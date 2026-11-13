// Bridge gangs (phase 3, milestone 3.2): when a wave is sent down a road whose
// bridge is down, two of its men carry planks instead of marching. They walk
// to the near end of the bridge (their own side of the stream) and, with no
// enemy close to it, relay the deck over a fixed time for a fixed price: the
// pieces go back as masons' stones do (lowest first, each only where its place
// is clear and what it rests on stands), loose masonry in a place is carried
// off, and bodies are buried. A man who falls is not replaced; with none left
// the gang ends. When every piece stands the men march on with their wave's
// road, and the nav grid (which sees restored pieces) opens the crossing.
// Deterministic: gangs in creation order, men in order, + - * / and comparisons.

import { REGISTER, Unit, type BridgeSite } from "@keepfall/content";
import { DPI, dsqrt } from "@keepfall/core";
import { Action, type Army, type Emit } from "./army";
import type { CastleSim } from "./castleSim";
import { EventKind } from "./frame";
import { isWorker, MinionState, Role, type Minion, type Minions } from "./minions";
import type { NavGrid } from "./nav";
import type { Terrain } from "./terrain";

/** What a match decides about gangs: paying for a bridge's relaying. */
export interface GangPolicy {
  /** Take `cost` gold from the team; false (and nothing taken) if it cannot pay. */
  pay(team: number, cost: number): boolean;
}

export const enum GangState {
  /** Walking to the near end of the bridge. */
  Walking = 0,
  /** At the bridge but held: an enemy is near, gold is short, or something unmovable is in a place. */
  Waiting = 1,
  /** Putting the deck back. */
  Working = 2,
}

/** Minion.task of a gang man. */
export const enum GangTask {
  Walk = 1,
  Wait = 2,
  Work = 3,
}

interface Gang {
  /** Index into layout.bridges, the road (ROUTE_NAMES index) and the team. */
  bridge: number;
  route: number;
  team: number;
  men: number[];
  state: GangState;
  paid: boolean;
  /** Pieces put back so far, pieces carried off, and the pace credit (pieces owed). */
  laid: number;
  cleared: number;
  credit: number;
}

/** A gang man this close to an enemy leaves his work and fights (m). */
const FIGHT = 5;
/** How far past the sill the gang stands (m). */
const STAND_OFF = 3;
/** Gang men count as arrived within this of their place (m). */
const ARRIVE = 0.6;
/** Places checked for the next piece each tick. */
const CHECKS = 8;

/** Read-only view of a gang for the page and the AI. */
export interface GangStatus {
  /** Index into layout.bridges (BRIDGES order: right, centre, left), and its road (ROUTE_NAMES index: left, centre, right). */
  bridge: number;
  route: number;
  team: number;
  state: GangState;
  men: number;
  /** 0 to 1: pieces put back over pieces put back and still down. */
  progress: number;
}

export class Gangs {
  readonly list: Gang[] = [];
  /** Set by the match; without one, gangs work for nothing. */
  policy: GangPolicy | null = null;

  constructor(
    private minions: Minions,
    private castle: CastleSim,
    private terrain: Terrain,
    private nav: NavGrid,
    private army: Army,
    private emit: Emit,
  ) {}

  private site(bridge: number): BridgeSite {
    return this.castle.layout.bridges[bridge].site;
  }

  /** Pieces of a bridge that are down. */
  private down(bridge: number): number {
    const b = this.castle.layout.bridges[bridge];
    let n = 0;
    for (let id = b.first; id < b.first + b.count; id++) if (this.castle.dynamic[id]) n++;
    return n;
  }

  /** Is a gang of either team on this bridge? */
  busy(bridge: number): boolean {
    for (const g of this.list) if (g.bridge === bridge) return true;
    return false;
  }

