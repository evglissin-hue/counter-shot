import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTE_NAMES, holdMarker } from "@keepfall/content";
import { F_GATE, F_HOLD, F_INSIDE, LANE_STRIDE, L_DIST, L_FLAGS, L_KEGS, L_LADDERS, L_MEN, L_MUSKETS, CELL_MIN, cellColumns, laneSummary, ownRoad, readLanes, type LaneMinion } from "../src/threat";
import { roadsAcross } from "../src/minimap";
import { groupMinions } from "../src/overviewMarks";
import { MINION_STRIDE } from "@keepfall/sim";

const man = (o: Partial<LaneMinion>): LaneMinion => ({ team: 1, state: 0, role: 0, unit: 0, task: 0, route: 0, action: 0, x: 0, z: -100, ...o });
const R = (name: string) => ROUTE_NAMES.indexOf(name as never);
const at = (lanes: Int16Array, team: number, route: number, k: number) => lanes[(team * ROUTE_NAMES.length + route) * LANE_STRIDE + k];

test("roads are named from the player's own side: castle 0 sees left and right swapped", () => {
  assert.equal(ownRoad(1, "left"), "left");
  assert.equal(ownRoad(1, "right"), "right");
  assert.equal(ownRoad(0, "left"), "right");
  assert.equal(ownRoad(0, "right"), "left");
  assert.equal(ownRoad(0, "centre"), "centre");
});

test("lane sums: men, kegs, muskets, ladders, the leading man's distance, flags", () => {
  const list: LaneMinion[] = [
    man({ route: R("left"), z: -100 }),
    man({ route: R("left"), unit: 3, task: 0, z: -90 }), // a sapper with his keg
    man({ route: R("left"), unit: 3, task: 3, z: -92 }), // his keg is set: counts as a man only
    man({ route: R("left"), unit: 4, z: -95 }),
    man({ route: R("left"), unit: 2, z: -96 }), // a ladder crewman
    man({ route: R("left"), role: 1, z: -50 }), // a garrison man: not marching
    man({ route: R("left"), state: 1, z: -40 }), // a ragdoll
    man({ route: R("right"), z: -20, action: 3 }), // battering the gate of castle 0
    man({ route: R("centre"), z: -10, x: 0 }), // inside castle 0's courtyard
    man({ team: 0, route: R("centre"), z: -60 }),
  ];
  const lanes = laneSummary(list, [{ team: 1, state: 0, front: 4 }, { team: 1, state: 3, front: 4 }]);
  assert.equal(at(lanes, 1, R("left"), L_MEN), 5);
  assert.equal(at(lanes, 1, R("left"), L_KEGS), 1);
  assert.equal(at(lanes, 1, R("left"), L_MUSKETS), 1);
  assert.equal(at(lanes, 1, R("left"), L_LADDERS), 1, "a fallen ladder is not counted");
  // Team 1 marches on castle 0 (front wall z = -15): its leading man at -90 is 75 m off.
  assert.equal(at(lanes, 1, R("left"), L_DIST), 75);
  assert.equal(at(lanes, 1, R("left"), L_FLAGS), 0);
  assert.equal(at(lanes, 1, R("right"), L_DIST), 5);
  assert.ok(at(lanes, 1, R("right"), L_FLAGS) & F_GATE);
  assert.ok(at(lanes, 1, R("centre"), L_FLAGS) & F_INSIDE);
  // Nobody on a road: -1 and zeros.
  assert.equal(at(lanes, 0, R("left"), L_DIST), -1);
  assert.equal(at(lanes, 0, R("left"), L_MEN), 0);
  // Team 0 marches on castle 1 (wall z = -135): a man at -60 is 75 m off.
  assert.equal(at(lanes, 0, R("centre"), L_DIST), 75);
});

test("the hold flag: standing at the midfield marker", () => {
  const mk = holdMarker(1, "centre");
  const lanes = laneSummary([man({ route: R("centre"), x: mk.x, z: mk.z, action: 1 }), man({ team: 0, route: R("centre"), x: mk.x, z: mk.z, action: 1 })], []);
  assert.ok(at(lanes, 1, R("centre"), L_FLAGS) & F_HOLD);
  assert.ok(!(at(lanes, 0, R("centre"), L_FLAGS) & F_HOLD), "team 0's marker is on the other side of the stream");
});

test("reading the strip from castle 0: the enemy on the match's right road shows in the left cell", () => {
  const lanes = laneSummary([man({ route: R("right"), z: -30 }), man({ route: R("right"), z: -80 }), man({ route: R("right"), z: -80 }), man({ team: 0, route: R("right"), z: -60 })], []);
  const r0 = readLanes(lanes, 0);
  assert.deepEqual(r0.map((c) => c.road), ["left", "centre", "right"]);
  assert.equal(r0[0].men, 3);
  assert.equal(r0[0].mine, 1);
  assert.equal(r0[0].level, "past");
  assert.equal(r0[1].level, "quiet");
  assert.equal(r0[2].men, 0);
  // From castle 1 the same men are the player's own, on the right; the enemy (team 0) has one man on the right.
  const r1 = readLanes(lanes, 1);
  assert.equal(r1[2].men, 1);
  assert.equal(r1[2].mine, 3);
});

