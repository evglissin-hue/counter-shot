// 3.4 The keep falls by engineering: the AI cuts the enemy keep and defends its own, through the inputs a player sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { AI_LEVELS, BUTTRESS_FACES, buildLayout, CASTLE_SHAPE, GAME_LAYOUT, KEEP_STOREYS, keepStructure, mirrorZ, structureList } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, StaticState, type Rapier } from "@keepfall/sim";
import { Match, Team, type MatchInput } from "@keepfall/rules";
import { AIM_GROUPS, AiPlayer, FOOT_COURSES, gateLeaves } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const L = structureList(layout);
const FOE = 0; // the castle at the origin: the idle one
const ME = Team.Player; // castle 1: the AI under test
const KEEP = keepStructure(FOE);
const FOOT_Y = (KEEP_STOREYS[0] - 1) * CASTLE_SHAPE.course;
const CUT = AIM_GROUPS.indexOf("cut");
const OPEN = AIM_GROUPS.indexOf("open");

const match = (seed: number) => new Match(R, layout, { seed, plan: false, rotate: false, barracks: false });
const knockGate = (m: Match, castle: number) => {
  for (const id of gateLeaves(m)[castle]) m.world.castle.knockLoose(id, 0, 0, 0);
};

/** Play an AI (castle 1) against an idle castle; each tick calls `each`. */
function play(m: Match, ai: AiPlayer, ticks: number, each?: (tick: number) => void) {
  for (let i = 0; i < ticks && !m.result; i++) {
    ai.step();
    m.step();
    each?.(m.tick);
  }
}

test("with the enemy gate off, a Knight gunner cuts the keep's foot and the keep's holds falls", () => {
  const m = match(5);
  knockGate(m, FOE);
  // A Knight that always cuts when it looks at the keep with a long gun (the share is its level's `cut`), aiming true so
  // its cut shots thread the narrow gateway rather than scattering off the wall (this watches the way it cuts, not its scatter).
  const ai = new AiPlayer(m, ME, "knight", 5, { level: { cut: 1, firstErr: 0, noise: 0, learn: 1 } });
  const kz = mirrorZ(FOE, CASTLE_SHAPE.keepZ), reach = CASTLE_SHAPE.keepHalf + 1.5;
  let footLandings = 0, minWeak = 99;
  play(m, ai, 3 * 60 * 60, () => {
    const s = m.world.statics!.status(KEEP);
    // The cut drives the keep's weakest course down to its foot (the floors are never shelled here).
    if (s.weakest >= 0 && s.holds < 0.95) minWeak = Math.min(minWeak, s.weakest);
    for (const l of m.world.landings) {
      if (l.auto || l.emplacement < 0 || m.emplacements[l.emplacement].z > -75) continue;
      // A hand shot that came down on the keep's footprint at its foot (the blast point of a shot into a foot piece reads a little above the stone's middle).
      if (Math.abs(l.x) <= reach && Math.abs(l.z - kz) <= reach && l.y < FOOT_Y + 2) footLandings++;
    }
  });
  const cut = ai.gunner.byAim[CUT];
  const holds = m.world.statics!.status(KEEP).holds;
  console.log("knight cuts: cut shots", cut, "open", ai.gunner.byAim[OPEN], "keep", ai.gunner.byAim[0], "foot landings", footLandings, "lowest weakest course", minWeak, "holds", holds.toFixed(2), "state", m.world.statics!.status(KEEP).state);
  assert.ok(cut >= 1, `${cut} shots by hand were cuts`);
  assert.ok(footLandings >= 1, `a shot by hand landed on the keep's foot`);
  assert.ok(minWeak < FOOT_COURSES, `the cut weakened a foot course (lowest weakest ${minWeak}, foot is under ${FOOT_COURSES})`);
  assert.ok(holds < 0.8 || m.world.statics!.status(KEEP).state !== StaticState.Standing, `the keep holds ${holds}`);
  m.free();
});

test("with the gate standing, a Knight that wants to cut shoots open first (at the gate's leaves)", () => {
  const m = match(7);
  const ai = new AiPlayer(m, ME, "knight", 7, { level: { cut: 1 } });
  const leaves = gateLeaves(m)[FOE];
  assert.ok(leaves.every((id) => !m.world.castle.dynamic[id]), "the gate stands");
  // Let the match set up and the guns be manned, with nothing yet shot down.
  for (let i = 0; i < 90; i++) {
    ai.step();
    m.step();
  }
  // Its long gun wants to cut, but the keep's foot cannot be seen through the standing gate: it opens the way (the gate's leaves).
  const pick = (ai.gunner as unknown as { cutPick(): { t: { key: number; x: number; y: number; z: number } } | null }).cutPick();
  assert.ok(pick, "it has a long gun and a choice");
  const AIM_OPEN = 4; // Aim.Open (a const enum: its value, so the test needs no runtime import of it)
  assert.equal(pick!.t.key, AIM_OPEN, `it opens the way rather than cutting (key ${pick!.t.key})`);
  // The gate's leaves: the shot is laid on the gate's middle, about y 2.5.
  const gz = leaves.reduce((s, id) => s + m.world.castle.layout.stones[id].z, 0) / leaves.length;
  assert.ok(Math.abs(pick!.t.x) < 1 && Math.abs(pick!.t.z - gz) < 2 && Math.abs(pick!.t.y - 2.5) < 1.5, `laid on the gate (${pick!.t.x}, ${pick!.t.y}, ${pick!.t.z})`);
  m.free();
});

