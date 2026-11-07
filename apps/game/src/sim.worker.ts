// The sandbox simulation runs here at a fixed 60 Hz, off the main thread.
// The page sends inputs; the worker tags each with the next tick, steps the
// sim and posts what changed.

import { buildLayout, GAME_LAYOUT, type CastleLayout } from "@keepfall/content";
import { RULES_VERSION, SandboxSim, type Rapier } from "@keepfall/sim";
import type { FromWorker, ToWorker } from "./protocol";

const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
const DT = 1000 / 60;

let R: Rapier | null = null;
let sim: SandboxSim | null = null;
let layout: CastleLayout | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
let acc = 0;
let speed = 1;
let paused = false;
let stepEma = 0;
/** The slowest step in the current and the previous second, for the HUD. */
let peakNow = 0, peakLast = 0, peakTicks = 0;
/** Test clock: the page advances the sim itself, frame by frame. */
let manual = false;

async function load(): Promise<Rapier> {
  if (R) return R;
  const m = await import("@dimforge/rapier3d-deterministic-compat");
  const r = (m.default ?? m) as unknown as Rapier;
  await r.init();
  R = r;
  return r;
}

/**
 * A throwaway sim bursts two shells and steps a little at load, so the
 * JavaScript and WebAssembly behind a burst are compiled before the player's
 * first one (that first burst used to stall the frames for about 100 ms).
 * It never touches the real sim.
 */
function rehearse() {
  if (!R || !layout) return;
  const r = new SandboxSim(R, layout, { seed: 1, minions: 2 });
  r.explode(0, 19.3, -0.6);
  r.explode(15, 11.6, -15);
  for (let i = 0; i < 45; i++) r.step();
  r.free();
}

function build(seed: number, minions: number) {
  if (!R) return;
  sim?.free();
  const t0 = performance.now();
  layout ??= buildLayout(1, GAME_LAYOUT);
  sim = new SandboxSim(R, layout, { seed, minions });
  post({ t: "ready", stones: sim.castle.layout.stones.length, setupMs: Math.round(performance.now() - t0), terrain: sim.terrain.fullPatch(), rulesVersion: RULES_VERSION });
}

function tick(advanceMs = -1) {
  if (!sim || paused) return;
  if (manual) {
    if (advanceMs < 0) return;
    acc += advanceMs * speed;
  } else {
    const now = performance.now();
    acc += (now - last) * speed;
    last = now;
    // After a slow step (a big collapse), fall a little behind real time rather
    // than stall and then rush through the backlog: at most two steps per tick.
    if (acc > DT * 2) acc = DT * 2;
  }
  let steps = 0;
  while (acc >= DT && steps < (manual ? 12 : 2)) {
    const t0 = performance.now();
    sim.step();
    const ms = performance.now() - t0;
    stepEma = stepEma === 0 ? ms : stepEma * 0.9 + ms * 0.1;
    if (ms > peakNow) peakNow = ms;
    if (++peakTicks >= 60) {
      peakLast = peakNow;
      peakNow = 0;
      peakTicks = 0;
    }
    acc -= DT;
    steps++;
  }
  if (!steps) return;
  const frame = sim.collect();
  const counts = sim.minionCounts();
  const transfer: Transferable[] = [frame.stones.buffer, frame.projectiles.buffer, frame.chains.buffer, frame.minions.buffer, frame.parts.buffer, frame.events.buffer];
  for (const p of frame.terrain) transfer.push(p.h.buffer);
  post({ t: "frame", frame, reload: sim.reload.slice(), stepMs: Math.round(stepEma * 100) / 100, stepPeak: Math.round(Math.max(peakNow, peakLast) * 10) / 10, down: counts.down, standing: counts.standing, awake: sim.castle.awakeCount() }, transfer as Transferable[]);
}

function start() {
  if (timer !== null) clearInterval(timer);
  last = performance.now();
  acc = 0;
  timer = setInterval(tick, 4);
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.t) {
      case "init":
        await load();
        layout ??= buildLayout(1, GAME_LAYOUT);
        rehearse();
        build(msg.seed, msg.minions);
        start();
        break;
      case "reset":
        build(msg.seed, msg.minions);
        start();
        break;
      case "input":
        if (sim) sim.queue(sim.tick, msg.input);
        break;
      case "speed":
        speed = msg.factor;
        break;
      case "pause":
        paused = msg.paused;
        last = performance.now();
        break;
      case "manual":
        manual = true;
        acc = 0;
        break;
      case "advance":
        tick(msg.seconds * 1000);
        break;
    }
  } catch (err) {
    post({ t: "error", message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};

export {};
