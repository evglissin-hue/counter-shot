// Short walks in and around a castle (phase 2 M4): masons to the damage and
// back, the garrison to its posts, defenders to whoever got in. A field per
// goal cell over a box of nav cells around the castle, built the first time
// it is asked for (Dijkstra with integer costs: 5 a straight step, 7 a
// diagonal one, never past a corner) and kept until the nav grid's topology
// changes. Waves on the march use the big flow fields (flow.ts) instead.
// Deterministic: integer costs, a fixed neighbour order, a fixed eviction
// order, no clocks.

import { dsqrt } from "@keepfall/core";
import { NAV_GRID, navWalkable, type NavGrid } from "./nav";

/** Cost where the goal cannot be reached. */
export const LOCAL_INF = 0x3fffffff;
/** Half the side of each castle's box (m). */
const HALF = 22;
/** Fields kept per castle; past this the oldest is dropped. */
const KEEP = 24;
const DI = [-1, 1, 0, 0, -1, 1, -1, 1];
const DJ = [0, 0, -1, 1, -1, -1, 1, 1];
/** For each diagonal, the straight neighbours beside it (indices into DI/DJ). */
const DIAG_A = [0, 0, 0, 0, 0, 1, 0, 1];
const DIAG_B = [0, 0, 0, 0, 2, 2, 3, 3];
const UNIT = 0.7071067811865476;
const UX = [-1, 1, 0, 0, -UNIT, UNIT, -UNIT, UNIT];
const UZ = [0, 0, -1, 1, -UNIT, -UNIT, UNIT, UNIT];

interface Box {
  i0: number;
  j0: number;
  ni: number;
  nj: number;
}

export class LocalFields {
  private boxes: Box[];
  private fields: Array<Map<number, Int32Array>>;
  /** Goal cells per castle in the order their fields were built (for dropping the oldest). */
  private order: number[][];
  private topo = -1;
  /** Fields built since the start (tests, the HUD). */
  builds = 0;

  /** One box per castle, centred on x = 0 and on its z; `halfX` and `halfZ` (m) size the boxes (the army's hold lines use wider, shallower ones). */
  constructor(private nav: NavGrid, castleZ: readonly number[], halfX = HALF, halfZ = HALF) {
    const G = NAV_GRID;
    this.boxes = castleZ.map((cz) => {
      const i0 = Math.max(1, Math.floor((-halfX - G.x0) / G.cell));
      const j0 = Math.max(1, Math.floor((cz - halfZ - G.z0) / G.cell));
      const i1 = Math.min(G.nx - 2, Math.floor((halfX - G.x0) / G.cell));
      const j1 = Math.min(G.nz - 2, Math.floor((cz + halfZ - G.z0) / G.cell));
      return { i0, j0, ni: i1 - i0 + 1, nj: j1 - j0 + 1 };
    });
    this.fields = castleZ.map(() => new Map());
    this.order = castleZ.map(() => []);
  }

  /** Is a point inside castle c's box (with a cell to spare)? */
  covers(c: number, x: number, z: number): boolean {
    const b = this.boxes[c];
    const G = NAV_GRID;
    const i = Math.floor((x - G.x0) / G.cell) - b.i0, j = Math.floor((z - G.z0) / G.cell) - b.j0;
    return i >= 1 && j >= 1 && i < b.ni - 1 && j < b.nj - 1;
  }

  /** Cost of the walk from (x, z) to the goal point (5 per metre, roughly), or LOCAL_INF. */
  cost(c: number, gx: number, gz: number, x: number, z: number): number {
    const f = this.field(c, gx, gz);
    if (!f) return LOCAL_INF;
    const k = this.index(c, x, z);
    return k < 0 ? LOCAL_INF : f[k];
  }

