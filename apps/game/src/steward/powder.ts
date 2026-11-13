// The standing order "Buy powder under twenty" (3.3): whenever the store is under
// 20 charges, a magazine works, there is room for all of a purchase and the gold
// is there, buy powder (the same input the build menu sends), at most once every 5 s.

import { POWDER } from "@keepfall/content";
import type { MatchInput } from "@keepfall/rules";

/** The store under which the order buys. */
export const POWDER_LOW = 20;
/** The least gap between two purchases (ms). */
export const POWDER_GAP_MS = 5000;

export interface PowderCtx {
  gold: number;
  /** The team's store: charges, what it holds, and the plot of the working magazine (-1: none). Null: a match without powder. */
  powder: { stock: number; cap: number; magazine: number } | null;
}

/** Should the order buy now? (`last` is when it last bought, ms; -1e9 for never.) */
export function wantsPowder(now: number, last: number, ctx: PowderCtx): boolean {
  const p = ctx.powder;
  if (!p || p.magazine < 0) return false;
  if (p.stock >= POWDER_LOW || p.cap - p.stock < POWDER.buy.charges || ctx.gold < POWDER.buy.gold) return false;
  return now - last >= POWDER_GAP_MS;
}

export const POWDER_INPUT: MatchInput = { kind: "powder" };
