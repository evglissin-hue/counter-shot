// Phase 2 M3: gold and building. Buildings rise as physics pieces and stop
// when knocked down; guns are bought, upgraded and fall with their masonry;
// gold comes from every source; sappers, kegs, musketeers and mixes; and the
// scripted building match replays to its pinned hash.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BUILDINGS, buildLayout, MATCH, MATCH_LAYOUT, TRICKS, UNITS, UPGRADE_COST, WAVES, WEAPON_COST, WEAPONS, weaponWith } from "@keepfall/content";
import { BUILD_MATCH_HASH, Match, PlotState, plotRect, runBuildMatch, Team } from "@keepfall/rules";
import { Felled, MinionState, Spin, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, MATCH_LAYOUT);
const quiet = (seed = 3) => new Match(R, layout, { seed, barracks: false, plan: false });

test("buildings go up course by course, work once done, stop when knocked down, and a rebuild clears the wreck", () => {
  const m = quiet();
  const start = m.gold[1];
  m.queue(1, Team.Player, { kind: "build", plot: 1, building: "mill" });
  m.queue(1, Team.Player, { kind: "build", plot: 1, building: "foundry" }); // the plot is taken now
  m.queue(2, Team.Player, { kind: "build", plot: 2, building: "barracks" }); // 300: cannot pay after the mill
  m.queue(2, Team.Player, { kind: "build", plot: 9, building: "mill" });
  for (let i = 0; i < 6 * 60; i++) m.step();
  const mill = m.plots[1][1];
  assert.equal(mill.kind, "mill");
  assert.equal(mill.state, PlotState.Building);
  assert.ok(mill.raised > 0 && mill.raised < mill.order.length, `half up: ${mill.raised} of ${mill.order.length}`);
  assert.equal(m.plots[1][2].state, PlotState.Empty, "the barracks was refused");
  assert.equal(m.gold[1], start - BUILDINGS.mill.cost + 6 * MATCH.keepIncome);
  for (let i = 0; i < 7 * 60; i++) m.step();
  assert.equal(mill.state, PlotState.Working);
  assert.equal(mill.standing, mill.order.length, "every piece stands");
  assert.ok(m.has(Team.Player, "mill") && !m.has(Team.Player, "foundry"));
  assert.equal(m.income(Team.Player), MATCH.keepIncome + MATCH.millIncome);
  assert.deepEqual(m.notes.map((n) => n.kind), ["built"]);
  m.notes = [];
  // A shell on it: knocked down, and the enemy is paid for it.
  const r = plotRect(Team.Player, 1);
  const enemyGold = m.gold[0];
  m.world.explode((r.x0 + r.x1) / 2, 2.5, (r.z0 + r.z1) / 2);
  for (let i = 0; i < 60; i++) m.step();
  assert.equal(mill.state, PlotState.Down);
  assert.ok(!m.has(Team.Player, "mill"));
  assert.deepEqual(m.notes.map((n) => n.kind), ["down"]);
  const paid = m.gold[0] - enemyGold - MATCH.keepIncome;
  assert.ok(paid >= Math.round(BUILDINGS.mill.cost * MATCH.buildingBounty), `the enemy earned ${paid} (a share of its cost and the masonry)`);
  // Building again on the wreck clears it first, then it goes up anew.
  m.gold[1] = 1000;
  m.queue(m.tick, Team.Player, { kind: "build", plot: 1, building: "foundry" });
  m.step();
  const c = m.world.castle;
  const old = layout.plots.find((s) => s.castle === 1 && s.plot === 1 && s.kind === "mill")!;
  for (let id = old.first; id < old.first + old.count; id++) assert.equal(c.absent[id], 1, "the wreck is gone");
  for (let i = 0; i < 16 * 60; i++) m.step();
  assert.equal(m.plots[1][1].kind, "foundry");
  assert.equal(m.plots[1][1].state, PlotState.Working);
  m.free();
});

