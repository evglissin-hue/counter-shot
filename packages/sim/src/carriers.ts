// Powder in the world (phase 3 milestone 3.3): each castle's store of powder,
// the ready box beside every gun, and the three powder boys who carry kegs
// from the store to the guns. CONTRACT (the master's): the types and the
// public surface below are fixed; the executor building the sim fills in the
// behaviour (docs/phase-3/03-powder.md, POWDER in @keepfall/content).
//
// - The store: whole charges per team, in its magazine (a working "magazine"
//   building on one of its plots, cap POWDER.magazineCap) or, with no working
//   magazine, in the keep's cellar (cap POWDER.cellarCap). The rules make
//   powder (Economy: the cellar and the mills, whole charges paid every second)
//   and pay it in with store(); what does not fit is lost. A match starts with
//   POWDER.start in the store. The stock never passes the cap: when the cap
//   falls (the magazine stops working) the stock above it is lost, unless the
//   magazine blew (then everything in it is lost anyway).
// - Boxes: per emplacement, its charges now (start full: boxSize; an empty
//   slot holds none; a gun bought later arrives with its box full: armed()).
//   canPay(emp) says whether its box holds a shot's cost (shotCost); pay(emp)
//   takes it when the gun fires (SandboxSim.apply calls it for every shot,
//   by hand, by its crew or in a salvo; it refuses a fire canPay refuses).
// - Boys: POWDER.boys per castle, Unit.PowderBoy minions with Role.Carrier in
//   the minion list (a wave of their own, like the masons' crew), spawned at
//   keepDoor(). Each repeats an errand: choose the gun most in need (POWDER.topUp
//   order: the gun the team rides, then a gun that cannot fire, then the
//   emptiest under topUp), walk to the store (magazineDoor of the working
//   magazine, else keepDoor), take a keg (POWDER.take ticks; the amount is
//   what the gun has room for with what is already on its way, at most
//   POWDER.keg, at most the stock, taken out of the stock then), walk to
//   powderFoot(e), hoist it (POWDER.hoist ticks; then the box gains it, up to
//   its size), and go back. The team that rides a gun is asked through the
//   policy. They run from enemy men within POWDER.flee as masons do, with their
//   kegs. A boy who falls is replaced at keepDoor after POWDER.respawn ticks.
//   A boy who cannot reach a gun's foot for POWDER.stuck ticks hoists from
//   where he stands within POWDER.reach of it, or takes the keg to the next
//   gun in need (that gun passed over for POWDER.skip ticks).
// - Kegs burst: a boy knocked down while he carries a keg, by anything but a
//   blow (a ball, a burst, falling masonry), sets it off where he lies: a
//   sapper's keg (KEG.burst) through SandboxSim.explode, credited to the shot
//   that knocked him down. Knocked down by a blow, the keg drops unlit and is
//   lost. A boy on his way back carries nothing and sets nothing off. A burst
//   that knocks a carrying boy down sets his keg off on the same tick or the
//   next (kegs set off kegs).
// - The magazine blows (afterStep): when a burst's centre comes inside it
//   (POWDER.inside, POWDER.insideY) or it is wrecked (it was working and is a
//   ruin now) with powder in it, the whole stock goes up as one burst at its
//   middle (magazineBurst(stock)); the stock is lost. An empty magazine makes
//   none. A Powder Mill that is wrecked while it works bursts like one keg
//   (KEG.burst at its middle). Each is an event (EventKind.MagazineBlew,
//   EventKind.MillBlew) and a burst like any other (it sets off kegs and
//   knocks men down, credited to the shot that set it off, -1 for none).
// - Practice range: no Carriers (SandboxSim.carriers is null): boxes never
//   empty, every fire is paid for. A match with MatchOptions.powder false
//   (the keep match: a test about the keep alone) has none either.
//
// Deterministic: crews and boys in a fixed order, Rapier's queries sorted,
// + - * / and comparisons, no Rng draws (nothing here is random).
//
// Build notes: a boy's errand is kept in his Boy record (gun, keg, what
// he reserved at the store) and mirrored into his minion (task, cool: the
// countdown of a take or a hoist, aux: his gun) for the page. A boy who has
// chosen a gun but not yet taken his keg reserves what he will take, so two
// boys do not go for the same charges; "charges on their way" counts kegs and
// reservations alike. The stuck timer counts ticks without getting closer to
// the gun's foot.


