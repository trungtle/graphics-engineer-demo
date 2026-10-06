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
  light: LightState;
  /** orbit camera angles in radians (0,0 = straight on) */
  camera: { yaw: number; pitch: number };
}

export const LIGHT_REF_HALF = 0.3;
export const LIGHT_MIN_HALF = 0.12;
export const LIGHT_MAX_HALF = 0.42;
export const CAMERA_YAW_LIMIT = 0.5;
export const CAMERA_PITCH_MIN = -0.2;
export const CAMERA_PITCH_MAX = 0.3;

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

export function defaultScene(): SceneState {
  return {
    bounces: 4,
    objects: [
      { pos: [-0.45, -0.62, -0.25], radius: 0.38, color: [0.8, 0.8, 0.8], mat: 0 },
      { pos: [0.5, -0.72, 0.3], radius: 0.28, color: [0.85, 0.7, 0.2], mat: 3 },
      { pos: [0.05, -0.8, 0.55], radius: 0.2, color: [1, 1, 1], mat: 2 },
    ],
    light: { x: 0, z: 0, half: LIGHT_REF_HALF, color: [...LIGHT_COLORS[0].rgb] },
    camera: { yaw: 0, pitch: 0 },
  };
}
