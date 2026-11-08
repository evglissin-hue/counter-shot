// Minions and waves as data (phase 2 M2 and M3): the Ashwright units
// (pikemen, sappers with their kegs, musketeers), the mixes a barracks can
// send, the wave timer, where waves form up and where they hold, what a gate
// can take, how many fallen bodies stay, how weapons nobody is manning fire
// at minions, and the enemy castle's plan until the AI player arrives.
// Starting numbers for tuning: everything here is data.
//
// Teams are castle indices, as in the match: team 0 holds the castle at the
// origin (the enemy in a match against the AI), team 1 the one at z = -DIST
// (the player's). A team's waves march on the other team's castle.

import type { BuildingKind } from "./buildings";
import { DIST } from "./field";
import { BRIDGES, type RouteName } from "./map";
import { MATCH_SLOTS, MOUNT_DEFAULT, slotEmplacement, type UpgradeKind } from "./slots";
import type { BurstDef, Emplacement, WeaponKind } from "./weapons";

export type UnitKind = "pikeman" | "sapper" | "musketeer";
/** Unit kinds by number, as minions carry them (the order never changes: frames and hashes use the index). */
export const UNIT_KINDS: UnitKind[] = ["pikeman", "sapper", "musketeer"];

export interface UnitDef {
  kind: UnitKind;
  name: string;
  /** Marching speed (m/s); each minion is up to `speedJitter` of it faster or slower. */
  speed: number;
  speedJitter: number;
  /** Speed while closing on an enemy, as a multiple of the marching speed. */
  charge: number;
  /** Sees enemy minions within this distance (m) and goes for them. */
  sight: number;
  /** Strikes enemy minions within this distance (m): a pike's reach. */
  reach: number;
  /** Ticks between blows, drawn from the seeded Rng within this range. */
  blowMin: number;
  blowMax: number;
  /** Ticks from meeting an enemy to the first blow. */
  readyMin: number;
  readyMax: number;
  /** Chance that a blow knocks an enemy minion down. */
  hit: number;
  /** Speed (m/s) a knockdown throws the loser at, along the blow. */
  knock: number;
  /** Gold each costs when its wave leaves, and the bounty the other side earns when it falls. */
  cost: number;
  bounty: number;
}

export const UNITS: Record<UnitKind, UnitDef> = {
  pikeman: {
    kind: "pikeman",
    name: "Pikeman",
    speed: 1.6,
    speedJitter: 0.06,
    charge: 1.25,
    sight: 9,
    reach: 2.6,
    blowMin: 70,
    blowMax: 110,
    readyMin: 15,
    readyMax: 45,
    hit: 0.3,
    knock: 3.2,
    cost: 0,
    bounty: 5,
  },
  // Carries a powder keg to the enemy gate (or, once inside, the keep) and never stops to fight.
  sapper: {
    kind: "sapper",
    name: "Sapper",
    speed: 1.45,
    speedJitter: 0.05,
    charge: 1,
    sight: 0,
    reach: 0,
    blowMin: 70,
    blowMax: 110,
    readyMin: 15,
    readyMax: 45,
    hit: 0,
    knock: 0,
    cost: 15,
    bounty: 8,
  },
  // Stops to shoot enemy minions from range (MUSKET); hand to hand only when one gets within reach.
  musketeer: {
    kind: "musketeer",
    name: "Musketeer",
    speed: 1.6,
    speedJitter: 0.06,
    charge: 1,
    sight: 26,
    reach: 1.6,
    blowMin: 80,
    blowMax: 120,
    readyMin: 30,
    readyMax: 90,
    hit: 0.15,
    knock: 3.0,
    cost: 10,
    bounty: 8,
  },
};

/** Musketeers: they stop and fire at enemy minions within `range`, every reloadMin to reloadMax ticks (the first shot after the unit's ready time); the odds fall from hitNear (within `near` m) to hitFar at full range. */
export const MUSKET = { range: 22, near: 6, reloadMin: 240, reloadMax: 330, hitNear: 0.6, hitFar: 0.2, knock: 3.6 } as const;

/** Sappers: ticks to plant a keg, ticks its fuse burns once planted, how far (m) the sapper backs off, and the fuse of a keg dropped when its carrier falls. */
export const SAPPER = { plant: 90, fuse: 180, backOff: 4, dropFuse: 30 } as const;

