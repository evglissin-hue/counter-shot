// 3.6 the household: named crews at every station as real figures, the reserve and its clock, who is replaced first, a
// crew's skill in place of dice, a gun with no crew, bounties, keepers that gate their organs.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import {
  buildLayout,
  crewPostXZ,
  Earn,
  GAME_LAYOUT,
  GOLD,
  GUN_HITS,
  HOUSEHOLD,
  keeperPost,
  MATCH_EMPLACEMENTS,
  REPAIR,
  StationKind,
  stoneBounds,
  WEAPONS,
  type FirstKind,
} from "@keepfall/content";
import {
  Cause,
  CrewAction,
  EVENT_STRIDE,
  EventKind,
  Household,
  MinionState,
  mountFloor,
  OutWait,
  PROJECTILE_STRIDE,
  Role,
  SeatState,
  solveAim,
  Spin,
  type Rapier,
} from "@keepfall/sim";
import { Match, Team, type MatchOptions } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);

const quiet = (seed = 3, more: Partial<MatchOptions> = {}) => new Match(R, layout, { seed, barracks: false, garrison: false, plan: false, gunnery: false, ...more });
const run = (m: Match, ticks: number, each?: (m: Match) => void) => {
  for (let i = 0; i < ticks; i++) {
    m.step();
    each?.(m);
  }
};
/** Step until something is true (or the cap), returning the ticks it took. */
const until = (m: Match, cap: number, done: (m: Match) => boolean): number => {
  for (let i = 0; i < cap; i++) {
    if (done(m)) return i;
    m.step();
  }
  return done(m) ? cap : -1;
};
const hh = (m: Match): Household => m.world.household!;
const station = (m: Match, team: number, kind: StationKind, index: number) => hh(m).stations.find((s) => s.team === team && s.kind === kind && s.index === index)!;
/** Knock a man of the household down the way a ball would. */
const knock = (m: Match, minion: number) => {
  const x = m.world.minions.list[minion];
  m.world.minions.knock({ minion, vx: 0.5, vy: 1, vz: 0, px: x.x, py: x.y + 1, pz: x.z, extra: 1, cause: Cause.Ball, shot: -1 }, m.tick);
};
const knockSeat = (m: Match, st: ReturnType<typeof station>, k: number) => knock(m, st.seats[k].minion);
/** Events of the given kinds a run of steps raised: [kind, a, b, c, d] each. */
const watch = (m: Match, kinds: EventKind[]) => {
  const got: number[][] = [];
  return {
    got,
    each: () => {
      const f = m.world.collect();
      for (let k = 0; k < f.eventCount; k++) {
        const o = k * EVENT_STRIDE;
        if (kinds.includes(f.events[o])) got.push(Array.from(f.events.subarray(o, o + EVENT_STRIDE)));
      }
    },
  };
};
const LONG = WEAPONS.longGun.reload;

test("a new match: four armed guns a castle with two men each at their posts, trained; masons, boys, keepers, a reserve of six; everyone named", () => {
  const names: string[][] = [];
  for (const seed of [3, 4]) {
    const m = quiet(seed);
    const h = hh(m);
    assert.ok(h.started);
    const list: string[] = [];
    for (const team of [0, 1]) {
      assert.equal(h.reserve[team], HOUSEHOLD.reserve);
      const guns = h.stations.filter((s) => s.team === team && s.kind === StationKind.Gun);
      assert.equal(guns.length, 8, "a station for every emplacement");
      let armed = 0;
      for (const g of guns) {
        const e = m.emplacements[g.index];
        if (e.empty) {
          assert.equal(h.crew(g.index), 0, "an empty slot has no crew");
          assert.ok(g.seats.every((s) => s.state === SeatState.Empty));
          continue;
        }
        armed++;
        assert.equal(h.crew(g.index), 2);
        assert.equal(h.level(g.index), 1, "the starting guns' crews are trained");
        for (const s of g.seats) {
          assert.equal(s.state, SeatState.AtPost);
          const man = m.world.minions.list[s.minion];
          assert.equal(man.role, Role.Crew);
          assert.equal(man.state, MinionState.Upright);
          assert.equal(man.action, CrewAction.AtGun);
          assert.equal(h.stationOf(man.id), h.stations.indexOf(g));
        }
      }
      assert.equal(armed, 4);
      for (const [kind, n] of [[StationKind.Mason, REPAIR.crew], [StationKind.Boy, 3], [StationKind.Bell, 1], [StationKind.Mast, 1]] as const) {
        const ss = h.stations.filter((s) => s.team === team && s.kind === kind);
        assert.equal(ss.length, n, `station kind ${kind}`);
        assert.ok(ss.every((s) => s.seats[0].state === SeatState.AtPost && s.seats[0].person >= 0));
      }
      const spotter = h.stations.filter((s) => s.team === team && s.kind === StationKind.Spotter);
      assert.equal(spotter.length, 1);
      assert.equal(spotter[0].seats[0].state, SeatState.Empty, "no spotter's tower, no spotter");
      const roster = h.roster(team);
      assert.equal(roster.reserve, HOUSEHOLD.reserve);
      assert.equal(roster.lost, 0);
      for (const s of roster.stations) for (const seat of s.seats) if (seat.person >= 0) list.push(seat.name);
    }
    assert.equal(list.length, h.people.length, "every person is named");
    assert.ok(list.every((n) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(n)));
    names.push(list);
    m.free();
  }
  assert.notDeepEqual(names[0], names[1], "another seed, other names");
});

