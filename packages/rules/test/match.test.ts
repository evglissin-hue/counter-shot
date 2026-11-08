import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, MATCH, ROUTE_NAMES, WAVES } from "@keepfall/content";
import { MinionState, Order, Role, Spin, type Rapier } from "@keepfall/sim";
import { Match, MATCH_HASH, runMatchSession, runWaveMatch, Team, WAVE_MATCH_HASH } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;

const layout = buildLayout(1, GAME_LAYOUT);

test("both keeps earn gold on the match clock", () => {
  const m = new Match(R, layout, { seed: 3 });
  for (let i = 0; i < 10 * 60; i++) m.step();
  const want = MATCH.startGold + 10 * MATCH.keepIncome;
  assert.deepEqual(m.gold, [want, want]);
  assert.equal(m.result, null);
  m.free();
});

test("a team fires only its own emplacements, and only after they reload", () => {
  const m = new Match(R, layout, { seed: 3 });
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
  assert.ok(a.result.tick > 760 && a.result.tick < 1400, `won at tick ${a.result.tick}, after the second shell`);
  assert.deepEqual(a.shots, [0, 3], "the third shell, the shot after the end and the enemy's borrowed gun were refused");
  const incomeTicks = Math.floor((a.result.tick + 1) / MATCH.incomeEvery);
  const income = incomeTicks * MATCH.keepIncome;
  assert.equal(a.earned[0], income, "the enemy earned its keep's income and nothing more, and income stops at the end");
  // M3: the player's shots brought enemy keep masonry down and struck the keep itself: both pay.
  assert.ok(a.earned[1] > income + 30, `the player earned ${a.earned[1] - income} gold besides income`);
  assert.deepEqual([a.gold[0] + a.spent[0], a.gold[1] + a.spent[1]], [MATCH.startGold + a.earned[0], MATCH.startGold + a.earned[1]], "what was not earned was not spent");
  // M4's masons put the keep back; M3: rubble off the keep may wreck the enemy's barracks beside it, which it rebuilds.
  assert.ok(a.spent[0] > 0, `the enemy spent ${a.spent[0]} gold on its keep`);
  assert.deepEqual(a.hash, MATCH_HASH);
});

test("barracks send a wave every 25 seconds down each team's route; orders and routes reach the waves", () => {
  const m = new Match(R, layout, { seed: 3 });
  m.queue(10, Team.Player, { kind: "route", route: "right" });
  m.queue(10, Team.Enemy, { kind: "man", emplacement: 1 }); // the player's mortar: refused
  m.queue(20, Team.Player, { kind: "order", order: Order.Hold });
  for (let i = 0; i < WAVES.first + 1; i++) m.step();
  assert.deepEqual(m.waves, [1, 1]);
  assert.equal(m.manned[0], -1, "the enemy cannot ride the player's gun");
  assert.equal(m.army.order[1], Order.Hold);
  const player = m.world.minions.list.filter((x) => x.team === Team.Player && x.wave >= 0 && x.role === Role.March);
  assert.equal(player.length, WAVES.size);
  for (const x of player) assert.equal(ROUTE_NAMES[x.route], "right");
  assert.equal(m.nextWaveIn(), WAVES.every - 1);
  for (let i = 0; i < WAVES.every; i++) m.step();
  assert.deepEqual(m.waves, [2, 2]);
  m.free();
});

test("weapons nobody mans fire at enemy minions coming at their walls; the one you ride does not", () => {
  const m = new Match(R, layout, { seed: 3 });
  m.queue(0, Team.Player, { kind: "man", emplacement: 0 }); // the player rides the long gun
  // An enemy wave already across the stream, 35 m from the player's gate.
  m.army.spawnWave(Team.Enemy, 1, 8, { x: 0, z: -97 });
  for (let i = 0; i < 12 * 60; i++) m.step();
  assert.ok(m.autoShots[Team.Player] > 0, `the player's unmanned guns fired ${m.autoShots[Team.Player]} times`);
  assert.equal(m.autoShots[Team.Enemy], 0, "the enemy's guns had nothing in reach");
  assert.equal(m.shots[Team.Player], 0, "the player fired nothing by hand");
  assert.equal(m.guns[0].target, -1, "the long gun is manned: it lays on nothing");
  const down = m.world.minions.list.filter((x) => x.team === Team.Enemy && x.state !== MinionState.Upright).length;
  assert.ok(down > 0, `${down} of the enemy wave knocked down`);
  m.free();
});

test("unmanned guns thin a wave on its way in, but most of it reaches the gate (the gunner's own shots decide)", () => {
  const m = new Match(R, layout, { seed: 1, barracks: false });
  m.queue(0, Team.Player, { kind: "man", emplacement: -1 }); // in the overview: every gun fires on its own (the mortar never does)
  m.army.spawnWave(Team.Enemy, 1, 8, { x: 0, z: -84 });
  let reached = 0;
  for (let i = 0; i < 40 * 60 && !reached; i++) {
    m.step();
    const up = m.world.minions.list.filter((x) => x.team === Team.Enemy && x.state === MinionState.Upright && x.role === Role.March);
    if (up.some((x) => x.action === 3)) reached = up.length;
  }
  assert.ok(m.autoShots[Team.Player] >= 3, `${m.autoShots[Team.Player]} unmanned shots`);
  assert.ok(reached >= 3 && reached < 8, `${reached} of 8 reached the gate`);
  m.free();
});

test("the wave match: both barracks, orders, a breach and unmanned guns replay to their pinned hash", () => {
  const a = runWaveMatch(R);
  console.log("wave match hash", a.hash, "waves", a.waves, "standing", a.standing, "fallen", a.fallen, "shots", a.shots, "auto", a.autoShots);
  assert.equal(a.result, null);
  // M3: the breach west of the enemy gate may spray the enemy's barracks behind it: then it misses a wave while it is rebuilt.
  assert.equal(a.waves[1], 3);
  assert.ok(a.waves[0] >= 2 && a.waves[0] <= 3, `the enemy sent ${a.waves[0]} waves`);
  assert.ok(a.spent[0] > 0, "the enemy paid for repairs (and any rebuilding)");
  assert.deepEqual(a.shots, [0, 3], "three shots by hand: down the road and two at the wall");
  assert.ok(a.fallen[0] > 0 && a.fallen[1] > 0, "both sides lost pikemen");
  assert.deepEqual(a.hash, WAVE_MATCH_HASH);
});
