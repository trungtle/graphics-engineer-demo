export type Term = 'lo' | 'le' | 'int' | 'fr' | 'li' | 'cos';

const SHORT_MS = 2500;
const TAP_MS = 9000;

export interface Equation {
  /** Light up a term for a moment. Used by controls. */
  highlight(term: Term, ms?: number): void;
}

/** The equation is a row of colored term buttons: they glow when the matching control is used (or when tapped). No text. */
export function initEquation(): Equation {
  const root = document.getElementById('equation')!;
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.term'));
  let timer = 0;

  const clear = () =>
    buttons.forEach((b) => {
      b.classList.remove('on');
      b.setAttribute('aria-pressed', 'false');
    });

  const show = (term: Term, ms: number) => {
    window.clearTimeout(timer);
    buttons.forEach((b) => {
      const on = b.dataset.term === term;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    timer = window.setTimeout(clear, ms);
  };

  buttons.forEach((b) => b.addEventListener('click', () => show(b.dataset.term as Term, TAP_MS)));
  clear();

  return { highlight: (term, ms = SHORT_MS) => show(term, ms) };
}
