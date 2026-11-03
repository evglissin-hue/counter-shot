// Diagnostics for the scripted siege: damage over time and slow steps.
// Usage: node <bundle> [span] [breakForce] [blastPerSpeed]
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout } from "../src/core/castle";
import { fireScripted, SIEGE_STEPS } from "../src/physics/bench";
import { CastleSim, DEFAULT_SIM, type Rapier } from "../src/physics/sim";

await RD.init();
const layout = buildLayout(1);
const span = Number(process.argv[2] ?? DEFAULT_SIM.span);
const force = Number(process.argv[3] ?? DEFAULT_SIM.breakForce);
const blast = Number(process.argv[4] ?? DEFAULT_SIM.blastPerSpeed);
const sim = new CastleSim(RD as unknown as Rapier, layout, { ...DEFAULT_SIM, span, breakForce: force, blastPerSpeed: blast });
sim.world.step();
let prevLoose = sim.dynList.length;
const slow: string[] = [];
for (let i = 0; i < SIEGE_STEPS; i++) {
  fireScripted(sim, i);
  const before = sim.dynList.length;
  const t0 = performance.now();
  sim.step();
  const ms = performance.now() - t0;
  const loosenedNow = sim.dynList.length - before;
  if (ms > 20) slow.push(`step ${i}: ${ms.toFixed(1)} ms, loosened ${loosenedNow}, awake ${sim.awakeCount()}`);
  if (i % 45 === 44 || i === SIEGE_STEPS - 1) {
    console.log(`t=${((i + 1) / 60).toFixed(2)}s loose total ${sim.dynList.length} (+${sim.dynList.length - prevLoose}) awake ${sim.awakeCount()} toppled ${sim.toppled[0]}`);
    prevLoose = sim.dynList.length;
  }
}
console.log("slow steps:\n" + slow.join("\n"));
const parts: Record<string, number> = {};
for (const id of sim.dynList) parts[layout.stones[id].part] = (parts[layout.stones[id].part] || 0) + 1;
console.log("loosened by part", parts);
