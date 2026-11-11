// 3.2 range and register: marks made from your own shots, guns nobody mans on
// marked ground, fire for effect.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, MATCH_EMPLACEMENTS, REGISTER, UNMANNED, weaponOf, WEAPONS, Unit } from "@keepfall/content";
import { MinionState, OutCause, SandboxSim, Spin, type Rapier } from "@keepfall/sim";
import { Match, Register, Team, type MatchInput } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);

const quiet = { barracks: false, garrison: false, masons: false, gunnery: false, plan: false } as const;
const newMatch = (seed = 3, opts: Record<string, unknown> = {}) => {
  const m = new Match(R, layout, { seed, ...quiet, ...opts });
  m.world.wind.x = m.world.wind.z = 0;
  return m;
};
/** The long gun's aim at the road the enemy's left-route waves take (the pinned wave match fires the same shot). */
const ROAD = { kind: "fire", emplacement: 0, yaw: 0.4845, pitch: -0.0573, charge: 1, fuse: 0, spin: Spin.None } as const;

/** Mark ground without a shot: a landing of the emplacement at (x, z), marked at once. */
function markAt(m: Match, x: number, z: number, emp = 0, team = 1): boolean {
  m.register.landings[emp] = { x, y: m.world.terrain.heightAt(x, z), z, tick: m.tick };
  return m.register.makeMark(team, emp, m.tick);
}

function stepUntil(m: Match, ticks: number, until: () => boolean): boolean {
  for (let i = 0; i < ticks; i++) {
    if (until()) return true;
    m.step();
  }
  return until();
}

test("a mark is made only from the team's own shot by hand, within the window; one landing makes one mark", () => {
  const m = newMatch();
  // No landing yet: refused.
  m.queue(2, Team.Player, { kind: "mark", emplacement: 0 });
  for (let i = 0; i < 5; i++) m.step();
  assert.equal(m.register.list(Team.Player).length, 0, "no landing, no mark");
  // A shot by hand comes down.
  m.queue(m.tick, Team.Player, ROAD);
  assert.ok(stepUntil(m, 400, () => m.register.landings[0] !== null), "the shot came down");
  const land = m.register.landings[0]!;
  // The other team cannot mark it, and neither can the player name the enemy's gun.
  m.queue(m.tick, Team.Enemy, { kind: "mark", emplacement: 0 });
  m.queue(m.tick, Team.Player, { kind: "mark", emplacement: 8 });
  m.step();
  assert.equal(m.register.list(Team.Player).length + m.register.list(Team.Enemy).length, 0, "other team's gun and other team's input refused");
  // The player marks it.
  m.queue(m.tick, Team.Player, { kind: "mark", emplacement: 0 });
  m.step();
  const marks = m.register.list(Team.Player);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].n, 1);
  assert.deepEqual([marks[0].x, marks[0].z], [land.x, land.z]);
  assert.equal(marks[0].emplacement, 0);
  assert.equal(marks[0].fades - marks[0].made, REGISTER.life);
  assert.equal(m.register.list(Team.Enemy).length, 0, "the other side has none");
  // One landing, one mark.
  m.queue(m.tick, Team.Player, { kind: "mark", emplacement: 0 });
  m.step();
  assert.equal(m.register.list(Team.Player).length, 1);
  m.free();
});

test("a mark is refused for an auto shot and after the window", () => {
  const m = newMatch();
  // An auto shot (as guns nobody mans fire) from the player's long gun.
  m.world.queue(0, { ...ROAD, auto: true });
  assert.ok(stepUntil(m, 400, () => m.world.landings.some((l) => l.auto)), "the auto shot came down");
  m.step();
  assert.equal(m.register.landings[0], null, "an auto landing is not remembered");
  assert.equal(m.register.makeMark(Team.Player, 0, m.tick), false);
  // A shot by hand, marked one tick too late.
  m.queue(m.tick + 400, Team.Player, ROAD);
  assert.ok(stepUntil(m, 800, () => m.register.landings[0] !== null));
  const at = m.register.landings[0]!.tick;
  for (let i = 0; i < REGISTER.markWindow + 1; i++) m.step();
  assert.equal(m.register.canMark(Team.Player, 0, at + REGISTER.markWindow + 1), false);
  assert.equal(m.register.makeMark(Team.Player, 0, at + REGISTER.markWindow + 1), false, "after the window");
  assert.equal(m.register.makeMark(Team.Player, 0, at + REGISTER.markWindow), true, "on its last tick");
  m.free();
});

