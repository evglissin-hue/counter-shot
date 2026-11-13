// Static look at the nav grid where waves walk: the walkable width of each bridge deck, the gates, and the muster.
// npx rolldown tools/army-diag/movement/navcheck.ts --format esm --platform node -o node_modules/.scratch/diag-move-nav.mjs && node node_modules/.scratch/diag-move-nav.mjs
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BRIDGES, buildLayout, GAME_LAYOUT, MATCH_EMPLACEMENTS } from "@keepfall/content";
import { navCell, NAV_GRID, SandboxSim, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const w = new SandboxSim(R, buildLayout(1, GAME_LAYOUT), { seed: 1, minions: 0, army: true, powder: false, emplacements: MATCH_EMPLACEMENTS });
const K = "GRWSB#"; // Ground Raised Water Steep Blocked Rubble
const row = (z: number, x0: number, x1: number) => {
  let s = "";
  for (let x = x0; x <= x1; x++) {
    const c = navCell(x + 0.5, z);
    s += K[w.nav.kind[c]];
  }
  return s;
};
for (const b of BRIDGES) {
  console.log(`${b.name} bridge x ${b.x} z ${b.z.toFixed(1)} width ${b.width} length ${b.length.toFixed(1)}; columns x ${b.x - 6}..${b.x + 6}`);
  for (let z = Math.floor(b.z - b.length / 2 - 6); z <= Math.ceil(b.z + b.length / 2 + 6); z++) {
    const fl: string[] = [];
    for (let x = b.x - 2; x <= b.x + 1; x++) fl.push(w.nav.floor[navCell(x + 0.5, z + 0.5)].toFixed(2));
    console.log(`  z ${String(z).padStart(5)} ${row(z + 0.5, b.x - 6, b.x + 6)}  floors ${fl.join(" ")}`);
  }
}
for (const [name, z0, z1] of [["castle 0 gate", -22, -8], ["castle 1 gate", -142, -128]] as const) {
  console.log(name);
  for (let z = z0; z <= z1; z++) console.log(`  z ${String(z).padStart(5)} ${row(z + 0.5, -12, 12)}`);
}
console.log(`flow region ${JSON.stringify(NAV_GRID)}`);
w.free();
