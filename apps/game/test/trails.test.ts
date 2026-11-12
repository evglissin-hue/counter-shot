import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BALL_FADE,
  BALL_LIFE,
  BALL_PATH,
  MAX_POINTS,
  MAX_SEGMENTS,
  MAX_SHOTS,
  SHELL_PATH,
  TrailSet,
} from "../src/render/trailLogic";
import { glassFromFov, zoomShare } from "../src/render/glassLogic";

const BALL = 0, SHELL = 1, CHAIN = 2, GRAPE = 3;
const bufs = () => [new Float32Array(MAX_SEGMENTS * 4), new Float32Array(MAX_SEGMENTS * 4), new Float32Array(MAX_SEGMENTS * 4)] as const;

/** Feed one shot flying along +z at `speed` m/s for `seconds`, one frame every `dt`, ending with a fill at the last clock. */
function fly(set: TrailSet, id: number, kind: number, speed: number, seconds: number, dt = 1 / 60, t0 = 0) {
  let t = t0;
  const end = t0 + seconds;
  for (; t <= end + 1e-9; t += dt) {
    set.add(id, kind, 0, 10, (t - t0) * speed, t);
  }
  return t - dt;
}

test("a round shot's trail grows frame by frame and is the last 0.06 s of its path", () => {
  const set = new TrailSet();
  const [A, B, C] = bufs();
  const now = fly(set, 7, BALL, 100, 0.2);
  assert.ok(set.has(7));
  const n = set.fill(now, 0, 0, A, B, C);
  assert.ok(n >= 3 && n <= 6, `about 4 frames of path, got ${n}`);
  // The streak's head is the ball and its length is 0.06 s of path (6 m at 100 m/s).
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minZ = Math.min(minZ, A[i * 4 + 2], B[i * 4 + 2]);
    maxZ = Math.max(maxZ, A[i * 4 + 2], B[i * 4 + 2]);
  }
  assert.ok(Math.abs(maxZ - 100 * 0.2) < 1e-3, "the head sits at the ball");
  assert.ok(Math.abs(maxZ - minZ - 100 * BALL_PATH) < 1e-2, `length ${maxZ - minZ}`);
  // It tapers: the oldest end is thin and clear, the head full width.
  const last = n - 1;
  assert.ok(B[last * 4 + 3] > 0.99 && C[last * 4 + 1] > C[0] , "head full, tail clear");
  assert.ok(A[3] < 0.05 && C[0] < 0.02, "the old end tapers to nothing");
  assert.equal(C[2], 0, "ball kind");
});

test("a ball's streak lasts half a second, fading over the last 0.15 s", () => {
  const set = new TrailSet();
  const [A, B, C] = bufs();
  const peak = (now: number) => {
    const n = set.fill(now, 0, 0, A, B, C);
    let p = 0;
    for (let i = 0; i < n; i++) p = Math.max(p, C[i * 4 + 1]);
    return { n, p };
  };
  fly(set, 1, BALL, 80, 0.3);
  const mid = peak(0.3);
  assert.ok(mid.n > 0 && mid.p > 0.3, "full at 0.3 s");
  fly(set, 1, BALL, 80, BALL_LIFE - BALL_FADE / 2);
  const fading = peak(BALL_LIFE - BALL_FADE / 2);
  assert.ok(fading.p > 0 && fading.p < mid.p * 0.6, `half faded at 0.425 s: ${fading.p} vs ${mid.p}`);
  fly(set, 1, BALL, 80, BALL_LIFE + 0.02);
  assert.equal(peak(BALL_LIFE + 0.02).n, 0, "gone after half a second");
  // The shot is still in the air: it keeps its slot (and does not start a fresh trail), but remembers nothing more.
  assert.ok(set.has(1));
  const before = set.points(1);
  fly(set, 1, BALL, 80, 1.0);
  assert.equal(set.points(1), before);
});

