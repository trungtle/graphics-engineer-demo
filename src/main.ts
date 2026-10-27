import './style.css';
import { VERT, TRACE_FRAG, DISPLAY_FRAG, DENOISE_FRAG } from './render/shaders';
import {
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  CAMERA_YAW_LIMIT,
  clampLight,
  defaultScene,
  lightRadiance,
  MATERIALS,
  WALLS,
  type MaterialId,
} from './scene';
import { cameraLookAlong, cameraOf, cameraRay, ceilingPoint, pick, project, type Camera } from './render/cpu';
import { initControls } from './ui/controls';
import { initEquation } from './ui/equation';
import { initPhoton } from './ui/photon';
import { initBench } from './ui/bench';
import { initFluid } from './ui/fluid';
import { initPick } from './ui/pick';
import { BENCH_TH, BEAM_PALETTE, CYL_MAX, POLY_MAX, TARGET_H, TARGET_MAX, benchCamera, type BenchScene } from './bench';
import { createStations } from './stations';
import { loadMesh, MODEL_TEXTURES, modelBvh, type MeshModelId, type ModelId } from './mesh';
import { textureData, type Bvh, type TextureImage } from './bvh';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const params = new URLSearchParams(location.search);
// The readout is a dev/device-test aid: show it with ?debug .
hud.hidden = !params.has('debug');
const glOrNull = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
if (!glOrNull) {
  hud.hidden = false;
  hud.textContent = 'WebGL2 not available';
  throw new Error('no webgl2');
}
const gl: WebGL2RenderingContext = glOrNull;

const extF32 = gl.getExtension('EXT_color_buffer_float');
const extF16 = gl.getExtension('EXT_color_buffer_half_float');
const extLin = gl.getExtension('OES_texture_float_linear');
const extTimer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';

// Prefer 32F; fall back to 16F (RND-001 finding decides the long-term choice).
const useF32 = !!extF32 && params.get('fmt') !== '16';
const internalFormat = useF32 ? gl.RGBA32F : gl.RGBA16F;
const texType = useF32 ? gl.FLOAT : gl.HALF_FLOAT;
const linearOk = useF32 ? !!extLin : true;
if (!extF32 && !extF16) {
  hud.hidden = false;
  hud.textContent = 'No float render targets';
}

function compile(type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}
function program(vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}
const traceProg = program(VERT, TRACE_FRAG);
const dispProg = program(VERT, DISPLAY_FRAG);
const denoiseProg = program(VERT, DENOISE_FRAG);
const loc = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);
const uTrace = {
  prev: loc(traceProg, 'u_prev'),
  prevG1: loc(traceProg, 'u_prevG1'),
  prevG2: loc(traceProg, 'u_prevG2'),
  res: loc(traceProg, 'u_res'),
  frame: loc(traceProg, 'u_frame'),
  bounces: loc(traceProg, 'u_bounces'),
  objPos: loc(traceProg, 'u_objPos'),
  objCol: loc(traceProg, 'u_objCol'),
  objMat: loc(traceProg, 'u_objMat'),
  nLights: loc(traceProg, 'u_nLights'),
  nee: loc(traceProg, 'u_nee'),
  wallMat: loc(traceProg, 'u_wallMat'),
  lights: loc(traceProg, 'u_lights'),
  lightCols: loc(traceProg, 'u_lightCols'),
  camPos: loc(traceProg, 'u_camPos'),
  camRight: loc(traceProg, 'u_camRight'),
  camUp: loc(traceProg, 'u_camUp'),
  camFwd: loc(traceProg, 'u_camFwd'),
  inside: loc(traceProg, 'u_inside'),
  th: loc(traceProg, 'u_th'),
  blend: loc(traceProg, 'u_blend'),
  bench: loc(traceProg, 'u_bench'),
  nPoly: loc(traceProg, 'u_nPoly'),
  plane: loc(traceProg, 'u_plane'),
  polyA: loc(traceProg, 'u_polyA'),
  polyB: loc(traceProg, 'u_polyB'),
  nCyl: loc(traceProg, 'u_nCyl'),
  cylA: loc(traceProg, 'u_cylA'),
  cylB: loc(traceProg, 'u_cylB'),
  pal: loc(traceProg, 'u_pal'),
  nTgt: loc(traceProg, 'u_nTgt'),
  tgt: loc(traceProg, 'u_tgt'),
  tgtCol: loc(traceProg, 'u_tgtCol'),
  tgtH: loc(traceProg, 'u_tgtH'),
  mesh: loc(traceProg, 'u_mesh'),
  bvh: loc(traceProg, 'u_bvh'),
  tri: loc(traceProg, 'u_tri'),
  meshTex: loc(traceProg, 'u_meshTex'),
  meshAlbedo: loc(traceProg, 'u_meshAlbedo'),
};
const uDen = {
  in: loc(denoiseProg, 'u_in'),
  color: loc(denoiseProg, 'u_color'),
  g1: loc(denoiseProg, 'u_g1'),
  g2: loc(denoiseProg, 'u_g2'),
  step: loc(denoiseProg, 'u_step'),
  first: loc(denoiseProg, 'u_first'),
  last: loc(denoiseProg, 'u_last'),
  spp: loc(denoiseProg, 'u_spp'),
  rawMix: loc(denoiseProg, 'u_rawMix'),
};
const uDisp = { tex: loc(dispProg, 'u_tex'), res: loc(dispProg, 'u_res'), dim: loc(dispProg, 'u_dim'), off: loc(dispProg, 'u_off') };
gl.bindVertexArray(gl.createVertexArray());

