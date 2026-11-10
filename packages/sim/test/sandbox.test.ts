import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, DECK_TOP, GAME_LAYOUT, KEEP_STOREYS, STREAM, streamWidth, WEAPONS } from "@keepfall/content";
import { EventKind, GUST_STRENGTH, runSession, SESSION_HASH, SandboxSim, Spin, Wind, stepAim, restAim, type Rapier } from "@keepfall/sim";
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

test("wind follows its seed, gusts, and stays in range", () => {
  const w = new Wind(new Rng(3).fork("wind"));
  let changes = 0, last = w.nextChangeIn(0);
  const top = 11 * (1 + GUST_STRENGTH);
  // Within one steady stretch the gusts still move the wind: track its spread over every 10 s window.
  let widest = 0, lo = Infinity, hi = -Infinity;
  for (let t = 0; t < 60 * 300; t++) {
    w.step(t);
    const s = w.x * w.x + w.z * w.z;
    assert.ok(s <= top * top + 1e-9, `wind ${Math.sqrt(s)}`);
    const next = w.nextChangeIn(t);
    if (next > last) changes++;
    last = next;
    lo = Math.min(lo, Math.sqrt(s));
    hi = Math.max(hi, Math.sqrt(s));
    if (t % 600 === 599) {
      widest = Math.max(widest, hi - lo);
      lo = Infinity;
      hi = -Infinity;
    }
  }
  assert.ok(changes >= 4 && changes <= 10, `changes ${changes}`);
  assert.ok(widest > 1, `gusts move the wind by ${widest.toFixed(2)} m/s within 10 s`);
  const a = new Wind(new Rng(3).fork("wind")), b = new Wind(new Rng(3).fork("wind"));
  for (let t = 0; t < 2000; t++) {
    a.step(t);
    b.step(t);
  }
  assert.deepEqual([a.x, a.z], [b.x, b.z], "the same seed blows the same");
});

test("the wind's lead says where a gust ends, and reading it changes nothing", () => {
  const a = new Wind(new Rng(5).fork("wind")), b = new Wind(new Rng(5).fork("wind"));
  const due = new Map<number, { x: number; z: number; change: number }>();
  let checked = 0;
  for (let t = 0; t < 60 * 240; t++) {
    a.step(t);
    b.step(t);
    const want = due.get(t);
    // Unless the base wind started a new turn meanwhile, the wind reaches the lead exactly when it said.
    if (want && want.change === a.nextChangeIn(t) + t) {
      assert.ok(Math.abs(a.x - want.x) < 1e-9 && Math.abs(a.z - want.z) < 1e-9, `tick ${t}: ${a.x},${a.z} vs ${want.x},${want.z}`);
      checked++;
    }
    const l = a.lead(t);
    assert.ok(l.ticks >= 0 && l.ticks <= 5 * 60);
    if (!due.has(t + l.ticks)) due.set(t + l.ticks, { x: l.x, z: l.z, change: a.nextChangeIn(t) + t });
    assert.deepEqual([a.x, a.z], [b.x, b.z], "reading the lead leaves the wind alone");
  }
  assert.ok(checked > 30, `checked ${checked} gusts`);
});

