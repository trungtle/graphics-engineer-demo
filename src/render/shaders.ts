export const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Path tracer: Cornell box (open front), 3 uniform-driven spheres, ceiling area light.
// Materials: 0 diffuse, 1 mirror, 2 glass, 3 rough metal, 4 emissive.
export const TRACE_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform int u_frame;
uniform int u_bounces;
uniform vec4 u_objPos[3];   // xyz center, w radius
uniform vec4 u_objCol[3];   // rgb color
uniform int u_objMat[3];
uniform vec4 u_light;       // x, z center, w half-size (y fixed at ceiling)
uniform vec3 u_lightCol;    // emitted radiance
uniform vec3 u_camPos;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camFwd;
uniform int u_inside;       // 1: camera is inside the box (photon view), no front-plane entry
uniform float u_th;         // tan-ish half field of view
uniform float u_blend;      // >0: fixed accumulation weight (moving camera); 0: 1/(frame+1)
uniform int u_mode;         // 0: path tracer (global illumination), 1: deterministic 'feature' shading
uniform int u_model;        // feature mode lighting: 0 flat, 1 Lambert, 2 Phong
uniform int u_shadows;      // feature mode: hard shadows from a point light at the lamp
uniform int u_reflect;      // feature mode: one reflection bounce on shiny things
uniform int u_ao;           // feature mode: cheap ambient occlusion
uniform int u_aa;           // feature mode: 4 samples per pixel
// ---- optical bench (the Mirrors puzzle as a 3D tabletop) ----
uniform int u_bench;                // 1: draw the bench instead of the Cornell box
uniform int u_nPoly;
uniform vec4 u_plane[72];           // 6 planes per solid: normal.xyz, d (inside is dot(n, p) <= d)
uniform vec4 u_polyA[12];           // rgb albedo (or emission), w = material
uniform vec4 u_polyB[12];           // x = number of planes, y = kind (1 = hazard stripes)
uniform int u_nCyl;
uniform vec4 u_cylA[24];            // a.xyz, radius
uniform vec4 u_cylB[24];            // b.xyz, palette index
uniform vec3 u_pal[4];              // beam emission colors
uniform int u_nTgt;
uniform vec4 u_tgt[3];              // x, z, radius, lit
uniform vec3 u_tgtCol[3];
uniform float u_tgtH;
// ---- triangle mesh (bunny, dragon): replaces the three balls, uses object 0's color and material ----
uniform int u_mesh;
uniform highp sampler2D u_bvh;      // 2 texels per node: (min, a), (max, b); leaf: a = first tri, b = count; inner: a = right child
uniform highp sampler2D u_tri;      // 6 texels per triangle: v0, e1, e2, n0, n1, n2
out vec4 outColor;

uint rngState;
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd() { rngState = pcg(rngState); return float(rngState) * (1.0 / 4294967296.0); }

const float EMISSIVE_OBJ = 6.0;
const float METAL_ROUGH = 0.18;
const float GLASS_IOR = 1.5;

struct Hit { float t; vec3 n; vec3 albedo; vec3 emit; int mat; };

void sphere(vec3 ro, vec3 rd, int i, inout Hit h) {
  vec3 c = u_objPos[i].xyz;
  float r = u_objPos[i].w;
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float disc = b * b - (dot(oc, oc) - r * r);
  if (disc < 0.0) return;
  float sq = sqrt(disc);
  float t = -b - sq;
  if (t < 1e-3) t = -b + sq;
  if (t > 1e-3 && t < h.t) {
    h.t = t;
    h.n = normalize(ro + rd * t - c);
    h.albedo = u_objCol[i].rgb;
    int m = u_objMat[i];
    h.mat = m;
    h.emit = m == 4 ? u_objCol[i].rgb * EMISSIVE_OBJ : vec3(0.0);
  }
}

// ---- triangle mesh: BVH walk (same as intersectBvh in bvh.ts) ----
vec4 texAt(highp sampler2D s, int i) { return texelFetch(s, ivec2(i & 2047, i >> 11), 0); }

