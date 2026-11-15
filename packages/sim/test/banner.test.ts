// A felled keep ends the match however its banner lands (rules version 16): the banner is down below bannerFallY, or once no storey
// board is tipping and it no longer stands on its keep. The banner is held still at a chosen place (teleported every tick).
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, CASTLE_SHAPE, GAME_LAYOUT, mirrorZ, structureList } from "@keepfall/content";
import { SandboxSim, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const L = structureList(layout);
const KEEP = 0;
const world = () => new SandboxSim(R, layout, { seed: 7, minions: 0 });

const rel = (id: number) => {
  const s = layout.stones[id];
  return { x: s.x - L[KEEP].cx, z: s.z - L[KEEP].cz, c: s.course, part: s.part };
};
/** The keep's -z face (every course in [c0, c1]) and a third of each side nearest it: it topples towards -z. */
const faceCut = (c0: number, c1: number, side = 1 / 3): number[] =>
  L[KEEP].stones.filter((id) => {
    const p = rel(id);
    return p.part === "keep" && p.c >= c0 && p.c <= c1 && (p.z < -3 || (Math.abs(p.x) > 3 && p.z < -5 + 10 * side));
  });
const cut = (sim: SandboxSim, ids: number[]) => {
  for (const id of ids) if (!sim.castle.dynamic[id]) sim.castle.dust(id);
  sim.castle.supportNow();
};
const boards = () => L[KEEP].stones.filter((id) => layout.stones[id].part === "storey");
const tipping = (sim: SandboxSim) => boards().some((id) => sim.castle.busy[id] !== 0);

type At = { x: number; y: number; z: number };
/** Hold castle 0's banner at `at` (null: leave it) and step n ticks; `each` sees the tick. */
function hold(sim: SandboxSim, at: At | null, n: number, each?: (t: number) => void, lay = layout) {
  const body = sim.castle.bodies[lay.bannerIds[0]];
  for (let t = 1; t <= n; t++) {
    if (at) {
      body.setTranslation(at, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    sim.step();
    each?.(t);
  }
}
const kz = mirrorZ(0, CASTLE_SHAPE.keepZ);

/**
 * Cut the keep and let the world run; once the tipping part is let go (no storey board busy after some were), hold the banner at `at`.
 * Returns the tick the last board stopped tipping, the tick the banner was down, and whether it was down while a board tipped.
 */
function fall(ids: number[], at: At, secs = 20) {
  const sim = world();
  cut(sim, ids);
  const body = sim.castle.bodies[layout.bannerIds[0]];
  let tipped = 0, released = -1, down = -1, downWhileTipping = false;
  for (let t = 1; t <= secs * 60; t++) {
    if (released > 0) {
      body.setTranslation(at, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    sim.step();
    const tp = tipping(sim);
    if (tp) tipped = t;
    if (tp && sim.castle.toppled[0]) downWhileTipping = true;
    if (!tp && tipped > 0 && released < 0) released = t;
    if (down < 0 && sim.castle.toppled[0]) down = t;
  }
  return { sim, tipped, released, down, downWhileTipping };
}

test("an untouched game castle: banner not down after some seconds", () => {
  const sim = world();
  hold(sim, null, 600);
  assert.ok(!sim.castle.toppled[0] && !sim.castle.toppled[1]);
  sim.free();
});

for (const [name, at] of [
  ["7 m over the rubble heap, outside the footprint", { x: 0, y: 7, z: kz - 12 }],
  ["5 m inside the footprint", { x: 0, y: 5, z: kz }],
] as const) {
  test(`a keep toppled from its foot: not down while the part tips, down once let go (banner ${name})`, () => {
    const r = fall(faceCut(2, 4), at);
    console.log("  tipped until", r.tipped, "released", r.released, "down", r.down);
    assert.ok(r.tipped > 0, "the part tipped");
    assert.ok(!r.downWhileTipping, "not down while storeys tip");
    assert.ok(r.released > 0 && r.down >= r.released, "down once let go");
    r.sim.free();
  });
}

const HIGH = faceCut(15, 18, 0.55);
test("banner caught on a curtain wall top outside the footprint after a higher fall: down", () => {
  const r = fall(HIGH, { x: 0, y: 8, z: kz - 14 });
  console.log("  higher fall, off the keep: tipped", r.tipped, "released", r.released, "down", r.down);
  assert.ok(r.tipped > 0 && r.released > 0, "the part tipped and was let go");
  assert.ok(!r.downWhileTipping);
  assert.ok(r.down >= r.released);
  r.sim.free();
});

test("the same higher fall with the banner lying on the standing 7 m storey inside the keep: not down", () => {
  const r = fall(HIGH, { x: 0, y: 7.7, z: kz });
  console.log("  higher fall, on the storey: tipped", r.tipped, "released", r.released, "down", r.down);
  assert.ok(r.tipped > 0 && r.released > 0, "the part was let go");
  const low = boards().filter((id) => layout.stones[id].y < 9);
  assert.ok(low.length > 0 && low.some((id) => r.sim.castle.dynamic[id] === 0), "the 7 m storey stands");
  assert.equal(r.down, -1);
  assert.ok(!r.sim.castle.toppled[0]);
  r.sim.free();
});

test("the floors path: the top storey broken, banner on the 13.5 m level over the 7 m storey: not down", () => {
  const sim = world();
  const top = boards().filter((id) => layout.stones[id].y > 10);
  assert.ok(top.length > 0);
  cut(sim, top);
  hold(sim, { x: 0, y: 13.75, z: kz }, 600);
  assert.ok(!sim.castle.toppled[0]);
  sim.free();
});

test("the lab layout's check is unchanged: banner high with no floors: not down; below the fall line: down", () => {
  const lab = buildLayout(1);
  assert.ok(!lab.keepFloors);
  const sim = new SandboxSim(R, lab, { seed: 7, minions: 0 });
  const p = sim.castle.bodies[lab.bannerIds[0]].translation();
  hold(sim, { x: 40, y: lab.bannerFallY + 3, z: p.z + 30 }, 120, undefined, lab);
  assert.ok(!sim.castle.toppled[0]);
  hold(sim, { x: p.x, y: lab.bannerFallY - 1, z: p.z }, 1, undefined, lab);
  assert.ok(sim.castle.toppled[0]);
  sim.free();
});
