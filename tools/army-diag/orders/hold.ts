// Hold: do waves stop at their route's marker and stay there as more waves stack up? And Hold given late (men at the enemy gate).
// npx rolldown tools/army-diag/orders/hold.ts --format esm --platform node -o node_modules/.scratch/diag-orders-hold.mjs && node node_modules/.scratch/diag-orders-hold.mjs sc=stack route=centre seed=21
//   sc=stack: both teams on Hold from the start on `route`, no gunnery; 300 s of waves stacking at the markers.
//   sc=late: both on Advance (player on `route`, enemy on the opposite flank); the player is given Hold at `at` s (default 100).
import { buildLayout, GAME_LAYOUT, ROUTE_NAMES, type RouteName } from "@keepfall/content";
import { MinionState, Order, Role, type Minion } from "@keepfall/sim";
import { Match, Team } from "@keepfall/rules";
import { ACTION, arg, clock, HOLD, R, tally, zone, ROLE } from "./common";

const sc = arg("sc", "stack");
const seed = Number(arg("seed", "21"));
const route = arg("route", "centre") as RouteName;
const ri = ROUTE_NAMES.indexOf(route);
const secs = Number(arg("secs", sc === "stack" ? "300" : "180"));
const at = Number(arg("at", "100")) * 60;
const other: RouteName = route === "left" ? "right" : route === "right" ? "left" : "left";
const m = new Match(R, buildLayout(1, GAME_LAYOUT), {
  seed, plan: false, rotate: false, gunnery: false,
  orders: sc === "stack" ? [Order.Hold, Order.Hold] : [Order.Advance, Order.Advance],
  routes: sc === "stack" ? [route, route] : [other, route],
});
if (sc === "late") m.queue(at, Team.Player, { kind: "order", order: Order.Hold });

/** Signed metres past a man's hold line (positive: towards the enemy), and distance to his marker. */
const past = (x: Minion) => {
  const h = HOLD[x.team][x.route];
  return x.team === 1 ? x.z - h.z : h.z - x.z;
};
const toMarker = (x: Minion) => Math.hypot(x.x - HOLD[x.team][x.route].x, x.z - HOLD[x.team][x.route].z);
interface Rec { arrive: number; samples: Array<[number, number, number]>; moving: number; after: number; path: number; px: number; pz: number }
const rec = new Map<number, Rec>();

