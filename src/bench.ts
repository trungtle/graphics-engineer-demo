// The Mirrors puzzle as a real 3D tabletop (an "optical bench") for the path tracer.
// The 2D engine (optics.ts / levels.ts) decides where the light goes; this file only turns that into 3D shapes.
//
// Puzzle units -> world: 1 puzzle unit = 0.1 world units; puzzle +x is world +x, puzzle +y (up the board) is world -z
// (away from the viewer). The table top is y = 0.
import { cameraLookAlong, type Camera, type Vec3 } from './render/cpu';
import { ARENA, pieceElements, type Evaluation, type Level, type PieceDef } from './levels';
import type { Vec2 } from './optics';

export const S = 0.1;
export const BEAM_Y = 0.3;
export const POLY_MAX = 12;
export const PLANES_PER_POLY = 6;
export const CYL_MAX = 24;
export const TARGET_MAX = 3;

const MIRROR_T = 0.12;
const MIRROR_H = 0.7;
const PRISM_H = 0.7;
const WALL_T = 0.2;
const WALL_H = 0.9;
const BEAM_R = 0.036;
export const TARGET_H = 0.42;

/** Material numbers shared with the shader (the same ones the path tracer already uses). */
export const MAT = { diffuse: 0, mirror: 1, glass: 2, metal: 3, emissive: 4 } as const;
export const KIND = { plain: 0, hazard: 1 } as const;

/** A convex solid described by planes: a point is inside when dot(n, p) <= d for every plane. */
export interface BenchPoly {
  planes: [number, number, number, number][];
  /** albedo, or emitted radiance for emissive things */
  color: Vec3;
  mat: number;
  kind: number;
}

export interface BenchCyl {
  a: Vec3;
  b: Vec3;
  radius: number;
  /** index into BEAM_PALETTE */
  color: number;
}

export interface BenchTarget {
  /** world x and z of the center */
  pos: [number, number];
  radius: number;
  lit: boolean;
  /** palette color of its channel */
  color: Vec3;
}

export interface BenchScene {
  polys: BenchPoly[];
  cyls: BenchCyl[];
  targets: BenchTarget[];
}

/** Beam emission colors: 0 = white (all three colors together), 1 red, 2 green, 3 blue. Already scaled to HDR. */
export const BEAM_PALETTE: Vec3[] = [
  [34, 30, 22],
  [44, 5, 5],
  [5, 44, 5],
  [6, 11, 48],
];
/** Ring color of a plain target (lit by the whole white or rainbow beam). */
export const TARGET_RING: Vec3 = [0.92, 0.1, 0.16];
/** Glow color of a lit target. */
export const TARGET_LIT: Vec3 = [0.25, 1, 0.42];
/** Plain channel colors (for colored targets). */
export const CHANNEL_COLORS: Vec3[] = [
  [0.95, 0.12, 0.12],
  [0.1, 0.85, 0.2],
  [0.15, 0.3, 0.98],
];

export const puzzleToWorld = (p: Vec2, y = 0): Vec3 => [(p[0] - ARENA.w / 2) * S, y, (ARENA.h / 2 - p[1]) * S];
export const worldToPuzzle = (x: number, z: number): Vec2 => [x / S + ARENA.w / 2, ARENA.h / 2 - z / S];

/** The fixed camera over the bench. */
export function benchCamera(): Camera {
  const pos: Vec3 = [0, 7.8, 7.4];
  const target: Vec3 = [0, 0, 0.15];
  return cameraLookAlong(pos, [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]]);
}
export const BENCH_TH = 0.45;

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A box that stands on the table, long axis along (ux, uz), centered at c (x, z), given as six planes. */
function standingBox(c: Vec2, u: Vec2, length: number, thick: number, height: number, y0 = 0): BenchPoly['planes'] {
  const un = Math.hypot(u[0], u[1]);
  const ux = u[0] / un;
  const uz = u[1] / un;
  const v: Vec2 = [-uz, ux];
  const cu = c[0] * ux + c[1] * uz;
  const cv = c[0] * v[0] + c[1] * v[1];
  return [
    [ux, 0, uz, cu + length / 2],
    [-ux, 0, -uz, -cu + length / 2],
    [v[0], 0, v[1], cv + thick / 2],
    [-v[0], 0, -v[1], -cv + thick / 2],
    [0, 1, 0, y0 + height],
    [0, -1, 0, -y0],
  ];
}

function mirrorPoly(p: PieceDef): BenchPoly {
  const c = puzzleToWorld(p.pos);
  // the mirror's long direction in the world: puzzle (cos a, sin a) -> world (cos a, -sin a)
  const u: Vec2 = [Math.cos(p.angle), -Math.sin(p.angle)];
  return { planes: standingBox([c[0], c[2]], u, p.size * S, MIRROR_T, MIRROR_H), color: [0.93, 0.95, 1], mat: MAT.mirror, kind: KIND.plain };
}

function prismPoly(p: PieceDef): BenchPoly {
  const el = pieceElements(p)[0];
  if (el.kind !== 'glass') throw new Error('prism expected');
  const pts = el.points.map((q) => puzzleToWorld(q));
  const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
  const cz = (pts[0][2] + pts[1][2] + pts[2][2]) / 3;
  const planes: BenchPoly['planes'] = [];
  for (let i = 0; i < 3; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 3];
    const ex = b[0] - a[0];
    const ez = b[2] - a[2];
    const len = Math.hypot(ex, ez);
    let nx = ez / len;
    let nz = -ex / len;
    if (nx * (cx - a[0]) + nz * (cz - a[2]) > 0) {
      nx = -nx;
      nz = -nz;
    }
    planes.push([nx, 0, nz, nx * a[0] + nz * a[2]]);
  }
  planes.push([0, 1, 0, PRISM_H], [0, -1, 0, 0]);
  return { planes, color: [0.84, 0.94, 1], mat: MAT.glass, kind: KIND.plain };
}

