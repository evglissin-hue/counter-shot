// The scripted matches. Node tests pin their hashes and headless Chromium must
// replay them to the same bits, so any change to how a match plays out shows
// up here.
//
// The keep match (M5: the sturdy keep): a long gun shot at the enemy keep,
// then the player's mortar lays every shell on the floor under the enemy
// banner as soon as it is loaded (the script was written by
// scripts/keep-script.ts), with no waves, no build order and the enemy's
// masons kept home, until the banner is on the ground: each floor takes two
// shells or more. A shell and a
// shot after the end, and the enemy firing the player's gun, must be refused.
//
// The wave match (phase 2 M2, M4): both barracks send their waves (every
// other one with a ladder crew), both courtyards hold a garrison and both
// castles have masons; the player rides the long gun, sends its next waves
// down the left, switches its masons off towers for a while, holds the waves
// at the midfield marker and then advances, fires down the centre road,
// breaches the enemy wall (which the enemy's masons rebuild) and orders Push
// the breach, then leaves for the overview so that every gun fires on its own.

import { buildLayout, GAME_LAYOUT } from "@keepfall/content";
import { Order, Spin, type Rapier } from "@keepfall/sim";
import { Match, Team, type MatchInput, type MatchOptions, type MatchResult } from "./match";

export const MATCH_TICKS = 4900;

/** Pinned: change only on purpose, and bump RULES_VERSION or MATCH_RULES_VERSION when play changes. */
export const MATCH_HASH = { state: "a6b8eb25", world: "7f743abe" } as const;

const fire = (emplacement: number, yaw: number, pitch: number, charge = 1): MatchInput => ({ kind: "fire", emplacement, yaw, pitch, charge, fuse: 0, spin: Spin.None });

/** The keep match is about the keep: no barracks, no build order, and the enemy's masons kept home, so it comes down to shells alone. */
export const MATCH_OPTIONS: Partial<MatchOptions> = { masons: false, barracks: false, plan: false };

export const MATCH_SCRIPT: Array<[number, Team, MatchInput]> = [
  [30, Team.Player, fire(1, 0, 0.9078)],
  [45, Team.Player, fire(0, -0.0196, 0.1198)],
  [285, Team.Player, fire(0, 0, 0.1198)],
  [525, Team.Player, fire(0, 0.0196, 0.1198)],
  [750, Team.Player, fire(1, 0, 0.9078)],
  [765, Team.Player, fire(0, -0.0196, 0.1198)],
  [1005, Team.Player, fire(0, 0, 0.1198)],
  [1245, Team.Player, fire(0, 0.0196, 0.1198)],
  [1470, Team.Player, fire(1, 0, 0.9078)],
  [1485, Team.Player, fire(0, -0.0196, 0.1198)],
  [1725, Team.Player, fire(0, 0, 0.1198)],
  [1965, Team.Player, fire(0, 0.0196, 0.1198)],
  [2190, Team.Player, fire(1, 0, 0.9077)],
  [2205, Team.Player, fire(0, -0.0196, 0.1198)],
  [2445, Team.Player, fire(0, 0, 0.0707)],
  [2685, Team.Player, fire(0, 0.0196, 0.0594)],
  [2910, Team.Player, fire(1, 0.0094, 1.0042)],
  [2925, Team.Player, fire(0, -0.0196, 0.0594)],
  [3165, Team.Player, fire(0, 0, 0.0594)],
  [3405, Team.Player, fire(0, 0.0196, 0.0594)],
  [3630, Team.Player, fire(1, 0.0097, 1.0045)],
  [3645, Team.Player, fire(0, -0.0196, 0.0594)],
  [3885, Team.Player, fire(0, 0, 0.0594)],
  [4125, Team.Player, fire(0, 0.0196, 0.0594)],
  [4350, Team.Player, fire(1, 0.0097, 1.0045)],
  [4365, Team.Player, fire(0, -0.0196, 0.0594)],
  [4605, Team.Player, fire(0, 0, 0.0594)],
  // The keep has fallen by now: these are refused.
  [4800, Team.Player, fire(1, 0.0097, 1.0045)],
  [4830, Team.Player, fire(0, 0.02, 0.03)],
  // Not the enemy's emplacement: refused.
  [100, Team.Enemy, fire(0, 0, 0.03)],
];

export interface MatchSessionResult {
  hash: { state: string; world: string };
  result: MatchResult | null;
  gold: [number, number];
  /** Gold each team earned (income, bounties, masonry, trick shots) and spent (buildings, guns, upgrades, repairs). */
  earned: [number, number];
  spent: [number, number];
  shots: [number, number];
  autoShots: [number, number];
  waves: [number, number];
  standing: [number, number];
  fallen: [number, number];
}

export function runMatchSession(R: Rapier, ticks = MATCH_TICKS, script = MATCH_SCRIPT, opts: Partial<MatchOptions> = MATCH_OPTIONS): MatchSessionResult {
  const m = new Match(R, buildLayout(1, GAME_LAYOUT), { ...opts, seed: 7 });
  for (const [t, team, input] of script) m.queue(t, team, input);
  for (let i = 0; i < ticks; i++) m.step();
  const c = m.armyCounts();
  const pair = (a: [number, number]): [number, number] => [a[0], a[1]];
  const out = { hash: m.hash(), result: m.result, gold: pair(m.gold), earned: pair(m.earned), spent: pair(m.spent), shots: pair(m.shots), autoShots: pair(m.autoShots), waves: pair(m.waves), standing: c.standing, fallen: c.fallen };
  m.free();
  return out;
}

