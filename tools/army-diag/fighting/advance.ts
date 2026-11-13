// Fighting diagnosis, the owner's Advance complaint first: on Advance, do the
// men engage the enemy minions they meet and fight their way on to the gate?
// Scripted scenarios (barracks off, guns off), each from either side.
// npx rolldown tools/army-diag/fighting/advance.ts --format esm --platform node -o node_modules/.scratch/diag-fight-advance.mjs && node node_modules/.scratch/diag-fight-advance.mjs sc=field atk=1 seed=7 secs=60
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, holdMarker, inCourtyard, mirrorZ, ROUTE_NAMES, Unit, type RouteName } from "@keepfall/content";
import { MinionState, Order, routeField, type Rapier } from "@keepfall/sim";
import { Match } from "@keepfall/rules";
import { census, Probe, roadX } from "./probe";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const sc = arg("sc", "field");
const atk = Number(arg("atk", "1")) as 0 | 1;
const def = (1 - atk) as 0 | 1;
const seed = Number(arg("seed", "7"));
const secs = Number(arg("secs", "60"));
const route = arg("route", "centre") as RouteName;
const ri = ROUTE_NAMES.indexOf(route);
const mix = arg("mix", "pikemen");
const UNITS_OF: Record<string, number[]> = {
  pikemen: [0, 0, 0, 0, 0, 0, 0, 0],
  volley: [0, 0, 0, 0, Unit.Musketeer, 0, Unit.Musketeer, Unit.Musketeer],
  mixed: [0, 0, 0, 0, Unit.Sapper, Unit.Musketeer, Unit.Musketeer, Unit.Sapper],
};
const garrison = arg("garrison", "1") === "1";
const masons = arg("masons", "1") === "1";

const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false, barracks: false, gunnery: false, garrison, masons });
const army = m.army;
/** World z at d metres out from castle c's centre on its field side. */
const out = (c: number, d: number) => mirrorZ(c, -d);
const at = (name: RouteName, z: number) => ({ x: roadX(name, z), z });
const P = new Probe(m);
const waveOf = new Map<number, string>();
const spawn = (team: 0 | 1, r: number, units: number[], pos?: { x: number; z: number }, opts = {}) => {
  const first = m.world.minions.list.length;
  const n = army.spawnMix(team, r, units, 0, pos, opts);
  for (let k = first; k < first + n; k++) waveOf.set(k, `t${team}`);
  return n;
};

