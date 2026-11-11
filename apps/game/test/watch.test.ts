// S6: the replay bar's pure parts: the speeds a machine is offered, and the clock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clockOf, speedLimit } from "../src/watch";

test("4x is offered while a physics step averages under 3 ms, 2x under 6 ms, else real time", () => {
  assert.equal(speedLimit(0), 4, "nothing measured yet: not held back");
  assert.equal(speedLimit(1.2), 4);
  assert.equal(speedLimit(2.99), 4);
  assert.equal(speedLimit(3), 2);
  assert.equal(speedLimit(5.9), 2);
  assert.equal(speedLimit(6), 1);
  assert.equal(speedLimit(40), 1);
});

test("the clock reads minutes and seconds", () => {
  assert.equal(clockOf(0), "0:00");
  assert.equal(clockOf(59 * 60 + 59), "0:59");
  assert.equal(clockOf(600 * 60), "10:00");
});
