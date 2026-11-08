// Plots and buildings (phase 2 M3), as data: where each courtyard's six plots
// lie, what each building costs and does, how long it takes to rise, and the
// pieces it is built from. Buildings are masonry like the walls: every piece
// is a physics piece in the castle's layout (see castle.ts, layout option
// plots), there from the start for every plot and kind but out of the world
// until that building is built there. A building rises piece by piece from
// the ground up, works while most of it stands and stops when knocked down.
//
// Places are in castle 0's own frame (centre at the origin, the gate side at
// z = -15); castle 1's are mirrored across the middle of the field
// (z' = -DIST - z), as the layout mirrors its stones. Kept clear of the gate
// corridor (x -4 to 4) and of where M4's masons and garrison stand.
// Starting numbers for tuning: everything here is data.

import { DPI, dcos, dsin, quatYX } from "@keepfall/core";
import type { Material, Part, Quat } from "./castle";
import { DIST } from "./field";

export type BuildingKind = "barracks" | "mill" | "foundry";
/** Building kinds in their fixed order (Stone.building and every list of kinds use it). */
export const BUILDING_KINDS: BuildingKind[] = ["barracks", "mill", "foundry"];

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  /** Gold to build it; a ruined one is rebuilt for `rebuild` of it. */
  cost: number;
  /** Ticks it takes to rise from the ground. */
  buildTicks: number;
  /** Gold a second while it works (Powder Mills). */
  income: number;
  /** What it does, for the build wheel. */
  blurb: string;
}

/**
 * Costs and income are kept modest on purpose (the owner's pacing note): M4's
 * masons pay for every stone they put back, so a siege is attrition against
 * the defender's gold, and more income makes castles harder to break. A match
 * should land at 10 to 15 minutes through sieges, repairs and storms, never
 * through waiting: buildings rise in seconds, and nothing is bought on a timer.
 */
export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  barracks: { kind: "barracks", name: "Barracks", cost: 220, buildTicks: 18 * 60, income: 0, blurb: "Sends a wave of 8 every 25 s: set its mix and route" },
  mill: { kind: "mill", name: "Powder Mill", cost: 160, buildTicks: 12 * 60, income: 1.5, blurb: "1.5 gold a second while it stands" },
  foundry: { kind: "foundry", name: "Foundry", cost: 250, buildTicks: 15 * 60, income: 0, blurb: "Upgrades for your guns" },
};

/** A building works while at least this share of its pieces stand; a ruin is rebuilt for this share of its cost. */
export const BUILDING_WORKS = 0.6;
export const BUILDING_REBUILD = 0.5;

export interface Plot {
  index: number;
  /** Centre (castle 0's frame) and footprint along x and z (m). */
  x: number;
  z: number;
  w: number;
  d: number;
  /** As its owner would say it. */
  name: string;
}

/**
 * The six plots of a courtyard (castle 0's frame): the two front plots where
 * the old houses stood, either side of the gate corridor, and four between
 * the keep and the side walls.
 */
export const PLOTS: Plot[] = [
  { index: 0, x: -7.5, z: -8.5, w: 6, d: 4, name: "front left" },
  { index: 1, x: 7.5, z: -8.5, w: 6, d: 4, name: "front right" },
  { index: 2, x: -9.3, z: -1.9, w: 3.4, d: 4, name: "left, by the keep" },
  { index: 3, x: 9.3, z: -1.9, w: 3.4, d: 4, name: "right, by the keep" },
  { index: 4, x: -9.3, z: 5.6, w: 3.4, d: 4.6, name: "back left" },
  { index: 5, x: 9.3, z: 5.6, w: 3.4, d: 4.6, name: "back right" },
];

/** A plot's centre in the world, for a castle (castle 1 is mirrored; x is the same in both). */
export function plotCentre(castle: number, plot: number): { x: number; z: number } {
  const p = PLOTS[plot];
  return { x: p.x, z: castle === 0 ? p.z : -DIST - p.z };
}

/**
 * Plot names as each owner says them: castle 0 looks out along -z, so its
 * left is -x, which is how PLOTS names them; castle 1 looks along +z, so its
 * left is +x and the names swap sides.
 */
export function plotName(castle: number, plot: number): string {
  const n = PLOTS[plot].name;
  return castle === 0 ? n : n.replace(/left|right/, (m) => (m === "left" ? "right" : "left"));
}

/** What stands on each plot when a match starts (both castles): the barracks on the front left plot. */
export const START_BUILDINGS: Array<{ plot: number; kind: BuildingKind }> = [{ plot: 0, kind: "barracks" }];

/** The Practice range's castles: lived in, with something of each kind to shoot at. */
export const PRACTICE_BUILDINGS: Array<{ plot: number; kind: BuildingKind }> = [
  { plot: 0, kind: "barracks" },
  { plot: 1, kind: "foundry" },
  { plot: 4, kind: "mill" },
  { plot: 5, kind: "barracks" },
];

/** One piece of a building, in castle 0's frame. */
export interface BuildingPiece {
  part: Part;
  material: Material;
  hx: number;
  hy: number;
  hz: number;
  x: number;
  y: number;
  z: number;
  q: Quat;
  course: number;
}

