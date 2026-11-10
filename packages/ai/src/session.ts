// The AI against AI match (phase 2 M5): a Knight on each side, from the same
// valley and the same seed, for three minutes of match time. Node pins its
// hash and headless Chromium must replay it to the same bits, so it covers the
// AI's every decision as well as the match and the world under it.

import { buildLayout, GAME_LAYOUT, type Difficulty } from "@keepfall/content";
import { Order, Spin, type Rapier } from "@keepfall/sim";
import { GUIDED_OPTIONS, Match, Team, TUTOR_TEAM, type MatchInput, type MatchResult } from "@keepfall/rules";
import { AiPlayer } from "./ai";

export const AI_MATCH_TICKS = 3 * 60 * 60;

/** Pinned: change only on purpose (and bump RULES_VERSION or MATCH_RULES_VERSION when play changes). */
export const AI_MATCH_HASH = { state: "0f46168b", world: "e4a33d6c" } as const;

export interface AiMatchResult {
  hash: { state: string; world: string };
  result: MatchResult | null;
  gold: [number, number];
  spent: [number, number];
  shots: [number, number];
  autoShots: [number, number];
  waves: [number, number];
  masonry: [number, number];
  built: [number, number];
}

export function runAiMatch(R: Rapier, ticks = AI_MATCH_TICKS, levels: [Difficulty, Difficulty] = ["knight", "knight"], seed = 11, onTick?: (m: Match, ais: AiPlayer[]) => void): AiMatchResult {
  const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false });
  const ais = [new AiPlayer(m, Team.Enemy, levels[0], seed), new AiPlayer(m, Team.Player, levels[1], seed)];
  for (let i = 0; i < ticks && !m.result; i++) {
    for (const ai of ais) ai.step();
    m.step();
    onTick?.(m, ais);
  }
  const pair = (a: [number, number]): [number, number] => [a[0], a[1]];
  const st = m.world.structures!;
  const built = [0, 1].map((c) => [0, 1, 2, 3, 4, 5].filter((p) => st.slot(c, p).kind >= 0).length) as [number, number];
  const out: AiMatchResult = {
    hash: m.hash(), result: m.result, gold: pair(m.gold), spent: pair(m.spent), shots: pair(m.shots), autoShots: pair(m.autoShots), waves: pair(m.waves),
    masonry: [m.masonryDown(0), m.masonryDown(1)], built,
  };
  m.free();
  return out;
}

// The guided match (phase 2 M6): the player against the tutor from the guided
// options (the tutor's castle starts with no barracks, the player's waves wait
// on Hold), for five minutes of match time. The player builds a mill, shoots at
// the keep with the long gun, orders Advance for a moment (and Hold again) and
// builds a second barracks; the tutor stirs at 1:30, wakes when the order is
// given and fights 150 s later. It pins the tutor's stages and every choice it makes.

export const GUIDED_MATCH_TICKS = 5 * 60 * 60;

/** Pinned: change only on purpose (and bump RULES_VERSION or MATCH_RULES_VERSION when play changes). */
export const GUIDED_MATCH_HASH = { state: "c71846e7", world: "dbf0c11b" } as const;

const guidedFire = (yaw: number, pitch: number): MatchInput => ({ kind: "fire", emplacement: 0, yaw, pitch, charge: 1, fuse: 0, spin: Spin.None });

export const GUIDED_MATCH_SCRIPT: Array<[number, MatchInput]> = [
  [0, { kind: "man", emplacement: 0 }],
  [1200, { kind: "build", plot: 1, building: "mill" }],
  [2400, guidedFire(0, 0.06)],
  [3600, guidedFire(0, 0.06)],
  [4800, guidedFire(0, 0.06)],
  [7200, { kind: "order", order: Order.Advance }], // 30 s after the tutor stirs: it wakes
  [7260, { kind: "order", order: Order.Hold }], // (sent in for longer, the waves would storm a sleeping castle and end the match)
  [16500, { kind: "order", order: Order.Advance }],
  [10000, { kind: "build", plot: 2, building: "barracks" }],
  [12000, guidedFire(0, 0.06)],
  [14000, guidedFire(0, 0.06)],
];

export interface GuidedMatchResult {
  hash: { state: string; world: string };
  result: MatchResult | null;
  /** The tutor's stage at 1:30, 3:00, 4:00 and the end, and the tick each stage began (-1: never). */
  stages: number[];
  stageTicks: number[];
  gold: [number, number];
  shots: [number, number];
  waves: [number, number];
  masonry: [number, number];
}

export function runGuidedMatch(R: Rapier, ticks = GUIDED_MATCH_TICKS, seed = 31): GuidedMatchResult {
  const m = new Match(R, buildLayout(1, GAME_LAYOUT), { ...GUIDED_OPTIONS, seed });
  const tutor = new AiPlayer(m, TUTOR_TEAM, "tutor", seed);
  for (const [t, input] of GUIDED_MATCH_SCRIPT) m.queue(t, Team.Player, input);
  const stages: number[] = [], stageTicks = [0, -1, -1, -1];
  for (let i = 0; i < ticks && !m.result; i++) {
    tutor.step();
    m.step();
    if (stageTicks[tutor.stage] < 0) stageTicks[tutor.stage] = i;
    if (i === 90 * 60 || i === 180 * 60 || i === 240 * 60) stages.push(tutor.stage);
  }
  stages.push(tutor.stage);
  const pair = (a: [number, number]): [number, number] => [a[0], a[1]];
  const out: GuidedMatchResult = { hash: m.hash(), result: m.result, stages, stageTicks, gold: pair(m.gold), shots: pair(m.shots), waves: pair(m.waves), masonry: [m.masonryDown(0), m.masonryDown(1)] };
  m.free();
  return out;
}
