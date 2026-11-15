// 3.5 machines, the masons' side: the crane's height limit, the crane first, and the bell waiting for its tower.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, CRANE, GAME_LAYOUT, MATCH_EMPLACEMENTS, ORGAN_KINDS, repairSections } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, OrganWait, SandboxSim, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const world = () => new SandboxSim(R, layout, { seed: 7, minions: 0, army: true, emplacements: MATCH_EMPLACEMENTS });
const CRANE_I = ORGAN_KINDS.indexOf("crane");
const BELL_I = ORGAN_KINDS.indexOf("bell");
const foot = (id: number) => layout.stones[id].y - layout.stones[id].hy;

/** Turn a piece to dust (the sim's own shatter, private to the castle). */
function dust(sim: SandboxSim, ids: number[]) {
  for (const id of ids) (sim.castle as unknown as { shatter(id: number): void }).shatter(id);
}

function purse(allow: (kind: string) => boolean) {
  return { allowed: (_t: number, k: string) => allow(k), pay: () => true };
}

/** Run n ticks, returning the pieces laid in order. */
function run(sim: SandboxSim, n: number, laid: number[] = []): number[] {
  for (let i = 0; i < n; i++) {
    sim.step();
    if (i % 3 !== 2) continue;
    const f = sim.collect();
    for (let k = 0; k < f.eventCount; k++) if (f.events[k * EVENT_STRIDE] === EventKind.Laid) laid.push(f.events[k * EVENT_STRIDE + 1] | 0);
  }
  return laid;
}

/** A back wall piece of castle 0 (the enemy's) at a foot in [lo, hi), with every piece below it standing. */
function backWallPiece(lo: number, hi: number): number {
  const back = repairSections(layout).find((s) => s.castle === 0 && s.name === "the back wall")!;
  for (const id of back.stones) {
    const s = layout.stones[id];
    if (s.part === "wall" && foot(id) >= lo && foot(id) < hi && Math.abs(s.x) < 4) return id;
  }
  throw new Error("no such wall piece");
}

const craneKey = layout.organs[CRANE_I].key;
const craneIds = Array.from({ length: layout.organs[CRANE_I].count }, (_, k) => layout.organs[CRANE_I].first + k);

test("with the crane down masons lay only low work; with Works on they rebuild the crane first, and then the high piece goes back", () => {
  // Works off: the crane stays down, the low piece goes back, the high one does not.
  {
    const sim = world();
    sim.works!.policy = purse((k) => k !== "works");
    sim.works!.spawnCrew(0);
    const low = backWallPiece(0, CRANE.low - 1.2);
    const high = backWallPiece(CRANE.low + 1, 12);
    dust(sim, [craneKey, low, high]);
    for (let i = 0; i < 30; i++) sim.step();
    assert.ok(!sim.organs!.working(0, CRANE_I), "the crane is down");
    assert.ok(foot(low) < CRANE.low && foot(high) >= CRANE.low);
    run(sim, 40 * 60);
    assert.ok(!sim.castle.dynamic[low], "the piece below 4 m is back");
    assert.ok(sim.castle.dynamic[high], "the piece above 4 m is not");
    assert.ok(sim.castle.dynamic[craneKey], "Works is off: the crane stays down");
    assert.equal(sim.organs!.wait[CRANE_I], OrganWait.Off, "and it says why");
    sim.free();
  }
  // Works on: the crane first, then the high piece.
  {
    const sim = world();
    sim.works!.policy = purse(() => true);
    sim.works!.spawnCrew(0);
    const high = backWallPiece(CRANE.low + 1, 12);
    dust(sim, [craneKey, high]);
    const laid = run(sim, 60 * 60);
    assert.ok(laid.includes(craneKey) && laid.includes(high), `laid ${laid.join(",")}`);
    assert.ok(laid.indexOf(craneKey) < laid.indexOf(high), "the crane went back before the wall");
    assert.ok(sim.organs!.working(0, CRANE_I), "the crane works again");
    assert.ok(!sim.castle.dynamic[high], "and the high piece is back");
    assert.equal(sim.organs!.wait[CRANE_I], OrganWait.None);
    sim.free();
  }
});

test("the crane never needs itself: its high pieces are laid with the crane down", () => {
  const sim = world();
  sim.works!.policy = purse(() => true);
  sim.works!.spawnCrew(0);
  dust(sim, craneIds);
  assert.ok(craneIds.some((id) => foot(id) >= CRANE.low), "the crane has high pieces (the jib)");
  run(sim, 120 * 60);
  assert.ok(craneIds.every((id) => !sim.castle.dynamic[id]), "every piece of the crane is back");
  assert.ok(sim.organs!.working(0, CRANE_I));
  sim.free();
});

test("the bell waits for its tower: Footing while the tower top under it is down, then it goes back up", () => {
  const sim = world();
  sim.works!.policy = purse(() => true);
  sim.works!.spawnCrew(0);
  const o = layout.organs[BELL_I];
  const bell = Array.from({ length: o.count }, (_, k) => o.first + k);
  const under = new Set<number>();
  for (const id of bell) for (const b of layout.below[id]) if (layout.stones[b].part !== "organ") under.add(b);
  assert.ok(under.size > 0, "something carries the bell");
  dust(sim, [...bell, ...under]);
  for (let i = 0; i < 20; i++) sim.step();
  assert.ok(!sim.organs!.working(0, BELL_I), "the bell is down");
  let sawFooting = false, topWasDown = false;
  for (let t = 0; t < 180 * 60 && !sim.organs!.working(0, BELL_I); t++) {
    sim.step();
    const topDown = [...under].some((id) => sim.castle.dynamic[id]);
    if (topDown && sim.organs!.wait[BELL_I] === OrganWait.Footing) sawFooting = true;
    if (topDown) topWasDown = true;
  }
  assert.ok(topWasDown && sawFooting, "while the tower top was down the bell waited for it (Footing)");
  assert.ok(sim.organs!.working(0, BELL_I), "once the tower top was rebuilt the bell went back up and works");
  sim.free();
});
