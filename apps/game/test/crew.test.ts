// Look round L1: the crew at every gun (logic without three): the action by stage for each weapon, nobody in the sight's line, places
// within the floor's reach, no jumps, and a gun swept away has no crew.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { WeaponKind } from "@keepfall/content";
import {
  BALL,
  CARTRIDGE,
  CREW_SIZE,
  GUNNER,
  HELPER,
  HIDE_NEAR,
  LINSTOCK_TOOL,
  LOADER,
  MORTAR_SPLITS,
  NO_CARRY,
  PLACES,
  POLE,
  REACH,
  SHELL,
  SPLITS,
  SPONGE,
  STAFF,
  crewSizeFor,
  headOf,
  inSightLine,
  liftOf,
  muzzleOf,
  newCrewGun,
  newFigures,
  poseCrew,
  type CrewGun,
  type Figure,
} from "../src/render/crewLogic";
import { RECOIL_BACK, RUN_OUT_FROM, RUN_OUT_TO, kick } from "../src/render/recoilLogic";

const KINDS: WeaponKind[] = ["longGun", "chainShot", "mortar", "swivel"];
const BARREL: Record<WeaponKind, number> = { longGun: 1.8, chainShot: 1.6, mortar: 0.9, swivel: 1.1 };
const DROP: Record<WeaponKind, number> = { longGun: 1.7, chainShot: 1.5, mortar: 0.9, swivel: 1.2 };
const RELOAD_S: Record<WeaponKind, number> = { longGun: 4, chainShot: 5, mortar: 12, swivel: 2 };
const PITCH: Record<WeaponKind, number> = { longGun: 0.05, chainShot: 0.05, mortar: 0.9, swivel: 0.05 };

/** A gun of `kind` at reload stage `s`, with its carriage where the kick puts it and its shot as old as the stage says (a 4 s reload). */
function gunAt(kind: WeaponKind, s: number, over: Partial<CrewGun> = {}): CrewGun {
  const g = newCrewGun();
  g.kind = kind;
  g.stage = s;
  g.age = s * RELOAD_S[kind];
  g.barrel = BARREL[kind];
  g.drop = DROP[kind];
  g.lift = liftOf(kind, g.drop);
  g.pitch = PITCH[kind];
  const k = kick(kind, g.age, s);
  g.slide = kind === "mortar" ? k.down : k.back;
  return Object.assign(g, over);
}

function pose(kind: WeaponKind, s: number, over: Partial<CrewGun> = {}): { g: CrewGun; f: Figure[]; n: number } {
  const g = gunAt(kind, s, over);
  const f = newFigures(4);
  const n = poseCrew(g, f);
  return { g, f, n };
}

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("a long gun has four men, a chain shot four, a mortar three and a swivel one", () => {
  assert.deepEqual(KINDS.map((k) => CREW_SIZE[k]), [4, 4, 3, 1]);
  for (const k of KINDS) assert.equal(pose(k, 0.5).n, CREW_SIZE[k]);
});

test("the splits are the ones of the brief", () => {
  assert.deepEqual([SPLITS.clear, SPLITS.swab, SPLITS.load, SPLITS.ram, SPLITS.runOut, SPLITS.ready], [[0, 0.08], [0.08, 0.3], [0.3, 0.5], [0.5, 0.72], [0.72, 0.92], [0.92, 1]]);
  assert.ok(Math.abs(SPLITS.runOut[0] - RUN_OUT_FROM) < 0.04 && SPLITS.runOut[1] === RUN_OUT_TO, "the run out of the crew is the gun's");
});

