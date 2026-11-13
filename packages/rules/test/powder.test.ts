// Powder in the match (3.3): the stock and its making, buying, a fire refused by an
// empty box, guns nobody mans that lay on nothing, a salvo that leaves a dry gun
// out, the keep match without powder, the magazine's rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BUILDINGS, buildLayout, GAME_LAYOUT, MATCH, POWDER, START_BUILDINGS, PRACTICE_BUILDINGS } from "@keepfall/content";
import { PlotState, Spin, Role, type Rapier } from "@keepfall/sim";
import { GUIDED_OPTIONS, Match, MATCH_OPTIONS, Team, teamOf, type MatchInput } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const quiet = (seed = 3, more: Record<string, unknown> = {}) => new Match(R, layout, { seed, barracks: false, plan: false, ...more });
const run = (m: Match, ticks: number, each?: (m: Match) => void) => {
  for (let i = 0; i < ticks; i++) {
    m.step();
    each?.(m);
  }
};
const MILL = 1;
const fire = (emplacement: number, pitch = 0.03): MatchInput => ({ kind: "fire", emplacement, yaw: 0, pitch, charge: 1, fuse: 0, spin: Spin.None });
const drain = (m: Match, id: number) => {
  while (m.world.carriers!.pay(id)) {
    /* empty its box */
  }
};
const long = (m: Match, team: Team) => m.emplacements.find((e) => !e.empty && e.weapon === "longGun" && teamOf(e) === team)!;

test("the keep match plays without powder; the other matches with it; both castles start with a magazine and 40 charges", () => {
  assert.equal(MATCH_OPTIONS.powder, false);
  const keep = new Match(R, layout, { ...MATCH_OPTIONS, seed: 7 });
  assert.equal(keep.world.carriers, null);
  keep.free();
  const m = quiet();
  assert.ok(m.world.carriers);
  for (const team of [Team.Enemy, Team.Player]) {
    assert.deepEqual(m.world.carriers!.status(team), { stock: POWDER.start, cap: POWDER.magazineCap, magazine: 5, lost: 0 });
    assert.equal(m.estate.magazine(team), 5);
    assert.equal(m.estate.kindOn(team, 5), "magazine");
  }
  assert.deepEqual(START_BUILDINGS.map((b) => b.kind), ["barracks", "magazine"]);
  assert.ok(PRACTICE_BUILDINGS.some((b) => b.kind === "magazine" && b.plot === 3), "the Practice range's castles have a magazine to shoot at");
  assert.deepEqual(GUIDED_OPTIONS.startBuildings![0], [{ plot: 5, kind: "magazine" }], "the tutor starts with its magazine");
  m.free();
});

test("a fire is refused with an empty box (no shot counted, no reload), and goes through once a keg is in", () => {
  const m = quiet();
  const lg = long(m, Team.Player);
  drain(m, lg.id);
  m.queue(m.tick, Team.Player, fire(lg.id));
  run(m, 1);
  assert.equal(m.shots[Team.Player], 0, "not counted");
  assert.equal(m.world.reload[lg.id], 0, "no reload");
  assert.equal(m.world.shotInfo.size, 0, "no shot in the air");
  m.world.carriers!.armed(lg);
  m.queue(m.tick, Team.Player, fire(lg.id));
  run(m, 1);
  assert.equal(m.shots[Team.Player], 1);
  assert.ok(m.world.reload[lg.id] > 0);
  assert.equal(m.world.carriers!.box(lg.id), POWDER.box.longGun - POWDER.cost.longGun);
  m.free();
});

test("a boy's keg fills a dry box in a match, from the store the rules fill", () => {
  const m = quiet();
  const lg = long(m, Team.Player);
  drain(m, lg.id);
  run(m, 40 * 60);
  assert.ok(m.world.carriers!.box(lg.id) >= POWDER.keg, `box ${m.world.carriers!.box(lg.id)}`);
  m.free();
});

