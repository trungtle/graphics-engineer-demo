// The strip under the Light Lab picture: samples per pixel, rays traced, and a small convergence graph.
// The graph plots the picture's estimated noise against samples per pixel on log-log axes. Monte Carlo noise falls
// like 1 / sqrt(samples) (a straight line of slope -1/2 here: four times the samples for half the noise); the dotted
// line shows that rate. The previous run stays as a faded curve, so restarting with light sampling switched on or
// off shows how much lower the new line starts.
import { formatCount } from './controls';

const X_MAX = 4; // log10 of samples: up to 10,000
const X_LABELS = ['1', '10', '100', '1k', '10k'];

export interface Convergence {
  /** a new estimate at `spp` samples (noise relative to the picture's brightness) */
  add(spp: number, noise: number): void;
  /** the picture restarted: the current run becomes the faded one */
  restart(): void;
  setStats(spp: number, rays: number): void;
}

export function initConvergence(): Convergence {
  const sppEl = document.getElementById('spp')!;
  const raysEl = document.getElementById('rays')!;
  const noiseEl = document.getElementById('noise')!;
  const canvas = document.getElementById('conv') as HTMLCanvasElement;
  let run: [number, number][] = [];
  let ghost: [number, number][] = [];
  let yTop = 0; // log10 of the highest noise shown, set from the first point of a run
  let yRange = 2; // decades shown: enough for the 1 / sqrt(N) line to reach the bottom right corner

  function draw() {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(r.width * dpr)) canvas.width = Math.round(r.width * dpr);
    if (canvas.height !== Math.round(r.height * dpr)) canvas.height = Math.round(r.height * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width;
    const H = r.height;
    ctx.clearRect(0, 0, W, H);
    const pad = 4;
    const bottom = 12; // room for the sample labels
    const x = (spp: number) => pad + (Math.log10(Math.max(1, spp)) / X_MAX) * (W - 2 * pad);
    const y = (n: number) => pad + ((yTop - Math.log10(Math.max(n, 1e-6))) / yRange) * (H - pad - bottom);

    // decade grid
    ctx.strokeStyle = 'rgba(22,32,46,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let d = 1; d < X_MAX; d++) {
      const gx = pad + (d / X_MAX) * (W - 2 * pad);
      ctx.moveTo(gx, pad);
      ctx.lineTo(gx, H - bottom);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(22,32,46,0.45)';
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    X_LABELS.forEach((label, d) => {
      const gx = pad + (d / X_MAX) * (W - 2 * pad);
      ctx.textAlign = d === 0 ? 'left' : d === X_MAX ? 'right' : 'center';
      ctx.fillText(label, gx, H);
    });

    const line = (pts: [number, number][], style: string, width: number, dash: number[] = []) => {
      if (pts.length < 2) return;
      ctx.setLineDash(dash);
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.beginPath();
      pts.forEach(([s, n], i) => (i ? ctx.lineTo(x(s), y(n)) : ctx.moveTo(x(s), y(n))));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(ghost, 'rgba(214,51,108,0.3)', 2);
    // 1 / sqrt(N) through the run's first point
    if (run.length) {
      const [s0, n0] = run[0];
      const ref: [number, number][] = [
        [s0, n0],
        [10 ** X_MAX, n0 * Math.sqrt(s0 / 10 ** X_MAX)],
      ];
      line(ref, 'rgba(22,32,46,0.35)', 1.2, [3, 3]);
    }
    line(run, '#d6336c', 2.2);
  }

  new ResizeObserver(draw).observe(canvas);

  return {
    add(spp, noise) {
      if (!(noise > 0) || !Number.isFinite(noise)) return;
      // the scale starts from the higher of this run and the faded one, so neither gets cut off
      if (!run.length) {
        yTop = Math.log10(Math.max(noise, ghost[0]?.[1] ?? 0)) + 0.1;
        yRange = Math.max(1, (X_MAX - Math.log10(spp)) / 2 + 0.25);
      }
      run.push([spp, noise]);
      noiseEl.textContent = `${(noise * 100).toFixed(noise < 0.1 ? 1 : 0)}%`;
      draw();
    },
    restart() {
      if (run.length > 1) ghost = run;
      run = [];
      noiseEl.textContent = '';
      draw();
    },
    setStats(spp, rays) {
      sppEl.textContent = spp.toLocaleString('en-US');
      raysEl.textContent = formatCount(rays);
    },
  };
}
