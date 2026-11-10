import { test } from "node:test";
import assert from "node:assert/strict";
import type { FrameData } from "@keepfall/sim";
import { CLIP_AFTER, CLIP_BEFORE, CLIP_MAX, FILM_LINE, KEY_EVERY, REEL_CAP, REEL_CLIPS, RING_CAP, RING_SECONDS, Recorder, type FrameExtras } from "../src/recorder";
import { keyframeDiff, sameState, eventChance, type RenderKeyframe } from "../src/render/keyframe";
import type { Moment } from "../src/moments";

const MB = 2 ** 20;

/** A synthetic frame of a size: one array of `bytes` bytes. */
function frame(tick: number, bytes = 1000): FrameData {
  return { tick, stones: new Float32Array(Math.floor(bytes / 4)), terrain: [], events: new Float32Array(0), eventCount: 0 } as unknown as FrameData;
}

function rig(keyBytes = 100_000) {
  const taken: number[] = [];
  const rec = new Recorder({
    capture: (tick) => {
      taken.push(tick);
      return { tick, parts: new Map(), last: null, bytes: keyBytes } as RenderKeyframe;
    },
  });
  return { rec, taken };
}

/** Feed frames every `step` ticks from `from` to `to` inclusive. */
function run(rec: Recorder, from: number, to: number, step = 2, bytes = 1000, each?: (t: number) => void) {
  for (let t = from; t <= to; t += step) {
    rec.frame(frame(t, bytes));
    each?.(t);
  }
}

let serial = 0;
function moment(tick: number, score = 150, extra: Partial<Moment> = {}): Moment {
  return { atMs: serial++, tick, x: 0, y: 0, z: 0, kind: "towerDown", team: 1, score, text: "", size: 1, ...extra };
}

test("a keyframe on the first frame, then every 10 s of ticks, taken after the frame is applied", () => {
  const { rec, taken } = rig();
  run(rec, 2, 3000);
  assert.deepEqual(taken, [2, 602, 1202, 1802, 2402]);
  assert.equal(taken[1] - taken[0], KEY_EVERY);
  rec.reset();
  run(rec, 10, 20);
  assert.deepEqual(taken.slice(5), [10], "the first frame after a reset takes one again");
});

test("the ring never spans more than 40 s", () => {
  const { rec } = rig();
  let worst = 0;
  run(rec, 2, 9000, 2, 1000, () => (worst = Math.max(worst, rec.stats().ringSeconds)));
  assert.ok(worst <= RING_SECONDS, `spanned ${worst} s`);
  assert.ok(worst > RING_SECONDS - 0.1, "and does fill it");
  const s = rec.stats();
  assert.ok(s.frames > 1000 && s.frames <= RING_SECONDS * 30 + 1);
  // Keyframes older than the oldest frame are gone.
  assert.ok(s.keyframes <= 5, `${s.keyframes} keyframes`);
});

test("the ring never holds more than 48 MB, keyframes counted, when no clip is pending", () => {
  const { rec } = rig(300_000);
  let worst = 0;
  run(rec, 2, 6000, 2, 1 * MB, () => (worst = Math.max(worst, rec.stats().ringBytes)));
  assert.ok(worst <= RING_CAP, `held ${worst}`);
  assert.ok(worst > RING_CAP - 2 * MB, "and does use the room");
  assert.ok(rec.stats().peakRingBytes <= RING_CAP);
  assert.ok(rec.stats().frames < 50, "about 48 big frames");
});