test("long gun and chain shot: swab, load, ram, run out, ready", () => {
  for (const kind of ["longGun", "chainShot"] as WeaponKind[]) {
    // Swab: the spongeman's staff is at the muzzle (its head within a metre of it), worked with both hands.
    for (const s of [0.18, 0.24, 0.28]) {
      const { g, f } = pose(kind, s);
      const m = muzzleOf(g, [0, 0, 0]);
      const sp = f[SPONGE];
      assert.equal(sp.tool, STAFF, `${kind} ${s}: the spongeman has the staff`);
      assert.ok(dist(sp.ta, m) < 0.6, `${kind} ${s}: its head is at the muzzle (${dist(sp.ta, m).toFixed(2)} m)`);
      assert.equal(sp.hw, 1);
      assert.equal(f[GUNNER].tool, LINSTOCK_TOOL, "the gunner stands by with the match");
    }
    // The staff goes in and out: two or three strokes over the swab.
    const ins: number[] = [];
    for (let i = 0; i < 160; i++) {
      const { g, f } = pose(kind, 0.14 + (0.16 * i) / 160);
      void g;
      ins.push(dist(f[SPONGE].ta, f[SPONGE].hr));
    }
    // (upward crossings of the middle of the stroke)
    const mid = (Math.min(...ins) + Math.max(...ins)) / 2;
    let strokes = 0;
    for (let i = 1; i < ins.length; i++) if (ins[i - 1] < mid && ins[i] >= mid) strokes++;
    assert.ok(strokes >= 2 && strokes <= 3, `${kind}: ${strokes} strokes at the swab`);
    // Load: the loader has the cartridge, the helper the ball, one after the other, each put at the muzzle.
    assert.equal(pose(kind, 0.34).f[LOADER].carry, CARTRIDGE, "the loader fetches a cartridge from the box");
    const l = pose(kind, 0.43);
    assert.equal(l.f[LOADER].carry, CARTRIDGE, "the loader puts it in");
    assert.ok(dist(l.f[LOADER].cp, muzzleOf(l.g, [0, 0, 0])) < 1.2, "at the muzzle");
    assert.equal(pose(kind, 0.3).f[HELPER].carry, BALL, "the helper has the ball ready");
    const b = pose(kind, 0.48);
    assert.equal(b.f[HELPER].carry, BALL, "and puts it in after the cartridge");
    assert.equal(pose(kind, 0.495).f[LOADER].carry, NO_CARRY);
    // Ram: the staff again, two hard strokes.
    const rins: number[] = [];
    for (let i = 0; i < 170; i++) {
      const { g, f } = pose(kind, 0.55 + (0.17 * i) / 170);
      assert.equal(f[SPONGE].tool, STAFF);
      void g;
      rins.push(dist(f[SPONGE].ta, f[SPONGE].hr));
    }
    const rmid = (Math.min(...rins) + Math.max(...rins)) / 2;
    let hard = 0;
    for (let i = 1; i < rins.length; i++) if (rins[i - 1] < rmid && rins[i] >= rmid) hard++;
    assert.equal(hard, 2, `${kind}: two ram strokes`);
    // Run out: three men lean on the carriage with both hands as the slide goes back to 0.
    const lean = (s: number) => pose(kind, s).f.filter((m) => m.hw === 1 && m.tool !== LINSTOCK_TOOL && m.carry === NO_CARRY && m.stride > 0).length;
    assert.ok(lean(0.82) >= 3, `${kind}: ${lean(0.82)} men push`);
    const early = pose(kind, 0.75), late = pose(kind, 0.91);
    assert.ok(early.g.slide > late.g.slide && late.g.slide < 0.05, "the gun goes forward as they push");
    // Their hands follow the carriage forward.
    assert.ok(late.f[SPONGE].hr[2] > early.f[SPONGE].hr[2] || late.f[SPONGE].hl[2] > early.f[SPONGE].hl[2], "the hands move forward with the gun");
    // Ready: the gunner by the breech with the linstock's tip near the vent, the others clear (no tool, no cargo, hands down).
    const r = pose(kind, 1);
    assert.equal(r.f[GUNNER].tool, LINSTOCK_TOOL);
    assert.equal(r.f[GUNNER].glow, 1);
    assert.ok(Math.abs(r.f[GUNNER].pz - PLACES[kind].gunnerReady[1]) < 0.01, "the gunner is by the breech");
    for (const m of [SPONGE, LOADER, HELPER]) assert.equal(r.f[m].carry, NO_CARRY);
    for (const m of [LOADER, HELPER]) assert.equal(r.f[m].hw, 0, "the others stand clear");
    assert.ok(r.f[SPONGE].tb[1] - r.f[SPONGE].ta[1] < -POLE + 0.1, "the staff stands upright");
  }
});

