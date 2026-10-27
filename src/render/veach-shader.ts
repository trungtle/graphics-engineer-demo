// Veach's MIS scene (see src/veach.ts): direct light only, one glossy bounce, so the three ways of estimating it
// can be compared side by side. A small separate program, compiled only when the MIS station is first opened.
export const VEACH_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform int u_frame;
uniform int u_mode;          // 0 BSDF sampling, 1 light sampling, 2 MIS, 3 all three stacked
uniform vec3 u_camPos;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camFwd;
uniform float u_th;          // half the view's width (at distance 1)
uniform vec4 u_lPos[4];      // lamp center, radius
uniform vec3 u_lRad[4];      // lamp radiance
uniform vec4 u_pC[4];        // plate center, half width
uniform vec4 u_pN[4];        // plate normal, half depth
uniform vec4 u_pU[4];        // plate width axis, Phong exponent
uniform vec4 u_pV[4];        // plate depth axis
// the accumulation targets also carry the denoiser's two layers; they get filler (the denoiser is off here)
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outG1;
layout(location = 2) out vec4 outG2;

const float PI = 3.14159265;

uint rngState;
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd() { rngState = pcg(rngState); return float(rngState) * (1.0 / 4294967296.0); }

float hitSphere(vec3 ro, vec3 rd, int i) {
  vec3 oc = ro - u_lPos[i].xyz;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - u_lPos[i].w * u_lPos[i].w;
  float h = b * b - c;
  if (h < 0.0) return -1.0;
  h = sqrt(h);
  float t = -b - h;
  if (t < 1e-4) t = -b + h;
  return t > 1e-4 ? t : -1.0;
}

float hitPlate(vec3 ro, vec3 rd, int i) {
  vec3 n = u_pN[i].xyz;
  float dn = dot(rd, n);
  if (abs(dn) < 1e-8) return -1.0;
  float t = dot(u_pC[i].xyz - ro, n) / dn;
  if (t < 1e-4) return -1.0;
  vec3 q = ro + rd * t - u_pC[i].xyz;
  if (abs(dot(q, u_pU[i].xyz)) > u_pC[i].w || abs(dot(q, u_pV[i].xyz)) > u_pN[i].w) return -1.0;
  return t;
}

// the closest lamp or plate along a ray (-1 when none)
void trace(vec3 ro, vec3 rd, out int lamp, out int plate) {
  float best = 1e20;
  lamp = -1;
  plate = -1;
  for (int i = 0; i < 4; i++) {
    float t = hitSphere(ro, rd, i);
    if (t > 0.0 && t < best) { best = t; lamp = i; plate = -1; }
  }
  for (int i = 0; i < 4; i++) {
    float t = hitPlate(ro, rd, i);
    if (t > 0.0 && t < best) { best = t; plate = i; lamp = -1; }
  }
}

// solid angle pdf of cone sampling lamp i from p, including picking it as 1 of 4 (1 - cos written to stay exact for tiny lamps)
float lampPdf(vec3 p, int i) {
  vec3 d = u_lPos[i].xyz - p;
  float sin2 = min(1.0, u_lPos[i].w * u_lPos[i].w / dot(d, d));
  float oneMinusCos = sin2 / (1.0 + sqrt(1.0 - sin2));
  return 1.0 / (4.0 * 2.0 * PI * oneMinusCos);
}

vec3 around(vec3 axis, float cosT, float phi) {
  vec3 a = abs(axis.x) > 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(a, axis));
  vec3 b = cross(axis, t);
  float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
  return normalize(t * (sinT * cos(phi)) + b * (sinT * sin(phi)) + axis * cosT);
}

float wPow(float a, float b) { return a * a / (a * a + b * b); }

