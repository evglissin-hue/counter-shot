// Powder (phase 3 milestone 3.3), as data: every shot burns charges of
// powder from the ready box beside its gun; the keep's cellar and the Powder
// Mills make it, the magazine stores it where everyone can see it, and three
// powder boys per castle carry it to the guns in kegs. Starting numbers for
// tuning: everything here is data (docs/phase-3/03-powder.md).
//
// Places are in a castle's own frame (castle 0's: centre at the origin, the
// gate side at z = -half) and turned into the world by mirrorZ().

import { CASTLE_SHAPE } from "./castle";
import { MID_Z } from "./map";
import { PLOTS } from "./buildings";
import { mirrorZ } from "./siege";
import { WEAPONS, type BurstDef, type Emplacement, type UpgradeKind, type WeaponKind } from "./weapons";

export const POWDER = {
  /** Charges in each castle's store when a match starts (its magazine; every gun's box starts full besides). */
  start: 40,
  /** Charges a shot burns, by weapon (guns nobody mans pay the same). */
  cost: { swivel: 1, chainShot: 3, longGun: 4, mortar: 10 } as Record<WeaponKind, number>,
  /** ... and more with these upgrades (heavy shot, a heavy shell). */
  upgradeExtra: { heavyShot: 1, heavyShell: 2 } as Partial<Record<UpgradeKind, number>>,
  /** The ready box beside each gun: the most it holds (charges). A gun fires only if its box holds the shot's cost. */
  box: { longGun: 12, mortar: 20, chainShot: 9, swivel: 6 } as Record<WeaponKind, number>,
  /** Charges a second the keep's cellar makes (always, so no castle is ever without powder coming in). */
  cellar: 0.4,
  /** Charges a second each working Powder Mill makes (mills no longer pay gold). */
  mill: 0.5,
  /** What the store holds: with a working magazine, and in the keep's cellar without one. Powder made with nowhere to go is lost. */
  magazineCap: 120,
  cellarCap: 30,
  /** Bought at a working magazine, at once, if there is room for all of it. */
  buy: { charges: 20, gold: 60 },
  /** Sudden death (until 3.8 replaces it) multiplies powder made by this. */
  sudden: 2,
  /** Powder boys per castle, and the ticks before one who falls is replaced at the keep's door (20 s). */
  boys: 3,
  respawn: 20 * 60,
  /** A keg holds at most this many charges (a boy takes what the gun has room for, up to this). */
  keg: 12,
  /** Ticks to take a keg from the store, and to hoist it up to the gun (set down beside a mortar pit) (3 s). */
  take: 60,
  hoist: 3 * 60,
  /** Walking speed (m/s): a boy with a keg on his shoulder, and without. */
  speedLoaded: 1.6,
  speedEmpty: 2.0,
  /** Boys run from enemy men within `flee` m, as masons do, and go back once none has been within `calm` m for `calmTicks`. */
  flee: 7,
  calm: 10,
  calmTicks: 2 * 60,
  /**
   * Which gun a boy serves next: the gun the team rides when its box has room for one shot more; then a gun that
   * cannot fire (its box under one shot); then any whose box (with what is on its way) is at or under this share full,
   * the emptiest first.
   */
  topUp: 0.5,
  /** A boy who has not reached a gun's foot for this long (ticks) hoists from where he stands if he is within `reach` m of it; otherwise he takes the keg to the next gun in need, and that gun is passed over for `skip` ticks. */
  stuck: 20 * 60,
  reach: 6,
  skip: 30 * 60,
  /**
   * The magazine blows when a burst comes inside it, or when it is wrecked (under BUILDING_WORKS standing) with powder
   * in it: everything in it goes up as one burst at its middle, reach `blowBase` m plus a metre for every `blowPer`
   * charges (120 charges: 9 m), thrown `blowThrow` times as hard as a shell. A burst counts as inside when its centre
   * is within the plot's footprint grown by `inside` m, and lower than `insideY` m.
   */
  blowBase: 3,
  blowPer: 20,
  blowThrow: 1.5,
  inside: 0.5,
  insideY: 3.5,
  /** The page draws a keg under the magazine's lean-to for every this many charges. */
  kegsPer: 10,
} as const;

