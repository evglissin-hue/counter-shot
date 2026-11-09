// The guided first match (phase 2 M6): a match against the tutor, a passive
// AI castle that wakes up in stages (TUTOR in @keepfall/content; the tutor
// itself is in @keepfall/ai). The match is an ordinary one with two changes,
// both as options: the tutor's castle starts with no barracks (it raises one
// when it stirs, so its waves start late), and your waves start on Hold at the
// midfield marker (they wait there until you send them in). Your castle is
// team 1 (Team.Player), as in Versus AI.

import { START_BUILDINGS } from "@keepfall/content";
import { Order } from "@keepfall/sim";
import { Team, type MatchOptions } from "./match";

export const GUIDED_OPTIONS: Omit<MatchOptions, "seed"> = {
  plan: false,
  rotate: false,
  startBuildings: [[], START_BUILDINGS],
  orders: [Order.Advance, Order.Hold],
};

/** The team the tutor commands in the guided match. */
export const TUTOR_TEAM = Team.Enemy;
