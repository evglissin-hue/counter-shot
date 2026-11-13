// Powder as the eye sees it (3.3), the numbers behind it: how many kegs stand
// under a magazine's lean-to for a store, where they sit, where a hoisted keg
// is along its rope, and which pose a powder boy takes. Pure maths, no
// three.js, testable in Node. Render only: nothing here feeds the match.

import { POWDER } from "@keepfall/content";

/** Kegs drawn at most (a full magazine's 120 charges). */
export const MAX_STACK = 12;
/** Sim minion actions of a powder boy (carriers.ts ACTION_KEG, ACTION_HOIST). */
export const ACT_KEG = 10;
export const ACT_HOIST = 11;

/** A keg for every POWDER.kegsPer charges in the store, up to MAX_STACK; none without a standing magazine. */
export function kegsFor(stock: number, standing: boolean): number {
  if (!standing || !(stock > 0)) return 0;
  return Math.min(MAX_STACK, Math.floor(stock / POWDER.kegsPer));
}

/** The rows of the low pyramid, bottom first (6 + 4 + 2 = 12). */
const ROWS = [6, 4, 2];
/** Keg spacing along the stack, and a row's rise (kegs lying on their sides nest in the row below). */
export const KEG_PITCH = 0.5;
export const ROW_RISE = 0.43;
export const KEG_REST = 0.24;

/** Where keg `i` of the stack sits: along the lean-to's face (`along`, metres from the stack's middle) and its height. The bottom row fills first, then the next row nests above. */
export function stackSlot(i: number): { along: number; y: number; row: number } {
  let left = i;
  for (let row = 0; row < ROWS.length; row++) {
    const n = ROWS[row];
    if (left < n) {
      const offset = (left - (n - 1) / 2) * KEG_PITCH;
      return { along: offset, y: KEG_REST + row * ROW_RISE, row };
    }
    left -= n;
  }
  return { along: 0, y: KEG_REST + ROWS.length * ROW_RISE, row: ROWS.length };
}

export interface HoistPoint {
  x: number;
  y: number;
  z: number;
  /** A rope hangs from the gun to the foot (false for a mortar pit: the keg slides into the pit's edge). */
  rope: boolean;
}

/** The point a hoisted keg is at, for the share of the hoist done (0 on the ground at the foot, 1 at the gun). */
export function hoistKeg(share: number, foot: { x: number; z: number }, gun: { x: number; y: number; z: number }): HoistPoint {
  const k = share < 0 ? 0 : share > 1 ? 1 : share;
  if (gun.y < 3) {
    // A pit at the ground: the keg is set down beside it, sliding in to its edge (0.7 m from its middle).
    const dx = gun.x - foot.x, dz = gun.z - foot.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    const ex = gun.x - (dx / d) * 0.7, ez = gun.z - (dz / d) * 0.7;
    return { x: foot.x + (ex - foot.x) * k, y: KEG_REST, z: foot.z + (ez - foot.z) * k, rope: false };
  }
  const top = ropeTop(gun);
  return { x: foot.x + (top.x - foot.x) * k, y: KEG_REST + (top.y - KEG_REST) * k, z: foot.z + (top.z - foot.z) * k, rope: true };
}

/** The top of the rope: over the parapet at the gun. */
export function ropeTop(gun: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: gun.x, y: gun.y + 0.5, z: gun.z };
}

export type BoyPose = "none" | "keg" | "hoist";

/** A powder boy's pose from his minion action: a keg on his shoulder, hauling the rope, or the plain walk and stand. */
export function boyPose(action: number): BoyPose {
  return action === ACT_KEG ? "keg" : action === ACT_HOIST ? "hoist" : "none";
}

/** One pull of the rope takes this many ticks of the hoist's `act` count. */
export const HAUL_TICKS = 60;
/** The two hands of a hauling boy, hand over hand: each 1 (reaching high) to 0 (pulled down), half a pull apart. */
export function haulHands(act: number): { left: number; right: number } {
  const u = (act % HAUL_TICKS) / HAUL_TICKS;
  const f = (p: number) => {
    const w = (u + p) % 1;
    // Down on the rope for the first 0.6 of a turn, then a quick reach back up.
    return w < 0.6 ? 1 - w / 0.6 : (w - 0.6) / 0.4;
  };
  return { left: f(0), right: f(0.5) };
}

/** What the minimap's magazine tile shows: the share of its cap the store holds (0..1), or -1 for no bar. */
export function stockShare(stock: number, cap: number): number {
  if (!(cap > 0)) return -1;
  const s = stock / cap;
  return s < 0 ? 0 : s > 1 ? 1 : s;
}
