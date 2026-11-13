// The army pass's march and orders: Push keeps its road, a loose gate leaf is
// battered down, boxed-in and cut-off men find their way, men who cannot
// batter stand off a gate, everyone steps back from a lit keg, and a route
// order moves the waves that have not crossed.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, DECK_TOP, GAME_LAYOUT, GATE_BLOWS, holdMarker, inCourtyard, MARCH, MATCH_EMPLACEMENTS, Unit, UNITS } from "@keepfall/content";
import { Action, breachField, FLOW_INF, MinionState, NAV_GRID, Order, routeField, SandboxSim, type Minion, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const world = (seed = 7) => new SandboxSim(R, layout, { seed, minions: 0, army: true, powder: false, emplacements: MATCH_EMPLACEMENTS });
const run = (sim: SandboxSim, seconds: number, each?: (sim: SandboxSim) => void) => {
  for (let i = 0; i < seconds * 60; i++) {
    sim.step();
    each?.(sim);
  }
};
const LEFT = 0, CENTRE = 1;
const PIKES = [0, 0, 0, 0, 0, 0, 0, 0];
const ofWave = (sim: SandboxSim, wave: number): Minion[] => sim.minions.list.filter((m) => m.wave === wave && m.state === MinionState.Upright);
const near = (m: Minion, p: { x: number; z: number }, r: number) => (m.x - p.x) * (m.x - p.x) + (m.z - p.z) * (m.z - p.z) < r * r;
/** Castle 0's gate leaves, and the z of their middle. */
const leaves = layout.stones.filter((s) => s.castle === 0 && s.part === "gate");
const gateZ = leaves.reduce((s, l) => s + l.z, 0) / leaves.length;
/** Two long gun balls at the foot of castle 0's front wall, west of its gate: a breach (as the Push test in army.test.ts). */
const breach = (sim: SandboxSim) => {
  for (const [k, x] of [[0, -8.5], [1, -7.5]] as const) sim.queue(10 + k * 250, { kind: "fire", emplacement: 0, yaw: Math.atan2(x, 120), pitch: -0.022, charge: 1, fuse: 0, spin: 0 });
  run(sim, 14);
};

test("on Push a wave sent down the left road keeps to its bridge with a breach by the gate, and still gets in through it", () => {
  const sim = world();
  breach(sim);
  assert.ok(sim.army!.flow.at(breachField(1), 0, -130) < FLOW_INF, "the breach reaches the courtyard from the muster");
  sim.army!.setOrder(1, Order.Push);
  sim.army!.spawnMix(1, LEFT, PIKES, 0);
  const wave = sim.army!.waves - 1;
  const crossedAt = new Map<number, number>();
  const inAt = new Map<number, number>();
  const t0 = sim.tick;
  run(sim, 125, (s) => {
    for (const m of ofWave(s, wave)) {
      if (!crossedAt.has(m.id) && m.z > -75) crossedAt.set(m.id, m.x);
      if (!inAt.has(m.id) && inCourtyard(0, m.x, m.z)) inAt.set(m.id, s.tick - t0);
    }
  });
  assert.equal(crossedAt.size, 8, "all eight crossed the stream");
  for (const [id, x] of crossedAt) assert.ok(x > 40, `man ${id} crossed by the left bridge (at x ${x.toFixed(1)})`);
  // By the left bridge it is some 170 m to a breach west of the gate (the breach field straight over the centre bridge was 125 m): 106 s at a pikeman's pace.
  const fast = [...inAt.values()].filter((t) => t <= 120 * 60).length;
  assert.ok(fast >= 7, `${fast} of 8 in the enemy courtyard within 120 s (${[...inAt.values()].map((t) => (t / 60).toFixed(0)).join(" ")})`);
  for (const l of leaves) assert.equal(sim.castle.dynamic[l.id], 0, "they went in by the breach: the gate still stands");
  sim.free();
});

test("a gate leaf already loose but still in its place is shoved by the blows that would knock it loose", () => {
  const sim = world();
  const army = sim.army!;
  const leaf = leaves[0].id;
  // Until the flow work's CastleSim.shove lands, a stand-in with the same contract.
  const castle = sim.castle as typeof sim.castle & { shove?(id: number, ix: number, iy: number, iz: number): boolean };
  const shoves: number[][] = [];
  const real = castle.shove?.bind(castle);
  castle.shove = (id, ix, iy, iz) => {
    shoves.push([id, ix, iy, iz]);
    if (real) return real(id, ix, iy, iz);
    if (!castle.dynamic[id]) return false;
    castle.bodies[id].applyImpulse({ x: ix, y: iy, z: iz }, true);
    return true;
  };
  army.spawnWave(1, CENTRE, 1, { x: 0, z: gateZ - 3 });
  const m = sim.minions.list[sim.minions.list.length - 1];
  const batter = (army as unknown as { batter(m: Minion, leaf: number, ux: number, uz: number, unit: unknown): void }).batter.bind(army);
  // A leaf that stands: the blow that brings it to GATE_BLOWS knocks it loose, and nothing is shoved.
  const other = leaves[1].id;
  army.gateHits.set(other, GATE_BLOWS - 1);
  batter(m, other, 0, 1, UNITS.pikeman);
  assert.equal(castle.dynamic[other], 1, "knocked loose");
  assert.equal(shoves.length, 0);
  // A leaf shaken loose (by a ball, say) that still stands in its place.
  assert.ok(castle.knockLoose(leaf, 0, 0, 0));
  run(sim, 1);
  const p0 = castle.bodies[leaf].translation();
  assert.ok(Math.abs(p0.z - leaves[0].z) < 0.2 && Math.abs(p0.y - leaves[0].y) < 0.2, "it still stands in its place");
  army.gateHits.set(leaf, GATE_BLOWS);
  batter(m, leaf, 0, 1, UNITS.pikeman);
  assert.equal(shoves.length, 1, "knockLoose refused the loose leaf, so it was shoved");
  assert.deepEqual(shoves[0], [leaf, 0, 0.3, 2.2], "the same push as knocking it loose, along the blow into the courtyard");
  // Eight men battering it, a blow each every second and a half: it goes over.
  for (let t = 0; t < 12 * 60; t++) {
    if (t % 11 === 0) batter(m, leaf, 0, 1, UNITS.pikeman);
    sim.step();
  }
  const p1 = castle.bodies[leaf].translation();
  assert.ok(p1.z - p0.z > 0.5 || p0.y - p1.y > 0.5, `the leaf went over into the courtyard (moved ${(p1.z - p0.z).toFixed(2)} m in, ${(p0.y - p1.y).toFixed(2)} m down)`);
  sim.free();
});

/** A walkable cell on team 1's centre route field, with finite cost, whose two straight neighbours towards one corner cannot be stepped to: a corner a man can be boxed into. */
function boxedCorner(sim: SandboxSim, f: number): { x: number; z: number; ux: number; uz: number } | null {
  const army = sim.army!;
  const G = NAV_GRID;
  const D = army.flow.dist[f];
  for (let j = 40; j < G.nz - 40; j++) {
    for (let i = 40; i < G.nx - 40; i++) {
      const c = j * G.nx + i;
      if (D[c] >= FLOW_INF) continue;
      for (const [si, sj] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const cx = G.x0 + (i + 0.5) * G.cell, cz = G.z0 + (j + 0.5) * G.cell;
        const x = cx + si * 0.495 * G.cell, z = cz + sj * 0.495 * G.cell;
        // His step this tick at 1.6 m/s along the diagonal: into the corner, refused both ways.
        const s = (1.6 / 60) * Math.SQRT1_2;
        if (army.canStep(c, x + si * s, z) || army.canStep(c, x, z + sj * s) || army.canStep(c, x + si * s, z + sj * s)) continue;
        // Somewhere else to go that is closer to the goal.
        let out = false;
        for (const [di, dj] of [[-si, 0], [0, -sj]]) {
          const n = (j + dj) * G.nx + i + di;
          if (D[n] < D[c] && army.canStep(c, G.x0 + (i + di + 0.5) * G.cell, G.z0 + (j + dj + 0.5) * G.cell)) out = true;
        }
        if (out) return { x, z, ux: si * Math.SQRT1_2, uz: sj * Math.SQRT1_2 };
      }
    }
  }
  return null;
}

test("a marching man refused on both axes steps towards the cheapest cell he can step to; a man walking anywhere else just stops", () => {
  const sim = world();
  const army = sim.army!;
  const f = routeField(1, CENTRE);
  const spot = boxedCorner(sim, f);
  assert.ok(spot, "found a corner to be boxed into");
  army.spawnWave(1, CENTRE, 1, { x: spot.x, z: spot.z });
  const m = sim.minions.list[sim.minions.list.length - 1];
  m.x = spot.x;
  m.z = spot.z;
  const c0 = army.flow.at(f, m.x, m.z);
  // Not marching (no field): refused on both axes, he stays put.
  army.move(m, spot.ux, spot.uz, 1.6, NaN, Action.Walk);
  assert.equal(m.x, spot.x);
  assert.equal(m.z, spot.z);
  // Marching: the same tick he steps his stride towards the middle of the cheapest neighbouring cell he can step to.
  const G = NAV_GRID;
  const c = army.cellAt(m.x, m.z);
  const ci = c % G.nx, cj = (c - ci) / G.nx;
  let tx = 0, tz = 0, best = FLOW_INF;
  const stride = 1.6 / 60;
  for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cost = army.flow.dist[f][(cj + dj) * G.nx + ci + di];
    const x = G.x0 + (ci + di + 0.5) * G.cell, z = G.z0 + (cj + dj + 0.5) * G.cell;
    // A cell he can step to, by a stride he can take towards it.
    const l = Math.hypot(x - spot.x, z - spot.z);
    const px = spot.x + ((x - spot.x) / l) * stride, pz = spot.z + ((z - spot.z) / l) * stride;
    if (cost < best && army.canStep(c, x, z) && army.canStep(c, px, pz)) {
      best = cost;
      tx = x;
      tz = z;
    }
  }
  assert.ok(best < c0, `a cheaper cell to go to (${best} < ${c0})`);
  army.move(m, spot.ux, spot.uz, 1.6, NaN, Action.Walk, f);
  const sx = m.x - spot.x, sz = m.z - spot.z, step = Math.hypot(sx, sz);
  assert.ok(Math.abs(step - 1.6 / 60) < 1e-6, `a stride of ${step.toFixed(4)} m`);
  const wx = tx - spot.x, wz = tz - spot.z;
  assert.ok((sx * wx + sz * wz) / (step * Math.hypot(wx, wz)) > 0.999, "straight at that cell's middle");
  sim.free();
});

