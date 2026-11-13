// The AI and powder (3.3): the gunner never sends a fire the rules refuse for want of powder and prefers
// a gun whose box holds two shots; the steward buys powder under 20 and not above, rebuilds a lost magazine before
// anything else; a Knight's raid goes for a stocked enemy magazine.

import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, POWDER, shotCost, type WeaponKind } from "@keepfall/content";
import { PlotState, type Rapier } from "@keepfall/sim";
import { firstSlot, Match, Team, type MatchInput } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);

/** Test-only reach into the store and the boxes (the world offers no way to set them). */
const stockOf = (m: Match) => m.world.carriers as unknown as { stock: [number, number]; boxes: number[] };
const setStock = (m: Match, team: number, n: number) => (stockOf(m).stock[team] = n);

/** The inputs a team's AI queues, with the match tick they were sent on. */
function spy(m: Match, team: number): Array<[number, MatchInput]> {
  const seen: Array<[number, MatchInput]> = [];
  const q = m.queue.bind(m);
  m.queue = (tick, t, input) => {
    if (t === team) seen.push([m.tick, input]);
    q(tick, t, input);
  };
  return seen;
}

test("six minutes of Knight against Knight: every fire the AI queues is paid for, and it buys powder only while its stock is under 20", () => {
  const m = new Match(R, layout, { seed: 11, plan: false, rotate: false });
  const ais = [new AiPlayer(m, Team.Enemy, "knight", 11), new AiPlayer(m, Team.Player, "knight", 11)];
  const fires = [0, 0], dry: string[] = [], buys: Array<[number, number, number]> = [];
  const q = m.queue.bind(m);
  m.queue = (tick, team, input) => {
    if (input.kind === "fire") {
      fires[team]++;
      // The box the fire will meet: nothing but a boy's keg (more) or a salvo (not while it waits for its own shot) changes it in between.
      if (!m.world.carriers!.canPay(input.emplacement)) dry.push(`team ${team} gun ${input.emplacement} at ${m.tick}`);
    }
    if (input.kind === "powder") buys.push([m.tick, team, m.world.carriers!.status(team).stock]);
    q(tick, team, input);
  };
  for (let i = 0; i < 6 * 60 * 60 && !m.result; i++) {
    for (const ai of ais) ai.step();
    m.step();
  }
  m.step();
  assert.deepEqual(dry, [], "no fire sent for a box that cannot pay");
  for (const team of [0, 1]) assert.equal(m.shots[team], fires[team], `team ${team}: every fire it sent was fired`);
  assert.ok(fires[0] + fires[1] >= 20, `${fires[0] + fires[1]} fires`);
  for (const [tick, team, stock] of buys) assert.ok(stock < 20, `team ${team} bought at ${tick} with ${stock} in store`);
  console.log("fires", fires, "buys", buys.length, "applied powder", m.applied.filter((a) => a[2] === "powder").length);
  m.free();
});

test("the steward buys powder when its stock is under 20 and leaves it alone above", () => {
  for (const [stock, bought] of [[30, false], [19, true]] as const) {
    const m = new Match(R, layout, { seed: 5, plan: false, rotate: false, barracks: false });
    const team = Team.Player;
    const ai = new AiPlayer(m, team, "knight", 5);
    m.gold[team] = 3000;
    setStock(m, team, stock);
    // Keep the stock where the test put it (boys take kegs, mills add charges): only the AI's buy raises it.
    const sent = spy(m, team);
    for (let i = 0; i < 10 * 60; i++) {
      setStock(m, team, stock);
      ai.step();
      m.step();
    }
    const asked = sent.filter(([, input]) => input.kind === "powder").length;
    assert.equal(asked > 0, bought, `stock ${stock}: ${asked} buys asked`);
    assert.equal(m.applied.some((a) => a[1] === team && a[2] === "powder"), bought);
    m.free();
  }
});

test("it does not buy powder without the gold above the price and its reserve", () => {
  const m = new Match(R, layout, { seed: 5, plan: false, rotate: false, barracks: false });
  const team = Team.Player;
  const ai = new AiPlayer(m, team, "knight", 5);
  const sent = spy(m, team);
  setStock(m, team, 5);
  m.gold[team] = POWDER.buy.gold + ai.level.reserve - 1;
  for (let i = 0; i < 60; i++) {
    m.gold[team] = POWDER.buy.gold + ai.level.reserve - 1;
    ai.step();
    m.step();
  }
  assert.equal(sent.filter(([, input]) => input.kind === "powder").length, 0, "no buy a gold short");
  m.free();
});

