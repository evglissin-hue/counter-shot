// The keep falls by engineering (phase 3, 3.4): a statics pass over each
// keep and tower, beside the masonry's support check. The rules are
// docs/phase-3/04-keep.md and content's STRUCTURE.
//
// - Support first: the support check runs as before; this looks only at
//   stones that still stand (CastleSim.dynamic is 0).
// - Crushing (rule 2): per structure and course c, carry(c) is the top area
//   of the course's standing masonry (keep walls, tower wedges, buttress
//   piers; not floors or battlements) as a share of the course as built
//   (buttresses not counted as built: one that stands adds to carry), and
//   load(c) the mass standing above c (every member, floors and buttresses
//   too) as a share of that as built (buttresses not counted). c crushes
//   when load / carry > STRUCTURE.crush.
// - Toppling (rule 3): the footing is the convex hull (x, z) of the top
//   faces of course c's standing masonry, drawn in by STRUCTURE.margin +
//   STRUCTURE.toe * half * load / carry (half: the structure's half width).
//   If the centre of mass of everything standing above c lies outside it
//   (its signed distance inside the hull, the least over the hull's edges,
//   is under the draw-in), the part above c topples about the most violated
//   edge, drawn in: towards the cut.
// - Rule 4: after any change to a structure (a member loosened, shattered,
//   restored, raised), its damaged courses are walked from the lowest up; the
//   first that crushes or topples decides, and must stay so for
//   STRUCTURE.hold ticks before the fall starts (Strain, then Topple or
//   Crush; Saved if it holds again first).
// - Rules 5 to 7: a toppling part turns kinematic and follows one rotation
//   about the hinge, integrated with dsin and dcos from its mass, its moment
//   about the hinge and gravity, from STRUCTURE.tipRate; it is let go at
//   STRUCTURE.tipAngle, when a probe stone meets standing masonry or the
//   ground, or after STRUCTURE.tipTicks. A crush turns the course's standing
//   stones to dust and lets the part above go at once. Of the stones let go
//   about STRUCTURE.bodies stay Rapier bodies (and every storey board); the
//   rest are brittle "ghosts": no body, posed and flown by this pass, dust at
//   the first touch of the ground or standing masonry.
// - A keep that falls takes its floors with it, so its banner comes down
//   (rule 9).
//
// Deterministic: structures and stones in a fixed order, + - * / and
// comparisons, @keepfall/core's dsin, dcos and dsqrt. Its state is hashed.

import { STRUCTURE, structureList, type CastleLayout, type StructureDef } from "@keepfall/content";
import { dcos, dsin, dsqrt } from "@keepfall/core";
import { DENSITY, type CastleSim } from "./castleSim";
import { EventKind } from "./frame";
import type { Terrain } from "./terrain";

type Emit = (kind: EventKind, a: number, b: number, c: number, d: number) => void;

/** Where a structure is in its life. */
export const enum StaticState {
  Standing = 0,
  /** A course crushes or topples: it falls in STRUCTURE.hold ticks unless saved. */
  Groaning = 1,
  /** The part above a course tips about its hinge (kinematic). */
  Toppling = 2,
  /** It fell (toppled and let go, or crushed). */
  Fallen = 3,
}

/** A structure's report, as the mason's eye and the AI read it (refreshed every STRUCTURE.reportEvery ticks). */
export interface StructureStatus {
  index: number;
  state: StaticState;
  /** 0 to 1: how much its weakest course still holds (1 untouched, 0 falling): 1 - the weakest course's heat. */
  holds: number;
  /** Its weakest course (the one nearest falling; -1: no course damaged). */
  weakest: number;
  /** At the weakest course: the share of the way to crushing ((load / carry - 1) / (crush - 1), 0 as built, 1 crushes) and to toppling (1 - margin / margin as built, 0 as built, 1 topples). */
  crushNear: number;
  toppleNear: number;
  /** Signed distance (m) of the centre of mass of what stands above the weakest course inside its drawn-in footing (negative: outside, it topples). */
  margin: number;
  /** Which way it would topple (a unit vector, world x and z; 0, 0 when nothing is damaged). */
  dirX: number;
  dirZ: number;
  /** The centre of mass of what stands above the weakest course (world); the plumb line drops from it. */
  comX: number;
  comY: number;
  comZ: number;
  /** The top of the weakest course (m): where the plumb line meets the footing. */
  footY: number;
  /** The weakest course's footing: its convex hull seen from above (x, z pairs, counter-clockwise; empty when nothing is damaged), and how far it is drawn in (m). */
  hull: number[];
  drawIn: number;
  /** For every course, lowest first: its share of the way to falling (the larger of the two shares above, 0 to 1), 0 when undamaged. */
  heat: number[];
}

const G = 9.81;
const DT = 1 / 60;
/** Mode of a fall: 1 crush, 2 topple (the Strain event's third number). */
const CRUSH = 1;
const TOPPLE = 2;

/** One course's judgement. */
interface CourseEval {
  course: number;
  r: number;
  crushNear: number;
  toppleNear: number;
  heat: number;
  margin: number;
  drawIn: number;
  comX: number;
  comY: number;
  comZ: number;
  hull: number[];
  /** Fall direction (unit, outward normal of the nearest edge) and the hinge point (on the line drawn in by drawIn). */
  nx: number;
  nz: number;
  hx: number;
  hz: number;
  mode: number;
}

/** What a structure knows about its stones (computed once from the layout). */
interface Struct {
  def: StructureDef;
  n: number;
  ids: Int32Array;
  course: Int32Array;
  mass: Float64Array;
  area: Float64Array;
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  /** 1 when the member is masonry that carries (keep, tower, buttress). */
  carry: Uint8Array;
  butt: Uint8Array;
  storey: Uint8Array;
  /** Top corners (x, z) * 4 of each carry member, world. */
  corners: Float64Array;
  snap: Uint8Array;
  nC: number;
  nCarry: number;
  /** Carry members (indices) of each course, buttress piers included. */
  byCourse: number[][];
  builtCount: Int32Array;
  builtArea: Float64Array;
  builtMassAbove: Float64Array;
  courseTop: Float64Array;
  margin0: Float64Array;
  // Scratch and the last evaluation.
  massC: Float64Array;
  mxC: Float64Array;
  myC: Float64Array;
  mzC: Float64Array;
  areaC: Float64Array;
  cntBuilt: Int32Array;
  cntAll: Int32Array;
  sig1: Float64Array;
  sig2: Float64Array;
  aboveMass: Float64Array;
  aboveX: Float64Array;
  aboveY: Float64Array;
  aboveZ: Float64Array;
  rC: Float64Array;
  hullCache: Array<{ cnt: number; s1: number; s2: number; pts: number[] } | null>;
  state: StaticState;
  pendCourse: number;
  pendMode: number;
  pendTick: number;
  dec: CourseEval | null;
  status: StructureStatus;
  group: Group | null;
}