test("guns: buy one for an empty slot, fit Foundry upgrades, and a gun falls with the masonry under it", () => {
  const m = quiet();
  m.gold[1] = 2000;
  m.queue(1, Team.Player, { kind: "buy", emplacement: 4, weapon: "mortar" }); // no mortar on the wall walk
  m.queue(1, Team.Player, { kind: "buy", emplacement: 12, weapon: "swivel" }); // the enemy's empty slot
  m.queue(1, Team.Player, { kind: "buy", emplacement: 0, weapon: "swivel" }); // it has a gun
  m.queue(2, Team.Player, { kind: "buy", emplacement: 6, weapon: "mortar" }); // a second mortar, on a back tower
  m.queue(3, Team.Player, { kind: "upgrade", emplacement: 0, upgrade: "rifled" }); // no foundry yet
  m.queue(4, Team.Player, { kind: "fire", emplacement: 4, yaw: 0, pitch: 0.03, charge: 1, fuse: 0, spin: Spin.None }); // empty slot
  m.queue(5, Team.Player, { kind: "build", plot: 2, building: "foundry" });
  for (let i = 0; i < 20; i++) m.step();
  assert.ok(m.usable(6) && !m.usable(4) && !m.usable(12));
  assert.equal(m.emplacements[6].weapon, "mortar");
  assert.equal(m.emplacements[6].y, 12 + 0.9, "a mortar stands on the tower top");
  assert.ok(m.world.reload[6] > 0, "a new gun is not loaded yet");
  assert.equal(m.gold[1], 2000 - WEAPON_COST.mortar - BUILDINGS.foundry.cost);
  assert.deepEqual(m.shots, [0, 0]);
  for (let i = 0; i < 16 * 60; i++) m.step();
  m.queue(m.tick, Team.Player, { kind: "upgrade", emplacement: 0, upgrade: "rifled" });
  m.queue(m.tick, Team.Player, { kind: "upgrade", emplacement: 0, upgrade: "heavy" });
  m.queue(m.tick, Team.Player, { kind: "upgrade", emplacement: 0, upgrade: "heavy" }); // fitted already
  const before = m.gold[1];
  m.step();
  assert.equal(before - m.gold[1], 2 * UPGRADE_COST);
  assert.deepEqual(m.emplacements[0].mods, { rifled: true, heavy: true });
  // Trade-offs: the rifled, heavy long gun is tighter and breaches more, but leaves slower and reloads slower.
  const w = weaponWith("longGun", { heavy: true, rifled: true }), base = WEAPONS.longGun;
  assert.ok(w.scatter.angle < base.scatter.angle && w.reload > base.reload && w.speed < base.speed && w.projectile.blast > base.projectile.blast);
  // A burst on the gatehouse under the long gun: the gun falls with it and cannot fire.
  m.world.explode(0, 7.6, -134.8);
  for (let i = 0; i < 90; i++) m.step();
  assert.ok(m.slots[0].down, "the long gun is knocked out");
  assert.ok(m.notes.some((n) => n.kind === "gunDown" && n.emplacement === 0));
  const shots = m.shots[1];
  m.world.reload[0] = 0;
  m.queue(m.tick, Team.Player, { kind: "fire", emplacement: 0, yaw: 0, pitch: 0.03, charge: 1, fuse: 0, spin: Spin.None });
  m.step();
  assert.equal(m.shots[1], shots, "a knocked out gun does not fire");
  assert.ok(!m.slots[1].down && !m.slots[2].down, "the others stand");
  m.free();
});

test("gold: the keep, mills, bounties for the fallen, enemy masonry and trick shots by a gunner's own hand", () => {
  const m = quiet();
  // Enemy pikemen bunched on the centre road, and a shell from the player's mortar into them (by hand).
  m.army.spawnWave(Team.Enemy, 1, 8, { x: 0, z: -58 });
  for (let i = 0; i < 5; i++) m.step();
  const g0 = m.gold[1];
  m.world.explode(0, 0.5, -59.5, undefined, 0);
  for (let i = 0; i < 30; i++) m.step();
  const fell = m.world.minions.list.filter((x) => x.team === Team.Enemy && x.state !== MinionState.Upright).length;
  assert.ok(fell >= 6, `${fell} fell`);
  const bounties = m.goldLog.filter((g) => g.team === Team.Player && g.why === "Pikeman down").reduce((n, g) => n + g.amount, 0);
  assert.equal(bounties, fell * UNITS.pikeman.bounty, "a bounty for each");
  assert.ok(!m.goldLog.some((g) => g.why.startsWith("Multi")), "a burst nobody fired is no trick shot");
  assert.ok(m.gold[1] >= g0 + bounties);
  // A shot by hand at the enemy keep: a keep hit, and masonry.
  m.goldLog = [];
  m.queue(m.tick, Team.Player, { kind: "fire", emplacement: 0, yaw: 0, pitch: 0.035, charge: 1, fuse: 0, spin: Spin.None });
  for (let i = 0; i < 4 * 60; i++) m.step();
  const why = new Set(m.goldLog.filter((g) => g.team === Team.Player).map((g) => g.why));
  assert.ok(why.has("Keep hit") && why.has("Masonry"), [...why].join(", "));
  assert.equal(m.earned[1].tricks, TRICKS.keep);
  assert.ok(m.earned[1].masonry > 0 && m.earned[1].bounty > 0 && m.earned[1].keep > 0);
  m.free();
});