/** A powder keg's burst: smaller than a mortar shell's, but at the foot of a wall it opens a breach. */
export const KEG_BURST: BurstDef = { radius: 3.6, shatter: 0.5, power: 24, lift: 0.9, bite: 0, knock: 9, knockSpeed: 15, crater: 2.4, depth: 0.9 };

export type MixName = "pikemen" | "sappers" | "musketeers" | "mixed";
export const MIX_NAMES: MixName[] = ["pikemen", "sappers", "musketeers", "mixed"];

/**
 * What a barracks sends in each wave, front rank first. A place whose unit is
 * locked (no mill for sappers, no foundry for musketeers) or that the team
 * cannot pay for when the wave leaves goes to a pikeman.
 */
export const MIXES: Record<MixName, { name: string; units: UnitKind[] }> = {
  pikemen: { name: "Pikemen", units: ["pikeman", "pikeman", "pikeman", "pikeman", "pikeman", "pikeman", "pikeman", "pikeman"] },
  sappers: { name: "Sappers", units: ["pikeman", "pikeman", "pikeman", "pikeman", "pikeman", "sapper", "sapper", "sapper"] },
  musketeers: { name: "Musketeers", units: ["pikeman", "pikeman", "pikeman", "pikeman", "musketeer", "musketeer", "musketeer", "musketeer"] },
  mixed: { name: "Mixed", units: ["pikeman", "pikeman", "pikeman", "pikeman", "sapper", "musketeer", "musketeer", "sapper"] },
};

/** The building a unit needs standing in its team's courtyard, if any. */
export const UNIT_NEEDS: Record<UnitKind, BuildingKind | null> = { pikeman: null, sapper: "mill", musketeer: "foundry" };

/** The order of routes wherever routes are numbered (fields, the HUD): the player's left, the centre road, the player's right. */
export const ROUTE_NAMES: RouteName[] = ["left", "centre", "right"];

export const WAVES = {
  /** The first wave leaves this many ticks into a match, then one every `every` ticks. */
  first: 8 * 60,
  every: 25 * 60,
  /** Pikemen per wave, formed up in ranks `file` wide, `spacing` metres apart. */
  size: 8,
  file: 4,
  spacing: 1.3,
  /** A barracks sends only as many as keep its team at or under this many standing minions. */
  maxStanding: 96,
} as const;

export interface Muster {
  x: number;
  z: number;
  /** The way the wave faces when it forms up: +1 along +z, -1 along -z. */
  dir: 1 | -1;
}

/** Where each team's waves form up: the front rank a few metres out from its own gate, facing the field. */
export const MUSTER: [Muster, Muster] = [
  { x: 0, z: -19.5, dir: -1 },
  { x: 0, z: -DIST + 19.5, dir: 1 },
];

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * The open courtyard just inside each castle's gate (indexed by castle):
 * the goal of the waves that march on it. Attackers who get in gather here.
 */
export const COURTYARD: [Rect, Rect] = [
  { x0: -4, x1: 4, z0: -13, z1: -4 },
  { x0: -4, x1: 4, z0: -DIST + 4, z1: -DIST + 13 },
];

/** Metres short of a bridge, on a team's own side, where its waves hold. */
const HOLD_SHORT = 4;

/**
 * The midfield marker where a team's waves stop on the Hold order, one per
 * route (ROUTE_NAMES order): a few metres short of that route's bridge on
 * the team's own side of the stream.
 */
export function holdMarker(team: 0 | 1, route: RouteName): { x: number; z: number } {
  const b = BRIDGES.find((s) => s.name === route)!;
  return team === 1 ? { x: b.x, z: b.z - b.length / 2 - HOLD_SHORT } : { x: b.x, z: b.z + b.length / 2 + HOLD_SHORT };
}

/** Blows from pikemen a gate leaf takes before it comes loose. */
export const GATE_BLOWS = 60;

/** Fallen minions stay as frozen bodies (cover, ramps, blockages); past this many the oldest sink into the ground. */
export const BODY_CAP = 240;