test("shots scatter a little: the same aim lands nearby but never on the same spot twice", () => {
  const land = (seed: number, shots: number) => {
    const sim = new SandboxSim(R, buildLayout(1, GAME_LAYOUT), { seed, minions: 0 });
    const out: Array<[number, number]> = [];
    for (let k = 0; k < shots; k++) {
      // The long gun into the open ground in front of the target castle, the same aim each time.
      sim.queue(sim.tick, { kind: "fire", emplacement: 0, yaw: 0.2, pitch: 0.02, charge: 1, fuse: 0, spin: Spin.None });
      let hit: [number, number] | null = null;
      for (let i = 0; i < 300 && !hit; i++) {
        sim.step();
        const f = sim.collect();
        for (let e = 0; e < f.eventCount; e++) if (f.events[e * 5] === EventKind.Landed) hit = [f.events[e * 5 + 2], f.events[e * 5 + 4]];
      }
      assert.ok(hit, "the ball landed");
      out.push(hit);
      while (sim.reload[0] > 0) sim.step();
    }
    sim.free();
    return out;
  };
  const a = land(5, 3);
  assert.deepEqual(land(5, 3), a, "the same seed scatters the same way");
  for (let i = 1; i < a.length; i++) {
    const d = Math.hypot(a[i][0] - a[0][0], a[i][1] - a[0][1]);
    assert.ok(d > 0.02 && d < 8, `shot ${i} landed ${d.toFixed(2)} m from the first`);
  }
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

test("a mortar burst on a wall top caves it in and throws masonry up and out", () => {
  const sim = new SandboxSim(R, buildLayout(1, GAME_LAYOUT), { seed: 3, minions: 0 });
  const layout = sim.castle.layout;
  const burst = WEAPONS.mortar.burst!;
  sim.explode(6, 7.6, -15.2); // just inside the top of the enemy's front wall
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

test("M5: the match keep's dressed stone takes a shell far better than the old keep", () => {
  const down = (keep: typeof GAME_LAYOUT.keep) => {
    const sim = new SandboxSim(R, buildLayout(1, { ...GAME_LAYOUT, keep }), { seed: 3, minions: 0 });
    const before = sim.castle.dynList.length; // (unbuilt buildings' pieces wait out of the world among the loose)
    sim.explode(0, 19.3, -0.6); // just inside the top of the keep's south face
    const n = sim.castle.dynList.length - before;
    sim.free();
    return n;
  };
  const old = down(undefined), sturdy = down(GAME_LAYOUT.keep);
  assert.ok(old >= 60, `the old keep lost ${old} pieces`);
  assert.ok(sturdy * 3 <= old, `the match keep lost ${sturdy} pieces to the same shell (the old one ${old})`);
});

test("a keep with timber floors comes down a storey per two shells, and the banner with it", () => {
  const sim = new SandboxSim(R, buildLayout(1, GAME_LAYOUT), { seed: 3, minions: 0 });
  const layout = sim.castle.layout;
  const banner = sim.castle.bodies[layout.bannerIds[0]];
  const storeyLeft = (course: number) => {
    let n = 0;
    for (const s of layout.stones) if (s.castle === 0 && s.part === "storey" && s.course === course - 1 && !sim.castle.dynamic[s.id]) n++;
    return n;
  };
  const cracked = (course: number) => layout.stones.filter((s) => s.castle === 0 && s.part === "storey" && s.course === course - 1 && sim.castle.hits[s.id] > 0).length;
  const [low, mid, top] = KEEP_STOREYS;
  const settle = () => {
    for (let i = 0; i < 360; i++) sim.step();
  };
  settle();
  const boards = storeyLeft(top);
  // A shell striking each floor bursts 0.9 m inside it, as a shell that hits masonry does.
  sim.explode(0.4, (top / 2) - 0.9, 4.3);
  settle();
  assert.equal(storeyLeft(top), boards, "the first shell only cracks the roof");
  assert.ok(cracked(top) >= 3, `${cracked(top)} roof boards cracked`);
  assert.ok(banner.translation().y > top / 2, "the banner is still on the roof");
  sim.explode(0.4, (top / 2) - 0.9, 4.3);
  settle();
  assert.ok(storeyLeft(top) <= boards - 3, `the second caves it in: ${storeyLeft(top)} of ${boards} boards left`);
  assert.equal(storeyLeft(mid), boards, "the storey below held");
  assert.ok(Math.abs(banner.translation().y - (mid / 2 + 0.6)) < 1.5 && !sim.castle.toppled[0], `the banner dropped one floor: ${banner.translation().y}`);
  for (let k = 0; k < 2; k++) {
    sim.explode(0.4, (mid / 2) - 0.9, 4.3);
    settle();
  }
  assert.ok(storeyLeft(mid) <= boards - 3);
  assert.equal(storeyLeft(low), boards);
  assert.ok(!sim.castle.toppled[0], "still standing on the lowest floor");
  for (let k = 0; k < 2; k++) {
    sim.explode(0.4, (low / 2) - 0.9, 4.3);
    settle();
  }
  assert.ok(sim.castle.toppled[0], `two more shells bring the banner down: ${banner.translation().y}`);
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
