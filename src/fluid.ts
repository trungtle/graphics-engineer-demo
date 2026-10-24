// A 2D FLIP fluid (particles carry the water, a grid enforces that it cannot be squeezed), the method film and
// game studios use for water. Structure follows the well-known "FLIP in a tank" recipe:
//   move particles -> push overlapping particles apart -> walls and the stirring ball
//   -> particle velocities to the grid -> make the grid velocities divergence free -> grid changes back to particles.
// Units: metres and seconds; x to the right, y up; the tank is [0, width] x [0, height] including a one-cell wall.

export const FLUID = 0;
export const AIR = 1;
export const SOLID = 2;

export interface Obstacle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export interface FluidOptions {
  width: number;
  height: number;
  /** grid cells across the height */
  rows: number;
  /** fraction of the tank (from the left wall, from the floor) that starts full of water */
  fillX: number;
  fillY: number;
}

export const DEFAULT_FLUID: FluidOptions = { width: 4.8, height: 3, rows: 45, fillX: 0.5, fillY: 0.62 };

export class Flip {
  readonly nx: number;
  readonly ny: number;
  readonly h: number;
  readonly invH: number;
  readonly width: number;
  readonly height: number;
  // staggered (MAC) grid: u on the left face of cell (i, j), v on its bottom face; index i * ny + j
  readonly u: Float32Array;
  readonly v: Float32Array;
  readonly du: Float32Array;
  readonly dv: Float32Array;
  readonly prevU: Float32Array;
  readonly prevV: Float32Array;
  /** 1 = open, 0 = wall or the stirring ball */
  readonly s: Float32Array;
  readonly cellType: Int32Array;
  readonly density: Float32Array;
  restDensity = 0;

  readonly radius: number;
  count = 0;
  readonly pos: Float32Array;
  readonly vel: Float32Array;

  // spatial hash for pushing particles apart
  private readonly pInvSpacing: number;
  private readonly pnx: number;
  private readonly pny: number;
  private readonly cellCount: Int32Array;
  private readonly firstCell: Int32Array;
  private readonly cellIds: Int32Array;

  flipRatio = 0.9;
  pressureIters = 50;
  separationIters = 2;
  overRelax = 1.9;

  constructor(readonly opts: FluidOptions = DEFAULT_FLUID) {
    this.width = opts.width;
    this.height = opts.height;
    this.ny = opts.rows;
    this.h = opts.height / opts.rows;
    this.invH = 1 / this.h;
    this.nx = Math.floor(opts.width * this.invH);
    const cells = this.nx * this.ny;
    this.u = new Float32Array(cells);
    this.v = new Float32Array(cells);
    this.du = new Float32Array(cells);
    this.dv = new Float32Array(cells);
    this.prevU = new Float32Array(cells);
    this.prevV = new Float32Array(cells);
    this.s = new Float32Array(cells);
    this.cellType = new Int32Array(cells);
    this.density = new Float32Array(cells);

    this.radius = 0.3 * this.h;
    const dx = 2 * this.radius;
    const dy = (Math.sqrt(3) / 2) * dx;
    const fillW = opts.fillX * opts.width - 2 * this.h - 2 * this.radius;
    const fillH = opts.fillY * opts.height - 2 * this.h - 2 * this.radius;
    const perRow = Math.floor(fillW / dx);
    const rowsP = Math.floor(fillH / dy);
    const max = perRow * rowsP;
    this.pos = new Float32Array(2 * max);
    this.vel = new Float32Array(2 * max);

    this.pInvSpacing = 1 / (2.2 * this.radius);
    this.pnx = Math.floor(opts.width * this.pInvSpacing) + 1;
    this.pny = Math.floor(opts.height * this.pInvSpacing) + 1;
    this.cellCount = new Int32Array(this.pnx * this.pny);
    this.firstCell = new Int32Array(this.pnx * this.pny + 1);
    this.cellIds = new Int32Array(max);
    this.reset();
  }

