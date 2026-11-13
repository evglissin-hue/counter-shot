// Standing orders (V3): switches the page holds until told otherwise (reset each
// match). Each acts through the same inputs a key would send.

import { BUILDINGS, BUILDING_KINDS, BUILDING_REBUILD, type RepairKind } from "@keepfall/content";
import type { MatchInput } from "@keepfall/rules";
import { STANDING_ORDERS, type StandingId } from "@keepfall/orders";
import { POWDER_INPUT, wantsPowder } from "./powder";

/** What a check reads of the match. */
export interface StandingCtx {
  gateOpen: boolean;
  gold: number;
  repairs: Record<RepairKind, boolean>;
  /** The player's plots: kind index (-1 none) and state (0 empty, 1 rising, 2 standing, 3 ruined). */
  plots: Array<{ kind: number; state: number }>;
  /** 3.3: your store (charges, what it holds, the plot of the working magazine or -1), or null in a match without powder. */
  powder?: { stock: number; cap: number; magazine: number } | null;
}

export interface StandingHooks {
  act: (input: MatchInput) => void;
  note: (text: string, ms: number) => void;
}

const CHECK_MS = 500;
const RETRY_MS = 5000;
const SIDE_REPAIRS: RepairKind[] = ["walls", "towers", "keep"];

export class Standing {
  private on = new Set<StandingId>();
  private nextCheck = 0;
  /** gateFirst: the repairs it switched off, to put back. Null: not acting. */
  private turnedOff: RepairKind[] | null = null;
  private lastRebuild = new Map<number, number>();
  private lastPowder = -1e9;

  constructor(private hooks: StandingHooks) {}

  list(): StandingId[] {
    return [...this.on];
  }

  has(id: StandingId): boolean {
    return this.on.has(id);
  }

  reset() {
    this.on.clear();
    this.turnedOff = null;
    this.lastRebuild.clear();
    this.lastPowder = -1e9;
    this.nextCheck = 0;
  }

  set(id: StandingId, on: boolean) {
    if (on) this.on.add(id);
    else {
      this.on.delete(id);
      if (id === "gateFirst") this.restore();
    }
  }

  /** Called every frame with the match; it does its work about twice a second. */
  tick(now: number, ctx: StandingCtx) {
    if (now < this.nextCheck) return;
    this.nextCheck = now + CHECK_MS;
    if (this.on.has("gateFirst")) this.gateFirst(ctx);
    if (this.on.has("rebuild")) this.rebuild(now, ctx);
    if (this.on.has("powder") && wantsPowder(now, this.lastPowder, { gold: ctx.gold, powder: ctx.powder ?? null })) {
      this.lastPowder = now;
      this.hooks.act(POWDER_INPUT);
      this.hooks.note("Steward: bought powder", 3000);
    }
  }

  private gateFirst(ctx: StandingCtx) {
    if (ctx.gateOpen && !this.turnedOff) {
      this.turnedOff = SIDE_REPAIRS.filter((k) => ctx.repairs[k] !== false);
      for (const k of this.turnedOff) this.hooks.act({ kind: "repair", repair: k, on: false });
      if (ctx.repairs.gate === false) this.hooks.act({ kind: "repair", repair: "gate", on: true });
      this.hooks.note("Steward: masons to the gate first", 3000);
    } else if (!ctx.gateOpen && this.turnedOff) this.restore();
  }

  private restore() {
    const off = this.turnedOff;
    this.turnedOff = null;
    if (!off) return;
    for (const k of off) this.hooks.act({ kind: "repair", repair: k, on: true });
    if (off.length) this.hooks.note("Steward: masons back on the walls", 3000);
  }

  private rebuild(now: number, ctx: StandingCtx) {
    for (let i = 0; i < ctx.plots.length; i++) {
      const p = ctx.plots[i];
      if (p.state !== 3 || p.kind < 0) continue;
      const kind = BUILDING_KINDS[p.kind];
      const cost = Math.round(BUILDINGS[kind].cost * BUILDING_REBUILD);
      if (ctx.gold < cost) continue;
      const at = this.lastRebuild.get(i);
      if (at !== undefined && now - at < RETRY_MS) continue;
      this.lastRebuild.set(i, now);
      this.hooks.act({ kind: "build", plot: i, building: kind });
      this.hooks.note(`Steward: rebuilding the ${BUILDINGS[kind].name}`, 3000);
      return;
    }
  }
}

export const standingName = (id: StandingId): string => STANDING_ORDERS[id].name;
