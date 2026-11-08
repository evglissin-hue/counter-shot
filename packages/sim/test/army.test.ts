import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, COURTYARD, DECK_TOP, GAME_LAYOUT, holdMarker, MATCH_EMPLACEMENTS } from "@keepfall/content";
import { Action, MinionState, navCell, NavKind, Order, SandboxSim, type Minion, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const world = (seed = 7) => new SandboxSim(R, layout, { seed, minions: 0, army: true, emplacements: MATCH_EMPLACEMENTS });
const upright = (sim: SandboxSim, team: number): Minion[] => sim.minions.list.filter((m) => m.team === team && m.state === MinionState.Upright);
const run = (sim: SandboxSim, seconds: number, each?: (sim: SandboxSim) => void) => {
  for (let i = 0; i < seconds * 60; i++) {
    sim.step();
    each?.(sim);
  }
};
const LEFT = 0, CENTRE = 1, RIGHT = 2;

test("waves march down the centre road, cross on the deck and fight where they meet", () => {
  const sim = world();
  sim.army!.spawnWave(1, CENTRE, 8);
  sim.army!.spawnWave(0, CENTRE, 8);
  let onDeck = 0, fights = 0;
  run(sim, 45, (s) => {
    for (const m of s.minions.list) {
      if (m.state !== MinionState.Upright) continue;
      if (m.action === Action.Fight) fights++;
      if (m.z > -80 && m.z < -70 && Math.abs(m.y - DECK_TOP) < 0.03) onDeck++;
    }
  });
  assert.ok(onDeck > 100, `walked on the deck (${onDeck} minion-ticks at deck height)`);
  assert.ok(fights > 100, `fought (${fights} minion-ticks fighting)`);
  const down = sim.minions.list.filter((m) => m.state !== MinionState.Upright).length;
  assert.ok(down >= 6, `${down} knocked down`);
  // Nobody fell into the stream: the fight was on and around the bridge.
  for (const m of sim.minions.list) if (m.state !== MinionState.Upright) assert.ok(m.parts[0].translation().y > -1.2, `minion ${m.id} lies at ${m.parts[0].translation().y.toFixed(2)}`);
  sim.free();
});

test("an unopposed wave batters the enemy gate loose and gathers in the courtyard", () => {
  const sim = world();
  sim.army!.spawnWave(1, CENTRE, 8, { x: 0, z: -42 });
  const leaves = layout.stones.filter((s) => s.castle === 0 && s.part === "gate").map((s) => s.id);
  let battered = 0;
  run(sim, 50, (s) => {
    for (const m of upright(s, 1)) if (m.action === Action.Batter) battered++;
  });
  assert.ok(battered > 200, `battered (${battered} minion-ticks)`);
  for (const id of leaves) assert.equal(sim.castle.dynamic[id], 1, `gate leaf ${id} came loose after ${sim.army!.gateHits.get(id)} blows`);
  const c = COURTYARD[0];
  const inside = upright(sim, 1).filter((m) => m.x >= c.x0 - 1 && m.x <= c.x1 + 1 && m.z >= c.z0 - 1 && m.z <= c.z1 + 1);
  assert.ok(inside.length >= 5, `${inside.length} gathered in the enemy courtyard`);
  // Only the gate gave way: the wall over it still stands.
  const wall = layout.stones.filter((s) => s.castle === 0 && s.part === "wall" && sim.castle.dynamic[s.id]).length;
  assert.equal(wall, 0, "no wall pieces came loose");
  sim.free();
});

test("with the centre bridge down, the next wave takes another bridge together and holds at its marker", () => {
  const sim = world();
  const s = layout.bridges[1].site;
  sim.explode(s.x + 0.3, DECK_TOP - 0.4, s.z + 0.5);
  run(sim, 4);
  assert.deepEqual(sim.bridgesOpen(), [true, false, true]);
  sim.army!.setOrder(1, Order.Hold);
  sim.army!.spawnWave(1, CENTRE, 8);
  run(sim, 1);
  const routes = new Set(upright(sim, 1).map((m) => m.route));
  assert.equal(routes.size, 1, "the wave stays together");
  const route = [...routes][0];
  assert.notEqual(route, CENTRE, "it left the centre road");
  run(sim, 55);
  const mark = holdMarker(1, route === LEFT ? "left" : "right");
  const team = upright(sim, 1);
  assert.equal(team.length, 8);
  for (const m of team) {
    assert.ok(Math.abs(m.x - mark.x) < 5 && m.z < mark.z + 1.6 && m.z > mark.z - 6, `holds near (${mark.x}, ${mark.z.toFixed(1)}): at (${m.x.toFixed(1)}, ${m.z.toFixed(1)})`);
    assert.equal(m.action, Action.Stand);
  }
  sim.free();
});

test("on Push a wave goes in through a breach in the wall and leaves the gate alone", () => {
  const sim = world();
  // Two long gun balls at the foot of the enemy front wall, west of the gate.
  for (const [k, x] of [[0, -8.5], [1, -7.5]] as const) {
    sim.queue(10 + k * 250, { kind: "fire", emplacement: 0, yaw: Math.atan2(x, 120), pitch: -0.022, charge: 1, fuse: 0, spin: 0 });
  }
  run(sim, 14);
  sim.army!.setOrder(1, Order.Push);
  sim.army!.spawnWave(1, CENTRE, 8, { x: -6, z: -40 });
  let battered = 0;
  run(sim, 30, (s) => {
    for (const m of upright(s, 1)) if (m.action === Action.Batter) battered++;
  });
  assert.equal(battered, 0, "nobody battered the gate");
  const leaves = layout.stones.filter((s) => s.castle === 0 && s.part === "gate").map((s) => s.id);
  for (const id of leaves) assert.equal(sim.castle.dynamic[id], 0, "the gate still stands");
  const inside = upright(sim, 1).filter((m) => m.z > -13);
  assert.ok(inside.length >= 5, `${inside.length} inside the enemy walls`);
  sim.free();
});

test("the fallen stay as floor to walk on, and past the cap the oldest sink and leave the world", () => {
  const sim = world();
  sim.minions.cap = 10;
  for (let k = 0; k < 3; k++) sim.army!.spawnWave(1, CENTRE, 8, { x: -3 + k * 3, z: -100 });
  run(sim, 0.2);
  const bodiesBefore = sim.castle.world.bodies.len();
  sim.explode(0, 0.5, -101);
  run(sim, 12);
  const states = sim.minions.list.map((m) => m.state);
  const gone = states.filter((s) => s === MinionState.Gone).length;
  const lying = states.filter((s) => s === MinionState.Frozen || s === MinionState.Ragdoll).length;
  assert.ok(gone >= 8, `${gone} sank and left the world`);
  assert.ok(lying <= 10, `${lying} bodies stay`);
  // The world holds exactly the bodies that stay: the 24 capsules became ragdolls, and the sunk ones left.
  assert.equal(sim.castle.world.bodies.len(), bodiesBefore - 24 + lying * 11, "the sunk bodies left the world");
  // A frozen body raises the floor under it: walkable rubble.
  const body = sim.minions.list.find((m) => m.state === MinionState.Frozen)!;
  const p = body.parts[0].translation();
  assert.equal(sim.nav.kind[navCell(p.x, p.z)], NavKind.Rubble, "the ground under a body is rubble to scramble over");
  const f = sim.collect();
  assert.ok(f.gone.length >= 8, "the frame reports who left");
  sim.free();
});
