export const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Spike path tracer: Cornell box (open front), two spheres, ceiling area light, diffuse only.
export const TRACE_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform int u_frame;
uniform int u_bounces;
out vec4 outColor;

uint rngState;
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd() { rngState = pcg(rngState); return float(rngState) * (1.0 / 4294967296.0); }

const vec3 LIGHT_E = vec3(18.0, 16.0, 13.0);
const float LIGHT_HALF = 0.3;

struct Hit { float t; vec3 n; vec3 albedo; vec3 emit; };

void sphere(vec3 ro, vec3 rd, vec3 c, float r, vec3 alb, inout Hit h) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float disc = b * b - (dot(oc, oc) - r * r);
  if (disc < 0.0) return;
  float s = sqrt(disc);
  float t = -b - s;
  if (t < 1e-3) t = -b + s;
  if (t > 1e-3 && t < h.t) { h.t = t; h.n = normalize(ro + rd * t - c); h.albedo = alb; h.emit = vec3(0.0); }
}

Hit scene(vec3 ro, vec3 rd) {
  Hit h; h.t = 1e20; h.n = vec3(0.0); h.albedo = vec3(0.0); h.emit = vec3(0.0);
  // room [-1,1]^3, front (z=+1) open
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
      if (rd.y > 0.0 && abs(p.x) < LIGHT_HALF && abs(p.z) < LIGHT_HALF) { h.emit = LIGHT_E; h.albedo = vec3(0.0); }
    } else {
      h.n = vec3(0.0, 0.0, 1.0);
      h.albedo = vec3(0.78);
    }
  }
  sphere(ro, rd, vec3(-0.45, -0.62, -0.25), 0.38, vec3(0.8, 0.8, 0.8), h);
  sphere(ro, rd, vec3(0.5, -0.72, 0.3), 0.28, vec3(0.85, 0.7, 0.2), h);
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
  vec3 ro = vec3(0.0, 0.0, 3.4);
  vec3 rd = normalize(vec3(uv.x * th * max(aspect, 1.0), uv.y * th / min(aspect, 1.0), -1.0));

  // advance primary ray to the open front plane z=1
  float t0 = (1.0 - ro.z) / rd.z;
  vec3 p0 = ro + rd * t0;
  vec3 L = vec3(0.0);
  if (abs(p0.x) <= 1.0 && abs(p0.y) <= 1.0) {
    ro = p0;
    vec3 thr = vec3(1.0);
    for (int i = 0; i <= 8; i++) {
      if (i > u_bounces) break;
      Hit h = scene(ro, rd);
      if (h.t > 1e19) break;
      L += thr * h.emit;
      if (i == u_bounces) break;
      ro = ro + rd * h.t + h.n * 1e-3;
      rd = cosineDir(h.n);
      thr *= h.albedo;
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
