import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, DECK_TOP, GAME_LAYOUT, MID_Z, streamOffset } from "@keepfall/content";
import { navCell, NavKind, NAV_GRID, SandboxSim, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;

/** Cells reachable on foot from in front of the player's gate. */
function reachable(sim: SandboxSim): Uint8Array {
  const out = new Uint8Array(NAV_GRID.nx * NAV_GRID.nz);
  sim.nav.reach(navCell(0.3, -126), out);
  return out;
}

test("the nav grid: water blocks, bridges cross, walls and a closed gate keep you out", () => {
  const sim = new SandboxSim(R, buildLayout(1, GAME_LAYOUT), { seed: 3, minions: 0 });
  const nav = sim.nav;
  assert.equal(nav.kind[navCell(20, MID_Z + streamOffset(20))], NavKind.Water, "the stream between the bridges");
  const deck = navCell(0.4, -75.2);
  assert.equal(nav.kind[deck], NavKind.Raised, "the centre bridge's deck");
  assert.ok(Math.abs(nav.floor[deck] - DECK_TOP) < 0.02, `deck floor ${nav.floor[deck]}`);
  assert.equal(nav.kind[navCell(30, -100)], NavKind.Ground, "open field");
  // The deck's edge over the bank, where a stringer runs under it: still the deck.
  for (const z of [-80.5, -78.5, -71.5, -69.5]) assert.equal(nav.kind[navCell(1.5, z)], NavKind.Raised, `deck edge at z ${z}`);
  assert.deepEqual(sim.bridgesOpen(), [true, true, true]);
  const r = reachable(sim);
  assert.equal(r[navCell(0.3, -24)], 1, "in front of the enemy gate, across the stream");
  assert.equal(r[navCell(48, -60)], 1, "the far side of the left flank");
  assert.equal(r[navCell(0, -2)], 0, "the enemy courtyard, behind a closed gate");
  assert.equal(r[navCell(0, -148)], 0, "your own courtyard, behind your own gate");
  sim.free();
});

test("blowing bridges closes their crossings, and all three cut the valley in two", () => {
  const sim = new SandboxSim(R, buildLayout(1, GAME_LAYOUT), { seed: 3, minions: 0 });
  const blow = (k: number) => {
    const s = sim.castle.layout.bridges[k].site;
    sim.explode(s.x + 0.3, DECK_TOP - 0.4, s.z + 0.5);
    for (let i = 0; i < 240; i++) sim.step();
  };
  blow(1);
  assert.deepEqual(sim.bridgesOpen(), [true, false, true], "the centre bridge is down");
  assert.equal(reachable(sim)[navCell(0.3, -24)], 1, "still reachable round the flanks");
  blow(0);
  blow(2);
  assert.deepEqual(sim.bridgesOpen(), [false, false, false]);
  const r = reachable(sim);
  assert.equal(r[navCell(0.3, -24)], 0, "the far side is cut off");
  assert.equal(r[navCell(0.3, -100)], 1, "the near side is still open");
  sim.free();
});
