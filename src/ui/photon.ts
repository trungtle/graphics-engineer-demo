import { cameraOf, project, recordPath, type PathSegment, type Vec3 } from '../render/cpu';
import { lightRadiance, type SceneState } from '../scene';

// Timing (ms): each segment is a travel phase then a short dwell where the hit glows.
const TRAVEL_MS = 750;
const DWELL_MS = 300;
const SEG_MS = TRAVEL_MS + DWELL_MS;
const HOLD_MS = 12000;
const FADE_MS = 1000;
// "All samples" view: how many of the pixel's sample paths to trace, and how long the reveal takes.
export const SAMPLES = 128;
const REVEAL_MS = 5500;

export interface Photon {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  /** Send a photon (or, in "All samples" mode, a whole pixel's worth) from a screen position in [-1,1] (y up). */
  trace(ndcX: number, ndcY: number): void;
  /** Stop and forget everything (scene changed): also resets the tally. */
  clear(): void;
  /** Position and direction of the flying photon at time `now`, for the first-person view (null when none). */
  pose(now: number): { pos: Vec3; fwd: Vec3 } | null;
  /** On-screen rectangle of the first-person inset, or null when it is not shown. */
  viewRect(): DOMRect | null;
}

export type Outcome = 'light' | 'object' | 'miss';

/** How a path ended: found the lamp, ended on a surface without finding light, or left the box. */
export function classify(path: PathSegment[]): Outcome {
  const last = path[path.length - 1];
  if (last.event === 'light') return 'light';
  if (last.event === 'escaped') return 'miss';
  return 'object';
}

/** Linear RGB this photon brings back to the pixel: lamp radiance times every surface color on the way. */
export function pathColor(path: PathSegment[], scene: SceneState): Vec3 {
  if (classify(path) !== 'light') return [0, 0, 0];
  const L = lightRadiance(scene.light);
  let r = L[0];
  let g = L[1];
  let b = L[2];
  for (const seg of path) {
    if (seg.event === 'light') break;
    r *= seg.albedo[0];
    g *= seg.albedo[1];
    b *= seg.albedo[2];
  }
  return [r, g, b];
}

/** n independent sample paths from one screen position (deterministic for a given seed0). */
export function samplePaths(
  ndcX: number,
  ndcY: number,
  aspect: number,
  scene: SceneState,
  n: number,
  seed0: number,
): PathSegment[][] {
  const out: PathSegment[][] = [];
  for (let i = 0; i < n; i++) out.push(recordPath(ndcX, ndcY, aspect, scene, (seed0 + i * 7919) >>> 0));
  return out.filter((p) => p.length > 0);
}

/** How many sample paths found the lamp, and the average color they bring back (linear RGB). */
export function summarize(paths: PathSegment[][], scene: SceneState): { found: number; avg: Vec3 } {
  let found = 0;
  const sum: Vec3 = [0, 0, 0];
  for (const p of paths) {
    if (classify(p) === 'light') found++;
    const c = pathColor(p, scene);
    sum[0] += c[0];
    sum[1] += c[1];
    sum[2] += c[2];
  }
  const n = Math.max(1, paths.length);
  return { found, avg: [sum[0] / n, sum[1] / n, sum[2] / n] };
}

const aces = (x: number) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
/** Linear radiance to the 0-255 value the display shader would show. */
export function toDisplay(c: Vec3): [number, number, number] {
  return c.map((v) => Math.round(255 * Math.pow(aces(v), 1 / 2.2))) as [number, number, number];
}

const swatch = (c: [number, number, number]) =>
  `<i class="sw" style="background:rgb(${c[0]},${c[1]},${c[2]})"></i> (${c[0]}, ${c[1]}, ${c[2]})`;

const TITLE: Record<Outcome, string> = { light: 'Hit light', object: 'Hit object', miss: 'Miss' };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const unit = (a: Vec3): Vec3 => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const ease = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, p)));
const clampInside = (p: Vec3): Vec3 => p.map((v) => Math.min(0.97, Math.max(-0.97, v))) as Vec3;

