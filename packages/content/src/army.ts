// Minions and waves as data (phase 2 M2): the pikeman, the barracks' wave
// timer, where waves form up and where they hold, what a gate can take, how
// many fallen bodies stay, and how weapons nobody is manning fire at minions.
// Starting numbers for tuning: everything here is data.
//
// Teams are castle indices, as in the match: team 0 holds the castle at the
// origin (the enemy in a match against the AI), team 1 the one at z = -DIST
// (the player's). A team's waves march on the other team's castle.

import { DIST } from "./field";
import { BRIDGES, type RouteName } from "./map";
import { POWDER } from "./powder";
import type { BurstDef, WeaponKind } from "./weapons";

export type UnitKind = "pikeman" | "mason" | "ladder" | "sapper" | "musketeer" | "powderBoy";

/** Unit kinds as the sim numbers them (Minion.unit). */
export const enum Unit {
  Pikeman = 0,
  /** Rebuilds its castle (M4): never fights. */
  Mason = 1,
  /** One of the two men who carry a wave's ladder; once it is up (or dropped) he fights with an axe. */
  Ladder = 2,
  /** Carries a powder keg to the enemy wall and blows a breach (M3). */
  Sapper = 3,
  /** Shoots enemy minions from range (M3). */
  Musketeer = 4,
  /** Carries kegs of powder from the store to the guns (3.3): never fights. */
  PowderBoy = 5,
}

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
  /** M3: false for those who leave a closed gate to the pikes and wait at it (sappers, musketeers). */
  batters?: boolean;
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
  mason: {
    kind: "mason",
    name: "Mason",
    speed: 1.8,
    speedJitter: 0.05,
    charge: 1,
    sight: 0,
    reach: 0,
    blowMin: 0,
    blowMax: 0,
    readyMin: 0,
    readyMax: 0,
    hit: 0,
    knock: 0,
  },
  ladder: {
    kind: "ladder",
    name: "Ladder crew",
    speed: 1.6,
    speedJitter: 0.04,
    charge: 1.25,
    sight: 7,
    reach: 1.7,
    blowMin: 60,
    blowMax: 95,
    readyMin: 12,
    readyMax: 36,
    hit: 0.24,
    knock: 2.8,
  },
  // A sapper never goes looking for a fight: with his keg he makes for the wall; after it, he only defends himself.
  sapper: {
    kind: "sapper",
    name: "Sapper",
    speed: 1.5,
    speedJitter: 0.05,
    charge: 1.1,
    sight: 2.5,
    reach: 1.3,
    blowMin: 70,
    blowMax: 110,
    readyMin: 20,
    readyMax: 50,
    hit: 0.12,
    knock: 2.4,
    batters: false,
  },
  // A musketeer fires from range (MUSKET); close in he jabs with the musket, and rarely knocks anyone down.
  musketeer: {
    kind: "musketeer",
    name: "Musketeer",
    speed: 1.55,
    speedJitter: 0.05,
    charge: 1.1,
    sight: 2.5,
    reach: 1.4,
    blowMin: 70,
    blowMax: 110,
    readyMin: 20,
    readyMax: 50,
    hit: 0.12,
    knock: 2.4,
    batters: false,
  },
  // A powder boy never fights: he carries kegs from the store to the guns (carriers.ts).
  powderBoy: {
    kind: "powderBoy",
    name: "Powder boy",
    speed: POWDER.speedEmpty,
    speedJitter: 0,
    charge: 1,
    sight: 0,
    reach: 0,
    blowMin: 0,
    blowMax: 0,
    readyMin: 0,
    readyMax: 0,
    hit: 0,
    knock: 0,
  },
};

/** UNITS by the sim's unit number. */
export const UNIT_DEFS: UnitDef[] = [UNITS.pikeman, UNITS.mason, UNITS.ladder, UNITS.sapper, UNITS.musketeer, UNITS.powderBoy];

/** Unit numbers by kind. */
export const UNIT_NUMBER: Record<UnitKind, Unit> = { pikeman: Unit.Pikeman, mason: Unit.Mason, ladder: Unit.Ladder, sapper: Unit.Sapper, musketeer: Unit.Musketeer, powderBoy: Unit.PowderBoy };

/**
 * A sapper's powder keg (M3): he sets it at the foot of the enemy front wall,
 * away from the gate, lights it and runs; it bursts after `fuse` ticks. Any
 * ball, burst or falling masonry that knocks him down on the way sets it off
 * where he stands, among his own wave; a burst near a set keg sets it off.
 */