float boxT(vec3 ro, vec3 inv, int node) {
  vec3 a = (texAt(u_bvh, node * 2).xyz - ro) * inv;
  vec3 b = (texAt(u_bvh, node * 2 + 1).xyz - ro) * inv;
  vec3 lo = min(a, b);
  vec3 hi = max(a, b);
  float tn = max(max(lo.x, lo.y), lo.z);
  float tf = min(min(hi.x, hi.y), hi.z);
  return tf >= max(tn, 0.0) ? tn : 1e30;
}

void meshHit(vec3 ro, vec3 rd, inout Hit h) {
  vec3 inv = 1.0 / rd;
  float best = h.t;
  if (boxT(ro, inv, 0) >= best) return;
  int stack[32];
  int sp = 0;
  int node = 0;
  int bestTri = -1;
  float bu = 0.0, bv = 0.0;
  for (int iter = 0; iter < 2048; iter++) {
    vec4 A = texAt(u_bvh, node * 2);
    int cnt = int(texAt(u_bvh, node * 2 + 1).w + 0.5);
    if (cnt > 0) {
      int first = int(A.w + 0.5);
      for (int ti = first; ti < first + cnt; ti++) {
        int q = ti * 6;
        vec3 e1 = texAt(u_tri, q + 1).xyz;
        vec3 e2 = texAt(u_tri, q + 2).xyz;
        vec3 pv = cross(rd, e2);
        float det = dot(e1, pv);
        if (abs(det) < 1e-12) continue;
        float id = 1.0 / det;
        vec3 tv = ro - texAt(u_tri, q).xyz;
        float u = dot(tv, pv) * id;
        if (u < 0.0 || u > 1.0) continue;
        vec3 qv = cross(tv, e1);
        float v = dot(rd, qv) * id;
        if (v < 0.0 || u + v > 1.0) continue;
        float t = dot(e2, qv) * id;
        if (t > 1e-4 && t < best) { best = t; bestTri = ti; bu = u; bv = v; }
      }
      if (sp == 0) break;
      node = stack[--sp];
    } else {
      int l = node + 1;
      int r = int(A.w + 0.5);
      float tl = boxT(ro, inv, l);
      float tr = boxT(ro, inv, r);
      bool hl = tl < best;
      bool hr = tr < best;
      if (hl && hr) {
        if (tl <= tr) { node = l; stack[sp++] = r; } else { node = r; stack[sp++] = l; }
      } else if (hl) node = l;
      else if (hr) node = r;
      else { if (sp == 0) break; node = stack[--sp]; }
    }
  }
  if (bestTri < 0) return;
  int q = bestTri * 6;
  vec3 g = normalize(cross(texAt(u_tri, q + 1).xyz, texAt(u_tri, q + 2).xyz));
  vec3 n = (1.0 - bu - bv) * texAt(u_tri, q + 3).xyz + bu * texAt(u_tri, q + 4).xyz + bv * texAt(u_tri, q + 5).xyz;
  n = dot(n, n) > 1e-16 ? normalize(n) : g;
  // a smooth normal that disagrees with the real surface about which side the ray is on would leak light
  if (dot(n, rd) * dot(g, rd) <= 0.0) n = g;
  h.t = best;
  h.n = n;
  h.albedo = u_objCol[0].rgb;
  // characters carry their baked texture color in the w of each corner normal (packed sRGB, -1 = none)
  vec3 cw = vec3(texAt(u_tri, q + 3).w, texAt(u_tri, q + 4).w, texAt(u_tri, q + 5).w);
  if (cw.x >= 0.0) {
    vec3 bary = vec3(1.0 - bu - bv, bu, bv);
    vec3 col = vec3(0.0);
    for (int k = 0; k < 3; k++) {
      int p = int(cw[k] + 0.5);
      col += bary[k] * pow(vec3(float(p >> 16), float((p >> 8) & 255), float(p & 255)) / 255.0, vec3(2.2));
    }
    h.albedo = col;
  }
  int m = u_objMat[0];
  h.mat = m;
  h.emit = m == 4 ? h.albedo * EMISSIVE_OBJ : vec3(0.0);
}

