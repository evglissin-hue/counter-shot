// Flight physics added on top of Rapier's gravity: quadratic air drag against
// the wind and Magnus lift for spinning shot. Shared by the sim (applied each
// tick as a velocity change) and the aim preview (integrated the same way).

import { AIR_DENSITY, AIR_SCALE, type ProjectileDef } from "@keepfall/content";
import { dsqrt } from "@keepfall/core";
import { G } from "./ballistics";
export const DT = 1 / 60;

export interface FlightCoef {
  /** Drag: acceleration = -drag * |v - w| * (v - w). */
  drag: number;
  /** Magnus: acceleration = magnus * (spin x v). */
  magnus: number;
  /** Gravity multiplier. */
  gravity: number;
}

export function flightCoef(p: ProjectileDef): FlightCoef {
  // Sphere: area pi r^2, mass 4/3 pi r^3 rho, so drag/m = 3 rho_air cd / (8 r rho).
  const drag = (AIR_SCALE * 3 * AIR_DENSITY * p.cd) / (8 * p.radius * p.density);
  // Magnus lift ~ rho_air pi r^3 (w x v) / m = 3 rho_air / (4 rho).
  const magnus = (AIR_SCALE * 3 * AIR_DENSITY) / (4 * p.density) * 0.5;
  return { drag, magnus, gravity: p.gravity };
}

/** Velocity change for one tick from drag and spin (not gravity). Writes into out. */
export function flightDv(
  v: [number, number, number],
  spin: [number, number, number] | null,
  windX: number,
  windZ: number,
  c: FlightCoef,
  out: [number, number, number],
) {
  const rx = v[0] - windX, ry = v[1], rz = v[2] - windZ;
  const s = dsqrt(rx * rx + ry * ry + rz * rz);
  let ax = -c.drag * s * rx, ay = -c.drag * s * ry, az = -c.drag * s * rz;
  if (spin) {
    ax += c.magnus * (spin[1] * v[2] - spin[2] * v[1]);
    ay += c.magnus * (spin[2] * v[0] - spin[0] * v[2]);
    az += c.magnus * (spin[0] * v[1] - spin[1] * v[0]);
  }
  out[0] = ax * DT;
  out[1] = ay * DT;
  out[2] = az * DT;
}

/**
 * Predicted path as xyz triples, integrated like the sim (drag and spin, then
 * gravity, then position), stopping at the ground (y = 0) or after `seconds`.
 */
export function predictPath(
  p0: [number, number, number],
  v0: [number, number, number],
  spin: [number, number, number] | null,
  windX: number,
  windZ: number,
  c: FlightCoef,
  seconds: number,
  every = 2,
): Float32Array {
  const steps = Math.ceil(seconds * 60);
  const out: number[] = [p0[0], p0[1], p0[2]];
  const p: [number, number, number] = [p0[0], p0[1], p0[2]];
  const v: [number, number, number] = [v0[0], v0[1], v0[2]];
  const dv: [number, number, number] = [0, 0, 0];
  for (let i = 1; i <= steps; i++) {
    flightDv(v, spin, windX, windZ, c, dv);
    v[0] += dv[0];
    v[1] += dv[1] - G * c.gravity * DT;
    v[2] += dv[2];
    p[0] += v[0] * DT;
    p[1] += v[1] * DT;
    p[2] += v[2] * DT;
    if (i % every === 0 || i === steps || p[1] <= 0) out.push(p[0], p[1], p[2]);
    if (p[1] <= 0) break;
  }
  return new Float32Array(out);
}