test("a man cut off from his field walks to the nearest cell on it within 4 m; with none that near he stands", () => {
  for (const [half, out] of [[2, true], [5, false]] as const) {
    const sim = world();
    const army = sim.army!;
    const f = routeField(1, CENTRE);
    army.spawnWave(1, CENTRE, 1, { x: 0.5, z: -110.5 });
    const m = sim.minions.list[sim.minions.list.length - 1];
    run(sim, 0.1);
    // His field cannot reach the goal from a square around him (as when a heap has just fallen there).
    const G = NAV_GRID;
    const ci = Math.floor((m.x - G.x0) / G.cell), cj = Math.floor((m.z - G.z0) / G.cell);
    for (let j = cj - half; j <= cj + half; j++) for (let i = ci - half; i <= ci + half; i++) army.flow.dist[f][j * G.nx + i] = FLOW_INF;
    const x0 = m.x, z0 = m.z;
    let walked = 0;
    run(sim, 3, () => {
      if (m.action === Action.Walk) walked++;
    });
    if (out) {
      assert.ok(army.flow.at(f, m.x, m.z) < FLOW_INF, `back on his field at (${m.x.toFixed(1)}, ${m.z.toFixed(1)})`);
      assert.ok(walked > 60);
    } else {
      assert.ok(Math.abs(m.x - x0) < 0.05 && Math.abs(m.z - z0) < 0.05, "he stood where he was");
      assert.equal(m.action, Action.Stand);
    }
    sim.free();
  }
});

