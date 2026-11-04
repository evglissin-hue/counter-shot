// The sandbox simulation runs here at a fixed 60 Hz, off the main thread.
// The page sends inputs; the worker tags each with the next tick, steps the
// sim and posts what changed.

import { buildLayout } from "@keepfall/content";
import { RULES_VERSION, SandboxSim, type Rapier } from "@keepfall/sim";
import type { FromWorker, ToWorker } from "./protocol";

const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
const DT = 1000 / 60;

let R: Rapier | null = null;
let sim: SandboxSim | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
let acc = 0;
let speed = 1;
let paused = false;
let stepEma = 0;

async function load(): Promise<Rapier> {
  if (R) return R;
  const m = await import("@dimforge/rapier3d-deterministic-compat");
  const r = (m.default ?? m) as unknown as Rapier;
  await r.init();
  R = r;
  return r;
}

function build(seed: number, minions: number) {
  if (!R) return;
  sim?.free();
  const t0 = performance.now();
  sim = new SandboxSim(R, buildLayout(1, { mirrorWedges: true }), { seed, minions });
  post({ t: "ready", stones: sim.castle.layout.stones.length, setupMs: Math.round(performance.now() - t0), terrain: sim.terrain.fullPatch(), rulesVersion: RULES_VERSION });
}

function tick() {
  if (!sim || paused) return;
  const now = performance.now();
  acc += (now - last) * speed;
  last = now;
  if (acc > 250) acc = DT; // the tab slept: do not catch up
  let steps = 0;
  while (acc >= DT && steps < 3) {
    const t0 = performance.now();
    sim.step();
    const ms = performance.now() - t0;
    stepEma = stepEma === 0 ? ms : stepEma * 0.9 + ms * 0.1;
    acc -= DT;
    steps++;
  }
  if (!steps) return;
  const frame = sim.collect();
  const counts = sim.minionCounts();
  const transfer: Transferable[] = [frame.stones.buffer, frame.projectiles.buffer, frame.chains.buffer, frame.minions.buffer, frame.parts.buffer, frame.events.buffer];
  for (const p of frame.terrain) transfer.push(p.h.buffer);
  post({ t: "frame", frame, reload: sim.reload.slice(), stepMs: Math.round(stepEma * 100) / 100, down: counts.down, standing: counts.standing, awake: sim.castle.awakeCount() }, transfer as Transferable[]);
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
    }
  } catch (err) {
    post({ t: "error", message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};

export {};
