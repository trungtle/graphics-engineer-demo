import { describe, expect, it } from 'vitest';
import { ARENA, LEVELS, evaluate, pieceElements, snapAngle, solved } from './levels';

describe('the puzzle', () => {
  const level = LEVELS[0];

  it('is a single level', () => {
    expect(LEVELS).toHaveLength(1);
  });

  it('is complex: both kinds of piece, several of each, and more than one wall', () => {
    expect(level.pieces.filter((p) => p.kind === 'mirror').length).toBeGreaterThanOrEqual(4);
    expect(level.pieces.filter((p) => p.kind === 'prism').length).toBeGreaterThanOrEqual(2);
    expect(level.blockers.length).toBeGreaterThanOrEqual(2);
  });

  it('is not solved at the start', () => {
    expect(evaluate(level, level.pieces).won).toBe(false);
  });

  it('is solvable with its listed solution', () => {
    const e = evaluate(level, solved(level));
    expect(e.won).toBe(true);
    expect(e.lit.every(Boolean)).toBe(true);
  });

  it('the solution uses every piece: the beam bends at each of them', () => {
    const beam = evaluate(level, solved(level)).beams[0].points;
    // laser + 2 per prism (in and out are one turn each, but the points include entry and exit) + 4 mirrors + target
    expect(beam.length).toBeGreaterThanOrEqual(10);
  });

  it('has one solution entry per piece, all inside the arena', () => {
    expect(level.solution).toHaveLength(level.pieces.length);
    for (const s of level.solution) {
      expect(s.pos[0]).toBeGreaterThan(0);
      expect(s.pos[0]).toBeLessThan(ARENA.w);
      expect(s.pos[1]).toBeGreaterThan(0);
      expect(s.pos[1]).toBeLessThan(ARENA.h);
    }
  });

  it('every solution angle is a multiple of the 15 degree snap, so touch players can reach it', () => {
    for (const s of level.solution) expect(snapAngle(s.angle)).toBeCloseTo(s.angle, 6);
  });

  it('the solution still works if the player is a little off (about 1 unit)', () => {
    for (const [dx, dy] of [
      [1, -1],
      [-1, 1],
      [1, 1],
      [-1, -1],
    ]) {
      const off = solved(level).map((p) => ({ ...p, pos: [p.pos[0] + dx, p.pos[1] + dy] as [number, number] }));
      expect(evaluate(level, off).won).toBe(true);
    }
  });

  it('turning one mirror breaks it', () => {
    const pieces = solved(level);
    const i = pieces.findIndex((p) => p.kind === 'mirror');
    pieces[i] = { ...pieces[i], angle: 0 };
    expect(evaluate(level, pieces).won).toBe(false);
  });

  it('removing a prism breaks it, so both prisms are needed', () => {
    for (let i = 0; i < level.pieces.length; i++) {
      if (level.pieces[i].kind !== 'prism') continue;
      const pieces = solved(level).map((p, k) => (k === i ? { ...p, pos: [5, 5] as [number, number] } : p));
      expect(evaluate(level, pieces).won).toBe(false);
    }
  });

  it('a prism is made of one piece of glass, a mirror of one segment', () => {
    const prismPiece = level.pieces.find((p) => p.kind === 'prism')!;
    const mirrorPiece = level.pieces.find((p) => p.kind === 'mirror')!;
    expect(pieceElements(prismPiece)).toHaveLength(1);
    expect(pieceElements(prismPiece)[0].kind).toBe('glass');
    expect(pieceElements(mirrorPiece)[0].kind).toBe('mirror');
  });

  it('white light is three colors that travel together, then glass spreads them into one thick rainbow ray', () => {
    const e = evaluate(level, solved(level));
    expect(e.beams).toHaveLength(3);
    const [r, g, b] = e.beams.map((bm) => bm.points);
    for (let i = 0; i < 3; i++) {
      for (const other of [g, b]) {
        expect(other[i][0]).toBeCloseTo(r[i][0], 3);
        expect(other[i][1]).toBeCloseTo(r[i][1], 3);
      }
    }
    // after the second prism the colors have separated a little, but stay together as one band
    const ends = [r, g, b].map((p) => p[p.length - 1]);
    const spread = Math.hypot(ends[0][0] - ends[2][0], ends[0][1] - ends[2][1]);
    expect(spread).toBeGreaterThan(0.3);
    expect(spread).toBeLessThan(level.targets[0].r * 2);
  });

  it('there is one target, and the whole rainbow ray (every color) has to reach it', () => {
    expect(level.targets).toHaveLength(1);
    expect(level.targets[0].channel).toBeUndefined();
    // without the splitting prism the beam misses the target entirely
    const pieces = solved(level).map((p, i, all) => (i === all.length - 1 ? { ...p, pos: [5, 5] as [number, number] } : p));
    expect(evaluate(level, pieces).won).toBe(false);
  });
});
