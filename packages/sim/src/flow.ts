// Flow fields over the nav grid (phase 2 M2). A field holds, for every cell,
// the cost of the cheapest walk from that cell to its goal, so a minion
// anywhere steps towards lower cost and finds its way round water, walls,
// rubble piles and craters.
//
// Costs are integers: 5 per straight step and 7 per diagonal one (never past
// a corner), times the field's weight for the cell walked from (2 on its
// route, up to 6 far off it, so a wave keeps to its route but takes another
// bridge when its own is down), plus a fixed charge to pass a gate that
// still stands: in a field with doors, the gate leaves of the castle being
// marched on count as walkable (the minions who reach them batter them
// down); in a field without, a standing gate is a wall.
//
// A field may have a second, fallback goal (the ground in front of the enemy
// gate), seeded at APPROACH_BASE in the same Dijkstra order: wherever the
// real goal can be reached it is far cheaper, so the fallback only leads
// where the goal is cut off (rubble in the gateway), and a wave then marches
// to the gate and stands there instead of wherever it was when the way shut.
//
// Fields are built with Dial's bucket queue (first in, first out within a
// cost) and a fixed amount of work per tick, double buffered: minions read
// the last finished field while the next one is built. A field is rebuilt
// when the nav grid's topology has changed since it was built, in turn, so a
// refresh costs the same on every machine and never stalls a frame.
// Deterministic: integer costs, fixed neighbour order, no clocks.

import type { CastleLayout, Rect } from "@keepfall/content";
import { dsqrt } from "@keepfall/core";
import type { CastleSim } from "./castleSim";
import { NAV_GRID, NAV_RUBBLE_STEP, NAV_STEP, NavKind, navStep, navWalkable, type NavGrid } from "./nav";

/** Cost where the goal cannot be reached. */
export const FLOW_INF = 0x3fffffff;
/**
 * Cost of a field's fallback goal cells (FieldSpec.approach): a cell whose
 * cost is under this reaches the real goal; at or over it, only the
 * fallback. Well above the dearest real cost (about 4400, a flank field with
 * the centre bridge down).
 */
export const APPROACH_BASE = 20000;
/** Extra cost to walk through a standing gate (in a field with doors). */
const DOOR = 150;
const BUCKETS = 256; // more than the dearest step (7 * 6 + DOOR)
/** Walk floor of a cell that cannot be walked (far beyond any step). */
const UNWALK = 1e9;
const MASK = BUCKETS - 1;
/** Straight and diagonal step costs, before weights. */
const STRAIGHT = 5;
const DIAGONAL = 7;
/** Neighbour order: four straight, then four diagonal (each diagonal's two straight cells by index). */
const DI = [-1, 1, 0, 0, -1, 1, -1, 1];
const DJ = [0, 0, -1, 1, -1, -1, 1, 1];
const DIAG_A = [0, 0, 0, 0, 0, 1, 0, 1]; // straight neighbour sharing the diagonal's i
const DIAG_B = [0, 0, 0, 0, 2, 2, 3, 3]; // and the one sharing its j
const UNIT = 0.7071067811865476;
const UX = [-1, 1, 0, 0, -UNIT, UNIT, -UNIT, UNIT];
const UZ = [0, 0, -1, 1, -UNIT, -UNIT, UNIT, UNIT];

export interface FieldSpec {
  /** Goal cells, cost 0: every cell whose centre lies in the rectangle. */
  goal: Rect;
  /** Fallback goal cells, cost APPROACH_BASE (where the goal cannot be reached, the field leads here), or null for none. */
  approach: Rect | null;
  /** Weight per cell (2 on the route, more off it), or null for 2 everywhere. */
  weight: Uint8Array | null;
  /** Castle (0 or 1) whose standing gate leaves are doors, or -1 for none. */
  doors: number;
}

/** The cells fields may cover: the valley floor between and around the castles. */
export const FLOW_REGION = { x0: -72, x1: 72, z0: -180, z1: 28 } as const;