test("sappers plant their kegs against the enemy gate and blow it open; one knocked down on the way blows up its own wave", () => {
  const m = quiet(5);
  m.army.spawnWave(Team.Player, 1, ["pikeman", "pikeman", "sapper", "sapper"], { x: 0, z: -40 });
  const leaves = layout.stones.filter((s) => s.part === "gate" && s.castle === 0).map((s) => s.id);
  let open = -1;
  for (let i = 0; i < 40 * 60 && open < 0; i++) {
    m.step();
    if (leaves.some((id) => m.world.castle.dynamic[id])) open = m.tick;
  }
  assert.ok(open > 0, "the gate is open");
  assert.ok(m.masonryDown(0) > 20, `${m.masonryDown(0)} pieces of the enemy's gatehouse down`);
  m.free();
  const n = quiet(5);
  n.army.spawnWave(Team.Enemy, 1, ["pikeman", "pikeman", "pikeman", "pikeman", "pikeman", "sapper", "pikeman", "pikeman"], { x: 0, z: -60 });
  for (let i = 0; i < 30; i++) n.step();
  const s = n.world.minions.list.find((x) => x.kind === 1)!;
  // As if a gunner's ball had hit it: a manned shot from the player's long gun.
  n.queue(n.tick, Team.Player, { kind: "fire", emplacement: 0, yaw: 0, pitch: 0.03, charge: 1, fuse: 0, spin: Spin.None });
  n.step();
  const shot = 1;
  n.world.minions.knock({ minion: s.id, vx: 0, vy: 2, vz: 3, px: s.x, py: s.y + 1, pz: s.z, extra: 0.5, cause: shot, how: Felled.Ball }, n.tick);
  for (let i = 0; i < 90; i++) n.step();
  const down = n.world.minions.list.filter((x) => x.state !== MinionState.Upright).length;
  assert.ok(down >= 6, `${down} of 8 down`);
  const why = new Set(n.goldLog.filter((g) => g.team === Team.Player).map((g) => g.why));
  assert.ok(why.has("Keg set off") && [...why].some((w) => w.startsWith("Multi-kill")), [...why].join(", "));
  n.free();
});

test("musketeers shoot enemy minions from range; a barracks sends its mix only as far as the team can pay and has what each needs", () => {
  const m = quiet(5);
  // Out on the left flank, beyond the reach of either castle's guns.
  m.army.spawnWave(Team.Player, 0, ["musketeer", "musketeer", "musketeer", "musketeer"], { x: 40, z: -100 });
  m.army.spawnWave(Team.Enemy, 0, ["pikeman", "pikeman", "pikeman", "pikeman"], { x: 40, z: -82 });
  let shotDown = 0;
  for (let i = 0; i < 20 * 60; i++) m.step();
  for (const x of m.world.minions.list) if (x.team === Team.Enemy && x.state !== MinionState.Upright && x.how === Felled.Musket) shotDown++;
  assert.ok(shotDown >= 1, `${shotDown} shot down`);
  m.free();
  // Mixes: sappers need a mill, musketeers a foundry; without them, pikemen.
  const n = new Match(R, layout, { seed: 3, plan: false });
  n.queue(1, Team.Player, { kind: "barracks", plot: 0, mix: "mixed" });
  for (let i = 0; i < WAVES.first + 2; i++) n.step();
  const kinds = (team: Team) => n.world.minions.list.filter((x) => x.team === team && x.wave >= 0).map((x) => x.kind);
  assert.deepEqual(kinds(Team.Player), [0, 0, 0, 0, 0, 0, 0, 0], "no mill, no foundry: all pikemen");
  n.free();
  const k = new Match(R, layout, { seed: 3, plan: false });
  k.gold[1] = 5000;
  k.queue(0, Team.Player, { kind: "build", plot: 1, building: "mill" });
  k.queue(0, Team.Player, { kind: "barracks", plot: 0, mix: "sappers" });
  for (let i = 0; i < 25 * 60 + WAVES.first + 2; i++) k.step();
  const sappers = k.world.minions.list.filter((x) => x.team === Team.Player && x.kind === 1).length;
  assert.equal(sappers, 3, "the second wave (after the mill was done) carried three sappers");
  k.free();
});


test("the building match: mills, a foundry, sappers, an upgrade, a gun bought and a shell on the enemy's mill replay to their pinned hash", () => {
  const a = runBuildMatch(R);
  console.log("build match hash", a.hash, "gold", a.gold, "waves", a.waves, "standing", a.standing, "fallen", a.fallen, "shots", a.shots, "auto", a.autoShots);
  assert.equal(a.result, null);
  assert.deepEqual(a.hash, BUILD_MATCH_HASH);
});
