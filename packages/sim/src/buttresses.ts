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

import { BUTTRESS, BUTTRESS_FACES, type CastleLayout } from "@keepfall/content";
import type { CastleSim } from "./castleSim";
import { EventKind } from "./frame";
import type { Minions } from "./minions";
import { raisePiece, RETRY } from "./structures";

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
  /** Each buttress's pieces (lowest course first, then by id), the next to raise, the tick it is due and the ticks between pieces. */
  private ids: number[][];
  private next: number[];
  private due: number[];
  private every: number[];

  constructor(
    private castle: CastleSim,
    private minions: Minions,
    private ground: ReadonlySet<number>,
    private emit: Emit,
  ) {
    const L = castle.layout;
    this.states = L.buttresses.map(() => ButtressState.Empty);
    this.of = new Int16Array(L.stones.length).fill(-1);
    this.ids = L.buttresses.map((b) => {
      const ids: number[] = [];
      for (let id = b.first; id < b.first + b.count; id++) ids.push(id);
      ids.sort((a, c) => L.stones[a].course - L.stones[c].course || a - c);
      return ids;
    });
    this.next = L.buttresses.map(() => 0);
    this.due = L.buttresses.map(() => 0);
    this.every = L.buttresses.map((b) => Math.max(1, Math.floor(BUTTRESS.buildTicks / Math.max(1, b.count))));
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
    const k = this.index(castle, face);
    if (k < 0 || this.states[k] !== ButtressState.Empty) return false;
    this.next[k] = 0;
    this.due[k] = tick + this.every[k];
    this.states[k] = ButtressState.Rising;
    return true;
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
    for (let k = 0; k < this.states.length; k++) {
      if (this.states[k] === ButtressState.Rising && tick >= this.due[k]) this.raiseNext(k, tick);
    }
  }

  private raiseNext(k: number, tick: number) {
    const ids = this.ids[k];
    const dyn = this.castle.dynamic;
    // Skip what already stands.
    while (this.next[k] < ids.length && !dyn[ids[this.next[k]]]) this.next[k]++;
    if (this.next[k] >= ids.length) {
      // Anything knocked down while it rose goes up again before it counts as finished.
      let j = 0;
      while (j < ids.length && !dyn[ids[j]]) j++;
      if (j < ids.length) {
        this.next[k] = j;
      } else {
        this.states[k] = ButtressState.Standing;
        const b = this.layout.buttresses[k];
        this.emit(EventKind.Buttressed, b.castle, BUTTRESS_FACES.indexOf(b.face), 0, 0);
        return;
      }
    }
    if (!raisePiece(this.castle, this.minions, this.ground, this.emit, this.layout, ids[this.next[k]])) {
      this.due[k] = tick + RETRY;
      return;
    }
    this.next[k]++;
    this.due[k] = tick + this.every[k];
  }

  hashInto(out: number[]) {
    for (let k = 0; k < this.states.length; k++) out.push(this.states[k], this.next[k], this.due[k]);
  }
}
