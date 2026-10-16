import { BEAM_Y, CHANNEL_COLORS, TARGET_LIT, buildBench, benchCamera, puzzleToWorld, worldToPuzzle, type BenchScene } from '../bench';
import { ARENA, LEVELS, evaluate, snapAngle, type Evaluation, type PieceDef } from '../levels';
import type { Vec2 } from '../optics';
import { project, rayDir } from '../render/cpu';

const PAD_PX = 26; // how close a finger must be to grab a piece
const HANDLE_PX = 17;
const EDGE = 3; // keep piece centers this far inside the board
const PRISM_HANDLE_ANGLE = Math.PI / 4; // the handle sits out from the middle of the long side

const clonePieces = (ps: PieceDef[]): PieceDef[] => ps.map((p) => ({ ...p, pos: [...p.pos] as Vec2 }));
const css = (c: readonly number[], a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

/**
 * "Mirrors" in 3D: the picture is the path-traced optical bench; this file holds the game state, turns finger
 * movements on the table into piece moves, and draws the things that sit on top (turn handle, outline, glow).
 */
export function initBench(opts: { setBench: (b: BenchScene | null, live?: boolean) => void }): {
  onEnter: () => void;
  onLeave: () => void;
  reset: () => void;
  /** development helper: put every piece on its winning spot */
  solve: () => void;
  puzzlePx: (p: [number, number], y?: number) => [number, number];
  pieces: () => PieceDef[];
} {
  const overlay = document.getElementById('bench-overlay') as HTMLCanvasElement;
  const root = document.getElementById('mirror-controls')!;
  const level = LEVELS[0];
  root.innerHTML = `
    <div class="chan-dots" id="chan-dots" aria-hidden="true">${level.targets
      .map((t) => `<i style="--cc:${css(t.channel === undefined ? TARGET_LIT : CHANNEL_COLORS[t.channel])}"></i>`)
      .join('')}</div>
    <div class="lvl-actions"><button class="btn" id="bench-reset" type="button">Reset</button></div>`;
  const dots = Array.from(root.querySelectorAll<HTMLElement>('#chan-dots i'));
  const resetBtn = root.querySelector<HTMLButtonElement>('#bench-reset')!;

  const cam = benchCamera();
  let pieces = clonePieces(level.pieces);
  let evalNow: Evaluation = evaluate(level, pieces);
  let selected: number | null = null;
  let drag: { mode: 'move' | 'turn'; piece: number; dx: number; dy: number } | null = null;
  let winAt = 0;
  let raf = 0;
  let active = false;

  // ---- 3D <-> screen ----
  const dims = () => {
    const w = overlay.clientWidth;
    const h = overlay.clientHeight;
    return { w, h, aspect: w / Math.max(1, h) };
  };
  const toPx = (world: [number, number, number]): Vec2 => {
    const { w, h, aspect } = dims();
    const q = project(world, aspect, cam);
    return [((q[0] + 1) / 2) * w, ((1 - q[1]) / 2) * h];
  };
  const puzzlePx = (p: Vec2, y = 0): Vec2 => toPx(puzzleToWorld(p, y));
  /** Where on the table (in puzzle units) a point on the screen is; null above the horizon. */
  const pointerToPuzzle = (e: PointerEvent): Vec2 | null => {
    const r = overlay.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = 1 - ((e.clientY - r.top) / r.height) * 2;
    const rd = rayDir(nx, ny, r.width / r.height, cam);
    if (rd[1] >= -1e-6) return null;
    const t = -cam.pos[1] / rd[1];
    return worldToPuzzle(cam.pos[0] + rd[0] * t, cam.pos[2] + rd[2] * t);
  };
  /** Puzzle units per screen pixel near the middle of the board (used to size touch targets). */
  const unitsPerPx = () => {
    const a = puzzlePx([40, 30]);
    const b = puzzlePx([41, 30]);
    return 1 / Math.max(2, Math.hypot(a[0] - b[0], a[1] - b[1]));
  };

  // ---- piece geometry (puzzle units) ----
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
  function apply(live: boolean) {
    evalNow = evaluate(level, pieces);
    if (evalNow.won && winAt === 0) winAt = performance.now();
    if (!evalNow.won) winAt = 0;
    dots.forEach((d, i) => d.classList.toggle('on', !!evalNow.lit[i]));
    opts.setBench(buildBench(level, pieces, evalNow), live);
  }

  function startOver() {
    pieces = clonePieces(level.pieces);
    selected = null;
    drag = null;
    winAt = 0;
    apply(false);
  }
  resetBtn.addEventListener('click', startOver);

  // ---- pointer ----
  const capture = (id: number) => {
    try {
      overlay.setPointerCapture(id);
    } catch {
      /* synthetic or unsupported pointer: dragging still works while it stays over the picture */
    }
  };

  overlay.addEventListener('pointerdown', (e) => {
    const q = pointerToPuzzle(e);
    if (!q) return;
    const upp = unitsPerPx();
    if (selected !== null) {
      const h = handleOf(pieces[selected]);
      if (Math.hypot(q[0] - h[0], q[1] - h[1]) <= (HANDLE_PX + 10) * upp) {
        drag = { mode: 'turn', piece: selected, dx: 0, dy: 0 };
        capture(e.pointerId);
        return;
      }
    }
    for (let i = pieces.length - 1; i >= 0; i--) {
      if (pieceHit(pieces[i], q, Math.max(2.2, PAD_PX * upp))) {
        selected = i;
        drag = { mode: 'move', piece: i, dx: pieces[i].pos[0] - q[0], dy: pieces[i].pos[1] - q[1] };
        capture(e.pointerId);
        return;
      }
    }
    selected = null;
  });

  overlay.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const q = pointerToPuzzle(e);
    if (!q) return;
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
    apply(true);
  });

  const endDrag = () => {
    if (drag) apply(false); // let the picture settle into the clean path-traced image
    drag = null;
  };
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);

  // ---- overlay drawing ----
  function draw(now: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { w, h } = dims();
    if (w === 0) return;
    if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
      overlay.width = Math.round(w * dpr);
      overlay.height = Math.round(h * dpr);
    }
    const ctx = overlay.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // soft glow around the beam (three colors added together: white until the glass splits them)
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    evalNow.beams.forEach((beam) => {
      const [r, g, b] = beam.color;
      const path = () => {
        ctx.beginPath();
        beam.points.forEach((pt, i) => {
          const s = puzzlePx(pt, BEAM_Y);
          if (i === 0) ctx.moveTo(s[0], s[1]);
          else ctx.lineTo(s[0], s[1]);
        });
      };
      for (const [lw, a] of [
        [34, 0.035],
        [16, 0.07],
      ] as const) {
        ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
        ctx.lineWidth = lw;
        path();
        ctx.stroke();
      }
      beam.points.slice(1, -1).forEach((pt) => {
        const s = puzzlePx(pt, BEAM_Y);
        const g2 = ctx.createRadialGradient(s[0], s[1], 0, s[0], s[1], 26);
        g2.addColorStop(0, `rgba(${r},${g},${b},0.25)`);
        g2.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(s[0], s[1], 26, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    // lit targets glow in their own color
    level.targets.forEach((t, i) => {
      if (!evalNow.lit[i]) return;
      const c = puzzlePx(t.pos, 0.15);
      const col = t.channel === undefined ? TARGET_LIT : CHANNEL_COLORS[t.channel];
      const pulse = 0.5 + 0.5 * Math.sin((now - winAt) / 220);
      const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], 60 + 14 * pulse);
      g.addColorStop(0, css(col, 0.5));
      g.addColorStop(1, css(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c[0], c[1], 80, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';

    // selected piece: outline on the table and the turn handle
    if (selected !== null) {
      const p = pieces[selected];
      const outline: Vec2[] =
        p.kind === 'mirror'
          ? (() => {
              const [a, b] = mirrorEnds(p);
              const nx = -Math.sin(p.angle) * 0.9;
              const ny = Math.cos(p.angle) * 0.9;
              return [
                [a[0] + nx, a[1] + ny],
                [b[0] + nx, b[1] + ny],
                [b[0] - nx, b[1] - ny],
                [a[0] - nx, a[1] - ny],
              ] as Vec2[];
            })()
          : prismPoints(p);
      ctx.shadowColor = '#ffd45e';
      ctx.shadowBlur = 16;
      ctx.strokeStyle = '#ffe9a8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      outline.forEach((q, i) => {
        const s = puzzlePx(q, 0.01);
        if (i === 0) ctx.moveTo(s[0], s[1]);
        else ctx.lineTo(s[0], s[1]);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.shadowBlur = 0;
      const hp = puzzlePx(handleOf(p), 0.2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(hp[0], hp[1], HANDLE_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#0d1226';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(hp[0], hp[1], HANDLE_PX * 0.55, -2.4, 1.2);
      ctx.stroke();
      const ax = hp[0] + HANDLE_PX * 0.55 * Math.cos(1.2);
      const ay = hp[1] + HANDLE_PX * 0.55 * Math.sin(1.2);
      ctx.fillStyle = '#0d1226';
      ctx.beginPath();
      ctx.moveTo(ax + 4, ay - 1);
      ctx.lineTo(ax - 5, ay - 3);
      ctx.lineTo(ax - 1, ay + 5);
      ctx.fill();
    }
  }

  function loop(now: number) {
    if (!active) return;
    draw(now);
    raf = requestAnimationFrame(loop);
  }

  return {
    onEnter() {
      active = true;
      apply(false);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    },
    onLeave() {
      active = false;
      cancelAnimationFrame(raf);
      opts.setBench(null);
    },
    reset: startOver,
    solve() {
      pieces = level.pieces.map((p, i) => ({ ...p, pos: [...level.solution[i].pos] as Vec2, angle: level.solution[i].angle }));
      selected = null;
      apply(false);
    },
    puzzlePx,
    pieces: () => pieces,
  };
}
