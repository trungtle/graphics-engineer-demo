export type Term = 'lo' | 'le' | 'int' | 'fr' | 'li' | 'cos';

interface TermInfo {
  title: string;
  /** one-line caption, shown whenever a control lights the term */
  caption: string;
  /** 1-2 sentences, shown when the student taps the term */
  detail: string;
}

export const TERMS: Record<Term, TermInfo> = {
  lo: {
    title: 'Lₒ',
    caption: 'The light you see from this spot',
    detail: 'This is what ends up in each pixel: all the light leaving one point on a surface toward your eye.',
  },
  le: {
    title: 'Lₑ',
    caption: 'Light the surface gives off itself',
    detail: 'Lamps and glowing things add their own light. Everything else can only reflect light that arrives.',
  },
  int: {
    title: '∫ dω',
    caption: 'Add up light from every direction',
    detail: 'A spot is lit from all around, so the computer tries random directions and averages them. Fewer tries means more noise.',
  },
  fr: {
    title: 'fᵣ',
    caption: 'The material',
    detail: 'How a surface scatters light: matte spreads it everywhere, a mirror sends it one way, glass lets it through.',
  },
  li: {
    title: 'Lᵢ',
    caption: 'Light arriving from somewhere else',
    detail: 'That light was bounced off something else first, so the equation uses itself. Each bounce is one more level.',
  },
  cos: {
    title: 'cos θ',
    caption: 'Slanted light is dimmer',
    detail: 'Light hitting a surface at a slant is spread over a bigger area, so that spot looks darker.',
  },
};

const HINT = { title: 'Tap any part', text: 'Or try the controls: the equation lights up what you change.' };
const SHORT_MS = 2500;
const TAP_MS = 9000;

export interface Equation {
  /** Light up a term (and its caption) for a moment. Used by controls. */
  highlight(term: Term, ms?: number): void;
}

export function initEquation(): Equation {
  const root = document.getElementById('equation')!;
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.term'));
  const cap = root.querySelector<HTMLElement>('#eq-cap')!;
  const capTitle = cap.querySelector<HTMLElement>('strong')!;
  const capText = cap.querySelector<HTMLElement>('span')!;
  let timer = 0;

  const clear = () => {
    buttons.forEach((b) => {
      b.classList.remove('on');
      b.setAttribute('aria-pressed', 'false');
    });
    cap.dataset.term = '';
    capTitle.textContent = HINT.title;
    capText.textContent = HINT.text;
  };

  const show = (term: Term, expanded: boolean, ms: number) => {
    window.clearTimeout(timer);
    buttons.forEach((b) => {
      const on = b.dataset.term === term;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const info = TERMS[term];
    cap.dataset.term = term;
    capTitle.textContent = info.title;
    capText.textContent = expanded ? `${info.caption}. ${info.detail}` : info.caption;
    timer = window.setTimeout(clear, ms);
  };

  buttons.forEach((b) =>
    b.addEventListener('click', () => show(b.dataset.term as Term, true, TAP_MS)),
  );
  clear();

  return { highlight: (term, ms = SHORT_MS) => show(term, false, ms) };
}
