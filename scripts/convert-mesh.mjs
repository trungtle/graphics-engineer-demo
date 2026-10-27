// Converts a triangle mesh into the compact binary format used by the app (see src/mesh.ts).
// Inputs: ASCII PLY (e.g. the Stanford 3D Scanning Repository) or OBJ (e.g. Keenan Crane's characters).
//
//   node scripts/convert-mesh.mjs <input.ply|obj> <output.bin> [--uv]
//
// With --uv (OBJ with texture coordinates), the file is written as 'MSH3': after the indices come the texture
// coordinates of every triangle corner (u, v as 16-bit values over UV_MIN..UV_MAX, v flipped so 0 is the top row of
// the image). The texture image itself is copied next to the model as a PNG and sampled by the shader.
//
// The model is centered on x and z, its lowest point is put at y = 0, and it is scaled so its largest
// dimension is 1. Positions are stored as 16-bit values across the bounding box; indices as 16-bit.
//
// File layout (little endian):
//   'MSH1'            4 bytes
//   vertexCount       u32
//   triangleCount     u32
//   bbox min xyz, max xyz (after normalizing)   6 x f32
//   positions         vertexCount x 3 x u16 (0..65535 across the bbox)
//   indices           triangleCount x 3 x u16
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output, flag] = process.argv.slice(2);
const withUv = flag === '--uv';
const UV_MIN = -0.25;
const UV_MAX = 1.25;
if (!input || !output) {
  console.error('usage: node scripts/convert-mesh.mjs <input.ply|obj> <output.bin> [--uv]');
  process.exit(1);
}

const lines = readFileSync(input, 'utf8').split(/\r?\n/);
const isObj = input.toLowerCase().endsWith('.obj');
let uvs = null; // per triangle corner: u, v (v = 0 at the top of the image)
let pos, idx, vertexCount = 0, faceCount = 0;
if (isObj) {
  const P = [], T = [], F = [];
  for (const l of lines) {
    const p = l.trim().split(/\s+/);
    if (p[0] === 'v') P.push(+p[1], +p[2], +p[3]);
    else if (p[0] === 'vt') T.push(+p[1], +p[2]);
    else if (p[0] === 'f') {
      if (p.length !== 4) throw new Error('only triangle faces are supported');
      F.push(p.slice(1).map((c) => c.split('/').map((x) => (x ? Number(x) - 1 : -1))));
    }
  }
  vertexCount = P.length / 3;
  faceCount = F.length;
  if (vertexCount > 65535) throw new Error('more than 65535 vertices: indices would need 32 bits');
  pos = Float64Array.from(P);
  idx = new Uint16Array(faceCount * 3);
  F.forEach((f, t) => f.forEach((c, k) => (idx[t * 3 + k] = c[0])));
  if (withUv) {
    uvs = new Float64Array(faceCount * 6);
    F.forEach((f, t) =>
      f.forEach((corner, k) => {
        if (corner[1] < 0) throw new Error(`face ${t} has no texture coordinates`);
        uvs[t * 6 + k * 2] = T[corner[1] * 2];
        uvs[t * 6 + k * 2 + 1] = 1 - T[corner[1] * 2 + 1];
      }),
    );
  }
} else {
let i = 0;
let format = '';
for (; i < lines.length; i++) {
  const l = lines[i].trim();
  if (l.startsWith('format')) format = l.split(/\s+/)[1];
  if (l.startsWith('element vertex')) vertexCount = Number(l.split(/\s+/)[2]);
  if (l.startsWith('element face')) faceCount = Number(l.split(/\s+/)[2]);
  if (l === 'end_header') {
    i++;
    break;
  }
}
if (format !== 'ascii') throw new Error(`only ascii PLY is supported (got ${format})`);
if (vertexCount > 65535) throw new Error('more than 65535 vertices: indices would need 32 bits');

pos = new Float64Array(vertexCount * 3);
for (let v = 0; v < vertexCount; v++, i++) {
  const p = lines[i].trim().split(/\s+/).map(Number);
  pos[v * 3] = p[0];
  pos[v * 3 + 1] = p[1];
  pos[v * 3 + 2] = p[2];
}
idx = new Uint16Array(faceCount * 3);
for (let f = 0; f < faceCount; f++, i++) {
  const p = lines[i].trim().split(/\s+/).map(Number);
  if (p[0] !== 3) throw new Error(`face ${f} is not a triangle`);
  idx[f * 3] = p[1];
  idx[f * 3 + 1] = p[2];
  idx[f * 3 + 2] = p[3];
}
}

// normalize: center x and z, base at y = 0, largest dimension = 1
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let v = 0; v < vertexCount; v++) {
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], pos[v * 3 + k]);
    max[k] = Math.max(max[k], pos[v * 3 + k]);
  }
}
const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
const cx = (min[0] + max[0]) / 2;
const cz = (min[2] + max[2]) / 2;
for (let v = 0; v < vertexCount; v++) {
  pos[v * 3] = (pos[v * 3] - cx) / size;
  pos[v * 3 + 1] = (pos[v * 3 + 1] - min[1]) / size;
  pos[v * 3 + 2] = (pos[v * 3 + 2] - cz) / size;
}
const bmin = [(min[0] - cx) / size, 0, (min[2] - cz) / size];
const bmax = [(max[0] - cx) / size, (max[1] - min[1]) / size, (max[2] - cz) / size];

const HEADER = 4 + 4 + 4 + 24;
const out = Buffer.alloc(HEADER + vertexCount * 6 + faceCount * 6 + (uvs ? faceCount * 12 : 0));
out.write(uvs ? 'MSH3' : 'MSH1', 0, 'ascii');
out.writeUInt32LE(vertexCount, 4);
out.writeUInt32LE(faceCount, 8);
[...bmin, ...bmax].forEach((x, k) => out.writeFloatLE(x, 12 + k * 4));
let o = HEADER;
for (let v = 0; v < vertexCount; v++) {
  for (let k = 0; k < 3; k++) {
    const t = (pos[v * 3 + k] - bmin[k]) / (bmax[k] - bmin[k] || 1);
    out.writeUInt16LE(Math.round(Math.min(1, Math.max(0, t)) * 65535), o);
    o += 2;
  }
}
for (let t = 0; t < faceCount * 3; t++, o += 2) out.writeUInt16LE(idx[t], o);
if (uvs) {
  for (let k = 0; k < uvs.length; k++, o += 2) {
    const t = (uvs[k] - UV_MIN) / (UV_MAX - UV_MIN);
    if (t < 0 || t > 1) throw new Error(`texture coordinate ${uvs[k]} is outside ${UV_MIN}..${UV_MAX}`);
    out.writeUInt16LE(Math.round(t * 65535), o);
  }
}
writeFileSync(output, out);
console.log(`${input} -> ${output}: ${vertexCount} vertices, ${faceCount} triangles, ${out.length} bytes, bbox ${bmin.map((x) => x.toFixed(3))} .. ${bmax.map((x) => x.toFixed(3))}`);
