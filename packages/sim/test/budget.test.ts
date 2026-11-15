// T9: the moving budget. With a budget, masonry that comes loose past it turns to dust, settled rubble stays settled
// when struck, a burst pulverises the heart of a heap, and a keep or tower fall wakes only the rubble resting on it.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BUDGET, buildLayout, GAME_LAYOUT, structureList } from "@keepfall/content";
import { CastleSim, DEFAULT_SIM, EVENT_STRIDE, EventKind, SandboxSim, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const L = structureList(layout);
const world = () => new SandboxSim(R, layout, { seed: 7, minions: 0 });

const countShattered = (c: CastleSim) => {
  let n = 0;
  for (let i = 0; i < layout.stones.length; i++) if (c.shattered[i]) n++;
  return n;
};

/** Put a piece (loosened first) where it is asked and freeze it there, as if it had settled. */
function freezeAt(c: CastleSim, id: number, x: number, y: number, z: number) {
  c.knockLoose(id, 0, 0, 0);
  const b = c.bodies[id];
  b.setTranslation({ x, y, z }, true);
  b.setBodyType(R.RigidBodyType.Fixed, true);
  const priv = c as unknown as { frozenList: number[] };
  c.frozen[id] = 1;
  priv.frozenList.push(id);
  (c as unknown as { woken: number }).woken = 0; // (as if a step had passed since)
}

/** Pieces of a far-away part of the layout (castle 1's walls) to use as loose rubble in tests, in id order. */
function spares(n: number): number[] {
  const out: number[] = [];
  for (const s of layout.stones) if (s.part === "wall" && s.x > 0 && out.length < n) out.push(s.id);
  return out;
}

test("several falls at once stay within the moving budget, and the excess is dust", () => {
  const sim = world();
  const c = sim.castle;
  const cutKeep = L[0].stones.filter((id) => {
    const s = layout.stones[id];
    return s.part === "keep" && s.course >= 2 && s.course <= 4 && (s.z - L[0].cz < -3 || (Math.abs(s.x - L[0].cx) > 3 && s.z - L[0].cz < -5 + 10 / 3));
  });
  const cutTower = (si: number) =>
    L[si].stones.filter((id) => layout.stones[id].part === "tower" && layout.stones[id].course === 2).filter((_, k) => k % 2 === 0);
  for (const id of [...cutKeep, ...cutTower(1), ...cutTower(2)]) if (!c.dynamic[id]) c.dust(id);
  c.supportNow();
  const walls = layout.stones.filter((st) => st.part === "wall" && st.course === 1).filter((_, k) => k % 6 === 0);
  const cuts = countShattered(c);
  let most = 0, topples = 0;
  for (let t = 0; t < 60 * 25; t++) {
    sim.step();
    // shells on the curtain walls while the rest falls (a fall that starts with no room keeps BUDGET.minFallBodies, so
    // the shells go on walls, not on more structures)
    if (t === 120 || t === 300) for (let k = 0; k < walls.length; k += 8) c.burst(walls[k].x, walls[k].y, walls[k].z, 5, 0.65, 14, 0.3);
    most = Math.max(most, c.awakeCount());
    const f = sim.collect();
    for (let i = 0; i < f.eventCount; i++) if (f.events[i * EVENT_STRIDE] === EventKind.Topple || f.events[i * EVENT_STRIDE] === EventKind.Crush) topples++;
  }
  assert.ok(topples >= 1, "something fell");
  // (+40 for storey boards and gates, which never turn to dust; + minFallBodies: the tower that topples while the keep's
  // fall and the shells have used the room still keeps that many bodies)
  assert.ok(most <= BUDGET.moving + BUDGET.minFallBodies + 40, `most moving ${most}, budget ${BUDGET.moving}`);
  assert.ok(countShattered(c) > cuts, "masonry that came loose beyond the budget turned to dust");
  sim.free();
});

test("with no room, loose masonry turns to dust; a storey board or a gate leaf does not", () => {
  const c = new CastleSim(R, layout, { ...DEFAULT_SIM, ground: true, settle: true, budget: 4 });
  assert.equal(c.room(), 4);
  const ids = spares(40);
  for (const id of ids.slice(0, 4)) c.knockLoose(id, 0, 0, 0);
  assert.ok(c.room() <= 0, "the budget is used up by what was woken");
  const before = countShattered(c);
  for (const id of ids.slice(4)) c.knockLoose(id, 0, 0, 0);
  assert.ok(countShattered(c) >= before + ids.length - 4 - ids.slice(4).filter((id) => layout.stones[id].part === "gate").length, "past the budget it is dust");
  c.free();
});

test("3.5: with no room, an organ's key piece (the bell, the jib, the yard) stays a body; its other pieces turn to dust", () => {
  const c = new CastleSim(R, layout, { ...DEFAULT_SIM, ground: true, settle: true, budget: 4 });
  const ids = spares(4);
  for (const id of ids) c.knockLoose(id, 0, 0, 0);
  assert.ok(c.room() <= 0, "the budget is used up");
  assert.ok(layout.organs.length > 0, "the game's layout has organs");
  for (const o of layout.organs) {
    c.knockLoose(o.key, 0, 0, 0);
    assert.equal(c.shattered[o.key], 0, `organ ${o.organ} of castle ${o.castle}: its key piece is a body`);
    assert.equal(c.dynamic[o.key], 1);
    const other = o.key === o.first ? o.first + 1 : o.first;
    c.knockLoose(other, 0, 0, 0);
    assert.equal(c.shattered[other], 1, "another piece of it is dust");
  }
  c.free();
});

test("without a budget, room is unlimited and nothing turns to dust for lack of room", () => {
  const c = new CastleSim(R, layout, { ...DEFAULT_SIM, ground: true });
  assert.equal(c.room(), Infinity);
  for (const id of spares(40)) c.knockLoose(id, 0, 0, 0);
  assert.equal(countShattered(c), 0);
  c.free();
});

test("a strike on settled rubble wakes only the nearest pieces the budget has room for", () => {
  const c = new CastleSim(R, layout, { ...DEFAULT_SIM, ground: true, settle: true, budget: 10 });
  const ids = spares(30);
  ids.forEach((id, k) => freezeAt(c, id, 0 + k * 0.01, 40, 0));
  c.thawAt(0, 40, 0, 2);
  const woke = ids.filter((id) => !c.frozen[id]);
  assert.equal(woke.length, 10);
  assert.deepEqual(woke, ids.slice(0, 10), "nearest first, then by id");
  c.free();
});

test("a burst in a frozen heap turns its core to dust and throws the rest", () => {
  const sim = world();
  const c = sim.castle;
  const ids = spares(3);
  freezeAt(c, ids[0], 0, 60, 0); // at the centre
  freezeAt(c, ids[1], 2, 60, 0); // inside the core (5 * 0.65 = 3.25 m)
  freezeAt(c, ids[2], 4.5, 60, 0); // outside the core, inside the reach (6.5 m)
  c.burst(0, 60, 0, 5, 0.65, 14, 0.3);
  assert.equal(c.shattered[ids[0]], 1);
  assert.equal(c.shattered[ids[1]], 1);
  assert.equal(c.shattered[ids[2]], 0, "outside the core: thrown, not dust");
  assert.equal(c.frozen[ids[2]], 0, "and woken to be thrown");
  sim.free();
});

test("a toppling tower wakes the rubble that lies on it, not what lies beside its foot", () => {
  const sim = world();
  const c = sim.castle;
  const d = L[1];
  const members = d.stones.filter((id) => layout.stones[id].part === "tower");
  const upper = layout.stones[members.find((id) => layout.stones[id].course === 5)!];
  const [onTop, beside] = spares(2);
  // On a member of the part that will fall, and beside the tower at the same height but clear of every member.
  let far = upper;
  for (const id of members) {
    const s = layout.stones[id];
    if (s.course === upper.course && (s.x - d.cx) * (upper.x - d.cx) + (s.z - d.cz) * (upper.z - d.cz) > 0 && Math.hypot(s.x - d.cx, s.z - d.cz) > Math.hypot(far.x - d.cx, far.z - d.cz)) far = s;
  }
  const ux = (far.x - d.cx) / Math.hypot(far.x - d.cx, far.z - d.cz), uz = (far.z - d.cz) / Math.hypot(far.x - d.cx, far.z - d.cz);
  freezeAt(c, onTop, upper.x, upper.y + 0.8, upper.z);
  freezeAt(c, beside, far.x + ux * 1.7, upper.y + 0.8, far.z + uz * 1.7);
  const target = Math.atan2(-1, -1);
  const cut = members
    .filter((id) => layout.stones[id].course === 2)
    .map((id) => ({ id, a: Math.abs(Math.atan2(Math.sin(Math.atan2(layout.stones[id].z - d.cz, layout.stones[id].x - d.cx) - target), Math.cos(Math.atan2(layout.stones[id].z - d.cz, layout.stones[id].x - d.cx) - target))) }))
    .sort((p, q) => p.a - q.a || p.id - q.id);
  for (const w of cut.slice(0, Math.round(cut.length * 0.45))) c.dust(w.id);
  c.supportNow();
  let toppled = false;
  for (let t = 0; t < 120 && !toppled; t++) {
    sim.step();
    const f = sim.collect();
    for (let i = 0; i < f.eventCount; i++) if (f.events[i * EVENT_STRIDE] === EventKind.Topple) toppled = true;
  }
  assert.ok(toppled, "the tower toppled");
  assert.equal(c.frozen[onTop], 0, "the piece on the part woke");
  assert.equal(c.frozen[beside], 1, "the piece beside it stayed settled");
  sim.free();
});

test("rubble on a moving part beyond the room turns to dust rather than hanging in the air", () => {
  const c = new CastleSim(R, layout, { ...DEFAULT_SIM, ground: true, settle: true, budget: 3 });
  const ids = spares(8);
  ids.forEach((id, k) => freezeAt(c, id, k * 0.01, 40, 0));
  c.wakeFrozen(ids);
  assert.equal(ids.filter((id) => !c.frozen[id] && !c.shattered[id]).length, 3, "as many wake as there is room for");
  assert.equal(ids.filter((id) => c.shattered[id]).length, 5, "the rest is dust");
  c.free();
});

test("3.6: loose rubble asleep but not yet frozen keeps its place in the budget (a touch wakes a sleeping heap whole)", () => {
  const c = new CastleSim(R, layout, { ...DEFAULT_SIM, ground: true, settle: true, budget: 200 });
  const ids = spares(24);
  for (const id of ids) c.knockLoose(id, 0, 0, 0);
  let seen = 0;
  for (let t = 0; t < 60 * 20 && seen < 5; t++) {
    c.step();
    let dozing = 0, awake = 0;
    for (const id of ids) {
      if (c.frozen[id] || c.shattered[id]) continue;
      if (c.bodies[id].isSleeping()) dozing++;
      else awake++;
    }
    if (dozing > 0) {
      seen++;
      assert.ok(c.room() <= 200 - dozing - awake, `room ${c.room()} with ${dozing} asleep and ${awake} awake of the budget's 200`);
    }
  }
  assert.ok(seen > 0, "some rubble fell asleep before it froze");
  c.free();
});

test("3.6: past the budget, rubble lying on a storey board that gives way turns to dust; with room it wakes", () => {
  const board = layout.stones.find((s) => s.part === "storey" && s.castle === 0)!;
  const top = board.y + board.hy;
  for (const budget of [3, 1000]) {
    const c = new CastleSim(R, layout, { ...DEFAULT_SIM, ground: true, settle: true, budget });
    const ids = spares(9);
    const on = ids.slice(0, 6);
    on.forEach((id, k) => freezeAt(c, id, board.x - 1 + (k % 3), top + 0.4, board.z - 0.5 + Math.floor(k / 3)));
    for (const id of ids.slice(6)) c.knockLoose(id, 0, 0, 0);
    if (budget === 3) assert.ok(c.room() <= 0, "the room is used up");
    c.dust(board.id);
    for (const id of on) {
      assert.equal(c.frozen[id], 0, "it is no longer fixed in the air");
      assert.equal(c.shattered[id], budget === 3 ? 1 : 0, budget === 3 ? "dust: no room" : "woken: there is room");
    }
    c.free();
  }
});
