// The marks on the ground (look rounds L2.3 and L3.4), with no three import so
// Node tests can run it. Per vertex of the terrain's 1 m field grid, three
// values in 0..1, four floats to a vertex (the fourth is spare):
//   scorch   where shells burst and kegs burn (char and ash)
//   dust     a pale wash round a great collapse; halves every 90 s
//   trodden  the routes the waves march, worn muddier a little at a time
// groundMarks.ts puts the array on the field mesh as a vertex attribute and
// uploads the rows touched. Crater patches change heights only, so the marks
// are not touched by them.
//
// This file is the only owner of the marks' state; track S3's replay
// keyframes read and write it through capture() and apply() and nowhere else.

import { VALLEY_GRID } from "@keepfall/content";
import { MINION_STRIDE } from "@keepfall/sim";

export const SCORCH = 0;
export const DUST = 1;
export const TRODDEN = 2;
export const MARK_STRIDE = 4;

/** A shell scorches a disc of this share of its radius. */
export const SCORCH_RADIUS_SHARE = 0.8;
/** An Explosion this near the ground scorches it (m). */
export const SCORCH_REACH = 4;
/** A burning keg scorches a disc this wide (radius, m) ... */
export const KEG_RADIUS = 2;
/** ... and adds this much at the centre each time it is sampled (4 Hz). */
export const KEG_AMOUNT = 0.15;
/** Dust halves in this many seconds. */
export const DUST_HALF_LIFE = 90;
const DUST_STEP = 5;
/**
 * Trodden: every sample (2 Hz) a man adds TROD_STEP at his cell and TROD_SIDE at each of
 * the four neighbours. A man walking at 1.5 m/s is in a cell for about 1.3 samples, so one
 * crossing leaves about 0.03 (below TRODDEN_VISIBLE, where the ground shader starts to
 * show it); a route walked by several waves of a dozen reaches 0.5 and more within two or
 * three minutes of play. Standing and fighting men wear the ground faster, as they should.
 */
export const TROD_STEP = 0.02;
export const TROD_SIDE = 0.008;
export const TRODDEN_VISIBLE = 0.08;
/** Men higher than this above the ground (on a wall, a ladder) tread nothing. */
const TROD_MAX_HEIGHT = 1.2;

export interface MarkGrid {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
}