test("powder is made by the cellar and by each working mill, whole charges every second, the fraction carried; mills pay no gold", () => {
  const m = quiet();
  assert.equal(m.powderRate(Team.Player), POWDER.cellar);
  assert.equal(m.economy.powderRate(2), POWDER.cellar + 2 * POWDER.mill);
  const store = m.world.carriers!;
  // Empty the store first so there is room to see it grow: take 30 out through the cellar's cap (40 start, cap 120: 80 room).
  const start = store.status(Team.Player).stock;
  run(m, 10 * 60);
  assert.equal(store.status(Team.Player).stock, start + 4, "0.4 a second for 10 seconds");
  m.world.structures!.place(Team.Player, 2, MILL);
  assert.equal(m.estate.mills(Team.Player), 1);
  assert.equal(m.powderRate(Team.Player), POWDER.cellar + POWDER.mill);
  const g1 = m.gold[Team.Player], g0 = m.gold[Team.Enemy];
  const before = store.status(Team.Player).stock;
  run(m, 10 * 60);
  const made = store.status(Team.Player).stock - before;
  assert.ok(made >= 8 && made <= 9, `0.9 a second with a mill: 8 or 9 whole charges in 10 seconds (${made}), the fraction carried`);
  assert.equal(m.gold[Team.Player] - g1, m.gold[Team.Enemy] - g0, "the mill pays no gold: both sides earned the same");
  assert.equal(BUILDINGS.mill.income, 0);
  assert.equal(m.income(Team.Player), MATCH.keepIncome);
  m.free();
});

test("powder made with nowhere to go is lost and counted", () => {
  const m = quiet(3, { startBuildings: [[], []] });
  const store = m.world.carriers!;
  run(m, 2);
  assert.equal(store.status(Team.Player).stock, POWDER.cellarCap, "no magazine: the cellar's 30");
  const lost = store.status(Team.Player).lost;
  run(m, 10 * 60);
  assert.equal(store.status(Team.Player).stock, POWDER.cellarCap);
  assert.ok(store.status(Team.Player).lost >= lost + 4, "what the cellar made over its cap was lost");
  m.free();
});

test("sudden death doubles the powder made", () => {
  const a = quiet(3), b = quiet(3, { suddenDeathTick: 0 });
  assert.equal(b.powderRate(Team.Player), POWDER.sudden * a.powderRate(Team.Player));
  run(a, 10 * 60);
  run(b, 10 * 60);
  const sa = a.world.carriers!.status(Team.Player).stock, sb = b.world.carriers!.status(Team.Player).stock;
  assert.equal(sa, POWDER.start + 4);
  assert.equal(sb, POWDER.start + 8);
  a.free();
  b.free();
});

test("buying powder: 20 charges for 60 gold at a working magazine, refused without one, without room for 20, without the gold", () => {
  const buy = (m: Match, team = Team.Player) => m.queue(m.tick, team, { kind: "powder" });
  const m = quiet();
  const store = m.world.carriers!;
  m.gold[Team.Player] = 100;
  const stock = store.status(Team.Player).stock;
  buy(m);
  run(m, 1);
  assert.equal(m.gold[Team.Player], 100 - POWDER.buy.gold, "60 gold paid");
  assert.equal(store.status(Team.Player).stock, stock + POWDER.buy.charges, "20 charges in at once");
  assert.deepEqual(m.applied.at(-1), [m.tick - 1, Team.Player, "powder"]);
  // Not enough gold.
  m.gold[Team.Player] = 59;
  buy(m);
  run(m, 1);
  assert.equal(m.gold[Team.Player], 59);
  assert.equal(store.status(Team.Player).stock, stock + POWDER.buy.charges);
  // No room for all 20: the store holds 120.
  store.store(Team.Player, store.room(Team.Player) - (POWDER.buy.charges - 1));
  assert.equal(store.room(Team.Player), 19);
  m.gold[Team.Player] = 500;
  buy(m);
  run(m, 1);
  assert.equal(m.gold[Team.Player], 500, "refused: only room for 19");
  store.store(Team.Player, 0);
  m.free();
  // No working magazine (a cellar holds 30): refused.
  const bare = quiet(3, { startBuildings: [[], []] });
  bare.gold[Team.Player] = 500;
  run(bare, 2);
  buy(bare);
  run(bare, 1);
  assert.equal(bare.gold[Team.Player], 500, "nothing paid");
  assert.equal(bare.applied.filter((a) => a[2] === "powder").length, 0);
  assert.equal(bare.estate.magazine(Team.Player), -1);
  bare.free();
});

