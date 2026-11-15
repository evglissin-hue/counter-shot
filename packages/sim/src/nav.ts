// The nav grid: where minions can walk. One cell per square metre of the
// terrain grid (cell (i, j) spans vertices (i, j) to (i + 1, j + 1)), each with
// a floor height and a kind:
// - the ground's height, unless water stands deeper than wading depth there
//   (only in the stream's channel: a crater pit elsewhere is dry) or the
//   ground is too steep;
// - in the stream, only an intact deck plank makes a floor: wreckage, the
//   fallen and the timbers of a lost deck leave the water as it was;
// - pieces standing on the floor raise it (walls stack up course by course,
//   rubble adds its height), so neighbours more than a step apart are not
//   connected: an intact wall is an obstacle, a low heap of rubble is not;
// - an intact bridge deck plank is a floor, whatever lies under it;
// - a piece high enough overhead (the wall over a broken gate) leaves the
//   way open, and one lower than headroom blocks the cell.
// Only standing (fixed) pieces, settled (frozen) rubble and fallen bodies
// count: moving pieces do not, and shattered ones are gone. The grid updates
// on fixed ticks, only for the cells around whatever changed, and keeps a
// topology version that bumps only when a step between neighbours opens or
// closes (what flow fields depend on). It steers minions, so it is
// deterministic: poses from the deterministic Rapier build, + - * / and
// comparisons, and a fixed order everywhere.

import { MID_Z, STREAM, stoneBounds, streamOffset, streamSlope, streamWidth, type BridgeSite, type CastleLayout } from "@keepfall/content";
import { dsqrt } from "@keepfall/core";
import type { CastleSim } from "./castleSim";
import { TERRAIN_GRID } from "./frame";
import type { Terrain } from "./terrain";

export const enum NavKind {
  /** Open ground. */
  Ground = 0,
  /** Walkable on top of something: a bridge deck, rubble, a wall top. */
  Raised = 1,
  /** Water deeper than wading depth. */
  Water = 2,
  /** Ground too steep to walk. */
  Steep = 3,
  /** Something in the way with no room to pass under it. */
  Blocked = 4,
  /** Walkable on top of settled rubble or the fallen: a heap you can scramble over. */
  Rubble = 5,
}

/** The highest step up between neighbouring cells. */
export const NAV_STEP = 0.6;
/** The highest step up onto or off a rubble cell: minions scramble over heaps, not up masonry. */
export const NAV_RUBBLE_STEP = 1.0;
/** Headroom a minion needs under anything overhead. */
export const NAV_HEAD = 1.9;
/** Water deeper than this blocks. */
const WADE = 0.25;
/** Rise across one cell beyond which the ground is too steep. */
const STEEP = 0.8;
/** A piece covers a cell when its footprint reaches the cell's central half metre. */
const INNER = 0.25;

/** Cells of the grid, and the cell under a point. */
export const NAV_GRID = {
  x0: TERRAIN_GRID.x0,
  z0: TERRAIN_GRID.z0,
  cell: TERRAIN_GRID.cell,
  nx: TERRAIN_GRID.nx - 1,
  nz: TERRAIN_GRID.nz - 1,
} as const;

export function navCell(x: number, z: number): number {
  const i = Math.floor((x - NAV_GRID.x0) / NAV_GRID.cell);
  const j = Math.floor((z - NAV_GRID.z0) / NAV_GRID.cell);
  if (i < 0 || j < 0 || i >= NAV_GRID.nx || j >= NAV_GRID.nz) return -1;
  return j * NAV_GRID.nx + i;
}

export function navWalkable(kind: number): boolean {
  return kind === NavKind.Ground || kind === NavKind.Raised || kind === NavKind.Rubble;
}

/** The highest step between two walkable cells of these kinds. */
export function navStep(a: number, b: number): number {
  return a === NavKind.Rubble || b === NavKind.Rubble ? NAV_RUBBLE_STEP : NAV_STEP;
}

/** The layout's pieces by cell, sorted by their bottoms: built once per layout. */
interface StaticIndex {
  off: Int32Array;
  ids: Int32Array;
  bottom: Float32Array;
  top: Float32Array;
  deck: Uint8Array;
}
const staticCache = new WeakMap<CastleLayout, StaticIndex>();

