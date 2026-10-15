import { describe, expect, it } from 'vitest';
import { ARENA, LEVELS, evaluate, pieceElements, snapAngle, solved } from './levels';

describe('levels', () => {
  it('has five levels', () => {
    expect(LEVELS).toHaveLength(5);
  });

  it.each(LEVELS.map((l, i) => [i + 1, l] as const))('level %i is not solved at the start', (_n, level) => {
    expect(evaluate(level, level.pieces).won).toBe(false);
  });

  it.each(LEVELS.map((l, i) => [i + 1, l] as const))('level %i is solvable with its listed solution', (_n, level) => {
    const e = evaluate(level, solved(level));
    expect(e.won).toBe(true);
    expect(e.lit.every(Boolean)).toBe(true);
  });

  it.each(LEVELS.map((l, i) => [i + 1, l] as const))('level %i has one solution entry per piece, all inside the arena', (_n, level) => {
    expect(level.solution).toHaveLength(level.pieces.length);
    for (const s of level.solution) {
      expect(s.pos[0]).toBeGreaterThan(0);
      expect(s.pos[0]).toBeLessThan(ARENA.w);
      expect(s.pos[1]).toBeGreaterThan(0);
      expect(s.pos[1]).toBeLessThan(ARENA.h);
    }
  });

  it('every solution angle is a multiple of the 15 degree snap, so touch players can reach it', () => {
    for (const level of LEVELS) {
      for (const s of level.solution) expect(snapAngle(s.angle)).toBeCloseTo(s.angle, 6);
    }
  });

  it('a solution still works if the player is a little off (about 1 unit)', () => {
    for (const level of LEVELS) {
      const off = solved(level).map((p) => ({ ...p, pos: [p.pos[0] + 1, p.pos[1] - 1] as [number, number] }));
      expect(evaluate(level, off).won).toBe(true);
    }
  });

  it('turning a mirror changes where the beam goes', () => {
    const level = LEVELS[0];
    const a = evaluate(level, solved(level));
    const b = evaluate(level, [{ ...solved(level)[0], angle: 0 }]);
    expect(a.won).toBe(true);
    expect(b.won).toBe(false);
  });

  it('a prism is made of one piece of glass, a mirror of one segment', () => {
    expect(pieceElements(LEVELS[3].pieces[0])).toHaveLength(1);
    expect(pieceElements(LEVELS[3].pieces[0])[0].kind).toBe('glass');
    expect(pieceElements(LEVELS[0].pieces[0])[0].kind).toBe('mirror');
  });
});
