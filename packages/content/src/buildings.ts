// Plots and buildings of a match castle (phase 2 M3), as data. Each courtyard
// has six plots; a plot takes a Barracks, a Powder Mill or a Foundry. A
// building is masonry and timber like the castle: its pieces are laid out in
// advance for every kind on every plot (MATCH_LAYOUT), stay out of the world
// until the building is raised course by course, and come down like any
// other masonry. A building works while most of its pieces stand.
//
// Coordinates are castle 0's own frame (gate at z = -15, keep behind the
// courtyard), as in castle.ts: castle 1 is its mirror image across the
// middle of the field, so a plot sits at the same x in both courtyards. From
// the player's castle, +x is the left.

import { DPI, dcos, dsin, type Rng } from "@keepfall/core";

export type BuildingKind = "barracks" | "mill" | "foundry";
export const BUILDING_KINDS: BuildingKind[] = ["barracks", "mill", "foundry"];

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  cost: number;
  /** Ticks from the order to the last course. */
  build: number;
  /** One line for the build menu. */
  blurb: string;
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  barracks: { kind: "barracks", name: "Barracks", cost: 300, build: 15 * 60, blurb: "Sends a wave every 25 s, with its own route and mix." },
  mill: { kind: "mill", name: "Powder Mill", cost: 200, build: 12 * 60, blurb: "2 gold a second. Sappers need one standing." },
  foundry: { kind: "foundry", name: "Foundry", cost: 250, build: 15 * 60, blurb: "Gun upgrades. Musketeers need one standing." },
};

/** A building stops working when fewer than this share of its pieces still stand. */
export const BUILDING_ALIVE = 0.6;

export interface Plot {
  id: number;
  /** Centre in castle 0's frame, and half extents of the ground it takes. */
  x: number;
  z: number;
  hw: number;
  hd: number;
  /** Seen from the player's castle. */
  name: string;
}

/** Six plots per courtyard: front, middle and beside the keep, down each side, clear of the gate and the space inside it. */
export const PLOTS: Plot[] = [
  { id: 0, x: 9, z: -9.5, hw: 2.5, hd: 2.6, name: "front left" },
  { id: 1, x: -9, z: -9.5, hw: 2.5, hd: 2.6, name: "front right" },
  { id: 2, x: 9.5, z: -2, hw: 2.5, hd: 2.6, name: "middle left" },
  { id: 3, x: -9.5, z: -2, hw: 2.5, hd: 2.6, name: "middle right" },
  { id: 4, x: 9.5, z: 5.6, hw: 2.5, hd: 2.6, name: "keep left" },
  { id: 5, x: -9.5, z: 5.6, hw: 2.5, hd: 2.6, name: "keep right" },
];

/** Each castle starts with a Barracks on this plot (the M2 barracks). */
export const START_BARRACKS = 0;

export type BuildingPart = "building" | "roof";

/** One piece of a building, in castle 0's frame. */
export interface BuildingPiece {
  part: BuildingPart;
  material: "stone" | "wood" | "roof";
  hx: number;
  hy: number;
  hz: number;
  x: number;
  y: number;
  z: number;
  q: [number, number, number, number];
  course: number;
}

const GAP = 0.004;
const COURSE = 0.5;
const THICK = 0.4;
const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];

class Pieces {
  out: BuildingPiece[] = [];

  add(p: Omit<BuildingPiece, "q"> & { q?: [number, number, number, number] }) {
    this.out.push({ ...p, q: p.q ?? IDENTITY });
  }

  /**
   * A brick wall run along x or z from `from` to `to`, `n` blocks a course,
   * odd courses shifted by half a block (running bond, halves at the ends).
   * `gap` leaves out the blocks of courses below `gapTop` that overlap
   * [gap0, gap1] (a doorway).
   */
  run(along: "x" | "z", from: number, to: number, fixed: number, n: number, c0: number, c1: number, gap?: { a: number; b: number; top: number }) {
    const b = (to - from) / n;
    for (let c = c0; c < c1; c++) {
      const cuts: Array<[number, number]> = [];
      if ((c & 1) === 1 && n > 1) {
        cuts.push([from, from + b / 2]);
        for (let i = 0; i < n - 1; i++) cuts.push([from + b / 2 + i * b, from + b / 2 + (i + 1) * b]);
        cuts.push([to - b / 2, to]);
      } else for (let i = 0; i < n; i++) cuts.push([from + i * b, from + (i + 1) * b]);
      for (const [p0, p1] of cuts) {
        if (gap && c < gap.top && p1 > gap.a + 0.05 && p0 < gap.b - 0.05) continue;
        const half = (p1 - p0) / 2 - GAP;
        const mid = (p0 + p1) / 2;
        const y = c * COURSE + COURSE / 2, hy = COURSE / 2 - GAP, ht = THICK / 2 - GAP;
        if (along === "x") this.add({ part: "building", material: "stone", hx: half, hy, hz: ht, x: mid, y, z: fixed, course: c });
        else this.add({ part: "building", material: "stone", hx: ht, hy, hz: half, x: fixed, y, z: mid, course: c });
      }
    }
  }

