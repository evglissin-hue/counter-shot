import { test } from "node:test";
import assert from "node:assert/strict";
import { MINION_STRIDE } from "@keepfall/sim";
import { CollapseTracker, HazeSet, hazeEnvelope, hazeRadius, locateRubble, MAX_HAZES } from "../src/render/hazeLogic";
import { DUST, DUST_HALF_LIFE, GroundMarksData, KEG_RADIUS, MARK_STRIDE, SCORCH, TRODDEN, TRODDEN_VISIBLE } from "../src/render/groundMarksLogic";

const GRID = { x0: 0, z0: 0, cell: 1, nx: 80, nz: 80 };
const at = (g: GroundMarksData, i: number, j: number, ch: number) => g.data[(j * GRID.nx + i) * MARK_STRIDE + ch];

test("a collapse counts at 25 pieces in 1.5 s, not at 24", () => {
  const t = new CollapseTracker();
  let hit = 0;
  for (let k = 0; k < 24; k++) hit += t.add(k * 3, 0, 4, 1);
  assert.equal(hit, 0, "24 pieces in 69 ticks is no great collapse");
  assert.equal(t.add(72, 0, 4, 1), 25, "the 25th starts one");
  // The sum starts afresh after a haze.
  assert.equal(t.add(73, 0, 4, 1), 0);
});

test("pieces are summed per castle and section", () => {
  const t = new CollapseTracker();
  assert.equal(t.add(0, 0, 4, 13), 0);
  assert.equal(t.add(1, 0, 5, 13), 0, "another section");
  assert.equal(t.add(2, 1, 4, 13), 0, "another castle");
  assert.equal(t.add(3, 0, -1, 13), 0, "no section is a group of its own");
  assert.equal(t.add(4, 0, 4, 12), 25);
});

test("the window slides: old pieces drop out", () => {
  const t = new CollapseTracker();
  assert.equal(t.add(0, 0, 2, 20), 0);
  assert.equal(t.add(90, 0, 2, 10), 0, "the first 20 are 90 ticks old: out of the window");
  assert.equal(t.add(100, 0, 2, 14), 0, "10 + 14");
  assert.equal(t.add(101, 0, 2, 1), 25);
  const u = new CollapseTracker();
  assert.equal(u.add(0, 0, 2, 20), 0);
  assert.equal(u.add(89, 0, 2, 5), 25, "89 ticks later it is still inside");
});

test("a tick that goes backwards forgets the count", () => {
  const t = new CollapseTracker();
  t.add(500, 0, 1, 24);
  assert.equal(t.add(10, 0, 1, 5), 0);
});

test("tracker capture and apply round trip", () => {
  const t = new CollapseTracker();
  t.add(10, 0, 3, 12);
  t.add(20, 1, 2, 7);
  const flat = t.capture();
  const u = new CollapseTracker();
  u.apply(flat);
  assert.deepEqual(u.capture(), flat);
  assert.equal(u.add(30, 0, 3, 13), 25);
});

test("rubble is found from the moving stones of the section, else from the layout", () => {
  const data = new Float32Array(8 * 5);
  const put = (i: number, id: number, x: number, y: number, z: number) => data.set([id, x, y, z, 0, 0, 0, 1], i * 8);
  put(0, 1, 10, 2, 20);
  put(1, 2, 14, 3, 20);
  put(2, 3, 12, 1, 24);
  put(3, 4, 500, 1, 500); // not in the section
  put(4, 5, 0, -1000, 0); // shattered
  const home = [1, 2, 3, 4, 5].map((id) => ({ id, x: 100 + id, y: 5, z: 100 }));
  const r = locateRubble(data, 5, (id) => id <= 3 || id === 5, home)!;
  assert.ok(Math.abs(r.x - 12) < 1e-4 && Math.abs(r.z - 21.3333) < 1e-3);
  assert.equal(r.n, 3);
  assert.ok(r.spread > 1 && r.spread < 5);
  const fb = locateRubble(data, 0, (id) => id <= 2, home)!;
  assert.ok(Math.abs(fb.x - 101.5) < 1e-6, "no stones moving: the layout's");
  assert.equal(locateRubble(data, 0, () => false, home), null);
  assert.ok(hazeRadius(0) >= 5 && hazeRadius(100) <= 30);
});

