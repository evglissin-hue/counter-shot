// 3.2 task A: the AI marks, fires for effect and sends a wave down a road with its bridge down, all through
// the inputs a player sends. A Knight ranges ground and marks it only where its own shot came down; a Squire
// never marks; a salvo is ordered on men on a mark, never twice in 20 s.

import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BRIDGES, buildLayout, DECK_TOP, GAME_LAYOUT, REGISTER, ROUTE_NAMES, Unit, type AiLevel, type Difficulty } from "@keepfall/content";
import type { Rapier } from "@keepfall/sim";
import { Match, Team, type MatchInput } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;

/** A match with one AI on `team` (the other castle idle), and every input it sends. */
function setup(level: Difficulty, team: Team, seed: number, over?: Partial<AiLevel>) {
  const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false });
  const ai = new AiPlayer(m, team, level, seed, over ? { level: over } : undefined);
  const sent: Array<{ tick: number; input: MatchInput }> = [];
  const q = m.queue.bind(m);
  m.queue = (tick, t, input) => {
    sent.push({ tick, input });
    q(tick, t, input);
  };
  return { m, ai, sent };
}

/** Every mark the team ever made (a mark is a new object when made; refreshing only moves its fade). */
function watchMarks(m: Match, team: number) {
  const seen = new Set<object>();
  const made: Array<{ x: number; z: number; tick: number }> = [];
  return () => {
    for (const k of m.register.marks[team]) {
      if (k && !seen.has(k)) {
        seen.add(k);
        made.push({ x: k.x, z: k.z, tick: m.tick });
      }
    }
    return made;
  };
}

test("a Knight against an idle castle marks the road near a bridge and the ground before its gate, only where its own shot landed; a Squire marks nothing", () => {
  const team = Team.Enemy;
  const { m, ai, sent } = setup("knight", team, 11);
  const marks = watchMarks(m, team);
  // Each mark input follows a shot of its own that came down inside the window (the match would refuse it otherwise).
  const origQueue = m.queue;
  m.queue = (tick, t, input) => {
    if (input.kind === "mark") assert.ok(m.register.canMark(team, input.emplacement, tick), `a mark input at ${tick} with no shot of its own to mark`);
    origQueue(tick, t, input);
  };
  for (let i = 0; i < 4 * 60 * 60; i++) {
    ai.step();
    m.step();
    marks();
  }
  const made = marks();
  const markInputs = sent.filter((s) => s.input.kind === "mark");
  assert.ok(markInputs.length >= 2, `it sent ${markInputs.length} mark inputs`);
  assert.ok(markInputs[0].tick >= AI_WARM(), `its first mark came at ${markInputs[0].tick}, before its warm-up was over`);
  const nearBridge = made.filter((k) => BRIDGES.some((b) => Math.hypot(k.x - b.x, k.z - b.z) < b.length / 2 + 8 + REGISTER.radius + 2));
  const gate = made.filter((k) => Math.abs(k.x) < REGISTER.radius && k.z < -19.5 - 5 && k.z > -19.5 - 40);
  assert.ok(nearBridge.length >= 1, `marks near a bridge: ${JSON.stringify(made)}`);
  assert.ok(gate.length >= 1, `marks before its gate: ${JSON.stringify(made)}`);
  for (const k of made) assert.ok(k.z > -75, "all on its own side of the stream");
  m.free();

  const s = setup("squire", team, 11);
  for (let i = 0; i < 4 * 60 * 60; i++) {
    s.ai.step();
    s.m.step();
  }
  assert.equal(s.sent.filter((x) => x.input.kind === "mark" || x.input.kind === "salvo").length, 0, "a Squire never marks or orders a salvo");
  assert.equal(s.m.register.list(team).length, 0);
  s.m.free();
});

function AI_WARM(): number {
  return 30 * 60; // a Knight's warm-up is at most this (the level's own is checked against the first shot in ai.test.ts)
}

test("with enemy men on a mark a Knight orders a salvo, not twice in 20 s; a Squire (and a Knight with salvo off) never does", () => {
  for (const [level, over, expect] of [["knight", undefined, true], ["squire", { marks: 1 }, false], ["knight", { salvo: false }, false]] as const) {
    const team = Team.Enemy, foe = Team.Player;
    const { m, ai, sent } = setup(level, team, 11, over);
    const marks = watchMarks(m, team);
    // (The Squire is given the Knight's marking by an override, so only its salvo choice is tested.)
    for (let i = 0; i < 4 * 60 * 60 && m.register.list(team).length === 0; i++) {
      ai.step();
      m.step();
      marks();
    }
    assert.ok(m.register.list(team)[0], "there is a mark");
    // A salvo fires only loaded guns clear of the team's own men and of bridges: go on until a mark has a gun that bears, and load the guns.
    const bears = () => m.register.list(team).find((k) => m.register.bearing(team, k.n, false).length > 0 && k.y < m.world.terrain.heightAt(k.x, k.z) + 0.5);
    for (let i = 0; i < 6 * 60 * 60 && !bears(); i++) {
      ai.step();
      m.step();
      marks();
    }
    const mark = bears();
    assert.ok(mark, "a mark with a gun that bears");
    for (const e of m.emplacements) m.world.reload[e.id] = 0;
    // Eight of the enemy's men standing on it.
    const wv = m.army.newWave(foe, 1, true);
    for (let k = 0; k < 12; k++) m.army.spawnAt(foe, wv, Unit.Pikeman, mark.x - 2 + (k % 3) * 2, mark.z - 2 + Math.floor(k / 3) * 2, 0).speed = 0;
    const before = sent.length;
    const at = m.tick;
    // The unmanned guns would shoot the men down before the AI looks: they are held while it decides.
    (m as unknown as { autoFire: boolean[] }).autoFire[foe] = false;
    (m as unknown as { autoFire: boolean[] }).autoFire[team] = false;
    for (let i = 0; i < 45 * 60; i++) {
      for (const e of m.emplacements) m.world.reload[e.id] = 0;
      ai.step();
      m.step();
    }
    const salvos = sent.slice(before).filter((s) => s.input.kind === "salvo");
    if (expect) {
      assert.ok(salvos.length >= 1, `a ${level} orders a salvo at men on its mark`);
      assert.ok(salvos[0].tick - at < REGISTER.salvoEvery + 10 * 60, "and once its last salvo is 20 s old");
      for (let k = 1; k < salvos.length; k++) assert.ok(salvos[k].tick - salvos[k - 1].tick >= REGISTER.salvoEvery, "never twice within 20 s");
    } else assert.equal(salvos.length, 0, `${level} ${JSON.stringify(over ?? {})} sends no salvo`);
    m.free();
  }
});

test("a Knight with a bridge down sends a wave down that road", () => {
  const team = Team.Enemy;
  const { m, ai, sent } = setup("knight", team, 7);
  m.gold[team] = 3000;
  // The centre bridge blown at the start, as the sim's bridge tests do.
  const s = BRIDGES[1];
  m.world.explode(s.x + 0.3, DECK_TOP - 0.4, s.z + 0.5);
  for (let i = 0; i < 240; i++) m.step();
  assert.deepEqual(m.army.bridgeOpen, [true, false, true]);
  for (let i = 0; i < 4 * 60 * 60; i++) {
    ai.step();
    m.step();
    if (sent.some((x) => x.input.kind === "barracks" && x.input.route === ROUTE_NAMES[1])) break;
  }
  assert.ok(sent.some((x) => x.input.kind === "barracks" && x.input.route === ROUTE_NAMES[1]), "a barracks was sent down the road of the downed bridge");
  m.free();
});
