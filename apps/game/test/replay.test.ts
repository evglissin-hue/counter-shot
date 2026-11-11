import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, GAME_LAYOUT } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, STONE_STRIDE, type FrameData } from "@keepfall/sim";
import type { Take } from "../src/director";
import type { Moment, MomentKind } from "../src/moments";
import type { Clip, FrameExtras, RecEntry } from "../src/recorder";
import type { RenderKeyframe } from "../src/render/keyframe";
import { CLOCK_BASE, LEAD_TICKS, MOMENT_NAMES, ReplayPlayer, quiet, speedLabel, type ReplayHost, type ReplayView } from "../src/replay";

const layout = buildLayout(1, GAME_LAYOUT);
const empty = new Float32Array(0);
const noExtras: FrameExtras = { guns: null, out: null, storm: null, bridges: null, arms: null };

function frame(tick: number, events: number[][] = []): FrameData {
  const ev = new Float32Array(events.length * EVENT_STRIDE);
  events.forEach((e, i) => ev.set(e, i * EVENT_STRIDE));
  const s = layout.stones[100];
  const stones = new Float32Array(STONE_STRIDE);
  stones.set([s.id, s.x + tick * 0.01, s.y, s.z, s.q[0], s.q[1], s.q[2], s.q[3]]);
  return {
    tick, stones, stoneCount: 1, projectiles: empty, projectileCount: 0, chains: empty, chainCount: 0, minions: empty, minionCount: 0,
    parts: empty, partCount: 0, events: ev, eventCount: events.length, terrain: [], windX: 0, windZ: 0,
  } as unknown as FrameData;
}

function keyframe(tick: number, tag: string): RenderKeyframe {
  return { tick, parts: new Map([["tag", tag]]), last: null, bytes: 100 };
}

function clipOf(kind: MomentKind = "towerDown"): Clip {
  const moment: Moment = { atMs: 0, tick: 180, x: 0, y: 0, z: 0, kind, team: 1, score: 200, text: "A tower of 90 stones", size: 1 };
  const entries: RecEntry[] = [];
  for (let t = 102; t <= 300; t += 2) {
    const ev = t === 150 ? [[EventKind.Explosion, 1, 2, 3, 4]] : [];
    entries.push({ frame: frame(t, ev), extras: { ...noExtras, storm: [t / 1000, 0, 0, 0] }, bytes: 10 });
  }
  return { moment, from: 100, to: 300, keyframe: { tick: 100, render: keyframe(100, "clip"), extras: { ...noExtras, out: new Int16Array([0, 0]) }, bytes: 10 }, entries, bytes: 100 };
}

/** A take of ticks 140 to 200: real speed to 170, a quarter speed after. */
function stubTake(): Take {
  return {
    recipe: "stub",
    start: 140,
    end: 200,
    seconds: 5,
    speedAt: (t) => (t < 170 ? 1 : 0.25),
    poseAt: (t) => ({ x: t, y: 5, z: 0, tx: 0, ty: 0, tz: 0, fov: 50 }),
    tickAt: (s) => 140 + s,
  };
}

interface Log {
  calls: string[];
  applied: number[];
  heard: Array<{ tick: number; speed: number; audible: boolean }>;
  cams: number[];
  scales: number[];
  extras: Array<{ full: boolean }>;
}

function rig(opts: { failRender?: number; failPlan?: boolean } = {}) {
  const log: Log = { calls: [], applied: [], heard: [], cams: [], scales: [], extras: [] };
  const live = keyframe(900, "live");
  let renders = 0;
  const host: ReplayHost = {
    layout,
    capture: () => {
      log.calls.push("capture");
      return live;
    },
    apply: (k) => log.calls.push(`apply:${k.parts.get("tag")}`),
    clock: () => 5.5,
    setClock: (t) => log.calls.push(`clock:${t}`),
    applyFrame: (f) => {
      log.calls.push("frame");
      log.applied.push(f.tick);
    },
    setProjectiles: () => {},
    setStones: () => {},
    setCamera: (p) => log.cams.push(p.x),
    render: () => {
      log.calls.push("render");
      if (opts.failRender !== undefined && ++renders === opts.failRender) throw new Error("render broke");
    },
    setTimeScale: (s) => log.scales.push(s),
    sightBlocked: () => false,
    groundAt: () => 0,
    closeInset: () => log.calls.push("closeInset"),
    extras: (_e, full) => log.extras.push({ full }),
    frame: (f, speed, audible) => log.heard.push({ tick: f.tick, speed, audible }),
  };
  const shown: boolean[] = [];
  const view: ReplayView = {
    show: (on) => shown.push(on),
    bars: () => {},
    cover: () => {},
    caption: (n, t) => log.calls.push(`caption:${n}|${t}`),
    speed: () => {},
  };
  const player = new ReplayPlayer(host, view, () => {
    if (opts.failPlan) throw new Error("no take");
    return stubTake();
  });
  return { player, log, shown };
}

