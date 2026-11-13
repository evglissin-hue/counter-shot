// Musketeers, scripted. Team 1 (the player) sends a Volley wave; team 0 may send pikemen.
// npx rolldown tools/army-diag/specialists/muskets.ts --format esm --platform node -o node_modules/.scratch/diag-spec-muskets.mjs && node node_modules/.scratch/diag-spec-muskets.mjs scen=field seed=1 route=1 secs=120
import { KEG, Unit, MUSKET } from "@keepfall/content";
import { MinionState, Order } from "@keepfall/sim";
import { arg, clock, newMatch, Tracker, where } from "./common";
import { wayIn } from "./common";

const scen = arg("scen", "field");
const seed = Number(arg("seed", "1"));
const route = Number(arg("route", "1"));
const secs = Number(arg("secs", "120"));
const verbose = process.argv.includes("v");
const gun = process.argv.includes("gun");
const P = Unit.Pikeman, M = Unit.Musketeer;
const m = newMatch({ seed, masons: !process.argv.includes("nomasons"), barracks: false, gunnery: gun ? [true, false] : false });
const tr = new Tracker(m, verbose);
const A = m.army;
const volley = [P, P, P, P, M, P, M, M];
if (scen === "hold" || scen === "holdfield") A.setOrder(1, Order.Hold);
if (scen === "push") {
  A.setOrder(1, Order.Push);
  for (const x of [-9, -8]) m.world.explode(x, 0.7, -15.3, KEG.burst);
}
A.spawnMix(1, route, volley, 0, undefined, scen === "ladder" ? { ladder: true } : {});
// The enemy: pikemen from their own muster, a little later so the waves meet past the stream (field), or late (hold).
let enemyAt = scen === "field" || scen === "holdfield" ? 20 * 60 : -1;
let pAt = -1;
// Per musketeer: ticks of each kind, the wave's centre when it was aiming, its distance to the wave's centre.
const lag: number[] = [];
const facing: number[] = [];
for (let i = 0; i < secs * 60 && !m.result; i++) {
  if (i === enemyAt) A.spawnMix(0, route, [P, P, P, P, P, P, P, P], 0);
  // Hold given late (the wave is at the enemy gate or inside): who comes back, and how long the musketeers keep shooting.
  if (scen === "holdlate" && i === Number(arg("holdAt", "100")) * 60) {
    A.setOrder(1, Order.Hold);
    tr.note("HOLD given");
  }
  if (scen === "holdlate" && i >= Number(arg("holdAt", "100")) * 60 && i % 300 === 0) {
    const ups = m.world.minions.list.filter((n) => n.team === 1 && n.wave >= 0 && n.role === 0 && n.state === MinionState.Upright);
    console.log(`  ${clock(i)} after HOLD: ${ups.map((n) => `${["P", "Ma", "L", "S", "M"][n.unit]}${n.id} a${n.action} z${n.z.toFixed(0)}`).join(" ")}`);
  }
  m.step();
  if (process.argv.includes("nostorm")) m.storm[0] = m.storm[1] = 0;
  tr.step();
  if (m.tick === 180 || m.tick % 1800 === 0) console.log(`  ${clock(m.tick)} ${wayIn(m, 1)}`);
  if (m.tick % 60 === 0) {
    const mine = m.world.minions.list.filter((n) => n.team === 1 && n.wave >= 0 && n.role === 0 && n.state === MinionState.Upright);
    const pikes = mine.filter((n) => n.unit === P);
    if (pikes.length) {
      const cz = pikes.reduce((s, n) => s + n.z, 0) / pikes.length;
      for (const n of mine) if (n.unit === M) lag.push(cz - n.z); // + means behind the pikes (team 1 marches +z)
    }
    for (const n of mine) {
      if (n.unit !== M || n.action !== 9 || n.target < 0) continue;
      const t = m.world.minions.list[n.target];
      const want = Math.atan2(t.x - n.x, t.z - n.z);
      let d = Math.abs(want - n.yaw);
      if (d > Math.PI) d = 2 * Math.PI - d;
      facing.push(d);
    }
    if (verbose && m.tick % 300 === 0) {
      const line = m.world.minions.list
        .filter((n) => n.wave >= 0 && n.role === 0 && n.state === MinionState.Upright && n.unit !== 1)
        .map((n) => `${n.team}${["P", "Ma", "L", "S", "M"][n.unit]}${n.id}:a${n.action}(${n.x.toFixed(0)},${n.z.toFixed(0)})`)
        .join(" ");
      console.log(`  ${clock(m.tick)} ${line}`);
    }
  }
}
void pAt;
const mus = m.world.minions.list.filter((n) => n.unit === M);
console.log(`final: musketeers ${mus.length}, up ${mus.filter((n) => n.state === MinionState.Upright).length}; team 0 marchers down ${m.world.minions.list.filter((n) => n.team === 0 && n.role === 0 && n.wave >= 0 && n.state !== MinionState.Upright).length}`);
for (const n of mus) if (n.state === MinionState.Upright) console.log(`  musket ${n.id} action ${n.action} target ${n.target} at (${n.x.toFixed(1)}, ${n.z.toFixed(1)}) ${where(m, n.x, n.z)}`);
if (lag.length) {
  lag.sort((a, b) => a - b);
  console.log(`musketeers behind their pikes (m, + is behind): median ${lag[lag.length >> 1].toFixed(1)}, 90% ${lag[Math.floor(lag.length * 0.9)].toFixed(1)}, max ${lag[lag.length - 1].toFixed(1)}, min ${lag[0].toFixed(1)}`);
}
if (facing.length) console.log(`facing error while aiming (rad): mean ${(facing.reduce((a, b) => a + b, 0) / facing.length).toFixed(2)}, max ${Math.max(...facing).toFixed(2)}`);
tr.report(`muskets scen=${scen} seed=${seed} route=${route}${gun ? " gun" : ""} range ${MUSKET.range}`);
m.free();