/** Range of cells along one axis whose central half metre overlaps [lo, hi]. */
function cellSpan(lo: number, hi: number, origin: number, count: number): [number, number] {
  const c = NAV_GRID.cell;
  let a = Math.floor((lo - origin) / c - 0.5 - INNER) + 1;
  let b = Math.ceil((hi - origin) / c - 0.5 + INNER) - 1;
  if (a < 0) a = 0;
  if (b > count - 1) b = count - 1;
  return [a, b];
}

function buildStatic(layout: CastleLayout): StaticIndex {
  const cached = staticCache.get(layout);
  if (cached) return cached;
  const n = layout.stones.length;
  const cells = NAV_GRID.nx * NAV_GRID.nz;
  const bottom = new Float32Array(n), top = new Float32Array(n), deck = new Uint8Array(n);
  const spans = new Int32Array(n * 4).fill(-1);
  const count = new Int32Array(cells + 1);
  const banners = layout.bannerIds;
  for (let id = 0; id < n; id++) {
    const s = layout.stones[id];
    if (id === banners[0] || id === banners[1]) continue;
    const b = stoneBounds(s, layout.wedge);
    bottom[id] = b[1];
    top[id] = b[4];
    deck[id] = s.deck ? 1 : 0;
    const [i0, i1] = cellSpan(b[0], b[3], NAV_GRID.x0, NAV_GRID.nx);
    const [j0, j1] = cellSpan(b[2], b[5], NAV_GRID.z0, NAV_GRID.nz);
    if (i0 > i1 || j0 > j1) continue;
    spans.set([i0, i1, j0, j1], id * 4);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) count[j * NAV_GRID.nx + i + 1]++;
  }
  const off = new Int32Array(cells + 1);
  for (let c = 0; c < cells; c++) off[c + 1] = off[c] + count[c + 1];
  const fill = off.slice(0, cells);
  const ids = new Int32Array(off[cells]);
  for (let id = 0; id < n; id++) {
    const i0 = spans[id * 4];
    if (i0 < 0) continue;
    const i1 = spans[id * 4 + 1], j0 = spans[id * 4 + 2], j1 = spans[id * 4 + 3];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) ids[fill[j * NAV_GRID.nx + i]++] = id;
  }
  // Each cell's pieces by bottom, then id (insertion sort: lists are short).
  for (let c = 0; c < cells; c++) {
    for (let k = off[c] + 1; k < off[c + 1]; k++) {
      const v = ids[k];
      let m = k - 1;
      while (m >= off[c] && (bottom[ids[m]] > bottom[v] || (bottom[ids[m]] === bottom[v] && ids[m] > v))) {
        ids[m + 1] = ids[m];
        m--;
      }
      ids[m + 1] = v;
    }
  }
  const idx = { off, ids, bottom, top, deck };
  staticCache.set(layout, idx);
  return idx;
}

let channelCache: Uint8Array | null = null;

/**
 * 1 for cells whose centres lie in the stream's channel: within its half
 * width and a bank of its centreline (measured square to it, as the valley
 * cuts it). Built once.
 */
function streamChannel(): Uint8Array {
  if (channelCache) return channelCache;
  const G = NAV_GRID;
  const out = new Uint8Array(G.nx * G.nz);
  for (let i = 0; i < G.nx; i++) {
    const x = G.x0 + (i + 0.5) * G.cell;
    const mid = MID_Z + streamOffset(x), slope = streamSlope(x);
    const reach = (streamWidth(x) / 2 + STREAM.bank) * dsqrt(1 + slope * slope);
    for (let j = 0; j < G.nz; j++) {
      const z = G.z0 + (j + 0.5) * G.cell;
      if (z - mid < reach && mid - z < reach) out[j * G.nx + i] = 1;
    }
  }
  channelCache = out;
  return out;
}

/** A settled piece (or fallen body) over one cell, and the floor it leaves there. */
interface SettledEntry {
  key: number;
  bottom: number;
  top: number;
}

/** Piece states as the nav grid last saw them. */
const enum PieceState {
  Standing = 0,
  Moving = 1,
  Settled = 2,
  Gone = 3,
}

