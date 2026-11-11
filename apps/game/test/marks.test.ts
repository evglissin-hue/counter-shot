import { test } from "node:test";
import assert from "node:assert/strict";
import { BRIDGES, CASTLE_SHAPE, DIST } from "@keepfall/content";
import { newestMark, placeName, SALVO_WAIT_MS, SalvoKeys } from "../src/marks";
import type { MarkInfo } from "../src/protocol";

const bridge = (name: string) => BRIDGES.find((b) => b.name === name)!;
const half = CASTLE_SHAPE.half;

test("a mark is named from where it lies, as the player's own side sees it", () => {
  // Castle 1's player: its left bridge is +x.
  assert.equal(placeName(1, bridge("left").x, 0, bridge("left").z + 12, 0), "Left bridge");
  assert.equal(placeName(1, bridge("right").x, 0, bridge("right").z - 12, 0), "Right bridge");
  assert.equal(placeName(1, 0, 0, bridge("centre").z + 10, 0), "Centre bridge");
  // The guest plays castle 0 and is mirrored: the same ground reads the other way.
  assert.equal(placeName(0, bridge("left").x, 0, bridge("left").z, 0), "Right bridge");
  assert.equal(placeName(0, bridge("right").x, 0, bridge("right").z, 0), "Left bridge");
  assert.equal(placeName(0, 0, 0, bridge("centre").z, 0), "Centre bridge");
});

test("gates, enemy masonry and open field", () => {
  // Castle 1's player: their gate is castle 0's front gate (z = -half), ours is at z = -DIST + half.
  assert.equal(placeName(1, 0, 0, -half - 3, 0), "Their gate");
  assert.equal(placeName(1, 0, 0, -DIST + half + 3, 0), "Our gate");
  // For castle 0 it is the other way round.
  assert.equal(placeName(0, 0, 0, -DIST + half + 3, 0), "Their gate");
  assert.equal(placeName(0, 0, 0, -half - 3, 0), "Our gate");
  // On their masonry away from the gate: a wall. The same spot on the ground is the field.
  assert.equal(placeName(1, half - 2, 9, 4, 0), "Their wall");
  assert.equal(placeName(1, 60, 0, -40, 0), "Field");
  assert.equal(placeName(1, 0, 0, -45, 0), "Field");
});

test("F then a number orders the salvo at that mark; F twice the newest; F then anything else, or 2 s, cancels", () => {
  const k = new SalvoKeys();
  assert.deepEqual(k.step(0, false, -1, false), { order: -1, eat: false });
  assert.deepEqual(k.step(100, true, -1, false), { order: -1, eat: false });
  assert.ok(k.armed);
  assert.deepEqual(k.step(300, false, 2, false), { order: 3, eat: true }, "key 3 is mark 3 and is not a gun switch");
  assert.ok(!k.armed);
  // A number with no F before it is a gun switch: not ours.
  assert.deepEqual(k.step(400, false, 2, false), { order: -1, eat: false });
  // F twice.
  k.step(1000, true, -1, false);
  assert.deepEqual(k.step(1200, true, -1, false), { order: 0, eat: false });
  assert.ok(!k.armed);
  // Anything else cancels, and the number after it is a gun switch again.
  k.step(2000, true, -1, false);
  k.step(2100, false, -1, true);
  assert.ok(!k.armed);
  assert.deepEqual(k.step(2200, false, 1, false), { order: -1, eat: false });
  // Two seconds of nothing cancels.
  k.step(3000, true, -1, false);
  assert.ok(k.armed);
  assert.deepEqual(k.step(3000 + SALVO_WAIT_MS + 1, false, 1, false), { order: -1, eat: false });
  assert.ok(!k.armed);
  // F and its number in one frame: read at once, in that order.
  assert.deepEqual(k.step(4000, true, 0, false), { order: 1, eat: true });
  assert.ok(!k.armed);
  // Keys 7 and 8 name no mark (six at most): eaten, no order.
  k.step(5000, true, -1, false);
  assert.deepEqual(k.step(5100, false, 6, false), { order: -1, eat: true });
});

test("the newest mark is the one made last", () => {
  const m = (n: number, made: number) => ({ n, made }) as MarkInfo;
  assert.equal(newestMark([]), 0);
  assert.equal(newestMark([m(1, 100), m(2, 900), m(3, 400)]), 2);
  assert.equal(newestMark([m(4, 500), m(2, 500)]), 4);
});
