// The scripted match: a long gun hit on the enemy keep and two mortar shells
// down its shaft bring the banner to the ground floor for the player's win; a
// third shell, a shot after the end and the enemy firing the player's gun must
// all be refused. Node tests pin its hash, so any change to how a match plays
// out shows up here.

import { buildLayout, GAME_LAYOUT } from "@keepfall/content";
import { Spin, type Rapier } from "@keepfall/sim";
import { Match, Team, type MatchInput, type MatchResult } from "./match";

export const MATCH_TICKS = 1200;

/** Pinned: change only on purpose, and bump RULES_VERSION or MATCH_RULES_VERSION when play changes. */
export const MATCH_HASH = { state: "8fd8ce35", world: "e6e81c57" } as const;

const fire = (emplacement: number, yaw: number, pitch: number): MatchInput => ({ kind: "fire", emplacement, yaw, pitch, charge: 1, fuse: 0, spin: Spin.None });

export const MATCH_SCRIPT: Array<[number, Team, MatchInput]> = [
  [30, Team.Player, fire(1, 0, 0.8165)],
  [60, Team.Player, fire(0, 0, 0.035)],
  [450, Team.Player, fire(1, -0.005, 0.8155)],
  // The keep has fallen by now: these are refused.
  [870, Team.Player, fire(1, -0.005, 0.8155)],
  [1000, Team.Player, fire(0, 0.02, 0.03)],
  // Not the enemy's emplacement: refused.
  [100, Team.Enemy, fire(0, 0, 0.03)],
];

export interface MatchSessionResult {
  hash: { state: string; world: string };
  result: MatchResult | null;
  gold: [number, number];
  shots: [number, number];
}

export function runMatchSession(R: Rapier, ticks = MATCH_TICKS): MatchSessionResult {
  const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed: 7 });
  for (const [t, team, input] of MATCH_SCRIPT) m.queue(t, team, input);
  for (let i = 0; i < ticks; i++) m.step();
  const out = { hash: m.hash(), result: m.result, gold: [m.gold[0], m.gold[1]] as [number, number], shots: [m.shots[0], m.shots[1]] as [number, number] };
  m.free();
  return out;
}
