// Powder in the world (3.3): each castle's store, the ready box beside every gun,
// the powder boys who carry kegs to them, kegs that burst, the magazine that blows.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import {
  BUILDINGS,
  buildLayout,
  castleOfEmp,
  GAME_LAYOUT,
  KEG,
  keepDoor,
  magazineBurst,
  magazineDoor,
  mirrorZ,
  CASTLE_SHAPE,
  MATCH_EMPLACEMENTS,
  plotCentre,
  POWDER,
  powderCost,
  shotCost,
  Unit,
  type BurstDef,
  type Emplacement,
} from "@keepfall/content";
import { BoyTask, Cause, EVENT_STRIDE, EventKind, MinionState, navCell, NavKind, PlotState, Role, SandboxSim, Spin, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);

const START = [0, 1].flatMap((castle) => [{ castle, plot: 0, kind: "barracks" as const }, { castle, plot: 5, kind: "magazine" as const }]);
const world = (opts: { buildings?: Array<{ castle: number; plot: number; kind: "barracks" | "mill" | "foundry" | "magazine" }>; emplacements?: Emplacement[]; seed?: number } = {}) =>
  new SandboxSim(R, layout, { seed: opts.seed ?? 7, minions: 0, army: true, emplacements: opts.emplacements ?? MATCH_EMPLACEMENTS.map((e) => ({ ...e })), buildings: opts.buildings ?? START });
const run = (sim: SandboxSim, ticks: number, each?: (sim: SandboxSim) => void) => {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    each?.(sim);
  }
};
/** The events since the last look, as [kind, a, b, c, d]. */
const events = (sim: SandboxSim): number[][] => {
  const f = sim.collect();
  const out: number[][] = [];
  for (let i = 0; i < f.eventCount; i++) out.push(Array.from(f.events.slice(i * EVENT_STRIDE, (i + 1) * EVENT_STRIDE)));
  return out;
};
const gunOf = (sim: SandboxSim, castle: number, weapon: string) => sim.emplacements.find((e) => !e.empty && e.weapon === weapon && castleOfEmp(e) === castle)!;
const drain = (sim: SandboxSim, id: number) => {
  while (sim.carriers!.pay(id)) {
    /* empty its box */
  }
};
const fireOf = (id: number) => ({ kind: "fire" as const, emplacement: id, yaw: 0, pitch: 0.03, charge: 1, fuse: 0, spin: Spin.None });
/** A burst too small to hurt anything: for putting a burst's centre somewhere without wrecking what stands there. */
const TINY: BurstDef = { ...KEG.burst, radius: 0.5, shatter: 0, power: 0, lift: 0, knock: 0.5, knockSpeed: 0, crater: 0.01, depth: 0 };
/** A burst in the middle of the step the carriers look at (the world clears its record when a step begins, so tests ask for the look themselves). */
const burstNow = (sim: SandboxSim, x: number, y: number, z: number, shot: number, burst: BurstDef = TINY) => {
  sim.explode(x, y, z, burst, shot);
  sim.carriers!.afterStep(sim.tick);
};
/** A spot of open ground near (x, z) where a man can stand. */
const openNear = (sim: SandboxSim, x: number, z: number): { x: number; z: number } => {
  for (const [dx, dz] of [[-3, 0], [3, 0], [0, 3], [0, -3], [-3, 3], [3, -3], [-2, 2], [2, 2]]) {
    const c = navCell(x + dx, z + dz);
    if (c >= 0 && sim.nav.kind[c] === NavKind.Ground) return { x: x + dx, z: z + dz };
  }
  return { x, z };
};
const boysOf = (sim: SandboxSim, castle: number) => sim.carriers!.errands().filter((b) => b.team === castle);

