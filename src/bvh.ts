// Bounding volume hierarchy for a triangle mesh, built once on the CPU.
// The same flat arrays are uploaded to the GPU as float textures (walked in shaders.ts `meshHit`) and walked here
// by `intersectBvh` for tap-picking and photon paths, so both hit exactly the same triangles.
import type { Mesh } from './mesh';
import type { Vec3 } from './render/cpu';

/** Texture width for the GPU copies (texel i is at (i % TEX_W, i / TEX_W)). Must match the shader. */
export const TEX_W = 2048;
export const TEXELS_PER_TRI = 6;
export const TEXELS_PER_NODE = 2;
export const MAX_LEAF = 4;
/** The shader's traversal stack is 32 deep; keep the tree shallower than that. */
export const MAX_DEPTH = 30;
const BINS = 12;

export interface Bvh {
  triangleCount: number;
  nodeCount: number;
  /** per node, 8 floats: min.xyz, a, max.xyz, b. Leaf: a = first triangle, b = count (> 0). Inner: a = right child, b = 0; the left child is the next node. */
  nodes: Float32Array;
  /** per triangle (in leaf order), 24 floats: v0, e1 = v1 - v0, e2 = v2 - v0, n0, n1, n2 (each xyz + 1 padding) */
  tris: Float32Array;
  bboxMin: Vec3;
  bboxMax: Vec3;
  depth: number;
}

export interface Placement {
  /** uniform scale applied to the normalized model */
  scale: number;
  /** turn around the vertical axis, radians */
  yaw: number;
  /** where the model's base center ends up */
  offset: Vec3;
}

/** World-space vertex positions and normals of a placed mesh. */
export function placeMesh(mesh: Mesh, p: Placement): { positions: Float32Array; normals: Float32Array } {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    positions[i] = (x * c + z * s) * p.scale + p.offset[0];
    positions[i + 1] = y * p.scale + p.offset[1];
    positions[i + 2] = (-x * s + z * c) * p.scale + p.offset[2];
    const nx = mesh.normals[i];
    const nz = mesh.normals[i + 2];
    normals[i] = nx * c + nz * s;
    normals[i + 1] = mesh.normals[i + 1];
    normals[i + 2] = -nx * s + nz * c;
  }
  return { positions, normals };
}

interface BuildNode {
  min: Vec3;
  max: Vec3;
  left?: BuildNode;
  right?: BuildNode;
  first: number;
  count: number;
}

const area = (mn: Vec3, mx: Vec3) => {
  const dx = mx[0] - mn[0];
  const dy = mx[1] - mn[1];
  const dz = mx[2] - mn[2];
  return dx < 0 ? 0 : 2 * (dx * dy + dy * dz + dz * dx);
};

