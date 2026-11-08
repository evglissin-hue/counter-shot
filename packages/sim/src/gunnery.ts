// Gunnery: the aim that puts a shot on a point, for weapons nobody is manning
// (and the AI player later). It flies the shot like the aim help does (drag
// in still air, the weapon's own gravity) and solves the elevation, or for a
// weapon with a charge (the mortar) the charge at a fixed elevation, by
// bisection. It ignores the wind: part of why an unmanned gun is less
// accurate than a gunner. Deterministic arithmetic only.

import { weaponOf, type Emplacement, type WeaponDef } from "@keepfall/content";
import { DPI, dsqrt } from "@keepfall/core";
import { aimDir, muzzle } from "./aim";
import { G } from "./ballistics";
import { DT, flightCoef, flightDv } from "./flight";
import { yawOf } from "./minions";

export interface AimSolution {
  yaw: number;
  pitch: number;
  /** 0..1 between the weapon's lowest and highest muzzle speed. */
  charge: number;
  /** Seconds the shot flies to the target. */
  time: number;
}

const TWO_PI = 2 * DPI;
/** Elevations a weapon with a charge lobs at: the first that can reach. */
const LOB_PITCHES = [1.05, 1.3];
/** The lowest elevation of the long lob: about the longest reach at full charge with the shell's drag (the mortar's is near 0.83). */
const LONG_LOB = 0.83;
const ITERATIONS = 22;
/** Longest flight considered (s). */
const MAX_FLIGHT = 9;

/**
 * Yaw towards a point from an emplacement, expressed near its base yaw (so
 * turn limits apply as they are), or null if the point is outside its arc.
 */
export function yawTowards(e: Emplacement, x: number, z: number): number | null {
  const dx = x - e.x, dz = z - e.z;
  const d2 = dx * dx + dz * dz;
  if (d2 < 1e-6) return null;
  const inv = 1 / dsqrt(d2);
  let yaw = yawOf(dx * inv, dz * inv);
  while (yaw - e.baseYaw > DPI) yaw -= TWO_PI;
  while (yaw - e.baseYaw < -DPI) yaw += TWO_PI;
  return yaw < e.baseYaw - e.yawLimit || yaw > e.baseYaw + e.yawLimit ? null : yaw;
}

/** Aim that lands a shot from `e` on (x, y, z) in still air, or null if it cannot (out of reach, too close below, outside its arc). */
export function solveAim(e: Emplacement, x: number, y: number, z: number): AimSolution | null {
  // The gun as it is armed: an upgrade that changes its speed changes its aim.
  const w = weaponOf(e);
  const yaw = yawTowards(e, x, z);
  if (yaw === null) return null;
  const dx = x - e.x, dz = z - e.z;
  const dist = dsqrt(dx * dx + dz * dz);
  const out = { y: 0, t: 0 };
  if (w.minSpeed >= w.speed) {
    // A fixed charge: find the elevation.
    let lo = w.minPitch, hi = w.maxPitch;
    if (!flyTo(e, w, yaw, lo, w.speed, dist, out) || out.y > y) return null; // passes over it even at the lowest elevation
    if (!flyTo(e, w, yaw, hi, w.speed, dist, out) || out.y < y) return null; // falls short even at the highest
    for (let k = 0; k < ITERATIONS; k++) {
      const mid = (lo + hi) / 2;
      if (flyTo(e, w, yaw, mid, w.speed, dist, out) && out.y >= y) hi = mid;
      else lo = mid;
    }
    const pitch = (lo + hi) / 2;
    flyTo(e, w, yaw, pitch, w.speed, dist, out);
    return { yaw, pitch, charge: 1, time: out.t };
  }
  // A charge: lob at a fixed elevation and find the charge.
  const speedOf = (c: number) => w.minSpeed + (w.speed - w.minSpeed) * c;
  let beyond = false;
  for (const pitch of LOB_PITCHES) {
    if (pitch < w.minPitch || pitch > w.maxPitch) continue;
    if (flyTo(e, w, yaw, pitch, speedOf(0), dist, out) && out.y > y) continue; // too close for this elevation
    if (!flyTo(e, w, yaw, pitch, speedOf(1), dist, out) || out.y < y) {
      beyond = pitch === LOB_PITCHES[0]; // out of reach even at the lower lob: try the long lob
      break;
    }
    let lo = 0, hi = 1;
    for (let k = 0; k < ITERATIONS; k++) {
      const mid = (lo + hi) / 2;
      if (flyTo(e, w, yaw, pitch, speedOf(mid), dist, out) && out.y >= y) hi = mid;
      else lo = mid;
    }
    const charge = (lo + hi) / 2;
    flyTo(e, w, yaw, pitch, speedOf(charge), dist, out);
    return { yaw, pitch, charge, time: out.t };
  }
  // M5: the long lob, for targets beyond the fixed elevations' reach (the enemy keep from your mortar pit):
  // full charge, and the elevation between the longest reach and the first lob, still coming down steeply.
  if (!beyond) return null;
  const pLo = LONG_LOB < w.minPitch ? w.minPitch : LONG_LOB, pHi = LOB_PITCHES[0];
  if (!flyTo(e, w, yaw, pLo, w.speed, dist, out) || out.y < y) return null; // out of reach even at the longest
  let lo = pLo, hi = pHi;
  for (let k = 0; k < ITERATIONS; k++) {
    const mid = (lo + hi) / 2;
    if (flyTo(e, w, yaw, mid, w.speed, dist, out) && out.y >= y) lo = mid;
    else hi = mid;
  }
  const pitch = (lo + hi) / 2;
  if (!flyTo(e, w, yaw, pitch, w.speed, dist, out)) return null;
  return { yaw, pitch, charge: 1, time: out.t };
}

/**
 * Fly a shot until it has gone `dist` metres along the ground from the
 * emplacement's pivot: its height and time there into `out`. False if it
 * comes down far below first (or flies too long).
 */
function flyTo(e: Emplacement, w: WeaponDef, yaw: number, pitch: number, speed: number, dist: number, out: { y: number; t: number }): boolean {
  const c = flightCoef(w.projectile);
  const [mx, my, mz] = muzzle(e, yaw, pitch);
  const [ux, uy, uz] = aimDir(yaw, pitch);
  const v: [number, number, number] = [ux * speed, uy * speed, uz * speed];
  const dv: [number, number, number] = [0, 0, 0];
  let px = mx, py = my, pz = mz;
  let along = horiz(px - e.x, pz - e.z);
  if (along >= dist) {
    out.y = py;
    out.t = 0;
    return true;
  }
  const steps = MAX_FLIGHT * 60;
  for (let i = 1; i <= steps; i++) {
    flightDv(v, null, 0, 0, c, dv);
    v[0] += dv[0];
    v[1] += dv[1] - G * c.gravity * DT;
    v[2] += dv[2];
    const qx = px + v[0] * DT, qy = py + v[1] * DT, qz = pz + v[2] * DT;
    const next = horiz(qx - e.x, qz - e.z);
    if (next >= dist) {
      const f = next > along ? (dist - along) / (next - along) : 0;
      out.y = py + (qy - py) * f;
      out.t = (i - 1 + f) * DT;
      return true;
    }
    px = qx;
    py = qy;
    pz = qz;
    along = next;
    if (py < -60) return false;
  }
  return false;
}

function horiz(dx: number, dz: number): number {
  return dsqrt(dx * dx + dz * dz);
}
