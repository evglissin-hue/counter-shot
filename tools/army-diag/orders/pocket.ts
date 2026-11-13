// Men standing in front of their own gate whatever the order: their cell is cut off from their route's flow field (cost INF).
// Replays the Knight AI v defensive gunner match (versus.ts ai=knight player=gunhold) and, every 5 s, counts each team's
// marching men whose route field cost is INF; at `map` s (or when first 8 or more are cut off) prints the nav around them.
// npx rolldown tools/army-diag/orders/pocket.ts --format esm --platform node -o node_modules/.scratch/diag-orders-pocket.mjs && node node_modules/.scratch/diag-orders-pocket.mjs seed=21 secs=300
import { buildLayout, GAME_LAYOUT, MUSTER } from "@keepfall/content";
import { breachField, FLOW_INF, MinionState, NAV_GRID, navCell, Order, Role, routeField } from "@keepfall/sim";
import { Match, Team, type MatchInput } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";
import { ACTION, arg, clock, ORDER, R, tally, zone } from "./common";

const seed = Number(arg("seed", "21"));
const secs = Number(arg("secs", "300"));
const player = arg("player", "gunhold");
const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false });
const ai = new AiPlayer(m, Team.Enemy, "knight", seed);
const pai = new AiPlayer(m, Team.Player, "knight", seed + 1);
const q = m.queue.bind(m);
m.queue = (tick: number, team: Team, input: MatchInput) => {
  if (player.startsWith("gun") && team === Team.Player && (input.kind === "order" || input.kind === "route" || input.kind === "barracks")) return;
  q(tick, team, input);
};
if (player === "gunhold") q(30 * 60, Team.Player, { kind: "order", order: Order.Hold });

const nav = m.world.nav;
const KIND = "GRWSBr";
let mapped = [false, false];
const firstCut = [-1, -1];
function map(team: number) {
  const g = MUSTER[team];
  const flow = m.army.flow;
  const f = routeField(team, 1);
  console.log(`MAP ${clock(m.tick)} around team ${team}'s muster (${g.x}, ${g.z}); rows by z (the field side first), cells 1 m; letter = nav kind (G ground, R raised, W water, S steep, B blocked, r rubble), lower case where the centre route field is INF, digits = men of the team standing there; floor heights below`);
  const rows: string[] = [];
  const zs: number[] = [];
  for (let dz = 18; dz >= -10; dz--) zs.push(team === 0 ? g.z - dz : g.z + dz);
  for (const z of zs) {
    let line = "", fl = "";
    for (let x = g.x - 14; x <= g.x + 14; x++) {
      const c = navCell(x + 0.5, z + 0.5);
      const men = m.world.minions.list.filter((n) => n.team === team && n.state === MinionState.Upright && navCell(n.x, n.z) === c && n.role === Role.March).length;
      const k = KIND[nav.kind[c]] ?? "?";
      const inf = flow.at(f, x + 0.5, z + 0.5) >= FLOW_INF;
      line += men ? String(Math.min(9, men)) : inf ? (k === "r" ? "~" : k.toLowerCase()) : k;
      fl += (nav.floor[c] >= 0 ? "+" : "-") + Math.min(9, Math.round(Math.abs(nav.floor[c]) * 2)).toString();
    }
    rows.push(`z ${z.toFixed(0).padStart(5)} ${line}   ${fl}`);
  }
  console.log(rows.join("\n"));
  void NAV_GRID;
}
for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
  ai.step();
  pai.step();
  m.step();
  if (tick % 300 !== 0) continue;
  for (const t of [0, 1]) {
    const cut = m.world.minions.list.filter((x) => x.team === t && x.state === MinionState.Upright && x.role === Role.March && x.wave >= 0 && m.army.flow.at(routeField(t, x.route), x.x, x.z) >= FLOW_INF);
    if (cut.length && tick % 1800 === 0) console.log(`${clock(m.tick)} team ${t} (${ORDER[m.army.order[t]]}) men cut off from their route field: ${cut.length}: ${tally(cut.map((x) => zone(t, x.x, x.z) + "/" + ACTION[x.action]))}; breach field also INF for ${cut.filter((x) => m.army.flow.at(breachField(t), x.x, x.z) >= FLOW_INF).length}; nav topo ${nav.topo}`);
    if (cut.length >= 8 && firstCut[t] < 0) {
      firstCut[t] = m.tick;
      console.log(`${clock(m.tick)} FIRST: team ${t} has ${cut.length} men cut off: ${tally(cut.map((x) => zone(t, x.x, x.z) + "/" + ACTION[x.action]))}`);
    }
    if (!mapped[t] && firstCut[t] >= 0 && m.tick - firstCut[t] >= 600) {
      mapped[t] = true;
      map(t);
    }
  }
}
console.log(`first cut off (8+ men): ${firstCut.map((v) => (v < 0 ? "never" : clock(v))).join(", ")}`);
mapped = [false, false];
for (const t of [0, 1]) map(t);
m.free();