test("chain-shot balls have trails like round shot; grape has none", () => {
  const set = new TrailSet();
  fly(set, 1, CHAIN, 60, 0.1);
  fly(set, 2, GRAPE, 60, 0.1);
  assert.ok(set.has(1));
  assert.ok(!set.has(2));
  assert.equal(set.live, 1);
});

test("a shell keeps a thread along the last 1.5 s of its path, thinning and fading with age", () => {
  const set = new TrailSet();
  const [A, B, C] = bufs();
  const now = fly(set, 3, SHELL, 40, 4, 1 / 30);
  const n = set.fill(now, 0, 0, A, B, C);
  assert.ok(n >= 10, `plenty of segments: ${n}`);
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minZ = Math.min(minZ, A[i * 4 + 2] - 0.15 * 0, B[i * 4 + 2]);
    maxZ = Math.max(maxZ, B[i * 4 + 2]);
    assert.equal(C[i * 4 + 2], 1, "shell kind");
  }
  assert.ok(Math.abs(maxZ - minZ - 40 * SHELL_PATH) < 0.1, `length ${maxZ - minZ}`);
  // Oldest segment: thinner and fainter than the newest.
  assert.ok(A[3] < B[(n - 1) * 4 + 3]);
  assert.ok(C[0] < C[(n - 1) * 4 + 1]);
  assert.ok(C[0] < 0.02, "clear at the far end");
  // It still holds all its points at most.
  assert.ok(set.points(3) <= MAX_POINTS);
});

test("a shell's thread drifts with the wind and rises, more the older it is", () => {
  const set = new TrailSet();
  const [A, B, C] = bufs();
  const now = fly(set, 3, SHELL, 40, 3, 1 / 30);
  const n0 = set.fill(now, 0, 0, A, B, C);
  const old0 = [A[0], A[1], A[2]], new0 = [B[(n0 - 1) * 4], B[(n0 - 1) * 4 + 1]];
  const n1 = set.fill(now, 8, 0, A, B, C);
  assert.equal(n1, n0);
  assert.ok(A[0] - old0[0] > 1, "the old end has drifted downwind");
  assert.equal(B[(n1 - 1) * 4], new0[0], "the head has not");
  assert.ok(A[1] > 10.1, "and risen");
});

test("a shell's thread comes in over its first moments", () => {
  const set = new TrailSet();
  const [A, B, C] = bufs();
  const now = fly(set, 3, SHELL, 40, 0.05, 1 / 60);
  const n = set.fill(now, 0, 0, A, B, C);
  let p = 0;
  for (let i = 0; i < n; i++) p = Math.max(p, C[i * 4 + 1]);
  assert.ok(p < 0.5 * 0.5, `faint at first: ${p}`);
});

test("a shot that vanishes takes its trail with it; another keeps its own", () => {
  const set = new TrailSet();
  const [A, B, C] = bufs();
  for (let k = 0; k < 10; k++) {
    set.begin();
    set.add(1, BALL, 0, 5, k, k / 60);
    set.add(2, BALL, 4, 5, k, k / 60);
    set.end();
  }
  assert.equal(set.live, 2);
  set.begin();
  set.add(2, BALL, 4, 5, 10, 10 / 60);
  set.end();
  assert.ok(!set.has(1) && set.has(2));
  assert.equal(set.live, 1);
  assert.ok(set.fill(10 / 60, 0, 0, A, B, C) > 0);
  // A shot with the same id later starts afresh.
  set.begin();
  set.add(1, BALL, 0, 5, 0, 1);
  set.end();
  set.begin();
  set.end();
  assert.equal(set.live, 0);
});

test("frozen frames (the same clock) add no points; a full ring drops the oldest", () => {
  const set = new TrailSet();
  for (let k = 0; k < 5; k++) {
    set.begin();
    set.add(1, SHELL, 0, 5, k, 1);
    set.end();
  }
  assert.equal(set.points(1), 1);
  for (let k = 0; k < 100; k++) {
    set.begin();
    set.add(1, SHELL, 0, 5, k, 1 + k * 0.1);
    set.end();
  }
  assert.equal(set.points(1), MAX_POINTS);
});