interface ManyState {
  paths: PathSegment[][];
  outcomes: Outcome[];
  colors: Vec3[];
  /** per path: the color it carries after each bounce (hue of the lamp, tinted by the surfaces hit) */
  tints: Vec3[][];
  /** the real pixel color from the picture (0-255), shown as the target ring */
  pixelRef: [number, number, number] | null;
  tapNdc: [number, number];
  start: number;
  counted: number;
  found: number;
  sum: Vec3;
  lastCaption: number;
  done: boolean;
}

export function initPhoton(opts: {
  stage: HTMLElement;
  view: HTMLCanvasElement;
  scene: SceneState;
  toast: (title: string, text: string, ms?: number) => void;
  highlight: (t: 'le' | 'int') => void;
  /** Linear RGB of the accumulated image around a screen position in [-1,1] (null if unavailable). */
  readPixel: (ndcX: number, ndcY: number) => Vec3 | null;
  /** How many samples per pixel the renderer has accumulated so far. */
  samplesSoFar: () => number;
}): Photon {
  const { stage, view, scene } = opts;

  const overlay = document.createElement('canvas');
  overlay.id = 'photon-overlay';
  stage.appendChild(overlay);
  const ctx = overlay.getContext('2d')!;

  const btn = document.createElement('button');
  btn.id = 'photon-btn';
  btn.type = 'button';
  btn.setAttribute('aria-pressed', 'false');
  btn.textContent = 'Be a photon';
  stage.appendChild(btn);

  // Sub-options, only visible in photon mode
  const tools = document.createElement('div');
  tools.id = 'photon-tools';
  const manyBtn = document.createElement('button');
  manyBtn.type = 'button';
  manyBtn.className = 'pill';
  manyBtn.id = 'photon-many-btn';
  manyBtn.setAttribute('aria-pressed', 'false');
  manyBtn.textContent = 'All samples';
  const fpBtn = document.createElement('button');
  fpBtn.type = 'button';
  fpBtn.className = 'pill on';
  fpBtn.id = 'photon-fp-btn';
  fpBtn.setAttribute('aria-pressed', 'true');
  fpBtn.textContent = "Photon's view";
  tools.append(manyBtn, fpBtn);
  stage.appendChild(tools);

  const fpFrame = document.createElement('div');
  fpFrame.id = 'fp-frame';
  fpFrame.hidden = true;
  fpFrame.innerHTML = "<span>Photon's view</span>";
  stage.appendChild(fpFrame);

  let on = false;
  let manyMode = false;
  let fpOn = true;
  let segs: PathSegment[] = [];
  let tints: Vec3[] = [];
  let tapNdc: [number, number] = [0, 0];
  let start = 0;
  let resultShown = false;
  let raf = 0;
  let many: ManyState | null = null;
  const tally = { sent: 0, found: 0 };

  const aspect = () => view.clientWidth / view.clientHeight;

  function toPx(p: Vec3): [number, number] {
    const [nx, ny] = project(p, aspect(), cameraOf(scene));
    return [((nx + 1) / 2) * view.clientWidth, ((1 - ny) / 2) * view.clientHeight];
  }
  const ndcToPx = (nx: number, ny: number): [number, number] => [
    ((nx + 1) / 2) * view.clientWidth,
    ((1 - ny) / 2) * view.clientHeight,
  ];

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(view.clientWidth * dpr);
    const h = Math.round(view.clientHeight * dpr);
    if (overlay.width !== w || overlay.height !== h) {
      overlay.width = w;
      overlay.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const lampHue = (): Vec3 => {
    const L = lightRadiance(scene.light);
    const m = Math.max(L[0], L[1], L[2]);
    return [L[0] / m, L[1] / m, L[2] / m];
  };

  /** Photon glow color: the lamp's hue, tinted by each surface it bounced off. */
  function buildTints(path: PathSegment[]): Vec3[] {
    let c = lampHue();
    const out: Vec3[] = [c];
    for (const seg of path) {
      if (seg.event !== 'light' && seg.event !== 'escaped') {
        const n: Vec3 = [c[0] * seg.albedo[0], c[1] * seg.albedo[1], c[2] * seg.albedo[2]];
        const mx = Math.max(n[0], n[1], n[2], 1e-3);
        c = [n[0] / mx, n[1] / mx, n[2] / mx];
      }
      out.push(c);
    }
    return out;
  }

  const rgba = (c: Vec3, a: number, lift = 0.35) =>
    `rgba(${Math.round(255 * (c[0] * (1 - lift) + lift))},${Math.round(255 * (c[1] * (1 - lift) + lift))},${Math.round(
      255 * (c[2] * (1 - lift) + lift),
    )},${a})`;

  function glow(x: number, y: number, radius: number, c: Vec3, a: number) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, rgba(c, a, 0.6));
    g.addColorStop(0.4, rgba(c, a * 0.45, 0.2));
    g.addColorStop(1, rgba(c, 0, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------- one photon ----------

  function showResult() {
    resultShown = true;
    const outcome = classify(segs);
    if (outcome === 'light') tally.found++;
    const mine = toDisplay(pathColor(segs, scene));
    const px = opts.readPixel(tapNdc[0], tapNdc[1]);
    const pixelText = px ? ` &nbsp; Pixel in the picture: ${swatch(toDisplay(px))}` : '';
    opts.toast(
      TITLE[outcome],
      `This photon brings back ${swatch(mine)}.${pixelText} &nbsp; <small>(${tally.found} of ${tally.sent} photons found the lamp)</small>`,
      HOLD_MS,
    );
    opts.highlight(outcome === 'light' ? 'le' : 'int');
  }

  function frameOne(now: number) {
    const t = now - start;
    const total = segs.length * SEG_MS;
    if (!resultShown && t >= total) showResult();
    const fade = t > total + HOLD_MS ? Math.max(0, 1 - (t - total - HOLD_MS) / FADE_MS) : 1;
    if (fade <= 0) {
      stop();
      return;
    }

    ctx.globalAlpha = fade;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    let head: [number, number] | null = null;
    let headTint: Vec3 = tints[0];
    segs.forEach((seg, i) => {
      const local = t - i * SEG_MS;
      if (local <= 0) return;
      const p = Math.min(1, local / TRAVEL_MS);
      const e = ease(p);
      const [ax, ay] = toPx(seg.from);
      const [bx, by] = toPx(seg.to);
      const hx = ax + (bx - ax) * e;
      const hy = ay + (by - ay) * e;
      const c = tints[i];
      // soft wide trail + bright core
      ctx.strokeStyle = rgba(c, 0.22);
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.strokeStyle = rgba(c, 0.95, 0.5);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      if (p >= 1 && seg.surface !== 'none') {
        // the hit lights up the surface: a glow that swells during the dwell and then settles
        const d = Math.min(1, (local - TRAVEL_MS) / DWELL_MS);
        const burst = Math.sin(Math.PI * d);
        const big = seg.event === 'light' ? 1.5 : 1;
        glow(bx, by, (46 + 40 * burst) * big, tints[i + 1], 0.45 + 0.35 * burst);
      }
      head = [hx, hy];
      headTint = c;
    });
    if (head && t < total - DWELL_MS) {
      glow(head[0], head[1], 70, headTint, 0.9);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(head[0], head[1], 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- all of a pixel's samples ----------

  const polyline = (path: PathSegment[]): [number, number][] => {
    const pts: [number, number][] = [toPx(path[0].from)];
    for (const s of path) pts.push(toPx(s.to));
    return pts;
  };

  function manyCaption(ms: ManyState, final: boolean) {
    const n = Math.max(1, ms.counted);
    const avg: Vec3 = [ms.sum[0] / n, ms.sum[1] / n, ms.sum[2] / n];
    const pct = Math.round((100 * ms.found) / n);
    let text = `<b>${ms.found}</b> of ${ms.counted} sample paths found the lamp (${pct}%). Their average: ${swatch(toDisplay(avg))}`;
    if (final) {
      const px = opts.readPixel(ms.tapNdc[0], ms.tapNdc[1]);
      if (px) text += ` &nbsp; Pixel in the picture (${opts.samplesSoFar().toLocaleString('en-US')} samples): ${swatch(toDisplay(px))}`;
      opts.toast(`${ms.counted} samples`, text, HOLD_MS);
      opts.highlight('int');
    } else {
      opts.toast(`${ms.counted} samples`, text, 700);
    }
  }

  function frameMany(now: number) {
    const ms = many!;
    const t = now - ms.start;
    const total = REVEAL_MS;
    const count = Math.min(ms.paths.length, Math.floor((t / total) * ms.paths.length) + 1);
    while (ms.counted < count) {
      const j = ms.counted++;
      if (ms.outcomes[j] === 'light') ms.found++;
      ms.sum[0] += ms.colors[j][0];
      ms.sum[1] += ms.colors[j][1];
      ms.sum[2] += ms.colors[j][2];
    }
    if (!ms.done && ms.counted >= ms.paths.length) {
      ms.done = true;
      manyCaption(ms, true);
    } else if (!ms.done && now - ms.lastCaption > 140) {
      ms.lastCaption = now;
      manyCaption(ms, false);
    }
    const fade = t > total + HOLD_MS ? Math.max(0, 1 - (t - total - HOLD_MS) / FADE_MS) : 1;
    if (fade <= 0) {
      stop();
      return;
    }

    ctx.globalAlpha = fade;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    // Every path takes on the color it picks up: it starts as the lamp's hue and is tinted by each
    // surface it bounces off. Dead ends are faint; paths that found the lamp glow.
    const seg = (pts: [number, number][], tint: Vec3[], k: number) => {
      ctx.beginPath();
      ctx.moveTo(pts[k][0], pts[k][1]);
      ctx.lineTo(pts[k + 1][0], pts[k + 1][1]);
      return tint[k];
    };
    ctx.lineWidth = 1.3;
    for (let j = 0; j < ms.counted; j++) {
      if (ms.outcomes[j] === 'light') continue;
      const pts = polyline(ms.paths[j]);
      for (let k = 0; k < pts.length - 1; k++) {
        const c = seg(pts, ms.tints[j], k);
        ctx.strokeStyle = rgba(c, 0.2, 0.3);
        ctx.stroke();
      }
    }
    for (let j = 0; j < ms.counted; j++) {
      if (ms.outcomes[j] !== 'light') continue;
      const pts = polyline(ms.paths[j]);
      for (const [w, a, lift] of [
        [8, 0.2, 0.35],
        [2.6, 0.95, 0.5],
      ] as const) {
        ctx.lineWidth = w;
        for (let k = 0; k < pts.length - 1; k++) {
          const c = seg(pts, ms.tints[j], k);
          ctx.strokeStyle = rgba(c, a, lift);
          ctx.stroke();
        }
      }
      const e = pts[pts.length - 1];
      glow(e[0], e[1], 26, ms.tints[j][ms.tints[j].length - 1], 0.5);
    }
    // the newest few paths flash white so the eye can follow the reveal
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    for (let j = Math.max(0, ms.counted - 3); j < ms.counted; j++) {
      const pts = polyline(ms.paths[j]);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
      ctx.stroke();
    }
    // The selected pixel is the accumulator: its disc fills with the running average color of the
    // paths so far, inside a ring showing the real pixel color it should converge to.
    ctx.globalCompositeOperation = 'source-over';
    const [px, py] = ndcToPx(ms.tapNdc[0], ms.tapNdc[1]);
    const n = Math.max(1, ms.counted);
    const avg = toDisplay([ms.sum[0] / n, ms.sum[1] / n, ms.sum[2] / n]);
    ctx.beginPath();
    ctx.arc(px, py, 17, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${avg[0]},${avg[1]},${avg[2]})`;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = ms.pixelRef ? `rgb(${ms.pixelRef[0]},${ms.pixelRef[1]},${ms.pixelRef[2]})` : '#fff';
    ctx.beginPath();
    ctx.arc(px, py, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(px, py, 24, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ---------- loop ----------

  function frame(now: number) {
    fit();
    ctx.clearRect(0, 0, view.clientWidth, view.clientHeight);
    ctx.save();
    if (!fpFrame.hidden) {
      // keep the photon's-view inset clean: do not draw path glows over it
      const fr = fpFrame.getBoundingClientRect();
      const vr = view.getBoundingClientRect();
      ctx.beginPath();
      ctx.rect(0, 0, view.clientWidth, view.clientHeight);
      ctx.rect(fr.left - vr.left, fr.top - vr.top, fr.width, fr.height);
      ctx.clip('evenodd');
    }
    if (many) frameMany(now);
    else if (segs.length) frameOne(now);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (!raf && !many && !segs.length) return;
    if (many || segs.length) raf = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    segs = [];
    many = null;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  }

  function clear() {
    stop();
    tally.sent = 0;
    tally.found = 0;
  }

  function setEnabled(v: boolean) {
    on = v;
    btn.setAttribute('aria-pressed', String(v));
    btn.classList.toggle('on', v);
    btn.textContent = v ? 'Photon mode: tap the picture' : 'Be a photon';
    stage.classList.toggle('photon-mode', v);
    clear();
    if (v) opts.toast('Photon mode', 'Tap anywhere to send a photon into the scene', 4000);
  }

  btn.addEventListener('click', () => setEnabled(!on));
  manyBtn.addEventListener('click', () => {
    manyMode = !manyMode;
    manyBtn.setAttribute('aria-pressed', String(manyMode));
    manyBtn.classList.toggle('on', manyMode);
    stop();
    opts.toast(
      manyMode ? 'All samples' : 'One photon',
      manyMode ? `Tap a pixel: all ${SAMPLES} of its sample paths get traced and averaged` : 'Tap anywhere to send one photon',
      4000,
    );
  });
  fpBtn.addEventListener('click', () => {
    fpOn = !fpOn;
    fpBtn.setAttribute('aria-pressed', String(fpOn));
    fpBtn.classList.toggle('on', fpOn);
  });

  return {
    get enabled() {
      return on;
    },
    setEnabled,
    clear,
    trace(ndcX, ndcY) {
      stop();
      if (manyMode) {
        const paths = samplePaths(ndcX, ndcY, aspect(), scene, SAMPLES, Math.floor(Math.random() * 2 ** 31));
        if (!paths.length) {
          opts.toast('Tap inside the picture', 'The photon needs to start in the box', 2000);
          return;
        }
        many = {
          paths,
          outcomes: paths.map(classify),
          colors: paths.map((p) => pathColor(p, scene)),
          tints: paths.map(buildTints),
          pixelRef: (() => {
            const px = opts.readPixel(ndcX, ndcY);
            return px ? toDisplay(px) : null;
          })(),
          tapNdc: [ndcX, ndcY],
          start: performance.now(),
          counted: 0,
          found: 0,
          sum: [0, 0, 0],
          lastCaption: 0,
          done: false,
        };
        raf = requestAnimationFrame(frame);
        return;
      }
      const path = recordPath(ndcX, ndcY, aspect(), scene, Math.floor(Math.random() * 2 ** 31));
      if (!path.length) {
        opts.toast('Tap inside the picture', 'The photon needs to start in the box', 2000);
        return;
      }
      segs = path;
      tints = buildTints(path);
      tapNdc = [ndcX, ndcY];
      tally.sent++;
      resultShown = false;
      start = performance.now();
      opts.toast('Photon on its way', '', segs.length * SEG_MS + 400);
      raf = requestAnimationFrame(frame);
    },
    pose(now) {
      let p: { pos: Vec3; fwd: Vec3 } | null = null;
      if (fpOn && !many && segs.length) {
        const t = Math.max(0, now - start);
        const i = Math.min(segs.length - 1, Math.floor(t / SEG_MS));
        const local = t >= segs.length * SEG_MS ? SEG_MS : t - i * SEG_MS;
        const seg = segs[i];
        const d = unit(sub(seg.to, seg.from));
        if (local < TRAVEL_MS) {
          p = { pos: clampInside(lerp3(seg.from, seg.to, ease(local / TRAVEL_MS))), fwd: d };
        } else {
          // arrived: sit just in front of the surface and turn toward the next leg
          const next = segs[i + 1];
          const turn = next ? ease((local - TRAVEL_MS) / DWELL_MS) : 0;
          const fwd = next ? unit(lerp3(d, unit(sub(next.to, next.from)), turn)) : d;
          p = { pos: clampInside(sub(seg.to, mul(d, 0.03))), fwd };
        }
      }
      if (fpFrame.hidden === !!p) fpFrame.hidden = !p;
      return p;
    },
    viewRect() {
      return fpFrame.hidden ? null : fpFrame.getBoundingClientRect();
    },
  };
}