/** Binned-SAH BVH over the triangles. */
export function buildBvh(positions: Float32Array, normals: Float32Array, indices: Uint16Array | Uint32Array): Bvh {
  const triCount = indices.length / 3;
  const tmin = new Float32Array(triCount * 3);
  const tmax = new Float32Array(triCount * 3);
  const cen = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let v = 0; v < 3; v++) {
        const x = positions[indices[t * 3 + v] * 3 + k];
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      tmin[t * 3 + k] = lo;
      tmax[t * 3 + k] = hi;
      cen[t * 3 + k] = (lo + hi) / 2;
    }
  }
  const order = new Uint32Array(triCount);
  for (let i = 0; i < triCount; i++) order[i] = i;

  const bounds = (first: number, count: number): [Vec3, Vec3] => {
    const mn: Vec3 = [Infinity, Infinity, Infinity];
    const mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = first; i < first + count; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], tmin[t * 3 + k]);
        mx[k] = Math.max(mx[k], tmax[t * 3 + k]);
      }
    }
    return [mn, mx];
  };

  let nodeCount = 0;
  let depth = 0;
  const build = (first: number, count: number, d: number): BuildNode => {
    nodeCount++;
    depth = Math.max(depth, d);
    const [mn, mx] = bounds(first, count);
    const node: BuildNode = { min: mn, max: mx, first, count };
    if (count <= MAX_LEAF) return node;

    // centroid bounds
    const cmn: Vec3 = [Infinity, Infinity, Infinity];
    const cmx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = first; i < first + count; i++) {
      for (let k = 0; k < 3; k++) {
        cmn[k] = Math.min(cmn[k], cen[order[i] * 3 + k]);
        cmx[k] = Math.max(cmx[k], cen[order[i] * 3 + k]);
      }
    }
    let bestCost = Infinity;
    let bestAxis = -1;
    let bestSplit = 0;
    for (let axis = 0; axis < 3; axis++) {
      const ext = cmx[axis] - cmn[axis];
      if (ext <= 1e-12) continue;
      const bc = new Array(BINS).fill(0);
      const bmn: Vec3[] = Array.from({ length: BINS }, () => [Infinity, Infinity, Infinity] as Vec3);
      const bmx: Vec3[] = Array.from({ length: BINS }, () => [-Infinity, -Infinity, -Infinity] as Vec3);
      for (let i = first; i < first + count; i++) {
        const t = order[i];
        const b = Math.min(BINS - 1, Math.floor(((cen[t * 3 + axis] - cmn[axis]) / ext) * BINS));
        bc[b]++;
        for (let k = 0; k < 3; k++) {
          bmn[b][k] = Math.min(bmn[b][k], tmin[t * 3 + k]);
          bmx[b][k] = Math.max(bmx[b][k], tmax[t * 3 + k]);
        }
      }
      // sweep: cost of splitting after bin s
      const leftArea = new Array(BINS - 1).fill(0);
      const leftCount = new Array(BINS - 1).fill(0);
      let amn: Vec3 = [Infinity, Infinity, Infinity];
      let amx: Vec3 = [-Infinity, -Infinity, -Infinity];
      let n = 0;
      for (let s = 0; s < BINS - 1; s++) {
        n += bc[s];
        amn = [Math.min(amn[0], bmn[s][0]), Math.min(amn[1], bmn[s][1]), Math.min(amn[2], bmn[s][2])];
        amx = [Math.max(amx[0], bmx[s][0]), Math.max(amx[1], bmx[s][1]), Math.max(amx[2], bmx[s][2])];
        leftArea[s] = area(amn, amx);
        leftCount[s] = n;
      }
      amn = [Infinity, Infinity, Infinity];
      amx = [-Infinity, -Infinity, -Infinity];
      n = 0;
      for (let s = BINS - 1; s > 0; s--) {
        n += bc[s];
        amn = [Math.min(amn[0], bmn[s][0]), Math.min(amn[1], bmn[s][1]), Math.min(amn[2], bmn[s][2])];
        amx = [Math.max(amx[0], bmx[s][0]), Math.max(amx[1], bmx[s][1]), Math.max(amx[2], bmx[s][2])];
        const nl = leftCount[s - 1];
        if (nl === 0 || n === 0) continue;
        const cost = leftArea[s - 1] * nl + area(amn, amx) * n;
        if (cost < bestCost) {
          bestCost = cost;
          bestAxis = axis;
          bestSplit = s;
        }
      }
    }

    let mid: number;
    // near the depth limit, median splits keep the rest of the tree balanced (log2 of what is left)
    if (bestAxis >= 0 && d < MAX_DEPTH - 14) {
      const ext = cmx[bestAxis] - cmn[bestAxis];
      let i = first;
      let j = first + count - 1;
      while (i <= j) {
        const t = order[i];
        const b = Math.min(BINS - 1, Math.floor(((cen[t * 3 + bestAxis] - cmn[bestAxis]) / ext) * BINS));
        if (b < bestSplit) i++;
        else {
          order[i] = order[j];
          order[j] = t;
          j--;
        }
      }
      mid = i;
    } else if (bestAxis < 0 && count <= MAX_LEAF * 4) {
      return node; // all centroids coincide: a small leaf is the best we can do
    } else {
      // median split on the widest axis (degenerate cases and the depth limit)
      let axis = 0;
      for (let k = 1; k < 3; k++) if (cmx[k] - cmn[k] > cmx[axis] - cmn[axis]) axis = k;
      const sub = Array.from(order.subarray(first, first + count)).sort((a, b) => cen[a * 3 + axis] - cen[b * 3 + axis]);
      order.set(sub, first);
      mid = first + (count >> 1);
    }
    if (mid === first || mid === first + count) mid = first + (count >> 1);
    node.left = build(first, mid - first, d + 1);
    node.right = build(mid, first + count - mid, d + 1);
    node.count = 0;
    return node;
  };
  const root = build(0, triCount, 0);

  // flatten depth-first: left child right after its parent
  const nodes = new Float32Array(nodeCount * 8);
  let next = 0;
  const flatten = (n: BuildNode): number => {
    const me = next++;
    const o = me * 8;
    nodes.set(n.min, o);
    nodes.set(n.max, o + 4);
    if (n.left && n.right) {
      flatten(n.left);
      nodes[o + 3] = flatten(n.right);
      nodes[o + 7] = 0;
    } else {
      nodes[o + 3] = n.first;
      nodes[o + 7] = n.count;
    }
    return me;
  };
  flatten(root);

  const tris = new Float32Array(triCount * 24);
  for (let i = 0; i < triCount; i++) {
    const t = order[i];
    const ia = indices[t * 3] * 3;
    const ib = indices[t * 3 + 1] * 3;
    const ic = indices[t * 3 + 2] * 3;
    const o = i * 24;
    for (let k = 0; k < 3; k++) {
      tris[o + k] = positions[ia + k];
      tris[o + 4 + k] = positions[ib + k] - positions[ia + k];
      tris[o + 8 + k] = positions[ic + k] - positions[ia + k];
      tris[o + 12 + k] = normals[ia + k];
      tris[o + 16 + k] = normals[ib + k];
      tris[o + 20 + k] = normals[ic + k];
    }
  }
  return { triangleCount: triCount, nodeCount, nodes, tris, bboxMin: root.min, bboxMax: root.max, depth };
}

