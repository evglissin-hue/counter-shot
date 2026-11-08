// The scripted matches. Node tests pin their hashes and headless Chromium must
// replay them to the same bits, so any change to how a match plays out shows
// up here.
//
// The keep match: a long gun hit on the enemy keep and two mortar shells down
// its shaft bring the banner to the ground floor for the player's win; a third
// shell, a shot after the end and the enemy firing the player's gun must all
// be refused.
//
// The wave match (phase 2 M2): both barracks send their waves; the player
// rides the long gun, sends its next waves down the left, holds them at the
// midfield marker and then advances, fires down the centre road, breaches the
// enemy wall and orders Push the breach, then leaves for the overview so that
// every gun fires on its own.

import { buildLayout, MATCH_LAYOUT } from "@keepfall/content";
import { Order, Spin, type Rapier } from "@keepfall/sim";
import { Match, Team, type MatchInput, type MatchResult } from "./match";

export const MATCH_TICKS = 1700;

/** Pinned: change only on purpose, and bump RULES_VERSION or MATCH_RULES_VERSION when play changes. */
export const MATCH_HASH = { state: "58e36bdb", world: "2ab901ef" } as const;

const fire = (emplacement: number, yaw: number, pitch: number): MatchInput => ({ kind: "fire", emplacement, yaw, pitch, charge: 1, fuse: 0, spin: Spin.None });

export const MATCH_SCRIPT: Array<[number, Team, MatchInput]> = [
  [30, Team.Player, fire(1, 0, 0.8165)],
  [60, Team.Player, fire(0, 0, 0.035)],
  [760, Team.Player, fire(1, -0.005, 0.8155)],
  // The keep has fallen by now: these are refused.
  [1400, Team.Player, fire(1, -0.005, 0.8155)],
  [1500, Team.Player, fire(0, 0.02, 0.03)],
  // Not the enemy's emplacement: refused.
  [100, Team.Enemy, fire(0, 0, 0.03)],
];

export interface MatchSessionResult {
  hash: { state: string; world: string };
  result: MatchResult | null;
  gold: [number, number];
  shots: [number, number];
  autoShots: [number, number];
  waves: [number, number];
  standing: [number, number];
  fallen: [number, number];
}

export function runMatchSession(R: Rapier, ticks = MATCH_TICKS, script = MATCH_SCRIPT): MatchSessionResult {
  const m = new Match(R, buildLayout(1, MATCH_LAYOUT), { seed: 7 });
  for (const [t, team, input] of script) m.queue(t, team, input);
  for (let i = 0; i < ticks; i++) m.step();
  const c = m.armyCounts();
  const pair = (a: [number, number]): [number, number] => [a[0], a[1]];
  const out = { hash: m.hash(), result: m.result, gold: pair(m.gold), shots: pair(m.shots), autoShots: pair(m.autoShots), waves: pair(m.waves), standing: c.standing, fallen: c.fallen };
  m.free();
  return out;
}

export const WAVE_MATCH_TICKS = 4800;

/** Pinned: change only on purpose, and bump RULES_VERSION or MATCH_RULES_VERSION when play changes. */
export const WAVE_MATCH_HASH = { state: "ad8ffc02", world: "3c4e5063" } as const;

/** The long gun at the foot of the enemy front wall, west of the gate (yaw towards x = -8.5 and -7.5 at the wall). */
const wall = (yaw: number): MatchInput => ({ kind: "fire", emplacement: 0, yaw, pitch: -0.022, charge: 1, fuse: 0, spin: Spin.None });

export const WAVE_MATCH_SCRIPT: Array<[number, Team, MatchInput]> = [
  [0, Team.Player, { kind: "man", emplacement: 0 }],
  [600, Team.Player, { kind: "route", route: "left" }],
  [1500, Team.Player, { kind: "order", order: Order.Hold }],
  [2350, Team.Player, fire(0, 0, -0.035)],
  [2700, Team.Player, { kind: "order", order: Order.Advance }],
  [3000, Team.Player, wall(-0.0707)],
  [3300, Team.Player, wall(-0.0624)],
  [3600, Team.Player, { kind: "order", order: Order.Push }],
  [4000, Team.Player, { kind: "man", emplacement: -1, left: { emplacement: 0, yaw: -0.06, pitch: -0.022 } }],
];

export function runWaveMatch(R: Rapier, ticks = WAVE_MATCH_TICKS): MatchSessionResult {
  return runMatchSession(R, ticks, WAVE_MATCH_SCRIPT);
}

export const BUILD_MATCH_TICKS = 4800;

/** Pinned: change only on purpose, and bump RULES_VERSION or MATCH_RULES_VERSION when play changes. */
export const BUILD_MATCH_HASH = { state: "768ae955", world: "8adb8235" } as const;

/**
 * The building match (phase 2 M3): the player builds a Powder Mill, sends
 * sappers, tries a Foundry before it can pay (refused) and again when it
 * can, fits a rifled barrel and buys a swivel; a mortar shell lands on the
 * enemy's new mill (the enemy follows its plan); the long gun fires down the
 * centre road. A long gun shot at the foot of the enemy gatehouse brings
 * down the wall under the enemy's long gun.
 */
export const BUILD_MATCH_SCRIPT: Array<[number, Team, MatchInput]> = [
  [0, Team.Player, { kind: "man", emplacement: 0 }],
  [60, Team.Player, { kind: "build", plot: 1, building: "mill" }],
  [1000, Team.Player, { kind: "barracks", plot: 0, mix: "sappers" }],
  [1500, Team.Player, { kind: "build", plot: 2, building: "foundry" }],
  [2400, Team.Player, { kind: "build", plot: 2, building: "foundry" }],
  [2500, Team.Player, fire(0, 0, -0.035)],
  [3150, Team.Player, { kind: "man", emplacement: 1 }],
  [3160, Team.Player, fire(1, -0.066, 1.0)],
  [3400, Team.Player, { kind: "upgrade", emplacement: 0, upgrade: "rifled" }],
  [3500, Team.Player, { kind: "buy", emplacement: 4, weapon: "swivel" }],
  [3600, Team.Player, { kind: "man", emplacement: 0 }],
  [3700, Team.Player, fire(0, 0.0, -0.012)],
  [4200, Team.Player, { kind: "route", route: "left" }],
];

export function runBuildMatch(R: Rapier, ticks = BUILD_MATCH_TICKS): MatchSessionResult {
  return runMatchSession(R, ticks, BUILD_MATCH_SCRIPT);
}