import {
  BUILDING_KINDS,
  boxSize,
  castleOfEmp,
  KEG,
  keepDoor,
  magazineBurst,
  magazineDoor,
  masonRefuge,
  PLOTS,
  plotCentre,
  POWDER,
  powderFoot,
  shotCost,
  Unit,
  type Emplacement,
} from "@keepfall/content";
import { dsqrt } from "@keepfall/core";
import type { Action, Army } from "./army";
import { EventKind } from "./frame";
import { Cause, MinionState, Role, yawOf, type Minion, type Minions } from "./minions";
import { PlotState, type Structures } from "./structures";

/** What a boy is doing (Minion.task). */
export const enum BoyTask {
  /** Waiting at the store for a gun in need. */
  Idle = 0,
  /** Walking to the store for a keg. */
  ToStore = 1,
  /** Taking a keg (Minion.cool counts down). */
  Take = 2,
  /** Carrying a keg to a gun's foot. */
  Carry = 3,
  /** Hoisting it up (Minion.cool counts down). */
  Hoist = 4,
  /** Walking back to the store, empty handed. */
  Back = 5,
  /** Running from enemy men (with his keg, if he has one). */
  Flee = 6,
}

/** What the match decides about powder: which emplacement each team rides (served first). */
export interface CarriersPolicy {
  /** The emplacement the team rides now (-1: none). */
  riding(team: number): number;
}

/** One boy's errand, for the page and the AI. */
export interface BoyErrand {
  team: number;
  /** Minion id (-1: fallen, waiting to be replaced). */
  minion: number;
  task: BoyTask;
  /** The emplacement he serves (-1: none), and the charges in his keg (0: none). */
  emplacement: number;
  keg: number;
}

export interface CarriersStatus {
  /** Charges in the team's store, the most it holds now, and the plot of its working magazine (-1: none, the cellar). */
  stock: number;
  cap: number;
  magazine: number;
  /** Charges lost because the store was full, since the match began (the HUD says "Magazine full" while it grows). */
  lost: number;
}

/** Frame actions (Minion.action, FrameData.minions): a boy with a keg on his shoulder, and a boy hoisting it up to its gun. */
export const ACTION_KEG = 10;
export const ACTION_HOIST = 11;

type Emit = (kind: EventKind, a: number, b: number, c: number, d: number) => void;
type Explode = (x: number, y: number, z: number, burst: import("@keepfall/content").BurstDef, shot: number) => void;

/** A burst of the step, as SandboxSim.explode records it. */
export interface BurstRecord {
  x: number;
  y: number;
  z: number;
  radius: number;
  shot: number;
}

interface Boy {
  castle: 0 | 1;
  slot: number;
  /** His minion (-1: fallen, waiting to be replaced), and the tick a replacement comes (-1: none due). */
  minion: number;
  due: number;
  /** The gun he serves (-1: none), the charges in his keg, and what he reserved at the store for it (before he takes his keg). */
  emp: number;
  keg: number;
  want: number;
  /** Ticks without getting closer to the gun's foot, and the closest he has been. */
  stuck: number;
  best: number;
}

const MAGAZINE = BUILDING_KINDS.indexOf("magazine");
const MILL = BUILDING_KINDS.indexOf("mill");
/** A boy is at a place when this close (m). */
const ARRIVED = 1.0;
/** Ticks between a free boy's looks for a gun in need. */
const LOOK = 5;
/** A boy gains ground when he gets this much closer (m). */
const PROGRESS = 0.4;
/** Rounds of bursts setting off bursts in one tick. */
const ROUNDS = 8;

