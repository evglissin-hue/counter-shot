// How visible is a breach? Fires three shots at the front wall and reports how far loosened stones travelled.
// Usage: node <bundle> [push] [span] [blastPerSpeed]
import RD from "@dimforge/rapier3d-deterministic-compat";
import { aim } from "../src/core/ballistics";
import { buildLayout } from "../src/core/castle";
import { CastleSim, DEFAULT_SIM, type Rapier } from "../src/physics/sim";

await RD.init();
const layout = buildLayout(1);
const push = Number(process.argv[2] ?? DEFAULT_SIM.push);
const span = Number(process.argv[3] ?? DEFAULT_SIM.span);
const blast = Number(process.argv[4] ?? DEFAULT_SIM.blastPerSpeed);
const sim = new CastleSim(RD as unknown as Rapier, layout, { ...DEFAULT_SIM, push, span, blastPerSpeed: blast });
sim.world.step();
const c = layout.cannon;
const targets: Array<[number, number, number]> = [[-4, 3, -15.3], [4, 4, -15.3], [0, 6, -15.3]];
for (let i = 0; i < 60 * 10; i++) {
  if (i % 42 === 0 && i / 42 < targets.length) {
    const t = targets[i / 42];
    const dist = Math.hypot(t[0] - c.x, t[2] - c.z);
    const v = aim(c.x, c.y, c.z, t[0], t[1], t[2], Math.min(4.5, Math.max(1.5, dist / 48)));
    sim.fire(c.x, c.y, c.z, v[0], v[1], v[2]);
  }
  sim.step();
}
let m1 = 0, m2 = 0, m4 = 0, loose = 0, shattered = 0;
for (const id of sim.dynList) {
  const s = layout.stones[id];
  if (s.part === "banner") continue;
  if (sim.shattered[id]) {
    shattered++;
    continue;
  }
  loose++;
  const p = sim.bodies[id].translation();
  const d = Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z);
  if (d > 1) m1++;
  if (d > 2) m2++;
  if (d > 4) m4++;
}
console.log(JSON.stringify({ push, span, blast, shattered, loose, movedOver1m: m1, over2m: m2, over4m: m4 }));