  /**
   * A new wave (its men, in the order they were spawned) is sent down a road:
   * if its bridge is down and no gang has it, the first men of the wave
   * (pikemen first, never a ladder crew) become the bridge's gang.
   */
  form(team: number, route: number, men: Minion[]) {
    const name = this.army.routeName(route);
    const bridge = this.castle.layout.bridges.findIndex((b) => b.site.name === name);
    if (bridge < 0 || this.busy(bridge)) return;
    if (this.nav.bridgeOpen(this.site(bridge)) || this.down(bridge) === 0) return;
    const pick: Minion[] = [];
    for (const pass of [0, 1]) {
      for (const m of men) {
        if (pick.length >= REGISTER.gangMen) break;
        if (m.state !== MinionState.Upright || m.role !== Role.March || m.unit === Unit.Ladder || m.unit === Unit.Mason || m.unit === Unit.PowderBoy || pick.includes(m)) continue;
        if (pass === 0 && m.unit !== Unit.Pikeman) continue;
        pick.push(m);
      }
    }
    if (!pick.length) return;
    const g: Gang = { bridge, route, team, men: [], state: GangState.Walking, paid: false, laid: 0, cleared: 0, credit: 0 };
    for (const m of pick) {
      m.role = Role.Gang;
      m.task = GangTask.Walk;
      g.men.push(m.id);
    }
    this.list.push(g);
  }

  /** Does the gang move this man this tick (else the army thinks for him: he is in a fight, or the floor went from under him)? */
  controls(m: Minion): boolean {
    return m.role === Role.Gang && this.free(m);
  }

  private free(m: Minion): boolean {
    return this.army.standsFirm(m) && !this.army.enemyNear(m.team, m.x, m.z, FIGHT);
  }

  /** The point a man of the gang stands at: the near end of the bridge, men side by side. */
  private spot(g: Gang, k: number, out: [number, number]) {
    const s = this.site(g.bridge);
    out[0] = s.x + (k - (g.men.length - 1) / 2) * 0.9;
    out[1] = g.team === 1 ? s.z - s.length / 2 - STAND_OFF : s.z + s.length / 2 + STAND_OFF;
  }

  /** Gangs walk, wait and work (after the army's step, before physics). */
  step() {
    const p: [number, number] = [0, 0];
    for (let gi = 0; gi < this.list.length; gi++) {
      const g = this.list[gi];
      // Men who fell are gone from the gang for good.
      if (g.men.some((id) => this.minions.list[id].state !== MinionState.Upright)) g.men = g.men.filter((id) => this.minions.list[id].state === MinionState.Upright);
      if (!g.men.length) {
        this.list.splice(gi--, 1);
        continue;
      }
      if (this.down(g.bridge) === 0) {
        this.finish(g);
        this.list.splice(gi--, 1);
        continue;
      }
      // Walk to the places; men in a fight are the army's.
      let arrived = true;
      const standing: Minion[] = [];
      for (let k = 0; k < g.men.length; k++) {
        const m = this.minions.list[g.men[k]];
        if (!this.free(m)) {
          arrived = false;
          continue;
        }
        this.spot(g, k, p);
        const dx = p[0] - m.x, dz = p[1] - m.z;
        const d = dsqrt(dx * dx + dz * dz);
        if (d > ARRIVE) {
          arrived = false;
          m.task = GangTask.Walk;
          this.army.move(m, dx / d, dz / d, m.speed, NaN, Action.Carry);
        } else standing.push(m);
      }
      this.spot(g, (g.men.length - 1) / 2, p);
      const hold = (state: GangState) => {
        g.state = state;
        for (const m of standing) {
          m.task = GangTask.Wait;
          this.army.move(m, 0, 0, 0, g.team === 1 ? 0 : DPI, Action.Stand);
        }
      };
      if (!arrived) {
        hold(GangState.Walking);
        continue;
      }
      if (this.nearSideFoe(g, p[0], p[1], REGISTER.gangClear)) {
        hold(GangState.Waiting);
        continue;
      }
      if (!g.paid) {
        if (this.policy && !this.policy.pay(g.team, REGISTER.gangCost)) {
          hold(GangState.Waiting);
          continue;
        }
        g.paid = true;
        this.emit(EventKind.GangStart, g.bridge, g.team, p[0], p[1]);
      }
      g.state = GangState.Working;
      for (const m of standing) {
        m.task = GangTask.Work;
        this.army.move(m, 0, 0, 0, g.team === 1 ? 0 : DPI, Action.Work);
      }
      this.work(g);
      if (this.down(g.bridge) === 0) {
        this.finish(g);
        this.list.splice(gi--, 1);
      }
    }
  }