export class FlowFields {
  readonly count: number;
  /** Finished costs per field (FLOW_INF where the goal cannot be reached). */
  readonly dist: Int32Array[];
  /** The nav grid's topology version each finished field was built from (-1: never). */
  readonly built: Int32Array;
  /** Fields finished since the start, for tests and the HUD. */
  builds = 0;
  private specs: FieldSpec[];
  private nav: NavGrid;
  private castle: CastleSim;
  private layout: CastleLayout;
  /** Gate leaf (stone id) covering each cell, or -1. */
  private doorLeaf: Int32Array;
  /** The gate leaves, in id order. */
  private leaves: number[] = [];
  /**
   * Per stone id, 1 for a gate leaf that stands in its place (standing, or
   * loose but upright where it hung): as of the build in progress (read at
   * its start), and as of the last physics step (for minions asking now).
   */
  private leafBuild: Uint8Array;
  private leafNow: Uint8Array;
  private leafStep = -1;
  /** Each field's fallback goal cells (in cell order), and whether the build in progress has yet to seed them. */
  private approach: Int32Array[];
  private approachDue = false;
  private i0: number;
  private i1: number;
  private j0: number;
  private j1: number;
  // The build in progress.
  private cur = -1;
  private curTopo = 0;
  private last = -1;
  private work: Int32Array;
  /** The build's walking height per cell (UNWALK where it cannot be walked), so a step test is one read; and 1 where it is rubble (a bigger step). */
  private wf: Float32Array;
  private wr: Uint8Array;
  /** Neighbour offsets in cell index, in the DI/DJ order. */
  private off = DI.map((di, k) => di + DJ[k] * NAV_GRID.nx);
  private head = new Int32Array(BUCKETS).fill(-1);
  private tail = new Int32Array(BUCKETS).fill(-1);
  private bucket = 0;
  private queued = 0;
  private nCell: Int32Array;
  private nDist: Int32Array;
  private nNext: Int32Array;
  private free = -1;
  private top = 0;

  constructor(nav: NavGrid, castle: CastleSim, specs: FieldSpec[]) {
    this.nav = nav;
    this.castle = castle;
    this.layout = castle.layout;
    this.specs = specs;
    this.count = specs.length;
    const cells = NAV_GRID.nx * NAV_GRID.nz;
    this.dist = specs.map(() => new Int32Array(cells).fill(FLOW_INF));
    this.work = new Int32Array(cells).fill(FLOW_INF);
    this.wf = new Float32Array(cells).fill(UNWALK);
    this.wr = new Uint8Array(cells);
    this.built = new Int32Array(specs.length).fill(-1);
    const g = NAV_GRID;
    this.i0 = Math.max(0, Math.floor((FLOW_REGION.x0 - g.x0) / g.cell));
    this.i1 = Math.min(g.nx - 1, Math.floor((FLOW_REGION.x1 - g.x0) / g.cell));
    this.j0 = Math.max(0, Math.floor((FLOW_REGION.z0 - g.z0) / g.cell));
    this.j1 = Math.min(g.nz - 1, Math.floor((FLOW_REGION.z1 - g.z0) / g.cell));
    // A ring of cells outside the region (never walkable for a field) keeps neighbour steps inside the grid.
    if (this.i0 < 1 || this.j0 < 1 || this.i1 > g.nx - 2 || this.j1 > g.nz - 2) throw new Error("flow region must sit inside the nav grid");
    const region = (this.i1 - this.i0 + 1) * (this.j1 - this.j0 + 1);
    this.nCell = new Int32Array(region * 2);
    this.nDist = new Int32Array(region * 2);
    this.nNext = new Int32Array(region * 2);
    this.doorLeaf = new Int32Array(cells).fill(-1);
    for (const s of this.layout.stones) {
      if (s.part !== "gate") continue;
      this.leaves.push(s.id);
      for (const c of nav.pieceCells(s.id)) this.doorLeaf[c] = s.id;
    }
    this.leafBuild = new Uint8Array(this.layout.stones.length);
    this.leafNow = new Uint8Array(this.layout.stones.length);
    this.approach = specs.map((s) => (s.approach ? this.cellsIn(s.approach) : new Int32Array(0)));
  }

