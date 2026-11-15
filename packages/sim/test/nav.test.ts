import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BRIDGES, buildLayout, DECK_TOP, GAME_LAYOUT, MID_Z, STREAM, streamOffset } from "@keepfall/content";
import { navCell, NavKind, NAV_GRID, SandboxSim, type Rapier } from "@keepfall/sim";

/** The wading line: ground below this reads as water only inside the stream's channel. */
const WADE_LINE = STREAM.level - 0.25;

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

test("a crater far from the stream is dry ground, not deep water", () => {
  const sim = new SandboxSim(R, buildLayout(1, GAME_LAYOUT), { seed: 3, minions: 0 });
  const cx = 30, cz = -100; // open ground, well away from the stream's channel
  assert.equal(sim.nav.kind[navCell(cx, cz)], NavKind.Ground, "open field to start");
  sim.explode(cx, 0.2, cz); // a mortar shell digs a crater below the wading line
  for (let i = 0; i < 180; i++) sim.step();
  let water = 0, minFloor = Infinity;
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    const c = navCell(cx + dx, cz + dz);
    if (sim.nav.floor[c] < minFloor) minFloor = sim.nav.floor[c];
    if (sim.nav.kind[c] === NavKind.Water) water++;
  }
  assert.ok(minFloor < WADE_LINE, `the crater digs below the wading line (floor ${minFloor.toFixed(2)})`);
  assert.equal(water, 0, "but no cell reads as water, because it is nowhere near the stream");
  // The stream itself is still water.
  assert.equal(sim.nav.kind[navCell(8, MID_Z + streamOffset(8))], NavKind.Water, "the stream is still water");
  sim.free();
});

test("a dropped deck leaves the bridge closed and does not read as an open crossing", () => {
  const sim = new SandboxSim(R, buildLayout(1, GAME_LAYOUT), { seed: 3, minions: 0 });
  assert.deepEqual(sim.bridgesOpen(), [true, true, true]);
  // Knock the centre deck's middle planks loose (no blast): they settle into the stream channel.
  const b = BRIDGES[1];
  const lb = sim.castle.layout.bridges[1];
  let n = 0;
  for (let id = lb.first; id < lb.first + lb.count; id++) {
    const s = sim.castle.layout.stones[id];
    if (Math.abs(s.z - b.z) < 4.5 && sim.castle.knockLoose(id, 0, -0.5, 0)) n++;
  }
  assert.ok(n > 0, `knocked ${n} deck planks loose`);
  // Give the wreck a few seconds to drop and settle and the nav grid to catch up.
  for (let i = 0; i < 5 * 60; i++) sim.step();
  assert.equal(sim.bridgesOpen()[1], false, "the centre crossing is gone once the deck has dropped");
  // And over the next 25 s it never re-opens over the settled wreck: the channel stays water.
  for (let t = 0; t < 25 * 60; t++) {
    sim.step();
    if (t % 60 === 0) assert.equal(sim.bridgesOpen()[1], false, `centre bridge stays down at ${(5 + t / 60).toFixed(0)} s`);
  }
  assert.deepEqual(sim.bridgesOpen(), [true, false, true], "only the centre bridge is down, and it stays down");
  sim.free();
});
