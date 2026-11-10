// The observatory (phase 3, 3.1): plays a matrix of AI matches, one worker
// thread per match, and appends one JSON line per match to
// tools/.observatory/<run>/matches.jsonl (the line is described in
// packages/ai/scripts/observe-line.ts). A run that is started again skips the
// setups already in matches.jsonl.
//
//   node tools/observatory.mjs preset=quick|review|side [run=name] [jobs=N] [secs=N]
//   node tools/observatory.mjs pairs=knight:knight,warlord:knight seeds=1-12 [swap=1] [variants=file.json] [run=name] [jobs=N] [secs=N]
//
// pairs are castle 0 : castle 1. swap=1 plays each pairing also with the
// castles exchanged. variants is a JSON array of { name, tuning }; every setup
// is played under each (none: one variant "base" with no changes).

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import os from "node:os";
import { Worker } from "node:worker_threads";
import { build } from "rolldown";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.includes("=")).map((a) => [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]));

/** "1-12" or "1,4,9" or "5" as a list of numbers. */
function seedList(text) {
  const out = [];
  for (const part of text.split(",")) {
    const m = /^(\d+)-(\d+)$/.exec(part.trim());
    if (m) for (let s = Number(m[1]); s <= Number(m[2]); s++) out.push(s);
    else if (/^\d+$/.test(part.trim())) out.push(Number(part));
    else throw new Error(`bad seeds "${text}"`);
  }
  return out;
}

const range = (a, b) => seedList(`${a}-${b}`);
const LEVELS = new Set(["squire", "knight", "warlord", "idle"]);

/** A match to play: [castle 0 level, castle 1 level, seed]. */
function presetCases(name) {
  const mk = (a, b, seeds) => seeds.map((s) => [a, b, s]);
  if (name === "quick") return [...mk("knight", "knight", range(1, 12)), ...mk("warlord", "knight", range(1, 6)), ...mk("knight", "warlord", range(1, 6))];
  if (name === "side") return mk("knight", "knight", range(1, 400));
  if (name === "review") {
    // The design review's fifteen matches (docs/plan.md, "Findings from the design review").
    return [
      ...mk("knight", "knight", [11, 12, 21, 22, 23, 24]),
      ...mk("squire", "squire", [41, 42]),
      ...mk("warlord", "warlord", [13, 31, 32]),
      ...mk("warlord", "knight", [51]),
      ...mk("knight", "warlord", [52]),
      ...mk("knight", "squire", [53]),
      ...mk("squire", "knight", [54]),
    ];
  }
  throw new Error(`unknown preset "${name}" (quick, review, side)`);
}

function customCases() {
  const cases = [];
  const seeds = seedList(args.seeds ?? "1");
  for (const p of (args.pairs ?? "knight:knight").split(",")) {
    const [a, b] = p.split(":");
    if (!LEVELS.has(a) || !LEVELS.has(b)) throw new Error(`bad pair "${p}"`);
    for (const s of seeds) {
      cases.push([a, b, s]);
      if (args.swap === "1" && a !== b) cases.push([b, a, s]);
    }
  }
  return cases;
}

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const cases = args.preset ? presetCases(args.preset) : customCases();
const variants = args.variants ? JSON.parse(readFileSync(resolve(args.variants), "utf8")) : [{ name: "base", tuning: {} }];
if (!Array.isArray(variants) || variants.some((v) => !v || typeof v.name !== "string")) throw new Error("variants must be an array of { name, tuning }");
const secs = args.secs ? Number(args.secs) : undefined;

const setups = [];
for (const v of variants) {
  for (const [a, b, seed] of cases) {
    const setup = { id: `${a}-${b}-s${seed}-${v.name}`, seed, sides: [a, b], plans: ["stock", "stock"], variant: v.name, tuning: v.tuning ?? {} };
    if (secs) setup.secs = secs;
    setups.push(setup);
  }
}
const ids = new Set(setups.map((s) => s.id));
if (ids.size !== setups.length) throw new Error("duplicate setup ids (check the variant names)");