// Per scenario: setup at tick 0 and events by tick.
const events: Array<[number, () => void]> = [];
let note = "";
switch (sc) {
  case "field": {
    // Same road, meeting in the field on the defender's half: the attacker crosses first.
    spawn(atk, ri, UNITS_OF[mix], at(route, out(def, 62)));
    spawn(def, ri, UNITS_OF.pikemen, at(route, out(def, 28)));
    note = `attacker t${atk} from ${out(def, 62).toFixed(0)}, t${def} from ${out(def, 28).toFixed(0)} on ${route}`;
    break;
  }
  case "bridge": {
    // Same road, meeting at the bridge.
    spawn(atk, ri, UNITS_OF[mix], at(route, out(atk, 50)));
    spawn(def, ri, UNITS_OF.pikemen, at(route, out(def, 50)));
    note = `both 25 m short of the ${route} bridge`;
    break;
  }
  case "hold": {
    // The defender's wave holds at its marker; the attacker advances into it.
    army.setOrder(def, Order.Hold);
    spawn(def, ri, UNITS_OF.pikemen, at(route, out(def, 50)));
    events.push([20 * 60, () => spawn(atk, ri, UNITS_OF[mix], at(route, out(atk, 50)))]);
    const hm = holdMarker(def, route);
    note = `t${def} holds at (${hm.x.toFixed(0)}, ${hm.z.toFixed(1)}); t${atk} advances from 20 s`;
    break;
  }
  case "adjacent": {
    // Different roads: the attacker on the given road, the defender on the centre (or left if route is centre), both from their musters.
    const other = route === "centre" ? 0 : 1;
    spawn(atk, ri, UNITS_OF[mix]);
    spawn(def, other, UNITS_OF.pikemen);
    note = `t${atk} on ${route}, t${def} on ${ROUTE_NAMES[other]}, from their musters`;
    break;
  }
  case "muster": {
    // The attacker comes up the road to the enemy gate while the enemy musters a wave outside it (same road, or `other=1` another road).
    const other = arg("other", "0") === "1" ? (ri === 1 ? 2 : 1) : ri;
    spawn(atk, ri, UNITS_OF[mix], at(route, out(def, 50)));
    const when = Number(arg("when", "12"));
    events.push([when * 60, () => spawn(def, other, UNITS_OF.pikemen)]);
    note = `t${atk} from 50 m out; t${def} musters at its gate at ${when} s on ${ROUTE_NAMES[other]}`;
    break;
  }
  case "gate": {
    // An unopposed wave (or two) at the enemy gate, against the garrison (and with `inside=1` a wave the defender musters inside once the courtyard is entered).
    const n = Number(arg("waves", "1"));
    for (let k = 0; k < n; k++) spawn(atk, 1, UNITS_OF[mix], at("centre", out(def, 42 + 6 * k)));
    note = `${n} wave(s) of t${atk} from 42 m out of castle ${def}; garrison ${garrison}`;
    break;
  }
  case "breach": {
    // As the siege test: the player's long gun opens the enemy front wall west of the gate, then waves come up (atk=1 only).
    if (atk !== 1) throw new Error("breach: atk=1 only");
    const fire = (yaw: number) => ({ kind: "fire" as const, emplacement: 0, yaw, pitch: -0.022, charge: 1, fuse: 0, spin: 0 as never });
    m.queue(0, 1, { kind: "man", emplacement: 0 });
    m.queue(5, 1, fire(-0.0707));
    m.queue(260, 1, fire(-0.0624));
    const order = arg("order", "push");
    if (order !== "advance") m.queue(300, 1, { kind: "order", order: Order.Push });
    const n = Number(arg("waves", "2"));
    events.push([400, () => {
      for (let k = 0; k < n; k++) spawn(1, 1, UNITS_OF[mix], { x: -6, z: -30 - 6 * k });
    }]);
    note = `breach west of castle 0's gate, ${n} waves at 6.7 s, order ${order}`;
    break;
  }
  default:
    throw new Error("unknown sc " + sc);
}

