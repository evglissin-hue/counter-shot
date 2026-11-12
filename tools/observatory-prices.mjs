// The price list (phase 3, 3.1, spec rule 7): what each thing gold buys is
// worth, as win rate per 100 gold.
//
//   node tools/observatory-prices.mjs [run=name] [seeds=1-4] [items=mill,heavyShot,...] [secs=N] [jobs=N] [dry=1]
//
// dry=1 prints the pairs and the match count and plays nothing.
//
// Items: every building kind (mill, barracks, foundry), every gun kind
// (longGun, mortar, chainShot, swivel) and every upgrade (heavyShot, rifled,
// ...). For each, a pair of plans on the common seeds against the stock Knight
// plan, from both castles (the openings search's panel): the stock Knight plan
// with the item and without it.
//
//   The item is in the stock Knight plan: "with" is the stock plan, "without"
//   removes the item's step (the last one of its kind: a second mill, the
//   second barracks), and with a gun also the upgrade on its slot, with the
//   foundry also every upgrade. The item's cost is the gold of everything
//   removed.
//   The item is not in it: "without" is the stock plan (with the other upgrade
//   of that gun removed when the item is an upgrade for a stock gun, so the
//   pair differs by the item only); "with" adds the item as a new step right
//   after the step whose `after` (a step without one takes the one before it)
//   is nearest 300 s, taking that step's `after`. A building goes on the first
//   free plot, a gun on the first free slot that allows it, an upgrade on the
//   slot of that gun (a stock gun's, else the one the plan buys it for).
//
// The difference is in win rate points (wins plus half the draws, over all
// matches). Writes prices.json: { rows: [{ item, cost, with, without, diff,
// per100, matches, ... }] } sorted by per100. Plans are named as in the
// openings search, so a run directory shared with it reuses its matches.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { doneIds, parseArgs, root, runPool, runReport, seedList, stamp, writeRunInfo } from "./observatory.mjs";
import { content, FREE_PLOTS, PANEL_PLAN, panelSetups, planName, readLines, scorePlan, stockSteps, validatePlan } from "./observatory-plans.mjs";

const { ASHWRIGHT_SLOTS, BUILDING_KINDS, BUILDINGS, UPGRADE_KINDS, UPGRADES, WEAPON_COST, WEAPON_KINDS } = content;

const stepCost = (s) => (s.kind === "build" ? BUILDINGS[s.building].cost : s.kind === "buy" ? WEAPON_COST[s.weapon] : UPGRADES[s.upgrade].cost);
const isItem = (s, item) => (s.kind === "build" ? s.building === item : s.kind === "buy" ? s.weapon === item : s.upgrade === item);
export const ITEMS = [...BUILDING_KINDS, ...WEAPON_KINDS, ...UPGRADE_KINDS];
const clone = (x) => JSON.parse(JSON.stringify(x));

/** The plan without the item's (last) step, and what went with it. */
function removeItem(steps, item) {
  let at = -1;
  steps.forEach((s, i) => {
    if (isItem(s, item)) at = i;
  });
  if (at < 0) return null;
  const gone = [steps[at]];
  let out = steps.filter((_, i) => i !== at);
  if (steps[at].kind === "buy") {
    const slot = steps[at].slot;
    gone.push(...out.filter((s) => s.kind === "upgrade" && s.slot === slot));
    out = out.filter((s) => !(s.kind === "upgrade" && s.slot === slot));
  }
  if (steps[at].kind === "build" && item === "foundry" && !out.some((s) => s.kind === "build" && s.building === "foundry")) {
    gone.push(...out.filter((s) => s.kind === "upgrade"));
    out = out.filter((s) => s.kind !== "upgrade");
  }
  return { steps: out, gone };
}

/** Where a new step goes: right after the step whose `after` is nearest 300 s; it takes that `after`. */
function insertAt(steps, step) {
  let eff = 0, best = -1, bestGap = Infinity, bestAfter = 0;
  steps.forEach((s, i) => {
    eff = s.after ?? eff;
    const gap = Math.abs(eff - 300);
    if (gap < bestGap) (best = i), (bestGap = gap), (bestAfter = eff);
  });
  const out = clone(steps);
  const s = { ...step };
  if (bestAfter > 0) s.after = bestAfter;
  out.splice(best + 1, 0, s);
  return out;
}

/** The slot an upgrade is for: a stock gun's, else the slot the plan buys that gun for. */
function upgradeSlot(steps, upgrade) {
  const gun = UPGRADES[upgrade].weapon;
  const stock = ASHWRIGHT_SLOTS.findIndex((s) => !s.empty && s.weapon === gun);
  if (stock >= 0) return stock;
  return steps.find((s) => s.kind === "buy" && s.weapon === gun)?.slot ?? -1;
}

