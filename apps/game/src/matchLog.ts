// Track S6: the match's input log and the replay file. A match is only its setup
// and the inputs it applied (the AI's and the players'): run again from the same
// setup with the same inputs on the same ticks it ends at the same hash. The worker
// records every input the match applies (Match.onInput), writes a file on request,
// and "Watch a replay" runs a file as a match with nobody driving it.
//
// No DOM, no worker here: Node tests use this module as the page does.

import { AI_LEVELS, buildLayout, BODY_CAP, BUILDING_WORKS, BUILDINGS, GAME_LAYOUT, GOLD, GUN_HITS, KEG, LADDER, MATCH, MATCH_EMPLACEMENTS, MUSKET, PLOTS, REMOUNT, REPAIR, START_BUILDINGS, STORM, UNITS, UNMANNED, UPGRADES, WAVES, WEAPONS, type CastleLayout, type Difficulty } from "@keepfall/content";
import { hashString } from "@keepfall/core";
import { MATCH_RULES_VERSION, type MatchInput, type MatchOptions } from "@keepfall/rules";
import { RULES_VERSION } from "@keepfall/sim";

export const REPLAY_FORMAT = "keepfall-replay";
export const REPLAY_V = 1;

/** Modes whose matches have a log (the Practice range has no match). */
export type LoggedMode = "versus" | "guided" | "online";

export interface ReplaySetup {
  mode: LoggedMode;
  /** The Match constructor's options exactly as the worker built them. */
  opts: MatchOptions;
  /** The AI's difficulty (for the label only: the log holds what it did). */
  difficulty?: Difficulty;
  /** The team the saver played. */
  team: 0 | 1;
  rulesVersion: number;
  matchRulesVersion: number;
  netVersion: number;
  /** Hash of the content the rules read (contentHash). */
  content: string;
}

/** [tick, team, seat, input]: seat is 0 (reserved for more than one player a team). */
export type ReplayEntry = [number, 0 | 1, number, MatchInput];

export interface ReplayFile {
  format: typeof REPLAY_FORMAT;
  v: typeof REPLAY_V;
  setup: ReplaySetup;
  saved: string;
  final: { tick: number; hash: { state: string; world: string } };
  inputs: ReplayEntry[];
}

/** What the content hash covers: the layout's stones, and the tables the rules and the sim read from @keepfall/content (CONTENT_TABLES). */
export const CONTENT_TABLES = ["WEAPONS", "BUILDINGS", "BUILDING_WORKS", "MATCH", "GOLD", "WAVES", "STORM", "REPAIR", "PLOTS", "START_BUILDINGS", "UNITS", "UNMANNED", "UPGRADES", "KEG", "MUSKET", "LADDER", "GUN_HITS", "REMOUNT", "BODY_CAP", "MATCH_EMPLACEMENTS"] as const;

/** A hash of the game's content as the rules read it, to tell a file saved on other content. */
export function contentHash(layout: CastleLayout): string {
  const stones = layout.stones.map((s) => [s.id, s.castle, s.x, s.y, s.z, s.hx, s.hy, s.hz, s.material]);
  const tables = { WEAPONS, BUILDINGS, BUILDING_WORKS, MATCH, GOLD, WAVES, STORM, REPAIR, PLOTS, START_BUILDINGS, UNITS, UNMANNED, UPGRADES, KEG, MUSKET, LADDER, GUN_HITS, REMOUNT, BODY_CAP, MATCH_EMPLACEMENTS };
  return hashString(JSON.stringify({ stones, tables })).toString(16).padStart(8, "0");
}

/** The versions this build runs (the layout is the game's own: GAME_LAYOUT). */
export interface Versions {
  rulesVersion: number;
  matchRulesVersion: number;
  content: string;
}

let cached: Versions | null = null;
export function currentVersions(layout?: CastleLayout): Versions {
  if (cached) return cached;
  const v = { rulesVersion: RULES_VERSION, matchRulesVersion: MATCH_RULES_VERSION, content: contentHash(layout ?? buildLayout(1, GAME_LAYOUT)) };
  cached = v;
  return v;
}

export function makeSetup(mode: LoggedMode, opts: MatchOptions, team: 0 | 1, netVersion: number, layout: CastleLayout, difficulty?: Difficulty): ReplaySetup {
  return { mode, opts: JSON.parse(JSON.stringify(opts)) as MatchOptions, difficulty, team, netVersion, ...currentVersions(layout) };
}

/**
 * The log of a match. Aim inputs only draw a barrel: one in four is kept per team, and a team's latest aim
 * is kept as well whenever that team's next other input is logged (and when the file is written), so the
 * barrel each gun was left at is never lost.
 */
export class MatchLog {
  private list: ReplayEntry[] = [];
  private aims = [0, 0];
  private pending: Array<ReplayEntry | null> = [null, null];
  /** Keep one aim input in this many. */
  static readonly AIM_EVERY = 4;

