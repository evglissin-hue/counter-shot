// The match's economy and clock, as data. Phase 2 M1 has only the keep's own
// income; mills, bounties, masonry and trick shots join in M3. Since M4 gold
// pays for repairs (see siege.ts).

import { KEEP_STOREYS, type Stone } from "./castle";
import type { WeaponKind } from "./weapons";

/** Is this piece part of a keep (its walls, its floors, its battlements)? */
export function isKeepPiece(s: Stone): boolean {
  return s.castle !== 2 && (s.part === "keep" || s.part === "storey" || s.part === "floor" || (s.part === "merlon" && s.course === KEEP_STOREYS[KEEP_STOREYS.length - 1]));
}

export const MATCH = {
  /** Gold each castle starts with. */
  startGold: 150,
  /** Gold a standing keep earns its castle every `incomeEvery` ticks. */
  keepIncome: 5,
  incomeEvery: 60,
  /** Sudden death starts here: income doubles and every gun reloads in `suddenReload` of its time. */
  suddenDeathTick: 15 * 60 * 60,
  suddenIncome: 2,
  suddenReload: 0.6,
} as const;

/**
 * Gold a team earns besides its income (phase 2 M3). Every enemy minion
 * knocked down pays a bounty, whatever knocked him down; enemy masonry
 * brought down pays a gold for every `masonryPer` pieces (the keep's count
 * `keepWeight` times). Trick shots pay only for shots a gunner fires himself.
 */
export const GOLD = {
  bounty: 4,
  masonryPer: 4,
  keepWeight: 2,
  trick: {
    /** A ball that glanced off stone, then knocked a minion down. */
    ricochet: 15,
    /** An enemy knocked down by his own castle's masonry falling. */
    collapse: 10,
    /**
     * One shot, at least `multiMin` enemies down (by the gun that fired it):
     * `multiPer` a man. A shell in the middle of a wave downs most of it by
     * design, so the mortar needs more for a trick. A shot's tally closes
     * `multiWait` ticks after its last knockdown.
     */
    multiMin: { longGun: 3, chainShot: 3, swivel: 4, mortar: 6 } as Record<WeaponKind, number>,
    multiPer: 5,
    multiWait: 45,
    /** A shot whose first touch is the enemy keep. */
    keep: 10,
  },
} as const;

/** Kinds of earnings, for the page's feed (MatchInfo.earned). */
export const enum Earn {
  Income = 0,
  Bounty = 1,
  Masonry = 2,
  Ricochet = 3,
  Collapse = 4,
  MultiKill = 5,
  KeepHit = 6,
}