export class Carriers {
  /** Set by the match; without one, no gun is served first. */
  policy: CarriersPolicy | null = null;

  private readonly stock: [number, number] = [POWDER.start, POWDER.start];
  private readonly lostN: [number, number] = [0, 0];
  private readonly boxes: number[];
  /** Until when each gun is passed over (a boy could not reach its foot). */
  private readonly skipUntil: number[];
  private readonly boys: Boy[][] = [[], []];
  private readonly gunsOf: number[][] = [[], []];
  /** Each castle's plot states at the last look (PlotState), to see a building wrecked. */
  private readonly prev: number[][] = [[], []];
  private wave: [number, number] = [-1, -1];
  private dir: [number, number] = [0, 0];
  private seen = 0;
  private own: number[] = [];

  constructor(
    private minions: Minions,
    private army: Army,
    private structures: Structures | null,
    private emps: Emplacement[],
    private emit: Emit,
    private explode: Explode,
    private bursts: BurstRecord[],
  ) {
    this.boxes = emps.map((e) => boxSize(e));
    this.skipUntil = emps.map(() => 0);
    for (const e of emps) this.gunsOf[castleOfEmp(e)].push(e.id);
    for (const c of [0, 1] as const) {
      for (let k = 0; k < POWDER.boys; k++) this.boys[c].push({ castle: c, slot: k, minion: -1, due: -1, emp: -1, keg: 0, want: 0, stuck: 0, best: Infinity });
      for (let p = 0; p < PLOTS.length; p++) this.prev[c].push(this.structures ? this.structures.slot(c, p).state : PlotState.Empty);
    }
  }

  /** Both castles' boys, at the keep's door (the start of a match). */
  spawnAll() {
    for (const c of [0, 1] as const) {
      if (this.wave[c] < 0) this.wave[c] = this.army.newWave(c, 1, true);
      for (const b of this.boys[c]) this.spawn(b);
    }
  }

  private spawn(b: Boy) {
    const d = keepDoor(b.castle);
    const x = d.x + (b.slot - (POWDER.boys - 1) / 2) * 1.2, z = d.z;
    const m = this.army.spawnAt(b.castle, this.wave[b.castle], Unit.PowderBoy, x, z, b.castle === 0 ? 3.141592653589793 / 2 : 0);
    m.role = Role.Carrier;
    m.home = b.castle;
    m.post = b.slot;
    m.task = BoyTask.Back;
    m.cool = 0;
    m.aux = -1;
    b.minion = m.id;
    b.due = -1;
    b.emp = -1;
    b.keg = 0;
    b.want = 0;
    b.stuck = 0;
    b.best = Infinity;
  }

  // ---- The store ----------------------------------------------------------

  /** The plot of the team's working magazine (-1: none). */
  private magazinePlot(team: number): number {
    const st = this.structures;
    if (!st) return -1;
    for (let p = 0; p < PLOTS.length; p++) {
      const s = st.slot(team, p);
      if (s.kind === MAGAZINE && s.state === PlotState.Standing) return p;
    }
    return -1;
  }

  private capOf(team: number): number {
    return this.magazinePlot(team) >= 0 ? POWDER.magazineCap : POWDER.cellarCap;
  }

  /** The team's store now. */
  status(team: number): CarriersStatus {
    return { stock: this.stock[team], cap: this.capOf(team), magazine: this.magazinePlot(team), lost: this.lostN[team] };
  }

  /** Pay made powder into the team's store; returns the charges that did not fit (lost). */
  store(team: number, charges: number): number {
    if (!(charges > 0)) return 0;
    const room = this.capOf(team) - this.stock[team];
    const add = room > 0 ? (charges < room ? charges : room) : 0;
    this.stock[team] += add;
    const over = charges - add;
    this.lostN[team] += over;
    return over;
  }