test("with its magazine blown it asks to rebuild the magazine before any other build", () => {
  const m = new Match(R, layout, { seed: 6, plan: false, rotate: false, barracks: false });
  const team = Team.Player;
  const ai = new AiPlayer(m, team, "knight", 6);
  const st = m.world.structures!;
  const sent = spy(m, team);
  m.gold[team] = 5000;
  assert.equal(st.slot(team, 5).state, PlotState.Standing);
  // Wreck the magazine with a hit on every one of its pieces (it goes up with its powder: the world's own rule).
  for (let i = 0; i < 30 && st.slot(team, 5).state !== PlotState.Ruined; i++) {
    for (const id of st.slot(team, 5).ids) m.world.castle.knockLoose(id, 0, -40, 0);
    m.step();
  }
  assert.equal(st.slot(team, 5).state, PlotState.Ruined, "the magazine is a ruin");
  const from = sent.length;
  for (let i = 0; i < 12 * 60; i++) {
    ai.step();
    m.step();
  }
  const builds = sent.slice(from).filter(([, input]) => input.kind === "build" || input.kind === "buy" || input.kind === "upgrade");
  assert.ok(builds.length > 0, "it built something");
  const first = builds[0][1];
  assert.deepEqual(first, { kind: "build", plot: 5, building: "magazine" }, "the magazine first");
  m.free();
});

test("with no magazine anywhere it builds a new one on a free plot, back plots first", () => {
  const m = new Match(R, layout, { seed: 6, plan: false, rotate: false, barracks: false, startBuildings: [[], []] });
  const team = Team.Player;
  const ai = new AiPlayer(m, team, "knight", 6);
  const sent = spy(m, team);
  m.gold[team] = 5000;
  assert.equal(m.estate.magazine(team), -1);
  for (let i = 0; i < 6 * 60; i++) {
    ai.step();
    m.step();
  }
  const first = sent.map(([, input]) => input).find((input) => input.kind === "build" || input.kind === "buy" || input.kind === "upgrade");
  assert.deepEqual(first, { kind: "build", plot: 5, building: "magazine" });
  m.free();
});

/** A castle's guns of a kind (emplacement ids), arming slots with the kind until there are two. */
function twoGuns(m: Match, team: number, kind: WeaponKind): number[] {
  const ids = (): number[] => m.emplacements.filter((e) => !e.empty && e.weapon === kind && e.id >= firstSlot(team) && e.id < firstSlot(team) + 8).map((e) => e.id);
  for (let s = 0; s < 8 && ids().length < 2; s++) {
    const e = m.emplacements[firstSlot(team) + s];
    if (e.empty && (e.allowed ?? []).includes(kind)) m.estate.buy(team, e.id, kind);
  }
  return ids();
}

test("the gunner never picks a gun whose box cannot pay, and prefers a gun whose box holds two shots", () => {
  const m = new Match(R, layout, { seed: 9, plan: false, rotate: false, barracks: false });
  const team = Team.Player;
  m.gold[team] = 5000;
  const ai = new AiPlayer(m, team, "knight", 9);
  const ids = twoGuns(m, team, "longGun");
  assert.ok(ids.length >= 2, "two long guns");
  const [a, b] = ids;
  const soonest = (): number | undefined =>
    (ai.gunner as unknown as { soonest(k: WeaponKind): { id: number } | null }).soonest("longGun")?.id;
  const cost = shotCost(m.emplacements[a]);
  const box = stockOf(m).boxes;
  box[a] = box[b] = 2 * cost;
  assert.ok(soonest() !== undefined);
  // One cannot pay: it is the other.
  box[a] = cost - 1;
  box[b] = cost;
  assert.equal(soonest(), b);
  // Neither can pay: none.
  box[b] = cost - 1;
  assert.equal(soonest(), undefined);
  // One holds a single shot and the other two: the two-shot gun, whichever is ready first.
  box[a] = cost;
  box[b] = 2 * cost;
  assert.equal(soonest(), b);
  box[a] = 2 * cost;
  box[b] = cost;
  assert.equal(soonest(), a);
  m.free();
});

test("a Knight's raid goes for the enemy magazine when it holds 80 charges or more, and not below", () => {
  const m = new Match(R, layout, { seed: 4, plan: false, rotate: false, barracks: false });
  const knight = Team.Player, foe = Team.Enemy;
  const ai = new AiPlayer(m, knight, "knight", 4);
  m.gold[foe] = 5000;
  // The foe has a mill, a barracks and a magazine standing, so only the stock decides.
  m.estate.build(foe, 1, "mill", 0);
  m.estate.build(foe, 2, "barracks", 0);
  for (let i = 0; i < 40 * 60; i++) m.step();
  const st = m.world.structures!;
  assert.equal(st.slot(foe, 5).state, PlotState.Standing);
  const target = () => (ai.gunner as unknown as { shellTarget(): { key: number } }).shellTarget().key;
  const keys = (n: number) => new Set(Array.from({ length: n }, target));
  setStock(m, foe, 90);
  assert.ok(keys(80).has(10 + 5), "a raid on plot 5 (the magazine) at 90 charges");
  assert.ok(!keys(200).has(10 + 1) && !keys(200).has(10 + 0), "and then only the magazine: no mill or barracks");
  setStock(m, foe, 79);
  const low = keys(200);
  assert.ok(!low.has(10 + 5), "not the magazine at 79 charges");
  assert.ok(low.has(10 + 1) || low.has(10 + 0), "a mill or barracks instead");
  m.free();
});