test("buying needs a working magazine: a ruined one, or one still rising, does not count", () => {
  const m = quiet(3, { startBuildings: [[], []] });
  m.gold[Team.Player] = 1000;
  m.queue(m.tick, Team.Player, { kind: "build", plot: 4, building: "magazine" });
  run(m, 2);
  assert.equal(m.world.structures!.slot(Team.Player, 4).state, PlotState.Rising);
  assert.equal(m.estate.magazine(Team.Player), -1, "rising: not working");
  assert.equal(m.world.carriers!.status(Team.Player).cap, POWDER.cellarCap);
  const g = m.gold[Team.Player];
  m.queue(m.tick, Team.Player, { kind: "powder" });
  run(m, 1);
  assert.equal(m.gold[Team.Player] - g, 0, "refused while it rises");
  run(m, BUILDINGS.magazine.buildTicks + 60);
  assert.equal(m.estate.magazine(Team.Player), 4);
  assert.equal(m.world.carriers!.status(Team.Player).cap, POWDER.magazineCap);
  m.free();
});

test("a team holds one magazine, standing or rising: another is refused; a ruin does not count, and rebuilding one beside a standing one is refused", () => {
  const m = quiet();
  m.gold[Team.Player] = 1000;
  m.queue(m.tick, Team.Player, { kind: "build", plot: 4, building: "magazine" });
  run(m, 2);
  assert.equal(m.gold[Team.Player], 1000, "refused: one stands on plot 5");
  assert.equal(m.world.structures!.slot(Team.Player, 4).state, PlotState.Empty);
  // Wreck the standing one (with its powder in it: it blows): a ruin does not count, so another may rise.
  const st = m.world.structures!;
  const at = layout.stones[st.slot(Team.Player, 5).ids[0]];
  m.world.castle.burst(at.x, 0.8, at.z, 5, 1, 12, 0.2);
  run(m, 60);
  assert.equal(st.slot(Team.Player, 5).state, PlotState.Ruined);
  m.queue(m.tick, Team.Player, { kind: "build", plot: 4, building: "magazine" });
  run(m, 2);
  assert.equal(st.slot(Team.Player, 4).state, PlotState.Rising, "a ruin does not count");
  // Rebuilding the ruin on plot 5 while plot 4's rises is refused.
  const g = m.gold[Team.Player];
  m.queue(m.tick, Team.Player, { kind: "build", plot: 5, building: "magazine" });
  run(m, 1);
  assert.equal(m.gold[Team.Player], g, "refused: nothing paid");
  assert.equal(st.slot(Team.Player, 5).state, PlotState.Ruined, "still a ruin");
  m.free();
});

test("a gun bought later arrives with its box full", () => {
  const m = quiet();
  m.gold[Team.Player] = 1000;
  const slot = m.emplacements.findIndex((e) => e.empty && teamOf(e) === Team.Player && (e.allowed ?? []).includes("swivel"));
  assert.ok(slot >= 0);
  assert.equal(m.world.carriers!.box(slot), 0);
  m.queue(m.tick, Team.Player, { kind: "buy", emplacement: slot, weapon: "swivel" });
  run(m, 1);
  assert.equal(m.emplacements[slot].empty, false);
  assert.equal(m.world.carriers!.box(slot), POWDER.box.swivel);
  m.free();
});