  /**
   * An upright enemy within r of the gang's check point on the gang's own side of the gap.
   * A man holding the far bank is not in the way (his hold point can lie inside r of a flank bridge's check
   * point, which would wait forever with every bridge down).
   */
  private nearSideFoe(g: Gang, x: number, z: number, r: number): boolean {
    const mid = this.site(g.bridge).z;
    const r2 = r * r;
    for (const n of this.minions.list) {
      if (n.team === g.team || n.state !== MinionState.Upright || isWorker(n)) continue;
      if (g.team === 1 ? n.z >= mid : n.z <= mid) continue;
      const dx = n.x - x, dz = n.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }

  /** Does what this piece rests on stand (or is there bridge beside it to bond to)? */
  private supported(id: number): boolean {
    const L = this.castle.layout;
    if (L.stones[id].grounded) return true;
    const dyn = this.castle.dynamic;
    for (const b of L.below[id]) if (!dyn[b]) return true;
    for (const b of L.side[id]) if (!dyn[b]) return true;
    return false;
  }

  /** One tick of work: pace credit builds, and each whole piece owed goes back, or what is in its way is carried off. */
  private work(g: Gang) {
    const castle = this.castle;
    const L = castle.layout;
    const b = L.bridges[g.bridge];
    const down: number[] = [];
    for (let id = b.first; id < b.first + b.count; id++) if (castle.dynamic[id]) down.push(id);
    g.credit += (g.laid + down.length) / REGISTER.gangTicks;
    if (g.credit < 1) return;
    down.sort((a, c) => L.stones[a].y - L.stones[c].y || a - c);
    let checks = 0, blocked = false;
    for (const id of down) {
      if (!this.supported(id)) continue;
      if (checks++ >= CHECKS) break;
      const p = castle.inPlace(id, this.terrain.handles);
      if (p.pieces.length) {
        // Loose masonry in the place (even a piece of this bridge) is carried off; it can be put back from dust later.
        const r = p.pieces[0];
        const t = castle.bodies[r].translation();
        castle.carryOff(r);
        this.emit(EventKind.Cleared, r, t.x, t.y, t.z);
        g.cleared++;
        return;
      }
      if (p.other.length) {
        for (const h of p.other) {
          const mid = this.minions.of(h);
          if (mid !== undefined && this.minions.list[mid].state === MinionState.Frozen) {
            this.minions.bury(mid);
            return;
          }
        }
        blocked = true;
        continue;
      }
      castle.restore(id);
      g.laid++;
      g.credit -= 1;
      g.state = GangState.Working;
      return;
    }
    if (blocked) g.state = GangState.Waiting;
  }

  /** The deck stands: the men march on with their road. */
  private finish(g: Gang) {
    const s = this.site(g.bridge);
    for (const id of g.men) {
      const m = this.minions.list[id];
      m.role = Role.March;
      m.task = 0;
      m.route = g.route;
    }
    this.emit(EventKind.Relaid, g.bridge, g.team, s.x, s.z);
  }

  /** Every gang, for the page and the AI. */
  status(): GangStatus[] {
    return this.list.map((g) => {
      const d = this.down(g.bridge);
      return { bridge: g.bridge, route: g.route, team: g.team, state: g.state, men: g.men.length, progress: g.laid + d > 0 ? g.laid / (g.laid + d) : 1 };
    });
  }

  hashInto(out: number[]) {
    out.push(this.list.length);
    for (const g of this.list) out.push(g.bridge, g.route, g.team, g.state, g.paid ? 1 : 0, g.laid, g.cleared, g.credit, ...g.men);
  }
}
