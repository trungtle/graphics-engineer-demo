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

void main() {
  rngState = pcg(uint(gl_FragCoord.x) + pcg(uint(gl_FragCoord.y) + pcg(uint(u_frame) * 9781u + 1u)));
  vec2 uv = (gl_FragCoord.xy + vec2(rnd(), rnd())) / u_res * 2.0 - 1.0;
  float aspect = u_res.x / u_res.y;
  float th = 0.45;
  vec3 ro = u_camPos;
  vec3 rd = normalize(u_camFwd + u_camRight * (uv.x * th * max(aspect, 1.0)) + u_camUp * (uv.y * th / min(aspect, 1.0)));

  float t0 = (1.0 - ro.z) / rd.z;
  vec3 p0 = ro + rd * t0;
  vec3 L = vec3(0.0);
  if (rd.z < -1e-3 && abs(p0.x) <= 1.0 && abs(p0.y) <= 1.0) {
    ro = p0;
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
  float w = 1.0 / float(u_frame + 1);
  outColor = vec4(mix(prev.rgb, L, w), 1.0);
}`;

export const DISPLAY_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_res;
out vec4 outColor;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec3 c = texture(u_tex, gl_FragCoord.xy / u_res).rgb;
  outColor = vec4(pow(aces(c), vec3(1.0 / 2.2)), 1.0);
}`;
