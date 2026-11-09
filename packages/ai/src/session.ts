// The AI against AI match (phase 2 M5): a Knight on each side, from the same
// valley and the same seed, for three minutes of match time. Node pins its
// hash and headless Chromium must replay it to the same bits, so it covers the
// AI's every decision as well as the match and the world under it.

import { buildLayout, GAME_LAYOUT, type Difficulty } from "@keepfall/content";
import type { Rapier } from "@keepfall/sim";
import { Match, Team, type MatchResult } from "@keepfall/rules";
import { AiPlayer } from "./ai";

export const AI_MATCH_TICKS = 3 * 60 * 60;

/** Pinned: change only on purpose (and bump RULES_VERSION or MATCH_RULES_VERSION when play changes). */
export const AI_MATCH_HASH = { state: "1122efd1", world: "e4a33d6c" } as const;

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
