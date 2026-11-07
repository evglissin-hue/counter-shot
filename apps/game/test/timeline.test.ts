import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, GAME_LAYOUT } from "@keepfall/content";
import { PROJECTILE_STRIDE, ProjectileKind, STONE_STRIDE, type FrameData } from "@keepfall/sim";
import { Timeline } from "../src/timeline";

const layout = buildLayout(1, GAME_LAYOUT);
const V = 80; // m/s along z

/** A frame at `tick` with one shell flying at V along z and one stone sliding at 3 m/s along x. */
function frame(tick: number): FrameData {
  const t = tick / 60;
  const projectiles = new Float32Array(PROJECTILE_STRIDE);
  projectiles.set([ProjectileKind.Shell, 7, 0, 20, -140 + V * t, 0.28, 0, 0, V]);
  const s = layout.stones[100];
  const stones = new Float32Array(STONE_STRIDE);
  stones.set([s.id, s.x + 3 * t, s.y, s.z, s.q[0], s.q[1], s.q[2], s.q[3]]);
  const empty = new Float32Array(0);
  return {
    tick, stones, stoneCount: 1, projectiles, projectileCount: 1, chains: empty, chainCount: 0, minions: empty, minionCount: 0,
    parts: empty, partCount: 0, events: empty, eventCount: 0, terrain: [], windX: 0, windZ: 0,
  };
}

test("shells glide at an even pace although frames arrive unevenly", () => {
  const tl = new Timeline(layout);
  // The worker: one step per 16.7 ms on average, but frames arrive late, early or two at a time.
  const arrivals: Array<[number, number]> = []; // [ms, tick]
  let ms = 0;
  for (let tick = 1; tick <= 240; tick++) {
    ms += 1000 / 60;
    const jitter = (tick % 7 === 0 ? 9 : 0) + (tick % 11 === 0 ? -6 : 0) + ((tick * 37) % 5);
    arrivals.push([ms + jitter, tick]);
  }
  arrivals.sort((p, q) => p[0] - q[0]);
  // The screen: 120 Hz.
  const dt = 1 / 120;
  let k = 0, lastZ: number | null = null;
  const steps: number[] = [];
  for (let now = 0; now < 4000; now += dt * 1000) {
    while (k < arrivals.length && arrivals[k][0] <= now) tl.push(frame(arrivals[k++][1]));
    tl.advance(dt, 1);
    tl.interpolate();
    const i = tl.find(7);
    if (i < 0) continue;
    const z = tl.proj[i * PROJECTILE_STRIDE + 4];
    if (lastZ !== null && now > 500) steps.push(z - lastZ);
    lastZ = z;
  }
  const expected = V * dt;
  const bad = steps.filter((d) => d < expected * 0.6 || d > expected * 1.4);
  assert.ok(steps.length > 300, `frames drawn: ${steps.length}`);
  assert.ok(Math.min(...steps) >= 0, "never moves backwards");
  assert.ok(bad.length / steps.length < 0.02, `uneven draws: ${bad.length} of ${steps.length} (min ${Math.min(...steps).toFixed(3)}, max ${Math.max(...steps).toFixed(3)}, expected ${expected.toFixed(3)})`);
});

test("loose stones are drawn between their frame positions", () => {
  const tl = new Timeline(layout);
  for (let tick = 1; tick <= 10; tick++) tl.push(frame(tick));
  tl.advance(0, 1); // the clock jumps to two ticks behind the newest frame
  tl.interpolate();
  tl.advance(1 / 120, 1); // half a tick on
  tl.interpolate();
  assert.equal(tl.stoneCount, 1);
  const s = layout.stones[100];
  const x = tl.stones[1];
  assert.ok(x > s.x + 3 * (7 / 60) && x < s.x + 3 * (10 / 60), `x ${x}`);
});

test("a reset forgets old frames and the clock follows a new run", () => {
  const tl = new Timeline(layout);
  for (let tick = 1; tick <= 100; tick++) tl.push(frame(tick));
  tl.advance(0, 1);
  tl.reset();
  for (let tick = 1; tick <= 5; tick++) tl.push(frame(tick));
  tl.advance(1 / 60, 1);
  assert.ok(tl.tick <= 5, `tick ${tl.tick}`);
});

/** Draws the shell at `hz` while frames arrive per `arrivals`; returns the per-draw moves after warm-up. */
function drawMoves(arrivals: Array<[number, number]>, hz: number, speed: number, until: number): number[] {
  const tl = new Timeline(layout);
  const dt = 1 / hz;
  let k = 0, lastZ: number | null = null;
  const moves: number[] = [];
  for (let now = 0; now < until; now += dt * 1000) {
    while (k < arrivals.length && arrivals[k][0] <= now) tl.push(frame(arrivals[k++][1]));
    tl.advance(dt, speed);
    tl.interpolate();
    const i = tl.find(7);
    if (i < 0) continue;
    const z = tl.proj[i * PROJECTILE_STRIDE + 4];
    if (lastZ !== null && now > 600) moves.push(z - lastZ);
    lastZ = z;
  }
  return moves;
}

test("slow motion is smooth, not stepped", () => {
  // At 0.3 speed the worker steps about every 55 ms.
  const arrivals: Array<[number, number]> = [];
  for (let tick = 1; tick <= 120; tick++) arrivals.push([(tick * 1000) / 60 / 0.3 + ((tick * 13) % 4), tick]);
  const moves = drawMoves(arrivals, 60, 0.3, 6000);
  const expected = (V * 0.3) / 60;
  const still = moves.filter((d) => d < expected * 0.5).length;
  assert.ok(Math.min(...moves) >= 0, "never moves backwards");
  assert.ok(still / moves.length < 0.03, `frames where the shell barely moved: ${still} of ${moves.length}`);
});

test("a stalled worker slows the shell for a moment instead of making it jump", () => {
  // Normal frames, then nothing for 90 ms, then the backlog at once, then normal again.
  const arrivals: Array<[number, number]> = [];
  for (let tick = 1; tick <= 200; tick++) {
    let ms = (tick * 1000) / 60;
    if (tick >= 60 && tick <= 65) ms = (65 * 1000) / 60 + 2;
    arrivals.push([ms, tick]);
  }
  const moves = drawMoves(arrivals, 120, 1, 3300);
  const expected = V / 120;
  assert.ok(Math.min(...moves) >= 0, "never moves backwards");
  assert.ok(Math.max(...moves) < expected * 3, `largest single move ${Math.max(...moves).toFixed(2)} m, normal ${expected.toFixed(2)} m`);
});
