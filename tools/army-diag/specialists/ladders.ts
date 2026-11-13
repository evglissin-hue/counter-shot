// Ladder crews and climbers, scripted. Team 1 (the player) attacks castle 0.
// npx rolldown tools/army-diag/specialists/ladders.ts --format esm --platform node -o node_modules/.scratch/diag-spec-ladders.mjs && node node_modules/.scratch/diag-spec-ladders.mjs scen=basic seed=1 route=1 secs=150
import { KEG, Unit } from "@keepfall/content";
import { Climb, LadderState, MinionState, Order } from "@keepfall/sim";
import { arg, clock, newMatch, Tracker } from "./common";
import { wayIn } from "./common";

const scen = arg("scen", "basic");
const seed = Number(arg("seed", "1"));
const route = Number(arg("route", "1"));
const secs = Number(arg("secs", "150"));
const verbose = process.argv.includes("v");
const gun = scen === "gun" || scen === "barracks" || process.argv.includes("gun");
const P = Unit.Pikeman;
const m = newMatch({ seed, masons: !process.argv.includes("nomasons"), barracks: scen === "barracks", gunnery: gun ? [true, false] : false });
const tr = new Tracker(m, verbose);
const A = m.army;
const L = m.world.ladders!;
const wave = (r = route, opts = { ladder: true }) => A.spawnMix(1, r, [P, P, P, P, P, P, P, P], 0, undefined, opts);

