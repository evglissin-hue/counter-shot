import { test } from "node:test";
import assert from "node:assert/strict";
import { BELL_RING_SECONDS, OrganWatch } from "../src/organWatch";

test("a bell rings from the moment it is struck, for as long as a ring lasts", () => {
  let now = 100;
  const w = new OrganWatch(() => now);
  assert.equal(w.bellRinging(0), -1);
  w.ring(1);
  assert.equal(w.bellRinging(1), 0);
  assert.equal(w.bellRinging(0), -1, "the other castle's bell is quiet");
  now += 3;
  assert.equal(w.bellRinging(1), 3);
  now += BELL_RING_SECONDS;
  assert.equal(w.bellRinging(1), -1, "the ring is over");
  assert.deepEqual(w.rings, [0, 1]);
});

test("a bell that falls stops at once", () => {
  let now = 0;
  const w = new OrganWatch(() => now);
  w.ring(0);
  now += 2;
  assert.equal(w.bellRinging(0), 2);
  w.cut(0);
  assert.equal(w.bellRinging(0), -1);
  w.ring(0);
  now += 1;
  assert.equal(w.bellRinging(0), 1, "a new ring starts again from nothing");
  w.reset();
  assert.equal(w.bellRinging(0), -1);
});