// ---- optical bench ----
bool hitPoly(vec3 ro, vec3 rd, int pi, out float tHit, out vec3 nHit) {
  int n = int(u_polyB[pi].x + 0.5);
  float tIn = -1e20;
  float tOut = 1e20;
  vec3 nIn = vec3(0.0);
  vec3 nOut = vec3(0.0);
  for (int k = 0; k < 6; k++) {
    if (k >= n) break;
    vec4 pl = u_plane[pi * 6 + k];
    float denom = dot(pl.xyz, rd);
    float dist = pl.w - dot(pl.xyz, ro);
    if (abs(denom) < 1e-8) {
      if (dist < 0.0) return false;
      continue;
    }
    float t = dist / denom;
    if (denom < 0.0) {
      if (t > tIn) { tIn = t; nIn = pl.xyz; }
    } else {
      if (t < tOut) { tOut = t; nOut = pl.xyz; }
    }
  }
  if (tIn > tOut || tOut < 1e-4) return false;
  if (tIn > 1e-4) { tHit = tIn; nHit = nIn; } else { tHit = tOut; nHit = nOut; }
  return true;
}

bool hitBeam(vec3 ro, vec3 rd, vec3 a, vec3 b, float r, out float tHit, out vec3 nHit) {
  vec3 ba = b - a;
  vec3 oa = ro - a;
  float baba = dot(ba, ba);
  float bard = dot(ba, rd);
  float baoa = dot(ba, oa);
  float k2 = baba - bard * bard;
  if (abs(k2) < 1e-9) return false;
  float k1 = baba * dot(oa, rd) - baoa * bard;
  float k0 = baba * dot(oa, oa) - baoa * baoa - r * r * baba;
  float h = k1 * k1 - k2 * k0;
  if (h < 0.0) return false;
  h = sqrt(h);
  float t = (-k1 - h) / k2;
  float y = baoa + t * bard;
  if (t > 1e-4 && y > 0.0 && y < baba) {
    tHit = t;
    nHit = normalize(oa + t * rd - ba * y / baba);
    return true;
  }
  return false;
}

