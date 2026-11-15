import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILDINGS, BUILDING_KINDS, PLOTS, allowedOn } from "@keepfall/content";
import { plotsText } from "../src/buildwheel";

test("plots are said as a player counts them, from 1", () => {
  assert.equal(plotsText([4, 5, 6, 7]), "Plots 5 to 8");
  assert.equal(plotsText([0, 1, 2, 3, 4, 5]), "Plots 1 to 6");
  assert.equal(plotsText([2, 3, 4, 5, 6, 7]), "Plots 3 to 8");
  assert.equal(plotsText([7]), "Plot 8");
  assert.equal(plotsText([0, 2, 5]), "Plots 1, 3 and 6");
});

test("every kind has a plot to stand on, and no plot is past the eighth", () => {
  assert.equal(PLOTS.length, 8);
  for (const k of BUILDING_KINDS) {
    assert.ok(BUILDINGS[k].plots.length > 0, k);
    for (const p of BUILDINGS[k].plots) assert.ok(allowedOn(k, p) && p < PLOTS.length, `${k} ${p}`);
  }
  assert.ok(allowedOn("spotter", 7) && !allowedOn("spotter", 0));
});
