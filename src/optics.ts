// 2D optics for the Mirrors puzzle: one beam of light bouncing and bending through mirrors and glass.
// Pure maths (no DOM) so it can be tested. Coordinates: x right, y up, arena = [0, w] x [0, h].

export type Vec2 = [number, number];

export interface Mirror {
  kind: 'mirror';
  a: Vec2;
  b: Vec2;
}
export interface Blocker {
  kind: 'blocker';
  a: Vec2;
  b: Vec2;
}
/** A solid piece of glass: a convex polygon. */
export interface Glass {
  kind: 'glass';
  points: Vec2[];
}
export interface Target {
  kind: 'target';
  pos: Vec2;
  r: number;
}
export type Element = Mirror | Blocker | Glass | Target;

export interface Bounds {
  w: number;
  h: number;
}

export type Ended = 'bounds' | 'blocked' | 'target' | 'max';

export interface BeamResult {
  /** the beam as a polyline, starting at the laser */
  points: Vec2[];
  /** indices (into the element list) of the targets the beam reached */
  hits: number[];
  ended: Ended;
}

export const GLASS_IOR = 1.5;
const EPS = 1e-4;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
const neg = (a: Vec2): Vec2 => [-a[0], -a[1]];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const unit = (a: Vec2): Vec2 => mul(a, 1 / Math.hypot(a[0], a[1]));

/** Law of reflection: mirror the direction about the surface normal. */
export function reflect(d: Vec2, n: Vec2): Vec2 {
  return sub(d, mul(n, 2 * dot(d, n)));
}

/**
 * Snell's law. `n` is the surface normal facing against the ray, `eta` = n1 / n2.
 * Returns null for total internal reflection.
 */
export function refract(d: Vec2, n: Vec2, eta: number): Vec2 | null {
  const cosi = -dot(d, n);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  return add(mul(d, eta), mul(n, eta * cosi - Math.sqrt(k)));
}

/** Beyond this angle from the normal, light inside glass cannot get out. */
export const criticalAngle = (ior: number) => Math.asin(1 / ior);

/** Counter-clockwise polygon, so edge normals can point outward consistently. */
export function glass(points: Vec2[]): Glass {
  let area = 0;
  for (let i = 0; i < points.length; i++) area += cross(points[i], points[(i + 1) % points.length]);
  return { kind: 'glass', points: area < 0 ? [...points].reverse() : points };
}

function raySegment(p: Vec2, d: Vec2, a: Vec2, b: Vec2): number | null {
  const e = sub(b, a);
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return null;
  const ap = sub(a, p);
  const t = cross(ap, e) / den;
  const u = cross(ap, d) / den;
  return t > 1e-6 && u >= 0 && u <= 1 ? t : null;
}

function rayCircle(p: Vec2, d: Vec2, c: Vec2, r: number): number | null {
  const oc = sub(p, c);
  const b = dot(oc, d);
  const disc = b * b - (dot(oc, oc) - r * r);
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t = -b - s > 1e-6 ? -b - s : -b + s;
  return t > 1e-6 ? t : null;
}

function exitBounds(p: Vec2, d: Vec2, bounds: Bounds): number {
  let t = Infinity;
  if (d[0] > 0) t = Math.min(t, (bounds.w - p[0]) / d[0]);
  if (d[0] < 0) t = Math.min(t, -p[0] / d[0]);
  if (d[1] > 0) t = Math.min(t, (bounds.h - p[1]) / d[1]);
  if (d[1] < 0) t = Math.min(t, -p[1] / d[1]);
  return Math.max(t, 0);
}

/** Follow one beam from `start` in direction `dir` until it leaves, is blocked, hits a target or bounces too often. */
export function traceBeam(
  start: Vec2,
  dir: Vec2,
  elements: Element[],
  bounds: Bounds,
  opts: { ior?: number; maxSegments?: number } = {},
): BeamResult {
  const ior = opts.ior ?? GLASS_IOR;
  const maxSegments = opts.maxSegments ?? 40;
  let p = start;
  let d = unit(dir);
  const points: Vec2[] = [p];
  const hits = new Set<number>();
  let ended: Ended = 'max';

  for (let seg = 0; seg < maxSegments; seg++) {
    let t = exitBounds(p, d, bounds);
    let kind: 'bounds' | 'mirror' | 'blocker' | 'glass' | 'target' = 'bounds';
    let index = -1;
    let outward: Vec2 = [0, 0];

    elements.forEach((e, i) => {
      if (e.kind === 'mirror' || e.kind === 'blocker') {
        const h = raySegment(p, d, e.a, e.b);
        if (h !== null && h < t) {
          t = h;
          kind = e.kind;
          index = i;
          const s = sub(e.b, e.a);
          outward = unit([s[1], -s[0]]);
        }
      } else if (e.kind === 'glass') {
        for (let k = 0; k < e.points.length; k++) {
          const a = e.points[k];
          const b = e.points[(k + 1) % e.points.length];
          const h = raySegment(p, d, a, b);
          if (h !== null && h < t) {
            t = h;
            kind = 'glass';
            index = i;
            const s = sub(b, a);
            outward = unit([s[1], -s[0]]); // counter-clockwise polygon: right-hand side is outside
          }
        }
      } else {
        const h = rayCircle(p, d, e.pos, e.r);
        if (h !== null && h < t) {
          t = h;
          kind = 'target';
          index = i;
        }
      }
    });

    const hit = add(p, mul(d, t));
    points.push(hit);
    if (kind === 'bounds') {
      ended = 'bounds';
      break;
    }
    if (kind === 'blocker') {
      ended = 'blocked';
      break;
    }
    if (kind === 'target') {
      hits.add(index);
      ended = 'target';
      break;
    }
    if (kind === 'mirror') {
      const n = dot(d, outward) > 0 ? neg(outward) : outward; // facing the beam
      d = reflect(d, n);
      p = add(hit, mul(n, EPS));
      continue;
    }
    // glass: bend in, bend out, or bounce off the inside (total internal reflection)
    const entering = dot(d, outward) < 0;
    const n = entering ? outward : neg(outward); // normal facing against the beam
    const bent = refract(d, n, entering ? 1 / ior : ior);
    if (bent) {
      d = unit(bent);
      p = add(hit, mul(n, -EPS));
    } else {
      d = reflect(d, n);
      p = add(hit, mul(n, EPS));
    }
  }
  return { points, hits: [...hits], ended };
}
