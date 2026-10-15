import { describe, expect, it } from 'vitest';
import { GLASS_IOR, criticalAngle, glass, reflect, refract, traceBeam, type Element, type Vec2 } from './optics';

const BOUNDS = { w: 50, h: 50 };
const deg = (v: number) => (v * 180) / Math.PI;
const angleOf = (a: Vec2, b: Vec2) => deg(Math.atan2(b[1] - a[1], b[0] - a[0]));

describe('reflection', () => {
  it('the angle out equals the angle in', () => {
    const d = reflect([Math.SQRT1_2, -Math.SQRT1_2], [0, 1]);
    expect(d[0]).toBeCloseTo(Math.SQRT1_2);
    expect(d[1]).toBeCloseTo(Math.SQRT1_2);
  });

  it('a beam bounces off a mirror and reaches a target', () => {
    const els: Element[] = [
      { kind: 'mirror', a: [9, 4], b: [11, 6] },
      { kind: 'target', pos: [10, 12], r: 1 },
    ];
    const r = traceBeam([1, 5], [1, 0], els, BOUNDS);
    expect(r.ended).toBe('target');
    expect(r.hits).toEqual([1]);
    expect(r.points[1][0]).toBeCloseTo(10);
    expect(r.points[1][1]).toBeCloseTo(5);
  });
});

describe('refraction (Snell)', () => {
  it('bends toward the normal entering glass and comes out parallel from a slab', () => {
    const slab = glass([[10, 0], [14, 0], [14, 20], [10, 20]]);
    const a = (30 * Math.PI) / 180;
    const r = traceBeam([0, 10], [Math.cos(a), Math.sin(a)], [slab], BOUNDS);
    expect(r.points.length).toBe(4); // laser, enter, exit, edge of the arena
    const inside = angleOf(r.points[1], r.points[2]);
    expect(Math.sin((inside * Math.PI) / 180)).toBeCloseTo(Math.sin(a) / GLASS_IOR, 3);
    expect(inside).toBeLessThan(30);
    expect(angleOf(r.points[2], r.points[3])).toBeCloseTo(30, 1);
  });

  it('refract() reports total internal reflection beyond the critical angle', () => {
    const steep = (60 * Math.PI) / 180; // 60 degrees from the normal inside glass
    expect(refract([Math.sin(steep), -Math.cos(steep)], [0, 1], GLASS_IOR)).toBeNull();
    const shallow = (30 * Math.PI) / 180;
    expect(refract([Math.sin(shallow), -Math.cos(shallow)], [0, 1], GLASS_IOR)).not.toBeNull();
  });

  it('critical angle for glass is about 41.8 degrees', () => {
    expect(deg(criticalAngle(GLASS_IOR))).toBeCloseTo(41.81, 1);
  });

  it('a right-angle prism turns a beam by 90 degrees using total internal reflection', () => {
    const prism = glass([[10, 10], [20, 10], [10, 20]]);
    const r = traceBeam([13, 3], [0, 1], [prism], BOUNDS);
    const last = r.points.length - 1;
    expect(r.ended).toBe('bounds');
    expect(angleOf(r.points[last - 1], r.points[last])).toBeCloseTo(180, 0); // now travelling left
    expect(r.points[last][0]).toBeCloseTo(0);
  });

  it('glass given clockwise is reordered so the normals still point outward', () => {
    const cw = glass([[10, 10], [10, 20], [20, 10]]);
    const r = traceBeam([13, 3], [0, 1], [cw], BOUNDS);
    expect(angleOf(r.points[r.points.length - 2], r.points[r.points.length - 1])).toBeCloseTo(180, 0);
  });
});

describe('beam endings', () => {
  it('leaves the arena', () => {
    const r = traceBeam([5, 5], [1, 0], [], BOUNDS);
    expect(r.ended).toBe('bounds');
    expect(r.points[1][0]).toBeCloseTo(50);
    expect(r.hits).toEqual([]);
  });

  it('is stopped by a blocker', () => {
    const r = traceBeam([5, 5], [1, 0], [{ kind: 'blocker', a: [20, 0], b: [20, 40] }], BOUNDS);
    expect(r.ended).toBe('blocked');
    expect(r.points[1][0]).toBeCloseTo(20);
  });

  it('two mirrors facing each other end at the segment limit instead of looping forever', () => {
    const els: Element[] = [
      { kind: 'mirror', a: [2, 0], b: [2, 40] },
      { kind: 'mirror', a: [8, 0], b: [8, 40] },
    ];
    const r = traceBeam([5, 10], [1, 0], els, BOUNDS, { maxSegments: 12 });
    expect(r.ended).toBe('max');
    expect(r.points.length).toBe(13);
  });

  it('a target behind a blocker is not reached', () => {
    const els: Element[] = [
      { kind: 'blocker', a: [10, 0], b: [10, 40] },
      { kind: 'target', pos: [20, 5], r: 1 },
    ];
    expect(traceBeam([1, 5], [1, 0], els, BOUNDS).hits).toEqual([]);
  });
});
