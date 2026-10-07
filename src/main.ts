import './style.css';
import { VERT, TRACE_FRAG, DISPLAY_FRAG } from './render/shaders';
import {
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  CAMERA_YAW_LIMIT,
  clampLight,
  defaultScene,
  lightRadiance,
  MATERIALS,
  type MaterialId,
} from './scene';
import { cameraLookAlong, cameraOf, ceilingPoint, pick, type Camera } from './render/cpu';
import { initControls } from './ui/controls';
import { initEquation } from './ui/equation';
import { initPhoton } from './ui/photon';
import { initIdle } from './idle';

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
const loc = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);
const uTrace = {
  prev: loc(traceProg, 'u_prev'),
  res: loc(traceProg, 'u_res'),
  frame: loc(traceProg, 'u_frame'),
  bounces: loc(traceProg, 'u_bounces'),
  objPos: loc(traceProg, 'u_objPos'),
  objCol: loc(traceProg, 'u_objCol'),
  objMat: loc(traceProg, 'u_objMat'),
  light: loc(traceProg, 'u_light'),
  lightCol: loc(traceProg, 'u_lightCol'),
  camPos: loc(traceProg, 'u_camPos'),
  camRight: loc(traceProg, 'u_camRight'),
  camUp: loc(traceProg, 'u_camUp'),
  camFwd: loc(traceProg, 'u_camFwd'),
  inside: loc(traceProg, 'u_inside'),
  th: loc(traceProg, 'u_th'),
  blend: loc(traceProg, 'u_blend'),
};
const uDisp = { tex: loc(dispProg, 'u_tex'), res: loc(dispProg, 'u_res'), dim: loc(dispProg, 'u_dim'), off: loc(dispProg, 'u_off') };
gl.bindVertexArray(gl.createVertexArray());

type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer };
let targets: Target[] = [];
let cur = 0;
let rw = 0;
let rh = 0;
let frame = 0;
let scale = Number(params.get('scale') ?? '1');
const scene = defaultScene();

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

function makeTarget(w: number, h: number): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, texType, null);
  const f = linearOk ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo };
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
    for (const t of targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    rw = w;
    rh = h;
    targets = [makeTarget(w, h), makeTarget(w, h)];
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
const ui = initControls({ scene, reset, onTerm: (t) => eq.highlight(t) });
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
  reset();
}

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
  if (h?.surface === 'object') {
    cycleMaterial(h.objectIndex);
    lastTap = null;
    return;
  }
  if (h?.surface === 'light') {
    eq.highlight('le');
    lastTap = null;
    return;
  }
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
  if (e.key === 's') {
    scale = scale === 1 ? 0.5 : 1;
    reset();
  }
  const oi = ['q', 'w', 'e'].indexOf(e.key);
  if (oi >= 0) cycleMaterial(oi);
});
// Attract mode: ?idle=<seconds> overrides the 45 s default (0 turns it off).
const idleParam = params.get('idle');
const idle = initIdle({
  scene,
  reset,
  ui,
  eq,
  photon,
  totalRays: () => raysTotal,
  timeoutSeconds: idleParam !== null && !Number.isNaN(Number(idleParam)) ? Number(idleParam) : 45,
});

// Hook for later UI work and manual testing from the console.
(window as unknown as Record<string, unknown>).lightlab = { scene, reset, pick, idle };

let raysTotal = 0; // every ray the main view has traced since the page loaded
let ema = 0;
let last = performance.now();
let gpuMs = NaN;
let query: WebGLQuery | null = null;

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
  gl.uniform2f(uTrace.res, w, h);
  gl.uniform1i(uTrace.frame, frameIdx);
  gl.uniform1f(uTrace.blend, blend);
  gl.uniform1f(uTrace.th, th);
  gl.uniform1i(uTrace.inside, inside ? 1 : 0);
  gl.uniform1i(uTrace.bounces, scene.bounces);
  gl.uniform4fv(uTrace.objPos, scene.objects.flatMap((o) => [...o.pos, o.radius]));
  gl.uniform4fv(uTrace.objCol, scene.objects.flatMap((o) => [...o.color, 1]));
  gl.uniform1iv(uTrace.objMat, scene.objects.map((o) => o.mat));
  gl.uniform4f(uTrace.light, scene.light.x, scene.light.z, 0, scene.light.half);
  gl.uniform3fv(uTrace.lightCol, lightRadiance(scene.light));
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

function tick(now: number) {
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
  }

  tracePass(targets[cur], targets[1 - cur], rw, rh, frame, 0, cameraOf(scene), 0.45, false);
  raysTotal += rw * rh * (scene.bounces + 1);
  if (query && extTimer) gl.endQuery(extTimer.TIME_ELAPSED_EXT);
  cur = 1 - cur;
  frame++;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(dispProg);
  gl.bindTexture(gl.TEXTURE_2D, targets[cur].tex);
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
      `target ${rw}x${rh} (scale ${scale})  bounces ${scene.bounces}\n` +
      `frame ${ema.toFixed(1)} ms (${(1000 / ema).toFixed(0)} fps)  gpu ${Number.isNaN(gpuMs) ? 'n/a' : gpuMs.toFixed(1) + ' ms'}  spp ${frame}  ~${((rw * rh * frame * (scene.bounces + 1)) / 1e9).toFixed(2)}B rays\n` +
      `tap: pick (${pickedText || 'none'})   s: scale 1/0.5   keys 0-8: bounces   q/w/e: cycle object material   ?fmt=16: half-float`;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
