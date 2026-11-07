// The match (phase 2): two castles and two teams in the valley, a match clock,
// the keeps' income, and who has won. It wraps the world simulation and adds
// what the world does not know about: whose castle is whose, gold, timers and
// the end of the match. Everything that changes a match enters as an input
// tagged with its tick and its team, so a match replays from its inputs, and
// an AI is just another player sending inputs.
//
// Teams are castle indices: team 0 holds the castle at the origin (the enemy
// in a match against the AI), team 1 the one at z = -DIST (the player's).

import { ASHWRIGHT_EMPLACEMENTS, MATCH, MID_Z, type CastleLayout, type Emplacement } from "@keepfall/content";
import { hashBytes, hex8 } from "@keepfall/core";
import { SandboxSim, type Rapier, type SandboxInput } from "@keepfall/sim";

export const enum Team {
  Enemy = 0,
  Player = 1,
}

/** Bump whenever the same match inputs would play out differently because of the match rules (the sim has its own RULES_VERSION). */
export const MATCH_RULES_VERSION = 1;

/** A shot from one of a team's emplacements. */
export type FireInput = Extract<SandboxInput, { kind: "fire" }>;
export type MatchInput = FireInput;

export interface MatchResult {
  /** The winning team, or -1 for a draw (both keeps fell on the same tick). */
  winner: Team | -1;
  reason: "keep";
  /** Tick the match ended. */
  tick: number;
}

export interface MatchOptions {
  seed: number;
  emplacements?: Emplacement[];
}

/** Which team an emplacement belongs to: the castle on its side of the field. */
export function teamOf(e: Emplacement): Team {
  return e.z < MID_Z ? Team.Player : Team.Enemy;
}

export class Match {
  readonly world: SandboxSim;
  readonly gold: [number, number] = [MATCH.startGold, MATCH.startGold];
  /** Shots fired per team. */
  readonly shots: [number, number] = [0, 0];
  result: MatchResult | null = null;
  private inputs = new Map<number, Array<{ team: Team; input: MatchInput }>>();
  private owner: Team[];

  constructor(R: Rapier, layout: CastleLayout, opts: MatchOptions) {
    const emplacements = opts.emplacements ?? ASHWRIGHT_EMPLACEMENTS;
    this.world = new SandboxSim(R, layout, { seed: opts.seed, minions: 0, emplacements });
    this.owner = emplacements.map(teamOf);
  }

  get tick(): number {
    return this.world.tick;
  }

  free() {
    this.world.free();
  }

  /** Queue a team's input for a tick (now or later). Whether it is allowed is decided on that tick. */
  queue(tick: number, team: Team, input: MatchInput) {
    const t = tick < this.tick ? this.tick : tick;
    let list = this.inputs.get(t);
    if (!list) this.inputs.set(t, (list = []));
    list.push({ team, input });
  }

  step() {
    const tick = this.tick;
    const list = this.inputs.get(tick);
    if (list) {
      this.inputs.delete(tick);
      for (const { team, input } of list) {
        // Only while the match is on, and only from the team's own emplacements.
        if (this.result || this.owner[input.emplacement] !== team) continue;
        if (this.world.reload[input.emplacement] > 0) continue;
        this.shots[team]++;
        this.world.queue(tick, input);
      }
    }
    this.world.step();
    if (this.result) return;
    if (tick % MATCH.incomeEvery === MATCH.incomeEvery - 1) {
      this.gold[0] += MATCH.keepIncome;
      this.gold[1] += MATCH.keepIncome;
    }
    // A keep is toppled when its banner comes down: the other team wins.
    const [down0, down1] = this.world.castle.toppled;
    if (down0 || down1) {
      const winner: Team | -1 = down0 && down1 ? -1 : down0 ? Team.Player : Team.Enemy;
      this.result = { winner, reason: "keep", tick };
    }
  }

  /** Pieces of a castle that have come loose or turned to dust. */
  masonryDown(castle: 0 | 1): number {
    const c = this.world.castle;
    let n = 0;
    for (const s of c.layout.stones) if (s.castle === castle && c.dynamic[s.id]) n++;
    return n;
  }

  /** Hash of the whole match: the world's state plus gold, shots and the result. */
  hash(): { state: string; world: string } {
    const w = this.world.hash();
    const r = this.result;
    const f = new Float64Array([this.tick, this.gold[0], this.gold[1], this.shots[0], this.shots[1], r ? r.winner : -2, r ? r.tick : -1, parseInt(w.state, 16)]);
    return { state: hex8(hashBytes(new Uint8Array(f.buffer))), world: w.world };
  }
}
