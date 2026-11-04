// Physics runs here, off the main thread: a live sandbox the page renders,
// and the benchmark suite on request.

import type { CastleLayout } from "@keepfall/content";
import { buildLayout } from "@keepfall/content";
import { runRubble, runSiege, type RubbleResult, type SiegeResult } from "./bench";
import { CastleSim, type Rapier } from "@keepfall/sim";
import type { FromWorker, ToWorker } from "./protocol";

const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

let det: Rapier | null = null;
let layout: CastleLayout | null = null;
let sim: CastleSim | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
let acc = 0;
let stepEma = 0;
let lastToppled = false;
const DT = 1000 / 60;
const bodyBuf = new Float32Array(9000 * 8);
const ballBuf = new Float32Array(16 * 4);

async function loadDeterministic(): Promise<Rapier> {
  if (det) return det;
  const m = await import("@dimforge/rapier3d-deterministic-compat");
  const R = (m.default ?? m) as unknown as Rapier;
  await R.init();
  det = R;
  return R;
}

async function loadSimd(): Promise<Rapier | null> {
  try {
    const m = await import("@dimforge/rapier3d-simd-compat");
    const R = (m.default ?? m) as unknown as Rapier;
    await R.init();
    return R;
  } catch {
    return null; // no WebAssembly SIMD on this browser
  }
}

function buildSim() {
  if (!det || !layout) return;
  sim?.free();
  const t0 = performance.now();
  sim = new CastleSim(det, layout);
  sim.world.step(); // build the broad phase now rather than on the first shot
  lastToppled = false;
  post({ t: "ready", stones: layout.stones.length, setupMs: Math.round(performance.now() - t0) });
}

function tick() {
  if (!sim) return;
  const now = performance.now();
  acc += now - last;
  last = now;
  if (acc > 250) acc = DT; // the tab was asleep: do not try to catch up
  let steps = 0;
  const impacts: number[] = [];
  while (acc >= DT && steps < 3) {
    const t0 = performance.now();
    sim.step();
    const ms = performance.now() - t0;
    stepEma = stepEma === 0 ? ms : stepEma * 0.9 + ms * 0.1;
    for (const im of sim.impacts) impacts.push(im.x, im.y, im.z, im.strength);
    acc -= DT;
    steps++;
  }
  if (!steps) return;
  const n = sim.collectMoving(bodyBuf);
  const nb = sim.collectBalls(ballBuf);
  const bodies = bodyBuf.slice(0, n * 8);
  const balls = ballBuf.slice(0, nb * 4);
  const imp = new Float32Array(impacts);
  post(
    {
      t: "frame",
      bodies,
      count: n,
      balls,
      ballCount: nb,
      impacts: imp,
      stepMs: Math.round(stepEma * 100) / 100,
      loose: sim.dynList.length,
      awake: sim.awakeCount(),
    },
    [bodies.buffer, balls.buffer, imp.buffer],
  );
  if (sim.toppled[0] && !lastToppled) {
    lastToppled = true;
    post({ t: "toppled", castle: 0 });
  }
}

function startLoop() {
  stopLoop();
  last = performance.now();
  acc = 0;
  timer = setInterval(tick, 4);
}

function stopLoop() {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

async function bench() {
  stopLoop();
  sim?.free();
  sim = null;
  const progress = (label: string, fraction: number) => post({ t: "progress", label, fraction });
  const R = await loadDeterministic();
  const L = layout ?? buildLayout(1);
  const siegeDet: SiegeResult = runSiege(R, "deterministic", L, progress);
  const rubbleDet: RubbleResult = runRubble(R, "deterministic", progress);
  progress("Loading the fast build", 0);
  const simd = await loadSimd();
  let siegeSimd: SiegeResult | null = null;
  let rubbleSimd: RubbleResult | null = null;
  if (simd) {
    siegeSimd = runSiege(simd, "simd", L, progress);
    rubbleSimd = runRubble(simd, "simd", progress);
  }
  post({ t: "bench", siegeDet, rubbleDet, siegeSimd, rubbleSimd });
  buildSim();
  startLoop();
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.t) {
      case "init": {
        await loadDeterministic();
        layout = buildLayout(1);
        buildSim();
        startLoop();
        break;
      }
      case "fire": {
        if (sim) sim.fire(msg.x, msg.y, msg.z, msg.vx, msg.vy, msg.vz);
        break;
      }
      case "reset": {
        buildSim();
        startLoop();
        break;
      }
      case "pause":
        stopLoop();
        break;
      case "resume":
        startLoop();
        break;
      case "bench":
        await bench();
        break;
    }
  } catch (err) {
    post({ t: "error", message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};

export {};
void CastleSim;
