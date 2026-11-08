// Deterministic layout of two masonry castles facing each other across a
// field. Shared by the physics (worker) and the renderer (main thread): both
// call buildLayout() and get identical stones, ids and neighbours.
//
// Coordinates: metres, Y up. The enemy castle (castle 0) sits at the origin
// with its gate facing -Z. The player's castle (castle 1) is its mirror image
// at z = -DIST, gate facing +Z. The player's cannon sits on castle 1's front
// wall and fires along +Z.

import { DPI, dcos, dsin, dsqrt, quatY, quatYX, Rng } from "@keepfall/core";
import { BUILDING_KINDS, buildingPieces, PLOTS, type BuildingKind } from "./buildings";
import { DIST } from "./field";
import { BRIDGES, bridgePieces, valleyHeight, type BridgeSite } from "./map";

export type Shape = "box" | "wedge";
export type Material = "stone" | "wood" | "plaster" | "roof" | "banner";
/**
 * "floor" is the lab layout's single keep platform. "storey" is a board of the
 * keep's timber floors (layout option keepFloors): only bursts and direct hits
 * break one, not falling rubble, so each shell caves in one level.
 */
export type Part = "wall" | "tower" | "keep" | "merlon" | "house" | "roof" | "gate" | "floor" | "storey" | "banner" | "bridge" | "building";
export type Quat = [number, number, number, number];

export interface Stone {
  id: number;
  /** 0 the enemy castle, 1 the player's, 2 the field (bridges): each group has its own support check. */
  castle: 0 | 1 | 2;
  part: Part;
  material: Material;
  shape: Shape;
  /** Half extents of the box. For wedges: hy is half height; hx, hz are unused (see layout.wedge). */
  hx: number;
  hy: number;
  hz: number;
  x: number;
  y: number;
  z: number;
  /** Rotation quaternion [x, y, z, w]. */
  q: Quat;
  course: number;
  grounded: boolean;
  /** 0..1, stable per stone, for colour variation. */
  shade: number;
  /** A beam that falls as soon as either of its supports goes (bridge stringers), not only when both do. */
  span?: boolean;
  /** A bridge deck plank: the nav grid walks on it whatever lies below. */
  deck?: boolean;
  /**
   * Support group, when it is not the castle number: the courtyard buildings
   * of castle 0 and 1 are groups 3 and 4 (they stand on their own ground).
   */
  group?: number;
  /** A building's piece (MATCH_LAYOUT): the plot it stands on and the kind of building; out of the world until raised. */
  plot?: number;
  kind?: BuildingKind;
}

/** The pieces of one kind of building on one plot of one castle (ids first to first + count - 1). */
export interface PlotSet {
  castle: 0 | 1;
  plot: number;
  kind: BuildingKind;
  first: number;
  count: number;
}

export interface WedgeSpec {
  rIn: number;
  rOut: number;
  /** Centre radius: the wedge's local origin sits on this radius. */
  rc: number;
  halfAngle: number;
  hy: number;
  /** 8 local-space corner points (x, y, z) * 8. Local +Z points radially outward, local X is tangential. */
  points: Float32Array;
}

export interface CastleLayout {
  stones: Stone[];
  wedge: WedgeSpec;
  /** For each stone: ids of neighbours below it, above it, and beside it (same courses). */
  below: number[][];
  above: number[][];
  side: number[][];
  /** The banner pole on each keep: index 0 enemy, 1 player. */
  bannerIds: [number, number];
  flag: { w: number; h: number };
  /** The player's cannon muzzle. */
  cannon: { x: number; y: number; z: number };
  /** Centre z of each castle. */
  castleZ: [number, number];
  dist: number;
  /** Height of the top of the enemy keep's walls. */
  keepTop: number;
  /** A keep is toppled when its banner's centre falls below this height. */
  bannerFallY: number;
  /** The bridges (group 2), each with the id range of its pieces. */
  bridges: Array<{ site: BridgeSite; first: number; count: number }>;
  /** Buildings laid out on the courtyard plots (MATCH_LAYOUT; empty otherwise): castle 0's sets, then castle 1's, plot by plot. */
  plots: PlotSet[];
  /** Support groups: the two castles, the bridges, then each castle's buildings when there are plots. */
  groups: number;
  /**
   * The keep has timber floors (layout option keepFloors). The sim then lets
   * each banner touch only its keep's intact walls and floors, the ground and
   * shots, so loose rubble never carries it off: it drops a floor at a time.
   */
  keepFloors: boolean;
}

