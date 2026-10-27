import { describe, expect, it } from 'vitest';
import { brdfLobes } from './lobe';
import type { Vec3 } from './render/cpu';

const P: Vec3 = [0, -1, 0];
const N: Vec3 = [0, 1, 0]; // floor
const RD: Vec3 = [Math.sin(0.6), -Math.cos(0.6), 0]; // view ray coming down at 0.6 rad from the normal
const WHITE: Vec3 = [1, 1, 1];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(...a);
const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

describe('BRDF lobes', () => {
  it('matte: a sphere resting on the surface (cosine lobe), above the surface', () => {
    const { lobes, normal } = brdfLobes(P, N, RD, 0, WHITE, false, 0.5);
    expect(normal).toEqual(N);
    expect(lobes).toHaveLength(1);
    const c: Vec3 = [P[0], P[1] + 0.25, P[2]];
    for (const line of lobes[0].lines)
      for (const q of line) {
        expect(len(sub(q, c))).toBeCloseTo(0.25, 5);
        expect(q[1]).toBeGreaterThanOrEqual(P[1] - 1e-9);
      }
  });

  it('mirror and metal point along the mirror direction; metal is wider than mirror', () => {
    const R = unit([RD[0], -RD[1], RD[2]]);
    const width = (mat: number) => {
      const lobe = brdfLobes(P, N, RD, mat, WHITE, false).lobes[0];
      expect(unit(sub(lobe.tip, P))[0]).toBeCloseTo(R[0], 5);
      expect(unit(sub(lobe.tip, P))[1]).toBeCloseTo(R[1], 5);
      // widest point of the lobe away from its axis
      let w = 0;
      for (const line of lobe.lines)
        for (const q of line) {
          const d = sub(q, P);
          const along = d[0] * R[0] + d[1] * R[1] + d[2] * R[2];
          w = Math.max(w, len(sub(d, [R[0] * along, R[1] * along, R[2] * along])));
        }
      return w;
    };
    expect(width(3)).toBeGreaterThan(width(1) * 3);
  });

  it('glass: a reflection and a refraction that share the light (Fresnel)', () => {
    const { lobes } = brdfLobes(P, N, RD, 2, WHITE, false);
    expect(lobes.map((l) => l.kind)).toEqual(['reflect', 'refract']);
    expect(lobes[0].weight + lobes[1].weight).toBeCloseTo(1, 9);
    expect(lobes[0].weight).toBeLessThan(0.1); // mostly transmitted at this angle
    expect(lobes[1].tip[1]).toBeLessThan(P[1]); // the refracted needle goes into the glass
  });

  it('glass from the inside at a grazing angle reflects everything (total internal reflection)', () => {
    const rd: Vec3 = unit([Math.sin(1.2), Math.cos(1.2), 0]); // traveling up, against the normal's other side
    const { lobes } = brdfLobes(P, N, rd, 2, WHITE, false);
    expect(lobes).toHaveLength(1);
    expect(lobes[0].weight).toBe(1);
  });

  it('glowing surfaces and lamps get an emission lobe instead', () => {
    expect(brdfLobes(P, N, RD, 4, WHITE, true).lobes[0].kind).toBe('emit');
    expect(brdfLobes(P, N, RD, 0, [0, 0, 0], true).lobes[0].kind).toBe('emit');
  });

  it('the normal is turned toward the camera even when stored the other way', () => {
    const { normal, toEye } = brdfLobes(P, [0, -1, 0], RD, 0, WHITE, false);
    expect(normal[1]).toBe(1);
    expect(toEye[1]).toBeGreaterThan(0);
  });
});
