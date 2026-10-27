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
uniform int u_wallMat[5];    // left, right, floor, ceiling, back: 0 matte, 1 mirror, 3 metal, 4 glowing
uniform int u_nLights;
uniform int u_nee;          // 1: next-event estimation toward the ceiling lamps, combined with MIS      // ceiling lamps (1 to 3); later lamps win where they overlap
uniform vec4 u_lights[3];
uniform vec3 u_lightCols[3];
uniform vec3 u_camPos;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camFwd;
uniform int u_inside;       // 1: camera is inside the box (photon view), no front-plane entry
uniform float u_th;         // tan-ish half field of view
uniform float u_blend;      // >0: fixed accumulation weight (moving camera); 0: 1/(frame+1)
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
uniform highp sampler2D u_tri;      // 6 texels per triangle: v0, e1, e2, n0, n1, n2 (the w's: corner texture coordinates)
uniform int u_meshTex;              // 1: the model has a texture image
uniform sampler2D u_meshAlbedo;     // its texture image (sRGB bytes)
uniform sampler2D u_prevG1;
uniform sampler2D u_prevG2;
layout(location = 0) out vec4 outColor;
// for the denoiser, accumulated like the color: the first matte surface the pixel sees (through any mirror or glass)
layout(location = 1) out vec4 outG1;  // its normal (facing the camera), distance along the path
layout(location = 2) out vec4 outG2;  // its albedo (tinted by mirrors and glass on the way), second moment of the lighting

uint rngState;
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd() { rngState = pcg(rngState); return float(rngState) * (1.0 / 4294967296.0); }

const float EMISSIVE_OBJ = 6.0;
const float EMISSIVE_WALL = 1.5;
const float METAL_ROUGH = 0.18;
const float GLASS_IOR = 1.5;
const float PI = 3.14159265;

