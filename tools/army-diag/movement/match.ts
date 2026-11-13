// AI v AI match (Knight both sides by default) with the movement probe on.
// npx rolldown tools/army-diag/movement/match.ts --format esm --platform node -o node_modules/.scratch/diag-move-match.mjs && node node_modules/.scratch/diag-move-match.mjs seed=21 secs=360
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, ROUTE_NAMES, type Difficulty } from "@keepfall/content";
import { Action, MinionState, Role, type Rapier } from "@keepfall/sim";
import { Match } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";
import { Probe } from "./probe";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const seed = Number(arg("seed", "21")), secs = Number(arg("secs", "360"));
const sides = [arg("enemy", "knight"), arg("player", "knight")];
const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false });
const ais = sides.map((s, team) => (s === "idle" ? null : new AiPlayer(m, team, s as Difficulty, seed)));
const w = m.world;
const p = new Probe(w, `match seed ${seed} ${sides.join(" v ")} ${secs} s`, arg("detail", "0") === "1");
const army = w.army!;
const isWorker = (r: number) => r === Role.Mason || r === Role.Carrier;
let shoveTicks = 0, soldierTicks = 0, gangShove = 0;
const shoveBy = new Map<string, number>();
const perMin: string[] = [];
const orders: string[] = [];
let lastOrder = [-1, -1];
/** Order compliance: per order change, snapshots at +5, +10, +20, +30 s. */
const comply: { team: number; order: number; at: number; notes: string[] }[] = [];
const snap = (team: number, order: number) => {
  const sol = w.minions.list.filter((x) => p.soldier(x) && x.team === team);
  const holding = sol.filter((x) => p.marchField(x) < 0).length;
  const back = sol.filter((x) => army.order[team] === 1 && p.marchField(x) === (1 - team) * 3 + x.route).length;
  const chasing = sol.filter((x) => x.target >= 0).length;
  const breach = sol.filter((x) => p.marchField(x) === 6 + team).length;
  const walking = sol.filter((x) => x.action === Action.Walk).length;
  const v = sol.reduce((a, x) => a + Math.hypot(x.vx, x.vz), 0) / Math.max(1, sol.length);
  return `n ${sol.length} holding ${holding} walking-back ${back} chasing ${chasing} on-breach-field ${breach} walk ${walking} v ${v.toFixed(2)}`;
};
let pastLineChasers = 0, holdManSecs = 0;
/** Per castle: seconds its gate leaves were loose but standing in their place (no door, no gap), and seconds each team's route fields reached nothing from its own muster. */
const sealedGate = [0, 0], cutTeam = [0, 0];
const sealedLog: string[] = [];
const leavesOf = [0, 1].map((c) => w.castle.layout.stones.filter((s) => s.castle === c && s.part === "gate"));
const t0 = Date.now();
for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
  for (const ai of ais) ai?.step();
  m.step();
  p.tick();
  for (const team of [0, 1]) {
    if (army.order[team] !== lastOrder[team]) {
      orders.push(`${(m.tick / 60).toFixed(0)}s t${team} order ${["advance", "hold", "push"][army.order[team]]}`);
      lastOrder[team] = army.order[team];
      comply.push({ team, order: army.order[team], at: m.tick, notes: [`+0 ${snap(team, army.order[team])}`] });
    }
  }
  for (const c of comply) {
    const dt = m.tick - c.at;
    if (army.order[c.team] === c.order && (dt === 300 || dt === 600 || dt === 1200 || dt === 1800)) c.notes.push(`+${dt / 60} ${snap(c.team, c.order)}`);
  }
  if (m.tick % 60 === 0) {
    for (const c of [0, 1]) {
      const inPlace = leavesOf[c].filter((s) => {
        if (!w.castle.dynamic[s.id] || w.castle.shattered[s.id]) return false; // a shattered leaf's disabled body stays at its pose
        const t = w.castle.bodies[s.id].translation();
        return Math.hypot(t.x - s.x, t.y - s.y, t.z - s.z) < 0.5;
      }).length;
      if (inPlace) {
        sealedGate[c]++;
        if (sealedGate[c] % 30 === 1) sealedLog.push(`${(m.tick / 60).toFixed(0)}s castle ${c}: ${inPlace} gate leaves loose but in place`);
      }
      const team = 1 - c, M = { x: c === 0 ? 0 : 0, z: c === 0 ? -130.5 : -19.5 };
      const inf = [0, 1, 2].every((r) => army.flow.at(team * 3 + r, M.x, M.z) >= 0x3fffffff);
      if (inf) cutTeam[team]++;
    }
    for (const x of w.minions.list) {
      if (!p.soldier(x) || army.order[x.team] !== 1) continue;
      holdManSecs++;
      if (x.target >= 0 && p.marchField(x) !== -1) pastLineChasers++;
    }
  }
  // Workers shoving soldiers: a mason or powder boy within the separation radius of a marching soldier.
  if (tick % 6 === 0) {
    const list = w.minions.list;
    for (const s of list) {
      if (!p.soldier(s)) continue;
      soldierTicks++;
      for (const o of list) {
        if (o.state !== MinionState.Upright || o === s) continue;
        const dx = o.x - s.x, dz = o.z - s.z;
        if (dx * dx + dz * dz >= 0.95 * 0.95) continue;
        if (isWorker(o.role)) {
          shoveTicks++;
          const k = o.role === Role.Mason ? "mason" : "powder boy";
          shoveBy.set(k, (shoveBy.get(k) ?? 0) + 1);
        } else if (o.role === Role.Gang) gangShove++;
        else if (o.role === Role.Garrison) shoveBy.set("garrison", (shoveBy.get("garrison") ?? 0) + 1);
      }
    }
  }
  if (m.tick % 3600 === 0) {
    const sol = w.minions.list.filter((x) => p.soldier(x));
    const by = (a: number) => sol.filter((x) => x.action === a).length;
    const calmStand = sol.filter((x) => x.action === Action.Stand && p.calmNow(x)).length;
    const routes = [0, 1].map((t) => ROUTE_NAMES.map((_, r) => sol.filter((x) => x.team === t && x.route === r).length).join("/")).join(" | ");
    perMin.push(`${m.tick / 3600} min: soldiers ${sol.length} walk ${by(Action.Walk)} stand ${by(Action.Stand)} (calm stand ${calmStand}) fight ${by(Action.Fight)} batter ${by(Action.Batter)} climb ${by(Action.Climb)}; by route t0 ${routes}; bridges ${w.bridgesOpen().map((o) => (o ? 1 : 0)).join("")}; open stuck ${p.open.size}`);
  }
}
console.log(p.report());
console.log(`orders: ${orders.join("; ")}`);
console.log(perMin.join("\n"));
console.log(`order compliance:\n  ${comply.map((c) => `t${c.team} ${["advance", "hold", "push"][c.order]} at ${(c.at / 60).toFixed(0)}s: ${c.notes.join(" | ")}`).join("\n  ")}`);
// Dry ground that reads as water (craters below the stream's wading depth, away from the stream).
let dryWater = 0;
for (let k = 0; k < w.nav.kind.length; k++) {
  if (w.nav.kind[k] !== 2) continue;
  const i = k % 192, j = (k - i) / 192;
  const z = -208 + j + 0.5;
  if (Math.abs(z + 75) > 14) dryWater++;
}
console.log(`gate leaves loose but in place (s): castle 0 ${sealedGate[0]}, castle 1 ${sealedGate[1]}; ${sealedLog.join("; ")}`);
console.log(`seconds a team's three route fields reached nothing from its own muster: t0 ${cutTeam[0]}, t1 ${cutTeam[1]}`);
console.log(`nav cells reading water more than 14 m from the stream's middle (crater pits): ${dryWater}`);
console.log(`under Hold: ${holdManSecs} soldier-s, ${pastLineChasers} of them chasing an enemy off their hold line`);
console.log(`worker/garrison inside a soldier's separation radius (sampled every 6 ticks): ${shoveTicks} worker contacts in ${soldierTicks} soldier samples (${JSON.stringify(Object.fromEntries(shoveBy))}); gang ${gangShove}`);
console.log(`result ${m.result ? JSON.stringify(m.result) : "none"} at ${(m.tick / 60).toFixed(0)} s; wall ${((Date.now() - t0) / 1000).toFixed(0)} s`);
w.free();
