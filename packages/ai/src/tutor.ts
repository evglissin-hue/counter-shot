// The tutor's stages (phase 2 M6, the guided first match): asleep, stirring,
// waking, fighting (TUTOR in @keepfall/content has the times). The stage only
// goes up, one at a time, and is judged from the match alone (what the player
// has built, bought and ordered, and the clock), so a guided match replays
// from its seed and the player's inputs. The gunner and the steward read it.

import { PLOTS, SLOTS_PER_CASTLE, TUTOR } from "@keepfall/content";
import { Order, PlotState } from "@keepfall/sim";
import { firstSlot, type Match } from "@keepfall/rules";

export class Tutor {
  /** 0 asleep, 1 stirs, 2 wakes, 3 fights. */
  stage = 0;
  /** Ticks at which stages 1 and 2 began. */
  private at = [0, 0, 0];
  private foe: number;
  /** What the player's castle held when the match began: only more than this counts as the player doing something. */
  private built0: number;
  private guns0: number;

  constructor(private m: Match, team: number) {
    this.foe = 1 - team;
    this.built0 = this.built();
    this.guns0 = this.guns();
  }

  private built(): number {
    const st = this.m.world.structures!;
    let n = 0;
    for (let p = 0; p < PLOTS.length; p++) if (st.slot(this.foe, p).state !== PlotState.Empty) n++;
    return n;
  }

  private guns(): number {
    let n = 0;
    const first = firstSlot(this.foe);
    for (let i = first; i < first + SLOTS_PER_CASTLE; i++) if (this.m.emplacements[i] && !this.m.emplacements[i].empty) n++;
    return n;
  }

  /** Once a tick: has the match brought it to the next stage? */
  update(tick: number) {
    if (this.stage >= 3) return;
    const s = TUTOR, m = this.m;
    const ordered = m.army.order[this.foe] !== Order.Hold;
    if (this.stage === 0) {
      const acted = this.built() > this.built0 || this.guns() > this.guns0 || ordered;
      if ((acted && tick >= s.stirsFrom * 60) || tick >= s.stirsBy * 60) this.go(1, tick);
    } else if (this.stage === 1) {
      const since = tick - this.at[1];
      if (since >= s.wakesAfter * 60 || (ordered && since >= s.wakesSoonest * 60)) this.go(2, tick);
    } else if (tick - this.at[2] >= s.fightsAfter * 60) this.go(3, tick);
  }

  private go(stage: number, tick: number) {
    this.stage = stage;
    this.at[stage] = tick;
  }
}
