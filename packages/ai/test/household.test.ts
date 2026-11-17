// 3.6 The household, the AI's side: the steward says who its reserve replaces first (by what it is short of, and only on a
// change, from a Knight up), the counter goes after the enemy gun with the most skilled crew (and leaves an uncrewed one
// alone), the gunner rides its best crew's gun when two would do, and the AI's counts leave the household out.

import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { AI_LEVELS, buildLayout, crewPostXZ, GAME_LAYOUT, HOUSEHOLD, SLOTS_PER_CASTLE, StationKind, type AiName } from "@keepfall/content";
import { isWorker, MinionState, type Household, type Rapier } from "@keepfall/sim";
import { firstSlot, Match, Team, type MatchInput } from "@keepfall/rules";
import { AiPlayer, standing } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const ME = Team.Player; // castle 1: the AI under test
const FOE = Team.Enemy; // castle 0: idle

function setup(level: AiName, seed = 5) {
  const m = new Match(R, layout, { seed, plan: false, rotate: false, barracks: false });
  const ai = new AiPlayer(m, ME, level, seed);
  const sent: Array<{ tick: number; input: MatchInput }> = [];
  const q = m.queue.bind(m);
  m.queue = (tick, t, input) => {
    if (t === ME) sent.push({ tick, input });
    q(tick, t, input);
  };
  return { m, ai, sent, h: m.world.household! };
}

type Priv = {
  lose(si: number, k: number, tick: number): void;
};
const lose = (h: Household, team: number, kind: StationKind, index: number, seat = 0) => {
  const si = h.stations.findIndex((s) => s.team === team && s.kind === kind && s.index === index);
  assert.ok(si >= 0);
  (h as unknown as Priv).lose(si, seat, 0);
};
const station = (h: Household, team: number, kind: StationKind, index: number) => h.stations.find((s) => s.team === team && s.kind === kind && s.index === index)!;
const armed = (m: Match, team: number) => {
  const out = [];
  for (let i = firstSlot(team); i < firstSlot(team) + SLOTS_PER_CASTLE; i++) if (!m.emplacements[i].empty) out.push(m.emplacements[i]);
  return out;
};
/** A crew's shots (both men), to give a gun a skill level. */
function train(h: Household, emp: number, shots: number) {
  for (const seat of station(h, emp < SLOTS_PER_CASTLE ? ME : FOE, StationKind.Gun, emp).seats) if (seat.person >= 0) h.people[seat.person].shots = shots;
}
/** Pieces down that its masons may mend (the works status says so). */
function piecesDown(m: Match, left: number) {
  const w = m.world.works!;
  const real = w.status.bind(w);
  w.status = (c: number) => ({ ...real(c), left });
}
const drain = (m: Match) => {
  const boxes = (m.world.carriers as unknown as { boxes: number[] }).boxes;
  for (const e of armed(m, ME)) boxes[e.id] = 0;
};
const household = (sent: Array<{ tick: number; input: MatchInput }>) => sent.filter((s) => s.input.kind === "household").map((s) => (s.input as { first: string }).first);

test("the steward sends walls with two masons lost and pieces down, powder with two boys lost and a gun that cannot pay, else guns, and only on a change", () => {
  const { m, ai, sent, h } = setup("knight");
  const st = ai.steward;
  assert.equal(st.chooseFirst(), "guns");
  st.look(600);
  assert.deepEqual(household(sent), [], "nothing to say at the start: guns is what the match starts at");
  // Two masons lost, nothing to mend: still guns.
  lose(h, ME, StationKind.Mason, 0);
  lose(h, ME, StationKind.Mason, 1);
  assert.equal(st.chooseFirst(), "guns", "no pieces down: the masons have nothing to do");
  // Pieces down: walls (sent once, not again at the next looks).
  piecesDown(m, 5);
  assert.equal(st.chooseFirst(), "walls");
  st.look(1300);
  st.look(2000);
  st.look(2700);
  assert.deepEqual(household(sent), ["walls"]);
  // One mason lost is not enough.
  const fresh = setup("knight");
  lose(fresh.h, ME, StationKind.Mason, 0);
  piecesDown(fresh.m, 5);
  assert.equal(fresh.ai.steward.chooseFirst(), "guns");
  // Back to guns when the work is done.
  piecesDown(m, 0);
  st.look(3400);
  assert.deepEqual(household(sent), ["walls", "guns"]);
  // Two boys lost, every gun's box full: guns. A gun that cannot pay: powder.
  lose(h, ME, StationKind.Boy, 0);
  lose(h, ME, StationKind.Boy, 1);
  assert.equal(st.chooseFirst(), "guns", "no gun is short of powder");
  drain(m);
  assert.equal(st.chooseFirst(), "powder");
  st.look(4100);
  st.look(4800);
  assert.deepEqual(household(sent), ["walls", "guns", "powder"]);
  // One boy lost is not enough.
  const one = setup("knight");
  lose(one.h, ME, StationKind.Boy, 2);
  drain(one.m);
  assert.equal(one.ai.steward.chooseFirst(), "guns");
});