test("what a shot costs, by weapon and by upgrade; a box holds what the data says", () => {
  assert.equal(powderCost("swivel"), 1);
  assert.equal(powderCost("chainShot"), 3);
  assert.equal(powderCost("longGun"), 4);
  assert.equal(powderCost("mortar"), 10);
  assert.equal(powderCost("longGun", "heavyShot"), 5, "heavy shot burns one more");
  assert.equal(powderCost("mortar", "heavyShell"), 12, "a heavy shell two more");
  const sim = world();
  const c = sim.carriers!;
  for (const e of sim.emplacements) {
    if (e.empty) {
      assert.equal(c.box(e.id), 0, "an empty slot has no box");
      assert.equal(c.canPay(e.id), false);
    } else {
      assert.equal(c.box(e.id), c.boxCap(e.id), `gun ${e.id} starts with its box full`);
      assert.equal(c.boxCap(e.id), POWDER.box[e.weapon]);
    }
  }
  sim.free();
});

test("a shot burns its cost from the box, a heavy shell and heavy shot more; an empty box refuses the fire (no shot, no reload, no event)", () => {
  const emps = MATCH_EMPLACEMENTS.map((e) => ({ ...e }));
  const lg = emps.find((e) => !e.empty && e.weapon === "longGun" && castleOfEmp(e) === 1)!;
  const mo = emps.find((e) => !e.empty && e.weapon === "mortar" && castleOfEmp(e) === 1)!;
  lg.upgrade = "heavyShot";
  mo.upgrade = "heavyShell";
  const sim = world({ emplacements: emps });
  const c = sim.carriers!;
  sim.queue(0, { ...fireOf(lg.id), pitch: 0.1 });
  sim.queue(0, { ...fireOf(mo.id), pitch: 0.9 });
  run(sim, 1);
  assert.equal(c.box(lg.id), 12 - 5, "heavy shot: 5");
  assert.equal(c.box(mo.id), 20 - 12, "heavy shell: 12");
  assert.ok(sim.reload[lg.id] > 0 && sim.reload[mo.id] > 0, "both loaded again after the shot");
  events(sim);
  // A box that cannot pay: the fire is refused whole.
  drain(sim, lg.id);
  assert.equal(c.canPay(lg.id), false);
  sim.reload[lg.id] = 0;
  sim.queue(sim.tick, fireOf(lg.id));
  run(sim, 1);
  assert.equal(sim.reload[lg.id], 0, "no reload begun");
  assert.equal(events(sim).filter((e) => e[0] === EventKind.Muzzle && e[1] === lg.id).length, 0, "no muzzle flash");
  assert.equal(sim.shotInfo.size, 2, "no third shot");
  // Mortar: 8 left is under its 12: refused too.
  sim.reload[mo.id] = 0;
  sim.queue(sim.tick, fireOf(mo.id));
  run(sim, 1);
  assert.equal(sim.reload[mo.id], 0);
  assert.equal(c.box(mo.id), 8, "nothing taken");
  sim.free();
});

test("without a powder store (the Practice range, a match with powder off) every fire is paid for", () => {
  const sim = new SandboxSim(R, layout, { seed: 7, minions: 0, emplacements: MATCH_EMPLACEMENTS.map((e) => ({ ...e })) });
  assert.equal(sim.carriers, null);
  const lg = gunOf(sim, 1, "longGun");
  for (let k = 0; k < 4; k++) {
    sim.reload[lg.id] = 0;
    sim.queue(sim.tick, fireOf(lg.id));
    run(sim, 1);
    assert.ok(sim.reload[lg.id] > 0, `shot ${k + 1} was fired`);
  }
  sim.free();
  const off = new SandboxSim(R, layout, { seed: 7, minions: 0, army: true, powder: false, emplacements: MATCH_EMPLACEMENTS.map((e) => ({ ...e })) });
  assert.equal(off.carriers, null);
  assert.equal(off.minions.list.filter((m) => m.unit === Unit.PowderBoy).length, 0, "no boys either");
  off.free();
});

