// Build plans for the observatory's searches (phase 3, 3.1): what a plan is
// (an AiStep list from packages/content/src/ai.ts), whether one is valid, how
// it is named, how it is written short, and how a search mutates one.
//
//   node tools/observatory-plans.mjs --self-check
//
// The lists a plan may use (building kinds, slots and what each allows, upgrades,
// mixes, routes, plots) are read from the content source, bundled with rolldown
// into node_modules/.scratch/content.mjs, so they follow content.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "rolldown";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentFile = join(root, "node_modules", ".scratch", "content.mjs");
await build({ input: join(root, "packages", "content", "src", "index.ts"), platform: "node", logLevel: "warn", output: { file: contentFile, format: "esm" } });
export const content = await import(pathToFileURL(contentFile).href + `?t=${Date.now()}`);
const { AI_PLANS, ASHWRIGHT_SLOTS, BUILDING_KINDS, MIX_NAMES, ROUTE_NAMES, PLOTS, START_BUILDINGS, UPGRADES, UPGRADE_KINDS, WEAPON_KINDS } = content;

/** The slots a plan may buy for (the empty ones), and the plots it may build on (not the starting barracks'). */
export const BUY_SLOTS = ASHWRIGHT_SLOTS.map((s, i) => (s.empty ? i : -1)).filter((i) => i >= 0);
export const FREE_PLOTS = PLOTS.map((p) => p.index).filter((i) => !START_BUILDINGS.some((b) => b.plot === i));
export const MAX_AFTER = 900;
export const LEVELS = ["squire", "knight", "warlord"];

/** The stock plans as explicit steps (a deep copy), by level. */
export const stockSteps = (level) => JSON.parse(JSON.stringify(AI_PLANS[level]));
export const STOCK_NAMES = LEVELS.map((l) => `stock-${l}`);

const KEY_ORDER = ["kind", "plot", "building", "mix", "route", "slot", "weapon", "upgrade", "after"];

/** A step with its keys in a fixed order (so equal plans give equal JSON). */
function canon(step) {
  const out = {};
  for (const k of KEY_ORDER) if (step[k] !== undefined) out[k] = step[k];
  for (const k of Object.keys(step).sort()) if (!(k in out) && step[k] !== undefined) out[k] = step[k];
  return out;
}
export const canonical = (steps) => JSON.stringify(steps.map(canon));

const STOCK_BY_JSON = new Map(LEVELS.map((l) => [canonical(stockSteps(l)), `stock-${l}`]));

/** A plan's name: stock-<level> for a stock plan, else p plus the first 8 hex digits of the hash of its JSON. */
export function planName(steps) {
  const json = canonical(steps);
  return STOCK_BY_JSON.get(json) ?? "p" + createHash("sha256").update(json).digest("hex").slice(0, 8);
}