test("posts are clear of masonry, stand on it, and a fresh match wakes nothing because of them", () => {
  const R_ = 0.3, H = 1.7;
  const clear = (label: string, x: number, y: number, z: number) => {
    for (const s of layout.stones) {
      const b = stoneBounds(s, layout.wedge);
      const cx = x < b[0] ? b[0] : x > b[3] ? b[3] : x;
      const cz = z < b[2] ? b[2] : z > b[5] ? b[5] : z;
      if ((cx - x) * (cx - x) + (cz - z) * (cz - z) >= R_ * R_) continue;
      if (b[4] <= y + 0.03 || b[1] >= y + H) continue;
      assert.fail(`${label} overlaps stone ${s.id} (${s.part}) at ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`);
    }
  };
  for (const e of MATCH_EMPLACEMENTS) {
    const floor = mountFloor(layout, e);
    for (const weapon of e.empty ? e.allowed! : [e.weapon]) {
      for (const seat of [0, 1]) {
        const p = crewPostXZ({ ...e, weapon }, seat);
        clear(`gun ${e.id} ${weapon} seat ${seat}`, p.x, floor, p.z);
      }
    }
  }
  for (const castle of [0, 1]) for (const kind of [StationKind.Bell, StationKind.Mast] as const) {
    const p = keeperPost(castle, kind);
    clear(`castle ${castle} keeper ${kind}`, p.x, p.y, p.z);
  }
  // A quiet match with the figures and one without them wake the same masonry.
  const withFigures = quiet(5);
  run(withFigures, 120);
  const awake = withFigures.world.castle.awakeCount();
  const start = Household.prototype.start;
  Household.prototype.start = function () {};
  const without = quiet(5);
  Household.prototype.start = start;
  run(without, 120);
  assert.equal(awake, without.world.castle.awakeCount(), "the crews wake no masonry");
  assert.equal(hh(without).started, false);
  withFigures.free();
  without.free();
});

