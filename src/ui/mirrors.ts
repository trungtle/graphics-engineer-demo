import { ARENA, LEVELS, evaluate, snapAngle, type Evaluation, type PieceDef } from '../levels';
import type { Vec2 } from '../optics';

const PAD_PX = 22; // how close a finger must be to grab a piece
const HANDLE_PX = 15;
const EDGE = 3; // keep piece centers this far inside the arena
const PRISM_HANDLE_ANGLE = Math.PI / 4; // the handle sits out from the middle of the long side

const clonePieces = (ps: PieceDef[]): PieceDef[] => ps.map((p) => ({ ...p, pos: [...p.pos] as Vec2 }));

/** "Mirrors": drag and turn mirrors and glass so the laser reaches every target. */
export function initMirrors(): { onEnter: () => void; onLeave: () => void } {
  const board = document.getElementById('mirror-board')!;
  const canvas = document.getElementById('mirror-canvas') as HTMLCanvasElement;
  const root = document.getElementById('mirror-controls')!;
  root.innerHTML = `
    <div class="lvl-head"><span class="lvl-num" id="lvl-num">1</span><span class="lvl-of">/ ${LEVELS.length}</span><span class="lvl-name" id="lvl-name"></span></div>
    <div class="lvl-dots" id="lvl-dots"></div>
    <div class="lvl-actions">
      <button class="btn" id="lvl-reset" type="button">Reset</button>
      <button class="btn primary" id="lvl-next" type="button" disabled>Next</button>
    </div>`;
  const numEl = root.querySelector<HTMLElement>('#lvl-num')!;
  const nameEl = root.querySelector<HTMLElement>('#lvl-name')!;
  const dotsEl = root.querySelector<HTMLElement>('#lvl-dots')!;
  const resetBtn = root.querySelector<HTMLButtonElement>('#lvl-reset')!;
  const nextBtn = root.querySelector<HTMLButtonElement>('#lvl-next')!;

  let levelIndex = 0;
  let pieces = clonePieces(LEVELS[0].pieces);
  let evalNow: Evaluation = evaluate(LEVELS[0], pieces);
  let done: boolean[] = LEVELS.map(() => false);
  let selected: number | null = null;
  let drag: { mode: 'move' | 'turn'; piece: number; dx: number; dy: number } | null = null;
  let winAt = 0;
  let dirty = true;
  let raf = 0;
  let active = false;

  // ---- geometry helpers ----
  const view = () => {
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
  const distToSegment = (q: Vec2, a: Vec2, b: Vec2) => {
    const ab: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1])));
    return Math.hypot(q[0] - (a[0] + t * ab[0]), q[1] - (a[1] + t * ab[1]));
  };
  const hitPiece = (q: Vec2, pad: number): boolean => false && pad > 0 && q.length > 0; // placeholder replaced below
  void hitPiece;
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
    dirty = true;
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

  resetBtn.addEventListener('click', () => {
    done[levelIndex] = false;
    loadLevel(levelIndex);
  });
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
    if (selected !== null) {
      const h = handleOf(pieces[selected]);
      if (Math.hypot(q[0] - h[0], q[1] - h[1]) <= (HANDLE_PX + 8) / v.s) {
        drag = { mode: 'turn', piece: selected, dx: 0, dy: 0 };
        capture(e.pointerId);
        return;
      }
    }
    for (let i = pieces.length - 1; i >= 0; i--) {
      if (pieceHit(pieces[i], q, pad)) {
        selected = i;
        drag = { mode: 'move', piece: i, dx: pieces[i].pos[0] - q[0], dy: pieces[i].pos[1] - q[1] };
        capture(e.pointerId);
        dirty = true;
        return;
      }
    }
    selected = null;
    dirty = true;
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
    dirty = true;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- drawing ----
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

    // arena
    const a0 = toScreen([0, ARENA.h], v);
    ctx.fillStyle = '#0d1226';
    ctx.beginPath();
    ctx.roundRect(a0[0], a0[1], ARENA.w * v.s, ARENA.h * v.s, 14);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (let x = 5; x < ARENA.w; x += 5) {
      for (let y = 5; y < ARENA.h; y += 5) {
        const p = toScreen([x, y], v);
        ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2);
      }
    }

    // blockers
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = Math.max(8, v.s * 1.4);
    for (const b of level.blockers) {
      const p = toScreen(b.a, v);
      const q = toScreen(b.b, v);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }

    // beams (additive: three colors add up to white until glass pulls them apart)
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    for (const beam of evalNow.beams) {
      const [r, g, b] = beam.color;
      for (const [w, a] of [
        [11, 0.16],
        [3.2, 0.95],
      ] as const) {
        ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        beam.points.forEach((pt, i) => {
          const s = toScreen(pt, v);
          if (i === 0) ctx.moveTo(s[0], s[1]);
          else ctx.lineTo(s[0], s[1]);
        });
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // laser
    const lp = toScreen(level.laser.pos, v);
    ctx.save();
    ctx.translate(lp[0], lp[1]);
    ctx.rotate(-level.laser.angle);
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.roundRect(-v.s * 2.2, -v.s * 1.4, v.s * 4.4, v.s * 2.8, 6);
    ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(v.s * 1.4, -v.s * 0.5, v.s * 1.2, v.s);
    ctx.restore();

    // targets
    level.targets.forEach((t, i) => {
      const p = toScreen(t.pos, v);
      const r = t.r * v.s;
      const lit = evalNow.lit[i];
      if (lit) {
        const pulse = 0.5 + 0.5 * Math.sin((now - winAt) / 180);
        const g = ctx.createRadialGradient(p[0], p[1], r * 0.4, p[0], p[1], r * (2.2 + 0.4 * pulse));
        g.addColorStop(0, 'rgba(74,222,128,0.8)');
        g.addColorStop(1, 'rgba(74,222,128,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r * 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = lit ? '#4ade80' : '#0d1226';
      ctx.strokeStyle = lit ? '#bbf7d0' : '#94a3b8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p[0], p[1], r * 0.45, 0, Math.PI * 2);
      ctx.strokeStyle = lit ? '#14532d' : '#94a3b8';
      ctx.stroke();
    });

    // pieces
    pieces.forEach((p, i) => {
      const isSel = i === selected;
      if (p.kind === 'mirror') {
        const [a, b] = mirrorEnds(p).map((q) => toScreen(q, v));
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = Math.max(9, v.s * 1.5);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        ctx.strokeStyle = isSel ? '#ffffff' : '#cbd5e1';
        ctx.lineWidth = Math.max(5, v.s * 0.8);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      } else {
        const pts = prismPoints(p).map((q) => toScreen(q, v));
        ctx.fillStyle = 'rgba(186,230,253,0.28)';
        ctx.strokeStyle = isSel ? '#ffffff' : '#bae6fd';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach((s, k) => (k === 0 ? ctx.moveTo(s[0], s[1]) : ctx.lineTo(s[0], s[1])));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      if (isSel) {
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
        ctx.beginPath();
        ctx.arc(h[0], h[1], HANDLE_PX, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0d1226';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(h[0], h[1], HANDLE_PX * 0.55, -2.4, 1.2);
        ctx.stroke();
        ctx.fillStyle = '#0d1226';
        ctx.beginPath();
        ctx.moveTo(h[0] + HANDLE_PX * 0.55 * Math.cos(1.2) + 4, h[1] + HANDLE_PX * 0.55 * Math.sin(1.2) - 1);
        ctx.lineTo(h[0] + HANDLE_PX * 0.55 * Math.cos(1.2) - 5, h[1] + HANDLE_PX * 0.55 * Math.sin(1.2) - 3);
        ctx.lineTo(h[0] + HANDLE_PX * 0.55 * Math.cos(1.2) - 1, h[1] + HANDLE_PX * 0.55 * Math.sin(1.2) + 5);
        ctx.fill();
      }
    });
  }

  function loop(now: number) {
    if (!active) return;
    if (dirty || evalNow.won) {
      draw(now);
      dirty = false;
    }
    raf = requestAnimationFrame(loop);
  }

  new ResizeObserver(() => {
    dirty = true;
  }).observe(board);

  return {
    onEnter() {
      active = true;
      renderPanel();
      dirty = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    },
    onLeave() {
      active = false;
      cancelAnimationFrame(raf);
    },
  };
}