  /**
   * Which way to walk from (x, z) towards the goal point: a unit vector into
   * `out`, or false where there is none (cut off, outside the box). Within a
   * metre of the goal it points straight at it, and false once there.
   */
  steer(c: number, gx: number, gz: number, x: number, z: number, out: [number, number]): boolean {
    const dx = gx - x, dz = gz - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.0025) return false;
    if (d2 < 1.0) {
      const d = dsqrt(d2);
      out[0] = dx / d;
      out[1] = dz / d;
      return true;
    }
    const f = this.field(c, gx, gz);
    if (!f) return false;
    const G = NAV_GRID, b = this.boxes[c];
    // Blend the downhill directions of the four cells around the point, so the way turns smoothly.
    const fx = (x - G.x0) / G.cell - 0.5 - b.i0, fz = (z - G.z0) / G.cell - 0.5 - b.j0;
    const ci = Math.floor(fx), cj = Math.floor(fz);
    const tx = fx - ci, tz = fz - cj;
    let sx = 0, sz = 0;
    const v: [number, number] = [0, 0];
    for (let k = 0; k < 4; k++) {
      const i = ci + (k & 1), j = cj + (k >> 1);
      if (i < 1 || j < 1 || i >= b.ni - 1 || j >= b.nj - 1) continue;
      const wgt = (k & 1 ? tx : 1 - tx) * (k >> 1 ? tz : 1 - tz);
      if (wgt <= 0) continue;
      this.cellDir(c, f, i, j, v);
      sx += v[0] * wgt;
      sz += v[1] * wgt;
    }
    const len2 = sx * sx + sz * sz;
    if (len2 < 1e-10) {
      // At the goal's cell or cut off: straight at the goal if it is that close.
      if (d2 < 4) {
        const d = dsqrt(d2);
        out[0] = dx / d;
        out[1] = dz / d;
        return true;
      }
      return false;
    }
    const inv = 1 / dsqrt(len2);
    out[0] = sx * inv;
    out[1] = sz * inv;
    return true;
  }

  /**
   * 3.3: the way down the field from the cell (x, z) lies in, alone (not
   * blended with its neighbours'): a unit vector into `out`, or false at the
   * goal's cell, cut off, or outside the box. Every direction in it leads to a
   * cell that can be stepped to, so a walker whose blended way pushed it into
   * a step it cannot take (at the corner of a heap) follows this instead.
   */
  downhill(c: number, gx: number, gz: number, x: number, z: number, out: [number, number]): boolean {
    const f = this.field(c, gx, gz);
    if (!f) return false;
    const G = NAV_GRID, b = this.boxes[c];
    const i = Math.floor((x - G.x0) / G.cell) - b.i0, j = Math.floor((z - G.z0) / G.cell) - b.j0;
    if (i < 1 || j < 1 || i >= b.ni - 1 || j >= b.nj - 1) return false;
    const v: [number, number] = [0, 0];
    this.cellDir(c, f, i, j, v);
    const len2 = v[0] * v[0] + v[1] * v[1];
    if (len2 < 1e-10) return false;
    const inv = 1 / dsqrt(len2);
    out[0] = v[0] * inv;
    out[1] = v[1] * inv;
    return true;
  }

  /** Index of a point in castle c's box, or -1. */
  private index(c: number, x: number, z: number): number {
    const b = this.boxes[c];
    const G = NAV_GRID;
    const i = Math.floor((x - G.x0) / G.cell) - b.i0, j = Math.floor((z - G.z0) / G.cell) - b.j0;
    if (i < 0 || j < 0 || i >= b.ni || j >= b.nj) return -1;
    return j * b.ni + i;
  }

  /** The field to a goal point (its cell), built if needed; null if the goal is outside the box or cannot be stood on. */
  private field(c: number, gx: number, gz: number): Int32Array | null {
    if (this.nav.topo !== this.topo) {
      this.topo = this.nav.topo;
      for (const m of this.fields) m.clear();
      for (const o of this.order) o.length = 0;
    }
    const g = this.index(c, gx, gz);
    if (g < 0) return null;
    const map = this.fields[c];
    const hit = map.get(g);
    if (hit) return hit;
    const f = this.build(c, g);
    map.set(g, f);
    const order = this.order[c];
    order.push(g);
    if (order.length > KEEP) map.delete(order.shift()!);
    return f;
  }

  private build(c: number, goal: number): Int32Array {
    const b = this.boxes[c];
    const n = b.ni * b.nj;
    const dist = new Int32Array(n).fill(LOCAL_INF);
    this.builds++;
    const nav = this.nav, nx = NAV_GRID.nx;
    const gi = goal % b.ni, gj = (goal - gi) / b.ni;
    const navOf = (i: number, j: number) => (b.j0 + j) * nx + b.i0 + i;
    if (!navWalkable(nav.kind[navOf(gi, gj)])) return dist;
    // Dial's queue over 8 buckets (no step costs more than 7), first in first out within a cost.
    const B = 8;
    const heads: number[][] = Array.from({ length: B }, () => []);
    let pending = 1;
    dist[goal] = 0;
    heads[0].push(goal);
    let d = 0;
    while (pending > 0) {
      const bucket = heads[d & (B - 1)];
      if (!bucket.length) {
        d++;
        continue;
      }
      // Take everything at this cost in order (new entries at this cost cannot appear: costs are at least 5).
      const list = bucket.splice(0, bucket.length);
      pending -= list.length;
      for (const u of list) {
        if (dist[u] !== d) continue; // reached more cheaply since
        const ui = u % b.ni, uj = (u - ui) / b.ni;
        const nu = navOf(ui, uj);
        let straight = 0;
        for (let k = 0; k < 8; k++) {
          const vi = ui + DI[k], vj = uj + DJ[k];
          if (vi < 0 || vj < 0 || vi >= b.ni || vj >= b.nj) continue;
          const nv = navOf(vi, vj);
          if (k < 4) {
            if (!nav.passable(nu, nv)) continue;
            straight |= 1 << k;
          } else {
            const a = DIAG_A[k], bb = DIAG_B[k];
            if (!(straight & (1 << a)) || !(straight & (1 << bb))) continue;
            const na = navOf(ui + DI[a], uj + DJ[a]), nb = navOf(ui + DI[bb], uj + DJ[bb]);
            if (!nav.passable(na, nv) || !nav.passable(nb, nv)) continue;
          }
          const v = vj * b.ni + vi;
          const nd = d + (k < 4 ? 5 : 7);
          if (nd < dist[v]) {
            dist[v] = nd;
            heads[nd & (B - 1)].push(v);
            pending++;
          }
        }
      }
      d++;
    }
    return dist;
  }

  /** The downhill direction of one cell of a field (box coordinates), not normalised; zero at the goal or cut off. */
  private cellDir(c: number, f: Int32Array, i: number, j: number, out: [number, number]) {
    const b = this.boxes[c];
    const u = j * b.ni + i;
    const du = f[u];
    out[0] = 0;
    out[1] = 0;
    if (du >= LOCAL_INF) return;
    const nav = this.nav, nx = NAV_GRID.nx;
    const navOf = (ii: number, jj: number) => (b.j0 + jj) * nx + b.i0 + ii;
    const nu = navOf(i, j);
    let straight = 0;
    for (let k = 0; k < 8; k++) {
      const vi = i + DI[k], vj = j + DJ[k];
      if (vi < 0 || vj < 0 || vi >= b.ni || vj >= b.nj) continue;
      const nv = navOf(vi, vj);
      if (k < 4) {
        if (!nav.passable(nu, nv)) continue;
        straight |= 1 << k;
      } else {
        const a = DIAG_A[k], bb = DIAG_B[k];
        if (!(straight & (1 << a)) || !(straight & (1 << bb))) continue;
        if (!nav.passable(navOf(i + DI[a], j + DJ[a]), nv) || !nav.passable(navOf(i + DI[bb], j + DJ[bb]), nv)) continue;
      }
      const drop = du - f[vj * b.ni + vi];
      if (drop <= 0) continue;
      const s = drop / (k < 4 ? 5 : 7);
      out[0] += UX[k] * s;
      out[1] += UZ[k] * s;
    }
  }
}
