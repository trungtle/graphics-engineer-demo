import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { intersectBvh, MAX_DEPTH, placeMesh, sampleTexture, textureData, TEX_W, type Bvh } from './bvh';
import { MODEL_PLACEMENT, modelBvh, parseMesh, type Mesh } from './mesh';
import { mulberry32, type Vec3 } from './render/cpu';

/** Some ray straight down onto the model (Bob is a ring, so a ray through the middle can miss). */
function downHit(bvh: Bvh): { ro: Vec3; rd: Vec3 } {
  const rd: Vec3 = [0, -1, 0];
  for (let x = 0; x < 0.9; x += 0.05) {
    const ro: Vec3 = [x, 0.95, (bvh.bboxMin[2] + bvh.bboxMax[2]) / 2];
    if (intersectBvh(bvh, ro, rd)) return { ro, rd };
  }
  throw new Error('no ray hits the model');
}

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

describe.each(['bunny', 'dragon', 'spot', 'bob', 'blub'] as const)('%s BVH', (name) => {
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

  it('stands on the floor (or floats where it is placed) inside the box', () => {
    expect(bvh.bboxMin[1]).toBeCloseTo(MODEL_PLACEMENT[name].offset[1], 3);
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
    const { ro, rd } = downHit(bvh);
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

describe('character textures', () => {
  it.each(['spot', 'bob', 'blub'] as const)('%s has texture coordinates for every corner, a PNG next to it, and hits return them', (name) => {
    const mesh = load(name);
    expect(mesh.uvs).not.toBeNull();
    expect(mesh.uvs!.length).toBe(mesh.triangleCount * 6);
    const png = readFileSync(`public/models/${name}.png`);
    expect(png.toString('ascii', 1, 4)).toBe('PNG');
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(1024); // width: the full texture, not a thumbnail
    const bvh = modelBvh(mesh, name);
    const { ro, rd } = downHit(bvh);
    const h = intersectBvh(bvh, ro, rd)!;
    for (const c of h.uv) {
      expect(c).toBeGreaterThanOrEqual(-0.25);
      expect(c).toBeLessThanOrEqual(1.25);
    }
  });

  it('a hit at a triangle corner returns that corner texture coordinates', () => {
    const mesh = load('spot');
    const bvh = modelBvh(mesh, 'spot');
    // aim at a point just inside corner 0 of the first leaf triangle, from just in front of it
    const T = bvh.tris;
    const v0: Vec3 = [T[0], T[1], T[2]];
    const e1: Vec3 = [T[4], T[5], T[6]];
    const e2: Vec3 = [T[8], T[9], T[10]];
    const p: Vec3 = [0, 1, 2].map((k) => v0[k] + 0.01 * e1[k] + 0.01 * e2[k]) as Vec3;
    const n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n);
    const ro: Vec3 = [p[0] + (n[0] / l) * 1e-3, p[1] + (n[1] / l) * 1e-3, p[2] + (n[2] / l) * 1e-3];
    const h = intersectBvh(bvh, ro, [-n[0] / l, -n[1] / l, -n[2] / l])!;
    expect(h.tri).toBe(0);
    expect(h.uv[0]).toBeCloseTo(T[3], 2);
    expect(h.uv[1]).toBeCloseTo(T[7], 2);
  });

  it('texture lookup: bilinear, wraps around, and turns sRGB into linear', () => {
    // 2x1 image: black, white
    const img = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) };
    expect(sampleTexture(img, 0.25, 0.5)[0]).toBeCloseTo(0, 6);
    expect(sampleTexture(img, 0.75, 0.5)[0]).toBeCloseTo(1, 6);
    expect(sampleTexture(img, 0.5, 0.5)[0]).toBeCloseTo(0.5, 6);
    expect(sampleTexture(img, 1.75, 0.5)[0]).toBeCloseTo(1, 6);
    const mid = { width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 128, 255]) };
    expect(sampleTexture(mid, 0.5, 0.5)[0]).toBeCloseTo(Math.pow(128 / 255, 2.2), 6);
  });

  it('plain models have no texture coordinates', () => {
    expect(load('bunny').uvs).toBeNull();
  });
});
