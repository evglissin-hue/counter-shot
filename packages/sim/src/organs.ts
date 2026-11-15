// The organs in the world (phase 3, 3.5). Each castle's bell, crane and signal
// mast are masonry laid out with it (content organs.ts, layout option organs)
// and stand from the first tick; nothing is withdrawn. Every COUNT_EVERY
// ticks each organ's pieces standing are counted (as structures.ts counts a
// building's): it works while at least ORGAN_WORKS of them stand, its key
// piece among them (the bell, the crane's jib, the mast's yard). A change
// either way is an event (OrganDown, OrganUp). Masons put organs back under
// the Works repair switch (works.ts); `wait` says why an organ that is down
// is not being put back, for the page.
//
// Deterministic: organs in layout order, counts on fixed ticks.

import { ORGAN_KINDS, ORGAN_WORKS, type CastleLayout } from "@keepfall/content";
import type { CastleSim } from "./castleSim";
import { EventKind } from "./frame";

type Emit = (kind: EventKind, a: number, b: number, c: number, d: number) => void;

/** Why an organ that is down is not being put back (Organs.wait; 0 while it works or masons are at it). */
export const enum OrganWait {
  /** It works, or masons are putting it back. */
  None = 0,
  /** What it stands on is down (the bell's tower top, the mast's roof): it waits for that. */
  Footing = 1,
  /** Its pieces are high work and the crane is down (never the crane's own). */
  Crane = 2,
  /** Works repairs are off. */
  Off = 3,
  /** Masons are busy with other work first, or wait for gold, or have none standing. */
  Busy = 4,
}

/** Ticks between counts of what stands. */
const COUNT_EVERY = 10;

export class Organs {
  /** Per organ in layout order (castle 0's in ORGAN_KINDS order, then castle 1's): its pieces, its key piece, pieces standing at the last count, and whether it works. */
  readonly ids: number[][];
  readonly key: number[];
  readonly up: number[];
  readonly works: boolean[];
  /** Per organ in layout order: why it is not being put back (OrganWait), set by the masons (works.ts). */
  readonly wait: Uint8Array;
  /** The organ each piece belongs to (index into layout.organs), or -1. */
  readonly of: Int16Array;

  constructor(
    private castle: CastleSim,
    private emit: Emit,
  ) {
    const L = castle.layout;
    this.ids = L.organs.map((o) => {
      const ids: number[] = [];
      for (let id = o.first; id < o.first + o.count; id++) ids.push(id);
      return ids;
    });
    this.key = L.organs.map((o) => o.key);
    this.up = L.organs.map((o) => o.count);
    this.works = L.organs.map(() => true);
    this.wait = new Uint8Array(L.organs.length);
    this.of = new Int16Array(L.stones.length).fill(-1);
    L.organs.forEach((o, k) => {
      for (let id = o.first; id < o.first + o.count; id++) this.of[id] = k;
    });
  }

  get layout(): CastleLayout {
    return this.castle.layout;
  }

  /** Index into layout.organs of a castle's organ (ORGAN_KINDS index), or -1 (a layout without organs). */
  index(castle: number, organ: number): number {
    const i = castle * ORGAN_KINDS.length + organ;
    const o = this.layout.organs[i];
    return o && o.castle === castle && o.organ === organ ? i : -1;
  }

  /** Does a castle's organ work? (True in a layout without organs: nothing is lost.) */
  working(castle: number, organ: number): boolean {
    const i = this.index(castle, organ);
    return i < 0 || this.works[i];
  }

  /** The share of a castle's organ's pieces standing (1 in a layout without organs). */
  share(castle: number, organ: number): number {
    const i = this.index(castle, organ);
    return i < 0 ? 1 : this.up[i] / this.ids[i].length;
  }

  /** Count what stands and say what changed (call after the physics step). */
  step(tick: number) {
    if (tick % COUNT_EVERY !== 0) return;
    const dyn = this.castle.dynamic;
    for (let i = 0; i < this.ids.length; i++) {
      let up = 0;
      for (const id of this.ids[i]) if (!dyn[id]) up++;
      this.up[i] = up;
      const works = up >= this.ids[i].length * ORGAN_WORKS && !dyn[this.key[i]];
      if (works === this.works[i]) continue;
      this.works[i] = works;
      const o = this.layout.organs[i];
      this.emit(works ? EventKind.OrganUp : EventKind.OrganDown, o.castle, o.organ, 0, 0);
    }
  }

  hashInto(out: number[]) {
    for (let i = 0; i < this.ids.length; i++) out.push(this.up[i], this.works[i] ? 1 : 0, this.wait[i]);
  }
}
