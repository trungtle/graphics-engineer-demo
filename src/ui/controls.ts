import { clampLight, LIGHT_COLORS, LIGHT_MAX_HALF, LIGHT_MIN_HALF, type MaterialId, type SceneState } from '../scene';
import type { Term } from './equation';

export const MATERIAL_BLURB: Record<MaterialId, { name: string; text: string }> = {
  0: { name: 'Matte', text: 'light scatters every which way' },
  1: { name: 'Mirror', text: 'light bounces off perfectly' },
  2: { name: 'Glass', text: 'light bends as it passes through' },
  3: { name: 'Metal', text: 'a blurry, shiny reflection' },
  4: { name: 'Glowing', text: 'this one makes its own light' },
};

const BOUNCE_CAPTION = (n: number): string =>
  n === 0 ? 'Only the lamp: no bounces yet' : n === 1 ? 'Direct light only' : 'Light bounces: walls tint each other';

const HINT = {
  title: 'Try it',
  text: 'Tap a ball to change what it is made of, drag the slider to change bounces, or press Be a photon.',
};

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
  /** Re-read the lamp size/color into the controls. */
  syncLamp(): void;
  /** Big attract-mode caption in the caption bar (null restores the normal hint). Normal captions are ignored while idle. */
  idleCaption(text: string | null): void;
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
      <p class="cap" id="bcap"></p>
    </div>
    <div class="ctl-block lamp">
      <div class="ctl-head"><span class="ctl-title t-le">Lamp</span><span class="ctl-hint" id="lcap"></span></div>
      <div class="lamp-row">
        <div class="swatches" role="radiogroup" aria-label="Lamp color">
          ${LIGHT_COLORS.map((c, i) => `<button class="swatch" type="button" role="radio" data-i="${i}" aria-label="${c.name}" style="--sw:${c.swatch}"></button>`).join('')}
        </div>
        <input id="lampsize" class="slider le" type="range" min="${Math.round(LIGHT_MIN_HALF * 100)}" max="${Math.round(LIGHT_MAX_HALF * 100)}" step="1" aria-label="Lamp size" />
      </div>
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

  const lsize = root.querySelector<HTMLInputElement>('#lampsize')!;
  const lcap = root.querySelector<HTMLElement>('#lcap')!;
  const swatches = Array.from(root.querySelectorAll<HTMLButtonElement>('.swatch'));
  const syncLamp = () => {
    const l = opts.scene.light;
    lsize.value = String(Math.round(l.half * 100));
    const frac = (l.half - LIGHT_MIN_HALF) / (LIGHT_MAX_HALF - LIGHT_MIN_HALF);
    lsize.style.setProperty('--fill', `${frac * 100}%`);
    lcap.textContent = frac < 0.25 ? 'Small: sharp shadows' : frac > 0.7 ? 'Big: soft shadows' : 'Drag it in the picture';
    swatches.forEach((b, i) => {
      const c = LIGHT_COLORS[i].rgb;
      const on = c[0] === l.color[0] && c[1] === l.color[1] && c[2] === l.color[2];
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
    });
  };
  lsize.addEventListener('input', () => {
    opts.scene.light.half = Number(lsize.value) / 100;
    clampLight(opts.scene.light);
    syncLamp();
    opts.reset();
    opts.onTerm?.('le');
  });
  swatches.forEach((b, i) =>
    b.addEventListener('click', () => {
      opts.scene.light.color = [...LIGHT_COLORS[i].rgb];
      syncLamp();
      opts.reset();
      opts.onTerm?.('le');
    }),
  );
  syncLamp();

  // Explanations live in a caption bar under the picture (never over the render).
  const explainEl = document.getElementById('explain')!;
  const isIdle = () => document.body.classList.contains('idle');
  const setHint = () => {
    if (isIdle()) return;
    explainEl.classList.remove('show');
    explainEl.innerHTML = `<strong>${HINT.title}</strong> <span>${HINT.text}</span>`;
  };
  setHint();
  let toastTimer = 0;

  return {
    syncBounces,
    syncLamp,
    idleCaption(text) {
      if (text === null) {
        setHint();
        return;
      }
      explainEl.classList.add('show');
      explainEl.innerHTML = `<strong>${text}</strong><small class="idle-tag">Touch to play</small>`;
    },
    setStats(spp, rays) {
      sppEl.textContent = spp.toLocaleString('en-US');
      raysEl.textContent = formatCount(rays);
    },
    toast(title, text, ms = 2600) {
      if (isIdle()) return;
      explainEl.innerHTML = `<strong>${title}:</strong> <span>${text}</span>`;
      explainEl.classList.add('show');
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(setHint, ms);
    },
  };
}
