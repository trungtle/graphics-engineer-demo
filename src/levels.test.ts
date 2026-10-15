import { describe, expect, it } from 'vitest';
import { ARENA, LEVELS, evaluate, pieceElements, snapAngle, solved } from './levels';

describe('levels', () => {
  it('has six levels', () => {
    expect(LEVELS).toHaveLength(6);
  });

  it('level 1 already has both a mirror and a prism, with the prism locked so the player sees what it does', () => {
    const kinds = LEVELS[0].pieces.map((p) => p.kind).sort();
    expect(kinds).toEqual(['mirror', 'prism']);
    expect(LEVELS[0].pieces.find((p) => p.kind === 'prism')!.fixed).toBe(true);
    expect(LEVELS[0].pieces.find((p) => p.kind === 'mirror')!.fixed).toBeUndefined();
  });

  it('locked pieces stay exactly where they start in the solution', () => {
    for (const level of LEVELS) {
      level.pieces.forEach((p, i) => {
        if (!p.fixed) return;
        expect(level.solution[i].pos).toEqual(p.pos);
        expect(level.solution[i].angle).toBeCloseTo(p.angle, 9);
      });
    }
  });

  it('prisms and mirrors ramp up: the later levels use more pieces than the first', () => {
    expect(LEVELS[LEVELS.length - 1].pieces.length).toBeGreaterThan(LEVELS[0].pieces.length);
    expect(LEVELS.some((l) => l.pieces.filter((p) => p.kind === 'prism').length >= 2)).toBe(true);
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
    const level = LEVELS[2];
    const a = evaluate(level, solved(level));
    const b = evaluate(level, [{ ...solved(level)[0], angle: 0 }, solved(level)[1]]);
    expect(a.won).toBe(true);
    expect(b.won).toBe(false);
  });

  it('a prism is made of one piece of glass, a mirror of one segment', () => {
    const prismPiece = LEVELS[0].pieces.find((p) => p.kind === 'prism')!;
    const mirrorPiece = LEVELS[0].pieces.find((p) => p.kind === 'mirror')!;
    expect(pieceElements(prismPiece)).toHaveLength(1);
    expect(pieceElements(prismPiece)[0].kind).toBe('glass');
    expect(pieceElements(mirrorPiece)[0].kind).toBe('mirror');
  });
});