test("marks fade at life, a hand shot landing inside refreshes one, a seventh replaces the oldest and keeps the places", () => {
  const m = newMatch();
  const reg = m.register;
  // Six marks along the road, a tick apart, then a seventh.
  for (let n = 0; n < REGISTER.max; n++) {
    assert.ok(markAt(m, 20 + n * 15, -60), `mark ${n + 1}`);
    m.step();
  }
  assert.deepEqual(reg.list(Team.Player).map((k) => k.n), [1, 2, 3, 4, 5, 6]);
  assert.ok(markAt(m, 0, -40), "a seventh");
  const after = reg.list(Team.Player);
  assert.equal(after.length, REGISTER.max);
  assert.equal(after[after.length - 1].n, 1, "it took the oldest one's place");
  assert.equal(after[after.length - 1].x, 0);
  assert.deepEqual(after.map((k) => k.n), [2, 3, 4, 5, 6, 1], "the others keep their place numbers");
  // An eighth takes place 2.
  m.step();
  assert.ok(markAt(m, 10, -40));
  assert.equal(reg.mark(Team.Player, 2)!.x, 10);
  // A mark that fades frees its place: the next takes the lowest free one.
  const m3 = reg.mark(Team.Player, 3)!;
  reg.beforeStep(m3.fades - 1);
  assert.ok(reg.mark(Team.Player, 3), "stands until its tick");
  reg.beforeStep(m3.fades);
  assert.equal(reg.mark(Team.Player, 3), null, "gone at life");
  m.step();
  assert.ok(markAt(m, 55, -45));
  assert.equal(reg.mark(Team.Player, 3)!.x, 55, "the lowest free place");
  // A shot by hand landing inside a mark refreshes it; an auto shot, the enemy's gun, or a landing outside does not.
  const k = reg.mark(Team.Player, 4)!;
  const was = k.fades;
  const land = (emplacement: number, auto: boolean, x: number, z: number) => m.world.landings.push({ shot: 99, emplacement, auto, x, y: 0, z });
  m.world.landings.length = 0;
  land(0, true, k.x, k.z);
  land(8, false, k.x, k.z);
  land(0, false, k.x + REGISTER.radius + 0.5, k.z);
  reg.afterStep(was - 100);
  assert.equal(k.fades, was, "none of those refresh it");
  m.world.landings.length = 0;
  land(0, false, k.x + REGISTER.radius - 0.5, k.z);
  reg.afterStep(was - 100);
  assert.equal(k.fades, was - 100 + REGISTER.life, "a hand shot inside refreshes it");
  m.world.landings.length = 0;
  m.free();
});

test("a mark nobody can see is the team's alone: the other team's list stays empty, and onMark reads the radius", () => {
  const m = newMatch();
  assert.ok(markAt(m, 30, -60));
  assert.equal(m.register.onMark(Team.Player, 30 + REGISTER.radius - 0.1, -60), true);
  assert.equal(m.register.onMark(Team.Player, 30 + REGISTER.radius + 0.1, -60), false);
  assert.equal(m.register.onMark(Team.Enemy, 30, -60), false);
  m.free();
});

test("on marked ground a gun nobody mans gets the smaller error, the 2x reload and lays on a man beyond DEFEND; off it nothing changes", () => {
  const run = (marked: boolean) => {
    const m = newMatch(5, { gunnery: [false, true] });
    m.army.spawnWave(Team.Enemy, 1, 8, { x: 0, z: -60 });
    if (marked) assert.ok(markAt(m, 0, -60));
    let first = -1, reload = 0, gun = -1, err = 0, range = 0, wasMarked = false;
    let everMarked = false;
    for (let i = 0; i < 700; i++) {
      m.step();
      for (const g of m.guns) if (g.marked) everMarked = true;
      if (first < 0 && m.autoShots[Team.Player] > 0) {
        first = m.tick;
        // The gun that has just fired is the one with the longest reload left.
        gun = m.world.reload.slice(0, 8).indexOf(Math.max(...m.world.reload.slice(0, 8)));
        reload = m.world.reload[gun];
        const g = m.guns[gun];
        err = Math.hypot(g.errX, g.errZ);
        wasMarked = g.marked;
        const e = m.emplacements[gun];
        range = Math.hypot(e.x - 0, e.z + 60);
      }
    }
    const result = { first, reload, gun, err, range, wasMarked, everMarked, autos: m.autoShots[Team.Player], men: m.world.minions.list.filter((x) => x.team === Team.Enemy && x.state === MinionState.Upright).length };
    m.free();
    return result;
  };
  const off = run(false);
  const on = run(true);
  assert.equal(off.autos, 0, "off marked ground nobody beyond DEFEND is engaged");
  assert.equal(off.everMarked, false);
  assert.ok(on.autos > 0, "on it, the guns lay on the men 70 m from the gate");
  assert.equal(on.wasMarked, true);
  const w = weaponOf(MATCH_EMPLACEMENTS[on.gun]);
  const U = UNMANNED[MATCH_EMPLACEMENTS[on.gun].weapon]!;
  assert.ok(on.reload > w.reload * REGISTER.reload * 0.5 && on.reload <= Math.round(w.reload * REGISTER.reload), `reload ${on.reload} follows 2x of ${w.reload}, not ${U.reload}x`);
  assert.ok(on.err <= (U.errBase + U.errPerM * on.range) * REGISTER.errScale + 0.01, `error ${on.err.toFixed(2)} within a quarter of the usual`);
  void WEAPONS;
});

