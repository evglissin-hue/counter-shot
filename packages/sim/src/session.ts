// The scripted sandbox session: every weapon fires (the mortar with a fuse and
// on impact, the long gun with spin) into the target castle and the patrol.
// Node tests pin its hash; the browser hash page replays it so devices and
// browsers can be compared with Node bit for bit.

import { buildLayout, GAME_LAYOUT } from "@keepfall/content";
import type { Rapier } from "./castleSim";
import { EVENT_STRIDE } from "./frame";
import { SandboxSim, Spin, type SandboxInput } from "./sandbox";

export const SESSION_TICKS = 1100;

/** Pinned: change only on purpose, and bump RULES_VERSION when gameplay changes. */
export const SESSION_HASH = { state: "54bd3d5b", world: "d2235629" } as const;

export const SESSION_SCRIPT: Array<[number, SandboxInput]> = [
  [5, { kind: "fire", emplacement: 0, yaw: 0, pitch: 0.035, charge: 1, fuse: 0, spin: Spin.None }],
  [30, { kind: "fire", emplacement: 1, yaw: 0.02, pitch: 1.2, charge: 1, fuse: 260, spin: Spin.None }],
  [60, { kind: "fire", emplacement: 2, yaw: -0.08, pitch: 0.0, charge: 1, fuse: 0, spin: Spin.None }],
  [90, { kind: "fire", emplacement: 3, yaw: 0.0, pitch: -0.02, charge: 1, fuse: 0, spin: Spin.None }],
  [260, { kind: "fire", emplacement: 0, yaw: 0.05, pitch: 0.03, charge: 1, fuse: 0, spin: Spin.Left }],
  [760, { kind: "fire", emplacement: 1, yaw: 0.0, pitch: 1.17, charge: 1, fuse: 0, spin: Spin.None }],
  [500, { kind: "fire", emplacement: 0, yaw: -0.04, pitch: -0.035, charge: 1, fuse: 0, spin: Spin.Top }],
  [560, { kind: "fire", emplacement: 2, yaw: 0.1, pitch: 0.01, charge: 1, fuse: 0, spin: Spin.None }],
];

export interface SessionResult {
  hash: { state: string; world: string };
  /** Event kinds in order, sampled every 8 ticks. */
  events: number[];
  down: number;
  standing: number;
}

/** Replays the scripted session. `onTick` may observe the sim (timing, progress). */
export function runSession(R: Rapier, ticks = SESSION_TICKS, onTick?: (sim: SandboxSim, tick: number) => void): SessionResult {
  const sim = new SandboxSim(R, buildLayout(1, GAME_LAYOUT), { seed: 7, minions: 12 });
  for (const [t, input] of SESSION_SCRIPT) sim.queue(t, input);
  const events: number[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    onTick?.(sim, i);
    if ((i & 7) === 0 || i === ticks - 1) {
      const f = sim.collect();
      for (let k = 0; k < f.eventCount; k++) events.push(f.events[k * EVENT_STRIDE]);
    }
  }
  const hash = sim.hash();
  const c = sim.minionCounts();
  sim.free();
  return { hash, events, down: c.down, standing: c.standing };
}
