// Sappers and their kegs, scripted. Team 1 (the player) attacks castle 0.
// npx rolldown tools/army-diag/specialists/sappers.ts --format esm --platform node -o node_modules/.scratch/diag-spec-sappers.mjs && node node_modules/.scratch/diag-spec-sappers.mjs scen=basic seed=1 route=1 secs=150
import { KEG, Unit } from "@keepfall/content";
import { MinionState, Order } from "@keepfall/sim";
import { arg, clock, newMatch, Tracker, where } from "./common";
import { wayIn } from "./common";

const scen = arg("scen", "basic");
const seed = Number(arg("seed", "1"));
const route = Number(arg("route", "1"));
const secs = Number(arg("secs", "150"));
const verbose = process.argv.includes("v");
const gun = process.argv.includes("gun");
const P = Unit.Pikeman, S = Unit.Sapper, M = Unit.Musketeer;
const m = newMatch({ seed, masons: !process.argv.includes("nomasons"), barracks: false, gunnery: gun ? [true, false] : false });
const tr = new Tracker(m, verbose);
const A = m.army;
const mix = scen === "mixed" ? [P, P, P, P, S, M, M, S] : [P, P, P, P, S, P, P, S];
if (scen === "breached") for (const x of [-9, -8, 7, 8]) m.world.explode(x, 0.7, -15.3, KEG.burst);
if (scen === "hold") A.setOrder(1, Order.Hold);
if (scen === "push" || scen === "breachedpush") A.setOrder(1, Order.Push);
if (scen === "breachedpush") for (const x of [-9, -8]) m.world.explode(x, 0.7, -15.3, KEG.burst);
A.spawnMix(1, route, mix, 0, undefined, scen === "ladder" ? { ladder: true } : {});
if (scen === "two") {
  // A second Breach wave 12 s later on the same road.
}
let holdAt = -1;
for (let i = 0; i < secs * 60 && !m.result; i++) {
  if (scen === "two" && i === 12 * 60) A.spawnMix(1, route, mix, 0);
  // Hold given once the sappers are on their way to the wall (task Carry, aux 1).
  if (scen === "holdlate" && holdAt < 0 && m.world.minions.list.some((n) => n.unit === S && n.aux === 1 && n.task === 0)) {
    A.setOrder(1, Order.Hold);
    holdAt = m.tick;
    tr.note("HOLD given");
  }
  m.step();
  if (process.argv.includes("nostorm")) m.storm[0] = m.storm[1] = 0;
  tr.step();
  if (m.tick === 180 || m.tick % 1800 === 0) console.log(`  ${clock(m.tick)} ${wayIn(m, 1)}`);
  if (verbose && m.tick % 300 === 0) {
    const line = m.world.minions.list
      .filter((n) => n.team === 1 && n.wave >= 0 && n.role === 0 && n.state === MinionState.Upright)
      .map((n) => `${["P", "Ma", "L", "S", "M"][n.unit]}${n.id}:t${n.task}a${n.action}(${n.x.toFixed(0)},${n.z.toFixed(0)})`)
      .join(" ");
    console.log(`  ${clock(m.tick)} ${line}`);
  }
}
const marchers = m.world.minions.list.filter((n) => n.team === 1 && n.wave >= 0 && n.role === 0);
const up = marchers.filter((n) => n.state === MinionState.Upright);
console.log(`final: team 1 marchers ${marchers.length}, up ${up.length}; masonry down castle 0: ${m.masonryDown(0)}; attackers in 0 ${A.attackers[0]}, storm ${m.storm[0]}; result ${m.result ? m.result.reason : "-"}`);
for (const n of up) console.log(`  ${["pike", "mason", "ladder", "sapper", "musket"][n.unit]} ${n.id} task ${n.task} action ${n.action} at (${n.x.toFixed(1)}, ${n.z.toFixed(1)}) ${where(m, n.x, n.z)}`);
tr.report(`sappers scen=${scen} seed=${seed} route=${route}${gun ? " gun" : ""}`);
m.free();
