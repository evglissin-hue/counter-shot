// Versus-AI-like match: an AI castle (team 0) against a player (team 1) who is idle, human-like or a Knight.
// Logs every order the AI sends with the steward's numbers, where the AI's men stand over time, and how many reach the gate.
// npx rolldown tools/army-diag/orders/versus.ts --format esm --platform node -o node_modules/.scratch/diag-orders-versus.mjs && node node_modules/.scratch/diag-orders-versus.mjs ai=knight player=idle secs=360 seed=21
import { buildLayout, GAME_LAYOUT, MUSTER, type Difficulty } from "@keepfall/content";
import { breachField, FLOW_INF, MinionState, Order, Role, routeField } from "@keepfall/sim";
import { Match, Team, type MatchInput } from "@keepfall/rules";
import { AiPlayer, marchers, wayIn } from "@keepfall/ai";
import { ACTION, arg, clock, ORDER, R, tally, UNIT, upright, zone } from "./common";

const aiLevel = arg("ai", "knight") as Difficulty;
const player = arg("player", "idle");
const secs = Number(arg("secs", "360")), seed = Number(arg("seed", "21"));
const quiet = arg("quiet", "0") === "1";
const dumpAt = arg("dump", "").split(",").filter(Boolean).map((v) => Number(v) * 60);
const dumpZone = arg("dumpZone", "");

const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false });
// aigun=0: the AI never fires by hand (its guns still fire on their own), so it does not knock the player's gate in at once.
const ai = new AiPlayer(m, Team.Enemy, aiLevel, seed, arg("aigun", "1") === "0" ? { level: { warmup: 1e9, marks: 0, salvo: false } } : undefined);
// "gunner": a Knight runs the player's castle and guns but never touches orders or routes (a human who leaves Advance on).
// "gunhold": the same, and the human puts its waves on Hold at 0:30 (a defensive player) and never sends them in.
const pai = ["knight", "squire", "warlord", "gunner", "gunhold"].includes(player) ? new AiPlayer(m, Team.Player, (player.startsWith("gun") ? "knight" : player) as Difficulty, seed + 1) : null;

const orderLog: string[] = [];
const q = m.queue.bind(m);
m.queue = (tick: number, team: Team, input: MatchInput) => {
  if (player.startsWith("gun") && team === Team.Player && (input.kind === "order" || input.kind === "route" || input.kind === "barracks")) return;
  if (input.kind === "order" || input.kind === "route" || (input.kind === "barracks" && input.route)) {
    const mine = marchers(m, team), theirs = marchers(m, 1 - team, MUSTER[team].x, MUSTER[team].z, 120), theirsAll = marchers(m, 1 - team);
    const where = tally(upright(m, 1 - team).filter((x) => (x.x - MUSTER[team].x) ** 2 + (x.z - MUSTER[team].z) ** 2 <= 120 * 120).map((x) => zone(1 - team, x.x, x.z)));
    const what = input.kind === "order" ? `order ${ORDER[input.order]}` : input.kind === "route" ? `route ${input.route}` : `barracks ${input.plot} route ${input.route}${input.mix ? " mix " + input.mix : ""}`;
    const line = `${clock(tick)} team${team} ${what}: mine=${mine} theirs120=${theirs} (all ${theirsAll}; 1.6*mine+4=${(mine * 1.6 + 4).toFixed(1)}) wayIn=${wayIn(m, team)} | theirs by zone: ${where}`;
    if (input.kind === "order") orderLog.push(line);
    if (!quiet) console.log("INPUT " + line);
  }
  q(tick, team, input);
};

if (player === "gunhold") q(30 * 60, Team.Player, { kind: "order", order: Order.Hold });
if (player === "human") {
  // A human-like player: leaves Advance on, changes the route now and then, holds once for 30 s.
  m.queue(60 * 60, Team.Player, { kind: "route", route: "left" });
  m.queue(150 * 60, Team.Player, { kind: "order", order: Order.Hold });
  m.queue(180 * 60, Team.Player, { kind: "order", order: Order.Advance });
  m.queue(240 * 60, Team.Player, { kind: "route", route: "centre" });
}

