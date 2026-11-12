// Look round L1: the gun's kick, its reload stage, the powder box's kegs and the camera's jolt (logic without three).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOX_KEGS, MORTAR_DIP, MORTAR_TIME, RECOIL_BACK, SWIVEL_TIME, kegCount, kick, newStage, stageFeed, stageFire, stageStep } from "../src/render/recoilLogic";
import { JOLT, JOLT_END, JOLT_PITCH_MAX, joltAt, joltEnvelope } from "../src/render/recoilCam";
import type { WeaponKind } from "@keepfall/content";

const KINDS: WeaponKind[] = ["longGun", "chainShot", "mortar", "swivel"];

// --- the kick ---------------------------------------------------------------------------------

test("a long gun leaps back in 0.07 s, stays back while loading and is run out between stage 0.75 and 0.92", () => {
  assert.equal(kick("longGun", 0, 0).back, 0);
  assert.ok(Math.abs(kick("longGun", 0.07, 0).back - 0.55) < 1e-9);
  assert.ok(kick("longGun", 0.03, 0).back > 0.3 && kick("longGun", 0.03, 0).back < 0.55);
  assert.ok(Math.abs(kick("longGun", 2, 0.5).back - 0.55) < 1e-9, "still back at half the reload");
  assert.ok(Math.abs(kick("longGun", 3, 0.75).back - 0.55) < 1e-9, "run out begins at 0.75");
  const mid = kick("longGun", 3, 0.835).back;
  assert.ok(mid > 0.1 && mid < 0.45, "half run out");
  assert.equal(kick("longGun", 3.8, 0.92).back, 0);
  assert.equal(kick("longGun", 5, 1).back, 0);
  assert.ok(Math.abs(kick("chainShot", 1, 0.2).back - 0.6) < 1e-9);
});

test("a gun that never fired sits run out (age Infinity, stage 1)", () => {
  for (const k of KINDS) {
    const r = kick(k, Infinity, 1);
    assert.deepEqual([r.back, r.down, r.pitch], [0, 0, 0], k);
  }
});

test("the mortar's bed thuds down and comes back by 0.25 s; the swivel springs back by 0.2 s and is never run out", () => {
  let peak = 0;
  for (let t = 0; t < MORTAR_TIME; t += 0.005) peak = Math.max(peak, kick("mortar", t, 0).down);
  assert.ok(Math.abs(peak - MORTAR_DIP) < 1e-3);
  assert.equal(kick("mortar", MORTAR_TIME, 0).down, 0);
  assert.equal(kick("mortar", MORTAR_TIME, 0).pitch, 0);
  assert.ok(kick("mortar", 0.05, 0).pitch > 0);
  assert.equal(kick("mortar", 0.05, 0).back, 0);
  let sp = 0;
  for (let t = 0; t < SWIVEL_TIME; t += 0.005) sp = Math.max(sp, kick("swivel", t, 0.5).back);
  assert.ok(Math.abs(sp - RECOIL_BACK.swivel) < 2e-3);
  assert.equal(kick("swivel", SWIVEL_TIME, 0).back, 0);
  assert.equal(kick("swivel", 0.1, 0).down, 0);
});

// --- the reload stage ----------------------------------------------------------------------------

test("stage: a gun never fired is loaded; a shot starts it at 0; a feed gives the stage and the full time", () => {
  const s = newStage();
  assert.equal(s.stage, 1);
  assert.equal(s.age, Infinity);
  stageFire(s, 240);
  assert.equal(s.stage, 0);
  assert.equal(s.age, 0);
  stageFeed(s, 240);
  assert.equal(s.stage, 0);
  stageFeed(s, 120);
  assert.ok(Math.abs(s.stage - 0.5) < 1e-9);
  stageFeed(s, 0);
  assert.equal(s.stage, 1);
});

test("stage: a feed with more ticks left than the guess widens the full time (an upgrade or a slower gun)", () => {
  const s = newStage();
  stageFire(s, 120);
  stageFeed(s, 300);
  assert.equal(s.full, 300);
  assert.equal(s.stage, 0);
  stageFeed(s, 150);
  assert.ok(Math.abs(s.stage - 0.5) < 1e-9);
});

test("stage: between feeds it advances with the renderer's clock, but only a frame or two past the last feed", () => {
  const s = newStage();
  stageFire(s, 240);
  // No feed yet since the shot (a replay without reload numbers): the clock alone carries it, 4 s to loaded.
  for (let i = 0; i < 120; i++) stageStep(s, 1 / 60);
  assert.ok(Math.abs(s.stage - 0.5) < 0.01);
  const t = newStage();
  stageFire(t, 240);
  stageFeed(t, 200);
  const fed = t.stage;
  for (let i = 0; i < 60; i++) stageStep(t, 1 / 60);
  assert.ok(t.stage <= fed + 2 / 240 + 1e-9, "held to the feed plus two ticks");
  assert.ok(t.stage > fed, "but it does move");
  stageFeed(t, 100);
  assert.ok(Math.abs(t.stage - 140 / 240) < 1e-9, "a new feed carries it on");
});

