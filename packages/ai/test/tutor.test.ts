// The tutor (phase 2 M6): the guided match's AI castle, asleep at first and
// waking in four stages that are judged from the match alone. These tests play
// a guided match (GUIDED_OPTIONS) against a scripted player and watch the
// inputs the tutor sends.

import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, TUTOR } from "@keepfall/content";
import { Order, PlotState, type Rapier } from "@keepfall/sim";
import { GUIDED_OPTIONS, Match, Team, TUTOR_TEAM, type MatchInput } from "@keepfall/rules";
import { AiPlayer, GUIDED_MATCH_HASH, runGuidedMatch } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;

interface Sent {
  tick: number;
  input: MatchInput;
}

function guided(seed = 31) {
  const m = new Match(R, buildLayout(1, GAME_LAYOUT), { ...GUIDED_OPTIONS, seed });
  const ai = new AiPlayer(m, TUTOR_TEAM, "tutor", seed);
  const sent: Sent[] = [];
  const q = m.queue.bind(m);
  m.queue = (tick, team, input) => {
    if (team === TUTOR_TEAM) sent.push({ tick, input });
    q(tick, team, input);
  };
  /** Play to a tick, noting the tick each stage began. */
  const stageAt = [0, -1, -1, -1];
  const play = (to: number, each?: (tick: number) => void) => {
    while (m.tick < to) {
      ai.step();
      m.step();
      if (stageAt[ai.stage] < 0) stageAt[ai.stage] = m.tick - 1;
      each?.(m.tick);
    }
  };
  return { m, ai, sent, stageAt, play };
}

const tutorEmps = (m: Match, weapon?: string) => m.emplacements.filter((e) => e.id >= 8 && e.id < 16 && (!weapon || e.weapon === weapon)).map((e) => e.id);

test("an idle player: the tutor sleeps to 4:00, then stirs and raises its barracks; its keep is never repaired", () => {
  const { m, ai, sent, play } = guided();
  assert.equal(ai.stage, 0);
  assert.equal(m.army.order[Team.Player], Order.Hold, "the player's waves start on Hold");
  assert.equal(m.world.structures!.slot(TUTOR_TEAM, 0).state, PlotState.Empty, "the tutor starts with no barracks");
  const asleep = TUTOR.stirsBy * 60 - 1;
  play(asleep);
  assert.equal(ai.stage, 0);
  const loud = sent.filter((s) => ["fire", "aim", "build", "buy", "upgrade", "man"].includes(s.input.kind));
  assert.deepEqual(loud, [], "asleep: no gun taken, laid or fired, nothing built or bought");
  assert.equal(m.shots[TUTOR_TEAM], 0);
  for (const k of ["gate", "walls", "towers", "keep"] as const) assert.equal(m.repairs[TUTOR_TEAM][k], false, `asleep: its ${k} repair switch is off`);
  play(TUTOR.stirsBy * 60 + 10 * 60);
  assert.equal(ai.stage, 1, "stage 1 at 4:00");
  const b = sent.find((s) => s.input.kind === "build" && s.input.building === "barracks");
  assert.ok(b && b.tick <= TUTOR.stirsBy * 60 + 10 * 60, "it orders its barracks within 10 s of stirring");
  const state = m.world.structures!.slot(TUTOR_TEAM, 0).state;
  assert.ok(state === PlotState.Rising || state === PlotState.Standing, `its barracks is rising (state ${state})`);
  assert.deepEqual(sent.filter((s) => s.input.kind === "fire"), [], "no fire yet at stage 1");
  assert.ok(!sent.some((s) => s.input.kind === "repair" && s.input.repair === "keep" && s.input.on), "it never switches its keep repair on");
  assert.equal(m.repairs[TUTOR_TEAM].keep, false);
  assert.equal(m.repairs[TUTOR_TEAM].gate, true, "stirring: the gate is repaired");
  assert.equal(m.repairs[TUTOR_TEAM].walls, false);
  m.free();
});

