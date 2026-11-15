// Tuning by path, for tools only (the observatory): the game page never calls
// this. A variant is a list of changes to content such as
// { "WEAPONS.mortar.reload": 600 }; applyTuning() makes them and returns an
// undo. A path is a root name from TUNING_ROOTS, then property names, with
// numeric segments indexing arrays. Every path is checked before any change
// is made.
//
// Which roots are safe: a change reaches only what reads the value live. The
// sim and the rules read WEAPONS, UPGRADES (through armedWeapon, whose cache
// is cleared), WEAPON_COST, GUN_HITS, REMOUNT, MATCH, GOLD, WAVES, UNITS,
// WAVE_MIXES, KEG, MUSKET, UNMANNED, BUILDINGS, REPAIR, GARRISON, STORM,
// LADDER and the AI's AI_LEVELS and AI_PLANS live (the steward copies its plan
// when the AiPlayer is built, so tune before that). Values derived at module
// load from other content do NOT follow a tuned value: castle layouts,
// MATCH_EMPLACEMENTS (built from the weapons' positions), the muster and
// courtyard rectangles, and anything a layout was built from. Tune numbers of
// play (reloads, costs, speeds, delays), not shapes of the field.
// Tune before the match is built, and undo after it is freed. Scalar
// `export const` numbers are not reachable and cannot be changed.

import { clearArmedCache, GUN_HITS, REMOUNT, UPGRADES, WEAPON_COST } from "./arsenal";
import { AI_LEVELS, AI_PLANS, TUTOR } from "./ai";
import { GOLD, MATCH } from "./economy";
import { BUILDINGS } from "./buildings";
import { KEG, MUSKET, UNITS, UNMANNED, WAVE_MIXES, WAVES } from "./army";
import { GARRISON, LADDER, REPAIR, STORM } from "./siege";
import { WEAPONS } from "./weapons";
import { REGISTER } from "./register";
import { BUTTRESS, STRUCTURE } from "./structure";

/** The content objects a path can start from. */
export const TUNING_ROOTS: Record<string, unknown> = {
  WEAPONS,
  UPGRADES,
  WEAPON_COST,
  GUN_HITS,
  REMOUNT,
  MATCH,
  GOLD,
  WAVES,
  UNITS,
  WAVE_MIXES,
  KEG,
  MUSKET,
  UNMANNED,
  BUILDINGS,
  REPAIR,
  GARRISON,
  STORM,
  LADDER,
  AI_LEVELS,
  AI_PLANS,
  TUTOR,
  REGISTER,
  STRUCTURE,
  BUTTRESS,
};

type Bag = Record<string, unknown>;

const kindOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Walk a path to the object that holds its last segment: [holder, last key]. Throws an Error naming the path if it does not exist. */
function locate(path: string): [Bag, string] {
  const segs = path.split(".");
  const root = has(TUNING_ROOTS, segs[0]) ? TUNING_ROOTS[segs[0]] : undefined;
  if (root === undefined) throw new Error(`tuning: unknown root "${segs[0]}" in path "${path}"`);
  if (segs.length < 2) throw new Error(`tuning: path "${path}" names a whole root; name a value inside it`);
  let at: unknown = root;
  for (let i = 1; i < segs.length; i++) {
    if (at === null || typeof at !== "object") throw new Error(`tuning: "${segs.slice(0, i).join(".")}" is not an object, so "${path}" cannot be reached`);
    if (!has(at as object, segs[i])) throw new Error(`tuning: no "${segs[i]}" in "${segs.slice(0, i).join(".")}" (path "${path}")`);
    if (i < segs.length - 1) at = (at as Bag)[segs[i]];
  }
  return [at as Bag, segs[segs.length - 1]];
}

/**
 * Change content by path. Throws (and changes nothing) if any path is
 * unknown, missing, runs through a non-object, or gives a value of another
 * type than the one it replaces. Returns an undo that puts the old values back.
 */
export function applyTuning(changes: Record<string, unknown>): () => void {
  const plan: Array<{ holder: Bag; key: string; value: unknown }> = [];
  for (const [path, value] of Object.entries(changes)) {
    const [holder, key] = locate(path);
    const old = holder[key];
    if (kindOf(old) !== kindOf(value)) throw new Error(`tuning: "${path}" is a ${kindOf(old)}, not a ${kindOf(value)}`);
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`tuning: "${path}" must be a finite number`);
    plan.push({ holder, key, value });
  }
  const undo: Array<{ holder: Bag; key: string; old: unknown }> = [];
  for (const p of plan) {
    undo.push({ holder: p.holder, key: p.key, old: p.holder[p.key] });
    p.holder[p.key] = p.value;
  }
  clearArmedCache();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (let i = undo.length - 1; i >= 0; i--) undo[i].holder[undo[i].key] = undo[i].old;
    clearArmedCache();
  };
}