  /** Dam break: a block of still water against the left wall. */
  reset(): void {
    const dx = 2 * this.radius;
    const dy = (Math.sqrt(3) / 2) * dx;
    const fillW = this.opts.fillX * this.width - 2 * this.h - 2 * this.radius;
    const fillH = this.opts.fillY * this.height - 2 * this.h - 2 * this.radius;
    const perRow = Math.floor(fillW / dx);
    const rowsP = Math.floor(fillH / dy);
    let p = 0;
    for (let i = 0; i < perRow; i++) {
      for (let j = 0; j < rowsP; j++) {
        this.pos[p++] = this.h + this.radius + dx * i + (j % 2 === 0 ? 0 : this.radius);
        this.pos[p++] = this.h + this.radius + dy * j;
      }
    }
    this.count = perRow * rowsP;
    this.vel.fill(0);
    this.u.fill(0);
    this.v.fill(0);
    this.restDensity = 0;
    this.setObstacle(null);
  }

  /** Lift a block of water from the bottom middle back up near the top, so it splashes down. */
  splash(): void {
    const top = this.height - 2 * this.h;
    // the highest particles keep their place; take the ones nearest the floor in the middle third
    const ids: number[] = [];
    for (let i = 0; i < this.count; i++) ids.push(i);
    const cx = this.width / 2;
    ids.sort((a, b) => Math.abs(this.pos[2 * a] - cx) + this.pos[2 * a + 1] - (Math.abs(this.pos[2 * b] - cx) + this.pos[2 * b + 1]));
    const take = Math.floor(this.count * 0.22);
    const dx = 2 * this.radius;
    const dy = (Math.sqrt(3) / 2) * dx;
    const perRow = Math.max(1, Math.floor(Math.sqrt(take * (dy / dx))));
    for (let k = 0; k < take; k++) {
      const i = ids[k];
      const col = k % perRow;
      const row = Math.floor(k / perRow);
      this.pos[2 * i] = cx - (perRow * dx) / 2 + col * dx + (row % 2 ? this.radius : 0);
      this.pos[2 * i + 1] = top - row * dy;
      this.vel[2 * i] = 0;
      this.vel[2 * i + 1] = -1;
    }
  }

  /** Walls on the border; the stirring ball (if any) is solid and moves the water with it. */
  setObstacle(o: Obstacle | null): void {
    const n = this.ny;
    for (let i = 0; i < this.nx; i++) {
      for (let j = 0; j < this.ny; j++) {
        const wall = i === 0 || i === this.nx - 1 || j === 0;
        this.s[i * n + j] = wall ? 0 : 1;
        if (!o || wall) continue;
        const cx = (i + 0.5) * this.h - o.x;
        const cy = (j + 0.5) * this.h - o.y;
        if (cx * cx + cy * cy < o.r * o.r) {
          this.s[i * n + j] = 0;
          this.u[i * n + j] = o.vx;
          if (i + 1 < this.nx) this.u[(i + 1) * n + j] = o.vx;
          this.v[i * n + j] = o.vy;
          if (j + 1 < this.ny) this.v[i * n + j + 1] = o.vy;
        }
      }
    }
    this.obstacle = o;
  }
  private obstacle: Obstacle | null = null;

  step(dt: number, gx: number, gy: number): void {
    this.integrate(dt, gx, gy);
    this.pushApart();
    this.collide();
    this.transfer(true);
    this.updateDensity();
    this.solve(dt);
    this.transfer(false);
  }

  private integrate(dt: number, gx: number, gy: number) {
    for (let i = 0; i < this.count; i++) {
      this.vel[2 * i] += dt * gx;
      this.vel[2 * i + 1] += dt * gy;
      this.pos[2 * i] += this.vel[2 * i] * dt;
      this.pos[2 * i + 1] += this.vel[2 * i + 1] * dt;
    }
  }

