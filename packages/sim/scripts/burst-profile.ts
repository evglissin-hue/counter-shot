// Where does the time go in and after a burst? Wraps CastleSim internals with timers.
// npx rolldown packages/sim/scripts/burst-profile.ts --format esm --platform node -o node_modules/.scratch/burst-profile.mjs && node node_modules/.scratch/burst-profile.mjs
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout } from "@keepfall/content";
import { CastleSim, SandboxSim, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, { mirrorWedges: true });
const P = CastleSim.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
const totals: Record<string, { ms: number; n: number }> = {};
for (const name of ["supportCheck", "loosen", "thaw", "throwPiece", "freezeResting", "shatter"]) {
  const orig = P[name];
  P[name] = function (this: unknown, ...a: unknown[]) {
    const t0 = performance.now();
    const r = orig.apply(this, a);
    const t = (totals[name] ??= { ms: 0, n: 0 });
    t.ms += performance.now() - t0;
    t.n++;
    return r;
  };
}
const sim = new SandboxSim(R, layout, { seed: 1, minions: 0 });
for (let i = 0; i < 30; i++) sim.step();
const world = sim.castle.world;
const origStep = world.step.bind(world);
let worldMs = 0;
(world as unknown as { step: (q?: unknown) => void }).step = (q?: unknown) => {
  const t0 = performance.now();
  origStep(q as never);
  worldMs += performance.now() - t0;
};
for (const k of Object.keys(totals)) delete totals[k];
const t0 = performance.now();
sim.explode(0, 19.3, -0.6);
console.log("burst call", (performance.now() - t0).toFixed(1), "ms", JSON.stringify(totals, (k, v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v)));
for (const k of Object.keys(totals)) delete totals[k];
for (let i = 0; i < 4; i++) {
  worldMs = 0;
  const s0 = performance.now();
  sim.step();
  const all = performance.now() - s0;
  console.log(`step ${i}: total ${all.toFixed(1)} ms, rapier ${worldMs.toFixed(1)} ms, rest`, JSON.stringify(totals, (k, v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v)), "dynamic", sim.castle.dynList.length, "awake", sim.castle.awakeCount());
  for (const k of Object.keys(totals)) delete totals[k];
}
sim.free();
