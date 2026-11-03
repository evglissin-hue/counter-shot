// Siege cost under different settings: average and worst step, loosened, peak moving.
// Usage: node <bundle> breakForce shatter push
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout } from "../src/core/castle";
import { fireScripted, SIEGE_STEPS } from "../src/physics/bench";
import { CastleSim, DEFAULT_SIM, type Rapier } from "../src/physics/sim";

await RD.init();
const layout = buildLayout(1);
const opts = { ...DEFAULT_SIM, breakForce: Number(process.argv[2] ?? DEFAULT_SIM.breakForce), shatter: Number(process.argv[3] ?? DEFAULT_SIM.shatter), push: Number(process.argv[4] ?? DEFAULT_SIM.push) };
const sim = new CastleSim(RD as unknown as Rapier, layout, opts);
sim.world.step();
const times: number[] = [];
let peak = 0, shattered = 0;
for (let i = 0; i < SIEGE_STEPS; i++) {
  fireScripted(sim, i);
  const t0 = performance.now();
  sim.step();
  times.push(performance.now() - t0);
  if (i % 10 === 0) peak = Math.max(peak, sim.awakeCount());
}
for (let i = 0; i < sim.shattered.length; i++) shattered += sim.shattered[i];
times.sort((a, b) => a - b);
const avg = times.reduce((s, t) => s + t, 0) / times.length;
console.log(JSON.stringify({ ...opts, avg: avg.toFixed(2), p95: times[Math.floor(times.length * 0.95)].toFixed(1), loosened: sim.dynList.length, shattered, peakMoving: peak }));
