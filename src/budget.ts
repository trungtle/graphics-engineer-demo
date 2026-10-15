import { ERAS, GI, type Shading } from './shading';

/** The 16 ms challenge: a fictional console, a frame-time budget and a table of what each effect costs. */
export type Feature = 'lighting' | 'shine' | 'shadows' | 'reflections' | 'ao' | 'aa' | 'gi';

export interface FeatureInfo {
  id: Feature;
  label: string;
  /** milliseconds on today's console */
  ms: number;
  /** how much prettier the picture gets */
  points: number;
  /** only works with this other feature on */
  needs?: Feature;
}

export const BUDGET_MS = 1000 / 60;
/** geometry and flat colors: always paid for */
export const BASE_MS = 3;

export const FEATURES: FeatureInfo[] = [
  { id: 'lighting', label: 'Lighting', ms: 2, points: 10 },
  { id: 'shine', label: 'Shine', ms: 1, points: 5, needs: 'lighting' },
  { id: 'shadows', label: 'Shadows', ms: 3.5, points: 15, needs: 'lighting' },
  { id: 'reflections', label: 'Reflections', ms: 4, points: 15 },
  { id: 'ao', label: 'Ambient occlusion', ms: 2.5, points: 10 },
  { id: 'aa', label: 'Smooth edges', ms: 1.5, points: 10 },
  // ray-traced lighting replaces everything above (and smooths edges for free)
  { id: 'gi', label: 'Ray-traced lighting', ms: 16, points: 75 },
];

export interface Tier {
  id: string;
  label: string;
  /** cost multiplier: bigger is slower */
  mult: number;
}

export const TIERS: Tier[] = [
  { id: 'old', label: 'Old', mult: 1.8 },
  { id: 'today', label: 'Today', mult: 1 },
  { id: 'future', label: 'Future', mult: 0.5 },
];

const info = (f: Feature) => FEATURES.find((x) => x.id === f)!;

/** What actually runs: ray-traced lighting replaces the raster tricks; effects that need another are dropped without it. */
export function normalize(sel: ReadonlySet<Feature>): Set<Feature> {
  if (sel.has('gi')) return new Set<Feature>(['gi']);
  const out = new Set(sel);
  for (const f of FEATURES) if (f.needs && out.has(f.id) && !out.has(f.needs)) out.delete(f.id);
  return out;
}

export function frameMs(sel: ReadonlySet<Feature>, mult: number): number {
  let ms = BASE_MS;
  for (const f of normalize(sel)) ms += info(f).ms;
  return ms * mult;
}

/** With vsync a late frame waits for the next refresh: 60, then 30, then 20 fps. */
export function effectiveFps(ms: number): 60 | 30 | 20 {
  if (ms <= BUDGET_MS + 1e-9) return 60;
  if (ms <= 2 * BUDGET_MS + 1e-9) return 30;
  return 20;
}

export function prettiness(sel: ReadonlySet<Feature>): number {
  let p = 0;
  for (const f of normalize(sel)) p += info(f).points;
  return p;
}

export interface Best {
  score: number;
  features: Set<Feature>;
  ms: number;
}

/** The prettiest picture that still holds 60 fps on a given tier (tries every combination). */
export function best(mult: number): Best {
  const ids = FEATURES.map((f) => f.id);
  let top: Best = { score: 0, features: new Set(), ms: BASE_MS * mult };
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    const sel = new Set<Feature>(ids.filter((_, i) => mask & (1 << i)));
    const n = normalize(sel);
    if (n.size !== sel.size) continue; // skip combinations that contain dropped features
    const ms = frameMs(n, mult);
    if (ms > BUDGET_MS + 1e-9) continue;
    const score = prettiness(n);
    if (score > top.score) top = { score, features: n, ms };
  }
  return top;
}

/** The picture for a feature set. */
export function toShading(sel: ReadonlySet<Feature>): Shading {
  const n = normalize(sel);
  if (n.has('gi')) return GI;
  return {
    mode: 'features',
    model: n.has('shine') ? 2 : n.has('lighting') ? 1 : 0,
    shadows: n.has('shadows'),
    reflections: n.has('reflections'),
    ao: n.has('ao'),
    aa: n.has('aa'),
  };
}

export const FLAT: Shading = ERAS[0].shading;
