// Repairs, the garrison, storming and ladders (phase 2 M4), as data: which
// stones make up each section a castle's masons rebuild and what a piece
// costs, where masons stand to work, where the garrison stands, which part of
// a courtyard counts when it is stormed, and where ladder crews lean their
// ladders. Places are given in a castle's own frame (castle 0's: centre at the
// origin, the gate side at z = -half) and turned into the world by mirrorZ():
// castle 1 is castle 0 mirrored across the middle of the field.
// Starting numbers for tuning: everything here is data.

import { dsqrt } from "@keepfall/core";
import { CASTLE_SHAPE, type CastleLayout, type Stone } from "./castle";
import { DIST } from "./field";

/** World z of a point at z in a castle's own frame, and back (the mirror is its own inverse). */
export function mirrorZ(castle: number, z: number): number {
  return castle === 0 ? z : -DIST - z;
}

/** Which way is the owner's left along x: castle 0 looks out along -z (its left is -x), castle 1 along +z (its left is +x). */
export function ownerLeft(castle: number): 1 | -1 {
  return castle === 0 ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Repairs

/** What a castle's repair switches cover (SPEC section 4: walls, towers, gate, keep). */
export type RepairKind = "gate" | "walls" | "towers" | "keep";
/** In the order masons take them when several need work. */
export const REPAIR_KINDS: RepairKind[] = ["gate", "walls", "towers", "keep"];

export const REPAIR = {
  /** Masons per castle. */
  crew: 4,
  /** Ticks a mason takes to set one stone, to hang a gate leaf, and to carry one piece of rubble out of the way. */
  lay: 90,
  hang: 240,
  clear: 45,
  /** A fallen mason is replaced at the yard after this many ticks. */
  respawn: 20 * 60,
  /** Walking speed (m/s). */
  speed: 1.8,
  /** Masons drop their work and run from enemy minions this close (m); they go back once none has been within `calm` m for `calmTicks`. */
  flee: 7,
  calm: 10,
  calmTicks: 2 * 60,
  /** Masons do not start on a section with enemy minions this close to where they would stand (m), nor rehang a gate with them this close (they would only batter it down again). */
  unsafe: 9,
  gateUnsafe: 22,
  /** Masons spread along the work this far apart (m). */
  spread: 1.1,
  /** Gold for each piece put back, by part. */
  cost: { wall: 1, tower: 1, merlon: 1, keep: 2, storey: 10, gate: 25 } as Partial<Record<Stone["part"], number>>,
} as const;

export interface RepairSection {
  index: number;
  castle: 0 | 1;
  kind: RepairKind;
  /** As its owner would say it: "the front wall, left of the gate". */
  name: string;
  /** Stone ids, lowest course first (then by id): the order they go back in. */
  stones: number[];
}

const S = CASTLE_SHAPE;
/** Inner faces of the curtain walls (local), and the line masons work along, inside them. */
const INNER = S.half - S.wallThick / 2;
const WORK = INNER - 1.4;
/** Masons keep this far from the towers along a wall (local |x| or |z|). */
const ALONG = 11;

const cache = new WeakMap<CastleLayout, RepairSection[]>();

/**
 * The sections of both castles that masons rebuild, in a fixed order per
 * castle: the gate, the front wall either side of it, the side walls, the back
 * wall, the four towers and the keep (with its floors). Houses, the banner and
 * the bridges are not rebuilt.
 */
export function repairSections(layout: CastleLayout): RepairSection[] {
  const hit = cache.get(layout);
  if (hit) return hit;
  const out: RepairSection[] = [];
  const T = S.half;
  for (const castle of [0, 1] as const) {
    const left = ownerLeft(castle);
    const base = out.length;
    const add = (kind: RepairKind, name: string) => out.push({ index: out.length, castle, kind, name, stones: [] }) - 1;
    const gate = add("gate", "the gate");
    const frontLeft = add("walls", "the front wall, left of the gate");
    const frontRight = add("walls", "the front wall, right of the gate");
    const sideLeft = add("walls", "the left wall");
    const sideRight = add("walls", "the right wall");
    const back = add("walls", "the back wall");
    const towers = [
      add("towers", "the front left tower"),
      add("towers", "the front right tower"),
      add("towers", "the back left tower"),
      add("towers", "the back right tower"),
    ];
    const keep = add("keep", "the keep");
    // Tower centres in local x, z, in the order above.
    const tc: Array<[number, number]> = [
      [left * T, -T],
      [-left * T, -T],
      [left * T, T],
      [-left * T, T],
    ];
    const nearestTower = (x: number, z: number) => {
      let best = 0, bd = Infinity;
      for (let k = 0; k < 4; k++) {
        const d = (x - tc[k][0]) * (x - tc[k][0]) + (z - tc[k][1]) * (z - tc[k][1]);
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      return towers[best];
    };
    for (const s of layout.stones) {
      if (s.castle !== castle) continue;
      const x = s.x, z = mirrorZ(castle, s.z);
      let sec = -1;
      if (s.part === "gate") sec = gate;
      else if (s.part === "keep" || s.part === "storey" || (s.part === "merlon" && s.course === S.keepCourses)) sec = keep;
      else if (s.part === "tower" || (s.part === "merlon" && s.course === S.towerCourses)) sec = nearestTower(x, z);
      else if (s.part === "wall" || s.part === "merlon") {
        if (Math.abs(z + T) < 1.5) sec = x * left > 0 ? frontLeft : frontRight;
        else if (Math.abs(z - T) < 1.5) sec = back;
        else if (Math.abs(x - left * T) < 1.5) sec = sideLeft;
        else if (Math.abs(x + left * T) < 1.5) sec = sideRight;
      }
      if (sec >= 0) out[sec].stones.push(s.id);
    }
    for (let k = base; k < out.length; k++) {
      out[k].stones.sort((a, b) => layout.stones[a].course - layout.stones[b].course || a - b);
    }
  }
  cache.set(layout, out);
  return out;
}

/** Each stone's section (index into repairSections), or -1 for pieces nobody rebuilds. */
const sectionOfCache = new WeakMap<CastleLayout, Int16Array>();
export function sectionOf(layout: CastleLayout): Int16Array {
  const hit = sectionOfCache.get(layout);
  if (hit) return hit;
  const a = new Int16Array(layout.stones.length).fill(-1);
  for (const sec of repairSections(layout)) for (const id of sec.stones) a[id] = sec.index;
  sectionOfCache.set(layout, a);
  return a;
}

/** Gold to put a piece back. */
export function repairCost(s: Stone): number {
  return REPAIR.cost[s.part] ?? 1;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Where a castle's masons stand to put a piece of a section back (world x,
 * z): inside the courtyard, a little in from the face the piece belongs to.
 * The keep's floors are put back from its side, over the wall.
 */
export function workSpot(layout: CastleLayout, section: RepairSection, id: number): { x: number; z: number } {
  const s = layout.stones[id];
  const c = section.castle;
  const x = s.x, z = mirrorZ(c, s.z);
  const T = S.half;
  let wx: number, wz: number;
  switch (section.kind) {
    case "gate":
      wx = 0;
      wz = -INNER + 1.6;
      break;
    case "towers": {
      // On the courtyard side of the tower, five metres from its centre.
      const tx = x > 0 ? T : -T, tz = z > 0 ? T : -T;
      wx = tx - (tx > 0 ? 3.54 : -3.54);
      wz = tz - (tz > 0 ? 3.54 : -3.54);
      break;
    }
    case "keep": {
      const h = S.keepHalf, kz = S.keepZ;
      if (s.part === "storey") {
        wx = h + 1.4;
        wz = kz;
      } else if (Math.abs(z - (kz - h)) < 1.6) {
        wx = clamp(x, -h + 1, h - 1);
        wz = kz - h - 1.4;
      } else if (Math.abs(z - (kz + h)) < 1.6) {
        wx = clamp(x, -h + 1, h - 1);
        wz = kz + h + 1.4;
      } else {
        wx = x > 0 ? h + 1.4 : -h - 1.4;
        wz = clamp(z, kz - h + 1, kz + h - 1);
      }
      break;
    }
    default:
      if (Math.abs(z + T) < 1.5) {
        wx = clamp(x, -ALONG, ALONG);
        wz = -WORK;
      } else if (Math.abs(z - T) < 1.5) {
        wx = clamp(x, -ALONG, ALONG);
        wz = WORK;
      } else {
        wx = x > 0 ? WORK : -WORK;
        wz = clamp(z, -ALONG, ALONG);
      }
  }
  return { x: wx, z: mirrorZ(c, wz) };
}

/** Where a castle's masons wait for work (by the workshop) and where they run to (behind the keep). World x, z. */
export function masonYard(castle: number): { x: number; z: number } {
  return { x: 7.5, z: mirrorZ(castle, -4.8) };
}
export function masonRefuge(castle: number): { x: number; z: number } {
  return { x: 0, z: mirrorZ(castle, S.keepZ + S.keepHalf + 2.4) };
}

// ---------------------------------------------------------------------------
// The garrison and storming

export const GARRISON = {
  /** Pikemen who stay in each courtyard, topped up from the barracks. */
  size: 4,
  /** Garrison and defenders go for enemy minions inside their courtyard up to this far (m). */
  sight: 16,
  /** Their posts (local x, z): a rank in front of the keep, facing the gate. */
  posts: [
    [-3.3, -5.4],
    [-1.1, -5.4],
    [1.1, -5.4],
    [3.3, -5.4],
  ] as Array<[number, number]>,
  /** Where a barracks musters a wave inside when its courtyard is attacked (local): beside the barracks house, two files deep. */
  muster: { x: -3.0, z: -7.2, file: 2, spacing: 1.2 },
} as const;

/** Garrison post k of a castle (world x, z). */
export function garrisonPost(castle: number, k: number): { x: number; z: number } {
  const p = GARRISON.posts[k % GARRISON.posts.length];
  return { x: p[0], z: mirrorZ(castle, p[1]) };
}

export const STORM = {
  /** Ticks attackers must hold a courtyard, outnumbering its defenders, to storm it. */
  hold: 20 * 60,
  /** At least this many attackers inside count as a storm. */
  min: 2,
  /** With no attacker inside, the meter drains this many ticks per tick. */
  drain: 2,
} as const;

/** Inside a castle's courtyard (world x, z): within the inner faces of its curtain walls. Minions on the walls do not count. */
export function inCourtyard(castle: number, x: number, z: number): boolean {
  const lz = mirrorZ(castle, z);
  const r = INNER - 0.4;
  return x > -r && x < r && lz > -r && lz < r;
}

// ---------------------------------------------------------------------------
// Ladders

export const LADDER = {
  /** Length (m) and the height of its top above the foot of the wall, in a crenel. */
  length: 9.0,
  top: 8.5,
  /** Its top leans this far out from the wall's face (m). */
  standOff: 0.08,
  /** Climbing speeds (m/s): up the ladder, across the wall walk, down the rope inside. */
  up: 1.0,
  across: 1.4,
  down: 2.0,
  /** Climbers on the ladder at once, and the least gap between them along it (m). */
  onLadder: 4,
  gap: 2.0,
  /** Ticks to raise it against the wall. */
  raise: 120,
  /** A crew makes for a ladder spot once it is this close (m) to the enemy front wall. */
  near: 34,
  /** Its side's minions this close (m) to the foot of a planted ladder climb it while the gate stands and no breach is open. */
  pull: 24,
  /** Climbers waiting for one ladder at most. */
  queue: 10,
  /** The crewmen walk this far apart (m), the ladder on their shoulders, at this share of a pikeman's pace. */
  carryGap: 3.6,
  carryPace: 0.85,
  /** A spot is usable while the wall there still stands at least this high (m above the ground); a loose top stone or two do not spoil it. */
  minWall: 6,
  /** A crew this close to the enemy wall with no usable spot for this long (s) drops its ladder and fights as pikemen. */
  giveUp: 20,
  /** Men who reach the wall walk wait for this many of their side to be there, or for nobody else to be coming, or for this many seconds. */
  group: 3,
  groupWait: 6,
  /** Men going over a wall together start this far apart (m) along the wall walk. */
  groupGap: 0.8,
  /** A man choosing a ladder counts this many metres of walk for each man already claiming it or on it. */
  queuePenalty: 4,
  /** Mass of a ladder (kg). */
  mass: 55,
  /** Fallen ladders that stay on the field; past this the oldest go. */
  keep: 10,
} as const;

/** Local x of the crenels in each front wall where crews lean their ladders. */
export const LADDER_SPOTS = [-8.1, -4.5, 4.5, 8.1];

export interface LadderSpot {
  castle: 0 | 1;
  /** Index into LADDER_SPOTS. */
  k: number;
  x: number;
  /** World z of the ladder's foot, its top (in the crenel, at the wall's outer face), the wall walk's inner edge, and the rope's foot inside. */
  footZ: number;
  topZ: number;
  innerZ: number;
  ropeZ: number;
  /** Height of the ladder's top. */
  topY: number;
  /** Outward from the wall along z (world): -1 for castle 0, +1 for castle 1. */
  out: 1 | -1;
}

/** The ladder spots of both castles, castle 0's first. */
export function ladderSpots(): LadderSpot[] {
  const out: LadderSpot[] = [];
  const face = S.half + S.wallThick / 2; // the outer face of the front wall, local -z
  const run = dsqrt(LADDER.length * LADDER.length - LADDER.top * LADDER.top);
  for (const castle of [0, 1] as const) {
    LADDER_SPOTS.forEach((x, k) =>
      out.push({
        castle,
        k,
        x,
        footZ: mirrorZ(castle, -face - LADDER.standOff - run),
        topZ: mirrorZ(castle, -face - LADDER.standOff),
        innerZ: mirrorZ(castle, -INNER - 0.25),
        ropeZ: mirrorZ(castle, -INNER + 0.55),
        topY: LADDER.top,
        out: castle === 0 ? -1 : 1,
      }),
    );
  }
  return out;
}