export const WAVE_MATCH_TICKS = 4800;

/** Pinned: change only on purpose, and bump RULES_VERSION or MATCH_RULES_VERSION when play changes. */
export const WAVE_MATCH_HASH = { state: "91935cd1", world: "7f068fe4" } as const;

/** The long gun at the foot of the enemy front wall, west of the gate (yaw towards x = -8.5 and -7.5 at the wall). */
const wall = (yaw: number): MatchInput => ({ kind: "fire", emplacement: 0, yaw, pitch: -0.022, charge: 1, fuse: 0, spin: Spin.None });

export const WAVE_MATCH_SCRIPT: Array<[number, Team, MatchInput]> = [
  [0, Team.Player, { kind: "man", emplacement: 0 }],
  [600, Team.Player, { kind: "route", route: "left" }],
  // M4: the player's masons leave towers alone for a while.
  [900, Team.Player, { kind: "repair", repair: "towers", on: false }],
  [4200, Team.Player, { kind: "repair", repair: "towers", on: true }],
  [1500, Team.Player, { kind: "order", order: Order.Hold }],
  [2350, Team.Player, fire(0, 0, -0.035)],
  [2700, Team.Player, { kind: "order", order: Order.Advance }],
  [3000, Team.Player, wall(-0.0707)],
  [3300, Team.Player, wall(-0.0624)],
  [3600, Team.Player, { kind: "order", order: Order.Push }],
  [4000, Team.Player, { kind: "man", emplacement: -1, left: { emplacement: 0, yaw: -0.06, pitch: -0.022 } }],
];

export function runWaveMatch(R: Rapier, ticks = WAVE_MATCH_TICKS): MatchSessionResult {
  return runMatchSession(R, ticks, WAVE_MATCH_SCRIPT, {});
}

// The estate match (phase 2 M3): the player builds a Powder Mill, sets the
// barracks to send Mixed waves (pikemen, sappers and musketeers, so musket
// rolls are pinned too; its sappers are still on the way when it ends) down
// the right flank, fires at the enemy keep,
// buys a swivel for an empty slot, builds a Foundry and a second barracks
// (musketeers, down the left), upgrades the long gun to heavy shot and
// breaches the wall with it, while the enemy castle follows its build order.

export const ESTATE_MATCH_TICKS = 6900;

/** Pinned: change only on purpose, and bump RULES_VERSION or MATCH_RULES_VERSION when play changes. */
export const ESTATE_MATCH_HASH = { state: "2bbc4cc0", world: "f93ead42" } as const;

export const ESTATE_MATCH_SCRIPT: Array<[number, Team, MatchInput]> = [
  [0, Team.Player, { kind: "man", emplacement: 0 }],
  [130, Team.Player, { kind: "build", plot: 1, building: "mill" }],
  [200, Team.Player, { kind: "barracks", plot: 0, mix: "mixed", route: "right" }],
  [900, Team.Player, fire(0, 0, 0.03)],
  [1700, Team.Player, { kind: "buy", emplacement: 4, weapon: "swivel" }],
  [3300, Team.Player, { kind: "build", plot: 3, building: "foundry" }],
  [4800, Team.Player, { kind: "upgrade", emplacement: 0, upgrade: "heavyShot" }],
  [5000, Team.Player, wall(-0.0707)],
  [5600, Team.Player, { kind: "man", emplacement: -1, left: { emplacement: 0, yaw: -0.06, pitch: -0.022 } }],
  [6300, Team.Player, { kind: "build", plot: 2, building: "barracks" }],
  [6310, Team.Player, { kind: "barracks", plot: 2, mix: "volley", route: "left" }],
];

export interface EstateMatchResult extends MatchSessionResult {
  /** What stands on each plot of each castle at the end (BUILDING_KINDS index, -1 none). */
  plots: [number[], number[]];
  /** The player's slot 4 and the long gun's upgrade. */
  slot4: string;
  upgrade: string;
}

export function runEstateMatch(R: Rapier, ticks = ESTATE_MATCH_TICKS, onTick?: (m: Match, tick: number) => void): EstateMatchResult {
  const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed: 7 });
  for (const [t, team, input] of ESTATE_MATCH_SCRIPT) m.queue(t, team, input);
  for (let i = 0; i < ticks; i++) {
    m.step();
    onTick?.(m, i);
  }
  const c = m.armyCounts();
  const pair = (a: [number, number]): [number, number] => [a[0], a[1]];
  const st = m.world.structures!;
  const plots: [number[], number[]] = [0, 1].map((castle) => [0, 1, 2, 3, 4, 5].map((p) => st.slot(castle, p).kind)) as [number[], number[]];
  const out: EstateMatchResult = {
    hash: m.hash(), result: m.result, gold: pair(m.gold), shots: pair(m.shots), autoShots: pair(m.autoShots), waves: pair(m.waves), standing: c.standing, fallen: c.fallen,
    earned: pair(m.earned), spent: pair(m.spent), plots,
    slot4: m.emplacements[4].empty ? "empty" : m.emplacements[4].weapon, upgrade: m.emplacements[0].upgrade ?? "none",
  };
  m.free();
  return out;
}