/** The reason a plan is invalid, or null when it is valid. */
export function validatePlan(steps) {
  if (!Array.isArray(steps)) return "a plan is a list of steps";
  if (steps.length === 0) return "a plan has no steps";
  const bought = new Map(); // slot -> weapon
  const upgraded = new Set();
  const used = new Set(); // plots
  for (const [i, s] of steps.entries()) {
    const at = `step ${i + 1}`;
    if (!s || typeof s !== "object") return `${at}: not an object`;
    const allowedKeys = s.kind === "build" ? ["kind", "plot", "building", "mix", "route", "after"] : s.kind === "buy" ? ["kind", "slot", "weapon", "after"] : s.kind === "upgrade" ? ["kind", "slot", "upgrade", "after"] : null;
    if (!allowedKeys) return `${at}: unknown kind "${s.kind}"`;
    for (const k of Object.keys(s)) if (!allowedKeys.includes(k)) return `${at}: unexpected field "${k}" on a ${s.kind} step`;
    if (s.after !== undefined && !(Number.isFinite(s.after) && s.after >= 0 && s.after <= MAX_AFTER)) return `${at}: after ${s.after} is not 0 to ${MAX_AFTER}`;
    if (s.kind === "build") {
      if (!FREE_PLOTS.includes(s.plot)) return `${at}: plot ${s.plot} is not one of ${FREE_PLOTS.join(", ")}`;
      if (used.has(s.plot)) return `${at}: plot ${s.plot} is built on twice`;
      used.add(s.plot);
      if (!BUILDING_KINDS.includes(s.building)) return `${at}: unknown building "${s.building}"`;
      if (s.mix !== undefined && (s.building !== "barracks" || !MIX_NAMES.includes(s.mix))) return `${at}: mix "${s.mix}" is only for a barracks, one of ${MIX_NAMES.join(", ")}`;
      if (s.route !== undefined && (s.building !== "barracks" || !ROUTE_NAMES.includes(s.route))) return `${at}: route "${s.route}" is only for a barracks, one of ${ROUTE_NAMES.join(", ")}`;
    } else if (s.kind === "buy") {
      if (!BUY_SLOTS.includes(s.slot)) return `${at}: slot ${s.slot} cannot be bought for (only ${BUY_SLOTS.join(", ")})`;
      if (!ASHWRIGHT_SLOTS[s.slot].allowed.includes(s.weapon)) return `${at}: a ${s.weapon} is not allowed on slot ${s.slot} (only ${ASHWRIGHT_SLOTS[s.slot].allowed.join(", ")})`;
      if (bought.has(s.slot)) return `${at}: slot ${s.slot} is bought for twice`;
      bought.set(s.slot, s.weapon);
    } else {
      if (!UPGRADE_KINDS.includes(s.upgrade)) return `${at}: unknown upgrade "${s.upgrade}"`;
      if (!Number.isInteger(s.slot) || s.slot < 0 || s.slot >= ASHWRIGHT_SLOTS.length) return `${at}: slot ${s.slot} does not exist`;
      const gun = ASHWRIGHT_SLOTS[s.slot].empty ? bought.get(s.slot) : ASHWRIGHT_SLOTS[s.slot].weapon;
      if (!gun) return `${at}: slot ${s.slot} has no gun yet (an upgrade must come after the buy)`;
      if (UPGRADES[s.upgrade].weapon !== gun) return `${at}: ${s.upgrade} is for a ${UPGRADES[s.upgrade].weapon}, slot ${s.slot} holds a ${gun}`;
      if (upgraded.has(s.slot)) return `${at}: slot ${s.slot} is upgraded twice`;
      upgraded.add(s.slot);
    }
  }
  return null;
}

/** A plan written short, e.g. "mill1@20 barracks2(breach,left)@90 buy4:chainShot@200 up0:heavyShot". */
export function describePlan(steps) {
  return steps
    .map((s) => {
      const at = s.after !== undefined ? `@${s.after}` : "";
      if (s.kind === "build") return `${s.building}${s.plot}${s.mix || s.route ? `(${[s.mix, s.route].filter(Boolean).join(",")})` : ""}${at}`;
      if (s.kind === "buy") return `buy${s.slot}:${s.weapon}${at}`;
      return `up${s.slot}:${s.upgrade}${at}`;
    })
    .join(" ");
}

// ---------------------------------------------------------------- random

/** A small seeded generator (an LCG), so a search replays from its seed. */
export function makeRng(seed) {
  let state = (Number(seed) >>> 0) || 1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const rng = () => next();
  rng.int = (n) => Math.floor(next() * n);
  rng.pick = (list) => list[Math.floor(next() * list.length)];
  return rng;
}

// ---------------------------------------------------------------- mutation

const clone = (steps) => JSON.parse(JSON.stringify(steps));
const clampAfter = (n) => Math.max(0, Math.min(MAX_AFTER, n));

