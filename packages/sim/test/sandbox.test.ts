import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, WEAPONS } from "@keepfall/content";
import { EventKind, runSession, SESSION_HASH, SandboxSim, Spin, Wind, stepAim, restAim, type Rapier } from "@keepfall/sim";
import { Rng } from "@keepfall/core";
import { ASHWRIGHT_EMPLACEMENTS } from "@keepfall/content";

await RD.init();
const R = RD as unknown as Rapier;


test("the scripted sandbox session replays to its pinned hash", () => {
  const a = runSession(R);
  const b = runSession(R);
  assert.deepEqual(a.hash, b.hash);
  console.log("session hash", a.hash, "down", a.down, "standing", a.standing);
  assert.ok(a.events.includes(EventKind.Explosion), "the mortar went off");
  assert.ok(a.down >= 3, "minions were knocked down");
  assert.deepEqual(a.hash, SESSION_HASH);
});

test("wind follows its seed and stays in range", () => {
  const w = new Wind(new Rng(3).fork("wind"));
  let changes = 0, last = w.nextChangeIn(0);
  for (let t = 0; t < 60 * 300; t++) {
    w.step(t);
    const s = w.x * w.x + w.z * w.z;
    assert.ok(s <= 11 * 11 + 1e-9);
    const next = w.nextChangeIn(t);
    if (next > last) changes++;
    last = next;
  }
  assert.ok(changes >= 4 && changes <= 10, `changes ${changes}`);
});

test("aiming is limited by the weapon's turn rate and arc", () => {
  const e = ASHWRIGHT_EMPLACEMENTS[0], w = WEAPONS.longGun;
  let a = restAim(e, w);
  for (let i = 0; i < 60; i++) a = stepAim(a, { dYaw: 1, dPitch: 0, fine: false }, e, w);
  assert.ok(Math.abs(a.yaw - (e.baseYaw + w.yawRate)) < 1e-9, `one second of turning: ${a.yaw}`);
  for (let i = 0; i < 600; i++) a = stepAim(a, { dYaw: 1, dPitch: 1, fine: false }, e, w);
  assert.equal(a.yaw, e.baseYaw + e.yawLimit);
  assert.equal(a.pitch, w.maxPitch);
});

test("chain shot balls stay within the chain and craters dig the ground", () => {
  const sim = new SandboxSim(R, buildLayout(1, { mirrorWedges: true }), { seed: 3, minions: 0 });
  sim.queue(0, { kind: "fire", emplacement: 2, yaw: 0.08, pitch: 0.05, charge: 1, fuse: 0, spin: Spin.None });
  let maxGap = 0;
  for (let i = 0; i < 60; i++) {
    sim.step();
    const f = sim.collect();
    for (let c = 0; c < f.chainCount; c++) {
      const o = c * 6;
      const dx = f.chains[o] - f.chains[o + 3], dy = f.chains[o + 1] - f.chains[o + 4], dz = f.chains[o + 2] - f.chains[o + 5];
      maxGap = Math.max(maxGap, Math.hypot(dx, dy, dz));
    }
  }
  assert.ok(maxGap > 1 && maxGap < WEAPONS.chainShot.chainLength + 0.15, `gap ${maxGap}`);
  const before = sim.terrain.heightAt(0, -60);
  sim.explode(0, 0.2, -60);
  assert.ok(sim.terrain.heightAt(0, -60) < before - 0.5, "a crater");
  sim.free();
});
