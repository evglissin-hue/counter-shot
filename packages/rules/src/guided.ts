// The guided first match (phase 2 M6): a match against the tutor, a passive
// AI castle that wakes up in stages (TUTOR in @keepfall/content; the tutor
// itself is in @keepfall/ai). The match is an ordinary one with two changes,
// all as options: the tutor's castle starts with its magazine but no barracks (it raises one
// when it stirs, so its waves start late), and your waves start on Hold at the
// midfield marker of the left flank (they wait there until you send them in).
// The flank, not the centre road: the centre marker lies under your mortar's
// line to the enemy keep, so a newcomer's early shell fell on their own waves
// and the centre bridge (the player's chair, M6). Your castle is team 1
// (Team.Player), as in Versus AI.

import { START_BUILDINGS } from "@keepfall/content";
import { Order } from "@keepfall/sim";
import { Team, type MatchOptions } from "./match";

export const GUIDED_OPTIONS: Omit<MatchOptions, "seed"> = {
  plan: false,
  rotate: false,
  startBuildings: [[{ plot: 5, kind: "magazine" }], START_BUILDINGS],
  orders: [Order.Advance, Order.Hold],
  routes: ["centre", "left"],
  // The tutor's guns never fire on their own (the player's chair: its chain shot and swivel cut down every wave
  // before its gate, so waves could never break in); it fires by hand as it wakes. Yours fire on their own as ever.
  gunnery: [false, true],
};

/** The team the tutor commands in the guided match. */
export const TUTOR_TEAM = Team.Enemy;
