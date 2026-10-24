import { describe, expect, it } from 'vitest';
import { Flip, FLUID, tiltedGravity } from './fluid';

const DT = 1 / 60;
const run = (f: Flip, steps: number, g: [number, number] = [0, -9.81]) => {
  for (let i = 0; i < steps; i++) f.step(DT, g[0], g[1]);
};
const inside = (f: Flip) => {
  for (let i = 0; i < f.count; i++) {
    const x = f.pos[2 * i];
    const y = f.pos[2 * i + 1];
    if (!(x >= f.h && x <= f.width - f.h && y >= f.h && y <= f.height)) return false;
  }
  return true;
};
const meanX = (f: Flip) => {
  let s = 0;
  for (let i = 0; i < f.count; i++) s += f.pos[2 * i];
  return s / f.count;
};
const maxY = (f: Flip) => {
  let m = 0;
  for (let i = 0; i < f.count; i++) m = Math.max(m, f.pos[2 * i + 1]);
  return m;
};

describe('FLIP tank', () => {
  it('starts as a still block of a few thousand particles against the left wall', () => {
    const f = new Flip();
    expect(f.count).toBeGreaterThan(2000);
    expect(f.count).toBeLessThan(6000);
    expect(f.maxSpeed()).toBe(0);
    expect(meanX(f)).toBeLessThan(f.width / 2);
  });

  it('the dam breaks: water runs right, stays in the tank, nothing is lost or blows up', () => {
    const f = new Flip();
    const n = f.count;
    const x0 = meanX(f);
    run(f, 90);
    expect(f.count).toBe(n);
    expect(meanX(f)).toBeGreaterThan(x0 + 0.3);
    expect(inside(f)).toBe(true);
    for (let i = 0; i < 2 * f.count; i++) expect(Number.isFinite(f.pos[i])).toBe(true);
    expect(f.maxSpeed()).toBeLessThan(30);
  });

  it('keeps its volume: about as many water cells after ten seconds of sloshing as at the start', () => {
    const f = new Flip();
    const fluidCells = () => f.cellType.reduce((n, t) => n + (t === FLUID ? 1 : 0), 0);
    run(f, 1);
    const v0 = fluidCells();
    run(f, 600);
    expect(f.maxSpeed()).toBeLessThan(3);
    expect(fluidCells()).toBeGreaterThan(v0 * 0.85);
    expect(fluidCells()).toBeLessThan(v0 * 1.25);
  });

  it('tilting the tank sends the water to the low side', () => {
    const f = new Flip();
    run(f, 300);
    const level = meanX(f);
    run(f, 300, tiltedGravity(0.35));
    expect(meanX(f)).toBeGreaterThan(level + 0.2);
    run(f, 400, tiltedGravity(-0.35));
    expect(meanX(f)).toBeLessThan(level - 0.2);
  });

  it('a stirring ball pushes water out of its way', () => {
    const f = new Flip();
    run(f, 300);
    const o = { x: f.width / 2, y: 0.4, vx: 0, vy: 0, r: 0.25 };
    f.setObstacle(o);
    run(f, 30);
    for (let i = 0; i < f.count; i++) {
      const d = Math.hypot(f.pos[2 * i] - o.x, f.pos[2 * i + 1] - o.y);
      expect(d).toBeGreaterThan(o.r);
    }
  });

  it('splash lifts some water up high and it falls back', () => {
    const f = new Flip();
    run(f, 300);
    f.splash();
    expect(maxY(f)).toBeGreaterThan(f.height * 0.8);
    run(f, 240);
    expect(inside(f)).toBe(true);
  });

  it('reset brings back the dam', () => {
    const f = new Flip();
    const x0 = meanX(f);
    run(f, 120);
    f.reset();
    expect(meanX(f)).toBeCloseTo(x0, 6);
    expect(f.maxSpeed()).toBe(0);
  });
});