test("guns nobody mans with an empty box lay on nothing and fire nothing; once the box is filled they fire", () => {
  const m = new Match(R, layout, { seed: 3 });
  m.queue(0, Team.Player, { kind: "man", emplacement: 0 });
  m.army.spawnWave(Team.Enemy, 1, 8, { x: 0, z: -97 });
  const unmanned = m.emplacements.filter((e) => !e.empty && teamOf(e) === Team.Player && e.id !== 0);
  run(m, 2);
  for (const e of unmanned) drain(m, e.id);
  run(m, 6 * 60, () => {
    for (const e of unmanned) assert.equal(m.guns[e.id].target, -1, `gun ${e.id} lays on nothing`);
  });
  assert.equal(m.autoShots[Team.Player], 0, "and fires nothing");
  for (const e of unmanned) m.world.carriers!.armed(e);
  run(m, 10 * 60);
  assert.ok(m.autoShots[Team.Player] > 0, `${m.autoShots[Team.Player]} shots once the boxes were full`);
  m.free();
});

test("a salvo leaves out a gun whose box cannot pay", () => {
  const m = quiet(3, { garrison: false, masons: false, gunnery: false });
  m.world.wind.x = m.world.wind.z = 0;
  const reg = m.register;
  reg.landings[0] = { x: 46, y: m.world.terrain.heightAt(46, -45), z: -45, tick: m.tick };
  assert.ok(reg.makeMark(Team.Player, 0, m.tick));
  const all = reg.bearing(Team.Player, 1, true);
  assert.ok(all.length >= 2, `${all.length} guns bear: ${all.join(",")}`);
  const dry = all[0];
  drain(m, dry);
  const some = reg.bearing(Team.Player, 1, true);
  assert.ok(!some.includes(dry), "the dry gun is left out");
  assert.equal(some.length, all.length - 1);
  // Loaded or not, a salvo ordered now fires from the others only.
  m.queue(m.tick, Team.Player, { kind: "salvo", mark: 1, mortar: true });
  run(m, 200);
  assert.equal(m.world.carriers!.box(dry) < POWDER.cost.mortar + POWDER.cost.longGun, true);
  m.free();
});

test("boys are left out of the men standing and fallen counts", () => {
  const m = quiet();
  const c = m.armyCounts();
  assert.deepEqual(c.standing.map((n) => n >= 0), [true, true]);
  const boys = m.world.minions.list.filter((x) => x.role === Role.Carrier);
  assert.equal(boys.length, 2 * POWDER.boys);
  const before = m.armyCounts();
  // A boy is knocked down: no fallen man is counted, and the masons' count does not move.
  const b = boys[0];
  m.world.minions.knock({ minion: b.id, vx: 1, vy: 1, vz: 0, px: b.x, py: b.y + 1, pz: b.z, extra: 1, cause: 4 }, m.tick);
  run(m, 2);
  const after = m.armyCounts();
  assert.deepEqual(after.fallen, before.fallen);
  assert.deepEqual(after.masonsFallen, before.masonsFallen);
  assert.deepEqual(after.standing, before.standing);
  m.free();
});

test("the dead end: a ridden long gun fired at every reload for 3 minutes, with a working magazine and two mills, never waits more than 20 s on an empty box while there is stock and a boy stands", () => {
  const m = quiet(5);
  m.world.structures!.place(Team.Player, 2, MILL);
  m.world.structures!.place(Team.Player, 3, MILL);
  assert.equal(m.estate.mills(Team.Player), 2);
  m.queue(0, Team.Player, { kind: "man", emplacement: 0 });
  const lg = long(m, Team.Player);
  const store = m.world.carriers!;
  let dry = 0, worst = 0, shots = 0;
  run(m, 3 * 60 * 60, () => {
    if (m.world.reload[lg.id] === 0) {
      if (store.canPay(lg.id)) {
        m.queue(m.tick, Team.Player, fire(lg.id, 0.06));
        shots++;
      }
    }
    const boy = store.errands().some((b) => b.team === Team.Player && b.minion >= 0);
    if (!store.canPay(lg.id) && store.status(Team.Player).stock > 0 && boy) {
      dry++;
      if (dry > worst) worst = dry;
    } else dry = 0;
  });
  assert.ok(shots >= 20, `${shots} shots fired`);
  assert.ok(worst <= 20 * 60, `the box stood empty with stock and a boy for ${(worst / 60).toFixed(1)} s`);
  m.free();
});
