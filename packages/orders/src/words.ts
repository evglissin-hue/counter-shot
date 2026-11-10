// The steward's word lists, as data.
import type { StandingId } from "./types";

/** Standing orders: their names as the panel lists them. */
export const STANDING_ORDERS: Record<StandingId, { name: string; blurb: string }> = {
  gateFirst: { name: "Keep the gate mended first", blurb: "While your gate is open, masons work only on the gate" },
  rebuild: { name: "Rebuild what falls", blurb: "A wrecked building is rebuilt for half as soon as the gold is there" },
};
