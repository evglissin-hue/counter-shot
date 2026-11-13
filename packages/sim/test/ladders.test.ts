import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, inCourtyard, MATCH_EMPLACEMENTS, Unit } from "@keepfall/content";
import { Climb, LadderState, MinionState, Order, SandboxSim, SapperTask, type Minion, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const world = (seed = 7) => new SandboxSim(R, layout, { seed, minions: 0, army: true, emplacements: MATCH_EMPLACEMENTS });
const CENTRE = 1;
const SECS = 60; // ticks per second

/** The pieces a ladder at each spot of castle 0 leans on (private to the ladders, read here to loosen them). */
function support(sim: SandboxSim): number[][] {
  const L = sim.ladders as unknown as { support: number[][]; spots: { castle: number }[] };
  return L.support.filter((_, k) => L.spots[k].castle === 0);
}

/** The standing men of team 1 walking to a ladder or waiting at its foot, per ladder. */
function claimed(sim: SandboxSim, id: number): number {
  let n = 0;
  for (const m of sim.minions.list) if (m.team === 1 && m.state === MinionState.Upright && (m.task === Climb.ToLadder || m.task === Climb.Wait) && m.aux === id) n++;
  return n;
}

test("a wall with a top stone knocked loose at every spot still takes a ladder", () => {
  const sim = world();
  // The topmost piece at each crenel comes loose: the wall still stands 7.5 m.
  for (const ids of support(sim)) {
    const top = ids.reduce((a, b) => (layout.stones[b].course > layout.stones[a].course ? b : a), ids[0]);
    sim.castle.knockLoose(top, 0, 0, -0.5);
  }
  sim.army!.spawnWave(1, CENTRE, 8, { x: 0, z: -44 }, { ladder: true });
  let planted = -1;
  for (let i = 0; i < 80 * SECS && planted < 0; i++) {
    sim.step();
    if (sim.ladders!.planted[1] > 0) planted = i;
  }
  assert.ok(planted > 0, "a ladder was planted against the damaged wall");
  sim.free();
});

test("a crew with no usable spot drops its ladder within 20 s of reaching the wall and never carries it into the courtyard", () => {
  const sim = world();
  // The top four courses are gone at every spot: the wall stands under 6 m there.
  for (const ids of support(sim)) for (const id of ids) sim.castle.knockLoose(id, 0, 0, -0.5);
  sim.army!.spawnWave(1, CENTRE, 8, { x: 0, z: -44 }, { ladder: true });
  const L = sim.ladders!;
  const crew = sim.minions.list.filter((m) => m.unit === Unit.Ladder);
  let nearAt = -1, droppedAt = -1, carriedInside = 0;
  for (let i = 0; i < 100 * SECS && droppedAt < 0; i++) {
    sim.step();
    const l = L.list[0];
    const a = sim.minions.list[l.front];
    if (nearAt < 0 && a.z > -16 - 34 && l.state === LadderState.Carried) nearAt = i;
    if (l.state === LadderState.Carried && inCourtyard(0, a.x, a.z)) carriedInside++;
    if (l.state === LadderState.Down) droppedAt = i;
  }
  assert.equal(L.planted[1], 0, "no ladder was raised");
  assert.ok(droppedAt > 0, "the crew dropped its ladder");
  assert.equal(carriedInside, 0, "never carried into the courtyard");
  assert.ok(droppedAt - nearAt <= 20 * SECS + 5, `dropped ${((droppedAt - nearAt) / SECS).toFixed(1)} s after reaching the wall`);
  for (const m of crew) {
    assert.equal(m.task, Climb.None, "the crew is free");
  }
  sim.free();
});

test("a crew whose way in is open drops its ladder and goes with the wave", () => {
  const sim = world();
  // A breach in the front wall left of the gate, before the wave comes.
  for (const x of [-10, -9]) sim.explode(x, 0.7, -15.3);
  for (let i = 0; i < 120; i++) sim.step();
  sim.army!.spawnWave(1, CENTRE, 8, { x: 0, z: -60 }, { ladder: true });
  for (let i = 0; i < 20 * SECS; i++) sim.step();
  assert.equal(sim.ladders!.planted[1], 0, "nothing was raised");
  assert.equal(sim.ladders!.list[0].state, LadderState.Down, "the ladder was dropped");
  sim.free();
});

test("men reaching the wall walk wait for each other and land together", () => {
  const sim = world();
  sim.army!.spawnWave(1, CENTRE, 8, { x: 0, z: -44 }, { ladder: true });
  const men = sim.minions.list.filter((m) => m.team === 1);
  const landed: number[] = [];
  const was = new Map<number, number>();
  let waited = 0;
  for (let i = 0; i < 90 * SECS; i++) {
    sim.step();
    for (const m of men) {
      const prev = was.get(m.id) ?? 0;
      if (prev === Climb.Down && m.task !== Climb.Down && m.state === MinionState.Upright) landed.push(i);
      was.set(m.id, m.task);
      if (m.task === Climb.Across && m.climb === 0 && m.action === 1) waited++;
    }
  }
  assert.ok(waited > 0, "men stood on the wall walk waiting");
  assert.ok(landed.length >= 4, `${landed.length} landed`);
  // A group of three lands within three seconds.
  let grouped = false;
  for (let k = 0; k + 2 < landed.length; k++) if (landed[k + 2] - landed[k] <= 3 * SECS) grouped = true;
  assert.ok(grouped, `landings at ${landed.map((t) => (t / SECS).toFixed(1)).join(", ")} s`);
  sim.free();
});

test("a man who falls on his way to a ladder frees his place in its queue", () => {
  const sim = world();
  sim.army!.spawnWave(1, CENTRE, 10, { x: 0, z: -44 }, { ladder: true });
  const L = sim.ladders!;
  let knocked = 0, mismatch = 0, checked = 0;
  for (let i = 0; i < 90 * SECS; i++) {
    sim.step();
    for (const l of L.list) {
      if (l.state !== LadderState.Planted) continue;
      checked++;
      if (l.claims !== claimed(sim, l.id)) mismatch++;
    }
    if (knocked < 4) {
      for (const m of sim.minions.list) {
        if (knocked >= 4 || m.team !== 1 || m.state !== MinionState.Upright || m.task !== Climb.ToLadder) continue;
        sim.minions.knock({ minion: m.id, vx: 0, vy: 2, vz: 2, px: m.x, py: 1, pz: m.z, extra: 1, cause: 1 }, sim.tick);
        knocked++;
      }
    }
  }
  assert.ok(knocked >= 1, "someone was knocked down on his way");
  assert.ok(checked > 100);
  assert.equal(mismatch, 0, "claims always match the men walking and waiting");
  sim.free();
});

test("Hold makes walkers and waiters give up their places and a crew drop its spot", () => {
  const sim = world();
  sim.army!.spawnWave(1, CENTRE, 12, { x: 0, z: -44 }, { ladder: true });
  const L = sim.ladders!;
  // A crew with a spot chosen, carrying: Hold drops the spot.
  let held = false;
  for (let i = 0; i < 60 * SECS && !held; i++) {
    sim.step();
    if (L.list[0].state === LadderState.Carried && L.list[0].spot >= 0) {
      sim.army!.setOrder(1, Order.Hold);
      sim.step();
      sim.step();
      assert.equal(L.list[0].spot, -1, "the crew dropped its spot");
      assert.equal(L.list[0].state, LadderState.Carried);
      held = true;
    }
  }
  assert.ok(held, "the crew chose a spot");
  sim.free();

  // Men walking to a planted ladder or waiting at its foot.
  const s2 = world();
  s2.army!.spawnWave(1, CENTRE, 12, { x: 0, z: -44 }, { ladder: true });
  let given = false;
  for (let i = 0; i < 90 * SECS && !given; i++) {
    s2.step();
    const l = s2.ladders!.list[0];
    if (l.state === LadderState.Planted && claimed(s2, 0) >= 3) {
      s2.army!.setOrder(1, Order.Hold);
      s2.step();
      s2.step();
      assert.equal(claimed(s2, 0), 0, "nobody walks to or waits at the ladder");
      assert.equal(l.claims, 0);
      for (const m of s2.minions.list) if (m.team === 1 && m.state === MinionState.Upright) assert.ok(m.task !== Climb.ToLadder && m.task !== Climb.Wait);
      given = true;
    }
  }
  assert.ok(given, "men were queueing");
  s2.free();
});

test("a sapper who has set his keg climbs, and keeps SapperTask.Done after; one still with his keg does not", () => {
  const sim = world();
  sim.army!.spawnWave(1, CENTRE, 8, { x: 0, z: -44 }, { ladder: true });
  const L = sim.ladders!;
  for (let i = 0; i < 60 * SECS && L.planted[1] === 0; i++) sim.step();
  assert.ok(L.planted[1] > 0);
  const sp = L.spots[L.list[0].spot];
  sim.army!.spawnMix(1, CENTRE, [Unit.Sapper], 0, { x: sp.x, z: sp.footZ - 4 });
  const m: Minion = sim.minions.list[sim.minions.list.length - 1];
  assert.equal(m.unit, Unit.Sapper);
  const task = () => m.task as number;
  m.task = SapperTask.Carry;
  assert.equal(L.claim(m, false), false, "a sapper with his keg does not");
  m.task = SapperTask.Done;
  assert.equal(L.claim(m, false), true, "a finished sapper does");
  assert.equal(task(), Climb.ToLadder);
  let climbed = false, over = false;
  for (let i = 0; i < 90 * SECS && !over; i++) {
    sim.step();
    if (m.state !== MinionState.Upright) break;
    if (task() >= Climb.Up && task() <= Climb.Down) climbed = true;
    if (task() === SapperTask.Done) over = true;
    assert.ok(task() !== SapperTask.Carry && task() !== SapperTask.Plant && task() !== SapperTask.Run, "never a keg task while climbing");
  }
  assert.ok(climbed, "he went up the ladder");
  assert.ok(over, "his climb ended with SapperTask.Done");
  sim.free();
});

test("two ladders share the men", () => {
  const sim = world();
  sim.army!.spawnWave(1, CENTRE, 6, { x: -3, z: -44 }, { ladder: true });
  sim.army!.spawnWave(1, CENTRE, 6, { x: 3, z: -44 }, { ladder: true });
  const L = sim.ladders!;
  for (let i = 0; i < 70 * SECS && L.planted[1] < 2; i++) sim.step();
  assert.equal(L.planted[1], 2, "both ladders went up");
  // A big wave in the middle: both ladders get men.
  sim.army!.spawnMix(1, CENTRE, new Array<number>(16).fill(0), 0, { x: 0, z: -34 });
  let worst = Infinity, seen = 0;
  for (let i = 0; i < 40 * SECS; i++) {
    sim.step();
    const a = L.list.filter((l) => l.state === LadderState.Planted);
    if (a.length < 2) continue;
    const loads = a.map((l) => l.claims + l.on.length);
    if (Math.max(...loads) >= 6) {
      seen++;
      worst = Math.min(worst, Math.min(...loads));
    }
  }
  assert.ok(seen === 0 || worst >= 2, `a queue of 6 or more while another had ${worst}`);
  sim.free();
});