test("three boys per castle stand at the store's door (the magazine's lean-to) to start; a boy's keg fills a box from the store", () => {
  const sim = world();
  const c = sim.carriers!;
  for (const castle of [0, 1]) {
    const boys = boysOf(sim, castle);
    assert.equal(boys.length, POWDER.boys);
    assert.equal(c.status(castle).magazine, 5, "the magazine on plot 5 works");
    const d = magazineDoor(castle, 5);
    for (const b of boys) {
      const m = sim.minions.list[b.minion];
      assert.equal(m.unit, Unit.PowderBoy);
      assert.equal(m.role, Role.Carrier);
      assert.ok(Math.hypot(m.x - d.x, m.z - d.z) < 2, "at the magazine's door");
    }
  }
  const lg = gunOf(sim, 1, "longGun");
  drain(sim, lg.id);
  const before = c.status(1).stock;
  let hoists = 0, boxed = 0, got = 0;
  run(sim, 40 * 60, () => {
    for (const e of events(sim)) {
      if (e[0] === EventKind.Hoist && e[1] === lg.id) hoists++;
      if (e[0] === EventKind.Boxed && e[1] === lg.id) (boxed++, (got += e[2]));
    }
  });
  assert.ok(hoists >= 1 && boxed >= 1, `a boy hoisted (${hoists}) and the keg reached the box (${boxed})`);
  assert.ok(c.box(lg.id) >= POWDER.keg, `box ${c.box(lg.id)}`);
  assert.ok(c.box(lg.id) <= c.boxCap(lg.id));
  // What the box gained came out of the store (nothing was made here: the rules do that).
  const taken = before - c.status(1).stock;
  assert.ok(taken >= got, `store gave ${taken}, boxes gained ${got}`);
  sim.free();
});

test("a boy takes a full keg; the box takes what it has room for and the rest goes on to the next gun or back to the store; a full box is not served", () => {
  const sim = world();
  const c = sim.carriers!;
  const sw = gunOf(sim, 1, "swivel");
  c.pay(sw.id); // 6 -> 5: 5 of 6 is not in need
  run(sim, 8 * 60);
  assert.equal(boysOf(sim, 1).every((b) => b.emplacement < 0), true, "a box at five of six is left alone");
  assert.equal(c.status(1).stock, POWDER.start, "no keg taken");
  while (c.canPay(sw.id)) c.pay(sw.id);
  let taken = -1, boy = -1, after = -1;
  run(sim, 40 * 60, () => {
    const b = boysOf(sim, 1).find((x) => x.emplacement === sw.id && x.keg > 0);
    if (b && taken < 0) {
      taken = b.keg;
      boy = b.minion;
    }
    const same = boysOf(sim, 1).find((x) => x.minion === boy);
    if (taken > 0 && after < 0 && same && same.emplacement !== sw.id) after = same.keg;
  });
  assert.equal(taken, POWDER.keg, "a full keg for the swivel's empty box");
  assert.equal(c.box(sw.id), c.boxCap(sw.id), "the box is full");
  assert.equal(after, POWDER.keg - c.boxCap(sw.id), "the six it had no room for stay in his keg as he leaves it");
  run(sim, 40 * 60);
  // Every box but the swivel's was full: the rest went back to the store.
  const total = c.status(1).stock + boysOf(sim, 1).reduce((n, b) => n + b.keg, 0);
  assert.equal(total, POWDER.start - c.boxCap(sw.id), "nothing lost but what the swivel took (no powder is made in a bare world)");
  sim.free();
});

test("the store never passes the cap: a magazine holds 120, the cellar 30 when there is no working magazine", () => {
  const sim = world();
  const c = sim.carriers!;
  assert.deepEqual(c.status(1), { stock: POWDER.start, cap: POWDER.magazineCap, magazine: 5, lost: 0 });
  const over = c.store(1, 200);
  assert.equal(over, 200 - (POWDER.magazineCap - POWDER.start), "what did not fit is returned");
  assert.equal(c.status(1).stock, POWDER.magazineCap);
  assert.equal(c.status(1).lost, over, "and counted as lost");
  assert.equal(c.room(1), 0);
  assert.equal(c.store(1, 5), 5, "a full store takes nothing");
  run(sim, 120);
  assert.equal(c.status(1).stock, POWDER.magazineCap, "it stays at the cap");
  sim.free();
  // No magazine: the cellar. A match starts with 40 in the store but the cellar holds 30: the extra is lost.
  const bare = world({ buildings: [] });
  const b = bare.carriers!;
  assert.equal(b.status(1).magazine, -1);
  assert.equal(b.status(1).cap, POWDER.cellarCap);
  run(bare, 2);
  assert.equal(b.status(1).stock, POWDER.cellarCap);
  assert.equal(b.status(1).lost, POWDER.start - POWDER.cellarCap);
  bare.free();
});