test("a haze fades in over 3 s and out over its last 10 s", () => {
  assert.equal(hazeEnvelope(0, 40), 0);
  assert.ok(hazeEnvelope(1.5, 40) > 0.4 && hazeEnvelope(1.5, 40) < 0.6);
  assert.equal(hazeEnvelope(20, 40), 1);
  assert.ok(hazeEnvelope(35, 40) < 1 && hazeEnvelope(35, 40) > 0);
  assert.equal(hazeEnvelope(40, 40), 0);
});

test("hazes: at most three (the oldest drops), onSettle once each, drift with the wind, life ends", () => {
  const set = new HazeSet();
  const calls: number[][] = [];
  set.onSettle = (x, y, z, r, a) => calls.push([x, y, z, r, a]);
  for (let k = 0; k < 5; k++) set.spawn(k * 25, k * 100, 1, 0, 8, 45);
  assert.equal(set.list.length, MAX_HAZES);
  assert.equal(calls.length, 5);
  assert.deepEqual(set.list.map((h) => h.x), [200, 300, 400]);
  assert.equal(set.spawn(100, 400, 1, 0, 8, 45), null, "the same place, a younger haze hangs there");
  assert.equal(calls.length, 5, "no settle call for a haze that did not start");
  const wind = (_x: number, _z: number, o: { x: number; z: number }) => {
    o.x = 10;
    o.z = -4;
  };
  set.update(90, 10, wind);
  const h = set.list[2];
  assert.ok(h.ox > 0 && h.oz < 0);
  set.update(1000, 1, wind);
  assert.equal(set.list.length, 0);
});

test("haze capture and apply round trip at another clock", () => {
  const set = new HazeSet();
  set.spawn(100, 5, 6, 7, 9, 40);
  set.list[0].ox = 3;
  const cap = set.capture(110);
  const back = new HazeSet();
  back.apply(cap, 500);
  assert.equal(back.list.length, 1);
  const h = back.list[0];
  assert.equal(h.born, 490);
  assert.deepEqual([h.x, h.y, h.z, h.radius, h.life, h.ox, h.oz], [5, 6, 7, 9, 40, 3, 0]);
});

test("a shell on the ground scorches a disc of about 0.8 of its radius, strongest at the centre, and clamps at 1", () => {
  const g = new GroundMarksData(GRID);
  const n = g.explosion(40, 1, 40, 5, 1);
  assert.ok(n > 30);
  const c = at(g, 40, 40, SCORCH);
  assert.ok(c > 0.9, "centre");
  assert.ok(at(g, 42, 40, SCORCH) < c, "weaker out");
  assert.equal(at(g, 40, 46, SCORCH), 0, "beyond 0.8 x 5 (and its ragged edge)");
  assert.equal(at(g, 60, 40, SCORCH), 0);
  assert.equal(at(g, 40, 40, DUST), 0);
  for (let k = 0; k < 5; k++) g.explosion(40, 1, 40, 5, 1);
  assert.equal(at(g, 40, 40, SCORCH), 1, "clamped");
  assert.deepEqual(g.takeDirty(), [35, 45]);
  assert.equal(g.takeDirty(), null);
  // A burst high in the air leaves the ground alone.
  const h = new GroundMarksData(GRID);
  assert.equal(h.explosion(40, 30, 40, 5, 1), 0);
});

test("a burning keg scorches a 2 m disc, and not once its fuse has run out", () => {
  const g = new GroundMarksData(GRID);
  const kegs = new Float32Array([20, 1, 20, 100, 60, 1, 60, 0]);
  g.kegs(kegs, 2);
  assert.ok(at(g, 20, 20, SCORCH) > 0.1);
  assert.equal(at(g, 20 + KEG_RADIUS + 1, 20, SCORCH), 0);
  assert.equal(at(g, 60, 60, SCORCH), 0, "no ticks left");
});

function man(x: number, z: number, y = 0): number[] {
  const m = new Array(MINION_STRIDE).fill(0);
  m[0] = 1;
  m[1] = x;
  m[2] = y;
  m[3] = z;
  return m;
}

