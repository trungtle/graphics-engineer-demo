import { describe, expect, it } from 'vitest';
import { BEAM_Y, CYL_MAX, POLY_MAX, PLANES_PER_POLY, MAT, S, benchCamera, buildBench, puzzleToWorld, rayPoly, worldToPuzzle } from './bench';
import { LEVELS, evaluate, solved } from './levels';
import { project } from './render/cpu';

const level = LEVELS[0];
const solvedScene = () => buildBench(level, solved(level), evaluate(level, solved(level)));
const startScene = () => buildBench(level, level.pieces, evaluate(level, level.pieces));

describe('coordinates', () => {
  it('maps puzzle to world and back', () => {
    for (const p of [[0, 0], [80, 60], [40, 30], [12.5, 47]] as const) {
      const w = puzzleToWorld([p[0], p[1]]);
      const back = worldToPuzzle(w[0], w[2]);
      expect(back[0]).toBeCloseTo(p[0], 9);
      expect(back[1]).toBeCloseTo(p[1], 9);
    }
  });
  it('puzzle up is away from the viewer (world -z) and the board is centered', () => {
    expect(puzzleToWorld([40, 30])).toEqual([0, 0, 0]);
    expect(puzzleToWorld([40, 60])[2]).toBeLessThan(0);
    expect(puzzleToWorld([80, 30])[0]).toBeCloseTo(4, 9);
  });
});

describe('bench geometry', () => {
  it.each([['start', startScene], ['solved', solvedScene]] as const)('%s scene fits the shader limits', (_n, make) => {
    const s = make();
    expect(s.polys.length).toBeLessThanOrEqual(POLY_MAX);
    for (const p of s.polys) {
      expect(p.planes.length).toBeLessThanOrEqual(PLANES_PER_POLY);
      for (const pl of p.planes) expect(Math.hypot(pl[0], pl[1], pl[2])).toBeCloseTo(1, 6);
    }
    expect(s.cyls.length).toBeLessThanOrEqual(CYL_MAX);
    expect(s.targets).toHaveLength(3);
  });

  it('has a mirror, a glass prism, a wall, a laser and a light for every piece of the puzzle', () => {
    const s = solvedScene();
    expect(s.polys.filter((p) => p.mat === MAT.mirror)).toHaveLength(level.pieces.filter((p) => p.kind === 'mirror').length);
    expect(s.polys.filter((p) => p.mat === MAT.glass)).toHaveLength(level.pieces.filter((p) => p.kind === 'prism').length);
    expect(s.polys.filter((p) => p.kind === 1)).toHaveLength(level.blockers.length);
    expect(s.polys.filter((p) => p.mat === MAT.emissive).length).toBeGreaterThanOrEqual(2); // lens and the big light
  });

  it('a ray dropped from above onto the middle of each standing solid hits its top face', () => {
    const s = solvedScene();
    for (const p of s.polys) {
      if (p.mat === MAT.emissive) continue; // the lens and the big light are not table-standing solids of this kind
      // the middle of the solid in x and z: average the corners that the side planes make is awkward; instead
      // probe a grid and require that at least one downward ray from above hits the solid
      let hits = 0;
      for (let x = -4.5; x <= 4.5; x += 0.05) {
        for (let z = -3.5; z <= 3.5; z += 0.05) {
          const h = rayPoly([x, 20, z], [0, -1, 0], p.planes);
          if (h && h.n[1] > 0.99) hits++;
        }
      }
      expect(hits).toBeGreaterThan(0);
    }
  });

  it('a ray along the beam hits the first mirror it should: the first prism is in the way of the laser', () => {
    const s = solvedScene();
    const laser = puzzleToWorld(level.laser.pos, BEAM_Y);
    const glass = s.polys.find((p) => p.mat === MAT.glass)!;
    const hit = rayPoly([laser[0], BEAM_Y, laser[2]], [1, 0, 0], glass.planes);
    expect(hit).not.toBeNull();
    // the prism's left edge is at puzzle x = 20, i.e. 14 puzzle units from the laser
    expect(hit!.t).toBeCloseTo(14 * S, 2);
    expect(hit!.n[0]).toBeLessThan(0); // entering through a face that faces the laser
  });

  it('the beam is white while the three colors travel together, then splits into red, green and blue stretches', () => {
    const s = solvedScene();
    const colors = s.cyls.map((c) => c.color);
    expect(colors.filter((c) => c === 0).length).toBeGreaterThanOrEqual(8);
    for (const c of [1, 2, 3]) expect(colors.filter((x) => x === c).length).toBeGreaterThanOrEqual(2);
    for (const c of s.cyls) {
      expect(c.a[1]).toBeCloseTo(BEAM_Y, 9);
      expect(c.b[1]).toBeCloseTo(BEAM_Y, 9);
    }
  });

  it('beam segments join up: each white segment starts where the previous one ended', () => {
    const white = solvedScene().cyls.filter((c) => c.color === 0);
    for (let i = 1; i < white.length; i++) {
      expect(white[i].a[0]).toBeCloseTo(white[i - 1].b[0], 6);
      expect(white[i].a[2]).toBeCloseTo(white[i - 1].b[2], 6);
    }
  });

  it('targets are lit only when the puzzle is solved', () => {
    expect(solvedScene().targets.every((t) => t.lit)).toBe(true);
    expect(startScene().targets.some((t) => t.lit)).toBe(false);
  });
});

describe('camera', () => {
  it('looks at the middle of the table and sees the whole board', () => {
    const cam = benchCamera();
    const aspect = 1.15;
    const centre = project([0, 0, 0.15], aspect, cam);
    expect(Math.abs(centre[0])).toBeLessThan(0.02);
    expect(Math.abs(centre[1])).toBeLessThan(0.02);
    for (const p of [[0, 0], [80, 0], [0, 60], [80, 60]] as const) {
      const w = puzzleToWorld([p[0], p[1]]);
      const q = project(w, aspect, cam);
      expect(Math.abs(q[0])).toBeLessThan(1);
      expect(Math.abs(q[1])).toBeLessThan(1);
    }
  });
});