test("musketeers stop well short of a gate that stands and leave the doorway to the pikes battering it", () => {
  const sim = world();
  const P = Unit.Pikeman, M = Unit.Musketeer;
  sim.army!.spawnMix(1, CENTRE, [P, P, P, P, M, M, M, M], 0, { x: 0, z: -42 });
  const wave = sim.army!.waves - 1;
  run(sim, 30);
  const men = ofWave(sim, wave);
  for (const l of leaves) assert.equal(sim.castle.dynamic[l.id], 0, "the gate still stands");
  const muskets = men.filter((m) => m.unit === Unit.Musketeer);
  assert.equal(muskets.length, 4);
  for (const m of muskets) {
    const off = gateZ - m.z;
    assert.ok(off > MARCH.doorStandOff - 2 && off < MARCH.doorStandOff + 3, `musketeer ${m.id} waits ${off.toFixed(1)} m out from the gate`);
    assert.equal(m.action, Action.Stand);
  }
  assert.ok(men.filter((m) => m.unit === Unit.Pikeman && m.action === Action.Batter).length >= 2, "the pikes batter it");
  sim.free();
});

test("men near lit kegs walk away from them (from both, when they stand either side of the gate) until they are gone, then go back to the gate", () => {
  const sim = world();
  const sp = sim.specialists!;
  sim.army!.spawnWave(1, CENTRE, 8, { x: 0, z: -42 });
  const wave = sim.army!.waves - 1;
  run(sim, 25);
  const men = ofWave(sim, wave);
  assert.ok(men.some((m) => m.action === Action.Batter), "they batter the gate");
  // Two sappers' kegs, one either side of the gate, where they set them.
  const kegs = [-3.5, 3.5].map((x) => ({ x, y: 0.35, z: gateZ - 0.9, by: 0.7, bz: gateZ, at: sim.tick + 20 * 60, shot: -1 }));
  sp.kegs.push(...kegs);
  const d = (m: Minion) => Math.min(...kegs.map((g) => Math.hypot(m.x - g.x, m.z - g.z)));
  const close = men.filter((m) => d(m) < MARCH.kegClear);
  assert.ok(close.length >= 4, `${close.length} men within ${MARCH.kegClear} m of a keg`);
  const before = close.map(d);
  run(sim, 0.5);
  close.forEach((m, k) => assert.ok(d(m) > before[k], `man ${m.id} walked away (${before[k].toFixed(1)} -> ${d(m).toFixed(1)} m)`));
  run(sim, 3.5);
  for (const m of ofWave(sim, wave)) assert.ok(d(m) > MARCH.kegClear - 1, `man ${m.id} keeps clear (${d(m).toFixed(1)} m)`);
  // The kegs taken away (they went off, or never would): back to the gate.
  sp.kegs.length = 0;
  run(sim, 6);
  assert.ok(ofWave(sim, wave).some((m) => m.action === Action.Batter), "back battering");
  sim.free();
});

