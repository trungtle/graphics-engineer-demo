// CPU mirror of the GPU path tracer's scene intersection and scattering.
// Keep in sync with TRACE_FRAG in shaders.ts (camera, room, spheres, materials).
// Used for tap-picking and for recording one light path for "Be a photon".
import type { SceneState } from '../scene';

export type Vec3 = [number, number, number];

export const CAMERA_DIST = 3.4;
export const CAMERA_TH = 0.45;
const GLASS_IOR = 1.5;
const METAL_ROUGH = 0.18;
const EPS = 1e-3;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const reflect = (d: Vec3, n: Vec3): Vec3 => sub(d, mul(n, 2 * dot(d, n)));

function refract(d: Vec3, n: Vec3, eta: number): Vec3 | null {
  const cosi = -dot(d, n);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  return add(mul(d, eta), mul(n, eta * cosi - Math.sqrt(k)));
}

export type Surface = 'left' | 'right' | 'floor' | 'ceiling' | 'back' | 'light' | 'object';

export interface CpuHit {
  t: number;
  p: Vec3;
  n: Vec3; // geometric normal as in the shader (may face away from the ray)
  surface: Surface;
  objectIndex: number; // -1 unless surface === 'object'
  mat: number;
  albedo: Vec3;
  emissive: boolean;
}

export interface Camera {
  pos: Vec3;
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
}

/** Orbit camera around the box center. yaw/pitch = 0 is straight on from +z. Mirrors main.ts uniforms. */
export function makeCamera(yaw = 0, pitch = 0): Camera {
  const cp = Math.cos(pitch);
  const pos: Vec3 = [
    CAMERA_DIST * Math.sin(yaw) * cp,
    CAMERA_DIST * Math.sin(pitch),
    CAMERA_DIST * Math.cos(yaw) * cp,
  ];
  const fwd = norm(mul(pos, -1));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { pos, right, up, fwd };
}

/** Camera at `pos` looking along `dir` (used for the photon's first-person view). */
export function cameraLookAlong(pos: Vec3, dir: Vec3): Camera {
  const fwd = norm(dir);
  const upHint: Vec3 = Math.abs(fwd[1]) > 0.97 ? [0, 0, 1] : [0, 1, 0];
  const right = norm(cross(fwd, upHint));
  const up = cross(right, fwd);
  return { pos, right, up, fwd };
}

export const cameraOf = (scene: SceneState): Camera => makeCamera(scene.camera.yaw, scene.camera.pitch);

/** Direction of the view ray through a screen position in [-1,1] (x right, y up). */
export function rayDir(ndcX: number, ndcY: number, aspect: number, cam: Camera): Vec3 {
  const sx = ndcX * CAMERA_TH * Math.max(aspect, 1);
  const sy = (ndcY * CAMERA_TH) / Math.min(aspect, 1);
  return norm(add(add(cam.fwd, mul(cam.right, sx)), mul(cam.up, sy)));
}

/** Primary ray, advanced to the open front plane z=1 (null if it misses the opening). */
export function cameraRay(ndcX: number, ndcY: number, aspect: number, cam: Camera): { ro: Vec3; rd: Vec3 } | null {
  const rd = rayDir(ndcX, ndcY, aspect, cam);
  if (rd[2] > -1e-3) return null;
  const t0 = (1 - cam.pos[2]) / rd[2];
  const p0 = add(cam.pos, mul(rd, t0));
  if (Math.abs(p0[0]) > 1 || Math.abs(p0[1]) > 1) return null;
  return { ro: p0, rd };
}

/** Inverse of rayDir: world point to [-1,1] screen coordinates. */
export function project(p: Vec3, aspect: number, cam: Camera): [number, number] {
  const d = sub(p, cam.pos);
  const z = dot(d, cam.fwd);
  return [
    dot(d, cam.right) / z / (CAMERA_TH * Math.max(aspect, 1)),
    (dot(d, cam.up) / z) * Math.min(aspect, 1) / CAMERA_TH,
  ];
}

/** Where a view ray lands on the ceiling plane y=1, as [x, z] (null if it does not point up). */
export function ceilingPoint(ndcX: number, ndcY: number, aspect: number, cam: Camera): [number, number] | null {
  const rd = rayDir(ndcX, ndcY, aspect, cam);
  if (rd[1] < 1e-4) return null;
  const t = (1 - cam.pos[1]) / rd[1];
  return [cam.pos[0] + rd[0] * t, cam.pos[2] + rd[2] * t];
}