test("a clip: the window, the keyframe before it, and the frames after the keyframe up to its end", () => {
  const { rec, taken } = rig();
  const got: unknown[] = [];
  rec.onClip((c) => got.push(c));
  run(rec, 2, 3000);
  const m = moment(3000, 150, { first: 2900 });
  rec.moment(m);
  assert.equal(rec.stats().pending, 1);
  assert.equal(rec.reel.length, 0);
  // Pending until a frame reaches its end.
  const to = 3000 + CLIP_AFTER;
  run(rec, 3002, to - 2);
  assert.equal(rec.reel.length, 0, "still pending one frame short");
  run(rec, to, to);
  assert.equal(rec.stats().pending, 0);
  assert.equal(rec.reel.length, 1);
  const c = rec.reel[0];
  assert.equal(got.length, 1);
  assert.equal(c.moment, m);
  assert.equal(c.from, 2900 - CLIP_BEFORE);
  assert.equal(c.to, to);
  assert.equal(c.keyframe.tick, 2402, "the newest keyframe at or before the start");
  assert.ok(taken.includes(c.keyframe.tick));
  assert.equal(c.entries[0].frame.tick, 2402 + 2, "frames after the keyframe");
  assert.equal(c.entries[c.entries.length - 1].frame.tick, to);
  for (let i = 1; i < c.entries.length; i++) assert.equal(c.entries[i].frame.tick, c.entries[i - 1].frame.tick + 2);
  assert.equal(c.bytes, c.keyframe.bytes + c.entries.reduce((n, e) => n + e.bytes, 0));
  assert.equal(rec.clipFor(m), c);
  assert.equal(rec.lastClip(), c);
});

test("a clip is at most 16 s whatever the moment says of when it began; without a start it begins 4 s before its tick", () => {
  const { rec } = rig();
  run(rec, 2, 6000);
  rec.moment(moment(5000, 150, { first: 3000 }));
  rec.moment(moment(5200));
  const [a, b] = [...rec.reel].sort((x, y) => x.moment.tick - y.moment.tick);
  assert.equal(a.to - a.from, CLIP_MAX);
  assert.equal(a.from, 5000 + CLIP_AFTER - CLIP_MAX);
  assert.equal(b.from, 5200 - CLIP_BEFORE);
});

test("a pending clip is closed by flush with the frames there are", () => {
  const { rec } = rig();
  run(rec, 2, 1500);
  rec.moment(moment(1400));
  assert.equal(rec.stats().pending, 1);
  rec.flush();
  assert.equal(rec.stats().pending, 0);
  assert.equal(rec.reel.length, 1);
  const c = rec.reel[0];
  assert.equal(c.entries[c.entries.length - 1].frame.tick, 1500, "as far as the frames go");
  assert.equal(c.keyframe.tick, 602, "the newest keyframe at or before its start (1160)");
});

test("a moment found after its frames have gone by closes at once", () => {
  const { rec } = rig();
  run(rec, 2, 3000);
  rec.moment(moment(2000));
  assert.equal(rec.stats().pending, 0);
  assert.equal(rec.reel.length, 1);
  assert.equal(rec.reel[0].entries[rec.reel[0].entries.length - 1].frame.tick, 2000 + CLIP_AFTER);
});

test("a pending clip pins its keyframe and its frames past the caps; the ring drops back once it closes", () => {
  const { rec } = rig(300_000);
  const big = MB / 2;
  // Calm until the moment (small frames), then half-megabyte frames: the cap holds about 95 of them, the clip wants 300.
  run(rec, 2, 1200, 2);
  rec.moment(moment(1200, 150, { first: 1200 }));
  const wantFrom = 1200 - CLIP_BEFORE;
  let over = 0;
  run(rec, 1202, 1200 + CLIP_AFTER - 2, 2, big, () => (over = Math.max(over, rec.stats().ringBytes)));
  assert.ok(over > RING_CAP, "pinned past the cap");
  assert.equal(rec.reel.length, 0);
  run(rec, 1200 + CLIP_AFTER, 1200 + CLIP_AFTER, 2, big);
  const c = rec.reel[0];
  assert.ok(c.keyframe.tick <= wantFrom);
  assert.equal(c.entries[0].frame.tick, c.keyframe.tick + 2, "no gap after the keyframe");
  for (let i = 1; i < c.entries.length; i++) assert.equal(c.entries[i].frame.tick, c.entries[i - 1].frame.tick + 2);
  assert.equal(c.entries[c.entries.length - 1].frame.tick, 1200 + CLIP_AFTER);
  run(rec, 1200 + CLIP_AFTER + 2, 1200 + CLIP_AFTER + 20, 2, big);
  assert.ok(rec.stats().ringBytes <= RING_CAP, "back under the cap");
});

