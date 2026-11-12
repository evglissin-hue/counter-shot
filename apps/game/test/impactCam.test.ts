// The impact cam's rules (show track, S2): when it opens and closes, which request wins, where the camera
// stands, and how a shot's landing is predicted and corrected. The page's clock and the renderer's questions
// (ground, masonry in the way, where a path hits) are stand-ins here.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FlightCoef } from "@keepfall/sim";
import {
  HOLD_MS,
  LEAD_MS,
  chooseStand,
  closeImpactCam,
  impactState,
  openImpactCam,
  pathTime,
  predictLanding,
  setImpactClock,
  setImpactDeps,
  setImpactEnabled,
  setImpactPaced,
  shotBurst,
  shotFired,
  shotLanded,
  shotSeen,
  shotsGone,
  swapImpactViews,
  updateImpactCam,
  type ImpactDeps,
} from "../src/impactCam";

let t = 0;
/** Stand-in world: level ground at y = 0 and a list of blocked lines (a wall as a predicate). */
let blocked: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => boolean = () => false;
let ground: (x: number, z: number) => number = () => 0;
let cast: ImpactDeps["castPath"] = () => null;
const deps: ImpactDeps = {
  groundAt: (x, z) => ground(x, z),
  sightBlocked: (...a) => blocked(...a),
  castPath: (p) => cast(p),
};
const AT = { x: 0, y: 5, z: -16 };
const FROM = { x: 0, z: -134 };
/** Run frames of 1/30 s up to `ms` after `t` and return the last frame. */
function run(ms: number) {
  let f = updateImpactCam(t, 1 / 30);
  for (const end = t + ms; t < end; ) {
    t += 1000 / 30;
    f = updateImpactCam(t, 1 / 30);
  }
  return f;
}

beforeEach(() => {
  t = 1000;
  blocked = () => false;
  ground = () => 0;
  cast = () => null;
  setImpactClock(() => t);
  setImpactDeps(deps);
  setImpactEnabled(true);
  setImpactPaced(false);
  closeImpactCam();
});

test("a request opens a second before the landing and closes 3 s after it", () => {
  openImpactCam(AT, 2500, "shot", FROM);
  assert.equal(impactState().open, true);
  assert.equal(updateImpactCam(t, 1 / 30).pose, null, "armed, not shown yet");
  const early = run(2500 - LEAD_MS - 100);
  assert.equal(early.pose, null);
  const f = run(300);
  assert.notEqual(f.pose, null, "shown a second before the landing");
  assert.equal(impactState().shown, true);
  // The landing is at t0 + 2500; it stays until 3 s after.
  const mid = run(LEAD_MS + 100 + HOLD_MS - 600);
  assert.notEqual(mid.pose, null, "still open just before it closes");
  let closing = run(0);
  for (let i = 0; i < 90 && impactState().open; i++) {
    t += 1000 / 30;
    closing = updateImpactCam(t, 1 / 30);
  }
  assert.equal(impactState().open, false);
  assert.notEqual(closing.pose, null, "a short fade holds the last view as it closes");
  assert.ok(closing.fade < 1);
  run(400);
  assert.equal(updateImpactCam(t, 1 / 30).pose, null, "then it is closed");
});

test("a landing less than a second away opens at once", () => {
  openImpactCam(AT, 400, "moment");
  assert.notEqual(updateImpactCam(t, 1 / 30).pose, null);
});

test("it looks at the landing from 30 to 40 m to one side and 6 to 12 m above, and pushes in about 15 %", () => {
  openImpactCam(AT, 0, "shot", FROM);
  const first = updateImpactCam(t, 1 / 30).pose!;
  const dist = (p: { x: number; y: number; z: number }) => Math.hypot(p.x - AT.x, p.z - AT.z);
  const d0 = dist(first);
  assert.ok(d0 >= 30 && d0 <= 40, `stands ${d0.toFixed(1)} m out`);
  const h = first.y - AT.y;
  assert.ok(h >= 6 && h <= 12, `${h.toFixed(1)} m up`);
  // To the side of the shot's line (which runs along z): mostly in x.
  assert.ok(Math.abs(first.x - AT.x) > 0.95 * d0, "beside the line of the shot");
  assert.equal(first.tx, AT.x);
  assert.equal(first.tz, AT.z);
  const last = run(HOLD_MS - 100).pose!;
  const d1 = dist(last);
  assert.ok(d1 < d0 * 0.9 && d1 > d0 * 0.8, `${d0.toFixed(1)} m closing to ${d1.toFixed(1)} m`);
});