test("walls win over powder, and a seasoned crew short a man keeps guns first over powder (but not over walls)", () => {
  const { m, ai, h } = setup("knight");
  const st = ai.steward;
  lose(h, ME, StationKind.Boy, 0);
  lose(h, ME, StationKind.Boy, 1);
  drain(m);
  assert.equal(st.chooseFirst(), "powder");
  // A seasoned crew with a man down: guns.
  const gun = armed(m, ME)[0];
  train(h, gun.id, 35);
  lose(h, ME, StationKind.Gun, gun.id, 1);
  assert.equal(st.chooseFirst(), "guns", "its seasoned crew comes first");
  // With every mason lost and pieces down: walls.
  for (let k = 0; k < 4; k++) lose(h, ME, StationKind.Mason, k);
  piecesDown(m, 4);
  assert.equal(st.chooseFirst(), "walls");
  // A green crew short a man is not protected.
  const g2 = setup("knight");
  lose(g2.h, ME, StationKind.Boy, 0);
  lose(g2.h, ME, StationKind.Boy, 1);
  drain(g2.m);
  const e2 = armed(g2.m, ME)[0];
  train(g2.h, e2.id, 2);
  lose(g2.h, ME, StationKind.Gun, e2.id, 1);
  assert.equal(g2.ai.steward.chooseFirst(), "powder");
});

test("the Squire and the tutor never send the household input, whatever they are short of", () => {
  for (const level of ["squire", "tutor"] as const) {
    assert.equal(AI_LEVELS[level].household, false);
    const { m, ai, sent, h } = setup(level);
    lose(h, ME, StationKind.Mason, 0);
    lose(h, ME, StationKind.Mason, 1);
    piecesDown(m, 5);
    for (let t = 600; t < 6000; t += 600) ai.steward.look(t);
    assert.deepEqual(household(sent), [], level);
  }
  assert.equal(AI_LEVELS.knight.household, true);
  assert.equal(AI_LEVELS.warlord.household, true);
});

test("the household input the steward sends is applied by the match", () => {
  const { m, ai, h } = setup("knight");
  lose(h, ME, StationKind.Mason, 0);
  lose(h, ME, StationKind.Mason, 1);
  piecesDown(m, 5);
  ai.steward.look(m.tick + 1);
  for (let i = 0; i < 5; i++) m.step();
  assert.equal(h.first[ME], "walls");
});

type Counter = { threat(tick: number): { id: number } | null; hurtBy: Map<number, number> };

test("the counter goes after the enemy gun that hurts it with the more skilled crew; an uncrewed enemy gun not ridden is never chosen", () => {
  const { m, ai, h } = setup("knight");
  const g = ai.gunner as unknown as Counter;
  const guns = armed(m, FOE);
  assert.ok(guns.length >= 3);
  const [a, b, c] = guns;
  train(h, a.id, 10);
  train(h, b.id, 35);
  train(h, c.id, 5);
  const tick = 1000;
  // Both hurt it; b has the crew of more skill, a was the last to hit it.
  g.hurtBy.set(a.id, tick - 60);
  g.hurtBy.set(b.id, tick - 600);
  assert.equal(g.threat(tick)?.id, b.id, "the seasoned crew first, though a hit last");
  // b's crew is swept away: it is left alone, and a is the one.
  lose(h, FOE, StationKind.Gun, b.id, 0);
  lose(h, FOE, StationKind.Gun, b.id, 1);
  assert.equal(h.crew(b.id), 0);
  assert.equal(g.threat(tick)?.id, a.id, "an uncrewed gun is passed over");
  // Only the uncrewed gun hurts it: nothing to go after.
  g.hurtBy.delete(a.id);
  assert.equal(g.threat(tick), null, "an uncrewed gun that is not ridden is never chosen");
  // Ridden by the enemy, it is a target all the same.
  m.manned[FOE] = b.id;
  assert.equal(g.threat(tick)?.id, b.id);
  m.manned[FOE] = -1;
  // Hits older than 20 s do not count.
  g.hurtBy.set(a.id, tick - 21 * 60);
  assert.equal(g.threat(tick), null);
});

test("with nothing hurting it, a seasoned crew may be the counter's target; a trained one is not", () => {
  const { m, ai, h } = setup("knight");
  const g = ai.gunner as unknown as Counter;
  const guns = armed(m, FOE);
  for (const e of guns) train(h, e.id, 10);
  assert.equal(g.threat(1000), null, "trained crews that have not hit it are left alone");
  train(h, guns[1].id, 30);
  train(h, guns[2].id, 65);
  assert.equal(g.threat(1000)?.id, guns[2].id, "the veteran crew before the seasoned one");
  lose(h, FOE, StationKind.Gun, guns[2].id, 0);
  lose(h, FOE, StationKind.Gun, guns[2].id, 1);
  assert.equal(g.threat(1000)?.id, guns[1].id);
});