test("with no working magazine the cellar's boys take kegs from the keep's door and the guns still get powder", () => {
  const sim = world({ buildings: [] });
  const c = sim.carriers!;
  const lg = gunOf(sim, 1, "longGun");
  drain(sim, lg.id);
  const d = keepDoor(1);
  let near = Infinity;
  run(sim, 45 * 60, () => {
    for (const m of sim.minions.list) {
      if (m.unit !== Unit.PowderBoy || m.team !== 1 || m.task !== BoyTask.Take) continue;
      near = Math.min(near, Math.hypot(m.x - d.x, m.z - d.z));
    }
  });
  assert.ok(near < 2, `a boy took a keg ${near.toFixed(1)} m from the keep's door`);
  assert.ok(c.box(lg.id) >= 8, `box ${c.box(lg.id)}`);
  assert.ok(c.status(1).stock < POWDER.cellarCap);
  sim.free();
});

test("the gun the team rides is served first, then guns that cannot fire, then the emptiest under half", () => {
  const sim = world();
  const c = sim.carriers!;
  const lg = gunOf(sim, 1, "longGun"), mo = gunOf(sim, 1, "mortar"), ch = gunOf(sim, 1, "chainShot");
  // Two of the three boys are down (a blow: no keg to burst), so the one left shows which gun he chooses.
  for (const b of boysOf(sim, 1).slice(0, 2)) {
    const m = sim.minions.list[b.minion];
    sim.minions.knock({ minion: m.id, vx: 1, vy: 1, vz: 0, px: m.x, py: m.y + 1, pz: m.z, extra: 1, cause: Cause.Blow }, sim.tick);
  }
  run(sim, 1);
  // The mortar is empty, the long gun at 3 of 12 (cannot fire: under 4), the ridden chain gun has room for a shot (9 - 6 = 3 left).
  drain(sim, mo.id);
  while (c.box(lg.id) > 3) c.pay(lg.id);
  for (let k = 0; k < 2; k++) c.pay(ch.id);
  c.policy = { riding: () => ch.id };
  let first = -1;
  run(sim, 30, () => {
    const b = boysOf(sim, 1).find((x) => x.minion >= 0);
    if (first < 0 && b && b.emplacement >= 0) first = b.emplacement;
  });
  assert.equal(first, ch.id, "the ridden gun first");
  // Not riding: a gun that cannot fire (the mortar with a heavy shell, 8 of 20 left, needs 12) comes before a long gun at 4 of 12 that still can.
  const emps = MATCH_EMPLACEMENTS.map((e) => ({ ...e }));
  const mo2 = emps.find((e) => !e.empty && e.weapon === "mortar" && castleOfEmp(e) === 1)!;
  mo2.upgrade = "heavyShell";
  const s2 = world({ emplacements: emps });
  const c2 = s2.carriers!;
  for (const b of boysOf(s2, 1).slice(0, 2)) {
    const m = s2.minions.list[b.minion];
    s2.minions.knock({ minion: m.id, vx: 1, vy: 1, vz: 0, px: m.x, py: m.y + 1, pz: m.z, extra: 1, cause: Cause.Blow }, s2.tick);
  }
  run(s2, 1);
  c2.pay(mo2.id);
  c2.pay(gunOf(s2, 1, "longGun").id);
  c2.pay(gunOf(s2, 1, "longGun").id);
  assert.equal(c2.box(mo2.id), 8);
  assert.equal(c2.box(gunOf(s2, 1, "longGun").id), 4);
  let pick = -1;
  run(s2, 30, () => {
    const b = boysOf(s2, 1).find((x) => x.minion >= 0);
    if (pick < 0 && b && b.emplacement >= 0) pick = b.emplacement;
  });
  assert.equal(pick, mo2.id, "a gun that cannot fire comes before one that only has less");
  s2.free();
  sim.free();
});