  private pushApart() {
    const { pnx, pny, pInvSpacing, cellCount, firstCell, cellIds, pos } = this;
    cellCount.fill(0);
    const cellOf = (i: number) => {
      const xi = Math.min(Math.max(Math.floor(pos[2 * i] * pInvSpacing), 0), pnx - 1);
      const yi = Math.min(Math.max(Math.floor(pos[2 * i + 1] * pInvSpacing), 0), pny - 1);
      return xi * pny + yi;
    };
    for (let i = 0; i < this.count; i++) cellCount[cellOf(i)]++;
    let first = 0;
    for (let c = 0; c < pnx * pny; c++) {
      first += cellCount[c];
      firstCell[c] = first;
    }
    firstCell[pnx * pny] = first;
    for (let i = 0; i < this.count; i++) {
      const c = cellOf(i);
      firstCell[c]--;
      cellIds[firstCell[c]] = i;
    }
    const minDist = 2 * this.radius;
    const minDist2 = minDist * minDist;
    for (let iter = 0; iter < this.separationIters; iter++) {
      for (let i = 0; i < this.count; i++) {
        const px = pos[2 * i];
        const py = pos[2 * i + 1];
        const pxi = Math.floor(px * pInvSpacing);
        const pyi = Math.floor(py * pInvSpacing);
        const x0 = Math.max(pxi - 1, 0);
        const y0 = Math.max(pyi - 1, 0);
        const x1 = Math.min(pxi + 1, pnx - 1);
        const y1 = Math.min(pyi + 1, pny - 1);
        for (let xi = x0; xi <= x1; xi++) {
          for (let yi = y0; yi <= y1; yi++) {
            const c = xi * pny + yi;
            for (let k = firstCell[c]; k < firstCell[c + 1]; k++) {
              const id = cellIds[k];
              if (id === i) continue;
              let dx = pos[2 * id] - px;
              let dy = pos[2 * id + 1] - py;
              const d2 = dx * dx + dy * dy;
              if (d2 > minDist2 || d2 === 0) continue;
              const d = Math.sqrt(d2);
              const sc = (0.5 * (minDist - d)) / d;
              dx *= sc;
              dy *= sc;
              pos[2 * i] -= dx;
              pos[2 * i + 1] -= dy;
              pos[2 * id] += dx;
              pos[2 * id + 1] += dy;
            }
          }
        }
      }
    }
  }

