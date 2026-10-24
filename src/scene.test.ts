import { describe, expect, it } from 'vitest';
import { clampLight, defaultScene, lampAt, LIGHT_COLORS, lightSetup, resetScene, setLights } from './scene';

describe('resetScene', () => {
  it('restores every default in place, keeping object identity', () => {
    const s = defaultScene();
    const objects = s.objects;
    const first = s.objects[0];
    const light = s.light;
    s.bounces = 8;
    s.objects[0].mat = 4;
    s.objects[2].pos = [0, 0, 0];
    s.light.x = 0.5;
    s.light.half = 0.4;
    s.light.color = [...LIGHT_COLORS[3].rgb];
    s.camera.yaw = 0.4;
    s.camera.pitch = -0.1;

    resetScene(s);

    expect(s).toEqual(defaultScene());
    expect(s.objects).toBe(objects);
    expect(s.objects[0]).toBe(first);
    expect(s.light).toBe(light);
  });
});

describe('lamp setups', () => {
  it('one, two or three lamps, all on the ceiling and not overlapping', () => {
    for (const n of [1, 2, 3] as const) {
      const ls = lightSetup(n);
      expect(ls).toHaveLength(n);
      for (const l of ls) {
        const c = { ...l };
        clampLight(c);
        expect(c).toEqual(l);
      }
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const a = ls[i];
          const b = ls[j];
          expect(Math.abs(a.x - b.x) >= a.half + b.half || Math.abs(a.z - b.z) >= a.half + b.half).toBe(true);
        }
    }
  });

  it('switching keeps the first lamp object and selects it; reset goes back to one lamp', () => {
    const s = defaultScene();
    const first = s.lights[0];
    setLights(s, 3);
    expect(s.lights).toHaveLength(3);
    expect(s.lights[0]).toBe(first);
    expect(s.light).toBe(first);
    s.light = s.lights[2];
    resetScene(s);
    expect(s.lights).toHaveLength(1);
    expect(s.light).toBe(first);
  });

  it('lampAt finds the lamp under a ceiling point', () => {
    const ls = lightSetup(3);
    ls.forEach((l, i) => expect(lampAt(ls, l.x, l.z)).toBe(i));
    expect(lampAt(ls, 0, -0.9)).toBe(-1);
  });
});
