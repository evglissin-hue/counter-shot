// Minions and waves as data (phase 2 M2): the pikeman, the barracks' wave
// timer, where waves form up and where they hold, what a gate can take, how
// many fallen bodies stay, and how weapons nobody is manning fire at minions.
// Starting numbers for tuning: everything here is data.
//
// Teams are castle indices, as in the match: team 0 holds the castle at the
// origin (the enemy in a match against the AI), team 1 the one at z = -DIST
// (the player's). A team's waves march on the other team's castle.

import { DPI } from "@keepfall/core";
import { DIST } from "./field";
import { BRIDGES, type RouteName } from "./map";
import { ASHWRIGHT_EMPLACEMENTS, type Emplacement, type WeaponKind } from "./weapons";

export type UnitKind = "pikeman";

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
  },
};

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
 * The enemy castle's emplacements: the player's, turned through the middle of
 * the field (both castles are symmetric across x = 0, so each lands on the
 * same wall or tower). Ids follow the player's. Yaws stay near the base yaw
 * (pi plus the player's), so turn limits work unchanged.
 */
export const ENEMY_EMPLACEMENTS: Emplacement[] = ASHWRIGHT_EMPLACEMENTS.map((e, i) => ({
  ...e,
  id: ASHWRIGHT_EMPLACEMENTS.length + i,
  x: -e.x,
  z: -DIST - e.z,
  baseYaw: e.baseYaw + DPI,
}));

/** Every emplacement in a match: the player's castle first, then the enemy's. */
export const MATCH_EMPLACEMENTS: Emplacement[] = [...ASHWRIGHT_EMPLACEMENTS, ...ENEMY_EMPLACEMENTS];

/** Until the AI player arrives (M5), the enemy's barracks sends its waves down the routes in turn. */
export const ENEMY_ROUTES: RouteName[] = ["centre", "left", "right"];
