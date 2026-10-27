// The MIS station: Veach's plates and lamps, rendered with one sampling strategy or all three side by side.
import type { MisMode } from '../veach';

const MODES: { id: MisMode; name: string }[] = [
  { id: 3, name: 'Compare' },
  { id: 0, name: 'BSDF' },
  { id: 1, name: 'Light' },
  { id: 2, name: 'MIS' },
];

export function initMis(opts: {
  /** null: the station is not showing */
  setMode: (m: MisMode | null) => void;
  restart: () => void;
  samples: () => number;
}): { onEnter(): void; onLeave(): void; reset(): void } {
  const root = document.getElementById('mis-controls')!;
  const labels = document.getElementById('mis-labels')!;
  root.innerHTML = `
    <div class="ctl-row">
      <div class="stat t-int"><span class="stat-num" id="mis-spp">0</span><span class="stat-lab">samples per pixel</span></div>
      <button id="mis-restart" class="btn" type="button">Restart</button>
    </div>
    <div class="seg mis-seg" role="radiogroup" aria-label="Sampling">
      ${MODES.map((m) => `<button class="seg-btn" type="button" role="radio" data-mode="${m.id}">${m.name}</button>`).join('')}
    </div>`;
  const sppEl = root.querySelector<HTMLElement>('#mis-spp')!;
  const btns = Array.from(root.querySelectorAll<HTMLButtonElement>('.seg-btn'));
  let mode: MisMode = 3;
  let active = false;
  let raf = 0;

  const paint = () => {
    btns.forEach((b) => {
      const on = Number(b.dataset.mode) === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    labels.hidden = mode !== 3;
  };
  btns.forEach((b) =>
    b.addEventListener('click', () => {
      mode = Number(b.dataset.mode) as MisMode;
      paint();
      if (active) opts.setMode(mode);
    }),
  );
  root.querySelector('#mis-restart')!.addEventListener('click', () => opts.restart());
  paint();

  const tick = () => {
    if (!active) return;
    sppEl.textContent = opts.samples().toLocaleString('en-US');
    raf = requestAnimationFrame(tick);
  };

  return {
    onEnter() {
      active = true;
      opts.setMode(mode);
      raf = requestAnimationFrame(tick);
    },
    onLeave() {
      active = false;
      cancelAnimationFrame(raf);
      opts.setMode(null);
    },
    reset() {
      mode = 3;
      paint();
    },
  };
}