console.log(`# ${sc} seed ${seed} atk t${atk} ${mix} ${note}`);
const insideMuster = arg("inside", "0") === "1";
let mustered = false;
let gateDown = -1;
const leaves = m.world.castle.layout.stones.filter((s) => s.castle === def && s.part === "gate").map((s) => s.id);
let minGap = Infinity;
let insideMax = 0;
let stormMax = 0;
const garrIdleOutside = { ticks: 0 };
const shots = [0, 0];
const gateStones = m.world.castle.layout.stones.filter((s) => s.castle === def && s.part === "gate");
const gz = gateStones.reduce((a, s) => a + s.z, 0) / (gateStones.length || 1);
/** Attacker man-ticks within 10 m of the enemy gate on the field side while it stands: battering, stuck (Stand or Walk under 0.15 m/s), moving, fighting. */
const crowd = { batter: 0, stuck: 0, moving: 0, fight: 0, ticks: 0, maxStuck: 0 };
for (let i = 0; i < secs * 60 && !m.result; i++) {
  for (const [tk, f] of events) if (tk === i) f();
  if (insideMuster && !mustered && army.attackers[def] > 0) {
    mustered = true;
    spawn(def, 1, UNITS_OF.pikemen, undefined, { inside: true });
    P.log(m.tick, `t${def} musters a wave inside (attackers ${army.attackers[def]})`);
  }
  m.step();
  P.after();
  if (gateDown < 0 && leaves.length && leaves.every((id) => m.world.castle.dynamic[id] === 1)) {
    gateDown = m.tick;
    P.log(m.tick, `gate of castle ${def} down; blows ${leaves.map((id) => army.gateHits.get(id)).join("/")}`);
  }
  if (army.attackers[def] > insideMax) insideMax = army.attackers[def];
  if (m.storm[def] > stormMax) stormMax = m.storm[def];
  // Opposing soldiers' least distance (any).
  const L = m.world.minions.list;
  for (const a of L) {
    if (a.team !== atk || a.state !== MinionState.Upright || a.wave < 0) continue;
    for (const b of L) if (b.team === def && b.state === MinionState.Upright && b.wave >= 0 && b.role !== 3 && b.role !== 5) {
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < minGap) minGap = d;
    }
  }
  if (gateDown < 0) {
    let st = 0, any = false;
    for (const a of L) {
      if (a.team !== atk || a.state !== MinionState.Upright || a.wave < 0 || a.role === 3) continue;
      const out = (a.z - gz) * (def === 0 ? -1 : 1);
      if (out < 0 || out > 10 || Math.abs(a.x) > 8) continue;
      any = true;
      if (a.action === 3) crowd.batter++;
      else if (a.action === 2) crowd.fight++;
      else if (a.action === 1 || Math.hypot(a.vx, a.vz) < 0.15) {
        crowd.stuck++;
        st++;
      } else crowd.moving++;
    }
    if (any) crowd.ticks++;
    if (st > crowd.maxStuck) crowd.maxStuck = st;
  }
  // The garrison idle while the gate is battered.
  const battering = L.some((a) => a.team === atk && a.state === MinionState.Upright && a.action === 3);
  if (battering) garrIdleOutside.ticks++;
  for (const x of L) if (x.unit === Unit.Musketeer && x.state === MinionState.Upright && x.action === 9 && x.act === 1) shots[x.team]++;
  if (arg("watch", "") === "musket" && (i + 1) % (5 * 60) === 0) {
    for (const x of L) if (x.unit === Unit.Musketeer && x.state === MinionState.Upright) {
      const t = x.target >= 0 ? L[x.target] : null;
      console.log(`    musket #${x.id} t${x.team} at (${x.x.toFixed(1)},${x.z.toFixed(1)}) act ${x.action} mark ${t ? `#${t.id} (${t.x.toFixed(1)},${t.z.toFixed(1)}) d=${Math.hypot(t.x - x.x, t.z - x.z).toFixed(1)} ${t.state === 0 ? "up" : "down"}` : "-"} shots so far t0 ${shots[0]} t1 ${shots[1]}`);
    }
  }
  if ((i + 1) % (10 * 60) === 0) console.log(`  t=${((i + 1) / 60).toFixed(0)}s t${atk}: ${census(m, atk)} | t${def}: ${census(m, def)} | attackers in ${def}: ${army.attackers[def]} defenders ${army.defenders[def]} storm ${m.storm[def]}`);
}
P.finish();
console.log(P.summary(`${sc} atk t${atk}`));
// Where the attacker's survivors are and how far they are from the goal.
const surv = m.world.minions.list.filter((x) => x.team === atk && x.state === MinionState.Upright && x.wave >= 0 && x.role === 0);
const costs = surv.map((x) => (army.flow.at(routeField(x.team, x.route), x.x, x.z) / 10).toFixed(0));
console.log(`  attacker survivors ${surv.length} (march role), metres to goal: ${costs.join(",")}; inside enemy courtyard ${surv.filter((x) => inCourtyard(def, x.x, x.z)).length}`);
if (crowd.ticks) console.log(`  at the gate (within 10 m outside, while it stands, ${(crowd.ticks / 60).toFixed(1)} s): battering ${(crowd.batter / 60).toFixed(1)} man-s, stuck/standing ${(crowd.stuck / 60).toFixed(1)} man-s (most at once ${crowd.maxStuck}), moving ${(crowd.moving / 60).toFixed(1)}, fighting ${(crowd.fight / 60).toFixed(1)}; batter ticks ${garrIdleOutside.ticks}`);
console.log(`  musket shots t0 ${shots[0]} t1 ${shots[1]}`);
console.log(`  least gap between the sides ${minGap.toFixed(1)} m; gate down ${gateDown >= 0 ? (gateDown / 60).toFixed(1) + "s" : "no"}; attackers inside max ${insideMax}; storm max ${(stormMax / 60).toFixed(1)}s; result ${m.result ? JSON.stringify(m.result) : "none"}`);
m.free();
