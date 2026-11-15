import { test } from "node:test";
import assert from "node:assert/strict";
import { drawnIn, eyeTargets, holdsClass, holdsLabel, structureUnder, structureWords, tells, heatColor, rayStructure } from "../src/eye";
import type { StructureInfo } from "../src/protocol";

function mk(index: number, over: Partial<StructureInfo> = {}): StructureInfo {
  const keep = index % 5 === 0;
  return { index, castle: index < 5 ? 0 : 1, kind: keep ? "keep" : "tower", name: keep ? "the keep" : "the front left tower", cx: keep ? 0 : 15, cz: index < 5 ? 100 : -100, half: keep ? 5 : 3.6, baseY: 0, topY: keep ? 20 : 12, state: 0, holds: 1, weakest: -1, crushNear: 0, toppleNear: 0, margin: 0, dirX: 0, dirZ: 0, comX: 0, comY: 0, comZ: 0, footY: 0, hull: [], drawIn: 0, heat: new Array(keep ? 40 : 24).fill(0), ...over };
}
const list = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => mk(i));

test("the ray picks the keep's box and the tower's cylinder, the nearest within range", () => {
  // Castle 1's keep is at (0, -100); look down -z from the middle of the field.
  assert.equal(structureUnder(list, 0, 8, 0, 0, 0, -1), 5);
  // 6.1 m off the keep's middle is inside its buttress reach (5 + 1.2), 6.5 is outside.
  assert.ok(rayStructure(list[5], 6.1, 8, 0, 0, 0, -1) > 0);
  assert.equal(rayStructure(list[5], 6.5, 8, 0, 0, 0, -1), -1);
  // A tower: radius 3.6, 12 m tall: a ray over its roof misses, through its side hits.
  assert.ok(rayStructure(list[6], 15, 6, 0, 0, 0, -1) > 0);
  assert.equal(rayStructure(list[6], 15, 13, 0, 0, 0, -1), -1);
  assert.equal(rayStructure(list[6], 19.5, 6, 0, 0, 0, -1), -1);
  // Out of range (400 m): nothing.
  assert.equal(structureUnder(list, 0, 8, 600, 0, 0, -1), -1);
});

test("a fallen structure is not picked and shows no eye", () => {
  const l = list.map((s) => (s.index === 5 ? { ...s, state: 3 } : s));
  assert.equal(structureUnder(l, 0, 8, 0, 0, 0, -1), -1);
  assert.deepEqual(eyeTargets(l, { held: true, overview: false, me: 0, under: 5, forced: -1 }), []);
});

test("targets: nothing without the key, the structure under the sight riding, your own castle and the enemy's under the mouse in the overview", () => {
  assert.deepEqual(eyeTargets(list, { held: false, overview: true, me: 0, under: 5, forced: -1 }), []);
  assert.deepEqual(eyeTargets(list, { held: true, overview: false, me: 0, under: 5, forced: -1 }), [5]);
  assert.deepEqual(eyeTargets(list, { held: true, overview: true, me: 0, under: 6, forced: -1 }), [0, 1, 2, 3, 4, 6]);
  assert.deepEqual(eyeTargets(list, { held: true, overview: true, me: 0, under: 2, forced: -1 }), [0, 1, 2, 3, 4]);
  // The guided match's one look needs no key.
  assert.deepEqual(eyeTargets(list, { held: false, overview: false, me: 0, under: -1, forced: 5 }), [5]);
  assert.deepEqual(eyeTargets([], { held: true, overview: false, me: 0, under: 0, forced: 0 }), []);
});

test("the label says the share held, or Falling", () => {
  assert.equal(holdsLabel(mk(5)), "Holds 100%");
  assert.equal(holdsLabel(mk(5, { holds: 0.62 })), "Holds 62%");
  assert.equal(holdsLabel(mk(5, { holds: 0.629 })), "Holds 62%");
  assert.equal(holdsLabel(mk(5, { holds: 0.4, state: 1 })), "Falling");
  assert.equal(holdsLabel(mk(5, { holds: 0.4, state: 2 })), "Falling");
});

test("the footing is drawn in: a square shrinks, a sliver vanishes", () => {
  const sq = [-5, -5, 5, -5, 5, 5, -5, 5];
  const inner = drawnIn(sq, 1);
  assert.equal(inner.length, 8);
  for (const v of inner) assert.ok(Math.abs(Math.abs(v) - 4) < 1e-9, `${v}`);
  assert.deepEqual(drawnIn(sq, 5.1), []);
  assert.equal(drawnIn(sq, 0).length, 8);
  assert.deepEqual(drawnIn([0, 0, 1, 0], 0.1), []);
  // A thin footing (a face cut away): 0.5 m wide, drawn in 0.3 each side: gone.
  assert.deepEqual(drawnIn([-5, 0, 5, 0, 5, 0.5, -5, 0.5], 0.3), []);
});

test("the world's tells: cracks at 70%, dust at 85%, nothing for the whole or the fallen", () => {
  const heat = new Array(10).fill(0);
  heat[3] = 0.69;
  assert.deepEqual(tells({ state: 0, heat, weakest: 3 }), { cracks: false, dust: false, course: 3 });
  heat[3] = 0.7;
  assert.deepEqual(tells({ state: 0, heat, weakest: 3 }), { cracks: true, dust: false, course: 3 });
  heat[3] = 0.9;
  assert.deepEqual(tells({ state: 1, heat, weakest: 3 }), { cracks: true, dust: true, course: 3 });
  assert.equal(tells({ state: 0, heat: [], weakest: -1 }).cracks, false);
  assert.equal(tells({ state: 3, heat, weakest: 3 }).cracks, false);
});

test("the tracker's bar: green over 0.6, red under 0.3", () => {
  assert.equal(holdsClass(1), "good");
  assert.equal(holdsClass(0.61), "good");
  assert.equal(holdsClass(0.6), "mid");
  assert.equal(holdsClass(0.3), "mid");
  assert.equal(holdsClass(0.29), "low");
});

test("heat runs cool to hot", () => {
  const c = heatColor(0), h = heatColor(1);
  assert.ok(c[2] > c[0] && h[0] > h[2]);
  assert.deepEqual(heatColor(-3), c);
});

test("the words: theirs and yours, a tower by its owner's name", () => {
  const keep = { kind: "keep" as const, name: "the keep" }, tower = { kind: "tower" as const, name: "the front left tower" };
  assert.equal(structureWords(keep, false).groan, "Their keep groans");
  assert.equal(structureWords(tower, false).groan, "Their front left tower groans");
  assert.equal(structureWords(keep, true).groan, "Your keep groans: masons to it");
  assert.equal(structureWords(keep, false).falling, "Their keep is coming down");
  assert.equal(structureWords(tower, false).falling, "Their front left tower fell");
  assert.equal(structureWords(keep, true).falling, "Your keep is coming down");
  assert.equal(structureWords(keep, true).saved, "Your masons saved the keep");
  assert.equal(structureWords(keep, false).felled, "Keep felled");
  assert.equal(structureWords(tower, false).felled, "Tower felled");
});
