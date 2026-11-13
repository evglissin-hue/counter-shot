// AI v AI (Knight both sides) with the specialists tracker on.
// npx rolldown tools/army-diag/specialists/aivai.ts --format esm --platform node -o node_modules/.scratch/diag-spec-aivai.mjs && node node_modules/.scratch/diag-spec-aivai.mjs seed=21 secs=420
import { Unit, type Difficulty } from "@keepfall/content";
import { Climb, MinionState } from "@keepfall/sim";
import { AiPlayer } from "@keepfall/ai";
import { arg, clock, newMatch, ORDER, Tracker, where } from "./common";

const seed = Number(arg("seed", "21"));
const secs = Number(arg("secs", "420"));
const level = arg("level", "knight") as Difficulty;
const verbose = process.argv.includes("v");
const m = newMatch({ seed });
const ais = [0, 1].map((team) => new AiPlayer(m, team, level, seed));
const tr = new Tracker(m, verbose);
const A = m.army;
let lastOrder = [-1, -1];
/** Per team: seconds with a ladder planted, and with men climbing while the order was Hold. */
const climbOnHold = [0, 0], muskOnHold = [0, 0], muskIdleAtGate = [0, 0], sapperAtGate = [0, 0];
const mixSeen = new Set<string>();
for (let i = 0; i < secs * 60 && !m.result; i++) {
  for (const ai of ais) ai.step();
  m.step();
  tr.step();
  for (const t of [0, 1]) if (A.order[t] !== lastOrder[t]) {
    tr.note(`team ${t} order -> ${ORDER[A.order[t]]}`);
    lastOrder[t] = A.order[t];
  }
  if (m.tick % 60 === 0) {
    for (const n of m.world.minions.list) {
      if (n.state !== MinionState.Upright || n.wave < 0) continue;
      const hold = A.order[n.team] === 1;
      if (hold && n.task >= Climb.ToLadder && n.task <= Climb.Down) climbOnHold[n.team]++;
      if (hold && n.unit === Unit.Musketeer && n.action === 9) muskOnHold[n.team]++;
      const g = Math.hypot(n.x, n.z - (n.team === 1 ? -15 : -135));
      if (n.unit === Unit.Musketeer && n.action === 1 && g < 6) muskIdleAtGate[n.team]++;
      if (n.unit === Unit.Sapper && n.action === 1 && g < 6) sapperAtGate[n.team]++;
    }
    for (const t of [0, 1]) for (const b of (m.estate as any).barracks[t]) if (b) mixSeen.add(`${t}:${b.mix}/${b.route}`);
  }
  if (m.tick % 1800 === 0) {
    const L = m.world.ladders!;
    const cnt = (t: number, u: number) => m.world.minions.list.filter((n) => n.team === t && n.unit === u && n.state === MinionState.Upright && n.wave >= 0).length;
    console.log(`${clock(m.tick)} orders ${ORDER[A.order[0]]}/${ORDER[A.order[1]]} waves ${m.waves[0]}/${m.waves[1]} ladders planted ${L.planted[0]}/${L.planted[1]} lost ${L.lost[0]}/${L.lost[1]} up: sappers ${cnt(0, 3)}/${cnt(1, 3)} muskets ${cnt(0, 4)}/${cnt(1, 4)} crews ${cnt(0, 2)}/${cnt(1, 2)} down ${m.masonryDown(0)}/${m.masonryDown(1)} storm ${m.storm[0]}/${m.storm[1]}`);
  }
}
console.log(m.result ? `END ${clock(m.result.tick)} winner ${m.result.winner} by ${m.result.reason}` : `no result after ${secs} s`);
console.log(`mixes seen: ${[...mixSeen].join(" ")}`);
console.log(`minion-seconds climbing on Hold ${climbOnHold.join("/")}, musket aiming on Hold ${muskOnHold.join("/")}, musketeers standing at the enemy gate ${muskIdleAtGate.join("/")}, sappers standing at the enemy gate ${sapperAtGate.join("/")}`);
const ups = m.world.minions.list.filter((n) => n.state === MinionState.Upright && n.wave >= 0 && (n.unit === Unit.Musketeer || n.unit === Unit.Sapper || n.unit === Unit.Ladder));
for (const n of ups) console.log(`  team ${n.team} ${["", "", "ladder", "sapper", "musket"][n.unit]} ${n.id} task ${n.task} action ${n.action} at (${n.x.toFixed(1)}, ${n.z.toFixed(1)}) ${where(m, n.x, n.z)}`);
for (const s of tr.events.filter((e) => /KEG|LADDER|order/.test(e))) console.log("  ev " + s);
tr.report(`aivai seed=${seed} ${level}`);
m.free();