export class NavGrid {
  readonly nx = NAV_GRID.nx;
  readonly nz = NAV_GRID.nz;
  /** Walking surface height per cell. */
  readonly floor: Float32Array;
  /** NavKind per cell. */
  readonly kind: Uint8Array;
  /** Bumps whenever a cell changes. */
  version = 0;
  /** Bumps only when walking between some pair of neighbours became possible or impossible. */
  topo = 0;
  private castle: CastleSim;
  /** Per cell: can you step to the neighbour at +x (bit 1) and at +z (bit 2)? */
  private edges: Uint8Array;
  /** Keys of fallen bodies start here, after every piece id. */
  private bodyBase: number;
  private terrain: Terrain;
  private idx: StaticIndex;
  private state: Uint8Array;
  /**
   * Settled rubble and fallen bodies, indexed per cell: each entry is a piece
   * (or body) lying over that cell, with the floor it leaves there (its box's
   * bottom and top over the cell's centre). `settled` keeps each key's cells
   * so it can be removed. Heights are per cell, from the piece's oriented box,
   * so a leaning slab reads as tall only over the cells it truly covers.
   */
  private settledAt = new Map<number, SettledEntry[]>();
  private settled = new Map<number, number[]>();
  private dirtyMark: Uint8Array;
  private dirty: number[] = [];
  private scratchB = new Float32Array(256);
  private scratchT = new Float32Array(256);
  private scratchD = new Uint8Array(256);
  /** 1 for settled rubble and bodies, 0 for standing pieces. */
  private scratchS = new Uint8Array(256);
  private queue: Int32Array;
  private seen: Uint8Array;
  /** 1 for cells in the stream's channel (its water and banks): the only place water stands. */
  private channel: Uint8Array;

  constructor(castle: CastleSim, terrain: Terrain) {
    this.castle = castle;
    this.terrain = terrain;
    const cells = this.nx * this.nz;
    this.floor = new Float32Array(cells);
    this.kind = new Uint8Array(cells);
    this.dirtyMark = new Uint8Array(cells);
    this.queue = new Int32Array(cells);
    this.seen = new Uint8Array(cells);
    this.channel = streamChannel();
    this.idx = buildStatic(castle.layout);
    const n = castle.layout.stones.length;
    this.state = new Uint8Array(n);
    for (let id = 0; id < n; id++) this.state[id] = this.stateOf(id);
    this.bodyBase = n;
    for (let c = 0; c < cells; c++) this.compute(c);
    this.edges = new Uint8Array(cells);
    for (let c = 0; c < cells; c++) this.edges[c] = this.edgeBits(c);
  }

  private edgeBits(c: number): number {
    const i = c % this.nx;
    let b = 0;
    if (i + 1 < this.nx && this.passable(c, c + 1)) b |= 1;
    if (c + this.nx < this.kind.length && this.passable(c, c + this.nx)) b |= 2;
    return b;
  }

  private stateOf(id: number): PieceState {
    const c = this.castle;
    if (c.shattered[id]) return PieceState.Gone;
    if (c.frozen[id]) return PieceState.Settled;
    if (c.dynamic[id]) return PieceState.Moving;
    return PieceState.Standing;
  }

  private mark(c: number) {
    if (this.dirtyMark[c]) return;
    this.dirtyMark[c] = 1;
    this.dirty.push(c);
  }

  private markRect(i0: number, i1: number, j0: number, j1: number) {
    if (i0 < 0) i0 = 0;
    if (j0 < 0) j0 = 0;
    if (i1 > this.nx - 1) i1 = this.nx - 1;
    if (j1 > this.nz - 1) j1 = this.nz - 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.mark(j * this.nx + i);
  }

  /** Where a piece stood in the layout: its cells go dirty. */
  private markStanding(id: number) {
    const b = stoneBounds(this.castle.layout.stones[id], this.castle.layout.wedge);
    const [i0, i1] = cellSpan(b[0], b[3], NAV_GRID.x0, this.nx);
    const [j0, j1] = cellSpan(b[2], b[5], NAV_GRID.z0, this.nz);
    this.markRect(i0, i1, j0, j1);
  }