export { DIST } from "./field";
const T = 15; // half distance between tower centres
const COURSE = 0.5; // course height
const GAP = 0.004; // shrink per side, so neighbours never overlap
const BLOCK = 1.25; // nominal block length
const WALL_COURSES = 16; // 8 m curtain walls
const WALL_THICK = 2.0;
const TOWER_COURSES = 24; // 12 m towers
const TOWER_R_OUT = 3.6;
const TOWER_R_IN = 2.4;
const TOWER_N = 20; // wedges per ring
const KEEP_COURSES = 40; // 20 m keep
const KEEP_SIZE = 10;
const KEEP_THICK = 1.4;
const KEEP_Z = 4;
const GATE_HALF = 2.0; // gate opening is 4 m wide
const GATE_COURSES = 10; // and 5 m tall
/** keepFloors: timber storeys at 7 and 13.5 m under the roof platform (20 m), each laid as boards. Wider apart than a burst reaches (4.6 m), so a shell caves in one level. */
export const KEEP_STOREYS = [14, 27, KEEP_COURSES];
const BOARDS = 6;
const BOARD_THICK = 0.3;

const IDENTITY: Quat = [0, 0, 0, 1];

class Builder {
  stones: Stone[] = [];
  rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  add(s: Omit<Stone, "id" | "castle" | "grounded" | "shade">): Stone {
    const stone: Stone = { ...s, id: this.stones.length, castle: 0, grounded: false, shade: this.rng.next() };
    this.stones.push(stone);
    return stone;
  }

  /**
   * A straight, axis-aligned wall run from a to b (along X if za == zb, else along Z),
   * with running bond: odd courses start with a half block.
   */
  run(part: Part, along: "x" | "z", from: number, to: number, fixed: number, thick: number, c0: number, c1: number) {
    const len = to - from;
    const n = Math.max(1, Math.round(len / BLOCK));
    const b = len / n;
    for (let c = c0; c < c1; c++) {
      const odd = (c & 1) === 1;
      const pieces: Array<[number, number]> = [];
      if (odd && n > 1) {
        pieces.push([from, from + b / 2]);
        for (let i = 0; i < n - 1; i++) pieces.push([from + b / 2 + i * b, from + b / 2 + (i + 1) * b]);
        pieces.push([to - b / 2, to]);
      } else {
        for (let i = 0; i < n; i++) pieces.push([from + i * b, from + (i + 1) * b]);
      }
      for (const [p0, p1] of pieces) {
        const half = (p1 - p0) / 2 - GAP;
        const centre = (p0 + p1) / 2;
        // Stones are a touch irregular: up to 3 cm shy of the wall faces.
        const ht = thick / 2 - GAP - this.rng.next() * 0.03;
        const y = c * COURSE + COURSE / 2;
        const hy = COURSE / 2 - GAP;
        if (along === "x") {
          this.add({ part, material: "stone", shape: "box", hx: half, hy, hz: ht, x: centre, y, z: fixed, q: IDENTITY, course: c });
        } else {
          this.add({ part, material: "stone", shape: "box", hx: ht, hy, hz: half, x: fixed, y, z: centre, q: IDENTITY, course: c });
        }
      }
    }
  }