test("a route order moves a wave holding at its marker to the new marker, all together; a wave already across, or a road whose bridge is down, is left alone", () => {
  const sim = world();
  const army = sim.army!;
  army.setOrder(1, Order.Hold);
  const left = holdMarker(1, "left"), centre = holdMarker(1, "centre");
  army.spawnMix(1, LEFT, PIKES, 0, { x: left.x, z: left.z - 3 });
  const holding = army.waves - 1;
  army.spawnMix(1, LEFT, PIKES, 0, { x: 48, z: -58 });
  const across = army.waves - 1;
  run(sim, 6);
  assert.ok(ofWave(sim, holding).every((m) => near(m, left, 6)), "the first wave holds at the left marker");
  army.setRoute(1, CENTRE);
  for (const m of ofWave(sim, holding)) assert.equal(m.route, CENTRE);
  for (const m of ofWave(sim, across)) assert.equal(m.route, LEFT, "the wave across keeps its road");
  run(sim, 60);
  const men = ofWave(sim, holding);
  assert.equal(men.length, 8);
  for (const m of men) {
    assert.ok(near(m, centre, 6), `man ${m.id} holds at the centre marker: at (${m.x.toFixed(1)}, ${m.z.toFixed(1)})`);
    assert.equal(m.action, Action.Stand);
  }
  sim.free();

  // The centre bridge down: the route order leaves the holding wave on its road.
  const sim2 = world();
  const s = layout.bridges[1].site;
  sim2.explode(s.x + 0.3, DECK_TOP - 0.4, s.z + 0.5);
  run(sim2, 4);
  assert.deepEqual(sim2.bridgesOpen(), [true, false, true]);
  sim2.army!.setOrder(1, Order.Hold);
  sim2.army!.spawnMix(1, LEFT, PIKES, 0, { x: left.x, z: left.z - 3 });
  run(sim2, 1);
  sim2.army!.setRoute(1, CENTRE);
  for (const m of ofWave(sim2, sim2.army!.waves - 1)) assert.equal(m.route, LEFT);
  sim2.free();
});
