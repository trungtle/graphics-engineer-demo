import { describe, expect, it } from 'vitest';
import { BASE_MS, BUDGET_MS, TIERS, best, effectiveFps, frameMs, normalize, prettiness, toShading, type Feature } from './budget';

const set = (...f: Feature[]) => new Set<Feature>(f);
const mult = (id: string) => TIERS.find((t) => t.id === id)!.mult;

describe('frame cost', () => {
  it('an empty frame costs just the base, scaled by the console', () => {
    expect(frameMs(set(), 1)).toBeCloseTo(BASE_MS);
    expect(frameMs(set(), 2)).toBeCloseTo(BASE_MS * 2);
  });

  it('each effect adds to the cost and the prettiness', () => {
    expect(frameMs(set('lighting'), 1)).toBeGreaterThan(frameMs(set(), 1));
    expect(prettiness(set('lighting'))).toBeGreaterThan(prettiness(set()));
  });

  it('effects that need lighting are dropped without it', () => {
    expect(normalize(set('shadows', 'shine'))).toEqual(set());
    expect(normalize(set('lighting', 'shadows'))).toEqual(set('lighting', 'shadows'));
  });

  it('ray-traced lighting replaces the raster tricks instead of adding to them', () => {
    expect(normalize(set('gi', 'lighting', 'shadows', 'reflections'))).toEqual(set('gi'));
    expect(frameMs(set('gi', 'shadows'), 1)).toBeCloseTo(frameMs(set('gi'), 1));
  });
});

describe('frame rate', () => {
  it('snaps to 60, 30 and 20 fps', () => {
    expect(effectiveFps(BUDGET_MS)).toBe(60);
    expect(effectiveFps(BUDGET_MS + 0.1)).toBe(30);
    expect(effectiveFps(2 * BUDGET_MS)).toBe(30);
    expect(effectiveFps(2 * BUDGET_MS + 0.1)).toBe(20);
  });
});

describe('the game', () => {
  it('on today\'s console not everything fits: you have to choose', () => {
    const all = set('lighting', 'shine', 'shadows', 'reflections', 'ao', 'aa');
    expect(frameMs(all, mult('today'))).toBeGreaterThan(BUDGET_MS);
    expect(frameMs(set('gi'), mult('today'))).toBeGreaterThan(BUDGET_MS);
  });

  it('better hardware allows a prettier picture, and the future console fits ray-traced lighting', () => {
    const o = best(mult('old'));
    const t = best(mult('today'));
    const f = best(mult('future'));
    expect(t.score).toBeGreaterThan(o.score);
    expect(f.score).toBeGreaterThan(t.score);
    expect(t.features.has('gi')).toBe(false);
    expect(f.features.has('gi')).toBe(true);
    for (const b of [o, t, f]) expect(b.ms).toBeLessThanOrEqual(BUDGET_MS + 1e-9);
  });
});

describe('picture for a feature set', () => {
  it('nothing on is flat colors; lighting and shine pick the model', () => {
    expect(toShading(set()).model).toBe(0);
    expect(toShading(set('lighting')).model).toBe(1);
    expect(toShading(set('lighting', 'shine')).model).toBe(2);
  });
  it('ray-traced lighting is the path tracer', () => {
    expect(toShading(set('gi')).mode).toBe('gi');
    expect(toShading(set('lighting')).mode).toBe('features');
  });
});
