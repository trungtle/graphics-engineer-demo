export type Term = 'lo' | 'le' | 'int' | 'fr' | 'li' | 'cos';

const SHORT_MS = 2500;
const TAP_MS = 9000;

export interface Equation {
  /** Light up a term for a moment. Used by controls. */
  highlight(term: Term, ms?: number): void;
  /** Keep one term lit until cleared (null), e.g. f_r while its lobe is shown. Brief highlights still flash over it. */
  setSticky(term: Term | null): void;
  /** Called when a term button is tapped. */
  onTap(cb: (term: Term) => void): void;
}

/** The equation is a row of colored term buttons: they glow when the matching control is used (or when tapped). No text. */
export function initEquation(): Equation {
  const root = document.getElementById('equation')!;
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.term'));
  let timer = 0;
  let sticky: Term | null = null;
  let tapCb: ((t: Term) => void) | null = null;

  const paint = (term: Term | null) =>
    buttons.forEach((b) => {
      const on = b.dataset.term === term || b.dataset.term === sticky;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  const clear = () => paint(null);

  const show = (term: Term, ms: number) => {
    window.clearTimeout(timer);
    paint(term);
    timer = window.setTimeout(clear, ms);
  };

  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      const term = b.dataset.term as Term;
      show(term, TAP_MS);
      tapCb?.(term);
    }),
  );
  clear();

  return {
    highlight: (term, ms = SHORT_MS) => show(term, ms),
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
