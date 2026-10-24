// Converts a triangle mesh into the compact binary format used by the app (see src/mesh.ts).
// Inputs: ASCII PLY (e.g. the Stanford 3D Scanning Repository) or OBJ (e.g. Keenan Crane's characters).
//
//   node scripts/convert-mesh.mjs <input.ply|obj> <output.bin> [texture.png]
//
// With a texture (8-bit RGB PNG, OBJ only), each vertex gets the average texture color over its corners and the
// file is written as 'MSH2' with 3 sRGB bytes per vertex after the indices.
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
import { inflateSync } from 'node:zlib';

const [input, output, texturePath] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/convert-mesh.mjs <input.ply|obj> <output.bin> [texture.png]');
  process.exit(1);
}

/** Minimal PNG reader: 8-bit RGB or RGBA, not interlaced. Returns rgb bytes, row 0 at the top. */
function readPng(path) {
  const b = readFileSync(path);
  let o = 8;
  let w = 0, h = 0, ct = 0;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString('ascii', o + 4, o + 8);
    const data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ct = data[9];
      if (data[8] !== 8 || (ct !== 2 && ct !== 6) || data[12] !== 0) throw new Error('only 8-bit RGB/RGBA non-interlaced PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = px[i * bpp + k];
  return { w, h, rgb };
}

const lines = readFileSync(input, 'utf8').split(/\r?\n/);
const isObj = input.toLowerCase().endsWith('.obj');
let colors = null; // per-vertex sRGB bytes
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
  if (texturePath) {
    const tex = readPng(texturePath);
    const sum = new Float64Array(vertexCount * 3);
    const cnt = new Float64Array(vertexCount);
    // bilinear sample in linear light, averaged over every corner that uses the vertex
    const lin = (b) => (b / 255) ** 2.2;
    const texel = (x, y, k) => lin(tex.rgb[(Math.min(tex.h - 1, Math.max(0, y)) * tex.w + Math.min(tex.w - 1, Math.max(0, x))) * 3 + k]);
    for (const f of F) {
      for (const c of f) {
        if (c[1] < 0) continue;
        const u = T[c[1] * 2] * tex.w - 0.5;
        const v = (1 - T[c[1] * 2 + 1]) * tex.h - 0.5;
        const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
        for (let k = 0; k < 3; k++) {
          sum[c[0] * 3 + k] +=
            (texel(x0, y0, k) * (1 - fx) + texel(x0 + 1, y0, k) * fx) * (1 - fy) +
            (texel(x0, y0 + 1, k) * (1 - fx) + texel(x0 + 1, y0 + 1, k) * fx) * fy;
        }
        cnt[c[0]]++;
      }
    }
    colors = Buffer.alloc(vertexCount * 3);
    for (let v = 0; v < vertexCount; v++)
      for (let k = 0; k < 3; k++) colors[v * 3 + k] = Math.round(((cnt[v] ? sum[v * 3 + k] / cnt[v] : 0.8) ** (1 / 2.2)) * 255);
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
const out = Buffer.alloc(HEADER + vertexCount * 6 + faceCount * 6 + (colors ? vertexCount * 3 : 0));
out.write(colors ? 'MSH2' : 'MSH1', 0, 'ascii');
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
if (colors) colors.copy(out, o);
writeFileSync(output, out);
console.log(`${input} -> ${output}: ${vertexCount} vertices, ${faceCount} triangles, ${out.length} bytes, bbox ${bmin.map((x) => x.toFixed(3))} .. ${bmax.map((x) => x.toFixed(3))}`);