/** g1, g2: the denoiser's extra layers (normal + distance, albedo + second moment), only on the main view's targets */
type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer; g1?: WebGLTexture; g2?: WebGLTexture };
let targets: Target[] = [];
let denoiseTargets: Target[] = [];
// The denoiser: on by default; ?denoise=0 or the d key shows the raw samples instead.
let denoise = params.get('denoise') !== '0';
const DENOISE_STEPS = [1, 2, 4, 8];
/** samples per pixel over which the filtered picture hands over to the raw one */
const DENOISE_FADE = [8, 96];
let cur = 0;
let rw = 0;
let rh = 0;
let frame = 0;
// Render at normal screen resolution by default: on retina screens and iPads the device has 2-4x the pixels,
// which a path tracer cannot afford. The canvas itself stays full resolution so overlays are crisp.
let scale = Number(params.get('scale') ?? String(1 / Math.min(window.devicePixelRatio || 1, 2)));
const scene = defaultScene();
// Light sampling (next-event estimation + MIS): on by default; ?nee=0 or the n key turns it off to compare noise.
let nee = params.get('nee') !== '0';

// The Mirrors station draws a 3D tabletop instead of the Cornell box. `bench` is null everywhere else.
let bench: BenchScene | null = null;
let benchLiveUntil = 0; // while a piece is being dragged, blend frames instead of restarting so it does not flash noisy
let benchWasLive = false;
const benchData = {
  plane: new Float32Array(POLY_MAX * 6 * 4),
  polyA: new Float32Array(POLY_MAX * 4),
  polyB: new Float32Array(POLY_MAX * 4),
  cylA: new Float32Array(CYL_MAX * 4),
  cylB: new Float32Array(CYL_MAX * 4),
  pal: new Float32Array(4 * 3),
  tgt: new Float32Array(TARGET_MAX * 4),
  tgtCol: new Float32Array(TARGET_MAX * 3),
};

// Triangle models: one BVH per model, built on first use and kept; the GPU copy lives in two float textures.
const bvhCache = new Map<MeshModelId, Bvh>();
// Texture images of the textured models: a GL texture for the shader and the decoded pixels for the CPU picker.
const imageCache = new Map<MeshModelId, { gl: WebGLTexture; cpu: TextureImage }>();
const noTexture = (() => {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 200, 200, 255]));
  return t;
})();

