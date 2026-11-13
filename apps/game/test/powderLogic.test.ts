// Powder as the eye sees it (3.3): kegs from stock, the hoisted keg along its rope, a boy's pose from his action.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ACT_HOIST, ACT_KEG, boyPose, haulHands, hoistKeg, kegsFor, MAX_STACK, ropeTop, stackSlot, stockShare } from "../src/render/powderLogic";

test("a keg for every 10 charges, up to 12, none without a standing magazine", () => {
  assert.equal(kegsFor(40, true), 4, "a match starts with 40 charges: 4 kegs");
  assert.equal(kegsFor(9, true), 0);
  assert.equal(kegsFor(10, true), 1);
  assert.equal(kegsFor(119, true), 11);
  assert.equal(kegsFor(120, true), 12);
  assert.equal(kegsFor(500, true), MAX_STACK);
  assert.equal(kegsFor(80, false), 0, "rising or a ruin: none");
  assert.equal(kegsFor(0, true), 0, "a blown magazine leaves none");
  assert.equal(kegsFor(NaN, true), 0);
});

test("the stack is a low pyramid: the bottom row fills first and every slot is its own", () => {
  const slots = Array.from({ length: MAX_STACK }, (_, i) => stackSlot(i));
  assert.equal(slots.filter((s) => s.row === 0).length, 6);
  assert.equal(slots.filter((s) => s.row === 1).length, 4);
  assert.equal(slots.filter((s) => s.row === 2).length, 2);
  assert.ok(slots.slice(0, 6).every((s) => s.row === 0), "the first six lie on the ground");
  const keys = new Set(slots.map((s) => `${s.along.toFixed(2)},${s.y.toFixed(2)}`));
  assert.equal(keys.size, MAX_STACK, "no two kegs share a place");
  const row0 = slots.filter((s) => s.row === 0).map((s) => s.along);
  assert.ok(Math.abs(row0.reduce((a, b) => a + b, 0)) < 1e-9, "the bottom row is centred");
});

test("a hoisted keg rises along the rope from the foot (share 0) to the gun (share 1)", () => {
  const foot = { x: 3, z: 10 }, gun = { x: 3.2, y: 8, z: 11.4 };
  const a = hoistKeg(0, foot, gun), b = hoistKeg(1, foot, gun), m = hoistKeg(0.5, foot, gun);
  assert.ok(a.rope && b.rope && m.rope);
  assert.equal(a.x, 3);
  assert.equal(a.z, 10);
  assert.ok(a.y < 0.5, "on the ground");
  const top = ropeTop(gun);
  assert.ok(Math.abs(b.x - top.x) < 1e-9 && Math.abs(b.y - top.y) < 1e-9 && Math.abs(b.z - top.z) < 1e-9, "at the gun");
  assert.ok(m.y > a.y && m.y < b.y, "halfway is between");
  assert.ok(Math.abs(m.y - (a.y + b.y) / 2) < 1e-9);
  assert.deepEqual(hoistKeg(-1, foot, gun), a, "a share under 0 is the ground");
  assert.deepEqual(hoistKeg(2, foot, gun), b, "a share over 1 is the gun");
});

test("beside a mortar pit the keg slides along the ground into the pit's edge: no rope", () => {
  const foot = { x: 5, z: 4 }, pit = { x: 3.4, y: 0.4, z: 4 };
  const a = hoistKeg(0, foot, pit), b = hoistKeg(1, foot, pit);
  assert.equal(a.rope, false);
  assert.equal(b.rope, false);
  assert.equal(a.y, b.y, "it stays on the ground");
  assert.equal(a.x, 5);
  assert.ok(Math.abs(b.x - 4.1) < 1e-9, "0.7 m from the pit's middle, on the foot's side");
});

test("a boy's pose from his action: keg on the shoulder, hauling, or plain", () => {
  assert.equal(boyPose(ACT_KEG), "keg");
  assert.equal(boyPose(ACT_HOIST), "hoist");
  assert.equal(boyPose(0), "none");
  assert.equal(boyPose(1), "none");
  assert.equal(ACT_KEG, 10);
  assert.equal(ACT_HOIST, 11);
});

test("hand over hand: the hands are half a pull apart and stay within 0..1", () => {
  for (let t = 0; t < 120; t++) {
    const h = haulHands(t);
    assert.ok(h.left >= 0 && h.left <= 1 && h.right >= 0 && h.right <= 1);
  }
  assert.notEqual(haulHands(0).left, haulHands(0).right);
  assert.equal(haulHands(0).left, haulHands(60).left, "one pull a second");
});

test("the stock bar is the share of the cap, clamped; no cap, no bar", () => {
  assert.equal(stockShare(40, 120), 40 / 120);
  assert.equal(stockShare(200, 120), 1);
  assert.equal(stockShare(-5, 120), 0);
  assert.equal(stockShare(10, 0), -1);
});
