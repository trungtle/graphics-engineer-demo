import { project, recordPath, type PathSegment } from '../render/cpu';
import type { SceneState } from '../scene';
import type { Term } from './equation';

const SEG_MS = 600;
const HOLD_MS = 8000;
const FADE_MS = 1000;
const SLANT = 0.45; // below this cos, call the hit "a slant"

export interface Photon {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  /** Send one random photon path from a screen position in [-1,1] (y up). */
  trace(ndcX: number, ndcY: number): void;
  /** Stop and forget everything (scene changed): also resets the tally. */
  clear(): void;
}

const SURFACE_NAME: Record<string, string> = {
  left: 'the red wall',
  right: 'the green wall',
  floor: 'the floor',
  ceiling: 'the ceiling',
  back: 'the back wall',
  light: 'the lamp',
  object: 'the ball',
};

/** What happened at the end of a segment, and which equation term explains it. */
export function describe(
  seg: PathSegment,
  index: number,
  tally: { sent: number; found: number } = { sent: 1, found: 0 },
): { title: string; text: string; term: Term; done: boolean } {
  const where = SURFACE_NAME[seg.surface] ?? 'a surface';
  const tint = seg.surface === 'left' ? ', picking up red' : seg.surface === 'right' ? ', picking up green' : '';
  const n = index + 1;
  const title = `Bounce ${n}`;
  const score = `${tally.found} of ${tally.sent} photons found the lamp so far.`;
  const lost = `Most photons never find the lamp, which is why the picture starts noisy. ${score} Tap again!`;
  switch (seg.event) {
    case 'light':
      return { title: 'Found the lamp!', text: `This path carries light to your eye. ${score} Tap again!`, term: 'le', done: true };
    case 'escaped':
      return { title: 'Lost', text: `It left the box without finding light. ${lost}`, term: 'int', done: true };
    case 'cutoff':
      return { title: 'Out of bounces', text: `This path found no light. ${lost}`, term: 'int', done: true };
    case 'mirror':
      return { title, text: `Hit ${where}: a mirror bounces light perfectly`, term: index === 0 ? 'lo' : 'fr', done: false };
    case 'metal':
      return { title, text: `Hit ${where}: metal gives a slightly blurry bounce`, term: index === 0 ? 'lo' : 'fr', done: false };
    case 'reflect':
      return { title, text: `Hit glass: this time the light reflects`, term: index === 0 ? 'lo' : 'fr', done: false };
    case 'refract':
      return { title, text: `Hit glass: this time the light bends through`, term: index === 0 ? 'lo' : 'fr', done: false };
    default:
      if (seg.cos < SLANT) {
        return { title, text: `Hit ${where} at a slant, so it gets less light`, term: 'cos', done: false };
      }
      return {
        title,
        text: `Hit ${where}: matte scatters light in a random direction${tint}`,
        term: index === 0 ? 'lo' : 'fr',
        done: false,
      };
  }
}

export function initPhoton(opts: {
  stage: HTMLElement;
  view: HTMLCanvasElement;
  scene: SceneState;
  toast: (title: string, text: string, ms?: number) => void;
  highlight: (t: Term, ms?: number) => void;
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
  let start = 0;
  let announced = 0;
  let raf = 0;
  const tally = { sent: 0, found: 0 };

  const aspect = () => view.clientWidth / view.clientHeight;

  function toPx(p: [number, number, number]): [number, number] {
    const [nx, ny] = project(p, aspect());
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

  function frame(now: number) {
    fit();
    ctx.clearRect(0, 0, view.clientWidth, view.clientHeight);
    const t = now - start;
    const total = segs.length * SEG_MS;
    const fade = t > total + HOLD_MS ? Math.max(0, 1 - (t - total - HOLD_MS) / FADE_MS) : 1;
    if (fade <= 0) {
      stop();
      return;
    }

    // announce each segment as the photon arrives at its end
    const arrived = Math.min(segs.length, Math.floor(t / SEG_MS));
    while (announced < arrived) {
      const d = describe(segs[announced], announced, tally);
      opts.toast(d.title, d.text, d.done ? 6000 : SEG_MS + 400);
      opts.highlight(d.term, d.done ? 3000 : SEG_MS + 300);
      announced++;
    }

    ctx.globalAlpha = fade;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let head: [number, number] | null = null;
    segs.forEach((seg, i) => {
      const p = Math.min(1, Math.max(0, (t - i * SEG_MS) / SEG_MS));
      if (p <= 0) return;
      const e = 1 - Math.pow(1 - p, 3);
      const [ax, ay] = toPx(seg.from);
      const [bx, by] = toPx(seg.to);
      const hx = ax + (bx - ax) * e;
      const hy = ay + (by - ay) * e;
      ctx.shadowColor = '#ffb81c';
      ctx.shadowBlur = 16;
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (p >= 1 && seg.surface !== 'none') {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#ffb81c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(bx, by, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#16202e';
        ctx.font = '700 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(seg.event === 'light' ? '★' : String(i + 1), bx, by + 0.5);
      }
      head = [hx, hy];
    });
    if (head && t < total) {
      ctx.shadowColor = '#ffb81c';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(head[0], head[1], 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
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
    if (v) opts.toast('Photon mode', 'Tap anywhere to send a photon into the scene', 3500);
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
      tally.sent++;
      if (path[path.length - 1].event === 'light') tally.found++;
      start = performance.now();
      announced = 0;
      raf = requestAnimationFrame(frame);
    },
  };
}