  /** The region's cells whose centres lie in a rectangle, in cell order. */
  private cellsIn(r: Rect): Int32Array {
    const G = NAV_GRID;
    const out: number[] = [];
    for (let j = this.j0; j <= this.j1; j++) {
      const z = G.z0 + (j + 0.5) * G.cell;
      if (z < r.z0 || z > r.z1) continue;
      for (let i = this.i0; i <= this.i1; i++) {
        const x = G.x0 + (i + 0.5) * G.cell;
        if (x >= r.x0 && x <= r.x1) out.push(j * G.nx + i);
      }
    }
    return Int32Array.from(out);
  }

  /** Which gate leaves stand in their places, into `up` (one read of each leaf's body). */
  private readLeaves(up: Uint8Array) {
    for (const id of this.leaves) up[id] = this.castle.standsInPlace(id) ? 1 : 0;
  }

  /** The leaves as of the last physics step (read once a step, for minions asking now). */
  private leavesNow(): Uint8Array {
    if (this.leafStep !== this.castle.steps) {
      this.leafStep = this.castle.steps;
      this.readLeaves(this.leafNow);
    }
    return this.leafNow;
  }

  /** Build every field now, however long it takes (at load). */
  buildAll() {
    for (let f = 0; f < this.count; f++) {
      this.start(f);
      this.run(Infinity);
    }
  }

  /** Spend at most `budget` cell visits refreshing stale fields, in turn. Call once a tick. */
  step(budget: number) {
    while (budget > 0) {
      if (this.cur < 0) {
        const f = this.nextStale();
        if (f < 0) return;
        budget -= this.start(f);
      }
      budget -= this.run(budget);
    }
  }

  /** Is any field older than the nav grid (or being rebuilt)? */
  get stale(): boolean {
    return this.cur >= 0 || this.nextStale() >= 0;
  }

  private nextStale(): number {
    const topo = this.nav.topo;
    for (let k = 1; k <= this.count; k++) {
      const f = (this.last + k) % this.count;
      if (this.built[f] !== topo) return f;
    }
    return -1;
  }

  /**
   * The gate leaf in a cell that field f treats as a door, or -1: a leaf of
   * the castle it marches on that stands in its place by `up` (standing, or
   * knocked loose but still upright where it hung: minions batter it on).
   */
  private door(f: number, c: number, up: Uint8Array): number {
    const id = this.doorLeaf[c];
    if (id < 0) return -1;
    const d = this.specs[f].doors;
    if (d < 0 || this.layout.stones[id].castle !== d || !up[id]) return -1;
    return id;
  }

  /** Walkable for field f (doors count), and the floor it walks at. */
  private walk(f: number, c: number, up: Uint8Array): boolean {
    return navWalkable(this.nav.kind[c]) || this.door(f, c, up) >= 0;
  }

  private floorOf(f: number, c: number, up: Uint8Array): number {
    return this.door(f, c, up) >= 0 ? this.nav.groundFloor(c) : this.nav.floor[c];
  }

  /** Can field f step between neighbouring cells a and b? */
  private trav(f: number, a: number, b: number, up: Uint8Array): boolean {
    if (!this.walk(f, a, up) || !this.walk(f, b, up)) return false;
    const d = this.floorOf(f, a, up) - this.floorOf(f, b, up);
    const lim = navStep(this.nav.kind[a], this.nav.kind[b]);
    return d <= lim && d >= -lim;
  }

