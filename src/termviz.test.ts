import { describe, expect, it } from 'vitest';
import type { Vec3 } from './render/cpu';
import { defaultScene, setLights } from './scene';
import { arc, hemisphereDirs, incomingLight, lampAngle } from './termviz';

const FLOOR_P: Vec3 = [0.75, -1, -0.6]; // in the open, not in a ball's shadow
const UP: Vec3 = [0, 1, 0];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('term pictures', () => {
  it('hemisphere directions are unit length and all above the surface', () => {
    for (const d of hemisphereDirs(UP, 40)) {
      expect(Math.hypot(...d)).toBeCloseTo(1, 9);
      expect(dot(d, UP)).toBeGreaterThan(0);
    }
  });

  it('incoming light on the floor: some directions see the lamp (bright, lamp colored), the rest see walls or the open front', () => {
    const s = defaultScene();
    const inc = incomingLight(FLOOR_P, UP, s, 120);
    const bright = inc.filter((i) => i.bright);
    expect(bright.length).toBeGreaterThan(0);
    expect(bright.length).toBeLessThan(inc.length / 2);
    for (const i of bright) for (const c of i.color) expect(c).toBeLessThanOrEqual(1);
  });

  it('with three colored lamps, the floor sees more than one lamp color', () => {
    const s = defaultScene();
    setLights(s, 3);
    const colors = new Set(incomingLight([0, -1, 0], UP, s, 400).filter((i) => i.bright).map((i) => i.color.map((c) => c.toFixed(2)).join()));
    expect(colors.size).toBeGreaterThan(1);
  });

  it('cos theta: straight under the lamp is about 1, off to the side it is smaller', () => {
    const s = defaultScene();
    expect(lampAngle([0, -1, 0], UP, s).cos).toBeCloseTo(1, 6);
    expect(lampAngle([0.9, -1, 0.9], UP, s).cos).toBeLessThan(0.9);
    // a wall facing away from the lamp gets no light from it
    expect(lampAngle([0, 0.5, -1], [0, 0, 1], s).cos).toBeGreaterThan(0);
    expect(lampAngle([0, 0, 0], [0, -1, 0], s).cos).toBe(0);
  });

  it('the angle arc runs from the first direction to the second at the given radius', () => {
    const pts = arc([0, 0, 0], UP, [1, 0, 0], 0.5, 8);
    expect(pts[0][1]).toBeCloseTo(0.5, 9);
    expect(pts[8][0]).toBeCloseTo(0.5, 9);
    for (const q of pts) expect(Math.hypot(...q)).toBeCloseTo(0.5, 9);
  });
});

describe('shadows in the L_i picture', () => {
  it('a floor point in the gold ball’s shadow sees no lamp', () => {
    const s = defaultScene();
    // straight under the gold ball, which blocks the lamp
    expect(incomingLight([0.5, -1, 0.3], UP, s).some((i) => i.bright)).toBe(false);
  });
});