  /** Room left in the team's store (cap minus stock). */
  room(team: number): number {
    const r = this.capOf(team) - this.stock[team];
    return r > 0 ? r : 0;
  }

  // ---- The boxes ----------------------------------------------------------

  /** Charges in an emplacement's ready box now, and the most it holds. */
  box(emp: number): number {
    return this.boxes[emp] ?? 0;
  }
  boxCap(emp: number): number {
    const e = this.emps[emp];
    return e ? boxSize(e) : 0;
  }

  /** Does the box hold a shot's cost now? (An empty slot: false.) */
  canPay(emp: number): boolean {
    const e = this.emps[emp];
    return !!e && !e.empty && this.boxes[emp] >= shotCost(e);
  }

  /** The gun fires: take a shot's cost from its box (false, and nothing taken, if it cannot pay). */
  pay(emp: number): boolean {
    if (!this.canPay(emp)) return false;
    this.boxes[emp] -= shotCost(this.emps[emp]);
    return true;
  }

  /** A gun was bought for an empty slot (the rules call it): its box starts full. */
  armed(e: Emplacement): void {
    this.boxes[e.id] = boxSize(e);
  }

  // ---- For the page and the AI -------------------------------------------

  private pos(b: Boy): Minion | null {
    if (b.minion < 0) return null;
    const m = this.minions.list[b.minion];
    return m.state === MinionState.Upright ? m : null;
  }

  private storeDoor(castle: number): { x: number; z: number } {
    const p = this.magazinePlot(castle);
    return p >= 0 ? magazineDoor(castle, p) : keepDoor(castle);
  }

  private walkTicks(x0: number, z0: number, x1: number, z1: number, speed: number): number {
    const dx = x1 - x0, dz = z1 - z0;
    return Math.floor((dsqrt(dx * dx + dz * dz) / speed) * 60);
  }

  /** For the page: ticks until the next keg reaches this emplacement's box (-1: none on its way), and the share of a hoist done at its foot (-1: none at work). */
  eta(emp: number): number {
    const e = this.emps[emp];
    if (!e) return -1;
    const c = castleOfEmp(e);
    const foot = powderFoot(e);
    let best = -1;
    for (const b of this.boys[c]) {
      if (b.emp !== emp) continue;
      const m = this.pos(b);
      if (!m) continue;
      let t: number;
      if (b.keg > 0) {
        t = m.task === BoyTask.Hoist ? m.cool : this.walkTicks(m.x, m.z, foot.x, foot.z, POWDER.speedLoaded) + POWDER.hoist;
      } else {
        const d = this.storeDoor(c);
        t = this.walkTicks(m.x, m.z, d.x, d.z, POWDER.speedEmpty) + (m.task === BoyTask.Take ? m.cool : POWDER.take) + this.walkTicks(d.x, d.z, foot.x, foot.z, POWDER.speedLoaded) + POWDER.hoist;
      }
      if (best < 0 || t < best) best = t;
    }
    return best;
  }
  hoisting(emp: number): number {
    const e = this.emps[emp];
    if (!e) return -1;
    for (const b of this.boys[castleOfEmp(e)]) {
      if (b.emp !== emp || b.keg <= 0) continue;
      const m = this.pos(b);
      if (m && m.task === BoyTask.Hoist) return 1 - m.cool / POWDER.hoist;
    }
    return -1;
  }

  /** Every boy of both castles, castle 0's first, in a fixed order. */
  errands(): BoyErrand[] {
    const out: BoyErrand[] = [];
    for (const c of [0, 1] as const) {
      for (const b of this.boys[c]) {
        const m = this.pos(b);
        out.push({ team: c, minion: b.minion, task: m ? (m.task as BoyTask) : BoyTask.Idle, emplacement: b.emp, keg: b.keg });
      }
    }
    return out;
  }

