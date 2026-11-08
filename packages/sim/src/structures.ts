// Plot buildings in the world (phase 2 M3). Every kind of building stands
// ready on every plot in the layout (content's buildings.ts); at the start
// all of them leave the world, and what is built rises piece by piece from
// the ground up: a piece goes up only when its place is clear (rubble lying
// in it is carried off, a fallen body buried; a minion standing in it is
// waited for). A finished building works while at least BUILDING_WORKS of
// its pieces stand; below that it is a ruin until it is rebuilt.
//
// Deterministic: plots are visited in a fixed order, pieces rise in layout
// order on fixed ticks, and the only queries are Rapier's, sorted.

import { BUILDING_KINDS, BUILDING_WORKS, BUILDINGS, PLOTS, type CastleLayout } from "@keepfall/content";
import type { CastleSim } from "./castleSim";
import { EventKind, PLOT_STRIDE } from "./frame";
import { MinionState, type Minions } from "./minions";

export const enum PlotState {
  Empty = 0,
  /** Going up, piece by piece. */
  Rising = 1,
  /** Finished; it works while enough of it stands. */
  Standing = 2,
  /** Too much of it came down: it does not work until it is rebuilt. */
  Ruined = 3,
}

/** Ticks between tries when a piece's place is not clear. */
const RETRY = 15;
/** Ticks between counts of what still stands. */
const COUNT_EVERY = 10;

interface PlotSlot {
  castle: 0 | 1;
  plot: number;
  /** Index into BUILDING_KINDS, or -1 for none. */
  kind: number;
  state: PlotState;
  /** The pieces of what is built here, lowest first. */
  ids: number[];
  /** Next piece to raise, and the tick it is due. */
  next: number;
  due: number;
  every: number;
  /** Pieces standing as of the last count. */
  up: number;
}

type Emit = (kind: EventKind, a: number, b: number, c: number, d: number) => void;

export class Structures {
  /** Castle 0's plots, then castle 1's (PLOTS order). */
  readonly plots: PlotSlot[] = [];
  private layout: CastleLayout;
  /** Pieces of each kind on each plot: [castle][plot][kind] -> ids. */
  private pieces: number[][][][] = [[], []];

  constructor(
    private castle: CastleSim,
    private minions: Minions,
    private ground: ReadonlySet<number>,
    private emit: Emit,
  ) {
    this.layout = castle.layout;
    for (const c of [0, 1] as const) {
      for (const p of PLOTS) {
        this.pieces[c][p.index] = BUILDING_KINDS.map(() => []);
        this.plots.push({ castle: c, plot: p.index, kind: -1, state: PlotState.Empty, ids: [], next: 0, due: 0, every: 1, up: 0 });
      }
    }
    for (const r of this.layout.plots) {
      const list = this.pieces[r.castle][r.plot][r.kind];
      for (let id = r.first; id < r.first + r.count; id++) list.push(id);
    }
  }

  /** The plot slot of a castle's plot. */
  slot(castle: number, plot: number): PlotSlot {
    return this.plots[castle * PLOTS.length + plot];
  }

  /** Every ready piece leaves the world (once, before anything is built and before the nav grid is made). */
  clearAll() {
    for (const r of this.layout.plots) for (let id = r.first; id < r.first + r.count; id++) this.castle.withdraw(id);
  }

  /** A building stands here at once (a match's start, the Practice range). */
  place(castle: number, plot: number, kind: number) {
    const s = this.slot(castle, plot);
    s.kind = kind;
    s.ids = this.pieces[castle][plot][kind];
    for (const id of s.ids) this.castle.restore(id);
    s.next = s.ids.length;
    s.up = s.ids.length;
    s.state = PlotState.Standing;
  }

  /** Start a building rising on an empty plot (the rules have checked the gold). False if the plot is not empty. */
  build(castle: number, plot: number, kind: number, tick: number): boolean {
    const s = this.slot(castle, plot);
    if (s.state !== PlotState.Empty || kind < 0 || kind >= BUILDING_KINDS.length) return false;
    s.kind = kind;
    s.ids = this.pieces[castle][plot][kind];
    s.every = Math.max(1, Math.floor(BUILDINGS[BUILDING_KINDS[kind]].buildTicks / s.ids.length));
    s.next = 0;
    s.due = tick + s.every;
    s.up = 0;
    s.state = PlotState.Rising;
    return true;
  }

