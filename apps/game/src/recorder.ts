// The recorder (track S, step S3): the page keeps the last 40 s of frames as
// they came, with what the page itself knew with each (barrels, guns out, the
// storm, bridges), takes a keyframe of the renderer's world every 10 s, and
// when a moment scores above the film's line copies its clip out (the keyframe
// before it and the frames from 4 s before the moment to 6 s after) into a reel
// of the 8 best clips of the match.
//
// No DOM and no renderer code: the keyframe is taken by a function the page
// passes in. Copying a clip is holding references: a frame is never written
// after the page receives it (nothing in the page writes into a frame's arrays),
// so a clip, the ring and the renderer's own last frame can share them.
//
// Call order from the page: `note(f, extras)` when a frame arrives from the
// worker, `frame(f)` after the renderer applied it (render-clock order),
// `moment(m)` from the moments finder, `reset()` with a new world.

import type { FrameData } from "@keepfall/sim";
import { frameBytes, type RenderKeyframe } from "./render/keyframe";
import type { Moment } from "./moments";

/** What the page knew when a frame arrived, which the frame does not carry. */
export interface FrameExtras {
  /** Every emplacement's barrel as it pointed: yaw, pitch each (match order). */
  guns: Float32Array | null;
  /** Every emplacement's knocked-out state ([state, ticks left] each). */
  out: Int16Array | null;
  /** What the page told the renderer's storm rings: progress and whether the attackers hold, for castle 0 then castle 1 (progress0, live0, progress1, live1). */
  storm: [number, number, number, number] | null;
  /** Can each bridge be crossed, when it changed. */
  bridges: boolean[] | null;
  /** Every emplacement's weapon and upgrade (two bytes each). */
  arms: Int8Array | null;
  /** Every gun's reload as the match reported it (ticks left, indexed by match emplacement id), for the guns' recoil and run out in a replay (look round L1). */
  reload: Int16Array | null;
}

export interface RecEntry {
  frame: FrameData;
  extras: FrameExtras;
  bytes: number;
}

export interface Keyframe {
  tick: number;
  render: RenderKeyframe;
  extras: FrameExtras;
  bytes: number;
}

export interface Clip {
  moment: Moment;
  /** The window asked for, in ticks (the keyframe is at or before `from`, unless the ring began later). */
  from: number;
  to: number;
  keyframe: Keyframe;
  /** Every recorded frame after the keyframe up to `to`, oldest first (the player rolls forward from the keyframe). */
  entries: RecEntry[];
  /** Entries plus keyframe. */
  bytes: number;
}

export const RING_SECONDS = 40;
export const RING_CAP = 48 * 2 ** 20;
/** A keyframe every this many ticks (10 s). */
export const KEY_EVERY = 600;
export const REEL_CLIPS = 8;
export const REEL_CAP = 120 * 2 ** 20;
/** A moment must score at least this to be copied out as a clip. */
export const FILM_LINE = 100;
/** Ticks before the moment's beginning (4 s) and after its tick (6 s), and the longest a clip may run (16 s). */
export const CLIP_BEFORE = 240;
export const CLIP_AFTER = 360;
export const CLIP_MAX = 960;

const TICKS_PER_SECOND = 60;
const NO_EXTRAS: FrameExtras = { guns: null, out: null, storm: null, bridges: null, arms: null, reload: null };

/** Bytes of what a frame's extras hold. */
export function extrasBytes(e: FrameExtras): number {
  return (e.guns ? e.guns.byteLength : 0) + (e.out ? e.out.byteLength : 0) + (e.arms ? e.arms.byteLength : 0) + (e.reload ? e.reload.byteLength : 0) + (e.storm ? 32 : 0) + (e.bridges ? e.bridges.length : 0);
}

interface Pending {
  moment: Moment;
  from: number;
  to: number;
  /** The tick of the keyframe this clip will start from (pinned in the ring until it closes), or -Infinity before any exists. */
  pin: number;
}