async function loadImage(id: MeshModelId): Promise<{ gl: WebGLTexture; cpu: TextureImage } | null> {
  const file = MODEL_TEXTURES[id];
  if (!file) return null;
  const cached = imageCache.get(id);
  if (cached) return cached;
  const res = await fetch(`${import.meta.env.BASE_URL}${file}`);
  if (!res.ok) throw new Error(`could not load ${file}: ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  // the CPU copy (for taps and photon paths)
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const cpu: TextureImage = { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
  // the GPU copy: plain bytes (the shader turns sRGB into linear the same way the CPU does), repeating, smooth
  gl.activeTexture(gl.TEXTURE3);
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.activeTexture(gl.TEXTURE0);
  bitmap.close();
  const entry = { gl: tex, cpu };
  imageCache.set(id, entry);
  return entry;
}
let modelWanted: ModelId = 'balls';
function floatTexture(data: Float32Array | null): WebGLTexture {
  gl.activeTexture(gl.TEXTURE3); // a spare unit, so uploading never disturbs the bound accumulation texture
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const t = data ? textureData(data) : { data: new Float32Array(4), width: 1, height: 1 };
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, t.width, t.height, 0, gl.RGBA, gl.FLOAT, t.data);
  gl.activeTexture(gl.TEXTURE0);
  return tex;
}
const meshTex = { bvh: floatTexture(null), tri: floatTexture(null), of: null as Bvh | null };
function bindMesh() {
  const b = scene.mesh?.bvh ?? null;
  if (b && meshTex.of !== b) {
    gl.deleteTexture(meshTex.bvh);
    gl.deleteTexture(meshTex.tri);
    meshTex.bvh = floatTexture(b.nodes);
    meshTex.tri = floatTexture(b.tris);
    meshTex.of = b;
  }
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, meshTex.bvh);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, meshTex.tri);
  gl.uniform1i(uTrace.bvh, 1);
  gl.uniform1i(uTrace.tri, 2);
  const image = scene.mesh ? imageCache.get(scene.mesh.id) : undefined;
  gl.activeTexture(gl.TEXTURE6);
  gl.bindTexture(gl.TEXTURE_2D, image && scene.mesh?.texture ? image.gl : noTexture);
  gl.uniform1i(uTrace.meshAlbedo, 6);
  gl.uniform1i(uTrace.meshTex, image && scene.mesh?.texture ? 1 : 0);
  gl.uniform1i(uTrace.mesh, b && !bench ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0);
}

/** Show the balls, the bunny or the dragon. Models load (and their BVH is built) the first time they are picked. */
async function setModel(id: ModelId): Promise<void> {
  modelWanted = id;
  picker.select(null); // the selected surface is gone with the old model
  if (id === 'balls') {
    scene.mesh = null;
    ui.syncModel();
    reset();
    return;
  }
  let bvh = bvhCache.get(id);
  if (!bvh) {
    bvh = modelBvh(await loadMesh(id), id);
    bvhCache.set(id, bvh);
  }
  const image = await loadImage(id);
  if (modelWanted !== id) return; // another model was picked while this one loaded
  scene.mesh = { id, bvh, ...(image ? { texture: image.cpu } : {}) };
  ui.syncModel();
  reset();
}

// First-person "photon's view": a small second render of the box from the photon's position.
const FP_W = 160;
const FP_H = 120;
const FP_TH = 0.8; // wider field of view than the main camera
const FP_MIN_BLEND = 0.07; // moving camera: keep ~1.5 frames of history
const FP_PASSES = 10; // samples per frame for the small inset (cheap at 160x120)
let fpTargets: Target[] = [];
let fpCur = 0;
let fpFrames = 0;
let fpRng = 0;

function floatTex(w: number, h: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, texType, null);
  const f = linearOk ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function makeTarget(w: number, h: number, withLayers = false): Target {
  const tex = floatTex(w, h);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (!withLayers) return { tex, fbo };
  const g1 = floatTex(w, h);
  const g2 = floatTex(w, h);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, g1, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, g2, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
  return { tex, fbo, g1, g2 };
}

function freeTarget(t: Target) {
  for (const x of [t.tex, t.g1, t.g2]) if (x) gl.deleteTexture(x);
  gl.deleteFramebuffer(t.fbo);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.round(canvas.clientWidth * dpr);
  const ch = Math.round(canvas.clientHeight * dpr);
  const w = Math.max(16, Math.round(cw * scale));
  const h = Math.max(16, Math.round(ch * scale));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  if (w !== rw || h !== rh) {
    for (const t of [...targets, ...denoiseTargets]) freeTarget(t);
    rw = w;
    rh = h;
    targets = [makeTarget(w, h, true), makeTarget(w, h, true)];
    denoiseTargets = [makeTarget(w, h), makeTarget(w, h)];
    frame = 0;
  }
}

let pickedText = '';
// Photon mode dims the render (in the display shader, so it is free) so the photon's glow stands out.
const PHOTON_DIM = 0.15;
let dim = 1;

/** Average linear RGB of the accumulated image around a screen position in [-1,1] (y up); null if unreadable. */
function readPixel(nx: number, ny: number): [number, number, number] | null {
  if (frame < 1) return null; // nothing accumulated yet (just restarted)
  try {
    const t = targets[cur];
    const x = Math.round(((nx + 1) / 2) * (rw - 1));
    const y = Math.round(((ny + 1) / 2) * (rh - 1));
    const x0 = Math.max(0, x - 1);
    const y0 = Math.max(0, y - 1);
    const w = Math.min(3, rw - x0);
    const h = Math.min(3, rh - y0);
    const buf = new Float32Array(w * h * 4);
    gl.getError();
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (gl.getError() !== gl.NO_ERROR) return null;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < w * h; i++) {
      r += buf[i * 4];
      g += buf[i * 4 + 1];
      b += buf[i * 4 + 2];
    }
    return [r / (w * h), g / (w * h), b / (w * h)];
  } catch {
    return null;
  }
}

let photon: ReturnType<typeof initPhoton> | undefined;
const reset = () => {
  frame = 0;
  photon?.clear();
};
const eq = initEquation();
const ui = initControls({
  scene,
  reset,
  onTerm: (t) => eq.highlight(t),
  onModel: (id) => void setModel(id),
  render: {
    nee,
    denoise,
    onNee: (on) => {
      nee = on;
      reset();
    },
    onDenoise: (on) => {
      denoise = on;
    },
  },
});
photon = initPhoton({
  stage: document.getElementById('viewport')!,
  view: canvas,
  scene,
  toast: ui.toast,
  highlight: eq.highlight,
  readPixel,
  samplesSoFar: () => frame,
});

function cycleMaterial(i: number) {
  const o = scene.objects[i];
  o.mat = ((o.mat + 1) % MATERIALS.length) as MaterialId;
  eq.highlight(o.mat === 4 ? 'le' : 'fr');
  picker.refresh();
  reset();
}

// Tap a pixel: select the surface under it (material bar under the picture). Tap f_r: show its BRDF lobe there.
const picker = initPick({
  scene,
  viewport: document.getElementById('viewport')!,
  onMaterial: (m) => {
    eq.highlight(m === 4 ? 'le' : 'fr');
    reset();
  },
  readPixel,
});
eq.onTap((term) => {
  // a term switches on its picture at the selected pixel; tapping it again switches it off
  picker.term = picker.term === term ? null : term;
  eq.setSticky(picker.term);
  // nothing selected yet: pick the front of the first object so there is something to show
  if (picker.term && !picker.hit) {
    const cam = cameraOf(scene);
    const r = canvas.getBoundingClientRect();
    const aspect = r.width / r.height;
    const o = scene.objects[0];
    const target: [number, number, number] = scene.mesh
      ? [(scene.mesh.bvh.bboxMin[0] + scene.mesh.bvh.bboxMax[0]) / 2, (scene.mesh.bvh.bboxMin[1] + scene.mesh.bvh.bboxMax[1]) / 2, scene.mesh.bvh.bboxMax[2] * 0.5]
      : [o.pos[0], o.pos[1] + o.radius * 0.4, o.pos[2] + o.radius * 0.9];
    const [x, y] = project(target, aspect, cam);
    picker.select(cameraRay(x, y, aspect, cam));
  }
});

// Pointer gestures on the picture:
//  - press the lamp and drag: move it along the ceiling
//  - drag anywhere else: orbit the camera (limited arc)
//  - short tap: on an object cycles its material (or sends a photon in photon mode); on the lamp explains it
//  - double-tap on the background: reset the view
const TAP_MOVE_PX = 10;
const TAP_MS = 300;
const DOUBLE_TAP_MS = 350;
const ORBIT_YAW_PER_PX = 0.004;
const ORBIT_PITCH_PER_PX = 0.003;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Drag {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  mode: 'pending' | 'lamp' | 'orbit';
  yaw0: number;
  pitch0: number;
  lampDx: number;
  lampDz: number;
}
let drag: Drag | null = null;
let lastTap: { t: number; x: number; y: number } | null = null;

function ndcOf(e: PointerEvent): { nx: number; ny: number; aspect: number } {
  const r = canvas.getBoundingClientRect();
  return { nx: ((e.clientX - r.left) / r.width) * 2 - 1, ny: 1 - ((e.clientY - r.top) / r.height) * 2, aspect: r.width / r.height };
}

function resetView() {
  scene.camera.yaw = 0;
  scene.camera.pitch = 0;
  reset();
}

canvas.addEventListener('pointerdown', (e) => {
  const { nx, ny, aspect } = ndcOf(e);
  const h = pick(nx, ny, aspect, scene);
  const d: Drag = {
    id: e.pointerId,
    x0: e.clientX,
    y0: e.clientY,
    t0: performance.now(),
    mode: 'pending',
    yaw0: scene.camera.yaw,
    pitch0: scene.camera.pitch,
    lampDx: 0,
    lampDz: 0,
  };
  if (h?.surface === 'light') {
    // the touched lamp becomes the one the color swatches and size slider change
    scene.light = scene.lights[h.objectIndex] ?? scene.light;
    ui.syncLamp();
    const c = ceilingPoint(nx, ny, aspect, cameraOf(scene));
    if (c) {
      d.mode = 'lamp';
      d.lampDx = scene.light.x - c[0];
      d.lampDz = scene.light.z - c[1];
    }
  }
  drag = d;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic or unsupported pointer: fine */
  }
});

canvas.addEventListener('pointermove', (e) => {
  const d = drag;
  if (!d || e.pointerId !== d.id) return;
  const dx = e.clientX - d.x0;
  const dy = e.clientY - d.y0;
  if (d.mode === 'pending' && Math.hypot(dx, dy) > TAP_MOVE_PX) d.mode = 'orbit';
  if (d.mode === 'orbit') {
    scene.camera.yaw = clamp(d.yaw0 - dx * ORBIT_YAW_PER_PX, -CAMERA_YAW_LIMIT, CAMERA_YAW_LIMIT);
    scene.camera.pitch = clamp(d.pitch0 + dy * ORBIT_PITCH_PER_PX, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX);
    reset();
  } else if (d.mode === 'lamp' && Math.hypot(dx, dy) > 2) {
    const { nx, ny, aspect } = ndcOf(e);
    const c = ceilingPoint(nx, ny, aspect, cameraOf(scene));
    if (c) {
      scene.light.x = c[0] + d.lampDx;
      scene.light.z = c[1] + d.lampDz;
      clampLight(scene.light);
      reset();
      eq.highlight('le');
    }
  }
});

canvas.addEventListener('pointerup', (e) => {
  const d = drag;
  drag = null;
  if (!d || e.pointerId !== d.id) return;
  const moved = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
  const quick = performance.now() - d.t0 <= TAP_MS;
  if (moved > TAP_MOVE_PX || !quick) return;
  // a tap
  const { nx, ny, aspect } = ndcOf(e);
  const h = pick(nx, ny, aspect, scene);
  pickedText = h ? (h.surface === 'object' ? `object ${h.objectIndex}` : h.surface) : 'background';
  if (photon?.enabled) {
    photon.trace(nx, ny);
    return;
  }
  if (h) {
    picker.select(cameraRay(nx, ny, aspect, cameraOf(scene)));
    eq.highlight(h.surface === 'light' || h.emissive ? 'le' : 'fr');
    lastTap = null;
    return;
  }
  picker.select(null);
  const now = performance.now();
  if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    resetView();
    lastTap = null;
  } else {
    lastTap = { t: now, x: e.clientX, y: e.clientY };
  }
});
canvas.addEventListener('pointercancel', () => {
  drag = null;
});
window.addEventListener('keydown', (e) => {
  if (e.key >= '0' && e.key <= '8') {
    scene.bounces = Number(e.key);
    ui.syncBounces();
    reset();
  }
  if (e.key === 'd') {
    denoise = !denoise;
    ui.syncRender(nee, denoise);
  }
  if (e.key === 'n') {
    nee = !nee;
    ui.syncRender(nee, denoise);
    reset();
  }
  if (e.key === 's') {
    scale = scale === 1 ? 0.5 : 1;
    reset();
  }
  const oi = ['q', 'w', 'e'].indexOf(e.key);
  if (oi >= 0) cycleMaterial(oi);
});
const stations = createStations({
  viewport: document.getElementById('viewport')!,
  tabs: document.getElementById('tabs')!,
});

stations.register({
  id: 'light',
  label: 'Light Lab',
  icon: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  root: document.getElementById('st-light')!,
  viewportSlot: document.getElementById('slot-light')!,
  onEnter: () => {
    // another station may have changed the scene: bring the controls back in line
    reset();
    ui.syncBounces();
    ui.syncLamp();
    ui.syncModel();
  },
  onLeave: () => photon?.setEnabled(false),
});

const mirrors = initBench({ setBench });
stations.register({
  id: 'mirrors',
  label: 'Mirrors',
  icon: '<path d="M4 20L20 4"/><path d="M3 9h7M14 13l4 0"/>',
  root: document.getElementById('st-mirrors')!,
  viewportSlot: document.getElementById('slot-mirrors')!,
  onEnter: mirrors.onEnter,
  onLeave: mirrors.onLeave,
  onReset: mirrors.reset,
});

const water = initFluid();
stations.register({
  id: 'fluid',
  label: 'Water',
  icon: '<path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
  root: document.getElementById('st-fluid')!,
  onEnter: water.onEnter,
  onLeave: water.onLeave,
  onReset: water.reset,
});

// Hook for later UI work and manual testing from the console.
(window as unknown as Record<string, unknown>).lightlab = { scene, reset, pick, stations, setBench, bench: mirrors, setModel, water, picker,
  /** debug: the accumulated linear image (rgba floats, bottom row first) and how many samples it holds */
  capture: (filtered = false) => {
    const buf = new Float32Array(rw * rh * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, filtered ? denoiseTargets[(DENOISE_STEPS.length - 1) % 2].fbo : targets[cur].fbo);
    gl.readPixels(0, 0, rw, rh, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { w: rw, h: rh, spp: frame, data: buf };
  },
  samples: () => frame,
  setDenoise: (on: boolean) => {
    denoise = on;
    ui.syncRender(nee, denoise);
  },
  setNee: (on: boolean) => {
    nee = on;
    ui.syncRender(nee, denoise);
    reset();
  },
};

let raysTotal = 0; // every ray the main view has traced since the page loaded
let ema = 0;
let last = performance.now();
let gpuMs = NaN;
let query: WebGLQuery | null = null;
let queryOpen = false; // a query is begun on one frame and ended once; later frames just wait for its result

function setBench(b: BenchScene | null, live = false) {
  bench = b;
  if (live) benchLiveUntil = performance.now() + 450;
  else reset();
}

function uploadBench(b: BenchScene | null) {
  gl.uniform1i(uTrace.bench, b ? 1 : 0);
  if (!b) return;
  const d = benchData;
  b.polys.forEach((p, i) => {
    for (let k = 0; k < 6; k++) {
      const pl = p.planes[k] ?? [0, 0, 0, 0];
      d.plane.set(pl, (i * 6 + k) * 4);
    }
    d.polyA.set([p.color[0], p.color[1], p.color[2], p.mat], i * 4);
    d.polyB.set([p.planes.length, p.kind, 0, 0], i * 4);
  });
  b.cyls.forEach((c, i) => {
    d.cylA.set([c.a[0], c.a[1], c.a[2], c.radius], i * 4);
    d.cylB.set([c.b[0], c.b[1], c.b[2], c.color], i * 4);
  });
  BEAM_PALETTE.forEach((c, i) => d.pal.set(c, i * 3));
  b.targets.forEach((t, i) => {
    d.tgt.set([t.pos[0], t.pos[1], t.radius, t.lit ? 1 : 0], i * 4);
    d.tgtCol.set(t.color, i * 3);
  });
  gl.uniform1i(uTrace.nPoly, b.polys.length);
  gl.uniform4fv(uTrace.plane, d.plane);
  gl.uniform4fv(uTrace.polyA, d.polyA);
  gl.uniform4fv(uTrace.polyB, d.polyB);
  gl.uniform1i(uTrace.nCyl, b.cyls.length);
  gl.uniform4fv(uTrace.cylA, d.cylA);
  gl.uniform4fv(uTrace.cylB, d.cylB);
  gl.uniform3fv(uTrace.pal, d.pal);
  gl.uniform1i(uTrace.nTgt, b.targets.length);
  gl.uniform4fv(uTrace.tgt, d.tgt);
  gl.uniform3fv(uTrace.tgtCol, d.tgtCol);
  gl.uniform1f(uTrace.tgtH, TARGET_H);
}

function tracePass(
  src: Target,
  dst: Target,
  w: number,
  h: number,
  frameIdx: number,
  blend: number,
  cam: Camera,
  th: number,
  inside: boolean,
) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, w, h);
  gl.useProgram(traceProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src.tex);
  gl.uniform1i(uTrace.prev, 0);
  // the denoiser's layers (the photon inset has none: it reads its color again, and the extra outputs are dropped)
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, src.g1 ?? src.tex);
  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_2D, src.g2 ?? src.tex);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(uTrace.prevG1, 4);
  gl.uniform1i(uTrace.prevG2, 5);
  gl.uniform2f(uTrace.res, w, h);
  gl.uniform1i(uTrace.frame, frameIdx);
  gl.uniform1f(uTrace.blend, blend);
  gl.uniform1f(uTrace.th, th);
  gl.uniform1i(uTrace.inside, inside ? 1 : 0);
  uploadBench(bench);
  bindMesh();
  gl.uniform1i(uTrace.bounces, scene.bounces);
  gl.uniform4fv(uTrace.objPos, scene.objects.flatMap((o) => [...o.pos, o.radius]));
  gl.uniform4fv(uTrace.objCol, scene.objects.flatMap((o) => [...o.color, 1]));
  gl.uniform1iv(uTrace.objMat, scene.objects.map((o) => o.mat));
  const lamps = [0, 1, 2].map((i) => scene.lights[Math.min(i, scene.lights.length - 1)]);
  gl.uniform1i(uTrace.nLights, scene.lights.length);
  gl.uniform1i(uTrace.nee, nee ? 1 : 0);
  gl.uniform1iv(uTrace.wallMat, WALLS.map((w) => scene.walls[w]));
  gl.uniform4fv(uTrace.lights, lamps.flatMap((l) => [l.x, l.z, 0, l.half]));
  gl.uniform3fv(uTrace.lightCols, lamps.flatMap((l) => lightRadiance(l)));
  gl.uniform3fv(uTrace.camPos, cam.pos);
  gl.uniform3fv(uTrace.camRight, cam.right);
  gl.uniform3fv(uTrace.camUp, cam.up);
  gl.uniform3fv(uTrace.camFwd, cam.fwd);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Render and draw the photon's first-person inset into the #fp-frame rectangle (full brightness). */
function drawPhotonView(pose: { pos: [number, number, number]; fwd: [number, number, number] }, rect: DOMRect) {
  if (!fpTargets.length) fpTargets = [makeTarget(FP_W, FP_H), makeTarget(FP_W, FP_H)];
  const cam = cameraLookAlong(pose.pos, pose.fwd);
  for (let k = 0; k < FP_PASSES; k++) {
    fpRng++;
    const blend = Math.max(1 / (fpFrames + 1), FP_MIN_BLEND);
    fpFrames++;
    tracePass(fpTargets[fpCur], fpTargets[1 - fpCur], FP_W, FP_H, fpRng, blend, cam, FP_TH, true);
    fpCur = 1 - fpCur;
  }

  const cr = canvas.getBoundingClientRect();
  const sx = canvas.width / cr.width;
  const sy = canvas.height / cr.height;
  const x = Math.round((rect.left - cr.left) * sx);
  const y = Math.round((cr.bottom - rect.bottom) * sy);
  const w = Math.round(rect.width * sx);
  const h = Math.round(rect.height * sy);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(x, y, w, h);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x, y, w, h);
  gl.useProgram(dispProg);
  gl.bindTexture(gl.TEXTURE_2D, fpTargets[fpCur].tex);
  gl.uniform1i(uDisp.tex, 0);
  gl.uniform1f(uDisp.dim, 1);
  gl.uniform2f(uDisp.res, w, h);
  gl.uniform2f(uDisp.off, x, y);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disable(gl.SCISSOR_TEST);
}

/** Run the a-trous passes over the accumulated picture; returns the texture to show. */
function denoised(spp: number): WebGLTexture {
  const src = targets[cur];
  gl.useProgram(denoiseProg);
  gl.viewport(0, 0, rw, rh);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, src.tex);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, src.g1!);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, src.g2!);
  gl.uniform1i(uDen.color, 1);
  gl.uniform1i(uDen.g1, 2);
  gl.uniform1i(uDen.g2, 3);
  gl.uniform1i(uDen.in, 0);
  gl.uniform1f(uDen.spp, Math.max(1, spp));
  // a quick clean preview first; the filter's slight blur then fades out so the picture converges to the exact result
  const t = Math.min(1, Math.max(0, (spp - DENOISE_FADE[0]) / (DENOISE_FADE[1] - DENOISE_FADE[0])));
  gl.uniform1f(uDen.rawMix, t * t * (3 - 2 * t));
  let input = src.tex;
  DENOISE_STEPS.forEach((step, i) => {
    const out = denoiseTargets[i % 2];
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.uniform1i(uDen.step, step);
    gl.uniform1i(uDen.first, i === 0 ? 1 : 0);
    gl.uniform1i(uDen.last, i === DENOISE_STEPS.length - 1 ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    input = out.tex;
  });
  return input;
}

function tick(now: number) {
  // nothing to draw while the canvas is hidden (another station is showing)
  if (!canvas.isConnected || canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    last = now;
    requestAnimationFrame(tick);
    return;
  }
  resize();
  if (query && extTimer) {
    const ready = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
    const disjoint = gl.getParameter(extTimer.GPU_DISJOINT_EXT);
    if (ready && !disjoint) gpuMs = Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6;
    if (ready) {
      gl.deleteQuery(query);
      query = null;
    }
  }
  if (!query && extTimer) {
    query = gl.createQuery()!;
    gl.beginQuery(extTimer.TIME_ELAPSED_EXT, query);
    queryOpen = true;
  }

  // deterministic raster-era looks replace the picture every frame; the path tracer accumulates
  if (bench) {
    // the bench is a free-standing scene: its own camera, no front opening, always path traced
    const live = now < benchLiveUntil;
    if (benchWasLive && !live) reset();
    benchWasLive = live;
    tracePass(targets[cur], targets[1 - cur], rw, rh, frame, live ? 0.18 : 0, benchCamera(), BENCH_TH, true);
  } else {
    benchWasLive = false;
    tracePass(targets[cur], targets[1 - cur], rw, rh, frame, 0, cameraOf(scene), 0.45, false);
  }
  raysTotal += rw * rh * (scene.bounces + 1);
  if (queryOpen && extTimer) {
    gl.endQuery(extTimer.TIME_ELAPSED_EXT);
    queryOpen = false;
  }
  cur = 1 - cur;
  frame++;

  const shown = denoise ? denoised(bench && now < benchLiveUntil ? 8 : frame) : targets[cur].tex;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(dispProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, shown);
  gl.uniform1i(uDisp.tex, 0);
  dim += ((photon?.enabled ? PHOTON_DIM : 1) - dim) * 0.12;
  gl.uniform1f(uDisp.dim, dim);
  gl.uniform2f(uDisp.res, canvas.width, canvas.height);
  gl.uniform2f(uDisp.off, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  const pose = photon?.pose(now) ?? null;
  const fpRect = pose ? photon?.viewRect() : null;
  if (pose && fpRect && fpRect.width > 0) drawPhotonView(pose, fpRect);
  else fpFrames = 0;

  const dt = now - last;
  last = now;
  ema = ema ? ema * 0.95 + dt * 0.05 : dt;
  if (frame % 10 === 0) ui.setStats(frame, rw * rh * frame * (scene.bounces + 1));
  if (frame % 15 === 0 && !hud.hidden) {
    hud.textContent =
      `${renderer}\n` +
      `format ${useF32 ? 'RGBA32F' : 'RGBA16F'}  f32:${!!extF32} f16:${!!extF16} f32lin:${!!extLin} timer:${!!extTimer}\n` +
      `target ${rw}x${rh} (scale ${scale})  bounces ${scene.bounces}  light sampling ${nee ? 'on' : 'off'} (n)  denoiser ${denoise ? 'on' : 'off'} (d)\n` +
      `frame ${ema.toFixed(1)} ms (${(1000 / ema).toFixed(0)} fps)  gpu ${Number.isNaN(gpuMs) ? 'n/a' : gpuMs.toFixed(1) + ' ms'}  spp ${frame}  ~${((rw * rh * frame * (scene.bounces + 1)) / 1e9).toFixed(2)}B rays\n` +
      `tap: pick (${pickedText || 'none'})   s: scale 1/0.5   keys 0-8: bounces   q/w/e: cycle object material   ?fmt=16: half-float`;
  }
  if (!bench) picker.draw();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
