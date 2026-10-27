// Veach's multiple importance sampling scene (Eric Veach's thesis, 1997, figure 9.2): four glossy plates, from
// rough to nearly mirror-like, reflect four round lamps of very different sizes that all give off the same power.
//   BSDF sampling (follow the plate's shine) is clean for small lamps on shiny plates, noisy for big lamps on rough ones.
//   Light sampling (aim at a lamp) is clean for big lamps on rough plates, noisy for small lamps on shiny ones.
//   MIS uses both and weights them, so it is clean everywhere.
// The geometry is computed here and handed to the shader (render/veach-shader.ts) as uniforms.
import type { Vec3 } from './render/cpu';

export const VEACH_CAMERA = { pos: [0, 2, 15] as Vec3, target: [0, -0.05, 1] as Vec3, th: 0.62 };

export interface VeachLight {
  pos: Vec3;
  radius: number;
  /** emitted radiance (color times strength); strength falls with 1 / radius^2 so every lamp has the same power */
  radiance: Vec3;
}

export interface VeachPlate {
  center: Vec3;
  /** unit normal and the two in-plane axes (width along x, depth across) */
  n: Vec3;
  u: Vec3;
  v: Vec3;
  halfW: number;
  halfD: number;
  /** Phong exponent: higher is shinier */
  exponent: number;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** Lamp radii as in Veach's figure; colors so each lamp's reflection can be told apart. */
const LIGHT_RADII = [0.03, 0.1, 0.3, 0.9];
const LIGHT_COLORS: Vec3[] = [
  [1, 0.35, 0.25],
  [1, 0.85, 0.3],
  [0.35, 1, 0.45],
  [0.35, 0.6, 1],
];
/** radiance of a lamp of radius 0.1; others scale by (0.1 / r)^2 */
const LIGHT_STRENGTH = 100;
const LIGHT_ROW: Vec3 = [0, 2.1, -3];
const LIGHT_SPACING = 2.5;

export const VEACH_LIGHTS: VeachLight[] = LIGHT_RADII.map((r, i) => ({
  pos: [LIGHT_ROW[0] + (i - 1.5) * LIGHT_SPACING, LIGHT_ROW[1], LIGHT_ROW[2]],
  radius: r,
  radiance: mul(LIGHT_COLORS[i], LIGHT_STRENGTH * (0.1 / r) ** 2),
}));

/** Plates from front (roughest) to back (shiniest), each tilted so the camera sees the lamp row in it. */
const PLATE_CENTERS: Vec3[] = [
  [0, -1.95, 3.6],
  [0, -1.4, 2.4],
  [0, -0.85, 1.2],
  [0, -0.3, 0],
];
const PLATE_EXPONENTS = [12, 60, 300, 5000];

export const VEACH_PLATES: VeachPlate[] = PLATE_CENTERS.map((c, i) => {
  const toEye = norm(sub(VEACH_CAMERA.pos, c));
  const toLights = norm(sub(LIGHT_ROW, c));
  const n = norm(add(toEye, toLights)); // the mirror direction from the eye lands on the middle of the lamp row
  const u: Vec3 = [1, 0, 0];
  const v = norm(cross(n, u));
  return { center: c, n, u, v, halfW: 4.5, halfD: 0.55, exponent: PLATE_EXPONENTS[i] };
});

export type MisMode = 0 | 1 | 2 | 3; // BSDF sampling, light sampling, MIS, compare (all three stacked)

/** Power heuristic weight of strategy a against b (the same rule the main path tracer uses). */
export const powerHeuristic = (pa: number, pb: number) => (pa * pa) / (pa * pa + pb * pb);

/** Phong lobe pdf (solid angle) for a direction at angle alpha from the mirror direction. */
export const phongPdf = (cosAlpha: number, e: number) => (cosAlpha <= 0 ? 0 : ((e + 1) / (2 * Math.PI)) * Math.pow(cosAlpha, e));

/** Cone sampling pdf (solid angle) toward a sphere of radius r at distance d, including picking 1 of n lamps. */
export const lightPdf = (r: number, d: number, n: number) => {
  const sinMax2 = Math.min(1, (r * r) / (d * d));
  const cosMax = Math.sqrt(1 - sinMax2);
  return 1 / (n * 2 * Math.PI * (1 - cosMax));
};
