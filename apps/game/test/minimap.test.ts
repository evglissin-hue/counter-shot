import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, CASTLE_SHAPE, DIST, GAME_LAYOUT } from "@keepfall/content";
import { Cell, FOOT_BREACH, GATE, KEEP, Minimap, SECTION_COUNT, SHARE_HALF, SHARE_SOUND, TOWER_BB, TOWER_FA, VH, VW, Wall, WALL_CELLS, cellState, sectionOf, wallCell } from "../src/minimap";

const layout = buildLayout(1, GAME_LAYOUT);

test("every section of both castles has stones to count, and the walls' cells are spread along their length", () => {
  for (const castle of [0, 1]) {
    const n: number[] = new Array(SECTION_COUNT).fill(0);
    for (const s of layout.stones) {
      if (s.castle !== castle) continue;
      const k = sectionOf(s);
      if (k >= 0) n[k]++;
    }
    n.forEach((c, k) => assert.ok(c >= (k === GATE ? 2 : 8), `castle ${castle} section ${k} has only ${c} stones`));
    // No cell is a sliver beside its neighbours.
    for (let w = 0; w < 4; w++) {
      const cells = Array.from({ length: WALL_CELLS }, (_, i) => n[wallCell(w, i)]);
      assert.ok(Math.min(...cells) * 3 >= Math.max(...cells), `wall ${w}: ${cells.join(" ")}`);
    }
  }
});

test("the cells run along their walls in order: the front from -x to +x, the sides front to back, the back from -x to +x", () => {
  const S = CASTLE_SHAPE;
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
  for (const castle of [0, 1]) {
    const at = (w: number, i: number, axis: "x" | "cz") =>
      mean(layout.stones.filter((s) => s.castle === castle && sectionOf(s) === wallCell(w, i)).map((s) => (axis === "x" ? s.x : castle === 0 ? s.z : -DIST - s.z)));
    for (let i = 1; i < WALL_CELLS; i++) {
      assert.ok(at(Wall.Front, i, "x") > at(Wall.Front, i - 1, "x"));
      assert.ok(at(Wall.Back, i, "x") > at(Wall.Back, i - 1, "x"));
      assert.ok(at(Wall.SideA, i, "cz") > at(Wall.SideA, i - 1, "cz"));
      assert.ok(at(Wall.SideB, i, "cz") > at(Wall.SideB, i - 1, "cz"));
    }
    assert.ok(at(Wall.Front, 2, "x") < -S.gateHalf && at(Wall.Front, 3, "x") > S.gateHalf, "the gate sits between the front's third and fourth cells");
    assert.ok(at(Wall.SideA, 0, "x") < 0 && at(Wall.SideB, 0, "x") > 0);
    assert.ok(at(Wall.Front, 0, "cz") < 0 && at(Wall.Back, 0, "cz") > 0);
  }
  const gate = layout.stones.filter((s) => s.castle === 1 && sectionOf(s) === GATE);
  assert.ok(gate.length > 0 && gate.every((s) => s.part === "gate"));
  assert.ok(layout.stones.some((s) => s.castle === 0 && sectionOf(s) === KEEP));
  assert.ok(layout.stones.some((s) => s.castle === 0 && sectionOf(s) === TOWER_FA) && layout.stones.some((s) => s.castle === 1 && sectionOf(s) === TOWER_BB));
});

test("a cell reads by its two shares: plain, hatched, amber, or a breach where the foot is open", () => {
  assert.equal(cellState(100, 100), Cell.Sound);
  assert.equal(cellState(SHARE_SOUND, 100), Cell.Sound);
  assert.equal(cellState(SHARE_SOUND - 1, 100), Cell.Damaged);
  assert.equal(cellState(SHARE_HALF, 100), Cell.Damaged);
  assert.equal(cellState(SHARE_HALF - 1, 100), Cell.Half);
  assert.equal(cellState(0, 0), Cell.Breach);
  // The foot decides a breach, whatever stands above it.
  assert.equal(cellState(90, FOOT_BREACH - 1), Cell.Breach);
  assert.equal(cellState(90, FOOT_BREACH), Cell.Damaged);
});

test("the map puts your castle at the bottom, the enemy's at the top, your left on the left, from either castle", () => {
  for (const me of [0, 1] as const) {
    const mineZ = me === 1 ? -DIST : 0, theirZ = me === 1 ? 0 : -DIST;
    const [mx, my] = Minimap.px(me, 0, mineZ);
    const [tx, ty] = Minimap.px(me, 0, theirZ);
    assert.equal(mx, VW / 2);
    assert.equal(tx, VW / 2);
    assert.ok(my > VH * 0.7 && ty < VH * 0.3, `mine at ${my}, theirs at ${ty}`);
    // Looking at the enemy, your left hand is the screen's left: castle 1 looks along +z, its left is +x.
    const left = me === 1 ? 20 : -20;
    assert.ok(Minimap.px(me, left, mineZ)[0] < VW / 2, "left is left");
    assert.ok(Minimap.px(me, -left, mineZ)[0] > VW / 2, "right is right");
  }
  // The stream sits in the middle of the page; the ground just outside each castle still fits the page.
  const [, sy] = Minimap.px(1, 0, -DIST / 2);
  assert.ok(Math.abs(sy - VH / 2) < 4);
  for (const z of [-DIST - 25, 25]) {
    const [, y] = Minimap.px(1, 0, z);
    assert.ok(y > 0 && y < VH, `z ${z} at ${y}`);
  }
});
