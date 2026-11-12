// The camera's jolt when the gun you ride fires (look round L1): a short kick back and up and a punch of the field
// of view, by the gun's weight. Pure numbers, no three; the renderer lays it over the picture only (never over the
// aim, the aim arc or anything the page computes).

import type { WeaponKind } from "@keepfall/content";

export interface JoltWeight {
  /** Metres the camera goes back along its view. */
  back: number;
  /** Metres it goes up. */
  up: number;
  /** Degrees the view tips up. */
  pitch: number;
  /** Degrees added to the field of view. */
  fov: number;
}

/** The camera's jolt by the gun fired (the numbers to tune). */
export const JOLT: Record<WeaponKind, JoltWeight> = {
  longGun: { back: 0.3, up: 0.1, pitch: 0.9, fov: 2.5 },
  chainShot: { back: 0.35, up: 0.12, pitch: 1.1, fov: 3 },
  swivel: { back: 0.12, up: 0.04, pitch: 0.5, fov: 1 },
  // The mortar has no sight: its spotter (a free camera) takes only a small punch and tip, and never moves back.
  mortar: { back: 0, up: 0, pitch: 0.3, fov: 1.5 },
};

/** Envelope timing (s): rises in RISE, decays with time constant TAU, exactly zero from END on. */
export const JOLT_RISE = 0.035;
export const JOLT_TAU = 0.11;
export const JOLT_END = 0.45;
/** No jolt may tip the view more than this (degrees). */
export const JOLT_PITCH_MAX = 1.5;

const TAIL = Math.exp(-(JOLT_END - JOLT_RISE) / JOLT_TAU);

/** 0 before the shot, 1 at the peak, back to exactly 0 at JOLT_END (continuous there). */
export function joltEnvelope(age: number): number {
  if (!(age > 0) || age >= JOLT_END) return 0;
  if (age < JOLT_RISE) {
    const u = age / JOLT_RISE;
    return u * u * (3 - 2 * u);
  }
  return (Math.exp(-(age - JOLT_RISE) / JOLT_TAU) - TAIL) / (1 - TAIL);
}

export interface Jolt {
  back: number;
  up: number;
  /** Radians. */
  pitch: number;
  /** Degrees. */
  fov: number;
}

/**
 * The jolt `age` seconds after the shot of a gun of `kind`, seen from a camera in mode `sight` (every gun but the
 * mortar) or `free` (the mortar's spotter). Zero for any other pairing.
 */
export function joltAt(kind: WeaponKind, mode: "sight" | "free", age: number, out: Jolt = { back: 0, up: 0, pitch: 0, fov: 0 }): Jolt {
  const fits = kind === "mortar" ? mode === "free" : mode === "sight";
  const e = fits ? joltEnvelope(age) : 0;
  const w = JOLT[kind];
  out.back = w.back * e;
  out.up = w.up * e;
  out.pitch = Math.min(JOLT_PITCH_MAX, w.pitch) * e * (Math.PI / 180);
  out.fov = w.fov * e;
  return out;
}
