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
  targets: { pos: Vec2; r: number }[];
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
 * Easy to hard. Level 1 already has both kinds of piece: the glass prism is locked in place so the player can
 * see what it does (it turns the beam), and only the mirror moves.
 */
export const LEVELS: Level[] = [
  {
    name: 'Meet the pieces',
    laser: { pos: [6, 45], angle: 0 },
    targets: [{ pos: [70, 15], r: 3.5 }],
    blockers: [],
    pieces: [prism(34, 35, 0, true), mirror(60, 48)],
    solution: [
      { pos: [34, 35], angle: 0 },
      { pos: [42, 15], angle: deg(-45) },
    ],
  },
  {
    name: 'Glass and mirror',
    laser: { pos: [6, 50], angle: 0 },
    targets: [{ pos: [70, 15], r: 3.5 }],
    blockers: [{ a: [58, 60], b: [58, 24] }],
    pieces: [prism(20, 10, 90), mirror(30, 55)],
    solution: [
      { pos: [34, 40], angle: 0 },
      { pos: [42, 15], angle: deg(-45) },
    ],
  },
  {
    name: 'Two turns',
    laser: { pos: [6, 50], angle: 0 },
    targets: [{ pos: [70, 15], r: 3.5 }],
    blockers: [],
    pieces: [mirror(20, 35), mirror(50, 25)],
    solution: [
      { pos: [30, 50], angle: deg(-45) },
      { pos: [30, 15], angle: deg(-45) },
    ],
  },
  {
    name: 'Over the wall',
    laser: { pos: [6, 15], angle: 0 },
    targets: [{ pos: [62, 15], r: 3.5 }],
    blockers: [{ a: [40, 0], b: [40, 40] }],
    pieces: [mirror(15, 40), mirror(35, 52), mirror(60, 40)],
    solution: [
      { pos: [20, 15], angle: deg(45) },
      { pos: [20, 50], angle: deg(45) },
      { pos: [62, 50], angle: deg(-45) },
    ],
  },
  {
    name: 'Prism relay',
    laser: { pos: [6, 45], angle: 0 },
    targets: [{ pos: [70, 18], r: 3.5 }],
    blockers: [],
    pieces: [prism(15, 15, 90), prism(62, 40, 270)],
    solution: [
      { pos: [34, 35], angle: 0 },
      { pos: [50, 28], angle: deg(180) },
    ],
  },
  {
    name: 'Zigzag',
    laser: { pos: [6, 10], angle: 0 },
    targets: [{ pos: [70, 10], r: 3.5 }],
    blockers: [
      { a: [25, 0], b: [25, 38] },
      { a: [52, 60], b: [52, 22] },
    ],
    pieces: [mirror(15, 30), mirror(35, 35), mirror(45, 45), mirror(60, 30)],
    solution: [
      { pos: [15, 10], angle: deg(45) },
      { pos: [15, 50], angle: deg(45) },
      { pos: [40, 50], angle: deg(-45) },
      { pos: [40, 10], angle: deg(-45) },
    ],
  },
];

/** One bright beam (a single laser color keeps it easy to tell from the silver mirrors and the red-and-white target). */
export const BEAMS: { ior: number; color: [number, number, number] }[] = [{ ior: 1.5, color: [255, 214, 102] }];

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
  const elements: Element[] = [];
  for (const b of level.blockers) elements.push({ kind: 'blocker', a: b.a, b: b.b });
  for (const p of pieces) elements.push(...pieceElements(p));
  const targetStart = elements.length;
  for (const t of level.targets) elements.push({ kind: 'target', pos: t.pos, r: t.r });

  const dir: Vec2 = [Math.cos(level.laser.angle), Math.sin(level.laser.angle)];
  const lit = level.targets.map(() => false);
  const beams = BEAMS.map((b) => {
    const r = traceBeam(level.laser.pos, dir, elements, ARENA, { ior: b.ior });
    for (const h of r.hits) lit[h - targetStart] = true;
    return { points: r.points, color: b.color };
  });
  return { beams, lit, won: lit.every(Boolean) };
}

/** The pieces of a level moved to its winning placement. */
export function solved(level: Level): PieceDef[] {
  return level.pieces.map((p, i) => ({ ...p, pos: level.solution[i].pos, angle: level.solution[i].angle }));
}

export const snapAngle = (a: number) => Math.round(a / SNAP_ANGLE) * SNAP_ANGLE;
