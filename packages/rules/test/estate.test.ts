// Phase 2 M3: gold, plots and buildings, guns bought and upgraded, sappers,
// musketeers, each barracks' mix and route, and the enemy's build order.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { armedWeapon, BUILDINGS, buildLayout, Earn, GAME_LAYOUT, GOLD, KEG, MATCH, MUSTER, PLOTS, ROUTE_NAMES, Unit, WEAPONS, WAVES } from "@keepfall/content";
import { Action, Cause, EVENT_STRIDE, EventKind, MinionState, navCell, NavKind, PlotState, PROJECTILE_STRIDE, Role, Spin, type Rapier } from "@keepfall/sim";
import { ESTATE_MATCH_HASH, Match, runEstateMatch, Team } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const quiet = (seed = 3) => new Match(R, layout, { seed, barracks: false, plan: false });
const run = (m: Match, ticks: number, each?: (m: Match) => void) => {
  for (let i = 0; i < ticks; i++) {
    m.step();
    each?.(m);
  }
};
const MILL = 1, FOUNDRY = 2;

test("a building rises from the ground up, works once finished, stops when knocked down, and a ruin is rebuilt for half its cost", () => {
  const m = quiet();
  const st = m.world.structures!;
  m.queue(1, Team.Player, { kind: "build", plot: 1, building: "mill" }); // 150 gold: refused
  run(m, 3);
  assert.equal(st.slot(1, 1).state, PlotState.Empty, "not enough gold yet");
  m.gold[1] = 1000;
  m.queue(m.tick, Team.Player, { kind: "build", plot: 1, building: "mill" });
  m.queue(m.tick, Team.Player, { kind: "build", plot: 1, building: "foundry" }); // the plot is taken: refused
  m.queue(m.tick, Team.Player, { kind: "build", plot: 0, building: "mill" }); // the barracks stands there: refused
  run(m, 2);
  const s = st.slot(1, 1);
  assert.equal(s.state, PlotState.Rising);
  assert.equal(m.gold[1], 1000 - BUILDINGS.mill.cost, "paid once");
  // Lowest first: every piece raised sits no lower than the one before it.
  let lastBottom = -1, raised = 0;
  run(m, BUILDINGS.mill.buildTicks + 60, () => {
    for (; raised < s.next; raised++) {
      const p = layout.stones[s.ids[raised]];
      assert.ok(p.y - p.hy >= lastBottom - 1e-6, "pieces go up from the bottom");
      lastBottom = p.y - p.hy;
      assert.equal(m.world.castle.dynamic[p.id], 0, "a raised piece stands");
    }
    if (s.state === PlotState.Rising) assert.equal(m.estate.mills(1), 0, "a mill works only once it is finished");
  });
  assert.equal(s.state, PlotState.Standing);
  assert.equal(m.estate.mills(1), 1);
  assert.equal(m.economy.incomeRate(m.estate.mills(1)), MATCH.keepIncome + BUILDINGS.mill.income);
  // The other kinds ready on this plot never came into the world.
  const foundry = layout.plots.find((r) => r.castle === 1 && r.plot === 1 && r.kind === FOUNDRY)!;
  for (let id = foundry.first; id < foundry.first + foundry.count; id++) assert.equal(m.world.castle.shattered[id], 1);
  // A shell on it: a ruin, and no more income from it.
  const c = layout.stones[s.ids[0]];
  m.world.explode(c.x, 1.4, c.z);
  run(m, 30);
  assert.equal(s.state, PlotState.Ruined, `health ${m.world.structures!.health(1, 1).toFixed(2)}`);
  assert.equal(m.estate.mills(1), 0);
  const before = m.gold[1];
  run(m, 240); // let the rubble settle
  const income = m.gold[1] - before;
  m.queue(m.tick, Team.Player, { kind: "build", plot: 1, building: "mill" });
  run(m, 1);
  assert.equal(m.gold[1], before + income - Math.round(BUILDINGS.mill.cost * 0.5), "rebuilt for half its cost");
  run(m, BUILDINGS.mill.buildTicks * 3);
  assert.equal(s.state, PlotState.Standing, "standing again");
  assert.equal(m.estate.mills(1), 1);
  m.free();
});

