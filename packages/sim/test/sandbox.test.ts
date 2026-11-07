import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, DECK_TOP, GAME_LAYOUT, KEEP_STOREYS, STREAM, streamWidth, WEAPONS } from "@keepfall/content";
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
  const sim = new SandboxSim(R, buildLayout(1, GAME_LAYOUT), { seed: 3, minions: 0 });
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

test("a mortar burst on the keep caves it in and throws masonry up and out", () => {
  const sim = new SandboxSim(R, buildLayout(1, GAME_LAYOUT), { seed: 3, minions: 0 });
  const layout = sim.castle.layout;
  const burst = WEAPONS.mortar.burst!;
  sim.explode(0, 19.3, -0.6); // just inside the top of the keep's south face
  let shattered = 0;
  for (let i = 0; i < layout.stones.length; i++) if (sim.castle.shattered[i]) shattered++;
  const loose = sim.castle.dynList.length - shattered;
  assert.ok(shattered >= 8, `a hole: ${shattered} stones turned to dust`);
  assert.ok(loose >= 40, `${loose} stones came loose`);
  const top = new Float32Array(layout.stones.length).fill(-1e9);
  for (let t = 0; t < 120; t++) {
    sim.step();
    for (const id of sim.castle.dynList) {
      if (sim.castle.shattered[id]) continue;
      const y = sim.castle.bodies[id].translation().y;
      if (y > top[id]) top[id] = y;
    }
  }
  let thrown = 0;
  for (const id of sim.castle.dynList) if (!sim.castle.shattered[id] && top[id] - layout.stones[id].y > 3) thrown++;
  assert.ok(thrown >= 15, `${thrown} stones thrown more than 3 m up`);
  assert.ok(burst.radius > 4 && burst.knock > burst.radius, "the burst reaches minions beyond the masonry it breaks");
  sim.free();
});

test("a keep with timber floors comes down a storey per shell, and the banner with it", () => {
  const sim = new SandboxSim(R, buildLayout(1, GAME_LAYOUT), { seed: 3, minions: 0 });
  const layout = sim.castle.layout;
  const banner = sim.castle.bodies[layout.bannerIds[0]];
  const storeyLeft = (course: number) => {
    let n = 0;
    for (const s of layout.stones) if (s.castle === 0 && s.part === "storey" && s.course === course - 1 && !sim.castle.dynamic[s.id]) n++;
    return n;
  };
  const [low, mid, top] = KEEP_STOREYS;
  const settle = () => {
    for (let i = 0; i < 360; i++) sim.step();
  };
  settle();
  // A shell striking each floor bursts 0.9 m inside it, as a shell that hits masonry does.
  sim.explode(0.4, (top / 2) - 0.9, 4.3);
  settle();
  assert.equal(storeyLeft(top), 0, "the roof caved in");
  assert.equal(storeyLeft(mid), 6, "the storey below held");
  assert.ok(Math.abs(banner.translation().y - (mid / 2 + 0.6)) < 1.5 && !sim.castle.toppled[0], `the banner dropped one floor: ${banner.translation().y}`);
  sim.explode(0.4, (mid / 2) - 0.9, 4.3);
  settle();
  assert.equal(storeyLeft(mid), 0);
  assert.equal(storeyLeft(low), 6);
  assert.ok(!sim.castle.toppled[0], "still standing on the lowest floor");
  sim.explode(0.4, (low / 2) - 0.9, 4.3);
  settle();
  assert.ok(sim.castle.toppled[0], `the third shell brings the banner down: ${banner.translation().y}`);
  sim.free();
});

test("a shell on a bridge drops its deck into the stream", () => {
  const sim = new SandboxSim(R, buildLayout(1, GAME_LAYOUT), { seed: 3, minions: 0 });
  const layout = sim.castle.layout;
  const centre = layout.bridges.find((b) => b.site.name === "centre")!;
  const { site, first, count } = centre;
  const half = streamWidth(site.x) / 2;
  // Deck planks over the water, and whether each still stands.
  const overWater: number[] = [];
  for (let i = first; i < first + count; i++) {
    const s = layout.stones[i];
    if (Math.abs(s.y - (DECK_TOP - 0.04)) < 0.05 && Math.abs(s.z - site.z) < half) overWater.push(i);
  }
  assert.ok(overWater.length >= 12, `${overWater.length} planks span the water`);
  for (let i = 0; i < 60; i++) sim.step();
  assert.ok(overWater.every((i) => !sim.castle.dynamic[i]), "the bridge stands until it is hit");
  sim.explode(site.x + 0.3, DECK_TOP - 0.4, site.z + 0.5);
  for (let i = 0; i < 300; i++) sim.step();
  let down = 0, inStream = 0;
  for (const i of overWater) {
    if (!sim.castle.dynamic[i]) continue;
    down++;
    if (sim.castle.shattered[i]) continue;
    if (sim.castle.bodies[i].translation().y < STREAM.level + 0.5) inStream++;
  }
  assert.equal(down, overWater.length, "no plank is left over the water");
  assert.ok(inStream >= 3, `${inStream} planks lie in the stream`);
  sim.free();
});
