import { BUDGET_MS, FEATURES, TIERS, best, effectiveFps, frameMs, normalize, prettiness, toShading, type Feature } from '../budget';
import { resetScene, type SceneState } from '../scene';
import type { Shading } from '../shading';

const BAR_MAX_MS = 36; // the budget bar runs from 0 to this

/** The 16 ms challenge: switch effects on, stay inside one 60 fps frame, make the prettiest picture you can. */
export function initBudget(opts: {
  scene: SceneState;
  reset: () => void;
  setShading: (s: Shading) => void;
}): { onEnter: () => void; onLeave: () => void } {
  const root = document.getElementById('budget-controls')!;
  root.innerHTML = `
    <div class="bud-top">
      <div class="bud-ms"><span id="bud-ms">0</span><small>ms</small></div>
      <div class="bud-fps" id="bud-fps">60 fps</div>
    </div>
    <div class="bud-bar" aria-hidden="true"><div class="bud-fill" id="bud-fill"></div><div class="bud-mark" style="left:${(BUDGET_MS / BAR_MAX_MS) * 100}%"></div></div>
    <div class="feat-grid">
      ${FEATURES.map((f) => `<button class="feat" type="button" data-f="${f.id}" aria-pressed="false"><span class="feat-name">${f.label}</span><span class="feat-ms"></span></button>`).join('')}
    </div>
    <div class="tier-row" role="radiogroup" aria-label="Console">
      ${TIERS.map((t) => `<button class="tier" type="button" role="radio" data-t="${t.id}" aria-checked="false">${t.label}</button>`).join('')}
    </div>
    <div class="bud-score"><span>Prettiness <b id="bud-score">0</b></span><span>Best <b id="bud-best">0</b><i id="bud-star" hidden> ★</i></span></div>
    <canvas class="bud-motion" id="bud-motion" aria-hidden="true"></canvas>`;

  const msEl = root.querySelector<HTMLElement>('#bud-ms')!;
  const fpsEl = root.querySelector<HTMLElement>('#bud-fps')!;
  const fillEl = root.querySelector<HTMLElement>('#bud-fill')!;
  const scoreEl = root.querySelector<HTMLElement>('#bud-score')!;
  const bestEl = root.querySelector<HTMLElement>('#bud-best')!;
  const starEl = root.querySelector<HTMLElement>('#bud-star')!;
  const feats = Array.from(root.querySelectorAll<HTMLButtonElement>('.feat'));
  const tiers = Array.from(root.querySelectorAll<HTMLButtonElement>('.tier'));
  const motion = root.querySelector<HTMLCanvasElement>('#bud-motion')!;

  let selected = new Set<Feature>();
  let tierIdx = 1; // Today
  let fps = 60;
  let raf = 0;

  const mult = () => TIERS[tierIdx].mult;

  function render() {
    const shown = normalize(selected);
    const ms = frameMs(shown, mult());
    fps = effectiveFps(ms);
    const over = ms > BUDGET_MS + 1e-9;
    msEl.textContent = ms.toFixed(1);
    fpsEl.textContent = `${fps} fps`;
    fpsEl.classList.toggle('over', over);
    fillEl.style.width = `${Math.min(100, (ms / BAR_MAX_MS) * 100)}%`;
    fillEl.classList.toggle('over', over);
    const score = prettiness(shown);
    const top = best(mult()).score;
    scoreEl.textContent = String(score);
    bestEl.textContent = String(top);
    starEl.hidden = !(score === top && !over);

    for (const b of feats) {
      const id = b.dataset.f as Feature;
      const f = FEATURES.find((x) => x.id === id)!;
      const gi = shown.has('gi');
      const on = shown.has(id);
      const locked = (id !== 'gi' && gi) || (!!f.needs && !shown.has(f.needs));
      b.setAttribute('aria-pressed', String(on));
      b.disabled = locked;
      b.classList.toggle('on', on);
      b.querySelector<HTMLElement>('.feat-ms')!.textContent = `+${(f.ms * mult()).toFixed(1)} ms`;
    }
    tiers.forEach((t, i) => {
      t.setAttribute('aria-checked', String(i === tierIdx));
      t.classList.toggle('on', i === tierIdx);
    });
    opts.setShading(toShading(shown));
  }

  feats.forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.f as Feature;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      render();
    }),
  );
  tiers.forEach((t, i) =>
    t.addEventListener('click', () => {
      tierIdx = i;
      render();
    }),
  );

  // Motion test: a ball sliding back and forth, drawn only as often as the console would manage.
  function drawMotion(now: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = motion.clientWidth;
    const h = motion.clientHeight;
    if (w === 0) {
      raf = requestAnimationFrame(drawMotion);
      return;
    }
    if (motion.width !== Math.round(w * dpr) || motion.height !== Math.round(h * dpr)) {
      motion.width = Math.round(w * dpr);
      motion.height = Math.round(h * dpr);
    }
    const ctx = motion.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const step = 1000 / fps;
    const t = Math.floor(now / step) * step; // sample-and-hold: the ball only moves on a new frame
    const x = 14 + (0.5 + 0.5 * Math.sin((t / 1400) * Math.PI * 2)) * (w - 28);
    ctx.fillStyle = '#e3e8ef';
    ctx.fillRect(14, h / 2 - 2, w - 28, 4);
    ctx.fillStyle = fps === 60 ? '#16a34a' : '#dc2626';
    ctx.beginPath();
    ctx.arc(x, h / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    raf = requestAnimationFrame(drawMotion);
  }

  return {
    onEnter() {
      resetScene(opts.scene);
      selected = new Set();
      tierIdx = 1;
      render();
      opts.reset();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(drawMotion);
    },
    onLeave() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