/** Per AI man: first tick at the player's gate or in its courtyard; ticks standing at its own marker or on a bridge under Advance. */
const reached = new Map<number, number>();
const seen = new Set<number>();
const stuckAtMarker = new Map<number, number>();
/** Stalls: per AI man, an anchor (x, z, tick) reset whenever he gets 2 m from it; a stall of 20 s or more is logged when it ends or at the end. */
const anchor = new Map<number, { x: number; z: number; t: number; fight: boolean; orders: Set<number>; zone: string; act: string }>();
const stalls: Array<{ id: number; secs: number; fight: boolean; orders: string; zone: string; act: string }> = [];
/** Walking back: per man of a team, his distance to the foe's gate 5 s ago; metres walked away from it (no target) by the order then. */
const prevD = [new Map<number, number>(), new Map<number, number>()];
const backM = [new Map<number, number>(), new Map<number, number>()];
const backByOrder = [[0, 0, 0], [0, 0, 0]];
const endStall = (id: number, now: number) => {
  const a = anchor.get(id);
  if (a && now - a.t >= 20 * 60) stalls.push({ id, secs: (now - a.t) / 60, fight: a.fight, orders: [...a.orders].map((o) => ORDER[o]).join("+"), zone: a.zone, act: a.act });
};
let holdTicks = 0;
const zoneTicks = new Map<string, number>();