  record(tick: number, team: number, input: MatchInput) {
    const t = team === 0 ? 0 : 1;
    if (input.kind === "aim") {
      if (this.aims[t]++ % MatchLog.AIM_EVERY === 0) {
        this.list.push([tick, t, 0, input]);
        this.pending[t] = null;
      } else this.pending[t] = [tick, t, 0, input];
      return;
    }
    const p = this.pending[t];
    if (p) {
      this.list.push(p);
      this.pending[t] = null;
    }
    this.list.push([tick, t, 0, input]);
  }

  get length(): number {
    return this.list.length;
  }

  /** Every entry so far, plus each team's latest aim not kept yet, in tick order (the order within a tick is each team's own). */
  entries(): ReplayEntry[] {
    const all = this.list.slice();
    for (const p of this.pending) if (p) all.push(p);
    // Stable: a team's inputs of one tick stay in the order applied.
    return all
      .map((e, i) => [e, i] as const)
      .sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1])
      .map(([e]) => e);
  }
}

/** The file's text. */
export function writeLog(setup: ReplaySetup, entries: ReplayEntry[], tick: number, hash: { state: string; world: string }, saved = new Date()): string {
  const file: ReplayFile = { format: REPLAY_FORMAT, v: REPLAY_V, setup, saved: saved.toISOString(), final: { tick, hash: { state: hash.state, world: hash.world } }, inputs: entries };
  return JSON.stringify(file);
}

/** `keepfall-replay-2026-11-10-1432.json` (the saver's local time). */
export function replayFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `keepfall-replay-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

const KINDS = ["fire", "aim", "order", "route", "man", "repair", "surrender", "build", "buy", "upgrade", "barracks", "mark", "salvo", "powder", "buttress"];
const MODES = ["versus", "guided", "online"];
/** A bound against a file made to hang the page: no match is longer than this. */
const MAX_TICKS = 200000;
const MAX_INPUTS = 400000;

export type ReadResult = { ok: true; log: ReplayFile } | { ok: false; why: string };

const isHash = (h: unknown) => typeof h === "string" && /^[0-9a-f]{8}$/.test(h);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function readLog(text: string, now: Versions = currentVersions()): ReadResult {
  const notReplay = { ok: false as const, why: "This is not a Keepfall replay." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return notReplay;
  }
  if (!isObj(raw) || raw.format !== REPLAY_FORMAT) return notReplay;
  if (raw.v !== REPLAY_V) return { ok: false, why: "This replay file is from another version of the game." };
  const s = raw.setup;
  if (!isObj(s) || !MODES.includes(s.mode as string) || !isObj(s.opts) || (s.team !== 0 && s.team !== 1)) return { ok: false, why: "This replay file is damaged (its setup is not readable)." };
  if (s.rulesVersion !== now.rulesVersion) return { ok: false, why: `This replay was saved with rules version ${String(s.rulesVersion)} (this game runs ${now.rulesVersion}): it would not play out the same.` };
  if (s.matchRulesVersion !== now.matchRulesVersion) return { ok: false, why: `This replay was saved with match rules version ${String(s.matchRulesVersion)} (this game runs ${now.matchRulesVersion}): it would not play out the same.` };
  if (s.content !== now.content) return { ok: false, why: `This replay was saved with other content (hash ${String(s.content)}; this game's is ${now.content}): it would not play out the same.` };
  const f = raw.final;
  if (!isObj(f) || !Number.isInteger(f.tick) || (f.tick as number) < 0 || (f.tick as number) > MAX_TICKS || !isObj(f.hash) || !isHash(f.hash.state) || !isHash(f.hash.world)) return { ok: false, why: "This replay file is damaged (its end is not readable)." };
  const inputs = raw.inputs;
  if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS) return { ok: false, why: "This replay file is damaged (its inputs are not readable)." };
  for (const e of inputs) {
    const ok = Array.isArray(e) && e.length === 4 && Number.isInteger(e[0]) && e[0] >= 0 && e[0] <= (f.tick as number) && (e[1] === 0 || e[1] === 1) && e[2] === 0 && isObj(e[3]) && KINDS.includes(e[3].kind as string);
    if (!ok) return { ok: false, why: "This replay file is damaged (an input is not well formed)." };
  }
  return { ok: true, log: raw as unknown as ReplayFile };
}

/** A line for the menu: what was played and how long it ran. */
export function describeLog(log: ReplayFile): string {
  const s = log.setup;
  const label = s.mode === "versus" ? `Versus AI${s.difficulty ? `: ${AI_LEVELS[s.difficulty].name}` : ""}` : s.mode === "guided" ? "Guided match" : "Online match";
  const secs = Math.round(log.final.tick / 60);
  return `${label}, ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