test("one man of a crew down: the gun loads in half again the time, a replacement from the reserve takes his place, green", () => {
  const m = quiet(6, { masons: false, powder: false });
  const h = hh(m);
  const w = watch(m, [EventKind.HouseholdDown, EventKind.HouseholdUp]);
  const gun = station(m, 1, StationKind.Gun, 0);
  const si = h.stations.indexOf(gun);
  const layer = gun.seats[0];
  const man = layer.minion;
  const pid = layer.person;
  const t0 = m.tick;
  knock(m, man);
  run(m, 1, w.each);
  assert.equal(h.crew(0), 1);
  assert.equal(layer.state, SeatState.Due);
  assert.equal(layer.due, t0 + HOUSEHOLD.walkOut);
  assert.equal(h.lost[1], 1);
  assert.deepEqual(w.got.filter((e) => e[0] === EventKind.HouseholdDown).map((e) => e.slice(1, 5)), [[1, si, 0, pid]], "HouseholdDown: team, station, seat, person");
  assert.equal(h.nameOf(pid).length > 3, true);
  // The next shot loads in half again the time (trained: 1.0 for the skill).
  m.queue(m.tick, Team.Player, { kind: "fire", emplacement: 0, yaw: 0, pitch: 0.02, charge: 1, fuse: 0, spin: Spin.None });
  run(m, 1);
  assert.equal(m.world.reload[0], Math.round(LONG * HOUSEHOLD.oneHand) - 1, "reload 1.5 times");
  // Nobody walks out until walkOut has passed; then a Crew minion leaves the keep's door.
  const crewBefore = m.world.minions.list.length;
  run(m, t0 + HOUSEHOLD.walkOut - m.tick - 1, w.each);
  assert.equal(layer.state, SeatState.Due);
  assert.equal(h.reserve[1], HOUSEHOLD.reserve);
  run(m, 2, w.each);
  assert.equal(layer.state, SeatState.Walking);
  assert.equal(h.reserve[1], HOUSEHOLD.reserve - 1);
  assert.ok(m.world.minions.list.length > crewBefore);
  const walker = m.world.minions.list[layer.minion];
  assert.equal(walker.role, Role.Crew);
  assert.equal(walker.unit, 6);
  // He walks to the foot, is hoisted, and stands at the post.
  assert.ok(until(m, 2400, () => layer.state === SeatState.Hoisting) >= 0, "he reaches the foot");
  assert.equal(h.crew(0), 1, "not at his post yet");
  assert.ok(until(m, HOUSEHOLD.hoist + 5, () => layer.state === SeatState.AtPost) >= 0);
  run(m, 1, w.each);
  assert.equal(h.crew(0), 2);
  assert.equal(h.level(0), 0, "a replacement is green");
  assert.equal(h.reserve[1], HOUSEHOLD.reserve - 1);
  assert.ok(w.got.some((e) => e[0] === EventKind.HouseholdUp && e[2] === si && e[3] === 0), "HouseholdUp");
  assert.equal(m.world.minions.list[layer.minion].action, CrewAction.AtGun);
  // A green crew scatters wide and loads a tenth slower.
  assert.equal(h.reloadScale(0), HOUSEHOLD.skill.reload[0]);
  m.free();
});

test("both of a crew down: the gun does not fire on its own and leaves a salvo out; ridden it fires by hand and loads in twice the time", () => {
  // Gun 3, the swivel on the front tower, lays on men near the gate (the long gun's minimum range is longer than that).
  const autoShots = (kill: boolean) => {
    const m = new Match(R, layout, { seed: 8, barracks: false, garrison: false, plan: false, masons: false, powder: false });
    m.world.wind.x = m.world.wind.z = 0;
    if (kill) {
      const g = station(m, 1, StationKind.Gun, 3);
      knockSeat(m, g, 0);
      knockSeat(m, g, 1);
    }
    m.army.spawnWave(Team.Enemy, 1, 6, { x: 0, z: -108 });
    run(m, 400);
    const n = [...m.world.shotInfo.values()].filter((s) => s.emplacement === 3 && s.auto).length;
    return { n, crew: hh(m).crew(3), m };
  };
  const mark = (m: Match) => {
    m.register.marks[1][0] = { n: 1, x: 0, y: 0, z: -40, emplacement: 0, made: m.tick, fades: m.tick + 5000, life: 5000 };
  };
  const crewed = autoShots(false);
  assert.ok(crewed.n > 0, `the crewed swivel lays and fires on its own (${crewed.n} shots)`);
  mark(crewed.m);
  assert.ok(crewed.m.register.bearing(1, 1, true, false).includes(0), "a crewed gun bears on the mark");
  crewed.m.free();
  const bare = autoShots(true);
  assert.equal(bare.crew, 0);
  assert.equal(bare.n, 0, "with no crew it fires nothing on its own");
  const m = bare.m;
  assert.equal(m.guns[3].target, -1, "and lays on nothing");
  const g0 = station(m, 1, StationKind.Gun, 0);
  knockSeat(m, g0, 0);
  knockSeat(m, g0, 1);
  run(m, 1);
  assert.equal(hh(m).crew(0), 0);
  // A salvo leaves it out; riding it brings it back in.
  m.world.reload[0] = 0;
  const reg = m.register;
  mark(m);
  assert.ok(!reg.bearing(1, 1, true, false).includes(0), "a salvo skips a gun with no crew");
  m.queue(m.tick, Team.Player, { kind: "man", emplacement: 0 });
  run(m, 1);
  assert.ok(reg.bearing(1, 1, true, false).includes(0), "unless the team rides it");
  // Ridden: a fire by hand is accepted; it loads in twice the time.
  const shots = m.shots[1];
  m.queue(m.tick, Team.Player, { kind: "fire", emplacement: 0, yaw: 0, pitch: 0.02, charge: 1, fuse: 0, spin: Spin.None });
  run(m, 1);
  assert.equal(m.shots[1], shots + 1, "accepted");
  assert.equal(m.world.reload[0], Math.round(LONG * HOUSEHOLD.ownHands) - 1, "twice the time");
  m.free();
});

