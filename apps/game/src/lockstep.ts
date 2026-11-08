// Lockstep for online 1v1 (SPEC section 14): both machines run the whole
// match, and only inputs cross the wire. Each side schedules its own inputs
// a few ticks ahead (the input delay) and promises that it has nothing more
// for every tick up to its `through`; a match steps a tick only once the
// other side has promised it. What travels is a side's whole state for the
// other (its promise, every input the other has not acknowledged yet, the
// last few state hashes), so a message that is dropped or arrives twice
// costs nothing: the next one carries everything again. The page carries it
// over the artifact room (presence); a test carries it over a lossy queue.

import { hashBytes } from "@keepfall/core";
import type { Match, MatchInput } from "@keepfall/rules";
import { MinionState } from "@keepfall/sim";

/** One input on the wire: its sequence number (1, 2, ...), the tick it is for, and the input. */
export interface NetInput {
  s: number;
  t: number;
  i: MatchInput;
}

/** What one side tells the other. Plain JSON, kept small (presence holds 4 KiB). */
export interface NetState {
  /** Every input of this side for ticks up to here is in `inputs` (or was acknowledged). */
  through: number;
  /** Inputs the other side has not acknowledged yet, oldest first. */
  inputs: NetInput[];
  /** The highest sequence number of the other side's inputs this side has taken. */
  ack: number;
  /** Recent state hashes: [tick, hash]. */
  hashes: Array<[number, number]>;
  /** The tick this side has simulated up to (for pacing and the HUD). */
  tick: number;
}

/** A state hash is taken every this many ticks (2 s). */
export const HASH_EVERY = 120;
/** How many recent hashes travel. */
const HASHES_KEPT = 4;
/** At most this many unacknowledged inputs: past it, new ones wait (the other side has gone quiet). */
export const OUTBOX_MAX = 32;

export interface Sink {
  /** Queue an input for a team on a tick (the match's queue). */
  queue(tick: number, team: number, input: MatchInput): void;
  /** The tick the match will simulate next. */
  readonly tick: number;
}

export class Lockstep {
  /** Input delay in ticks: local inputs are scheduled this far ahead. */
  delay: number;
  /** The highest tick this side has promised (its inputs up to it are final). */
  promised: number;
  /** The other side's promise, its tick as it last said, and the last time (ms, the caller's clock) it was heard from. */
  remoteThrough = -1;
  remoteTick = -1;
  heardAt = 0;
  /** First tick whose hashes differ between the two sides (null: none so far). */
  desync: number | null = null;
  private seq = 0;
  private outbox: NetInput[] = [];
  private remoteSeq = 0;
  private mine = new Map<number, number>();
  private theirs = new Map<number, number>();
  private recent: Array<[number, number]> = [];
  /** Inputs that could not be scheduled yet (the outbox was full), in order. */
  private waiting: MatchInput[] = [];

  constructor(
    private sink: Sink,
    readonly me: number,
    readonly them: number,
    delay = 8,
  ) {
    this.delay = delay;
    this.promised = delay - 1;
  }

  /** May the match step its next tick? Only once the other side has promised it. */
  canStep(): boolean {
    return this.sink.tick <= this.remoteThrough && this.sink.tick <= this.promised;
  }

  /** How far ahead of the other side this one is (ticks; negative: behind). */
  lead(): number {
    return this.remoteTick < 0 ? 0 : this.sink.tick - this.remoteTick;
  }

  /** After the match stepped a tick: promise more, and take a hash when one is due (`hash` is called only then). */
  afterStep(hash: () => number) {
    const t = this.sink.tick; // the next tick to simulate
    const want = t + this.delay - 1;
    if (want > this.promised) this.promised = want;
    while (this.waiting.length && this.outbox.length < OUTBOX_MAX) this.schedule(this.waiting.shift()!);
    if ((t - 1) % HASH_EVERY === 0) {
      const h = hash();
      this.mine.set(t - 1, h);
      this.recent.push([t - 1, h]);
      if (this.recent.length > HASHES_KEPT) this.recent.shift();
      this.check(t - 1);
      if (this.mine.size > 64) this.mine.delete(this.mine.keys().next().value!);
    }
  }

