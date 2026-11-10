// The observatory's entry: plays one match and gives its JSON line.
// As a worker thread (workerData.setup, started by tools/observatory.mjs) it
// posts the line to its parent and exits. From the command line it prints it:
// npx rolldown packages/ai/scripts/observe.ts --format esm --platform node -o node_modules/.scratch/observe.mjs && node node_modules/.scratch/observe.mjs [seed=11] [sides=knight,knight] [secs=300] [variant=name] [tuning='{"WEAPONS.mortar.reload":600}'] [plans=stock,stock] [tweak0='{"marks":0,"salvo":false}'] [tweak1=...]
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import RD from "@dimforge/rapier3d-deterministic-compat";
import type { Rapier } from "@keepfall/sim";
import { MATCH } from "@keepfall/content";
import { observeMatch } from "./observe-match";
import type { MatchSetup, Side } from "./observe-line";

await RD.init();
const R = RD as unknown as Rapier;

if (!isMainThread && workerData?.setup) {
  const line = observeMatch(R, workerData.setup as MatchSetup);
  parentPort!.postMessage(line);
  process.exit(0);
} else {
  const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.slice(k.length + 1) ?? d;
  const sides = arg("sides", "knight,knight").split(",") as [Side, Side];
  const plans = arg("plans", "stock,stock").split(",") as [string, string];
  const seed = Number(arg("seed", "11"));
  const variant = arg("variant", "base");
  const tweaks = [arg("tweak0", ""), arg("tweak1", "")];
  const levels = tweaks.map((t) => (t ? JSON.parse(t) : null)) as [Record<string, unknown> | null, Record<string, unknown> | null];
  const setup: MatchSetup = {
    id: `${sides[0]}-${sides[1]}-s${seed}-${variant}${tweaks[0] ? `-t0=${tweaks[0]}` : ""}${tweaks[1] ? `-t1=${tweaks[1]}` : ""}`,
    ...(levels[0] || levels[1] ? { levels } : {}),
    seed,
    sides,
    plans,
    variant,
    tuning: JSON.parse(arg("tuning", "{}")),
    secs: Number(arg("secs", String(MATCH.timeLimitTick / 60))),
  };
  console.log(JSON.stringify(observeMatch(R, setup)));
}