/** A toppling part: members, hinge, rotation (state), poses. */
interface Group {
  s: number;
  ids: number[];
  /** 1 for a member that is a ghost (no body). */
  ghost: Uint8Array;
  p0: Float64Array;
  q0: Float64Array;
  mass: Float64Array;
  /** Local half extents of each member's bounds. */
  lh: Float64Array;
  pos: Float64Array;
  rot: Float64Array;
  hx: number;
  hy: number;
  hz: number;
  nx: number;
  nz: number;
  ux: number;
  uz: number;
  theta: number;
  omega: number;
  start: number;
  M: number;
  d0: number;
  h0: number;
  I: number;
  probes: number[];
  /** What each probe already touches at the start (a wall bonded to a tower, the course below): not a hit. */
  touching: number[][];
  bodies: number;
}

/** A brittle stone in flight: no body, posed and flown here. */
interface Ghost {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  wx: number;
  wy: number;
  wz: number;
  age: number;
}

function statusOf(i: number, state: StaticState): StructureStatus {
  return { index: i, state, holds: 1, weakest: -1, crushNear: 0, toppleNear: 0, margin: 0, dirX: 0, dirZ: 0, comX: 0, comY: 0, comZ: 0, footY: 0, hull: [], drawIn: 0, heat: [] };
}

/** Convex hull of points (x, z), counter-clockwise with x to the right and z up (monotone chain, ties by x then z). Flat x, z pairs. */
function convexHull(xs: number[], zs: number[]): number[] {
  const n = xs.length;
  if (n === 0) return [];
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  idx.sort((a, b) => xs[a] - xs[b] || zs[a] - zs[b] || a - b);
  const px: number[] = [], pz: number[] = [];
  for (const i of idx) {
    const l = px.length;
    if (l && px[l - 1] === xs[i] && pz[l - 1] === zs[i]) continue;
    px.push(xs[i]);
    pz.push(zs[i]);
  }
  const m = px.length;
  if (m < 3) {
    const o: number[] = [];
    for (let i = 0; i < m; i++) o.push(px[i], pz[i]);
    return o;
  }
  const hx: number[] = [], hz: number[] = [];
  const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  for (let i = 0; i < m; i++) {
    while (hx.length >= 2 && cross(hx[hx.length - 2], hz[hz.length - 2], hx[hx.length - 1], hz[hz.length - 1], px[i], pz[i]) <= 1e-9) {
      hx.pop();
      hz.pop();
    }
    hx.push(px[i]);
    hz.push(pz[i]);
  }
  const lower = hx.length + 1;
  for (let i = m - 2; i >= 0; i--) {
    while (hx.length >= lower && cross(hx[hx.length - 2], hz[hz.length - 2], hx[hx.length - 1], hz[hz.length - 1], px[i], pz[i]) <= 1e-9) {
      hx.pop();
      hz.pop();
    }
    hx.push(px[i]);
    hz.push(pz[i]);
  }
  hx.pop();
  hz.pop();
  const o: number[] = [];
  for (let i = 0; i < hx.length; i++) o.push(hx[i], hz[i]);
  return o;
}

export class Statics {
  readonly list: StructureDef[];
  private S: Struct[] = [];
  private owner: Int16Array;
  private ghosts: Ghost[] = [];
  private tick = 0;
  /** Every stone's bounds at its layout pose (world, axis aligned) and its local half extents. */
  private bmin: Float64Array;
  private bmax: Float64Array;
  private lh: Float64Array;
  /** The largest half extent (any axis) of a stone on the small grid, and the bigger stones (houses, roofs, gates, bridges) on a grid of their own. */
  private smallPad = 0;
  private bigCells = new Map<number, number[]>();
  private bigTop = 0;
  private tmp: number[] = [];
  private ex = 0;
  private ey = 0;
  private ez = 0;
  private mD = 0;
  private mI = 0;
  /** For the measures: how far each part had tipped when it was let go, and why (1 the tip angle, 2 a probe met masonry or the ground, 3 the time). */
  readonly lastRelease: Array<{ theta: number; why: number } | undefined> = [];

  constructor(
    private castle: CastleSim,
    private terrain: Terrain,
    private emit: Emit,
  ) {
    this.list = structureList(castle.layout);
    const layout = castle.layout;
    const n = layout.stones.length;
    this.owner = new Int16Array(n).fill(-1);
    this.bmin = new Float64Array(n * 3);
    this.bmax = new Float64Array(n * 3);
    this.lh = new Float64Array(n * 3);
    this.buildBounds();
    for (const d of this.list) this.S.push(this.build(d));
    for (const S of this.S) {
      for (let k = 0; k < S.n; k++) S.snap[k] = castle.dynamic[S.ids[k]];
      this.evaluate(S);
    }
    castle.poseReporter = (out, k, max) => this.report(out, k, max);
  }

  get layout(): CastleLayout {
    return this.castle.layout;
  }

  // ---- setup ----