  /** Merlons along a wall top, on the outer edge. `outward` is +1 or -1 along the wall's normal axis. */
  merlons(along: "x" | "z", from: number, to: number, fixed: number, thick: number, outward: number, course: number) {
    const span = to - from;
    const pitch = 1.8; // merlon 1.0 m + crenel 0.8 m
    const n = Math.max(1, Math.floor((span + 0.8) / pitch));
    const used = n * pitch - 0.8;
    const start = from + (span - used) / 2;
    const off = fixed + outward * (thick / 2 - 0.3);
    const y = course * COURSE + 0.45;
    for (let i = 0; i < n; i++) {
      const centre = start + i * pitch + 0.5;
      if (along === "x") {
        this.add({ part: "merlon", material: "stone", shape: "box", hx: 0.5 - GAP, hy: 0.45 - GAP, hz: 0.3 - GAP, x: centre, y, z: off, q: IDENTITY, course });
      } else {
        this.add({ part: "merlon", material: "stone", shape: "box", hx: 0.3 - GAP, hy: 0.45 - GAP, hz: 0.5 - GAP, x: off, y, z: centre, q: IDENTITY, course });
      }
    }
  }

  tower(cx: number, cz: number, wedge: WedgeSpec) {
    const step = (2 * DPI) / TOWER_N;
    for (let c = 0; c < TOWER_COURSES; c++) {
      const offset = (c & 1) === 1 ? step / 2 : 0;
      const y = c * COURSE + COURSE / 2;
      for (let i = 0; i < TOWER_N; i++) {
        const phi = i * step + offset;
        this.add({
          part: "tower",
          material: "stone",
          shape: "wedge",
          hx: 0,
          hy: wedge.hy,
          hz: 0,
          x: cx + wedge.rc * dcos(phi),
          y,
          z: cz + wedge.rc * dsin(phi),
          q: quatY(DPI / 2 - phi),
          course: c,
        });
      }
    }
    // Merlons on every other wedge position of the top ring.
    const r = TOWER_R_OUT - 0.3;
    for (let i = 0; i < TOWER_N; i += 2) {
      const phi = i * step;
      this.add({
        part: "merlon",
        material: "stone",
        shape: "box",
        hx: 0.45 - GAP,
        hy: 0.45 - GAP,
        hz: 0.3 - GAP,
        x: cx + r * dcos(phi),
        y: TOWER_COURSES * COURSE + 0.45,
        z: cz + r * dsin(phi),
        q: quatY(DPI / 2 - phi),
        course: TOWER_COURSES,
      });
    }
  }

  keep(floors: boolean): { platformTop: number } {
    const h = KEEP_SIZE / 2;
    const t = KEEP_THICK;
    for (let c = 0; c < KEEP_COURSES; c++) {
      const nsFull = (c & 1) === 0;
      // North and south faces run along X; east and west along Z. Corners interlock.
      if (nsFull) {
        this.run("keep", "x", -h, h, KEEP_Z - h + t / 2, t, c, c + 1);
        this.run("keep", "x", -h, h, KEEP_Z + h - t / 2, t, c, c + 1);
        this.run("keep", "z", KEEP_Z - h + t, KEEP_Z + h - t, -h + t / 2, t, c, c + 1);
        this.run("keep", "z", KEEP_Z - h + t, KEEP_Z + h - t, h - t / 2, t, c, c + 1);
      } else {
        this.run("keep", "z", KEEP_Z - h, KEEP_Z + h, -h + t / 2, t, c, c + 1);
        this.run("keep", "z", KEEP_Z - h, KEEP_Z + h, h - t / 2, t, c, c + 1);
        this.run("keep", "x", -h + t, h - t, KEEP_Z - h + t / 2, t, c, c + 1);
        this.run("keep", "x", -h + t, h - t, KEEP_Z + h - t / 2, t, c, c + 1);
      }
    }
    const inner = h - t;
    const topY = KEEP_COURSES * COURSE;
    if (floors) {
      // Timber floors, as in a real keep: boards spanning wall to wall at each storey,
      // the top one carrying the banner. A shell caves in one storey; the banner drops to the next.
      const bw = (2 * inner) / BOARDS;
      for (const c of KEEP_STOREYS) {
        for (let k = 0; k < BOARDS; k++) {
          this.add({
            part: "storey",
            material: "wood",
            shape: "box",
            hx: inner - GAP,
            hy: BOARD_THICK / 2 - GAP,
            hz: bw / 2 - GAP,
            x: 0,
            y: c * COURSE - BOARD_THICK / 2,
            z: KEEP_Z - inner + bw * (k + 0.5),
            q: IDENTITY,
            course: c - 1,
          });
        }
      }
    } else {
      // The lab layout: one timber platform inside the top course carries the banner.
      this.add({
        part: "floor",
        material: "wood",
        shape: "box",
        hx: inner - GAP,
        hy: 0.15,
        hz: inner - GAP,
        x: 0,
        y: topY - 0.15 - GAP,
        z: KEEP_Z,
        q: IDENTITY,
        course: KEEP_COURSES - 1,
      });
    }
    this.merlons("x", -h, h, KEEP_Z - h + t / 2, t, -1, KEEP_COURSES);
    this.merlons("x", -h, h, KEEP_Z + h - t / 2, t, 1, KEEP_COURSES);
    this.merlons("z", KEEP_Z - h + 1.2, KEEP_Z + h - 1.2, -h + t / 2, t, -1, KEEP_COURSES);
    this.merlons("z", KEEP_Z - h + 1.2, KEEP_Z + h - 1.2, h - t / 2, t, 1, KEEP_COURSES);
    return { platformTop: topY - GAP };
  }

