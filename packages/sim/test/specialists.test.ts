import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, DIST, GAME_LAYOUT, KEG, Unit, type BurstDef } from "@keepfall/content";
import { Cause, LocalFields, MinionState, NAV_GRID, NavKind, Order, Role, SandboxSim, SapperTask, Specialists, navCell, type Minion, type Rapier, type Steer } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const world = () => new SandboxSim(R, layout, { seed: 7, minions: 0, army: true });
const out = (): Steer => ({ mx: 0, mz: 0, speed: 0, face: NaN, action: 0 });

/** Spawn a wave of the given unit kinds (team 1 attacks castle 0) and return its minions. */
function mix(sim: SandboxSim, team: 0 | 1, units: number[]): Minion[] {
  const first = sim.minions.list.length;
  const n = sim.army!.spawnMix(team, 1, units, 0, { x: 0, z: team === 1 ? -DIST / 2 : -DIST / 2 + 4 });
  return sim.minions.list.slice(first, first + n);
}

function place(sim: SandboxSim, m: Minion, x: number, z: number) {
  m.x = x;
  m.z = z;
  m.y = sim.terrain.heightAt(x, z);
}

/** A tick at which musketeer m looks for a mark. */
const lookTick = (m: Minion) => 10 * 100 - (m.id % 10);

/** Two ground spots 18 m apart on opposite banks of the stream (water between), found on the nav grid. */
function acrossStream(sim: SandboxSim): { ax: number; az: number; bx: number; bz: number } {
  for (let x = -60; x <= 60; x += 2.5) {
    for (let z = -DIST + 20; z < -20; z += 0.5) {
      const c = navCell(x, z);
      if (c < 0 || sim.nav.kind[c] !== NavKind.Water) continue;
      // The run of water from here on.
      let z1 = z;
      while (navCell(x, z1 + 0.5) >= 0 && sim.nav.kind[navCell(x, z1 + 0.5)] === NavKind.Water) z1 += 0.5;
      const ca = navCell(x, z - 3), cb = navCell(x, z1 + 3);
      if (ca < 0 || cb < 0 || sim.nav.kind[ca] !== NavKind.Ground || sim.nav.kind[cb] !== NavKind.Ground) break;
      if (z1 - z + 6 > 22) break;
      return { ax: x, az: z - 3, bx: x, bz: z1 + 3 };
    }
  }
  throw new Error("no stream found");
}

/** A spot with 16 m of open ground (walkable, no water) running on in +z. */
function openRun(sim: SandboxSim): { x: number; z: number } {
  for (let x = -40; x <= 40; x += 2.5) {
    for (let z = -DIST + 30; z < -30; z += 2) {
      let ok = true;
      for (let d = 0; d <= 16 && ok; d += 0.5) {
        const c = navCell(x, z + d);
        ok = c >= 0 && sim.nav.kind[c] === NavKind.Ground;
      }
      if (ok) return { x, z };
    }
  }
  throw new Error("no open ground");
}

test("a musketeer on Advance takes no mark across the stream, but does on Hold", () => {
  const sim = world();
  const sp = sim.specialists!;
  const p = acrossStream(sim);
  const gun = mix(sim, 1, [Unit.Musketeer])[0];
  const foe = mix(sim, 0, [Unit.Pikeman])[0];
  // The far bank is team 0's side of the pair: the musketeer (team 1) stands on one bank, the pike on the other.
  place(sim, gun, p.ax, p.az);
  place(sim, foe, p.bx, p.bz);
  assert.equal(sim.army!.walkLine(gun.x, gun.z, foe.x, foe.z), false, "the stream is in the way");
  const o = out();
  sim.army!.setOrder(1, Order.Advance);
  gun.target = -1;
  assert.equal(sp.steer(gun, lookTick(gun), o) && o.action === 9, false, "Advance: he does not stop for it");
  assert.equal(gun.target, -1);
  sim.army!.setOrder(1, Order.Hold);
  assert.equal(sp.steer(gun, lookTick(gun), o), true);
  assert.equal(gun.target, foe.id, "Hold: he shoots across the stream");
});

test("a musketeer on Advance drops a mark that stops being walkable", () => {
  const sim = world();
  const sp = sim.specialists!;
  const p = acrossStream(sim);
  const gun = mix(sim, 1, [Unit.Musketeer])[0];
  const foe = mix(sim, 0, [Unit.Pikeman])[0];
  place(sim, gun, p.ax, p.az);
  place(sim, foe, p.bx, p.bz);
  gun.target = foe.id;
  const o = out();
  assert.equal(sp.steer(gun, lookTick(gun), o), false, "he marches on");
  assert.equal(gun.target, -1);
});

