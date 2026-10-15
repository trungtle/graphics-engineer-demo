/** A station is one full screen of the booth (picture + panel). The shell owns the tab bar and visibility. */
export interface Station {
  id: string;
  label: string;
  /** inline SVG shapes on a 24x24 grid, stroked with currentColor */
  icon: string;
  /** the station's container (`.station`) */
  root: HTMLElement;
  /** if set, the shared GL viewport is moved here while this station is shown */
  viewportSlot?: HTMLElement;
  onEnter?: () => void;
  onLeave?: () => void;
}

export interface Stations {
  register(s: Station): void;
  show(id: string): void;
  readonly current: string | null;
  ids(): string[];
}

export function createStations(opts: { viewport: HTMLElement; tabs: HTMLElement }): Stations {
  const list: Station[] = [];
  let current: Station | null = null;
  const { viewport, tabs } = opts;

  function renderTabs() {
    tabs.hidden = list.length < 2;
    tabs.innerHTML = '';
    for (const s of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
      b.dataset.station = s.id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(s === current));
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${s.icon}</svg><span>${s.label}</span>`;
      b.addEventListener('click', () => show(s.id));
      tabs.appendChild(b);
    }
  }

  function show(id: string) {
    const next = list.find((s) => s.id === id);
    if (!next || next === current) return;
    current?.onLeave?.();
    for (const s of list) s.root.hidden = s !== next;
    if (next.viewportSlot && viewport.parentElement !== next.viewportSlot) next.viewportSlot.appendChild(viewport);
    current = next;
    tabs.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.station === id)));
    next.onEnter?.();
  }

  return {
    register(s) {
      list.push(s);
      if (!current) {
        current = s;
        s.onEnter?.();
      } else {
        s.root.hidden = true;
      }
      renderTabs();
    },
    show,
    get current() {
      return current?.id ?? null;
    },
    ids: () => list.map((s) => s.id),
  };
}