test("skill rises with shots (10, 30, 60) and falls to green when a replacement joins", () => {
  const m = quiet(9, { masons: false, powder: false });
  const h = hh(m);
  const g = station(m, 1, StationKind.Gun, 0);
  const men = g.seats.map((s) => h.people[s.person]);
  assert.deepEqual(men.map((p) => p.shots), [HOUSEHOLD.startShots, HOUSEHOLD.startShots]);
  assert.equal(h.level(0), 1);
  for (let i = 0; i < 19; i++) h.fired(0);
  assert.deepEqual([men[0].shots, h.level(0)], [29, 1], "under 30: trained");
  h.fired(0);
  assert.deepEqual([men[0].shots, h.level(0)], [30, 2], "30: seasoned");
  for (let i = 0; i < 29; i++) h.fired(0);
  assert.equal(h.level(0), 2, "59: still seasoned");
  h.fired(0);
  assert.deepEqual([men[0].shots, h.level(0)], [60, 3], "60: veteran");
  assert.equal(h.scatterScale(0), HOUSEHOLD.skill.scatter[3]);
  assert.equal(h.reloadScale(0), HOUSEHOLD.skill.reload[3]);
  // A shot the world fires counts for the men at the posts, whoever fired it.
  m.queue(m.tick, Team.Player, { kind: "fire", emplacement: 0, yaw: 0, pitch: 0.02, charge: 1, fuse: 0, spin: Spin.None });
  run(m, 1);
  assert.equal(men[0].shots, 61);
  assert.equal(men[1].shots, 61);
  // One of them falls: his replacement is green, and the crew is as skilled as its less skilled man.
  knockSeat(m, g, 0);
  assert.ok(until(m, 4000, () => g.seats[0].state === SeatState.AtPost && h.people[g.seats[0].person] !== men[0]) >= 0);
  assert.equal(h.people[g.seats[0].person].shots, 0);
  assert.equal(h.level(0), 0, "green again");
  assert.equal(h.people[g.seats[1].person].shots, 61, "the other is still a veteran");
  m.free();
});

test("scatter by skill: the mean angle a shot leaves its aim by, level 3 against level 0 over 40 shots each, is 0.6 against 1.3 of the weapon's", () => {
  const m = quiet(21, { masons: false, powder: false });
  m.world.wind.x = m.world.wind.z = 0;
  const h = hh(m);
  const g = station(m, 1, StationKind.Gun, 0);
  const men = g.seats.map((s) => h.people[s.person]);
  const world = m.world;
  /** Fire the long gun on a fixed aim; the launch direction after its first tick. */
  const launch = () => {
    world.reload[0] = 0;
    world.queue(world.tick, { kind: "fire", emplacement: 0, yaw: 0, pitch: 0.05, charge: 1, fuse: 0, spin: Spin.None });
    m.step();
    const f = world.collect();
    assert.ok(f.projectileCount >= 1);
    const o = 0;
    const vx = f.projectiles[o + 6], vy = f.projectiles[o + 7], vz = f.projectiles[o + 8];
    const l = Math.hypot(vx, vy, vz);
    world.castle.balls.forEach((b, i) => {
      if (b.alive) world.castle.removeBall(i);
    });
    return [vx / l, vy / l, vz / l];
  };
  // The reference: a shot with no scatter at all (the same aim, the same tick's drag and drop).
  const keep = HOUSEHOLD.skill.scatter.slice();
  for (let i = 0; i < keep.length; i++) HOUSEHOLD.skill.scatter[i] = 0;
  const ref = launch();
  for (let i = 0; i < keep.length; i++) HOUSEHOLD.skill.scatter[i] = keep[i];
  const mean = (shots: number) => {
    let sum = 0;
    for (let i = 0; i < 40; i++) {
      for (const p of men) p.shots = shots;
      const d = launch();
      const dot = Math.min(1, d[0] * ref[0] + d[1] * ref[1] + d[2] * ref[2]);
      sum += Math.acos(dot);
    }
    return sum / 40;
  };
  const green = mean(0), veteran = mean(60);
  const want = HOUSEHOLD.skill.scatter[3] / HOUSEHOLD.skill.scatter[0];
  const got = veteran / green;
  assert.ok(Math.abs(got / want - 1) <= 0.15, `veteran ${veteran.toFixed(5)} against green ${green.toFixed(5)}: ${got.toFixed(3)} (wanted ${want.toFixed(3)} within 15%)`);
  // And a green crew's mean is about two thirds of the weapon's angle times 1.3.
  assert.ok(Math.abs(green / (WEAPONS.longGun.scatter.angle * HOUSEHOLD.skill.scatter[0] * (2 / 3)) - 1) <= 0.25, `green ${green}`);
  m.free();
});

