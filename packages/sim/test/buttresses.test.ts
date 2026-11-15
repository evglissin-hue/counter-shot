import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BUTTRESS, buildLayout, GAME_LAYOUT, MATCH_EMPLACEMENTS, repairCost, repairSections, Unit } from "@keepfall/content";
import { ButtressState, EVENT_STRIDE, EventKind, MinionState, SandboxSim, raisePiece, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const world = (seed = 7) => new SandboxSim(R, layout, { seed, minions: 0, army: true, emplacements: MATCH_EMPLACEMENTS });

/** Step `n` ticks, counting the events of the given kinds (collected often enough not to overflow). */
function run(sim: SandboxSim, n: number, ...kinds: EventKind[]): Array<[EventKind, number, number, number, number]> {
  const got: Array<[EventKind, number, number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    if (i % 10 !== 9) continue;
    const f = sim.collect();
    for (let k = 0; k < f.eventCount; k++) {
      const o = k * EVENT_STRIDE;
      const kind = f.events[o] as EventKind;
      if (kinds.includes(kind)) got.push([kind, f.events[o + 1], f.events[o + 2], f.events[o + 3], f.events[o + 4]]);
    }
  }
  return got;
}

const range = (k: number) => {
  const b = layout.buttresses[k];
  return Array.from({ length: b.count }, (_, i) => b.first + i);
};

test("buttresses start withdrawn, and a bought one rises in about BUTTRESS.buildTicks, a Raised per piece and one Buttressed", () => {
  const sim = world();
  const B = sim.buttresses!;
  assert.equal(layout.buttresses.length, 8);
  for (let k = 0; k < 8; k++) {
    assert.equal(B.states[k], ButtressState.Empty);
    for (const id of range(k)) assert.ok(sim.castle.dynamic[id], "withdrawn");
  }
  assert.equal(B.build(0, 0, sim.tick), true);
  assert.equal(B.state(0, 0), ButtressState.Rising);
  assert.equal(B.build(0, 0, sim.tick), false, "already rising");
  const ev = run(sim, BUTTRESS.buildTicks + 60, EventKind.Raised, EventKind.Buttressed);
  assert.equal(B.state(0, 0), ButtressState.Standing);
  for (const id of range(0)) assert.ok(!sim.castle.dynamic[id], `piece ${id} stands`);
  const raised = ev.filter((e) => e[0] === EventKind.Raised && e[1] >= 0).map((e) => e[1]);
  assert.deepEqual([...raised].sort((a, b) => a - b), range(0));
  // Lowest course first.
  const courses = raised.map((id) => layout.stones[id].course);
  assert.deepEqual(courses, [...courses].sort((a, b) => a - b));
  const done = ev.filter((e) => e[0] === EventKind.Buttressed);
  assert.equal(done.length, 1);
  assert.deepEqual(done[0].slice(1), [0, 0, 0, 0]);
  assert.equal(B.build(0, 0, sim.tick), false, "standing");
  // The other buttresses stayed bare.
  for (let k = 1; k < 8; k++) assert.equal(B.states[k], ButtressState.Empty);
  // Hashed: the state changes the hash.
  const h = [] as number[];
  B.hashInto(h);
  assert.ok(h.length > 0);
  sim.free();
});

test("a buttress on castle 1's face rises on its own, and a bad face index builds nothing", () => {
  const sim = world();
  const B = sim.buttresses!;
  assert.equal(B.build(1, 4, 0), false);
  assert.equal(B.build(1, 2, sim.tick), true);
  assert.equal(B.state(1, 2), ButtressState.Rising);
  assert.equal(B.state(0, 2), ButtressState.Empty);
  run(sim, BUTTRESS.buildTicks + 60);
  assert.equal(B.state(1, 2), ButtressState.Standing);
  sim.free();
});

test("a minion standing in a piece's place holds the piece back until he leaves; the fallen are buried", () => {
  const sim = world();
  const id = range(0)[0];
  const st = layout.stones[id];
  const wave = sim.army!.newWave(1, 1);
  const m = sim.army!.spawnAt(1, wave, Unit.Pikeman, st.x, st.z, 0);
  assert.equal(m.state, MinionState.Upright);
  sim.step(); // the broad phase sees him
  const noEmit = () => {};
  const call = () => raisePiece(sim.castle, sim.minions, sim.terrain.handles, noEmit, layout, id);
  assert.equal(call(), false, "a living minion is waited for");
  assert.ok(sim.castle.dynamic[id], "the piece is not up");
  sim.minions.knock({ minion: m.id, vx: 0, vy: 0, vz: 0, px: m.x, py: m.y + 1, pz: m.z, extra: 0 }, sim.tick);
  m.state = MinionState.Gone;
  assert.equal(call(), true, "once he has gone it goes up");
  assert.ok(!sim.castle.dynamic[id]);
  sim.free();
});

test("a piece knocked down while the buttress rises goes up again before it counts as finished", () => {
  const sim = world();
  const B = sim.buttresses!;
  B.build(0, 1, sim.tick);
  run(sim, BUTTRESS.buildTicks - 120);
  const ids = range(1);
  const up = ids.filter((id) => !sim.castle.dynamic[id]);
  assert.ok(up.length > 0 && up.length < ids.length, `${up.length} of ${ids.length} up`);
  // Knock down the topmost piece standing.
  const top = up.reduce((a, b) => (layout.stones[b].course > layout.stones[a].course ? b : a));
  sim.castle.knockLoose(top, 0, 1, 0);
  run(sim, 400);
  assert.equal(B.state(0, 1), ButtressState.Standing);
  for (const id of ids) assert.ok(!sim.castle.dynamic[id], `piece ${id} stands`);
  sim.free();
});

test("masons never touch an unbought buttress", () => {
  const sim = world();
  const paid = { gold: 0 };
  sim.works!.policy = { allowed: () => true, pay: (_t, c) => ((paid.gold += c), true) };
  sim.works!.spawnCrew(0);
  sim.works!.spawnCrew(1);
  const ev = run(sim, 40 * 60, EventKind.Laid);
  for (const e of ev) assert.ok(!layout.buttresses.some((b) => e[1] >= b.first && e[1] < b.first + b.count), `laid ${e[1]}`);
  for (let k = 0; k < 8; k++) {
    assert.equal(sim.buttresses!.states[k], ButtressState.Empty);
    for (const id of range(k)) assert.ok(sim.castle.dynamic[id]);
  }
  assert.equal(paid.gold, 0);
  sim.free();
});

test("masons put back the stones of a standing buttress that came down, at REPAIR.cost.buttress", () => {
  const sim = world();
  const B = sim.buttresses!;
  B.build(0, 0, sim.tick);
  run(sim, BUTTRESS.buildTicks + 60);
  assert.equal(B.state(0, 0), ButtressState.Standing);
  const ids = range(0);
  // The top course of one pier comes down (nothing rests on it).
  const topCourse = Math.max(...ids.map((id) => layout.stones[id].course));
  const knocked = ids.filter((id) => layout.stones[id].course === topCourse).slice(0, 2);
  for (const id of knocked) sim.castle.knockLoose(id, 0, 1, 0);
  const down = ids.filter((id) => sim.castle.dynamic[id]);
  assert.ok(down.length >= 2);
  let paid = 0;
  sim.works!.policy = { allowed: () => true, pay: (_t, c) => ((paid += c), true) };
  sim.works!.spawnCrew(0);
  const ev = run(sim, 90 * 60, EventKind.Laid);
  const laid = ev.map((e) => e[1]).filter((id) => ids.includes(id));
  for (const id of down) assert.ok(!sim.castle.dynamic[id], `piece ${id} put back`);
  assert.ok(laid.length >= down.length);
  assert.equal(paid, ev.reduce((s, e) => s + repairCost(layout.stones[e[1]]), 0), "every stone paid at its price");
  assert.equal(repairCost(layout.stones[knocked[0]]), 2);
  sim.free();
});

// Masons by load (rule 12), against a stub of the statics pass.

const keepSec = repairSections(layout).find((s) => s.castle === 0 && s.kind === "keep")!;
const keepSet = new Set(keepSec.stones);

test("rule 12: masons in the keep section put back a stone of the course carrying the most first", () => {
  const sim = world();
  const keepPieces = keepSec.stones.filter((id) => layout.stones[id].part === "keep");
  const KZ = (layout.stones[keepPieces[0]].z + layout.stones[keepPieces[keepPieces.length - 1]].z) / 2;
  const pick = (course: number, front: boolean) => keepPieces.find((id) => layout.stones[id].course === course && (layout.stones[id].z < KZ) === front && Math.abs(layout.stones[id].x) < 3)!;
  const low = pick(2, true), high = pick(6, false);
  assert.ok(low !== undefined && high !== undefined);
  sim.castle.knockLoose(high, 0, 1, 0);
  sim.castle.knockLoose(low, 0, 1, 0);
  for (let i = 0; i < 120; i++) sim.step();
  sim.works!.statics = { ratio: (_i, c) => (c === 6 ? 5 : 1), structureOf: (id) => (keepSet.has(id) ? 0 : -1), status: () => ({ holds: 1 }) };
  sim.works!.policy = { allowed: () => true, pay: () => true };
  sim.works!.spawnCrew(0);
  const ev = run(sim, 120 * 60, EventKind.Laid).map((e) => e[1]).filter((id) => keepSet.has(id));
  assert.ok(ev.length >= 2, `${ev.length} keep stones laid`);
  const firstCourse = layout.stones[ev[0]].course;
  assert.equal(firstCourse, 6, `first laid is course ${firstCourse}`);
  sim.free();
});

test("rule 12: without statics the same damage is mended from the lowest course up", () => {
  const sim = world();
  const keepPieces = keepSec.stones.filter((id) => layout.stones[id].part === "keep");
  const KZ = (layout.stones[keepPieces[0]].z + layout.stones[keepPieces[keepPieces.length - 1]].z) / 2;
  const pick = (course: number, front: boolean) => keepPieces.find((id) => layout.stones[id].course === course && (layout.stones[id].z < KZ) === front && Math.abs(layout.stones[id].x) < 3)!;
  sim.castle.knockLoose(pick(6, false), 0, 1, 0);
  sim.castle.knockLoose(pick(2, true), 0, 1, 0);
  for (let i = 0; i < 120; i++) sim.step();
  sim.works!.statics = null;
  sim.works!.policy = { allowed: () => true, pay: () => true };
  sim.works!.spawnCrew(0);
  const ev = run(sim, 120 * 60, EventKind.Laid).map((e) => e[1]).filter((id) => keepSet.has(id));
  assert.equal(layout.stones[ev[0]].course, 2);
  sim.free();
});

test("rule 12: a keep that holds only 0.3 is mended before a broken gate", () => {
  const sim = world();
  const gate = repairSections(layout).find((s) => s.castle === 0 && s.kind === "gate")!;
  for (const id of gate.stones.slice(0, 3)) sim.castle.knockLoose(id, 0, 1, 0);
  const keepPieces = keepSec.stones.filter((id) => layout.stones[id].part === "keep");
  sim.castle.knockLoose(keepPieces.find((id) => layout.stones[id].course === 8)!, 0, 1, 0);
  for (let i = 0; i < 120; i++) sim.step();
  assert.ok(gate.stones.some((id) => sim.castle.dynamic[id]));
  sim.works!.statics = { ratio: () => 1, structureOf: (id) => (keepSet.has(id) ? 0 : -1), status: () => ({ holds: 0.3 }) };
  sim.works!.policy = { allowed: () => true, pay: () => true };
  sim.works!.spawnCrew(0);
  const gateSet = new Set(gate.stones);
  const ev = run(sim, 120 * 60, EventKind.Laid).map((e) => e[1]).filter((id) => keepSet.has(id) || gateSet.has(id));
  assert.ok(ev.length >= 2, `${ev.length} laid`);
  assert.ok(keepSet.has(ev[0]), "the keep first");
  sim.free();
});
