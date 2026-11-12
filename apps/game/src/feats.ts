// The book of feats (track S, step S1): named firsts and bests, each a rule
// over moments. Only the player's own doing counts. Kept per viewer in
// localStorage (the page works without it); feats pay no gold.

import type { Moment, MomentKind } from "./moments";

export interface FeatDef {
  id: string;
  name: string;
  /** What to do, said plainly (shown dimmed until earned). */
  hint: string;
  /** What the best is counted in ("men", "stones", "m", or "" for a feat with no size). */
  unit: string;
  /** The value this moment makes of the feat (its size), or null when the moment does not count. */
  rule: (m: Moment) => number | null;
}

const of = (kinds: MomentKind | MomentKind[], min = 1, pick: (m: Moment) => number = (m) => m.size) => {
  const ks = Array.isArray(kinds) ? kinds : [kinds];
  return (m: Moment): number | null => {
    if (!ks.includes(m.kind)) return null;
    const v = pick(m);
    return v >= min ? v : null;
  };
};
const men = (m: Moment) => m.men ?? m.size;

export const FEATS: FeatDef[] = [
  { id: "skittles", name: "Skittles", hint: "Knock down three men with one shot", unit: "men", rule: of("multiKill", 3) },
  { id: "strike", name: "Strike", hint: "Knock down five men with one shot", unit: "men", rule: of("multiKill", 5) },
  { id: "squad", name: "A whole squad", hint: "Knock down eight men with one shot", unit: "men", rule: of("multiKill", 8) },
  { id: "skipping", name: "Skipping stone", hint: "Fell a man with a ball that glanced off stone first", unit: "men", rule: of("ricochetKill") },
  { id: "domino", name: "Domino", hint: "Bury five men under falling masonry", unit: "men", rule: of(["collapseKill", "towerDown", "breachOpened"], 5, men) },
  { id: "timber", name: "Timber", hint: "Bring down a tower", unit: "stones", rule: of("towerDown") },
  { id: "rubble", name: "Mountain of rubble", hint: "Bring down a tower of 150 stones or more", unit: "stones", rule: of("towerDown", 150) },
  { id: "breach", name: "Hole in the wall", hint: "Open a breach in an enemy wall", unit: "stones", rule: of("breachOpened") },
  { id: "gate", name: "Gate crasher", hint: "Break down the enemy gate", unit: "", rule: of("gateDown") },
  { id: "roof", name: "Roof off", hint: "Cave in a floor of the enemy keep", unit: "", rule: of("floorCaved") },
  { id: "flag", name: "Flag down", hint: "Bring the enemy banner to the ground", unit: "", rule: of("bannerDown") },
  { id: "silencer", name: "Silencer", hint: "Knock out an enemy gun", unit: "", rule: of("gunSilenced") },
  { id: "powder", name: "Powder train", hint: "Set off three kegs in a chain", unit: "kegs", rule: of("kegChain", 3) },
  { id: "sender", name: "Return to sender", hint: "Burst a keg among the men who set it", unit: "men", rule: of("kegBack") },
  { id: "hurled", name: "Hurled", hint: "Throw a man 20 m or more", unit: "m", rule: of("thrown", 20) },
  { id: "hill", name: "Over the hill", hint: "Throw a man 35 m or more", unit: "m", rule: of("thrown", 35) },
  { id: "wrecker", name: "Wrecker", hint: "Wreck an enemy building", unit: "", rule: of(["buildingWrecked", "magazine"]) },
  { id: "kegfeat", name: "Powder keg", hint: "Blow up the enemy magazine", unit: "charges", rule: of("magazine") },
  { id: "wet", name: "Wet feet", hint: "Drop a bridge with men on it", unit: "men", rule: of("bridgeDown") },
  { id: "yard", name: "Over the wall", hint: "Begin a storm of the enemy courtyard", unit: "", rule: of("stormBegun") },
  { id: "hold", name: "Hold the yard", hint: "Beat off an enemy storm", unit: "", rule: of("stormBeaten") },
  { id: "word", name: "The last word", hint: "Deal the blow that ends a match", unit: "", rule: of("lastBlow") },
  { id: "show", name: "Showpiece", hint: "Make a moment worth a film", unit: "pts", rule: (m) => (m.score >= 500 ? m.score : null) },
];

export interface FeatRecord {
  /** The date of the first time (YYYY-MM-DD) and the best value so far. */
  first: string;
  best: number;
}

export interface FeatRow {
  def: FeatDef;
  record: FeatRecord | null;
}

/** The slice of localStorage that feats use. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const FEATS_KEY = "keepfall.feats.v1";

export interface FeatsOptions {
  /** The team this page plays: only its doing counts. */
  me: number;
  /** Where records are kept; defaults to localStorage. Any call may throw: the book still works for the session. */
  store?: Store | null;
  today?: () => string;
  /** Feats earned for the first time by one moment (one call per moment, in the book's order). */
  onFirsts?: (earned: Array<{ def: FeatDef; value: number }>) => void;
  /** A feat's best beaten (not the first time). */
  onBest?: (def: FeatDef, value: number) => void;
}

export class Feats {
  private records = new Map<string, FeatRecord>();
  me: number;

  constructor(private o: FeatsOptions) {
    this.me = o.me;
    this.load();
  }

  private store(): Store | null {
    if (this.o.store !== undefined) return this.o.store;
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  private load() {
    try {
      const raw = this.store()?.getItem(FEATS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, FeatRecord>;
      for (const def of FEATS) {
        const r = data[def.id];
        if (r && typeof r.first === "string" && typeof r.best === "number") this.records.set(def.id, { first: r.first, best: r.best });
      }
    } catch {
      /* private window, blocked or damaged storage: start with an empty book */
    }
  }

  private save() {
    try {
      const out: Record<string, FeatRecord> = {};
      for (const [id, r] of this.records) out[id] = r;
      this.store()?.setItem(FEATS_KEY, JSON.stringify(out));
    } catch {
      /* the book still holds this session's feats */
    }
  }

  /** Look at a moment: earn or better any feat it meets. */
  observe(m: Moment) {
    if (m.team !== this.me) return;
    let changed = false;
    const firsts: Array<{ def: FeatDef; value: number }> = [];
    for (const def of FEATS) {
      const v = def.rule(m);
      if (v === null) continue;
      const had = this.records.get(def.id);
      if (!had) {
        this.records.set(def.id, { first: this.today(), best: v });
        changed = true;
        firsts.push({ def, value: v });
      } else if (v > had.best) {
        had.best = v;
        changed = true;
        this.o.onBest?.(def, v);
      }
    }
    if (changed) this.save();
    if (firsts.length) this.o.onFirsts?.(firsts);
  }

  private today(): string {
    if (this.o.today) return this.o.today();
    return new Date().toISOString().slice(0, 10);
  }

  /** Every feat in the book's order, with its record if earned. */
  list(): FeatRow[] {
    return FEATS.map((def) => ({ def, record: this.records.get(def.id) ?? null }));
  }

  earned(): number {
    return this.records.size;
  }
}

/** The best of a feat, in words: "5 men", "212 stones", "24 m", or nothing for a feat with no size. */
export function bestText(def: FeatDef, r: FeatRecord): string {
  return def.unit ? `${r.best} ${def.unit}` : "";
}
