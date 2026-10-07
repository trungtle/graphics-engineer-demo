import { LIGHT_COLORS, resetScene, type MaterialId, type SceneState } from './scene';
import { formatCount, type Controls } from './ui/controls';
import type { Equation } from './ui/equation';
import type { Photon } from './ui/photon';

/** Attract mode: after a quiet spell the demo plays itself to catch people walking past. */
export interface Idle {
  readonly active: boolean;
  /** Seconds of quiet before attract mode starts (0 disables it). */
  setTimeoutSeconds(s: number): void;
  start(): void;
  stop(): void;
}

const CHECK_MS = 1000;
const MOVE_PX = 6; // mouse jitter below this does not wake the demo
const CANCELLED = Symbol('cancelled');

const ease = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * p);

export function initIdle(opts: {
  scene: SceneState;
  reset: () => void;
  ui: Controls;
  eq: Equation;
  photon: Photon;
  /** Total rays traced since the page loaded (never resets). */
  totalRays: () => number;
  timeoutSeconds: number;
}): Idle {
  const { scene, ui, eq, photon } = opts;
  let timeoutMs = opts.timeoutSeconds * 1000;
  let active = false;
  let run = 0;
  let lastActivity = performance.now();
  let swallow = false;
  let raysAtStart = 0;
  let lastX = NaN;
  let lastY = NaN;

  const syncUi = () => {
    ui.syncBounces();
    ui.syncLamp();
  };

  function start() {
    if (active) return;
    active = true;
    raysAtStart = opts.totalRays();
    document.body.classList.add('idle');
    photon.setEnabled(false);
    resetScene(scene);
    syncUi();
    opts.reset();
    const my = ++run;
    void loop(my).catch((e) => {
      if (e !== CANCELLED) throw e;
    });
  }

  function stop() {
    if (!active) return;
    active = false;
    run++;
    document.body.classList.remove('idle');
    photon.setEnabled(false);
    photon.clear();
    resetScene(scene);
    syncUi();
    opts.reset();
    ui.idleCaption(null);
    lastActivity = performance.now();
  }

  // ---- the show ----

  async function loop(my: number) {
    const alive = () => active && run === my;
    const wait = (ms: number) =>
      new Promise<void>((res, rej) => setTimeout(() => (alive() ? res() : rej(CANCELLED)), ms));
    const tween = (ms: number, f: (p: number) => void) =>
      new Promise<void>((res, rej) => {
        const t0 = performance.now();
        const step = (now: number) => {
          if (!alive()) return rej(CANCELLED);
          const p = Math.min(1, (now - t0) / ms);
          f(ease(p));
          if (p < 1) requestAnimationFrame(step);
          else res();
        };
        requestAnimationFrame(step);
      });
    const say = (text: string) => ui.idleCaption(text);

    const setBounces = (n: number) => {
      scene.bounces = n;
      ui.syncBounces();
      opts.reset();
      eq.highlight('li', 1600);
    };
    const setMaterial = (i: number, m: MaterialId) => {
      scene.objects[i].mat = m;
      opts.reset();
      eq.highlight(m === 4 ? 'le' : 'fr', 3000);
    };
    const moveCamera = (yaw: number, pitch: number, ms: number) => {
      const y0 = scene.camera.yaw;
      const p0 = scene.camera.pitch;
      return tween(ms, (p) => {
        scene.camera.yaw = y0 + (yaw - y0) * p;
        scene.camera.pitch = p0 + (pitch - p0) * p;
        opts.reset();
      });
    };

    for (;;) {
      // 1. Orbit in steps: each move restarts the picture as noise, each pause lets it clean up
      say('Every pixel here is a simulated ray of light');
      for (const [yaw, pitch] of [
        [0.35, 0.1],
        [-0.4, 0.05],
        [0.2, -0.1],
        [0, 0],
      ] as const) {
        await moveCamera(yaw, pitch, 1400);
        await wait(3000);
      }

      // 2. Bounces 0 to 8
      for (let n = 0; n <= 8; n++) {
        say(n === 0 ? 'Light bounces: 0. Only the lamp is visible' : `Light bounces: ${n}. ${n === 1 ? 'Direct light only' : 'Walls start to tint each other'}`);
        setBounces(n);
        await wait(n === 0 ? 2400 : 1700);
      }
      setBounces(4);
      await wait(1500);

      // 3. Same ball, different materials
      for (const [m, name] of [
        [1, 'a mirror'],
        [2, 'glass'],
        [4, 'a lamp of its own'],
        [0, 'matte again'],
      ] as const) {
        say(`Same ball, now ${name}`);
        setMaterial(0, m);
        await wait(3200);
      }

      // 4. The lamp: color, size, position
      say('Change the lamp: color, size and position');
      const lampX0 = scene.light.x;
      for (const [ci, half, x] of [
        [4, 0.4, -0.4],
        [3, 0.14, 0.4],
        [2, 0.3, 0],
        [0, 0.3, 0],
      ] as const) {
        scene.light.color = [...LIGHT_COLORS[ci].rgb];
        scene.light.half = half;
        scene.light.x = x;
        ui.syncLamp();
        opts.reset();
        eq.highlight('le', 3000);
        await wait(3300);
      }
      scene.light.x = lampX0;

      // 5. A photon's journey, first person
      say('Be a photon: follow one ray of light');
      photon.setEnabled(true);
      await wait(1200);
      for (const [x, y] of [
        [-0.25, -0.3],
        [0.3, 0.05],
      ] as const) {
        photon.trace(x, y);
        await wait(7500);
      }
      photon.setEnabled(false);
      await wait(1200);

      // 6. Facts, then the invitation
      say('Movies spend hours on ONE frame');
      await wait(4500);
      say(`Your laptop just traced ${formatCount(opts.totalRays() - raysAtStart)} rays`);
      await wait(4500);
      say('Tap to play');
      await wait(4500);
    }
  }

  // ---- wake on any input ----

  const wake = (e: Event) => {
    if (active) {
      e.stopPropagation();
      e.preventDefault();
      swallow = e.type === 'pointerdown';
      stop();
      return;
    }
    lastActivity = performance.now();
  };
  for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(t, wake, { capture: true, passive: false });
  }
  window.addEventListener(
    'pointermove',
    (e) => {
      const moved = Number.isNaN(lastX) ? Infinity : Math.hypot(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
      if (active) {
        if (moved > MOVE_PX) {
          e.stopPropagation();
          stop();
        }
      } else {
        lastActivity = performance.now();
      }
    },
    { capture: true },
  );
  // the gesture that woke us must not also press a button or tap an object
  for (const t of ['pointerup', 'pointercancel', 'click']) {
    window.addEventListener(
      t,
      (e) => {
        if (!swallow) return;
        e.stopPropagation();
        e.preventDefault();
        if (t === 'pointerup' || t === 'pointercancel') swallow = false;
      },
      { capture: true },
    );
  }

  window.setInterval(() => {
    if (!active && timeoutMs > 0 && performance.now() - lastActivity > timeoutMs) start();
  }, CHECK_MS);

  return {
    get active() {
      return active;
    },
    setTimeoutSeconds(s) {
      timeoutMs = s * 1000;
    },
    start,
    stop,
  };
}