test("gold: the keep and each working mill through one income function, a bounty for every enemy down, a gold for every four pieces of enemy masonry", () => {
  const m = quiet();
  const mills = m.estate.mills(1);
  run(m, 10 * 60);
  assert.deepEqual(m.gold, [MATCH.startGold + 10 * MATCH.keepIncome, MATCH.startGold + 10 * MATCH.keepIncome]);
  assert.equal(mills, 0);
  // A working mill adds its income, fractions carried: 1.5 a second over 10 s is 15.
  m.world.structures!.place(1, 2, MILL);
  run(m, 10 * 60);
  assert.equal(m.gold[1] - m.gold[0], 10 * BUILDINGS.mill.income);
  // A burst among enemy pikemen: a bounty each for the other side.
  const g = [m.gold[0], m.gold[1]];
  m.army.spawnWave(Team.Enemy, 1, 8, { x: 0, z: -75 });
  run(m, 2);
  m.world.explode(0, 1, -76.5);
  run(m, 2);
  const down = m.world.minions.list.filter((x) => x.team === Team.Enemy && x.state !== MinionState.Upright).length;
  assert.ok(down >= 6, `${down} down`);
  assert.equal(m.gold[1] - g[1], down * GOLD.bounty, "bounties to the player");
  assert.equal(m.gold[0], g[0], "nothing to the enemy");
  // A burst on the enemy's wall: masonry pays the player.
  const g1 = m.gold[1];
  m.economy.feed.length = 0;
  m.world.explode(-8, 2, -15.5);
  run(m, 1);
  const masonry = m.economy.feed.filter((e) => e.kind === Earn.Masonry && e.team === Team.Player).reduce((n, e) => n + e.amount, 0);
  assert.ok(masonry > 5, `${masonry} gold for masonry`);
  assert.ok(m.gold[1] >= g1 + masonry);
  m.free();
});

test("trick shots pay a gunner (ricochet, collapse, multi-kill, keep hit), never a gun nobody mans", () => {
  const m = quiet();
  const w = m.world;
  m.army.spawnWave(Team.Enemy, 1, 8, { x: 0, z: -70 });
  run(m, 2);
  const enemy = w.minions.list.filter((x) => x.team === Team.Enemy);
  // Shot 9001 from the player's long gun, by hand, that glanced off stone; 9002 the same but fired by the gun on its own.
  w.shotInfo.set(9001, { emplacement: 0, auto: false, glanced: true, ended: -1 });
  w.shotInfo.set(9002, { emplacement: 0, auto: true, glanced: true, ended: -1 });
  const knock = (id: number, cause: number, shot: number, stone = -1) => w.minions.knock({ minion: id, vx: 0, vy: 1, vz: 0, px: 0, py: 0, pz: 0, extra: 0, cause, shot, stone }, m.tick);
  m.economy.feed.length = 0;
  knock(enemy[0].id, Cause.Ball, 9001);
  knock(enemy[1].id, Cause.Ball, 9001);
  knock(enemy[2].id, Cause.Ball, 9001);
  knock(enemy[3].id, Cause.Ball, 9002);
  // One crushed by his own castle's masonry, one by the player's (no trick for that one).
  const own = layout.stones.find((s) => s.castle === 0 && s.part === "wall")!.id;
  const theirs = layout.stones.find((s) => s.castle === 1 && s.part === "wall")!.id;
  knock(enemy[4].id, Cause.Masonry, -1, own);
  knock(enemy[5].id, Cause.Masonry, -1, theirs);
  w.keepHits.push(9001, 0, 9002, 0);
  run(m, GOLD.trick.multiWait + 2);
  const paid = (kind: Earn) => m.economy.feed.filter((e) => e.kind === kind && e.team === Team.Player).reduce((n, e) => n + e.amount, 0);
  assert.equal(paid(Earn.Bounty), 6 * GOLD.bounty, "a bounty for each, whatever knocked him down");
  assert.equal(paid(Earn.Ricochet), 3 * GOLD.trick.ricochet, "three ricochet kills by hand, none for the gun on its own");
  assert.equal(paid(Earn.MultiKill), 3 * GOLD.trick.multiPer, "one shot, three down");
  assert.equal(paid(Earn.Collapse), GOLD.trick.collapse, "his own castle's masonry only");
  assert.equal(paid(Earn.KeepHit), GOLD.trick.keep, "the keep hit by hand");
  assert.deepEqual(m.economy.tricks[Team.Player].slice(Earn.Ricochet), [3, 1, 1, 1]);
  assert.equal(m.economy.feed.filter((e) => e.team === Team.Enemy && e.kind !== Earn.Income).length, 0);
  m.free();
});