test("the stand takes the first side clear of masonry, and stays above the ground", () => {
  // A wall on the right of the shot's line (looking along it, +x is the left of the line, -x the right): block the one side.
  const sides = chooseStand(AT, FROM, deps);
  blocked = (ax) => Math.sign(ax - AT.x) === Math.sign(sides.x);
  const other = chooseStand(AT, FROM, deps);
  assert.equal(Math.sign(other.x), -Math.sign(sides.x), "the other side");
  // Both sides shut: the next bearings are tried (not straight along the line, which is last).
  blocked = (ax) => Math.abs(ax - AT.x) > 20;
  const third = chooseStand(AT, FROM, deps);
  assert.ok(Math.abs(third.x) <= 20.001, "a bearing nearer the line");
  // A hill under the side positions: the camera stands above the ground there.
  blocked = () => false;
  ground = (x) => (Math.abs(x - AT.x) > 20 ? 30 : 0);
  const up = chooseStand(AT, FROM, deps);
  assert.ok(up.y + AT.y >= 30 - 1e-9 || Math.abs(up.x) < 20, "never under the ground");
  // Nothing clear at all: still a stand, high on one side.
  blocked = () => true;
  const none = chooseStand(AT, FROM, deps);
  assert.ok(Math.hypot(none.x, none.z) > 30 && none.y >= 12);
});

test("a newer shot replaces the open request; a moment replaces only a moment", () => {
  openImpactCam({ x: 1, y: 0, z: 0 }, 0, "shot", FROM);
  openImpactCam({ x: 2, y: 0, z: 0 }, 0, "moment");
  updateImpactCam(t, 1 / 30);
  assert.equal(impactState().reason, "shot", "a moment does not replace a shot");
  openImpactCam({ x: 3, y: 0, z: 0 }, 0, "shot", FROM);
  updateImpactCam(t, 1 / 30);
  assert.ok(Math.abs(run(2000).pose!.tx - 3) < 0.2, "a shot replaces a shot (the camera glides to it)");
  closeImpactCam();
  openImpactCam({ x: 4, y: 0, z: 0 }, 0, "moment");
  openImpactCam({ x: 5, y: 0, z: 0 }, 0, "moment");
  updateImpactCam(t, 1 / 30);
  assert.ok(Math.abs(run(2000).pose!.tx - 5) < 0.2, "a moment replaces a moment");
  openImpactCam({ x: 6, y: 0, z: 0 }, 0, "shot", FROM);
  assert.equal(impactState().reason, "shot", "a shot replaces a moment");
});

test("K (off) and the frame pacer's floor keep it shut and close it", () => {
  setImpactEnabled(false);
  openImpactCam(AT, 0, "shot", FROM);
  assert.equal(impactState().open, false);
  setImpactEnabled(true);
  openImpactCam(AT, 0, "shot", FROM);
  assert.notEqual(updateImpactCam(t, 1 / 30).pose, null);
  setImpactPaced(true);
  assert.equal(updateImpactCam(t, 1 / 30).pose, null, "closes while the pacer is at its floor");
  openImpactCam(AT, 0, "shot", FROM);
  assert.equal(impactState().open, false, "and stays closed");
  setImpactPaced(false);
  setImpactEnabled(false);
  openImpactCam(AT, 0, "shot", FROM);
  openImpactCam(AT, 0, "moment");
  assert.equal(impactState().open, false);
});

test("a click swaps the views only while it is shown, and they go back when it closes", () => {
  openImpactCam(AT, 3000, "shot", FROM);
  swapImpactViews();
  assert.equal(impactState().swapped, false, "not while armed");
  run(2500);
  swapImpactViews();
  assert.equal(updateImpactCam(t, 1 / 30).swapped, true);
  run(HOLD_MS + 1500);
  assert.equal(impactState().swapped, false);
  assert.equal(updateImpactCam(t, 1 / 30).swapped, false);
});