Hit benchScene(vec3 ro, vec3 rd) {
  Hit h;
  h.t = 1e20; h.n = vec3(0.0); h.albedo = vec3(0.0); h.emit = vec3(0.0); h.mat = 0;
  // the optical table: dark steel with a grid of holes
  if (rd.y < -1e-5) {
    float t = -ro.y / rd.y;
    if (t > 1e-4) {
      vec3 p = ro + rd * t;
      vec2 g = mod(p.xz, 0.25) - 0.125;
      float hole = 1.0 - smoothstep(0.036, 0.046, length(g));
      h.t = t; h.n = vec3(0.0, 1.0, 0.0); h.mat = 0; // matte steel: lit evenly, so the whole bench reads
      h.albedo = mix(vec3(0.20, 0.21, 0.24), vec3(0.01), hole);
    }
  }
  // mirrors, glass, walls, laser, light
  for (int i = 0; i < 12; i++) {
    if (i >= u_nPoly) break;
    float t; vec3 n;
    if (hitPoly(ro, rd, i, t, n) && t < h.t) {
      vec4 A = u_polyA[i];
      int mat = int(A.w + 0.5);
      h.t = t; h.n = n; h.mat = mat; h.albedo = A.rgb;
      h.emit = mat == 4 ? A.rgb : vec3(0.0);
      if (int(u_polyB[i].y + 0.5) == 1) {
        vec3 p = ro + rd * t;
        h.albedo = mod(floor((p.x + p.z + p.y) * 6.0), 2.0) < 1.0 ? vec3(0.9, 0.62, 0.05) : vec3(0.04);
      }
    }
  }
  // the beam
  for (int i = 0; i < 24; i++) {
    if (i >= u_nCyl) break;
    float t; vec3 n;
    if (hitBeam(ro, rd, u_cylA[i].xyz, u_cylB[i].xyz, u_cylA[i].w, t, n) && t < h.t) {
      h.t = t; h.n = n; h.mat = 4; h.albedo = vec3(0.0);
      h.emit = u_pal[int(u_cylB[i].w + 0.5)];
    }
  }
  // target pucks with a bullseye on top
  for (int i = 0; i < 3; i++) {
    if (i >= u_nTgt) break;
    vec2 c = u_tgt[i].xy;
    float R = u_tgt[i].z;
    bool lit = u_tgt[i].w > 0.5;
    // top face
    if (rd.y < 0.0) {
      float t = (u_tgtH - ro.y) / rd.y;
      if (t > 1e-4 && t < h.t) {
        vec3 p = ro + rd * t;
        float d = length(p.xz - c) / R;
        if (d <= 1.0) {
          float ring = mod(floor(d * 5.0), 2.0);
          vec3 col = ring < 0.5 ? vec3(0.95) : u_tgtCol[i];
          h.t = t; h.n = vec3(0.0, 1.0, 0.0);
          if (lit) { h.mat = 4; h.albedo = vec3(0.0); h.emit = (ring < 0.5 ? vec3(0.8, 1.0, 0.85) : vec3(0.25, 1.0, 0.42)) * 2.6; }
          else { h.mat = 0; h.albedo = col; h.emit = vec3(0.0); }
        }
      }
    }
    // side wall
    vec2 oc = ro.xz - c;
    float a2 = dot(rd.xz, rd.xz);
    if (a2 > 1e-9) {
      float b2 = dot(oc, rd.xz);
      float c2 = dot(oc, oc) - R * R;
      float disc = b2 * b2 - a2 * c2;
      if (disc >= 0.0) {
        float t = (-b2 - sqrt(disc)) / a2;
        if (t > 1e-4 && t < h.t) {
          vec3 p = ro + rd * t;
          if (p.y >= 0.0 && p.y <= u_tgtH) {
            h.t = t; h.n = normalize(vec3(p.x - c.x, 0.0, p.z - c.y));
            if (lit) { h.mat = 4; h.albedo = vec3(0.0); h.emit = vec3(0.25, 1.0, 0.42) * 1.2; }
            else { h.mat = 0; h.albedo = vec3(0.35); h.emit = vec3(0.0); }
          }
        }
      }
    }
  }
  return h;
}

vec3 benchEnv(vec3 d) {
  float k = 0.5 + 0.5 * d.y;
  return mix(vec3(0.012, 0.014, 0.026), vec3(0.075, 0.085, 0.12), k);
}

Hit scene(vec3 ro, vec3 rd) {
  if (u_bench == 1) return benchScene(ro, rd);
  Hit h; h.t = 1e20; h.n = vec3(0.0); h.albedo = vec3(0.0); h.emit = vec3(0.0); h.mat = 0;
  vec3 inv = 1.0 / rd;
  float tx = (rd.x < 0.0 ? -1.0 - ro.x : 1.0 - ro.x) * inv.x;
  float ty = (rd.y < 0.0 ? -1.0 - ro.y : 1.0 - ro.y) * inv.y;
  float tz = (rd.z < 0.0 ? -1.0 - ro.z : 1.0 - ro.z) * inv.z;
  float t = min(tx, min(ty, tz));
  bool exitFront = (t == tz) && rd.z > 0.0;
  if (!exitFront) {
    h.t = t;
    vec3 p = ro + rd * t;
    if (t == tx) {
      h.n = vec3(-sign(rd.x), 0.0, 0.0);
      h.albedo = rd.x < 0.0 ? vec3(0.75, 0.12, 0.10) : vec3(0.12, 0.62, 0.15);
    } else if (t == ty) {
      h.n = vec3(0.0, -sign(rd.y), 0.0);
      h.albedo = vec3(0.78);
      if (rd.y > 0.0 && abs(p.x - u_light.x) < u_light.w && abs(p.z - u_light.y) < u_light.w) {
        h.emit = u_lightCol; h.albedo = vec3(0.0);
      }
    } else {
      h.n = vec3(0.0, 0.0, 1.0);
      h.albedo = vec3(0.78);
    }
  }
  if (u_mesh == 1) meshHit(ro, rd, h);
  else for (int i = 0; i < 3; i++) sphere(ro, rd, i, h);
  return h;
}