/** Charges a shot of this weapon (with this upgrade) burns. */
export function powderCost(kind: WeaponKind, upgrade?: UpgradeKind): number {
  return POWDER.cost[kind] + (upgrade ? (POWDER.upgradeExtra[upgrade] ?? 0) : 0);
}

/** Charges a shot from this emplacement burns now (0 for an empty slot). */
export function shotCost(e: Emplacement): number {
  return e.empty ? 0 : powderCost(e.weapon, e.upgrade);
}

/** The most an emplacement's ready box holds (0 for an empty slot). */
export function boxSize(e: Emplacement): number {
  return e.empty ? 0 : POWDER.box[e.weapon];
}

/** The castle an emplacement belongs to (castle 1 at z = -DIST, castle 0 at the origin). */
export function castleOfEmp(e: Emplacement): 0 | 1 {
  return e.z < MID_Z ? 1 : 0;
}

const S = CASTLE_SHAPE;
/** Where a boy stands at the foot of a wall: this far in from its inner face (as masons work). */
const WORK = S.half - S.wallThick / 2 - 1.4;
/** At the foot of a tower: this far in from its centre along each axis (as masons work, 5 m off the centre). */
const TOWER_IN = 3.54;

/**
 * Where a boy stands to hoist a keg up to an emplacement (world x, z): in the
 * courtyard at the foot of the wall or tower under the gun, or beside a mortar
 * pit (a pit is at the ground: the keg is set down beside it).
 */
export function powderFoot(e: Emplacement): { x: number; z: number } {
  const c = castleOfEmp(e);
  const x = e.x, z = mirrorZ(c, e.z);
  const T = S.half;
  let fx: number, fz: number;
  if (e.y < 3) {
    // A mortar pit: beside it, outwards from the gate corridor's middle.
    fx = x > 0.5 ? x + 1.6 : x - 1.6;
    fz = z;
  } else if (Math.abs(x) > T - 2 && Math.abs(z) > T - 2) {
    // A tower: on its courtyard side.
    fx = x > 0 ? T - TOWER_IN : -T + TOWER_IN;
    fz = z > 0 ? T - TOWER_IN : -T + TOWER_IN;
  } else if (Math.abs(z) >= Math.abs(x)) {
    // The front or back wall.
    fx = x < -11 ? -11 : x > 11 ? 11 : x;
    fz = z > 0 ? WORK : -WORK;
  } else {
    fx = x > 0 ? WORK : -WORK;
    fz = z < -11 ? -11 : z > 11 ? 11 : z;
  }
  return { x: fx, z: mirrorZ(c, fz) };
}

/** The keep's door (world x, z): the cellar's powder is taken here without a magazine, and boys who fall are replaced here. Behind the keep, out of the gate's line. */
export function keepDoor(castle: number): { x: number; z: number } {
  return { x: 0, z: mirrorZ(castle, S.keepZ + S.keepHalf + 1.2) };
}

/** Where boys take kegs from a magazine on a plot (world x, z): under its lean-to, on the side of the plot towards the courtyard's middle. */
export function magazineDoor(castle: number, plot: number): { x: number; z: number } {
  const p = PLOTS[plot];
  return { x: p.x > 0 ? p.x - p.w / 2 - 0.9 : p.x + p.w / 2 + 0.9, z: mirrorZ(castle, p.z) };
}

/** The magazine going up with this much powder in it: a shell's burst, wider with the stock and thrown harder (null when it is empty: an empty one makes none). */
export function magazineBurst(stock: number): BurstDef | null {
  if (stock <= 0) return null;
  const shell = WEAPONS.mortar.burst!;
  const radius = POWDER.blowBase + stock / POWDER.blowPer;
  const k = radius / shell.radius;
  return {
    radius,
    shatter: shell.shatter,
    power: shell.power * POWDER.blowThrow,
    lift: shell.lift,
    bite: 0,
    knock: shell.knock * k,
    knockSpeed: shell.knockSpeed * POWDER.blowThrow,
    crater: shell.crater * k,
    depth: shell.depth,
  };
}
