// How big is a mortar burst? Bursts a shell at a few targets on the enemy
// castle and prints what came loose, how high it flew and what it cost.
// npx rolldown packages/sim/scripts/burst.ts --format esm --platform node -o node_modules/.scratch/burst.mjs && node node_modules/.scratch/burst.mjs
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout } from "@keepfall/content";
import { SandboxSim, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, { mirrorWedges: true });
const cases: Array<[string, number, number, number]> = [
  ["keep top, south face", 0, 19.3, -0.6],
  ["keep platform centre", 0, 19.0, 4],
  ["front wall top", 6, 7.6, -15.2],
  ["front wall, mid height", -6, 4, -16.4],
  ["house roof (barracks)", -7.5, 4.0, -8.5],
  ["tower top", 15, 11.6, -15],
  ["open ground, patrol", 0, 0.3, -30],
];
for (const [name, x, y, z] of cases) {
  const sim = new SandboxSim(R, layout, { seed: 1, minions: 12 });
  const before = sim.castle.dynList.length;
  sim.explode(x, y, z);
  let shattered = 0;
  for (let i = 0; i < layout.stones.length; i++) if (sim.castle.shattered[i]) shattered++;
  const loose = sim.castle.dynList.length - before - shattered;
  let maxRise = 0, peakMoving = 0, worst = 0, sum = 0, risen = 0;
  const top = new Float32Array(layout.stones.length).fill(-1e9);
  for (let t = 0; t < 240; t++) {
    const t0 = performance.now();
    sim.step();
    const ms = performance.now() - t0;
    sum += ms;
    if (ms > worst) worst = ms;
    peakMoving = Math.max(peakMoving, sim.castle.awakeCount());
    for (const id of sim.castle.dynList) {
      if (sim.castle.shattered[id]) continue;
      const p = sim.castle.bodies[id].translation();
      if (p.y > top[id]) top[id] = p.y;
    }
  }
  for (const id of sim.castle.dynList) {
    if (sim.castle.shattered[id]) continue;
    const rise = top[id] - layout.stones[id].y;
    if (rise > maxRise) maxRise = rise;
    if (rise > 3) risen++;
  }
  const c = sim.minionCounts();
  console.log(
    `${name.padEnd(24)} shattered ${String(shattered).padStart(3)}  loosened ${String(loose).padStart(4)}  thrown >3 m up ${String(risen).padStart(3)}  max rise ${maxRise.toFixed(1).padStart(5)} m  peak moving ${String(peakMoving).padStart(4)}  step avg ${(sum / 240).toFixed(2)} ms worst ${worst.toFixed(1)} ms  minions down ${c.down}`,
  );
  sim.free();
}
