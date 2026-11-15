import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, holdMarker, ORGAN_KINDS } from "@keepfall/content";
import { MinionState, Order, type Rapier } from "@keepfall/sim";
import { Match, Team } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const CENTRE = 1;
const LEFT = 0;
const P = Team.Player;
const MAST = ORGAN_KINDS.indexOf("mast");

/** A match with no barracks waves and no guns, masons' Works repairs off (so a mast that is down stays down). */
function match(): Match {
  const m = new Match(R, layout, { seed: 3, barracks: false, gunnery: false });
  m.queue(0, P, { kind: "repair", repair: "works", on: false });
  m.step();
  return m;
}
const run = (m: Match, n: number) => { for (let i = 0; i < n; i++) m.step(); };
const mastKey = () => layout.organs[P * ORGAN_KINDS.length + MAST].key;

function mastDown(m: Match) {
  m.world.castle.dust(mastKey());
  m.world.castle.supportNow();
  run(m, 20);
  assert.equal(m.organUp(P, "mast"), false, "the mast is down");
}
function mastBack(m: Match) {
  const o = layout.organs[P * ORGAN_KINDS.length + MAST];
  for (let id = o.first; id < o.first + o.count; id++) m.world.castle.restore(id);
  run(m, 20);
  assert.equal(m.organUp(P, "mast"), true, "the mast works again");
}
function men(m: Match, wave: number) {
  return m.world.minions.list.filter((x) => x.team === P && x.wave === wave && x.state === MinionState.Upright);
}
const meanZ = (l: { z: number }[]) => l.reduce((s, x) => s + x.z, 0) / l.length;
const holding = (m: Match, wave: number) => {
  const mark = holdMarker(P, "centre");
  const l = men(m, wave);
  return l.length > 0 && l.every((x) => Math.abs(x.x - mark.x) < 6 && x.z < mark.z + 2);
};

function twoWaves(m: Match) {
  m.army.spawnWave(P, CENTRE, 6, { x: -6, z: -105 });
  const a = m.world.minions.list.filter((x) => x.team === P && x.wave >= 0).map((x) => x.wave).sort((p, q) => q - p)[0];
  run(m, 5);
  m.queue(m.tick, P, { kind: "order", order: Order.Hold });
  run(m, 2);
  m.army.spawnWave(P, CENTRE, 6, { x: 6, z: -115 });
  const b = m.world.minions.list.filter((x) => x.team === P && x.wave >= 0).map((x) => x.wave).sort((p, q) => q - p)[0];
  assert.notEqual(a, b);
  return [a, b] as const;
}

test("mast up: an order to Hold reaches the wave in the field and the next one", () => {
  const m = match();
  assert.equal(m.organUp(P, "mast"), true);
  const [a, b] = twoWaves(m);
  assert.equal(m.army.orderOf(men(m, a)[0]), Order.Hold);
  assert.equal(m.army.orderOf(men(m, b)[0]), Order.Hold);
  run(m, 60 * 25);
  assert.ok(holding(m, a), "the wave in the field holds");
  assert.ok(holding(m, b), "the new wave holds");
  m.free();
});

test("mast down: a wave in the field keeps marching after Hold; a wave that musters later holds", () => {
  const m = match();
  mastDown(m);
  const [a, b] = twoWaves(m);
  assert.equal(m.army.order[P], Order.Hold, "the standing order changed");
  assert.equal(m.army.orderOf(men(m, a)[0]), Order.Advance);
  assert.equal(m.army.orderOf(men(m, b)[0]), Order.Hold);
  const z0 = meanZ(men(m, a));
  run(m, 60 * 25);
  assert.ok(!holding(m, a), "the wave in the field did not hold");
  assert.ok(meanZ(men(m, a)) > z0 + 30, `it marched on (${z0.toFixed(1)} to ${meanZ(men(m, a)).toFixed(1)})`);
  assert.ok(holding(m, b), "the new wave holds at its marker");
  m.free();
});

test("the mast working again sends the standing order to the waves in the field", () => {
  const m = match();
  mastDown(m);
  const [a] = twoWaves(m);
  run(m, 30);
  assert.equal(m.army.orderOf(men(m, a)[0]), Order.Advance);
  mastBack(m);
  assert.equal(m.army.orderOf(men(m, a)[0]), Order.Hold, "the wave in the field takes the standing order");
  m.free();
});

test("a road changed with the mast down leaves the wave out on its road; the next wave takes the new one", () => {
  const m = match();
  mastDown(m);
  m.army.spawnWave(P, CENTRE, 6, { x: -6, z: -130 });
  const a = m.army.waves - 1;
  run(m, 5);
  m.queue(m.tick, P, { kind: "route", route: "left" });
  run(m, 3);
  assert.equal(m.route[P], "left");
  assert.ok(men(m, a).every((x) => x.route === CENTRE), "the wave out keeps its road");
  m.army.spawnWave(P, LEFT, 6, { x: 6, z: -115 });
  const b = m.army.waves - 1;
  assert.ok(men(m, b).every((x) => x.route === LEFT), "the next wave takes the new road");
  m.free();
});

test("a road changed with the mast up moves the wave out too", () => {
  const m = match();
  m.army.spawnWave(P, CENTRE, 6, { x: -6, z: -130 });
  const a = m.army.waves - 1;
  run(m, 5);
  m.queue(m.tick, P, { kind: "route", route: "left" });
  run(m, 3);
  assert.ok(men(m, a).every((x) => x.route === LEFT), "the wave out takes the new road");
  m.free();
});

test("dead end: with the mast down for good, new waves still follow the team's orders and roads", () => {
  const m = match();
  mastDown(m);
  m.queue(m.tick, P, { kind: "order", order: Order.Push });
  m.queue(m.tick, P, { kind: "route", route: "right" });
  run(m, 3);
  m.army.spawnWave(P, CENTRE, 4, { x: -6, z: -130 });
  const a = m.army.waves - 1;
  assert.equal(m.army.orderOf(men(m, a)[0]), Order.Push);
  m.queue(m.tick, P, { kind: "order", order: Order.Hold });
  run(m, 3);
  m.army.spawnWave(P, CENTRE, 4, { x: 6, z: -115 });
  const b = m.army.waves - 1;
  assert.equal(m.army.orderOf(men(m, b)[0]), Order.Hold, "the second wave takes the second order");
  assert.equal(m.army.orderOf(men(m, a)[0]), Order.Push, "the first keeps its own");
  assert.equal(m.route[P], "right");
  m.free();
});