test("trodden builds under upright men, and one man crossing leaves nothing visible", () => {
  const one = new GroundMarksData(GRID);
  // A man walks 60 m at 1.5 m/s, sampled at 2 Hz.
  for (let s = 0; s < 80; s++) one.walkers(new Float32Array(man(10 + s * 0.75, 30)), 1);
  let max = 0;
  for (let j = 0; j < GRID.nz; j++) for (let i = 0; i < GRID.nx; i++) max = Math.max(max, at(one, i, j, TRODDEN));
  assert.ok(max > 0 && max < TRODDEN_VISIBLE, `one pass leaves ${max}`);
  // Eight waves of twelve over the same route.
  const route = new GroundMarksData(GRID);
  for (let wave = 0; wave < 8; wave++) {
    for (let s = 0; s < 80; s++) {
      const all: number[] = [];
      for (let m = 0; m < 12; m++) all.push(...man(10 + s * 0.75 - m * 1.2, 30 + ((m * 7) % 5) - 2));
      route.walkers(new Float32Array(all), 12);
    }
  }
  assert.ok(at(route, 40, 30, TRODDEN) > 0.5, "a worn route");
  assert.equal(at(route, 40, 10, TRODDEN), 0, "off the route nothing");
  assert.ok(at(route, 40, 31, TRODDEN) > 0, "the sides wear a little");
  for (let k = 0; k < 40; k++) route.walkers(new Float32Array(man(40, 30)), 1);
  assert.equal(at(route, 40, 30, TRODDEN), 1, "capped at 1");
  // No men, no marks; men up a wall tread nothing.
  const none = new GroundMarksData(GRID);
  assert.equal(none.walkers(new Float32Array(0), 0), 0);
  none.walkers(new Float32Array(man(30, 30, 9)), 1, () => 0);
  assert.equal(at(none, 30, 30, TRODDEN), 0);
});

test("dust halves every 90 s and leaves the other marks alone", () => {
  const g = new GroundMarksData(GRID);
  g.dust(40, 40, 10, 0.8);
  g.explosion(40, 1, 40, 5, 1);
  const d0 = at(g, 40, 40, DUST);
  const s0 = at(g, 40, 40, SCORCH);
  assert.ok(d0 > 0.7 && at(g, 36, 40, DUST) > 0);
  g.update(DUST_HALF_LIFE);
  assert.ok(Math.abs(at(g, 40, 40, DUST) - d0 / 2) < 1e-5);
  assert.equal(at(g, 40, 40, SCORCH), s0);
  // The same in 5 s steps.
  const h = new GroundMarksData(GRID);
  h.dust(40, 40, 10, 0.8);
  for (let k = 0; k < 18; k++) h.update(5);
  assert.ok(Math.abs(at(h, 40, 40, DUST) - 0.4) < 1e-4);
  // Eventually gone.
  for (let k = 0; k < 200; k++) h.update(5);
  assert.equal(at(h, 40, 40, DUST), 0);
});

test("ground marks capture, apply and clear round trip", () => {
  const g = new GroundMarksData(GRID);
  g.explosion(30, 1, 30, 4, 1);
  g.dust(50, 50, 8, 0.6);
  g.walkers(new Float32Array(man(20, 20)), 1);
  const cap = g.capture();
  const h = new GroundMarksData(GRID);
  h.apply(cap);
  assert.deepEqual(h.capture(), cap);
  assert.deepEqual(h.takeDirty(), [0, GRID.nz - 1]);
  h.update(90);
  assert.ok(at(h, 50, 50, DUST) < at(g, 50, 50, DUST), "dust still decays after apply");
  h.clear();
  assert.ok(h.capture().every((v) => v === 0));
});

test("a shared store keeps its spare tail", () => {
  const store = new Float32Array(GRID.nx * GRID.nz * MARK_STRIDE + 40).fill(0);
  const g = new GroundMarksData(GRID, store);
  g.explosion(30, 1, 30, 4, 1);
  g.clear();
  assert.equal(g.capture().length, GRID.nx * GRID.nz * MARK_STRIDE);
  assert.throws(() => new GroundMarksData(GRID, new Float32Array(10)));
});
