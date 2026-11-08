// The AI player (phase 2 M5): a castle commanded by the same inputs a player
// sends, judged by the same rules. It reads the match (as you read the field
// from your walls and the overview), and every tick its gunner turns the gun
// it rides, fires and learns from where its shots land, while every few
// seconds its steward builds and buys by its plan, sets its barracks, gives
// orders and works the repair switches. It draws from its own seeded stream,
// so a match against it replays from its seed and your inputs.

import { AI_LEVELS, type AiLevel, type Difficulty } from "@keepfall/content";
import { hashString, Rng } from "@keepfall/core";
import type { Match, MatchInput } from "@keepfall/rules";
import { Gunner } from "./gunner";
import { Steward } from "./steward";

export class AiPlayer {
  readonly level: AiLevel;
  readonly gunner: Gunner;
  readonly steward: Steward;
  private nextLook: number;

  constructor(
    private m: Match,
    readonly team: number,
    readonly difficulty: Difficulty,
    seed: number,
  ) {
    this.level = AI_LEVELS[difficulty];
    const rng = new Rng((hashString(`ai:${team}`) ^ seed) >>> 0);
    const send = (tick: number, input: MatchInput) => this.m.queue(tick, team, input);
    this.gunner = new Gunner(m, team, this.level, rng, send);
    this.steward = new Steward(m, team, difficulty, this.level, rng, send);
    // Its first look comes a moment into the match, staggered by team.
    this.nextLook = 30 + team * 7;
  }

  /** Once a tick, before the match steps: read the field and send inputs for this tick. */
  step() {
    const m = this.m;
    if (m.result) return;
    const tick = m.tick;
    this.gunner.step(tick);
    if (tick >= this.nextLook) {
      this.steward.look(tick);
      this.nextLook = tick + this.level.plan;
    }
  }
}
