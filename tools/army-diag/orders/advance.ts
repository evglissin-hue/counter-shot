// Advance obedience: men already out (holding at a marker, after a fight, the guided match's waves on the left flank)
// are given Advance; per man, the ticks until he walks toward the enemy gate and how far he got 20 s later.
// npx rolldown tools/army-diag/orders/advance.ts --format esm --platform node -o node_modules/.scratch/diag-orders-advance.mjs && node node_modules/.scratch/diag-orders-advance.mjs sc=marker seed=21
//   sc=marker: both teams on Hold (player left flank, enemy right flank), no gunnery; player Advance at 75 s, enemy Advance at 140 s.
//   sc=guided: the guided match (tutor), the player's waves on Hold on the left flank; Advance at 2:00 as the guided script does.
//   sc=fight: both on the centre road on Hold; enemy Advance at 40 s (walks into the player's held men), player Advance at 100 s.
import { buildLayout, GAME_LAYOUT, MUSTER } from "@keepfall/content";
import { MinionState, Order, Role, routeField, FLOW_INF, type Minion } from "@keepfall/sim";
import { GUIDED_OPTIONS, Match, Team, TUTOR_TEAM, type MatchOptions } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";
import { ACTION, arg, clock, ORDER, R, ROLE, tally, UNIT, zone } from "./common";

const sc = arg("sc", "marker");
const seed = Number(arg("seed", "21"));
const secs = Number(arg("secs", sc === "guided" ? "200" : "200"));

let opts: MatchOptions;
let events: Array<[number, Team, Order]>;
if (sc === "guided") {
  opts = { ...GUIDED_OPTIONS, seed };
  events = [[120 * 60, Team.Player, Order.Advance]];
} else if (sc === "fight") {
  opts = { seed, plan: false, rotate: false, gunnery: false, orders: [Order.Hold, Order.Hold], routes: ["centre", "centre"] };
  events = [[40 * 60, Team.Enemy, Order.Advance], [100 * 60, Team.Player, Order.Advance]];
} else {
  opts = { seed, plan: false, rotate: false, gunnery: false, orders: [Order.Hold, Order.Hold], routes: ["right", "left"] };
  events = [[75 * 60, Team.Player, Order.Advance], [140 * 60, Team.Enemy, Order.Advance]];
}
const m = new Match(R, buildLayout(1, GAME_LAYOUT), opts);
const tutor = sc === "guided" ? new AiPlayer(m, TUTOR_TEAM, "tutor", seed) : null;
if (sc === "guided") m.queue(0, Team.Player, { kind: "man", emplacement: 0 });
for (const [t, team, order] of events) m.queue(t, team, { kind: "order", order });

const flow = m.army.flow;
const cost = (x: Minion) => flow.at(routeField(x.team, x.route), x.x, x.z);
const gateD = (x: Minion) => Math.hypot(x.x - MUSTER[1 - x.team].x, x.z - MUSTER[1 - x.team].z);
const dirOut: [number, number] = [0, 0];

interface Watch {
  team: Team;
  t0: number;
  men: Map<number, { c0: number; g0: number; resp: number; z0: string; act0: string }>;
}
const watches: Watch[] = [];

for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
  tutor?.step();
  const ev = events.find((e) => e[0] === tick);
  m.step();
  if (ev) {
    const [, team] = ev;
    const men = new Map<number, { c0: number; g0: number; resp: number; z0: string; act0: string }>();
    for (const x of m.world.minions.list) {
      if (x.team !== team || x.state !== MinionState.Upright || x.wave < 0 || x.role !== Role.March) continue;
      men.set(x.id, { c0: cost(x), g0: gateD(x), resp: -1, z0: zone(team, x.x, x.z), act0: ACTION[x.action] });
    }
    watches.push({ team, t0: m.tick, men });
    console.log(`${clock(m.tick)} team ${team} given ${ORDER[ev[2]]} (order now ${ORDER[m.army.order[team]]}): ${men.size} marching men out, where: ${tally([...men.values()].map((v) => v.z0))}; doing: ${tally([...men.values()].map((v) => v.act0))}`);
  }
  for (const w of watches) {
    const dt = m.tick - w.t0;
    if (dt > 20 * 60) continue;
    for (const [id, s] of w.men) {
      const x = m.world.minions.list[id];
      if (s.resp >= 0 || x.state !== MinionState.Upright) continue;
      const f = routeField(x.team, x.route);
      if (!flow.dir(f, x.x, x.z, dirOut)) continue;
      const v = x.vx * dirOut[0] + x.vz * dirOut[1];
      if (v > 0.5 * x.speed) s.resp = dt;
    }
    if (dt === 20 * 60) {
      const resp: number[] = [];
      const lag: string[] = [];
      let down = 0;
      for (const [id, s] of w.men) {
        const x = m.world.minions.list[id];
        if (x.state !== MinionState.Upright) {
          down++;
          continue;
        }
        if (s.resp >= 0) resp.push(s.resp);
        const c1 = cost(x);
        const prog = c1 >= FLOW_INF || s.c0 >= FLOW_INF ? NaN : (s.c0 - c1) / 10;
        const gprog = s.g0 - gateD(x);
        if (!(prog >= 10)) {
          const t = x.target >= 0 ? m.world.minions.list[x.target] : null;
          lag.push(
            `  man ${id} ${UNIT[x.unit]} role ${ROLE[x.role]} task ${x.task} action ${ACTION[x.action]} target ${x.target}${t ? ` (${t.state === MinionState.Upright ? "up" : "down"} ${Math.hypot(t.x - x.x, t.z - x.z).toFixed(1)} m)` : ""} route ${x.route} cost ${s.c0}->${c1} (${prog.toFixed(1)} m along) gate dist ${s.g0.toFixed(1)}->${gateD(x).toFixed(1)} at (${x.x.toFixed(1)},${x.z.toFixed(1)}) ${zone(x.team, x.x, x.z)} was ${s.z0}/${s.act0} responded ${s.resp >= 0 ? s.resp + " ticks" : "never"}`,
          );
        }
      }
      resp.sort((a, b) => a - b);
      const med = resp.length ? resp[Math.floor(resp.length / 2)] : -1;
      console.log(`${clock(m.tick)} team ${w.team}, 20 s after the order: ${w.men.size} men, ${down} down since; responded ${resp.length} (median ${med} ticks, max ${resp.length ? resp[resp.length - 1] : -1}); under 10 m along the route: ${lag.length}`);
      for (const l of lag) console.log(l);
    }
  }
  if (tick % (10 * 60) === 0) {
    const line = [0, 1].map((t) => {
      const up = m.world.minions.list.filter((x) => x.team === t && x.state === MinionState.Upright && x.role === Role.March);
      return `team ${t} ${ORDER[m.army.order[t]]} ${up.length}: ${tally(up.map((x) => zone(t, x.x, x.z) + "/" + ACTION[x.action]))}`;
    });
    console.log(`${clock(m.tick)} ${line.join(" || ")}`);
  }
}
m.free();
