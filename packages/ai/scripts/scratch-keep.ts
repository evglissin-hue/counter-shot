import RD from "@dimforge/rapier3d-deterministic-compat";
import { applyTuning, buildLayout, GAME_LAYOUT, keepStructure, structureList } from "@keepfall/content";
import { type Rapier } from "@keepfall/sim";
import { Match } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";
await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const tune = arg("tune", "");
if (tune) applyTuning(JSON.parse(tune));
const seed = Number(arg("seed", "2")), secs = Number(arg("secs", "110")), c = Number(arg("castle", "1"));
const layout = buildLayout(1, GAME_LAYOUT);
const m = new Match(R, layout, { seed, plan: false, rotate: false });
const ais = [0, 1].map((t) => new AiPlayer(m, t, "knight", seed));
const w = m.world;
const L = structureList(layout);
const ki = c * 5;
const keepIds = L[ki].stones;
let lastShots = [0, 0];
for (let i = 0; i < secs * 60 && !m.result; i++) {
  for (const a of ais) a.step();
  m.step();
  if (i % 300 === 0) {
    const down = keepIds.filter((id) => w.castle.dynamic[id]).length;
    const low = keepIds.filter((id) => w.castle.dynamic[id] && layout.stones[id].course <= 4).length;
    const st = w.statics!.status(ki);
    const ws = w.works!.status(c);
    const bt = ["front", "back", "left", "right"].map((f) => m.buttress(c, f as never)).join("");
    const enemy = 1 - c;
    console.log(`${(i / 60).toFixed(0)} s keep${c}: down ${down} (low ${low}) holds ${st.holds.toFixed(2)} | masons ${ws.masons} "${ws.job}" left ${ws.left} | gold ${m.gold[c]} buttress ${bt} | enemy shots ${m.shots[enemy] - lastShots[enemy]} auto ${m.autoShots[enemy]} | gate hits ${[...m.army.gateHits.values()].reduce((a, b) => a + b, 0)}`);
    lastShots = [m.shots[0], m.shots[1]];
  }
}
console.log(m.result ? `END ${(m.result.tick / 60).toFixed(0)} s ${m.result.reason} winner ${m.result.winner}` : "no result");