vec3 cosineDir(vec3 n) {
  float u1 = rnd(), u2 = rnd();
  float r = sqrt(u1), phi = 6.2831853 * u2;
  vec3 a = abs(n.x) > 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(a, n));
  vec3 b = cross(n, t);
  return normalize(t * (r * cos(phi)) + b * (r * sin(phi)) + n * sqrt(1.0 - u1));
}

// ---- feature mode: how games shaded before (and beside) path tracing ----
float featureAO(vec3 p, vec3 n) {
  vec3 a = abs(n.x) > 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(a, n));
  vec3 b = cross(n, t);
  float occ = 0.0;
  for (int i = 0; i < 6; i++) {
    float ang = float(i) * 1.0471976;
    float el = (i % 2 == 0) ? 0.55 : 0.9;
    float side = 1.0 - el * 0.5;
    vec3 d = normalize(t * (cos(ang) * side) + b * (sin(ang) * side) + n * el);
    Hit h = scene(p + n * 1e-3, d);
    if (h.t < 0.35) occ += 1.0;
  }
  return 1.0 - 0.75 * occ / 6.0;
}

vec3 featureColor(vec3 ro, vec3 rd) {
  vec3 lampHue = u_lightCol / max(max(u_lightCol.r, u_lightCol.g), u_lightCol.b);
  vec3 lampPos = vec3(u_light.x, 0.985, u_light.y);
  vec3 result = vec3(0.0);
  vec3 weight = vec3(1.0);
  for (int bounce = 0; bounce < 2; bounce++) {
    Hit h = scene(ro, rd);
    if (h.t > 1e19) break;
    if (h.mat == 4 || dot(h.emit, h.emit) > 0.0) { result += weight * min(h.emit, vec3(8.0)) * 0.12; break; }
    vec3 p = ro + rd * h.t;
    vec3 n = h.n;
    if (dot(n, rd) > 0.0) n = -n;
    vec3 col;
    if (u_model == 0) {
      col = h.albedo;
    } else {
      vec3 Ld = lampPos - p;
      float dist = length(Ld);
      Ld /= dist;
      float ndl = max(dot(n, Ld), 0.0);
      float atten = 1.0 / (1.0 + 0.9 * dist * dist);
      float sh = 1.0;
      if (u_shadows == 1) {
        Hit s = scene(p + n * 1e-3, Ld);
        if (s.t < dist) sh = 0.0;
      }
      float ao = (u_ao == 1) ? featureAO(p, n) : 1.0;
      col = h.albedo * (vec3(0.18 * ao) + lampHue * (ndl * atten * 2.6 * sh));
      if (u_model == 2) {
        vec3 R = reflect(-Ld, n);
        float sp = pow(max(dot(R, -rd), 0.0), 40.0) * atten * 3.0 * sh;
        col += lampHue * sp * (h.mat == 0 ? 0.25 : 0.8);
      }
    }
    bool shiny = h.mat == 1 || h.mat == 2 || h.mat == 3;
    if (u_reflect == 1 && shiny && bounce == 0) {
      float k = h.mat == 1 ? 0.85 : (h.mat == 3 ? 0.55 : 0.6);
      result += weight * (1.0 - k) * col;
      weight *= k * ((h.mat == 1 || h.mat == 3) ? h.albedo : vec3(1.0));
      ro = p + n * 1e-3;
      rd = reflect(rd, n);
      continue;
    }
    result += weight * col;
    break;
  }
  return result;
}

vec3 featureRayColor(vec2 pix) {
  vec2 uv = pix / u_res * 2.0 - 1.0;
  float aspect = u_res.x / u_res.y;
  vec3 ro = u_camPos;
  vec3 rd = normalize(u_camFwd + u_camRight * (uv.x * u_th * max(aspect, 1.0)) + u_camUp * (uv.y * u_th / min(aspect, 1.0)));
  float t0 = (1.0 - ro.z) / rd.z;
  vec3 p0 = ro + rd * t0;
  bool enter = u_inside == 1 || (rd.z < -1e-3 && abs(p0.x) <= 1.0 && abs(p0.y) <= 1.0);
  if (!enter) return vec3(0.0);
  if (u_inside == 0) ro = p0;
  return featureColor(ro, rd);
}

