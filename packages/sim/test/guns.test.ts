// After M5: guns stand on real masonry and can be knocked out; the chain
// shot's chain sweeps. The Practice range's world has the match's sixteen
// emplacements: 0 to 7 the player's castle, 8 to 15 the target castle's
// (8 its long gun on the gate wall, 9 its mortar in the courtyard).
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, REMOUNT } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, OutCause, SandboxSim, solveAim, Spin, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);

/** Step a sim, collecting the events of the kinds asked for: [kind, a, b, c, d] each. */
function run(sim: SandboxSim, ticks: number, kinds: EventKind[]): number[][] {
  const out: number[][] = [];
  for (let t = 0; t < ticks; t++) {
    sim.step();
    const f = sim.collect();
    for (let k = 0; k < f.eventCount; k++) {
      const o = k * EVENT_STRIDE;
      if (kinds.includes(f.events[o])) out.push(Array.from(f.events.subarray(o, o + EVENT_STRIDE)));
    }
  }
  return out;
}

test("after M5: a gun falls with the masonry under it, cannot fire while it is out, and is back once that masonry stands again", () => {
  const sim = new SandboxSim(R, layout, { seed: 3, minions: 0 });
  const M = sim.mounts;
  assert.ok(M.pieces[8].length >= 6, `the gate wall's long gun stands on its wall walk (${M.pieces[8].length} pieces)`);
  assert.ok(M.pieces[10].length >= 30, `a tower's gun stands on the top of its ring (${M.pieces[10].length} pieces)`);
  assert.equal(M.pieces[9].length, 0, "a mortar stands on the ground");
  // The wall walk under the long gun gives way.
  for (const id of M.pieces[8]) sim.castle.knockLoose(id, 0, -50, 0);
  const outs = run(sim, 2, [EventKind.GunOut]);
  assert.deepEqual(outs.map((e) => [e[1], e[2]]), [[8, OutCause.Mount]], "it fell with its masonry");
  assert.equal(M.up(8), false);
  // Out, it cannot fire.
  sim.queue(sim.tick, { kind: "fire", emplacement: 8, yaw: sim.emplacements[8].baseYaw, pitch: 0, charge: 1, fuse: 0, spin: Spin.None });
  assert.equal(run(sim, 3, [EventKind.Muzzle]).length, 0, "a knocked-out gun does not fire");
  // Its crew's time passes, but the masonry is still down: it waits.
  assert.equal(run(sim, REMOUNT.ticks, [EventKind.GunBack]).length, 0, "not back while its masonry is down");
  // Masons put the wall walk back: its crew has it on its mount again, loaded afresh.
  for (const id of M.pieces[8]) sim.castle.restore(id);
  const backs = run(sim, 2, [EventKind.GunBack]);
  assert.deepEqual(backs.map((e) => e[1]), [8], "back once its masonry stands");
  assert.equal(M.up(8), true);
  assert.ok(sim.reload[8] > 0, "and loaded afresh");
  sim.free();
});

test("after M5: a chain shot sweeps the crew off a gun, a shell beside one blows it off its bed, and its crew has it back in time", () => {
  // The player's chain shot (2) on the target castle's long gun (8), in still air.
  const sim = new SandboxSim(R, layout, { seed: 4, minions: 0 });
  sim.wind.x = sim.wind.z = 0;
  const g = sim.emplacements[8];
  const s = solveAim(sim.emplacements[2], g.x, g.y - 0.3, g.z);
  assert.ok(s, "the chain shot can reach the gate wall");
  sim.queue(0, { kind: "fire", emplacement: 2, yaw: s!.yaw, pitch: s!.pitch, charge: 1, fuse: 0, spin: Spin.None });
  const outs = run(sim, 150, [EventKind.GunOut]);
  assert.deepEqual(outs.map((e) => [e[1], e[2]]), [[8, OutCause.Chain]], "its crew swept off the wall");
  // Back after the crew's time (nothing under it fell).
  const backs = run(sim, REMOUNT.ticks, [EventKind.GunBack]);
  assert.deepEqual(backs.map((e) => e[1]), [8], "back in action");
  // A shell bursting beside the target castle's mortar in its pit.
  const m = sim.emplacements[9];
  sim.explode(m.x + 1.5, m.y, m.z + 1);
  const burst = run(sim, 1, [EventKind.GunOut]);
  assert.deepEqual(burst.map((e) => [e[1], e[2]]), [[9, OutCause.Burst]], "blown off its bed");
  sim.free();
});

test("after M5: a ball must strike a gun square to knock it out; one passing over its crew does not", () => {
  const near = (dy: number) => {
    const sim = new SandboxSim(R, layout, { seed: 5, minions: 0 });
    sim.wind.x = sim.wind.z = 0;
    const g = sim.emplacements[8];
    const s = solveAim(sim.emplacements[0], g.x, g.y - 0.3 + dy, g.z);
    sim.queue(0, { kind: "fire", emplacement: 0, yaw: s!.yaw, pitch: s!.pitch, charge: 1, fuse: 0, spin: Spin.None });
    const outs = run(sim, 120, [EventKind.GunOut]).filter((e) => e[1] === 8);
    sim.free();
    return outs.map((e) => e[2]);
  };
  assert.deepEqual(near(0), [OutCause.Shot], "a square hit smashes it");
  assert.deepEqual(near(1.6), [], "a ball 1.6 m over it flies on");
});