test("a gun bought for an empty slot fires; an upgrade needs a working Foundry and changes how the gun fires", () => {
  const m = quiet();
  m.gold[1] = 2000;
  m.queue(1, Team.Player, { kind: "buy", emplacement: 4, weapon: "mortar" }); // a wall slot takes no mortar
  m.queue(1, Team.Player, { kind: "buy", emplacement: 12, weapon: "swivel" }); // the enemy's slot
  m.queue(2, Team.Player, { kind: "fire", emplacement: 4, yaw: 0, pitch: 0.05, charge: 1, fuse: 0, spin: Spin.None }); // still empty
  run(m, 4);
  assert.equal(m.emplacements[4].empty, true);
  assert.equal(m.emplacements[12].empty, true);
  assert.equal(m.shots[1], 0);
  m.queue(m.tick, Team.Player, { kind: "buy", emplacement: 4, weapon: "swivel" });
  m.queue(m.tick + 1, Team.Player, { kind: "fire", emplacement: 4, yaw: 0, pitch: 0.05, charge: 1, fuse: 0, spin: Spin.None });
  run(m, 3);
  assert.equal(m.emplacements[4].weapon, "swivel");
  assert.equal(m.shots[1], 1, "the new swivel fired");
  // No Foundry, no upgrade.
  m.queue(m.tick, Team.Player, { kind: "upgrade", emplacement: 0, upgrade: "heavyShot" });
  run(m, 1);
  assert.equal(m.emplacements[0].upgrade, undefined);
  m.world.structures!.place(1, 3, FOUNDRY);
  run(m, 11);
  m.queue(m.tick, Team.Player, { kind: "upgrade", emplacement: 0, upgrade: "rifled" });
  m.queue(m.tick, Team.Player, { kind: "upgrade", emplacement: 0, upgrade: "heavyShot" }); // one upgrade per gun
  m.queue(m.tick, Team.Player, { kind: "upgrade", emplacement: 3, upgrade: "heavyShot" }); // not a swivel's
  run(m, 1);
  assert.equal(m.emplacements[0].upgrade, "rifled");
  assert.equal(m.emplacements[3].upgrade, undefined);
  const rifled = armedWeapon("longGun", "rifled");
  assert.equal(rifled.scatter.angle, WEAPONS.longGun.scatter.angle * 0.4);
  assert.equal(rifled.reload, Math.round(WEAPONS.longGun.reload * 1.3));
  assert.equal(armedWeapon("longGun"), WEAPONS.longGun, "without an upgrade, the very same weapon");
  // Heavy shot on the second long gun bought for slot 5: it flies slower.
  m.queue(m.tick, Team.Player, { kind: "buy", emplacement: 5, weapon: "longGun" });
  m.queue(m.tick + 1, Team.Player, { kind: "upgrade", emplacement: 5, upgrade: "heavyShot" });
  m.queue(m.tick + 2, Team.Player, { kind: "fire", emplacement: 5, yaw: 0, pitch: 0.05, charge: 1, fuse: 0, spin: Spin.None });
  run(m, 4);
  const f = m.world.collect();
  let speed = 0;
  for (let i = 0; i < f.projectileCount; i++) {
    const o = i * PROJECTILE_STRIDE;
    speed = Math.max(speed, Math.hypot(f.projectiles[o + 6], f.projectiles[o + 7], f.projectiles[o + 8]));
  }
  assert.ok(Math.abs(speed - WEAPONS.longGun.speed * 0.88) < 3, `heavy shot leaves at ${speed.toFixed(1)} m/s`);
  assert.equal(m.world.reload[0], 0, "the rifled gun has not fired");
  m.free();
});

