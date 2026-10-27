import { describe, expect, it } from 'vitest';
import type { Vec3 } from './render/cpu';
import { lightPdf, phongPdf, powerHeuristic, VEACH_CAMERA, VEACH_LIGHTS, VEACH_PLATES } from './veach';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lum = (c: Vec3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe("Veach's MIS scene", () => {
  it('four lamps of very different sizes give off about the same power (radiance x area, up to their colors)', () => {
    const radii = VEACH_LIGHTS.map((l) => l.radius);
    expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThanOrEqual(30);
    const strength = VEACH_LIGHTS.map((l) => Math.max(...l.radiance) * l.radius * l.radius);
    for (const s of strength) expect(s).toBeCloseTo(strength[0], 6);
    for (const l of VEACH_LIGHTS) expect(lum(l.radiance)).toBeGreaterThan(0);
  });

  it('plates go from rough to nearly mirror-like', () => {
    const e = VEACH_PLATES.map((p) => p.exponent);
    for (let i = 1; i < e.length; i++) expect(e[i]).toBeGreaterThan(e[i - 1]);
    expect(e[e.length - 1] / e[0]).toBeGreaterThan(100);
  });

  it('each plate reflects the lamp row toward the camera (mirror law at its center)', () => {
    const row: Vec3 = [0, VEACH_LIGHTS[0].pos[1], VEACH_LIGHTS[0].pos[2]];
    for (const p of VEACH_PLATES) {
      const toEye = norm(sub(VEACH_CAMERA.pos, p.center));
      const toRow = norm(sub(row, p.center));
      expect(dot(toEye, p.n)).toBeCloseTo(dot(toRow, p.n), 9);
      expect(Math.hypot(...p.n)).toBeCloseTo(1, 9);
      expect(dot(p.n, p.u)).toBeCloseTo(0, 9);
      expect(dot(p.n, p.v)).toBeCloseTo(0, 9);
    }
  });

  it('MIS weights of the two strategies add up to 1', () => {
    for (const [a, b] of [
      [1, 1],
      [0.01, 30],
      [500, 2],
    ]) expect(powerHeuristic(a, b) + powerHeuristic(b, a)).toBeCloseTo(1, 12);
  });

  it('the Phong lobe pdf integrates to 1 over the hemisphere around its axis', () => {
    for (const e of [12, 300]) {
      let sum = 0;
      const n = 20000;
      for (let i = 0; i < n; i++) {
        const c = (i + 0.5) / n; // cos alpha, uniform in [0, 1]: d(omega) = 2 pi d(cos)
        sum += phongPdf(c, e) * 2 * Math.PI * (1 / n);
      }
      expect(sum).toBeCloseTo(1, 3);
    }
  });

  it('lamp sampling pdf is 1 / (lamps x solid angle of the lamp), and stays finite for the tiny lamp', () => {
    const r = 0.5;
    const d = 5;
    const cosMax = Math.sqrt(1 - (r * r) / (d * d));
    expect(lightPdf(r, d, 4)).toBeCloseTo(1 / (4 * 2 * Math.PI * (1 - cosMax)), 6);
    const tiny = lightPdf(0.03, 10, 4);
    expect(Number.isFinite(tiny)).toBe(true);
    // a tiny lamp's solid angle is about pi r^2 / d^2
    expect(tiny).toBeCloseTo(1 / (4 * Math.PI * 0.0009 / 100), -2);
  });
});
