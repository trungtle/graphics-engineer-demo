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

Hit scene(vec3 ro, vec3 rd) {
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
  for (int i = 0; i < 3; i++) sphere(ro, rd, i, h);
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
      if (h.t > 1e19) break;
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
