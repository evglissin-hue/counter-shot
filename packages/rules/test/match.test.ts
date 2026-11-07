import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, MATCH } from "@keepfall/content";
import { Spin, type Rapier } from "@keepfall/sim";
import { Match, MATCH_HASH, runMatchSession, Team } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;

test("both keeps earn gold on the match clock", () => {
  const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed: 3 });
  for (let i = 0; i < 10 * 60; i++) m.step();
  const want = MATCH.startGold + 10 * MATCH.keepIncome;
  assert.deepEqual(m.gold, [want, want]);
  assert.equal(m.result, null);
  m.free();
});

test("a team fires only its own emplacements, and only after they reload", () => {
  const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed: 3 });
  const shot = { kind: "fire" as const, emplacement: 0, yaw: 0, pitch: 0.03, charge: 1, fuse: 0, spin: Spin.None };
  m.queue(5, Team.Enemy, shot);
  m.queue(6, Team.Player, shot);
  m.queue(7, Team.Player, shot);
  for (let i = 0; i < 20; i++) m.step();
  assert.deepEqual(m.shots, [0, 1]);
  m.free();
});

test("the scripted match: a long gun hit and two shells down the enemy keep win it, and nothing counts after the end", () => {
  const a = runMatchSession(R);
  const b = runMatchSession(R);
  assert.deepEqual(a.hash, b.hash);
  console.log("match hash", a.hash, "result", a.result, "gold", a.gold, "shots", a.shots);
  assert.ok(a.result, "the match ended");
  assert.equal(a.result.winner, Team.Player);
  assert.equal(a.result.reason, "keep");
  assert.ok(a.result.tick > 450 && a.result.tick < 870, `won at tick ${a.result.tick}, after the second shell`);
  assert.deepEqual(a.shots, [0, 3], "the third shell, the shot after the end and the enemy's borrowed gun were refused");
  const incomeTicks = Math.floor((a.result.tick + 1) / MATCH.incomeEvery);
  assert.deepEqual(a.gold, [MATCH.startGold + incomeTicks * MATCH.keepIncome, MATCH.startGold + incomeTicks * MATCH.keepIncome], "gold stops at the end");
  assert.deepEqual(a.hash, MATCH_HASH);
});