test("a man at the gate is red, and a quiet road shows nothing", () => {
  const lanes = laneSummary([man({ route: R("centre"), z: -17 })], []);
  const r = readLanes(lanes, 0);
  assert.equal(r[1].level, "danger");
  assert.ok(r[1].near > 0.9);
  assert.equal(r[0].near, 0);
});

type Row = [number, number, number, number, number];
/** Frame rows: id, x, y, z, yaw, phase, team, action, act, unit. */
function rows(men: Row[]): Float32Array {
  const out = new Float32Array(men.length * MINION_STRIDE);
  men.forEach(([id, x, z, team, unit], i) => {
    out.set([id, x, 0, z, 0, 0, team, 0, 0, unit], i * MINION_STRIDE);
  });
  return out;
}

test("groups: neighbours join, apart stay apart, masons and teams stay out, small groups get no mark", () => {
  const men: Row[] = [];
  for (let i = 0; i < 12; i++) men.push([i, (i % 4) * 2, -60 - Math.floor(i / 4) * 2, 1, 0]); // one block of 12
  for (let i = 0; i < 5; i++) men.push([20 + i, 40 + i, -60, 1, 0]); // five, 40 m away
  men.push([30, 80, -60, 1, 0], [31, 81, -60, 1, 0]); // two: too few
  for (let i = 0; i < 4; i++) men.push([40 + i, i, -61, 0, 0]); // the other team on the same spot
  for (let i = 0; i < 6; i++) men.push([50 + i, 100 + i, -60, 1, 1]); // masons
  men.push([60, 3, -60, 1, 3]); // a sapper in the first block
  const g = groupMinions(rows(men), men.length, new Set(), null, 0).sort((a, b) => b.n - a.n);
  assert.deepEqual(g.map((x) => [x.team, x.n]), [[1, 13], [1, 5], [0, 4]]);
  assert.equal(g[0].kegs, 1);
  const set = groupMinions(rows(men), men.length, new Set([60]), null, 0).sort((a, b) => b.n - a.n);
  assert.equal(set[0].kegs, 0, "a sapper who has set his keg carries none");
});

test("a group's motion is its men's mean displacement", () => {
  const a: Row[] = [];
  for (let i = 0; i < 4; i++) a.push([i, i, -60, 1, 0]);
  const prev = new Float32Array(64).fill(NaN);
  a.forEach(([id, x, z]) => {
    prev[id * 2] = x - 1;
    prev[id * 2 + 1] = z;
  });
  const g = groupMinions(rows(a), a.length, new Set(), prev, 0.5);
  assert.equal(g.length, 1);
  assert.ok(Math.abs(g[0].vx - 2) < 1e-6 && g[0].vz === 0);
});

test("the strip's cells line up with the minimap's roads: each spans the part of the strip nearest its road, none too narrow for its kit", () => {
  // The side column is 196 px wide; the map's box 196 x 250 draws its roads at about 17, 98 and 179.
  const roads = roadsAcross(196, 250);
  assert.ok(Math.abs(roads[0] - 17.5) < 1.5 && Math.abs(roads[1] - 98) < 1.5 && Math.abs(roads[2] - 178.5) < 1.5, `roads at ${roads.map((r) => r.toFixed(1))}`);
  // The strip has 6 px of padding each side: its columns run from 6 to 190 on the map's scale.
  const cols = cellColumns(roads, 6, 184);
  assert.equal(Math.round(cols[0] + cols[1] + cols[2]), 184);
  for (const c of cols) assert.ok(c >= Math.min(CELL_MIN, 184 / 3) - 1e-9, `a cell of ${c.toFixed(1)} px is too narrow for three kinds of kit`);
  const edges = [6, 6 + cols[0], 6 + cols[0] + cols[1], 190];
  // Each road runs under its own cell, and the centre road under the middle of the centre cell.
  for (let i = 0; i < 3; i++) assert.ok(roads[i] >= edges[i] && roads[i] <= edges[i + 1], `road ${i} at ${roads[i]} inside its cell ${edges[i]}..${edges[i + 1]}`);
  assert.ok(Math.abs((edges[1] + edges[2]) / 2 - roads[1]) < 2);
  // With room to spare, the split is halfway between roads.
  const wide = cellColumns(roads, 6, 184, 40);
  assert.ok(Math.abs(6 + wide[0] - (roads[0] + roads[1]) / 2) < 1e-9 && Math.abs(6 + wide[0] + wide[1] - (roads[1] + roads[2]) / 2) < 1e-9);
  // A short map box (drawn narrower, centred) moves the roads in.
  const short = roadsAcross(196, 180);
  assert.ok(short[0] > roads[0] + 5 && short[2] < roads[2] - 5);
  // Nothing goes negative or past the strip, whatever the roads or the width.
  for (const [r, w] of [[[-50, 0, 400], 184], [[0, 1, 2], 184], [[10, 20, 30], 90]] as const) {
    const c = cellColumns(r as [number, number, number], 6, w);
    assert.ok(c.every((x) => x >= 0) && Math.abs(c[0] + c[1] + c[2] - w) < 1e-9, `${r} ${w}: ${c}`);
  }
});