test("sappers set their kegs at the foot of the enemy wall and blow a breach the wave walks through", () => {
  // The kegs alone: no guns firing on their own (one lucky shot sets both off on the way), no masons to close the breach, no garrison inside.
  const m = new Match(R, layout, { seed: 5, barracks: false, plan: false, gunnery: false, masons: false, garrison: false });
  m.army.spawnMix(Team.Player, 1, [Unit.Pikeman, Unit.Pikeman, Unit.Pikeman, Unit.Pikeman, Unit.Sapper, Unit.Pikeman, Unit.Pikeman, Unit.Sapper], 0, { x: 0, z: -50 });
  let kegs = 0, inside = 0;
  run(m, 45 * 60, (mm) => {
    const f = mm.world.collect();
    for (let k = 0; k < f.eventCount; k++) if (f.events[k * EVENT_STRIDE] === EventKind.Keg) kegs++;
  });
  assert.equal(kegs, 2, "both sappers set their kegs");
  // The wall's foot by the kegs is open: some cell of the front wall's rows can be walked.
  let open = 0;
  for (let x = -12; x <= 12; x++) {
    if (Math.abs(x) <= 2) continue; // the gateway
    const c = navCell(x + 0.5, -15.5);
    if (m.world.nav.kind[c] === NavKind.Ground || m.world.nav.kind[c] === NavKind.Rubble) open++;
  }
  assert.ok(open >= 2, `${open} metres of the wall's foot open`);
  for (const x of m.world.minions.list) if (x.team === Team.Player && x.state === MinionState.Upright && x.z > -14 && x.z < 14 && Math.abs(x.x) < 14) inside++;
  assert.ok(inside >= 1, `${inside} of the wave inside the enemy courtyard`);
  assert.ok(m.masonryDown(0) > 20, `${m.masonryDown(0)} pieces of the enemy wall down`);
  m.free();
});

test("a sapper knocked down on his way sets his keg off among his own wave, and the gunner who did it is paid for all of them", () => {
  const m = quiet(6);
  m.army.spawnMix(Team.Enemy, 1, [Unit.Pikeman, Unit.Pikeman, Unit.Pikeman, Unit.Pikeman, Unit.Pikeman, Unit.Sapper, Unit.Pikeman, Unit.Pikeman], 0, { x: 0, z: -70 });
  run(m, 30);
  const sapper = m.world.minions.list.find((x) => x.unit === Unit.Sapper)!;
  m.world.shotInfo.set(9100, { emplacement: 2, auto: false, glanced: false, ended: -1 }); // the player's chain shot, by hand
  m.economy.feed.length = 0;
  let bursts = 0;
  m.world.minions.knock({ minion: sapper.id, vx: 0, vy: 2, vz: 3, px: sapper.x, py: 1, pz: sapper.z, extra: 1, cause: Cause.Ball, shot: 9100 }, m.tick);
  run(m, GOLD.trick.multiWait + 5, (mm) => {
    const f = mm.world.collect();
    for (let k = 0; k < f.eventCount; k++) if (f.events[k * EVENT_STRIDE] === EventKind.Explosion) bursts++;
  });
  assert.equal(bursts, 1, "his keg went off");
  const down = m.world.minions.list.filter((x) => x.team === Team.Enemy && x.state !== MinionState.Upright).length;
  assert.ok(down >= 5, `${down} of his wave down`);
  const multi = m.economy.feed.filter((e) => e.kind === Earn.MultiKill && e.team === Team.Player);
  assert.equal(multi.length, 1, "one multi-kill for the chain shot");
  assert.equal(multi[0].amount, down * GOLD.trick.multiPer);
  assert.equal(KEG.fuse > 0, true);
  m.free();
});

test("musketeers stop to fire at enemies in sight, and their hits knock men down", () => {
  const m = quiet(7);
  m.army.spawnMix(Team.Player, 1, [Unit.Musketeer, Unit.Musketeer, Unit.Musketeer, Unit.Musketeer], 0, { x: 0, z: -92 });
  m.army.spawnWave(Team.Enemy, 1, 6, { x: 0, z: -58 });
  let shots = 0, aiming = 0;
  run(m, 30 * 60, (mm) => {
    const f = mm.world.collect();
    for (let k = 0; k < f.eventCount; k++) if (f.events[k * EVENT_STRIDE] === EventKind.Musket) shots++;
    for (const x of mm.world.minions.list) if (x.unit === Unit.Musketeer && x.state === MinionState.Upright && x.action === 9) aiming++;
  });
  const downs = m.world.minions.list.filter((x) => x.team === Team.Enemy && x.state !== MinionState.Upright && x.downCause === Cause.Musket).length;
  assert.ok(shots >= 4, `${shots} musket shots`);
  assert.ok(aiming > 100, `aimed for ${aiming} minion-ticks`);
  assert.ok(downs >= 1, `${downs} knocked down by musket balls`);
  m.free();
});

