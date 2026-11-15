// What the page knows about each castle's organs that the 3D look needs (3.5):
// is the bell ringing now, and since when. The soundscape sets it (the bell
// rings when enemy men cross the stream towards that castle, and stops short
// when the bell falls); the renderer asks `bellRinging(castle)` to swing it.
// Page time only: nothing here feeds the sim.

import { BELL_GAP, BELL_STROKES } from "./sound";

/** How long one ring lasts (s): its strokes, and the hum after the last. */
export const BELL_RING_SECONDS = BELL_STROKES * BELL_GAP + 1.5;

export class OrganWatch {
  private since: [number, number] = [-1, -1];

  constructor(private clock: () => number = () => performance.now() / 1000) {}

  /** The bell of a castle began to ring now. */
  ring(castle: number) {
    if (castle === 0 || castle === 1) this.since[castle] = this.clock();
  }

  /** The bell stopped short (it fell). */
  cut(castle: number) {
    if (castle === 0 || castle === 1) this.since[castle] = -1;
  }

  /** Seconds since a castle's bell began to ring, or -1 when it is not ringing. */
  bellRinging(castle: number): number {
    const s = this.since[castle === 1 ? 1 : 0];
    if (s < 0) return -1;
    const age = this.clock() - s;
    if (age > BELL_RING_SECONDS) {
      this.since[castle === 1 ? 1 : 0] = -1;
      return -1;
    }
    return age;
  }

  reset() {
    this.since = [-1, -1];
  }
}

/** The one the page and the renderer share. */
export const organWatch = new OrganWatch();

/** Seconds since a castle's bell began to ring, or -1 (for the renderer). */
export function bellRinging(castle: number): number {
  return organWatch.bellRinging(castle);
}
