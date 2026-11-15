// 3.5 Machines, the AI's side: from a Knight up the gunner goes after the enemy's organs (the bell, the crane, the roof
// and mast) by what its own side is about to do; its raids include the spotter's tower; the mason's eye is earned; the
// steward builds only on plots a kind may take. All through the inputs a player sends.

import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { AI_LEVELS, allowedOn, buildLayout, GAME_LAYOUT, MID_Z, ORGAN_KINDS, Unit, type AiLevel, type AiStep, type AiName } from "@keepfall/content";
import { Match, Team, type MatchInput } from "@keepfall/rules";
import type { Rapier } from "@keepfall/sim";
import { AIM_GROUPS, AiPlayer, gateLeaves } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const ME = Team.Player; // castle 1: the AI under test
const FOE = Team.Enemy; // castle 0: idle
const BELL = AIM_GROUPS.indexOf("bell"), CRANE = AIM_GROUPS.indexOf("crane"), MAST = AIM_GROUPS.indexOf("mast");
const AIM_BELL = 6, AIM_CRANE = 7, AIM_MAST = 8; // Aim.* (a const enum: its value)

type Pick = { e: { id: number }; t: { key: number; x: number; y: number; z: number } } | null;
const organPick = (ai: AiPlayer) => (ai.gunner as unknown as { organPick(): Pick }).organPick();

function setup(level: AiName, seed: number, over: Partial<AiLevel> = {}) {
  const m = new Match(R, layout, { seed, plan: false, rotate: false, barracks: false });
  const ai = new AiPlayer(m, ME, level, seed, { level: { organAims: 1, ...over } });
  const sent: Array<{ tick: number; input: MatchInput }> = [];
  const q = m.queue.bind(m);
  m.queue = (tick, t, input) => {
    if (t === ME) sent.push({ tick, input });
    q(tick, t, input);
  };
  // A mortar and a long gun, in slots that allow them.
  for (const kind of ["mortar", "longGun"] as const) {
    for (let s = 0; s < 8; s++) {
      const e = m.emplacements[ME * 8 + s];
      if (e.empty && (e.allowed ?? []).includes(kind)) {
        m.estate.buy(ME, e.id, kind);
        break;
      }
    }
  }
  return { m, ai, sent };
}

/** Two of its waves across the stream (on the enemy's side), three men each, standing still. */
function wavesPast(m: Match, team: number, n = 2) {
  for (let w = 0; w < n; w++) {
    const wv = m.army.newWave(team, 1);
    for (let k = 0; k < 3; k++) m.army.spawnAt(team, wv, Unit.Pikeman, -4 + k * 4, MID_Z + (team === ME ? 25 : -25) + w * 3, 0).speed = 0;
  }
}

function run(m: Match, ai: AiPlayer, ticks: number) {
  for (let i = 0; i < ticks && !m.result; i++) {
    for (const e of m.emplacements) if (e.id >= ME * 8 && e.id < ME * 8 + 8) m.world.reload[e.id] = 0;
    ai.step();
    m.step();
  }
}

const knock = (m: Match, id: number) => m.world.castle.knockLoose(id, 0, 0, 0);
const organKey = (m: Match, kind: number) => m.world.castle.layout.organs[m.world.organs!.index(FOE, kind)].key;

test("with two of its waves across the stream, a Knight that looks at organs aims at the enemy's bell and fires; with the bell down it does not", () => {
  const { m, ai, sent } = setup("knight", 3);
  run(m, ai, 30);
  assert.equal(organPick(ai), null, "no wave across the stream: no bell");
  wavesPast(m, ME);
  const p = organPick(ai);
  assert.ok(p, "it picks an organ");
  assert.equal(p!.t.key, AIM_BELL);
  const key = m.world.castle.layout.stones[organKey(m, 0)];
  assert.ok(Math.abs(p!.t.x - key.x) < 1e-6 && Math.abs(p!.t.y - key.y) < 1e-6 && Math.abs(p!.t.z - key.z) < 1e-6, "laid on the bell");
  run(m, ai, 60 * 60);
  assert.ok(ai.gunner.byAim[BELL] >= 1, `${ai.gunner.byAim[BELL]} hand shots at the bell`);
  assert.ok(sent.some((s) => s.input.kind === "fire"));
  // The bell down: it leaves it alone.
  knock(m, organKey(m, 0));
  run(m, ai, 30);
  assert.equal(m.organUp(FOE, "bell"), false);
  assert.notEqual(organPick(ai)?.t.key, AIM_BELL, "no bell to aim at");
  const before = ai.gunner.byAim[BELL];
  run(m, ai, 60 * 60);
  assert.equal(ai.gunner.byAim[BELL], before, "no more shots at it");
  m.free();
});

