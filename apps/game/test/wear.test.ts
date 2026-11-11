import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, GAME_LAYOUT } from "@keepfall/content";
import { FACE_NEW, WEAR_STRIDE, WearModel, type RestStone } from "../src/render/wearLogic";

function box(id: number, x: number, y: number, z: number, h = [0.5, 0.25, 0.5], q: number[] = [0, 0, 0, 1], extra: Partial<RestStone> = {}): RestStone {
  return { id, x, y, z, q, hx: h[0], hy: h[1], hz: h[2], castle: 0, material: "stone", shape: "box", ...extra };
}
const F = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 };

test("contacts: two touching boxes, one each way", () => {
  const m = new WearModel([box(0, 0, 0, 0), box(1, 1.0, 0, 0)]);
  assert.deepEqual(m.contactsOf(0), [[1, F.PX]]);
  assert.deepEqual(m.contactsOf(1), [[0, F.NX]]);
});

test("contacts: none across a 10 cm gap, none when only edges meet", () => {
  const gap = new WearModel([box(0, 0, 0, 0), box(1, 1.1, 0, 0)]);
  assert.equal(gap.contactCount, 0);
  const edge = new WearModel([box(0, 0, 0, 0), box(1, 1.0, 0, 1.0)]);
  assert.equal(edge.contactCount, 0);
  // Overlap of 4 cm only: not a face.
  const sliver = new WearModel([box(0, 0, 0, 0), box(1, 1.0, 0, 0.96)]);
  assert.equal(sliver.contactCount, 0);
});

test("contacts: stacked courses and a wall turned by a quaternion", () => {
  const stack = new WearModel([box(0, 0, 0, 0), box(1, 0.3, 0.5, 0)]);
  assert.deepEqual(stack.contactsOf(0), [[1, F.PY]]);
  assert.deepEqual(stack.contactsOf(1), [[0, F.NY]]);
  // Turn the pair a quarter about Y: local +X maps to world -Z.
  const s = Math.SQRT1_2;
  const q = [0, s, 0, s];
  const turned = new WearModel([box(0, 0, 0, 0, undefined, q), box(1, 0, 0, -1.0, undefined, q)]);
  assert.deepEqual(turned.contactsOf(0), [[1, F.PX]]);
  assert.deepEqual(turned.contactsOf(1), [[0, F.NX]]);
  // A stone turned a quarter against an unturned one (a corner): contact on the right faces.
  const corner = new WearModel([box(0, 0, 0, 0), box(1, 1.0, 0, 0, undefined, q)]);
  assert.deepEqual(corner.contactsOf(0), [[1, F.PX]]);
});

test("a neighbour leaving its place bares the right faces only", () => {
  const m = new WearModel([box(0, 0, 0, 0), box(1, 1.0, 0, 0), box(2, -1.0, 0, 0), box(3, 0, 0.5, 0)]);
  m.moved(1, 1.0, 0, 0.02); // 2 cm: still in place
  assert.equal(m.facesOf(0), 0);
  m.moved(1, 1.0, -3, 0); // gone
  assert.equal(m.facesOf(1), 1 << F.NX);
  assert.equal(m.facesOf(0), 1 << F.PX, "the face of the standing neighbour that faced it");
  assert.equal(m.facesOf(2), 0);
  assert.equal(m.facesOf(3), 0);
  // The stone above leaves too: stone 0 gets its +Y face as well.
  m.moved(3, 0, 5, 0);
  assert.equal(m.facesOf(0), (1 << F.PX) | (1 << F.PY));
});

test("Laid clears fresh bits, sets new, re-covers the neighbour's face", () => {
  const m = new WearModel([box(0, 0, 0, 0), box(1, 1.0, 0, 0), box(2, -1.0, 0, 0)]);
  m.moved(1, 1.0, -3, 0);
  assert.equal(m.facesOf(0), 1 << F.PX);
  m.now = 10;
  m.laid(1);
  assert.equal(m.facesOf(1), FACE_NEW);
  assert.equal(m.facesOf(0), 0);
  // Its flight home does not bare anything.
  m.moved(1, 3, 4, 0);
  m.moved(1, 1.0, 0.8, 0);
  assert.equal(m.facesOf(1), FACE_NEW);
  assert.equal(m.facesOf(0), 0);
  m.moved(1, 1.0, 0, 0);
  // After arrival, a new knock does count.
  m.moved(1, 1.0, -3, 0);
  assert.equal(m.facesOf(1) & (1 << F.NX), 1 << F.NX);
  assert.equal(m.facesOf(1) & FACE_NEW, FACE_NEW);
});