test("with two long guns ready within a second, the gunner rides the one with the full trained crew over a green or short one", () => {
  const { m, ai, h } = setup("knight");
  const gn = ai.gunner as unknown as { soonest(kind: string): { id: number } | null; longGuns(): Array<{ id: number }> };
  m.gold[ME] += 2000;
  const longs = () => armed(m, ME).filter((e) => e.weapon === "longGun");
  for (let s = 0; s < SLOTS_PER_CASTLE && longs().length < 2; s++) {
    const e = m.emplacements[firstSlot(ME) + s];
    if (e.empty && (e.allowed ?? []).includes("longGun")) m.estate.buy(ME, e.id, "longGun");
  }
  const [x, y] = longs();
  assert.ok(x && y, "two long guns");
  for (const e of [x, y]) assert.equal(h.crew(e.id), 2);
  // Both full crews: the one ready first (they are equal here: the lower id).
  m.world.reload[x.id] = 0;
  m.world.reload[y.id] = 0;
  train(h, x.id, 10);
  train(h, y.id, 10);
  const full = gn.soonest("longGun")!.id;
  assert.ok(full === x.id || full === y.id);
  const other = full === x.id ? y : x;
  // The other has a green crew, then a short one, and is ready 0.5 s sooner: the full trained crew still goes.
  const gun = full === x.id ? x : y;
  m.world.reload[gun.id] = 30;
  m.world.reload[other.id] = 0;
  train(h, other.id, 0);
  assert.equal(gn.soonest("longGun")!.id, gun.id, "trained over green");
  assert.equal(gn.longGuns()[0].id, gun.id);
  train(h, other.id, 10);
  lose(h, ME, StationKind.Gun, other.id, 1);
  assert.equal(h.crew(other.id), 1);
  assert.equal(gn.soonest("longGun")!.id, gun.id, "two men over one");
  // More than a second sooner: the readier one goes.
  m.world.reload[gun.id] = 200;
  assert.equal(gn.soonest("longGun")!.id, other.id, "readiness beats the crew beyond a second");
  // With no crew at it, a gun is not ridden while one with a crew would do, however sooner.
  lose(h, ME, StationKind.Gun, other.id, 0);
  assert.equal(h.crew(other.id), 0);
  m.world.reload[gun.id] = 400;
  assert.equal(gn.soonest("longGun")!.id, gun.id, "never an uncrewed gun when one with a crew would do");
  // Alone, an uncrewed gun is still ridden.
  lose(h, ME, StationKind.Gun, gun.id, 0);
  lose(h, ME, StationKind.Gun, gun.id, 1);
  assert.ok(gn.soonest("longGun"));
});

test("the household stands outside the AI's counts of fighting men", () => {
  const { m } = setup("knight");
  let fighters = 0, all = 0, workers = 0;
  for (const mi of m.world.minions.list) {
    if (mi.team !== ME || mi.state !== MinionState.Upright) continue;
    all++;
    if (isWorker(mi)) workers++;
    else fighters++;
  }
  assert.ok(workers >= 2 * HOUSEHOLD.gunCrew, `${workers} household and masons stand`);
  assert.equal(standing(m, ME), fighters);
  assert.ok(standing(m, ME) < all);
});

test("the counter's chain shot is laid between the layer and the loader of the gun on a wall, and the rest starts once its crew is gone", () => {
  const m = new Match(R, layout, { seed: 5, plan: false, rotate: false, barracks: false });
  const ai = new AiPlayer(m, ME, "knight", 5, { level: { counter: 1, marks: 0, raids: false } });
  const h = m.world.household!;
  const g = ai.gunner as unknown as Counter & { think(tick: number): void; target: { x: number; y: number; z: number } | null; watch(tick: number): void; counterUntil: number };
  const wall = armed(m, FOE).find((e) => e.weapon === "longGun")!;
  assert.ok(wall.y > 5);
  const tick = 10 * 60;
  m.step();
  g.hurtBy.set(wall.id, tick);
  for (const e of armed(m, ME)) m.world.reload[e.id] = 0;
  g.think(tick);
  assert.ok(g.target, "it went after the gun");
  const a = crewPostXZ(wall, 0), b = crewPostXZ(wall, 1);
  assert.ok(Math.abs(g.target!.x - (a.x + b.x) / 2) < 1e-9 && Math.abs(g.target!.z - (a.z + b.z) / 2) < 1e-9, "between its two men");
  // Its crew swept away, the counter rests as a knock-out made it rest.
  g.watch(tick + 1);
  assert.equal(g.counterUntil, 0, "not while the crew stands");
  lose(h, FOE, StationKind.Gun, wall.id, 0);
  lose(h, FOE, StationKind.Gun, wall.id, 1);
  g.watch(tick + 2);
  assert.equal(g.counterUntil, tick + 2 + AI_LEVELS.knight.counterRest);
});
