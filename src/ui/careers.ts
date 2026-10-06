interface Career {
  id: string;
  label: string;
  /** one short line, shown when the chip is selected */
  text: string;
  /** accent color token */
  color: string;
  /** inline SVG shapes on a 24x24 grid, stroked with currentColor */
  icon: string;
}

export const CAREERS: Career[] = [
  {
    id: 'games',
    label: 'Games',
    text: 'Games: every frame has to be drawn in a few milliseconds',
    color: 'var(--c-fr)',
    icon: '<path d="M7 6h10a4 4 0 0 1 4 4v3a3 3 0 0 1-5.2 2L14 13h-4l-1.8 2A3 3 0 0 1 3 13v-3a4 4 0 0 1 4-4z"/><path d="M7 10h4M9 8v4"/><circle cx="15.5" cy="10" r="0.8"/><circle cx="17.5" cy="12" r="0.8"/>',
  },
  {
    id: 'movies',
    label: 'Movies and VFX',
    text: 'Movies: one frame can take hours to render',
    color: 'var(--c-int)',
    icon: '<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M5.5 4.5l3 4.5M11 4.5l3 4.5M16.5 4.5l3 4.5"/>',
  },
  {
    id: 'xr',
    label: 'AR and VR',
    text: 'AR and VR: two pictures, redrawn about 90 times a second',
    color: 'var(--c-li)',
    icon: '<path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4l-1.5-2.5h-3L9 17H5a2 2 0 0 1-2-2z"/>',
  },
  {
    id: 'cars',
    label: 'Cars and simulators',
    text: 'Cars and simulators: test a design before building it',
    color: 'var(--c-le)',
    icon: '<path d="M4 15l1.5-5A2 2 0 0 1 7.4 8.5h9.2a2 2 0 0 1 1.9 1.5L20 15v3h-3v-1.5H7V18H4z"/><circle cx="8" cy="13" r="0.9"/><circle cx="16" cy="13" r="0.9"/>',
  },
  {
    id: 'medical',
    label: 'Medical imaging',
    text: 'Medical imaging: see inside the body in 3D',
    color: 'var(--c-cos)',
    icon: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  },
  {
    id: 'gpu',
    label: 'GPU companies',
    text: 'GPU companies: design the chips that draw everything',
    color: 'var(--c-fr)',
    icon: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  },
  {
    id: 'math',
    label: 'The math',
    text: "The math you're learning now (vectors, trig, probability) is the job",
    color: 'var(--c-int)',
    icon: '<path d="M17 5H7l6 7-6 7h10"/>',
  },
];

const ROTATE_MS = 4500;
const PAUSE_AFTER_TAP_MS = 15000;

/** Bottom strip: where graphics programmers work. Rotates through the list; tapping a chip pins it for a while. */
export function initCareers(): void {
  const root = document.getElementById('careers')!;
  root.innerHTML = `
    <span class="careers-label">Graphics programmers work on</span>
    <div class="careers-chips" role="tablist" aria-label="Where graphics programmers work">
      ${CAREERS.map(
        (c, i) =>
          `<button class="chip" type="button" role="tab" data-i="${i}" aria-label="${c.label}" style="--cc:${c.color}"><svg viewBox="0 0 24 24" aria-hidden="true">${c.icon}</svg></button>`,
      ).join('')}
    </div>
    <p class="careers-text" aria-live="off"></p>`;
  const chips = Array.from(root.querySelectorAll<HTMLButtonElement>('.chip'));
  const text = root.querySelector<HTMLElement>('.careers-text')!;
  let cur = 0;
  let pausedUntil = 0;

  const show = (i: number) => {
    cur = i;
    chips.forEach((c, k) => {
      c.classList.toggle('on', k === i);
      c.setAttribute('aria-selected', String(k === i));
    });
    text.textContent = CAREERS[i].text;
    text.style.setProperty('--cc', CAREERS[i].color);
    text.classList.remove('swap');
    void text.offsetWidth; // restart the fade
    text.classList.add('swap');
  };
  chips.forEach((c, i) =>
    c.addEventListener('click', () => {
      pausedUntil = performance.now() + PAUSE_AFTER_TAP_MS;
      show(i);
    }),
  );
  show(0);
  window.setInterval(() => {
    if (performance.now() >= pausedUntil) show((cur + 1) % CAREERS.length);
  }, ROTATE_MS);
}
