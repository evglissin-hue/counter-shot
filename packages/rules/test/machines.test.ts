// 3.5 machines, the rules' side: the bell's reach, the spotter's tower and the marks, and which plots take which building.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BELL, BUILDING_KINDS, BUILDINGS, buildLayout, ENEMY_PLAN, GAME_LAYOUT, MUSTER, ORGAN_KINDS, SPOTTER, type BuildingKind } from "@keepfall/content";
import { PlotState, type Rapier } from "@keepfall/sim";
import { Match, Team } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);

const quiet = { barracks: false, garrison: false, masons: false, plan: false } as const;
const newMatch = (seed = 3, opts: Record<string, unknown> = {}) => {
  const m = new Match(R, layout, { seed, ...quiet, ...opts });
  m.world.wind.x = m.world.wind.z = 0;
  return m;
};
const BELL_I = ORGAN_KINDS.indexOf("bell");
const bellOf = (m: Match, team: number) => layout.organs[team * ORGAN_KINDS.length + BELL_I];

function dust(m: Match, ids: number[]) {
  for (const id of ids) (m.world.castle as unknown as { shatter(id: number): void }).shatter(id);
}
function bellDown(m: Match, team: number) {
  const o = bellOf(m, team);
  dust(m, [o.key]);
  for (let i = 0; i < 12; i++) m.step();
  assert.ok(!m.organUp(team === 0 ? Team.Enemy : Team.Player, "bell"), "the bell is down");
}
function bellUp(m: Match, team: number) {
  const o = bellOf(m, team);
  m.world.castle.restore(o.key);
  for (let i = 0; i < 12; i++) m.step();
  assert.ok(m.organUp(team === 0 ? Team.Enemy : Team.Player, "bell"), "the bell is back");
}

/** Does any gun of the player's lay on an enemy man put at `dist` m (along the road) from its muster, within `ticks`? */
function lays(m: Match, dist: number, ticks = 90): boolean {
  const g = MUSTER[Team.Player];
  m.world.minions.list.length;
  m.army.spawnWave(Team.Enemy, 1, 4, { x: g.x, z: g.z + g.dir * dist });
  // Hold them where they stand: nothing moves them while the gun looks.
  for (let i = 0; i < ticks; i++) {
    m.step();
    if (m.guns.some((u, id) => m.emplacements[id] && u.target >= 0 && (m as unknown as { owner: number[] }).owner[id] === Team.Player)) return true;
  }
  return false;
}

test("the bell: with it down a gun nobody mans engages only within 20 m of its gate, and marks do nothing for it; with it back, 45 m returns", () => {
  const run = (dist: number, bell: "up" | "down" | "back", marked = false) => {
    const m = newMatch(5, { gunnery: [false, true] });
    if (bell !== "up") bellDown(m, Team.Player);
    if (bell === "back") bellUp(m, Team.Player);
    if (marked) {
      const g = MUSTER[Team.Player];
      const x = g.x, z = g.z + g.dir * dist;
      m.register.landings[0] = { x, y: m.world.terrain.heightAt(x, z), z, tick: m.tick };
      assert.ok(m.register.makeMark(Team.Player, 0, m.tick));
    }
    const r = lays(m, dist);
    m.free();
    return r;
  };
  assert.equal(run(30, "up"), true, "bell up: a man 30 m from the gate is engaged");
  assert.equal(run(30, "down"), false, "bell down: not at 30 m");
  assert.equal(run(12, "down"), true, "bell down: still at 12 m");
  assert.equal(run(70, "up", true), true, "bell up: a man on a mark 70 m out is engaged");
  assert.equal(run(70, "down", true), false, "bell down: marks do nothing for the gun");
  assert.equal(run(30, "back"), true, "the bell put back: 45 m returns");
  assert.ok(BELL.late < 30 && 30 < BELL.defend);
});

test("a salvo is not changed by the bell", () => {
  const m = newMatch(5);
  bellDown(m, Team.Player);
  const x = 46, z = -45;
  m.register.landings[0] = { x, y: m.world.terrain.heightAt(x, z), z, tick: m.tick };
  assert.ok(m.register.makeMark(Team.Player, 0, m.tick));
  m.queue(m.tick, Team.Player, { kind: "salvo", mark: 1, mortar: false });
  m.step();
  assert.ok(m.register.queued.length > 0 || m.register.salvoAt[Team.Player] > 0, "the salvo was ordered");
  m.free();
});

/** A match with the player's castle holding a spotter's tower or not. */
function spotterMatch(tower: boolean) {
  const start = [{ plot: 5, kind: "barracks" as const }, { plot: 3, kind: "magazine" as const }, ...(tower ? [{ plot: 7, kind: "spotter" as const }] : [])];
  return newMatch(3, { gunnery: false, startBuildings: [start, start] });
}
function markAt(m: Match, x: number, z: number, emp = 0, team = 1): boolean {
  m.register.landings[emp] = { x, y: m.world.terrain.heightAt(x, z), z, tick: m.tick };
  return m.register.makeMark(team, emp, m.tick);
}

