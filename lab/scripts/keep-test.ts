// How many focused shots does it take to topple the enemy keep?
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout } from "../src/core/castle";
import { CastleSim, DEFAULT_SIM, type Rapier } from "../src/physics/sim";

await RD.init();
const layout = buildLayout(1);
const sim = new CastleSim(RD as unknown as Rapier, layout, DEFAULT_SIM);
sim.world.step();
const c = layout.cannon;
const targets: Array<[number, number, number]> = [];
for (let i = 0; i < 16; i++) targets.push([((i % 5) - 2) * 1.6, 10 + (i % 3) * 1.5, -1.2]);
let maxMs = 0;
for (let i = 0; i < 60 * 30; i++) {
  if (i % 40 === 0 && i / 40 < targets.length) {
    const t = targets[i / 40];
    const [vx, vy, vz] = CastleSim.aim(c.x, c.y, c.z, t[0], t[1], t[2], 2.6);
    sim.fire(c.x, c.y, c.z, vx, vy, vz);
  }
  const t0 = performance.now();
  sim.step();
  maxMs = Math.max(maxMs, performance.now() - t0);
  if (sim.toppled[0]) { console.log(`keep toppled at t=${(i / 60).toFixed(1)}s after ${Math.min(targets.length, Math.floor(i / 40) + 1)} shots`); break; }
  if (i % 120 === 119) console.log(`t=${((i + 1) / 60).toFixed(0)}s loose ${sim.dynList.length} awake ${sim.awakeCount()} banner y ${sim.bodies[layout.bannerIds[0]].translation().y.toFixed(1)}`);
}
console.log("max step ms", maxMs.toFixed(1), "loose", sim.dynList.length);
