// One shot at the front wall: speeds right after the blast and distances a second later.
import RD from "@dimforge/rapier3d-deterministic-compat";
import { aim } from "../src/core/ballistics";
import { buildLayout } from "../src/core/castle";
import { CastleSim, DEFAULT_SIM, type Rapier } from "../src/physics/sim";

await RD.init();
const layout = buildLayout(1);
const sim = new CastleSim(RD as unknown as Rapier, layout, { ...DEFAULT_SIM, push: Number(process.argv[2] ?? 0.22) });
sim.world.step();
const c = layout.cannon;
const t = [-4, 3, -15.3];
const v = aim(c.x, c.y, c.z, t[0], t[1], t[2], 2.5);
sim.fire(c.x, c.y, c.z, v[0], v[1], v[2]);
let step = 0;
const before = sim.dynList.length;
while (sim.dynList.length === before && step < 400) { sim.step(); step++; }
const hit = sim.dynList.slice(before);
const ball = sim.balls[0];
console.log("blast at step", step, "loosened", hit.length, "ball speed after", Math.hypot(ball.body.linvel().x, ball.body.linvel().y, ball.body.linvel().z).toFixed(1));
const sp = hit.map((id) => { const l = sim.bodies[id].linvel(); return Math.hypot(l.x, l.y, l.z); }).sort((a, b) => b - a);
console.log("speeds right after (m/s):", sp.slice(0, 10).map((x) => x.toFixed(1)).join(" "), "... median", sp[Math.floor(sp.length / 2)].toFixed(1));
sim.step();
const sp2 = hit.map((id) => { const l = sim.bodies[id].linvel(); return Math.hypot(l.x, l.y, l.z); }).sort((a, b) => b - a);
console.log("speeds one step later:", sp2.slice(0, 10).map((x) => x.toFixed(1)).join(" "), "... median", sp2[Math.floor(sp2.length / 2)].toFixed(1));
for (let i = 0; i < 90; i++) sim.step();
const dist = hit.map((id) => { const s = layout.stones[id]; const p = sim.bodies[id].translation(); return Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z); }).sort((a, b) => b - a);
console.log("distance after 1.5 s:", dist.slice(0, 12).map((x) => x.toFixed(1)).join(" "), "... median", dist[Math.floor(dist.length / 2)].toFixed(2));
