import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, GAME_LAYOUT, CRANE } from "@keepfall/content";
import { WORKS_STRIDE } from "@keepfall/sim";
import { bellAmplitude, bellAngle, BELL_SWING, displaced, drawnByOrgans, masonsWorkHigh, organIds, streamOf, streamerAt } from "../src/render/organsLogic";

const layout = buildLayout(1, GAME_LAYOUT);

test("each castle's bell box, treadwheel, jib and yard are found, and only the box and the wheel are drawn apart", () => {
  const ids = organIds(layout);
  for (const c of [0, 1] as const) {
    const o = ids[c];
    assert.ok(o.bell >= 0 && o.wheel >= 0 && o.jib >= 0 && o.yard >= 0, `castle ${c} has all four`);
    assert.equal(layout.stones[o.bell].material, "iron");
    assert.equal(layout.stones[o.bell].castle, c);
    assert.ok(layout.stones[o.wheel].hy > 1 && layout.stones[o.wheel].material === "wood");
    assert.equal(layout.stones[o.jib].organ, 1, "the jib belongs to the crane");
    assert.equal(layout.stones[o.yard].organ, 2, "the yard belongs to the mast");
  }
  const apart = drawnByOrgans(layout);
  assert.equal(apart.length, 4);
  for (const id of apart) assert.ok(!ids.some((o) => o.jib === id || o.yard === id));
});

test("the lab's layout has no organs and nothing is drawn apart", () => {
  const lab = buildLayout(1, {});
  assert.deepEqual(drawnByOrgans(lab), []);
});

test("a bell eases into its swing in 0.4 s, out in 1.5 s, and a still bell does not swing", () => {
  let a = 0;
  for (let i = 0; i < 12; i++) a = bellAmplitude(a, 2, 0.04);
  assert.ok(a > 0.9 && a <= 1, `rung up to ${a}`);
  let b = 1;
  for (let i = 0; i < 12; i++) b = bellAmplitude(b, -1, 0.04);
  assert.ok(b > 0.5 && b < 1, `still easing out after 0.48 s: ${b}`);
  for (let i = 0; i < 40; i++) b = bellAmplitude(b, -1, 0.04);
  assert.equal(b, 0);
  for (let t = 0; t < 3; t += 0.1) assert.ok(Math.abs(bellAngle(0, t)) === 0);
  let top = 0;
  for (let t = 0; t < 3; t += 0.01) top = Math.max(top, Math.abs(bellAngle(1, t)));
  assert.ok(top > BELL_SWING * 0.98 && top <= BELL_SWING);
});

test("masons work high when a repair's stone has its foot at 4 m or over, and only for that castle", () => {
  const low = layout.stones.find((s) => s.castle === 0 && s.part === "wall" && s.y - s.hy < CRANE.low - 0.5)!;
  const high = layout.stones.find((s) => s.castle === 1 && s.part === "wall" && s.y - s.hy >= CRANE.low + 0.5)!;
  const works = new Float32Array(WORKS_STRIDE * 2);
  works.set([0, 0, 0, 0, 0, 0, low.id, 3], 0);
  works.set([1, 0, 0, 0, 0, 0, high.id, 3], WORKS_STRIDE);
  assert.deepEqual(masonsWorkHigh(layout, works, 2), [false, true]);
  assert.deepEqual(masonsWorkHigh(layout, works, 1), [false, false], "only the entries counted");
  assert.deepEqual(masonsWorkHigh(layout, works, 0), [false, false]);
});

test("a piece is displaced when it has fallen or is withdrawn, not when it sits", () => {
  const home = { x: 3, y: 5, z: 7 };
  assert.equal(displaced(home, 3, 5, 7), false);
  assert.equal(displaced(home, 3.1, 5.1, 7), false);
  assert.equal(displaced(home, 3, 2, 7), true);
  assert.equal(displaced(home, 3, -1000, 7), true);
});

test("cloth streams further out in more wind, hangs slack in a calm and stays finite", () => {
  assert.ok(streamOf(0) < streamOf(3) && streamOf(3) < streamOf(9));
  assert.equal(streamOf(20), 1);
  const calm = streamerAt(1, 0, 2.7, streamOf(0));
  const blow = streamerAt(1, 0, 2.7, streamOf(9));
  assert.ok(blow.along > calm.along * 1.5, `${blow.along} against ${calm.along}`);
  assert.ok(calm.drop > blow.drop, "slack cloth hangs lower");
  for (let t = 0; t < 10; t += 0.37) for (let u = 0; u <= 1; u += 0.1) for (const s of [0.1, 1]) {
    const p = streamerAt(u, t, 2.7, s);
    assert.ok(Number.isFinite(p.along) && Number.isFinite(p.side) && Number.isFinite(p.drop));
  }
  const root = streamerAt(0, 3, 2.7, 1);
  assert.ok(Math.abs(root.along) + Math.abs(root.side) + Math.abs(root.drop) === 0, "fast at the pole");
});