  /** Start building field f. Returns the work it took, in cell visits. */
  private start(f: number): number {
    this.cur = f;
    this.curTopo = this.nav.topo;
    const w = this.work, nx = NAV_GRID.nx;
    const wf = this.wf, wr = this.wr, kind = this.nav.kind, floor = this.nav.floor, leaf = this.doorLeaf;
    const up = this.leafBuild;
    this.readLeaves(up);
    for (let j = this.j0; j <= this.j1; j++) {
      w.fill(FLOW_INF, j * nx + this.i0, j * nx + this.i1 + 1);
      for (let c = j * nx + this.i0, e = j * nx + this.i1; c <= e; c++) {
        wr[c] = kind[c] === NavKind.Rubble ? 1 : 0;
        if (leaf[c] >= 0 && this.door(f, c, up) >= 0) wf[c] = this.nav.groundFloor(c);
        else wf[c] = navWalkable(kind[c]) ? floor[c] : UNWALK;
      }
    }
    this.head.fill(-1);
    this.tail.fill(-1);
    this.bucket = 0;
    this.queued = 0;
    this.free = -1;
    this.top = 0;
    const g = this.specs[f].goal;
    const G = NAV_GRID;
    for (let j = this.j0; j <= this.j1; j++) {
      const z = G.z0 + (j + 0.5) * G.cell;
      if (z < g.z0 || z > g.z1) continue;
      for (let i = this.i0; i <= this.i1; i++) {
        const x = G.x0 + (i + 0.5) * G.cell;
        if (x < g.x0 || x > g.x1) continue;
        const c = j * nx + i;
        if (wf[c] === UNWALK) continue;
        w[c] = 0;
        this.push(0, c);
      }
    }
    this.approachDue = this.approach[f].length > 0;
    return ((this.i1 - this.i0 + 1) * (this.j1 - this.j0 + 1)) >> 3;
  }