test("the gunner leans away as it fires", () => {
  const rest = pose("longGun", 1).f[GUNNER];
  const fired = pose("longGun", 0.0, { age: 0.08 }).f[GUNNER];
  assert.ok(fired.lean < rest.lean - 0.2, "leaning back");
  assert.ok(fired.crouch > 0);
  const later = pose("longGun", 0.06, { age: 3 }).f[GUNNER];
  assert.ok(Math.abs(later.crouch) < 1e-9, "upright again a while later");
});

test("mortar: swab, the powder, the shell carried by two men, stand clear", () => {
  const sw = pose("mortar", 0.2);
  assert.equal(sw.f[SPONGE].tool, STAFF);
  assert.ok(dist(sw.f[SPONGE].ta, muzzleOf(sw.g, [0, 0, 0])) < 0.6);
  assert.equal(pose("mortar", 0.34).f[LOADER].carry, CARTRIDGE, "the powder");
  const sh = pose("mortar", 0.62);
  assert.equal(sh.f[SPONGE].carry, SHELL, "the shell");
  // Two men: both have their hands at the shell, either side of it.
  const c = sh.f[SPONGE].cp;
  assert.ok(dist(sh.f[SPONGE].hl, c) < 0.4 && dist(sh.f[LOADER].hr, c) < 0.4, "carried between them");
  assert.equal(sh.f[LOADER].tool, 0);
  // At the end it is in the muzzle and gone.
  assert.equal(pose("mortar", 0.79).f[SPONGE].carry, NO_CARRY);
  assert.ok(MORTAR_SPLITS.ready[0] === 0.8);
  const r = pose("mortar", 1);
  assert.equal(r.f[GUNNER].tool, LINSTOCK_TOOL);
  assert.equal(r.f[LOADER].hw, 0);
  assert.equal(r.f[LOADER].carry, NO_CARRY);
});

test("swivel: one man, at the breech and then the tiller", () => {
  const b = pose("swivel", 0.3);
  assert.equal(b.n, 1);
  assert.equal(b.f[GUNNER].hw, 1);
  const t = pose("swivel", 1);
  assert.equal(t.f[GUNNER].tool, LINSTOCK_TOOL);
  // His hand is on the tiller, behind the pivot.
  assert.ok(t.f[GUNNER].hr[2] < -0.5);
  assert.ok(Math.abs(b.f[GUNNER].px - t.f[GUNNER].px) < 0.5, "a step or two between");
});

test("nobody stands in the sight's line, at any stage, for any gun the player rides", () => {
  for (const kind of KINDS) {
    for (const turn of [0, 0.35, -0.35, 0.7, -0.7]) {
      for (let i = 0; i <= 200; i++) {
        const s = i / 200;
        const { g, f, n } = pose(kind, s, { ridden: true, turn, propTurn: -turn * 0.4 });
        for (let m = 0; m < n; m++) {
          const h = headOf(f[m], [0, 0, 0]);
          // The man himself: head, chest, pelvis.
          const pts: number[][] = [h, [f[m].px, f[m].py + 1.2, f[m].pz], [f[m].px, f[m].py + 0.9, f[m].pz]];
          for (const p of pts) assert.ok(!inSightLine(p[0], p[1], p[2], g.drop, turn), `${kind} stage ${s} turn ${turn}: man ${m} at (${p.map((v) => v.toFixed(2))}) is in the sight's line`);
          // His hands at work are held to the middle of the cone (what a man puts into the muzzle is at the muzzle, where the aim line starts).
          const mz = muzzleOf(g, [0, 0, 0]);
          if (f[m].hw > 0 && kind !== "mortar") for (const p of [f[m].hl, f[m].hr]) if (dist(p, mz) > 0.75) assert.ok(!inSightLine(p[0], p[1], p[2], g.drop, turn, 0.6), `${kind} stage ${s} turn ${turn}: a hand of man ${m} is in the sight's line`);
        }
      }
    }
  }
});

