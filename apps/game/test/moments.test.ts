import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, GAME_LAYOUT, repairSections } from "@keepfall/content";
import { Cause, EVENT_STRIDE, EventKind, MINION_STRIDE, PART_STRIDE, type FrameData } from "@keepfall/sim";
import { Moments, scoreOf, type MatchView, type Moment } from "../src/moments";

const layout = buildLayout(1, GAME_LAYOUT);
const secs = repairSections(layout);
const towerOf = (castle: number) => secs.find((s) => s.castle === castle && s.kind === "towers")!;

type Ev = [number, number, number, number, number];
interface Spec {
  events?: Ev[];
  /** [id, x, z, team] */
  men?: Array<[number, number, number, number]>;
  /** [id, x, y, z] part 0 of a body in flight */
  parts?: Array<[number, number, number, number]>;
  settled?: Array<[number, number, number, number]>;
  plots?: number[][];
}
function frame(tick: number, s: Spec = {}): FrameData {
  const events = new Float32Array((s.events ?? []).flat());
  const minions = new Float32Array((s.men ?? []).flatMap(([id, x, z, team]) => [id, x, 0, z, 0, 0, team, 0, 0, 0]));
  const parts = new Float32Array((s.parts ?? []).flatMap(([id, x, y, z]) => [id, 0, x, y, z, 0, 0, 0, 1]));
  const settled = new Float32Array((s.settled ?? []).flatMap(([id, x, y, z]) => [id, 0, x, y, z, 0, 0, 0, 1]));
  const plots = new Float32Array((s.plots ?? []).flat());
  return {
    tick,
    events,
    eventCount: events.length / EVENT_STRIDE,
    minions,
    minionCount: minions.length / MINION_STRIDE,
    parts,
    partCount: parts.length / PART_STRIDE,
    settled,
    settledCount: settled.length / PART_STRIDE,
    gone: new Int32Array(0),
    plots,
    plotCount: plots.length / 6,
  } as unknown as FrameData;
}
const muzzle = (emp: number, shot: number): Ev => [EventKind.Muzzle, emp, shot, 0, 0];
const down = (id: number, cause: number, shot: number, speed = 5): Ev => [EventKind.Down, id, cause, shot, speed];

function rig() {
  let now = 1000;
  const m = new Moments({
    layout,
    me: 1,
    clock: () => now++,
    gun: (emp) => (emp === 0 ? { team: 1, name: "long gun", x: 0, y: 5, z: 0 } : emp === 8 ? { team: 0, name: "long gun", x: 0, y: 5, z: 100 } : null),
  });
  const got: Moment[] = [];
  m.onMoment((x) => got.push(x));
  return { m, got };
}
/** Run quiet frames until a tick. */
function quiet(m: Moments, from: number, to: number) {
  for (let t = from; t <= to; t += 30) m.frame(frame(t));
}
const view = (o: Partial<MatchView> = {}): MatchView => ({ tick: 0, earned: new Float32Array(0), gateOpen: [false, false], storm: [0, 0], keeps: [3, 3], result: null, ...o });

test("one shot that fells four men is one multi-kill moment with the count, emitted once", () => {
  const { m, got } = rig();
  m.frame(frame(10, { events: [muzzle(0, 5)], men: [[1, 0, -50, 0], [2, 1, -50, 0], [3, 2, -50, 0], [4, 3, -50, 0]] }));
  m.frame(frame(40, { events: [down(1, Cause.Ball, 5), down(2, Cause.Ball, 5), down(3, Cause.Ball, 5)] }));
  m.frame(frame(45, { events: [down(4, Cause.Ball, 5)] }));
  assert.equal(got.length, 0, "nothing until the shot's window closes");
  quiet(m, 60, 400);
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, "multiKill");
  assert.equal(got[0].size, 4);
  assert.equal(got[0].team, 1);
  assert.equal(got[0].shot, 5);
  assert.match(got[0].text, /Four men/);
  quiet(m, 430, 900);
  assert.equal(got.length, 1, "never twice");
});

test("a man of the shooter's own side does not count; one man alone is no moment", () => {
  const { m, got } = rig();
  m.frame(frame(10, { events: [muzzle(0, 5)], men: [[1, 0, -50, 1], [2, 1, -50, 1], [3, 2, -50, 0]] }));
  m.frame(frame(20, { events: [down(1, Cause.Ball, 5), down(2, Cause.Ball, 5), down(3, Cause.Ball, 5)] }));
  quiet(m, 40, 400);
  assert.equal(got.length, 0);
});

