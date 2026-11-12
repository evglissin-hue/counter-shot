import { test } from "node:test";
import assert from "node:assert/strict";
import { MID_Z } from "@keepfall/content";
import {
  TREE_FADE,
  TREE_KINDS,
  TREE_NEAR_X,
  TREE_NEAR_Z,
  deadTree,
  drawsAsCard,
  drawsAsModel,
  oak,
  spruce,
  treeCardShare,
  treeEdgeDistance,
  triangleCount,
  type Soup,
} from "../src/render/treeShapes";
import { cardStats, plantColor, rasterCard } from "../src/render/treeRaster";

const PAL = { leaf: 0x24382a, leafLight: 0x3a5238, leafDark: 0x15241a, trunk: 0x2e251d };

function bounds(s: Soup) {
  let minY = 1e9, maxY = -1e9, maxR = 0;
  for (let i = 0; i < s.pos.length; i += 3) {
    minY = Math.min(minY, s.pos[i + 1]);
    maxY = Math.max(maxY, s.pos[i + 1]);
    maxR = Math.max(maxR, Math.hypot(s.pos[i], s.pos[i + 2]));
  }
  return { minY, maxY, maxR };
}

/** The crown's width (max x extent) at a height, from the vertices. */
function widthAt(s: Soup, y0: number, y1: number): number {
  let w = 0;
  for (let i = 0; i < s.pos.length; i += 3) if (s.pos[i + 1] >= y0 && s.pos[i + 1] < y1) w = Math.max(w, Math.abs(s.pos[i]));
  return w;
}

test("every kind is deterministic and well formed", () => {
  for (const k of TREE_KINDS) {
    const a = k.build(), b = k.build();
    assert.deepEqual(a.pos, b.pos, k.id);
    assert.deepEqual(a.idx, b.idx, k.id);
    assert.equal(a.part.length, a.pos.length / 3);
    assert.equal(a.shade.length, a.pos.length / 3);
    assert.ok(a.idx.every((i) => i >= 0 && i < a.pos.length / 3), `${k.id} indices in range`);
    assert.ok(a.pos.every(Number.isFinite), `${k.id} finite`);
    assert.ok(bounds(a).minY > -0.2, `${k.id} stands on the ground`);
  }
});

test("a spruce is narrow at the top: a spire above its tiers, the trunk bare low down", () => {
  const s = spruce({ seed: 31, whorls: 11, fingers: 9, height: 9.6, radius: 2.4 });
  const b = bounds(s);
  assert.ok(b.maxY > 9.5 && b.maxY < 9.7);
  assert.ok(widthAt(s, 8.4, 9.7) < 0.5, "the spire is slender");
  assert.ok(widthAt(s, 1.9, 3.5) > 1.5, "the lower tiers are broad");
  assert.ok(widthAt(s, 0, 0.5) < 0.3, "the trunk shows below the lowest tier");
  // The outline narrows going up: width in each third is under the one below it.
  const w1 = widthAt(s, 2, 4.5), w2 = widthAt(s, 4.5, 7), w3 = widthAt(s, 7, 9.7);
  assert.ok(w1 > w2 && w2 > w3);
});

test("an oak's crown has gaps where the sky shows, a spruce's much fewer", () => {
  const o = rasterCard(oak({ seed: 29, limbs: 3, size: 0.9 }), PAL, 200);
  const d = rasterCard(deadTree({ seed: 5, limbs: 5 }), PAL, 200);
  const sp = rasterCard(spruce({ seed: 31, whorls: 11, fingers: 9, height: 9.6, radius: 2.4 }), PAL, 200);
  const so = cardStats(o), sd = cardStats(d), ss = cardStats(sp);
  assert.ok(so.gaps > 0.08, `oak gaps ${so.gaps}`);
  assert.ok(sd.gaps > so.gaps, "a dead tree is mostly bare sky");
  assert.ok(so.covered > 0.15 && so.covered < 0.5, `oak coverage ${so.covered}`);
  assert.ok(ss.covered > 0.2, `spruce coverage ${ss.covered}`);
});

test("the triangle budget of a model stays modest", () => {
  for (const k of TREE_KINDS) {
    const n = triangleCount(k.build());
    assert.ok(n > 100 && n < 450, `${k.id} has ${n} triangles`);
  }
});

test("the card painter fills a silhouette, leaves its edge soft and the empty pixels coloured", () => {
  const img = rasterCard(spruce({ seed: 47, whorls: 11, fingers: 8, height: 8.6, radius: 2.1 }), PAL, 128);
  assert.equal(img.height, 128);
  assert.equal(img.data.length, img.width * img.height * 4);
  let soft = 0, solid = 0, empty = 0;
  for (let i = 3; i < img.data.length; i += 4) {
    const a = img.data[i];
    if (a === 0) empty++;
    else if (a === 255) solid++;
    else soft++;
  }
  assert.ok(solid > 500 && soft > 100 && empty > 1000, `${solid} solid, ${soft} soft, ${empty} empty`);
  // Empty pixels carry the mean colour, not black.
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] === 0) {
    assert.ok(img.data[i + 1] > 10);
    break;
  }
  // The card is as wide and tall as the model.
  assert.ok(Math.abs(img.tall - 8.6 * 1.02) < 0.3);
});

test("plantColor follows the material: dark in the shade, light at the tips, wood is brown", () => {
  const dark = plantColor(PAL, 1, 0.1), lit = plantColor(PAL, 1, 1.0), wood = plantColor(PAL, 0, 0.6);
  assert.ok(lit[1] > dark[1]);
  assert.ok(wood[0] > wood[2]);
});

test("the near and far split: a model inside the battlefield box, a card beyond it, both in the fade", () => {
  assert.equal(treeEdgeDistance(0, MID_Z), 0);
  assert.equal(treeEdgeDistance(TREE_NEAR_X, MID_Z + TREE_NEAR_Z), 0);
  assert.equal(treeEdgeDistance(TREE_NEAR_X + 10, MID_Z), 10);
  assert.ok(Math.abs(treeEdgeDistance(TREE_NEAR_X + 30, MID_Z + TREE_NEAR_Z + 40) - 50) < 1e-9);
  for (const d of [0, 1, TREE_FADE / 2, TREE_FADE - 1]) assert.ok(drawsAsModel(d), `model at ${d}`);
  assert.ok(!drawsAsModel(TREE_FADE) && !drawsAsModel(500));
  assert.ok(!drawsAsCard(0) && drawsAsCard(0.01) && drawsAsCard(500));
  // The crossfade: all model at the edge, all card at the end of the fade, monotone between.
  assert.equal(treeCardShare(0), 0);
  assert.equal(treeCardShare(TREE_FADE), 1);
  let last = 0;
  for (let d = 0; d <= TREE_FADE; d += 1) {
    const c = treeCardShare(d);
    assert.ok(c >= last);
    last = c;
  }
  // Every tree is drawn as at least one of them: the two ranges overlap, never leave a gap.
  for (let d = 0; d < 600; d += 0.5) assert.ok(drawsAsModel(d) || drawsAsCard(d), `at ${d}`);
});
