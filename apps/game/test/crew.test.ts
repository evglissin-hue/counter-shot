// Look round L1, reworked for 3.6: the crew at every gun (logic without three). The household gives a gun two men, one or
// none; the choreography follows the reload's stage with what men there are: every man on the floor or the platform, none
// in another's place, nobody in the sight's line, no jumps, and the minion renderer leaves the men at a gun to the crews.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { WeaponKind } from "@keepfall/content";
import {
  ACTION_AT_GUN,
  ACTION_AT_POST,
  ACTION_HOIST,
  BALL,
  CARTRIDGE,
  CREW_MEN,
  HIDE_NEAR,
  LAYER,
  LINSTOCK_TOOL,
  LOADER,
  NO_CARRY,
  POLE,
  REACH,
  SHELL,
  STAFF,
  UNIT_CREW,
  crewSizeFor,
  drawnByCrews,
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
import { kick } from "../src/render/recoilLogic";

const KINDS: WeaponKind[] = ["longGun", "chainShot", "mortar", "swivel"];
const BARREL: Record<WeaponKind, number> = { longGun: 1.8, chainShot: 1.6, mortar: 0.9, swivel: 1.1 };
const DROP: Record<WeaponKind, number> = { longGun: 1.7, chainShot: 1.5, mortar: 0.9, swivel: 1.2 };
const RELOAD_S: Record<WeaponKind, number> = { longGun: 4, chainShot: 5, mortar: 12, swivel: 2 };
const PITCH: Record<WeaponKind, number> = { longGun: 0.05, chainShot: 0.05, mortar: 0.9, swivel: 0.05 };

/** A gun of `kind` at reload stage `s` with `men` at it: its carriage where the kick puts it and its shot as old as the stage says (the reload is half again as long with one man). */
function gunAt(kind: WeaponKind, s: number, men: number, over: Partial<CrewGun> = {}): CrewGun {
  const g = newCrewGun();
  g.kind = kind;
  g.stage = s;
  g.men = men;
  g.age = s * RELOAD_S[kind] * (men === 1 ? 1.5 : 1);
  g.barrel = BARREL[kind];
  g.drop = DROP[kind];
  g.lift = liftOf(kind, g.drop);
  g.pitch = PITCH[kind];
  const k = kick(kind, g.age, s);
  g.slide = kind === "mortar" ? k.down : k.back;
  return Object.assign(g, over);
}

function pose(kind: WeaponKind, s: number, men = 2, over: Partial<CrewGun> = {}): { g: CrewGun; f: Figure[]; n: number } {
  const g = gunAt(kind, s, men, over);
  const f = newFigures(CREW_MEN);
  const n = poseCrew(g, f);
  return { g, f, n };
}

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const strokesOf = (vals: number[]) => {
  const mid = (Math.min(...vals) + Math.max(...vals)) / 2;
  let n = 0;
  for (let i = 1; i < vals.length; i++) if (vals[i - 1] < mid && vals[i] >= mid) n++;
  return n;
};

test("two men, one or none: the poses make as many men as the household has", () => {
  assert.equal(CREW_MEN, 2);
  for (const k of KINDS) {
    assert.equal(pose(k, 0.5, 2).n, 2, `${k}: two`);
    assert.equal(pose(k, 0.5, 1).n, 1, `${k}: one`);
    assert.equal(pose(k, 0.5, 0).n, 0, `${k}: none`);
  }
});

test("a long gun or a chain shot with two men: the layer swabs and rams, the loader brings the powder, both run the gun out", () => {
  for (const kind of ["longGun", "chainShot"] as WeaponKind[]) {
    for (const s of [0.16, 0.19, 0.22]) {
      const { g, f } = pose(kind, s);
      assert.equal(f[LAYER].tool, STAFF, `${kind} ${s}: the layer has the staff`);
      assert.ok(dist(f[LAYER].ta, muzzleOf(g, [0, 0, 0])) < 0.6, `${kind} ${s}: its head is at the muzzle`);
    }
    assert.equal(pose(kind, 0.13).f[LOADER].carry, CARTRIDGE, "the loader fetches a cartridge from the box");
    assert.equal(pose(kind, 0.2).f[LOADER].carry, CARTRIDGE, "and carries it");
    const put = pose(kind, 0.32);
    assert.equal(put.f[LOADER].carry, CARTRIDGE, "and puts it in");
    assert.ok(dist(put.f[LOADER].cp, muzzleOf(put.g, [0, 0, 0])) < 1.2, "at the muzzle");
    assert.equal(pose(kind, 0.38).f[LAYER].carry, BALL, "the layer takes the shot from the garland");
    assert.equal(pose(kind, 0.5).f[LAYER].carry, BALL, "and puts it in after the cartridge");
    const ins: number[] = [];
    for (let i = 0; i < 160; i++) ins.push(dist(pose(kind, 0.55 + (0.17 * i) / 160).f[LAYER].ta, pose(kind, 0.55 + (0.17 * i) / 160).f[LAYER].hr));
    assert.equal(strokesOf(ins), 2, `${kind}: two ram strokes`);
    const lean = (s: number) => pose(kind, s).f.filter((m) => m.hw === 1 && m.tool !== LINSTOCK_TOOL && m.carry === NO_CARRY && m.stride > 0).length;
    assert.equal(lean(0.84), 2, `${kind}: both men push`);
    const r = pose(kind, 1);
    assert.equal(r.f[LAYER].tool, LINSTOCK_TOOL, "the layer is back at the breech with the match");
    assert.equal(r.f[LAYER].glow, 1);
    assert.equal(r.f[LOADER].hw, 0, "the loader stands clear");
    assert.equal(r.f[LOADER].carry, NO_CARRY);
  }
});

test("with one man he does it all in turn: the sponge, the powder, the shot, the rammer, the run out", () => {
  for (const kind of ["longGun", "chainShot"] as WeaponKind[]) {
    const at = (s: number) => pose(kind, s, 1);
    assert.equal(at(0.12).f[0].tool, STAFF, "swab");
    assert.equal(at(0.29).f[0].carry, CARTRIDGE, "the powder from the box");
    assert.equal(at(0.34).f[0].carry, CARTRIDGE);
    assert.equal(at(0.55).f[0].carry, BALL, "the shot from the garland");
    assert.equal(at(0.6).f[0].carry, BALL);
    const ins: number[] = [];
    for (let i = 0; i < 160; i++) ins.push(dist(at(0.67 + (0.09 * i) / 160).f[0].ta, at(0.67 + (0.09 * i) / 160).f[0].hr));
    assert.equal(strokesOf(ins), 2, `${kind}: two ram strokes`);
    const run = at(0.86).f[0];
    assert.equal(run.hw, 1);
    assert.ok(run.stride > 0, "he leans on the carriage alone");
    assert.equal(at(1).f[0].tool, LINSTOCK_TOOL);
  }
});

test("the mortar: swab, the powder, the shell carried by two men or lifted by one", () => {
  const sw = pose("mortar", 0.2);
  assert.equal(sw.f[LAYER].tool, STAFF);
  assert.ok(dist(sw.f[LAYER].ta, muzzleOf(sw.g, [0, 0, 0])) < 0.6);
  assert.equal(pose("mortar", 0.34).f[LOADER].carry, CARTRIDGE, "the powder");
  const sh = pose("mortar", 0.62);
  assert.equal(sh.f[LAYER].carry, SHELL, "the shell");
  const c = sh.f[LAYER].cp;
  assert.ok(dist(sh.f[LAYER].hl, c) < 0.4 && dist(sh.f[LOADER].hr, c) < 0.4, "carried between them");
  assert.equal(pose("mortar", 0.79).f[LAYER].carry, NO_CARRY, "in the muzzle and gone");
  assert.equal(pose("mortar", 1).f[LAYER].tool, LINSTOCK_TOOL);
  // One man: the powder, then the shell on his own.
  assert.equal(pose("mortar", 0.34, 1).f[0].carry, CARTRIDGE);
  assert.equal(pose("mortar", 0.65, 1).f[0].carry, SHELL);
  assert.equal(pose("mortar", 0.82, 1).f[0].carry, NO_CARRY);
});

test("the swivel: the layer at the breech and then the tiller, the loader across from him; one man does the layer's part", () => {
  for (const men of [1, 2]) {
    const b = pose("swivel", 0.3, men);
    assert.equal(b.n, men);
    assert.equal(b.f[LAYER].hw, 1);
    const t = pose("swivel", 1, men);
    assert.equal(t.f[LAYER].tool, LINSTOCK_TOOL);
    assert.ok(t.f[LAYER].hr[2] < -0.5, "his hand is on the tiller, behind the pivot");
    assert.ok(Math.abs(b.f[LAYER].px - t.f[LAYER].px) < 0.5, "a step or two between");
  }
  assert.ok(pose("swivel", 0.3, 2).f[LOADER].hw === 1, "the loader's hands are at the breech");
});

test("the layer leans away as it fires", () => {
  const rest = pose("longGun", 1).f[LAYER];
  const fired = pose("longGun", 0.0, 2, { age: 0.08 }).f[LAYER];
  assert.ok(fired.lean < rest.lean - 0.2, "leaning back");
  assert.ok(fired.crouch > 0);
  const later = pose("longGun", 0.06, 2, { age: 3 }).f[LAYER];
  assert.ok(Math.abs(later.crouch) < 1e-9, "upright again a while later");
});

test("nobody stands in the sight's line, at any stage, with any number of men, for any gun the player rides", () => {
  for (const kind of KINDS) {
    for (const men of [1, 2]) {
      for (const turn of [0, 0.35, -0.35, 0.7, -0.7]) {
        for (let i = 0; i <= 200; i++) {
          const s = i / 200;
          const { g, f, n } = pose(kind, s, men, { ridden: true, turn, propTurn: -turn * 0.4 });
          for (let m = 0; m < n; m++) {
            const h = headOf(f[m], [0, 0, 0]);
            const pts: number[][] = [h, [f[m].px, f[m].py + 1.2, f[m].pz], [f[m].px, f[m].py + 0.9, f[m].pz]];
            for (const p of pts) assert.ok(!inSightLine(p[0], p[1], p[2], g.drop, turn), `${kind} ${men} men, stage ${s} turn ${turn}: man ${m} at (${p.map((v) => v.toFixed(2))}) is in the sight's line`);
            const mz = muzzleOf(g, [0, 0, 0]);
            if (f[m].hw > 0 && kind !== "mortar") for (const p of [f[m].hl, f[m].hr]) if (dist(p, mz) > 0.75) assert.ok(!inSightLine(p[0], p[1], p[2], g.drop, turn, 0.6), `${kind} ${men} men, stage ${s} turn ${turn}: a hand of man ${m} is in the sight's line`);
          }
        }
      }
    }
  }
});

test("the staff and the linstock reach the sight's line only at the muzzle and the vent", () => {
  for (const kind of ["longGun", "chainShot"] as WeaponKind[]) {
    for (const men of [1, 2]) {
      for (let i = 0; i <= 100; i++) {
        const { g, f, n } = pose(kind, i / 100, men, { ridden: true });
        const m = muzzleOf(g, [0, 0, 0]);
        for (let k = 0; k < n; k++) {
          const man = f[k];
          if (man.tool !== STAFF) continue;
          for (let t = 0; t <= 1; t += 0.05) {
            const p = [0, 1, 2].map((q) => man.ta[q] + (man.tb[q] - man.ta[q]) * t);
            if (dist(p, m) < 1.0) continue;
            assert.ok(!inSightLine(p[0], p[1], p[2], g.drop, 0), `${kind} ${men} men ${i / 100}: the staff crosses the sight`);
          }
        }
      }
    }
  }
});

test("every man stands within the floor's reach and on a level of it, the two never in one place, and none jumps between nearby stages", () => {
  for (const kind of KINDS) {
    for (const men of [1, 2]) {
      let prev: Figure[] | null = null;
      const secs = RELOAD_S[kind] * (men === 1 ? 1.5 : 1);
      for (let i = 0; i <= 1000; i++) {
        const s = i / 1000;
        const { g, f, n } = pose(kind, s, men);
        for (let m = 0; m < n; m++) {
          assert.ok(Math.abs(f[m].px) <= REACH.x, `${kind} ${s}: man ${m} x ${f[m].px.toFixed(2)}`);
          assert.ok(f[m].pz >= -REACH.zBack && f[m].pz <= REACH.zFront, `${kind} ${s}: man ${m} z ${f[m].pz.toFixed(2)}`);
          assert.ok(f[m].py >= 0 && f[m].py <= g.lift + 1e-9, `${kind} ${s}: man ${m} on the floor or the platform`);
          for (const v of [f[m].face, f[m].lean, f[m].crouch, f[m].hw, ...f[m].hl, ...f[m].hr]) assert.ok(Number.isFinite(v));
          if (prev) {
            const step = Math.hypot(f[m].px - prev[m].px, f[m].pz - prev[m].pz);
            assert.ok(step < 10 * secs * 0.001, `${kind} ${men} men ${s}: man ${m} jumps ${step.toFixed(3)} m`);
            assert.ok(Math.abs(f[m].py - prev[m].py) < 0.05);
          }
        }
        if (n === 2) {
          const d = Math.hypot(f[0].px - f[1].px, f[0].pz - f[1].pz);
          assert.ok(d > 0.45, `${kind} ${s}: the two men are ${d.toFixed(2)} m apart`);
        }
        prev = f.slice(0, n).map((x) => JSON.parse(JSON.stringify(x)) as Figure);
      }
    }
  }
});

test("a man on the platform stands on its top; the others on the floor", () => {
  const { g, f } = pose("longGun", 0.2);
  assert.ok(g.lift > 0.5);
  assert.ok(Math.abs(f[LAYER].py - g.lift) < 1e-6, "at the front, on the platform");
  assert.equal(pose("longGun", 0.1).f[LOADER].py, 0, "at the box, on the floor");
  assert.equal(liftOf("mortar", 0.9), 0);
  assert.equal(liftOf("longGun", 0.5), 0);
});

test("a pose is a function of the gun alone: the same gun, the same men, and a jump in stage lands on the right pose", () => {
  for (const men of [0, 1, 2]) {
    const a = pose("longGun", 0.6, men), b = pose("longGun", 0.6, men);
    assert.deepEqual(a.f, b.f);
    const f = newFigures(CREW_MEN);
    poseCrew(gunAt("longGun", 0.1, men), f);
    poseCrew(gunAt("longGun", 0.9, men), f);
    poseCrew(gunAt("longGun", 0.6, men), f);
    assert.deepEqual(f.slice(0, men), a.f.slice(0, men));
  }
});

test("the household's count decides who is drawn: none for an empty slot or a gun not shown, two in the Practice range", () => {
  assert.equal(crewSizeFor("longGun", 2, true), 2);
  assert.equal(crewSizeFor("longGun", 1, true), 1);
  assert.equal(crewSizeFor("longGun", 0, true), 0, "swept away or shot down: nobody at it");
  assert.equal(crewSizeFor("longGun", -1, true), 2, "no household: two");
  assert.equal(crewSizeFor("", 2, true), 0, "an empty slot");
  assert.equal(crewSizeFor("mortar", 2, false), 0, "not shown");
  assert.equal(crewSizeFor("swivel", 2, true), 2);
});

test("the minion renderer leaves out a crewman at his gun and draws a keeper at his post and a man being hoisted", () => {
  assert.equal(UNIT_CREW, 6);
  assert.equal(drawnByCrews(UNIT_CREW, ACTION_AT_GUN), true, "the crews draw him");
  assert.equal(drawnByCrews(UNIT_CREW, ACTION_AT_POST), false, "a keeper stands at his post");
  assert.equal(drawnByCrews(UNIT_CREW, ACTION_HOIST), false, "a hoist is drawn as a man on a rope");
  assert.equal(drawnByCrews(UNIT_CREW, 0), false, "a replacement walking out");
  assert.equal(drawnByCrews(1, ACTION_AT_GUN), false, "a mason is a mason");
});

test("a man's head near the camera is hidden: the limit is 0.8 m", () => {
  assert.equal(HIDE_NEAR, 0.8);
  assert.ok(POLE > 2);
});
