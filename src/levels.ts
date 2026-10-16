import { glass, traceBeam, type Bounds, type Element, type Vec2 } from './optics';

/** A piece on the board. `pos` is the center of a mirror and the right-angle corner of a prism. */
export interface PieceDef {
  kind: 'mirror' | 'prism';
  pos: Vec2;
  /** radians; a mirror at 0 is horizontal, a prism at 0 has its legs along +x and +y from the corner */
  angle: number;
  /** mirror length, or prism leg length */
  size: number;
  /** locked in place: part of the puzzle, not something the player moves */
  fixed?: boolean;
}

export interface Level {
  name: string;
  laser: { pos: Vec2; angle: number };
  /** `channel`: which color of the beam lights it (0 red, 1 green, 2 blue); unset = all colors (white light) must reach it */
  targets: { pos: Vec2; r: number; channel?: number }[];
  blockers: { a: Vec2; b: Vec2 }[];
  /** where the pieces start */
  pieces: PieceDef[];
  /** one winning placement per piece (position and angle); fixed pieces just repeat where they are */
  solution: { pos: Vec2; angle: number }[];
}

export const ARENA: Bounds = { w: 80, h: 60 };
export const SNAP_ANGLE = (15 * Math.PI) / 180;
const deg = (d: number) => (d * Math.PI) / 180;

const mirror = (x: number, y: number, a = 0): PieceDef => ({ kind: 'mirror', pos: [x, y], angle: deg(a), size: 14 });
const prism = (x: number, y: number, a = 0, fixed = false): PieceDef => ({
  kind: 'prism',
  pos: [x, y],
  angle: deg(a),
  size: 18,
  ...(fixed ? { fixed: true } : {}),
});

/**
 * One puzzle, and a hard one. The white beam has to be turned down by a prism, carried across and over a wall by
 * four mirrors, and then sent through a second prism that spreads it into a thick rainbow ribbon (glass bends each
 * color a slightly different amount). The whole ribbon has to land on the one target.
 * The 2D engine in optics.ts decides where the light goes; the 3D bench only draws it.
 */
export const LEVELS: Level[] = [
  {
    name: 'The bench',
    laser: { pos: [6, 50], angle: 0 },
    targets: [{ pos: [75, 15], r: 3.5 }],
    blockers: [
      { a: [45, 0], b: [45, 35] },
      { a: [58, 60], b: [58, 46] },
    ],
    pieces: [prism(15, 14, 90), mirror(62, 44), mirror(12, 33, 60), mirror(70, 25, 30), mirror(30, 55, 120), prism(45, 6, 270)],
    solution: [
      { pos: [20, 40], angle: 0 },
      { pos: [28, 25], angle: deg(-45) },
      { pos: [40, 25], angle: deg(45) },
      { pos: [40, 48], angle: deg(45) },
      { pos: [52, 48], angle: deg(-45) },
      { pos: [52, 28], angle: deg(15) },
    ],
  },
];

/**
 * White light is three beams (red, green, blue) that travel together until glass bends them by slightly different
 * amounts. The spread is kept small on purpose, so after a prism they stay together as one thick rainbow ray.
 */
export const BEAMS: { ior: number; color: [number, number, number] }[] = [
  { ior: 1.45, color: [255, 70, 70] },
  { ior: 1.5, color: [70, 255, 70] },
  { ior: 1.55, color: [70, 110, 255] },
];

/** The optical elements for a piece. */
export function pieceElements(p: PieceDef): Element[] {
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  const rot = (x: number, y: number): Vec2 => [p.pos[0] + x * c - y * s, p.pos[1] + x * s + y * c];
  if (p.kind === 'mirror') {
    const h = p.size / 2;
    return [{ kind: 'mirror', a: rot(-h, 0), b: rot(h, 0) }];
  }
  return [glass([rot(0, 0), rot(p.size, 0), rot(0, p.size)])];
}

export interface Evaluation {
  beams: { points: Vec2[]; color: [number, number, number] }[];
  /** which targets the light reaches */
  lit: boolean[];
  won: boolean;
}

export function evaluate(level: Level, pieces: PieceDef[]): Evaluation {
  const base: Element[] = [];
  for (const b of level.blockers) base.push({ kind: 'blocker', a: b.a, b: b.b });
  for (const p of pieces) base.push(...pieceElements(p));

  const dir: Vec2 = [Math.cos(level.laser.angle), Math.sin(level.laser.angle)];
  const hitBy = level.targets.map(() => new Set<number>());
  const beams = BEAMS.map((b, bi) => {
    // a colored target only stops its own color; a plain target stops every color
    const mine: number[] = [];
    level.targets.forEach((t, ti) => {
      if (t.channel === undefined || t.channel === bi) mine.push(ti);
    });
    const elements: Element[] = [...base, ...mine.map((ti): Element => ({ kind: 'target', pos: level.targets[ti].pos, r: level.targets[ti].r }))];
    const r = traceBeam(level.laser.pos, dir, elements, ARENA, { ior: b.ior });
    for (const h of r.hits) hitBy[mine[h - base.length]].add(bi);
    return { points: r.points, color: b.color };
  });
  // a colored target needs its color; a plain one needs all of the white light
  const lit = level.targets.map((t, ti) => (t.channel === undefined ? hitBy[ti].size === BEAMS.length : hitBy[ti].has(t.channel)));
  return { beams, lit, won: lit.every(Boolean) };
}

/** The pieces of a level moved to its winning placement. */
export function solved(level: Level): PieceDef[] {
  return level.pieces.map((p, i) => ({ ...p, pos: level.solution[i].pos, angle: level.solution[i].angle }));
}

export const snapAngle = (a: number) => Math.round(a / SNAP_ANGLE) * SNAP_ANGLE;
