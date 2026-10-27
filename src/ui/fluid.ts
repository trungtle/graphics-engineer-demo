// The Water station: a FLIP fluid in a glass tank. Drag a finger through the water to stir it, tilt the tank,
// drop a splash, or look under the hood: the particles the simulation moves and the grid it solves on.
import { Flip, FLUID, tiltedGravity, type Obstacle } from '../fluid';
import { formatCount } from './controls';
import { initEquation } from './equation';

type NsTerm = 'du' | 'adv' | 'p' | 'visc' | 'g';
/** Short labels shown under a tapped term. */
const NS_NAMES: Record<NsTerm, string> = {
  du: 'How the velocity changes',
  adv: 'Water carries its own motion',
  p: 'Pressure pushes water apart',
  visc: 'Stickiness (not simulated)',
  g: 'Gravity',
};

type View = 'water' | 'particles' | 'grid';
const VIEWS: { id: View; name: string }[] = [
  { id: 'water', name: 'Water' },
  { id: 'particles', name: 'Particles' },
  { id: 'grid', name: 'Grid' },
];

const DT = 1 / 60;
const MAX_TILT = (25 * Math.PI) / 180;
const BALL_R = 0.22;
const MAX_BALL_SPEED = 5; // m/s
/** water picture resolution: texels per grid cell */
const TEX_PER_CELL = 4;
const KERNEL_R = 3.2; // in texels
const SURFACE = 1.0; // density at the water's edge (interior is about 2)

