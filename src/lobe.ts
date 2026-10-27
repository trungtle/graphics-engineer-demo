// BRDF lobes for the "f_r" view: at a picked point, the shape of where light arriving from the camera's direction
// gets scattered, using the same materials as the path tracer (shaders.ts / cpu.ts):
//   matte: cosine-weighted around the normal (a sphere sitting on the surface)
//   metal: a narrow lobe around the mirror direction (roughness 0.18)
//   mirror: a needle along the mirror direction
//   glass: a reflected needle and a refracted needle, their lengths split by the Fresnel term
//   glowing things and lamps do not scatter: they get an emission lobe instead (the L_e term)
import type { Vec3 } from './render/cpu';

const GLASS_IOR = 1.5;

export type LobeKind = 'scatter' | 'reflect' | 'refract' | 'emit';

export interface Lobe {
  kind: LobeKind;
  /** share of the scattered light (glass splits it between reflect and refract) */
  weight: number;
  /** polylines in world space: rings around the lobe axis and meridians from the surface point */
  lines: Vec3[][];
  /** the lobe's tip (furthest point along its axis) */
  tip: Vec3;
}

export interface LobeSet {
  lobes: Lobe[];
  /** the surface normal, turned to face the camera side */
  normal: Vec3;
  /** unit direction from the point back toward the camera */
  toEye: Vec3;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const reflect = (d: Vec3, n: Vec3): Vec3 => add(d, mul(n, -2 * dot(d, n)));

function refract(d: Vec3, n: Vec3, eta: number): Vec3 | null {
  const cosi = -dot(d, n);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  return norm(add(mul(d, eta), mul(n, eta * cosi - Math.sqrt(k))));
}

const RINGS = 9;
const MERIDIANS = 16;

/**
 * A lobe around `axis`: radius(d) along each direction d, sampled on rings out to `thetaMax` from the axis.
 * Directions on the wrong side of the surface (`side`) get radius 0.
 */
function buildLobe(p: Vec3, axis: Vec3, side: Vec3, thetaMax: number, radius: (d: Vec3) => number, size: number): { lines: Vec3[][]; tip: Vec3 } {
  const a: Vec3 = Math.abs(axis[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t = norm(cross(a, axis));
  const b = cross(axis, t);
  const point = (theta: number, phi: number): Vec3 => {
    const d = norm(add(add(mul(t, Math.sin(theta) * Math.cos(phi)), mul(b, Math.sin(theta) * Math.sin(phi))), mul(axis, Math.cos(theta))));
    const r = dot(d, side) <= 0 ? 0 : Math.max(0, radius(d));
    return add(p, mul(d, r * size));
  };
  // rings bunch up near the axis, where narrow lobes change fastest
  const thetas = Array.from({ length: RINGS + 1 }, (_, k) => thetaMax * (k / RINGS) ** 1.3);
  const lines: Vec3[][] = [];
  for (let k = 1; k <= RINGS; k++) {
    const ring: Vec3[] = [];
    for (let m = 0; m <= MERIDIANS; m++) ring.push(point(thetas[k], (m / MERIDIANS) * 2 * Math.PI));
    lines.push(ring);
  }
  for (let m = 0; m < MERIDIANS; m++) {
    const mer: Vec3[] = [p];
    for (let k = 0; k <= RINGS; k++) mer.push(point(thetas[k], (m / MERIDIANS) * 2 * Math.PI));
    lines.push(mer);
  }
  return { lines, tip: point(0, 0) };
}

/** Phong-style exponent whose lobe is about as wide as the path tracer's rough metal (roughness 0.18). */
export const METAL_EXP = 60;
const NEEDLE_EXP = 3000;

/**
 * Lobes at a point. `n` is the surface normal as stored (either side), `rd` the direction the view ray traveled to
 * reach the point, `size` the length of a full-strength lobe in world units.
 */
export function brdfLobes(p: Vec3, n: Vec3, rd: Vec3, mat: number, albedo: Vec3, emissive: boolean, size = 0.45): LobeSet {
  const inside = dot(rd, n) > 0;
  const nf = inside ? mul(n, -1) : n; // facing the camera's side
  const toEye = mul(rd, -1);
  const strength = 0.4 + 0.6 * Math.min(1, Math.max(albedo[0], albedo[1], albedo[2]));
  const lobes: Lobe[] = [];
  const R = norm(reflect(rd, nf));
  const make = (kind: LobeKind, weight: number, axis: Vec3, side: Vec3, thetaMax: number, f: (d: Vec3) => number, len: number) =>
    lobes.push({ kind, weight, ...buildLobe(p, axis, side, thetaMax, f, len) });

  if (emissive || mat === 4) {
    make('emit', 1, nf, nf, Math.PI / 2, (d) => dot(d, nf), size);
  } else if (mat === 0) {
    make('scatter', 1, nf, nf, Math.PI / 2, (d) => dot(d, nf), size * strength);
  } else if (mat === 3) {
    make('reflect', 1, R, nf, 0.55, (d) => Math.max(0, dot(d, R)) ** METAL_EXP, size * 1.3 * strength);
  } else if (mat === 1) {
    make('reflect', 1, R, nf, 0.08, (d) => Math.max(0, dot(d, R)) ** NEEDLE_EXP, size * 1.4 * strength);
  } else {
    // glass: Fresnel (Schlick, as in the path tracer) splits the light between a reflection and a refraction
    const eta = inside ? GLASS_IOR : 1 / GLASS_IOR;
    const cosi = Math.min(1, Math.max(0, dot(toEye, nf)));
    let r0 = (1 - GLASS_IOR) / (1 + GLASS_IOR);
    r0 *= r0;
    const T = refract(rd, nf, eta);
    const F = T ? r0 + (1 - r0) * (1 - cosi) ** 5 : 1;
    const len = (w: number) => size * 1.4 * Math.max(0.12, w);
    make('reflect', F, R, nf, 0.08, (d) => Math.max(0, dot(d, R)) ** NEEDLE_EXP, len(F));
    if (T) make('refract', 1 - F, T, mul(nf, -1), 0.08, (d) => Math.max(0, dot(d, T)) ** NEEDLE_EXP, len(1 - F));
  }
  return { lobes, normal: nf, toEye };
}