if (scen !== "barracks") wave();
if (scen === "hold0") A.setOrder(1, Order.Hold);
if (scen === "push") A.setOrder(1, Order.Push);
if (scen === "breach" || scen === "breachpush") {
  // A breach in the front wall to the left of the gate, before the wave comes.
  for (const x of [-10, -9]) m.world.explode(x, 0.7, -15.3, KEG.burst);
  if (scen === "breachpush") A.setOrder(1, Order.Push);
}
let leaked = 0;
if (scen === "merlon") {
  // One loose stone (the topmost of each spot's support, a merlon or the top course) at every ladder spot of castle 0.
  const sup = (L as any).support as number[][];
  const lay = m.world.castle.layout;
  for (let k = 0; k < L.spots.length; k++) {
    if (L.spots[k].castle !== 0) continue;
    const ids = sup[k];
    const parts = ids.map((id) => `${lay.stones[id].part}:c${lay.stones[id].course}`);
    console.log(`spot ${k} (x ${L.spots[k].x}) support ${ids.length} pieces: ${parts.join(" ")}`);
    const top = ids.reduce((a, b) => (lay.stones[b].course > lay.stones[a].course ? b : a), ids[0]);
    m.world.castle.knockLoose(top, 0, 0, -0.5);
    console.log(`  knocked loose piece ${top} (${lay.stones[top].part}, course ${lay.stones[top].course}, x ${lay.stones[top].x.toFixed(1)})`);
  }
}
let holdGiven = -1, wallBlown = -1, crewKnocked = -1;
const extra: string[] = [];
for (let i = 0; i < secs * 60 && !m.result; i++) {
  if (scen === "many" && i > 0 && i % 600 === 0 && i <= 3000) wave();
  // Hold once the ladder is up and men are queueing.
  if (scen === "holdlate" && holdGiven < 0 && L.list[0].state === LadderState.Planted && L.list[0].t > 120) {
    A.setOrder(1, Order.Hold);
    holdGiven = m.tick;
    tr.note("HOLD given");
  }
  if (scen === "holdspot" && holdGiven < 0 && L.list[0].spot >= 0) {
    A.setOrder(1, Order.Hold);
    holdGiven = m.tick;
    tr.note("HOLD given (the crew has chosen its spot)");
  }
  if (scen === "crewdie" && crewKnocked < 0 && m.tick === 40 * 60) {
    const f = m.world.minions.list[L.list[0].front];
    m.world.minions.knock({ minion: f.id, vx: 0, vy: 2, vz: 2, px: f.x, py: 1, pz: f.z, extra: 1, cause: 1 }, m.tick);
    crewKnocked = m.tick;
    tr.note(`front man ${f.id} knocked down at (${f.x.toFixed(1)}, ${f.z.toFixed(1)})`);
  }
  // Knock down every man the first moment he walks for the ladder (Climb.ToLadder), up to `leakN` of them.
  if (scen === "leak" && leaked < Number(arg("leakN", "3"))) {
    for (const n of m.world.minions.list) {
      if (n.state !== MinionState.Upright || n.task !== Climb.ToLadder || leaked >= Number(arg("leakN", "3"))) continue;
      m.world.minions.knock({ minion: n.id, vx: 0, vy: 2, vz: 2, px: n.x, py: 1, pz: n.z, extra: 1, cause: 1 }, m.tick);
      leaked++;
      tr.note(`knocked down ${n.id} on his way to ladder ${n.aux} (claims now ${L.list[n.aux].claims})`);
    }
  }
  if (scen === "wallfall" && wallBlown < 0 && L.list[0].state === LadderState.Planted && L.list[0].t > 6 * 60) {
    const sp = L.spots[L.list[0].spot];
    m.world.explode(sp.x, 7.5, -15);
    wallBlown = m.tick;
    tr.note(`wall under ladder 0 blown (spot x ${sp.x})`);
  }
  m.step();
  if (process.argv.includes("nostorm")) m.storm[0] = m.storm[1] = 0;
  tr.step();
  if (m.tick === 180 || m.tick % 1800 === 0) console.log(`  ${clock(m.tick)} ${wayIn(m, 1)}`);
  if (verbose && m.tick % 600 === 0) {
    const crew = L.list.map((l) => {
      const f = m.world.minions.list[l.front];
      return `L${l.id}:${["carried", "raising", "planted", "down", "gone"][l.state]} f(${f.x.toFixed(0)},${f.z.toFixed(0)}) claims ${l.claims}`;
    });
    const ups = m.world.minions.list.filter((n) => n.team === 1 && n.state === MinionState.Upright && n.wave >= 0 && n.role === 0);
    const tasks = new Map<string, number>();
    for (const n of ups) {
      const k = n.task >= 10 ? ["to", "wait", "up", "across", "down"][n.task - 10] : `t${n.task}:a${n.action}`;
      tasks.set(k, (tasks.get(k) ?? 0) + 1);
    }
    console.log(`  ${clock(m.tick)} ${crew.join(" ")} | team1 up ${ups.length}: ${[...tasks.entries()].map(([k, v]) => `${k}=${v}`).join(" ")} | attackers in 0: ${A.attackers[0]} storm ${m.storm[0]}`);
  }
}
if (holdGiven >= 0) {
  // Who kept climbing after Hold?
  extra.push(`HOLD given at ${clock(holdGiven)}`);
}
const marchers = m.world.minions.list.filter((n) => n.team === 1 && n.wave >= 0 && n.role === 0);
const up = marchers.filter((n) => n.state === MinionState.Upright);
const where = new Map<string, number>();
for (const n of up) {
  const k = n.task >= 10 ? `climb ${["to", "wait", "up", "across", "down"][n.task - 10]}` : n.z > -15 && n.z < 15 && Math.abs(n.x) < 15 ? "inside castle 0" : `outside z ${Math.round(n.z / 10) * 10} a${n.action}`;
  where.set(k, (where.get(k) ?? 0) + 1);
}
console.log(`final: team 1 marchers ${marchers.length}, up ${up.length}: ${[...where.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}; autoShots ${m.autoShots[0]}/${m.autoShots[1]}; storm[0] ${m.storm[0]} result ${m.result ? m.result.reason : "-"}`);
for (const s of extra) console.log(s);
tr.report(`ladders scen=${scen} seed=${seed} route=${route}${gun ? " gun" : ""}`);
void Climb;
m.free();
