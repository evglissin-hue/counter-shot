// Ladders (phase 2 M4). A ladder crew (two men, the ladder on their
// shoulders) marches with its wave; near the enemy's front wall it makes for
// a crenel where the wall stands to the top, raises the ladder against it,
// and the wave climbs: up the outside, across the wall walk, down a rope on
// the inside, a few at a time. A planted ladder is a physics body (fixed
// while it leans): a ball, a falling stone or a burst knocks it off the wall,
// and so does the wall giving way under its top; whoever is on it falls. A
// crew knocked down drops its ladder. Fallen ladders lie as bodies, and past
// a few the oldest go.
// Deterministic: ladders in id order, climbers in id order, + - * / and
// comparisons, dsin and dcos for the raise.

import { CASTLE_SHAPE, LADDER, ladderSpots, mirrorZ, Unit, type LadderSpot } from "@keepfall/content";
import { DPI, dcos, dsin, dsqrt } from "@keepfall/core";
import { Action, breachField, Climb, Order, type Army, type Emit } from "./army";
import { FLOW_INF } from "./flow";
import type { CastleSim, Rapier } from "./castleSim";
import { EventKind, LADDER_STRIDE } from "./frame";
import { Cause, MinionState, Role, yawOf, type Minion, type Minions } from "./minions";
import { segPoint2 } from "./mounts";
import { SapperTask } from "./specialists";
import { chainMid, SWEEP, type ChainMove } from "./sweep";
import type { Terrain } from "./terrain";

type World = InstanceType<Rapier["World"]>;
type Body = ReturnType<World["createRigidBody"]>;

export const enum LadderState {
  Carried = 0,
  Raising = 1,
  Planted = 2,
  Down = 3,
  Gone = 4,
}

interface Ladder {
  id: number;
  team: number;
  state: LadderState;
  /** The crew: the front man and the back man (minion ids). */
  front: number;
  back: number;
  /** The spot it makes for or leans at (index into spots), or -1. */
  spot: number;
  /** Ticks in its state. */
  t: number;
  body: Body | null;
  handle: number;
  /** Its ends (world): the foot and the top. */
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  /** Climbers on the ladder itself, in the order they got on (minion ids). */
  on: number[];
  /** Minions making for it or waiting at its foot (recounted every step). */
  claims: number;
  /** Men waiting on the wall walk for their group, in the order they got there, and the tick each got there. */
  walk: number[];
  walkT: number[];
  /** The height (m) of the wall walk at its spot, set when it leans. */
  walkY: number;
  /** Ticks a carried ladder has spent near the enemy wall with no usable spot. */
  bare: number;
  /** A rope hangs down inside (the first climber reached the top). */
  rope: boolean;
  /** The front man's last positions (x, z pairs, newest last), for the back man to walk in. */
  trail: number[];
  /** Ticks a fallen ladder has lain still. */
  rest: number;
  /** Tick it came down. */
  downAt: number;
}

/** Courses from the top of the wall down that a ladder's top leans on. */
const TOP_COURSES = 4;
/** Trail samples kept for the back man (one a tick). */
const TRAIL = 200;
/** Ticks between a man checking whether another ladder's queue is much shorter than his, and how much shorter (men) it must be. */
const REBALANCE = 20;
const REBALANCE_GAP = 3;
/** How high the crew carries the ladder (m above the feet). */
const SHOULDER = 1.52;

export class Ladders {
  readonly list: Ladder[] = [];
  readonly spots: LadderSpot[] = ladderSpots();
  /** Ladders each team has raised against a wall (for the end screen). */
  readonly planted: [number, number] = [0, 0];
  /** Ladders each team lost before or after raising them. */
  readonly lost: [number, number] = [0, 0];
  /** Set by the world (the army walks the crews and climbers). */
  army!: Army;
  private byHandle = new Map<number, number>();
  /** Crewmen carrying or raising a ladder: minion id -> ladder id. */
  private crewOf = new Map<number, number>();
  /** Per spot: the wall pieces its ladder's top leans on. */
  private support: number[][];
  /** Per spot: the top (m) of each of those pieces, and the ground at the wall's foot. */
  private supportTop: number[][];
  private base: number[];
  private dir: [number, number] = [0, 0];

  constructor(
    private R: Rapier,
    private world: World,
    private castle: CastleSim,
    private terrain: Terrain,
    private minions: Minions,
    private emit: Emit,
  ) {
    const L = castle.layout;
    const S = CASTLE_SHAPE;
    this.base = this.spots.map((sp) => terrain.heightAt(sp.x, sp.topZ));
    this.support = this.spots.map((sp) => {
      const ids: number[] = [];
      for (const s of L.stones) {
        if (s.castle !== sp.castle || (s.part !== "wall" && s.part !== "merlon")) continue;
        if (Math.abs(mirrorZ(sp.castle, s.z) + S.half) > 1.5 || s.course < S.wallCourses - TOP_COURSES) continue;
        if (Math.abs(s.x - sp.x) < s.hx + 0.35) ids.push(s.id);
      }
      return ids;
    });
    this.supportTop = this.support.map((ids) => ids.map((id) => L.stones[id].y + L.stones[id].hy));
  }

