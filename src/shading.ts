/** Shading features of the picture. `mode: 'features'` is the deterministic raster-era look; `'gi'` is the path tracer. */
export interface Shading {
  mode: 'features' | 'gi';
  /** 0 flat colors, 1 Lambert (diffuse), 2 Phong (diffuse + shine) */
  model: 0 | 1 | 2;
  shadows: boolean;
  reflections: boolean;
  ao: boolean;
  aa: boolean;
}

export const GI: Shading = { mode: 'gi', model: 2, shadows: true, reflections: true, ao: true, aa: true };

export interface Era {
  year: string;
  name: string;
  shading: Shading;
}

/** The look of each era. Every step only adds to the one before it. */
export const ERAS: Era[] = [
  { year: '1993', name: 'Flat colors', shading: { mode: 'features', model: 0, shadows: false, reflections: false, ao: false, aa: false } },
  { year: '1997', name: 'Lit surfaces', shading: { mode: 'features', model: 1, shadows: false, reflections: false, ao: false, aa: false } },
  { year: '2004', name: 'Shadows and shine', shading: { mode: 'features', model: 2, shadows: true, reflections: false, ao: false, aa: false } },
  { year: '2012', name: 'Reflections and smooth edges', shading: { mode: 'features', model: 2, shadows: true, reflections: true, ao: true, aa: true } },
  { year: 'Today', name: 'Global illumination', shading: GI },
];

/** True if `b` has everything `a` has (used to check the presets only ever add features). */
export function includes(b: Shading, a: Shading): boolean {
  if (a.mode === 'gi') return b.mode === 'gi';
  return (
    b.model >= a.model &&
    (!a.shadows || b.shadows) &&
    (!a.reflections || b.reflections) &&
    (!a.ao || b.ao) &&
    (!a.aa || b.aa)
  );
}
