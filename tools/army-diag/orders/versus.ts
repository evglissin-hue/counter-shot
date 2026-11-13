// Versus-AI-like match: an AI castle (team 0) against a player (team 1) who is idle, human-like or a Knight.
// Logs every order the AI sends with the steward's numbers, where the AI's men stand over time, and how many reach the gate.
// npx rolldown tools/army-diag/orders/versus.ts --format esm --platform node -o node_modules/.scratch/diag-orders-versus.mjs && node node_modules/.scratch/diag-orders-versus.mjs ai=knight player=idle secs=360 seed=21
import { buildLayout, GAME_LAYOUT, MUSTER, type Difficulty } from "@keepfall/content";
import { MinionState, Order, Role } from "@keepfall/sim";
import { Match, Team, type MatchInput } from "@keepfall/rules";
import { AiPlayer, marchers, wayIn } from "@keepfall/ai";
import { ACTION, arg, clock, ORDER, R, tally, upright, zone } from "./common";

const aiLevel = arg("ai", "knight") as Difficulty;
const player = arg("player", "idle");
const secs = Number(arg("secs", "360")), seed = Number(arg("seed", "21"));
const quiet = arg("quiet", "0") === "1";

const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false });
const ai = new AiPlayer(m, Team.Enemy, aiLevel, seed);
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
let holdTicks = 0;
const zoneTicks = new Map<string, number>();

for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
  ai.step();
  pai?.step();
  m.step();
  const order = m.army.order[0];
  if (order === Order.Hold) holdTicks++;
  if (tick % 30 !== 0) continue;
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
console.log(`AI orders sent (${orderLog.length}):\n  ${orderLog.join("\n  ")}`);
void MinionState;
void Role;
m.free();
