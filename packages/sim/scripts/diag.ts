// Where does each weapon land? Fires single shots and prints first contacts.
// npx rolldown packages/sim/scripts/diag.ts --format esm --platform node -o node_modules/.scratch/diag.mjs && node node_modules/.scratch/diag.mjs
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, SandboxSim, Spin, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, { mirrorWedges: true });
const cases: Array<[string, number, number, number, Spin]> = [
  ["long gun", 0, 0.0, 0, Spin.None], ["long gun", 0, 0.03, 0, Spin.None], ["long gun", 0, 0.06, 0, Spin.None],
  ["long gun left", 0, 0.03, 0, Spin.Left], ["long gun back", 0, 0.03, 0, Spin.Back],
  ["mortar", 1, 0.8, 0, Spin.None], ["mortar", 1, 1.0, 0, Spin.None], ["mortar", 1, 1.2, 0, Spin.None],
  ["chain", 2, 0.03, 0, Spin.None], ["chain", 2, 0.07, 0, Spin.None],
  ["swivel", 3, -0.05, 0, Spin.None], ["swivel", 3, 0.0, 0, Spin.None],
];
for (const [name, e, pitch, fuse, spin] of cases) {
  const sim = new SandboxSim(R, layout, { seed: 1, minions: 0 });
  sim.wind.x = 0; sim.wind.z = 0;
  sim.queue(0, { kind: "fire", emplacement: e, yaw: sim.emplacements[e].baseYaw, pitch, charge: 1, fuse, spin });
  let out = "";
  for (let i = 0; i < 900 && !out; i++) {
    sim.step();
    const f = sim.collect();
    for (let k = 0; k < f.eventCount; k++) {
      const o = k * EVENT_STRIDE;
      if (f.events[o] === EventKind.Landed) out = `t=${(i / 60).toFixed(2)}s at (${f.events[o + 2].toFixed(1)}, ${f.events[o + 3].toFixed(1)}, ${f.events[o + 4].toFixed(1)})`;
    }
  }
  console.log(name.padEnd(14), `pitch ${pitch}`, out || "no landing", "loose", sim.castle.dynList.length);
  sim.free();
}
