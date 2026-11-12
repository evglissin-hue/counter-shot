// Match.onInput: the page's replay log watches the inputs a match applies. It is
// told of exactly those that reach apply (well formed, and either the match is
// on or it is a surrender), in the order applied, and it changes no state.

import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT } from "@keepfall/content";
import { Order, Spin, type Rapier } from "@keepfall/sim";
import { Match, Team, type MatchInput } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);

test("the observer sees the well formed inputs, tick by tick, team by team, and nothing else", () => {
  const m = new Match(R, layout, { seed: 3 });
  const seen: Array<[number, number, string]> = [];
  m.onInput = (tick, team, input) => seen.push([tick, team, input.kind]);
  const shot = { kind: "fire" as const, emplacement: 0, yaw: 0, pitch: 0.03, charge: 1, fuse: 0, spin: Spin.None };
  m.queue(2, Team.Player, shot);
  m.queue(2, Team.Enemy, { kind: "order", order: Order.Hold });
  m.queue(3, Team.Player, { kind: "nonsense" } as unknown as MatchInput); // malformed: not told
  m.queue(3, Team.Player, { kind: "aim", emplacement: 99, yaw: 0, pitch: 0 }); // out of range: not well formed
  m.queue(4, Team.Player, { kind: "order", order: Order.Hold });
  for (let i = 0; i < 6; i++) m.step();
  assert.deepEqual(seen, [[2, 0, "order"], [2, 1, "fire"], [4, 1, "order"]]);
  m.free();
});

test("once the match has a result only a surrender reaches the observer", () => {
  const m = new Match(R, layout, { seed: 3 });
  const seen: string[] = [];
  m.onInput = (_t, _team, input) => seen.push(input.kind);
  m.queue(1, Team.Player, { kind: "surrender" });
  m.queue(3, Team.Enemy, { kind: "order", order: Order.Hold });
  for (let i = 0; i < 5; i++) m.step();
  assert.ok(m.result);
  assert.deepEqual(seen, ["surrender"]);
  m.free();
});

test("watching changes nothing: the same inputs hash the same with and without an observer", () => {
  const run = (watch: boolean) => {
    const m = new Match(R, layout, { seed: 3 });
    if (watch) m.onInput = () => {};
    m.queue(5, Team.Player, { kind: "fire", emplacement: 0, yaw: 0, pitch: 0.05, charge: 1, fuse: 0, spin: Spin.None });
    m.queue(9, Team.Player, { kind: "order", order: Order.Hold });
    for (let i = 0; i < 200; i++) m.step();
    const h = m.hash();
    m.free();
    return h;
  };
  assert.deepEqual(run(true), run(false));
});