test("a chain shot through a gun's crew knocks the figures down, pays their bounties to the shooter's side, and leaves the gun standing", () => {
  const m = quiet(4, { masons: false, powder: false });
  const h = hh(m);
  m.world.wind.x = m.world.wind.z = 0;
  const w = watch(m, [EventKind.GunOut, EventKind.HouseholdDown]);
  const g = m.emplacements[8];
  const target = station(m, 0, StationKind.Gun, 8);
  const ids = target.seats.map((s) => s.minion);
  // Between the two men, at their chests: the chain's whirl takes both and its balls pass the gun's body by.
  const s = solveAim(m.emplacements[2], -0.4, 8.0, g.z + 1.7)!;
  m.queue(0, Team.Player, { kind: "fire", emplacement: 2, yaw: s.yaw, pitch: s.pitch, charge: 1, fuse: 0, spin: Spin.None });
  run(m, 150, w.each);
  for (const id of ids) assert.notEqual(m.world.minions.list[id].state, MinionState.Upright, "swept down");
  assert.equal(h.crew(8), 0);
  assert.equal(w.got.filter((e) => e[0] === EventKind.GunOut).length, 0, "the gun is not knocked out");
  assert.equal(m.world.mounts.up(8), true);
  const downs = w.got.filter((e) => e[0] === EventKind.HouseholdDown && e[1] === 0 && e[2] === h.stations.indexOf(target));
  assert.equal(downs.length, 2, "both are household losses");
  const bounty = m.economy.feed.filter((e) => e.kind === Earn.Bounty && e.team === Team.Player);
  assert.ok(bounty.length >= 2);
  assert.equal(bounty.reduce((a, e) => a + e.amount, 0), HOUSEHOLD.bounty * bounty.length, "8 gold each");
  assert.ok(HOUSEHOLD.bounty > GOLD.bounty);
  m.free();
});

test("the reserve empties, a seat stays empty at 0, and the reserve gains one a minute later which goes straight to it", () => {
  const m = quiet(10, { masons: false, powder: false });
  const h = hh(m);
  const w = watch(m, [EventKind.Reserve, EventKind.HouseholdDown]);
  const t0 = m.tick;
  const down: Array<[number, number]> = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0]];
  for (const [gun, k] of down) knockSeat(m, station(m, 1, StationKind.Gun, gun), k);
  run(m, 1, w.each);
  assert.equal(h.lost[1], 7);
  assert.equal(w.got.filter((e) => e[0] === EventKind.HouseholdDown).length, 7);
  run(m, t0 + HOUSEHOLD.walkOut - m.tick + 1, w.each);
  assert.equal(h.reserve[1], 0, "six hands went out");
  assert.deepEqual(w.got.filter((e) => e[0] === EventKind.Reserve).map((e) => e.slice(1, 3)), [[1, 0]], "the reserve ran dry");
  const last = station(m, 1, StationKind.Gun, 3).seats[0];
  assert.equal(last.state, SeatState.Due, "the seventh seat stays empty");
  assert.ok(last.due <= m.tick, "(its time has come)");
  const took = h.refillAt[1];
  assert.equal(took, t0 + HOUSEHOLD.walkOut + HOUSEHOLD.refill, "the clock started when the first hand went out");
  run(m, took - m.tick, w.each);
  assert.equal(h.reserve[1], 0);
  assert.equal(last.state, SeatState.Due);
  run(m, 1, w.each);
  assert.equal(last.state, SeatState.Walking, "the hand that came back went straight to the seat");
  assert.equal(h.reserve[1], 0);
  assert.ok(w.got.some((e) => e[0] === EventKind.Reserve && e[2] === 1), "the reserve gained one back from none");
  assert.equal(h.refillAt[1], took + HOUSEHOLD.refill, "and the clock runs on while it is under six");
  // The other team's household was not touched.
  assert.equal(h.reserve[0], HOUSEHOLD.reserve);
  m.free();
});