/**
 * Weapons nobody is manning fire at enemy minions on their own: slower and
 * much less accurate than a gunner. They defend their own castle (the tower
 * defence half): only minions within DEFEND metres of their own gate, the
 * approach once the stream is crossed. They turn at the weapon's own rates
 * and fire when they are on their mark, which lands within
 * `errBase + errPerM * distance` metres of the target (uniform over a disc).
 * The mortar never fires on its own: one shell knocks down a whole wave, so
 * it stays the gunner's big event.
 */
export const DEFEND = 45;

export interface UnmannedDef {
  /** Ground distance (m) from the gun at which it will fire. */
  minRange: number;
  maxRange: number;
  /**
   * Fire discipline: it holds fire on a target with one of its own side's
   * minions this close (m), or with a bridge this close to where the shot
   * may fall: for a flat gun, along the line of fire for `overshoot` metres
   * past the target; for the mortar, its whole error and burst.
   */
  clearOwn: number;
  clearBridge: number;
  overshoot: number;
  /** Reload as a multiple of the weapon's own. */
  reload: number;
  errBase: number;
  errPerM: number;
}

export const UNMANNED: Record<WeaponKind, UnmannedDef | null> = {
  longGun: { minRange: 50, maxRange: 170, clearOwn: 4, clearBridge: 4, overshoot: 70, reload: 3, errBase: 3, errPerM: 0.1 },
  mortar: null,
  chainShot: { minRange: 45, maxRange: 140, clearOwn: 4, clearBridge: 4, overshoot: 60, reload: 3, errBase: 3, errPerM: 0.1 },
  swivel: { minRange: 15, maxRange: 60, clearOwn: 3, clearBridge: 3, overshoot: 30, reload: 2.5, errBase: 2, errPerM: 0.08 },
};

/**
 * Every emplacement in a match, one per gun slot (slots.ts): the player's
 * castle first (ids 0 to 7; 0 to 3 are M2's guns), then the enemy's, turned
 * through the middle of the field (both castles are symmetric across x = 0,
 * so each lands on the same wall or tower; yaws stay near the base yaw, so
 * turn limits work unchanged). An empty slot is drawn as the gun its mount
 * usually takes until one is bought.
 */
export const MATCH_EMPLACEMENTS: Emplacement[] = MATCH_SLOTS.map((s, i) => slotEmplacement(i, s, s.start ?? MOUNT_DEFAULT[s.mount]));

/** Until the AI player arrives (M5), the enemy's first barracks sends its waves down the routes in turn. */
export const ENEMY_ROUTES: RouteName[] = ["centre", "left", "right"];

/**
 * One step of the enemy castle's plan (until the AI player, M5): from tick
 * `at`, build on a plot, buy a gun for a slot (the enemy's own numbering,
 * 0 to 7), fit an upgrade, or set a barracks' mix or route. A step it cannot
 * afford or do yet waits and is tried again every few seconds; the next
 * step waits for it.
 */
export type PlanStep =
  | { at: number; build: { plot: number; kind: BuildingKind } }
  | { at: number; buy: { slot: number; weapon: WeaponKind } }
  | { at: number; upgrade: { slot: number; upgrade: UpgradeKind } }
  | { at: number; mix: { plot: number; mix: MixName } }
  | { at: number; route: { plot: number; route: RouteName } };

export const ENEMY_PLAN: PlanStep[] = [
  { at: 35 * 60, build: { plot: 3, kind: "mill" } },
  { at: 70 * 60, mix: { plot: 0, mix: "sappers" } },
  { at: 100 * 60, build: { plot: 1, kind: "barracks" } },
  { at: 100 * 60, route: { plot: 1, route: "right" } },
  { at: 150 * 60, buy: { slot: 4, weapon: "swivel" } },
  { at: 190 * 60, build: { plot: 5, kind: "foundry" } },
  { at: 240 * 60, mix: { plot: 1, mix: "musketeers" } },
  { at: 270 * 60, upgrade: { slot: 0, upgrade: "rifled" } },
  { at: 320 * 60, build: { plot: 2, kind: "mill" } },
  { at: 380 * 60, buy: { slot: 6, weapon: "longGun" } },
  { at: 430 * 60, mix: { plot: 0, mix: "mixed" } },
  { at: 470 * 60, build: { plot: 4, kind: "barracks" } },
  { at: 470 * 60, route: { plot: 4, route: "left" } },
  { at: 520 * 60, upgrade: { slot: 1, upgrade: "heavy" } },
];