test("with a way into the enemy courtyard open it aims at the crane; with their men outnumbering its own by half again, at the roof and mast", () => {
  {
    const { m, ai } = setup("knight", 4);
    run(m, ai, 30);
    assert.equal(organPick(ai), null);
    for (const id of gateLeaves(m)[FOE]) knock(m, id);
    run(m, ai, 120);
    const p = organPick(ai);
    assert.ok(p, "a way in is open");
    assert.equal(p!.t.key, AIM_CRANE);
    run(m, ai, 60 * 60);
    assert.ok(ai.gunner.byAim[CRANE] >= 1, `${ai.gunner.byAim[CRANE]} hand shots at the crane`);
    knock(m, organKey(m, 1));
    run(m, ai, 30);
    assert.equal(m.organUp(FOE, "crane"), false);
    assert.notEqual(organPick(ai)?.t.key, AIM_CRANE, "the crane is down");
    m.free();
  }
  {
    const { m, ai } = setup("knight", 5);
    run(m, ai, 30);
    const wv = m.army.newWave(FOE, 1);
    const men = (n: number, team: number, w: number) => {
      for (let k = 0; k < n; k++) m.army.spawnAt(team, w, Unit.Pikeman, -10 + k * 2, MID_Z + (team === ME ? -25 : 25), 0).speed = 0;
    };
    men(5, FOE, wv);
    assert.equal(organPick(ai), null, "five men are not enough");
    men(1, FOE, wv);
    const own = m.army.newWave(ME, 1);
    men(5, ME, own); // 6 against 5: not half again
    assert.equal(organPick(ai), null, "6 against 5 is under half again");
    // Their men now 9 against its 5: more than half again, and at least 6.
    men(3, FOE, wv);
    const p = organPick(ai);
    assert.ok(p, "outnumbered by half again");
    assert.equal(p!.t.key, AIM_MAST);
    run(m, ai, 60 * 60);
    assert.ok(ai.gunner.byAim[MAST] >= 1, `${ai.gunner.byAim[MAST]} hand shots at the roof and mast`);
    m.free();
  }
});

test("after an organ falls it leaves organs alone for its rest", () => {
  const { m, ai } = setup("knight", 6);
  run(m, ai, 30);
  wavesPast(m, ME);
  assert.ok(organPick(ai));
  for (const id of gateLeaves(m)[FOE]) knock(m, id);
  run(m, ai, 120);
  knock(m, organKey(m, 2));
  run(m, ai, 30);
  assert.equal(m.organUp(FOE, "mast"), false);
  // Bell and crane both stand and both apply, yet it holds off while it rests.
  const g = ai.gunner as unknown as { organUntil: number };
  assert.ok(g.organUntil > m.tick + AI_LEVELS.knight.organRest - 120, "its rest began");
  const before = ai.gunner.byAim[BELL] + ai.gunner.byAim[CRANE];
  run(m, ai, 30 * 60);
  assert.equal(ai.gunner.byAim[BELL] + ai.gunner.byAim[CRANE], before, "no organ shots in the rest");
  m.free();
});

test("the Squire and the tutor never aim at an organ, though everything is set up for it", () => {
  for (const level of ["squire", "tutor"] as const) {
    assert.equal(AI_LEVELS[level].organs, false);
    const { m, ai } = setup(level, 7, { organAims: 1 });
    wavesPast(m, ME);
    for (const id of gateLeaves(m)[FOE]) knock(m, id);
    run(m, ai, 2 * 60 * 60);
    assert.equal(ai.gunner.byAim[BELL] + ai.gunner.byAim[CRANE] + ai.gunner.byAim[MAST], 0, level);
    m.free();
  }
  assert.equal(AI_LEVELS.knight.organs, true);
  assert.equal(AI_LEVELS.warlord.organs, true);
  assert.equal(AIM_GROUPS.slice(-3).join(), "bell,crane,mast");
  assert.deepEqual(ORGAN_KINDS, ["bell", "crane", "mast"]);
});

