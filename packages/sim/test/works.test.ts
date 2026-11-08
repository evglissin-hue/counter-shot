import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, inCourtyard, MATCH_EMPLACEMENTS, repairCost, repairSections } from "@keepfall/content";
import { Climb, EVENT_STRIDE, EventKind, LadderState, MasonTask, MinionState, SandboxSim, WorksHold, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const world = (seed = 7) => new SandboxSim(R, layout, { seed, minions: 0, army: true, emplacements: MATCH_EMPLACEMENTS });
const CENTRE = 1;
const front = repairSections(layout).filter((s) => s.castle === 0 && s.kind === "walls");
const downIn = (sim: SandboxSim, ids: number[]) => ids.filter((id) => sim.castle.dynamic[id]).length;

/** A purse for one team's masons. */
function purse(gold: number) {
  const p = { gold, paid: 0, allow: true };
  return {
    p,
    policy: {
      allowed: () => p.allow,
      pay: (_t: number, c: number) => {
        if (p.gold < c) return false;
        p.gold -= c;
        p.paid += c;
        return true;
      },
    },
  };
}

test("masons clear a breach and rebuild it from the bottom course up, paying for every stone", () => {
  const sim = world();
  const { p, policy } = purse(5000);
  sim.works!.policy = policy;
  sim.works!.spawnCrew(0);
  // A powder burst at the foot of the enemy front wall, left of the gate (as its owner sees it).
  sim.explode(-8, 1.0, -16.3);
  const wallIds = front.flatMap((s) => s.stones);
  for (let i = 0; i < 120; i++) sim.step();
  const before = downIn(sim, wallIds);
  assert.ok(before > 20, `${before} wall pieces down`);
  let laid = 0, cost = 0, cleared = 0, unsupported = 0;
  const L = layout;
  for (let i = 0; i < 70 * 60; i++) {
    sim.step();
    if (i % 4 !== 3) continue;
    const f = sim.collect();
    for (let k = 0; k < f.eventCount; k++) {
      const o = k * EVENT_STRIDE;
      if (f.events[o] === EventKind.Cleared) cleared++;
      if (f.events[o] !== EventKind.Laid) continue;
      const id = f.events[o + 1] | 0;
      laid++;
      cost += repairCost(L.stones[id]);
      // Whatever it rests on (but a gate leaf) stands: the bottom course went back first.
      for (const b of L.below[id]) if (sim.castle.dynamic[b] && L.stones[b].part !== "gate") unsupported++;
    }
  }
  const after = downIn(sim, wallIds);
  const st = sim.works!.status(0);
  console.log(`breach: ${before} down, ${after} after 70 s; laid ${laid}, cleared ${cleared}, paid ${p.paid}`);
  assert.ok(laid >= 25, `${laid} stones put back`);
  assert.equal(unsupported, 0, "no stone went back over a gap");
  assert.equal(p.paid, cost, "every stone was paid for at its price");
  assert.equal(st.laid, laid);
  assert.ok(cleared > 0, "rubble in the gap was carried off");
  assert.ok(after < before, "the breach is smaller");
  sim.free();
});

test("masons wait for gold, and leave alone what their switches turn off", () => {
  const sim = world();
  const { p, policy } = purse(0);
  sim.works!.policy = policy;
  sim.works!.spawnCrew(0);
  sim.explode(-8, 1.0, -16.3);
  for (let i = 0; i < 25 * 60; i++) sim.step();
  assert.equal(sim.works!.status(0).laid, 0, "no gold, no stones");
  assert.equal(sim.works!.status(0).hold, WorksHold.Gold);
  p.gold = 40;
  for (let i = 0; i < 25 * 60; i++) sim.step();
  const laid = sim.works!.status(0).laid;
  assert.ok(laid > 0 && p.gold < 40, `${laid} stones once there was gold (${p.gold} left)`);
  p.allow = false;
  p.gold = 1000;
  for (let i = 0; i < 60; i++) sim.step();
  const stopped = sim.works!.status(0).laid;
  for (let i = 0; i < 15 * 60; i++) sim.step();
  assert.equal(sim.works!.status(0).laid, stopped, "switched off: nothing more");
  assert.equal(sim.works!.status(0).hold, WorksHold.Idle);
  sim.free();
});

test("masons run from enemy pikemen at the damage and go back once it is calm", () => {
  const sim = world();
  sim.works!.spawnCrew(0);
  sim.explode(-8, 1.0, -16.3);
  const masons = sim.works!.crews[0].masons.map((id) => sim.minions.list[id]);
  for (let i = 0; i < 40 * 60 && !masons.some((m) => m.task === MasonTask.Work); i++) sim.step();
  assert.ok(masons.some((m) => m.task === MasonTask.Work), "at work");
  // Two of the other side turn up right where they work.
  const crew = sim.works!.crews[0];
  sim.army!.spawnWave(1, CENTRE, 2, { x: crew.spotX, z: crew.spotZ + 1.5 });
  const intruders = sim.minions.list.slice(-2);
  let fled = 0;
  for (let i = 0; i < 6 * 60; i++) {
    sim.step();
    for (const m of masons) if (m.state === MinionState.Upright && m.task === MasonTask.Flee) fled++;
  }
  assert.ok(fled > 60, `masons ran (${fled} mason-ticks fleeing)`);
  // The intruders are knocked down: once it is calm the masons go back to work.
  for (const m of intruders) if (m.state === MinionState.Upright) sim.minions.knock({ minion: m.id, vx: 0, vy: 1, vz: 0, px: m.x, py: m.y + 1, pz: m.z, extra: 0 }, sim.tick);
  const laid = sim.works!.status(0).laid;
  for (let i = 0; i < 25 * 60; i++) sim.step();
  assert.ok(sim.works!.status(0).laid > laid, "back at work");
  sim.free();
});

test("a ladder crew raises its ladder against an intact wall and the wave climbs over into the courtyard", () => {
  const sim = world();
  sim.army!.spawnWave(1, CENTRE, 8, { x: 0, z: -44 }, { ladder: true });
  const wave = sim.minions.list.filter((m) => m.team === 1);
  let planted = -1, climbed = 0;
  for (let i = 0; i < 80 * 60; i++) {
    sim.step();
    if (planted < 0 && sim.ladders!.planted[1] > 0) planted = i;
    for (const m of wave) if (m.state === MinionState.Upright && m.task === Climb.Up) climbed++;
  }
  const inside = wave.filter((m) => m.state === MinionState.Upright && m.task === Climb.None && inCourtyard(0, m.x, m.z));
  console.log(`ladder up at ${(planted / 60).toFixed(1)} s, ${inside.length} of 8 inside`);
  assert.ok(planted > 0 && planted < 40 * 60, `planted after ${(planted / 60).toFixed(1)} s`);
  assert.ok(climbed > 200, "they climbed");
  assert.ok(inside.length >= 6, `${inside.length} got over the wall`);
  // The gate still stands: they came over the wall, not through it.
  for (const s of layout.stones) if (s.castle === 0 && s.part === "gate") assert.equal(sim.castle.dynamic[s.id], 0);
  sim.free();
});

test("a ball knocks a planted ladder off the wall, and the man on it falls", () => {
  const sim = world();
  sim.army!.spawnWave(1, CENTRE, 6, { x: 0, z: -40 }, { ladder: true });
  let climber = -1;
  for (let i = 0; i < 60 * 60 && climber < 0; i++) {
    sim.step();
    const m = sim.minions.list.find((x) => x.state === MinionState.Upright && x.task === Climb.Up && x.climb > 3);
    if (m) climber = m.id;
  }
  assert.ok(climber >= 0, "someone is on the ladder");
  const L = sim.ladders!.list.find((l) => l.state === LadderState.Planted)!;
  // A ball from out in front at the middle of the ladder.
  const mx = (L.fx + L.tx) / 2, my = (L.fy + L.ty) / 2, mz = (L.fz + L.tz) / 2;
  sim.castle.fire(mx, my + 1, mz - 25, 0, -2, 60, { radius: 0.22, density: 7800, blast: 1 });
  for (let i = 0; i < 90; i++) sim.step();
  assert.equal(L.state, LadderState.Down, "the ladder is down");
  assert.notEqual(sim.minions.list[climber].state, MinionState.Upright, "the climber fell");
  sim.free();
});
