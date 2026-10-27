export type Term = 'lo' | 'le' | 'int' | 'fr' | 'li' | 'cos';

const SHORT_MS = 2500;

/** The name shown under a term when it is tapped. Kept to a few words on purpose. */
export const TERM_NAMES: Record<Term, string> = {
  lo: 'Outgoing light',
  le: 'Emitted light',
  int: 'Sum over all directions',
  fr: 'Material (BRDF)',
  li: 'Incoming light',
  cos: 'Angle to the surface',
};
const TAP_MS = 9000;

export interface Equation<T extends string = Term> {
  /** Light up a term for a moment. Used by controls. */
  highlight(term: T, ms?: number): void;
  /** Keep one term lit until cleared (null), e.g. f_r while its lobe is shown. Brief highlights still flash over it. */
  setSticky(term: T | null): void;
  /** Called when a term button is tapped. */
  onTap(cb: (term: T) => void): void;
}

/** The equation is a row of colored term buttons: they glow when the matching control is used (or when tapped). No text. */
export function initEquation<T extends string = Term>(
  rootId = 'equation',
  names: Record<T, string> = TERM_NAMES as Record<string, string> as Record<T, string>,
): Equation<T> {
  const root = document.getElementById(rootId)!;
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.term'));
  let timer = 0;
  let sticky: T | null = null;
  let tapCb: ((t: T) => void) | null = null;

  // one small label, placed under whichever term was tapped (fixed position, so no card clips it)
  const tip = document.createElement('div');
  tip.className = 'term-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  let tipFor: HTMLButtonElement | null = null;
  const placeTip = () => {
    if (!tipFor) return;
    const r = tipFor.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    // keep the label on screen; the little arrow still points at the term
    const half = tip.offsetWidth / 2;
    const x = Math.min(Math.max(cx, half + 8), window.innerWidth - half - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${r.bottom + 8}px`;
    tip.style.setProperty('--arrow', `${cx - x}px`);
  };
  const showTip = (b: HTMLButtonElement) => {
    tipFor = b;
    tip.textContent = names[b.dataset.term as T];
    tip.style.setProperty('--tc', getComputedStyle(b).color);
    tip.hidden = false;
    placeTip();
  };
  const hideTip = () => {
    tipFor = null;
    tip.hidden = true;
  };
  window.addEventListener('resize', placeTip);

  const paint = (term: T | null) =>
    buttons.forEach((b) => {
      const on = b.dataset.term === term || b.dataset.term === sticky;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  const clear = () => {
    paint(null);
    // the label stays only while its term stays lit (f_r stays lit while its lobe is shown)
    if (tipFor && tipFor.dataset.term !== sticky) hideTip();
  };

  const show = (term: T, ms: number) => {
    window.clearTimeout(timer);
    paint(term);
    timer = window.setTimeout(clear, ms);
  };

  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      const term = b.dataset.term as T;
      show(term, TAP_MS);
      showTip(b);
      tapCb?.(term);
    }),
  );
  clear();

  return {
    highlight: (term, ms = SHORT_MS) => {
      // a control lighting another term takes the label away from the tapped one
      if (tipFor && tipFor.dataset.term !== term) hideTip();
      show(term, ms);
    },
    setSticky(term) {
      sticky = term;
      window.clearTimeout(timer);
      clear();
    },
    onTap(cb) {
      tapCb = cb;
    },
  };
}