  // ---- Choosing a gun -----------------------------------------------------

  /** Charges on their way to a gun in other boys' kegs (and what they have reserved at the store). */
  private inbound(emp: number, castle: number, except: Boy): number {
    let n = 0;
    for (const o of this.boys[castle]) if (o !== except && o.emp === emp) n += o.keg > 0 ? o.keg : o.want;
    return n;
  }

  /**
   * The gun this boy serves next (-1: none needs one): the gun the team rides
   * when its box has room for one shot more, then a gun that cannot fire, then
   * any at or under POWDER.topUp of its size, the emptiest first, ties to the
   * lowest id. `exclude` is a gun he has just failed to reach.
   */
  private pick(b: Boy, tick: number, exclude = -1): number {
    const ridden = this.policy ? this.policy.riding(b.castle) : -1;
    let best = -1, bestClass = 9, bestShare = Infinity;
    for (const id of this.gunsOf[b.castle]) {
      const e = this.emps[id];
      const size = boxSize(e);
      if (size <= 0 || id === exclude || this.skipUntil[id] > tick) continue;
      const cost = shotCost(e);
      const have = this.boxes[id] + this.inbound(id, b.castle, b);
      const room = size - have;
      if (room <= 0) continue;
      let cls: number;
      if (id === ridden) {
        if (room < cost) continue;
        cls = 0;
      } else if (have < cost) cls = 1;
      else if (have <= POWDER.topUp * size) cls = 2;
      else continue;
      const share = have / size;
      if (cls < bestClass || (cls === bestClass && share < bestShare)) {
        best = id;
        bestClass = cls;
        bestShare = share;
      }
    }
    return best;
  }

  // ---- The boys -----------------------------------------------------------

  /** Boys think and move (after the army's step, before physics). */
  step(tick: number): void {
    for (const c of [0, 1] as const) {
      for (const b of this.boys[c]) {
        if (b.minion < 0) {
          if (b.due >= 0 && tick >= b.due && this.wave[c] >= 0) this.spawn(b);
          continue;
        }
        const m = this.minions.list[b.minion];
        // A fallen boy is dealt with after the physics step (his keg may go off).
        if (m.state !== MinionState.Upright) continue;
        this.think(b, m, tick);
        m.aux = b.emp;
      }
    }
  }

  private walkTo(m: Minion, x: number, z: number, speed: number, action: number): boolean {
    if (!this.army.local.steer(m.home, x, z, m.x, m.z, this.dir)) return false;
    this.army.move(m, this.dir[0], this.dir[1], speed, NaN, action as Action);
    return true;
  }

  private stand(m: Minion, face: number, action: number) {
    this.army.move(m, 0, 0, 0, face, action as Action);
  }

