import { resetScene, type SceneState } from '../scene';
import { ERAS, type Shading } from '../shading';

/** "Through the decades": one slider that walks the same scene from flat 1993 colors to path-traced global illumination. */
export function initDecades(opts: {
  scene: SceneState;
  reset: () => void;
  setShading: (s: Shading) => void;
}): { onEnter: () => void } {
  const root = document.getElementById('decades-controls')!;
  const last = ERAS.length - 1;
  root.innerHTML = `
    <div class="era-head"><span class="era-year" id="era-year"></span><span class="era-name" id="era-name"></span></div>
    <input id="era-slider" class="slider" type="range" min="0" max="${last}" step="1" aria-label="Year" />
    <div class="era-ticks" aria-hidden="true">${ERAS.map((e) => `<span>${e.year}</span>`).join('')}</div>`;
  const slider = root.querySelector<HTMLInputElement>('#era-slider')!;
  const year = root.querySelector<HTMLElement>('#era-year')!;
  const name = root.querySelector<HTMLElement>('#era-name')!;

  const apply = (i: number) => {
    const era = ERAS[i];
    slider.value = String(i);
    slider.style.setProperty('--fill', `${(i / last) * 100}%`);
    year.textContent = era.year;
    name.textContent = era.name;
    opts.setShading(era.shading);
  };
  slider.addEventListener('input', () => apply(Number(slider.value)));

  return {
    onEnter() {
      resetScene(opts.scene);
      apply(0);
      opts.reset();
    },
  };
}
