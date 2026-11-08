import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, GARRISON, inCourtyard, MATCH, STORM, WAVES, WEAPONS } from "@keepfall/content";
import { MinionState, Order, Role, Spin, type Rapier } from "@keepfall/sim";
import { Match, Team, type MatchInput } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const CENTRE = 1;
/** A few metres inside the player's gate (its courtyard, local z = -9). */
const INSIDE_PLAYER_GATE = -150 + 9;
const wallShot = (yaw: number): MatchInput => ({ kind: "fire", emplacement: 0, yaw, pitch: -0.022, charge: 1, fuse: 0, spin: Spin.None });

test("each courtyard starts with a garrison and each castle with its masons", () => {
  const m = new Match(R, layout, { seed: 3, barracks: false });
  assert.deepEqual([m.army.garrisonCount(0), m.army.garrisonCount(1)], [GARRISON.size, GARRISON.size]);
  for (const team of [0, 1]) {
    const g = m.world.minions.list.filter((x) => x.team === team && x.role === Role.Garrison);
    for (const x of g) assert.ok(inCourtyard(team, x.x, x.z), "the garrison stands inside");
    assert.equal(m.world.works!.status(team).masons, 4);
  }
  for (let i = 0; i < 120; i++) m.step();
  assert.deepEqual(m.army.defenders, [GARRISON.size, GARRISON.size], "the garrisons count as defenders");
  assert.deepEqual(m.storm, [0, 0]);
  m.free();
});

test("storming: two waves through a breach outnumber the garrison and hold the enemy courtyard for 20 seconds", () => {
  const m = new Match(R, layout, { seed: 7, barracks: false, gunnery: false });
  m.queue(0, Team.Player, { kind: "man", emplacement: 0 });
  m.queue(5, Team.Player, wallShot(-0.0707));
  m.queue(260, Team.Player, wallShot(-0.0624));
  m.queue(300, Team.Player, { kind: "order", order: Order.Push });
  let held = 0;
  for (let i = 0; i < 90 * 60 && !m.result; i++) {
    if (i === 400) {
      m.army.spawnWave(Team.Player, CENTRE, 8, { x: -6, z: -30 });
      m.army.spawnWave(Team.Player, CENTRE, 8, { x: -6, z: -36 });
    }
    m.step();
    if (m.storm[0] > held) held = m.storm[0];
  }
  console.log("stormed at", m.result?.tick, "stats", JSON.stringify(m.stats(Team.Player)));
  assert.ok(m.result, "the match ended");
  assert.equal(m.result.winner, Team.Player);
  assert.equal(m.result.reason, "storm");
  assert.equal(held, STORM.hold);
  assert.equal(m.stats(Team.Player).stormsBegun, 1);
  m.free();
});

test("a garrison holds against fewer attackers, and a barracks under attack musters its wave inside", () => {
  const m = new Match(R, layout, { seed: 5, gunnery: false });
  // Three of the enemy get into the player's courtyard just before the first waves leave.
  for (let i = 0; i < WAVES.first - 30; i++) m.step();
  m.army.spawnWave(Team.Enemy, CENTRE, 3, { x: 0, z: INSIDE_PLAYER_GATE });
  let outnumbered = 0;
  for (let i = 0; i < 40; i++) {
    m.step();
    if (m.army.attackers[1] > m.army.defenders[1]) outnumbered++;
  }
  assert.equal(outnumbered, 0, "four defenders against three");
  assert.equal(m.storm[1], 0, "no storm while they are outnumbered");
  // The player's first wave mustered inside to defend.
  const defenders = m.world.minions.list.filter((x) => x.team === Team.Player && x.role === Role.Defend);
  assert.ok(defenders.length >= 6, `${defenders.length} mustered inside`);
  for (const x of defenders) assert.ok(inCourtyard(1, x.x, x.z));
  for (let i = 0; i < 30 * 60; i++) m.step();
  const left = m.world.minions.list.filter((x) => x.team === Team.Enemy && x.state === MinionState.Upright && inCourtyard(1, x.x, x.z));
  assert.equal(left.length, 0, "the courtyard is cleared");
  assert.equal(m.result, null);
  m.free();
});

test("sudden death doubles income and speeds up every reload", () => {
  const m = new Match(R, layout, { seed: 3, barracks: false, suddenDeathTick: 600 });
  m.queue(0, Team.Player, { kind: "man", emplacement: 0 });
  for (let i = 0; i < 300; i++) m.step();
  const g0 = m.gold[1];
  for (let i = 0; i < 120; i++) m.step();
  assert.equal(m.gold[1] - g0, 2 * MATCH.keepIncome, "5 a second before");
  assert.equal(m.suddenDeath, false);
  for (let i = 0; i < 300; i++) m.step();
  assert.equal(m.suddenDeath, true);
  const g1 = m.gold[1];
  for (let i = 0; i < 120; i++) m.step();
  assert.equal(m.gold[1] - g1, 2 * MATCH.keepIncome * MATCH.suddenIncome, "10 a second after");
  m.queue(m.tick, Team.Player, { kind: "fire", emplacement: 0, yaw: 0, pitch: 0.03, charge: 1, fuse: 0, spin: Spin.None });
  m.step();
  assert.equal(m.world.reload[0], Math.round(WEAPONS.longGun.reload * MATCH.suddenReload) - 1, "the long gun reloads in 60% of its time");
  m.free();
});

test("a team can surrender, and nothing counts after it", () => {
  const m = new Match(R, layout, { seed: 3, barracks: false });
  m.queue(10, Team.Player, { kind: "surrender" });
  m.queue(20, Team.Player, { kind: "fire", emplacement: 0, yaw: 0, pitch: 0.03, charge: 1, fuse: 0, spin: Spin.None });
  m.queue(30, Team.Enemy, { kind: "surrender" });
  for (let i = 0; i < 60; i++) m.step();
  assert.deepEqual(m.result, { winner: Team.Enemy, reason: "surrender", tick: 10 });
  assert.deepEqual(m.shots, [0, 0]);
  m.free();
});

test("repair switches are each team's own, and the enemy's masons rebuild what the player breaks", () => {
  const m = new Match(R, layout, { seed: 7, barracks: false, gunnery: false });
  m.queue(0, Team.Player, { kind: "repair", repair: "walls", on: false });
  m.queue(0, Team.Enemy, { kind: "repair", repair: "keep", on: false });
  m.queue(5, Team.Player, wallShot(-0.0707));
  for (let i = 0; i < 50 * 60; i++) m.step();
  assert.equal(m.repairs[Team.Player].walls, false);
  assert.equal(m.repairs[Team.Player].keep, true);
  assert.equal(m.repairs[Team.Enemy].keep, false);
  assert.equal(m.repairs[Team.Enemy].walls, true);
  const st = m.stats(Team.Enemy);
  assert.ok(st.stonesRebuilt > 10, `the enemy put back ${st.stonesRebuilt} stones`);
  assert.equal(st.goldSpent, m.spent[Team.Enemy]);
  assert.equal(m.gold[Team.Enemy] + m.spent[Team.Enemy], MATCH.startGold + m.earned[Team.Enemy]);
  m.free();
});