function wallPoly(a: Vec2, b: Vec2): BenchPoly {
  const wa = puzzleToWorld(a);
  const wb = puzzleToWorld(b);
  const u: Vec2 = [wb[0] - wa[0], wb[2] - wa[2]];
  const length = Math.hypot(u[0], u[1]);
  const c: Vec2 = [(wa[0] + wb[0]) / 2, (wa[2] + wb[2]) / 2];
  return { planes: standingBox(c, u, length, WALL_T, WALL_H), color: [0.9, 0.62, 0.05], mat: MAT.diffuse, kind: KIND.hazard };
}

/** Turn the puzzle's current state into a 3D scene. */
export function buildBench(level: Level, pieces: PieceDef[], evaluation: Evaluation): BenchScene {
  const polys: BenchPoly[] = [];

  for (const p of pieces) polys.push(p.kind === 'mirror' ? mirrorPoly(p) : prismPoly(p));
  for (const w of level.blockers) polys.push(wallPoly(w.a, w.b));

  // the laser: a steel body behind the muzzle, with a glowing lens
  const lw = puzzleToWorld(level.laser.pos);
  const lu: Vec2 = [Math.cos(level.laser.angle), -Math.sin(level.laser.angle)];
  const bodyLen = 0.5;
  const body: Vec2 = [lw[0] - lu[0] * (bodyLen / 2), lw[2] - lu[1] * (bodyLen / 2)];
  polys.push({
    planes: standingBox(body, lu, bodyLen, 0.34, 0.5, 0.05),
    color: [0.34, 0.37, 0.42],
    mat: MAT.metal,
    kind: KIND.plain,
  });
  const lens: Vec2 = [lw[0] - lu[0] * 0.015, lw[2] - lu[1] * 0.015];
  polys.push({ planes: standingBox(lens, lu, 0.04, 0.14, 0.14, BEAM_Y - 0.07), color: [24, 17, 6], mat: MAT.emissive, kind: KIND.plain });

  // a big soft light above the bench
  polys.push({
    planes: [
      [1, 0, 0, 7],
      [-1, 0, 0, 7],
      [0, 0, 1, 5],
      [0, 0, -1, 5],
      [0, 1, 0, 8.2],
      [0, -1, 0, -8],
    ],
    color: [2.6, 2.5, 2.3],
    mat: MAT.emissive,
    kind: KIND.plain,
  });

  // the beam: one white stretch while the three colors travel together, then colored stretches
  const cyls: BenchCyl[] = [];
  const pts = evaluation.beams.map((b) => b.points);
  const same = (i: number) =>
    pts.every((p) => p[i] !== undefined && Math.hypot(p[i][0] - pts[0][i][0], p[i][1] - pts[0][i][1]) < 1e-3);
  let shared = 0;
  while (same(shared + 1) && shared + 1 < pts[0].length) shared++;
  const seg = (a: Vec2, b: Vec2, color: number) => {
    if (cyls.length < CYL_MAX) cyls.push({ a: puzzleToWorld(a, BEAM_Y), b: puzzleToWorld(b, BEAM_Y), radius: BEAM_R, color });
  };
  for (let i = 0; i < shared; i++) seg(pts[0][i], pts[0][i + 1], 0);
  pts.forEach((p, bi) => {
    for (let i = shared; i + 1 < p.length; i++) seg(p[i], p[i + 1], 1 + bi);
  });

  const targets: BenchTarget[] = level.targets.slice(0, TARGET_MAX).map((t, i) => {
    const c = puzzleToWorld(t.pos);
    return { pos: [c[0], c[2]], radius: t.r * S, lit: evaluation.lit[i], color: t.channel === undefined ? TARGET_RING : CHANNEL_COLORS[t.channel] };
  });
  return { polys, cyls, targets };
}

// ---------- CPU copies of what the shader does (used for tests; the shader is the one that draws) ----------

/** Ray against a convex solid given as planes (same method as the shader): returns the entry distance, or null. */
export function rayPoly(ro: Vec3, rd: Vec3, planes: BenchPoly['planes']): { t: number; n: Vec3 } | null {
  let tIn = -Infinity;
  let tOut = Infinity;
  let nIn: Vec3 = [0, 0, 0];
  let nOut: Vec3 = [0, 0, 0];
  for (const pl of planes) {
    const n: Vec3 = [pl[0], pl[1], pl[2]];
    const denom = dot3(n, rd);
    const dist = pl[3] - dot3(n, ro);
    if (Math.abs(denom) < 1e-8) {
      if (dist < 0) return null;
      continue;
    }
    const t = dist / denom;
    if (denom < 0) {
      if (t > tIn) {
        tIn = t;
        nIn = n;
      }
    } else if (t < tOut) {
      tOut = t;
      nOut = n;
    }
  }
  if (tIn > tOut || tOut < 1e-4) return null;
  return tIn > 1e-4 ? { t: tIn, n: nIn } : { t: tOut, n: nOut };
}