// lamp: which ceiling lamp was hit (-1: anything else); needed to weight lamp hits for MIS
struct Hit { float t; vec3 n; vec3 albedo; vec3 emit; int mat; int lamp; };

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
    h.lamp = -1;
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
  h.lamp = -1;
  h.n = n;
  h.albedo = u_objCol[0].rgb;
  // textured models (the characters): the corners' texture coordinates sit in the six spare w's
  if (u_meshTex == 1) {
    vec2 uv = (1.0 - bu - bv) * vec2(texAt(u_tri, q).w, texAt(u_tri, q + 1).w) +
              bu * vec2(texAt(u_tri, q + 2).w, texAt(u_tri, q + 3).w) +
              bv * vec2(texAt(u_tri, q + 4).w, texAt(u_tri, q + 5).w);
    h.albedo = pow(textureLod(u_meshAlbedo, uv, 0.0).rgb, vec3(2.2));
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
  h.t = 1e20; h.n = vec3(0.0); h.albedo = vec3(0.0); h.emit = vec3(0.0); h.mat = 0; h.lamp = -1;
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
  Hit h; h.t = 1e20; h.n = vec3(0.0); h.albedo = vec3(0.0); h.emit = vec3(0.0); h.mat = 0; h.lamp = -1;
  vec3 inv = 1.0 / rd;
  float tx = (rd.x < 0.0 ? -1.0 - ro.x : 1.0 - ro.x) * inv.x;
  float ty = (rd.y < 0.0 ? -1.0 - ro.y : 1.0 - ro.y) * inv.y;
  float tz = (rd.z < 0.0 ? -1.0 - ro.z : 1.0 - ro.z) * inv.z;
  float t = min(tx, min(ty, tz));
  bool exitFront = (t == tz) && rd.z > 0.0;
  if (!exitFront) {
    h.t = t;
    vec3 p = ro + rd * t;
    int wi;
    if (t == tx) {
      h.n = vec3(-sign(rd.x), 0.0, 0.0);
      h.albedo = rd.x < 0.0 ? vec3(0.75, 0.12, 0.10) : vec3(0.12, 0.62, 0.15);
      wi = rd.x < 0.0 ? 0 : 1;
    } else if (t == ty) {
      h.n = vec3(0.0, -sign(rd.y), 0.0);
      h.albedo = vec3(0.78);
      wi = rd.y < 0.0 ? 2 : 3;
      // written out instead of a loop: scene() is inlined into the bounce loop, and loops in here can make a
      // driver's shader compiler take so long that the browser's GPU process hangs
      if (rd.y > 0.0) {
        if (abs(p.x - u_lights[0].x) < u_lights[0].w && abs(p.z - u_lights[0].y) < u_lights[0].w) { h.emit = u_lightCols[0]; h.albedo = vec3(0.0); h.lamp = 0; }
        if (u_nLights > 1 && abs(p.x - u_lights[1].x) < u_lights[1].w && abs(p.z - u_lights[1].y) < u_lights[1].w) { h.emit = u_lightCols[1]; h.albedo = vec3(0.0); h.lamp = 1; }
        if (u_nLights > 2 && abs(p.x - u_lights[2].x) < u_lights[2].w && abs(p.z - u_lights[2].y) < u_lights[2].w) { h.emit = u_lightCols[2]; h.albedo = vec3(0.0); h.lamp = 2; }
      }
    } else {
      h.n = vec3(0.0, 0.0, 1.0);
      h.albedo = vec3(0.78);
      wi = 4;
    }
    // the walls can be made shiny or glowing too (the lamp patch stays a lamp)
    if (dot(h.emit, h.emit) == 0.0) {
      h.mat = u_wallMat[wi];
      if (h.mat == 4) h.emit = h.albedo * EMISSIVE_WALL;
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

void main() {
  rngState = pcg(uint(gl_FragCoord.x) + pcg(uint(gl_FragCoord.y) + pcg(uint(u_frame) * 9781u + 1u)));
  vec2 uv = (gl_FragCoord.xy + vec2(rnd(), rnd())) / u_res * 2.0 - 1.0;
  float aspect = u_res.x / u_res.y;
  float th = u_th;
  vec3 ro = u_camPos;
  vec3 rd = normalize(u_camFwd + u_camRight * (uv.x * th * max(aspect, 1.0)) + u_camUp * (uv.y * th / min(aspect, 1.0)));

  float t0 = (1.0 - ro.z) / rd.z;
  vec3 p0 = ro + rd * t0;
  vec3 L = vec3(0.0);
  bool gDone = false;
  vec3 gN = vec3(0.0);
  float gZ = 0.0;
  vec3 gA = vec3(1.0);
  vec3 gTint = vec3(1.0);
  float pathLen = 0.0;
  bool enter = u_inside == 1 || (rd.z < -1e-3 && abs(p0.x) <= 1.0 && abs(p0.y) <= 1.0);
  if (enter) {
    if (u_inside == 0) ro = p0;
    vec3 thr = vec3(1.0);
    bool nee = u_nee == 1 && u_bench == 0;
    int bounce = 0;
    // Next-event estimation: at each matte bounce a shadow ray goes to a random point on a random lamp. It is traced
    // through the same scene() call as the path (the loop alternates), because a second scene() call would be
    // inlined a second time and make the shader much slower to compile.
    bool shadowRay = false;
    vec3 shadowL = vec3(0.0);   // what the lamp sample adds if the shadow ray reaches it
    float shadowDist = 0.0;
    vec3 nextRo = vec3(0.0);    // where the path continues after the shadow ray
    vec3 nextRd = vec3(0.0);
    float prevPdf = 0.0;        // solid-angle pdf of the last matte bounce's direction (0: last bounce was not matte)
    for (int it = 0; it < 18; it++) {
      Hit h = scene(ro, rd);
      if (shadowRay) {
        if (h.lamp >= 0 && h.t > shadowDist - 2e-3) L += shadowL;
        shadowRay = false;
        ro = nextRo;
        rd = nextRd;
        continue;
      }
      if (h.t > 1e19) {
        if (u_bench == 1) L += thr * benchEnv(rd);
        if (!gDone) { gDone = true; gZ = 1e4; gA = gTint; gN = -rd; }
        break;
      }
      pathLen += h.t;
      if (!gDone) {
        bool glows = dot(h.emit, h.emit) > 0.0;
        if (glows || (h.mat != 1 && h.mat != 2)) {
          gDone = true;
          gN = dot(rd, h.n) > 0.0 ? -h.n : h.n;
          gZ = pathLen;
          gA = glows ? gTint : gTint * h.albedo;
        } else {
          gTint *= h.albedo;
        }
      }
      // a lamp found by a matte bounce could also have been sampled directly: weight the two (power heuristic)
      float wE = 1.0;
      if (nee && prevPdf > 0.0 && h.lamp >= 0) {
        vec4 Lh = u_lights[h.lamp];
        float pdfL = h.t * h.t / (max(rd.y, 1e-4) * 4.0 * Lh.w * Lh.w) / float(u_nLights);
        wE = prevPdf * prevPdf / (prevPdf * prevPdf + pdfL * pdfL);
      }
      L += thr * h.emit * wE;
      if (bounce == u_bounces || h.mat == 4) break;
      bounce++;
      vec3 p = ro + rd * h.t;
      vec3 n = h.n;
      bool inside = dot(rd, n) > 0.0;
      if (inside) n = -n;  // n now faces against the ray
      prevPdf = 0.0;
      if (h.mat == 0) {
        vec3 o = p + n * 1e-3;
        vec3 nd = cosineDir(n);
        if (nee) {
          int k = min(int(rnd() * float(u_nLights)), u_nLights - 1);
          vec4 Ls = u_lights[k];
          vec3 q = vec3(Ls.x + (2.0 * rnd() - 1.0) * Ls.w, 1.0, Ls.y + (2.0 * rnd() - 1.0) * Ls.w);
          vec3 wi = q - o;
          float d2 = dot(wi, wi);
          float d = sqrt(d2);
          wi /= d;
          float cosS = dot(n, wi);
          float cosL = wi.y;  // the lamp faces straight down
          if (cosS > 0.0 && cosL > 0.0) {
            float pdfL = d2 / (cosL * 4.0 * Ls.w * Ls.w) / float(u_nLights);
            float pdfB = cosS / PI;
            float w = pdfL * pdfL / (pdfL * pdfL + pdfB * pdfB);
            shadowL = thr * (h.albedo / PI) * u_lightCols[k] * cosS / pdfL * w;
            shadowDist = d;
            shadowRay = true;
            nextRo = o;
            nextRd = nd;
          }
          prevPdf = max(dot(n, nd), 1e-6) / PI;
          thr *= h.albedo;
          if (shadowRay) { ro = o; rd = wi; } else { ro = o; rd = nd; }
        } else {
          ro = o; rd = nd; thr *= h.albedo;
        }
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
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec4 prev = texelFetch(u_prev, px, 0);
  float w = u_blend > 0.0 ? u_blend : 1.0 / float(u_frame + 1);
  outColor = vec4(mix(prev.rgb, L, w), 1.0);
  float lum = dot(L / max(gA, vec3(0.02)), vec3(0.2126, 0.7152, 0.0722));
  outG1 = mix(texelFetch(u_prevG1, px, 0), vec4(gN, gZ), w);
  outG2 = mix(texelFetch(u_prevG2, px, 0), vec4(gA, min(lum * lum, 1e4)), w);
}`;

// Edge-aware a-trous filter (a simple SVGF without the temporal part). Four passes with growing gaps smooth the
// lighting (the color divided by the surface albedo, so textures and colors stay sharp) but stop at edges in normal,
// distance and brightness. The brightness tolerance comes from each pixel's own noise estimate, which shrinks as
// samples add up, so the filter fades out by itself and the picture still converges to the exact result.
export const DENOISE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_in;     // first pass: the accumulated color; later passes: the filtered lighting
uniform sampler2D u_color;  // the accumulated color
uniform sampler2D u_g1;     // normal, distance
uniform sampler2D u_g2;     // albedo, second moment of the lighting's luminance
uniform int u_step;          // gap between taps: 1, 2, 4, 8
uniform int u_first;         // 1: divide the input by the albedo
uniform int u_last;          // 1: multiply the result by the albedo
uniform float u_spp;
uniform float u_rawMix;      // last pass: how much of the unfiltered picture to show (rises to 1 as samples add up)
out vec4 outColor;

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 albedo(ivec2 q) { return max(texelFetch(u_g2, q, 0).rgb, vec3(0.02)); }
vec3 load(ivec2 q) {
  vec3 c = texelFetch(u_in, q, 0).rgb;
  return u_first == 1 ? c / albedo(q) : c;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(u_in, 0);
  vec4 g1 = texelFetch(u_g1, p, 0);
  vec3 n = g1.xyz / max(length(g1.xyz), 1e-4);
  vec3 c = load(p);
  float lc = lum(c);
  // Noise in the pixel's average, over its 3x3 neighborhood (so a pixel whose few samples all came out dark does not
  // count as noise-free): from each pixel's own samples once there are a few, from the spread between pixels before.
  float s1 = 0.0;
  float s2 = 0.0;
  float tv = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 q = clamp(p + ivec2(x, y), ivec2(0), size - 1);
      float l = lum(texelFetch(u_color, q, 0).rgb / albedo(q));
      s1 += l;
      s2 += l * l;
      tv += max(texelFetch(u_g2, q, 0).a - l * l, 0.0);
    }
  }
  s1 /= 9.0;
  float var = u_spp >= 4.0 ? tv / 9.0 / u_spp : max(s2 / 9.0 - s1 * s1, 0.0);
  float sigL = 2.0 * sqrt(var) + 1e-3;
  float sigZ = 0.03 * max(g1.w, 0.1) * float(u_step);

  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      ivec2 q = p + ivec2(x, y) * u_step;
      if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
      vec4 h1 = texelFetch(u_g1, q, 0);
      vec3 nq = h1.xyz / max(length(h1.xyz), 1e-4);
      vec3 cq = load(q);
      float k = (x == 0 ? 0.375 : (abs(x) == 1 ? 0.25 : 0.0625)) * (y == 0 ? 0.375 : (abs(y) == 1 ? 0.25 : 0.0625));
      float wn = pow(max(dot(n, nq), 0.0), 64.0);
      float wz = exp(-abs(g1.w - h1.w) / sigZ);
      float wl = exp(-abs(lum(cq) - lc) / sigL);
      float w = k * wn * wz * wl;
      sum += cq * w;
      wsum += w;
    }
  }
  vec3 outc = wsum > 1e-6 ? sum / wsum : c;
  if (u_last == 1) outc = mix(outc * albedo(p), texelFetch(u_color, p, 0).rgb, u_rawMix);
  outColor = vec4(outc, 1.0);
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