test("a moment under the film's line makes no clip; nor does one with no tick", () => {
  const { rec } = rig();
  run(rec, 2, 1500);
  rec.moment(moment(1000, FILM_LINE - 1));
  rec.moment(moment(Number.NaN, 500));
  rec.moment(moment(Infinity, 500));
  assert.equal(rec.stats().pending, 0);
  run(rec, 1502, 2000);
  assert.equal(rec.reel.length, 0);
  assert.equal(rec.lastClip(), null);
  rec.moment(moment(1000, FILM_LINE));
  assert.equal(rec.reel.length, 1, "a score at the line counts");
});

test("the reel keeps at most 8 clips and drops the lowest score; of equal scores the older goes first", () => {
  const { rec } = rig();
  run(rec, 2, 9000);
  const scores = [300, 120, 500, 150, 200, 110, 400, 250, 600, 130, 105];
  scores.forEach((s, i) => rec.moment(moment(7000 + i * 100, s)));
  assert.equal(rec.stats().pending, 0, "all in the ring's past: closed at once");
  assert.equal(rec.reel.length, REEL_CLIPS);
  assert.deepEqual(rec.reel.map((c) => c.moment.score), [600, 500, 400, 300, 250, 200, 150, 130], "best first, the lowest three gone");
  // A new one under all of them is the one dropped.
  rec.moment(moment(8300, FILM_LINE));
  assert.equal(rec.reel.length, REEL_CLIPS);
  assert.ok(!rec.reel.some((c) => c.moment.score === FILM_LINE));
  // A tie with the lowest: the older moment goes, the newer stays.
  const a = moment(8400, 130), b = moment(8500, 130);
  rec.moment(a);
  assert.ok(rec.reel.some((c) => c.moment === a));
  assert.ok(!rec.reel.some((c) => c.moment.tick === 7900), "the older of the two 130s went");
  rec.moment(b);
  assert.ok(rec.reel.some((c) => c.moment === b));
  assert.ok(!rec.reel.some((c) => c.moment === a));
  assert.equal(rec.reel.length, REEL_CLIPS);
});

test("the reel never passes 120 MB", () => {
  const { rec } = rig(300_000);
  // 0.6 MB frames a third of a second apart: a clip is about 18 MB, so six fill the reel.
  let n = 0, worst = 0;
  run(rec, 20, 40_000, 20, 0.6 * MB, (t) => {
    if (t % 2000 !== 0) return;
    rec.moment(moment(t - 400, 200 + n++));
    worst = Math.max(worst, rec.stats().reelBytes);
    assert.ok(rec.stats().reelBytes <= REEL_CAP, `reel ${rec.stats().reelBytes}`);
  });
  assert.ok(n >= 19);
  assert.ok(worst > REEL_CAP * 0.8, `the cap did bind (${worst})`);
  assert.ok(rec.reel.length < REEL_CLIPS && rec.reel.length >= 4, `${rec.reel.length} clips`);
  const scores = rec.reel.map((c) => c.moment.score);
  assert.deepEqual(scores, [...scores].sort((x, y) => y - x), "best first");
});

test("a clip too big for the reel by itself is not kept", () => {
  const { rec } = rig(1000);
  // Small frames until the moment, then 70 MB ones (zeroed pages cost nothing): the clip is about 140 MB.
  run(rec, 2, 400, 2);
  rec.moment(moment(300, 150, { first: 300 }));
  run(rec, 500, 800, 100, 70 * MB);
  rec.flush();
  assert.equal(rec.reel.length, 0);
  assert.equal(rec.stats().reelBytes, 0);
  assert.equal(rec.lastClip()?.moment.tick, 300, "though the last clip is still handed out for a replay");
});

