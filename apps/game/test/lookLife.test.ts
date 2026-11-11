// Look round L3: grass tufts, crows and braziers (the logic without three).
import { test } from "node:test";
import assert from "node:assert/strict";
import { GAME_LAYOUT, MID_Z, ROUTE_HALF, buildLayout, roadX, streamOffset, streamWidth, valleyHeight } from "@keepfall/content";
import { BLADES_PER_CLUMP, CLUMPS_PER_TILE, HOLD, MAX_TILES, TILE, TileRing, isGrass, placeTile, wallDistance } from "../src/render/grassLogic";
import { Flock, REACT, SETTLE, UP_MAX, UP_MIN } from "../src/render/flocks";
import { BrazierFires, OUT_DISTANCE, pickBraziers } from "../src/render/brazierLogic";

const valley = valleyHeight;
const flat = { drawn: (x: number, z: number) => valleyHeight(x, z) };

// --- grass ---------------------------------------------------------------------

test("the tile ring recomputes only the tiles that enter range", () => {
  const ring = new TileRing();
  const entered: Array<[number, number]> = [];
  const left: Array<[number, number]> = [];
  const enter = (tx: number, tz: number) => entered.push([tx, tz]);
  const leave = (tx: number, tz: number) => left.push([tx, tz]);
  ring.update(3, -19, enter, leave);
  const first = entered.length;
  assert.ok(first > 50 && first <= MAX_TILES, `first fill ${first}`);
  assert.equal(left.length, 0);
  // Standing still, or moving inside a quarter tile: nothing.
  entered.length = 0;
  ring.update(3, -19, enter, leave);
  ring.update(3.4, -19.2, enter, leave);
  assert.equal(entered.length + left.length, 0);
  // One tile east: a strip enters, a strip leaves, and every other tile is untouched.
  ring.update(3 + TILE, -19, enter, leave);
  assert.ok(entered.length > 0 && entered.length < first / 3, `entered ${entered.length} of ${first}`);
  assert.ok(left.length > 0 && left.length < first / 3);
  assert.equal(ring.count, first - left.length + entered.length);
  for (const [tx, tz] of entered) {
    assert.ok(Math.hypot((tx + 0.5) * TILE - (3 + TILE), (tz + 0.5) * TILE + 19) <= HOLD + 1e-9);
    assert.ok(!left.some(([a, b]) => a === tx && b === tz), "no tile both leaves and enters");
  }
  // A long jump: everything that was held leaves or stays by range alone.
  entered.length = 0;
  left.length = 0;
  ring.update(500, 500, enter, leave);
  assert.equal(ring.count, entered.length);
  assert.ok(left.length > 0, "the old ring left");
});

test("the ring never needs more slots than the tufts have", () => {
  for (const [x, z] of [[0, 0], [4, 4], [7.9, 0.1], [-3.3, -77.7], [0.01, 0.01]]) {
    const ring = new TileRing();
    ring.update(x, z, () => {}, () => {});
    assert.ok(ring.count <= MAX_TILES, `${ring.count} tiles at ${x},${z}`);
  }
  // The advertised budget: about 20,000 blades in the ring at most.
  assert.ok(MAX_TILES * CLUMPS_PER_TILE * BLADES_PER_CLUMP <= 24000);
});

