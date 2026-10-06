import { describe, expect, it } from 'vitest';
import { defaultScene } from '../scene';
import { pick, project, recordPath } from './cpu';

const ASPECT = 1.25;

describe('cpu ray picker', () => {
  const scene = defaultScene();

  it('picks each object at its projected center', () => {
    scene.objects.forEach((o, i) => {
      const [x, y] = project(o.pos, ASPECT);
      const h = pick(x, y, ASPECT, scene);
      expect(h?.surface).toBe('object');
      expect(h?.objectIndex).toBe(i);
    });
  });

  it('picks walls, ceiling light and floor', () => {
    expect(pick(-0.65, 0.2, ASPECT, scene)?.surface).toBe('left');
    expect(pick(0.65, 0.2, ASPECT, scene)?.surface).toBe('right');
    expect(pick(0, 0.3, ASPECT, scene)?.surface).toBe('back');
    expect(pick(0, 0.7, ASPECT, scene)?.surface).toBe('light');
    const [fx, fy] = project([-0.9, -1, 0.9], ASPECT);
    expect(pick(fx, fy, ASPECT, scene)?.surface).toBe('floor');
  });

  it('returns null outside the box opening', () => {
    expect(pick(1.5, 0, ASPECT, scene)).toBeNull();
  });
});

describe('path recorder', () => {
  const scene = defaultScene();

  it('first hit matches the picked object', () => {
    scene.objects.forEach((o, i) => {
      const [x, y] = project(o.pos, ASPECT);
      const path = recordPath(x, y, ASPECT, scene, 1);
      expect(path[0].surface).toBe('object');
      expect(path[0].objectIndex).toBe(i);
    });
  });

  it('is deterministic for a fixed seed and varies across seeds', () => {
    const a = recordPath(-0.3, -0.4, ASPECT, scene, 42);
    const b = recordPath(-0.3, -0.4, ASPECT, scene, 42);
    const c = recordPath(-0.3, -0.4, ASPECT, scene, 43);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('records an arrival angle cosine in [0,1] for every segment', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const s of recordPath(-0.2, -0.3, ASPECT, scene, seed)) {
        expect(s.cos).toBeGreaterThanOrEqual(0);
        expect(s.cos).toBeLessThanOrEqual(1);
      }
    }
  });

  it('only a few random paths reach the lamp (why the image starts noisy)', () => {
    const s = defaultScene();
    s.bounces = 8;
    let hits = 0;
    const N = 300;
    for (let seed = 1; seed <= N; seed++) {
      const path = recordPath(0, 0.55, ASPECT, s, seed);
      if (path[path.length - 1].event === 'light') hits++;
    }
    // measured ~6%: most photons never find the lamp; photon mode explains this to students
    expect(hits / N).toBeGreaterThan(0.02);
    expect(hits / N).toBeLessThan(0.3);
  });

  it('respects the bounce limit', () => {
    const s = defaultScene();
    s.bounces = 1;
    const path = recordPath(-0.65, 0.2, ASPECT, s, 7);
    expect(path.length).toBeLessThanOrEqual(2);
  });

  it('zero bounces only shows the lamp: other surfaces end in cutoff', () => {
    const s = defaultScene();
    s.bounces = 0;
    const path = recordPath(-0.65, 0.2, ASPECT, s, 7);
    expect(path).toHaveLength(1);
    expect(path[0].event).toBe('cutoff');
  });
});