test("who is replaced first: guns, walls (masons) or powder, with one hand in the reserve; the input is checked and hashed", () => {
  const outcome = (first: FirstKind | null) => {
    const m = quiet(11);
    const h = hh(m);
    if (first) m.queue(0, Team.Player, { kind: "household", first });
    run(m, 1);
    h.reserve[1] = 1;
    const layer = station(m, 1, StationKind.Gun, 0).seats[0];
    const mason = station(m, 1, StationKind.Mason, 0).seats[0];
    const boy = station(m, 1, StationKind.Boy, 0).seats[0];
    knock(m, layer.minion);
    knock(m, mason.minion);
    knock(m, boy.minion);
    const t0 = m.tick;
    run(m, 1);
    assert.deepEqual([layer.state, mason.state, boy.state], [SeatState.Due, SeatState.Due, SeatState.Due]);
    assert.equal(layer.due, mason.due, "lost on the same tick");
    assert.equal(mason.due, boy.due);
    run(m, t0 + HOUSEHOLD.walkOut - m.tick + 2);
    const served = [layer, mason, boy].map((s) => s.state !== SeatState.Due);
    assert.equal(served.filter(Boolean).length, 1, "one hand, one seat");
    assert.equal(h.reserve[1], 0);
    const out = { served, first: h.first[1], hash: m.hash().state, man: [layer, mason, boy].map((s) => (s.minion >= 0 ? m.world.minions.list[s.minion].role : -1)) };
    m.free();
    return out;
  };
  const guns = outcome(null);
  assert.deepEqual(guns.served, [true, false, false], "guns first");
  assert.equal(guns.first, "guns");
  const walls = outcome("walls");
  assert.deepEqual(walls.served, [false, true, false], "walls first: the mason");
  assert.equal(walls.man[1], Role.Mason, "a mason out of the keep's door, at work");
  const powder = outcome("powder");
  assert.deepEqual(powder.served, [false, false, true], "powder first: a powder boy before either");
  assert.equal(powder.man[2], Role.Carrier);
  assert.notEqual(guns.hash, walls.hash);
  // A malformed input is refused (and changes nothing); a good one is in the hash.
  const a = quiet(12), b = quiet(12), c = quiet(12);
  a.queue(2, Team.Player, { kind: "household", first: "nonsense" as FirstKind });
  b.queue(2, Team.Player, { kind: "household" } as never);
  c.queue(2, Team.Player, { kind: "household", first: "powder" });
  run(a, 4);
  run(b, 4);
  run(c, 4);
  assert.equal(hh(a).first[1], "guns");
  assert.equal(hh(b).first[1], "guns");
  assert.equal(hh(c).first[1], "powder");
  assert.equal(a.hash().state, b.hash().state, "refused: the same match");
  assert.notEqual(a.hash().state, c.hash().state, "the setting is in the hash");
  a.free();
  b.free();
  c.free();
});

test("a gun's mount brought down: its crew fall with it, the replacements wait at the foot until it stands again, and the gun is back only with a man at its post", () => {
  const m = quiet(12, { masons: false, powder: false });
  const h = hh(m);
  const w = watch(m, [EventKind.GunOut, EventKind.GunBack, EventKind.HouseholdDown]);
  const g = station(m, 1, StationKind.Gun, 0);
  const old = g.seats.map((s) => s.minion);
  const pieces = [...m.world.mounts.pieces[0]];
  for (const id of pieces) m.world.castle.knockLoose(id, 0, -50, 0);
  run(m, 3, w.each);
  assert.deepEqual(w.got.filter((e) => e[0] === EventKind.GunOut).map((e) => [e[1], e[2]]), [[0, 1]], "out by its mount");
  for (const id of old) assert.equal(m.world.minions.list[id].downCause, Cause.Fall, "the crew fell with it");
  assert.equal(h.crew(0), 0);
  assert.equal(w.got.filter((e) => e[0] === EventKind.HouseholdDown).length, 2);
  // They walk out, and wait at the foot: the masonry is down.
  assert.ok(until(m, 4000, () => g.seats.every((s) => s.state === SeatState.Waiting)) >= 0, "the replacements wait at the foot");
  assert.equal(h.reserve[1], HOUSEHOLD.reserve - 2);
  run(m, 120);
  assert.ok(g.seats.every((s) => s.state === SeatState.Waiting), "and go on waiting while it is down");
  assert.equal(m.world.mounts.up(0), false);
  // Masons put it back.
  for (const id of pieces) m.world.castle.restore(id);
  run(m, 2, w.each);
  assert.ok(g.seats.every((s) => s.state === SeatState.Hoisting), "hoisted once it stands");
  assert.equal(m.world.mounts.up(0), false, "not back with nobody at its post");
  assert.equal(m.world.mounts.guns[0].wait, OutWait.Hands);
  const rep = new Int16Array(64);
  m.world.mounts.report(m.tick, rep);
  assert.equal(rep[0], 1 + OutWait.Hands, "the page reads 'no hands'");
  assert.ok(until(m, 400, () => m.world.mounts.up(0)) >= 0, "back once a man is at its post");
  run(m, 1, w.each);
  assert.ok(h.crew(0) >= 1);
  assert.ok(w.got.some((e) => e[0] === EventKind.GunBack && e[1] === 0));
  m.free();
});