  private buildBounds() {
    const layout = this.castle.layout;
    const wp = layout.wedge.points;
    let wx = 0, wy = 0, wz = 0;
    for (let i = 0; i < 8; i++) {
      wx = Math.max(wx, Math.abs(wp[i * 3]));
      wy = Math.max(wy, Math.abs(wp[i * 3 + 1]));
      wz = Math.max(wz, Math.abs(wp[i * 3 + 2]));
    }
    for (const s of layout.stones) {
      const hx = s.shape === "wedge" ? wx : s.hx, hy = s.shape === "wedge" ? wy : s.hy, hz = s.shape === "wedge" ? wz : s.hz;
      this.lh[s.id * 3] = hx;
      this.lh[s.id * 3 + 1] = hy;
      this.lh[s.id * 3 + 2] = hz;
      this.halfExtents(s.q[0], s.q[1], s.q[2], s.q[3], hx, hy, hz);
      this.bmin.set([s.x - this.ex, s.y - this.ey, s.z - this.ez], s.id * 3);
      this.bmax.set([s.x + this.ex, s.y + this.ey, s.z + this.ez], s.id * 3);
      const big = s.part === "house" || s.part === "roof" || s.part === "gate" || s.part === "bridge";
      const m = Math.max(this.ex, this.ey, this.ez);
      if (big) {
        const k = this.bigKey(Math.floor(s.x / 4), Math.floor(s.y / 4), Math.floor(s.z / 4));
        let l = this.bigCells.get(k);
        if (!l) this.bigCells.set(k, (l = []));
        l.push(s.id);
        if (s.y + this.ey > this.bigTop) this.bigTop = s.y + this.ey;
      } else if (m > this.smallPad && s.part !== "storey" && s.part !== "banner") {
        this.smallPad = m;
      }
    }
  }

  private bigKey(cx: number, cy: number, cz: number): number {
    return ((cx + 256) * 512 + (cy + 256)) * 512 + (cz + 256);
  }

  /** The half extents of a box rotated by a quaternion, into this.ex, ey, ez. */
  private halfExtents(qx: number, qy: number, qz: number, qw: number, hx: number, hy: number, hz: number) {
    const xx = qx * qx, yy = qy * qy, zz = qz * qz;
    const xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
    this.ex = Math.abs(1 - 2 * (yy + zz)) * hx + Math.abs(2 * (xy - wz)) * hy + Math.abs(2 * (xz + wy)) * hz;
    this.ey = Math.abs(2 * (xy + wz)) * hx + Math.abs(1 - 2 * (xx + zz)) * hy + Math.abs(2 * (yz - wx)) * hz;
    this.ez = Math.abs(2 * (xz - wy)) * hx + Math.abs(2 * (yz + wx)) * hy + Math.abs(1 - 2 * (xx + yy)) * hz;
  }

