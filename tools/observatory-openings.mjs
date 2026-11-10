// The opening search (phase 3, 3.1, spec rule 6): looks for dominant build
// orders and says whether T6 holds.
//
//   node tools/observatory-openings.mjs [run=name] [seeds=1-4] [gens=3] [pop=6] [keep=3] [secs=N] [jobs=N] [seed=1]
//
// Start from the three stock plans. Each generation: score every plan not yet
// scored on the panel (the plan as one castle against the stock Knight plan as
// the other, on the common seeds, from both castles; every plan played by the
// Knight level), keep the best `keep`, and fill the population (`pop`) with
// mutated children of the kept ones. `seed` seeds the mutations, so a search
// replays; played again in the same run directory it plays no match twice.
// Writes openings.json (for the report): { pass, best, median, within5, rows }.
// T6 holds when at least three plans score within 5 points of the best and the
// best beats the median plan by under 10 points.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { doneIds, parseArgs, root, runPool, runReport, seedList, stamp, writeRunInfo } from "./observatory.mjs";
import { describePlan, LEVELS, makeChild, makeRng, panelSetups, planName, readLines, scorePlan, stockSteps } from "./observatory-plans.mjs";

const args = parseArgs(process.argv.slice(2));
const seeds = seedList(args.seeds ?? "1-4");
const gens = Math.max(1, Number(args.gens ?? 3));
const pop = Math.max(1, Number(args.pop ?? 6));
const keep = Math.min(pop, Math.max(1, Number(args.keep ?? 3)));
const secs = args.secs ? Number(args.secs) : undefined;
const jobs = Math.max(1, Number(args.jobs ?? os.availableParallelism()));
const rng = makeRng(Number(args.seed ?? 1));
const run = args.run ?? `openings-${stamp()}`;
const dir = join(root, "tools", ".observatory", run);
mkdirSync(dir, { recursive: true });

const perPlan = seeds.length * 2;
const first = LEVELS.length;
const later = Math.max(0, pop - keep);
const planned = first + (gens - 1) * later;
console.log(`${run}: ${gens} generations, population ${pop}, keep ${keep}, ${seeds.length} seeds x 2 castles = ${perPlan} matches per plan`);
console.log(`up to ${planned} plans (${first} stock, then ${later} new per generation) = about ${planned * perPlan} matches, fewer when some are already in ${run}/matches.jsonl`);

/** plan name -> { name, steps, gen, setups, ...score } */
const plans = new Map();
const allSetups = new Map();
const note = (steps, gen) => {
  const name = planName(steps);
  if (!plans.has(name)) plans.set(name, { name, steps, gen, setups: panelSetups({ name, steps }, seeds, secs) });
  return plans.get(name);
};

const rows = () =>
  [...plans.values()]
    .filter((p) => p.matches > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((p) => ({ plan: p.name, score: Number(p.score.toFixed(1)), matches: p.matches, wins: p.wins, draws: p.draws, steps: describePlan(p.steps) }));

function verdict(list) {
  if (!list.length) return { pass: null, best: null, median: null, within5: 0 };
  const best = list[0].score;
  const sorted = list.map((r) => r.score).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const within5 = list.filter((r) => r.score >= best - 5).length;
  return { pass: within5 >= 3 && best - median < 10, best, median: Number(median.toFixed(1)), within5 };
}

function save() {
  const list = rows();
  const v = verdict(list);
  writeFileSync(join(dir, "openings.json"), JSON.stringify({ ...v, panel: { opponent: "stock-knight", seeds: args.seeds ?? "1-4", secs: secs ?? null, level: "knight" }, rows: list }, null, 2) + "\n");
  return { list, v };
}

let population = LEVELS.map((l) => note(stockSteps(l), 0));
for (let gen = 1; gen <= gens; gen++) {
  const fresh = population.filter((p) => !p.evaluated);
  for (const p of population) for (const s of p.setups) allSetups.set(s.id, s);
  const setups = [...allSetups.values()];
  writeRunInfo(dir, { run, jobs, args, matrix: { kind: "openings", seeds: args.seeds ?? "1-4", gens, pop, keep, secs: secs ?? null }, expected: setups.length, setups: setups.map((s) => s.id) });
  const todo = fresh.flatMap((p) => p.setups);
  const have = doneIds(dir);
  console.log(`\ngeneration ${gen}: ${fresh.length} plans to score, ${todo.filter((s) => !have.has(s.id)).length} of ${todo.length} matches to play on ${jobs} workers`);
  await runPool({ dir, setups: todo, jobs });
  const lines = readLines(dir);
  for (const p of fresh) {
    Object.assign(p, scorePlan(p.setups, lines));
    p.evaluated = true;
  }
  const ranked = [...plans.values()].filter((p) => p.matches > 0).sort((a, b) => b.score - a.score);
  console.log(`generation ${gen}: scores so far (win rate in points against stock-knight, wins plus half the draws)`);
  for (const p of ranked) console.log(`  ${p.name.padEnd(14)} ${p.score.toFixed(1).padStart(5)}  ${String(p.matches).padStart(3)} matches${p.gen === gen - 1 ? "  new" : ""}`);
  save();
  if (gen === gens) break;
  const kept = ranked.slice(0, keep);
  const seen = new Set(plans.keys());
  const next = [...kept];
  let tries = 0;
  while (next.length < pop && tries++ < pop * 20) {
    const parent = kept[rng.int(kept.length)];
    const steps = makeChild(parent.steps, rng, { seen });
    if (!steps) continue;
    const p = note(steps, gen);
    seen.add(p.name);
    next.push(p);
  }
  if (next.length < pop) console.log(`(only ${next.length} plans: no more valid children found)`);
  population = next;
}

const { list, v } = save();
console.log("\nbest plans:");
for (const r of list.slice(0, 5)) console.log(`  ${r.plan}  ${r.score.toFixed(1)}  (${r.wins} wins, ${r.draws} draws of ${r.matches})  ${r.steps}`);
console.log(`\nT6: ${v.pass === null ? "not measured" : v.pass ? "PASS" : "FAIL"}: ${v.within5} plan(s) within 5 points of the best (${v.best?.toFixed(1)}), median ${v.median}, best minus median ${v.best === null ? "n/a" : (v.best - v.median).toFixed(1)} (needs at least 3 within 5 and under 10)`);
console.log(`wrote ${join(dir, "openings.json")}`);
await runReport(dir);
