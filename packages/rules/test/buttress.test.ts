// 3.4 rule 11: a buttress for the keep is a purchase like a building.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BUTTRESS, BUTTRESS_FACES, buildLayout, GAME_LAYOUT } from "@keepfall/content";
import { ButtressState, type Rapier } from "@keepfall/sim";
import { Match, Team } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const quiet = (seed = 3) => new Match(R, layout, { seed, barracks: false, plan: false });
const run = (m: Match, ticks: number) => {
  for (let i = 0; i < ticks; i++) m.step();
};

test("a buttress is refused without the gold, accepted once, and refused again on the same face", () => {
  const m = quiet();
  m.gold[1] = BUTTRESS.gold - 1;
  m.queue(m.tick, Team.Player, { kind: "buttress", face: "front" });
  run(m, 2);
  assert.equal(m.buttress(1, "front"), 0, "no gold, nothing happens");
  assert.ok(m.gold[1] >= BUTTRESS.gold - 1, "nothing taken");
  assert.equal(m.applied.length, 0);
  m.gold[1] = 1000;
  m.queue(m.tick, Team.Player, { kind: "buttress", face: "front" });
  run(m, 2);
  assert.equal(m.buttress(1, "front"), 1, "rising");
  assert.equal(m.buttress(0, "front"), 0, "the other team's is not");
  assert.equal(m.buttress(1, "back"), 0);
  const left = m.gold[1];
  assert.ok(left <= 1000 - BUTTRESS.gold + 5 && left > 1000 - BUTTRESS.gold - 5, `${BUTTRESS.gold} taken (income aside): ${left}`);
  assert.equal(m.applied.length, 1);
  assert.deepEqual(m.applied[0].slice(1), [Team.Player, "buttress front"]);
  // Again on the same face: refused, no gold taken for it.
  const before = m.gold[1];
  m.queue(m.tick, Team.Player, { kind: "buttress", face: "front" });
  run(m, 2);
  assert.ok(m.gold[1] >= before, "nothing taken the second time");
  assert.equal(m.applied.length, 1);
  // It rises and stands.
  run(m, BUTTRESS.buildTicks + 90);
  assert.equal(m.buttress(1, "front"), 2);
  assert.equal(m.world.buttresses!.state(1, BUTTRESS_FACES.indexOf("front")), ButtressState.Standing);
  // Standing: still refused.
  m.queue(m.tick, Team.Player, { kind: "buttress", face: "front" });
  run(m, 2);
  assert.equal(m.applied.length, 1);
});

test("a malformed buttress input does nothing", () => {
  const m = quiet();
  m.gold[1] = 1000;
  m.queue(m.tick, Team.Player, { kind: "buttress", face: "up" as never });
  m.queue(m.tick, Team.Player, { kind: "buttress" } as never);
  run(m, 2);
  for (const f of BUTTRESS_FACES) assert.equal(m.buttress(1, f), 0);
  assert.equal(m.applied.length, 0);
  assert.ok(m.gold[1] >= 1000);
});

test("each team buys its own faces, all four", () => {
  const m = quiet();
  m.gold[0] = 1000;
  m.gold[1] = 1000;
  for (const f of BUTTRESS_FACES) {
    m.queue(m.tick, Team.Enemy, { kind: "buttress", face: f });
    m.queue(m.tick, Team.Player, { kind: "buttress", face: f });
  }
  run(m, 2);
  for (const f of BUTTRESS_FACES) {
    assert.equal(m.buttress(0, f), 1);
    assert.equal(m.buttress(1, f), 1);
  }
  assert.equal(m.applied.length, 8);
});
