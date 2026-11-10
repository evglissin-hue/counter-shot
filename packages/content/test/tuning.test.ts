// applyTuning: variants of content by path, for tools. A bad path is refused
// whole, a good one applies and undoes, and armedWeapon() follows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTuning, armedWeapon, AI_LEVELS, AI_PLANS, UPGRADES, WEAPON_COST, WEAPONS } from "@keepfall/content";

const reload = WEAPONS.mortar.reload;

test("a missing path, an unknown root and a wrong type are refused, and nothing changes", () => {
  const cost = WEAPON_COST.mortar;
  for (const bad of [{ "WEAPONS.mortar.nope": 1 }, { "NOPE.x": 1 }, { "WEAPONS.mortar.reload": "fast" }, { "WEAPONS.mortar.reload.deep": 1 }, { WEAPONS: 1 }, { "WEAPONS.mortar.reload": Infinity }]) {
    // The first path is fine: a refusal must undo none of it because it applied none of it.
    assert.throws(() => applyTuning({ "WEAPON_COST.mortar": cost + 50, ...bad }), /tuning/);
    assert.equal(WEAPON_COST.mortar, cost);
  }
  assert.throws(() => applyTuning({ "WEAPONS.mortar.nope": 1 }), /WEAPONS\.mortar\.nope/);
  assert.equal(WEAPONS.mortar.reload, reload);
});

test("nested and array-index paths apply, and undo restores them in reverse", () => {
  const speed = WEAPONS.longGun.projectile.blast;
  const warm = AI_LEVELS.warlord.warmup;
  const undo = applyTuning({ "WEAPONS.longGun.projectile.blast": speed * 2, "AI_LEVELS.warlord.warmup": warm + 600 });
  assert.equal(WEAPONS.longGun.projectile.blast, speed * 2);
  assert.equal(AI_LEVELS.warlord.warmup, warm + 600);
  undo();
  assert.equal(WEAPONS.longGun.projectile.blast, speed);
  assert.equal(AI_LEVELS.warlord.warmup, warm);
});

test("an array may be indexed by number and replaced by an array", () => {
  const was = AI_PLANS.knight[0];
  const slot = (was as { plot?: number }).plot;
  const undo = applyTuning({ "AI_PLANS.knight.0.after": 5 });
  assert.equal((AI_PLANS.knight[0] as { after?: number }).after, 5);
  undo();
  assert.equal(AI_PLANS.knight[0], was);
  assert.equal((AI_PLANS.knight[0] as { plot?: number }).plot, slot);
  assert.throws(() => applyTuning({ "AI_PLANS.knight.99.after": 5 }), /tuning/);
  assert.throws(() => applyTuning({ "AI_PLANS.knight": { a: 1 } }), /array/);
});

test("armedWeapon follows a tuned reload and returns to normal after undo", () => {
  const before = armedWeapon("mortar", "heavyShell").reload;
  assert.equal(before, reload);
  const undo = applyTuning({ "WEAPONS.mortar.reload": 900, "UPGRADES.quickLoader.reload": 0.5 });
  assert.equal(armedWeapon("mortar", "heavyShell").reload, 900);
  assert.equal(armedWeapon("mortar", "quickLoader").reload, 450);
  undo();
  assert.equal(armedWeapon("mortar", "heavyShell").reload, reload);
  assert.equal(armedWeapon("mortar", "quickLoader").reload, Math.round(reload * UPGRADES.quickLoader.reload!));
  undo(); // undoing twice does nothing more
  assert.equal(WEAPONS.mortar.reload, reload);
});