const MUTATIONS = {
  swap(steps, rng) {
    if (steps.length < 2) return null;
    const a = rng.int(steps.length);
    let b = rng.int(steps.length - 1);
    if (b >= a) b++;
    [steps[a], steps[b]] = [steps[b], steps[a]];
    return steps;
  },
  building(steps, rng) {
    const idx = steps.map((s, i) => (s.kind === "build" ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return null;
    const s = steps[rng.pick(idx)];
    const free = FREE_PLOTS.filter((p) => !steps.some((q) => q.kind === "build" && q.plot === p));
    if (rng() < 0.5 || !free.length) {
      const kinds = BUILDING_KINDS.filter((k) => k !== s.building);
      s.building = rng.pick(kinds);
      if (s.building !== "barracks") {
        delete s.mix;
        delete s.route;
      }
    } else s.plot = rng.pick(free);
    return steps;
  },
  after(steps, rng) {
    const s = steps[rng.int(steps.length)];
    if (s.after !== undefined && rng() < 0.2) delete s.after;
    else s.after = clampAfter((s.after ?? 0) + (rng() < 0.5 ? -1 : 1) * (30 + rng.int(91)));
    return steps;
  },
  mixroute(steps, rng) {
    const idx = steps.map((s, i) => (s.kind === "build" && s.building === "barracks" ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return null;
    const s = steps[rng.pick(idx)];
    if (rng() < 0.5) s.mix = rng.pick(MIX_NAMES);
    else s.route = rng.pick(ROUTE_NAMES);
    return steps;
  },
  gun(steps, rng) {
    const idx = steps.map((s, i) => (s.kind === "buy" ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return null;
    const s = steps[rng.pick(idx)];
    const options = ASHWRIGHT_SLOTS[s.slot].allowed.filter((w) => w !== s.weapon);
    if (!options.length) return null;
    s.weapon = rng.pick(options);
    // an upgrade on this slot that no longer fits is dropped
    return steps.filter((q) => !(q.kind === "upgrade" && q.slot === s.slot && UPGRADES[q.upgrade].weapon !== s.weapon));
  },
  drop(steps, rng) {
    if (steps.length < 2) return null;
    steps.splice(rng.int(steps.length), 1);
    return steps;
  },
  insert(steps, rng, stocks) {
    const from = rng.pick(stocks);
    const s = clone(rng.pick(from));
    steps.splice(rng.int(steps.length + 1), 0, s);
    return steps;
  },
};
export const MUTATION_NAMES = Object.keys(MUTATIONS);

/**
 * A child of `parent`: one or two mutations (a seeded generator picks them),
 * redrawn until the child is valid and new (its name is not in `seen`).
 * Returns null after `tries` failed draws.
 */
export function makeChild(parent, rng, { stocks = LEVELS.map(stockSteps), seen = new Set(), tries = 300 } = {}) {
  for (let t = 0; t < tries; t++) {
    let steps = clone(parent);
    const n = 1 + rng.int(2);
    let ok = true;
    for (let k = 0; k < n && ok; k++) {
      const out = MUTATIONS[rng.pick(MUTATION_NAMES)](steps, rng, stocks);
      if (out) steps = out;
      else ok = false;
    }
    if (!ok || validatePlan(steps)) continue;
    const name = planName(steps);
    if (seen.has(name)) continue;
    return steps;
  }
  return null;
}

// ---------------------------------------------------------------- the panel

/** The plan every candidate is measured against: the stock Knight plan, as explicit steps. */
export const PANEL_PLAN = { name: "stock-knight", steps: stockSteps("knight") };

/**
 * The matches that score one candidate plan: it as castle 0, then as castle 1,
 * on each seed, against the stock Knight plan; every plan played by the Knight
 * level. Ids carry both plan names (and the seconds when shortened), so a plan
 * that was scored in another run in the same directory is not played again.
 */
export function panelSetups(candidate, seeds, secs) {
  const out = [];
  for (const seed of seeds) {
    for (const castle of [0, 1]) {
      const plans = castle === 0 ? [candidate, PANEL_PLAN] : [PANEL_PLAN, candidate];
      const setup = {
        id: `${plans[0].name}-${plans[1].name}-s${seed}${secs ? `-t${secs}` : ""}-base`,
        seed,
        sides: ["knight", "knight"],
        plans: [plans[0].name, plans[1].name],
        steps: [plans[0].steps, plans[1].steps],
        variant: "base",
        tuning: {},
      };
      if (secs) setup.secs = secs;
      out.push(setup);
    }
  }
  return out;
}

/**
 * A candidate's score from the match lines (a Map by id) for the setups
 * panelSetups() made (even positions: the candidate is castle 0, odd: castle
 * 1): wins plus half the draws over every match played (no result counts as a
 * draw), in points of 100.
 */
export function scorePlan(setups, lines) {
  let wins = 0, draws = 0, matches = 0;
  setups.forEach((setup, i) => {
    const line = lines.get(setup.id);
    if (!line) return;
    const w = line.result?.winner;
    matches++;
    if (w === i % 2) wins++;
    else if (w === null || w === undefined || w === -1) draws++;
  });
  return { wins, draws, matches, score: matches ? ((wins + draws / 2) / matches) * 100 : null };
}

/** Every line in dir/matches.jsonl by setup id (a later line wins). */
export function readLines(dir) {
  const out = new Map();
  const file = join(dir, "matches.jsonl");
  if (!existsSync(file)) return out;
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l) continue;
    try {
      const line = JSON.parse(l);
      out.set(line.setup.id, line);
    } catch {
      // a torn line
    }
  }
  return out;
}

// ---------------------------------------------------------------- self check

function selfCheck() {
  let bad = 0;
  const show = (label, steps, expectOk, wantText) => {
    const err = validatePlan(steps);
    const ok = expectOk ? err === null : err !== null && (!wantText || err.includes(wantText));
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${err === null ? "valid" : "rejected (" + err + ")"}`);
  };
  for (const l of LEVELS) show(`stock-${l} (${planName(stockSteps(l))})`, stockSteps(l), true);
  const base = [{ kind: "build", plot: 1, building: "mill" }];
  show("buy on slot 2", [...base, { kind: "buy", slot: 2, weapon: "chainShot" }], false, "slot 2");
  show("mortar on slot 5", [...base, { kind: "buy", slot: 5, weapon: "mortar" }], false, "not allowed on slot 5");
  show("upgrade on slot 6 before a gun is bought there", [...base, { kind: "upgrade", slot: 6, upgrade: "rifled" }, { kind: "buy", slot: 6, weapon: "longGun" }], false, "no gun yet");
  show("unknown building", [{ kind: "build", plot: 1, building: "tavern" }], false, "unknown building");
  show("plot 0", [{ kind: "build", plot: 0, building: "mill" }], false, "plot 0");
  show("plot 6", [{ kind: "build", plot: 6, building: "mill" }], false, "plot 6");
  show("after 901", [{ kind: "build", plot: 1, building: "mill", after: 901 }], false, "after");
  show("mix on a mill", [{ kind: "build", plot: 1, building: "mill", mix: "breach" }], false, "mix");
  show("bad route on a barracks", [{ kind: "build", plot: 2, building: "barracks", route: "up" }], false, "route");
  show("upgrade for another gun", [...base, { kind: "upgrade", slot: 0, upgrade: "quickLoader" }], false, "is for a mortar");
  show("upgrade on a stock gun", [...base, { kind: "upgrade", slot: 1, upgrade: "heavyShell", after: 100 }], true);
  show("upgrade after its buy", [...base, { kind: "buy", slot: 6, weapon: "chainShot" }, { kind: "upgrade", slot: 6, upgrade: "longChain" }], true);
  const a = planName(stockSteps("knight").slice(0, 3)), b = planName(stockSteps("knight").slice(0, 3));
  const same = a === b && /^p[0-9a-f]{8}$/.test(a);
  if (!same) bad++;
  console.log(`${same ? "ok  " : "FAIL"} the same plan has the same name (${a})`);
  const rng = makeRng(7);
  const seen = new Set(STOCK_NAMES);
  let made = 0;
  for (let i = 0; i < 200; i++) {
    const kid = makeChild(stockSteps(LEVELS[i % 3]), rng, { seen });
    if (kid) {
      made++;
      if (validatePlan(kid)) bad++;
    }
  }
  console.log(`${made === 200 ? "ok  " : "FAIL"} 200 children drawn, all valid (${made})`);
  if (made !== 200) bad++;
  console.log(bad ? `${bad} FAILED` : "all checks passed");
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--self-check")) selfCheck();
