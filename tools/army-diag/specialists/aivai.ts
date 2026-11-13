// AI v AI (Knight both sides) with the specialists tracker on.
// npx rolldown tools/army-diag/specialists/aivai.ts --format esm --platform node -o node_modules/.scratch/diag-spec-aivai.mjs && node node_modules/.scratch/diag-spec-aivai.mjs seed=21 secs=420
import { Unit, type Difficulty } from "@keepfall/content";
import { Climb, MinionState, navCell } from "@keepfall/sim";
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
const dbgAt = (arg("dbg", "") || "").split(",").filter(Boolean).map((v) => Number(v) * 60);
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
  if (dbgAt.includes(m.tick)) {
    const F = (A as any).flow;
    const G = (m.world as any).gangs;
    if (process.argv.includes("navgate")) for (const zc of [-134, -16]) {
      const rows: string[] = [];
      for (let z = zc + 6; z >= zc - 6; z--) {
        let row = "";
        for (let x = -14; x <= 14; x++) { const c = navCell(x + 0.25, z + 0.25); row += "GRWSBr"[m.world.nav.kind[c]]; }
        rows.push(`${String(z).padStart(5)} ${row}`);
      }
      console.log(`DBG ${clock(m.tick)} nav around z ${zc} (x -14..14):\n${rows.join("\n")}`);
    }
    const pts = [[0, -40], [0, -100], [48, -60], [0, -125], [0, -138]];
    console.log(`DBG ${clock(m.tick)} fields: ${[0, 1, 2, 6, 3, 4, 5, 7].map((f) => `f${f}:` + pts.map(([x, z]) => { const v = F.at(f, x, z); return v >= 1e9 ? "INF" : String(v); }).join("/")).join(" ")} builds ${F.builds} topo ${m.world.nav.topo} stale ${F.stale}`);
    console.log(`DBG ${clock(m.tick)} bridgeOpen ${JSON.stringify(A.bridgeOpen)} nav.bridgeOpen ${JSON.stringify(((A as any).bridges as any[]).map((b) => m.world.nav.bridgeOpen(b)))} gangs ${G ? JSON.stringify((G.list ?? G.gangs ?? []).map((g: any) => ({ team: g.team, route: g.route, state: g.state, men: g.men.length }))) : "-"} waveRoutes team0 ${JSON.stringify([...new Set(m.world.minions.list.filter((n) => n.team === 0 && n.wave >= 0 && n.role === 0 && n.state === MinionState.Upright).map((n) => n.route))])}`);
    const dir: [number, number] = [0, 0];
    for (const n of m.world.minions.list) {
      if (n.state !== MinionState.Upright || n.unit !== Unit.Sapper || n.task !== 0 || n.action !== 1) continue;
      const f = n.team * 3 + n.route;
      const has = F.dir(f, n.x, n.z, dir);
      let near = 0, nearUp = 0;
      for (const o of m.world.minions.list) if (o !== n && Math.hypot(o.x - n.x, o.z - n.z) < 1.5) { near++; if (o.state === MinionState.Upright) nearUp++; }
      const t = n.target >= 0 ? m.world.minions.list[n.target] : null;
      if (process.argv.includes("navsap")) {
        const rows: string[] = [];
        for (let z = Math.round(n.z) + 8; z >= Math.round(n.z) - 4; z--) {
          let row = "";
          for (let x = Math.round(n.x) - 4; x <= Math.round(n.x) + 14; x++) { const c = navCell(x + 0.25, z + 0.25); row += Math.round(n.x) === x && Math.round(n.z) === z ? "@" : "GRWSBr"[m.world.nav.kind[c]]; }
          rows.push(`${String(z).padStart(5)} ${row}`);
        }
        console.log(`DBG nav around sapper ${n.id} (x ${Math.round(n.x) - 4}..${Math.round(n.x) + 14}), target (${n.tx.toFixed(1)}, ${n.tz.toFixed(1)}) aux ${n.aux}:\n${rows.join("\n")}`);
      }
      console.log(`DBG ${clock(m.tick)} sapper ${n.id} team ${n.team} route ${n.route} at (${n.x.toFixed(1)}, ${n.z.toFixed(1)}) order ${ORDER[A.order[n.team]]} field ${F.at(f, n.x, n.z)} dir ${has ? dir.map((v) => v.toFixed(2)).join(",") : "NONE"} door ${has ? F.doorAhead(f, n.x, n.z, dir[0], dir[1], 0.7) : "-"} target ${t ? t.id + (t.state === MinionState.Upright ? " up" : " down") : "-"} men within 1.5 m ${near} (up ${nearUp}) vx ${n.vx.toFixed(2)} vz ${n.vz.toFixed(2)} ${where(m, n.x, n.z)}`);
    }
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
