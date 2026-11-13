// Buttresses against the keep's faces (phase 3, 3.4, rule 11). Contract
// written by the master. Each keep's four buttresses are laid out with the
// castle (content BUTTRESS, layout option buttresses) and leave the world at
// the start (before the nav grid sees the castles); one that is bought rises
// piece by piece like a building, over BUTTRESS.buildTicks, a piece going up
// only when its place is clear (as structures.ts raises a plot's building).
// Once up it is masonry of the keep: the statics pass counts it, and the
// keep's masons put its pieces back when they come down (never before it is
// bought).
//
// Deterministic: buttresses in layout order, pieces in id order on fixed
// ticks, Rapier's queries sorted.

import type { CastleLayout } from "@keepfall/content";
import type { CastleSim } from "./castleSim";
import type { EventKind } from "./frame";
import type { Minions } from "./minions";

type Emit = (kind: EventKind, a: number, b: number, c: number, d: number) => void;

export const enum ButtressState {
  /** Not bought: its pieces are out of the world. */
  Empty = 0,
  /** Going up, piece by piece. */
  Rising = 1,
  /** Up: masonry of the keep (masons put back what comes down). */
  Standing = 2,
}

export class Buttresses {
  /** Each buttress's state, in layout order (castle 0's four in BUTTRESS_FACES order, then castle 1's). */
  readonly states: ButtressState[];
  /** The buttress each piece belongs to (index into layout.buttresses), or -1. */
  private of: Int16Array;

  constructor(
    private castle: CastleSim,
    private minions: Minions,
    private ground: ReadonlySet<number>,
    private emit: Emit,
  ) {
    void this.minions;
    void this.ground;
    void this.emit;
    const L = castle.layout;
    this.states = L.buttresses.map(() => ButtressState.Empty);
    this.of = new Int16Array(L.stones.length).fill(-1);
    L.buttresses.forEach((b, k) => {
      for (let id = b.first; id < b.first + b.count; id++) this.of[id] = k;
    });
  }

  /** Index into layout.buttresses (and `states`) of a castle's buttress on a face (BUTTRESS_FACES index), or -1. */
  index(castle: number, face: number): number {
    return this.layout.buttresses.findIndex((b, k) => b.castle === castle && k - this.layout.buttresses.findIndex((q) => q.castle === castle) === face);
  }

  get layout(): CastleLayout {
    return this.castle.layout;
  }

  /** Every buttress piece leaves the world (once, before anything is built and before the nav grid is made). */
  clearAll() {
    for (const b of this.layout.buttresses) for (let id = b.first; id < b.first + b.count; id++) this.castle.withdraw(id);
  }

  /** Start a castle's buttress on a face (BUTTRESS_FACES index) rising (the rules have checked the gold). False if it is not Empty. */
  build(castle: number, face: number, tick: number): boolean {
    void castle;
    void face;
    void tick;
    return false;
  }

  state(castle: number, face: number): ButtressState {
    const k = this.index(castle, face);
    return k < 0 ? ButtressState.Empty : this.states[k];
  }

  /** May masons put this piece back? True for any piece that is not a buttress's, and for a buttress's once it is up. */
  mendable(id: number): boolean {
    const k = this.of[id];
    return k < 0 || this.states[k] === ButtressState.Standing;
  }

  /** Raise what is due. Call before the physics step. */
  step(tick: number) {
    void tick;
  }

  hashInto(out: number[]) {
    void out;
  }
}