export const KEG = {
  fuse: 4 * 60,
  /** He makes for the wall once he is this close to the enemy castle's front (m). */
  near: 32,
  /** He keeps this far (m) from the gate's middle and from the towers' middles along the wall. */
  gateClear: 3.6,
  towerClear: 4.6,
  /** Ticks to set it and light it, and how far (m) he runs before he waits for the burst. */
  plant: 75,
  run: 10,
  /**
   * The charge is packed into the foot of the wall: it bursts `into` metres
   * in from the face, `up` metres up, and turns most of what it reaches to
   * dust (a burst outside the face only lifts the lower courses into the ones
   * above, and they settle back), leaving a gap to walk through under the
   * courses that still bridge it.
   */
  into: 0.7,
  up: 0.7,
  burst: { radius: 3.0, shatter: 0.78, power: 10, lift: 0.2, bite: 0, knock: 7, knockSpeed: 12, crater: 1.8, depth: 0.6 } as BurstDef,
} as const;

/**
 * Musketeers (M3): they stop and fire at enemy minions within `range` that
 * they can see, a shot every reloadMin..reloadMax ticks after aiming for `aim`
 * ticks; a hit (more likely close in: from `hitNear` at `near` metres down to
 * `hitFar` at `range`) knocks the target down at `knock` m/s. Closer than
 * `close` they jab with the musket, weakly (UNITS.musketeer). Their rolls come
 * from their own stream.
 */
export const MUSKET = {
  range: 26,
  near: 6,
  close: 3,
  aim: 30,
  // Tuned on open-field clashes on the centre road (5 or 6 seeds, from both
  // sides): with these a Volley wave beats a Pikemen wave 7 times in 12 and a
  // Mixed wave breaks even. At 0.6 and a 4 to 5.3 s reload Volley won 8 in 10
  // and left the pikemen almost nobody; at 0.42 and 4.5 to 6 s it lost 7 in 10.
  reloadMin: 255,
  reloadMax: 340,
  hitNear: 0.5,
  hitFar: 0.12,
  knock: 3.4,
  /** Eye height (m) the line of sight runs at. */
  eye: 1.5,
} as const;

export type MixName = "pikemen" | "breach" | "volley" | "mixed";
export const MIX_NAMES: MixName[] = ["pikemen", "breach", "volley", "mixed"];

/**
 * A barracks' wave mixes (M3), rank by rank from the front, four abreast:
 * sappers and musketeers walk in the rear rank. A mix is data, so other kinds
 * (M4's ladder crew) can join one.
 */
export const WAVE_MIXES: Record<MixName, { name: string; units: UnitKind[] }> = {
  pikemen: { name: "Pikemen", units: ["pikeman", "pikeman", "pikeman", "pikeman", "pikeman", "pikeman", "pikeman", "pikeman"] },
  breach: { name: "Breach", units: ["pikeman", "pikeman", "pikeman", "pikeman", "sapper", "pikeman", "pikeman", "sapper"] },
  volley: { name: "Volley", units: ["pikeman", "pikeman", "pikeman", "pikeman", "musketeer", "pikeman", "musketeer", "musketeer"] },
  mixed: { name: "Mixed", units: ["pikeman", "pikeman", "pikeman", "pikeman", "sapper", "musketeer", "musketeer", "sapper"] },
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
  /** From its `ladderFrom`th wave on, every `ladderEvery`th wave a barracks sends carries a ladder: two of its men are the crew. */
  ladderFrom: 2,
  ladderEvery: 2,
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

/**
 * The ground in front of each castle's gate (indexed by castle): within 7 m
 * of the gate's middle along the wall, from 2.5 to 9 m out from the front
 * wall's outer face (16 m from the castle's centre). A wave marching on a
 * castle whose courtyard it cannot reach (rubble in the gateway, a leaf
 * knocked loose that still stands in its place) makes for this ground
 * instead and stands there, for its ladder and its sappers, rather than
 * wherever it was when the way shut.
 */
export const APPROACH: [Rect, Rect] = [
  { x0: -7, x1: 7, z0: -25, z1: -18.5 },
  { x0: -7, x1: 7, z0: -DIST + 18.5, z1: -DIST + 25 },
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

/** Until the AI player arrives (M5), the enemy's barracks sends its waves down the routes in turn. */
export const ENEMY_ROUTES: RouteName[] = ["centre", "left", "right"];
