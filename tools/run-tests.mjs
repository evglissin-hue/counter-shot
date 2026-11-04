// Bundles every packages/*/test/*.test.ts (and apps) with rolldown and runs
// the bundles with Node's test runner. Bundling resolves workspace imports and
// TypeScript the same way the apps do. Pass a substring to run a subset.

import { readdirSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "rolldown";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const filter = process.argv[2] ?? "";
const out = join(root, "node_modules", ".keepfall-tests");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const tests = [];
for (const group of ["packages", "apps"]) {
  const dir = join(root, group);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const t = join(dir, name, "test");
    if (!existsSync(t)) continue;
    for (const f of readdirSync(t)) if (f.endsWith(".test.ts") && `${name}/${f}`.includes(filter)) tests.push({ file: join(t, f), id: `${name}-${basename(f, ".ts")}` });
  }
}

const bundles = [];
for (const t of tests) {
  const file = join(out, `${t.id}.mjs`);
  await build({ input: t.file, platform: "node", logLevel: "warn", output: { file, format: "esm" } });
  bundles.push(file);
}
if (!bundles.length) {
  console.log("No tests found.");
  process.exit(0);
}
const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...bundles], { stdio: "inherit" });
process.exit(r.status ?? 1);