  /**
   * Seed the build's fallback goal cells at APPROACH_BASE, where they cost
   * more (the real goal is cut off from them). Called when the frontier
   * reaches APPROACH_BASE or the queue runs dry before it: every cell still
   * queued then costs from APPROACH_BASE to less than a bucket round past it,
   * so the bucket queue stays in order. Returns the work it took.
   */
  private seedApproach(): number {
    this.approachDue = false;
    const w = this.work, wf = this.wf;
    const cells = this.approach[this.cur];
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      if (wf[c] === UNWALK || w[c] <= APPROACH_BASE) continue;
      w[c] = APPROACH_BASE;
      this.push(APPROACH_BASE, c);
    }
    this.bucket = APPROACH_BASE & MASK;
    return cells.length;
  }

  private push(d: number, c: number) {
    let n = this.free;
    if (n >= 0) this.free = this.nNext[n];
    else {
      if (this.top >= this.nCell.length) this.grow();
      n = this.top++;
    }
    this.nCell[n] = c;
    this.nDist[n] = d;
    this.nNext[n] = -1;
    const b = d & MASK;
    if (this.tail[b] < 0) this.head[b] = n;
    else this.nNext[this.tail[b]] = n;
    this.tail[b] = n;
    this.queued++;
  }

  private grow() {
    const size = this.nCell.length * 2;
    for (const k of ["nCell", "nDist", "nNext"] as const) {
      const a = new Int32Array(size);
      a.set(this[k]);
      this[k] = a;
    }
  }

  /** Visit up to `budget` cells of the build in progress; finish it when the queue runs dry. Returns the visits made. */
  private run(budget: number): number {
    const f = this.cur;
    const w = this.work, wf = this.wf, wr = this.wr, leaf = this.doorLeaf, up = this.leafBuild;
    const weight = this.specs[f].weight;
    const off = this.off;
    let visits = 0;
    while (visits < budget) {
      if (this.queued === 0) {
        if (!this.approachDue) break;
        visits += this.seedApproach();
        continue;
      }
      while (this.head[this.bucket] < 0) this.bucket = (this.bucket + 1) & MASK;
      const n = this.head[this.bucket];
      if (this.approachDue && this.nDist[n] >= APPROACH_BASE) {
        visits += this.seedApproach();
        continue;
      }
      this.head[this.bucket] = this.nNext[n];
      if (this.head[this.bucket] < 0) this.tail[this.bucket] = -1;
      this.queued--;
      const u = this.nCell[n], d = this.nDist[n];
      this.nNext[n] = this.free;
      this.free = n;
      visits++;
      if (d > w[u]) continue; // a stale entry: u was reached more cheaply since
      // Cells outside the region read as unwalkable, so no bounds checks are needed.
      const fu = wf[u], ru = wr[u];
      let straight = 0; // bit k: straight neighbour k is traversable
      for (let k = 0; k < 8; k++) {
        const v = u + off[k];
        const fv = wf[v];
        if (fv === UNWALK) continue;
        const rv = wr[v];
        if (k < 4) {
          const lim = ru | rv ? NAV_RUBBLE_STEP : NAV_STEP;
          if (fu - fv > lim || fv - fu > lim) continue;
          straight |= 1 << k;
        } else {
          // Diagonal: both straight cells beside it must be open both ways.
          const a = DIAG_A[k], b = DIAG_B[k];
          if (!(straight & (1 << a)) || !(straight & (1 << b))) continue;
          const ca = u + off[a], cb = u + off[b];
          const la = wr[ca] | rv ? NAV_RUBBLE_STEP : NAV_STEP, lb = wr[cb] | rv ? NAV_RUBBLE_STEP : NAV_STEP;
          const fa = wf[ca], fb = wf[cb];
          if (fa - fv > la || fv - fa > la || fb - fv > lb || fv - fb > lb) continue;
        }
        let cost = (k < 4 ? STRAIGHT : DIAGONAL) * (weight ? weight[v] : 2);
        if (leaf[v] >= 0 && this.door(f, v, up) >= 0) cost += DOOR;
        const nd = d + cost;
        if (nd < w[v]) {
          w[v] = nd;
          this.push(nd, v);
        }
      }
    }
    if (this.queued === 0 && !this.approachDue) {
      // Done: the new field replaces the old one, whose buffer is reused for the next build.
      const old = this.dist[f];
      this.dist[f] = w;
      this.work = old;
      this.built[f] = this.curTopo;
      this.last = f;
      this.cur = -1;
      this.builds++;
    }
    return visits;
  }

  /** Cost to field f's goal from the cell under (x, z) (FLOW_INF if none). */
  at(f: number, x: number, z: number): number {
    const c = cellAt(x, z);
    return c < 0 ? FLOW_INF : this.dist[f][c];
  }

  /** Does field f's cost at (x, z) lead to its real goal (not only to the fallback ground before the gate, nor nowhere)? */
  reachesGoal(f: number, x: number, z: number): boolean {
    return this.at(f, x, z) < APPROACH_BASE;
  }

  /**
   * Which way to walk from (x, z) on field f: a unit vector into `out`, or
   * false where there is none (at the goal, or cut off from it). Blends the
   * downhill directions (each a unit vector) of the four cells around the
   * point, so the way turns smoothly from cell to cell; but only of those
   * the cell under the point can step to (itself, a straight neighbour, a
   * diagonal one through both straight ones), so a cell he cannot climb to
   * never pulls him into its step. Standing on a cell the field cannot walk
   * (it just became water or a heap), he follows any walkable one around.
   */
  dir(f: number, x: number, z: number, out: [number, number]): boolean {
    const G = NAV_GRID;
    const up = this.leavesNow();
    const fx = (x - G.x0) / G.cell - 0.5, fz = (z - G.z0) / G.cell - 0.5;
    const ci = Math.floor(fx), cj = Math.floor(fz);
    const tx = fx - ci, tz = fz - cj;
    // The cell under the point is one of the four: the one each axis rounds to.
    const oi = tx < 0.5 ? ci : ci + 1, oj = tz < 0.5 ? cj : cj + 1;
    const own = oj * G.nx + oi;
    const inside = oi >= this.i0 && oi <= this.i1 && oj >= this.j0 && oj <= this.j1;
    const free = !inside || !this.walk(f, own, up);
    let sx = 0, sz = 0;
    for (let k = 0; k < 4; k++) {
      const i = ci + (k & 1), j = cj + (k >> 1);
      if (i < this.i0 || i > this.i1 || j < this.j0 || j > this.j1) continue;
      const wgt = (k & 1 ? tx : 1 - tx) * (k >> 1 ? tz : 1 - tz);
      if (wgt <= 0) continue;
      const c = j * G.nx + i;
      if (!this.walk(f, c, up)) continue;
      if (!free && c !== own) {
        if (i === oi || j === oj) {
          if (!this.trav(f, own, c, up)) continue;
        } else {
          // Diagonal: through both straight cells beside it.
          const a = oj * G.nx + i, b = j * G.nx + oi;
          if (!this.trav(f, own, a, up) || !this.trav(f, a, c, up) || !this.trav(f, own, b, up) || !this.trav(f, b, c, up)) continue;
        }
      }
      this.cellDir(f, c, out, up);
      sx += out[0] * wgt;
      sz += out[1] * wgt;
    }
    const len2 = sx * sx + sz * sz;
    if (len2 < 1e-10) return false;
    const inv = 1 / dsqrt(len2);
    out[0] = sx * inv;
    out[1] = sz * inv;
    return true;
  }

  /** The downhill direction of one cell, as a unit vector (zero at the goal or cut off). */
  private cellDir(f: number, c: number, out: [number, number], up: Uint8Array) {
    const D = this.dist[f];
    const dc = D[c];
    out[0] = 0;
    out[1] = 0;
    if (dc >= FLOW_INF) return;
    const nx = NAV_GRID.nx;
    const i = c % nx, j = (c - i) / nx;
    let straight = 0;
    let sx = 0, sz = 0;
    for (let k = 0; k < 8; k++) {
      const vi = i + DI[k], vj = j + DJ[k];
      if (vi < this.i0 || vi > this.i1 || vj < this.j0 || vj > this.j1) continue;
      const v = vj * nx + vi;
      if (k < 4) {
        if (!this.trav(f, c, v, up)) continue;
        straight |= 1 << k;
      } else {
        const a = DIAG_A[k], b = DIAG_B[k];
        if (!(straight & (1 << a)) || !(straight & (1 << b))) continue;
        if (!this.trav(f, c + DI[a], v, up) || !this.trav(f, c + DJ[b] * nx, v, up)) continue;
      }
      const drop = dc - D[v];
      if (drop <= 0) continue;
      const s = drop / (k < 4 ? STRAIGHT : DIAGONAL);
      sx += UX[k] * s;
      sz += UZ[k] * s;
    }
    const len2 = sx * sx + sz * sz;
    if (len2 < 1e-10) return;
    const inv = 1 / dsqrt(len2);
    out[0] = sx * inv;
    out[1] = sz * inv;
  }

  /**
   * The gate leaf (stone id) of a door that field f leads into just ahead of
   * (x, z) along (dx, dz), if it still stands in its place: where marching
   * minions stop and batter. -1 if none.
   */
  doorAhead(f: number, x: number, z: number, dx: number, dz: number, reach: number): number {
    const c = cellAt(x + dx * reach, z + dz * reach);
    if (c < 0 || this.doorLeaf[c] < 0) return -1;
    return this.door(f, c, this.leavesNow());
  }
}

/** The nav cell under a point (-1 outside the grid). */
function cellAt(x: number, z: number): number {
  const G = NAV_GRID;
  const i = Math.floor((x - G.x0) / G.cell), j = Math.floor((z - G.z0) / G.cell);
  if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) return -1;
  return j * G.nx + i;
}