  /** Rebuild a ruin: its missing pieces rise again. False if it is not a ruin. */
  rebuild(castle: number, plot: number, tick: number): boolean {
    const s = this.slot(castle, plot);
    if (s.state !== PlotState.Ruined) return false;
    s.every = Math.max(1, Math.floor(BUILDINGS[BUILDING_KINDS[s.kind]].buildTicks / s.ids.length));
    s.next = 0;
    s.due = tick + s.every;
    s.state = PlotState.Rising;
    return true;
  }

  /** Does the building on this plot work (finished, and enough of it standing)? */
  works(castle: number, plot: number): boolean {
    const s = this.slot(castle, plot);
    return s.state === PlotState.Standing;
  }

  /** The share of the building's pieces standing (0 for an empty plot). */
  health(castle: number, plot: number): number {
    const s = this.slot(castle, plot);
    return s.ids.length ? s.up / s.ids.length : 0;
  }

  /** Raise what is due, then see what still stands. Call before the physics step. */
  step(tick: number) {
    for (const s of this.plots) {
      if (s.state === PlotState.Rising && tick >= s.due) this.raiseNext(s, tick);
    }
    if (tick % COUNT_EVERY !== 0) return;
    const dyn = this.castle.dynamic;
    for (const s of this.plots) {
      if (s.kind < 0) continue;
      let up = 0;
      for (const id of s.ids) if (!dyn[id]) up++;
      s.up = up;
      if (s.state === PlotState.Standing && up < s.ids.length * BUILDING_WORKS) s.state = PlotState.Ruined;
    }
  }

  private raiseNext(s: PlotSlot, tick: number) {
    const dyn = this.castle.dynamic;
    // Skip what already stands.
    while (s.next < s.ids.length && !dyn[s.ids[s.next]]) s.next++;
    if (s.next >= s.ids.length) {
      // Anything knocked down while it rose goes up again before it counts as finished.
      let k = 0;
      while (k < s.ids.length && !dyn[s.ids[k]]) k++;
      if (k < s.ids.length) {
        s.next = k;
      } else {
        s.state = PlotState.Standing;
        s.up = s.ids.length;
        this.emit(EventKind.Built, s.castle, s.plot, s.kind, 0);
        return;
      }
    }
    const id = s.ids[s.next];
    const { pieces, other } = this.castle.inPlace(id, this.ground);
    let blocked = false;
    for (const h of other) {
      const mid = this.minions.of(h);
      if (mid === undefined) {
        blocked = true; // a shot lying in it, or something else: wait
        continue;
      }
      const m = this.minions.list[mid];
      // The fallen are carried off and buried; the living are waited for.
      if (m.state === MinionState.Frozen) this.minions.bury(mid);
      else if (m.state !== MinionState.Sinking && m.state !== MinionState.Gone) blocked = true;
    }
    for (const p of pieces) {
      // Rubble in the way is carried off; rubble still moving is waited for.
      if (this.castle.frozen[p]) {
        const b = this.castle.bodies[p].translation();
        if (this.castle.carryOff(p)) this.emit(EventKind.Raised, -1, b.x, b.y, b.z);
      } else blocked = true;
    }
    if (blocked || pieces.length) {
      s.due = tick + RETRY;
      return;
    }
    if (this.castle.restore(id)) {
      const st = this.layout.stones[id];
      this.emit(EventKind.Raised, id, st.x, st.y, st.z);
    }
    s.next++;
    s.due = tick + s.every;
  }

  /** [castle, plot, kind, state, share raised, health] per plot. */
  collect(out: Float32Array): number {
    let n = 0;
    for (const s of this.plots) {
      if ((n + 1) * PLOT_STRIDE > out.length) break;
      const o = n * PLOT_STRIDE;
      const total = s.ids.length || 1;
      out[o] = s.castle;
      out[o + 1] = s.plot;
      out[o + 2] = s.kind;
      out[o + 3] = s.state;
      out[o + 4] = s.state === PlotState.Rising ? s.next / total : s.kind >= 0 ? 1 : 0;
      out[o + 5] = s.kind >= 0 ? s.up / total : 0;
      n++;
    }
    return n;
  }

  hashInto(out: number[]) {
    for (const s of this.plots) out.push(s.kind, s.state, s.next, s.due, s.up);
  }
}