  private think(b: Boy, m: Minion, tick: number) {
    const castle = b.castle;
    const loaded = b.keg > 0;
    const walkAction = loaded ? ACTION_KEG : 0;
    const standAction = loaded ? ACTION_KEG : 1;
    const speed = loaded ? POWDER.speedLoaded : POWDER.speedEmpty;
    // On the lookout, as masons are: run from enemy men close by, back once it has been calm for a while.
    if ((tick + m.id) % 6 === 0) {
      if (this.army.enemyNear(castle, m.x, m.z, POWDER.flee)) {
        if (m.task !== BoyTask.Flee) this.leave(b);
        m.task = BoyTask.Flee;
        m.cool = POWDER.calmTicks;
      } else if (m.task === BoyTask.Flee && this.army.enemyNear(castle, m.x, m.z, POWDER.calm)) m.cool = POWDER.calmTicks;
    }
    if (m.task === BoyTask.Flee) {
      if (--m.cool <= 0) {
        m.task = b.keg > 0 ? BoyTask.Carry : b.emp >= 0 ? BoyTask.ToStore : BoyTask.Back;
        b.stuck = 0;
        b.best = Infinity;
        m.cool = 0;
      } else {
        const r = masonRefuge(castle);
        const tx = r.x + (b.slot - (POWDER.boys - 1) / 2) * 1.4, tz = r.z;
        if (!this.walkTo(m, tx, tz, speed * 1.25, walkAction)) this.stand(m, NaN, standAction);
        return;
      }
    }
    switch (m.task) {
      case BoyTask.Idle:
      case BoyTask.Back: {
        if ((tick + m.id) % LOOK === 0) {
          const g = this.pick(b, tick);
          if (g >= 0) {
            this.choose(b, g);
            m.task = BoyTask.ToStore;
            return;
          }
        }
        const d = this.storeDoor(castle);
        const dx = d.x - m.x, dz = d.z - m.z;
        if (dx * dx + dz * dz > ARRIVED * ARRIVED && this.walkTo(m, d.x, d.z, speed, walkAction)) {
          m.task = BoyTask.Back;
          return;
        }
        m.task = dx * dx + dz * dz > ARRIVED * ARRIVED * 4 ? BoyTask.Back : BoyTask.Idle;
        this.stand(m, NaN, standAction);
        return;
      }
      case BoyTask.ToStore: {
        const d = this.storeDoor(castle);
        const dx = d.x - m.x, dz = d.z - m.z;
        if (dx * dx + dz * dz > ARRIVED * ARRIVED) {
          if (!this.walkTo(m, d.x, d.z, speed, walkAction)) this.stand(m, NaN, standAction);
          return;
        }
        m.task = BoyTask.Take;
        m.cool = POWDER.take;
        m.act = 0;
        this.stand(m, NaN, standAction);
        return;
      }
      case BoyTask.Take: {
        const d = this.storeDoor(castle);
        const dx = d.x - m.x, dz = d.z - m.z;
        if (dx * dx + dz * dz > ARRIVED * ARRIVED * 4) {
          // The store moved (a magazine went up or came down): walk to the new door.
          m.task = BoyTask.ToStore;
          return;
        }
        if (m.cool > 0) m.cool--;
        if (m.cool <= 0) this.takeKeg(b, m);
        this.stand(m, NaN, b.keg > 0 ? ACTION_KEG : 1);
        return;
      }
      case BoyTask.Carry: {
        const e = this.emps[b.emp];
        if (!e) {
          // Nothing to carry to (cannot happen: slots never vanish): hold the keg.
          m.task = BoyTask.Back;
          return;
        }
        const f = powderFoot(e);
        const dx = f.x - m.x, dz = f.z - m.z;
        const d = dsqrt(dx * dx + dz * dz);
        if (d <= ARRIVED || (b.stuck >= POWDER.stuck && d <= POWDER.reach)) {
          m.task = BoyTask.Hoist;
          m.cool = POWDER.hoist;
          m.act = 0;
          this.emit(EventKind.Hoist, b.emp, b.keg, m.id, 0);
          this.stand(m, this.faceGun(m, e), ACTION_HOIST);
          return;
        }
        if (d < b.best - PROGRESS) {
          b.best = d;
          b.stuck = 0;
        } else b.stuck++;
        if (b.stuck >= POWDER.stuck) {
          // He cannot get there: the keg goes to the next gun in need, and this one is passed over for a while.
          this.skipUntil[b.emp] = tick + POWDER.skip;
          const g = this.pick(b, tick, b.emp);
          b.stuck = 0;
          b.best = Infinity;
          if (g >= 0) b.emp = g;
        }
        if (!this.walkTo(m, f.x, f.z, speed, ACTION_KEG)) this.stand(m, NaN, ACTION_KEG);
        return;
      }
      case BoyTask.Hoist: {
        const e = this.emps[b.emp];
        if (--m.cool <= 0 || !e) {
          if (e) this.hoisted(b, e);
          m.task = BoyTask.Back;
          m.cool = 0;
          this.stand(m, NaN, 1);
          return;
        }
        this.stand(m, this.faceGun(m, e), ACTION_HOIST);
        return;
      }
      default:
        m.task = BoyTask.Back;
        return;
    }
  }