/** A hash of a cell to 0..1 (rendering only, stable so a mark's edge does not shimmer). */
function cellHash(i: number, j: number, salt: number): number {
  let h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(salt, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class GroundMarksData {
  readonly grid: MarkGrid;
  /** nx * nz * MARK_STRIDE floats, row by row (j outer). Pass `store` to share a bigger buffer (the mesh attribute's). */
  readonly data: Float32Array;
  /** Rows touched since takeDirty(). */
  private rowMin = Infinity;
  private rowMax = -Infinity;
  /** The box of cells that may hold dust. */
  private dMinI = Infinity;
  private dMaxI = -Infinity;
  private dMinJ = Infinity;
  private dMaxJ = -Infinity;
  private dustTimer = 0;

  constructor(grid: MarkGrid = VALLEY_GRID, store?: Float32Array) {
    this.grid = grid;
    const n = grid.nx * grid.nz * MARK_STRIDE;
    this.data = store ?? new Float32Array(n);
    if (this.data.length < n) throw new Error("groundMarks: store too small");
  }

  private touch(j0: number, j1: number) {
    if (j0 < this.rowMin) this.rowMin = j0;
    if (j1 > this.rowMax) this.rowMax = j1;
  }

  /** Add `amount * falloff` to a channel over a disc, its edge ragged by `jitter` (a cell hash). Returns the cells changed. */
  private splat(ch: number, x: number, z: number, radius: number, amount: number, jitter: number, power: number): number {
    const { x0, z0, cell, nx, nz } = this.grid;
    const reach = radius * (1 + jitter * 0.5);
    const fi = (x - x0) / cell, fj = (z - z0) / cell;
    const i0 = Math.max(0, Math.floor(fi - reach / cell)), i1 = Math.min(nx - 1, Math.ceil(fi + reach / cell));
    const j0 = Math.max(0, Math.floor(fj - reach / cell)), j1 = Math.min(nz - 1, Math.ceil(fj + reach / cell));
    if (i1 < i0 || j1 < j0) return 0;
    const salt = Math.floor(x * 7 + z * 13);
    let n = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(x0 + i * cell - x, z0 + j * cell - z);
        const r = radius * (1 + jitter * (cellHash(i, j, salt) - 0.5));
        if (d >= r) continue;
        const f = Math.pow(1 - d / r, power);
        const o = (j * nx + i) * MARK_STRIDE + ch;
        const v = this.data[o] + amount * f;
        this.data[o] = v > 1 ? 1 : v;
        n++;
      }
    }
    if (n) {
      this.touch(j0, j1);
      if (ch === DUST) {
        this.dMinI = Math.min(this.dMinI, i0);
        this.dMaxI = Math.max(this.dMaxI, i1);
        this.dMinJ = Math.min(this.dMinJ, j0);
        this.dMaxJ = Math.max(this.dMaxJ, j1);
      }
    }
    return n;
  }

  /** A burst: scorch a disc of 0.8 x its radius, ragged at the edge and strongest at the centre, if it is within 4 m of the ground. Returns the cells changed. */
  explosion(x: number, y: number, z: number, radius: number, groundY: number): number {
    const h = y - groundY;
    if (h > SCORCH_REACH) return 0;
    const lift = 1 - (0.5 * Math.max(0, h)) / SCORCH_REACH;
    return this.splat(SCORCH, x, z, Math.max(0.5, radius) * SCORCH_RADIUS_SHARE, lift, 0.35, 0.8);
  }

  /** One sample (call at 4 Hz) of the kegs burning: kegs is [x, y, z, ticks left] each. */
  kegs(kegs: Float32Array, count: number): number {
    let n = 0;
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      if (!(kegs[o + 3] > 0)) continue;
      n += this.splat(SCORCH, kegs[o], kegs[o + 2], KEG_RADIUS, KEG_AMOUNT, 0.3, 1);
    }
    return n;
  }

  /** A pale wash round a collapse: radius m, amount 0..1 at the centre. */
  dust(x: number, z: number, radius: number, amount: number): number {
    return this.splat(DUST, x, z, radius, amount, 0.2, 1.5);
  }

  /** One sample (call at 2 Hz) of the upright men: minions is MINION_STRIDE floats each. groundAt skips men up on a wall or a ladder. */
  walkers(minions: Float32Array, count: number, groundAt?: (x: number, z: number) => number): number {
    const { x0, z0, cell, nx, nz } = this.grid;
    let n = 0;
    for (let m = 0; m < count; m++) {
      const o = m * MINION_STRIDE;
      const x = minions[o + 1], y = minions[o + 2], z = minions[o + 3];
      if (groundAt && y - groundAt(x, z) > TROD_MAX_HEIGHT) continue;
      const i = Math.round((x - x0) / cell), j = Math.round((z - z0) / cell);
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      this.bump(i, j, TROD_STEP);
      if (i > 0) this.bump(i - 1, j, TROD_SIDE);
      if (i < nx - 1) this.bump(i + 1, j, TROD_SIDE);
      if (j > 0) this.bump(i, j - 1, TROD_SIDE);
      if (j < nz - 1) this.bump(i, j + 1, TROD_SIDE);
      this.touch(Math.max(0, j - 1), Math.min(nz - 1, j + 1));
      n++;
    }
    return n;
  }

  private bump(i: number, j: number, amount: number) {
    const o = (j * this.grid.nx + i) * MARK_STRIDE + TRODDEN;
    const v = this.data[o] + amount;
    this.data[o] = v > 1 ? 1 : v;
  }

  /** Once a frame: dust halves every DUST_HALF_LIFE seconds (applied in steps over the box it may lie in). */
  update(dt: number) {
    if (this.dMaxI < this.dMinI) {
      this.dustTimer = 0;
      return;
    }
    this.dustTimer += dt;
    if (this.dustTimer < DUST_STEP) return;
    const k = Math.pow(0.5, this.dustTimer / DUST_HALF_LIFE);
    this.dustTimer = 0;
    const { nx } = this.grid;
    let any = false;
    for (let j = this.dMinJ; j <= this.dMaxJ; j++) {
      for (let i = this.dMinI; i <= this.dMaxI; i++) {
        const o = (j * nx + i) * MARK_STRIDE + DUST;
        const v = this.data[o];
        if (v === 0) continue;
        const w = v * k;
        this.data[o] = w < 0.004 ? 0 : w;
        if (w >= 0.004) any = true;
      }
    }
    this.touch(this.dMinJ, this.dMaxJ);
    if (!any) {
      this.dMinI = this.dMinJ = Infinity;
      this.dMaxI = this.dMaxJ = -Infinity;
    }
  }

  /** The rows changed since the last call (j0..j1), or null. */
  takeDirty(): [number, number] | null {
    if (this.rowMin > this.rowMax) return null;
    const r: [number, number] = [this.rowMin, this.rowMax];
    this.rowMin = Infinity;
    this.rowMax = -Infinity;
    return r;
  }

  clear() {
    this.data.fill(0, 0, this.grid.nx * this.grid.nz * MARK_STRIDE);
    this.dMinI = this.dMinJ = Infinity;
    this.dMaxI = this.dMaxJ = -Infinity;
    this.dustTimer = 0;
    this.touch(0, this.grid.nz - 1);
  }

  /** A copy of the marks (the grid's floats). */
  capture(): Float32Array {
    return this.data.slice(0, this.grid.nx * this.grid.nz * MARK_STRIDE);
  }

  apply(saved: ArrayLike<number>) {
    const n = this.grid.nx * this.grid.nz * MARK_STRIDE;
    for (let k = 0; k < n; k++) this.data[k] = saved[k] ?? 0;
    this.dMinI = 0;
    this.dMaxI = this.grid.nx - 1;
    this.dMinJ = 0;
    this.dMaxJ = this.grid.nz - 1;
    this.dustTimer = 0;
    this.touch(0, this.grid.nz - 1);
  }
}
