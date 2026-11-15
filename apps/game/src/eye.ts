// The mason's eye (phase 3, 3.4), the logic with no three import: which structures to show, the structure under the
// sight, the footing drawn in, the words. render/masonEye.ts draws it; the page feeds it the structures' report.

import { STRUCTURE } from "@keepfall/content";
import type { StructureInfo } from "./protocol";

/**
 * Is the eye free for everyone? The owner has not answered whether it should be earned (a building, a tool, a
 * veteran's right); until they do it is free, as the spec's default says. One constant to change.
 */
export const EYE_FREE = true;

/** A structure's state (sim StaticState). */
export const enum Life {
  Standing = 0,
  Groaning = 1,
  Toppling = 2,
  Fallen = 3,
}

/** Hold C: the eye. (C is also photo mode's shutter; photo mode keeps it.) */
export const EYE_KEY = "KeyC";

/** The farthest structure the sight's ray can pick (m). */
export const EYE_RANGE = 400;
/** The keep's bounds for the ray: its square plus this much of buttress each side (m), and its height. */
const KEEP_REACH = 1.2;
const KEEP_HEIGHT = 20;
const TOWER_RADIUS = 3.6;
const TOWER_HEIGHT = 12;

/** Where the structure's masonry ends, for the ray: a keep a box, a tower a cylinder. */
export function boundsOf(s: StructureInfo): { box: boolean; half: number; base: number; top: number } {
  if (s.kind === "keep") return { box: true, half: s.half + KEEP_REACH, base: s.baseY, top: s.baseY + KEEP_HEIGHT };
  return { box: false, half: TOWER_RADIUS, base: s.baseY, top: s.baseY + TOWER_HEIGHT };
}

/** Distance along a ray (origin o, unit direction d) to a structure's bounds, or -1 for a miss. */
export function rayStructure(s: StructureInfo, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  const b = boundsOf(s);
  if (b.box) {
    let t0 = 0, t1 = Infinity;
    const slab = (o: number, d: number, lo: number, hi: number): boolean => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let a = (lo - o) / d, c = (hi - o) / d;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      return t0 <= t1;
    };
    if (!slab(ox, dx, s.cx - b.half, s.cx + b.half) || !slab(oy, dy, b.base, b.top) || !slab(oz, dz, s.cz - b.half, s.cz + b.half)) return -1;
    return t0;
  }
  // A vertical cylinder: the circle in x, z, then the height (the roof's cap too).
  const px = ox - s.cx, pz = oz - s.cz;
  const a = dx * dx + dz * dz;
  const r2 = b.half * b.half;
  let tEnter = 0, tExit = Infinity;
  if (a < 1e-12) {
    if (px * px + pz * pz > r2) return -1;
  } else {
    const hb = px * dx + pz * dz, c = px * px + pz * pz - r2;
    const disc = hb * hb - a * c;
    if (disc < 0) return -1;
    const q = Math.sqrt(disc);
    tEnter = (-hb - q) / a;
    tExit = (-hb + q) / a;
  }
  tEnter = Math.max(tEnter, 0);
  if (Math.abs(dy) < 1e-9) {
    if (oy < b.base || oy > b.top) return -1;
  } else {
    let y0 = (b.base - oy) / dy, y1 = (b.top - oy) / dy;
    if (y0 > y1) [y0, y1] = [y1, y0];
    tEnter = Math.max(tEnter, y0);
    tExit = Math.min(tExit, y1);
  }
  return tEnter <= tExit ? tEnter : -1;
}

/** The nearest structure along a ray within EYE_RANGE that still stands (index into the list), or -1. */
export function structureUnder(list: readonly StructureInfo[], ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  let best = -1, bt = EYE_RANGE;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.state === Life.Fallen) continue;
    const t = rayStructure(s, ox, oy, oz, dx, dy, dz);
    if (t >= 0 && t <= bt) {
      bt = t;
      best = i;
    }
  }
  return best;
}

export interface EyeAsk {
  /** Is the key held (or the guided match showing the eye)? */
  held: boolean;
  /** Riding a gun (the structure under the sight) or the overview (your own castle, and the enemy's under the mouse). */
  overview: boolean;
  /** The team this page plays, the structure under the sight or the mouse (-1: none) and one the coach points at (-1: none). */
  me: number;
  under: number;
  forced: number;
}

/** Which structures to draw the eye on now (indices into the list): none unless the eye is free and asked for. */
export function eyeTargets(list: readonly StructureInfo[], ask: EyeAsk): number[] {
  const out: number[] = [];
  if (!EYE_FREE || !list.length) return out;
  const fine = (i: number) => i >= 0 && i < list.length && list[i].state !== Life.Fallen;
  if (ask.held) {
    if (ask.overview) for (const s of list) if (s.castle === ask.me && s.state !== Life.Fallen) out.push(s.index);
    if (fine(ask.under) && !out.includes(ask.under)) out.push(ask.under);
  }
  if (fine(ask.forced) && !out.includes(ask.forced)) out.push(ask.forced);
  return out;
}

/** "Holds 62%", or "Falling" once it groans, tips or goes. */
export function holdsLabel(s: Pick<StructureInfo, "state" | "holds">): string {
  if (s.state !== Life.Standing) return "Falling";
  return `Holds ${Math.max(0, Math.min(100, Math.floor(s.holds * 100 + 1e-6)))}%`;
}

/** The share to colour a course by: 0 cool to 1 hot, as rgb 0..1 (cool blue-grey, then amber, then red). */
export function heatColor(h: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, h));
  const cool: [number, number, number] = [0.32, 0.6, 0.78], mid: [number, number, number] = [0.95, 0.72, 0.2], hot: [number, number, number] = [0.9, 0.18, 0.12];
  const lerp = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  return t < 0.5 ? lerp(cool, mid, t * 2) : lerp(mid, hot, (t - 0.5) * 2);
}