  house(cx: number, cz: number, w: number, d: number, h: number) {
    const t = 0.3;
    const hy = h / 2 - GAP;
    // Front and back walls (along X), then the side walls between them.
    this.add({ part: "house", material: "plaster", shape: "box", hx: w / 2 - GAP, hy, hz: t / 2 - GAP, x: cx, y: h / 2, z: cz - d / 2 + t / 2, q: IDENTITY, course: 0 });
    this.add({ part: "house", material: "plaster", shape: "box", hx: w / 2 - GAP, hy, hz: t / 2 - GAP, x: cx, y: h / 2, z: cz + d / 2 - t / 2, q: IDENTITY, course: 0 });
    this.add({ part: "house", material: "plaster", shape: "box", hx: t / 2 - GAP, hy, hz: d / 2 - t - GAP, x: cx - w / 2 + t / 2, y: h / 2, z: cz, q: IDENTITY, course: 0 });
    this.add({ part: "house", material: "plaster", shape: "box", hx: t / 2 - GAP, hy, hz: d / 2 - t - GAP, x: cx + w / 2 - t / 2, y: h / 2, z: cz, q: IDENTITY, course: 0 });
    // Gabled roof: two slabs pitched at 35 degrees, ridge along X.
    const pitch = (35 / 180) * DPI;
    const cp = dcos(pitch);
    const sp = dsin(pitch);
    const run = d / 2 + 0.35; // horizontal run of each slab incl. overhang
    const slope = run / cp;
    const thick = 0.12;
    const rise = (run / 2) * (sp / cp);
    for (const side of [-1, 1]) {
      this.add({
        part: "roof",
        material: "roof",
        shape: "box",
        hx: w / 2 + 0.3,
        hy: thick,
        hz: slope / 2 - 0.01,
        x: cx,
        y: h + rise + thick + 0.02,
        z: cz + side * (run / 2),
        q: quatYX(0, side < 0 ? -pitch : pitch),
        course: 1,
      });
    }
  }
}

function makeWedge(): WedgeSpec {
  const rIn = TOWER_R_IN;
  const rOut = TOWER_R_OUT;
  const rc = (rIn + rOut) / 2;
  const halfAngle = DPI / TOWER_N - GAP / rc;
  const hy = COURSE / 2 - GAP;
  const sa = dsin(halfAngle);
  const ca = dcos(halfAngle);
  const pts: number[] = [];
  for (const r of [rIn, rOut]) {
    for (const s of [-1, 1]) {
      for (const y of [-hy, hy]) {
        pts.push(s * r * sa, y, r * ca - rc);
      }
    }
  }
  return { rIn, rOut, rc, halfAngle, hy, points: new Float32Array(pts) };
}

/** Rotate v by unit quaternion q. */
function rotate(q: Quat, x: number, y: number, z: number): [number, number, number] {
  const [qx, qy, qz, qw] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
}

