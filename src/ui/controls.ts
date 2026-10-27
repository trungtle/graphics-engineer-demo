import {
  APERTURE_RANGE,
  clampLight,
  FOCUS_RANGE,
  FOV_RANGE,
  LIGHT_COLORS,
  LIGHT_MAX_HALF,
  LIGHT_MIN_HALF,
  setLights,
  type LightSetup,
  type SceneState,
} from '../scene';
import type { Term } from './equation';
import type { ModelId } from '../mesh';

const MODELS: { id: ModelId; name: string }[] = [
  { id: 'balls', name: 'Balls' },
  { id: 'bunny', name: 'Bunny' },
  { id: 'dragon', name: 'Dragon' },
  { id: 'spot', name: 'Spot' },
  { id: 'bob', name: 'Bob' },
  { id: 'blub', name: 'Blub' },
];

export function formatCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} billion`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} million`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} thousand`;
  return String(Math.round(n));
}

export interface Controls {
  toast(title: string, text: string, ms?: number): void;
  /** Re-read scene.bounces into the slider (after a change made elsewhere, e.g. the keyboard). */
  syncBounces(): void;
  /** Re-read the lamp size/color into the controls. */
  syncLamp(): void;
  /** Re-read which model is shown into the picker. */
  syncModel(): void;
  /** Show whether light sampling and the denoiser are on (after a change made elsewhere, e.g. the keyboard). */
  syncRender(nee: boolean, denoise: boolean): void;
  /** Re-read the camera's field of view, aperture and focus into the sliders. */
  syncCamera(): void;
  /** Big attract-mode caption in the caption bar (null restores the normal hint). Normal captions are ignored while idle. */
  idleCaption(text: string | null): void;
}

export function initControls(opts: {
  scene: SceneState;
  reset: () => void;
  onTerm?: (t: Term) => void;
  onModel?: (id: ModelId) => void;
  /** the two speed-ups: their switches and starting states */
  render?: { nee: boolean; denoise: boolean; onNee: (on: boolean) => void; onDenoise: (on: boolean) => void };
}): Controls {
  const root = document.getElementById('controls')!;
  const stats = document.getElementById('stage-stats')!;
  root.innerHTML = `
    <div class="ctl-row">
      <div class="render-toggles">
        <button class="toggle" id="t-nee" type="button" aria-pressed="false"><i></i>Light sampling</button>
        <button class="toggle" id="t-denoise" type="button" aria-pressed="false"><i></i>Denoiser</button>
      </div>
      <button id="restart" class="btn" type="button">Restart</button>
    </div>
    <div class="seg" role="radiogroup" aria-label="Model">
      ${MODELS.map((m) => `<button class="seg-btn" type="button" role="radio" data-model="${m.id}">${m.name}</button>`).join('')}
    </div>
    <div class="ctl-block">
      <div class="ctl-head"><span class="ctl-title t-li">Light bounces</span><span class="ctl-val t-li" id="bval"></span></div>
      <input id="bounces" class="slider" type="range" min="0" max="8" step="1" aria-label="Light bounces" />
    </div>
    <div class="ctl-block lamp">
      <div class="ctl-head"><span class="ctl-title t-le">Lamp</span>
        <div class="seg seg-mini" role="radiogroup" aria-label="Number of lamps">
          ${[1, 2, 3].map((n) => `<button class="seg-btn lamps-btn" type="button" role="radio" data-n="${n}" aria-label="${n} lamp${n > 1 ? 's' : ''}">${'<i></i>'.repeat(n)}</button>`).join('')}
        </div>
      </div>
      <div class="lamp-row">
        <div class="swatches" role="radiogroup" aria-label="Lamp color">
          ${LIGHT_COLORS.map((c, i) => `<button class="swatch" type="button" role="radio" data-i="${i}" aria-label="${c.name}" style="--sw:${c.swatch}"></button>`).join('')}
        </div>
        <input id="lampsize" class="slider le" type="range" min="${Math.round(LIGHT_MIN_HALF * 100)}" max="${Math.round(LIGHT_MAX_HALF * 100)}" step="1" aria-label="Lamp size" />
      </div>
    </div>
    <div class="ctl-block cam-ctl">
      <span class="ctl-title">Camera</span>
      <div class="cam-row"><span>Field of view</span><input id="cam-fov" class="slider" type="range" min="${FOV_RANGE[0]}" max="${FOV_RANGE[1]}" step="1" aria-label="Field of view" /><b id="fov-val"></b></div>
      <div class="cam-row"><span>Aperture</span><input id="cam-ap" class="slider" type="range" min="${APERTURE_RANGE[0] * 100}" max="${APERTURE_RANGE[1] * 100}" step="1" aria-label="Aperture" /><b id="ap-val"></b></div>
      <div class="cam-row"><span>Focus</span><input id="cam-focus" class="slider" type="range" min="${FOCUS_RANGE[0] * 10}" max="${FOCUS_RANGE[1] * 10}" step="1" aria-label="Focus distance" /><b id="focus-val"></b></div>
    </div>`;

  // samples, rays and the convergence graph sit at the top of the panel, just under the rendering equation
  root.prepend(stats);

  const slider = root.querySelector<HTMLInputElement>('#bounces')!;
  const bval = root.querySelector<HTMLElement>('#bval')!;

  const syncBounces = () => {
    slider.value = String(opts.scene.bounces);
    bval.textContent = String(opts.scene.bounces);
    slider.style.setProperty('--fill', `${(opts.scene.bounces / 8) * 100}%`);
  };
  slider.addEventListener('input', () => {
    opts.scene.bounces = Number(slider.value);
    syncBounces();
    opts.reset();
    opts.onTerm?.('li');
  });
  // the two speed-ups, so the booth can show the difference without a keyboard
  const neeBtn = root.querySelector<HTMLButtonElement>('#t-nee')!;
  const denBtn = root.querySelector<HTMLButtonElement>('#t-denoise')!;
  const syncRender = (nee: boolean, denoise: boolean) => {
    neeBtn.setAttribute('aria-pressed', String(nee));
    denBtn.setAttribute('aria-pressed', String(denoise));
  };
  if (opts.render) {
    const r = opts.render;
    syncRender(r.nee, r.denoise);
    neeBtn.addEventListener('click', () => {
      const on = neeBtn.getAttribute('aria-pressed') !== 'true';
      neeBtn.setAttribute('aria-pressed', String(on));
      r.onNee(on);
      opts.onTerm?.('int');
    });
    denBtn.addEventListener('click', () => {
      const on = denBtn.getAttribute('aria-pressed') !== 'true';
      denBtn.setAttribute('aria-pressed', String(on));
      r.onDenoise(on);
    });
  } else {
    neeBtn.hidden = true;
    denBtn.hidden = true;
  }
  // auto-scale: shrink the whole panel (down to ZOOM_MIN) until the controls fit and the ray sketch has a readable
  // height; with no such size the sketch steps aside. Runs on window resize and orientation change.
  const rayPanel = document.getElementById('ray-panel')!;
  const panelEl = document.getElementById('panel')!;
  const ZOOM_MIN = 0.75;
  const SKETCH_MIN = 110; // screen px
  const fitPanel = () => {
    const parts = Array.from(panelEl.children) as HTMLElement[];
    const setZoom = (z: number) => parts.forEach((el) => (el.style.zoom = z === 1 ? '' : String(z)));
    const fits = (needSketch: boolean) =>
      panelEl.scrollHeight <= panelEl.clientHeight + 1 && (!needSketch || rayPanel.getBoundingClientRect().height >= SKETCH_MIN);
    if (panelEl.clientHeight === 0) return;
    rayPanel.hidden = false;
    for (let z = 1; z >= ZOOM_MIN - 1e-6; z -= 0.025) {
      setZoom(z);
      if (fits(true)) return;
    }
    // no scale shows the sketch: hide it and scale only as far as the controls need
    rayPanel.hidden = true;
    for (let z = 1; z >= ZOOM_MIN - 1e-6; z -= 0.025) {
      setZoom(z);
      if (fits(false)) return;
    }
  };
  window.addEventListener('resize', fitPanel);
  requestAnimationFrame(fitPanel);

  // camera: field of view, aperture (depth of field) and focus
  const fovEl = root.querySelector<HTMLInputElement>('#cam-fov')!;
  const apEl = root.querySelector<HTMLInputElement>('#cam-ap')!;
  const focusEl = root.querySelector<HTMLInputElement>('#cam-focus')!;
  const fill = (el: HTMLInputElement) =>
    el.style.setProperty('--fill', `${((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100}%`);
  const syncCamera = () => {
    const cam = opts.scene.camera;
    const fov = Math.round((2 * Math.atan(cam.th) * 180) / Math.PI);
    fovEl.value = String(fov);
    apEl.value = String(Math.round(cam.aperture * 2 * 100));
    focusEl.value = String(Math.round(cam.focus * 10));
    root.querySelector('#fov-val')!.textContent = `${fov}\u00b0`;
    root.querySelector('#ap-val')!.textContent = `${Math.round(cam.aperture * 2 * 100)} cm`;
    root.querySelector('#focus-val')!.textContent = `${cam.focus.toFixed(1)} m`;
    [fovEl, apEl, focusEl].forEach(fill);
  };
  fovEl.addEventListener('input', () => {
    opts.scene.camera.th = Math.tan(((Number(fovEl.value) / 2) * Math.PI) / 180);
    syncCamera();
    opts.reset();
  });
  apEl.addEventListener('input', () => {
    opts.scene.camera.aperture = Number(apEl.value) / 100 / 2;
    syncCamera();
    opts.reset();
  });
  focusEl.addEventListener('input', () => {
    opts.scene.camera.focus = Number(focusEl.value) / 10;
    syncCamera();
    opts.reset();
  });
  syncCamera();

  root.querySelector('#restart')!.addEventListener('click', () => {
    opts.reset();
    opts.onTerm?.('int');
  });
  syncBounces();

  const lsize = root.querySelector<HTMLInputElement>('#lampsize')!;
  const swatches = Array.from(root.querySelectorAll<HTMLButtonElement>('.swatch'));
  const lampBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('.lamps-btn'));
  const syncLamp = () => {
    lampBtns.forEach((b) => {
      const on = Number(b.dataset.n) === opts.scene.lights.length;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
    });
    const l = opts.scene.light;
    lsize.value = String(Math.round(l.half * 100));
    const frac = (l.half - LIGHT_MIN_HALF) / (LIGHT_MAX_HALF - LIGHT_MIN_HALF);
    lsize.style.setProperty('--fill', `${frac * 100}%`);
    swatches.forEach((b, i) => {
      const c = LIGHT_COLORS[i].rgb;
      const on = c[0] === l.color[0] && c[1] === l.color[1] && c[2] === l.color[2];
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
    });
  };
  lampBtns.forEach((b) =>
    b.addEventListener('click', () => {
      setLights(opts.scene, Number(b.dataset.n) as LightSetup);
      syncLamp();
      opts.reset();
      opts.onTerm?.('le');
    }),
  );
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

  const modelBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('.seg-btn[data-model]'));
  const paintModel = (id: ModelId) =>
    modelBtns.forEach((b) => {
      const on = b.dataset.model === id;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
    });
  const syncModel = () => paintModel(opts.scene.mesh?.id ?? 'balls');
  modelBtns.forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.model as ModelId;
      paintModel(id); // right away, even while the model is still loading
      opts.onModel?.(id);
      opts.onTerm?.('fr');
    }),
  );
  syncModel();

  // Explanations live in a caption bar under the picture (never over the render).
  const explainEl = document.getElementById('explain')!;
  const isIdle = () => document.body.classList.contains('idle');
  const setHint = () => {
    if (isIdle()) return;
    explainEl.classList.remove('show');
    explainEl.innerHTML = '';
  };
  setHint();
  let toastTimer = 0;

  return {
    syncBounces,
    syncLamp,
    syncModel,
    syncRender,
    syncCamera,
    idleCaption(text) {
      if (text === null) {
        setHint();
        return;
      }
      explainEl.classList.add('show');
      explainEl.innerHTML = `<strong>${text}</strong><small class="idle-tag">Touch to play</small>`;
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
