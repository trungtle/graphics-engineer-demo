// Light Lab: tap a pixel to select the surface under it. A material bar appears in the caption strip under the
// picture (never over it). While a term of the equation is switched on, a simple picture of that term is drawn at
// the selected point: L_o an arrow to the eye in the pixel's color, L_e the emission, the integral the hemisphere
// of directions, f_r the BRDF lobe, L_i light arriving from many directions, cos theta the angle to the lamp.
import { brdfLobes, type LobeKind } from '../lobe';
import { cameraOf, intersect, project, type CpuHit, type Vec3 } from '../render/cpu';
import type { MaterialId, SceneState, WallId } from '../scene';
import { arc, dirAt, incomingLight, lampAngle } from '../termviz';
import type { Term } from './equation';
import { toDisplay } from './photon';

const MATERIALS: { id: MaterialId; name: string; walls: boolean }[] = [
  { id: 0, name: 'Matte', walls: true },
  { id: 1, name: 'Mirror', walls: true },
  { id: 2, name: 'Glass', walls: false },
  { id: 3, name: 'Metal', walls: true },
  { id: 4, name: 'Glow', walls: true },
];

const LOBE_COLORS: Record<LobeKind, string> = {
  scatter: '#2563eb',
  reflect: '#2563eb',
  refract: '#60a5fa',
  emit: '#e08600',
};
const NORMAL_COLOR = '#0f9d8a';
const COS_COLOR = '#0f9d8a';
const INT_COLOR = '#d6336c';
const LE_COLOR = '#e08600';
const ARROW_LEN = 0.32;
const DOME_R = 0.3;
/** how often (frames) L_o re-reads the pixel's color from the render */
const LO_READ_EVERY = 20;
const css = (c: Vec3) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

export interface Pick {
  /** Select whatever a view ray (from `ro` along `rd`) hits; null clears. */
  select(ray: { ro: Vec3; rd: Vec3 } | null): void;
  readonly hit: CpuHit | null;
  /** the equation term pictured at the selected point (null: just the marker) */
  term: Term | null;
  /** Re-read the surface under the selection (after a material change made elsewhere). */
  refresh(): void;
  /** Redraw the marker and lobe (call every frame: the camera can move). */
  draw(): void;
}