vec3 featurePixel() {
  vec2 base = floor(gl_FragCoord.xy);
  if (u_aa == 0) return featureRayColor(base + vec2(0.5));
  return 0.25 * (featureRayColor(base + vec2(0.25, 0.25)) + featureRayColor(base + vec2(0.75, 0.25)) +
                 featureRayColor(base + vec2(0.25, 0.75)) + featureRayColor(base + vec2(0.75, 0.75)));
}

void main() {
  if (u_mode == 1) {
    outColor = vec4(featurePixel(), 1.0);
    return;
  }
  rngState = pcg(uint(gl_FragCoord.x) + pcg(uint(gl_FragCoord.y) + pcg(uint(u_frame) * 9781u + 1u)));
  vec2 uv = (gl_FragCoord.xy + vec2(rnd(), rnd())) / u_res * 2.0 - 1.0;
  float aspect = u_res.x / u_res.y;
  float th = u_th;
  vec3 ro = u_camPos;
  vec3 rd = normalize(u_camFwd + u_camRight * (uv.x * th * max(aspect, 1.0)) + u_camUp * (uv.y * th / min(aspect, 1.0)));

  float t0 = (1.0 - ro.z) / rd.z;
  vec3 p0 = ro + rd * t0;
  vec3 L = vec3(0.0);
  bool enter = u_inside == 1 || (rd.z < -1e-3 && abs(p0.x) <= 1.0 && abs(p0.y) <= 1.0);
  if (enter) {
    if (u_inside == 0) ro = p0;
    vec3 thr = vec3(1.0);
    for (int i = 0; i <= 8; i++) {
      if (i > u_bounces) break;
      Hit h = scene(ro, rd);
      if (h.t > 1e19) {
        if (u_bench == 1) L += thr * benchEnv(rd);
        break;
      }
      L += thr * h.emit;
      if (i == u_bounces || h.mat == 4) break;
      vec3 p = ro + rd * h.t;
      vec3 n = h.n;
      bool inside = dot(rd, n) > 0.0;
      if (inside) n = -n;  // n now faces against the ray
      if (h.mat == 0) {
        ro = p + n * 1e-3; rd = cosineDir(n); thr *= h.albedo;
      } else if (h.mat == 1) {
        ro = p + n * 1e-3; rd = reflect(rd, n); thr *= h.albedo;
      } else if (h.mat == 3) {
        vec3 r = normalize(reflect(rd, n) + METAL_ROUGH * cosineDir(n));
        if (dot(r, n) <= 0.0) r = reflect(rd, n);
        ro = p + n * 1e-3; rd = r; thr *= h.albedo;
      } else {
        float eta = inside ? GLASS_IOR : 1.0 / GLASS_IOR;
        float cosi = clamp(dot(-rd, n), 0.0, 1.0);
        float r0 = (1.0 - GLASS_IOR) / (1.0 + GLASS_IOR); r0 *= r0;
        float fres = r0 + (1.0 - r0) * pow(1.0 - cosi, 5.0);
        vec3 refr = refract(rd, n, eta);
        if (dot(refr, refr) == 0.0 || rnd() < fres) {
          ro = p + n * 1e-3; rd = reflect(rd, n);
        } else {
          ro = p - n * 1e-3; rd = refr; thr *= h.albedo;
        }
      }
    }
  }
  vec4 prev = texelFetch(u_prev, ivec2(gl_FragCoord.xy), 0);
  float w = u_blend > 0.0 ? u_blend : 1.0 / float(u_frame + 1);
  outColor = vec4(mix(prev.rgb, L, w), 1.0);
}`;

export const DISPLAY_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_dim;
uniform vec2 u_off;
out vec4 outColor;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec3 c = texture(u_tex, (gl_FragCoord.xy - u_off) / u_res).rgb * u_dim;
  outColor = vec4(pow(aces(c), vec3(1.0 / 2.2)), 1.0);
}`;