/** Pad a float array to whole rows of a TEX_W-wide RGBA texture. */
export function textureData(data: Float32Array): { data: Float32Array; width: number; height: number } {
  const texels = data.length / 4;
  const height = Math.max(1, Math.ceil(texels / TEX_W));
  const out = new Float32Array(TEX_W * height * 4);
  out.set(data);
  return { data: out, width: TEX_W, height };
}

function boxT(ro: Vec3, inv: Vec3, nodes: Float32Array, o: number): number {
  let tn = -Infinity;
  let tf = Infinity;
  for (let k = 0; k < 3; k++) {
    const a = (nodes[o + k] - ro[k]) * inv[k];
    const b = (nodes[o + 4 + k] - ro[k]) * inv[k];
    tn = Math.max(tn, Math.min(a, b));
    tf = Math.min(tf, Math.max(a, b));
  }
  return tf >= Math.max(tn, 0) ? tn : Infinity;
}

export interface MeshHit {
  t: number;
  /** shading normal (interpolated), on the same side of the surface as the geometric normal relative to the ray */
  n: Vec3;
  tri: number;
}

/** Closest hit closer than tMax, same traversal as the shader. */
export function intersectBvh(bvh: Bvh, ro: Vec3, rd: Vec3, tMax = Infinity): MeshHit | null {
  const { nodes, tris } = bvh;
  const inv: Vec3 = [1 / rd[0], 1 / rd[1], 1 / rd[2]];
  let best = tMax;
  let bestTri = -1;
  let bu = 0;
  let bv = 0;
  if (!(boxT(ro, inv, nodes, 0) < best)) return null;
  const stack: number[] = [];
  let node = 0;
  for (;;) {
    const o = node * 8;
    const cnt = nodes[o + 7];
    if (cnt > 0) {
      const first = nodes[o + 3];
      for (let ti = first; ti < first + cnt; ti++) {
        const q = ti * 24;
        const e1: Vec3 = [tris[q + 4], tris[q + 5], tris[q + 6]];
        const e2: Vec3 = [tris[q + 8], tris[q + 9], tris[q + 10]];
        const pv: Vec3 = [rd[1] * e2[2] - rd[2] * e2[1], rd[2] * e2[0] - rd[0] * e2[2], rd[0] * e2[1] - rd[1] * e2[0]];
        const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
        if (Math.abs(det) < 1e-12) continue;
        const id = 1 / det;
        const tv: Vec3 = [ro[0] - tris[q], ro[1] - tris[q + 1], ro[2] - tris[q + 2]];
        const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * id;
        if (u < 0 || u > 1) continue;
        const qv: Vec3 = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
        const v = (rd[0] * qv[0] + rd[1] * qv[1] + rd[2] * qv[2]) * id;
        if (v < 0 || u + v > 1) continue;
        const t = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * id;
        if (t > 1e-4 && t < best) {
          best = t;
          bestTri = ti;
          bu = u;
          bv = v;
        }
      }
      if (!stack.length) break;
      node = stack.pop()!;
    } else {
      const l = node + 1;
      const r = nodes[o + 3];
      const tl = boxT(ro, inv, nodes, l * 8);
      const tr = boxT(ro, inv, nodes, r * 8);
      const hl = tl < best;
      const hr = tr < best;
      if (hl && hr) {
        if (tl <= tr) {
          node = l;
          stack.push(r);
        } else {
          node = r;
          stack.push(l);
        }
      } else if (hl) node = l;
      else if (hr) node = r;
      else {
        if (!stack.length) break;
        node = stack.pop()!;
      }
    }
  }
  if (bestTri < 0) return null;
  return { t: best, n: shadingNormal(bvh, bestTri, bu, bv, rd), tri: bestTri };
}

function shadingNormal(bvh: Bvh, tri: number, u: number, v: number, rd: Vec3): Vec3 {
  const q = tri * 24;
  const T = bvh.tris;
  const w = 1 - u - v;
  let n: Vec3 = [0, 1, 2].map((k) => w * T[q + 12 + k] + u * T[q + 16 + k] + v * T[q + 20 + k]) as Vec3;
  const e1: Vec3 = [T[q + 4], T[q + 5], T[q + 6]];
  const e2: Vec3 = [T[q + 8], T[q + 9], T[q + 10]];
  let g: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const gl = Math.hypot(g[0], g[1], g[2]) || 1;
  g = [g[0] / gl, g[1] / gl, g[2] / gl];
  const nl = Math.hypot(n[0], n[1], n[2]);
  n = nl > 1e-8 ? [n[0] / nl, n[1] / nl, n[2] / nl] : g;
  // a smooth normal that disagrees with the real surface about which side the ray is on would leak light: use the flat one
  const dn = n[0] * rd[0] + n[1] * rd[1] + n[2] * rd[2];
  const dg = g[0] * rd[0] + g[1] * rd[1] + g[2] * rd[2];
  return dn * dg <= 0 ? g : n;
}
