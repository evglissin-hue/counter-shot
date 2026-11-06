import { test } from "node:test";
import assert from "node:assert/strict";
import { Pacer, SCALES } from "../src/pacing";

/** Runs frames of `ms` each for `seconds`, starting at `t0` ms; returns the end time and what happened. */
function run(p: Pacer, t0: number, seconds: number, ms: number, gpu: number | null = null) {
  let now = t0, drops = 0, lowest = p.scaleIdx;
  while (now < t0 + seconds * 1000) {
    now += ms;
    const r = p.frame(ms, gpu, now);
    if (r.dropTier) drops++;
    lowest = Math.max(lowest, p.scaleIdx);
  }
  return { now, drops, lowest };
}

test("a mortar burst lowers the resolution for a moment and never the quality tier", () => {
  const p = new Pacer();
  let t = run(p, 0, 5, 8.3).now; // calm at 120 Hz
  assert.equal(p.scaleIdx, 0);
  p.burst(t);
  const heavy = run(p, t, 4, 30); // the burst: 33 fps for four seconds
  assert.equal(heavy.drops, 0, "no tier drop during a burst");
  assert.ok(heavy.lowest >= 2, `the resolution stepped down (step ${heavy.lowest})`);
  const after = run(p, heavy.now, 12, 9);
  assert.equal(after.drops, 0, "no tier drop after it");
  assert.equal(p.scaleIdx, 0, "back to full resolution");
  assert.equal(SCALES[p.scaleIdx], 1);
  t = after.now;
});

test("many bursts in a row still never cost a tier", () => {
  const p = new Pacer();
  let now = 0, drops = 0;
  for (let k = 0; k < 10; k++) {
    p.burst(now);
    const h = run(p, now, 3, 35);
    const c = run(p, h.now, 3, 12);
    drops += h.drops + c.drops;
    now = c.now;
  }
  assert.equal(drops, 0);
});

test("lasting slowness in calm play drops a tier the quick test picked, but not one the player chose", () => {
  const auto = new Pacer();
  const slow = run(auto, 0, 20, 40);
  assert.ok(slow.drops >= 1, "an automatic tier comes down when the machine cannot keep up");
  const chosen = new Pacer();
  chosen.tierChosen = true;
  assert.equal(run(chosen, 0, 20, 40).drops, 0, "a chosen tier stays");
  assert.equal(chosen.scaleIdx, SCALES.length - 1, "resolution still helps it");
});

test("a measured GPU time is used where the screen's refresh hides it", () => {
  const p = new Pacer();
  // Frames held at 16.7 ms by a 60 Hz screen, but the GPU needs 18 ms: step down.
  run(p, 0, 2, 16.7, 18);
  assert.ok(p.scaleIdx >= 1, `step ${p.scaleIdx}`);
  // GPU comfortably fast again: back up.
  run(p, 2000, 10, 16.7, 6);
  assert.equal(p.scaleIdx, 0);
});