for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
  ai.step();
  pai?.step();
  m.step();
  const order = m.army.order[0];
  if (order === Order.Hold) holdTicks++;
  if (dumpAt.includes(m.tick)) {
    for (const t of [0, 1]) {
      const list = upright(m, t).filter((x) => !dumpZone || zone(t, x.x, x.z) === dumpZone);
      console.log(`DUMP ${clock(m.tick)} team ${t} order ${ORDER[m.army.order[t]]} ${list.length} men${dumpZone ? " in " + dumpZone : ""}; breach field reaches gate: ${wayIn(m, t)}`);
      for (const x of list.slice(0, 60)) {
        const rf = m.army.flow.at(routeField(t, x.route), x.x, x.z), bf = m.army.flow.at(breachField(t), x.x, x.z);
        console.log(`  man ${x.id} w${x.wave} ${UNIT[x.unit]} route ${x.route} (${x.x.toFixed(1)},${x.z.toFixed(1)}) ${zone(t, x.x, x.z)} ${ACTION[x.action]} task ${x.task} target ${x.target} v ${Math.hypot(x.vx, x.vz).toFixed(2)} routeCost ${rf >= FLOW_INF ? "INF" : rf} breachCost ${bf >= FLOW_INF ? "INF" : bf}`);
      }
    }
  }
  if (tick % 30 !== 0) continue;
  if (tick % 300 === 0) {
    for (const x of m.world.minions.list) {
      if (x.wave < 0 || x.role !== Role.March) continue;
      const t = x.team;
      if (x.state !== MinionState.Upright) {
        prevD[t].delete(x.id);
        continue;
      }
      const d = Math.hypot(x.x - MUSTER[1 - t].x, x.z - MUSTER[1 - t].z);
      const p = prevD[t].get(x.id);
      prevD[t].set(x.id, d);
      if (p === undefined || x.target >= 0) continue;
      if (d - p > 3) {
        backM[t].set(x.id, (backM[t].get(x.id) ?? 0) + d - p);
        backByOrder[t][m.army.order[t]] += d - p;
      }
    }
  }
  if (tick % 60 === 0) {
    for (const x of m.world.minions.list) {
      if (x.team !== 0 || x.wave < 0 || x.role !== Role.March) continue;
      const a = anchor.get(x.id);
      if (x.state !== MinionState.Upright) {
        if (a) endStall(x.id, m.tick);
        anchor.delete(x.id);
        continue;
      }
      const zn = zone(0, x.x, x.z);
      if (!a || Math.hypot(x.x - a.x, x.z - a.z) > 2 || zn === "foeYard") {
        if (a) endStall(x.id, m.tick);
        anchor.set(x.id, { x: x.x, z: x.z, t: m.tick, fight: false, orders: new Set([order]), zone: zn, act: ACTION[x.action] });
      } else {
        a.orders.add(order);
        if (x.target >= 0 || x.action === 2) a.fight = true;
        a.act = ACTION[x.action];
      }
    }
  }
  for (const x of upright(m, 0)) {
    seen.add(x.id);
    const z = zone(0, x.x, x.z);
    zoneTicks.set(z, (zoneTicks.get(z) ?? 0) + 30);
    if ((z === "foeGate" || z === "foeYard" || x.action === 3) && !reached.has(x.id)) reached.set(x.id, m.tick);
    const still = x.vx * x.vx + x.vz * x.vz < 0.04;
    if (order === Order.Advance && still && (z === "ownMarker" || z === "onBridge") && x.target < 0) stuckAtMarker.set(x.id, (stuckAtMarker.get(x.id) ?? 0) + 30);
  }
  if (tick % (15 * 60) === 0 && !quiet) {
    const a = upright(m, 0), p = upright(m, 1);
    const near = a.filter((x) => ["ownMarker", "onBridge"].includes(zone(0, x.x, x.z)));
    console.log(
      `${clock(m.tick)} AI ${ORDER[order]} (player ${ORDER[m.army.order[1]]}) AI marchers ${a.length}: ${tally(a.map((x) => zone(0, x.x, x.z)))} | at marker/bridge actions: ${tally(near.map((x) => ACTION[x.action] + (x.target >= 0 ? "*" : "")))} | player marchers ${p.length}: ${tally(p.map((x) => zone(1, x.x, x.z)))} | storm ${m.storm[0]}/${m.storm[1]}`,
    );
  }
}
const counts = m.armyCounts();
console.log(`\n=== ai=${aiLevel} player=${player} seed=${seed} secs=${secs} result=${m.result ? JSON.stringify(m.result) : "none"}`);
console.log(`AI waves ${m.waves[0]}, men seen marching ${seen.size}, reached the player's gate or courtyard ${reached.size}; AI on Hold ${(holdTicks / 60).toFixed(0)} s of ${secs}`);
console.log(`AI man-seconds by zone: ${[...zoneTicks.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${(v / 60).toFixed(0)}`).join(" ")}`);
const stuck = [...stuckAtMarker.values()].filter((v) => v >= 20 * 60).length;
console.log(`AI men standing still (no target) at own marker or on a bridge under Advance for 20 s or more: ${stuck}; total man-seconds ${([...stuckAtMarker.values()].reduce((a, b) => a + b, 0) / 60).toFixed(0)}`);
console.log(`standing ${counts.standing} fallen ${counts.fallen}`);
for (const id of anchor.keys()) endStall(id, m.tick);
for (const t of [0, 1]) {
  const v = [...backM[t].values()];
  console.log(`team ${t} walking back (away from the foe gate by over 3 m in 5 s, no target): ${v.filter((q) => q >= 10).length} men walked back 10 m or more, total ${v.reduce((a, b) => a + b, 0).toFixed(0)} m; metres by order then: Advance ${backByOrder[t][0].toFixed(0)}, Hold ${backByOrder[t][1].toFixed(0)}, Push ${backByOrder[t][2].toFixed(0)}`);
}
const sm = (f: (q: (typeof stalls)[number]) => string) => tally(stalls.map(f));
console.log(`AI stalls of 20 s or more (moved under 2 m, outside the player's courtyard): ${stalls.length} (men ${new Set(stalls.map((q) => q.id)).size}), man-seconds ${stalls.reduce((a, q) => a + q.secs, 0).toFixed(0)}`);
console.log(`  by order: ${sm((q) => q.orders)} | by zone: ${sm((q) => q.zone)} | fought during it: ${sm((q) => (q.fight ? "fought" : "no fight"))} | last action: ${sm((q) => q.act)}`);
console.log(`  zone x order (no fight): ${sm((q) => (q.fight ? "" : q.zone + "/" + q.orders)).replace(/^:\d+ ?/, "")}`);
console.log(`AI orders sent (${orderLog.length}):\n  ${orderLog.join("\n  ")}`);
void MinionState;
void Role;
m.free();