test("a frame's extras, noted at receipt, ride with its entry and its keyframe", () => {
  const { rec } = rig();
  const ex = (n: number): FrameExtras => ({ guns: new Float32Array([n, n]), out: new Int16Array([n]), storm: [n, 0, 0, 0], bridges: [true], arms: new Int8Array([n]) });
  const f1 = frame(2), f2 = frame(4);
  rec.note(f1, ex(1));
  rec.note(f2, ex(2));
  rec.frame(f1);
  rec.frame(f2);
  rec.moment(moment(4));
  rec.flush();
  const c = rec.reel[0];
  assert.equal(c.keyframe.extras.guns![0], 1, "the keyframe has the extras of the frame it was taken at");
  assert.equal(c.entries[0].extras.guns![0], 2);
  assert.equal(c.entries[0].extras.storm![0], 2);
  // A frame never noted has none.
  rec.frame(frame(6));
  rec.moment(moment(6));
  rec.flush();
  const last = rec.reel.find((x) => x.moment.tick === 6)!;
  assert.equal(last.entries[last.entries.length - 1].extras.guns, null);
  // Bytes include the extras and the frame's arrays.
  assert.ok(c.entries[0].bytes >= 1000 + 8 + 2 + 1);
});

test("reset empties everything, the reel and pending clips too", () => {
  const { rec } = rig();
  run(rec, 2, 3000);
  rec.moment(moment(1000));
  rec.moment(moment(3000));
  assert.equal(rec.reel.length, 1);
  assert.equal(rec.stats().pending, 1);
  rec.reset();
  const s = rec.stats();
  assert.equal(rec.reel.length, 0);
  assert.equal(rec.lastClip(), null);
  assert.deepEqual([s.frames, s.keyframes, s.ringBytes, s.reelBytes, s.clips, s.pending, s.peakRingBytes], [0, 0, 0, 0, 0, 0, 0]);
  run(rec, 2, 2 + CLIP_AFTER + 10);
  assert.equal(rec.reel.length, 0, "the pending clip of the old world did not come back");
});

test("frames whose ticks run backwards are a new world: the ring starts again", () => {
  const { rec } = rig();
  run(rec, 2, 2000);
  run(rec, 2, 100);
  const s = rec.stats();
  assert.equal(s.keyframes, 1);
  assert.ok(s.ringSeconds < 2);
});

test("keyframe states compare by value: Float32 arrays exactly, ages within a millisecond or two", () => {
  const a: RenderKeyframe = { tick: 1, parts: new Map<string, unknown>([["stones", { moved: new Float32Array([1, 2, 3]) }], ["decals", { age: new Float64Array([1.5, 2.5]), n: 3 }]]), last: null, bytes: 0 };
  const same: RenderKeyframe = { tick: 1, parts: new Map<string, unknown>([["decals", { age: new Float64Array([1.5 + 1e-5, 2.5]), n: 3 }], ["stones", { moved: new Float32Array([1, 2, 3]) }]]), last: null, bytes: 0 };
  assert.deepEqual(keyframeDiff(a, same), []);
  const off: RenderKeyframe = { tick: 1, parts: new Map<string, unknown>([["stones", { moved: new Float32Array([1, 2, 3.0001]) }], ["decals", { age: new Float64Array([1.5, 2.6]), n: 3 }]]), last: null, bytes: 0 };
  assert.deepEqual(keyframeDiff(a, off).sort(), ["decals", "stones"]);
  assert.equal(sameState(new Map([[1, 2]]), new Map([[1, 3]])), false);
  assert.equal(sameState([1, { a: 2 }], [1, { a: 2 }]), true);
  assert.deepEqual(keyframeDiff(a, { ...a, parts: new Map([["stones", {}]]) }), ["stones", "decals"]);
});

test("a chance drawn from an event's tick and place is the same each time and spreads over 0 to 1", () => {
  assert.equal(eventChance(100, 1.5, 2, -3), eventChance(100, 1.5, 2, -3));
  assert.notEqual(eventChance(100, 1.5, 2, -3), eventChance(101, 1.5, 2, -3));
  assert.notEqual(eventChance(100, 1.5, 2, -3), eventChance(100, 1.6, 2, -3));
  let lo = 1, hi = 0, sum = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const r = eventChance(i * 3, (i % 17) * 1.3, (i % 5) * 0.7, -(i % 11) * 2.1);
    assert.ok(r >= 0 && r < 1);
    lo = Math.min(lo, r);
    hi = Math.max(hi, r);
    sum += r;
  }
  assert.ok(lo < 0.05 && hi > 0.95);
  assert.ok(Math.abs(sum / n - 0.5) < 0.05);
});
