// Triangle meshes for the bunny and the dragon. The files are made by scripts/convert-mesh.mjs.
import type { Vec3 } from './render/cpu';

export interface Mesh {
  vertexCount: number;
  triangleCount: number;
  /** bounding box in model space (the model is normalized: largest dimension 1, base at y = 0, centered on x and z) */
  bboxMin: Vec3;
  bboxMax: Vec3;
  /** xyz per vertex */
  positions: Float32Array;
  /** three vertex indices per triangle */
  indices: Uint16Array;
  /** smooth normals, xyz per vertex */
  normals: Float32Array;
}

export type ModelId = 'balls' | 'bunny' | 'dragon';
export const MODEL_FILES: Record<Exclude<ModelId, 'balls'>, string> = {
  bunny: 'models/bunny.bin',
  dragon: 'models/dragon.bin',
};

const HEADER_BYTES = 4 + 4 + 4 + 24;

/** Area-weighted smooth vertex normals. */
export function computeNormals(positions: Float32Array, indices: Uint16Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const e1x = positions[b] - positions[a];
    const e1y = positions[b + 1] - positions[a + 1];
    const e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a];
    const e2y = positions[c + 1] - positions[a + 1];
    const e2z = positions[c + 2] - positions[a + 2];
    // the cross product's length is twice the triangle area, so summing it weights by area
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const len = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
    normals[v] /= len;
    normals[v + 1] /= len;
    normals[v + 2] /= len;
  }
  return normals;
}

export function parseMesh(buf: ArrayBuffer): Mesh {
  const view = new DataView(buf);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'MSH1') throw new Error('not a mesh file');
  const vertexCount = view.getUint32(4, true);
  const triangleCount = view.getUint32(8, true);
  const f = (k: number) => view.getFloat32(12 + k * 4, true);
  const bboxMin: Vec3 = [f(0), f(1), f(2)];
  const bboxMax: Vec3 = [f(3), f(4), f(5)];

  const positions = new Float32Array(vertexCount * 3);
  let o = HEADER_BYTES;
  for (let v = 0; v < vertexCount; v++) {
    for (let k = 0; k < 3; k++, o += 2) {
      positions[v * 3 + k] = bboxMin[k] + (view.getUint16(o, true) / 65535) * (bboxMax[k] - bboxMin[k]);
    }
  }
  const indices = new Uint16Array(triangleCount * 3);
  for (let t = 0; t < indices.length; t++, o += 2) indices[t] = view.getUint16(o, true);

  return {
    vertexCount,
    triangleCount,
    bboxMin,
    bboxMax,
    positions,
    indices,
    normals: computeNormals(positions, indices),
  };
}

export async function loadMesh(id: Exclude<ModelId, 'balls'>): Promise<Mesh> {
  const res = await fetch(`${import.meta.env.BASE_URL}${MODEL_FILES[id]}`);
  if (!res.ok) throw new Error(`could not load ${id}: ${res.status}`);
  return parseMesh(await res.arrayBuffer());
}