test("a bought gun arrives with two green men at its posts, new people; the reserve is unchanged", () => {
  const m = quiet(13, { masons: false, powder: false });
  const h = hh(m);
  m.gold[Team.Player] += 600;
  const people = h.people.length;
  const g = station(m, 1, StationKind.Gun, 4);
  assert.deepEqual(g.seats.map((s) => s.state), [SeatState.Empty, SeatState.Empty]);
  m.queue(0, Team.Player, { kind: "buy", emplacement: 4, weapon: "swivel" });
  run(m, 2);
  assert.equal(m.emplacements[4].empty, false);
  assert.equal(h.crew(4), 2);
  assert.equal(h.level(4), 0, "green");
  assert.equal(h.people.length, people + 2, "two new people");
  assert.equal(h.reserve[1], HOUSEHOLD.reserve, "the reserve is not touched");
  for (const [k, s] of g.seats.entries()) {
    assert.equal(s.state, SeatState.AtPost);
    const man = m.world.minions.list[s.minion];
    const p = crewPostXZ(m.emplacements[4], k);
    assert.ok(Math.hypot(man.x - p.x, man.z - p.z) < 1e-9, "at his post");
    assert.equal(h.people[s.person].shots, 0);
  }
  assert.equal(h.reloadScale(4), HOUSEHOLD.skill.reload[0]);
  m.free();
});

test("a keeper down gates his organ until his replacement is at his post: the bell, the mast and the spotter's tower", () => {
  const SPOT = [{ plot: 0, kind: "barracks" as const }, { plot: 5, kind: "magazine" as const }, { plot: 7, kind: "spotter" as const }];
  const m = quiet(14, { startBuildings: [SPOT, SPOT] });
  const h = hh(m);
  m.step();
  assert.ok(m.organUp(1, "bell") && m.organUp(1, "mast") && m.organUp(1, "crane"));
  assert.ok(m.spotter(1) && m.estate.spotter(1));
  const keeperTests: Array<[string, StationKind.Bell | StationKind.Mast | StationKind.Spotter, () => boolean]> = [
    ["bell", StationKind.Bell, () => m.organUp(1, "bell")],
    ["mast", StationKind.Mast, () => m.organUp(1, "mast")],
    ["spotter", StationKind.Spotter, () => m.spotter(1)],
  ];
  for (const [name, kind, up] of keeperTests) {
    const st = h.stations.find((s) => s.team === 1 && s.kind === kind)!;
    assert.equal(st.seats[0].state, SeatState.AtPost, name);
    const person = st.seats[0].person;
    knock(m, st.seats[0].minion);
    run(m, 1);
    assert.equal(up(), false, `${name}: down with his keeper`);
    if (name !== "spotter") assert.equal(m.organUp(1, "crane"), true, "the crane has no keeper");
    else assert.equal(m.estate.spotter(1), true, "the tower itself stands");
    assert.equal(h.keeper(1, kind), false);
    assert.equal(st.seats[0].state, SeatState.Due);
    assert.ok(until(m, 5000, () => st.seats[0].state === SeatState.AtPost) >= 0, `${name}: his replacement takes the post`);
    assert.notEqual(st.seats[0].person, person);
    m.step();
    assert.equal(up(), true, `${name}: up again with his replacement`);
  }
  assert.equal(h.lost[1], 3);
  m.free();
});

