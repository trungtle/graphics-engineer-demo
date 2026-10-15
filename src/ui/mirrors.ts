import { ARENA, LEVELS, evaluate, snapAngle, type Evaluation, type PieceDef } from '../levels';
import type { Vec2 } from '../optics';

const PAD_PX = 22; // how close a finger must be to grab a piece
const HANDLE_PX = 15;
const EDGE = 3; // keep piece centers this far inside the arena
const PRISM_HANDLE_ANGLE = Math.PI / 4; // the handle sits out from the middle of the long side

const clonePieces = (ps: PieceDef[]): PieceDef[] => ps.map((p) => ({ ...p, pos: [...p.pos] as Vec2 }));

type View = { w: number; h: number; s: number; ox: number; oy: number };

/**
 * "Mirrors": drag and turn mirrors and glass so the laser reaches the target.
 * Look: a dark table, a chrome mirror, a glass prism, a red-and-white bullseye, a glowing gold beam.
 */
export function initMirrors(): { onEnter: () => void; onLeave: () => void; reset: () => void } {
  const canvas = document.getElementById('mirror-canvas') as HTMLCanvasElement;
  const root = document.getElementById('mirror-controls')!;
  root.innerHTML = `
    <div class="lvl-head"><span class="lvl-num" id="lvl-num">1</span><span class="lvl-of">/ ${LEVELS.length}</span><span class="lvl-name" id="lvl-name"></span></div>
    <div class="lvl-dots" id="lvl-dots"></div>
    <div class="lvl-actions">
      <button class="btn" id="lvl-reset" type="button">Reset</button>
      <button class="btn" id="lvl-first" type="button">Start over</button>
      <button class="btn primary" id="lvl-next" type="button" disabled>Next</button>
    </div>`;
  const numEl = root.querySelector<HTMLElement>('#lvl-num')!;
  const nameEl = root.querySelector<HTMLElement>('#lvl-name')!;
  const dotsEl = root.querySelector<HTMLElement>('#lvl-dots')!;
  const resetBtn = root.querySelector<HTMLButtonElement>('#lvl-reset')!;
  const firstBtn = root.querySelector<HTMLButtonElement>('#lvl-first')!;
  const nextBtn = root.querySelector<HTMLButtonElement>('#lvl-next')!;

  let levelIndex = 0;
  let pieces = clonePieces(LEVELS[0].pieces);
  let evalNow: Evaluation = evaluate(LEVELS[0], pieces);
  let done: boolean[] = LEVELS.map(() => false);
  let selected: number | null = null;
  let drag: { mode: 'move' | 'turn'; piece: number; dx: number; dy: number } | null = null;
  let winAt = 0;
  let raf = 0;
  let active = false;

  // ---- geometry helpers ----
  const view = (): View => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const s = Math.min(w / ARENA.w, h / ARENA.h);
    return { w, h, s, ox: (w - ARENA.w * s) / 2, oy: (h - ARENA.h * s) / 2 };
  };
  const toScreen = (p: Vec2, v = view()): Vec2 => [v.ox + p[0] * v.s, v.oy + (ARENA.h - p[1]) * v.s];
  const toWorld = (px: number, py: number, v = view()): Vec2 => [(px - v.ox) / v.s, ARENA.h - (py - v.oy) / v.s];

  const prismPoints = (p: PieceDef): Vec2[] => {
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
    const rot = (x: number, y: number): Vec2 => [p.pos[0] + x * c - y * s, p.pos[1] + x * s + y * c];
    return [rot(0, 0), rot(p.size, 0), rot(0, p.size)];
  };
  const mirrorEnds = (p: PieceDef): [Vec2, Vec2] => {
    const h = p.size / 2;
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
    return [
      [p.pos[0] - h * c, p.pos[1] - h * s],
      [p.pos[0] + h * c, p.pos[1] + h * s],
    ];
  };
  const handleOf = (p: PieceDef): Vec2 => {
    if (p.kind === 'mirror') {
      const r = p.size / 2 + 4;
      return [p.pos[0] + r * Math.cos(p.angle), p.pos[1] + r * Math.sin(p.angle)];
    }
    const r = p.size * Math.SQRT1_2 + 5;
    const a = p.angle + PRISM_HANDLE_ANGLE;
    return [p.pos[0] + r * Math.cos(a), p.pos[1] + r * Math.sin(a)];
  };
  const centerOf = (p: PieceDef): Vec2 => {
    if (p.kind === 'mirror') return p.pos;
    const [a, b, c] = prismPoints(p);
    return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
  };
  const distToSegment = (q: Vec2, a: Vec2, b: Vec2) => {
    const ab: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1])));
    return Math.hypot(q[0] - (a[0] + t * ab[0]), q[1] - (a[1] + t * ab[1]));
  };
  const pieceHit = (p: PieceDef, q: Vec2, pad: number): boolean => {
    if (p.kind === 'mirror') {
      const [a, b] = mirrorEnds(p);
      return distToSegment(q, a, b) <= pad;
    }
    const [a, b, c] = prismPoints(p);
    const side = (u: Vec2, v: Vec2) => (v[0] - u[0]) * (q[1] - u[1]) - (v[1] - u[1]) * (q[0] - u[0]);
    const inside = side(a, b) >= 0 && side(b, c) >= 0 && side(c, a) >= 0;
    return inside || distToSegment(q, a, b) <= pad || distToSegment(q, b, c) <= pad || distToSegment(q, c, a) <= pad;
  };

  // ---- game state ----
  function refresh() {
    evalNow = evaluate(LEVELS[levelIndex], pieces);
    if (evalNow.won && !done[levelIndex]) {
      done[levelIndex] = true;
      winAt = performance.now();
    }
    if (!evalNow.won) winAt = 0;
    renderPanel();
  }

  function renderPanel() {
    numEl.textContent = String(levelIndex + 1);
    nameEl.textContent = LEVELS[levelIndex].name;
    dotsEl.innerHTML = LEVELS.map((_, i) => `<i class="${done[i] ? 'done' : ''}${i === levelIndex ? ' cur' : ''}"></i>`).join('');
    nextBtn.disabled = !evalNow.won;
    nextBtn.textContent = levelIndex === LEVELS.length - 1 ? 'Again' : 'Next';
  }

  function loadLevel(i: number) {
    levelIndex = i;
    pieces = clonePieces(LEVELS[i].pieces);
    selected = null;
    drag = null;
    winAt = 0;
    refresh();
  }

  /** Back to the very first level with no progress (also used when attract mode starts). */
  function startOver() {
    done = LEVELS.map(() => false);
    loadLevel(0);
  }

  resetBtn.addEventListener('click', () => {
    done[levelIndex] = false;
    loadLevel(levelIndex);
  });
  firstBtn.addEventListener('click', startOver);
  nextBtn.addEventListener('click', () => {
    if (levelIndex === LEVELS.length - 1) done = LEVELS.map(() => false);
    loadLevel((levelIndex + 1) % LEVELS.length);
  });

  // ---- pointer ----
  const pointerWorld = (e: PointerEvent): Vec2 => {
    const r = canvas.getBoundingClientRect();
    return toWorld(e.clientX - r.left, e.clientY - r.top);
  };
  const capture = (id: number) => {
    try {
      canvas.setPointerCapture(id);
    } catch {
      /* synthetic or unsupported pointer: dragging still works while it stays over the canvas */
    }
  };

  canvas.addEventListener('pointerdown', (e) => {
    const v = view();
    const q = pointerWorld(e);
    const pad = PAD_PX / v.s;
    // the turn handle of the selected piece first
    if (selected !== null && !pieces[selected].fixed) {
      const h = handleOf(pieces[selected]);
      if (Math.hypot(q[0] - h[0], q[1] - h[1]) <= (HANDLE_PX + 8) / v.s) {
        drag = { mode: 'turn', piece: selected, dx: 0, dy: 0 };
        capture(e.pointerId);
        return;
      }
    }
    for (let i = pieces.length - 1; i >= 0; i--) {
      if (pieces[i].fixed) continue; // locked pieces cannot be grabbed
      if (pieceHit(pieces[i], q, pad)) {
        selected = i;
        drag = { mode: 'move', piece: i, dx: pieces[i].pos[0] - q[0], dy: pieces[i].pos[1] - q[1] };
        capture(e.pointerId);
        return;
      }
    }
    selected = null;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const q = pointerWorld(e);
    const p = pieces[drag.piece];
    if (drag.mode === 'move') {
      p.pos = [
        Math.min(ARENA.w - EDGE, Math.max(EDGE, Math.round((q[0] + drag.dx) * 2) / 2)),
        Math.min(ARENA.h - EDGE, Math.max(EDGE, Math.round((q[1] + drag.dy) * 2) / 2)),
      ];
    } else {
      const offset = p.kind === 'mirror' ? 0 : PRISM_HANDLE_ANGLE;
      p.angle = snapAngle(Math.atan2(q[1] - p.pos[1], q[0] - p.pos[0]) - offset);
    }
    refresh();
  });

  const endDrag = () => {
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- drawing ----
  function drawLock(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, -4, 5, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.roundRect(-8, -4, 16, 12, 3);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(0, 2, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMirror(ctx: CanvasRenderingContext2D, p: PieceDef, v: View, isSel: boolean) {
    const c = toScreen(p.pos, v);
    const L = p.size * v.s;
    const th = Math.max(11, v.s * 1.7);
    ctx.save();
    ctx.translate(c[0], c[1]);
    ctx.rotate(-p.angle);
    // body and soft shadow
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(-L / 2, -th / 2, L, th, th / 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // chrome face
    const g = ctx.createLinearGradient(0, -th / 2, 0, th / 2);
    g.addColorStop(0, '#fbfdff');
    g.addColorStop(0.28, '#c7d2e0');
    g.addColorStop(0.5, '#8997ab');
    g.addColorStop(0.54, '#dfe7f2');
    g.addColorStop(1, '#5f6c7e');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(-L / 2 + 2, -th / 2 + 2, L - 4, th - 4, (th - 4) / 2);
    ctx.fill();
    // bright reflection streak
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-L / 2 + th * 0.8, -th * 0.22);
    ctx.lineTo(L / 2 - th * 0.8, -th * 0.22);
    ctx.stroke();
    if (isSel) {
      ctx.shadowColor = '#ffd45e';
      ctx.shadowBlur = 16;
      ctx.strokeStyle = '#ffe9a8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(-L / 2 - 2, -th / 2 - 2, L + 4, th + 4, th / 2 + 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPrism(ctx: CanvasRenderingContext2D, p: PieceDef, v: View, isSel: boolean) {
    const pts = prismPoints(p).map((q) => toScreen(q, v));
    const cen: Vec2 = [(pts[0][0] + pts[1][0] + pts[2][0]) / 3, (pts[0][1] + pts[1][1] + pts[2][1]) / 3];
    const trace = (poly: Vec2[]) => {
      ctx.beginPath();
      poly.forEach((s, k) => (k === 0 ? ctx.moveTo(s[0], s[1]) : ctx.lineTo(s[0], s[1])));
      ctx.closePath();
    };
    ctx.save();
    ctx.lineJoin = 'round';
    // glass body with a soft shadow
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    const mid: Vec2 = [(pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2];
    const g = ctx.createLinearGradient(pts[0][0], pts[0][1], mid[0], mid[1]);
    g.addColorStop(0, 'rgba(214,240,255,0.62)');
    g.addColorStop(1, 'rgba(96,165,230,0.22)');
    ctx.fillStyle = g;
    trace(pts);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // bevel: bright outer edge and a thinner inner one
    ctx.strokeStyle = isSel ? '#ffffff' : 'rgba(235,248,255,0.95)';
    ctx.lineWidth = 3;
    trace(pts);
    ctx.stroke();
    const inner = pts.map((q): Vec2 => [cen[0] + (q[0] - cen[0]) * 0.8, cen[1] + (q[1] - cen[1]) * 0.8]);
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 1.5;
    trace(inner);
    ctx.stroke();
    // glare strip along one leg
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    const along = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    trace([along(pts[0], pts[1], 0.1), along(pts[0], pts[1], 0.55), along(inner[0], inner[1], 0.5), along(inner[0], inner[1], 0.15)]);
    ctx.fill();
    if (isSel) {
      ctx.shadowColor = '#ffd45e';
      ctx.shadowBlur = 16;
      ctx.strokeStyle = '#ffe9a8';
      ctx.lineWidth = 2.5;
      trace(pts);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTarget(ctx: CanvasRenderingContext2D, pos: Vec2, r: number, lit: boolean, now: number, v: View) {
    const c = toScreen(pos, v);
    const R = r * v.s * 1.15;
    if (lit) {
      const pulse = 0.5 + 0.5 * Math.sin((now - winAt) / 180);
      const g = ctx.createRadialGradient(c[0], c[1], R * 0.4, c[0], c[1], R * (2.3 + 0.4 * pulse));
      g.addColorStop(0, 'rgba(74,222,128,0.85)');
      g.addColorStop(1, 'rgba(74,222,128,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c[0], c[1], R * 2.8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // a slow ring that draws the eye to where the light has to go
      const t = (now % 1800) / 1800;
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - t)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c[0], c[1], R * (1.1 + 0.9 * t), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    const bands: [number, string, string][] = [
      [1, '#f8fafc', '#dcfce7'],
      [0.78, '#e11d48', '#16a34a'],
      [0.56, '#f8fafc', '#dcfce7'],
      [0.34, '#e11d48', '#16a34a'],
      [0.14, '#f8fafc', '#dcfce7'],
    ];
    for (const [f, off, on] of bands) {
      ctx.fillStyle = lit ? on : off;
      ctx.beginPath();
      ctx.arc(c[0], c[1], R * f, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = 'transparent';
    }
    ctx.restore();
    if (lit) {
      ctx.strokeStyle = '#052e16';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c[0] - R * 0.25, c[1]);
      ctx.lineTo(c[0] - R * 0.05, c[1] + R * 0.22);
      ctx.lineTo(c[0] + R * 0.3, c[1] - R * 0.2);
      ctx.stroke();
    }
  }

  function draw(now: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const v = view();
    if (v.w === 0) return;
    if (canvas.width !== Math.round(v.w * dpr) || canvas.height !== Math.round(v.h * dpr)) {
      canvas.width = Math.round(v.w * dpr);
      canvas.height = Math.round(v.h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, v.w, v.h);
    const level = LEVELS[levelIndex];

    // the table: dark, slightly lit from above, darker at the edges
    const a0 = toScreen([0, ARENA.h], v);
    const aw = ARENA.w * v.s;
    const ah = ARENA.h * v.s;
    const tg = ctx.createLinearGradient(0, a0[1], 0, a0[1] + ah);
    tg.addColorStop(0, '#1b2444');
    tg.addColorStop(1, '#0a0f1f');
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.roundRect(a0[0], a0[1], aw, ah, 16);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(a0[0], a0[1], aw, ah, 16);
    ctx.clip();
    const vg = ctx.createRadialGradient(a0[0] + aw / 2, a0[1] + ah / 2, ah * 0.3, a0[0] + aw / 2, a0[1] + ah / 2, aw * 0.65);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg;
    ctx.fillRect(a0[0], a0[1], aw, ah);
    ctx.fillStyle = 'rgba(255,255,255,0.055)';
    for (let x = 5; x < ARENA.w; x += 5) {
      for (let y = 5; y < ARENA.h; y += 5) {
        const p = toScreen([x, y], v);
        ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2);
      }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(a0[0], a0[1], aw, ah, 16);
    ctx.stroke();

    // walls: dark steel with hazard stripes, so they read as "light stops here"
    ctx.lineCap = 'round';
    const wallW = Math.max(12, v.s * 1.9);
    for (const b of level.blockers) {
      const p = toScreen(b.a, v);
      const q = toScreen(b.b, v);
      ctx.strokeStyle = '#0b1220';
      ctx.lineWidth = wallW + 4;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = wallW;
      ctx.stroke();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = wallW * 0.55;
      ctx.setLineDash([wallW * 0.7, wallW * 0.7]);
      ctx.lineCap = 'butt';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
    }

    // the target sits under the beam so the light visibly lands on it
    level.targets.forEach((t, i) => drawTarget(ctx, t.pos, t.r, evalNow.lit[i], now, v));

    // the beam: soft bloom layers, then a hot white core (added together so it glows)
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    for (const beam of evalNow.beams) {
      const [r, g, b] = beam.color;
      const path = () => {
        ctx.beginPath();
        beam.points.forEach((pt, i) => {
          const s = toScreen(pt, v);
          if (i === 0) ctx.moveTo(s[0], s[1]);
          else ctx.lineTo(s[0], s[1]);
        });
      };
      for (const [w, a, col] of [
        [26, 0.07, `${r},${g},${b}`],
        [13, 0.16, `${r},${g},${b}`],
        [6, 0.5, `${r},${g},${b}`],
        [2.4, 1, '255,250,230'],
      ] as const) {
        ctx.strokeStyle = `rgba(${col},${a})`;
        ctx.lineWidth = w;
        path();
        ctx.stroke();
      }
      // a flare wherever the beam turns
      beam.points.slice(1, -1).forEach((pt) => {
        const s = toScreen(pt, v);
        const g2 = ctx.createRadialGradient(s[0], s[1], 0, s[0], s[1], 20);
        g2.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
        g2.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(s[0], s[1], 20, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.globalCompositeOperation = 'source-over';

    // laser: a steel body with a glowing lens
    const lp = toScreen(level.laser.pos, v);
    ctx.save();
    ctx.translate(lp[0], lp[1]);
    ctx.rotate(-level.laser.angle);
    const bw = v.s * 4.8;
    const bh = v.s * 3.2;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    const lg = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
    lg.addColorStop(0, '#94a3b8');
    lg.addColorStop(0.45, '#475569');
    lg.addColorStop(1, '#0f172a');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 7);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    const lens = ctx.createRadialGradient(bw / 2 - 2, 0, 0, bw / 2 - 2, 0, bh * 0.7);
    lens.addColorStop(0, 'rgba(255,240,200,1)');
    lens.addColorStop(0.4, 'rgba(255,196,80,0.9)');
    lens.addColorStop(1, 'rgba(255,196,80,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = lens;
    ctx.beginPath();
    ctx.arc(bw / 2 - 2, 0, bh * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // pieces on top
    pieces.forEach((p, i) => {
      const isSel = i === selected;
      if (p.kind === 'mirror') drawMirror(ctx, p, v, isSel);
      else drawPrism(ctx, p, v, isSel);
      if (p.fixed) {
        const c = toScreen(centerOf(p), v);
        drawLock(ctx, c[0], c[1]);
      }
      if (isSel && !p.fixed) {
        const c = toScreen(p.pos, v);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(c[0], c[1], HANDLE_PX + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const h = toScreen(handleOf(p), v);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(h[0], h[1], HANDLE_PX, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = '#0d1226';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(h[0], h[1], HANDLE_PX * 0.55, -2.4, 1.2);
        ctx.stroke();
        ctx.fillStyle = '#0d1226';
        const ax = h[0] + HANDLE_PX * 0.55 * Math.cos(1.2);
        const ay = h[1] + HANDLE_PX * 0.55 * Math.sin(1.2);
        ctx.beginPath();
        ctx.moveTo(ax + 4, ay - 1);
        ctx.lineTo(ax - 5, ay - 3);
        ctx.lineTo(ax - 1, ay + 5);
        ctx.fill();
      }
    });
  }

  function loop(now: number) {
    if (!active) return;
    draw(now);
    raf = requestAnimationFrame(loop);
  }

  return {
    onEnter() {
      active = true;
      renderPanel();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    },
    onLeave() {
      active = false;
      cancelAnimationFrame(raf);
    },
    reset: startOver,
  };
}