test("stage: slow motion slows it; it never goes backwards except on a new shot", () => {
  const a = newStage(), b = newStage();
  stageFire(a, 240);
  stageFire(b, 240);
  for (let i = 0; i < 60; i++) {
    stageStep(a, 1 / 60);
    stageStep(b, 1 / 600);
  }
  assert.ok(Math.abs(a.stage - 0.25) < 0.01);
  assert.ok(Math.abs(b.stage - 0.025) < 0.002);
  stageFeed(a, 100);
  const high = a.stage;
  stageFeed(a, 200); // a stale, older feed
  assert.equal(a.stage, high);
  stageStep(a, 0);
  assert.equal(a.stage, high);
  stageFire(a, 240);
  assert.equal(a.stage, 0);
  assert.equal(a.age, 0);
});

test("stage: a loaded gun told it has ticks left (a shot not yet drawn) is left alone until its Muzzle event", () => {
  const s = newStage();
  stageFeed(s, 240);
  assert.equal(s.stage, 1);
  stageStep(s, 1 / 60);
  assert.equal(s.stage, 1);
});

// --- the powder box ------------------------------------------------------------------------------

test("kegs: none at 0 charges, a keg for any charge, four when full", () => {
  assert.equal(kegCount(0, 8), 0);
  assert.equal(kegCount(-1, 8), 0);
  assert.equal(kegCount(1, 8), 1);
  assert.equal(kegCount(2, 8), 1);
  assert.equal(kegCount(3, 8), 2);
  assert.equal(kegCount(4, 8), 2);
  assert.equal(kegCount(5, 8), 3);
  assert.equal(kegCount(6, 8), 3);
  assert.equal(kegCount(7, 8), 4);
  assert.equal(kegCount(8, 8), 4);
  assert.equal(kegCount(20, 8), BOX_KEGS, "never more than four");
  assert.equal(kegCount(3, 0), BOX_KEGS, "no capacity known: full");
});

// --- the camera's jolt ---------------------------------------------------------------------------

test("jolt envelope: zero before and from 0.45 s on, one at its peak, continuous", () => {
  assert.equal(joltEnvelope(-1), 0);
  assert.equal(joltEnvelope(0), 0);
  assert.equal(joltEnvelope(JOLT_END), 0);
  assert.equal(joltEnvelope(0.45), 0);
  assert.equal(joltEnvelope(2), 0);
  assert.equal(joltEnvelope(Infinity), 0);
  assert.ok(Math.abs(joltEnvelope(0.035) - 1) < 1e-9);
  let peak = 0, prev = 0;
  for (let t = 0; t <= 0.5; t += 0.001) {
    const e = joltEnvelope(t);
    assert.ok(e >= 0 && e <= 1 + 1e-9, `t=${t}`);
    assert.ok(Math.abs(e - prev) < 0.12, `no jump at ${t}`);
    prev = e;
    peak = Math.max(peak, e);
  }
  assert.ok(Math.abs(peak - 1) < 1e-3);
  assert.ok(joltEnvelope(0.44) < 0.01, "almost gone just before the end");
  // Rises in about 0.035 s, decays with a time constant of about 0.11 s.
  assert.ok(joltEnvelope(0.035 + 0.11) < 0.4 && joltEnvelope(0.035 + 0.11) > 0.33);
});

test("jolt: each weapon's peak is its table's, no pitch is above 1.5 degrees, and it is gone at 0.45 s", () => {
  for (const k of KINDS) {
    const mode = k === "mortar" ? "free" : "sight";
    let back = 0, up = 0, pitch = 0, fov = 0;
    for (let t = 0; t < 1; t += 0.001) {
      const j = joltAt(k, mode, t);
      back = Math.max(back, j.back);
      up = Math.max(up, j.up);
      pitch = Math.max(pitch, j.pitch);
      fov = Math.max(fov, j.fov);
      if (t >= 0.45) assert.deepEqual([j.back, j.up, j.pitch, j.fov], [0, 0, 0, 0], `${k} at ${t}`);
    }
    assert.ok(back <= JOLT[k].back + 1e-9 && back >= JOLT[k].back - 1e-3, `${k} back`);
    assert.ok(up <= JOLT[k].up + 1e-9 && up >= JOLT[k].up - 1e-3, `${k} up`);
    assert.ok(fov <= JOLT[k].fov + 1e-9 && fov >= JOLT[k].fov - 1e-2, `${k} fov`);
    assert.ok(pitch * (180 / Math.PI) <= JOLT_PITCH_MAX, `${k} pitch ${pitch}`);
    assert.ok(pitch * (180 / Math.PI) <= JOLT[k].pitch + 1e-9, `${k} pitch is the table's`);
  }
  assert.equal(JOLT.mortar.back, 0, "the spotter never moves back");
  assert.equal(JOLT.mortar.fov, 1.5);
  assert.equal(JOLT.swivel.fov, 1);
  assert.ok(JOLT.chainShot.back > JOLT.longGun.back && JOLT.longGun.back > JOLT.swivel.back, "by the gun's weight");
});

test("jolt: a sight camera gets nothing for the mortar and a free camera nothing for the others", () => {
  assert.equal(joltAt("mortar", "sight", 0.05).fov, 0);
  assert.equal(joltAt("longGun", "free", 0.05).fov, 0);
  assert.ok(joltAt("mortar", "free", 0.05).fov > 0);
  assert.ok(joltAt("longGun", "sight", 0.05).fov > 0);
});

test("jolt: the shortest reload (the swivel's 2 s) is long after the kick has gone", () => {
  assert.ok(2 > JOLT_END * 4);
  for (const k of KINDS) {
    const j = joltAt(k, k === "mortar" ? "free" : "sight", 2);
    assert.equal(j.fov + j.back + j.up + j.pitch, 0);
  }
});