export class Recorder {
  private capture: (tick: number) => RenderKeyframe;
  private extrasOf = new WeakMap<FrameData, FrameExtras>();
  /** The ring, oldest first. */
  private entries: RecEntry[] = [];
  private entryBytes = 0;
  private keys: Keyframe[] = [];
  private keyBytes = 0;
  private lastKeyTick = -Infinity;
  private pending: Pending[] = [];
  private clips: Clip[] = [];
  private closed: Clip | null = null;
  private subs: Array<(c: Clip) => void> = [];
  private peak = 0;

  constructor(opts: { capture: (tick: number) => RenderKeyframe }) {
    this.capture = opts.capture;
  }

  /** A frame arrived from the worker, with what the page knew with it. */
  note(f: FrameData, extras: FrameExtras): void {
    this.extrasOf.set(f, extras);
  }

  /** The renderer applied this frame. */
  frame(f: FrameData): void {
    const last = this.entries[this.entries.length - 1];
    // Time went backwards (a new world the page did not say so for): the old frames are not this match's.
    if (last && f.tick < last.frame.tick) this.clearRing();
    const extras = this.extrasOf.get(f) ?? NO_EXTRAS;
    this.extrasOf.delete(f);
    const bytes = frameBytes(f) + extrasBytes(extras);
    this.entries.push({ frame: f, extras, bytes });
    this.entryBytes += bytes;
    if (f.tick - this.lastKeyTick >= KEY_EVERY) {
      const render = this.capture(f.tick);
      const key: Keyframe = { tick: f.tick, render, extras, bytes: render.bytes + extrasBytes(extras) };
      this.keys.push(key);
      this.keyBytes += key.bytes;
      this.lastKeyTick = f.tick;
    }
    // A pending clip that has no keyframe yet takes the first one.
    for (const p of this.pending) if (p.pin === -Infinity) p.pin = this.keyFor(p.from)?.tick ?? -Infinity;
    for (const p of [...this.pending]) if (f.tick >= p.to) this.close(p);
    this.trim();
    this.peak = Math.max(this.peak, this.entryBytes + this.keyBytes);
  }

  /** A moment was found. One that scores above the film's line opens a clip. */
  moment(m: Moment): void {
    if (!(m.score >= FILM_LINE) || !Number.isFinite(m.tick)) return;
    const began = Number.isFinite(m.first) ? Math.min(m.first as number, m.tick) : m.tick;
    const to = m.tick + CLIP_AFTER;
    const from = Math.max(began - CLIP_BEFORE, to - CLIP_MAX);
    const p: Pending = { moment: m, from, to, pin: this.keyFor(from)?.tick ?? -Infinity };
    // Frames already past its end (the page found it late): close at once with what is there.
    const newest = this.entries[this.entries.length - 1];
    this.pending.push(p);
    if (newest && newest.frame.tick >= to) this.close(p);
  }

  /** Close every pending clip with the frames there are. */
  flush(): void {
    for (const p of [...this.pending]) this.close(p);
    this.trim();
  }

  /** A new match or a reset: everything goes, the reel too. */
  reset(): void {
    this.clearRing();
    this.pending = [];
    this.clips = [];
    this.closed = null;
    this.peak = 0;
    this.extrasOf = new WeakMap();
  }

  /** The reel: the best clips of the match, best first. */
  get reel(): readonly Clip[] {
    return this.clips;
  }

  /** The most recent clip closed (by its moment's tick), in the reel or not. */
  lastClip(): Clip | null {
    return this.closed;
  }

  /** The clip made for a moment, if it was copied out and still held. */
  clipFor(m: Moment): Clip | null {
    for (const c of this.clips) if (c.moment === m) return c;
    if (this.closed && this.closed.moment === m) return this.closed;
    for (const c of this.clips) {
      const o = c.moment;
      if (o.kind === m.kind && o.tick === m.tick && o.x === m.x && o.z === m.z && o.score === m.score) return c;
    }
    return null;
  }

  /** Called with each clip as it closes (whether or not it makes the reel). */
  onClip(fn: (c: Clip) => void): void {
    this.subs.push(fn);
  }