  /**
   * A piece settled: index each cell its oriented box covers with the box's
   * bottom and top over that cell's centre, so a leaning slab or a tilted
   * block reads as tall and wide only where it truly lies. A cuboid is cut by
   * a vertical line through the cell centre (an oriented-box slab test); a
   * wedge falls back to its axis-aligned bounds, uniform over its footprint.
   */
  private addSettled(id: number) {
    const L = this.castle.layout;
    const s = L.stones[id];
    const body = this.castle.bodies[id];
    const t = body.translation(), r = body.rotation();
    const b = this.pieceWorldBounds(id);
    const [i0, i1] = cellSpan(b[0], b[3], NAV_GRID.x0, this.nx);
    const [j0, j1] = cellSpan(b[2], b[5], NAV_GRID.z0, this.nz);
    const cells: number[] = [];
    const g = NAV_GRID;
    const box = s.shape !== "wedge";
    // The inverse rotation as a 3x3 matrix (columns, built once from the conjugate quaternion):
    // the box's local frame. Its middle column is the local direction of a vertical world line.
    const qx = -r.x, qy = -r.y, qz = -r.z, qw = r.w;
    const m00 = rotX(qx, qy, qz, qw, 1, 0, 0), m10 = rotY(qx, qy, qz, qw, 1, 0, 0), m20 = rotZ(qx, qy, qz, qw, 1, 0, 0);
    const ldx = rotX(qx, qy, qz, qw, 0, 1, 0), ldy = rotY(qx, qy, qz, qw, 0, 1, 0), ldz = rotZ(qx, qy, qz, qw, 0, 1, 0);
    const m02 = rotX(qx, qy, qz, qw, 0, 0, 1), m12 = rotY(qx, qy, qz, qw, 0, 0, 1), m22 = rotZ(qx, qy, qz, qw, 0, 0, 1);
    const hx = s.hx, hy = s.hy, hz = s.hz;
    const oy = -t.y;
    // Slab bounds along each local axis for a non-zero local-direction component (constant per piece).
    const invx = ldx > 1e-9 || ldx < -1e-9 ? 1 / ldx : 0;
    const invy = ldy > 1e-9 || ldy < -1e-9 ? 1 / ldy : 0;
    const invz = ldz > 1e-9 || ldz < -1e-9 ? 1 / ldz : 0;
    for (let j = j0; j <= j1; j++) {
      const cz = g.z0 + (j + 0.5) * g.cell;
      for (let i = i0; i <= i1; i++) {
        const cx = g.x0 + (i + 0.5) * g.cell;
        let bottom: number, top: number;
        if (box) {
          // The vertical world line through the cell centre in the box's local frame.
          const ox = cx - t.x, oz = cz - t.z;
          const lpx = m00 * ox + ldx * oy + m02 * oz;
          const lpy = m10 * ox + ldy * oy + m12 * oz;
          const lpz = m20 * ox + ldz * oy + m22 * oz;
          let smin = -Infinity, smax = Infinity, miss = false;
          if (invx) { const sa = (-hx - lpx) * invx, sb = (hx - lpx) * invx; if (sa < sb) { if (sa > smin) smin = sa; if (sb < smax) smax = sb; } else { if (sb > smin) smin = sb; if (sa < smax) smax = sa; } }
          else if (lpx < -hx || lpx > hx) miss = true;
          if (!miss && invy) { const sa = (-hy - lpy) * invy, sb = (hy - lpy) * invy; if (sa < sb) { if (sa > smin) smin = sa; if (sb < smax) smax = sb; } else { if (sb > smin) smin = sb; if (sa < smax) smax = sa; } }
          else if (!miss && !invy && (lpy < -hy || lpy > hy)) miss = true;
          if (!miss && invz) { const sa = (-hz - lpz) * invz, sb = (hz - lpz) * invz; if (sa < sb) { if (sa > smin) smin = sa; if (sb < smax) smax = sb; } else { if (sb > smin) smin = sb; if (sa < smax) smax = sa; } }
          else if (!miss && !invz && (lpz < -hz || lpz > hz)) miss = true;
          if (miss || smin > smax) continue; // the cell's centre is not under the box
          // World y along the vertical line equals the parameter sigma (direction is unit +y).
          bottom = smin;
          top = smax;
        } else {
          // A wedge: its axis-aligned bounds, uniform over the cells its footprint reaches.
          const cxo = cx - b[0], czo = cz - b[2];
          if (cxo < 0 || cx > b[3] || czo < 0 || cz > b[5]) continue;
          bottom = b[1];
          top = b[4];
        }
        const c = j * this.nx + i;
        cells.push(c);
        let list = this.settledAt.get(c);
        if (!list) this.settledAt.set(c, (list = []));
        list.push({ key: id, bottom, top });
        this.mark(c);
      }
    }
    this.settled.set(id, cells);
  }

