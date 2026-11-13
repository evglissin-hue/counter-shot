// Push the breach: the player's gun opens a breach west of the enemy gate (the siege test's two wall shots);
// the player's waves march on Push from their own gate. Do they go through it, how many, how long; and what when masons close it?
// npx rolldown tools/army-diag/orders/push.ts --format esm --platform node -o node_modules/.scratch/diag-orders-push.mjs && node node_modules/.scratch/diag-orders-push.mjs seed=7 masons=1
//   order=push (default) or order=advance (the same match on Advance, to compare); masons=0 keeps the breach open.
import { buildLayout, GAME_LAYOUT, inCourtyard, ROUTE_NAMES, type RouteName } from "@keepfall/content";
import { breachField, FLOW_INF, MinionState, Order, Role, Spin } from "@keepfall/sim";
import { Match, Team, type MatchInput } from "@keepfall/rules";
import { wayIn } from "@keepfall/ai";
import { ACTION, arg, clock, R, tally, zone } from "./common";

const seed = Number(arg("seed", "7"));
const order = arg("order", "push") === "push" ? Order.Push : Order.Advance;
const route = arg("route", "left") as RouteName;
const secs = Number(arg("secs", "180"));
const m = new Match(R, buildLayout(1, GAME_LAYOUT), {
  seed, plan: false, rotate: false, gunnery: false, masons: arg("masons", "1") === "1",
  orders: [Order.Hold, order], routes: ["right", route],
});
const wallShot = (yaw: number): MatchInput => ({ kind: "fire", emplacement: 0, yaw, pitch: -0.022, charge: 1, fuse: 0, spin: Spin.None });
m.queue(0, Team.Player, { kind: "man", emplacement: 0 });
m.queue(5, Team.Player, wallShot(-0.0707));
m.queue(260, Team.Player, wallShot(-0.0624));

const spawnTick = new Map<number, number>();
const inTick = new Map<number, number>();
const waveOf = new Map<number, number>();
/** Which bridge each man crossed the stream by (his x where he first got past z = -75). */
const crossed = new Map<number, string>();
let lastWay = false;
for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
  m.step();
  const way = wayIn(m, Team.Player);
  if (way !== lastWay) {
    console.log(`${clock(m.tick)} way in to the enemy courtyard: ${way}`);
    lastWay = way;
  }
  for (const x of m.world.minions.list) {
    if (x.team !== 1 || x.wave < 0 || x.role !== Role.March) continue;
    if (!spawnTick.has(x.id)) {
      spawnTick.set(x.id, m.tick);
      waveOf.set(x.id, x.wave);
    }
    if (x.state === MinionState.Upright && !inTick.has(x.id) && inCourtyard(0, x.x, x.z)) inTick.set(x.id, m.tick);
    if (x.state === MinionState.Upright && !crossed.has(x.id) && x.z > -75) crossed.set(x.id, x.x > 24 ? "left" : x.x < -24 ? "right" : "centre");
  }
  if (tick % (15 * 60) === 0 && tick > 0) {
    const up = m.world.minions.list.filter((x) => x.team === 1 && x.state === MinionState.Upright && x.role === Role.March);
    const bf = up.map((x) => m.army.flow.at(breachField(1), x.x, x.z) < FLOW_INF);
    console.log(`${clock(m.tick)} player ${["Adv", "Hold", "Push"][m.army.order[1]]} ${up.length} up (breach field reaches ${bf.filter(Boolean).length}): ${tally(up.map((x) => zone(1, x.x, x.z) + "/" + ACTION[x.action]))} | in enemy courtyard so far ${inTick.size}, attackers now ${m.army.attackers[0]} v defenders ${m.army.defenders[0]}, storm ${m.storm[0]}`);
  }
}
// Per wave: men sent, men that got in, seconds from leaving to getting in.
const waves = new Map<number, number[]>();
for (const [id, w] of waveOf) {
  if (!waves.has(w)) waves.set(w, []);
  waves.get(w)!.push(id);
}
for (const [w, ids] of [...waves.entries()].sort((a, b) => a[0] - b[0])) {
  const t = ids.filter((id) => inTick.has(id)).map((id) => (inTick.get(id)! - spawnTick.get(id)!) / 60).sort((a, b) => a - b);
  const left = ids.map((id) => m.world.minions.list[id]).filter((x) => x.state === MinionState.Upright && !inTick.has(x.id));
  console.log(`wave ${w} (left at ${clock(spawnTick.get(ids[0])!)}, route ${ROUTE_NAMES[m.world.minions.list[ids[0]].route]}): ${ids.length} men, ${t.length} got in (s: ${t.map((v) => v.toFixed(0)).join(" ")}); crossed by ${tally(ids.map((id) => crossed.get(id) ?? "-"))}; still up outside: ${tally(left.map((x) => zone(1, x.x, x.z) + "/" + ACTION[x.action]))}; down ${ids.filter((id) => m.world.minions.list[id].state !== MinionState.Upright).length}`);
}
console.log(`result ${JSON.stringify(m.result)}`);
m.free();
