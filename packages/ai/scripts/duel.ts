// Watch the AI play: a match with an AI on either side (or a side left idle),
// printed every 30 s: gold, what stands on the plots, shots by hand and on
// their own, masonry down, where each banner stands, and the end.
// npx rolldown packages/ai/scripts/duel.ts --format esm --platform node -o node_modules/.scratch/duel.mjs && node node_modules/.scratch/duel.mjs [enemy=knight|idle] [player=knight|idle] [secs=300] [seed=11]
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, BUILDING_KINDS, type Difficulty } from "@keepfall/content";
import type { Rapier } from "@keepfall/sim";
import { Match, Team } from "@keepfall/rules";
import { AiPlayer, banner } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const sides = [arg("enemy", "knight"), arg("player", "knight")];
const secs = Number(arg("secs", "300")), seed = Number(arg("seed", "11"));
const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false });
const ais = sides.map((s, team) => (s === "idle" ? null : new AiPlayer(m, team, s as Difficulty, seed)));
const t0 = performance.now();
let worst = 0;
const plots = (c: number) => [0, 1, 2, 3, 4, 5].map((p) => { const s = m.world.structures!.slot(c, p); return s.kind < 0 ? "." : BUILDING_KINDS[s.kind][0] + (s.state === 3 ? "x" : ""); }).join("");
for (let i = 0; i < secs * 60 && !m.result; i++) {
  for (const ai of ais) ai?.step();
  const s0 = performance.now();
  m.step();
  worst = Math.max(worst, performance.now() - s0);
  if (i % 1800 === 1799) {
    const b = [banner(m, 0), banner(m, 1)];
    console.log(`${String(Math.round(i / 60)).padStart(4)} s  gold ${m.gold[0]}/${m.gold[1]} spent ${m.spent[0]}/${m.spent[1]}  plots ${plots(0)} ${plots(1)}  shots ${m.shots[0]}/${m.shots[1]} auto ${m.autoShots[0]}/${m.autoShots[1]}  down ${m.masonryDown(0)}/${m.masonryDown(1)}  banners ${b[0].floor}/${b[1].floor}  waves ${m.waves[0]}/${m.waves[1]}  standing ${m.armyCounts().standing}  storm ${m.storm[0]}/${m.storm[1]}`);
  }
}
console.log(m.result ? `END at ${(m.result.tick / 60).toFixed(0)} s: winner ${m.result.winner === Team.Player ? "player (castle 1)" : m.result.winner === Team.Enemy ? "enemy (castle 0)" : "draw"} by ${m.result.reason}` : `no result after ${secs} s`);
console.log(`wall ${((performance.now() - t0) / 1000).toFixed(0)} s, worst step ${worst.toFixed(1)} ms; AI shots by hand: ${ais.map((a) => a?.gunner.shotsFired ?? "-").join("/")}`);
m.free();