test("the spotter's tower: without it a mark lasts 90 s and serves only its own gun; with it 240 s and every gun that bears", () => {
  const alone = spotterMatch(false);
  assert.equal(alone.spotter(Team.Player), false);
  assert.ok(markAt(alone, 46, -45));
  const mk = alone.register.list(Team.Player)[0];
  assert.equal(mk.fades - mk.made, SPOTTER.lifeAlone);
  assert.equal(mk.life, SPOTTER.lifeAlone);
  assert.deepEqual(alone.register.bearing(Team.Player, 1, true), [0], "only the gun that made it");
  assert.equal(alone.register.onMark(Team.Player, 46, -45, 0), true);
  assert.equal(alone.register.onMark(Team.Player, 46, -45, 2), false, "another gun does not share it");
  alone.free();

  const m = spotterMatch(true);
  assert.equal(m.spotter(Team.Player), true);
  assert.ok(markAt(m, 46, -45));
  const k = m.register.list(Team.Player)[0];
  assert.equal(k.fades - k.made, SPOTTER.life);
  assert.equal(k.life, SPOTTER.life);
  const all = m.register.bearing(Team.Player, 1, true);
  assert.ok(all.length >= 3 && all.includes(0) && all.includes(2), `${all.length} guns bear`);
  assert.equal(m.register.onMark(Team.Player, 46, -45, 2), true, "every gun shares it");

  // Losing the tower cuts the 240 s mark to at most 90 s from then.
  const slot = m.world.structures!.slot(Team.Player, 7);
  dust(m, slot.ids);
  for (let i = 0; i < 12; i++) m.step();
  assert.equal(m.spotter(Team.Player), false, "the tower is gone");
  for (let i = 0; i < 2; i++) m.step();
  const cut = m.register.list(Team.Player)[0];
  assert.ok(cut, "the mark is still there");
  assert.ok(cut.fades - m.tick <= SPOTTER.lifeAlone, `${cut.fades - m.tick} ticks left`);
  assert.deepEqual(m.register.bearing(Team.Player, 1, true), [0], "and it serves only its own gun again");
  // A landing inside refreshes it to the short life.
  m.world.landings.push({ emplacement: 0, x: 46, y: 0, z: -45, auto: false } as never);
  m.register.afterStep(m.tick);
  m.world.landings.length = 0;
  assert.equal(cut.life, SPOTTER.lifeAlone);
  assert.equal(cut.fades, m.tick + SPOTTER.lifeAlone);
  m.free();
});

test("without a spotter's tower a mark fades after 90 s; with one it lasts 240 s", () => {
  const run = (tower: boolean, ticks: number) => {
    const m = spotterMatch(tower);
    assert.ok(markAt(m, 46, -45));
    for (let i = 0; i < ticks; i++) m.step();
    const n = m.register.list(Team.Player).length;
    m.free();
    return n;
  };
  assert.equal(run(false, SPOTTER.lifeAlone - 5), 1);
  assert.equal(run(false, SPOTTER.lifeAlone + 5), 0);
  assert.equal(run(true, SPOTTER.lifeAlone + 5), 1);
});

const plots = (m: Match, team: number) => m.world.structures!.plots.slice(team * 8, team * 8 + 8);

test("estate: a build is refused on a plot its kind may not take; a spotter's tower on plot 7 rises", () => {
  const m = newMatch(3, { startBuildings: [[], []] });
  m.gold[1] = 5000;
  const st = m.world.structures!;
  const attempt = (plot: number, building: BuildingKind) => {
    const gold = m.gold[1];
    m.queue(m.tick, Team.Player, { kind: "build", plot, building });
    m.step();
    return m.gold[1] < gold || st.slot(1, plot).state !== PlotState.Empty;
  };
  for (const p of [6, 7]) assert.equal(attempt(p, "barracks"), false, `no barracks on plot ${p}`);
  for (const p of [0, 1, 2, 3]) assert.equal(attempt(p, "spotter"), false, `no spotter's tower on plot ${p}`);
  for (const p of [0, 1]) assert.equal(attempt(p, "magazine"), false, `no magazine on plot ${p}`);
  assert.equal(plots(m, 1).every((s) => s.state === PlotState.Empty), true, "nothing was built");
  assert.equal(m.spotter(Team.Player), false);
  assert.equal(attempt(7, "spotter"), true, "a spotter's tower on plot 7 is built");
  for (let i = 0; i < BUILDINGS.spotter.buildTicks + 120; i++) m.step();
  assert.equal(st.slot(1, 7).state, PlotState.Standing);
  assert.equal(m.spotter(Team.Player), true, "spotter(team) turns true");
  assert.equal(BUILDING_KINDS.includes("spotter"), true);
  m.free();
});

test("estate: the enemy's scripted plan passes over a step on a plot its kind may not take", () => {
  const bad = { at: 0, kind: "build", plot: 6, building: "barracks" } as const;
  ENEMY_PLAN.unshift(bad);
  try {
    const m = new Match(R, layout, { seed: 4, barracks: false, garrison: false, masons: false });
    const est = (m as unknown as { estate: { planStep: number } }).estate;
    m.gold[0] = 5000;
    for (let i = 0; i < 61; i++) m.step();
    assert.ok(est.planStep >= 1, "the plan moved past the step");
    assert.equal(m.world.structures!.slot(0, 6).state, PlotState.Empty, "nothing was built there");
    assert.equal(m.economy.spent[0], 0, "and nothing was paid");
    m.free();
  } finally {
    ENEMY_PLAN.shift();
  }
});