test("every working barracks sends its own mix down its own route, side by side outside the gate", () => {
  const m = new Match(R, layout, { seed: 3, plan: false });
  m.world.structures!.place(1, 2, 0); // a second barracks
  m.queue(1, Team.Player, { kind: "barracks", plot: 0, mix: "pikemen", route: "left" });
  m.queue(1, Team.Player, { kind: "barracks", plot: 2, mix: "volley", route: "right" });
  run(m, WAVES.first + 2);
  assert.equal(m.waves[1], 2, "two waves from two barracks");
  // The waves that marched out (M4's garrison and masons are army minions too).
  const army = m.world.minions.list.filter((x) => x.team === Team.Player && x.wave >= 0 && x.role === Role.March);
  assert.equal(army.length, 16);
  const byWave = new Map<number, typeof army>();
  for (const x of army) byWave.set(x.wave, [...(byWave.get(x.wave) ?? []), x]);
  const waves = [...byWave.values()];
  assert.deepEqual(waves.map((w) => ROUTE_NAMES[w[0].route]).sort(), ["left", "right"]);
  const volley = waves.find((w) => ROUTE_NAMES[w[0].route] === "right")!;
  assert.equal(volley.filter((x) => x.unit === Unit.Musketeer).length, 3);
  const cx = waves.map((w) => w.reduce((n, x) => n + x.x, 0) / w.length);
  assert.ok(Math.abs(cx[0] - cx[1]) > 4, `formed up side by side (${cx.map((v) => v.toFixed(1)).join(", ")})`);
  void MUSTER;
  m.free();
});

test("only pikes batter a gate: the musketeers of a wave wait at it", () => {
  const m = quiet(4);
  const P = Unit.Pikeman, M = Unit.Musketeer;
  m.army.spawnMix(Team.Player, 1, [P, P, P, P, M, M, M, M], 0, { x: 0, z: -26 });
  let pikes = 0, muskets = 0, near = 0;
  run(m, 25 * 60, (mm) => {
    for (const x of mm.world.minions.list) {
      if (x.team !== Team.Player || x.state !== MinionState.Upright) continue;
      if (x.action === Action.Batter) {
        if (x.unit === M) muskets++;
        else pikes++;
      } else if (x.unit === M && x.z > -18) near++;
    }
  });
  assert.ok(pikes > 200, `pikemen battered (${pikes} minion-ticks)`);
  assert.equal(muskets, 0, "no musketeer battered");
  assert.ok(near > 100, `musketeers stood by at the gate (${near} minion-ticks)`);
  m.free();
});

test("the enemy castle follows its build order, paying like anyone, and rebuilds a ruin first", () => {
  const m = new Match(R, layout, { seed: 4, barracks: false });
  const st = m.world.structures!;
  run(m, 45 * 60 + 40);
  assert.equal(st.slot(Team.Enemy, 1).state, PlotState.Rising, "its Powder Mill is going up at 0:45");
  assert.ok(m.economy.spent[Team.Enemy] >= BUILDINGS.mill.cost);
  run(m, BUILDINGS.mill.buildTicks + 30);
  assert.equal(st.slot(Team.Enemy, 1).state, PlotState.Standing);
  // Shell its barracks: it rebuilds it before anything else.
  const b = st.slot(Team.Enemy, 0);
  const p = layout.stones[b.ids[0]];
  m.world.explode(p.x, 1.4, p.z);
  run(m, 70);
  assert.equal(b.state, PlotState.Rising, "rebuilding its barracks");
  assert.equal(PLOTS.length, 6);
  m.free();
});

test("the estate match: building, buying, upgrading and mixed waves replay to their pinned hash", () => {
  const a = runEstateMatch(R);
  console.log("estate match hash", a.hash, "gold", a.gold, "earned", a.earned, "spent", a.spent, "plots", JSON.stringify(a.plots), "waves", a.waves, "fallen", a.fallen);
  assert.equal(a.slot4, "swivel");
  assert.equal(a.upgrade, "heavyShot");
  assert.deepEqual(a.plots[1].slice(0, 4), [0, MILL, 0, FOUNDRY], "the player's barracks, mill, second barracks and foundry");
  assert.equal(a.plots[0][1], MILL, "the enemy's first mill");
  assert.deepEqual(a.hash, ESTATE_MATCH_HASH);
});
