import type { Bvh, TextureImage } from './bvh';
import type { MeshModelId } from './mesh';

export const MATERIALS = ['diffuse', 'mirror', 'glass', 'metal', 'glowing'] as const;
export type MaterialId = 0 | 1 | 2 | 3 | 4;

export interface SphereObj {
  pos: [number, number, number];
  radius: number;
  color: [number, number, number];
  mat: MaterialId;
}

export interface LightState {
  /** center on the ceiling */
  x: number;
  z: number;
  /** half the side length of the square lamp */
  half: number;
  /** emitted radiance when half === LIGHT_REF_HALF (scaled so power stays constant) */
  color: [number, number, number];
}

export interface SceneState {
  bounces: number;
  objects: SphereObj[];
  /** every lamp on the ceiling (1 to MAX_LIGHTS) */
  lights: LightState[];
  /** the lamp the controls change (always one of `lights`; the last one tapped or dragged) */
  light: LightState;
  /** orbit camera angles in radians (0,0 = straight on) */
  /**
   * orbit angles in radians (0,0 = straight on); th = tan of half the field of view; aperture = lens radius
   * (0 = pinhole, everything sharp); focus = distance to the sharp plane along the view direction
   */
  camera: { yaw: number; pitch: number; th: number; aperture: number; focus: number };
  /** material of each wall of the box (glass is not offered for walls) */
  walls: Record<WallId, MaterialId>;
  /** a triangle model (bunny, dragon) standing in for the balls; it takes object 0's color and material. null = the balls */
  mesh: { id: MeshModelId; bvh: Bvh; texture?: TextureImage } | null;
}

export type WallId = 'left' | 'right' | 'floor' | 'ceiling' | 'back';
/** Order of the walls in the shader's u_wallMat. */
export const WALLS: WallId[] = ['left', 'right', 'floor', 'ceiling', 'back'];
const plainWalls = (): Record<WallId, MaterialId> => ({ left: 0, right: 0, floor: 0, ceiling: 0, back: 0 });

export const LIGHT_REF_HALF = 0.3;
export const MAX_LIGHTS = 3;
export const LIGHT_MIN_HALF = 0.12;
export const LIGHT_MAX_HALF = 0.42;
export const CAMERA_YAW_LIMIT = 0.5;
export const CAMERA_PITCH_MIN = -0.2;
export const CAMERA_PITCH_MAX = 0.3;
/** camera control ranges: field of view in degrees, aperture diameter in metres (the box is 2 m), focus in metres */
export const FOV_RANGE: [number, number] = [25, 80];
export const APERTURE_RANGE: [number, number] = [0, 0.4];
export const FOCUS_RANGE: [number, number] = [1.6, 6];

export const LIGHT_COLORS: { name: string; rgb: [number, number, number]; swatch: string }[] = [
  { name: 'Warm white', rgb: [18, 16, 13], swatch: '#ffd9a0' },
  { name: 'Cool white', rgb: [13, 16, 20], swatch: '#bcd8ff' },
  { name: 'Red', rgb: [22, 5, 4], swatch: '#ef4444' },
  { name: 'Blue', rgb: [4, 8, 24], swatch: '#3b82f6' },
  { name: 'Purple', rgb: [16, 5, 22], swatch: '#a855f7' },
];

/** Radiance actually emitted: a bigger lamp spreads the same power over more area. */
export function lightRadiance(l: LightState): [number, number, number] {
  const k = (LIGHT_REF_HALF / l.half) ** 2;
  return [l.color[0] * k, l.color[1] * k, l.color[2] * k];
}

/** Keep the lamp fully on the ceiling. */
export function clampLight(l: LightState): void {
  l.half = Math.min(LIGHT_MAX_HALF, Math.max(LIGHT_MIN_HALF, l.half));
  const lim = 0.97 - l.half;
  l.x = Math.min(lim, Math.max(-lim, l.x));
  l.z = Math.min(lim, Math.max(-lim, l.z));
}

export type LightSetup = 1 | 2 | 3;

/**
 * Ready-made lamp setups: one warm lamp; a warm and a cool lamp; red, green and blue lamps (they add up to white
 * where all three reach, and every object casts three colored shadows).
 */
export function lightSetup(n: LightSetup): LightState[] {
  const c = (i: number) => [...LIGHT_COLORS[i].rgb] as [number, number, number];
  if (n === 1) return [{ x: 0, z: 0, half: LIGHT_REF_HALF, color: c(0) }];
  if (n === 2)
    return [
      { x: -0.5, z: 0, half: 0.22, color: c(0) },
      { x: 0.5, z: 0, half: 0.22, color: c(1) },
    ];
  return [
    { x: -0.5, z: -0.25, half: 0.2, color: c(2) },
    { x: 0.5, z: -0.25, half: 0.2, color: [5, 22, 5] },
    { x: 0, z: 0.45, half: 0.2, color: c(3) },
  ];
}

/** Switch the ceiling to a setup. The first lamp keeps its object identity (other modules may hold it). */
export function setLights(s: SceneState, n: LightSetup): void {
  const [first, ...rest] = lightSetup(n);
  const keep = s.lights[0];
  Object.assign(keep, first);
  s.lights = [keep, ...rest];
  s.light = keep;
}

/** The lamp under ceiling point (x, z), or -1. Later lamps win where they overlap (same rule as the shader). */
export function lampAt(lights: LightState[], x: number, z: number): number {
  for (let i = lights.length - 1; i >= 0; i--) {
    const l = lights[i];
    if (Math.abs(x - l.x) < l.half && Math.abs(z - l.z) < l.half) return i;
  }
  return -1;
}

export function defaultScene(): SceneState {
  const lights = lightSetup(1);
  return {
    bounces: 4,
    objects: [
      { pos: [-0.45, -0.62, -0.25], radius: 0.38, color: [0.8, 0.8, 0.8], mat: 0 },
      { pos: [0.5, -0.72, 0.3], radius: 0.28, color: [0.85, 0.7, 0.2], mat: 3 },
      { pos: [0.05, -0.8, 0.55], radius: 0.2, color: [1, 1, 1], mat: 2 },
    ],
    lights,
    light: lights[0],
    walls: plainWalls(),
    camera: { yaw: 0, pitch: 0, th: 0.45, aperture: 0, focus: 3.4 },
    mesh: null,
  };
}

/** Put an existing scene object back to the defaults, in place (other modules hold a reference to it). */
export function resetScene(s: SceneState): void {
  const d = defaultScene();
  s.bounces = d.bounces;
  d.objects.forEach((o, i) => Object.assign(s.objects[i], o));
  setLights(s, 1);
  s.walls = plainWalls();
  Object.assign(s.camera, d.camera);
  s.mesh = null;
}
