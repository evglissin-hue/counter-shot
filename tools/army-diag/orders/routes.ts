// Routes: which road does a wave sent "left" from each castle take, and does a route input move waves already out?
// npx rolldown tools/army-diag/orders/routes.ts --format esm --platform node -o node_modules/.scratch/diag-orders-routes.mjs && node node_modules/.scratch/diag-orders-routes.mjs seed=21
// Both teams on Advance down "left"; at 20 s both send route "right" (the first waves are out by then). No gunnery.
// blow=1: at 30 s the left bridge's deck is removed (its pieces knocked loose) to see a marching wave reroute.
import { buildLayout, GAME_LAYOUT, ROUTE_NAMES } from "@keepfall/content";
import { MinionState, Order, Role } from "@keepfall/sim";
import { Match, Team } from "@keepfall/rules";
import { arg, clock, HOLD, R, tally } from "./common";

const seed = Number(arg("seed", "21"));
const blow = arg("blow", "0") === "1";
const order = arg("order", "advance") === "hold" ? Order.Hold : Order.Advance;
const secs = Number(arg("secs", "100"));
const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false, gunnery: false, orders: [order, order], routes: ["left", "left"] });
m.queue(20 * 60, Team.Enemy, { kind: "route", route: "right" });
m.queue(20 * 60, Team.Player, { kind: "route", route: "right" });

/** Per man: x where he first crossed the stream line (z = -75), or the farthest he got. */
const crossed = new Map<number, number>();
const waveOf = new Map<number, number>();
const startRoute = new Map<number, number>();
for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
  if (blow && tick === 30 * 60) {
    // Knock every deck plank and stringer of the left bridge loose (it falls into the stream).
    const L = m.world.castle.layout;
    let n = 0;
    for (const s of L.stones) {
      if (s.part !== "bridge") continue;
      if (Math.abs(s.x - 48) > 3) continue;
      if (m.world.castle.knockLoose(s.id, 0, -0.5, 0)) n++;
    }
    console.log(`${clock(m.tick)} left bridge: ${n} pieces knocked loose`);
  }
  m.step();
  for (const x of m.world.minions.list) {
    if (x.wave < 0 || x.role !== Role.March || x.state !== MinionState.Upright) continue;
    if (!waveOf.has(x.id)) {
      waveOf.set(x.id, x.wave);
      startRoute.set(x.id, x.route);
    }
    if (crossed.has(x.id)) continue;
    const across = x.team === 1 ? x.z > -75 : x.z < -75;
    if (across) crossed.set(x.id, x.x);
  }
  if (tick % (10 * 60) === 0 && tick > 0) {
    const up = m.world.minions.list.filter((x) => x.wave >= 0 && x.role === Role.March && x.state === MinionState.Upright);
    console.log(`${clock(m.tick)} bridges open ${m.army.bridgeOpen.map((b) => (b ? 1 : 0)).join("")} ` + [0, 1].map((t) => `team ${t}: ${tally(up.filter((x) => x.team === t).map((x) => `w${x.wave}/${ROUTE_NAMES[x.route]}@x${Math.round(x.x / 8) * 8}`))}`).join(" || "));
  }
}
const side = (x: number) => (x > 24 ? "+x (match 'left')" : x < -24 ? "-x (match 'right')" : "centre");
const waves = new Map<number, number[]>();
for (const [id, w] of waveOf) {
  if (!waves.has(w)) waves.set(w, []);
  waves.get(w)!.push(id);
}
for (const [w, ids] of [...waves.entries()].sort((a, b) => a[0] - b[0])) {
  const x0 = m.world.minions.list[ids[0]];
  console.log(`wave ${w} team ${x0.team} sent down ${ROUTE_NAMES[startRoute.get(ids[0])!]}, route now ${ROUTE_NAMES[x0.route]}: crossed by ${tally(ids.map((id) => (crossed.has(id) ? side(crossed.get(id)!) : "not yet")))} (team ${x0.team}'s own left is ${x0.team === 1 ? "+x" : "-x"})`);
}
void HOLD;
m.free();
