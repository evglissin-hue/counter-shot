import { test } from "node:test";
import assert from "node:assert/strict";
import { BAND, FLAG_FRONT_GAIN, FRONT_SPEED, PASS_FADE, WindState, flagWindTarget } from "../src/render/windState";

/** A wind state with the wind now at (4, 0), a gust to (8, 0) due in `secs` seconds, anchored at (0, -150). */
function gusty(secs: number): WindState {
  const w = new WindState();
  w.setAnchor(0, -150);
  w.setFrame(4, 0, 8, 0, secs * 60);
  // Let the upwind wind ease fully to the lead.
  for (let i = 0; i < 120; i++) w.update(1 / 60);
  return w;
}

test("a front starts upwind at FRONT_SPEED times the time left", () => {
  const w = new WindState();
  w.setAnchor(0, -150);
  w.setFrame(4, 0, 8, 0, 4 * 60);
  for (let i = 0; i < 120; i++) {
    w.setFrame(4, 0, 8, 0, 4 * 60 - i);
    w.update(1 / 60);
  }
  // 2 s have gone, so 2 s are left: 60 m upwind of the anchor along -x.
  assert.ok(Math.abs(w.frontX - -60) < 1, `frontX ${w.frontX}`);
  assert.ok(Math.abs(w.frontZ - -150) < 1e-6);
  assert.equal(w.frontDirX, 1);
  assert.equal(2 * FRONT_SPEED, 60);
});

test("the front reaches the anchor as gustIn reaches 0", () => {
  const w = new WindState();
  w.setAnchor(10, -140);
  for (let i = 0; i <= 200; i++) {
    w.setFrame(0, 6, 0, 9, Math.max(0, 200 - i));
    w.update(1 / 60);
  }
  assert.ok(Math.hypot(w.frontX - 10, w.frontZ - -140) < 1e-6);
});

test("a gust band is positive, a lull negative, and it peaks on the front", () => {
  const up = gusty(3);
  assert.ok(up.changeNext > 0.4);
  assert.ok(up.bandAt(up.frontX, up.frontZ) > 0.4);
  assert.ok(Math.abs(up.bandAt(up.frontX + 4 * BAND, up.frontZ)) < 1e-6);
  const w = new WindState();
  w.setAnchor(0, -150);
  w.setFrame(8, 0, 4, 0, 180);
  for (let i = 0; i < 120; i++) w.update(1 / 60);
  assert.ok(w.bandAt(w.frontX, w.frontZ) < -0.2);
});

test("bandAt and sampleAt match the formulas", () => {
  const w = gusty(3);
  const x = -20, z = -143;
  const a = ((x - w.frontX) * w.frontDirX + (z - w.frontZ) * w.frontDirZ) / BAND;
  assert.ok(Math.abs(w.bandAt(x, z) - Math.exp(-a * a) * w.changeNext) < 1e-12);
  const out = { x: 0, z: 0 };
  // Far upwind of the front: the coming wind. Far downwind: the wind now.
  w.sampleAt(w.frontX - 3 * BAND, w.frontZ, out);
  assert.ok(Math.abs(out.x - 8) < 0.05);
  w.sampleAt(w.frontX + 3 * BAND, w.frontZ, out);
  assert.ok(Math.abs(out.x - 4) < 1e-9);
  w.sampleAt(w.frontX, w.frontZ, out);
  assert.ok(Math.abs(out.x - 6) < 0.05);
});

test("a passing front rolls on downwind and fades", () => {
  const w = new WindState();
  w.setAnchor(0, -150);
  for (let i = 0; i < 240; i++) {
    w.setFrame(4, 0, 8, 0, Math.max(0, 120 - i));
    w.update(1 / 60);
  }
  // The gust arrived: now the wind is 8 and a new gust begins 3 s out.
  w.setFrame(8, 0, 6, 0, 180);
  w.update(1 / 60);
  const p0 = w.pastX;
  const c0 = w.changePast;
  assert.ok(c0 > 0.3, `change ${c0}`);
  for (let i = 0; i < 60; i++) {
    w.setFrame(8, 0, 6, 0, 180 - i - 1);
    w.update(1 / 60);
  }
  assert.ok(w.pastX > p0 + FRONT_SPEED * 0.9, "rolled on");
  assert.ok(w.changePast < c0 && w.changePast > 0, "fading");
  for (let i = 0; i < PASS_FADE * 60; i++) w.update(1 / 60);
  assert.equal(w.changePast, 0);
});

test("no front when the gust fields are missing", () => {
  const w = new WindState();
  w.setAnchor(0, -150);
  w.setFrame(5, 2);
  for (let i = 0; i < 60; i++) w.update(1 / 60);
  assert.equal(w.hasLead, false);
  assert.equal(w.changeNext, 0);
  assert.equal(w.bandAt(0, -150), 0);
  const out = { x: 0, z: 0 };
  w.sampleAt(100, 100, out);
  assert.ok(Math.abs(out.x - 5) < 1e-9 && Math.abs(out.z - 2) < 1e-9);
});

test("the drift follows the wind and stays small", () => {
  const w = new WindState();
  w.setFrame(10, -5);
  for (let i = 0; i < 60; i++) w.update(1);
  assert.ok(Math.abs(w.driftX) <= 4096 && Math.abs(w.driftZ) <= 4096);
  const v = new WindState();
  v.setFrame(2, 1);
  v.update(3);
  assert.equal(v.driftX, 6);
  assert.equal(v.driftZ, 3);
});

test("a banner streams harder as a gust front passes and slacker in a lull", () => {
  const calm = flagWindTarget(4, 0, 0);
  const gust = flagWindTarget(4, 0, 1);
  const lull = flagWindTarget(4, 0, -1);
  assert.ok(gust.strength > calm.strength && lull.strength < calm.strength);
  assert.ok(Math.abs(gust.strength - calm.strength - FLAG_FRONT_GAIN) < 1e-12);
  assert.ok(Math.abs(calm.angle as number) < 1e-12);
  assert.equal(flagWindTarget(0, 0, 0).angle, null);
  assert.equal(flagWindTarget(0, 0, -1).strength, 0);
});
