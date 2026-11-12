// The page events Down and Fell (track S1): reported by the world, never part of its state.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, sectionOf } from "@keepfall/content";
import { Cause, EVENT_STRIDE, EventKind, SESSION_SCRIPT, SESSION_TICKS, SandboxSim, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;

test("the scripted session reports knockdowns (with cause and speed) and stones coming loose (by castle and section)", () => {
  const layout = buildLayout(1, GAME_LAYOUT);
  const sim = new SandboxSim(R, layout, { seed: 7, minions: 12 });
  for (const [t, input] of SESSION_SCRIPT) sim.queue(t, input);
  const secs = sectionOf(layout);
  const downs: number[][] = [];
  const fells: number[][] = [];
  const seen = new Set<number>();
  let fellStones = 0;
  for (let i = 0; i < SESSION_TICKS; i++) {
    sim.step();
    const f = sim.collect();
    for (let k = 0; k < f.eventCount; k++) {
      const o = k * EVENT_STRIDE;
      const e = Array.from(f.events.subarray(o, o + EVENT_STRIDE));
      if (e[0] === EventKind.Down) {
        downs.push(e);
        assert.ok(!seen.has(e[1]), "a man falls once");
        seen.add(e[1]);
      } else if (e[0] === EventKind.Fell) {
        fells.push(e);
        fellStones += e[3];
      }
    }
  }
  const counts = sim.minionCounts();
  assert.ok(downs.length >= 3 && downs.length <= counts.down, `${downs.length} knockdowns for ${counts.down} bodies`);
  for (const d of downs) {
    assert.ok(d[2] >= Cause.Unknown && d[2] <= Cause.Musket, "a known cause");
    assert.ok(d[4] >= 0 && Number.isFinite(d[4]), "a speed");
  }
  assert.ok(fells.length > 0, "stones came loose");
  const top = Math.max(...secs);
  for (const e of fells) {
    assert.ok(e[1] === 0 || e[1] === 1, "a castle");
    assert.ok(e[2] >= -1 && e[2] <= top, "a section");
    assert.ok(e[3] > 0, "a nonzero count");
  }
  assert.ok(fellStones > 20, `${fellStones} stones loose in all`);
  sim.free();
});