test("a shot's landing is predicted from its state each frame, and a hit on the way opens it at once", () => {
  const coef: FlightCoef = { drag: 0, magnus: 0, gravity: 1 };
  // A ball from 10 m up at 20 m/s along +z, flat: still air, level ground, no masonry.
  const hit = predictLanding([0, 10, 0], [0, 0, 20], null, { x: 0, z: 0 }, coef, deps);
  assert.ok(hit);
  const fall = Math.sqrt((2 * 10) / 9.81);
  assert.ok(Math.abs(hit.t - fall) < 0.05, `lands in ${hit.t.toFixed(2)} s (expected ${fall.toFixed(2)})`);
  assert.ok(Math.abs(hit.z - 20 * fall) < 1.5);
  // It never lands within 14 s: no prediction.
  assert.equal(predictLanding([0, 5000, 0], [0, 0, 0], null, { x: 0, z: 0 }, { drag: 0, magnus: 0, gravity: 0 }, deps), null);

  shotFired(7, 3, FROM, coef, null);
  shotSeen(7, 0, 10, 0, 0, 0, 20, { x: 0, z: 0 }, 1);
  assert.equal(impactState().open, true, "armed from the shot's first frame");
  assert.ok(Math.abs(impactState().msToLanding - fall * 1000) < 80);
  // A wall in the way: the cast finds a hit at 0.6 s in, 12 m out; the prediction moves.
  cast = (path) => ({ index: Math.min(9, path.length / 3 - 2), x: 0, y: 3, z: 12, stone: 5, nx: 0, ny: 0, nz: -1 });
  shotSeen(7, 0, 10, 0, 0, 0, 20, { x: 0, z: 0 }, 1);
  assert.ok(impactState().msToLanding < fall * 1000, "earlier than the ground");
  // The sim says it came down: where it did, now, and held 3 s from here.
  t += 400;
  shotLanded(3, 1, 2, 9);
  const f = updateImpactCam(t, 1 / 30);
  assert.ok(f.pose);
  assert.equal(f.pose!.tz, 9);
  assert.equal(impactState().msToLanding, 0);
  run(HOLD_MS - 200);
  assert.equal(impactState().open, true);
  run(500);
  assert.equal(impactState().open, false);
});

test("a shot that lands before it was predicted opens at once, and a shot nobody tracks opens nothing", () => {
  shotLanded(3, 5, 0, 5);
  assert.equal(impactState().open, false, "no tracked shot, no inset");
  shotFired(1, 3, FROM, { drag: 0, magnus: 0, gravity: 1 }, null);
  shotLanded(3, 5, 0, 5);
  assert.equal(impactState().open, true);
  assert.notEqual(updateImpactCam(t, 1 / 30).pose, null, "open at once on the actual landing");
  run(HOLD_MS - 300);
  assert.equal(impactState().open, true);
  run(600);
  assert.equal(impactState().open, false);
});

test("a shell's burst, or a shot leaving the frame, is its landing", () => {
  const coef: FlightCoef = { drag: 0, magnus: 0, gravity: 1 };
  shotFired(2, 1, FROM, coef, null);
  cast = () => ({ index: 20, x: 0, y: 0, z: 100, stone: -1, nx: 0, ny: 1, nz: 0 });
  shotSeen(2, 0, 6, 0, 0, 0, 30, { x: 0, z: 0 }, 1);
  t += 500;
  shotBurst(0, 4, 3);
  assert.equal(impactState().msToLanding, 0, "burst near where it was last seen");
  closeImpactCam();
  shotFired(3, 1, FROM, coef, null);
  shotSeen(3, 0, 20, 0, 0, 0, 30, { x: 0, z: 0 }, 1);
  shotsGone(new Set());
  assert.equal(impactState().msToLanding, 0, "gone from the frame: down where it was last seen");
});

test("path time to a hit counts two ticks per path point", () => {
  const path = new Float32Array([0, 0, 0, 0, 0, 10, 0, 0, 20]);
  const hit = { index: 1, x: 0, y: 0, z: 15, stone: -1, nx: 0, ny: 1, nz: 0 };
  assert.ok(Math.abs(pathTime(path, hit) - (1.5 * 2) / 60) < 1e-9);
});