const DT = 1 / 30;

test("every kind of moment has a short name, and nothing is empty", () => {
  const kinds: MomentKind[] = ["multiKill", "ricochetKill", "collapseKill", "thrown", "kegChain", "kegBack", "gunSilenced", "buildingWrecked", "gateDown", "breachOpened", "towerDown", "floorCaved", "bannerDown", "bridgeDown", "stormBegun", "stormBeaten", "lastBlow"];
  assert.equal(Object.keys(MOMENT_NAMES).length, kinds.length);
  for (const k of kinds) assert.ok(MOMENT_NAMES[k] && MOMENT_NAMES[k].length <= 20, k);
  assert.equal(MOMENT_NAMES.towerDown, "Tower down");
  assert.equal(MOMENT_NAMES.multiKill, "Multi-kill");
});

test("the speed mark: 1/4 when slowed, none at real speed", () => {
  assert.equal(speedLabel(0.25), "1/4");
  assert.equal(speedLabel(0.2), "1/5");
  assert.equal(speedLabel(1), null);
  assert.equal(speedLabel(0.97), null);
});

test("a frame rolled forward unseen loses only the events that make particles", () => {
  const f = frame(10, [[EventKind.Explosion, 0, 0, 0, 1], [EventKind.Laid, 5, 0, 0, 0], [EventKind.Muzzle, 2, 1, 0, 0], [EventKind.Blood, 1, 1, 1, 1]]);
  const q = quiet(f);
  assert.equal(q.eventCount, 2);
  assert.equal(q.events[0], EventKind.Laid);
  assert.equal(q.events[EVENT_STRIDE], EventKind.Blood);
  assert.equal(q.stones, f.stones, "stones and the rest are shared, not copied");
  const plain = frame(12, [[EventKind.Laid, 5, 0, 0, 0]]);
  assert.equal(quiet(plain), plain);
});

test("play: live keyframe first, then the clip's, the unseen roll forward, the lead without sound, then sound", () => {
  const { player, log, shown } = rig();
  const clip = clipOf();
  let ended = 0;
  player.play(clip, { onEnd: () => ended++ });
  assert.deepEqual(log.calls.slice(0, 4), ["capture", "closeInset", `clock:${CLOCK_BASE + 100 / 60}`, "apply:clip"]);
  assert.ok(log.calls.includes("caption:Tower down|A tower of 90 stones"));
  assert.equal(shown[0], true);
  assert.ok(player.playing);
  // Everything before take.start - LEAD_TICKS is already in, nothing later, and nothing was drawn yet.
  assert.ok(log.applied.length > 0 && Math.max(...log.applied) < 140 - LEAD_TICKS);
  assert.equal(log.calls.includes("render"), false);
  assert.ok(log.extras.every((e) => e.full), "the keyframe's and the roll's extras are the full ones");
  let frames = 0;
  while (player.playing && frames++ < 1000) player.update(DT);
  assert.equal(ended, 1);
  assert.equal(shown[shown.length - 1], false);
  assert.equal(log.calls[log.calls.length - 1], "apply:live", "the live keyframe is the last thing put in the renderer");
  assert.equal(log.calls[log.calls.length - 2], "clock:5.5", "after the live clock is put back");
  // The lead ran silent; the take's frames were heard.
  const silent = log.heard.filter((h) => !h.audible), loud = log.heard.filter((h) => h.audible);
  assert.ok(silent.length > 0 && silent.every((h) => h.tick <= 140));
  assert.ok(loud.length > 0 && loud.every((h) => h.tick >= 140 && h.tick <= 200));
  // Slow motion is told to the renderer, and put back at the end.
  assert.ok(log.scales.includes(0.25));
  assert.equal(log.scales[log.scales.length - 1], 1);
  assert.ok(loud.some((h) => h.speed === 0.25));
});

