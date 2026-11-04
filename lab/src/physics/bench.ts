// Physics benchmarks. Both run the same fixed script on every device, so the
// timings compare devices and the hashes compare determinism.

import type { CastleLayout } from "@keepfall/content";
import { fireScripted, SIEGE_SHOTS, SIEGE_STEPS } from "@keepfall/sim";
import { dsqrt, quatY, Rng } from "@keepfall/core";
import { CastleSim, type Rapier } from "@keepfall/sim";

export interface StepStats {
  avg: number;
  p95: number;
  max: number;
}

export interface SiegeResult {
  build: string;
  steps: number;
  setupMs: number;
  totalMs: number;
  stats: StepStats;
  peakAwake: number;
  loosened: number;
  toppled: boolean;
  hash: { state: string; snapshot: string };
}

export interface RubbleRow {
  bodies: number;
  avg: number;
  p95: number;
}

export interface RubbleResult {
  build: string;
  rows: RubbleRow[];
  /** Most moving bodies that fit in 6 ms per step (comfortable at 60 Hz next to rendering). */
  comfortable: number;
  /** Most moving bodies that fit in 12 ms per step (the edge of 60 Hz). */
  limit: number;
}

type Progress = (label: string, fraction: number) => void;

function stats(times: number[]): StepStats {
  if (!times.length) return { avg: 0, p95: 0, max: 0 };
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((s, t) => s + t, 0) / times.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { avg: round2(avg), p95: round2(p95), max: round2(sorted[sorted.length - 1]) };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export { fireScripted, SIEGE_SHOTS, SIEGE_STEPS };

export function runSiege(R: Rapier, build: string, layout: CastleLayout, progress: Progress): SiegeResult {
  const t0 = performance.now();
  const sim = new CastleSim(R, layout);
  sim.world.step(); // the first step builds the broad phase for every piece: a loading cost, not a frame cost
  const setupMs = performance.now() - t0;
  const times: number[] = [];
  let peakAwake = 0;
  for (let i = 0; i < SIEGE_STEPS; i++) {
    fireScripted(sim, i);
    const s0 = performance.now();
    sim.step();
    times.push(performance.now() - s0);
    if ((i & 15) === 0) {
      peakAwake = Math.max(peakAwake, sim.awakeCount());
      progress(`Siege (${build})`, i / SIEGE_STEPS);
    }
  }
  const result: SiegeResult = {
    build,
    steps: SIEGE_STEPS,
    setupMs: round2(setupMs),
    totalMs: round2(performance.now() - t0),
    stats: stats(times),
    peakAwake,
    loosened: sim.dynList.length,
    toppled: sim.toppled[0],
    hash: sim.hash(),
  };
  sim.free();
  return result;
}

/** N loose stones dropped in a jittered grid: raw cost of moving, colliding bodies. */
function rubbleStep(R: Rapier, bodies: number, seed: number): number[] {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const ground = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
  world.createCollider(R.ColliderDesc.cuboid(200, 1, 200).setFriction(0.8), ground);
  const rng = new Rng(seed).fork("rubble");
  const layers = 6;
  const perLayer = Math.ceil(bodies / layers);
  const side = Math.ceil(dsqrt(perLayer));
  let made = 0;
  for (let l = 0; l < layers && made < bodies; l++) {
    for (let i = 0; i < side && made < bodies; i++) {
      for (let j = 0; j < side && made < bodies; j++) {
        const x = (i - side / 2) * 1.0 + rng.range(-0.2, 0.2);
        const z = (j - side / 2) * 1.0 + rng.range(-0.2, 0.2);
        const y = 0.6 + l * 0.75 + rng.range(0, 0.2);
        const q = quatY(rng.range(0, 3.1));
        const b = world.createRigidBody(
          R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }),
        );
        world.createCollider(R.ColliderDesc.cuboid(0.45, 0.22, 0.35).setDensity(2300).setFriction(0.75), b);
        made++;
      }
    }
  }
  const times: number[] = [];
  for (let s = 0; s < 200; s++) {
    const t0 = performance.now();
    world.step();
    if (s >= 20) times.push(performance.now() - t0);
  }
  world.free();
  return times;
}

export function runRubble(R: Rapier, build: string, progress: Progress, maxBodies = 8000): RubbleResult {
  const rows: RubbleRow[] = [];
  const ladder = [250, 500, 1000, 2000, 4000, 8000].filter((n) => n <= maxBodies);
  for (let k = 0; k < ladder.length; k++) {
    progress(`Moving stones (${build}): ${ladder[k]}`, k / ladder.length);
    const st = stats(rubbleStep(R, ladder[k], 7));
    rows.push({ bodies: ladder[k], avg: st.avg, p95: st.p95 });
    if (st.avg > 16) break; // the next size would only take longer
  }
  return { build, rows, comfortable: budget(rows, 6), limit: budget(rows, 12) };
}

/** Interpolate how many bodies fit in `ms` per step. */
function budget(rows: RubbleRow[], ms: number): number {
  if (!rows.length) return 0;
  if (rows[0].avg > ms) return Math.round((rows[0].bodies * ms) / Math.max(rows[0].avg, 0.01));
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].avg > ms) {
      const a = rows[i - 1], b = rows[i];
      const t = (ms - a.avg) / Math.max(b.avg - a.avg, 0.001);
      return Math.round(a.bodies + t * (b.bodies - a.bodies));
    }
  }
  const last = rows[rows.length - 1];
  return Math.round((last.bodies * ms) / Math.max(last.avg, 0.01)); // extrapolated, roughly linear
}