test("a boy knocked down by a ball while he carries a keg sets it off where he lies; on his way back he sets nothing off; a blow drops the keg unlit", () => {
  const sim = world();
  const c = sim.carriers!;
  const lg = gunOf(sim, 1, "longGun");
  drain(sim, lg.id);
  const carrying = (): { id: number; keg: number } | null => {
    const b = boysOf(sim, 1).find((x) => x.keg > 0 && x.task === BoyTask.Carry);
    return b ? { id: b.minion, keg: b.keg } : null;
  };
  let guard = 0;
  while (!carrying() && guard++ < 40 * 60) sim.step();
  let b = carrying()!;
  assert.ok(b, "a boy came out with a keg");
  const m = sim.minions.list[b.id];
  events(sim);
  sim.minions.knock({ minion: m.id, vx: 3, vy: 1, vz: 0, px: m.x, py: m.y + 1.2, pz: m.z, extra: 1, cause: Cause.Ball, shot: 77 }, sim.tick);
  run(sim, 1);
  const burst = sim.bursts.find((x) => x.shot === 77);
  assert.ok(burst, "his keg burst, credited to the shot that downed him");
  assert.equal(burst!.radius, KEG.burst.radius);
  assert.ok(Math.hypot(burst!.x - m.x, burst!.z - m.z) < 1.5, "where he lies");
  assert.ok(events(sim).some((e) => e[0] === EventKind.KegBurst && e[1] === m.id), "a KegBurst event");
  assert.ok(!boysOf(sim, 1).some((x) => x.minion === m.id), "he is no longer one of the boys");
  assert.ok(boysOf(sim, 1).some((x) => x.minion < 0), "and a replacement is due");
  // POWDER.respawn ticks later a new boy stands at the store's door.
  run(sim, POWDER.respawn + 2);
  assert.equal(boysOf(sim, 1).filter((x) => x.minion < 0).length, 0, "replaced");
  sim.free();

  // On his way back (no keg): knocked down, nothing goes off.
  const s2 = world();
  const lg2 = gunOf(s2, 1, "longGun");
  drain(s2, lg2.id);
  let back = null as number | null;
  guard = 0;
  while (back === null && guard++ < 60 * 60) {
    s2.step();
    const x = boysOf(s2, 1).find((y) => y.task === BoyTask.Back && y.keg === 0 && s2.carriers!.box(lg2.id) > 0);
    if (x) back = x.minion;
  }
  assert.ok(back !== null, "a boy walks back empty handed");
  const mb = s2.minions.list[back!];
  s2.minions.knock({ minion: mb.id, vx: 3, vy: 1, vz: 0, px: mb.x, py: mb.y + 1.2, pz: mb.z, extra: 1, cause: Cause.Ball, shot: 78 }, s2.tick);
  run(s2, 1);
  assert.equal(s2.bursts.filter((x) => x.shot === 78).length, 0, "no keg, no burst");
  s2.free();

  // A blow (a fight) drops the keg unlit.
  const s3 = world();
  drain(s3, gunOf(s3, 1, "longGun").id);
  let id3 = -1;
  guard = 0;
  while (id3 < 0 && guard++ < 40 * 60) {
    s3.step();
    const x = boysOf(s3, 1).find((y) => y.keg > 0 && y.task === BoyTask.Carry);
    if (x) id3 = x.minion;
  }
  assert.ok(id3 >= 0);
  const m3 = s3.minions.list[id3];
  s3.minions.knock({ minion: m3.id, vx: 3, vy: 1, vz: 0, px: m3.x, py: m3.y + 1.2, pz: m3.z, extra: 1, cause: Cause.Blow }, s3.tick);
  run(s3, 1);
  assert.equal(s3.bursts.length, 0, "no burst");
  assert.ok(boysOf(s3, 1).some((x) => x.minion < 0), "but he is down");
  s3.free();
});

