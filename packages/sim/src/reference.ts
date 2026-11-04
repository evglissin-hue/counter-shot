// The reference siege: a fixed barrage every device replays. Its hash is what
// the lab compares devices against, and what the tests pin, so any change to
// the masonry physics shows up here.

import type { CastleLayout } from "@keepfall/content";
import { aim, SIEGE_SHOTS, SIEGE_STEPS } from "./ballistics";
import { CastleSim, type Rapier } from "./castleSim";

/** The hash every deterministic build must reproduce (lab-2 onwards). */
export const REFERENCE_SIEGE_HASH = { state: "35a7603f", snapshot: "054e5eb0" } as const;

export function fireScripted(sim: CastleSim, step: number) {
  const c = sim.layout.cannon;
  for (const shot of SIEGE_SHOTS) {
    if (shot.step !== step) continue;
    const [vx, vy, vz] = aim(c.x, c.y, c.z, shot.target[0], shot.target[1], shot.target[2], shot.time);
    sim.fire(c.x, c.y, c.z, vx, vy, vz);
  }
}

/** Runs the reference siege without timing and returns its hash. */
export function referenceSiegeHash(R: Rapier, layout: CastleLayout): { state: string; snapshot: string } {
  const sim = new CastleSim(R, layout);
  sim.world.step();
  for (let i = 0; i < SIEGE_STEPS; i++) {
    fireScripted(sim, i);
    sim.step();
  }
  const h = sim.hash();
  sim.free();
  return h;
}
