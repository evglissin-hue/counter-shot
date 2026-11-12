// The AI castle (phase 2 M5): an AI against AI match replays to its pinned
// hash, and each side plays: it rides its guns and fires by hand, builds by
// its plan, sends its waves and gives orders, all through the same inputs a
// player sends.

import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { AI_LEVELS, buildLayout, DIFFICULTIES, GAME_LAYOUT } from "@keepfall/content";
import { PlotState, type Rapier } from "@keepfall/sim";
import { Match, Team, type MatchInput } from "@keepfall/rules";
import { AI_MATCH_HASH, AiPlayer, runAiMatch } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;

test("Knight against Knight replays to its pinned hash, and both sides play", () => {
  const a = runAiMatch(R);
  console.log("ai match hash", a.hash, "result", a.result, "gold", a.gold, "spent", a.spent, "shots", a.shots, "auto", a.autoShots, "waves", a.waves, "masonry", a.masonry, "built", a.built);
  for (const team of [0, 1]) {
    assert.ok(a.shots[team] >= 10, `team ${team} fired ${a.shots[team]} shots by hand`);
    assert.ok(a.spent[team] >= 400, `team ${team} spent ${a.spent[team]} gold`);
    assert.ok(a.built[team] >= 3, `team ${team} has ${a.built[team]} buildings`);
    assert.ok(a.masonry[1 - team] >= 40, `team ${team} brought down ${a.masonry[1 - team]} pieces of the other castle`);
  }
  assert.deepEqual(a.hash, AI_MATCH_HASH);
});

test("the AI sends only inputs a player could, for its own castle, and the difficulties differ as data says", () => {
  const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed: 3, plan: false, rotate: false, barracks: false });
  const ai = new AiPlayer(m, Team.Enemy, "warlord", 3);
  const seen: MatchInput[] = [];
  let firstFire = -1;
  const q = m.queue.bind(m);
  m.queue = (tick, team, input) => {
    assert.equal(team, Team.Enemy, "it sends inputs for its own team only");
    assert.ok(tick >= m.tick, "never for a tick already played");
    if (input.kind === "fire" && firstFire < 0) firstFire = tick;
    seen.push(input);
    q(tick, team, input);
  };
  for (let i = 0; i < 40 * 60; i++) {
    ai.step();
    m.step();
  }
  const kinds = new Set(seen.map((i) => i.kind));
  for (const k of ["man", "aim", "fire", "build"]) assert.ok(kinds.has(k as MatchInput["kind"]), `it sent a ${k}`);
  for (const i of seen) {
    if (i.kind === "fire" || i.kind === "aim" || (i.kind === "man" && i.emplacement >= 0)) {
      const e = "emplacement" in i ? i.emplacement : -1;
      assert.ok(e >= 8 && e < 16, `emplacement ${e} is one of its own`);
    }
  }
  assert.ok(m.shots[Team.Enemy] >= 5, `it fired ${m.shots[Team.Enemy]} shots by hand in 40 s`);
  const [s, k, w] = DIFFICULTIES.map((d) => AI_LEVELS[d]);
  assert.ok(firstFire >= w.warmup, `its first shot by hand left at tick ${firstFire}, before its warm-up (${w.warmup})`);
  assert.ok(s.firstErr > k.firstErr && k.firstErr > w.firstErr && s.learn < k.learn && k.learn < w.learn && s.think > k.think && k.think > w.think);
  assert.ok(s.warmup > k.warmup && k.warmup > w.warmup && s.look > k.look && k.look > w.look, "the easier a level, the longer it gives you before its first shot, and between shots");
  m.free();
});

test("after M5: while a gun's slot waits for its masonry, the AI's steward takes the next step of its plan", () => {
  const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed: 6, plan: false, rotate: false, barracks: false });
  const team = Team.Player; // its slots are emplacements 0 to 7
  const ai = new AiPlayer(m, team, "knight", 6);
  // The Knight's fourth step buys a chain shot for slot 4 (the front wall, left of the gate), its fifth builds a Foundry on plot 3.
  // The wall walk under slot 4 is down (knocked loose again each second, whatever the masons put back).
  const pieces = m.world.mounts.pieces[4];
  assert.ok(pieces.length > 0, "slot 4 stands on its wall walk");
  m.gold[team] = 5000;
  ai.steward.step = 3;
  for (let i = 0; i < 20 * 60; i++) {
    if (i % 60 === 0) for (const id of pieces) m.world.castle.knockLoose(id, 0, -40, 0);
    ai.step();
    m.step();
  }
  assert.ok(m.emplacements[4].empty, "no gun on masonry that is down");
  assert.notEqual(m.world.structures!.slot(team, 3).state, PlotState.Empty, "the Foundry went up meanwhile (it used to wait on the gun)");
});