  stats() {
    const first = this.entries[0], last = this.entries[this.entries.length - 1];
    let reelBytes = 0;
    for (const c of this.clips) reelBytes += c.bytes;
    return {
      ringBytes: this.entryBytes + this.keyBytes,
      ringSeconds: first && last ? (last.frame.tick - first.frame.tick) / TICKS_PER_SECOND : 0,
      frames: this.entries.length,
      keyframes: this.keys.length,
      keyframeBytes: this.keyBytes,
      reelBytes,
      clips: this.clips.length,
      peakRingBytes: this.peak,
      pending: this.pending.length,
    };
  }

  // ---- internals ---------------------------------------------------------------

  private clearRing() {
    this.entries = [];
    this.entryBytes = 0;
    this.keys = [];
    this.keyBytes = 0;
    this.lastKeyTick = -Infinity;
    // Clips waiting on frames of the old world cannot be filled.
    this.pending = [];
  }

  /** The newest keyframe at or before a tick, else the oldest there is. */
  private keyFor(tick: number): Keyframe | null {
    let best: Keyframe | null = null;
    for (const k of this.keys) if (k.tick <= tick) best = k;
    return best ?? this.keys[0] ?? null;
  }

  private close(p: Pending) {
    const i = this.pending.indexOf(p);
    if (i < 0) return;
    this.pending.splice(i, 1);
    const key = this.keyFor(p.from);
    if (!key) return;
    const entries = this.entries.filter((e) => e.frame.tick > key.tick && e.frame.tick <= p.to);
    let bytes = key.bytes;
    for (const e of entries) bytes += e.bytes;
    const clip: Clip = { moment: p.moment, from: p.from, to: p.to, keyframe: key, entries, bytes };
    if (!this.closed || clip.moment.tick >= this.closed.moment.tick) this.closed = clip;
    this.addToReel(clip);
    for (const fn of this.subs.slice()) fn(clip);
  }

  private addToReel(clip: Clip) {
    this.clips.push(clip);
    // Best first; of equal scores the newer moment first, so the older goes first when the reel is over.
    this.clips.sort((a, b) => b.moment.score - a.moment.score || b.moment.tick - a.moment.tick || b.moment.atMs - a.moment.atMs);
    let bytes = 0;
    for (const c of this.clips) bytes += c.bytes;
    while (this.clips.length > REEL_CLIPS || bytes > REEL_CAP) {
      const gone = this.clips.pop();
      if (!gone) break;
      bytes -= gone.bytes;
    }
  }

  /**
   * Keep the ring within 40 s and 48 MB (entries and keyframes together), dropping the oldest
   * entries first, and the keyframes older than the oldest entry. A pending clip pins its
   * keyframe and every entry after it, past both caps, until it closes: its frames are what
   * it is made of.
   */
  private trim() {
    const pin = this.pending.reduce((t, p) => Math.min(t, p.pin), Infinity);
    const span = RING_SECONDS * TICKS_PER_SECOND;
    let drop = 0;
    const n = this.entries.length;
    const newest = n ? this.entries[n - 1].frame.tick : 0;
    while (drop < n - 1) {
      const e = this.entries[drop];
      if (e.frame.tick >= pin) break;
      const over = newest - e.frame.tick > span || this.entryBytes + this.keyBytes > RING_CAP;
      if (!over) break;
      this.entryBytes -= e.bytes;
      drop++;
      this.dropStaleKeys(this.entries[drop].frame.tick, pin);
    }
    if (drop) this.entries.splice(0, drop);
    if (n) this.dropStaleKeys(this.entries[0].frame.tick, pin);
  }

  /** Drop keyframes older than the oldest entry, except the ones pending clips start from. */
  private dropStaleKeys(oldest: number, _pin: number) {
    const pins = new Set(this.pending.map((p) => p.pin));
    if (this.keys.every((k) => k.tick >= oldest || pins.has(k.tick))) return;
    const kept: Keyframe[] = [];
    this.keyBytes = 0;
    for (const k of this.keys) {
      if (k.tick < oldest && !pins.has(k.tick)) continue;
      kept.push(k);
      this.keyBytes += k.bytes;
    }
    this.keys = kept;
  }
}