test("a burst that knocks down a boy with a keg sets his keg off in the same tick, and kegs set off kegs", () => {
  const sim = world();
  // Put two boys with kegs side by side: drain the guns they serve, wait for kegs.
  for (const e of sim.emplacements) if (!e.empty && castleOfEmp(e) === 1) drain(sim, e.id);
  let guard = 0;
  const carrying = () => boysOf(sim, 1).filter((b) => b.keg > 0 && b.task === BoyTask.Carry);
  while (carrying().length < 2 && guard++ < 60 * 60) sim.step();
  const two = carrying();
  assert.ok(two.length >= 2, "two boys carry kegs");
  const [a, b] = two.map((x) => sim.minions.list[x.minion]);
  // Bring the second boy next to the first, then burst on the first with a shell's own burst.
  events(sim);
  sim.explode(a.x, a.y + 0.5, a.z, undefined, 55);
  run(sim, 1);
  const kegs = sim.bursts.filter((x) => x.radius === KEG.burst.radius);
  assert.ok(sim.bursts.length >= 2, `the shell and then a keg or more: ${sim.bursts.length} bursts`);
  assert.ok(kegs.length >= 1, "a keg went off");
  assert.ok(kegs.every((k) => k.shot === 55), "credited to the shell that set it going");
  void b;
  sim.free();
});

test("a burst whose knock throws a boy down but whose radius does not reach his keg leaves it unlit (lost); a burst's own radius lights it", () => {
  const sim = world();
  for (const e of sim.emplacements) if (!e.empty && castleOfEmp(e) === 1) drain(sim, e.id);
  let guard = 0;
  const carrying = () => boysOf(sim, 1).filter((b) => b.keg > 0 && b.task === BoyTask.Carry);
  while (carrying().length < 1 && guard++ < 60 * 60) sim.step();
  const first = carrying()[0];
  assert.ok(first, "a boy carries a keg");
  const m = sim.minions.list[first.minion];
  const stock = sim.carriers!.status(1).stock;
  // A burst with a short radius and a long knock, 5 m off: it throws him down; its fire does not reach the keg.
  const far: BurstDef = { ...KEG.burst, radius: 1, knock: 12, knockSpeed: 14 };
  let lit = 0;
  sim.explode(m.x + 5, m.y + 1, m.z, far, 77);
  run(sim, 2, () => {
    for (const e of events(sim)) if (e[0] === EventKind.KegBurst) lit++;
  });
  assert.notEqual(sim.minions.list[first.minion].state, MinionState.Upright, "he was thrown down");
  assert.equal(lit, 0, "his keg did not go off");
  assert.equal(sim.carriers!.status(1).stock, stock, "and its powder is lost, not returned");
  sim.free();
});

test("the magazine's burst grows with its stock; an empty one makes none", () => {
  assert.equal(magazineBurst(0), null);
  for (const stock of [10, 40, 120]) {
    const b = magazineBurst(stock)!;
    assert.equal(b.radius, POWDER.blowBase + stock / POWDER.blowPer);
  }
  assert.equal(magazineBurst(120)!.radius, 9);
  assert.ok(magazineBurst(120)!.radius > magazineBurst(40)!.radius);
  const sim = world();
  const c = sim.carriers!;
  c.store(1, 200); // full: 120
  const at = plotCentre(1, 5);
  events(sim);
  burstNow(sim, at.x, 1.0, at.z, 31); // a shell bursts inside it
  const blew = events(sim).filter((e) => e[0] === EventKind.MagazineBlew);
  assert.equal(blew.length, 1, "it blew");
  assert.deepEqual(blew[0].slice(1), [1, 5, 120, 31], "castle 1, plot 5, 120 charges, the shell's id");
  assert.equal(c.status(1).stock, 0, "and the stock is gone");
  const big = sim.bursts.filter((x) => x.radius === 9);
  assert.equal(big.length, 1, "one burst of 3 + 120/20 = 9 m");
  assert.equal(big[0].shot, 31, "credited to the shell");
  run(sim, 1);
  // A second shell into the same (now empty, wrecked) magazine makes none of the big burst.
  run(sim, 30);
  events(sim);
  burstNow(sim, at.x, 1.0, at.z, 32);
  assert.equal(sim.bursts.filter((x) => x.radius > 3.5).length, 0, "an empty magazine makes no burst");
  assert.equal(events(sim).filter((e) => e[0] === EventKind.MagazineBlew).length, 0);
  // The cellar fills a little (the rules pay it in); a shell in the ruin must not blow it: only a standing magazine holds the stock.
  assert.equal(sim.structures!.slot(1, 5).state, PlotState.Ruined);
  c.store(1, 10);
  events(sim);
  burstNow(sim, at.x, 1.0, at.z, 33);
  assert.equal(events(sim).filter((e) => e[0] === EventKind.MagazineBlew).length, 0, "a ruin does not blow");
  assert.equal(c.status(1).stock, 10, "the stock stays");
  sim.free();
});