test("no grass on the road, the flank paths, the stream, the bridges or the castle pads", () => {
  // Known bare ground.
  for (const u of [-30, -12, 12, 30, 45]) {
    const z = MID_Z + u;
    assert.equal(isGrass(roadX(u), z, valley, flat), false, `road at u=${u}`);
    const sz = MID_Z + streamOffset(10);
    assert.equal(isGrass(10, sz, valley, flat), false, "stream centre");
  }
  assert.equal(isGrass(10, MID_Z + streamOffset(10) + streamWidth(10) / 2 + 1, valley, flat), false, "the bank");
  for (const [x, z] of [[0, 0], [5, -3], [20, 0], [0, -150], [-18, -140], [0, -171]]) assert.equal(isGrass(x, z, valley, flat), false, `castle pad ${x},${z}`);
  // Open meadow well off the routes and away from the castles is grass (somewhere in it).
  let grass = 0;
  for (let x = -60; x <= 60; x += 3) for (let z = -120; z <= -30; z += 3) if (isGrass(x, z, valley, flat)) grass++;
  assert.ok(grass > 100, `meadow grass ${grass}`);
  // Every clump of the tiles round the road, the stream and a castle keeps clear of them.
  const ring = new TileRing();
  let placed = 0;
  ring.update(0, MID_Z, (tx, tz) => {
    placed += placeTile(tx, tz, valley, flat, (x, z) => {
      const u = z - MID_Z;
      if (Math.abs(u) < 60) assert.ok(Math.abs(x - roadX(u)) >= ROUTE_HALF.centre, `clump on the road at ${x},${z}`);
      assert.ok(Math.abs(z - MID_Z - streamOffset(x)) >= streamWidth(x) / 2 + 2.3 - 1e-6 || Math.abs(z - MID_Z - streamOffset(x)) > 1e3, `clump in the stream at ${x},${z}`);
      assert.ok(wallDistance(x, z) >= 6.9, `clump on a castle pad at ${x},${z}`);
    });
  }, () => {});
  assert.ok(placed > 100, `placed ${placed}`);
});

test("no grass in a crater or on its rim, and the same tile always grows the same clumps", () => {
  const x = 40, z = -60;
  assert.equal(isGrass(x, z, valley, flat), true, "the spot is meadow");
  assert.equal(isGrass(x, z, valley, { drawn: (a, b) => valleyHeight(a, b) - 0.12 }), false, "a crater");
  assert.equal(isGrass(x, z, valley, { drawn: (a, b) => valleyHeight(a, b) + 0.25 }), false, "a rim");
  assert.equal(isGrass(x, z, valley, { drawn: (a, b) => valleyHeight(a, b) - 0.01 }), true, "a dent too shallow to count");
  const a: number[] = [], b: number[] = [];
  placeTile(5, -8, valley, flat, (px, pz, h) => a.push(px, pz, h));
  placeTile(5, -8, valley, flat, (px, pz, h) => b.push(px, pz, h));
  assert.deepEqual(a, b);
  for (let i = 2; i < a.length; i += 3) assert.ok(a[i] >= 0.15 && a[i] <= 0.45, "short");
  // A tile cratered in its middle loses the clumps there.
  const crater = { drawn: (px: number, pz: number) => valleyHeight(px, pz) - (Math.hypot(px - 44, pz + 60) < 3 ? 0.5 : 0) };
  let whole = 0, cut = 0;
  placeTile(5, -8, valley, flat, () => whole++);
  placeTile(5, -8, valley, crater, () => cut++);
  assert.ok(cut < whole, `${cut} < ${whole}`);
});

// --- crows -----------------------------------------------------------------------

function flock(): Flock {
  const at = (x: number, z: number): [number, number, number] => [x, valleyHeight(x, z) + 5, z];
  return new Flock([at(100, 0), at(160, 40), at(90, -80)], 12, 77);
}

test("a flock rises for a shot within 120 m and not for one at 200 m", () => {
  const f = flock();
  f.site = 0;
  assert.equal(f.noise(-100, 5, 0, 1), false, "200 m away");
  assert.equal(f.state, "perched");
  assert.equal(f.noise(0, 5, 0, 1), true, "100 m away");
  assert.equal(f.state, "up");
  // Just under and just over the reach.
  const g = flock();
  g.site = 0;
  assert.equal(g.noise(100 - REACT - 1, 5, 0, 1), false);
  assert.equal(g.noise(100 - REACT + 1, 5, 0, 1), true);
  // Already up: a second shot does nothing.
  assert.equal(g.noise(100, 5, 0, 2), false);
});