/** { with, without, cost, how } for an item against a base plan, or { error }. */
export function pairFor(base, item) {
  if (base.some((s) => isItem(s, item))) {
    const r = removeItem(base, item);
    const cost = r.gone.reduce((n, s) => n + stepCost(s), 0);
    return { with: base, without: r.steps, cost, how: `removes ${r.gone.length} step${r.gone.length === 1 ? "" : "s"}` };
  }
  let plain = base, step;
  if (BUILDING_KINDS.includes(item)) {
    const plot = FREE_PLOTS.find((p) => !base.some((s) => s.kind === "build" && s.plot === p));
    if (plot === undefined) return { error: "no free plot" };
    step = { kind: "build", plot, building: item, ...(item === "barracks" ? { mix: "mixed", route: "centre" } : {}) };
  } else if (WEAPON_KINDS.includes(item)) {
    const slot = ASHWRIGHT_SLOTS.findIndex((s, i) => s.empty && s.allowed.includes(item) && !base.some((q) => q.kind === "buy" && q.slot === i));
    if (slot < 0) return { error: "no free slot allows it" };
    step = { kind: "buy", slot, weapon: item };
  } else {
    const slot = upgradeSlot(base, item);
    if (slot < 0) return { error: "no gun of its kind in the plan" };
    plain = base.filter((s) => !(s.kind === "upgrade" && s.slot === slot));
    step = { kind: "upgrade", slot, upgrade: item };
  }
  return { with: insertAt(plain, step), without: plain, cost: stepCost(step), how: "adds one step" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seeds = seedList(args.seeds ?? "1-4");
  const secs = args.secs ? Number(args.secs) : undefined;
  const jobs = Math.max(1, Number(args.jobs ?? os.availableParallelism()));
  const items = args.items ? args.items.split(",").map((s) => s.trim()).filter(Boolean) : ITEMS;
  for (const it of items) if (!ITEMS.includes(it)) throw new Error(`unknown item "${it}" (${ITEMS.join(", ")})`);
  const run = args.run ?? `prices-${stamp()}`;
  const dir = join(root, "tools", ".observatory", run);
  mkdirSync(dir, { recursive: true });

  const base = stockSteps("knight");
  const plans = new Map(); // name -> { name, steps, setups }
  const note = (steps) => {
    const name = planName(steps);
    if (!plans.has(name)) plans.set(name, { name, steps, setups: panelSetups({ name, steps }, seeds, secs) });
    return plans.get(name);
  };
  const pairs = [];
  for (const item of items) {
    const p = pairFor(base, item);
    if (p.error) {
      console.log(`${item}: skipped (${p.error})`);
      continue;
    }
    const bad = validatePlan(p.with) ?? validatePlan(p.without);
    if (bad) {
      console.log(`${item}: skipped (invalid pair: ${bad})`);
      continue;
    }
    pairs.push({ item, cost: p.cost, how: p.how, with: note(p.with), without: note(p.without) });
  }
  const setups = [...plans.values()].flatMap((p) => p.setups);
  const have = doneIds(dir);
  const toPlay = setups.filter((s) => !have.has(s.id)).length;
  console.log(`${run}: ${pairs.length} items, ${plans.size} distinct plans x ${seeds.length * 2} matches = ${setups.length} matches (${toPlay} to play on ${jobs} workers)`);
  if (args.dry === "1") {
    for (const p of pairs) console.log(`${p.item.padEnd(12)} cost ${String(p.cost).padStart(3)}  ${p.how}  with ${p.with.name}  without ${p.without.name}`);
    return;
  }
  writeRunInfo(dir, { run, jobs, args, matrix: { kind: "prices", seeds: args.seeds ?? "1-4", items, secs: secs ?? null }, expected: setups.length, setups: setups.map((s) => s.id) });

  await runPool({ dir, setups, jobs });
  const lines = readLines(dir);
  const score = (p) => scorePlan(p.setups, lines);
  const rows = pairs
    .map((p) => {
      const w = score(p.with), o = score(p.without);
      if (!w.matches || !o.matches) return null;
      const diff = w.score - o.score;
      return {
        item: p.item,
        cost: p.cost,
        with: Number(w.score.toFixed(1)),
        without: Number(o.score.toFixed(1)),
        diff: Number(diff.toFixed(1)),
        per100: Number(((diff / p.cost) * 100).toFixed(2)),
        matches: w.matches + o.matches,
        withPlan: p.with.name,
        withoutPlan: p.without.name,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.per100 - a.per100);
  writeFileSync(join(dir, "prices.json"), JSON.stringify({ panel: { opponent: PANEL_PLAN.name, seeds: args.seeds ?? "1-4", secs: secs ?? null, level: "knight" }, rows }, null, 2) + "\n");
  console.log("\nitem            cost   with  without   diff  per 100 gold  matches");
  for (const r of rows) console.log(`${r.item.padEnd(14)} ${String(r.cost).padStart(5)} ${r.with.toFixed(1).padStart(6)} ${r.without.toFixed(1).padStart(8)} ${r.diff.toFixed(1).padStart(6)} ${r.per100.toFixed(2).padStart(12)} ${String(r.matches).padStart(8)}`);
  console.log(`\nwrote ${join(dir, "prices.json")}`);
  await runReport(dir);
}

await main();
