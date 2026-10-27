// Light Lab: tap a pixel to select the surface under it. A material bar appears in the caption strip under the
// picture (never over it), and while f_r is switched on in the equation the BRDF lobe is drawn at that point.
import { brdfLobes, type LobeKind } from '../lobe';
import { cameraOf, intersect, project, type CpuHit, type Vec3 } from '../render/cpu';
import type { MaterialId, SceneState, WallId } from '../scene';

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
const ARROW_LEN = 0.32;

export interface Pick {
  /** Select whatever a view ray (from `ro` along `rd`) hits; null clears. */
  select(ray: { ro: Vec3; rd: Vec3 } | null): void;
  readonly hit: CpuHit | null;
  lobe: boolean;
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

  function arrow(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], color: string) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const ux = dx / l;
    const uy = dy / l;
    const head = Math.min(12, l * 0.4);
    for (const [style, width] of [
      ['rgba(255,255,255,0.85)', 5],
      [color, 2.5],
    ] as const) {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
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

    if (api.lobe) {
      const set = brdfLobes(hit.p, hit.n, ray!.rd, hit.mat, hit.albedo, hit.emissive);
      for (const lobe of set.lobes) {
        const lines = lobe.lines.map((line) => line.map((q) => toPx(q, r.width, r.height, aspect)));
        for (const [style, width] of [
          ['rgba(255,255,255,0.55)', 3],
          [LOBE_COLORS[lobe.kind], 1.4],
        ] as const) {
          ctx.strokeStyle = style;
          ctx.lineWidth = width;
          ctx.beginPath();
          for (const line of lines) {
            ctx.moveTo(line[0][0], line[0][1]);
            for (let i = 1; i < line.length; i++) ctx.lineTo(line[i][0], line[i][1]);
          }
          ctx.stroke();
        }
      }
      const tipOf = (d: Vec3): Vec3 => [hit!.p[0] + d[0] * ARROW_LEN, hit!.p[1] + d[1] * ARROW_LEN, hit!.p[2] + d[2] * ARROW_LEN];
      arrow(ctx, at, toPx(tipOf(set.normal), r.width, r.height, aspect), NORMAL_COLOR);
      arrow(ctx, at, toPx(tipOf(set.toEye), r.width, r.height, aspect), '#16202e');
    }

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

  const api: Pick = {
    lobe: false,
    get hit() {
      return hit;
    },
    select(next) {
      ray = next;
      refresh();
    },
    refresh,
    draw,
  };
  return api;
}