test("a burst outside the magazine does not blow it; one above it does not either; one inside a magazine that is not working does not", () => {
  const sim = world();
  const at = plotCentre(1, 5);
  events(sim);
  burstNow(sim, at.x, 0.5, at.z + 9, 40); // a shell in the courtyard
  burstNow(sim, at.x, POWDER.insideY + 1, at.z, 41); // a burst well over the roof
  burstNow(sim, at.x + 3.4 / 2 + POWDER.inside + 0.3, 1, at.z, 42); // just outside the footprint grown by half a metre
  assert.equal(events(sim).filter((e) => e[0] === EventKind.MagazineBlew).length, 0);
  assert.equal(sim.carriers!.status(1).stock, POWDER.start);
  burstNow(sim, at.x + 3.4 / 2 + POWDER.inside - 0.1, 1, at.z, 43); // just inside it
  assert.equal(events(sim).filter((e) => e[0] === EventKind.MagazineBlew).length, 1);
  sim.free();
});

test("a magazine wrecked with powder in it goes up; a rising one holds nothing", () => {
  const sim = world();
  const c = sim.carriers!;
  const st = sim.structures!;
  const at = plotCentre(1, 5);
  // Wreck it with a blast that is not a burst of the world's (the masonry only): it falls to a ruin and blows.
  sim.castle.burst(at.x, 0.8, at.z, 5, 1, 12, 0.2);
  events(sim);
  let blew = 0;
  run(sim, 40, () => {
    blew += events(sim).filter((e) => e[0] === EventKind.MagazineBlew).length;
  });
  assert.equal(st.slot(1, 5).state, PlotState.Ruined);
  assert.equal(blew, 1, "it blew once");
  assert.equal(c.status(1).stock, 0);
  assert.equal(c.status(1).magazine, -1, "no working magazine now: the cellar");
  sim.free();
});

test("a Powder Mill that was working bursts once like a keg when it is wrecked", () => {
  const sim = world({ buildings: [...START, { castle: 1, plot: 4, kind: "mill" }] });
  const at = plotCentre(1, 4);
  sim.castle.burst(at.x, 0.8, at.z, 5, 1, 12, 0.2);
  let mills = 0;
  const kegs: number[] = [];
  run(sim, 120, () => {
    for (const e of events(sim)) if (e[0] === EventKind.MillBlew) mills++;
    for (const x of sim.bursts) if (x.radius === KEG.burst.radius) kegs.push(x.radius);
  });
  assert.equal(sim.structures!.slot(1, 4).state, PlotState.Ruined);
  assert.equal(mills, 1, "once");
  assert.equal(kegs.length, 1, "one keg's burst at its middle");
  // A ruin wrecked again does not burst again.
  run(sim, 120, () => {
    for (const e of events(sim)) if (e[0] === EventKind.MillBlew) mills++;
  });
  assert.equal(mills, 1);
  sim.free();
});

test("boys are not counted among the men standing, nor in the storm counts, and enemy pikemen do not chase them", () => {
  const sim = world();
  const army = sim.army!;
  assert.equal(boysOf(sim, 1).length, POWDER.boys);
  assert.equal(army.standing(1), 0, "boys stand outside the cap on men");
  assert.equal(army.standing(0), 0);
  run(sim, 2);
  assert.equal(army.defenders[1], 0, "not defenders");
  assert.equal(army.attackers[1], 0);
  // A pikeman of the other side inside the courtyard, close by the boys: he walks on, the boys keep away.
  const d = keepDoor(1);
  const wave = army.newWave(0, 1, true);
  const p = army.spawnAt(0, wave, Unit.Pikeman, d.x, d.z + 5, 0);
  let chased = 0;
  run(sim, 6 * 60, () => {
    if (p.target >= 0 && sim.minions.list[p.target]?.role === Role.Carrier) chased++;
  });
  assert.equal(chased, 0, "he never took a boy for his mark");
  for (const b of boysOf(sim, 1)) assert.equal(sim.minions.list[b.minion].state, MinionState.Upright, "no boy was struck down");
  assert.equal(army.attackers[1], 1, "the pikeman counts as an attacker, the boys do not defend");
  sim.free();
});