test("at most 64 shots keep a trail", () => {
  const set = new TrailSet();
  set.begin();
  for (let i = 0; i < 100; i++) set.add(i, SHELL, i, 5, 0, 0);
  set.end();
  assert.equal(set.live, MAX_SHOTS);
});

test("capture then apply then capture gives equal states, at the same or a later clock", () => {
  const set = new TrailSet();
  fly(set, 1, BALL, 90, 0.3, 1 / 30, 20);
  fly(set, 2, SHELL, 40, 2.5, 1 / 30, 19);
  const now = 21.7;
  const a = set.capture(now);
  const other = new TrailSet();
  other.apply(a, now);
  const b = other.capture(now);
  assert.deepEqual(Array.from(b), Array.from(a));
  // Put back at a later clock the ages are kept: the same picture.
  const later = new TrailSet();
  later.apply(a, 500);
  assert.deepEqual(Array.from(later.capture(500)), Array.from(a));
  const [A1, B1, C1] = bufs(), [A2, B2, C2] = bufs();
  const n1 = set.fill(now, 3, 1, A1, B1, C1);
  const n2 = later.fill(500, 3, 1, A2, B2, C2);
  assert.equal(n2, n1);
  // Ages are kept as float32, so the picture matches to far less than a pixel.
  for (let i = 0; i < n1 * 4; i++) {
    assert.ok(Math.abs(A2[i] - A1[i]) < 1e-4 && Math.abs(B2[i] - B1[i]) < 1e-4 && Math.abs(C2[i] - C1[i]) < 1e-5, `float ${i}`);
  }
});

test("a shot seen again after a keyframe is put back continues its trail", () => {
  const set = new TrailSet();
  const t = fly(set, 5, SHELL, 40, 1, 1 / 30);
  const saved = set.capture(t);
  const fresh = new TrailSet();
  fresh.apply(saved, t);
  const had = fresh.points(5);
  assert.ok(had > 5);
  fresh.begin();
  fresh.add(5, SHELL, 0, 10, 40 + 1, t + 0.1);
  fresh.end();
  assert.equal(fresh.points(5), had + 1, "one more point, not a new trail");
  // A shot the keyframe did not hold is new.
  fresh.begin();
  fresh.add(9, SHELL, 0, 10, 0, t + 0.1);
  fresh.add(5, SHELL, 0, 10, 40 + 2, t + 0.2);
  fresh.end();
  assert.equal(fresh.points(9), 1);
  // A keyframe applied empties what was there.
  fresh.apply(new TrailSet().capture(0), 0);
  assert.equal(fresh.live, 0);
});

test("the clock going back forgets the points ahead of it", () => {
  const set = new TrailSet();
  fly(set, 1, SHELL, 40, 2, 1 / 30, 10);
  set.begin();
  set.add(1, SHELL, 0, 10, 5, 8);
  set.end();
  assert.equal(set.points(1), 1);
});

test("the glass: none at the default zoom, whole at the narrowest field of view", () => {
  // A long gun's range as in content: the default view is 0.8 of the widest.
  const min = 12, max = 40;
  assert.equal(glassFromFov(max * 0.8, min, max), 0, "default zoom");
  assert.equal(glassFromFov(max, min, max), 0);
  assert.equal(glassFromFov(min, min, max), 1, "Z held");
  assert.ok(zoomShare(min, min, max) === 1 && zoomShare(max, min, max) === 0);
  // Smooth in between, from 0.55 to 0.9 of the zoom.
  const at = (z: number) => glassFromFov(max - z * (max - min), min, max);
  assert.ok(at(0.55) < 1e-9);
  assert.ok(Math.abs(at(0.725) - 0.5) < 1e-9);
  assert.ok(at(0.9) > 1 - 1e-9);
  assert.ok(at(0.7) < at(0.8));
  // A fov outside the range, or a range with no width, is safe.
  assert.equal(glassFromFov(min - 5, min, max), 1);
  assert.equal(glassFromFov(max + 5, min, max), 0);
  assert.equal(glassFromFov(20, 20, 20), 0);
});
