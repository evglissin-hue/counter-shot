import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { APPROACH, buildLayout, COURTYARD, GAME_LAYOUT, MATCH_EMPLACEMENTS } from "@keepfall/content";
import { APPROACH_BASE, Action, breachField, FLOW_INF, MinionState, routeField, SandboxSim, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
// Team 1 marches on castle 0 (at the origin); its centre route field's goal is castle 0's courtyard.
const CENTRE = routeField(1, 1);
const world = () => new SandboxSim(R, layout, { seed: 7, minions: 0, army: true, powder: false, emplacements: MATCH_EMPLACEMENTS });
const run = (sim: SandboxSim, secs: number) => { for (let i = 0; i < secs * 60; i++) sim.step(); };
const upright = (sim: SandboxSim) => sim.minions.list.filter((m) => m.team === 1 && m.state === MinionState.Upright);
/** Step until the nav grid has caught up and every field is rebuilt from it (at most 20 s). */
const fresh = (sim: SandboxSim) => {
  for (let i = 0; i < 30; i++) sim.step();
  for (let i = 0; i < 20 * 60 && sim.army!.flow.stale; i++) sim.step();
  assert.ok(!sim.army!.flow.stale, "the fields caught up");
};

test("a sealed courtyard sends the route field to the gate front; opening it lets men in", () => {
  const sim = world();
  // Open the gateway itself (no battering to confuse the picture): the only way in is the gate corridor.
  for (const s of layout.stones) if (s.castle === 0 && s.part === "gate") sim.castle.withdraw(s.id);
  fresh(sim);
  const front = { x: 0, z: APPROACH[0].z0 + 1 };
  const inside = { x: 0, z: -8 };
  assert.ok(sim.army!.flow.reachesGoal(CENTRE, front.x, front.z), "open: the gate front reaches the courtyard");

  // Seal: a tall rubble block across the gate corridor, just inside the gate (not a gate-leaf cell).
  sim.nav.addBody(900000, -2.4, 0, -14.5, 2.4, 2.2, -13.5);
  fresh(sim);
  assert.equal(sim.army!.flow.at(CENTRE, inside.x, inside.z), 0, "the courtyard is still the goal");
  assert.ok(!sim.army!.flow.reachesGoal(CENTRE, 0, -17), "sealed: just outside the gate no longer reaches the courtyard");
  assert.ok(!sim.army!.flow.reachesGoal(CENTRE, front.x, front.z), "sealed: the gate front no longer reaches the goal");
  assert.ok(sim.army!.flow.at(CENTRE, 0, -60) >= APPROACH_BASE, "sealed: a man far out is led to the gate front, not the courtyard");
  assert.ok(sim.army!.flow.at(CENTRE, front.x, front.z) < FLOW_INF, "sealed: the field is still finite at the gate front (the approach)");
  assert.ok(sim.army!.flow.at(breachField(1), 0, -60) >= FLOW_INF, "the breach field has no fallback: INF still means no way in");

  // A wave marches: it makes for the gate front and stands there, instead of freezing where the way shut.
  sim.army!.spawnWave(1, 1, 8, { x: 0, z: -40 });
  run(sim, 40);
  const men = upright(sim);
  assert.equal(men.length, 8, "the wave is intact");
  const atFront = men.filter((m) => m.z > APPROACH[0].z0 - 2 && m.z < APPROACH[0].z1 + 3 && Math.abs(m.x) < 9);
  assert.ok(atFront.length >= 6, `${atFront.length} of 8 stand at the gate front`);
  for (const m of men) assert.ok(m.z < -13.5, `man ${m.id} did not get past the seal (z ${m.z.toFixed(1)})`);

  // Open it: remove the block. The courtyard is reachable again and the men walk in.
  sim.nav.removeBody(900000);
  fresh(sim);
  assert.ok(sim.army!.flow.reachesGoal(CENTRE, front.x, front.z), "opened: the gate front reaches the courtyard again");
  run(sim, 40);
  const c = COURTYARD[0];
  const got = upright(sim).filter((m) => m.x >= c.x0 - 1 && m.x <= c.x1 + 1 && m.z >= c.z0 - 1 && m.z <= c.z1 + 1);
  assert.ok(got.length >= 5, `${got.length} walked into the courtyard once it opened`);
  sim.free();
});

test("a loose gate leaf standing in its place is a door; a shoved leaf falls and the way opens", () => {
  const sim = world();
  const leaves = layout.stones.filter((s) => s.castle === 0 && s.part === "gate").map((s) => s.id);
  // A gun knocks the leaves loose but does not topple them: they stand, leaning only a little, where they hung.
  for (const id of leaves) sim.castle.knockLoose(id, 0, 0, 0);
  run(sim, 5);
  fresh(sim);
  for (const id of leaves) {
    assert.equal(sim.castle.dynamic[id], 1, `leaf ${id} is loose`);
    assert.ok(sim.castle.standsInPlace(id), `leaf ${id} still stands in its place`);
  }
  // The field passes through the gate (the courtyard is still reachable), and a marcher at the gate finds the door.
  assert.ok(sim.army!.flow.reachesGoal(CENTRE, 0, -17), "the field still reaches the courtyard through the loose leaves");
  const door = sim.army!.flow.doorAhead(CENTRE, -1, -16.8, 0, 1, 1.6);
  assert.ok(leaves.includes(door), `a marcher at the gate finds the loose leaf as a door (got ${door})`);

  // Shove it as batter() will: a handful of blows topples it out of its place.
  let shoves = 0;
  for (let t = 0; t < 25 * 60 && sim.castle.standsInPlace(door); t++) {
    if (t % 70 === 0) { sim.castle.shove(door, 0, 0.3, 2.2); shoves++; }
    sim.step();
  }
  run(sim, 3);
  assert.ok(!sim.castle.standsInPlace(door), `the shoved leaf toppled out of its place after ${shoves} shoves`);
  assert.ok(shoves <= 12, `it took only a handful of shoves (${shoves})`);
  assert.equal(sim.army!.flow.doorAhead(CENTRE, -1, -16.8, 0, 1, 1.6), -1, "the toppled leaf is no longer a door: the way is open");
  sim.free();
});

test("a wave does not stand frozen on a dropped bridge wreck (dir never points into a refused step)", () => {
  // The centre deck's middle is knocked loose under a crossing wave (the drop-deck scenario, seed 7).
  const sim = world();
  const b = layout.bridges[1].site;
  const lb = layout.bridges[1];
  sim.army!.spawnMix(1, 1, [0, 0, 0, 0, 0, 0, 0, 0], 0);
  // Let the wave reach the deck, then knock its middle loose under their feet.
  let droppedAt = -1;
  for (let t = 0; t < 100 * 60; t++) {
    if (droppedAt < 0) {
      const team = upright(sim);
      const onDeck = team.filter((m) => m.z > b.z - b.length / 2 && m.z < b.z + b.length / 2 && Math.abs(m.x - b.x) < 2.5).length;
      if (onDeck >= 4) {
        droppedAt = t;
        for (let id = lb.first; id < lb.first + lb.count; id++) {
          const s = layout.stones[id];
          if (Math.abs(s.z - b.z) < 4.5) sim.castle.knockLoose(id, 0, -0.5, 0);
        }
      }
    }
    sim.step();
    // Once the wreck has settled (a few seconds on) the crossing is gone and never re-opens over it.
    if (droppedAt >= 0 && t > droppedAt + 5 * 60 && t % 60 === 0) {
      assert.equal(sim.bridgesOpen()[1], false, "the dropped centre deck reads as no crossing");
    }
  }
  assert.ok(droppedAt >= 0, "the wave reached the deck and it was dropped");
  // Nobody stands frozen on the wreck: the men reroute or keep moving rather than standing where the way shut.
  const stuck = upright(sim).filter((m) => m.action === Action.Stand && Math.abs(m.x) < 3 && m.z > b.z - 10 && m.z < b.z + 10);
  assert.equal(stuck.length, 0, `nobody stands frozen on the wreck (${stuck.length})`);
  assert.equal(sim.bridgesOpen()[1], false, "the bridge is still down at the end (no false crossing over the wreck)");
  sim.free();
});
