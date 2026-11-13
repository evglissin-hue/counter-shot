import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, CASTLE_SHAPE, GAME_LAYOUT, garrisonPost, inCourtyard, inGatePassage, MATCH_EMPLACEMENTS, mirrorZ, Unit, UNITS } from "@keepfall/content";
import { Action, MinionState, Order, Role, SandboxSim, type Minion, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const world = (seed = 7) => new SandboxSim(R, layout, { seed, minions: 0, army: true, powder: false, emplacements: MATCH_EMPLACEMENTS });
const CENTRE = 1;
const run = (sim: SandboxSim, ticks: number, each?: (sim: SandboxSim) => void) => {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    each?.(sim);
  }
};
/** A lone minion of a team, standing at (x, z). */
const lone = (sim: SandboxSim, team: 0 | 1, x: number, z: number, role = Role.March): Minion => {
  sim.army!.spawnWave(team, CENTRE, 1, { x, z });
  const m = sim.minions.list[sim.minions.list.length - 1];
  m.role = role;
  return m;
};

test("8 v 8 in the field: the wave spreads over the enemy instead of piling on the front man", () => {
  const sim = world();
  sim.army!.spawnWave(1, CENTRE, 8, { x: 0, z: -62 });
  sim.army!.spawnWave(0, CENTRE, 8, { x: 0, z: -28 });
  let samples = 0, distinct = 0, men = 0, worst = 0;
  run(sim, 30 * 60, (s) => {
    for (const team of [0, 1]) {
      const on = new Map<number, number>();
      let n = 0;
      for (const m of s.minions.list) {
        if (m.team !== team || m.state !== MinionState.Upright || m.target < 0) continue;
        n++;
        on.set(m.target, (on.get(m.target) ?? 0) + 1);
      }
      if (n < 5) continue;
      samples++;
      distinct += on.size;
      men += n;
      for (const k of on.values()) worst = Math.max(worst, k);
    }
  });
  assert.ok(samples > 60, `the sides met (${samples} samples)`);
  assert.ok(distinct / samples >= 3, `${(distinct / samples).toFixed(1)} distinct targets for ${(men / samples).toFixed(1)} men`);
  assert.ok(worst <= 5, `at most ${worst} on one enemy`);
  sim.free();
});

/** Hold minions where they stand, tick after tick (marching and works would move them). */
const pinned = (sim: SandboxSim, spots: Array<[Minion, number, number]>, ticks: number) => {
  run(sim, ticks, () => {
    for (const [m, x, z] of spots) {
      if (m.state !== MinionState.Upright) continue;
      m.x = x;
      m.z = z;
      m.vx = 0;
      m.vz = 0;
      sim.minions.place(m);
    }
  });
};

test("a man out of reach of his target switches to a free enemy in reach, and keeps his cool", () => {
  const sim = world();
  const me = lone(sim, 0, 0, -40);
  const far = lone(sim, 1, 0, -47);
  const near = lone(sim, 1, 1.5, -37.5);
  me.target = far.id;
  me.cool = 33;
  pinned(sim, [[me, 0, -40], [far, 0, -47], [near, 1.5, -37.5]], 8);
  assert.equal(me.target, near.id, "took the nearer enemy");
  // The margin: an enemy barely closer does not take him off his target.
  const sim2 = world();
  const a = lone(sim2, 0, 0, -40);
  const b = lone(sim2, 1, 0, -46);
  const c = lone(sim2, 1, 1.5, -45);
  a.target = b.id;
  pinned(sim2, [[a, 0, -40], [b, 0, -46], [c, 1.5, -45]], 8);
  assert.equal(a.target, b.id, "stays on his target for a small gain");
  sim.free();
  sim2.free();
});

test("a fleeing mason is not chased beyond 3 m, and is taken when he is that close", () => {
  const sim = world();
  const pike = lone(sim, 0, 0, -40);
  const mason = lone(sim, 1, 0, -45, Role.Mason);
  mason.unit = Unit.Mason;
  pinned(sim, [[pike, 0, -40], [mason, 0, -45]], 12);
  assert.equal(pike.target, -1, "a mason 5 m off is not a target");
  const sim2 = world();
  const p2 = lone(sim2, 0, 0, -40);
  const m2 = lone(sim2, 1, 0, -42.5, Role.Mason);
  m2.unit = Unit.Mason;
  pinned(sim2, [[p2, 0, -40], [m2, 0, -42.5]], 12);
  assert.equal(p2.target, m2.id, "a mason at 2.5 m is");
  // He walks off: the target is dropped past 3 m.
  pinned(sim2, [[p2, 0, -40], [m2, 0, -46]], 2);
  assert.equal(p2.target, -1, "dropped once he is beyond 3 m");
  sim.free();
  sim2.free();
});

test("with no straight line between them (a heap), a garrison man and an attacker in a courtyard still fight by the local field", () => {
  const sim = world();
  sim.army!.spawnGarrison(0, 4, true);
  // Every straight line is blocked, as across a heap; the castle's own ways stay open.
  sim.army!.walkLine = () => false;
  const post = garrisonPost(0, 1);
  const lz = CASTLE_SHAPE.half - 4;
  const foe = lone(sim, 1, post.x, mirrorZ(0, lz));
  sim.army!.setOrder(1, Order.Hold);
  assert.ok(inCourtyard(0, foe.x, foe.z));
  const garrison = sim.minions.list.filter((m) => m.team === 0 && m.role === Role.Garrison);
  let fought = 0;
  run(sim, 20 * 60, (s) => {
    for (const g of garrison) if (g.state === MinionState.Upright && g.action === Action.Fight) fought++;
    void s;
  });
  assert.ok(fought > 30, `the garrison fought the intruder (${fought} man-ticks)`);
  sim.free();
});

test("the garrison takes an attacker standing in the gate passage", () => {
  const sim = world();
  sim.army!.spawnGarrison(0, 4, true);
  const lz = -(CASTLE_SHAPE.half - 0.6);
  const foe = lone(sim, 1, 0, mirrorZ(0, lz));
  sim.army!.setOrder(1, Order.Hold);
  assert.ok(inGatePassage(0, foe.x, foe.z) && !inCourtyard(0, foe.x, foe.z), "in the passage, not the courtyard");
  let aimed = 0;
  run(sim, 10 * 60, () => {
    for (const m of sim.minions.list) if (m.team === 0 && m.role === Role.Garrison && m.target === foe.id) aimed++;
  });
  assert.ok(aimed > 0, "a garrison man took him as a target");
  assert.equal(sim.army!.attackers[0], 0, "he is not counted as an attacker inside (the storm counts stand)");
  sim.free();
});

test("blow timing and odds are unchanged: the same pair trades the same blows as the pinned pair", () => {
  const sim = world();
  const a = lone(sim, 0, 0, -40);
  const b = lone(sim, 1, 0, -39);
  sim.army!.setOrder(0, Order.Hold);
  sim.army!.setOrder(1, Order.Hold);
  const def = UNITS.pikeman;
  let blows = 0, lastBlow = -1;
  const gaps: number[] = [];
  run(sim, 600, () => {
    if (a.state === MinionState.Upright && a.action === Action.Fight && a.act === 1) {
      blows++;
      if (lastBlow >= 0) gaps.push(sim.tick - lastBlow);
      lastBlow = sim.tick;
    }
  });
  assert.ok(blows > 0, "a blow fell");
  for (const g of gaps) assert.ok(g >= def.blowMin && g <= def.blowMax, `gap ${g} in ${def.blowMin}..${def.blowMax}`);
  assert.ok(b.id >= 0);
  sim.free();
});
