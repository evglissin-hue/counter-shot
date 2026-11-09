// The chain shot's chain (after M5). A chain shot is two iron balls on a
// chain, and until now only the balls touched anything, so it played like a
// weak long gun. Now the chain between them sweeps too. It whirls about the
// vertical many times a second, so it is taken as the disc it whirls through
// (as wide as the chain), carried along the shot's path: every step, every
// man standing where that disc passes through his body (it must come in low:
// knee to shoulder) is knocked down, planted ladders it passes are knocked
// off the walls (ladders.ts), and the crews of guns it passes are swept away
// (mounts.ts). Each man it takes slows it a little, so a good shot scythes
// through a rank or two and drops.
//
// Deterministic: men in id order, plain arithmetic, dsqrt.

import { dsqrt } from "@keepfall/core";
import { MINION_HEIGHT } from "./frame";
import { Cause, MinionState, type Minions } from "./minions";

export const SWEEP = {
  /** The chain sweeps only while it flies at least this fast (m/s): not once it rolls along the ground. */
  minSpeed: 20,
  /** A man is swept when the chain's whirl passes this close to his body's axis (m, beyond the whirl's radius). */
  reach: 0.3,
  /** Of a man's height, the part the chain can take him by: from the knees to the shoulders. */
  low: 0.35,
  high: 1.55,
  /** Share of the chain's velocity a man is thrown with, plus a lift (m/s). */
  share: 0.3,
  lift: 2,
  /** What the chain keeps of its speed for each man it takes. */
  keep: 0.9,
  /** Sub-steps between where the chain was and where it is (it covers about 1.3 m a step). */
  steps: 4,
} as const;

/** The chain's two ends before and after a step: a0, b0 where they were, a1, b1 where they are. */
export interface ChainMove {
  a0: [number, number, number];
  b0: [number, number, number];
  a1: [number, number, number];
  b1: [number, number, number];
}

/** The middle of the chain at sub-step k of SWEEP.steps (0: where it was, SWEEP.steps: where it is). */
export function chainMid(mv: ChainMove, k: number): [number, number, number] {
  const s = k / SWEEP.steps, { a0, b0, a1, b1 } = mv;
  return [
    (a0[0] + b0[0]) / 2 + ((a1[0] + b1[0]) / 2 - (a0[0] + b0[0]) / 2) * s,
    (a0[1] + b0[1]) / 2 + ((a1[1] + b1[1]) / 2 - (a0[1] + b0[1]) / 2) * s,
    (a0[2] + b0[2]) / 2 + ((a1[2] + b1[2]) / 2 - (a0[2] + b0[2]) / 2) * s,
  ];
}

/**
 * Men standing in the whirl's way this step (the men it sweeps), in id
 * order, each with where along the sweep it took him. `half` is the whirl's
 * radius (half the chain); `skip` holds men this shot has already swept.
 */
export function sweptMen(minions: Minions, mv: ChainMove, half: number, skip: Set<number>): Array<{ id: number; x: number; y: number; z: number }> {
  const out: Array<{ id: number; x: number; y: number; z: number }> = [];
  const c0 = chainMid(mv, 0), c1 = chainMid(mv, SWEEP.steps);
  const mx = (c0[0] + c1[0]) / 2, my = (c0[1] + c1[1]) / 2, mz = (c0[2] + c1[2]) / 2;
  const dx = c1[0] - c0[0], dy = c1[1] - c0[1], dz = c1[2] - c0[2];
  const R = half + SWEEP.reach, R2 = R * R;
  // Candidates: anyone near the middle of this step's sweep (near() measures to the middle of a man).
  const near = minions.near(mx, my, mz, dsqrt(dx * dx + dy * dy + dz * dz) / 2 + R + MINION_HEIGHT / 2 + 0.5);
  for (const n of near) {
    const m = minions.list[n.id];
    if (!m || m.state !== MinionState.Upright || skip.has(m.id)) continue;
    const feet = n.cy - MINION_HEIGHT / 2;
    const lo = feet + SWEEP.low, hi = feet + SWEEP.high;
    for (let k = 0; k <= SWEEP.steps; k++) {
      const c = chainMid(mv, k);
      if (c[1] < lo || c[1] > hi) continue;
      const hx = c[0] - n.cx, hz = c[2] - n.cz;
      if (hx * hx + hz * hz > R2) continue;
      out.push({ id: m.id, x: n.cx, y: c[1], z: n.cz });
      break;
    }
  }
  return out;
}

/** The Cause a chain sweeps a man down with (it counts as its shot's ball: bounties, multi-kills). */
export const SWEEP_CAUSE = Cause.Ball;