test("a newly built spotter's tower brings its spotter; wrecked, he falls and his seat waits; a tower rebuilt on any plot is the same station", () => {
  const m = quiet(15, { masons: false, powder: false });
  const h = hh(m);
  m.gold[Team.Player] += 900;
  const st = h.stations.find((s) => s.team === 1 && s.kind === StationKind.Spotter)!;
  assert.equal(st.seats[0].state, SeatState.Empty);
  assert.equal(m.spotter(1), false);
  const people = h.people.length;
  m.queue(0, Team.Player, { kind: "build", plot: 7, building: "spotter" });
  assert.ok(until(m, 3000, () => m.estate.spotter(1)) >= 0, "the tower works");
  m.step();
  assert.equal(st.seats[0].state, SeatState.AtPost, "its spotter is at his post");
  assert.equal(st.index, 7);
  assert.equal(h.people.length, people + 1, "a new person");
  assert.equal(h.reserve[1], HOUSEHOLD.reserve, "not from the reserve");
  assert.equal(m.spotter(1), true);
  // Wrecked: he falls.
  const slot = m.world.structures!.slot(1, 7);
  for (const id of slot.ids) m.world.castle.knockLoose(id, 0, -20, 0);
  assert.ok(until(m, 60, () => st.seats[0].state === SeatState.Due) >= 0, "he falls with his tower");
  assert.equal(m.spotter(1), false);
  // While it is a ruin his seat waits: no hand is spent.
  run(m, HOUSEHOLD.walkOut + 60);
  assert.equal(st.seats[0].state, SeatState.Due);
  assert.equal(h.reserve[1], HOUSEHOLD.reserve);
  // A tower built on another plot is the same station.
  m.queue(m.tick, Team.Player, { kind: "build", plot: 6, building: "spotter" });
  assert.ok(until(m, 3000, () => m.estate.spotter(1)) >= 0);
  m.step();
  assert.equal(st.index, 6);
  assert.ok(until(m, 4000, () => st.seats[0].state === SeatState.AtPost) >= 0, "his replacement takes the post");
  assert.equal(h.reserve[1], HOUSEHOLD.reserve - 1);
  m.step();
  assert.equal(m.spotter(1), true);
  m.free();
});

test("the household is not counted among men standing, attackers or defenders; its men pay 8 gold, a soldier 4", () => {
  const m = quiet(16);
  const h = hh(m);
  run(m, 30);
  const upright = m.world.minions.list.filter((x) => x.role === Role.Crew || x.role === Role.Mason || x.role === Role.Carrier).filter((x) => x.state === MinionState.Upright);
  assert.ok(upright.length >= 2 * (8 + 4 + 3 + 2), `${upright.length} of the household stand`);
  assert.deepEqual([m.army.standing(0), m.army.standing(1)], [0, 0]);
  assert.deepEqual([m.army.attackers[0], m.army.attackers[1], m.army.defenders[0], m.army.defenders[1]], [0, 0, 0, 0]);
  assert.deepEqual(m.armyCounts().standing, [0, 0]);
  // A mason, a powder boy, a crewman and a keeper pay 8; a pikeman 4.
  m.army.spawnWave(Team.Enemy, 1, 2, { x: 0, z: -60 });
  run(m, 2);
  const pay = (id: number) => {
    m.economy.feed.length = 0;
    knock(m, id);
    run(m, 1);
    const e = m.economy.feed.filter((x) => x.kind === Earn.Bounty);
    return e.map((x) => [x.team, x.amount]);
  };
  const mason = station(m, 1, StationKind.Mason, 0).seats[0].minion;
  const boy = station(m, 1, StationKind.Boy, 0).seats[0].minion;
  const crew = station(m, 1, StationKind.Gun, 1).seats[1].minion;
  const keeper = station(m, 1, StationKind.Bell, 0).seats[0].minion;
  assert.deepEqual(pay(mason), [[0, HOUSEHOLD.bounty]]);
  assert.deepEqual(pay(boy), [[0, HOUSEHOLD.bounty]]);
  assert.deepEqual(pay(crew), [[0, HOUSEHOLD.bounty]]);
  assert.deepEqual(pay(keeper), [[0, HOUSEHOLD.bounty]]);
  const pike = m.world.minions.list.find((x) => x.team === Team.Enemy && x.role === Role.March && x.state === MinionState.Upright)!;
  assert.deepEqual(pay(pike.id), [[1, GOLD.bounty]]);
  assert.equal(m.stats(Team.Player).householdLost, h.lost[1]);
  assert.equal(h.lost[1], 4);
  assert.equal(m.stats(Team.Enemy).householdLost, 0);
  m.free();
});

void GUN_HITS;
void PROJECTILE_STRIDE;