test("the staff and the linstock reach the sight's line only at the muzzle and the vent", () => {
  for (const kind of ["longGun", "chainShot"] as WeaponKind[]) {
    for (let i = 0; i <= 100; i++) {
      const { g, f } = pose(kind, i / 100, { ridden: true });
      const m = muzzleOf(g, [0, 0, 0]);
      for (const man of f) {
        if (man.tool !== STAFF) continue;
        // Points along the pole a metre or more from the muzzle are out of the line.
        for (let t = 0; t <= 1; t += 0.05) {
          const p = [0, 1, 2].map((k) => man.ta[k] + (man.tb[k] - man.ta[k]) * t);
          if (dist(p, m) < 1.0) continue;
          assert.ok(!inSightLine(p[0], p[1], p[2], g.drop, 0), `${kind} ${i / 100}: the staff crosses the sight`);
        }
      }
    }
  }
});

test("every man stands within the floor's reach and on a level of it, and none jumps between nearby stages", () => {
  for (const kind of KINDS) {
    let prev: Figure[] | null = null;
    for (let i = 0; i <= 1000; i++) {
      const s = i / 1000;
      const { g, f, n } = pose(kind, s);
      for (let m = 0; m < n; m++) {
        assert.ok(Math.abs(f[m].px) <= REACH.x, `${kind} ${s}: man ${m} x ${f[m].px.toFixed(2)}`);
        assert.ok(f[m].pz >= -REACH.zBack && f[m].pz <= REACH.zFront, `${kind} ${s}: man ${m} z ${f[m].pz.toFixed(2)}`);
        assert.ok(f[m].py >= 0 && f[m].py <= g.lift + 1e-9);
        for (const v of [f[m].face, f[m].lean, f[m].crouch, f[m].hw, ...f[m].hl, ...f[m].hr]) assert.ok(Number.isFinite(v));
        if (prev) {
          // A thousand steps of the reload: no man runs faster than 9 m/s.
          const step = Math.hypot(f[m].px - prev[m].px, f[m].pz - prev[m].pz);
          assert.ok(step < 9 * RELOAD_S[kind] * 0.001, `${kind} ${s}: man ${m} jumps ${step.toFixed(3)} m`);
          assert.ok(Math.abs(f[m].py - prev[m].py) < 0.05);
        }
      }
      prev = f.map((x) => JSON.parse(JSON.stringify(x)) as Figure);
    }
  }
});

test("a man on the platform stands on its top; the others on the floor", () => {
  const { g, f } = pose("longGun", 0.2);
  assert.ok(g.lift > 0.5);
  assert.ok(Math.abs(f[SPONGE].py - g.lift) < 1e-6, "at the front, on the platform");
  assert.equal(f[HELPER].py, 0);
  // A gun that stands on the floor has no platform.
  assert.equal(liftOf("mortar", 0.9), 0);
  assert.equal(liftOf("longGun", 0.5), 0);
});

test("a pose is a function of the gun alone: the same gun, the same men, and a jump in stage lands on the right pose", () => {
  const a = pose("longGun", 0.6), b = pose("longGun", 0.6);
  assert.deepEqual(a.f, b.f);
  // Going 0.1, 0.9, 0.6 gives what 0.6 gave straight away (nothing is remembered).
  const f = newFigures(4);
  poseCrew(gunAt("longGun", 0.1), f);
  poseCrew(gunAt("longGun", 0.9), f);
  poseCrew(gunAt("longGun", 0.6), f);
  assert.deepEqual(f, a.f);
});

test("a gun knocked out has no crew; when it is back, its crew is back", () => {
  assert.equal(crewSizeFor("longGun", false, true), 4);
  assert.equal(crewSizeFor("longGun", true, true), 0, "swept away");
  assert.equal(crewSizeFor("longGun", false, true), 4, "back");
  assert.equal(crewSizeFor("", false, true), 0, "an empty slot");
  assert.equal(crewSizeFor("mortar", false, false), 0, "not shown");
  assert.equal(crewSizeFor("swivel", false, true), 1);
});

test("a man's head near the camera is hidden: the limit is 0.8 m", () => {
  assert.equal(HIDE_NEAR, 0.8);
  void RECOIL_BACK;
});
