// When and how the gate leaves come loose in an AI v AI match, and what the nav and the fields make of them after.
// npx rolldown tools/army-diag/movement/gates.ts --format esm --platform node -o node_modules/.scratch/diag-move-gates.mjs && node node_modules/.scratch/diag-move-gates.mjs seed=45 secs=40
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, type Difficulty } from "@keepfall/content";
import { breachField, FLOW_INF, navCell, type Rapier } from "@keepfall/sim";
import { Match } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const seed = Number(arg("seed", "45")), secs = Number(arg("secs", "40"));
const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false });
const ais = [0, 1].map((team) => new AiPlayer(m, team, "knight" as Difficulty, seed));
const w = m.world, c = w.castle;
const leaves = c.layout.stones.filter((s) => s.part === "gate");
const was = new Map<number, string>();
const state = (id: number) => (c.shattered[id] ? "gone" : c.frozen[id] ? "settled" : c.dynamic[id] ? "loose" : "fixed");
for (let tick = 0; tick < secs * 60; tick++) {
  for (const ai of ais) ai.step();
  m.step();
  for (const l of w.landings) {
    for (const s of leaves) if (Math.hypot(l.x - s.x, l.z - s.z) < 8) console.log(`${(m.tick / 60).toFixed(2)}s shot from emplacement ${l.emplacement} (auto ${l.auto}) landed at (${l.x.toFixed(1)}, ${l.y.toFixed(1)}, ${l.z.toFixed(1)}), ${Math.hypot(l.x - s.x, l.z - s.z).toFixed(1)} m from gate leaf ${s.id} of castle ${s.castle}`);
  }
  for (const s of leaves) {
    const st = state(s.id);
    if (was.get(s.id) !== st) {
      const t = c.bodies[s.id].translation();
      console.log(`${(m.tick / 60).toFixed(2)}s castle ${s.castle} gate leaf ${s.id}: ${st} at (${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)}) (layout ${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)})`);
      was.set(s.id, st);
    }
  }
  if (m.tick % 300 === 0) {
    const gz = [-16, -135];
    const cells = [0, 1].map((castle) => [-2, -1, 0, 1].map((x) => { const k = navCell(x + 0.5, gz[castle] + 0.5); return `${"GRWSB#"[w.nav.kind[k]]}${w.nav.floor[k].toFixed(1)}`; }).join(" "));
    const way = [0, 1].map((team) => (w.army!.flow.at(breachField(team), 0, team === 0 ? -130.5 : -19.5) < FLOW_INF ? "way in" : "no way"));
    console.log(`${(m.tick / 60).toFixed(0)}s gateway cells castle 0 [${cells[0]}] castle 1 [${cells[1]}]; breach field from the enemy muster: t0 ${way[0]}, t1 ${way[1]}; orders ${m.army.order.join("/")}`);
  }
}
w.free();
