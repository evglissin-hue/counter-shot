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
  GUN_HITS,
  MIX_NAMES,
  MUSTER,
  PLOTS,
  REGISTER,
  ROUTE_NAMES,
  TUTOR,
  UPGRADES,
  WEAPON_COST,
  type AiLevel,
  type AiStep,
  type AiName,
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
  /** 3.2: the roads it has sent waves down; the tick it last sent a wave to relay each bridge; and the barracks it has sent down a downed road for one wave. */
  private used = new Set<number>();
  private gangSent = [-1e9, -1e9, -1e9];
  private gang: { plot: number; route: RouteName; waves: number } | null = null;

  constructor(
    private m: Match,
    private team: number,
    difficulty: AiName,
    private L: AiLevel,
    private rng: Rng,
    private send: (tick: number, input: MatchInput) => void,
    /** M6: the tutor's stage (it builds, buys and repairs by it); null for every other AI. */
    private stage: (() => number) | null = null,
    /** For tools: a plan to follow instead of the level's own. */
    plan?: AiStep[],
  ) {
    this.plan = [...(plan ?? AI_PLANS[difficulty])]; // its own copy: a step that must wait can be put behind the next one
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
    if (this.stage && this.stage() < 1) return; // the tutor asleep builds and buys nothing
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
      let s = this.plan[this.step];
      if (this.done(s)) continue;
      if (!this.possible(s)) continue; // the plot is taken, the slot armed: passed over
      if (this.stage && (s.stage ?? 0) > this.stage()) return; // the tutor's step waits for its stage
      if (this.blocked(s)) {
        // After M5: the masonry under the slot is down, and no gun goes there until masons put it back. It asked
        // again every few seconds and built nothing else meanwhile; now the next step it can take goes first.
        const k = this.plan.findIndex((q, i) => i > this.step && !this.done(q) && this.possible(q) && !this.blocked(q));
        if (k < 0) return;
        s = this.plan.splice(k, 1)[0];
        this.plan.splice(this.step, 0, s);
      }
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

  /** A gun for a slot whose masonry is down (after M5): the match refuses it until that masonry stands again. */
  private blocked(s: AiStep): boolean {
    return s.kind === "buy" && this.m.world.mounts.standing(firstSlot(this.team) + s.slot) < GUN_HITS.mountBack;
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
    // 3.2: a bridge gang works only when a wave comes down a road whose bridge is down; one barracks sends one for one wave.
    if (this.gang && m.waves[team] > this.gang.waves) this.gang = null;
    if (!this.gang && !this.stage) this.gang = this.startGang(tick, plots, open);
    for (const p of plots) {
      if (this.gang && this.gang.plot === p) {
        if (this.routes[p] !== this.gang.route) {
          this.routes[p] = this.gang.route;
          this.send(tick, { kind: "barracks", plot: p, route: this.gang.route });
        }
        continue;
      }
      let route = this.routes[p] ?? m.estate.barracks[team][p].route;
      let mix = this.mixes[p] ?? m.estate.barracks[team][p].mix;
      if (this.stage) {
        // The tutor: its first waves down a road the player's waves are not holding (the lesson: stop them with your
        // guns), later ones down the road they hold or march (an idle castle is not ground down); sappers once it fights.
        mix = TUTOR.mixes[this.stage()];
        const r = m.waves[team] < TUTOR.sneak ? this.bestRoute(open, p) : this.meetRoute(open);
        if (r) route = r;
      } else if (this.L.adapts) {
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
      this.used.add(ROUTE_NAMES.indexOf(route));
      if (route !== this.routes[p] || mix !== this.mixes[p]) {
        this.routes[p] = route;
        this.mixes[p] = mix;
        this.send(tick, { kind: "barracks", plot: p, mix, route });
      }
    }
  }

  /**
   * 3.2, from a Knight up: a bridge is down, no wave has been sent to it in the last minute (the sim reports gangs at work: gangs.status())
   * and no gang works it now) and there is gold for a gang: one working barracks sends its next wave down that road,
   * which a gang then relays. A road it has used goes first.
   */
  private startGang(tick: number, plots: number[], open: boolean[]): { plot: number; route: RouteName; waves: number } | null {
    if (!this.L.gangs || this.gold < REGISTER.gangCost + this.L.reserve) return null;
    const working = this.m.world.gangs?.status() ?? [];
    const down = [0, 1, 2].filter((r) => !open[r] && tick - this.gangSent[r] >= 60 * 60 && !working.some((g) => g.route === r));
    if (!down.length) return null;
    down.sort((a, b) => Number(this.used.has(b)) - Number(this.used.has(a)) || a - b);
    this.gangSent[down[0]] = tick;
    return { plot: plots[0], route: ROUTE_NAMES[down[0]], waves: this.m.waves[this.team] };
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

  /**
   * M6, the tutor's later waves: the road with the most of the player's men
   * within 30 m of its bridge; with none near any, the road the player sends
   * its waves down (they meet there); a road whose bridge is down is passed over.
   */
  private meetRoute(open: boolean[]): RouteName | null {
    const foe = 1 - this.team;
    let best = -1, bestN = 0;
    for (let r = 0; r < 3; r++) {
      if (!open[r]) continue;
      const b = V.bridgeOf(r);
      const n = V.marchers(this.m, foe, b.x, b.z, 30);
      if (n > bestN) {
        bestN = n;
        best = r;
      }
    }
    if (best < 0) {
      const k = ROUTE_NAMES.indexOf(this.m.route[foe]);
      if (k >= 0 && open[k]) best = k;
    }
    return best >= 0 ? ROUTE_NAMES[best] : null;
  }

  /** Orders: push through a way in; hold at the markers while the enemy in the field far outnumbers its own; else advance. */
  private orders(tick: number) {
    const m = this.m, team = this.team, foe = 1 - team;
    let order: Order = Order.Advance;
    if (this.stage) order = Order.Advance; // the tutor never pushes or holds
    else if (V.wayIn(m, team)) order = Order.Push;
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
    const tutor = this.stage ? TUTOR.repairs[this.stage()] : null;
    const want: Record<RepairKind, boolean> = tutor ? { gate: tutor.includes("gate"), walls: tutor.includes("walls"), towers: tutor.includes("towers"), keep: false } : { gate: true, keep: true, walls: r.walls ? g >= 15 : g >= 40, towers: r.towers ? g >= 50 : g >= 120 };
    for (const k of ["gate", "walls", "towers", "keep"] as RepairKind[]) {
      if (want[k] === this.repairs[k]) continue;
      this.repairs[k] = want[k];
      this.send(tick, { kind: "repair", repair: k, on: want[k] });
    }
    void MIX_NAMES;
  }
}
