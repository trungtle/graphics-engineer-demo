import { cameraOf, project, recordPath, type PathSegment, type Vec3 } from '../render/cpu';
import { lightRadiance, type SceneState } from '../scene';

// Timing (ms): each segment is a travel phase then a short dwell where the hit glows.
const TRAVEL_MS = 750;
const DWELL_MS = 300;
const SEG_MS = TRAVEL_MS + DWELL_MS;
const HOLD_MS = 12000;
const FADE_MS = 1000;

export interface Photon {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  /** Send one random photon path from a screen position in [-1,1] (y up). */
  trace(ndcX: number, ndcY: number): void;
  /** Stop and forget everything (scene changed): also resets the tally. */
  clear(): void;
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

const aces = (x: number) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
/** Linear radiance to the 0-255 value the display shader would show. */
export function toDisplay(c: Vec3): [number, number, number] {
  return c.map((v) => Math.round(255 * Math.pow(aces(v), 1 / 2.2))) as [number, number, number];
}

const swatch = (c: [number, number, number]) =>
  `<i class="sw" style="background:rgb(${c[0]},${c[1]},${c[2]})"></i> (${c[0]}, ${c[1]}, ${c[2]})`;

const TITLE: Record<Outcome, string> = { light: 'Hit light', object: 'Hit object', miss: 'Miss' };

export function initPhoton(opts: {
  stage: HTMLElement;
  view: HTMLCanvasElement;
  scene: SceneState;
  toast: (title: string, text: string, ms?: number) => void;
  highlight: (t: 'le' | 'int') => void;
  /** Linear RGB of the accumulated image around a screen position in [-1,1] (null if unavailable). */
  readPixel: (ndcX: number, ndcY: number) => Vec3 | null;
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

  let on = false;
  let segs: PathSegment[] = [];
  let tints: Vec3[] = [];
  let tapNdc: [number, number] = [0, 0];
  let start = 0;
  let resultShown = false;
  let raf = 0;
  const tally = { sent: 0, found: 0 };

  const aspect = () => view.clientWidth / view.clientHeight;

  function toPx(p: Vec3): [number, number] {
    const [nx, ny] = project(p, aspect(), cameraOf(scene));
    return [((nx + 1) / 2) * view.clientWidth, ((1 - ny) / 2) * view.clientHeight];
  }

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

  /** Photon glow color: the lamp's hue, tinted by each surface it bounced off. */
  function buildTints(path: PathSegment[]): Vec3[] {
    const L = lightRadiance(scene.light);
    const m = Math.max(L[0], L[1], L[2]);
    let c: Vec3 = [L[0] / m, L[1] / m, L[2] / m];
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

  const ease = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * p);

  function frame(now: number) {
    fit();
    ctx.clearRect(0, 0, view.clientWidth, view.clientHeight);
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
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    segs = [];
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

  return {
    get enabled() {
      return on;
    },
    setEnabled,
    clear,
    trace(ndcX, ndcY) {
      stop();
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
  };
}
