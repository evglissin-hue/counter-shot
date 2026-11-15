// Army diag (page): runs parse-entry.ts (the order line's parser on a table of phrases, both seats) and prints what each gives.
// Usage: node tools/army-diag/page/parse-table.mjs [--all]
import { build } from "rolldown";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
const here = fileURLToPath(new URL(".", import.meta.url));
const out = fileURLToPath(new URL("../../../node_modules/.army-diag/parse.mjs", import.meta.url));
mkdirSync(fileURLToPath(new URL("../../../node_modules/.army-diag/", import.meta.url)), { recursive: true });
await build({ input: `${here}parse-entry.ts`, platform: "node", logLevel: "warn", output: { file: out, format: "esm" } });
const r = spawnSync(process.execPath, [out], { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const rows = JSON.parse(r.stdout);
// The parser speaks the match's frame (castle 1's left is "left"); for team 0 the player's left is the match's right.
const flip = { L: "R", R: "L", C: "C" };
const expect = (meant, team) => meant.split("+").map((p) => (p[0] === "r" && team === 0 ? `r${flip[p[1]]}` : p)).join("+");
let bad = 0;
for (const x of rows) {
  const want = expect(x.meant, x.team);
  const good = x.ok && x.got === want;
  if (!good) bad++;
  if (!good || process.argv.includes("--all")) console.log(`${good ? "ok  " : "MISS"} team ${x.team} ${JSON.stringify(x.phrase).padEnd(28)} want ${want.padEnd(6)} got ${(x.ok ? x.got : "-").padEnd(6)} | ${x.say}`);
}
console.log(`${bad} of ${rows.length} phrases not understood as meant`);