  /** World-space axis-aligned bounds of a piece in its current pose. */
  private pieceWorldBounds(id: number): [number, number, number, number, number, number] {
    const L = this.castle.layout;
    const s = L.stones[id];
    const body = this.castle.bodies[id];
    const t = body.translation(), r = body.rotation();
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    const visit = (lx: number, ly: number, lz: number) => {
      const tx = 2 * (r.y * lz - r.z * ly), ty = 2 * (r.z * lx - r.x * lz), tz = 2 * (r.x * ly - r.y * lx);
      const px = t.x + lx + r.w * tx + (r.y * tz - r.z * ty);
      const py = t.y + ly + r.w * ty + (r.z * tx - r.x * tz);
      const pz = t.z + lz + r.w * tz + (r.x * ty - r.y * tx);
      if (px < x0) x0 = px;
      if (py < y0) y0 = py;
      if (pz < z0) z0 = pz;
      if (px > x1) x1 = px;
      if (py > y1) y1 = py;
      if (pz > z1) z1 = pz;
    };
    if (s.shape === "wedge") {
      const p = L.wedge.points;
      for (let k = 0; k < 8; k++) visit(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
    } else {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) visit(sx * s.hx, sy * s.hy, sz * s.hz);
    }
    return [x0, y0, z0, x1, y1, z1];
  }

