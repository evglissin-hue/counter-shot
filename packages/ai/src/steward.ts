// The AI's steward and general: it builds and buys by its plan in data
// (rebuilding a ruin first, keeping gold back for its masons), sets its
// barracks' mixes and routes, gives its waves their orders and works its
// repair switches. It sends the inputs a player would, and the match judges
// them the same way: a build it cannot pay for is refused.

import {
  AI_PLANS,
  BUILDING_KINDS,
  BUILDING_REBUILD,
  BUILDINGS,
  MIX_NAMES,
  MUSTER,
  PLOTS,
  ROUTE_NAMES,
  UPGRADES,
  WEAPON_COST,
  type AiLevel,
  type AiStep,
  type Difficulty,
  type MixName,
  type RepairKind,
  type RouteName,
} from "@keepfall/content";
import type { Rng } from "@keepfall/core";
import { Order, PlotState } from "@keepfall/sim";
import { firstSlot, type Match, type MatchInput } from "@keepfall/rules";
import * as V from "./view";

export class Steward {
  /** The next step of its plan, and a step it has asked for and waits to see done. */
  step = 0;
  private asked = -1;
  private askedAt = 0;
  private plan: AiStep[];
  private order: Order = Order.Advance;
  /** Tick its standing order was last changed (an order holds a while before it changes again). */
  private orderAt = -1e9;
  private repairs: Record<RepairKind, boolean> = { gate: true, walls: true, towers: true, keep: true };
  /** Each barracks plot's route and mix as it last set them (to send only changes), and which route its waves take next in turn. */
  private routes: Array<RouteName | null> = PLOTS.map(() => null);
  private mixes: Array<MixName | null> = PLOTS.map(() => null);
  private turn = 0;
  private leaves: number[][] | null = null;

  constructor(
    private m: Match,
    private team: number,
    difficulty: Difficulty,
    private L: AiLevel,
    private rng: Rng,
    private send: (tick: number, input: MatchInput) => void,
  ) {
    this.plan = AI_PLANS[difficulty];
    // Its castle as it finds it (M5 audit: taking over a friend's castle mid-match, it assumed Advance and every repair on).
    this.order = m.army.order[team] as Order;
    this.repairs = { ...m.repairs[team] };
  }

  private get gold(): number {
    return this.m.gold[this.team];
  }

  /** One look at the castle: a build or a buy, the barracks, the orders, the repairs. */
  look(tick: number) {
    this.build(tick);
    this.barracks(tick);
    this.orders(tick);
    this.switches(tick);
  }

  private build(tick: number) {
    const m = this.m, team = this.team, st = m.world.structures!;
    // A ruin first (a barracks before anything else), whenever it can be paid for: it costs half.
    for (const kind of [0, 1, 2]) {
      for (let p = 0; p < PLOTS.length; p++) {
        const s = st.slot(team, p);
        if (s.state !== PlotState.Ruined || s.kind !== kind) continue;
        const k = BUILDING_KINDS[kind];
        if (this.gold >= Math.round(BUILDINGS[k].cost * BUILDING_REBUILD)) this.send(tick, { kind: "build", plot: p, building: k });
        return;
      }
    }
    // Then its plan, in order: a step it asked for is checked first.
    if (this.asked === this.step) {
      if (this.done(this.plan[this.step])) {
        const s = this.plan[this.step];
        if (s.kind === "build" && s.building === "barracks" && (s.mix || s.route)) this.send(tick, { kind: "barracks", plot: s.plot, mix: s.mix, route: s.route });
        if (s.kind === "build" && s.building === "barracks") {
          this.mixes[s.plot] = s.mix ?? "pikemen";
          this.routes[s.plot] = s.route ?? "centre";
        }
        this.step++;
        this.asked = -1;
      } else if (tick - this.askedAt < 3 * 60) return; // give it a moment to land
      else this.asked = -1;
    }
    for (; this.step < this.plan.length; this.step++) {
      const s = this.plan[this.step];
      if (this.done(s)) continue;
      if (!this.possible(s)) continue; // the plot is taken, the slot armed: passed over
      // A step waits for its time, unless the gold is piling up (then it hurries on).
      if (tick < (s.after ?? 0) * 60 && this.gold < this.L.reserve + 350) return;
      const cost = this.cost(s);
      if (cost < 0) return; // not yet (an upgrade waiting for its Foundry)
      if (this.gold < cost + this.L.reserve) return;
      this.send(tick, this.input(s));
      this.asked = this.step;
      this.askedAt = tick;
      return;
    }
  }

  /** Is a step done already? */
  private done(s: AiStep | undefined): boolean {
    if (!s) return true;
    const m = this.m;
    if (s.kind === "build") {
      const slot = m.world.structures!.slot(this.team, s.plot);
      return slot.state !== PlotState.Empty && BUILDING_KINDS[slot.kind] === s.building;
    }
    const e = m.emplacements[firstSlot(this.team) + s.slot];
    if (s.kind === "buy") return !!e && !e.empty && e.weapon === s.weapon;
    return !!e && e.upgrade === s.upgrade;
  }

