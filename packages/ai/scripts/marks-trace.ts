// Where the AI's marks lie, and whether they feed the keep fight (3.2, A2).
// Plays Knight against Knight (either castle may be tweaked) and prints, per castle: marks made by place (gate or wall of
// the enemy keep, its own gate, road or field), the seconds its waves were within 30 m of the enemy gate with a gate or
// wall mark held, salvos ordered with their guns and the kind of mark, and the hand shots by aim.
// npx rolldown packages/ai/scripts/marks-trace.ts --format esm --platform node -o node_modules/.scratch/marks-trace.mjs && node node_modules/.scratch/marks-trace.mjs [seed=1] [secs=420] [tweak1='{"marks":0,"salvo":false}']
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, MUSTER, type AiLevel } from "@keepfall/content";
import type { Rapier } from "@keepfall/sim";
import { Match } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";
import * as V from "../src/view";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.slice(k.length + 1) ?? d;
const seed = Number(arg("seed", "1")), secs = Number(arg("secs", "420"));
const tw = [arg("tweak0", ""), arg("tweak1", "")].map((t) => (t ? (JSON.parse(t) as Partial<AiLevel>) : undefined));
const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false });
const ais = [0, 1].map((t) => new AiPlayer(m, t, "knight", seed, { level: tw[t] }));
const kindOf = (team: number, k: { x: number; z: number }) => {
  const fz = V.frontFaceZ(1 - team);
  if (Math.abs(k.z - fz) <= 8 && Math.abs(k.x) <= 14) return "gate/wall";
  if (Math.abs(k.z - V.frontFaceZ(team)) <= 30 && Math.abs(k.x) <= 20) return "own gate";
  return "road/field";
};
const rec = [0, 1].map(() => ({ marks: { "gate/wall": 0, "own gate": 0, "road/field": 0 } as Record<string, number>, near: 0, nearMarked: 0, salvos: [] as string[], seen: new WeakSet<object>(), salvoAt: -1e9 }));
for (let i = 0; i < secs * 60 && !m.result; i++) {
  for (const ai of ais) ai.step();
  m.step();
  for (const c of [0, 1]) {
    const r = rec[c], reg = m.register;
    for (const k of reg.marks[c]) if (k && !r.seen.has(k)) (r.seen.add(k), r.marks[kindOf(c, k)]++);
    const g = MUSTER[1 - c];
    if (V.marchers(m, c, g.x, g.z, 30) >= 3) {
      r.near++;
      if (reg.list(c).some((k) => kindOf(c, k) === "gate/wall")) r.nearMarked++;
    }
    if (reg.salvoAt[c] !== r.salvoAt) {
      r.salvoAt = reg.salvoAt[c];
      const q = reg.queued.filter((s) => s.team === c);
      const mk = reg.mark(c, q[0]?.mark ?? 0);
      r.salvos.push(`${(m.tick / 60).toFixed(0)}s ${q.length} guns ${mk ? kindOf(c, mk) : "?"}`);
    }
  }
}
for (const c of [0, 1]) {
  const r = rec[c];
  console.log(`seed ${seed} castle ${c}: marks ${JSON.stringify(r.marks)}; own waves near enemy gate ${(r.near / 60).toFixed(0)} s, with a gate/wall mark ${(r.nearMarked / 60).toFixed(0)} s; salvos ${r.salvos.length} [${r.salvos.join("; ")}]; autoOnMark ${m.autoOnMark[c]}; hand by aim keep/crowd/breach/raid/masons/gun/range/open/cut ${ais[c].gunner.byAim.join("/")}`);
}
console.log(m.result ? `END ${(m.result.tick / 60).toFixed(0)} s winner ${m.result.winner} by ${m.result.reason}` : "no result");
m.free();