  /** A wave's ladder crew: two men, the ladder on their shoulders. */
  makeCrew(team: number, front: Minion, back: Minion) {
    const id = this.list.length;
    const L: Ladder = {
      id, team, state: LadderState.Carried, front: front.id, back: back.id, spot: -1, t: 0, body: null, handle: -1,
      fx: back.x, fy: back.y + SHOULDER, fz: back.z, tx: front.x, ty: front.y + SHOULDER, tz: front.z,
      on: [], claims: 0, walk: [], walkT: [], walkY: 0, bare: 0, rope: false, trail: [], rest: 0, downAt: -1,
    };
    // The trail starts as a straight line from the back man to the front man.
    const n = 24;
    for (let k = 0; k <= n; k++) L.trail.push(back.x + ((front.x - back.x) * k) / n, back.z + ((front.z - back.z) * k) / n);
    this.list.push(L);
    this.crewOf.set(front.id, id);
    this.crewOf.set(back.id, id);
    front.action = back.action = Action.Carry;
  }

  /** Is this minion moved by the ladders this tick (carrying or raising one, or on its way over a wall)? */
  controls(m: Minion): boolean {
    if (this.crewOf.has(m.id)) return true;
    return m.task >= Climb.Wait && m.task <= Climb.Down;
  }

  /** The foot of a planted ladder (where its climbers queue), or null if it is not up. */
  foot(id: number): { x: number; z: number; castle: number } | null {
    const L = this.list[id];
    if (!L || L.state !== LadderState.Planted) return null;
    const sp = this.spots[L.spot];
    return { x: sp.x, z: sp.footZ + sp.out * 1.0, castle: sp.castle };
  }

  /**
   * A marching minion near a planted ladder of its side goes for it, when
   * its way in is shut (the gate stands and there is no breach). Returns
   * true if it did.
   */
  claim(m: Minion, wayIn: boolean): boolean {
    if (wayIn || m.role !== Role.March || m.unit === Unit.Mason || m.unit === Unit.PowderBoy) return false;
    // A sapper who has set his keg climbs like the rest; one still with his keg does not.
    if (m.unit === Unit.Sapper ? m.task !== SapperTask.Done : m.task !== Climb.None) return false;
    // The nearest ladder by walk plus a penalty for each man already on or making for it, so the waves spread.
    let best = -1, bd = 0;
    for (const L of this.list) {
      if (L.state !== LadderState.Planted || L.team !== m.team || L.claims >= LADDER.queue) continue;
      const sp = this.spots[L.spot];
      const dx = sp.x - m.x, dz = sp.footZ - m.z;
      const d = dsqrt(dx * dx + dz * dz);
      if (d >= LADDER.pull) continue;
      const score = d + LADDER.queuePenalty * (L.claims + L.on.length);
      if (best < 0 || score < bd) {
        bd = score;
        best = L.id;
      }
    }
    if (best < 0) return false;
    m.task = Climb.ToLadder;
    m.aux = best;
    this.list[best].claims++;
    return true;
  }

  /** It reached the foot of its ladder: it waits for room on it. */
  arrive(m: Minion) {
    m.task = Climb.Wait;
    m.climb = 0;
  }

  /** Crews, raising, the wall under each planted ladder, and everyone climbing (after the army's step, before physics). */
  step(tick: number) {
    const army = this.army;
    for (const L of this.list) {
      if (L.state === LadderState.Carried) this.carry(L, tick);
      else if (L.state === LadderState.Raising) this.raise(L, tick);
      else if (L.state === LadderState.Planted) {
        L.t++;
        L.on = L.on.filter((id) => this.minions.list[id].state === MinionState.Upright && this.minions.list[id].task === Climb.Up);
        if ((tick + L.id) % 10 === 0 && !this.usable(L.spot)) this.knockDown(L, 0, 0, 0, tick, true);
      } else if (L.state === LadderState.Down) this.lie(L);
      this.gather(L, tick);
    }
    for (const m of this.minions.list) {
      if (m.task < Climb.ToLadder || m.task > Climb.Down) continue;
      if (m.state !== MinionState.Upright) {
        this.release(m);
        continue;
      }
      if (m.task <= Climb.Wait) {
        // Hold: nobody walks to a ladder or waits at its foot; the army has him again.
        const L = this.list[m.aux];
        if (army.order[m.team] === Order.Hold || !L || L.state !== LadderState.Planted) {
          this.release(m);
          continue;
        }
      }
      if (m.task <= Climb.Wait && (tick + m.id) % REBALANCE === 0) this.rebalance(m);
      if (m.task >= Climb.Wait) this.climbStep(m, tick);
    }
    // The claims are what the standing men walking to or waiting at each ladder say they are.
    for (const L of this.list) L.claims = 0;
    for (const m of this.minions.list) {
      if (m.state !== MinionState.Upright || (m.task !== Climb.ToLadder && m.task !== Climb.Wait)) continue;
      const L = this.list[m.aux];
      if (L && L.state === LadderState.Planted) L.claims++;
    }
  }

