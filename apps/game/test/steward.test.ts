import { test } from "node:test";
import assert from "node:assert/strict";
import { ASHWRIGHT_EMPLACEMENTS, BUILDING_KINDS, BUILDINGS, BUILDING_REBUILD } from "@keepfall/content";
import type { MatchInput } from "@keepfall/rules";
import { Standing, type StandingCtx } from "../src/steward/standing";
import { buildView } from "../src/steward/view";

const MILL = BUILDING_KINDS.indexOf("mill");
const BARRACKS = BUILDING_KINDS.indexOf("barracks");

test("the view names plot kinds and states, and a standing barracks' mix and route", () => {
  const plots = [
    { kind: -1, state: 0 },
    { kind: MILL, state: 1 },
    { kind: BARRACKS, state: 2 },
    { kind: BARRACKS, state: 3 },
    { kind: -1, state: 0 },
    { kind: -1, state: 0 },
  ];
  const barracks = new Int8Array(12);
  barracks[4] = 2;
  barracks[5] = 1;
  const v = buildView({
    team: 1,
    gold: 123,
    plots,
    guns: ASHWRIGHT_EMPLACEMENTS,
    mountDown: [false, true],
    foundry: false,
    barracks,
    repairs: { gate: true, walls: true, towers: true, keep: true },
    order: 1,
    route: "centre",
    riding: -1,
    standing: ["rebuild"],
  });
  assert.equal(v.plots[1].kind, "mill");
  assert.equal(v.plots[1].state, "rising");
  assert.equal(v.plots[3].state, "ruined");
  assert.deepEqual(v.barracks[2], { mix: "volley", route: "centre" });
  assert.equal(v.barracks[3], null, "a ruin has no settings");
  assert.equal(v.guns[1].mountDown, true);
  assert.equal(v.guns[0].id, ASHWRIGHT_EMPLACEMENTS[0].id);
  assert.deepEqual(v.standing, ["rebuild"]);
});

function rig() {
  const inputs: MatchInput[] = [];
  const notes: string[] = [];
  const s = new Standing({ act: (i) => inputs.push(i), note: (t) => notes.push(t) });
  const ctx: StandingCtx = { gateOpen: false, gold: 1000, repairs: { gate: true, walls: true, towers: false, keep: true }, plots: [] };
  return { s, inputs, notes, ctx };
}

test("gate first: a broken gate turns off the other repairs that were on, and the end puts back exactly those", () => {
  const { s, inputs, notes, ctx } = rig();
  s.set("gateFirst", true);
  s.tick(0, ctx);
  assert.equal(inputs.length, 0, "nothing while the gate stands");
  ctx.gateOpen = true;
  s.tick(1000, ctx);
  assert.deepEqual(inputs, [
    { kind: "repair", repair: "walls", on: false },
    { kind: "repair", repair: "keep", on: false },
  ]);
  assert.match(notes[0], /gate first/);
  inputs.length = 0;
  ctx.repairs = { gate: true, walls: false, towers: false, keep: false };
  s.tick(2000, ctx);
  assert.equal(inputs.length, 0, "acts once");
  ctx.gateOpen = false;
  s.tick(3000, ctx);
  assert.deepEqual(inputs, [
    { kind: "repair", repair: "walls", on: true },
    { kind: "repair", repair: "keep", on: true },
  ]);
});

test("gate first: switching it off while acting puts the repairs back", () => {
  const { s, inputs, ctx } = rig();
  s.set("gateFirst", true);
  ctx.gateOpen = true;
  s.tick(0, ctx);
  inputs.length = 0;
  s.set("gateFirst", false);
  assert.equal(inputs.length, 2);
  assert.ok(inputs.every((i) => i.kind === "repair" && i.on === true));
});

test("rebuild: a ruin is rebuilt once the gold is there, once, and again after five seconds if still ruined", () => {
  const { s, inputs, notes, ctx } = rig();
  const cost = Math.round(BUILDINGS.mill.cost * BUILDING_REBUILD);
  ctx.plots = [{ kind: -1, state: 0 }, { kind: MILL, state: 3 }];
  ctx.gold = cost - 1;
  s.set("rebuild", true);
  s.tick(0, ctx);
  assert.equal(inputs.length, 0, "not enough gold");
  ctx.gold = cost;
  s.tick(1000, ctx);
  assert.deepEqual(inputs, [{ kind: "build", plot: 1, building: "mill" }]);
  assert.match(notes[0], /rebuilding the/);
  s.tick(3000, ctx);
  assert.equal(inputs.length, 1, "not again within five seconds");
  s.tick(7000, ctx);
  assert.equal(inputs.length, 2, "retried");
});

test("standing orders that are off do nothing, and reset clears them", () => {
  const { s, inputs, ctx } = rig();
  ctx.gateOpen = true;
  ctx.plots = [{ kind: MILL, state: 3 }];
  s.tick(0, ctx);
  assert.equal(inputs.length, 0);
  s.set("rebuild", true);
  s.reset();
  assert.deepEqual(s.list(), []);
});