  /**
   * Four brick walls round a w by d footprint centred on (cx, cz), `courses`
   * high: the long walls run the length (along z), the end walls fit between
   * them. A doorway in the long wall facing the courtyard's middle.
   */
  walls(cx: number, cz: number, w: number, d: number, courses: number, nLong: number, nEnd: number, door: { w: number; top: number }) {
    const inward = cx > 0 ? -1 : 1; // the long wall that faces the middle of the courtyard
    for (const side of [-1, 1]) {
      const x = cx + side * (w / 2 - THICK / 2);
      this.run("z", cz - d / 2, cz + d / 2, x, nLong, 0, courses, side === inward ? { a: cz - door.w / 2, b: cz + door.w / 2, top: door.top } : undefined);
    }
    for (const side of [-1, 1]) this.run("x", cx - w / 2 + THICK, cx + w / 2 - THICK, cz + side * (d / 2 - THICK / 2), nEnd, 0, courses);
  }

  /**
   * A gabled roof on a w by d building whose walls end `top` high, the ridge
   * along z: two slabs pitched about z, their undersides on the walls' outer
   * top edges, overhanging the eaves by 0.3 m. Returns the ridge's height.
   */
  gable(cx: number, cz: number, w: number, d: number, top: number, pitchDeg: number): number {
    const p = (pitchDeg / 180) * DPI;
    const cp = dcos(p), sp = dsin(p), tp = sp / cp;
    const run = w / 2 + 0.3;
    const hy = 0.1;
    // The slab's middle, half its run from the ridge: its underside lies on the line through the wall's outer top edge.
    const yc = top + (w / 2 - run / 2) * tp + hy / cp;
    for (const side of [-1, 1]) {
      // Rotation about z by -side * p: each slab falls away from the ridge.
      const a = (-side * p) / 2;
      this.add({ part: "roof", material: "roof", hx: run / (2 * cp) - 0.01, hy: hy - GAP, hz: d / 2 + 0.25, x: cx + side * (run / 2), y: yc, z: cz, q: [0, 0, dsin(a), dcos(a)], course: 99 });
    }
    return top + (w / 2) * tp + (2 * hy) / cp;
  }
}

/** The pieces of a building of this kind on this plot (castle 0's frame), bottom courses first. */
export function buildingPieces(kind: BuildingKind, plot: Plot): BuildingPiece[] {
  const b = new Pieces();
  const { x, z } = plot;
  if (kind === "barracks") {
    // A long, low hall with a wide doorway and a steep gabled roof.
    const w = 3.6, d = 4.8, courses = 5;
    b.walls(x, z, w, d, courses, 3, 2, { w: 1.6, top: 4 });
    b.gable(x, z, w, d, courses * COURSE, 38);
  } else if (kind === "mill") {
    // A squat brick base with a timber upper storey and a vent on the ridge: taller than the others.
    const w = 3.8, d = 3.8, courses = 4;
    b.walls(x, z, w, d, courses, 3, 2, { w: 1.27, top: 3 });
    const base = courses * COURSE, up = 1.5, t = 0.16;
    for (const side of [-1, 1]) {
      // Plank walls flush with the brick's outer faces, so the roof sits on them.
      b.add({ part: "building", material: "wood", hx: t / 2 - GAP, hy: up / 2 - GAP, hz: d / 2 - GAP, x: x + side * (w / 2 - t / 2), y: base + up / 2, z, course: courses });
      b.add({ part: "building", material: "wood", hx: w / 2 - t - GAP, hy: up / 2 - GAP, hz: t / 2 - GAP, x, y: base + up / 2, z: z + side * (d / 2 - t / 2), course: courses });
    }
    const ridge = b.gable(x, z, w, d, base + up, 45);
    b.add({ part: "building", material: "wood", hx: 0.35, hy: 0.35, hz: 0.45, x, y: ridge + 0.3, z, course: 100 });
  } else {
    // A hall with a lean of roof and a tall brick chimney at its back corner.
    const w = 4.0, d = 4.6, courses = 4;
    b.walls(x, z, w, d, courses, 3, 2, { w: 1.53, top: 3 });
    b.gable(x, z, w, d, courses * COURSE, 22);
    const outward = x > 0 ? 1 : -1;
    const cx = x + outward * (w / 2 - 0.55), cz = z + d / 2 + 0.55;
    for (let c = 0; c < 15; c++) b.add({ part: "building", material: "stone", hx: 0.5 - GAP, hy: COURSE / 2 - GAP, hz: 0.5 - GAP, x: cx, y: c * COURSE + COURSE / 2, z: cz, course: c });
  }
  return b.out;
}

/** Shade per piece, from the layout's own stream (kept here so castle.ts stays the one that numbers pieces). */
export function shadeOf(rng: Rng): number {
  return rng.next();
}