  /** One of this side's inputs: scheduled after everything promised, and queued here at once. */
  local(input: MatchInput) {
    if (this.outbox.length >= OUTBOX_MAX || this.waiting.length) {
      this.waiting.push(input);
      return;
    }
    this.schedule(input);
  }

  private schedule(input: MatchInput) {
    const t = Math.max(this.promised + 1, this.sink.tick + this.delay);
    const n: NetInput = { s: ++this.seq, t, i: input };
    this.outbox.push(n);
    this.sink.queue(t, this.me, input);
  }

  /**
   * What to tell the other side now, in at most about `budget` bytes of JSON
   * (the room's presence holds 4 KiB): the oldest inputs first, and if some
   * do not fit, a promise that stops short of the first one left out.
   */
  state(budget = 3000): NetState {
    let through = this.promised;
    const inputs: NetInput[] = [];
    let size = 160;
    for (const n of this.outbox) {
      size += JSON.stringify(n).length + 1;
      if (size > budget && inputs.length) {
        through = Math.min(through, n.t - 1);
        break;
      }
      inputs.push(n);
    }
    return { through, inputs, ack: this.remoteSeq, hashes: this.recent.slice(), tick: this.sink.tick };
  }

  /**
   * What the other side said. Its inputs are taken in sequence (a gap means a
   * stale message: the rest waits for the next), its promise is believed only
   * as far as the inputs taken, and what it acknowledged leaves the outbox.
   * Returns false if the message made no sense (an input for a tick already
   * simulated: the two sides can no longer agree).
   */
  remote(st: NetState, now: number): boolean {
    this.heardAt = now;
    let ok = true;
    let complete = true;
    const list = Array.isArray(st.inputs) ? st.inputs : [];
    for (const n of list) {
      if (!n || typeof n.s !== "number" || typeof n.t !== "number") continue;
      if (n.s <= this.remoteSeq) continue;
      if (n.s !== this.remoteSeq + 1) {
        complete = false;
        break;
      }
      if (n.t < this.sink.tick) ok = false;
      this.sink.queue(n.t, this.them, n.i);
      this.remoteSeq = n.s;
    }
    if (complete && typeof st.through === "number" && st.through > this.remoteThrough) this.remoteThrough = st.through;
    if (typeof st.tick === "number") this.remoteTick = st.tick;
    if (typeof st.ack === "number") {
      let k = 0;
      while (k < this.outbox.length && this.outbox[k].s <= st.ack) k++;
      if (k) this.outbox.splice(0, k);
    }
    if (Array.isArray(st.hashes)) {
      for (const pair of st.hashes) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        this.theirs.set(pair[0], pair[1]);
        this.check(pair[0]);
      }
      if (this.theirs.size > 64) this.theirs.delete(this.theirs.keys().next().value!);
    }
    if (!ok && this.desync === null) this.desync = this.sink.tick;
    return ok;
  }

  private check(tick: number) {
    const a = this.mine.get(tick), b = this.theirs.get(tick);
    if (a !== undefined && b !== undefined && a !== b && this.desync === null) this.desync = tick;
  }

  /** Inputs waiting for the other side's acknowledgement (for the HUD: a long queue means a slow link). */
  get unacked(): number {
    return this.outbox.length + this.waiting.length;
  }
}

/**
 * A cheap hash of a match for the two sides to compare (every 2 s): the
 * clock, gold, shots, waves, the result, every man standing and where, how
 * many pieces are loose and where the banners are. Not the whole world (that
 * takes a Rapier snapshot): enough to see two sides drift apart within seconds.
 */
export function netHash(m: Match): number {
  const nums: number[] = [m.tick, m.gold[0], m.gold[1], m.shots[0], m.shots[1], m.autoShots[0], m.autoShots[1], m.waves[0], m.waves[1], m.result ? m.result.winner : -2];
  for (const mi of m.world.minions.list) if (mi.state === MinionState.Upright) nums.push(mi.id, mi.x, mi.z);
  const c = m.world.castle;
  nums.push(c.dynList.length);
  for (const id of c.layout.bannerIds) {
    const p = c.bodies[id].translation();
    nums.push(p.x, p.y, p.z);
  }
  return hashBytes(new Uint8Array(new Float64Array(nums).buffer));
}