const GAP = 0.004;
const IDENTITY: Quat = [0, 0, 0, 1];
const WALL = 0.3;

/**
 * The pieces of a building of this kind on a plot, lowest first (the order
 * they rise in). The ridge runs along x.
 */
export function buildingPieces(kind: BuildingKind, plot: Plot): BuildingPiece[] {
  const out: BuildingPiece[] = [];
  const { x: cx, z: cz, w, d } = plot;
  const add = (part: Part, material: Material, hx: number, hy: number, hz: number, x: number, y: number, z: number, course: number, q: Quat = IDENTITY) =>
    out.push({ part, material, hx: hx - GAP, hy: hy - GAP, hz: hz - GAP, x, y, z, q, course });
  /**
   * One course of walls from y0 to y1: the front and back walls (along x) in
   * two panels each, the side walls (along z) between them; `inset` leaves
   * room at the corners for posts.
   */
  const course = (material: Material, y0: number, y1: number, c: number, inset: number) => {
    const hy = (y1 - y0) / 2, y = (y0 + y1) / 2;
    const x0 = -w / 2 + inset, x1 = w / 2 - inset;
    const half = (x1 - x0) / 4;
    for (const side of [-1, 1]) {
      const z = cz + side * (d / 2 - WALL / 2);
      add("house", material, half, hy, WALL / 2, cx + x0 + half, y, z, c);
      add("house", material, half, hy, WALL / 2, cx + x0 + 3 * half, y, z, c);
    }
    const zs = d / 2 - (inset > WALL ? inset : WALL);
    for (const side of [-1, 1]) add("house", material, WALL / 2, hy, zs, cx + side * (w / 2 - WALL / 2), y, cz, c);
  };
  const roof = (h: number) => {
    // A gabled roof: two slabs pitched at 35 degrees, ridge along x, as the old houses had.
    const pitch = (35 / 180) * DPI;
    const cp = dcos(pitch), sp = dsin(pitch);
    const run = d / 2 + 0.35;
    const slope = run / cp;
    const thick = 0.12;
    const rise = (run / 2) * (sp / cp);
    for (const side of [-1, 1]) {
      out.push({ part: "roof", material: "roof", hx: w / 2 + 0.3, hy: thick, hz: slope / 2 - 0.01, x: cx, y: h + rise + thick + 0.02, z: cz + side * (run / 2), q: quatYX(0, side < 0 ? -pitch : pitch), course: 9 });
    }
  };
  if (kind === "barracks") {
    // A timber-framed hall: corner posts, two courses of plaster panels between them, a roof.
    const H = 2.8, post = 0.24;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add("house", "wood", post / 2, H / 2, post / 2, cx + sx * (w / 2 - post / 2), H / 2, cz + sz * (d / 2 - post / 2), 0);
    course("plaster", 0, H / 2, 0, post);
    course("plaster", H / 2, H, 1, post);
    roof(H);
  } else if (kind === "mill") {
    // A stone ground floor under a plastered upper one.
    course("stone", 0, 1.2, 0, 0);
    course("plaster", 1.2, 2.6, 1, 0);
    roof(2.6);
  } else {
    // The foundry: stone throughout, and a tall stone chimney against the back wall.
    course("stone", 0, 1.3, 0, 0);
    course("stone", 1.3, 2.7, 1, 0);
    roof(2.7);
    const bx = cx - w / 2 + 0.8, bz = cz + d / 2 + 0.46;
    for (let k = 0; k < 6; k++) add("house", "stone", 0.45, 0.55, 0.45, bx, 0.55 + k * 1.1, bz, 2 + k);
  }
  // Lowest first: the order the pieces rise in (stable for equal bottoms).
  const bottom = (p: BuildingPiece) => p.y - p.hy;
  return out.map((p, i) => ({ p, i })).sort((a, b) => bottom(a.p) - bottom(b.p) || a.i - b.i).map((e) => e.p);
}

/** The enemy castle's build order until the AI (M5): each step waits for its time and its gold, in turn. */
export type PlanStep =
  | { at: number; kind: "build"; plot: number; building: BuildingKind; mix?: string; route?: "left" | "centre" | "right" }
  | { at: number; kind: "buy"; emplacement: number; weapon: "longGun" | "mortar" | "chainShot" | "swivel" }
  | { at: number; kind: "upgrade"; emplacement: number; upgrade: string };

/** Emplacement numbers here are the castle's own slots (0 to 7), as the player's are numbered. */
export const ENEMY_PLAN: PlanStep[] = [
  { at: 45 * 60, kind: "build", plot: 1, building: "mill" },
  { at: 2 * 3600, kind: "build", plot: 2, building: "barracks", mix: "breach", route: "left" },
  { at: 3 * 3600 + 15 * 60, kind: "build", plot: 3, building: "foundry" },
  { at: 4 * 3600, kind: "buy", emplacement: 4, weapon: "swivel" },
  { at: 5 * 3600, kind: "build", plot: 4, building: "mill" },
  { at: 6 * 3600, kind: "upgrade", emplacement: 0, upgrade: "heavyShot" },
  { at: 7 * 3600, kind: "buy", emplacement: 5, weapon: "chainShot" },
  { at: 8 * 3600, kind: "build", plot: 5, building: "barracks", mix: "volley", route: "right" },
];
