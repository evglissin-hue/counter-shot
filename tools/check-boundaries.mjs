// Package boundary and determinism rules. Run by `npm run check`.
//
// 1. A workspace imports another workspace only by name, never by a relative
//    path that leaves its own folder.
// 2. Every bare import is declared in that workspace's package.json.
// 3. Packages under packages/ are DOM-free.
// 4. core, content, sim and rules avoid maths and clocks that differ between engines.
// 5. Direction: core <- content <- sim <- rules <- apps and lab. Nothing imports an app.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { builtinModules } from "node:module";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const workspaces = [];
for (const group of ["packages", "apps"]) {
  const dir = join(root, group);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    if (existsSync(join(dir, name, "package.json"))) workspaces.push({ dir: join(dir, name), group });
  }
}
workspaces.push({ dir: join(root, "lab"), group: "lab" });

const RANK = { "@keepfall/core": 0, "@keepfall/content": 1, "@keepfall/sim": 2, "@keepfall/rules": 3 };
const DETERMINISTIC = new Set(["@keepfall/core", "@keepfall/content", "@keepfall/sim", "@keepfall/rules"]);
const BANNED_MATHS = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log2|log10|log1p|pow|sqrt|cbrt|hypot|random)\b|\bDate\b|\bperformance\b/;
const DOM = /\b(window|document|navigator|requestAnimationFrame|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement)\b/;
const IMPORT = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
const builtins = new Set(builtinModules);

const names = new Map();
for (const ws of workspaces) {
  const pkg = JSON.parse(readFileSync(join(ws.dir, "package.json"), "utf8"));
  ws.pkg = pkg;
  names.set(pkg.name, ws);
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) yield p;
  }
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const errors = [];
for (const ws of workspaces) {
  const declared = { ...ws.pkg.dependencies, ...ws.pkg.devDependencies, ...ws.pkg.peerDependencies };
  const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const rootDev = { ...rootPkg.devDependencies };
  for (const [dep, version] of Object.entries(declared)) {
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) errors.push(`${ws.pkg.name}: ${dep} is not pinned to an exact version (${version})`);
  }
  for (const file of files(ws.dir)) {
    const rel = relative(root, file);
    const isTest = rel.includes(`${sep}test${sep}`) || rel.includes(`${sep}scripts${sep}`) || /config\.ts$/.test(rel);
    const src = stripComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith(".")) {
        const target = resolve(dirname(file), spec);
        if (!target.startsWith(ws.dir + sep)) errors.push(`${rel}: relative import "${spec}" leaves ${ws.pkg.name}; import the package by name`);
        continue;
      }
      if (spec.startsWith("node:") || builtins.has(spec)) {
        if (!isTest) errors.push(`${rel}: Node built-in "${spec}" outside tests and scripts`);
        continue;
      }
      if (/^[\w-]+:/.test(spec) || spec.startsWith("/")) continue; // virtual modules, absolute URLs
      const base = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (base === ws.pkg.name) continue; // a package's tests import it by name
      if (!(base in declared) && !(isTest && base in rootDev)) errors.push(`${rel}: imports "${base}" without declaring it in ${ws.pkg.name}/package.json`);
      const target = names.get(base);
      if (target) {
        if (target.group === "apps") errors.push(`${rel}: imports the app ${base}`);
        const from = RANK[ws.pkg.name], to = RANK[base];
        if (from !== undefined && to !== undefined && to >= from) errors.push(`${rel}: ${ws.pkg.name} may not import ${base}`);
      }
    }
    if (ws.group === "packages" && !isTest && DOM.test(src)) errors.push(`${rel}: DOM API in a DOM-free package (${src.match(DOM)[0]})`);
    if (DETERMINISTIC.has(ws.pkg.name) && !isTest) {
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        const hit = line.match(BANNED_MATHS);
        if (hit) errors.push(`${rel}:${i + 1}: ${hit[0]} is not deterministic; use @keepfall/core (dsin, dcos, dsqrt, Rng)`);
      });
    }
  }
}

if (errors.length) {
  console.error(`Boundary check failed (${errors.length}):\n  ` + errors.join("\n  "));
  process.exit(1);
}
console.log(`Boundary check passed: ${workspaces.length} workspaces.`);