test("boys run from enemy men, with their kegs, and go back once it is calm", () => {
  const sim = world();
  const lg = gunOf(sim, 1, "longGun");
  drain(sim, lg.id);
  let guard = 0;
  while (!boysOf(sim, 1).some((b) => b.keg > 0) && guard++ < 40 * 60) sim.step();
  const army = sim.army!;
  const boy = boysOf(sim, 1).find((b) => b.keg > 0)!;
  const m = sim.minions.list[boy.minion];
  const wave = army.newWave(0, 1, true);
  const at = openNear(sim, m.x, m.z);
  army.spawnAt(0, wave, Unit.Pikeman, at.x, at.z, 0);
  let fled = false;
  run(sim, 120, () => {
    if (boysOf(sim, 1).some((b) => b.minion === boy.minion && b.task === BoyTask.Flee)) fled = true;
  });
  assert.ok(fled, "he fled");
  assert.ok(boysOf(sim, 1).find((b) => b.minion === boy.minion)!.keg > 0, "with his keg");
  sim.free();
});

test("the same setup replays to the same hash, and a shot paid for changes it", () => {
  const a = world(), b = world(), c2 = world();
  const lg = gunOf(a, 1, "longGun").id;
  run(a, 300);
  run(b, 300);
  run(c2, 300);
  assert.deepEqual(a.hash(), b.hash());
  c2.carriers!.pay(lg);
  assert.notDeepEqual(c2.hash().state, a.hash().state, "a box counts in the hash");
  a.carriers!.store(1, 5);
  assert.notDeepEqual(a.hash().state, b.hash().state, "so does the store");
  a.free();
  b.free();
  c2.free();
});

test("buildings: the magazine's pieces are 24 to 36 on every plot, inside it, and it costs what the brief says", () => {
  assert.equal(BUILDINGS.magazine.cost, 140);
  assert.equal(BUILDINGS.magazine.buildTicks, 12 * 60);
  assert.equal(BUILDINGS.mill.income, 0);
  for (const r of layout.plots.filter((p) => p.castle === 0 && p.kind === 3)) {
    assert.ok(r.count >= 24 && r.count <= 36, `plot ${r.plot}: ${r.count} pieces`);
  }
  assert.equal(shotCost({ ...MATCH_EMPLACEMENTS[0], empty: true }), 0);
});

test("a boy with no way at all to the store (left on a wall top) finds his way round to its door", () => {
  const sim = world();
  const c = sim.carriers!;
  const b = boysOf(sim, 1)[0];
  const m = sim.minions.list[b.minion];
  // The top of castle 1's back wall: walkable, but with no way down.
  const S = CASTLE_SHAPE;
  const x = -5, z = mirrorZ(1, S.half);
  const cell = navCell(x, z);
  assert.ok(cell >= 0 && sim.nav.kind[cell] === NavKind.Raised, "the wall top is walkable");
  m.x = x;
  m.z = z;
  m.y = sim.army!.surface(x, z, cell);
  sim.minions.place(m);
  const top = m.y;
  assert.ok(top > 3, "up on the wall");
  // Give the boys an errand.
  drain(sim, gunOf(sim, 1, "longGun").id);
  drain(sim, gunOf(sim, 1, "mortar").id);
  const d = magazineDoor(1, c.status(1).magazine);
  let came = false;
  run(sim, POWDER.stuck + 4 * 60, () => {
    if (m.state === MinionState.Upright && Math.hypot(m.x - d.x, m.z - d.z) < 1.5 && m.y < 1) came = true;
  });
  assert.equal(m.state, MinionState.Upright, "still on his feet");
  assert.ok(came, "he came round to the magazine's door");
  assert.ok(m.y < top - 2, "off the wall");
  sim.free();
});