  /** He has chosen a gun: he reserves what he will take for it. */
  private choose(b: Boy, g: number) {
    const e = this.emps[g];
    const room = boxSize(e) - this.boxes[g] - this.inbound(g, b.castle, b);
    b.emp = g;
    b.want = room < POWDER.keg ? room : POWDER.keg;
    b.keg = 0;
  }

  /** Fleeing with only a reservation: it is given up (he looks again when he is back); a keg he keeps. */
  private leave(b: Boy) {
    if (b.keg > 0) return;
    b.emp = -1;
    b.want = 0;
  }

  /** The keg's time is up: take what the gun has room for (with what is on its way) from the store, or wait at the door if it is empty. */
  private takeKeg(b: Boy, m: Minion) {
    const e = this.emps[b.emp];
    if (!e || boxSize(e) <= 0) {
      this.release(b, m);
      return;
    }
    const room = boxSize(e) - this.boxes[b.emp] - this.inbound(b.emp, b.castle, b);
    if (room <= 0) {
      this.release(b, m);
      return;
    }
    const have = this.stock[b.castle];
    if (have <= 0) return;
    let n = room < POWDER.keg ? room : POWDER.keg;
    if (n > have) n = have;
    this.stock[b.castle] -= n;
    b.keg = n;
    b.want = 0;
    b.stuck = 0;
    b.best = Infinity;
    m.task = BoyTask.Carry;
    m.cool = 0;
  }

  private release(b: Boy, m: Minion) {
    b.emp = -1;
    b.want = 0;
    b.keg = 0;
    m.task = BoyTask.Back;
    m.cool = 0;
  }

  /** The hoist is done: the box gains the keg (capped at its size; any excess is lost). */
  private hoisted(b: Boy, e: Emplacement) {
    const size = boxSize(e);
    const room = size - this.boxes[e.id];
    const add = b.keg < room ? b.keg : room > 0 ? room : 0;
    this.boxes[e.id] += add;
    this.emit(EventKind.Boxed, e.id, add, 0, 0);
    b.keg = 0;
    b.emp = -1;
    b.want = 0;
  }

  private faceGun(m: Minion, e: Emplacement): number {
    const dx = e.x - m.x, dz = e.z - m.z;
    const d = dsqrt(dx * dx + dz * dz);
    return d > 0.05 ? yawOf(dx / d, dz / d) : m.yaw;
  }

  // ---- Bursts -------------------------------------------------------------