export function initPick(opts: {
  scene: SceneState;
  viewport: HTMLElement;
  /** the material changed: restart the render */
  onMaterial: (mat: MaterialId) => void;
  /** the rendered (linear) color around a screen position, or null */
  readPixel: (nx: number, ny: number) => Vec3 | null;
}): Pick {
  const { scene, viewport } = opts;
  const overlay = document.createElement('canvas');
  overlay.id = 'pick-overlay';
  viewport.appendChild(overlay);

  const bar = document.createElement('div');
  bar.id = 'pick-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'radiogroup');
  bar.setAttribute('aria-label', 'Material');
  bar.innerHTML = `<div class="seg pick-seg">${MATERIALS.map((m) => `<button class="seg-btn" type="button" role="radio" data-mat="${m.id}">${m.name}</button>`).join('')}</div>
    <button class="pick-close" type="button" aria-label="Close">&times;</button>`;
  const explain = document.getElementById('explain')!;
  explain.insertAdjacentElement('afterend', bar);
  const matBtns = Array.from(bar.querySelectorAll<HTMLButtonElement>('.seg-btn'));

  let ray: { ro: Vec3; rd: Vec3 } | null = null;
  let hit: CpuHit | null = null;

  const isWall = (h: CpuHit) => h.surface !== 'object' && h.surface !== 'light';

  function syncBar() {
    // the lamp's material is not up for change; neither is anything while photon mode is on
    const show = !!hit && hit.surface !== 'light' && !viewport.classList.contains('photon-mode');
    bar.hidden = !show;
    explain.classList.toggle('covered', show);
    if (!show || !hit) return;
    const wall = isWall(hit);
    matBtns.forEach((b) => {
      const m = Number(b.dataset.mat);
      b.hidden = wall && !MATERIALS[m].walls;
      const on = m === hit!.mat;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }

  function refresh() {
    hit = ray ? intersect(ray.ro, ray.rd, scene) : null;
    syncBar();
  }

  matBtns.forEach((b) =>
    b.addEventListener('click', () => {
      if (!hit) return;
      const m = Number(b.dataset.mat) as MaterialId;
      if (hit.surface === 'object') scene.objects[hit.objectIndex].mat = m;
      else if (isWall(hit)) scene.walls[hit.surface as WallId] = m;
      refresh();
      opts.onMaterial(m);
    }),
  );
  bar.querySelector('.pick-close')!.addEventListener('click', () => api.select(null));

  // ---- drawing ----
  const toPx = (p: Vec3, w: number, h: number, aspect: number): [number, number] => {
    const [x, y] = project(p, aspect, cameraOf(scene));
    return [((x + 1) / 2) * w, ((1 - y) / 2) * h];
  };

  type Px = [number, number];
  function polyline(ctx: CanvasRenderingContext2D, lines: Px[][], color: string, width = 1.4, dash: number[] = []) {
    ctx.setLineDash(dash);
    for (const [style, w] of [
      ['rgba(255,255,255,0.55)', width + 1.6],
      [color, width],
    ] as const) {
      ctx.strokeStyle = style;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (const line of lines) {
        ctx.moveTo(line[0][0], line[0][1]);
        for (let i = 1; i < line.length; i++) ctx.lineTo(line[i][0], line[i][1]);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function arrow(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], color: string, width = 2.5) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const ux = dx / l;
    const uy = dy / l;
    const head = Math.min(12, l * 0.4);
    for (const [style, w] of [
      ['rgba(255,255,255,0.85)', width + 2.5],
      [color, width],
    ] as const) {
      ctx.strokeStyle = style;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.moveTo(b[0] - ux * head - uy * head * 0.55, b[1] - uy * head + ux * head * 0.55);
      ctx.lineTo(b[0], b[1]);
      ctx.lineTo(b[0] - ux * head + uy * head * 0.55, b[1] - uy * head - ux * head * 0.55);
      ctx.stroke();
    }
  }

  function draw() {
    const r = overlay.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(r.width * dpr);
    const H = Math.round(r.height * dpr);
    if (overlay.width !== W || overlay.height !== H) {
      overlay.width = W;
      overlay.height = H;
    }
    const ctx = overlay.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    syncBar();
    if (!hit || r.width === 0 || viewport.classList.contains('photon-mode')) return;
    const aspect = r.width / r.height;
    const at = toPx(hit.p, r.width, r.height, aspect);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (api.term) drawTerm(ctx, api.term, at, (q) => toPx(q, r.width, r.height, aspect), aspect);

    // the selected pixel
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(22,32,46,0.9)';
    ctx.beginPath();
    ctx.arc(at[0], at[1], 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(at[0], at[1], 9, 0, Math.PI * 2);
    ctx.stroke();
  }

  let loColor: Vec3 | null = null;
  let loFrame = 0;

  function drawTerm(ctx: CanvasRenderingContext2D, term: Term, at: Px, px: (q: Vec3) => Px, aspect: number) {
    const h = hit!;
    const rd = ray!.rd;
    const set = brdfLobes(h.p, h.n, rd, h.mat, h.albedo, h.emissive);
    const nf = set.normal;
    const along = (d: Vec3, len: number): Vec3 => [h.p[0] + d[0] * len, h.p[1] + d[1] * len, h.p[2] + d[2] * len];
    const ring = (theta: number, radius: number): Px[] =>
      Array.from({ length: 33 }, (_, i) => px(along(dirAt(nf, theta, (i / 32) * 2 * Math.PI), radius)));

    if (term === 'fr' || term === 'le') {
      // f_r: how the surface scatters light; L_e: what it gives off by itself (a dashed empty dome when nothing)
      const lobes = set.lobes.filter((l) => (term === 'le') === (l.kind === 'emit'));
      for (const lobe of lobes) polyline(ctx, lobe.lines.map((line) => line.map(px)), LOBE_COLORS[lobe.kind]);
      if (term === 'le' && !lobes.length) polyline(ctx, [0.5, 1.0, 1.45].map((th) => ring(th, DOME_R * 0.6)), LE_COLOR, 1.2, [3, 4]);
      if (term === 'fr') {
        arrow(ctx, at, px(along(set.normal, ARROW_LEN)), NORMAL_COLOR);
        arrow(ctx, at, px(along(set.toEye, ARROW_LEN)), '#16202e');
      }
      return;
    }

    if (term === 'lo') {
      // the light leaving toward the eye: an arrow in the pixel's own color
      if (!loColor || ++loFrame % LO_READ_EVERY === 0) {
        const [nx, ny] = project(h.p, aspect, cameraOf(scene));
        const c = opts.readPixel(nx, ny);
        if (c) loColor = toDisplay(c).map((v) => v / 255) as Vec3;
      }
      arrow(ctx, at, px(along(set.toEye, ARROW_LEN * 1.6)), loColor ? css(loColor) : '#16202e', 6);
      return;
    }

    if (term === 'li') {
      // light arriving from all over the hemisphere: each arrow colored by what that direction sees
      for (const inc of incomingLight(h.p, nf, scene)) {
        const from = px(along(inc.dir, inc.bright ? ARROW_LEN * 1.5 : ARROW_LEN));
        arrow(ctx, from, at, css(inc.color), inc.bright ? 3 : 1.6);
      }
      return;
    }

    if (term === 'cos') {
      // the angle between the normal and the light's direction: light from straight above counts fully, grazing light hardly
      const { toLamp } = lampAngle(h.p, nf, scene);
      arrow(ctx, at, px(along(nf, ARROW_LEN)), NORMAL_COLOR);
      arrow(ctx, px(along(toLamp, ARROW_LEN * 1.4)), at, LE_COLOR, 3);
      polyline(ctx, [arc(h.p, nf, toLamp, ARROW_LEN * 0.55).map(px)], COS_COLOR, 2);
      const m = px(arc(h.p, nf, toLamp, ARROW_LEN * 0.75, 2)[1]);
      ctx.font = 'italic 600 18px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText('\u03b8', m[0], m[1]);
      ctx.fillStyle = COS_COLOR;
      ctx.fillText('\u03b8', m[0], m[1]);
      return;
    }

    // the integral and d-omega: every direction over the surface (the dome), and one small patch of directions
    const lines: Px[][] = [1, 2, 3, 4].map((k) => ring((k / 4) * (Math.PI / 2), DOME_R));
    for (let m = 0; m < 12; m++) {
      const ph = (m / 12) * 2 * Math.PI;
      lines.push(Array.from({ length: 9 }, (_, i) => px(along(dirAt(nf, (i / 8) * (Math.PI / 2), ph), DOME_R))));
    }
    polyline(ctx, lines, INT_COLOR, 1.2);
    const th0 = 0.55;
    const ph0 = 0.9;
    const patch: Px[] = [];
    for (let i = 0; i <= 6; i++) patch.push(px(along(dirAt(nf, th0, ph0 + (i / 6) * 0.45), DOME_R)));
    for (let i = 0; i <= 6; i++) patch.push(px(along(dirAt(nf, th0 + 0.3, ph0 + 0.45 - (i / 6) * 0.45), DOME_R)));
    ctx.fillStyle = 'rgba(214, 51, 108, 0.55)';
    ctx.beginPath();
    ctx.moveTo(patch[0][0], patch[0][1]);
    for (const q of patch) ctx.lineTo(q[0], q[1]);
    ctx.closePath();
    ctx.fill();
    arrow(ctx, at, px(along(dirAt(nf, th0 + 0.15, ph0 + 0.22), DOME_R)), INT_COLOR, 2);
  }

  const api: Pick = {
    term: null,
    get hit() {
      return hit;
    },
    select(next) {
      ray = next;
      loColor = null;
      refresh();
    },
    refresh,
    draw,
  };
  return api;
}
