// Step-by-step cost of the ticks after a mortar burst: where does the spike sit?
// npx rolldown packages/sim/scripts/burst-steps.ts --format esm --platform node -o node_modules/.scratch/burst-steps.mjs && node node_modules/.scratch/burst-steps.mjs
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout } from "@keepfall/content";
import { SandboxSim, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, { mirrorWedges: true });
const cases: Array<[string, number, number, number]> = [
  ["keep top, south face", 0, 19.3, -0.6],
  ["front wall top", 6, 7.6, -15.2],
  ["tower top", 15, 11.6, -15],
  ["courtyard by the keep", 1, 0.3, -2.3],
];
for (const [name, x, y, z] of cases) {
  const sim = new SandboxSim(R, layout, { seed: 1, minions: 12 });
  for (let i = 0; i < 30; i++) sim.step();
  let t0 = performance.now();
  sim.explode(x, y, z);
  const burstMs = performance.now() - t0;
  const steps: string[] = [];
  let total = 0;
  for (let i = 0; i < 40; i++) {
    t0 = performance.now();
    sim.step();
    const ms = performance.now() - t0;
    total += ms;
    if (i < 12 || ms > 8) steps.push(`${i}:${ms.toFixed(1)}`);
  }
  console.log(`${name.padEnd(22)} burst call ${burstMs.toFixed(1)} ms, awake ${sim.castle.awakeCount()}, next 40 steps ${total.toFixed(0)} ms: ${steps.join(" ")}`);
  sim.free();
}