/** World-space axis-aligned bounds of a stone. */
export function stoneBounds(s: Stone, wedge: WedgeSpec): [number, number, number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const visit = (lx: number, ly: number, lz: number) => {
    const [wx, wy, wz] = rotate(s.q, lx, ly, lz);
    const px = s.x + wx, py = s.y + wy, pz = s.z + wz;
    if (px < x0) x0 = px;
    if (py < y0) y0 = py;
    if (pz < z0) z0 = pz;
    if (px > x1) x1 = px;
    if (py > y1) y1 = py;
    if (pz > z1) z1 = pz;
  };
  if (s.shape === "wedge") {
    const p = wedge.points;
    for (let i = 0; i < 8; i++) visit(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  } else {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) visit(sx * s.hx, sy * s.hy, sz * s.hz);
  }
  return [x0, y0, z0, x1, y1, z1];
}

function oneCastle(seed: number, wedge: WedgeSpec, floors: boolean, houses: boolean): { stones: Stone[]; bannerId: number; platformTop: number } {
  const b = new Builder(seed);
  const e = TOWER_R_OUT - 0.13; // wall ends just inside the tower's skin
  // Front wall (z = -T) with the gate, back wall, and the two side walls.
  b.run("wall", "x", -T + e, -GATE_HALF, -T, WALL_THICK, 0, GATE_COURSES);
  b.run("wall", "x", GATE_HALF, T - e, -T, WALL_THICK, 0, GATE_COURSES);
  b.run("wall", "x", -T + e, T - e, -T, WALL_THICK, GATE_COURSES, WALL_COURSES);
  b.run("wall", "x", -T + e, T - e, T, WALL_THICK, 0, WALL_COURSES);
  b.run("wall", "z", -T + e, T - e, -T, WALL_THICK, 0, WALL_COURSES);
  b.run("wall", "z", -T + e, T - e, T, WALL_THICK, 0, WALL_COURSES);
  b.merlons("x", -T + e, T - e, -T, WALL_THICK, -1, WALL_COURSES);
  b.merlons("x", -T + e, T - e, T, WALL_THICK, 1, WALL_COURSES);
  b.merlons("z", -T + e, T - e, -T, WALL_THICK, -1, WALL_COURSES);
  b.merlons("z", -T + e, T - e, T, WALL_THICK, 1, WALL_COURSES);
  // Gate leaves.
  for (const side of [-1, 1]) {
    b.add({
      part: "gate",
      material: "wood",
      shape: "box",
      hx: GATE_HALF / 2 - GAP,
      hy: (GATE_COURSES * COURSE) / 2 - GAP,
      hz: 0.15,
      x: side * (GATE_HALF / 2),
      y: (GATE_COURSES * COURSE) / 2,
      z: -T - 0.4,
      q: IDENTITY,
      course: 0,
    });
  }
  for (const [tx, tz] of [[-T, -T], [T, -T], [-T, T], [T, T]] as const) b.tower(tx, tz, wedge);
  const { platformTop } = b.keep(floors);
  if (houses) {
    b.house(-7.5, -8.5, 6, 4, 3); // barracks
    b.house(7.5, -8.5, 6, 4, 3); // workshop
    b.house(-9.2, 6, 3, 5, 2.6);
    b.house(9.2, 6, 3, 5, 2.6);
  }
  // Banner pole on the keep platform: the enemy wins when this falls.
  const poleH = 4;
  const banner = b.add({
    part: "banner",
    material: "banner",
    shape: "box",
    hx: 0.08,
    hy: poleH / 2,
    hz: 0.08,
    x: 0,
    y: platformTop + poleH / 2 + 0.01,
    z: KEEP_Z,
    q: IDENTITY,
    course: KEEP_COURSES,
  });
  return { stones: b.stones, bannerId: banner.id, platformTop };
}