  private build(def: StructureDef): Struct {
    const layout = this.castle.layout;
    const n = def.stones.length;
    const wedge = layout.wedge;
    const wedgeArea = (wedge.rOut * wedge.rOut - wedge.rIn * wedge.rIn) * wedge.halfAngle;
    const course = new Int32Array(n), mass = new Float64Array(n), area = new Float64Array(n);
    const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
    const carry = new Uint8Array(n), butt = new Uint8Array(n), storey = new Uint8Array(n);
    const corners = new Float64Array(n * 8);
    const ids = Int32Array.from(def.stones);
    let nC = 0, nCarry = 0;
    for (let k = 0; k < n; k++) {
      const s = layout.stones[ids[k]];
      this.owner[s.id] = def.index;
      course[k] = s.course;
      px[k] = s.x;
      py[k] = s.y;
      pz[k] = s.z;
      const wedgy = s.shape === "wedge";
      const a = wedgy ? wedgeArea : 4 * s.hx * s.hz;
      area[k] = a;
      mass[k] = DENSITY[s.material] * (wedgy ? a * 2 * s.hy : 8 * s.hx * s.hy * s.hz);
      carry[k] = s.part === "keep" || s.part === "tower" || s.part === "buttress" ? 1 : 0;
      butt[k] = s.part === "buttress" ? 1 : 0;
      storey[k] = s.part === "storey" ? 1 : 0;
      if (s.course + 1 > nC) nC = s.course + 1;
      if (carry[k]) {
        if (!butt[k] && s.course + 1 > nCarry) nCarry = s.course + 1;
        const pts: number[][] = [];
        if (wedgy) {
          for (let i = 0; i < 8; i++) if (wedge.points[i * 3 + 1] > 0) pts.push([wedge.points[i * 3], wedge.points[i * 3 + 1], wedge.points[i * 3 + 2]]);
        } else {
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx * s.hx, s.hy, sz * s.hz]);
        }
        for (let i = 0; i < 4 && i < pts.length; i++) {
          const r = this.rotate(s.q, pts[i][0], pts[i][1], pts[i][2]);
          corners[k * 8 + i * 2] = s.x + r[0];
          corners[k * 8 + i * 2 + 1] = s.z + r[2];
        }
      }
    }
    const byCourse: number[][] = [];
    for (let c = 0; c < nC; c++) byCourse.push([]);
    const builtCount = new Int32Array(nCarry), builtArea = new Float64Array(nCarry), courseTop = new Float64Array(nCarry);
    const massAt = new Float64Array(nC + 1), mx = new Float64Array(nC + 1), my = new Float64Array(nC + 1), mz = new Float64Array(nC + 1);
    for (let k = 0; k < n; k++) {
      const c = course[k];
      if (carry[k]) byCourse[c].push(k);
      if (butt[k]) continue;
      massAt[c] += mass[k];
      mx[c] += mass[k] * px[k];
      my[c] += mass[k] * py[k];
      mz[c] += mass[k] * pz[k];
      if (carry[k]) {
        builtCount[c]++;
        builtArea[c] += area[k];
        const top = py[k] + layout.stones[ids[k]].hy;
        if (top > courseTop[c]) courseTop[c] = top;
      }
    }
    const builtMassAbove = new Float64Array(nCarry), margin0 = new Float64Array(nCarry);
    let aM = 0, aX = 0, aZ = 0;
    const aboveM = new Float64Array(nC + 1), aboveXs = new Float64Array(nC + 1), aboveZs = new Float64Array(nC + 1);
    for (let c = nC - 1; c >= 0; c--) {
      aboveM[c] = aM;
      aboveXs[c] = aX;
      aboveZs[c] = aZ;
      aM += massAt[c];
      aX += mx[c];
      aZ += mz[c];
    }
    for (let c = 0; c < nCarry; c++) builtMassAbove[c] = aboveM[c];
    const half = def.half;
    for (let c = 0; c < nCarry; c++) {
      const xs: number[] = [], zs: number[] = [];
      for (const k of byCourse[c]) {
        if (butt[k]) continue;
        for (let i = 0; i < 4; i++) {
          xs.push(corners[k * 8 + i * 2]);
          zs.push(corners[k * 8 + i * 2 + 1]);
        }
      }
      const hull = convexHull(xs, zs);
      let m0 = 1;
      if (hull.length >= 6 && aboveM[c] > 0) {
        this.edgeMargin(hull, aboveXs[c] / aboveM[c], aboveZs[c] / aboveM[c]);
        m0 = this.mD - (STRUCTURE.margin + STRUCTURE.toe * half);
      }
      margin0[c] = m0 > 0.05 ? m0 : 0.05;
    }
    const z = (k: number) => new Float64Array(k);
    return {
      def, n, ids, course, mass, area, px, py, pz, carry, butt, storey, corners,
      snap: new Uint8Array(n), nC, nCarry, byCourse, builtCount, builtArea, builtMassAbove, courseTop, margin0,
      massC: z(nC + 1), mxC: z(nC + 1), myC: z(nC + 1), mzC: z(nC + 1), areaC: z(nC + 1),
      cntBuilt: new Int32Array(nC + 1), cntAll: new Int32Array(nC + 1), sig1: z(nC + 1), sig2: z(nC + 1),
      aboveMass: z(nC + 1), aboveX: z(nC + 1), aboveY: z(nC + 1), aboveZ: z(nC + 1), rC: z(nCarry),
      hullCache: new Array(nCarry).fill(null),
      state: StaticState.Standing, pendCourse: -1, pendMode: 0, pendTick: 0, dec: null,
      status: statusOf(def.index, StaticState.Standing), group: null,
    };
  }

  private rotate(q: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
    const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
  }

  // ---- the footing ----

  /** The least signed distance of a point inside a counter-clockwise hull (positive inside), in this.mD, and its edge in this.mI. */
  private edgeMargin(hull: number[], x: number, z: number) {
    const m = hull.length / 2;
    let best = Infinity, bi = 0;
    for (let i = 0; i < m; i++) {
      const j = i + 1 === m ? 0 : i + 1;
      const ax = hull[i * 2], az = hull[i * 2 + 1];
      const ex = hull[j * 2] - ax, ez = hull[j * 2 + 1] - az;
      const len = dsqrt(ex * ex + ez * ez);
      const d = len > 0 ? (ex * (z - az) - ez * (x - ax)) / len : Infinity;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    this.mD = best;
    this.mI = bi;
  }

  private hullOf(S: Struct, c: number): number[] {
    const hc = S.hullCache[c];
    if (hc && hc.cnt === S.cntAll[c] && hc.s1 === S.sig1[c] && hc.s2 === S.sig2[c]) return hc.pts;
    const xs: number[] = [], zs: number[] = [];
    const dyn = this.castle.dynamic;
    for (const k of S.byCourse[c]) {
      if (dyn[S.ids[k]]) continue;
      for (let i = 0; i < 4; i++) {
        xs.push(S.corners[k * 8 + i * 2]);
        zs.push(S.corners[k * 8 + i * 2 + 1]);
      }
    }
    const pts = convexHull(xs, zs);
    S.hullCache[c] = { cnt: S.cntAll[c], s1: S.sig1[c], s2: S.sig2[c], pts };
    return pts;
  }

  // ---- judging ----

  /** Sum the standing members, judge every damaged course, set the structure's report and S.dec (the first course that fails, or null). */
  private evaluate(S: Struct) {
    const dyn = this.castle.dynamic;
    const nC = S.nC;
    S.massC.fill(0);
    S.mxC.fill(0);
    S.myC.fill(0);
    S.mzC.fill(0);
    S.areaC.fill(0);
    S.cntBuilt.fill(0);
    S.cntAll.fill(0);
    S.sig1.fill(0);
    S.sig2.fill(0);
    for (let k = 0; k < S.n; k++) {
      const id = S.ids[k];
      if (dyn[id]) continue;
      const c = S.course[k], m = S.mass[k];
      S.massC[c] += m;
      S.mxC[c] += m * S.px[k];
      S.myC[c] += m * S.py[k];
      S.mzC[c] += m * S.pz[k];
      if (S.carry[k]) {
        S.areaC[c] += S.area[k];
        if (!S.butt[k]) S.cntBuilt[c]++;
        S.cntAll[c]++;
        S.sig1[c] += id;
        S.sig2[c] += id * id;
      }
    }
    let aM = 0, aX = 0, aY = 0, aZ = 0;
    for (let c = nC - 1; c >= 0; c--) {
      S.aboveMass[c] = aM;
      S.aboveX[c] = aX;
      S.aboveY[c] = aY;
      S.aboveZ[c] = aZ;
      aM += S.massC[c];
      aX += S.mxC[c];
      aY += S.myC[c];
      aZ += S.mzC[c];
    }
    const half = S.def.half;
    let dec: CourseEval | null = null;
    let best: CourseEval | null = null;
    const heat: number[] = [];
    for (let c = 0; c < S.nCarry; c++) {
      const load = S.builtMassAbove[c] > 0 ? S.aboveMass[c] / S.builtMassAbove[c] : 0;
      const carry = S.builtArea[c] > 0 ? S.areaC[c] / S.builtArea[c] : 1;
      const r = load <= 0 ? 0 : carry <= 1e-9 ? Infinity : load / carry;
      S.rC[c] = r;
      if (S.builtCount[c] === 0 || S.cntBuilt[c] >= S.builtCount[c]) {
        heat.push(0);
        continue;
      }
      const ev = this.judgeCourse(S, c, r, half);
      heat.push(ev.heat);
      if (!dec && ev.mode) dec = ev;
      if (!best || ev.heat > best.heat) best = ev;
    }
    S.dec = dec;
    const st = statusOf(S.def.index, S.state);
    if (best) {
      st.holds = 1 - best.heat;
      st.weakest = best.course;
      st.crushNear = best.crushNear;
      st.toppleNear = best.toppleNear;
      st.margin = best.margin;
      st.dirX = best.nx;
      st.dirZ = best.nz;
      st.comX = best.comX;
      st.comY = best.comY;
      st.comZ = best.comZ;
      st.footY = S.courseTop[best.course];
      st.hull = best.hull.slice();
      st.drawIn = best.drawIn;
    }
    st.heat = heat;
    S.status = st;
  }

  /** Judge one damaged course: crush, topple, how near each is. */
  private judgeCourse(S: Struct, c: number, r: number, half: number): CourseEval {
    const crush = STRUCTURE.crush;
    const above = S.aboveMass[c];
    const hull = this.hullOf(S, c);
    const rc = r > crush ? crush : r;
    const drawIn = STRUCTURE.margin + STRUCTURE.toe * half * rc;
    const ev: CourseEval = {
      course: c, r, crushNear: r > 1 ? (r - 1) / (crush - 1) : 0, toppleNear: 0, heat: 0, margin: S.margin0[c], drawIn,
      comX: S.def.cx, comY: S.courseTop[c], comZ: S.def.cz, hull, nx: 0, nz: 0, hx: 0, hz: 0, mode: 0,
    };
    if (above > 0) {
      const comX = S.aboveX[c] / above, comY = S.aboveY[c] / above, comZ = S.aboveZ[c] / above;
      ev.comX = comX;
      ev.comY = comY;
      ev.comZ = comZ;
      const m = hull.length / 2;
      if (m >= 3) {
        this.edgeMargin(hull, comX, comZ);
        const i = this.mI, j = i + 1 === m ? 0 : i + 1;
        const ax = hull[i * 2], az = hull[i * 2 + 1];
        const ex = hull[j * 2] - ax, ez = hull[j * 2 + 1] - az;
        const len = dsqrt(ex * ex + ez * ez);
        const nx = ez / len, nz = -ex / len;
        const t = ((comX - ax) * ex + (comZ - az) * ez) / (len * len);
        ev.margin = this.mD - drawIn;
        ev.nx = nx;
        ev.nz = nz;
        ev.hx = ax + ex * t - nx * drawIn;
        ev.hz = az + ez * t - nz * drawIn;
      } else if (m >= 1) {
        // A footing of a point or a line: it topples about the middle, towards the centre of mass.
        let mx = 0, mz = 0;
        for (let i = 0; i < m; i++) {
          mx += hull[i * 2] / m;
          mz += hull[i * 2 + 1] / m;
        }
        let dx = comX - mx, dz = comZ - mz;
        const len = dsqrt(dx * dx + dz * dz);
        if (len > 1e-6) {
          dx /= len;
          dz /= len;
        } else {
          dx = 1;
          dz = 0;
        }
        ev.margin = -drawIn - len;
        ev.nx = dx;
        ev.nz = dz;
        ev.hx = mx;
        ev.hz = mz;
      }
      const tn = 1 - ev.margin / S.margin0[c];
      ev.toppleNear = tn < 0 ? 0 : tn > 1 ? 1 : tn;
      if (ev.margin < 0) ev.mode = TOPPLE;
    }
    if (r > crush) ev.mode = CRUSH;
    const h = ev.crushNear > ev.toppleNear ? ev.crushNear : ev.toppleNear;
    ev.heat = h < 0 ? 0 : h > 1 ? 1 : h;
    return ev;
  }

  // ---- the step ----

  /** After the world's step (and the bursts of the step): see what changed, judge it, groan, start falls, turn toppling parts, let them go, dust brittle stones. */
  step(tick: number) {
    this.tick = tick;
    const dyn = this.castle.dynamic;
    for (const S of this.S) {
      if (S.state === StaticState.Toppling) {
        this.advance(S, tick);
        continue;
      }
      if (S.state === StaticState.Fallen) continue;
      let changed = false;
      for (let k = 0; k < S.n; k++) {
        const d = dyn[S.ids[k]];
        if (d !== S.snap[k]) {
          S.snap[k] = d;
          changed = true;
        }
      }
      const due = S.state === StaticState.Groaning && tick - S.pendTick >= STRUCTURE.hold;
      if (!changed && !due) continue;
      this.evaluate(S);
      const d = S.dec;
      const i = S.def.index;
      if (S.state === StaticState.Standing) {
        if (d) {
          this.setState(S, StaticState.Groaning);
          S.pendCourse = d.course;
          S.pendMode = d.mode;
          S.pendTick = tick;
          this.emit(EventKind.Strain, i, d.course, d.mode, 0);
        }
      } else if (!d) {
        this.setState(S, StaticState.Standing);
        this.emit(EventKind.Saved, i, S.pendCourse, 0, 0);
      } else {
        S.pendCourse = d.course;
        S.pendMode = d.mode;
        if (due) {
          if (d.mode === CRUSH) this.crush(S, d, tick);
          else this.beginTopple(S, d, tick);
        }
      }
    }
    this.flyGhosts();
  }

  private setState(S: Struct, st: StaticState) {
    S.state = st;
    S.status.state = st;
  }

  /** Is this member a Rapier body when its part is let go (else a brittle ghost)? Evenly by id order, every storey board always. */
  private selectBodies(S: Struct, members: number[]): Uint8Array {
    const n = members.length;
    const K = STRUCTURE.bodies;
    const ghost = new Uint8Array(n);
    for (let j = 0; j < n; j++) {
      const body = S.storey[members[j]] === 1 || Math.floor(((j + 1) * K) / n) > Math.floor((j * K) / n);
      ghost[j] = body ? 0 : 1;
    }
    return ghost;
  }

  /** Rule 9 and the footing: what a fall at course c does before the part above moves. Returns the members that stand above c, in id order. */
  private prepare(S: Struct, c: number): number[] {
    const dyn = this.castle.dynamic;
    if (S.def.kind === "keep") {
      // The falling mass goes through the floors under it: those boards come loose, the banner comes down with them.
      for (let k = 0; k < S.n; k++) if (S.storey[k] && S.course[k] <= c && !dyn[S.ids[k]]) this.castle.looseNow(S.ids[k]);
    }
    const members: number[] = [];
    for (let k = 0; k < S.n; k++) if (S.course[k] > c && !dyn[S.ids[k]]) members.push(k);
    return members;
  }

  private thawOver(S: Struct, members: number[], y0: number) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const k of members) {
      if (S.px[k] < x0) x0 = S.px[k];
      if (S.px[k] > x1) x1 = S.px[k];
      if (S.pz[k] < z0) z0 = S.pz[k];
      if (S.pz[k] > z1) z1 = S.pz[k];
    }
    if (x0 <= x1) this.castle.thawBoxAbove(x0 - 1, z0 - 1, x1 + 1, z1 + 1, y0);
  }

  // ---- a crush ----

  private crush(S: Struct, d: CourseEval, tick: number) {
    const c = d.course;
    const dyn = this.castle.dynamic;
    const i = S.def.index;
    for (const k of S.byCourse[c]) if (!dyn[S.ids[k]]) this.castle.dust(S.ids[k]);
    const members = this.prepare(S, c);
    this.thawOver(S, members, S.courseTop[c]);
    const ghost = this.selectBodies(S, members);
    let bodies = 0;
    const layout = this.castle.layout;
    for (let j = 0; j < members.length; j++) {
      const k = members[j], id = S.ids[k], st = layout.stones[id];
      this.castle.claim(id, ghost[j] === 1);
      let vx = S.px[k] - S.def.cx, vz = S.pz[k] - S.def.cz;
      const len = dsqrt(vx * vx + vz * vz);
      if (len > 1e-6) {
        vx = (vx / len) * STRUCTURE.splay;
        vz = (vz / len) * STRUCTURE.splay;
      } else {
        vx = 0;
        vz = 0;
      }
      if (ghost[j]) {
        this.ghosts.push({ id, x: st.x, y: st.y, z: st.z, vx, vy: 0, vz, qx: st.q[0], qy: st.q[1], qz: st.q[2], qw: st.q[3], wx: 0, wy: 0, wz: 0, age: 0 });
      } else {
        bodies++;
        this.castle.letGo(id, st.x, st.y, st.z, st.q[0], st.q[1], st.q[2], st.q[3], vx, 0, vz, 0, 0, 0);
      }
    }
    this.castle.supportNow();
    this.setState(S, StaticState.Fallen);
    this.emit(EventKind.Crush, i, c, S.def.cx, S.def.cz);
    this.emit(EventKind.Released, i, members.length, bodies, 0);
    void tick;
  }

  // ---- a topple ----

  private beginTopple(S: Struct, d: CourseEval, tick: number) {
    const c = d.course;
    const dyn = this.castle.dynamic;
    const layout = this.castle.layout;
    const i = S.def.index;
    const Hx = d.hx, Hz = d.hz, Hy = S.courseTop[c];
    const nx = d.nx, nz = d.nz;
    // The toe that crushed: standing masonry of the course beyond the hinge line would be overlapped by the tipping part.
    for (const k of S.byCourse[c]) {
      if (dyn[S.ids[k]]) continue;
      if ((S.px[k] - Hx) * nx + (S.pz[k] - Hz) * nz > 0) this.castle.dust(S.ids[k]);
    }
    const members = this.prepare(S, c);
    this.thawOver(S, members, Hy);
    const n = members.length;
    const ghost = this.selectBodies(S, members);
    const g: Group = {
      s: i, ids: [], ghost, p0: new Float64Array(n * 3), q0: new Float64Array(n * 4), mass: new Float64Array(n), lh: new Float64Array(n * 3),
      pos: new Float64Array(n * 3), rot: new Float64Array(n * 4), hx: Hx, hy: Hy, hz: Hz, nx, nz, ux: nz, uz: -nx,
      theta: 0, omega: STRUCTURE.tipRate, start: tick, M: 0, d0: 0, h0: 0, I: 0, probes: [], touching: [], bodies: 0,
    };
    let M = 0, sd = 0, sh = 0, I = 0;
    for (let j = 0; j < n; j++) {
      const k = members[j], id = S.ids[k], st = layout.stones[id];
      g.ids.push(id);
      g.p0.set([st.x, st.y, st.z], j * 3);
      g.q0.set(st.q, j * 4);
      g.pos.set([st.x, st.y, st.z], j * 3);
      g.rot.set(st.q, j * 4);
      g.lh.set([this.lh[id * 3], this.lh[id * 3 + 1], this.lh[id * 3 + 2]], j * 3);
      g.mass[j] = S.mass[k];
      const dd = (st.x - Hx) * nx + (st.z - Hz) * nz, hh = st.y - Hy;
      M += S.mass[k];
      sd += S.mass[k] * dd;
      sh += S.mass[k] * hh;
      I += S.mass[k] * (dd * dd + hh * hh);
      this.castle.claim(id, ghost[j] === 1);
      if (!ghost[j]) g.bodies++;
    }
    g.M = M;
    g.d0 = M > 0 ? sd / M : 0;
    g.h0 = M > 0 ? sh / M : 0;
    g.I = I > 0 ? I : 1;
    g.probes = this.chooseProbes(S, g, members, c);
    for (const j of g.probes) {
      const found: number[] = [];
      this.probeHit(g, j, null, found);
      g.touching.push(found);
    }
    this.castle.supportNow();
    S.group = g;
    this.setState(S, StaticState.Toppling);
    this.emit(EventKind.Topple, i, c, nx, nz);
  }

  /** Up to 64 stones to watch: the lowest three courses of the part on the fall side of the hinge, then the top course's furthest along the fall direction. */
  private chooseProbes(S: Struct, g: Group, members: number[], c: number): number[] {
    const n = members.length;
    const along = (j: number) => (g.p0[j * 3] - g.hx) * g.nx + (g.p0[j * 3 + 2] - g.hz) * g.nz;
    const low: number[] = [];
    let top = 0;
    for (let j = 0; j < n; j++) {
      const k = members[j];
      if (S.course[k] > top) top = S.course[k];
      if (S.course[k] <= c + 3 && along(j) > 0) low.push(j);
    }
    low.sort((a, b) => along(b) - along(a) || a - b);
    const probes = low.slice(0, 40);
    const high: number[] = [];
    for (let j = 0; j < n; j++) if (S.course[members[j]] === top) high.push(j);
    high.sort((a, b) => along(b) - along(a) || a - b);
    for (const j of high) {
      if (probes.length >= 64) break;
      probes.push(j);
    }
    return probes;
  }

  /** Pose every member of a group at a tip of theta about its hinge. */
  private pose(g: Group, theta: number) {
    const cs = dcos(theta), sn = dsin(theta), ch = dcos(theta / 2), sh = dsin(theta / 2);
    const ux = g.ux, uz = g.uz;
    const ax = ux * sh, az = uz * sh;
    const n = g.ids.length;
    for (let j = 0; j < n; j++) {
      const rx = g.p0[j * 3] - g.hx, ry = g.p0[j * 3 + 1] - g.hy, rz = g.p0[j * 3 + 2] - g.hz;
      const k = (ux * rx + uz * rz) * (1 - cs);
      g.pos[j * 3] = g.hx + rx * cs + -uz * ry * sn + ux * k;
      g.pos[j * 3 + 1] = g.hy + ry * cs + (uz * rx - ux * rz) * sn;
      g.pos[j * 3 + 2] = g.hz + rz * cs + ux * ry * sn + uz * k;
      const bx = g.q0[j * 4], by = g.q0[j * 4 + 1], bz = g.q0[j * 4 + 2], bw = g.q0[j * 4 + 3];
      // (ax, 0, az, ch) * b
      g.rot[j * 4] = ch * bx + ax * bw + 0 * bz - az * by;
      g.rot[j * 4 + 1] = ch * by - ax * bz + 0 * bw + az * bx;
      g.rot[j * 4 + 2] = ch * bz + ax * by - 0 * bx + az * bw;
      g.rot[j * 4 + 3] = ch * bw - ax * bx - 0 * by - az * bz;
    }
  }

  private advance(S: Struct, tick: number) {
    const g = S.group!;
    const alpha = (g.M * G * (g.d0 * dcos(g.theta) + g.h0 * dsin(g.theta))) / g.I;
    g.omega += alpha * DT;
    g.theta += g.omega * DT;
    this.pose(g, g.theta);
    const n = g.ids.length;
    for (let j = 0; j < n; j++) {
      if (g.ghost[j]) continue;
      this.castle.poseBody(g.ids[j], g.pos[j * 3], g.pos[j * 3 + 1], g.pos[j * 3 + 2], g.rot[j * 4], g.rot[j * 4 + 1], g.rot[j * 4 + 2], g.rot[j * 4 + 3]);
    }
    let why = g.theta >= STRUCTURE.tipAngle ? 1 : tick - g.start >= STRUCTURE.tipTicks ? 3 : 0;
    if (!why) {
      for (let k = 0; k < g.probes.length; k++) {
        if (this.probeHit(g, g.probes[k], g.touching[k], null) !== -1) {
          why = 2;
          break;
        }
      }
    }
    if (why) {
      this.lastRelease[S.def.index] = { theta: g.theta, why };
      this.release(S, g);
    }
  }

  /**
   * What would this member of a tipping part meet now: the id of a standing piece its bounds (shrunk by 0.1 m) overlap that is
   * not in `skip`, -2 for the ground, -1 for nothing.
   */
  private probeHit(g: Group, j: number, skip: number[] | null, found: number[] | null): number {
    const x = g.pos[j * 3], y = g.pos[j * 3 + 1], z = g.pos[j * 3 + 2];
    this.halfExtents(g.rot[j * 4], g.rot[j * 4 + 1], g.rot[j * 4 + 2], g.rot[j * 4 + 3], g.lh[j * 3], g.lh[j * 3 + 1], g.lh[j * 3 + 2]);
    const ex = this.ex - 0.1, ey = this.ey - 0.1, ez = this.ez - 0.1;
    if (y - this.ey < this.terrain.heightAt(x, z)) return -2;
    const pad = Math.max(this.ex, this.ey, this.ez) + this.smallPad;
    const list = this.tmp;
    list.length = 0;
    this.castle.standingNear(x, y, z, pad, list);
    const bmin = this.bmin, bmax = this.bmax;
    let hit = -1;
    const test = (id: number): boolean => {
      const o = id * 3;
      if (!(bmin[o] < x + ex && bmax[o] > x - ex && bmin[o + 1] < y + ey && bmax[o + 1] > y - ey && bmin[o + 2] < z + ez && bmax[o + 2] > z - ez)) return false;
      if (skip && skip.includes(id)) return false;
      hit = id;
      if (found) found.push(id);
      return !found;
    };
    for (const id of list) if (test(id)) return hit;
    if (y - this.ey < this.bigTop) {
      const r = Math.max(this.ex, this.ey, this.ez) + 4;
      for (let cx = Math.floor((x - r) / 4); cx <= Math.floor((x + r) / 4); cx++)
        for (let cy = Math.floor((y - r) / 4); cy <= Math.floor((y + r) / 4); cy++)
          for (let cz = Math.floor((z - r) / 4); cz <= Math.floor((z + r) / 4); cz++) {
            const l = this.bigCells.get(this.bigKey(cx, cy, cz));
            if (!l) continue;
            for (const id of l) if (!this.castle.dynamic[id] && test(id)) return hit;
          }
    }
    return hit;
  }

  /** Rule 5, the end of the tip: every body of the part turns dynamic with the part's velocity where it is, ghosts take the same and fly on. */
  private release(S: Struct, g: Group) {
    const n = g.ids.length;
    const w = g.omega;
    for (let j = 0; j < n; j++) {
      const rx = g.pos[j * 3] - g.hx, ry = g.pos[j * 3 + 1] - g.hy, rz = g.pos[j * 3 + 2] - g.hz;
      const vx = w * (-g.uz * ry), vy = w * (g.uz * rx - g.ux * rz), vz = w * (g.ux * ry);
      const wx = w * g.ux, wz = w * g.uz;
      const id = g.ids[j];
      if (g.ghost[j]) {
        this.ghosts.push({
          id, x: g.pos[j * 3], y: g.pos[j * 3 + 1], z: g.pos[j * 3 + 2], vx, vy, vz,
          qx: g.rot[j * 4], qy: g.rot[j * 4 + 1], qz: g.rot[j * 4 + 2], qw: g.rot[j * 4 + 3], wx, wy: 0, wz, age: 0,
        });
      } else {
        this.castle.letGo(id, g.pos[j * 3], g.pos[j * 3 + 1], g.pos[j * 3 + 2], g.rot[j * 4], g.rot[j * 4 + 1], g.rot[j * 4 + 2], g.rot[j * 4 + 3], vx, vy, vz, wx, 0, wz);
      }
    }
    S.group = null;
    this.setState(S, StaticState.Fallen);
    this.emit(EventKind.Released, S.def.index, n, g.bodies, 0);
  }

  // ---- brittle stones in flight ----

  private flyGhosts() {
    if (!this.ghosts.length) return;
    const keep: Ghost[] = [];
    for (const h of this.ghosts) {
      h.age++;
      h.vy -= G * DT;
      h.x += h.vx * DT;
      h.y += h.vy * DT;
      h.z += h.vz * DT;
      if (h.wx !== 0 || h.wy !== 0 || h.wz !== 0) {
        const k = 0.5 * DT;
        const nqx = h.qx + k * (h.wx * h.qw + h.wy * h.qz - h.wz * h.qy);
        const nqy = h.qy + k * (-h.wx * h.qz + h.wy * h.qw + h.wz * h.qx);
        const nqz = h.qz + k * (h.wx * h.qy - h.wy * h.qx + h.wz * h.qw);
        const nqw = h.qw + k * (-h.wx * h.qx - h.wy * h.qy - h.wz * h.qz);
        const l = dsqrt(nqx * nqx + nqy * nqy + nqz * nqz + nqw * nqw);
        h.qx = nqx / l;
        h.qy = nqy / l;
        h.qz = nqz / l;
        h.qw = nqw / l;
      }
      if (this.ghostDone(h)) this.castle.dustGhost(h.id);
      else keep.push(h);
    }
    this.ghosts = keep;
  }

  /** A brittle stone turns to dust at its first touch: the ground, standing masonry, or (a guard) after brittleTicks. */
  private ghostDone(h: Ghost): boolean {
    if (h.age >= STRUCTURE.brittleTicks) return true;
    const id = h.id;
    this.halfExtents(h.qx, h.qy, h.qz, h.qw, this.lh[id * 3], this.lh[id * 3 + 1], this.lh[id * 3 + 2]);
    if (h.y - this.ey <= this.terrain.heightAt(h.x, h.z)) return true;
    if (h.y > 24) return false;
    const list = this.tmp;
    list.length = 0;
    this.castle.standingNear(h.x, h.y, h.z, this.smallPad, list);
    const bmin = this.bmin, bmax = this.bmax;
    for (const o of list) {
      const i = o * 3;
      if (h.x > bmin[i] && h.x < bmax[i] && h.y > bmin[i + 1] && h.y < bmax[i + 1] && h.z > bmin[i + 2] && h.z < bmax[i + 2]) return true;
    }
    if (h.y < this.bigTop) {
      // A big stone's centre may lie in a neighbouring cell: look at the cells around.
      for (let cx = Math.floor((h.x - 4) / 4); cx <= Math.floor((h.x + 4) / 4); cx++)
        for (let cy = Math.floor((h.y - 4) / 4); cy <= Math.floor((h.y + 4) / 4); cy++)
          for (let cz = Math.floor((h.z - 4) / 4); cz <= Math.floor((h.z + 4) / 4); cz++) {
            const bl = this.bigCells.get(this.bigKey(cx, cy, cz));
            if (!bl) continue;
            for (const o of bl) {
              if (this.castle.dynamic[o]) continue;
              const i = o * 3;
              if (h.x > bmin[i] && h.x < bmax[i] && h.y > bmin[i + 1] && h.y < bmax[i + 1] && h.z > bmin[i + 2] && h.z < bmax[i + 2]) return true;
            }
          }
    }
    return false;
  }

  /** Poses of what this pass moves (a toppling part, brittle stones in flight), appended after the world's own. */
  private report(out: Float32Array, n: number, max: number): number {
    for (const S of this.S) {
      const g = S.group;
      if (!g) continue;
      for (let j = 0; j < g.ids.length && n < max; j++) {
        const o = n * 8;
        out[o] = g.ids[j];
        out[o + 1] = g.pos[j * 3];
        out[o + 2] = g.pos[j * 3 + 1];
        out[o + 3] = g.pos[j * 3 + 2];
        out[o + 4] = g.rot[j * 4];
        out[o + 5] = g.rot[j * 4 + 1];
        out[o + 6] = g.rot[j * 4 + 2];
        out[o + 7] = g.rot[j * 4 + 3];
        n++;
      }
    }
    for (const h of this.ghosts) {
      if (n >= max) break;
      const o = n * 8;
      out[o] = h.id;
      out[o + 1] = h.x;
      out[o + 2] = h.y;
      out[o + 3] = h.z;
      out[o + 4] = h.qx;
      out[o + 5] = h.qy;
      out[o + 6] = h.qz;
      out[o + 7] = h.qw;
      n++;
    }
    return n;
  }

  // ---- reading ----

  /** A structure's last report (index into `list`). */
  status(i: number): StructureStatus {
    return this.S[i].status;
  }

  /** Rule 12: load / carry of a structure's course now (0: nothing above it or undamaged and unloaded; Infinity: nothing of it stands under a load). */
  ratio(i: number, course: number): number {
    const S = this.S[i];
    return course >= 0 && course < S.nCarry ? S.rC[course] : 0;
  }

  /** The structure a stone belongs to (-1: none). */
  structureOf(id: number): number {
    return this.owner[id] ?? -1;
  }

  /** Brittle stones in flight now (no Rapier body). */
  ghostCount(): number {
    return this.ghosts.length;
  }

  /** How many stones of a structure's toppling part are Rapier bodies and how many in all (0, 0 when none tips). */
  groupSize(i: number): { stones: number; bodies: number } {
    const g = this.S[i].group;
    return g ? { stones: g.ids.length, bodies: g.bodies } : { stones: 0, bodies: 0 };
  }

  hashInto(out: number[]) {
    for (const S of this.S) {
      out.push(S.state, S.pendCourse, S.pendMode, S.pendTick);
      const g = S.group;
      if (g) out.push(g.hx, g.hy, g.hz, g.ux, g.uz, g.theta, g.omega, g.start, g.ids.length);
    }
    for (const h of this.ghosts) out.push(h.id, h.x, h.y, h.z, h.vx, h.vy, h.vz, h.qx, h.qy, h.qz, h.qw, h.wx, h.wy, h.wz, h.age);
  }
}