  /** Index something lying across an axis-aligned box (a fallen body) by the cells its footprint reaches. */
  private indexBox(key: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const [i0, i1] = cellSpan(x0, x1, NAV_GRID.x0, this.nx);
    const [j0, j1] = cellSpan(z0, z1, NAV_GRID.z0, this.nz);
    const cells: number[] = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * this.nx + i;
        cells.push(c);
        let list = this.settledAt.get(c);
        if (!list) this.settledAt.set(c, (list = []));
        list.push({ key, bottom: y0, top: y1 });
        this.mark(c);
      }
    }
    this.settled.set(key, cells);
  }

  /**
   * A fallen body (frozen) lying across a box: it raises the floor like
   * settled rubble, so the dead become ramps and blockages. The key (a
   * minion id) must not be in use; the cells catch up on the next update.
   */
  addBody(key: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.indexBox(this.bodyBase + key, x0, y0, z0, x1, y1, z1);
  }

  /** The body moved again or left the world. */
  removeBody(key: number) {
    this.removeSettled(this.bodyBase + key);
  }

  /** Cells a piece covers where it stands in the layout (its footprint), in order. */
  pieceCells(id: number): number[] {
    const b = stoneBounds(this.castle.layout.stones[id], this.castle.layout.wedge);
    const [i0, i1] = cellSpan(b[0], b[3], NAV_GRID.x0, this.nx);
    const [j0, j1] = cellSpan(b[2], b[5], NAV_GRID.z0, this.nz);
    const out: number[] = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push(j * this.nx + i);
    return out;
  }

  /** The bare ground's height in a cell (the mean of its corners), whatever stands on it. */
  groundFloor(c: number): number {
    const i = c % this.nx, j = (c - i) / this.nx;
    const H = this.terrain.h, nv = this.terrain.nx;
    return (H[j * nv + i] + H[j * nv + i + 1] + H[(j + 1) * nv + i] + H[(j + 1) * nv + i + 1]) * 0.25;
  }

  private removeSettled(id: number) {
    const cells = this.settled.get(id);
    if (!cells) return;
    for (const c of cells) {
      const list = this.settledAt.get(c);
      if (list) {
        const k = list.findIndex((e) => e.key === id);
        if (k >= 0) list.splice(k, 1);
        if (!list.length) this.settledAt.delete(c);
      }
      this.mark(c);
    }
    this.settled.delete(id);
  }

  /** Bring changed cells up to date. Call on fixed ticks. Returns true if any cell changed. */
  update(): boolean {
    const t = this.terrain.navDirty;
    for (let k = 0; k + 3 < t.length; k += 4) this.markRect(t[k] - 1, t[k + 2], t[k + 1] - 1, t[k + 3]);
    t.length = 0;
    const n = this.state.length;
    const banners = this.castle.layout.bannerIds;
    for (let id = 0; id < n; id++) {
      const now = this.stateOf(id);
      const was = this.state[id];
      if (now === was || id === banners[0] || id === banners[1]) continue;
      this.state[id] = now;
      // A piece that leaves its place, or (masons) comes back to it, changes the cells it stands on.
      if (was === PieceState.Standing || now === PieceState.Standing) this.markStanding(id);
      if (was === PieceState.Settled) this.removeSettled(id);
      if (now === PieceState.Settled) this.addSettled(id);
    }
    if (!this.dirty.length) return false;
    this.dirty.sort((a, b) => a - b);
    const before = this.version;
    for (const c of this.dirty) {
      this.dirtyMark[c] = 0;
      this.compute(c);
    }
    // Steps into and out of every changed cell: did any open or close?
    let opened = false;
    const nx = this.nx;
    for (const c of this.dirty) {
      for (const e of [c, c - 1, c - nx]) {
        if (e < 0 || (e === c - 1 && c % nx === 0)) continue;
        const b = this.edgeBits(e);
        if (b !== this.edges[e]) {
          this.edges[e] = b;
          opened = true;
        }
      }
    }
    if (opened) this.topo++;
    this.dirty.length = 0;
    return this.version !== before;
  }

  private compute(c: number) {
    const i = c % this.nx, j = (c - i) / this.nx;
    const H = this.terrain.h, nv = this.terrain.nx;
    const a = H[j * nv + i], b = H[j * nv + i + 1], d = H[(j + 1) * nv + i], e = H[(j + 1) * nv + i + 1];
    let floor = (a + b + d + e) * 0.25;
    const hi = Math.max(a, b, d, e), lo = Math.min(a, b, d, e);
    let water = this.channel[c] === 1 && floor < STREAM.level - WADE;
    let steep = hi - lo > STEEP;
    let raised = false, blocked = false, rubble = false;
    // Standing pieces (already in order of their bottoms) and settled rubble here, merged by bottom.
    const B = this.scratchB, T = this.scratchT, D = this.scratchD, S = this.scratchS;
    let m = 0;
    const idx = this.idx;
    for (let k = idx.off[c]; k < idx.off[c + 1] && m < B.length; k++) {
      const id = idx.ids[k];
      if (this.state[id] !== PieceState.Standing) continue;
      B[m] = idx.bottom[id];
      T[m] = idx.top[id];
      D[m] = idx.deck[id];
      S[m] = 0;
      m++;
    }
    const here = this.settledAt.get(c);
    if (here) {
      for (const e of here) {
        if (m >= B.length) break;
        let k = m++;
        while (k > 0 && B[k - 1] > e.bottom) {
          B[k] = B[k - 1];
          T[k] = T[k - 1];
          D[k] = D[k - 1];
          S[k] = S[k - 1];
          k--;
        }
        B[k] = e.bottom;
        T[k] = e.top;
        D[k] = 0;
        S[k] = 1;
      }
    }
    for (let k = 0; k < m; k++) {
      if (D[k]) {
        // A deck plank is a floor, whatever is under it (water, a bank, the beams that carry it).
        if (T[k] > floor || water || blocked) floor = T[k];
        water = false;
        steep = false;
        blocked = false;
        raised = true;
        rubble = false;
        continue;
      }
      // In the stream only a deck plank makes a floor: wreckage, the fallen and the timbers under a lost deck do not bridge the water.
      if (water) continue;
      if (B[k] <= floor + NAV_STEP) {
        if (T[k] > floor) {
          floor = T[k];
          steep = false;
          raised = true;
          rubble = S[k] === 1;
        }
      } else if (B[k] < floor + NAV_HEAD) {
        blocked = true;
      }
    }
    const kind = blocked ? NavKind.Blocked : water ? NavKind.Water : steep ? NavKind.Steep : raised ? (rubble ? NavKind.Rubble : NavKind.Raised) : NavKind.Ground;
    if (this.kind[c] !== kind || this.floor[c] !== floor) {
      this.kind[c] = kind;
      this.floor[c] = floor;
      this.version++;
    }
  }

  /** Can you walk from cell a to its neighbour b? */
  passable(a: number, b: number): boolean {
    const ka = this.kind[a], kb = this.kind[b];
    if (!navWalkable(ka) || !navWalkable(kb)) return false;
    const d = this.floor[a] - this.floor[b];
    const lim = navStep(ka, kb);
    return d <= lim && d >= -lim;
  }

  /**
   * Every cell reachable on foot from a start cell (4-neighbour steps within
   * the step height). Writes 1 into `out` for reachable cells (0 elsewhere)
   * and returns how many there are.
   */
  reach(start: number, out: Uint8Array): number {
    out.fill(0);
    if (start < 0 || !navWalkable(this.kind[start])) return 0;
    return this.flood([start], out, null);
  }

  /** Breadth-first flood from walkable start cells, inside a box of cells if given (`out` must be clear there). */
  private flood(starts: number[], out: Uint8Array, box: { i0: number; i1: number; j0: number; j1: number } | null): number {
    const q = this.queue;
    let head = 0, tail = 0;
    for (const s of starts) {
      if (out[s] || !navWalkable(this.kind[s])) continue;
      out[s] = 1;
      q[tail++] = s;
    }
    const nx = this.nx, nz = this.nz;
    while (head < tail) {
      const c = q[head++];
      const i = c % nx, j = (c - i) / nx;
      for (let k = 0; k < 4; k++) {
        const ni = k === 0 ? i - 1 : k === 1 ? i + 1 : i;
        const nj = k === 2 ? j - 1 : k === 3 ? j + 1 : j;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        if (box && (ni < box.i0 || ni > box.i1 || nj < box.j0 || nj > box.j1)) continue;
        const nc = nj * nx + ni;
        if (out[nc] || !this.passable(c, nc)) continue;
        out[nc] = 1;
        q[tail++] = nc;
      }
    }
    return tail;
  }

  /** Can a minion still cross this bridge: is there a walkable way from one bank to the other over its deck? */
  bridgeOpen(site: BridgeSite): boolean {
    const g = NAV_GRID;
    const box = {
      i0: Math.max(0, Math.floor((site.x - site.width / 2 - 1 - g.x0) / g.cell)),
      i1: Math.min(this.nx - 1, Math.floor((site.x + site.width / 2 + 1 - g.x0) / g.cell)),
      j0: Math.max(0, Math.floor((site.z - site.length / 2 - 1.5 - g.z0) / g.cell)),
      j1: Math.min(this.nz - 1, Math.floor((site.z + site.length / 2 + 1.5 - g.z0) / g.cell)),
    };
    const out = this.seen;
    for (let j = box.j0; j <= box.j1; j++) for (let i = box.i0; i <= box.i1; i++) out[j * this.nx + i] = 0;
    // From every cell of the near bank's row, to any cell of the far bank's row.
    const starts: number[] = [];
    for (let i = box.i0; i <= box.i1; i++) starts.push(box.j0 * this.nx + i);
    if (!this.flood(starts, out, box)) return false;
    for (let i = box.i0; i <= box.i1; i++) if (out[box.j1 * this.nx + i]) return true;
    return false;
  }
}

// Rotate a vector (vx, vy, vz) by a unit quaternion (x, y, z, w): one output
// component each, so the oriented-box slab test needs no temporaries.
// v' = v + 2 q.xyz x (q.xyz x v + w v).
function rotX(x: number, y: number, z: number, w: number, vx: number, vy: number, vz: number): number {
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return vx + w * tx + (y * tz - z * ty);
}
function rotY(x: number, y: number, z: number, w: number, vx: number, vy: number, vz: number): number {
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return vy + w * ty + (z * tx - x * tz);
}
function rotZ(x: number, y: number, z: number, w: number, vx: number, vy: number, vz: number): number {
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return vz + w * tz + (x * ty - y * tx);
}