export function initFluid(): { onEnter(): void; onLeave(): void; reset(): void; sim: Flip } {
  const canvas = document.getElementById('fluid-canvas') as HTMLCanvasElement;
  const root = document.getElementById('fluid-controls')!;
  const sim = new Flip();
  const eq = initEquation<NsTerm>('ns-equation', NS_NAMES);

  root.innerHTML = `
    <div class="ctl-row">
      <div class="stat"><span class="stat-num">${sim.count.toLocaleString('en-US')}</span><span class="stat-lab">particles</span></div>
      <div class="stat"><span class="stat-num">${(sim.nx * sim.ny).toLocaleString('en-US')}</span><span class="stat-lab">grid cells</span></div>
      <div class="stat"><span class="stat-num" id="fluid-steps">0</span><span class="stat-lab">steps</span></div>
    </div>
    <div class="seg fluid-view" role="radiogroup" aria-label="View">
      ${VIEWS.map((v) => `<button class="seg-btn" type="button" role="radio" data-view="${v.id}">${v.name}</button>`).join('')}
    </div>
    <div class="ctl-block">
      <div class="ctl-head"><span class="ctl-title">Tilt</span><span class="ctl-val" id="fluid-tilt-val">0°</span></div>
      <input id="fluid-tilt" class="slider" type="range" min="-25" max="25" step="1" value="0" aria-label="Tilt" />
    </div>
    <div class="lvl-actions">
      <button class="btn" id="fluid-splash" type="button">Splash</button>
      <button class="btn" id="fluid-reset" type="button">Reset</button>
    </div>`;
  const stepsEl = root.querySelector<HTMLElement>('#fluid-steps')!;
  const tiltEl = root.querySelector<HTMLInputElement>('#fluid-tilt')!;
  const tiltVal = root.querySelector<HTMLElement>('#fluid-tilt-val')!;
  const viewBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('.seg-btn[data-view]'));

  let view: View = 'water';
  let tiltTarget = 0;
  let tilt = 0;
  let steps = 0;
  let active = false;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let ball: (Obstacle & { id: number }) | null = null;

  const paintView = () =>
    viewBtns.forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  viewBtns.forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.view as View;
      paintView();
      eq.highlight(view === 'grid' ? 'p' : view === 'particles' ? 'adv' : 'du');
    }),
  );
  const syncTilt = () => {
    tiltEl.value = String(Math.round((tiltTarget * 180) / Math.PI));
    tiltVal.textContent = `${tiltEl.value}°`;
    tiltEl.style.setProperty('--fill', `${((Number(tiltEl.value) + 25) / 50) * 100}%`);
  };
  tiltEl.addEventListener('input', () => {
    tiltTarget = (Number(tiltEl.value) * Math.PI) / 180;
    syncTilt();
    eq.highlight('g');
  });
  root.querySelector('#fluid-splash')!.addEventListener('click', () => {
    sim.splash();
    eq.highlight('g');
  });
  root.querySelector('#fluid-reset')!.addEventListener('click', () => reset());
  paintView();
  syncTilt();

  function reset() {
    sim.reset();
    ball = null;
    tiltTarget = 0;
    tilt = 0;
    steps = 0;
    view = 'water';
    paintView();
    syncTilt();
  }

  // ---- layout: the tank is fitted so it never leaves the picture at full tilt ----
  let cssW = 0;
  let cssH = 0;
  let scale = 1; // px per metre
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    cssW = r.width;
    cssH = r.height;
    const bw = sim.width * Math.cos(MAX_TILT) + sim.height * Math.sin(MAX_TILT);
    const bh = sim.width * Math.sin(MAX_TILT) + sim.height * Math.cos(MAX_TILT);
    scale = Math.min((cssW * 0.92) / bw, (cssH * 0.9) / bh);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };
  new ResizeObserver(fit).observe(canvas);

  /** screen (CSS px) -> tank metres, undoing the tilt */
  const toTank = (px: number, py: number): [number, number] => {
    const dx = px - cssW / 2;
    const dy = py - cssH / 2;
    // screen y grows down; the tank is drawn rotated by +tilt (clockwise on screen)
    const c = Math.cos(-tilt);
    const s = Math.sin(-tilt);
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    return [rx / scale + sim.width / 2, sim.height / 2 - ry / scale];
  };

  // ---- touch: a ball that follows the finger and pushes the water ----
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const [x, y] = toTank(e.clientX - r.left, e.clientY - r.top);
    canvas.setPointerCapture(e.pointerId);
    ball = { id: e.pointerId, x, y, vx: 0, vy: 0, r: BALL_R };
    eq.highlight('p', 4000);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ball || e.pointerId !== ball.id) return;
    const r = canvas.getBoundingClientRect();
    const [x, y] = toTank(e.clientX - r.left, e.clientY - r.top);
    const cx = Math.min(Math.max(x, sim.h + BALL_R), sim.width - sim.h - BALL_R);
    const cy = Math.min(Math.max(y, sim.h + BALL_R), sim.height - BALL_R);
    // velocity from the move, smoothed so jittery touch events do not kick the water
    ball.vx = 0.5 * ball.vx + 0.5 * ((cx - ball.x) / DT);
    ball.vy = 0.5 * ball.vy + 0.5 * ((cy - ball.y) / DT);
    // a flick should splash, not blow the tank apart
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > MAX_BALL_SPEED) {
      ball.vx *= MAX_BALL_SPEED / sp;
      ball.vy *= MAX_BALL_SPEED / sp;
    }
    ball.x = cx;
    ball.y = cy;
  });
  const lift = (e: PointerEvent) => {
    if (ball && e.pointerId === ball.id) ball = null;
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  // ---- drawing ----
  const RW = sim.nx * TEX_PER_CELL;
  const RH = sim.ny * TEX_PER_CELL;
  const dens = new Float32Array(RW * RH);
  const speed = new Float32Array(RW * RH);
  const off = document.createElement('canvas');
  off.width = RW;
  off.height = RH;
  const offCtx = off.getContext('2d')!;
  const img = offCtx.createImageData(RW, RH);
  const texPerM = TEX_PER_CELL / sim.h;
  const kr = Math.ceil(KERNEL_R);

  function waterImage() {
    dens.fill(0);
    speed.fill(0);
    const R2 = KERNEL_R * KERNEL_R;
    for (let i = 0; i < sim.count; i++) {
      const tx = sim.pos[2 * i] * texPerM;
      const ty = (sim.height - sim.pos[2 * i + 1]) * texPerM; // image rows go down
      const sp = Math.hypot(sim.vel[2 * i], sim.vel[2 * i + 1]);
      const x0 = Math.max(0, Math.floor(tx - kr));
      const x1 = Math.min(RW - 1, Math.ceil(tx + kr));
      const y0 = Math.max(0, Math.floor(ty - kr));
      const y1 = Math.min(RH - 1, Math.ceil(ty + kr));
      for (let y = y0; y <= y1; y++) {
        const dy = y + 0.5 - ty;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - tx;
          const q = (dx * dx + dy * dy) / R2;
          if (q >= 1) continue;
          const w = (1 - q) * (1 - q);
          dens[y * RW + x] += w;
          speed[y * RW + x] += w * sp;
        }
      }
    }
    const px = img.data;
    for (let y = 0; y < RH; y++) {
      const depth = y / RH; // 0 at the top of the tank
      for (let x = 0; x < RW; x++) {
        const k = y * RW + x;
        const d = dens[k];
        const o = k * 4;
        if (d < SURFACE * 0.7) {
          px[o + 3] = 0;
          continue;
        }
        const t = Math.min(1, (d - SURFACE * 0.7) / (SURFACE * 0.6));
        const a = t * t * (3 - 2 * t);
        // fast water turns pale (foam), but stays clearly blue against the light tank
        const foam = 0.6 * Math.min(1, Math.max(0, (speed[k] / d - 2) / 3));
        // deeper water is a darker blue
        const r0 = 40 - 25 * depth;
        const g0 = 160 - 60 * depth;
        const b0 = 235 - 35 * depth;
        px[o] = r0 + (170 - r0) * foam;
        px[o + 1] = g0 + (220 - g0) * foam;
        px[o + 2] = b0 + (250 - b0) * foam;
        px[o + 3] = 235 * a;
      }
    }
    offCtx.putImageData(img, 0, 0);
  }

  const SPEED_COLORS = Array.from({ length: 8 }, (_, i) => {
    const t = i / 7;
    return `rgb(${Math.round(30 + 220 * t)},${Math.round(120 + 130 * t)},${Math.round(230 + 25 * t)})`;
  });

  function draw() {
    const ctx = canvas.getContext('2d')!;
    const dpr = canvas.width / Math.max(1, cssW);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const W = sim.width * scale;
    const H = sim.height * scale;

    ctx.save();
    ctx.translate(cssW / 2, cssH / 2);
    ctx.rotate(tilt);
    ctx.translate(-W / 2, -H / 2);
    const wall = sim.h * scale;

    // glass back panel
    ctx.fillStyle = '#eef4fa';
    ctx.fillRect(wall, 0, W - 2 * wall, H - wall);

    if (view === 'grid') {
      ctx.fillStyle = 'rgba(37, 99, 235, 0.22)';
      for (let i = 0; i < sim.nx; i++)
        for (let j = 0; j < sim.ny; j++)
          if (sim.cellType[i * sim.ny + j] === FLUID) ctx.fillRect(i * wall, H - (j + 1) * wall, wall, wall);
      ctx.strokeStyle = 'rgba(22, 32, 46, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= sim.nx; i++) {
        ctx.moveTo(i * wall, 0);
        ctx.lineTo(i * wall, H);
      }
      for (let j = 0; j <= sim.ny; j++) {
        ctx.moveTo(0, H - j * wall);
        ctx.lineTo(W, H - j * wall);
      }
      ctx.stroke();
    }

    if (view === 'water') {
      waterImage();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, W, H);
    } else {
      const pr = Math.max(1.2, sim.radius * scale * (view === 'grid' ? 0.6 : 1));
      const buckets: number[][] = SPEED_COLORS.map(() => []);
      for (let i = 0; i < sim.count; i++) {
        const sp = Math.hypot(sim.vel[2 * i], sim.vel[2 * i + 1]);
        buckets[Math.min(7, Math.floor(sp / 0.8))].push(i);
      }
      buckets.forEach((ids, b) => {
        ctx.fillStyle = SPEED_COLORS[b];
        ctx.beginPath();
        for (const i of ids) {
          const x = sim.pos[2 * i] * scale;
          const y = H - sim.pos[2 * i + 1] * scale;
          ctx.moveTo(x + pr, y);
          ctx.arc(x, y, pr, 0, Math.PI * 2);
        }
        ctx.fill();
      });
    }

    // the stirring ball
    if (ball) {
      const bx = ball.x * scale;
      const by = H - ball.y * scale;
      const br = ball.r * scale;
      const g = ctx.createRadialGradient(bx - br * 0.35, by - br * 0.35, br * 0.1, bx, by, br);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#9aa7b8');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }

    // glass walls and floor (open top)
    ctx.fillStyle = 'rgba(120, 150, 180, 0.55)';
    ctx.fillRect(0, 0, wall, H);
    ctx.fillRect(W - wall, 0, wall, H);
    ctx.fillRect(0, H - wall, W, wall);
    ctx.strokeStyle = 'rgba(70, 95, 125, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, H);
    ctx.lineTo(W, H);
    ctx.lineTo(W, 0);
    ctx.stroke();
    ctx.restore();
  }

  function frame(now: number) {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    if (cssW === 0) fit();
    acc += Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    // ease the tank toward the slider so tilting is smooth
    tilt += (tiltTarget - tilt) * 0.08;
    let n = 0;
    while (acc >= DT && n < 2) {
      sim.setObstacle(ball);
      const [gx, gy] = tiltedGravity(tilt);
      sim.step(DT, gx, gy);
      acc -= DT;
      steps++;
      n++;
    }
    if (n === 2) acc = 0; // too slow to keep up: run in slow motion rather than pile up work
    stepsEl.textContent = formatCount(steps);
    draw();
  }

  return {
    sim,
    reset,
    onEnter() {
      active = true;
      last = 0;
      acc = 0;
      fit();
      raf = requestAnimationFrame(frame);
    },
    onLeave() {
      active = false;
      cancelAnimationFrame(raf);
      ball = null;
    },
  };
}