  /** A man walking to or waiting at a ladder whose queue is much longer than another's within reach of him goes to the shorter one. */
  private rebalance(m: Minion) {
    const cur = this.list[m.aux];
    if (!cur) return;
    const load = (L: Ladder) => L.claims + L.on.length;
    let best: Ladder | null = null, bl = load(cur) - REBALANCE_GAP;
    for (const L of this.list) {
      if (L === cur || L.state !== LadderState.Planted || L.team !== m.team || L.claims >= LADDER.queue) continue;
      const sp = this.spots[L.spot];
      const dx = sp.x - m.x, dz = sp.footZ - m.z;
      if (dx * dx + dz * dz >= LADDER.pull * LADDER.pull) continue;
      if (!best ? load(L) <= bl : load(L) < load(best)) best = L;
    }
    if (!best) return;
    cur.claims--;
    best.claims++;
    m.task = Climb.ToLadder;
    m.aux = best.id;
    m.climb = 0;
  }

  /** The men waiting on a ladder's wall walk go down the rope together, a step apart, once their group is there or nobody else is coming or they have waited long enough. */
  private gather(L: Ladder, tick: number) {
    const list = this.minions.list;
    const ids: number[] = [], ts: number[] = [];
    for (let k = 0; k < L.walk.length; k++) {
      const m = list[L.walk[k]];
      if (m.state !== MinionState.Upright || m.task !== Climb.Across || m.aux !== L.id) continue;
      ids.push(m.id);
      ts.push(L.walkT[k]);
    }
    L.walk = ids;
    L.walkT = ts;
    const n = ids.length;
    if (n === 0) return;
    const nobody = L.on.length === 0 && L.claims === 0;
    if (n < LADDER.group && !nobody && tick - ts[0] < LADDER.groupWait * 60) return;
    for (let k = 0; k < n; k++) list[ids[k]].climb = -LADDER.groupGap * k;
    L.walk = [];
    L.walkT = [];
  }

  /** The height (m) at which the wall still stands at a spot: the top of its highest standing piece, or 0. */
  private standTop(spot: number): number {
    const ids = this.support[spot], tops = this.supportTop[spot];
    let h = 0;
    for (let i = 0; i < ids.length; i++) if (!this.castle.dynamic[ids[i]] && tops[i] > h) h = tops[i];
    return h;
  }

  /** Does the wall at a spot still stand high enough for a ladder (a loose top stone does not spoil it)? */
  private usable(spot: number): boolean {
    return this.standTop(spot) - this.base[spot] >= LADDER.minWall;
  }