test("a ricochet credit from the earned feed makes a one-man shot a ricochet kill", () => {
  const { m, got } = rig();
  m.frame(frame(10, { events: [muzzle(0, 6)], men: [[1, 0, -50, 0]] }));
  const earned = new Float32Array([1, 20, 3, 0, 2, -50]); // team 1, 20 gold, Earn.Ricochet
  m.match(view({ tick: 15, earned }));
  m.frame(frame(20, { events: [down(1, Cause.Ball, 6)] }));
  quiet(m, 40, 300);
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, "ricochetKill");
  assert.equal(got[0].team, 1);
});

test("men killed by masonry with no big structure is a collapse kill", () => {
  const { m, got } = rig();
  const c = layout.stones.find((s) => s.castle === 0 && s.part === "wall")!;
  m.frame(frame(10, { men: [[1, c.x, c.z, 0], [2, c.x + 1, c.z, 0], [3, c.x + 2, c.z, 0]] }));
  m.frame(frame(30, { events: [down(1, Cause.Masonry, -1), down(2, Cause.Masonry, -1), down(3, Cause.Masonry, -1)] }));
  quiet(m, 60, 500);
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, "collapseKill");
  assert.equal(got[0].size, 3);
  assert.equal(got[0].team, 1, "the doing of the other castle's side");
});

test("a tower coming down with men and a gun is one moment with all three counts", () => {
  const { m, got } = rig();
  const t = towerOf(0);
  const c = layout.stones[t.stones[0]];
  const men: Array<[number, number, number, number]> = [];
  const downs: Ev[] = [];
  for (let i = 0; i < 9; i++) {
    men.push([i + 1, c.x, c.z, 0]);
    downs.push(down(i + 1, Cause.Masonry, -1));
  }
  m.frame(frame(10, { men }));
  m.frame(frame(30, { events: [[EventKind.Fell, 0, t.index, t.stones.length, 0], ...downs, [EventKind.GunOut, 8, 0, -1, 0]] }));
  quiet(m, 60, 500);
  const tower = got.filter((x) => x.kind === "towerDown");
  assert.equal(tower.length, 1);
  assert.equal(tower[0].men, 9);
  assert.equal(tower[0].stones, t.stones.length);
  assert.equal(tower[0].guns, 1);
  assert.match(tower[0].text, new RegExp(`^Tower down: ${t.stones.length} stones, 9 men, a gun$`));
  assert.equal(got.filter((x) => x.kind === "collapseKill").length, 0, "its men are part of the tower moment");
});

test("a wall losing stones opens a breach; a few stones are nothing", () => {
  const { m, got } = rig();
  const wall = secs.find((s) => s.castle === 0 && s.kind === "walls")!;
  m.frame(frame(10, { events: [[EventKind.Fell, 0, wall.index, 6, 0]] }));
  quiet(m, 30, 400);
  assert.equal(got.length, 0);
  m.frame(frame(500, { events: [[EventKind.Fell, 0, wall.index, 30, 0]] }));
  quiet(m, 520, 900);
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, "breachOpened");
  assert.equal(got[0].size, 30);
});

test("a man thrown 25 m is a moment once his body settles", () => {
  const { m, got } = rig();
  m.frame(frame(10, { events: [muzzle(0, 9)], men: [[7, 0, -40, 0]] }));
  m.frame(frame(20, { events: [down(7, Cause.Burst, 9, 18)], parts: [[7, 0, 1, -40]] }));
  m.frame(frame(40, { parts: [[7, 10, 6, -40]] }));
  m.frame(frame(60, { parts: [[7, 20, 2, -40]] }));
  quiet(m, 70, 100);
  assert.equal(got.filter((x) => x.kind === "thrown").length, 0, "still in the air");
  m.frame(frame(120, { settled: [[7, 25, 0.2, -40]] }));
  const th = got.filter((x) => x.kind === "thrown");
  assert.equal(th.length, 1);
  assert.equal(th[0].size, 25);
  assert.equal(th[0].team, 1);
  assert.equal(th[0].text, "A man thrown 25 m");
  quiet(m, 150, 800);
  assert.equal(got.filter((x) => x.kind === "thrown").length, 1);
});

test("a man thrown only 8 m is nothing", () => {
  const { m, got } = rig();
  m.frame(frame(10, { events: [muzzle(0, 9)], men: [[7, 0, -40, 0]] }));
  m.frame(frame(20, { events: [down(7, Cause.Ball, 9, 18)] }));
  m.frame(frame(120, { settled: [[7, 8, 0.2, -40]] }));
  assert.equal(got.filter((x) => x.kind === "thrown").length, 0);
});

