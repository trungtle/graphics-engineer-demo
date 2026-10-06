export const MATERIALS = ['diffuse', 'mirror', 'glass', 'metal', 'glowing'] as const;
export type MaterialId = 0 | 1 | 2 | 3 | 4;

export interface SphereObj {
  pos: [number, number, number];
  radius: number;
  color: [number, number, number];
  mat: MaterialId;
}

export interface SceneState {
  bounces: number;
  objects: SphereObj[];
  light: { x: number; z: number; half: number; color: [number, number, number] };
}

export function defaultScene(): SceneState {
  return {
    bounces: 4,
    objects: [
      { pos: [-0.45, -0.62, -0.25], radius: 0.38, color: [0.8, 0.8, 0.8], mat: 0 },
      { pos: [0.5, -0.72, 0.3], radius: 0.28, color: [0.85, 0.7, 0.2], mat: 3 },
      { pos: [0.05, -0.8, 0.55], radius: 0.2, color: [1, 1, 1], mat: 2 },
    ],
    light: { x: 0, z: 0, half: 0.3, color: [18, 16, 13] },
  };
}