  /** A spot for a crew: the nearest free one of the castle it marches on where the wall still stands high enough, or -1. */
  private pickSpot(team: number, x: number, z: number): number {
    const target = 1 - team;
    let best = -1, bd = Infinity;
    for (let k = 0; k < this.spots.length; k++) {
      const sp = this.spots[k];
      if (sp.castle !== target || !this.usable(k)) continue;
      let taken = false;
      for (const L of this.list) if (L.spot === k && L.state <= LadderState.Planted) taken = true;
      if (taken) continue;
      const d = (sp.x - x) * (sp.x - x) + (sp.footZ - z) * (sp.footZ - z);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  /** The nearest spot of the castle a team marches on, usable or not (somewhere to walk to by the castle's local field). */
  private nearestSpot(team: number, x: number, z: number): number {
    let best = -1, bd = Infinity;
    for (let k = 0; k < this.spots.length; k++) {
      const sp = this.spots[k];
      if (sp.castle !== 1 - team) continue;
      const d = (sp.x - x) * (sp.x - x) + (sp.footZ - z) * (sp.footZ - z);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  private carry(L: Ladder, tick: number) {
    const list = this.minions.list;
    const a = list[L.front], b = list[L.back];
    if (a.state !== MinionState.Upright || b.state !== MinionState.Upright) {
      this.drop(L, tick);
      return;
    }
    const army = this.army;
    const hold = army.order[L.team] === Order.Hold;
    // The front man leads: with the wave on its field, then for a crenel of the enemy front wall.
    const target = 1 - L.team;
    const face = CASTLE_SHAPE.half + CASTLE_SHAPE.wallThick / 2;
    const wallZ = mirrorZ(target, -face);
    const near = (a.z - wallZ) * (a.z - wallZ) < LADDER.near * LADDER.near && a.x > -30 && a.x < 30;
    // Near the wall with a way in open for the wave (a breach it can reach): the ladder is no use, the crew goes with the
    // wave. Not from further off: a breach seen from the muster is often closed by the masons before the crew gets there.
    if (near && army.flow.at(breachField(L.team), a.x, a.z) < FLOW_INF) {
      this.drop(L, tick);
      return;
    }
    // Never into the enemy courtyard with the ladder on the shoulder: it is dropped at the gate.
    if (mirrorZ(target, a.z) > -face + 0.3 && a.x > -CASTLE_SHAPE.half && a.x < CASTLE_SHAPE.half) {
      this.drop(L, tick);
      return;
    }
    if (L.spot >= 0) {
      let taken = !this.usable(L.spot) || hold;
      for (const o of this.list) if (o !== L && o.spot === L.spot && o.state <= LadderState.Planted) taken = true;
      if (taken) L.spot = -1;
    }
    if (L.spot < 0 && near && !hold && (tick + L.id) % 15 === 0) L.spot = this.pickSpot(L.team, a.x, a.z);
    // No usable spot for too long near the wall: the ladder is dropped and the crew fights.
    if (L.spot >= 0 || !near || hold) L.bare = 0;
    else if (++L.bare >= LADDER.giveUp * 60) {
      this.drop(L, tick);
      return;
    }
    let mx = 0, mz = 0, speed = a.speed * LADDER.carryPace;
    if (L.spot >= 0) {
      const sp = this.spots[L.spot];
      const dx = sp.x - a.x, dz = sp.footZ - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.6 * 0.6) {
        L.state = LadderState.Raising;
        L.t = 0;
        this.raise(L, tick);
        return;
      }
      if (army.local.covers(sp.castle, a.x, a.z) && army.local.steer(sp.castle, sp.x, sp.footZ, a.x, a.z, this.dir)) {
        mx = this.dir[0];
        mz = this.dir[1];
      } else {
        const d = dsqrt(d2);
        mx = dx / d;
        mz = dz / d;
      }
    } else if (army.marchDir(a, this.dir)) {
      mx = this.dir[0];
      mz = this.dir[1];
    } else if (near && !hold) {
      // No march field here: walk for the nearest spot by the castle's own field.
      const sp = this.spots[this.nearestSpot(L.team, a.x, a.z)];
      const dx = sp.x - a.x, dz = sp.footZ - a.z;
      const d = dsqrt(dx * dx + dz * dz) + 1e-9;
      if (d < 0.6) speed = 0;
      else if (army.local.covers(sp.castle, a.x, a.z) && army.local.steer(sp.castle, sp.x, sp.footZ, a.x, a.z, this.dir)) {
        mx = this.dir[0];
        mz = this.dir[1];
      } else {
        mx = dx / d;
        mz = dz / d;
      }
    } else speed = 0;
    army.move(a, mx, mz, speed, NaN, speed > 0 ? Action.Carry : Action.Stand);
    a.action = Action.Carry;
    // The back man walks in the front man's steps, a carry behind.
    L.trail.push(a.x, a.z);
    if (L.trail.length > TRAIL * 2) L.trail.splice(0, L.trail.length - TRAIL * 2);
    this.follow(L, b, a);
    this.carriedEnds(L, a, b);
  }

  /** Put the back man on the front man's trail, LADDER.carryGap behind him. */
  private follow(L: Ladder, b: Minion, a: Minion) {
    const tr = L.trail;
    let left: number = LADDER.carryGap;
    let px = a.x, pz = a.z;
    let x = tr[0], z = tr[1];
    for (let k = tr.length - 2; k >= 0; k -= 2) {
      const qx = tr[k], qz = tr[k + 1];
      const dx = px - qx, dz = pz - qz;
      const d = dsqrt(dx * dx + dz * dz);
      if (d >= left) {
        const f = left / (d + 1e-9);
        x = px - dx * f;
        z = pz - dz * f;
        left = 0;
        break;
      }
      left -= d;
      px = qx;
      pz = qz;
      x = qx;
      z = qz;
    }
    const mx = x - b.x, mz = z - b.z;
    const moved = dsqrt(mx * mx + mz * mz);
    b.vx = mx * 60;
    b.vz = mz * 60;
    b.x = x;
    b.z = z;
    b.phase = (b.phase + moved / 1.4) % 1;
    // Face the front man.
    const fx = a.x - b.x, fz = a.z - b.z;
    const fd = dsqrt(fx * fx + fz * fz);
    if (fd > 0.2) this.army.turn(b, yawOf(fx / fd, fz / fd));
    const c = navCellOf(this.army, b.x, b.z);
    const want = this.army.surface(b.x, b.z, c);
    const dy = want - b.y;
    b.y = dy > 0.04 ? b.y + 0.04 : dy < -0.04 ? b.y - 0.04 : want;
    b.action = Action.Carry;
    if (b.act < 600) b.act++;
    this.minions.place(b);
  }

  /** The ladder on two pairs of shoulders: the foot end at the back man, the top end at the front man. */
  private carriedEnds(L: Ladder, a: Minion, b: Minion) {
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, cy = (a.y + b.y) / 2 + SHOULDER;
    let dx = a.x - b.x, dz = a.z - b.z;
    const d = dsqrt(dx * dx + dz * dz);
    if (d < 0.1) {
      dx = 0;
      dz = 1;
    } else {
      dx /= d;
      dz /= d;
    }
    const h = LADDER.length / 2;
    L.fx = cx - dx * h;
    L.fy = cy - (a.y - b.y) * 0.1;
    L.fz = cz - dz * h;
    L.tx = cx + dx * h;
    L.ty = cy + (a.y - b.y) * 0.1;
    L.tz = cz + dz * h;
  }

  /** Raising: the foot at the base of the wall, the top swinging up from the ground behind it, over and onto the wall. */
  private raise(L: Ladder, tick: number) {
    const list = this.minions.list;
    const a = list[L.front], b = list[L.back];
    if (a.state !== MinionState.Upright || b.state !== MinionState.Upright) {
      this.drop(L, tick);
      return;
    }
    const sp = this.spots[L.spot];
    const fy = this.terrain.heightAt(sp.x, sp.footZ);
    const wallYaw = sp.out < 0 ? 0 : DPI;
    // The front man at the foot, the back man beside him, both facing the wall.
    a.x += (sp.x - a.x) * 0.2;
    a.z += (sp.footZ + sp.out * 0.5 - a.z) * 0.2;
    b.x += (sp.x + 0.9 - b.x) * 0.1;
    b.z += (sp.footZ + sp.out * 0.9 - b.z) * 0.1;
    for (const m of [a, b]) {
      this.army.turn(m, wallYaw);
      m.action = Action.Raise;
      m.vx = m.vz = 0;
      if (m.act < 600) m.act++;
      this.minions.place(m);
    }
    L.t++;
    const k = L.t / LADDER.raise;
    const e = k >= 1 ? 1 : k * k * (3 - 2 * k);
    // Angle from the ground behind (0) through upright to leaning on the wall.
    const lean = this.leanAngle(sp, fy);
    const th = (DPI - lean) * e;
    const len = LADDER.length;
    L.fx = sp.x;
    L.fy = fy;
    L.fz = sp.footZ;
    L.tx = sp.x;
    L.ty = fy + len * dsin(th);
    L.tz = sp.footZ + sp.out * len * dcos(th);
    if (L.t >= LADDER.raise) this.plant(L, tick);
  }

  /** The angle (rad) between the ground and a ladder leaning from a spot's foot to its top. */
  private leanAngle(sp: LadderSpot, fy: number): number {
    const rise = sp.topY - fy, run = dsqrt((sp.topZ - sp.footZ) * (sp.topZ - sp.footZ));
    // asin by bisection (dsin is monotonic over [0, pi/2]).
    const s = rise / dsqrt(rise * rise + run * run);
    let lo = 0, hi = DPI / 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (dsin(mid) < s) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Up against the wall: a fixed body now, and the crew climbs first. */
  private plant(L: Ladder, tick: number) {
    const sp = this.spots[L.spot];
    const fy = this.terrain.heightAt(sp.x, sp.footZ);
    L.fx = sp.x;
    L.fy = fy;
    L.fz = sp.footZ;
    L.tx = sp.x;
    L.ty = sp.topY;
    L.tz = sp.topZ;
    L.state = LadderState.Planted;
    L.t = 0;
    // The wall walk is as high as the wall still stands at the spot (never above the full wall).
    const stand = this.standTop(L.spot);
    L.walkY = stand < CASTLE_SHAPE.wallTop ? stand : CASTLE_SHAPE.wallTop;
    this.makeBody(L, false, 0, 0, 0);
    this.planted[L.team]++;
    this.emit(EventKind.Ladder, L.id, LadderState.Planted, sp.x, sp.footZ);
    for (const id of [L.front, L.back]) {
      this.crewOf.delete(id);
      const m = this.minions.list[id];
      m.task = Climb.Wait;
      m.aux = L.id;
      m.climb = 0;
    }
    void tick;
  }

  /** A body along the ladder's ends: fixed while it leans, dynamic when it falls (with a velocity). */
  private makeBody(L: Ladder, dynamic: boolean, vx: number, vy: number, vz: number) {
    const R = this.R;
    let ux = L.tx - L.fx, uy = L.ty - L.fy, uz = L.tz - L.fz;
    const len = dsqrt(ux * ux + uy * uy + uz * uz) + 1e-9;
    ux /= len;
    uy /= len;
    uz /= len;
    // The rotation that turns +Y onto the ladder: about (uz, 0, -ux) by acos(uy).
    let ax = uz, az = -ux;
    const al = dsqrt(ax * ax + az * az);
    let q = { x: 0, y: 0, z: 0, w: 1 };
    if (al > 1e-6) {
      ax /= al;
      az /= al;
      const s = dsqrt((1 - uy) / 2), c = dsqrt((1 + uy) / 2);
      q = { x: ax * s, y: 0, z: az * s, w: c };
    }
    const desc = (dynamic ? R.RigidBodyDesc.dynamic().setLinvel(vx, vy, vz).setAngularDamping(0.8) : R.RigidBodyDesc.fixed())
      .setTranslation((L.fx + L.tx) / 2, (L.fy + L.ty) / 2, (L.fz + L.tz) / 2)
      .setRotation(q);
    const body = this.world.createRigidBody(desc);
    const hx = 0.28, hz = 0.05, hy = len / 2;
    const col = this.world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setDensity(LADDER.mass / (8 * hx * hy * hz))
        .setFriction(0.6)
        .setRestitution(0.1)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    L.body = body;
    L.handle = col.handle;
    this.byHandle.set(col.handle, L.id);
  }

  /** Off the wall: it falls, with a push (ix, iy, iz as an impulse), and everyone on it falls with it. */
  knockDown(L: Ladder, ix: number, iy: number, iz: number, tick: number, wallGave = false) {
    if (L.state !== LadderState.Planted || !L.body) return;
    const sp = this.spots[L.spot];
    L.body.setBodyType(this.R.RigidBodyType.Dynamic, true);
    L.body.recomputeMassPropertiesFromColliders();
    // Away from the wall, whatever pushed it.
    L.body.applyImpulseAtPoint({ x: ix, y: iy, z: iz + sp.out * LADDER.mass * 1.2 }, { x: L.tx, y: L.ty, z: L.tz }, true);
    this.down(L, tick);
    for (const m of this.minions.list) {
      if (m.state !== MinionState.Upright || m.aux !== L.id) continue;
      if (m.task === Climb.Up || (wallGave && (m.task === Climb.Across || m.task === Climb.Down))) {
        this.minions.knock({ minion: m.id, vx: ix * 0.02, vy: 0.6, vz: sp.out * 2.2 + iz * 0.02, px: m.x, py: m.y + 1.2, pz: m.z, extra: 0.3, cause: Cause.Fall }, tick);
        this.release(m);
      } else if (m.task === Climb.Wait || m.task === Climb.ToLadder) this.release(m);
    }
    L.on = [];
    L.claims = 0;
  }

  /** The crew went down while carrying or raising it: the ladder drops where it is. */
  private drop(L: Ladder, tick: number) {
    const list = this.minions.list;
    const a = list[L.front], b = list[L.back];
    this.crewOf.delete(L.front);
    this.crewOf.delete(L.back);
    for (const m of [a, b]) {
      if (m.state === MinionState.Upright) {
        m.task = Climb.None;
        m.aux = -1;
      }
    }
    const vx = (a.vx + b.vx) / 2, vz = (a.vz + b.vz) / 2;
    this.makeBody(L, true, vx, 0, vz);
    this.down(L, tick);
  }

  private down(L: Ladder, tick: number) {
    L.state = LadderState.Down;
    L.downAt = tick;
    L.rest = 0;
    this.lost[L.team]++;
    this.emit(EventKind.Ladder, L.id, LadderState.Down, L.fx, L.fz);
    // Past a few fallen ladders, the oldest goes.
    let downs = 0;
    for (const o of this.list) if (o.state === LadderState.Down) downs++;
    for (const o of this.list) {
      if (downs <= LADDER.keep) break;
      if (o.state !== LadderState.Down || o === L || !o.body) continue;
      this.byHandle.delete(o.handle);
      this.world.removeRigidBody(o.body);
      o.body = null;
      o.state = LadderState.Gone;
      downs--;
    }
  }

  /** A fallen ladder: its ends follow its body; once it has lain still for a second and a half it is fixed. */
  private lie(L: Ladder) {
    const b = L.body;
    if (!b) return;
    if (b.isFixed()) return;
    const t = b.translation(), r = b.rotation();
    // +Y of the body, rotated.
    const x = 2 * (r.x * r.y - r.w * r.z), y = 1 - 2 * (r.x * r.x + r.z * r.z), z = 2 * (r.y * r.z + r.w * r.x);
    const h = LADDER.length / 2;
    L.fx = t.x - x * h;
    L.fy = t.y - y * h;
    L.fz = t.z - z * h;
    L.tx = t.x + x * h;
    L.ty = t.y + y * h;
    L.tz = t.z + z * h;
    if (b.isSleeping()) {
      if (++L.rest >= 90) b.setBodyType(this.R.RigidBodyType.Fixed, false);
    } else L.rest = 0;
  }

  /** Is this collider a ladder? */
  isLadder(handle: number): boolean {
    return this.byHandle.has(handle);
  }

  /** A ball touched a collider: if it is a planted ladder and the ball carries enough, it comes down. Returns whether the collider is a ladder. */
  hitByBall(handle: number, vx: number, vy: number, vz: number, mass: number, tick: number): boolean {
    const id = this.byHandle.get(handle);
    if (id === undefined) return false;
    const L = this.list[id];
    const v = dsqrt(vx * vx + vy * vy + vz * vz);
    if (L.state === LadderState.Planted && v > 8 && mass * v > 150) this.knockDown(L, ...push(vx, vy, vz, v), tick);
    return true;
  }

  /** A loose stone touched a collider: a planted ladder it strikes hard enough comes down. */
  hitByStone(handle: number, vx: number, vy: number, vz: number, tick: number): boolean {
    const id = this.byHandle.get(handle);
    if (id === undefined) return false;
    const L = this.list[id];
    const v = dsqrt(vx * vx + vy * vy + vz * vz);
    if (L.state === LadderState.Planted && v > 3) this.knockDown(L, ...push(vx, vy, vz, v), tick);
    return true;
  }

  /**
   * After M5: a chain shot's whirl (radius `half`) swept from where it was to
   * where it is this step, at (vx, vy, vz): a planted ladder it passes comes
   * off the wall. Returns how many it took.
   */
  sweptBy(mv: ChainMove, half: number, vx: number, vy: number, vz: number, tick: number): number {
    let n = 0;
    const r = half + 0.3, r2 = r * r;
    for (const L of this.list) {
      if (L.state !== LadderState.Planted) continue;
      let hit = false;
      for (let k = 0; k <= SWEEP.steps && !hit; k++) {
        const c = chainMid(mv, k);
        if (segPoint2(L.fx, L.fy, L.fz, L.tx, L.ty, L.tz, c[0], c[1], c[2]) < r2) hit = true;
      }
      if (!hit) continue;
      const v = dsqrt(vx * vx + vy * vy + vz * vz);
      this.knockDown(L, ...push(vx, vy, vz, v), tick);
      n++;
    }
    return n;
  }

  /** A powder burst: planted ladders within its reach come down, thrown away from it. */
  blast(x: number, y: number, z: number, radius: number, tick: number) {
    for (const L of this.list) {
      if (L.state !== LadderState.Planted) continue;
      // Distance from the burst to the ladder's segment.
      const ux = L.tx - L.fx, uy = L.ty - L.fy, uz = L.tz - L.fz;
      const l2 = ux * ux + uy * uy + uz * uz;
      let t = ((x - L.fx) * ux + (y - L.fy) * uy + (z - L.fz) * uz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = L.fx + ux * t - x, py = L.fy + uy * t - y, pz = L.fz + uz * t - z;
      const d2 = px * px + py * py + pz * pz;
      if (d2 > (radius + 1) * (radius + 1)) continue;
      const d = dsqrt(d2) + 0.3;
      const k = LADDER.mass * 6;
      this.knockDown(L, (px / d) * k, (py / d) * k + k * 0.3, (pz / d) * k, tick);
    }
  }

  /** It stopped climbing (it fell, or its ladder went): free its place and its claim. */
  private release(m: Minion) {
    const L = m.aux >= 0 ? this.list[m.aux] : undefined;
    if (L) {
      const k = L.on.indexOf(m.id);
      if (k >= 0) L.on.splice(k, 1);
    }
    if (m.state === MinionState.Upright) {
      m.task = this.idle(m);
      m.aux = -1;
      m.climb = 0;
    }
  }

  /** What a man's task is when he is not on his way over a wall: a sapper who has set his keg is Done (0 would be Carry), everyone else None. */
  private idle(m: Minion): number {
    return m.unit === Unit.Sapper ? SapperTask.Done : Climb.None;
  }

  /** One tick of a climber: waiting at the foot, up the ladder, across the wall walk, down the rope. */
  private climbStep(m: Minion, tick: number) {
    const L = this.list[m.aux];
    if (!L || (L.state !== LadderState.Planted && m.task <= Climb.Up)) {
      this.release(m);
      return;
    }
    const sp = this.spots[L.spot];
    const wallYaw = sp.out < 0 ? 0 : DPI;
    if (m.task === Climb.Wait) {
      // Queue at the foot, a little out from it, spread along the wall.
      const slot = (m.id % 4) - 1.5;
      const qx = sp.x + slot * 0.8, qz = sp.footZ + sp.out * 1.0;
      const dx = qx - m.x, dz = qz - m.z;
      const d = dsqrt(dx * dx + dz * dz);
      const last = L.on.length ? this.minions.list[L.on[L.on.length - 1]] : null;
      const room = L.on.length < LADDER.onLadder && (!last || last.climb >= LADDER.gap);
      if (room && d < 1.6) {
        m.task = Climb.Up;
        m.climb = 0;
        L.on.push(m.id);
      } else if (d > 0.15) this.army.move(m, dx / d, dz / d, m.speed * 0.8, wallYaw, Action.Walk);
      else this.army.move(m, 0, 0, 0, wallYaw, Action.Stand);
      return;
    }
    const top = L.walkY;
    if (m.task === Climb.Up) {
      const ux = L.tx - L.fx, uy = L.ty - L.fy, uz = L.tz - L.fz;
      const len = dsqrt(ux * ux + uy * uy + uz * uz) + 1e-9;
      const off = (top - L.fy) / (uy / len); // metres along it to the wall walk's height
      // Keep a gap to the climber above.
      const k = L.on.indexOf(m.id);
      const above = k > 0 ? this.minions.list[L.on[k - 1]] : null;
      const limit = above && above.task === Climb.Up ? above.climb - LADDER.gap : Infinity;
      const next = m.climb + LADDER.up / 60;
      if (next <= limit) m.climb = next;
      if (m.climb >= off) {
        m.task = Climb.Across;
        m.climb = 0;
        if (k >= 0) L.on.splice(k, 1);
        L.rope = true;
        // On the wall walk he waits for his group (see gather).
        L.walk.push(m.id);
        L.walkT.push(tick);
        this.place(m, sp.x + ((m.id % 3) - 1) * 0.4, top, sp.topZ, wallYaw, Action.Stand, 0);
        return;
      }
      const f = m.climb / len;
      // Feet on the rungs, the body on the outer side of the ladder.
      this.place(m, L.fx + ux * f, L.fy + uy * f, L.fz + uz * f + sp.out * 0.22, wallYaw, Action.Climb, LADDER.up / 60);
      return;
    }
    if (m.task === Climb.Across) {
      if (L.walk.indexOf(m.id) >= 0) {
        this.place(m, sp.x + ((m.id % 3) - 1) * 0.4, top, sp.topZ, wallYaw, Action.Stand, 0);
        return;
      }
      const span = (sp.innerZ - sp.topZ) * -sp.out;
      m.climb += LADDER.across / 60;
      if (m.climb >= span) {
        m.task = Climb.Down;
        m.climb = 0;
      }
      const z = sp.topZ - sp.out * (m.climb < 0 ? 0 : m.climb < span ? m.climb : span);
      this.place(m, sp.x, top, z, wallYaw, m.climb < 0 ? Action.Stand : Action.Walk, m.climb < 0 ? 0 : LADDER.across / 60);
      return;
    }
    // Down the rope, facing the wall, out to its foot inside.
    m.climb += LADDER.down / 60;
    const ground = this.terrain.heightAt(sp.x, sp.ropeZ);
    const drop = top - ground;
    if (m.climb >= drop) {
      m.task = this.idle(m);
      m.aux = -1;
      m.climb = 0;
      m.y = ground;
      m.x = sp.x;
      m.z = sp.ropeZ;
      m.action = Action.Stand;
      this.minions.place(m);
      return;
    }
    const f = m.climb / drop;
    this.place(m, sp.x, top - m.climb, sp.innerZ + (sp.ropeZ - sp.innerZ) * f, wallYaw + DPI, Action.Climb, LADDER.down / 60);
    void tick;
  }

  /** Set a climber's pose directly (it moves along the ladder, the wall walk or the rope). */
  private place(m: Minion, x: number, y: number, z: number, yaw: number, action: Action, step: number) {
    m.vx = (x - m.x) * 60;
    m.vz = (z - m.z) * 60;
    m.x = x;
    m.y = y;
    m.z = z;
    let w = yaw;
    if (w > DPI) w -= 2 * DPI;
    m.yaw = w;
    m.phase = (m.phase + step / 0.7) % 1;
    m.action = action;
    if (m.act < 600) m.act++;
    this.minions.place(m);
  }

  /** Every ladder for the renderer (LADDER_STRIDE each). Returns the count. */
  collect(out: Float32Array): number {
    let n = 0;
    for (const L of this.list) {
      if (L.state === LadderState.Gone || (n + 1) * LADDER_STRIDE > out.length) continue;
      const o = n * LADDER_STRIDE;
      const t = L.state === LadderState.Raising ? L.t / LADDER.raise : L.state === LadderState.Planted ? (L.rope ? 1 : 0) : 0;
      out[o] = L.id;
      out[o + 1] = L.team;
      out[o + 2] = L.state;
      out[o + 3] = L.fx;
      out[o + 4] = L.fy;
      out[o + 5] = L.fz;
      out[o + 6] = L.tx;
      out[o + 7] = L.ty;
      out[o + 8] = L.tz;
      out[o + 9] = t;
      n++;
    }
    return n;
  }

  /** Ladders standing against a castle's walls now. */
  plantedAt(castle: number): number {
    let n = 0;
    for (const L of this.list) if (L.state === LadderState.Planted && this.spots[L.spot].castle === castle) n++;
    return n;
  }

  hashInto(out: number[]) {
    out.push(this.list.length, this.planted[0], this.planted[1]);
    for (const L of this.list) {
      out.push(L.state, L.spot, L.t, L.claims, L.bare, L.walkY, L.rope ? 1 : 0, L.on.length, L.walk.length, L.fx, L.fy, L.fz, L.tx, L.ty, L.tz);
      for (let k = 0; k < L.walk.length; k++) out.push(L.walk[k], L.walkT[k]);
      if (L.body) {
        const t = L.body.translation(), r = L.body.rotation();
        out.push(t.x, t.y, t.z, r.x, r.y, r.z, r.w);
      }
    }
  }
}

/** An impulse for a ladder struck by something moving at (vx, vy, vz) with speed v: along it, up to ten metres a second's worth. */
function push(vx: number, vy: number, vz: number, v: number): [number, number, number] {
  const k = (LADDER.mass * (v < 10 ? v : 10)) / (v + 1e-9);
  return [vx * k, vy * k, vz * k];
}

/** The nav cell under a point, through the army (it owns the grid). */
function navCellOf(army: Army, x: number, z: number): number {
  return army.cellAt(x, z);
}
