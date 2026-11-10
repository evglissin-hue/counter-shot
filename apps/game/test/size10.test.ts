import { test } from "node:test";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT } from "@keepfall/content";
import { AiPlayer } from "@keepfall/ai";
import { Match, Team } from "@keepfall/rules";
import type { Rapier } from "@keepfall/sim";
import { makeSetup, MatchLog, writeLog } from "../src/matchLog";

await RD.init();
const R = RD as unknown as Rapier;
test("size of a 10 minute match", { skip: !process.env.SIZE10 }, () => {
  const layout = buildLayout(1, GAME_LAYOUT);
  const m = new Match(R, layout, { seed: 11, plan: false, rotate: false });
  const log = new MatchLog();
  let n = 0;
  m.onInput = (t, team, i) => { n++; log.record(t, team, i); };
  const ais = [new AiPlayer(m, Team.Enemy, "knight", 11), new AiPlayer(m, Team.Player, "knight", 11)];
  for (let i = 0; i < 36000 && !m.result; i++) { for (const a of ais) a.step(); m.step(); }
  const text = writeLog(makeSetup("versus", { seed: 11, plan: false, rotate: false }, 1, 4, layout, "knight"), log.entries(), m.tick, m.hash());
  console.log("SIZE10 tick", m.tick, "result", JSON.stringify(m.result), "applied", n, "kept", log.entries().length, "bytes", text.length);
});