  private collide() {
    const r = this.radius;
    const minX = this.h + r;
    const maxX = (this.nx - 1) * this.h - r;
    const minY = this.h + r;
    // open top: water may splash above the rim, but not out of the picture
    const maxY = this.height - r;
    const o = this.obstacle;
    const oMin = o ? o.r + r : 0;
    for (let i = 0; i < this.count; i++) {
      let x = this.pos[2 * i];
      let y = this.pos[2 * i + 1];
      if (o) {
        const dx = x - o.x;
        const dy = y - o.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < oMin * oMin) {
          const d = Math.sqrt(d2) || 1e-6;
          x = o.x + (dx / d) * oMin;
          y = o.y + (dy / d) * oMin;
          this.vel[2 * i] = o.vx;
          this.vel[2 * i + 1] = o.vy;
        }
      }
      if (x < minX) {
        x = minX;
        this.vel[2 * i] = 0;
      }
      if (x > maxX) {
        x = maxX;
        this.vel[2 * i] = 0;
      }
      if (y < minY) {
        y = minY;
        this.vel[2 * i + 1] = 0;
      }
      if (y > maxY) {
        y = maxY;
        this.vel[2 * i + 1] = Math.min(0, this.vel[2 * i + 1]);
      }
      this.pos[2 * i] = x;
      this.pos[2 * i + 1] = y;
    }
  }

  private cellIndex(x: number, y: number): number {
    const xi = Math.min(Math.max(Math.floor(x * this.invH), 0), this.nx - 1);
    const yi = Math.min(Math.max(Math.floor(y * this.invH), 0), this.ny - 1);
    return xi * this.ny + yi;
  }

  private updateDensity() {
    const n = this.ny;
    const h = this.h;
    const h2 = 0.5 * h;
    const d = this.density;
    d.fill(0);
    for (let i = 0; i < this.count; i++) {
      const x = Math.min(Math.max(this.pos[2 * i], h), (this.nx - 1) * h);
      const y = Math.min(Math.max(this.pos[2 * i + 1], h), (this.ny - 1) * h);
      const x0 = Math.floor((x - h2) * this.invH);
      const tx = (x - h2 - x0 * h) * this.invH;
      const x1 = Math.min(x0 + 1, this.nx - 2);
      const y0 = Math.floor((y - h2) * this.invH);
      const ty = (y - h2 - y0 * h) * this.invH;
      const y1 = Math.min(y0 + 1, this.ny - 2);
      const sx = 1 - tx;
      const sy = 1 - ty;
      if (x0 < this.nx && y0 < this.ny) d[x0 * n + y0] += sx * sy;
      if (x1 < this.nx && y0 < this.ny) d[x1 * n + y0] += tx * sy;
      if (x1 < this.nx && y1 < this.ny) d[x1 * n + y1] += tx * ty;
      if (x0 < this.nx && y1 < this.ny) d[x0 * n + y1] += sx * ty;
    }
    if (this.restDensity === 0) {
      let sum = 0;
      let cells = 0;
      for (let c = 0; c < this.nx * this.ny; c++) {
        if (this.cellType[c] === FLUID) {
          sum += d[c];
          cells++;
        }
      }
      if (cells > 0) this.restDensity = sum / cells;
    }
  }

  private transfer(toGrid: boolean) {
    const n = this.ny;
    const h = this.h;
    const h1 = this.invH;
    const h2 = 0.5 * h;
    if (toGrid) {
      this.prevU.set(this.u);
      this.prevV.set(this.v);
      this.du.fill(0);
      this.dv.fill(0);
      this.u.fill(0);
      this.v.fill(0);
      for (let c = 0; c < this.nx * this.ny; c++) this.cellType[c] = this.s[c] === 0 ? SOLID : AIR;
      for (let i = 0; i < this.count; i++) {
        const c = this.cellIndex(this.pos[2 * i], this.pos[2 * i + 1]);
        if (this.cellType[c] === AIR) this.cellType[c] = FLUID;
      }
    }
    for (let comp = 0; comp < 2; comp++) {
      const dx = comp === 0 ? 0 : h2;
      const dy = comp === 0 ? h2 : 0;
      const f = comp === 0 ? this.u : this.v;
      const prevF = comp === 0 ? this.prevU : this.prevV;
      const d = comp === 0 ? this.du : this.dv;
      for (let i = 0; i < this.count; i++) {
        const x = Math.min(Math.max(this.pos[2 * i], h), (this.nx - 1) * h);
        const y = Math.min(Math.max(this.pos[2 * i + 1], h), (this.ny - 1) * h);
        const x0 = Math.min(Math.floor((x - dx) * h1), this.nx - 2);
        const tx = (x - dx - x0 * h) * h1;
        const x1 = Math.min(x0 + 1, this.nx - 2);
        const y0 = Math.min(Math.floor((y - dy) * h1), this.ny - 2);
        const ty = (y - dy - y0 * h) * h1;
        const y1 = Math.min(y0 + 1, this.ny - 2);
        const sx = 1 - tx;
        const sy = 1 - ty;
        const d0 = sx * sy;
        const d1 = tx * sy;
        const d2 = tx * ty;
        const d3 = sx * ty;
        const nr0 = x0 * n + y0;
        const nr1 = x1 * n + y0;
        const nr2 = x1 * n + y1;
        const nr3 = x0 * n + y1;
        if (toGrid) {
          const pv = this.vel[2 * i + comp];
          f[nr0] += pv * d0;
          d[nr0] += d0;
          f[nr1] += pv * d1;
          d[nr1] += d1;
          f[nr2] += pv * d2;
          d[nr2] += d2;
          f[nr3] += pv * d3;
          d[nr3] += d3;
        } else {
          const off = comp === 0 ? n : 1;
          const ct = this.cellType;
          const valid = (nr: number) => (ct[nr] !== AIR || (nr - off >= 0 && ct[nr - off] !== AIR) ? 1 : 0);
          const v0 = valid(nr0);
          const v1 = valid(nr1);
          const v2 = valid(nr2);
          const v3 = valid(nr3);
          const dsum = v0 * d0 + v1 * d1 + v2 * d2 + v3 * d3;
          if (dsum > 0) {
            const pic = (v0 * d0 * f[nr0] + v1 * d1 * f[nr1] + v2 * d2 * f[nr2] + v3 * d3 * f[nr3]) / dsum;
            const corr =
              (v0 * d0 * (f[nr0] - prevF[nr0]) +
                v1 * d1 * (f[nr1] - prevF[nr1]) +
                v2 * d2 * (f[nr2] - prevF[nr2]) +
                v3 * d3 * (f[nr3] - prevF[nr3])) /
              dsum;
            const flip = this.vel[2 * i + comp] + corr;
            this.vel[2 * i + comp] = (1 - this.flipRatio) * pic + this.flipRatio * flip;
          }
        }
      }
      if (toGrid) {
        for (let c = 0; c < f.length; c++) if (d[c] > 0) f[c] /= d[c];
        for (let i = 0; i < this.nx; i++) {
          for (let j = 0; j < this.ny; j++) {
            const solid = this.cellType[i * n + j] === SOLID;
            if (solid || (i > 0 && this.cellType[(i - 1) * n + j] === SOLID)) this.u[i * n + j] = this.prevU[i * n + j];
            if (solid || (j > 0 && this.cellType[i * n + j - 1] === SOLID)) this.v[i * n + j] = this.prevV[i * n + j];
          }
        }
      }
    }
  }

  private solve(_dt: number) {
    const n = this.ny;
    this.prevU.set(this.u);
    this.prevV.set(this.v);
    for (let iter = 0; iter < this.pressureIters; iter++) {
      for (let i = 1; i < this.nx - 1; i++) {
        for (let j = 1; j < this.ny - 1; j++) {
          const c = i * n + j;
          if (this.cellType[c] !== FLUID) continue;
          const left = (i - 1) * n + j;
          const right = (i + 1) * n + j;
          const bottom = c - 1;
          const top = c + 1;
          const sx0 = this.s[left];
          const sx1 = this.s[right];
          const sy0 = this.s[bottom];
          const sy1 = this.s[top];
          const ss = sx0 + sx1 + sy0 + sy1;
          if (ss === 0) continue;
          let div = this.u[right] - this.u[c] + this.v[top] - this.v[c];
          // squeezed regions (too many particles per cell) push outward, so the water keeps its volume
          if (this.restDensity > 0) {
            const compression = this.density[c] - this.restDensity;
            if (compression > 0) div -= compression;
          }
          const p = (-div / ss) * this.overRelax;
          this.u[c] -= sx0 * p;
          this.u[right] += sx1 * p;
          this.v[c] -= sy0 * p;
          this.v[top] += sy1 * p;
        }
      }
    }
  }

  /** Fastest particle speed (m/s); used by tests and for the foam color scale. */
  maxSpeed(): number {
    let m = 0;
    for (let i = 0; i < this.count; i++) m = Math.max(m, Math.hypot(this.vel[2 * i], this.vel[2 * i + 1]));
    return m;
  }
}

/** Gravity for a tank tilted by `angle` radians (positive = tank turned clockwise on screen, water runs right). */
export function tiltedGravity(angle: number, g = 9.81): [number, number] {
  return [g * Math.sin(angle), -g * Math.cos(angle)];
}