/** Builds both castles and the neighbour graph. Same input, same output, on every machine. */
export interface LayoutOptions {
  /**
   * Mirror wedge shapes properly for castle 1. The lab's reference layout
   * (and its device hash) predates this fix, so it stays off there: without
   * it, castle 1's tower wedges are turned inside out.
   */
  mirrorWedges?: boolean;
  /**
   * Timber floors inside the keep (the owner's choice for matches): one shell
   * caves in one storey and the banner drops a floor at a time, so toppling a
   * keep takes a siege. Off in the lab, whose reference hash predates them.
   */
  keepFloors?: boolean;
  /** Timber bridges to build across the stream (the valley's BRIDGES), after both castles. */
  bridges?: BridgeSite[];
  /** The courtyards' decorative houses (default on); a match castle has plots instead. */
  houses?: boolean;
  /** Lay out every kind of building on every plot of both courtyards (after the bridges), out of the world until raised. */
  plots?: boolean;
}

/** The Practice range's world: wedges mirrored properly, timber floors in the keeps, the valley's bridges. */
export const GAME_LAYOUT: LayoutOptions = { mirrorWedges: true, keepFloors: true, bridges: BRIDGES };

/** A match's world (phase 2 M3): the same, with plots in both courtyards instead of the houses. */
export const MATCH_LAYOUT: LayoutOptions = { ...GAME_LAYOUT, houses: false, plots: true };