test("a Knight's cut forecasts with the mason's eye only while its own spotter's tower works", () => {
  for (const spotter of [false, true]) {
    const m = new Match(R, layout, { seed: 5, plan: false, rotate: false, barracks: false });
    for (const id of gateLeaves(m)[FOE]) knock(m, id);
    const ai = new AiPlayer(m, ME, "knight", 5, { level: { cut: 1 } });
    m.spotter = (team: number) => spotter && team === ME;
    let calls = 0;
    const st = m.world.statics!;
    const w = st.whatIf.bind(st);
    st.whatIf = (...a: Parameters<typeof w>) => {
      calls++;
      return w(...a);
    };
    for (let i = 0; i < 90; i++) {
      ai.step();
      m.step();
    }
    // Each look draws its own points to see: over a few looks it sees the keep's foot through the open gate and cuts.
    let pick: { t: { key: number } } | null = null;
    for (let k = 0; k < 40 && pick?.t.key !== 5; k++) pick = (ai.gunner as unknown as { cutPick(): { t: { key: number } } | null }).cutPick();
    assert.ok(pick, `it still picks a point (spotter ${spotter})`);
    assert.equal(pick!.t.key, 5, "it cuts (Aim.Cut)");
    if (spotter) assert.ok(calls >= 1, "with a spotter's tower it forecasts");
    else assert.equal(calls, 0, "without one it makes no forecast");
    m.free();
  }
});

test("six minutes of Knight against Warlord: every build is on a plot its kind may take, and the spotter's tower goes on its plan's plot", () => {
  const m = new Match(R, layout, { seed: 21, plan: false, rotate: false });
  const ais = [new AiPlayer(m, Team.Enemy, "warlord", 21), new AiPlayer(m, Team.Player, "knight", 21)];
  m.gold[0] = m.gold[1] = 4000; // rich, so the plans run to their spotter's tower inside six minutes
  const builds: Array<[number, string, number]> = [];
  const q = m.queue.bind(m);
  m.queue = (tick, team, input) => {
    if (input.kind === "build") builds.push([team, input.building, input.plot]);
    q(tick, team, input);
  };
  for (let i = 0; i < 6 * 60 * 60 && !m.result; i++) {
    for (const ai of ais) ai.step();
    m.step();
  }
  console.log("builds", JSON.stringify(builds));
  assert.ok(builds.length >= 4, `${builds.length} builds`);
  for (const [team, kind, plot] of builds) assert.ok(allowedOn(kind as never, plot), `team ${team} built ${kind} on plot ${plot}`);
  for (const team of [0, 1]) assert.ok(builds.some(([t, k, p]) => t === team && k === "spotter" && p === 7), `team ${team} built its spotter's tower on plot 7`);
  m.free();
});

test("a plan step that puts a building on a plot it may not take is passed over, never sent", () => {
  const plan: AiStep[] = [
    { kind: "build", plot: 7, building: "barracks" },
    { kind: "build", plot: 0, building: "spotter" },
    { kind: "build", plot: 1, building: "mill" },
  ];
  const m = new Match(R, layout, { seed: 8, plan: false, rotate: false, barracks: false, startBuildings: [[], []] });
  const ai = new AiPlayer(m, ME, "knight", 8, { plan });
  const sent: MatchInput[] = [];
  const q = m.queue.bind(m);
  m.queue = (tick, t, input) => {
    if (t === ME) sent.push(input);
    q(tick, t, input);
  };
  m.gold[ME] = 3000;
  run(m, ai, 20 * 60);
  const builds = sent.filter((i) => i.kind === "build") as Array<{ plot: number; building: string }>;
  assert.ok(builds.length >= 1);
  for (const b of builds) assert.ok(allowedOn(b.building as never, b.plot), `${b.building} on ${b.plot}`);
  assert.ok(builds.some((b) => b.building === "mill" && b.plot === 1), "the step it could take, it took");
  m.free();
});