test("a player who builds, then orders Advance, wakes the tutor early; the stages come in order, 150 s apart at the end", () => {
  const { m, ai, sent, stageAt, play } = guided();
  m.queue(1200, Team.Player, { kind: "build", plot: 1, building: "mill" });
  play(TUTOR.stirsFrom * 60 - 1);
  assert.equal(ai.stage, 0, "a player who built at 0:20 does not stir it before 1:30");
  play(TUTOR.stirsFrom * 60 + 1);
  assert.equal(ai.stage, 1);
  assert.equal(stageAt[1], TUTOR.stirsFrom * 60, "stage 1 at 1:30");
  const advanceAt = stageAt[1] + 40 * 60;
  // The order is given for half a second only (sent in, the player's waves would storm the sleeping castle and end the match).
  m.queue(advanceAt, Team.Player, { kind: "order", order: Order.Advance });
  m.queue(advanceAt + 30, Team.Player, { kind: "order", order: Order.Hold });
  play(advanceAt);
  assert.equal(ai.stage, 1);
  play(advanceAt + 10);
  assert.equal(ai.stage, 2, "Advance 40 s after stage 1 wakes it then, not after 90 s");
  assert.ok(stageAt[2] <= advanceAt + 2 && stageAt[2] > advanceAt, `stage 2 at ${stageAt[2]}, the order at ${advanceAt}`);
  const fightsAt = stageAt[2] + TUTOR.fightsAfter * 60;
  play(fightsAt - 1);
  assert.equal(ai.stage, 2);
  play(fightsAt + 1);
  assert.equal(ai.stage, 3);
  assert.equal(stageAt[3], fightsAt, "stage 3 comes 150 s after stage 2");
  play(fightsAt + 8 * 60); // its next look at its castle
  assert.ok(stageAt[0] < stageAt[1] && stageAt[1] < stageAt[2] && stageAt[2] < stageAt[3], "in order, none skipped");

  // What it fired, and with what: by hand only from stage 2 (the long gun), the mortar only from stage 3.
  const mortars = tutorEmps(m, "mortar"), longs = tutorEmps(m, "longGun");
  const fires = sent.filter((s) => s.input.kind === "fire");
  assert.ok(fires.length > 0, "it fired by hand once awake");
  for (const f of fires) {
    const e = (f.input as { emplacement: number }).emplacement;
    assert.ok(f.tick >= stageAt[2], `no fire by hand before stage 2 (at ${f.tick})`);
    if (mortars.includes(e)) assert.ok(f.tick >= stageAt[3], `no mortar before stage 3 (at ${f.tick})`);
    else assert.ok(longs.includes(e) || f.tick >= stageAt[3], "before stage 3 it fires the long gun only");
  }
  assert.ok(!sent.some((s) => s.input.kind === "repair" && s.input.repair === "keep" && s.input.on), "its keep repair is never on");
  assert.ok(!sent.some((s) => s.input.kind === "order" && s.input.order !== Order.Advance), "it only ever orders Advance");
  assert.ok(!sent.some((s) => s.input.kind === "upgrade"), "it never upgrades");
  assert.equal(m.repairs[TUTOR_TEAM].towers, true, "stage 3: gate, walls and towers");
  assert.equal(m.repairs[TUTOR_TEAM].keep, false);
  m.free();
});

test("a ruined barracks of the tutor's is rebuilt, and an idle player's tutor still stirs at 4:00", () => {
  const { m, sent, play, ai } = guided();
  play(TUTOR.stirsBy * 60 + 40 * 60); // its barracks has risen
  const st = m.world.structures!, s = st.slot(TUTOR_TEAM, 0);
  assert.equal(s.state, PlotState.Standing, "its barracks stands");
  assert.equal(ai.stage, 1);
  const builds = () => sent.filter((x) => x.input.kind === "build" && x.input.plot === 0).length;
  const before = builds();
  // The player shells it to ruin (here: every piece knocked loose).
  for (const id of s.ids) m.world.castle.knockLoose(id, 0, 1, 0);
  play(m.tick + 60 * 60);
  assert.ok(builds() > before, "it orders the ruin rebuilt");
  play(m.tick + 40 * 60);
  assert.equal(s.state, PlotState.Standing, "its barracks stands again");
  m.free();
});

test("the guided match replays to its pinned hash, and the tutor stirs, wakes and fights as scripted", () => {
  const a = runGuidedMatch(R);
  console.log("guided match", JSON.stringify(a));
  assert.deepEqual(a.hash, GUIDED_MATCH_HASH);
  assert.equal(a.stageTicks[1], TUTOR.stirsFrom * 60, "the mill at 0:20 stirs it at 1:30");
  assert.ok(a.stageTicks[2] > a.stageTicks[1] && a.stageTicks[2] <= 7300, "the order at 2:00 wakes it");
  assert.equal(a.stageTicks[3], a.stageTicks[2] + TUTOR.fightsAfter * 60, "it fights 150 s later");
  assert.ok(a.shots[TUTOR_TEAM] > 0 && a.shots[Team.Player] >= 3);
});