const run = args.run ?? `${args.preset ?? "custom"}-${stamp()}`;
const dir = join(root, "tools", ".observatory", run);
mkdirSync(dir, { recursive: true });
const matchesFile = join(dir, "matches.jsonl"), errorsFile = join(dir, "errors.jsonl");
const jobs = Math.max(1, Number(args.jobs ?? os.availableParallelism()));

const readLines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []);
const done = new Set();
for (const l of readLines(matchesFile)) {
  try {
    done.add(JSON.parse(l).setup.id);
  } catch {
    // a torn last line from a stopped run: that match is played again
  }
}

const runFile = join(dir, "run.json");
const cpus = os.cpus();
const info = {
  run,
  name: run,
  jobs,
  args,
  matrix: { preset: args.preset ?? null, pairs: args.pairs ?? null, seeds: args.seeds ?? null, swap: args.swap === "1", variants: variants.map((v) => v.name), secs: secs ?? null },
  expected: setups.length,
  setups: setups.map((s) => s.id),
  variants,
  machine: { cpu: cpus[0]?.model ?? "unknown", cpus: cpus.length, parallelism: os.availableParallelism(), jobs, node: process.version },
  startedAt: new Date().toISOString(),
};
if (existsSync(runFile)) info.resumedAt = info.startedAt, info.startedAt = JSON.parse(readFileSync(runFile, "utf8")).startedAt ?? info.startedAt;
info.started = info.startedAt;
writeFileSync(runFile, JSON.stringify(info, null, 2) + "\n");

const todo = setups.filter((s) => !done.has(s.id));
console.log(`${run}: ${setups.length} matches, ${done.size} already done, ${todo.length} to play on ${jobs} workers`);

let finished = 0, failed = 0;
const t0 = Date.now();

if (todo.length) {
  const bundle = join(root, "node_modules", ".scratch", "observe.mjs");
  await build({ input: join(root, "packages", "ai", "scripts", "observe.ts"), platform: "node", logLevel: "warn", output: { file: bundle, format: "esm" } });

  const fail = (setup, error) => {
    failed++;
    appendFileSync(errorsFile, JSON.stringify({ id: setup.id, error }) + "\n");
    console.log(`${setup.id}  FAILED: ${error.split("\n")[0]}`);
  };

  await new Promise((finish) => {
    let next = 0, running = 0;
    const launch = () => {
      while (running < jobs && next < todo.length) {
        const setup = todo[next++];
        running++;
        const started = Date.now();
        let line = null, settled = false;
        const end = (error) => {
          if (settled) return;
          settled = true;
          if (line) {
            appendFileSync(matchesFile, JSON.stringify(line) + "\n");
            finished++;
            const r = line.result;
            const who = r.winner === null ? "no result" : r.winner === -1 ? "draw" : `castle ${r.winner}`;
            console.log(`${setup.id}  ${who}${r.reason ? " by " + r.reason : ""}  ${Math.floor(r.tick / 3600)}:${String(Math.floor(r.tick / 60) % 60).padStart(2, "0")}  ${((Date.now() - started) / 1000).toFixed(0)} s wall  (${finished + failed}/${todo.length})`);
          } else fail(setup, error ?? "worker ended without a line");
          running--;
          if (next >= todo.length && running === 0) finish();
          else launch();
        };
        const w = new Worker(bundle, { workerData: { setup } });
        w.on("message", (m) => {
          line = m;
        });
        w.on("error", (e) => end(String(e?.stack ?? e)));
        w.on("exit", (code) => end(code ? `worker exited with code ${code}` : undefined));
      }
    };
    launch();
  });
}

const hours = (Date.now() - t0) / 3.6e6;
const have = new Set([...done]);
for (const l of readLines(matchesFile)) {
  try {
    have.add(JSON.parse(l).setup.id);
  } catch {
    // ignore
  }
}
const total = [...ids].filter((id) => have.has(id)).length;
console.log(`done ${total} / expected ${setups.length}, failed ${failed} this time${todo.length ? `, ${(finished / hours).toFixed(0)} matches per hour` : ""}`);

const reporter = join(root, "tools", "observatory-report.mjs");
if (existsSync(reporter)) {
  const { report } = await import(reporter);
  if (typeof report === "function") await report(dir);
}