test("a gate going down, a storm, a floor and the last blow come from the match report, once each", () => {
  const { m, got } = rig();
  m.match(view({ tick: 1 }));
  m.match(view({ tick: 100, gateOpen: [true, false] }));
  m.match(view({ tick: 101, gateOpen: [true, false] }));
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, "gateDown");
  assert.equal(got[0].team, 1, "the enemy gate: your doing");
  m.match(view({ tick: 200, gateOpen: [true, false], storm: [30, 0] }));
  assert.equal(got[1].kind, "stormBegun");
  assert.equal(got[1].team, 1, "you storm the enemy courtyard");
  m.match(view({ tick: 300, gateOpen: [true, false], storm: [0, 0] }));
  assert.equal(got[2].kind, "stormBeaten");
  assert.equal(got[2].team, 0, "the enemy beat it off");
  m.match(view({ tick: 400, gateOpen: [true, false], keeps: [2, 3] }));
  assert.equal(got[3].kind, "floorCaved");
  assert.equal(got[3].team, 1);
  m.match(view({ tick: 500, gateOpen: [true, false], keeps: [0, 3], result: { winner: 1, reason: "keep", tick: 500 } }));
  assert.deepEqual(got.slice(4).map((x) => x.kind), ["lastBlow"]);
  m.match(view({ tick: 501, keeps: [0, 3], result: { winner: 1, reason: "keep", tick: 500 } }));
  assert.equal(got.length, 5, "the end is told once");
});

test("a bridge dropping with men on it is a moment; an empty one is not", () => {
  const { m, got } = rig();
  const b = layout.bridges[1].site;
  m.frame(frame(10, { men: [[1, b.x, b.z, 0], [2, b.x, b.z + 1, 0]] }));
  m.bridges([true, true, true], [true, false, true]);
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, "bridgeDown");
  assert.equal(got[0].men, 2);
  m.frame(frame(20));
  m.bridges([true, false, true], [true, false, false]);
  assert.equal(got.length, 1);
});

test("kegs set off in a chain are one moment; kegs among their own setters are a keg sent back", () => {
  const { m, got } = rig();
  const kegs: Ev[] = [[EventKind.Keg, 1, 10, 1, 0], [EventKind.Keg, 1, 20, 1, 0], [EventKind.Keg, 1, 30, 1, 0]];
  m.frame(frame(10, { men: [[1, 10, 0, 0], [11, 12, 0, 0], [12, 14, 0, 0], [13, 22, 0, 0]], events: kegs.map((k, i) => [k[0], 1, 10 * (i + 1), 1, 0] as Ev) }));
  m.frame(frame(100, { events: [[EventKind.Explosion, 10, 1, 0, 6], [EventKind.Explosion, 20, 1, 0, 6], [EventKind.Explosion, 30, 1, 0, 6], down(11, Cause.Burst, -1), down(12, Cause.Burst, -1), down(13, Cause.Burst, -1)] }));
  quiet(m, 130, 500);
  const kinds = got.map((x) => x.kind).sort();
  assert.deepEqual(kinds, ["kegBack", "kegChain"]);
  const chain = got.find((x) => x.kind === "kegChain")!;
  assert.equal(chain.size, 3);
  assert.equal(chain.team, 0, "the setters' keg chain");
  assert.equal(got.find((x) => x.kind === "kegBack")!.team, 1);
});

test("a gun knocked out is a moment for the other side", () => {
  const { m, got } = rig();
  m.frame(frame(10, { events: [[EventKind.GunOut, 8, 1, 3, 0]] }));
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, "gunSilenced");
  assert.equal(got[0].team, 1);
  assert.equal(got[0].text, "Enemy long gun silenced");
});

test("a building going to ruin is a moment", () => {
  const { m, got } = rig();
  m.frame(frame(10, { plots: [[0, 1, 1, 2, 1, 1]] }));
  m.frame(frame(20, { plots: [[0, 1, 1, 3, 1, 0]] }));
  m.frame(frame(30, { plots: [[0, 1, 1, 3, 1, 0]] }));
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, "buildingWrecked");
  assert.equal(got[0].text, "Powder Mill wrecked");
});

test("scores: a tower down with 9 men outranks a single kill and a three-man shot; the rare score more", () => {
  const tower = scoreOf("towerDown", 212, { men: 9, guns: 1 });
  assert.ok(tower > scoreOf("ricochetKill", 1, { men: 1 }));
  assert.ok(tower > scoreOf("multiKill", 3, { men: 3 }));
  assert.ok(scoreOf("multiKill", 1) < scoreOf("multiKill", 2));
  assert.ok(scoreOf("lastBlow", 1) > tower);
  assert.ok(scoreOf("bannerDown", 1) > scoreOf("floorCaved", 1));
});

test("subscribers can leave, and reset forgets what was in flight", () => {
  const { m, got } = rig();
  const more: Moment[] = [];
  const off = m.onMoment((x) => more.push(x));
  m.match(view({ tick: 1 }));
  m.match(view({ tick: 100, gateOpen: [true, false] }));
  assert.equal(more.length, 1);
  off();
  m.match(view({ tick: 200, gateOpen: [true, true] }));
  assert.equal(more.length, 1);
  assert.equal(got.length, 2);
  m.reset();
  assert.equal(m.log.length, 0);
});