export function intersect(ro: Vec3, rd: Vec3, scene: SceneState): CpuHit | null {
  let best: CpuHit | null = null;

  const tx = ((rd[0] < 0 ? -1 - ro[0] : 1 - ro[0]) / rd[0]);
  const ty = ((rd[1] < 0 ? -1 - ro[1] : 1 - ro[1]) / rd[1]);
  const tz = ((rd[2] < 0 ? -1 - ro[2] : 1 - ro[2]) / rd[2]);
  const t = Math.min(tx, ty, tz);
  const exitFront = t === tz && rd[2] > 0;
  if (!exitFront) {
    const p = add(ro, mul(rd, t));
    let n: Vec3;
    let surface: Surface;
    let albedo: Vec3;
    let emissive = false;
    if (t === tx) {
      n = [-Math.sign(rd[0]), 0, 0];
      surface = rd[0] < 0 ? 'left' : 'right';
      albedo = rd[0] < 0 ? [0.75, 0.12, 0.1] : [0.12, 0.62, 0.15];
    } else if (t === ty) {
      n = [0, -Math.sign(rd[1]), 0];
      surface = rd[1] > 0 ? 'ceiling' : 'floor';
      albedo = [0.78, 0.78, 0.78];
      const L = scene.light;
      if (rd[1] > 0 && Math.abs(p[0] - L.x) < L.half && Math.abs(p[2] - L.z) < L.half) {
        surface = 'light';
        emissive = true;
        albedo = [0, 0, 0];
      }
    } else {
      n = [0, 0, 1];
      surface = 'back';
      albedo = [0.78, 0.78, 0.78];
    }
    best = { t, p, n, surface, objectIndex: -1, mat: 0, albedo, emissive };
  }

  scene.objects.forEach((o, i) => {
    const oc = sub(ro, o.pos);
    const b = dot(oc, rd);
    const disc = b * b - (dot(oc, oc) - o.radius * o.radius);
    if (disc < 0) return;
    const sq = Math.sqrt(disc);
    let ts = -b - sq;
    if (ts < EPS) ts = -b + sq;
    if (ts > EPS && (!best || ts < best.t)) {
      const p = add(ro, mul(rd, ts));
      best = {
        t: ts,
        p,
        n: norm(sub(p, o.pos)),
        surface: 'object',
        objectIndex: i,
        mat: o.mat,
        albedo: o.color,
        emissive: o.mat === 4,
      };
    }
  });
  return best;
}

/** What is under this screen position? Returns null if the ray leaves the box (background). */
export function pick(ndcX: number, ndcY: number, aspect: number, scene: SceneState): CpuHit | null {
  const ray = cameraRay(ndcX, ndcY, aspect, cameraOf(scene));
  return ray ? intersect(ray.ro, ray.rd, scene) : null;
}

/** Deterministic RNG so a recorded path can be replayed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cosineDir(n: Vec3, rnd: () => number): Vec3 {
  const u1 = rnd();
  const u2 = rnd();
  const r = Math.sqrt(u1);
  const phi = 2 * Math.PI * u2;
  const a: Vec3 = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t = norm(cross(a, n));
  const b = cross(n, t);
  return norm(add(add(mul(t, r * Math.cos(phi)), mul(b, r * Math.sin(phi))), mul(n, Math.sqrt(1 - u1))));
}

export type PathEvent =
  | 'diffuse' // scattered randomly off a matte surface
  | 'mirror'
  | 'metal'
  | 'reflect' // glass reflection
  | 'refract' // glass transmission
  | 'light' // reached a light source
  | 'escaped' // left through the open front
  | 'cutoff'; // ran out of bounces

export interface PathSegment {
  from: Vec3;
  to: Vec3;
  surface: Surface | 'none';
  objectIndex: number;
  event: PathEvent;
  /** cos of the angle between the arriving ray and the surface normal (1 = head-on, 0 = grazing) */
  cos: number;
  /** surface color at the hit (zero for the lamp and for escapes) */
  albedo: Vec3;
}

/** Trace one random light path (camera -> light direction) from a screen position. */
export function recordPath(ndcX: number, ndcY: number, aspect: number, scene: SceneState, seed: number): PathSegment[] {
  const ray = cameraRay(ndcX, ndcY, aspect, cameraOf(scene));
  if (!ray) return [];
  const rnd = mulberry32(seed);
  const segs: PathSegment[] = [];
  let { ro, rd } = ray;
  for (let i = 0; i <= scene.bounces; i++) {
    const h = intersect(ro, rd, scene);
    if (!h) {
      segs.push({ from: ro, to: add(ro, mul(rd, 1.5)), surface: 'none', objectIndex: -1, event: 'escaped', cos: 1, albedo: [0, 0, 0] });
      break;
    }
    const cosIn = Math.min(1, Math.abs(dot(rd, h.n)));
    const seg = (event: PathEvent): PathSegment => ({
      from: ro,
      to: h.p,
      surface: h.surface,
      objectIndex: h.objectIndex,
      event,
      cos: cosIn,
      albedo: h.albedo,
    });
    if (h.emissive) {
      segs.push(seg('light'));
      break;
    }
    if (i === scene.bounces) {
      segs.push(seg('cutoff'));
      break;
    }
    const inside = dot(rd, h.n) > 0;
    const n: Vec3 = inside ? mul(h.n, -1) : h.n;
    if (h.mat === 0) {
      segs.push(seg('diffuse'));
      ro = add(h.p, mul(n, EPS));
      rd = cosineDir(n, rnd);
    } else if (h.mat === 1) {
      segs.push(seg('mirror'));
      ro = add(h.p, mul(n, EPS));
      rd = reflect(rd, n);
    } else if (h.mat === 3) {
      segs.push(seg('metal'));
      let r = norm(add(reflect(rd, n), mul(cosineDir(n, rnd), METAL_ROUGH)));
      if (dot(r, n) <= 0) r = reflect(rd, n);
      ro = add(h.p, mul(n, EPS));
      rd = r;
    } else {
      const eta = inside ? GLASS_IOR : 1 / GLASS_IOR;
      const cosi = Math.min(1, Math.max(0, dot(mul(rd, -1), n)));
      let r0 = (1 - GLASS_IOR) / (1 + GLASS_IOR);
      r0 *= r0;
      const fres = r0 + (1 - r0) * Math.pow(1 - cosi, 5);
      const refr = refract(rd, n, eta);
      if (!refr || rnd() < fres) {
        segs.push(seg('reflect'));
        ro = add(h.p, mul(n, EPS));
        rd = reflect(rd, n);
      } else {
        segs.push(seg('refract'));
        ro = sub(h.p, mul(n, EPS));
        rd = refr;
      }
    }
  }
  return segs;
}