test("a Squire never cuts or opens the way", () => {
  const m = match(9);
  knockGate(m, FOE);
  const ai = new AiPlayer(m, ME, "squire", 9);
  assert.equal(AI_LEVELS.squire.cut, 0);
  play(m, ai, 4 * 60 * 60);
  assert.ok(ai.gunner.shotsFired >= 3, `it fired ${ai.gunner.shotsFired} shots`);
  assert.equal(ai.gunner.byAim[CUT], 0);
  assert.equal(ai.gunner.byAim[OPEN], 0);
  m.free();
});

/** Cut a castle's front face (its owner's words) at courses 2 to 4, to within `half` m of the face's middle, through the castle's own hooks. */
function cutFront(m: Match, castle: number, half: number) {
  const ki = keepStructure(castle);
  for (const id of L[ki].stones) {
    const s = layout.stones[id];
    if (s.part !== "keep" || s.course < 2 || s.course > 4) continue;
    const f = castle === 0 ? -(s.z - L[ki].cz) : s.z - L[ki].cz;
    if (f > 3 && Math.abs(s.x - L[ki].cx) <= half && !m.world.castle.dynamic[id]) m.world.castle.dust(id);
  }
  m.world.castle.supportNow();
}

test("a Knight steward whose keep holds under 0.5 buys the buttress on the face being cut within 10 s; above 0.5 it does not", () => {
  for (const [half, low] of [[9, true], [3, false]] as const) {
    const m = match(11);
    m.gold[ME] = 1000;
    const ai = new AiPlayer(m, ME, "knight", 11);
    cutFront(m, ME, half);
    for (let i = 0; i < 40; i++) m.step();
    const st = m.world.statics!.status(keepStructure(ME));
    assert.equal(st.state, StaticState.Standing, "the cut leaves it standing");
    assert.equal(st.holds < 0.5, low, `holds ${st.holds} for a cut ${half} m either side of the middle`);
    // Its front is the face the keep would fall towards (castle 1 looks along +z).
    if (low) assert.ok(st.dirZ > 0.9, `it would fall towards its front: ${st.dirX}, ${st.dirZ}`);
    const sent: MatchInput[] = [];
    const q = m.queue.bind(m);
    m.queue = (tick, team, input) => {
      sent.push(input);
      q(tick, team, input);
    };
    play(m, ai, 10 * 60);
    const asked = sent.filter((i) => i.kind === "buttress");
    if (low) {
      assert.deepEqual(asked, [{ kind: "buttress", face: "front" }], "it bought the front buttress, and only that");
      assert.notEqual(m.buttress(ME, "front"), 0, "the buttress is going up");
      for (const f of BUTTRESS_FACES) if (f !== "front") assert.equal(m.buttress(ME, f), 0);
    } else {
      assert.equal(asked.length, 0, "a keep that holds well buys no buttress");
    }
    m.free();
  }
});

test("a Squire keeps its gold in its pocket: it buys no buttress either", () => {
  const m = match(13);
  m.gold[ME] = 1000;
  const ai = new AiPlayer(m, ME, "squire", 13);
  cutFront(m, ME, 9);
  play(m, ai, 30 * 60);
  for (const f of BUTTRESS_FACES) assert.equal(m.buttress(ME, f), 0);
  m.free();
});

test("Statics.whatIf changes no state: the hash and every status are the same before and after", () => {
  const m = match(15);
  // Damage the enemy keep a little, so there is something to judge.
  cutFront(m, FOE, 9);
  for (let i = 0; i < 20; i++) m.step();
  const st = m.world.statics!;
  const ki = keepStructure(FOE);
  const hash0 = m.hash(), json0 = JSON.stringify(L.map((d) => st.status(d.index)));
  const standing = L[ki].stones.filter((id) => !m.world.castle.dynamic[id] && layout.stones[id].part === "keep" && layout.stones[id].course < 10);
  const dynBefore = Array.from(m.world.castle.dynamic);
  const before = st.status(ki).holds;
  const forecast = st.whatIf(ki, standing);
  assert.ok(forecast.holds < before, `felling the foot would leave the keep holding less (${forecast.holds} against ${before})`);
  assert.equal(st.whatIf(ki, []).holds, before, "nothing removed, nothing changes");
  // A piece of another structure and ids that are no piece are ignored.
  const other = L[keepStructure(ME)].stones[0];
  assert.equal(st.whatIf(ki, [other, -1, 1e9]).holds, before);
  assert.deepEqual(m.hash(), hash0);
  assert.equal(JSON.stringify(L.map((d) => st.status(d.index))), json0);
  assert.deepEqual(Array.from(m.world.castle.dynamic), dynBefore);
  // And the match goes on exactly as one that was never asked.
  const twin = match(15);
  cutFront(twin, FOE, 9);
  for (let i = 0; i < 20; i++) twin.step();
  for (let i = 0; i < 120; i++) {
    m.step();
    twin.step();
  }
  assert.deepEqual(m.hash(), twin.hash());
  m.free();
  twin.free();
});

test("an untouched castle never strains: idle against idle for ten minutes", () => {
  const m = match(17);
  const events = (m.world as unknown as { events: number[] }).events;
  let seen = 0, strains = 0;
  for (let i = 0; i < 10 * 60 * 60 && !m.result; i++) {
    m.step();
    for (; seen + EVENT_STRIDE <= events.length; seen += EVENT_STRIDE) if (events[seen] === EventKind.Strain) strains++;
  }
  assert.equal(strains, 0, "no structure gave way");
  for (const d of L) assert.equal(m.world.statics!.status(d.index).holds, 1);
  m.free();
});
