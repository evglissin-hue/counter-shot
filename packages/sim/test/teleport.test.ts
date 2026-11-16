// 3.6: a man moved metres in one step (hoisted to his post, climbing down) is teleported, not moved: a kinematic move
// over metres in one step has the speed of that move (hundreds of m/s) and flings any loose stone it lands on.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT } from "@keepfall/content";
import { SandboxSim, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);

test("a man lifted 12 m to his post is put there at once: the capsule stands at the post and a loose stone where he lands stays put", () => {
  const sim = new SandboxSim(R, layout, { seed: 3, minions: 0, army: true, powder: false });
  const c = sim.castle;
  // A loose stone lying where he arrives (rubble on a tower top), over open ground in the field.
  const id = layout.stones.find((s) => s.part === "wall" && s.castle === 0 && s.course === 1)!.id;
  c.knockLoose(id, 0, 0, 0);
  const x = 0, z = -60;
  c.bodies[id].setTranslation({ x, y: 13.75, z }, true);
  c.bodies[id].setLinvel({ x: 0, y: 0, z: 0 }, true);
  const m = sim.minions.spawn(0, x, z, x, z, x, z, false);
  m.y = 12;
  sim.minions.teleport(m);
  const t = m.capsule!.translation();
  assert.ok(Math.abs(t.y - (12 + 0.85)) < 1e-6, `the capsule is at his post at once (${t.y.toFixed(2)})`);
  sim.castle.world.step();
  const v = c.bodies[id].linvel();
  const speed = Math.hypot(v.x, v.y, v.z);
  assert.ok(speed < 2, `the stone moves at ${speed.toFixed(1)} m/s`);
  sim.free();
});