test("a salvo fires only guns that are loaded, standing and bear; the mortar only when asked", () => {
  const m = newMatch();
  assert.ok(markAt(m, 46, -45));
  const reg = m.register;
  const all = reg.bearing(Team.Player, 1, false);
  assert.ok(all.includes(0) && all.includes(2), `bearing ${all}`);
  assert.ok(!all.includes(1), "not the mortar");
  assert.ok(all.every((id) => id < 8 && !m.emplacements[id].empty), "only the player's armed guns");
  const dist = (id: number) => Math.hypot(m.emplacements[id].x - 46, m.emplacements[id].z + 45);
  for (let i = 1; i < all.length; i++) assert.ok(dist(all[i - 1]) <= dist(all[i]), "nearest first");
  assert.ok(reg.bearing(Team.Player, 1, true).includes(1), "the mortar joins when asked");
  assert.deepEqual(reg.bearing(Team.Player, 2, false), [], "no such mark");
  assert.deepEqual(reg.bearing(Team.Enemy, 1, false), [], "the other team has none");
  // A gun that is reloading, and one that is knocked out, are left out.
  m.queue(m.tick, Team.Player, { kind: "fire", emplacement: 2, yaw: 0.6, pitch: 0.05, charge: 1, fuse: 0, spin: Spin.None });
  m.step();
  assert.ok(!reg.bearing(Team.Player, 1, false).includes(2), "reloading");
  m.world.mounts.knockOut(0, OutCause.Shot, -1, m.tick);
  assert.ok(!reg.bearing(Team.Player, 1, false).includes(0), "knocked out");
  m.free();
});