test("a flock settles again, elsewhere, within 20 to 40 s", () => {
  const f = flock();
  f.site = 0;
  f.noise(0, 5, 0, 10);
  const from = f.site;
  const dt = 1 / 30;
  let t = 10, back = -1;
  let shown = 0;
  for (let i = 0; i < 30 * 60 && back < 0; i++) {
    t += dt;
    f.step(t, dt, 3, 1);
    if (f.state === "up") {
      shown = Math.max(shown, f.birds.filter((b) => b.shown).length);
      for (const b of f.birds) assert.ok(Number.isFinite(b.x + b.y + b.z), "finite");
    } else back = t - 10;
  }
  assert.ok(back >= UP_MIN - 0.1 && back <= UP_MAX + 0.1, `settled after ${back} s`);
  assert.ok(shown >= f.birds.length - 1, "the birds were drawn while up");
  assert.notEqual(f.site, from, "it settled somewhere else");
  assert.ok(f.birds.every((b) => !b.shown), "hidden again at rest");
  assert.ok(SETTLE < UP_MIN);
  // At rest again it can rise anew.
  const h = f.here;
  assert.equal(f.noise(h[0], h[1], h[2], t + 1), true);
});

test("circling birds stay above the ground and away from the middle of the valley's lane", () => {
  const f = flock();
  f.site = 0;
  f.noise(0, 5, 0, 0);
  const dt = 1 / 30;
  for (let i = 1; i < 30 * 18; i++) {
    f.step(i * dt, dt, 0, 0);
    for (const b of f.birds) if (f.state === "up") assert.ok(b.y > valleyHeight(b.x, b.z) - 0.5, "above the ground");
  }
});

// --- braziers --------------------------------------------------------------------

test("three braziers per castle ride merlons at the gatehouse and on a tower", () => {
  const layout = buildLayout(1, GAME_LAYOUT);
  const spots = pickBraziers(layout);
  assert.equal(spots.length, 6);
  for (const castle of [0, 1] as const) {
    const mine = spots.filter((s) => s.castle === castle);
    assert.equal(mine.filter((s) => s.where === "gate").length, 2);
    assert.equal(mine.filter((s) => s.where === "tower").length, 1);
  }
  for (const s of spots) {
    const st = layout.stones[s.stone];
    assert.equal(st.part, "merlon");
    assert.ok(Math.abs(s.y - (st.y + st.hy)) < 1e-9, "stands on the stone");
  }
  assert.equal(new Set(spots.map((s) => s.stone)).size, 6);
});

test("a brazier goes out when its stone moves more than half a metre, and burns again after a reset", () => {
  const layout = buildLayout(1, GAME_LAYOUT);
  const spots = pickBraziers(layout);
  const fires = new BrazierFires(spots, layout);
  const pose = (id: number, dx: number, dy: number, dz: number) => {
    const s = layout.stones[id];
    return Float32Array.from([id, s.x + dx, s.y + dy, s.z + dz, 0, 0, 0, 1]);
  };
  const out: number[] = [];
  // Some other stone moving does nothing; a brazier's stone nudged a little keeps its fire.
  const other = layout.stones.find((s) => !spots.some((p) => p.stone === s.id))!;
  fires.bodies(pose(other.id, 5, 0, 0), 1, (i) => out.push(i));
  fires.bodies(pose(spots[0].stone, OUT_DISTANCE * 0.6, 0, 0), 1, (i) => out.push(i));
  assert.equal(out.length, 0);
  assert.ok(fires.lit.every(Boolean));
  // Over half a metre, and a fall: out.
  fires.bodies(pose(spots[0].stone, 0, -0.8, 0), 1, (i) => out.push(i));
  assert.deepEqual(out, [0]);
  assert.equal(fires.lit[0], false);
  assert.ok(fires.lit.slice(1).every(Boolean));
  fires.bodies(pose(spots[3].stone, 3, -6, 1), 1, (i) => out.push(i));
  assert.deepEqual(out, [0, 3]);
  // Coming back to rest does not relight it.
  fires.bodies(pose(spots[0].stone, 0, 0, 0), 1);
  assert.equal(fires.lit[0], false);
  fires.relight();
  assert.ok(fires.lit.every(Boolean));
});
