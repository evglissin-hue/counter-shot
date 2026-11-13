// Fighting diagnosis in a real match: an AI on either side (Knight), or the
// player's side left to its barracks (player=idle: waves on the centre road,
// Advance). The probe watches every fighting man.
// npx rolldown tools/army-diag/fighting/ai.ts --format esm --platform node -o node_modules/.scratch/diag-fight-ai.mjs && node node_modules/.scratch/diag-fight-ai.mjs seed=21 secs=300 enemy=knight player=knight
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, type Difficulty } from "@keepfall/content";
import { MinionState, type Rapier } from "@keepfall/sim";
import { Match } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";
import { census, Probe } from "./probe";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const sides = [arg("enemy", "knight"), arg("player", "knight")];
const secs = Number(arg("secs", "300")), seed = Number(arg("seed", "21"));
const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false });
const ais = sides.map((s, team) => (s === "idle" ? null : new AiPlayer(m, team, s as Difficulty, seed)));
const P = new Probe(m, { log: arg("log", "1") === "1" });
let lastOrder = [-1, -1];
for (let i = 0; i < secs * 60 && !m.result; i++) {
  for (const ai of ais) ai?.step();
  m.step();
  P.after();
  for (const t of [0, 1]) if (m.army.order[t] !== lastOrder[t]) {
    lastOrder[t] = m.army.order[t];
    P.log(m.tick, `team ${t} order ${["Advance", "Hold", "Push"][lastOrder[t]]}`);
  }
  if ((i + 1) % (30 * 60) === 0) {
    for (const t of [0, 1]) console.log(`  t=${((i + 1) / 60).toFixed(0)}s t${t} [${["Advance", "Hold", "Push"][m.army.order[t]]}]: ${census(m, t)} | in its courtyard: enemy ${m.army.attackers[t]} own ${m.army.defenders[t]} storm ${m.storm[t]}`);
  }
}
P.finish();
console.log(`seed ${seed} ${sides[0]} v ${sides[1]}: ${(m.tick / 60).toFixed(0)} s, result ${m.result ? JSON.stringify(m.result) : "none"}`);
console.log(P.summary("ai"));
const ev = P.events;
const kinds = ["IGNORE", "IDLE", "CHASE-BLOCKED", "PASS-IN-REACH"];
console.log("  event counts: " + kinds.map((k) => `${k} ${ev.filter((e) => e.includes(k)).length}`).join(", "));
m.free();
void MinionState;
