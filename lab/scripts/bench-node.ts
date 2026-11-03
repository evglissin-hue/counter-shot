// Runs the physics benchmarks in Node and prints the results, including the
// reference determinism hash the lab page compares devices against.
// Usage: npx rolldown scripts/bench-node.ts --format esm --platform browser -o /tmp/bench.mjs && node /tmp/bench.mjs
import RD from "@dimforge/rapier3d-deterministic-compat";
import RS from "@dimforge/rapier3d-simd-compat";
import { buildLayout } from "../src/core/castle";
import { runRubble, runSiege } from "../src/physics/bench";
import type { Rapier } from "../src/physics/sim";

await RD.init();
await RS.init();
const layout = buildLayout(1);
const quiet = () => {};
const det = runSiege(RD as unknown as Rapier, "deterministic", layout, quiet);
console.log(JSON.stringify(det));
const again = runSiege(RD as unknown as Rapier, "deterministic", layout, quiet);
console.log("repeat gives the same hash:", det.hash.state === again.hash.state && det.hash.snapshot === again.hash.snapshot);
console.log(JSON.stringify(runSiege(RS as unknown as Rapier, "simd", layout, quiet)));
console.log(JSON.stringify(runRubble(RD as unknown as Rapier, "deterministic", quiet, 4000)));
console.log(JSON.stringify(runRubble(RS as unknown as Rapier, "simd", quiet, 4000)));
