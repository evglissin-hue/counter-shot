// Keyframes (track S, step S3): a picture of the renderer's world that can be
// put back. A frame from the worker holds only what moved; a stone at rest, a
// body that has stopped, the ground's craters and a gun's state are sent once
// and then remembered by the renderer's modules. A stretch of recorded frames
// can only be drawn again from a keyframe taken at its start.
//
// Each module that remembers something registers a KeyframePart with the
// renderer. `capture(now)` and `apply(state, now)` are a pair: after
// `apply(k)`, `capture()` gives `k` again (the acceptance test). Times are
// kept as ages (now minus start) so a keyframe can be put back at any later
// render clock; apply rebases them to the clock it finds.
//
// No DOM here: the recorder imports these types only.

import type { FrameData } from "@keepfall/sim";

/** One module's share of a keyframe. Times are kept as ages (now minus start) and rebased on apply. */
export interface KeyframePart<S = unknown> {
  capture(now: number): S;
  apply(state: S, now: number): void;
  /** Bytes the state holds (for the recorder's caps); typed arrays' byteLength plus a rough count for the rest. */
  bytes(state: S): number;
}

export interface RenderKeyframe {
  /** The tick of the last frame applied when it was taken. */
  tick: number;
  /** Part name to its state, in registration order. */
  parts: Map<string, unknown>;
  /** The last frame applied before it was taken (re-applied without events after the parts, so the every-frame lists are in place). */
  last: FrameData | null;
  bytes: number;
}

/** Bytes of every typed array a frame holds (terrain patches included). */
export function frameBytes(f: FrameData): number {
  let n = 0;
  for (const v of Object.values(f)) {
    if (ArrayBuffer.isView(v)) n += v.byteLength;
  }
  for (const p of f.terrain ?? []) n += p.h.byteLength + 32;
  return n;
}

/** A rough size of plain state: typed arrays by byteLength, numbers 8, strings 2 a character, containers a little extra. */
export function roughBytes(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number" || typeof v === "boolean") return 8;
  if (typeof v === "string") return v.length * 2 + 8;
  if (ArrayBuffer.isView(v)) return v.byteLength + 16;
  if (Array.isArray(v)) {
    let n = 16;
    for (const x of v) n += roughBytes(x);
    return n;
  }
  if (v instanceof Map) {
    let n = 32;
    for (const [k, x] of v) n += roughBytes(k) + roughBytes(x) + 16;
    return n;
  }
  if (typeof v === "object") {
    let n = 16;
    for (const x of Object.values(v as Record<string, unknown>)) n += 8 + roughBytes(x);
    return n;
  }
  return 0;
}

/** Ages are stored through Float32 buffers in places, so plain numbers and Float64Arrays are compared to this (seconds); Float32 and integer arrays exactly. */
export const AGE_TOLERANCE = 2e-3;

function numbersClose(a: number, b: number): boolean {
  if (a === b) return true;
  if (a !== a && b !== b) return true;
  return Math.abs(a - b) <= AGE_TOLERANCE;
}

/** Are two part states the same (see AGE_TOLERANCE for what "the same" allows)? */
export function sameState(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return numbersClose(a, b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor || a.byteLength !== b.byteLength) return false;
    const x = a as unknown as ArrayLike<number>, y = b as unknown as ArrayLike<number>;
    const loose = a instanceof Float64Array;
    for (let i = 0; i < x.length; i++) {
      if (x[i] === y[i]) continue;
      if (x[i] !== x[i] && y[i] !== y[i]) continue;
      if (loose && numbersClose(x[i], y[i])) continue;
      return false;
    }
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameState(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !sameState(v, b.get(k))) return false;
    return true;
  }
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!sameState((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/** The names of the parts whose states differ between two keyframes (a part in only one counts as different). */
export function keyframeDiff(a: RenderKeyframe, b: RenderKeyframe): string[] {
  const out: string[] = [];
  for (const [name, s] of a.parts) if (!b.parts.has(name) || !sameState(s, b.parts.get(name))) out.push(name);
  for (const name of b.parts.keys()) if (!a.parts.has(name)) out.push(name);
  return out;
}

/**
 * A chance drawn from an event's own tick and place (0 up to but not including 1),
 * so what the renderer makes up (a decal's turn, which way a spray lands) is the
 * same each time the event is drawn, whatever drew before it.
 */
export function eventChance(tick: number, x: number, y: number, z: number): number {
  let h = Math.imul(tick | 0, 0x9e3779b1) ^ 0x85ebca6b;
  for (const v of [x, y, z]) {
    h = Math.imul(h ^ Math.round(v * 64), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}