test("the clip ticks advance by dt times 60 times the speed", () => {
  const { player } = rig();
  player.play(clipOf());
  // The lead: 20 ticks at real speed take 10 frames at 30 per second.
  for (let i = 0; i < 10; i++) player.update(DT);
  assert.ok(Math.abs(player.at - 140) < 1e-6, `at ${player.at}`);
  player.update(DT);
  assert.ok(Math.abs(player.at - 142) < 1e-6);
  while (player.at < 170) player.update(DT);
  const before = player.at;
  player.update(DT);
  assert.ok(Math.abs(player.at - before - 0.5) < 1e-6, "a quarter of the 2 ticks a frame");
  assert.equal(player.speed, 0.25);
});

test("a skip half way puts the live keyframe back and calls onEnd once", () => {
  const { player, log, shown } = rig();
  let ended = 0;
  player.play(clipOf(), { onEnd: () => ended++ });
  for (let i = 0; i < 20; i++) player.update(DT);
  assert.ok(player.playing);
  player.skip();
  player.skip();
  assert.equal(player.playing, false);
  assert.equal(ended, 1);
  assert.equal(log.calls[log.calls.length - 1], "apply:live");
  assert.equal(shown[shown.length - 1], false);
  assert.equal(player.at, -1);
});

test("an error while drawing ends the replay with the live view back", () => {
  const { player, log } = rig({ failRender: 3 });
  let ended = 0;
  const quietLog = console.error;
  console.error = () => {};
  try {
    player.play(clipOf(), { onEnd: () => ended++ });
    for (let i = 0; i < 10; i++) player.update(DT);
  } finally {
    console.error = quietLog;
  }
  assert.equal(player.playing, false);
  assert.equal(ended, 1);
  assert.equal(log.calls[log.calls.length - 1], "apply:live");
});

test("a director that fails ends the replay at once, with the live view back and onEnd called", () => {
  const { player, log, shown } = rig({ failPlan: true });
  let ended = 0;
  const quietLog = console.error;
  console.error = () => {};
  try {
    player.play(clipOf(), { onEnd: () => ended++ });
  } finally {
    console.error = quietLog;
  }
  assert.equal(player.playing, false);
  assert.equal(ended, 1);
  assert.equal(log.calls[log.calls.length - 1], "apply:live");
  assert.equal(shown[shown.length - 1], false);
});

test("cancel puts the live view back and does not call onEnd", () => {
  const { player, log } = rig();
  let ended = 0;
  player.play(clipOf(), { onEnd: () => ended++ });
  player.update(DT);
  player.cancel();
  assert.equal(player.playing, false);
  assert.equal(ended, 0);
  assert.equal(log.calls[log.calls.length - 1], "apply:live");
});

test("the camera is the take's pose at the tick shown, never past its end", () => {
  const { player, log } = rig();
  player.play(clipOf());
  while (player.playing) player.update(DT);
  assert.ok(log.cams.length > 10);
  assert.ok(Math.max(...log.cams) <= 200 + 1e-9);
  assert.ok(Math.min(...log.cams) >= 140 - 1e-9);
});

test("playing again after an end works and starts from the clip again", () => {
  const { player, log } = rig();
  const clip = clipOf();
  for (let round = 0; round < 2; round++) {
    log.calls.length = 0;
    player.play(clip);
    assert.deepEqual(log.calls.slice(0, 4), ["capture", "closeInset", `clock:${CLOCK_BASE + 100 / 60}`, "apply:clip"]);
    while (player.playing) player.update(DT);
    assert.equal(log.calls[log.calls.length - 1], "apply:live");
  }
});