const lateStart = new Map<number, { past: number; zone: string; action: string }>();
for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
  m.step();
  const list = m.world.minions.list.filter((x) => x.state === MinionState.Upright && x.role === Role.March && x.wave >= 0);
  if (sc === "late" && m.tick === at + 1) {
    for (const x of list) if (x.team === 1) lateStart.set(x.id, { past: past(x), zone: zone(1, x.x, x.z), action: ACTION[x.action] });
    console.log(`${clock(m.tick)} Hold given: ${lateStart.size} men out; past their line: ${[...lateStart.values()].filter((v) => v.past > 1.5).length}; where ${tally([...lateStart.values()].map((v) => v.zone + "/" + v.action))}`);
  }
  if (m.army.order[1] !== Order.Hold) continue;
  for (const x of list) {
    let r = rec.get(x.id);
    const p = past(x);
    if (!r) {
      if (p > -2 && p < 2.5 && toMarker(x) < 15) {
        r = { arrive: m.tick, samples: [], moving: 0, after: 0, path: 0, px: x.x, pz: x.z };
        rec.set(x.id, r);
      }
      continue;
    }
    r.path += Math.hypot(x.x - r.px, x.z - r.pz);
    r.px = x.x;
    r.pz = x.z;
    if ((m.tick - r.arrive) % 60 === 0) {
      r.after++;
      if (x.vx * x.vx + x.vz * x.vz > 0.09) r.moving++;
    }
    for (const s of [30, 60, 120]) if (m.tick - r.arrive === s * 60) r.samples.push([s, toMarker(x), p]);
  }
  if (tick % (30 * 60) === 0 && tick > 0) {
    for (const t of sc === "stack" ? [0, 1] : [1]) {
      const mine = list.filter((x) => x.team === t);
      const arrived = mine.filter((x) => rec.has(x.id));
      const near = arrived.filter((x) => toMarker(x) < 6).length;
      const pastLine = mine.filter((x) => past(x) > 1.5).length;
      const walking = arrived.filter((x) => x.vx * x.vx + x.vz * x.vz > 0.09).length;
      const spread = arrived.length ? Math.max(...arrived.map((x) => Math.abs(x.x - HOLD[t][x.route].x))) : 0;
      const depth = arrived.length ? Math.max(...arrived.map((x) => Math.abs(past(x)))) : 0;
      console.log(`${clock(m.tick)} team ${t} ${["Adv", "Hold", "Push"][m.army.order[t]]}: ${mine.length} out, ${arrived.length} arrived; within 6 m of marker ${near}, past line >1.5 m ${pastLine}, arrived and walking ${walking}; spread across ${spread.toFixed(1)} m, depth ${depth.toFixed(1)} m; actions ${tally(arrived.map((x) => ACTION[x.action]))}; not arrived: ${tally(mine.filter((x) => !rec.has(x.id)).map((x) => zone(t, x.x, x.z) + "/" + ACTION[x.action] + "/" + ROLE[x.role]))}`);
    }
  }
}
// Per-man summary for the player's team (and the enemy's on stack).
for (const t of sc === "stack" ? [0, 1] : [1]) {
  const rs = [...rec.entries()].filter(([id]) => m.world.minions.list[id].team === t);
  for (const s of [30, 60, 120]) {
    const v = rs.map(([, r]) => r.samples.find((q) => q[0] === s)).filter((q): q is [number, number, number] => !!q);
    if (!v.length) continue;
    const in6 = v.filter((q) => q[1] < 6).length, in3 = v.filter((q) => q[1] < 3).length;
    const mean = v.reduce((a, q) => a + q[1], 0) / v.length;
    console.log(`team ${t} +${s} s after reaching the line: ${v.length} men, within 3 m of marker ${in3}, within 6 m ${in6}, mean distance ${mean.toFixed(1)} m, max ${Math.max(...v.map((q) => q[1])).toFixed(1)} m`);
  }
  const mov = rs.filter(([, r]) => r.after >= 30);
  const share = mov.reduce((a, [, r]) => a + r.moving / r.after, 0) / Math.max(1, mov.length);
  const pathPerMin = mov.reduce((a, [, r]) => a + (r.path / r.after) * 60, 0) / Math.max(1, mov.length);
  console.log(`team ${t}: of ${mov.length} men held 30 s or more, mean share of seconds walking (>0.3 m/s) ${(share * 100).toFixed(0)}%, mean metres walked per minute while holding ${pathPerMin.toFixed(1)}`);
}
if (sc === "late") {
  let back = 0, stay = 0;
  const stayers: string[] = [];
  for (const [id, s] of lateStart) {
    const x = m.world.minions.list[id];
    if (x.state !== MinionState.Upright) continue;
    const r = rec.get(id);
    if (r) back++;
    else {
      stay++;
      stayers.push(`man ${id} was ${s.zone}/${s.action} past ${s.past.toFixed(1)}; now ${zone(1, x.x, x.z)} ${ACTION[x.action]} task ${x.task} target ${x.target} past ${past(x).toFixed(1)}`);
    }
  }
  console.log(`late Hold: of the men out when it was given and still up, ${back} reached their line, ${stay} never did`);
  for (const s of stayers.slice(0, 20)) console.log("  " + s);
  const times = [...lateStart.keys()].map((id) => rec.get(id)?.arrive).filter((v): v is number => v !== undefined).map((v) => (v - at) / 60).sort((a, b) => a - b);
  if (times.length) console.log(`seconds from Hold to reaching the line: median ${times[Math.floor(times.length / 2)].toFixed(0)}, max ${times[times.length - 1].toFixed(0)}`);
}
m.free();