test("a salvo goes off over its span from the nearest gun out, with the quarter error, and never into the team's own castle", () => {
  const m = newMatch();
  assert.ok(markAt(m, 46, -45));
  const baseDown = m.masonryDown(1);
  const guns = m.register.bearing(Team.Player, 1, true);
  assert.ok(guns.length >= 3, `${guns.length} guns bear`);
  const t0 = m.tick;
  m.queue(t0, Team.Player, { kind: "man", emplacement: 0 });
  m.queue(t0, Team.Player, { kind: "salvo", mark: 1, mortar: true });
  const firedAt = new Map<number, number>();
  const landed: Array<[number, number, number]> = [];
  for (let i = 0; i < 700; i++) {
    m.step();
    for (let id = 0; id < 8; id++) if (m.world.reload[id] > 0 && !firedAt.has(id)) firedAt.set(id, m.tick);
    for (const l of m.world.landings) if (l.auto) landed.push([l.emplacement, l.x, l.z]);
  }
  assert.deepEqual([...firedAt.keys()].sort((a, b) => a - b), [...guns].sort((a, b) => a - b), "exactly the guns that bear fired");
  const order = [...firedAt.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map((e) => e[0]);
  assert.deepEqual(order, guns, "from the gun nearest the mark outwards");
  const span = Math.max(...firedAt.values()) - Math.min(...firedAt.values());
  assert.ok(span <= REGISTER.salvoSpan + 1 && span >= REGISTER.salvoSpan - 2, `spread over ${span} ticks`);
  assert.equal(landed.length, guns.length, "every shot came down");
  for (const [, x, z] of landed) assert.ok(Math.hypot(x - 46, z + 45) < 14, `landed ${Math.hypot(x - 46, z + 45).toFixed(1)} m from the mark`);
  console.log("DOWN1", m.masonryDown(1), "at start", baseDown, JSON.stringify(landed));
  assert.equal(m.masonryDown(1), baseDown, "nothing of the player's own castle came down");
  // The ridden gun fires with its own reload and its barrel is left alone; the others take 2x and turn.
  const w0 = WEAPONS.longGun;
  assert.ok(m.world.reload[0] <= w0.reload, "the ridden gun reloads as usual");
  assert.equal(m.guns[0].yaw, 0, "its barrel is left to the page");
  assert.notEqual(m.guns[2].yaw, m.emplacements[2].baseYaw, "a gun nobody rides turned to the mark");
  m.free();
});

test("a salvo is refused when nothing bears (no 20 s spent), twice within salvoEvery, and by a team with no mark", () => {
  const m = newMatch();
  const reg = m.register;
  // A mark out of every gun's reach.
  assert.ok(markAt(m, 0, 250));
  assert.deepEqual(reg.bearing(Team.Player, 1, true), []);
  assert.equal(reg.salvo(Team.Player, 1, true, m.tick), false);
  assert.equal(reg.salvoAt[Team.Player], -1e9, "no 20 s spent");
  assert.equal(reg.queued.length, 0);
  // A mark in reach.
  assert.ok(markAt(m, 46, -45));
  assert.equal(reg.salvo(Team.Enemy, 2, false, m.tick), false, "the other team has no mark 2");
  assert.equal(reg.salvo(Team.Player, 2, false, m.tick), true);
  const queued = reg.queued.length;
  assert.ok(queued > 0);
  for (let i = 0; i < 100; i++) m.step();
  const t = m.tick;
  assert.equal(reg.salvo(Team.Player, 2, false, t), false, "not again so soon");
  assert.equal(reg.salvo(Team.Player, 2, false, reg.salvoAt[Team.Player] + REGISTER.salvoEvery - 1), false, "not 1 tick short of 20 s");
  while (m.tick < REGISTER.salvoEvery + 100) m.step();
  assert.ok(reg.bearing(Team.Player, 2, false).length > 0, "reloaded");
  assert.equal(reg.salvo(Team.Player, 2, false, m.tick), true, "after 20 s, with guns loaded");
  m.free();
});

test("wellFormed refuses malformed mark and salvo inputs", () => {
  const m = newMatch();
  assert.ok(markAt(m, 46, -45));
  const bad = (input: unknown) => m.queue(m.tick, Team.Player, input as MatchInput);
  for (const mark of [0, 7, 1.5, "1", NaN, -1, null]) bad({ kind: "salvo", mark });
  bad({ kind: "salvo", mark: 1, mortar: "yes" });
  for (let i = 0; i < 3; i++) m.step();
  assert.equal(m.register.queued.length, 0);
  assert.equal(m.register.salvoAt[Team.Player], -1e9);
  // Marks: emplacement out of range or not an integer.
  m.register.landings[0] = { x: 1, y: 0, z: -60, tick: m.tick };
  const before = m.register.list(Team.Player).length;
  for (const emplacement of [-1, 16, 99, 0.5, "0", undefined, NaN]) bad({ kind: "mark", emplacement });
  for (let i = 0; i < 3; i++) m.step();
  assert.equal(m.register.list(Team.Player).length, before);
  assert.notEqual(m.register.landings[0], null, "the landing is still there");
  // The well-formed ones go through.
  m.queue(m.tick, Team.Player, { kind: "salvo", mark: 1 });
  m.step();
  assert.ok(m.register.queued.length > 0);
  m.free();
});

test("the same seed and inputs give the same hash twice; marks and salvos are in it", () => {
  const run = (script: boolean) => {
    const m = newMatch(9);
    m.queue(1, Team.Player, ROAD);
    if (script) {
      m.queue(120, Team.Player, { kind: "mark", emplacement: 0 });
      m.queue(130, Team.Player, { kind: "salvo", mark: 1, mortar: true });
    }
    for (let i = 0; i < 500; i++) m.step();
    const h = m.hash();
    m.free();
    return h;
  };
  const a = run(true), b = run(true), c = run(false);
  assert.deepEqual(a, b);
  assert.notEqual(a.state, c.state, "a mark and a salvo change the hash");
});

test("the register runs on a bare sandbox (the Practice range): one team's guns, marks, a salvo", () => {
  const emps = MATCH_EMPLACEMENTS.map((e) => ({ ...e }));
  const world = new SandboxSim(R, layout, { seed: 4, minions: 0, emplacements: emps });
  world.wind.x = world.wind.z = 0;
  const reg = new Register({ world, emplacements: emps, owner: (id) => (emps[id].z < -75 ? 1 : 0), manned: () => 0, reloadScale: () => 1 }, 4);
  world.queue(0, { ...ROAD });
  let landed = false;
  for (let i = 0; i < 400 && !landed; i++) {
    reg.beforeStep(world.tick);
    world.step();
    reg.afterStep(world.tick - 1);
    landed = reg.landings[0] !== null;
  }
  assert.ok(landed);
  assert.ok(reg.makeMark(1, 0, world.tick));
  assert.ok(reg.salvo(1, 1, false, world.tick));
  for (let i = 0; i < 200; i++) {
    reg.beforeStep(world.tick);
    world.step();
    reg.afterStep(world.tick - 1);
  }
  assert.ok(world.reload[2] > 0 || world.reload[0] > 0, "its guns fired");
  world.free();
});

test("a salvo skips guns when its own men stand at the mark, at order time and when they walk in later", () => {
  const m = newMatch();
  const reg = m.register;
  assert.ok(markAt(m, 46, -45));
  assert.ok(reg.bearing(Team.Player, 1, false).length > 0, "clear ground bears");
  // Order it, then a man of the team walks onto the mark before the shots go.
  assert.equal(reg.salvo(Team.Player, 1, false, m.tick), true);
  const queued = reg.queued.length;
  assert.ok(queued > 0);
  const w = m.world.army!.newWave(Team.Player, 1, true);
  m.world.army!.spawnAt(Team.Player, w, Unit.Pikeman, 46, -45, 0).speed = 0;
  for (let i = 0; i < 400; i++) m.step();
  assert.equal(reg.queued.length, 0, "the queue ran out");
  for (let id = 0; id < 8; id++) assert.equal(m.world.reload[id], 0, `gun ${id} did not fire`);
  // And a salvo ordered now finds nothing that bears, though the guns are loaded.
  assert.deepEqual(reg.bearing(Team.Player, 1, false), []);
  assert.deepEqual(reg.bearing(Team.Player, 1, false, false), [], "own men, not reload: still no gun");
  assert.equal(reg.salvo(Team.Player, 1, false, m.tick + 5000), false);
  m.free();
});

test("a salvo does not fire where a bridge is at risk", () => {
  const m = newMatch();
  const reg = m.register;
  const b = layout.bridges.find((x) => x.site.name === "centre")!.site;
  assert.ok(markAt(m, b.x, b.z));
  assert.deepEqual(reg.bearing(Team.Player, 1, true, false), [], "a mark on a bridge is nobody's target");
  m.free();
});

test("bearing(..., loaded = false) skips only the reload test", () => {
  const m = newMatch();
  const reg = m.register;
  assert.ok(markAt(m, 46, -45));
  m.queue(m.tick, Team.Player, { kind: "fire", emplacement: 2, yaw: 0.6, pitch: 0.05, charge: 1, fuse: 0, spin: Spin.None });
  m.step();
  assert.ok(!reg.bearing(Team.Player, 1, false).includes(2));
  assert.ok(reg.bearing(Team.Player, 1, false, false).includes(2), "reloading gun counts as bearing when not asked for loaded");
  m.world.mounts.knockOut(0, OutCause.Shot, -1, m.tick);
  assert.ok(!reg.bearing(Team.Player, 1, false, false).includes(0), "a knocked-out gun still does not");
  m.free();
});

test("a salvo's queued shots drop when their mark is replaced in place by a seventh", () => {
  const m = newMatch();
  const reg = m.register;
  for (let i = 0; i < REGISTER.max; i++) {
    assert.ok(markAt(m, 46, -45));
    m.step();
  }
  assert.equal(reg.mark(Team.Player, 1)!.n, 1);
  assert.equal(reg.salvo(Team.Player, 1, false, m.tick), true);
  assert.ok(reg.queued.length > 0);
  assert.ok(reg.queued.every((q) => q.made === reg.mark(Team.Player, 1)!.made));
  // A seventh mark replaces the oldest, which is place 1.
  assert.ok(markAt(m, 20, -40));
  assert.equal(reg.mark(Team.Player, 1)!.x, 20);
  for (let i = 0; i < 400; i++) m.step();
  assert.equal(reg.queued.length, 0);
  for (let id = 0; id < 8; id++) assert.equal(m.world.reload[id], 0, `gun ${id} did not fire at the new spot`);
  m.free();
});
