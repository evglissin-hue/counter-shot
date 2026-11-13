// Is there a way into each castle at the start of a match (the breach fields), and where does it lead?
// npx rolldown tools/army-diag/orders/wayin.ts --format esm --platform node -o node_modules/.scratch/diag-orders-wayin.mjs && node node_modules/.scratch/diag-orders-wayin.mjs
import { buildLayout, GAME_LAYOUT, MUSTER, inCourtyard } from "@keepfall/content";
import { breachField, FLOW_INF, NAV_GRID, routeField } from "@keepfall/sim";
import { Match } from "@keepfall/rules";
import { AiPlayer, wayIn } from "@keepfall/ai";
import { R, arg } from "./common";

const seed = Number(arg("seed", "21"));
const barracks = arg("barracks", "0") === "1";
const at = Number(arg("at", "2"));
const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false, barracks, gunnery: arg("gunnery", "0") === "1" });
const aiName = arg("ai", "");
const ai = aiName ? new AiPlayer(m, 0, aiName as "knight", seed) : null;
const first = [-1, -1];
for (let i = 0; i < at; i++) {
  ai?.step();
  m.step();
  for (const t of [0, 1]) if (first[t] < 0 && wayIn(m, t)) first[t] = m.tick;
}
console.log("first tick wayIn true per team", first, "shots", m.shots, "auto", m.autoShots, "dynamic stones by castle", [0, 1].map((c) => tallyParts(m, c)), "nav topo", m.world.nav.topo, "flow builds", m.army.flow.builds);
const f = m.army.flow;
for (const team of [0, 1]) {
  const b = breachField(team);
  const g = MUSTER[1 - team];
  console.log(`team ${team}: wayIn=${wayIn(m, team)} breach cost at foe muster ${f.at(b, g.x, g.z)} at -12 ${f.at(b, g.x - 12, g.z)} at +12 ${f.at(b, g.x + 12, g.z)}; route field (centre) cost ${f.at(routeField(team, 1), g.x, g.z)}`);
  // Trace the breach field from the foe muster for up to 400 steps of 0.5 m.
  for (const sx of [0, -12, 12]) {
    let x = g.x + sx, z = g.z;
    const dir: [number, number] = [0, 0];
    const path: string[] = [];
    let k = 0;
    for (; k < 400; k++) {
      if (inCourtyard(1 - team, x, z)) break;
      if (!f.dir(b, x, z, dir)) break;
      x += dir[0] * 0.5;
      z += dir[1] * 0.5;
      if (k % 10 === 0) path.push(`(${x.toFixed(1)},${z.toFixed(1)})`);
    }
    console.log(`  from x${sx >= 0 ? "+" : ""}${sx}: ${k} steps, ends (${x.toFixed(1)},${z.toFixed(1)}) inYard=${inCourtyard(1 - team, x, z)} cost ${f.at(b, x, z)}: ${path.join(" ")}`);
  }
}
void FLOW_INF;
void NAV_GRID;
m.free();
function tallyParts(mm: Match, c: number): string {
  const t = new Map<string, number>();
  for (const st of mm.world.castle.layout.stones) if (st.castle === c && mm.world.castle.dynamic[st.id]) t.set(st.part, (t.get(st.part) ?? 0) + 1);
  return [...t.entries()].map(([k, v]) => `${k}:${v}`).join(" ");
}
