// Machines (phase 3, 3.5): the organs every castle has from the start, as
// data. An organ is masonry laid out with its castle (layout option organs,
// set only by GAME_LAYOUT, so the lab's reference hash holds), standing from
// the first tick. It works while ORGAN_WORKS of its pieces stand, its key
// piece among them, and masons put it back under the Works repair switch.
//
// 1. The bell: a timber frame with an iron bell on the top of the back right
//    tower (the one tower with no gun slot). While it rings, guns nobody mans
//    engage enemy men within BELL.defend m of their gate and on marked
//    ground; without it only within BELL.late m, and marks do nothing for them.
// 2. The crane: a treadwheel crane in the yard by the masons, its jib 10 m
//    high, just showing over the front wall. Without it masons lay only
//    pieces whose foot is under CRANE.low m and carry rubble; higher work
//    waits, and they rebuild the crane first (its own pieces are always low
//    work: it never needs itself).
// 3. The signal mast: on the keep's roof beside the banner, standing on the
//    top floor's boards. Without it a change of order or road reaches only
//    waves that muster after it; men in the field keep their last order. It
//    goes back up once the roof under it is back.
//
// Places are in castle 0's own frame (centre at the origin, the gate side at
// z = -15), as the layout builds every castle before it mirrors castle 1
// across z (x is kept, so castle 1's left is +x). The bell is the only organ
// whose place differs by castle: each castle's back right tower.
// Starting numbers for tuning: everything here is data (docs/phase-3/05-machines.md).

import type { Material, Part, Quat } from "./castle";

export type OrganKind = "bell" | "crane" | "mast";
/** Organs in their fixed order (Stone.organ and every per-organ list use it). */
export const ORGAN_KINDS: OrganKind[] = ["bell", "crane", "mast"];

export interface OrganDef {
  kind: OrganKind;
  /** As its owner would say it (the masons' section, notes, the minimap). */
  name: string;
  /** What it does while it stands, and what is lost without it (the build menu, the minimap's tooltip). */
  blurb: string;
}

export const ORGANS: Record<OrganKind, OrganDef> = {
  bell: { kind: "bell", name: "the bell", blurb: "Rings when the enemy comes: guns nobody mans engage from 45 m and on your marks; without it from 20 m only" },
  crane: { kind: "crane", name: "the crane", blurb: "Lifts stone: without it masons build only the lowest 4 m" },
  mast: { kind: "mast", name: "the signal mast", blurb: "Signals the field: without it new orders and roads reach only waves that muster after" },
};

/** An organ works while at least this share of its pieces stand, its key piece among them. */
export const ORGAN_WORKS = 0.6;

/** The bell's numbers: how far from their gate guns nobody mans engage enemy men with it ringing (DEFEND, as today) and without it. */
export const BELL = {
  defend: 45,
  /** The owner's choice (November 15): 20 m stays. */
  late: 20,
} as const;

/** The crane's numbers: without it masons lay only pieces whose foot (lowest point as laid out) is under `low` m (8 courses). */
export const CRANE = {
  low: 4,
} as const;

/** One piece of an organ, in castle 0's frame. `key` marks the piece the organ cannot work without (one per organ). */
export interface OrganPiece {
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
  key?: boolean;
}

const GAP = 0.004;
const IDENTITY: Quat = [0, 0, 0, 1];
/** Half the distance between tower centres, the towers' height and the keep's middle (CASTLE_SHAPE's numbers, kept here so this file needs nothing from castle.ts at run time). */
const T = 15;
const TOWER_TOP = 12;
const KEEP_Z = 4;
const KEEP_TOP = 20;
/** Courses for the organ pieces (the masons' order is lowest first; a course is 0.5 m). */
const courseAt = (y: number) => Math.floor(y / 0.5);

/**
 * The pieces of a castle's organ, lowest first, in castle 0's frame (castle 1
 * is mirrored across z by the layout). `castle` picks the bell's tower: each
 * castle's back right one (castle 0's right is +x, castle 1's is -x).
 */
export function organPieces(kind: OrganKind, castle: 0 | 1): OrganPiece[] {
  const out: OrganPiece[] = [];
  const add = (part: Part, material: Material, hx: number, hy: number, hz: number, x: number, y: number, z: number, key = false) =>
    out.push({ part, material, hx: hx - GAP, hy: hy - GAP, hz: hz - GAP, x, y, z, q: IDENTITY, course: courseAt(y - hy + 0.01), ...(key ? { key: true } : {}) });
  if (kind === "bell") {
    // On the ring's top (12 m): two posts just inside the merlons, a stock across the tower's hollow with the bell
    // resting on it (the page hangs it from the headbeam), the headbeam over the posts and a small canopy on that.
    const bx = castle === 0 ? T : -T, bz = T;
    const y0 = TOWER_TOP;
    for (const s of [-1, 1]) add("organ", "wood", 0.15, 1.5, 0.15, bx + s * 2.7, y0 + 1.5, bz);
    add("organ", "wood", 2.55, 0.15, 0.15, bx, y0 + 1.0, bz);
    add("organ", "iron", 0.32, 0.4, 0.32, bx, y0 + 1.15 + 0.4, bz, true);
    add("organ", "wood", 3.0, 0.15, 0.2, bx, y0 + 3.15, bz);
    add("organ", "roof", 1.0, 0.06, 0.7, bx, y0 + 3.3 + 0.06, bz);
  } else if (kind === "crane") {
    // East of the masons' yard, between the front right plot and the plot by the keep: two sills on the ground, the
    // treadwheel standing on them (the page draws it round), a mast of four lengths beside it and the jib on its top,
    // reaching out towards the gate 10 m up, just over the front wall.
    const wx = 10.6, wz = -5.2, mx = 11.4;
    for (const s of [-1, 1]) add("organ", "wood", 0.1, 0.125, 1.2, wx + s * 0.25, 0.125, wz);
    add("organ", "wood", 0.35, 1.1, 1.1, wx, 0.25 + 1.1, wz);
    for (let k = 0; k < 4; k++) add("organ", "wood", 0.15, 1.25, 0.15, mx, 1.25 + 2.5 * k, wz);
    add("organ", "wood", 0.12, 0.12, 2.75, mx, 10 + 0.12, -6.7, true);
  } else {
    // On the keep's top floor (its boards' tops at 20 m), beside the banner: a foot on two boards, a pole of three
    // lengths and the yard across its top, where the signals fly.
    const x = 1.8, z = KEEP_Z + 1.0;
    add("organ", "wood", 0.3, 0.15, 0.3, x, KEEP_TOP + 0.15, z);
    for (let k = 0; k < 3; k++) add("organ", "wood", 0.1, 1.0, 0.1, x, KEEP_TOP + 0.3 + 1.0 + 2.0 * k, z);
    add("organ", "wood", 0.9, 0.06, 0.06, x, KEEP_TOP + 6.3 + 0.06, z, true);
  }
  // Lowest first: the order masons put them back in (stable for equal feet).
  const foot = (p: OrganPiece) => p.y - p.hy;
  return out.map((p, i) => ({ p, i })).sort((a, b) => foot(a.p) - foot(b.p) || a.i - b.i).map((e) => e.p);
}