test("a musketeer with an armed man and a mason in range marks the armed man", () => {
  const sim = world();
  const sp = sim.specialists!;
  const gun = mix(sim, 1, [Unit.Musketeer])[0];
  const [mason, pike] = mix(sim, 0, [Unit.Pikeman, Unit.Pikeman]);
  mason.role = Role.Mason;
  const o0 = openRun(sim);
  place(sim, gun, o0.x, o0.z);
  place(sim, mason, o0.x, o0.z + 8);
  place(sim, pike, o0.x, o0.z + 14);
  const o = out();
  sp.steer(gun, lookTick(gun), o);
  assert.equal(gun.target, pike.id, "the farther armed man, not the mason");
  // With no armed man in sight he shoots the mason.
  const gun2 = mix(sim, 1, [Unit.Musketeer])[0];
  place(sim, gun2, o0.x, o0.z);
  place(sim, pike, o0.x + 60, o0.z);
  gun2.target = -1;
  sp.steer(gun2, lookTick(gun2), o);
  assert.equal(gun2.target, mason.id);
});

test("two sappers of one wave set kegs on opposite sides, 9.5 m or more from the gate's middle", () => {
  const sim = world();
  const sp = sim.specialists!;
  const sappers = mix(sim, 1, [Unit.Pikeman, Unit.Pikeman, Unit.Sapper, Unit.Sapper]).filter((m) => m.unit === Unit.Sapper);
  assert.equal(sappers.length, 2);
  // Both come up on the same side of the road, a metre apart.
  place(sim, sappers[0], 3, -30);
  place(sim, sappers[1], 4, -30);
  const xs: number[] = [];
  const o = out();
  for (let t = 0; t < 1200 && xs.length < 2; t++) {
    for (const m of sappers) {
      if (!sp.steer(m, t, o)) continue;
      m.x += (o.mx * o.speed) / 60;
      m.z += (o.mz * o.speed) / 60;
    }
    if (sp.kegs.length > xs.length) xs.push(sp.kegs[sp.kegs.length - 1].x);
  }
  assert.equal(xs.length, 2, "both set a keg");
  assert.ok(xs[0] * xs[1] < 0, `opposite sides: ${xs}`);
  for (const x of xs) assert.ok(Math.abs(x) >= KEG.gateClear, `${x} m from the gate's middle`);
  assert.ok(Math.abs(xs[0]) + Math.abs(xs[1]) >= 2 * KEG.gateClear);
});

test("a set keg throws men less far than one a sapper carries", () => {
  const sim = world();
  const bursts: BurstDef[] = [];
  const sp = new Specialists(sim.minions, sim.nav, sim.terrain, 1, () => {}, (_x, _y, _z, b) => bursts.push(b));
  sp.orders = sim.army!.order;
  const [a, b] = mix(sim, 1, [Unit.Sapper, Unit.Sapper]);
  place(sim, a, 10.5, -30);
  // The first sets his keg and it burns down.
  const o = out();
  let t = 0;
  for (; t < 1200 && sp.kegs.length === 0; t++) {
    if (!sp.steer(a, t, o)) {
      a.z -= a.speed / 60;
      continue;
    }
    a.x += (o.mx * o.speed) / 60;
    a.z += (o.mz * o.speed) / 60;
  }
  assert.equal(sp.kegs.length, 1);
  for (let k = 0; k < KEG.fuse + 2 && bursts.length === 0; k++) sp.afterStep(t++);
  assert.equal(bursts.length, 1);
  assert.equal(bursts[0], KEG.setBurst);
  // The second is shot down with his keg in his arms.
  place(sim, b, 0, -30);
  sp.beforeStep();
  b.state = MinionState.Ragdoll;
  b.downCause = Cause.Musket;
  sp.afterStep(t++);
  assert.equal(bursts.length, 2);
  assert.equal(bursts[1], KEG.burst);
  const reach = 6;
  assert.ok(bursts[0].knock < reach && bursts[1].knock >= reach, `set ${bursts[0].knock} m, carried ${bursts[1].knock} m`);
  assert.equal(bursts[0].radius, bursts[1].radius, "the masonry is treated the same");
  assert.equal(bursts[0].shatter, bursts[1].shatter);
});

test("a sapper behind a rim in the way reaches his spot by the castle's field", () => {
  const sim = world();
  const sp = sim.specialists!;
  const army = sim.army!;
  const [s] = mix(sim, 1, [Unit.Sapper]);
  // A rim of unwalkable cells across the straight line, with a way round at its west end.
  const spotX = 10.2;
  for (let x = 2; x <= 16; x += NAV_GRID.cell / 2) for (let z = -19.5; z <= -18.5; z += NAV_GRID.cell / 2) sim.nav.kind[navCell(x, z)] = NavKind.Blocked;
  // The field is read from the nav grid as it is now.
  sp.local = new LocalFields(sim.nav, army.castle.layout.castleZ);
  place(sim, s, spotX, -21.5);
  const o = out();
  let planted = -1;
  for (let t = 0; t < 3000 && planted < 0; t++) {
    if (!sp.steer(s, t, o)) {
      
      continue;
    }
    s.x += (o.mx * o.speed) / 60;
    s.z += (o.mz * o.speed) / 60;
    const c = navCell(s.x, s.z);
    assert.notEqual(sim.nav.kind[c], NavKind.Blocked, `walked into the rim at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
    if (s.task === SapperTask.Plant) planted = t;
  }
  assert.ok(planted >= 0, `he set his keg (at ${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
});
