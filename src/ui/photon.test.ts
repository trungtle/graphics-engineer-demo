import { describe, expect, it } from 'vitest';
import { cameraOf, project, recordPath } from '../render/cpu';
import { defaultScene, lightRadiance } from '../scene';
import { classify, pathColor, toDisplay } from './photon';

const ASPECT = 1.25;

describe('photon outcome', () => {
  it('a photon started on the lamp hits light and brings back the lamp color', () => {
    const s = defaultScene();
    const [x, y] = project([0, 1, 0], ASPECT, cameraOf(s));
    const path = recordPath(x, y, ASPECT, s, 1);
    expect(classify(path)).toBe('light');
    expect(pathColor(path, s)).toEqual(lightRadiance(s.light));
  });

  it('with zero bounces a photon on a wall ends on an object and brings back black', () => {
    const s = defaultScene();
    s.bounces = 0;
    const path = recordPath(-0.65, 0.2, ASPECT, s, 3);
    expect(classify(path)).toBe('object');
    expect(pathColor(path, s)).toEqual([0, 0, 0]);
  });

  it('some photons miss (leave the box) and some find the lamp, never more light than the lamp emits', () => {
    const s = defaultScene();
    s.bounces = 8;
    const seen = { light: 0, object: 0, miss: 0 };
    for (let seed = 1; seed <= 400; seed++) {
      const path = recordPath(-0.2, -0.3, ASPECT, s, seed);
      const k = classify(path);
      seen[k]++;
      const c = pathColor(path, s);
      const L = lightRadiance(s.light);
      expect(c[0]).toBeLessThanOrEqual(L[0] + 1e-9);
      expect(c[1]).toBeLessThanOrEqual(L[1] + 1e-9);
      expect(c[2]).toBeLessThanOrEqual(L[2] + 1e-9);
      if (k !== 'light') expect(c).toEqual([0, 0, 0]);
    }
    expect(seen.light).toBeGreaterThan(0);
    expect(seen.object).toBeGreaterThan(0);
    expect(seen.miss).toBeGreaterThan(0);
  });

  it('a bounce off the red wall tints the photon red', () => {
    const s = defaultScene();
    s.bounces = 8;
    let tinted = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const path = recordPath(-0.65, 0.2, ASPECT, s, seed);
      if (classify(path) !== 'light') continue;
      const [r, g, b] = pathColor(path, s);
      if (r > g && r > b && g < r * 0.8) tinted++;
    }
    expect(tinted).toBeGreaterThan(0);
  });
});

describe('toDisplay', () => {
  it('maps black to black and very bright to white', () => {
    expect(toDisplay([0, 0, 0])).toEqual([0, 0, 0]);
    expect(toDisplay([100, 100, 100])).toEqual([255, 255, 255]);
  });
  it('is monotonic', () => {
    expect(toDisplay([0.2, 0.2, 0.2])[0]).toBeLessThan(toDisplay([0.8, 0.8, 0.8])[0]);
  });
});