export function buildLayout(seed = 1, opts: LayoutOptions = {}): CastleLayout {
  const wedge = makeWedge();
  const floors = opts.keepFloors === true;
  const houses = opts.houses !== false;
  const enemy = oneCastle(seed, wedge, floors, houses);
  const player = oneCastle(seed + 1, wedge, floors, houses);
  const stones: Stone[] = [];
  for (const s of enemy.stones) stones.push({ ...s, id: stones.length, castle: 0 });
  const offset = stones.length;
  for (const s of player.stones) {
    // Mirror across z = -DIST / 2: z' = -DIST - z; rotations mirror as (-x, -y, z, w).
    // A reflection must also flip the piece's own shape. Wedges are symmetric across local X,
    // so reflecting local Z equals a half turn about local Y: q' = mirror(q) * (0, 1, 0, 0).
    const q: Quat =
      opts.mirrorWedges && s.shape === "wedge" ? [-s.q[2], s.q[3], -s.q[0], s.q[1]] : [-s.q[0], -s.q[1], s.q[2], s.q[3]];
    stones.push({ ...s, id: stones.length, castle: 1, z: -DIST - s.z, q });
  }
  const bannerIds: [number, number] = [enemy.bannerId, offset + player.bannerId];
  const bridges: CastleLayout["bridges"] = [];
  if (opts.bridges) {
    const rng = new Rng(seed + 77);
    for (const site of opts.bridges) {
      const first = stones.length;
      for (const p of bridgePieces(site)) {
        stones.push({ id: stones.length, castle: 2, part: "bridge", material: "wood", shape: "box", hx: p.hx, hy: p.hy, hz: p.hz, x: p.x, y: p.y, z: p.z, q: IDENTITY, course: 0, grounded: false, shade: rng.next(), ...(p.span ? { span: true } : {}), ...(p.deck ? { deck: true } : {}) });
      }
      bridges.push({ site, first, count: stones.length - first });
    }
  }
  // Buildings on the plots: every kind on every plot, castle 0's (group 3) then castle 1's (group 4), mirrored like the castle.
  const plots: PlotSet[] = [];
  if (opts.plots) {
    const rng = new Rng(seed + 131);
    for (const castle of [0, 1] as const) {
      for (const plot of PLOTS) {
        for (const kind of BUILDING_KINDS) {
          const first = stones.length;
          for (const p of buildingPieces(kind, plot)) {
            const q: Quat = castle === 1 ? [-p.q[0], -p.q[1], p.q[2], p.q[3]] : p.q;
            stones.push({ id: stones.length, castle, part: p.part, material: p.material, shape: "box", hx: p.hx, hy: p.hy, hz: p.hz, x: p.x, y: p.y, z: castle === 1 ? -DIST - p.z : p.z, q, course: p.course, grounded: false, shade: rng.next(), group: 3 + castle, plot: plot.id, kind });
          }
          plots.push({ castle, plot: plot.id, kind, first, count: stones.length - first });
        }
      }
    }
  }

  // Neighbour graph from bounds overlap.
  const n = stones.length;
  const bounds = stones.map((s) => stoneBounds(s, wedge));
  for (let i = 0; i < n; i++) stones[i].grounded = bounds[i][1] < 0.02;
  // Bridge pieces stand on the valley's ground, not on y = 0: a pier cap over the water is held up by its posts.
  for (const b of bridges) {
    for (let i = b.first; i < b.first + b.count; i++) stones[i].grounded = bounds[i][1] < valleyHeight(stones[i].x, stones[i].z) + 0.02;
  }
  const below: number[][] = Array.from({ length: n }, () => []);
  const above: number[][] = Array.from({ length: n }, () => []);
  const side: number[][] = Array.from({ length: n }, () => []);
  const CELL = 2.5;
  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number) => (cx + 1000) * 4096 + (cz + 1000);
  for (let i = 0; i < n; i++) {
    const [x0, , z0, x1, , z1] = bounds[i];
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = key(cx, cz);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(i);
      }
    }
  }
  const TOL = 0.06;
  const seen = new Set<number>();
  for (const list of grid.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let c = a + 1; c < list.length; c++) {
        const i = list[a] < list[c] ? list[a] : list[c];
        const j = list[a] < list[c] ? list[c] : list[a];
        const pair = i * n + j;
        if (seen.has(pair)) continue;
        seen.add(pair);
        const A = bounds[i];
        const B = bounds[j];
        const ox = Math.min(A[3], B[3]) - Math.max(A[0], B[0]);
        const oy = Math.min(A[4], B[4]) - Math.max(A[1], B[1]);
        const oz = Math.min(A[5], B[5]) - Math.max(A[2], B[2]);
        if (ox < -TOL || oy < -TOL || oz < -TOL) continue;
        if (B[1] >= A[4] - 0.05 && ox > 0.05 && oz > 0.05) {
          above[i].push(j);
          below[j].push(i);
        } else if (A[1] >= B[4] - 0.05 && ox > 0.05 && oz > 0.05) {
          above[j].push(i);
          below[i].push(j);
        } else if (oy > 0.05) {
          side[i].push(j);
          side[j].push(i);
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    below[i].sort((p, q) => p - q);
    above[i].sort((p, q) => p - q);
    side[i].sort((p, q) => p - q);
  }

  const T_ = T;
  return {
    stones,
    wedge,
    below,
    above,
    side,
    bannerIds,
    flag: { w: 2.6, h: 1.6 },
    cannon: { x: 0, y: 9.7, z: -DIST + T_ + 1.4 },
    castleZ: [0, -DIST],
    dist: DIST,
    keepTop: KEEP_COURSES * COURSE,
    // With floors the banner must come down to the ground floor (the lowest storey is at 7 m).
    bannerFallY: floors ? 3.5 : KEEP_COURSES * COURSE * 0.6,
    keepFloors: floors,
    bridges,
    plots,
    groups: plots.length ? 5 : 3,
  };
}

// ---------------------------------------------------------------------------
// Terrain for the renderer. The physics only knows a flat field at y = 0, so
// the terrain stays exactly flat where stones and balls can land.

/** Inside this region the ground is flat (y = 0). */
export const FIELD = { x0: -48, x1: 48, z0: -DIST - 42, z1: 42 };

function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Rolling hills outside the flat field. Deterministic, so the physics can share it later. */
export function terrainHeight(x: number, z: number): number {
  const dx = Math.max(FIELD.x0 - x, 0, x - FIELD.x1);
  const dz = Math.max(FIELD.z0 - z, 0, z - FIELD.z1);
  const d = dsqrt(dx * dx + dz * dz);
  if (d <= 0) return 0;
  const t = Math.min(1, d / 60);
  const blend = t * t * (3 - 2 * t);
  let h = 0;
  let amp = 18;
  let f = 1 / 70;
  for (let o = 0; o < 4; o++) {
    h += (valueNoise(x * f + 11.3 * o, z * f - 7.1 * o) - 0.3) * amp;
    amp *= 0.45;
    f *= 2.1;
  }
  return Math.max(0, h) * blend + d * 0.06 * blend;
}
