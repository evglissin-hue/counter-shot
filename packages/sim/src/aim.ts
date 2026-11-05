// Turn-rate-limited aiming. Pure and deterministic: the page runs it every
// tick for instant feel, and the sim checks every fire against the same limits.

import type { Emplacement, WeaponDef } from "@keepfall/content";
import { dcos, dsin } from "@keepfall/core";

export interface AimState {
  yaw: number;
  pitch: number;
}

export interface AimInput {
  /** Wanted change this tick, before limits (radians). Mouse gives deltas; keys and sticks give rate * dt. */
  dYaw: number;
  dPitch: number;
  fine: boolean;
}

export function restAim(e: Emplacement, w: WeaponDef): AimState {
  return { yaw: e.baseYaw, pitch: clamp(w.restPitch, w.minPitch, w.maxPitch) };
}

/** One tick (1/60 s) of turning: each axis moves at most its rate. */
export function stepAim(a: AimState, input: AimInput, e: Emplacement, w: WeaponDef): AimState {
  const k = input.fine ? w.fine : 1;
  const maxY = (w.yawRate * k) / 60;
  const maxP = (w.pitchRate * k) / 60;
  const dy = clamp(input.dYaw, -maxY, maxY);
  const dp = clamp(input.dPitch, -maxP, maxP);
  return clampAim({ yaw: a.yaw + dy, pitch: a.pitch + dp }, e, w);
}

export function clampAim(a: AimState, e: Emplacement, w: WeaponDef): AimState {
  return {
    yaw: clamp(a.yaw, e.baseYaw - e.yawLimit, e.baseYaw + e.yawLimit),
    pitch: clamp(a.pitch, w.minPitch, w.maxPitch),
  };
}

/** Unit barrel direction for an aim. */
export function aimDir(yaw: number, pitch: number): [number, number, number] {
  const cp = dcos(pitch);
  return [dsin(yaw) * cp, dsin(pitch), dcos(yaw) * cp];
}

/** Muzzle point: pivot plus the barrel. */
export function muzzle(e: Emplacement, yaw: number, pitch: number): [number, number, number] {
  const [dx, dy, dz] = aimDir(yaw, pitch);
  return [e.x + dx * e.barrel, e.y + dy * e.barrel, e.z + dz * e.barrel];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