test("Raised clears bits and does not set new", () => {
  const m = new WearModel([box(0, 0, 0, 0, undefined, undefined, { plot: 0 })]);
  m.laid(0);
  assert.equal(m.facesOf(0), FACE_NEW);
  m.raised(0);
  assert.equal(m.facesOf(0), 0);
});

test("soot: explosion falloff and caps, muzzle cap, kegs", () => {
  const m = new WearModel([box(0, 0, 0, 0), box(1, 3, 0, 0), box(2, 30, 0, 0)]);
  m.explosion(0, 0, 0, 2);
  const s = (id: number) => m.wear[id * WEAR_STRIDE + 1];
  assert.ok(Math.abs(s(0) - 0.8) < 1e-6);
  assert.ok(s(1) > 0 && s(1) < s(0), "falls off with distance");
  assert.equal(s(2), 0);
  m.explosion(0, 0, 0, 2);
  assert.equal(s(0), 1, "caps at 1");
  // Muzzle: cap 0.8, only below or behind.
  const g = new WearModel([box(0, 0, -1, 0), box(1, 0, 2, 1)]);
  for (let i = 0; i < 20; i++) g.muzzle(0, 0, 0, 0, 0, 1);
  assert.ok(Math.abs(g.wear[1] - 0.8) < 1e-6, "below the muzzle, capped at 0.8");
  assert.equal(g.wear[WEAR_STRIDE + 1], 0, "above and ahead: clean");
  // Kegs: 0.1 a second.
  const k = new WearModel([box(0, 1, 0, 0), box(1, 9, 0, 0)]);
  k.setKegs([0, 0, 0, 100], 1);
  for (let i = 0; i < 10; i++) k.update(0.1);
  assert.ok(k.wear[1] > 0.07 && k.wear[1] <= 0.1);
  assert.equal(k.wear[WEAR_STRIDE + 1], 0);
});

test("cracks from blows held, and setCrack", () => {
  const m = new WearModel([box(0, 0, 0, 0), box(1, 0, 3, 0)]);
  m.impact(0.5, 0, 0, 1);
  const c = (id: number) => m.wear[id * WEAR_STRIDE + 2];
  assert.ok(c(0) > 0 && c(0) <= 0.6);
  assert.equal(c(1), 0);
  m.setCrack(1, 0.7);
  assert.ok(Math.abs(c(1) - 0.7) < 1e-6);
  m.setCrack(1, 3);
  assert.equal(c(1), 1);
});

test("dust washes on and halves every 90 s", () => {
  const m = new WearModel([box(0, 0, 0, 0), box(1, 40, 0, 0)]);
  m.dustAround(0, 0, 0, 5, 0.8);
  const d = () => m.wear[3];
  assert.ok(Math.abs(d() - 0.8) < 1e-6);
  assert.equal(m.wear[WEAR_STRIDE + 3], 0);
  for (let i = 0; i < 90; i++) m.update(1);
  assert.ok(Math.abs(d() - 0.4) < 0.01, `halved: ${d()}`);
});

test("capture and apply round trip; clear", () => {
  const m = new WearModel([box(0, 0, 0, 0), box(1, 1, 0, 0)]);
  m.moved(1, 1, -3, 0);
  m.explosion(0, 0, 0, 2);
  m.dustAround(0, 0, 0, 3, 0.5);
  const snap = m.capture();
  m.clear();
  assert.ok(m.wear.every((v) => v === 0));
  const seen: number[] = [];
  m.drain((id) => seen.push(id));
  m.apply(snap);
  assert.deepEqual(Array.from(m.wear), Array.from(snap));
  seen.length = 0;
  m.drain((id) => seen.push(id));
  assert.deepEqual(seen.sort(), [0, 1], "every stone is flushed after apply");
  m.drain((id) => seen.push(id));
  assert.equal(seen.length, 2, "and only once");
});

test("the real layout: contacts exist, plot pieces have none, wedges only stack", () => {
  const layout = buildLayout(1, GAME_LAYOUT);
  const m = new WearModel(layout.stones);
  assert.ok(m.contactCount > layout.stones.length, `contacts ${m.contactCount} for ${layout.stones.length} stones`);
  for (const s of layout.stones) {
    if (s.plot !== undefined || s.material !== "stone") assert.equal(m.contactsOf(s.id).length, 0);
    for (const [nb, f] of m.contactsOf(s.id)) {
      assert.ok(m.contactsOf(nb).some(([a]) => a === s.id), "contacts are symmetric");
      if (s.shape === "wedge") assert.ok(f === 2 || f === 3);
    }
  }
  // A standing wall shows no fresh faces until something moves.
  assert.ok(m.wear.every((v) => v === 0));
});
