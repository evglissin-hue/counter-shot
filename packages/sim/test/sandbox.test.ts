import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, WEAPONS } from "@keepfall/content";
import { EventKind, EVENT_STRIDE, SandboxSim, Spin, Wind, stepAim, restAim, type Rapier, type SandboxInput } from "@keepfall/sim";
import { Rng } from "@keepfall/core";
import { ASHWRIGHT_EMPLACEMENTS } from "@keepfall/content";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1);

/** A scripted session: every weapon fires, the mortar twice with a fuse and on impact. */
const SCRIPT: Array<[number, SandboxInput]> = [
  [5, { kind: "fire", emplacement: 0, yaw: 0, pitch: 0.035, charge: 1, fuse: 0, spin: Spin.None }],
  [30, { kind: "fire", emplacement: 1, yaw: 0.02, pitch: 1.2, charge: 1, fuse: 260, spin: Spin.None }],
  [60, { kind: "fire", emplacement: 2, yaw: -0.08, pitch: 0.0, charge: 1, fuse: 0, spin: Spin.None }],
  [90, { kind: "fire", emplacement: 3, yaw: 0.0, pitch: -0.02, charge: 1, fuse: 0, spin: Spin.None }],
  [260, { kind: "fire", emplacement: 0, yaw: 0.05, pitch: 0.03, charge: 1, fuse: 0, spin: Spin.Left }],
  [420, { kind: "fire", emplacement: 1, yaw: 0.0, pitch: 1.03, charge: 1, fuse: 0, spin: Spin.None }],
];

function run(ticks: number) {
  const sim = new SandboxSim(R, layout, { seed: 7, minions: 12 });
  for (const [t, input] of SCRIPT) sim.queue(t, input);
  const events: number[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    if ((i & 7) === 0 || i === ticks - 1) {
      const f = sim.collect();
      for (let k = 0; k < f.eventCount; k++) events.push(f.events[k * EVENT_STRIDE]);
    }
  }
  const h = sim.hash();
  const counts = sim.minionCounts();
  sim.free();
  return { h, events, counts };
}

test("a scripted sandbox session replays to the same hash", () => {
  const a = run(900);
  const b = run(900);
  assert.deepEqual(a.h, b.h);
  console.log("sandbox hash", a.h, "minions", a.counts, "explosions", a.events.filter((k) => k === EventKind.Explosion).length);
  assert.ok(a.events.includes(EventKind.Explosion), "the mortar went off");
  assert.ok(a.events.includes(EventKind.Muzzle));
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