void main() {
  rngState = pcg(uint(gl_FragCoord.x) + pcg(uint(gl_FragCoord.y) + pcg(uint(u_frame) * 7919u + 3u)));
  // compare: the whole scene three times, stacked: BSDF sampling on top, light sampling in the middle, MIS below
  int mode = u_mode;
  vec2 frag = gl_FragCoord.xy;
  vec2 res = u_res;
  if (u_mode == 3) {
    float rowH = u_res.y / 3.0;
    int row = min(int(frag.y / rowH), 2);
    mode = 2 - row;
    frag.y -= float(row) * rowH;
    res.y = rowH;
  }
  // the width is fixed (the scene is wide); the height follows the picture's shape
  vec2 uv = (frag + vec2(rnd(), rnd())) / res * 2.0 - 1.0;
  float aspect = res.x / res.y;
  vec3 rd = normalize(u_camFwd + u_camRight * (uv.x * u_th) + u_camUp * (uv.y * u_th / aspect));
  vec3 ro = u_camPos;

  vec3 L = vec3(0.004, 0.0045, 0.006);
  int lamp;
  int plate;
  trace(ro, rd, lamp, plate);
  if (lamp >= 0) {
    L = u_lRad[lamp];
  } else if (plate >= 0) {
    float tP = hitPlate(ro, rd, plate);
    vec3 p = ro + rd * tP;
    vec3 n = u_pN[plate].xyz;
    if (dot(n, rd) > 0.0) n = -n;
    vec3 R = reflect(rd, n);
    float e = u_pU[plate].w;
    vec3 o = p + n * 1e-3;
    L = vec3(0.0);
    // BSDF sampling: a direction from the plate's Phong lobe; counts only if it happens to hit a lamp
    if (mode == 0 || mode == 2) {
      float cosA = pow(rnd(), 1.0 / (e + 1.0));
      vec3 wi = around(R, cosA, 2.0 * PI * rnd());
      float cosN = dot(wi, n);
      if (cosN > 0.0) {
        int hl;
        int hp;
        trace(o, wi, hl, hp);
        if (hl >= 0) {
          float pdfB = (e + 1.0) / (2.0 * PI) * pow(cosA, e);
          float f = (e + 2.0) / (2.0 * PI) * pow(cosA, e);
          float w = mode == 2 ? wPow(pdfB, lampPdf(p, hl)) : 1.0;
          L += u_lRad[hl] * (f * cosN / pdfB * w);
        }
      }
    }
    // light sampling: a direction toward a random lamp; counts by how much the plate reflects it toward the eye
    if (mode == 1 || mode == 2) {
      int j = min(int(rnd() * 4.0), 3);
      vec3 toC = u_lPos[j].xyz - p;
      float d2 = dot(toC, toC);
      float sin2 = min(1.0, u_lPos[j].w * u_lPos[j].w / d2);
      float oneMinusCosMax = sin2 / (1.0 + sqrt(1.0 - sin2));
      float cosT = 1.0 - rnd() * oneMinusCosMax;
      vec3 wi = around(toC / sqrt(d2), cosT, 2.0 * PI * rnd());
      float cosN = dot(wi, n);
      float cosA = dot(wi, R);
      if (cosN > 0.0 && cosA > 0.0) {
        int hl;
        int hp;
        trace(o, wi, hl, hp);
        if (hl == j) {
          float pdfL = 1.0 / (4.0 * 2.0 * PI * oneMinusCosMax);
          float pdfB = (e + 1.0) / (2.0 * PI) * pow(cosA, e);
          float f = (e + 2.0) / (2.0 * PI) * pow(cosA, e);
          float w = mode == 2 ? wPow(pdfL, pdfB) : 1.0;
          L += u_lRad[j] * (f * cosN / pdfL * w);
        }
      }
    }
  }
  // thin dividers between the three rows
  if (u_mode == 3) {
    float py = gl_FragCoord.y;
    if (abs(py - u_res.y / 3.0) < 1.0 || abs(py - 2.0 * u_res.y / 3.0) < 1.0) L = vec3(0.6);
  }
  vec4 prev = texelFetch(u_prev, ivec2(gl_FragCoord.xy), 0);
  outColor = vec4(mix(prev.rgb, L, 1.0 / float(u_frame + 1)), 1.0);
  outG1 = vec4(0.0, 0.0, 1.0, 1.0);
  outG2 = vec4(1.0, 1.0, 1.0, 0.0);
}`;
