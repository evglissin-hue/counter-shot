// The observatory's match (3.1): the same setup played twice gives the same
// hash, a variant changes play, tuning does not leak, and the line holds the
// samples and the counts the contract promises.

import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import type { Rapier } from "@keepfall/sim";
import { AI_LEVELS } from "@keepfall/content";
import { observeMatch } from "../scripts/observe-match";
import { AIM_KINDS, type MatchSetup } from "../scripts/observe-line";

await RD.init();
const R = RD as unknown as Rapier;

const base: MatchSetup = { id: "warlord-knight-s51-base", seed: 51, sides: ["warlord", "knight"], plans: ["stock", "stock"], variant: "base", tuning: {}, secs: 40 };
const key = (l: { result: { hash: { state: string; world: string } } }) => `${l.result.hash.state}/${l.result.hash.world}`;

test("the same setup gives the same line; a variant differs; undo leaves the base as it was", () => {
  const a = observeMatch(R, base);
  const b = observeMatch(R, base);
  assert.equal(key(a), key(b));
  assert.deepEqual(a.totals.build, b.totals.build);

  const warm = AI_LEVELS.warlord.warmup;
  const v = observeMatch(R, { ...base, id: "v", variant: "slow", tuning: { "AI_LEVELS.warlord.warmup": warm + 1500 } });
  assert.notEqual(key(v), key(a));
  assert.equal(AI_LEVELS.warlord.warmup, warm);

  const c = observeMatch(R, base);
  assert.equal(key(c), key(a));

  // The line: a sample each 30 s and one at the end, shots counted by what they were for.
  assert.equal(a.samples.length, 2);
  assert.deepEqual(a.samples.map((s) => s.t), [30, 40]);
  assert.equal(a.result.tick, 40 * 60);
  assert.equal(a.result.winner, null);
  for (const side of [0, 1] as const) {
    const sum = AIM_KINDS.reduce((n, k) => n + a.totals.byHand[side][k], 0);
    assert.equal(sum, a.totals.shots[side], "the gunner never sends a fire the rules refuse for want of powder");
  }
  assert.ok(a.totals.shots[0] + a.totals.shots[1] > 0, "shots were fired");
  // 3.3: the powder fields: spent is the cost of the shots that left (by hand and by crews), the stock is sampled, no magazine blew in 40 s.
  const t = a.totals;
  for (const side of [0, 1] as const) {
    assert.ok(t.powderSpent![side] >= t.shots[side] + t.auto[side], `${t.powderSpent![side]} charges spent on ${t.shots[side] + t.auto[side]} shots`);
    assert.ok(t.powderMade![side] >= 0 && t.powderBought![side] === 0 && t.powderLost![side] >= 0 && t.dryRideSecs![side] === 0);
    assert.equal(t.magazineBlown![side], -1);
    assert.equal(t.magazinesBlown![side], 0);
  }
  assert.ok(a.samples.every((x) => x.stock!.every((n) => n >= 0)) && a.samples.every((x) => x.plots.every((p) => p[5] === "K")), "the magazine stands on plot 5 (K)");
  assert.ok(a.totals.build.length > 0 && a.totals.build.every((e) => /^(build|buy|upgrade) /.test(e[2])));
  assert.equal(a.rules.match > 0, true);
});

test("a setup with a bad tuning path throws and leaves content alone", () => {
  const warm = AI_LEVELS.warlord.warmup;
  assert.throws(() => observeMatch(R, { ...base, tuning: { "AI_LEVELS.warlord.warmup": warm + 1, "AI_LEVELS.warlord.nope": 1 } }), /nope/);
  assert.equal(AI_LEVELS.warlord.warmup, warm);
});

test("an idle side counts no shots by hand", () => {
  const l = observeMatch(R, { ...base, id: "idle", sides: ["idle", "knight"], secs: 10 });
  assert.equal(AIM_KINDS.reduce((n, k) => n + l.totals.byHand[0][k], 0), 0);
});