/**
 * The footing's convex hull (x, z pairs, counter-clockwise) drawn in by `d` metres: each edge moves inward and the
 * polygon is clipped by it. Empty when nothing is left of it.
 */
export function drawnIn(hull: readonly number[], d: number): number[] {
  let pts: Array<[number, number]> = [];
  for (let i = 0; i + 1 < hull.length; i += 2) pts.push([hull[i], hull[i + 1]]);
  if (pts.length < 3) return [];
  const n = pts.length;
  const edges: Array<[number, number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
    const ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    // Counter-clockwise seen from above (x right, z up): the inside is to the left of each edge.
    const nx = -ez / len, nz = ex / len;
    edges.push([ax + nx * d, az + nz * d, nx, nz]);
  }
  for (const [px, pz, nx, nz] of edges) {
    const next: Array<[number, number]> = [];
    const side = (p: [number, number]) => (p[0] - px) * nx + (p[1] - pz) * nz;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const sa = side(a), sb = side(b);
      if (sa >= 0) next.push(a);
      if ((sa >= 0) !== (sb >= 0)) {
        const k = sa / (sa - sb);
        next.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
      }
    }
    pts = next;
    if (pts.length < 3) return [];
  }
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(area) < 1e-4) return [];
  return pts.flatMap((p) => p);
}

/** The world's tells, with no key: dark cracks across the weakest course, dust trickling from it. */
export function tells(s: Pick<StructureInfo, "state" | "heat" | "weakest">): { cracks: boolean; dust: boolean; course: number } {
  if (s.state === Life.Fallen || s.weakest < 0) return { cracks: false, dust: false, course: -1 };
  const h = s.heat[s.weakest] ?? 0;
  return { cracks: h >= STRUCTURE.cracks, dust: h >= STRUCTURE.dust, course: s.weakest };
}

/** The keep tracker's bar: 0 to 1, and its colour class (green over 0.6, amber, red under 0.3). */
export function holdsClass(h: number): "good" | "mid" | "low" {
  return h > 0.6 ? "good" : h < 0.3 ? "low" : "mid";
}

/** What the world says of a structure's life, in short and for the log. `mine`: the page's team owns it. */
export function structureWords(s: Pick<StructureInfo, "kind" | "name">, mine: boolean) {
  const what = s.kind === "keep" ? "keep" : `${s.name.replace(/^the /, "")}`;
  const theirs = s.kind === "keep" ? "Their keep" : `Their ${what}`;
  const yours = s.kind === "keep" ? "Your keep" : `Your ${what}`;
  const subject = mine ? yours : theirs;
  return {
    /** Strain: the groan. */
    groan: mine ? `${subject} groans: masons to it` : `${subject} groans`,
    /** Topple or Crush: the fall begins (a tower is told when it has fallen). */
    falling: s.kind === "keep" ? `${subject} is coming down` : `${subject} fell`,
    saved: `Your masons saved the ${s.kind === "keep" ? "keep" : what}`,
    /** The moment's name (track S). */
    felled: s.kind === "keep" ? "Keep felled" : "Tower felled",
  };
}

export type PuffKind = "skirt" | "ring" | "bank" | "column" | "smoke";

/** One puff of a great cloud: seconds after the fall's release, its kind, and its size. */
export interface Puff {
  t: number;
  kind: PuffKind;
  scale: number;
  /** Where, from the landing (m, along the fall and across it, in units of the structure's half width). */
  along: number;
  across: number;
}

/**
 * A fall turns hundreds of stones to dust in a second or two. Instead of a dust effect per stone (capped) the great
 * cloud stands for them: about ten puffs of the bursts the page already draws, spread over two and a half seconds, so a
 * fall never costs more frame time than a shell's burst does. `k` sizes it (a keep 1, a tower less).
 */
export function cloudPlan(k: number): Puff[] {
  const p = (t: number, kind: PuffKind, scale: number, along: number, across: number): Puff => ({ t, kind, scale: scale * k, along, across });
  return [
    p(0, "skirt", 3.2, 0, 0),
    p(0, "bank", 3, 0, 0),
    p(0.1, "ring", 2.2, 0.5, 0),
    p(0.25, "column", 2.4, 0, 0),
    p(0.5, "skirt", 2.4, 0.6, 0.5),
    p(0.8, "smoke", 1.6, 0.2, -0.4),
    p(1.2, "bank", 2.6, -0.4, 0.3),
    p(1.6, "skirt", 1.8, 0.3, -0.6),
    p(2.2, "column", 1.8, 0, 0),
  ];
}

/**
 * Where a fall lands (world x, z, and the ground it lands on): a topple lands a way off along its direction (about 0.6
 * of the height above its cut), a crush straight down on the structure's middle.
 */
export function landing(s: Pick<StructureInfo, "cx" | "cz" | "baseY" | "topY" | "footY" | "weakest">, dirX: number, dirZ: number): { x: number; z: number; y: number } {
  if (dirX === 0 && dirZ === 0) return { x: s.cx, z: s.cz, y: s.baseY };
  const above = Math.max(2, s.topY - (s.weakest >= 0 ? s.footY : s.baseY));
  const d = Math.min(14, above * 0.6);
  return { x: s.cx + dirX * d, z: s.cz + dirZ * d, y: s.baseY };
}

/** The camera's shake for a fall `dist` m away (0..1): stronger than a shell's, further reaching. */
export function fallShake(dist: number): number {
  return Math.max(0.15, Math.min(1, 1.5 - dist / 140));
}