  /** After the physics step and the bursts of the step: kegs that go off with fallen boys, the magazine and mills that blow. */
  afterStep(tick: number): void {
    this.seen = 0;
    this.own.length = 0;
    // Buildings wrecked this step (Standing to Ruined): magazines and mills, castle 0's first.
    const wrecked: Array<[number, number]> = [];
    if (this.structures) {
      for (const c of [0, 1] as const) {
        for (let p = 0; p < PLOTS.length; p++) {
          const now = this.structures.slot(c, p).state;
          if (this.prev[c][p] === PlotState.Standing && now === PlotState.Ruined) wrecked.push([c, p]);
          this.prev[c][p] = now;
        }
      }
    }
    for (let round = 0; round < ROUNDS; round++) {
      let any = false;
      // A boy who is down with a keg: it goes off where he lies, unless he was struck down in a fight.
      for (const c of [0, 1] as const) {
        for (const b of this.boys[c]) {
          if (b.minion < 0) continue;
          const m = this.minions.list[b.minion];
          if (m.state === MinionState.Upright) continue;
          if (this.fell(b, m, tick)) any = true;
        }
      }
      // Wrecked while it worked: a mill bursts like a keg; a magazine with powder in it goes up.
      for (const [c, p] of wrecked.splice(0)) {
        const k = this.structures!.slot(c, p).kind;
        if (k === MAGAZINE) {
          if (this.blow(c, p, -1)) any = true;
        } else if (k === MILL) {
          const at = plotCentre(c, p);
          this.emit(EventKind.MillBlew, c, p, 0, -1);
          this.explode(at.x, 1.0, at.z, KEG.burst, -1);
          any = true;
        }
      }
      // A burst of this step with its centre inside a stocked magazine sets it off.
      while (this.seen < this.bursts.length) {
        const i = this.seen++;
        if (this.own.includes(i)) continue;
        const bu = this.bursts[i];
        if (this.structures) {
          for (const c of [0, 1] as const) {
            for (let p = 0; p < PLOTS.length; p++) {
              const s = this.structures.slot(c, p);
              if (s.kind !== MAGAZINE || (s.state !== PlotState.Standing && s.state !== PlotState.Ruined)) continue;
              if (this.stock[c] > 0 && this.within(c, p, bu.x, bu.y, bu.z) && this.blow(c, p, bu.shot)) any = true;
            }
          }
        }
      }
      if (!any) break;
    }
    // The store holds only so much: what the magazine's loss leaves above the cellar's cap is lost.
    for (const c of [0, 1] as const) {
      const cap = this.capOf(c);
      if (this.stock[c] > cap) {
        this.lostN[c] += this.stock[c] - cap;
        this.stock[c] = cap;
      }
    }
  }

  /** Is a burst's centre inside the magazine on this plot (its footprint grown a little, and low)? */
  private within(c: number, p: number, x: number, y: number, z: number): boolean {
    const P = PLOTS[p];
    const at = plotCentre(c, p);
    const dx = x - at.x, dz = z - at.z;
    const hx = P.w / 2 + POWDER.inside, hz = P.d / 2 + POWDER.inside;
    return y < POWDER.insideY && dx >= -hx && dx <= hx && dz >= -hz && dz <= hz;
  }

  /** The magazine goes up with everything in it (false: it was empty, no burst). */
  private blow(c: number, p: number, shot: number): boolean {
    const stock = this.stock[c];
    const burst = magazineBurst(stock);
    if (!burst) return false;
    this.stock[c] = 0;
    const at = plotCentre(c, p);
    this.emit(EventKind.MagazineBlew, c, p, stock, shot);
    this.explode(at.x, 1.0, at.z, burst, shot);
    this.own.push(this.bursts.length - 1);
    return true;
  }

  /** A boy is down: his keg goes off where he lies (unless a blow felled him), and a replacement is due. Returns whether a burst went off. */
  private fell(b: Boy, m: Minion, tick: number): boolean {
    const keg = b.keg > 0;
    b.minion = -1;
    b.due = tick + POWDER.respawn;
    b.keg = 0;
    b.want = 0;
    b.emp = -1;
    b.stuck = 0;
    b.best = Infinity;
    if (!keg || m.downCause === Cause.Blow) return false;
    const p = m.parts.length > 1 ? m.parts[1].translation() : { x: m.x, y: m.y + 1, z: m.z };
    this.emit(EventKind.KegBurst, m.id, p.x, p.y, p.z);
    this.explode(p.x, p.y, p.z, KEG.burst, m.downShot ?? -1);
    return true;
  }

  hashInto(out: number[]): void {
    out.push(this.stock[0], this.stock[1], this.lostN[0], this.lostN[1], ...this.boxes, ...this.skipUntil);
    for (const c of [0, 1] as const) {
      out.push(...this.prev[c]);
      for (const b of this.boys[c]) {
        const m = b.minion >= 0 ? this.minions.list[b.minion] : null;
        out.push(b.minion, b.due, m ? m.task : -1, b.emp, b.keg, b.want, m ? m.cool : -1, b.stuck, b.best === Infinity ? -1 : b.best);
      }
    }
  }
}
