import type { MaterialId, SceneState } from '../scene';
import type { Term } from './equation';

export const MATERIAL_BLURB: Record<MaterialId, { name: string; text: string }> = {
  0: { name: 'Matte', text: 'light scatters every which way' },
  1: { name: 'Mirror', text: 'light bounces off perfectly' },
  2: { name: 'Glass', text: 'light bends as it passes through' },
  3: { name: 'Metal', text: 'a blurry, shiny reflection' },
  4: { name: 'Glowing', text: 'this one makes its own light' },
};

const BOUNCE_CAPTION = (n: number): string =>
  n === 0
    ? 'Only the lamp: no light has bounced yet'
    : n === 1
      ? 'Direct light: straight from the lamp to the surface'
      : 'Light bounces around: the walls tint each other';

export function formatCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} billion`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} million`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} thousand`;
  return String(Math.round(n));
}

export interface Controls {
  setStats(samplesPerPixel: number, raysTraced: number): void;
  toast(title: string, text: string, ms?: number): void;
  /** Re-read scene.bounces into the slider (after a change made elsewhere, e.g. the keyboard). */
  syncBounces(): void;
}

export function initControls(opts: {
  scene: SceneState;
  reset: () => void;
  onTerm?: (t: Term) => void;
}): Controls {
  const root = document.getElementById('controls')!;
  root.innerHTML = `
    <div class="ctl-row">
      <div class="stat t-int"><span class="stat-num" id="spp">0</span><span class="stat-lab">samples per pixel</span></div>
      <div class="stat t-int"><span class="stat-num" id="rays">0</span><span class="stat-lab">rays traced</span></div>
      <button id="restart" class="btn" type="button">Restart</button>
    </div>
    <div class="ctl-block">
      <div class="ctl-head"><span class="ctl-title t-li">Light bounces</span><span class="ctl-val t-li" id="bval"></span></div>
      <input id="bounces" class="slider" type="range" min="0" max="8" step="1" aria-label="Light bounces" />
      <div class="ticks" aria-hidden="true">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<span>${n}</span>`).join('')}</div>
      <p class="cap" id="bcap"></p>
    </div>`;

  const slider = root.querySelector<HTMLInputElement>('#bounces')!;
  const bval = root.querySelector<HTMLElement>('#bval')!;
  const bcap = root.querySelector<HTMLElement>('#bcap')!;
  const sppEl = root.querySelector<HTMLElement>('#spp')!;
  const raysEl = root.querySelector<HTMLElement>('#rays')!;

  const syncBounces = () => {
    slider.value = String(opts.scene.bounces);
    bval.textContent = String(opts.scene.bounces);
    bcap.textContent = BOUNCE_CAPTION(opts.scene.bounces);
    slider.style.setProperty('--fill', `${(opts.scene.bounces / 8) * 100}%`);
  };
  slider.addEventListener('input', () => {
    opts.scene.bounces = Number(slider.value);
    syncBounces();
    opts.reset();
    opts.onTerm?.('li');
  });
  root.querySelector('#restart')!.addEventListener('click', () => {
    opts.reset();
    opts.onTerm?.('int');
  });
  syncBounces();

  const toastEl = document.createElement('div');
  toastEl.id = 'toast';
  toastEl.setAttribute('role', 'status');
  document.getElementById('stage')!.appendChild(toastEl);
  let toastTimer = 0;

  return {
    syncBounces,
    setStats(spp, rays) {
      sppEl.textContent = spp.toLocaleString('en-US');
      raysEl.textContent = formatCount(rays);
    },
    toast(title, text, ms = 2600) {
      toastEl.innerHTML = `<strong>${title}:</strong> <span>${text}</span>`;
      toastEl.classList.add('show');
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
    },
  };
}