  /** Could a step still be done (or is it in the way of nothing)? */
  private possible(s: AiStep): boolean {
    const m = this.m;
    if (s.kind === "build") return m.world.structures!.slot(this.team, s.plot).state === PlotState.Empty;
    const e = m.emplacements[firstSlot(this.team) + s.slot];
    if (!e) return false;
    if (s.kind === "buy") return !!e.empty && (e.allowed ?? []).includes(s.weapon);
    const u = UPGRADES[s.upgrade];
    return !e.empty && !e.upgrade && !!u && u.weapon === e.weapon;
  }

  /** Gold a step costs now, or -1 while it cannot be done yet. */
  private cost(s: AiStep): number {
    if (s.kind === "build") return BUILDINGS[s.building].cost;
    if (s.kind === "buy") return WEAPON_COST[s.weapon];
    return this.m.estate.foundry(this.team) ? UPGRADES[s.upgrade].cost : -1;
  }

  private input(s: AiStep): MatchInput {
    if (s.kind === "build") return { kind: "build", plot: s.plot, building: s.building };
    if (s.kind === "buy") return { kind: "buy", emplacement: firstSlot(this.team) + s.slot, weapon: s.weapon };
    return { kind: "upgrade", emplacement: firstSlot(this.team) + s.slot, upgrade: s.upgrade };
  }

  /** Mixes and routes (from a Knight up: from what it sees), set in its last look before the waves leave. */
  private barracks(tick: number) {
    const m = this.m, team = this.team, foe = 1 - team;
    if (m.nextWaveIn() > this.L.plan + 30) return;
    const plots = m.estate.workingBarracks(team);
    if (!plots.length) return;
    this.leaves ??= V.gateLeaves(m);
    const open = m.army.bridgeOpen;
    const gateUp = V.gateStands(m, foe, this.leaves);
    const way = V.wayIn(m, team);
    for (const p of plots) {
      let route = this.routes[p] ?? m.estate.barracks[team][p].route;
      let mix = this.mixes[p] ?? m.estate.barracks[team][p].mix;
      if (this.L.adapts) {
        // Its first barracks: pikes to batter a standing gate, a mixed wave to storm once there is a way in.
        if (p === 0) mix = way || !gateUp ? "mixed" : "pikemen";
        // Routes: a bridge still standing, the one with the fewest of the enemy on it, otherwise in turn.
        const r = this.bestRoute(open, p);
        if (r) route = r;
      }
      if (!open[ROUTE_NAMES.indexOf(route)]) {
        // Its bridge is down: the next one standing (its waves would reroute anyway, all together).
        const k = [0, 1, 2].find((i) => open[(ROUTE_NAMES.indexOf(route) + i) % 3]);
        if (k !== undefined) route = ROUTE_NAMES[(ROUTE_NAMES.indexOf(route) + k) % 3];
      }
      if (route !== this.routes[p] || mix !== this.mixes[p]) {
        this.routes[p] = route;
        this.mixes[p] = mix;
        this.send(tick, { kind: "barracks", plot: p, mix, route });
      }
    }
  }

  /** A route for a barracks: the open bridges, the fewest enemy marchers near them; ties go in turn. */
  private bestRoute(open: boolean[], plot: number): RouteName | null {
    const foe = 1 - this.team;
    let best = -1, bestN = 1e9;
    for (let k = 0; k < 3; k++) {
      const r = (k + this.turn + plot) % 3;
      if (!open[r]) continue;
      const b = V.bridgeOf(r);
      const n = V.marchers(this.m, foe, b.x, b.z, 30);
      if (n < bestN) {
        bestN = n;
        best = r;
      }
    }
    this.turn++;
    return best >= 0 ? ROUTE_NAMES[best] : null;
  }

  /** Orders: push through a way in; hold at the markers while the enemy in the field far outnumbers its own; else advance. */
  private orders(tick: number) {
    const m = this.m, team = this.team, foe = 1 - team;
    let order: Order = Order.Advance;
    if (V.wayIn(m, team)) order = Order.Push;
    else if (this.L.adapts) {
      const mine = V.marchers(m, team), theirs = V.marchers(m, foe, MUSTER[team].x, MUSTER[team].z, 120);
      if (theirs > mine * 1.6 + 4) order = Order.Hold;
    }
    // An order holds for a while (a way in that opens and closes as rubble settles does not swing the waves about).
    if (order !== this.order && tick - this.orderAt >= (this.order === Order.Push ? 20 : 10) * 60) {
      this.order = order;
      this.orderAt = tick;
      this.send(tick, { kind: "order", order });
    }
  }

  /** Repairs: the keep and the gate always; walls and towers while there is gold for them. */
  private switches(tick: number) {
    const g = this.gold, r = this.repairs;
    // With a margin either way, so the switches do not flick back and forth as gold comes and goes.
    const want: Record<RepairKind, boolean> = { gate: true, keep: true, walls: r.walls ? g >= 15 : g >= 40, towers: r.towers ? g >= 50 : g >= 120 };
    for (const k of ["gate", "walls", "towers", "keep"] as RepairKind[]) {
      if (want[k] === this.repairs[k]) continue;
      this.repairs[k] = want[k];
      this.send(tick, { kind: "repair", repair: k, on: want[k] });
    }
    void MIX_NAMES;
  }
}
