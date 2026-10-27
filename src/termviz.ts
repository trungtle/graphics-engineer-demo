// Simple pictures of the rendering equation's terms at one surface point, for teaching (not for rendering):
//   L_i: light arriving from many directions (what each direction sees in the box)
//   cos θ: the angle between the normal and the direction to the lamp
//   ∫ dω: the hemisphere of directions, with one small patch of it
import { intersect, type Vec3 } from './render/cpu';
import { lightRadiance, type SceneState } from './scene';

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** A tangent frame around n. */
export function frame(n: Vec3): [Vec3, Vec3] {
  const a: Vec3 = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t = norm(cross(a, n));
  return [t, cross(n, t)];
}

/** Direction at polar angle theta from n, turned phi around it. */
export function dirAt(n: Vec3, theta: number, phi: number): Vec3 {
  const [t, b] = frame(n);
  return norm(add(add(mul(t, Math.sin(theta) * Math.cos(phi)), mul(b, Math.sin(theta) * Math.sin(phi))), mul(n, Math.cos(theta))));
}

/** `count` directions spread evenly over the hemisphere around n (a golden-angle spiral, cosine-weighted). */
export function hemisphereDirs(n: Vec3, count: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    out.push(dirAt(n, Math.asin(Math.sqrt(u)), i * 2.399963));
  }
  return out;
}

export interface Incoming {
  /** unit direction from the point out to where the light comes from */
  dir: Vec3;
  /** display color 0..1 for the arrow */
  color: Vec3;
  /** a lamp (or something glowing) is in this direction */
  bright: boolean;
}

/**
 * What each of `count` directions over the hemisphere sees: lamps bright, walls in their color, the open front dark.
 * The lamps are small, so an evenly spread set of directions can miss them: every lamp the point can see is added too.
 */
export function incomingLight(p: Vec3, nf: Vec3, scene: SceneState, count = 28): Incoming[] {
  const ro = add(p, mul(nf, 1e-3));
  const lampDirs: Vec3[] = [];
  scene.lights.forEach((l, i) => {
    const d = norm([l.x - p[0], 1 - p[1], l.z - p[2]]);
    if (dot(d, nf) <= 0) return;
    const h = intersect(ro, d, scene);
    if (h?.surface === 'light' && h.objectIndex === i) lampDirs.push(d);
  });
  return [...hemisphereDirs(nf, count), ...lampDirs].map((dir) => {
    const h = intersect(ro, dir, scene);
    if (!h) return { dir, color: [0.12, 0.13, 0.18], bright: false };
    if (h.surface === 'light') {
      const L = lightRadiance(scene.lights[h.objectIndex] ?? scene.light);
      const m = Math.max(L[0], L[1], L[2]);
      return { dir, color: [L[0] / m, L[1] / m, L[2] / m], bright: true };
    }
    if (h.emissive) return { dir, color: h.albedo, bright: true };
    // a lit wall or object passes on some of the lamp's light in its own color
    return { dir, color: mul(h.albedo, 0.75), bright: false };
  });
}

/** Direction to the selected lamp's center and the angle it makes with the normal. */
export function lampAngle(p: Vec3, nf: Vec3, scene: SceneState): { toLamp: Vec3; theta: number; cos: number } {
  const L = scene.light;
  const toLamp = norm([L.x - p[0], 1 - p[1], L.z - p[2]]);
  const c = Math.max(-1, Math.min(1, dot(toLamp, nf)));
  return { toLamp, theta: Math.acos(c), cos: Math.max(0, c) };
}

/** Points along the arc from a to b (unit vectors), for drawing an angle. */
export function arc(center: Vec3, a: Vec3, b: Vec3, radius: number, steps = 16): Vec3[] {
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  if (theta < 1e-4) return [add(center, mul(a, radius))];
  const s = Math.sin(theta);
  const pts: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * theta;
    const d = add(mul(a, Math.sin(theta - t) / s), mul(b, Math.sin(t) / s));
    pts.push(add(center, mul(d, radius)));
  }
  return pts;
}
