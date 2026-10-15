import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeNormals, parseMesh, type Mesh } from './mesh';

const load = (name: string): Mesh => {
  const b = readFileSync(`public/models/${name}.bin`);
  return parseMesh(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe.each([
  ['bunny', 8171, 16301],
  ['dragon', 5205, 11102],
] as const)('%s model file', (name, vertices, triangles) => {
  const m = load(name);

  it('has the expected size', () => {
    expect(m.vertexCount).toBe(vertices);
    expect(m.triangleCount).toBe(triangles);
    expect(m.positions.length).toBe(vertices * 3);
    expect(m.indices.length).toBe(triangles * 3);
  });

  it('is normalized: largest dimension 1, centered on x and z, standing on y = 0', () => {
    const size = [0, 1, 2].map((k) => m.bboxMax[k] - m.bboxMin[k]);
    expect(Math.max(...size)).toBeCloseTo(1, 4);
    expect(m.bboxMin[1]).toBeCloseTo(0, 6);
    expect((m.bboxMin[0] + m.bboxMax[0]) / 2).toBeCloseTo(0, 3);
    expect((m.bboxMin[2] + m.bboxMax[2]) / 2).toBeCloseTo(0, 3);
  });

  it('keeps every vertex inside its bounding box and every index valid', () => {
    for (let v = 0; v < m.vertexCount; v++) {
      for (let k = 0; k < 3; k++) {
        expect(m.positions[v * 3 + k]).toBeGreaterThanOrEqual(m.bboxMin[k] - 1e-6);
        expect(m.positions[v * 3 + k]).toBeLessThanOrEqual(m.bboxMax[k] + 1e-6);
      }
    }
    for (const i of m.indices) expect(i).toBeLessThan(m.vertexCount);
  });

  it('has unit-length smooth normals on every vertex a triangle uses', () => {
    const used = new Set<number>(m.indices);
    for (const v of used) {
      expect(Math.hypot(m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2])).toBeCloseTo(1, 4);
    }
    // a few scan points are not part of any triangle (known quirk of the bunny data); they are harmless
    expect(m.vertexCount - used.size).toBeLessThan(m.vertexCount * 0.01);
  });

  it('has almost no degenerate triangles', () => {
    let bad = 0;
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
      if (a === b || b === c || a === c) bad++;
    }
    expect(bad).toBeLessThan(m.triangleCount * 0.001);
  });
});

describe('computeNormals', () => {
  it('a flat triangle in the xz plane gets normals pointing along +y or -y consistently', () => {
    const n = computeNormals(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), new Uint16Array([0, 1, 2]));
    expect(Math.abs(n[1])).toBeCloseTo(1, 6);
    expect(n[4]).toBeCloseTo(n[1], 6);
    expect(n[7]).toBeCloseTo(n[1], 6);
  });
});
