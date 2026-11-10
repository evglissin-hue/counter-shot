// The AI player (phase 2 M5): a castle commanded by the same inputs a player
// sends, judged by the same rules. It reads the match (as you read the field
// from your walls and the overview), and every tick its gunner turns the gun
// it rides, fires and learns from where its shots land, while every few
// seconds its steward builds and buys by its plan, sets its barracks, gives
// orders and works the repair switches. It draws from its own seeded stream,
// so a match against it replays from its seed and your inputs.

import { AI_LEVELS, type AiLevel, type AiName, type AiStep } from "@keepfall/content";
import { hashString, Rng } from "@keepfall/core";
import type { Match, MatchInput } from "@keepfall/rules";
import { Gunner } from "./gunner";
import { Steward } from "./steward";
import { Tutor } from "./tutor";

export class AiPlayer {
  readonly level: AiLevel;
  readonly gunner: Gunner;
  readonly steward: Steward;
  private nextLook: number;
  private tutor: Tutor | null;

  constructor(
    private m: Match,
    readonly team: number,
    readonly difficulty: AiName,
    seed: number,
    /** For tools: a build plan to follow instead of the level's own. */
    opts?: { plan?: AiStep[] },
  ) {
    this.level = AI_LEVELS[difficulty];
    const rng = new Rng((hashString(`ai:${team}`) ^ seed) >>> 0);
    const send = (tick: number, input: MatchInput) => this.m.queue(tick, team, input);
    this.tutor = difficulty === "tutor" ? new Tutor(m, team) : null;
    const stage = this.tutor ? () => this.tutor!.stage : null;
    this.gunner = new Gunner(m, team, this.level, rng, send, stage);
    this.steward = new Steward(m, team, difficulty, this.level, rng, send, stage, opts?.plan);
    // Its first look comes a moment into the match, staggered by team.
    this.nextLook = 30 + team * 7;
  }

  /**
   * M6: the tutor's stage (the guided first match), for the page: 0 asleep, then
   * higher as it wakes (TUTOR in @keepfall/content); -1 for any other AI.
   */
  get stage(): number {
    return this.tutor ? this.tutor.stage : -1;
  }

  /** Once a tick, before the match steps: read the field and send inputs for this tick. */
  step() {
    const m = this.m;
    if (m.result) return;
    const tick = m.tick;
    this.tutor?.update(tick);
    this.gunner.step(tick);
    if (tick >= this.nextLook) {
      this.steward.look(tick);
      this.nextLook = tick + this.level.plan;
    }
  }
}
