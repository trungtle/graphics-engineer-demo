import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { intersectBvh, MAX_DEPTH, placeMesh, textureData, TEX_W, type Bvh } from './bvh';
import { MODEL_PLACEMENT, modelBvh, parseMesh, type Mesh } from './mesh';
import { mulberry32, type Vec3 } from './render/cpu';

const load = (name: string): Mesh => {
  const b = readFileSync(`public/models/${name}.bin`);
  return parseMesh(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

/** Brute force over every triangle of the placed mesh (Moller-Trumbore, same thresholds). */
function bruteForce(mesh: Mesh, positions: Float32Array, ro: Vec3, rd: Vec3): number {
  let best = Infinity;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const p = (i: number): Vec3 => {
      const k = mesh.indices[t * 3 + i] * 3;
      return [positions[k], positions[k + 1], positions[k + 2]];
    };
    const [a, b, c] = [p(0), p(1), p(2)];
    const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const pv: Vec3 = [rd[1] * e2[2] - rd[2] * e2[1], rd[2] * e2[0] - rd[0] * e2[2], rd[0] * e2[1] - rd[1] * e2[0]];
    const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
    if (Math.abs(det) < 1e-12) continue;
    const tv: Vec3 = [ro[0] - a[0], ro[1] - a[1], ro[2] - a[2]];
    const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det;
    if (u < 0 || u > 1) continue;
    const qv: Vec3 = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
    const v = (rd[0] * qv[0] + rd[1] * qv[1] + rd[2] * qv[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const tt = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
    if (tt > 1e-4 && tt < best) best = tt;
  }
  return best;
}

describe.each(['bunny', 'dragon'] as const)('%s BVH', (name) => {
  const mesh = load(name);
  const t0 = performance.now();
  const bvh: Bvh = modelBvh(mesh, name);
  const buildMs = performance.now() - t0;
  const placed = placeMesh(mesh, MODEL_PLACEMENT[name]);

  it('builds quickly and stays within the shader stack', () => {
    expect(buildMs).toBeLessThan(1500);
    expect(bvh.depth).toBeLessThanOrEqual(MAX_DEPTH);
    expect(bvh.nodeCount).toBeLessThan(mesh.triangleCount);
  });

  it('puts every triangle in exactly one leaf, and children inside their parent', () => {
    const seen = new Uint8Array(bvh.triangleCount);
    const walk = (n: number) => {
      const o = n * 8;
      const cnt = bvh.nodes[o + 7];
      if (cnt > 0) {
        for (let t = bvh.nodes[o + 3]; t < bvh.nodes[o + 3] + cnt; t++) seen[t]++;
        return;
      }
      for (const c of [n + 1, bvh.nodes[o + 3]]) {
        for (let k = 0; k < 3; k++) {
          expect(bvh.nodes[c * 8 + k]).toBeGreaterThanOrEqual(bvh.nodes[o + k] - 1e-6);
          expect(bvh.nodes[c * 8 + 4 + k]).toBeLessThanOrEqual(bvh.nodes[o + 4 + k] + 1e-6);
        }
        walk(c);
      }
    };
    walk(0);
    expect(Array.from(seen).every((s) => s === 1)).toBe(true);
  });

  it('stands on the floor inside the box', () => {
    expect(bvh.bboxMin[1]).toBeCloseTo(-1, 3);
    for (let k = 0; k < 3; k++) {
      if (k !== 1) expect(bvh.bboxMin[k]).toBeGreaterThan(-0.95);
      expect(bvh.bboxMax[k]).toBeLessThan(0.95);
    }
  });

  it('agrees with brute force on random rays', () => {
    const rnd = mulberry32(7);
    let hits = 0;
    for (let i = 0; i < 300; i++) {
      // rays from around the box aimed at points near the model
      const ro: Vec3 = [rnd() * 1.8 - 0.9, rnd() * 1.8 - 0.9, 0.95];
      const aim: Vec3 = [rnd() - 0.5, -1 + rnd() * 0.9, rnd() * 0.6 - 0.3];
      const d: Vec3 = [aim[0] - ro[0], aim[1] - ro[1], aim[2] - ro[2]];
      const l = Math.hypot(...d);
      const rd: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
      const want = bruteForce(mesh, placed.positions, ro, rd);
      const got = intersectBvh(bvh, ro, rd);
      if (want === Infinity) expect(got).toBeNull();
      else {
        hits++;
        expect(got!.t).toBeCloseTo(want, 4);
        expect(Math.hypot(...got!.n)).toBeCloseTo(1, 4);
      }
    }
    expect(hits).toBeGreaterThan(50);
  });

  it('respects the max distance (for shadow rays)', () => {
    const ro: Vec3 = [0, -0.6, 0.95];
    const rd: Vec3 = [0, 0, -1];
    const h = intersectBvh(bvh, ro, rd);
    expect(h).not.toBeNull();
    expect(intersectBvh(bvh, ro, rd, h!.t * 0.99)).toBeNull();
  });

  it('packs into whole texture rows', () => {
    const n = textureData(bvh.nodes);
    const t = textureData(bvh.tris);
    expect(n.width).toBe(TEX_W);
    expect(n.data.length).toBe(n.width * n.height * 4);
    expect(t.height).toBe(Math.ceil((bvh.triangleCount * 6) / TEX_W));
  });
});
