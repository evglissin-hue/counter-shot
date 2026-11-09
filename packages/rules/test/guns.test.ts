// After M5: guns knocked out in a match pay their silencer's side, come back
// free once their crews have had the time; the chain shot's whirling chain
// scythes through a marching wave.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, GOLD, REMOUNT } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, MinionState, OutCause, solveAim, Spin, type Rapier } from "@keepfall/sim";
import { Match, Team } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);

test("after M5: silencing an enemy gun pays 20 gold; its crew puts it back free 30 s later", () => {
  const m = new Match(R, layout, { seed: 6, barracks: false, garrison: false, masons: false, gunnery: false, plan: false });
  m.world.wind.x = m.world.wind.z = 0;
  // The player's chain shot (2) on the enemy's long gun (8), on its gate wall.
  const g = m.emplacements[8];
  const s = solveAim(m.emplacements[2], g.x, g.y - 0.3, g.z)!;
  m.queue(0, Team.Player, { kind: "fire", emplacement: 2, yaw: s.yaw, pitch: s.pitch, charge: 1, fuse: 0, spin: Spin.None });
  let outAt = -1;
  for (let t = 0; t < 150 && outAt < 0; t++) {
    m.step();
    if (!m.world.mounts.up(8)) outAt = m.tick;
  }
  assert.ok(outAt > 0, "the enemy long gun was knocked out");
  assert.equal(m.world.mounts.guns[8].cause, OutCause.Chain);
  assert.deepEqual(m.economy.silenced, [0, 1], "one enemy gun silenced, by the player");
  assert.ok(m.earned[Team.Player] >= GOLD.silenced, `the player earned ${m.earned[Team.Player]}`);
  // Out, the enemy cannot fire it.
  m.queue(m.tick, Team.Enemy, { kind: "fire", emplacement: 8, yaw: g.baseYaw, pitch: 0.02, charge: 1, fuse: 0, spin: Spin.None });
  const shots = m.shots[Team.Enemy];
  for (let t = 0; t < 5; t++) m.step();
  assert.equal(m.world.reload[8], 0, "no shot left it");
  assert.equal(m.shots[Team.Enemy], shots, "nor is one counted");
  const spent = m.spent[Team.Enemy];
  for (let t = 0; t < REMOUNT.ticks && !m.world.mounts.up(8); t++) m.step();
  assert.ok(m.world.mounts.up(8), "back once its crew has had the time");
  assert.equal(m.spent[Team.Enemy], spent, "free");
  assert.ok(m.stats(Team.Player).gunsSilenced === 1 && m.stats(Team.Enemy).gunsLost === 1);
  m.free();
});

test("after M5: a chain shot's whirling chain scythes through a marching wave", () => {
  let men = 0, swept = 0;
  for (const seed of [1, 2, 3]) {
    const m = new Match(R, layout, { seed, barracks: false, garrison: false, masons: false, gunnery: false, plan: false });
    m.world.wind.x = m.world.wind.z = 0;
    m.army.spawnWave(Team.Enemy, 1, 8, { x: 0, z: -60 });
    for (let t = 0; t < 90; t++) m.step();
    const wave = m.world.minions.list.filter((x) => x.team === Team.Enemy && x.state === MinionState.Upright);
    const mid = wave[wave.length >> 1];
    const e = m.emplacements[2];
    const first = solveAim(e, mid.x, mid.y + 1.1, mid.z)!;
    const s = solveAim(e, mid.x + mid.vx * first.time, mid.y + 1.1, mid.z + mid.vz * first.time)!;
    m.queue(m.tick, Team.Player, { kind: "fire", emplacement: 2, yaw: s.yaw, pitch: s.pitch, charge: 1, fuse: 0, spin: Spin.None });
    for (let t = 0; t < 180; t++) {
      m.step();
      const f = m.world.collect();
      for (let k = 0; k < f.eventCount; k++) if (f.events[k * EVENT_STRIDE] === EventKind.Swept) swept++;
    }
    men += wave.length - m.world.minions.list.filter((x) => x.team === Team.Enemy && x.state === MinionState.Upright).length;
    m.free();
  }
  console.log(`chain shot: ${men} men down in 3 shots, ${swept} by the chain`);
  assert.ok(men >= 9, `${men} men down in 3 shots (a long gun ball takes about two)`);
  assert.ok(swept >= 6, `${swept} swept by the chain itself`);
});
