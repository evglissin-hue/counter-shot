// Repairs (phase 2 M4): each castle's masons walk from their yard by the
// workshop to the damage and rebuild it, a section at a time and the lowest
// course first: a stone goes back only where what it rests on stands and its
// place is clear. Rubble in the way is carried off (or, if it is a stone of
// the same section whose own place is ready, set back there), fallen bodies
// are carried out of the way, and anything else in the place (a minion, a
// shot, a ladder) makes them wait. Every stone costs gold, paid through the
// match's policy, which also says which kinds of section a castle repairs.
// Masons run from enemy minions close by and go back once it is calm; a
// mason knocked down is replaced at the yard after a while.
// Deterministic: crews and masons in a fixed order, Rapier's deterministic
// queries sorted, + - * / and comparisons.

import { masonRefuge, masonYard, REPAIR, REPAIR_KINDS, repairCost, repairSections, sectionOf, Unit, workSpot, type RepairKind, type RepairSection } from "@keepfall/content";
import { DPI, dsqrt } from "@keepfall/core";
import { Action, type Army, type Emit } from "./army";
import type { CastleSim } from "./castleSim";
import { EventKind, WORKS_STRIDE } from "./frame";
import { MinionState, Role, yawOf, type Minion, type Minions } from "./minions";
import type { Terrain } from "./terrain";

/** What a match decides about repairs: which kinds of section a castle repairs, and paying for each stone. */
export interface WorksPolicy {
  allowed(team: number, kind: RepairKind): boolean;
  /** Take `cost` gold from the team; false (and nothing taken) if it cannot pay. */
  pay(team: number, cost: number): boolean;
}

/** What a mason is doing (Minion.task). */
export const enum MasonTask {
  Home = 0,
  Walk = 1,
  Work = 2,
  Flee = 3,
}

/** Why a crew is not putting stones back right now (for the HUD). */
export const enum WorksHold {
  /** At work. */
  None = 0,
  /** Waiting for gold. */
  Gold = 1,
  /** Something they cannot move is in the way (a minion, a shot, a ladder). */
  Blocked = 2,
  /** Enemy minions at the damage. */
  Danger = 3,
  /** Nothing to repair (or nothing allowed). */
  Idle = 4,
}

interface Crew {
  castle: 0 | 1;
  wave: number;
  /** Per place in the crew: its mason (minion id) or -1, and the tick a replacement comes (-1: none due). */
  masons: number[];
  due: number[];
  /** The section being rebuilt (index into repairSections) and the stone that goes back next, or -1. */
  job: number;
  next: number;
  /** Where the masons stand for the next stone (world x, z), and the job that place was chosen for. */
  spotX: number;
  spotZ: number;
  spotJob: number;
  hold: WorksHold;
  /** Pieces still down in the job's section. */
  left: number;
  /** Stones put back, pieces of rubble and bodies carried off, and gold spent. */
  laid: number;
  cleared: number;
  spent: number;
}

/** Places checked for the next stone each time a crew plans. */
const CHECKS = 16;
/** A mason's mallet comes down this often while it works (ticks): the renderer and the sound follow `act`. */
const STROKE = 45;
/** Masons work on stones up to this far (m) from where they stand before they move along. */
const REACH = 5;

export class Works {
  readonly crews: Crew[];
  /** Set by the match; without one, every section is repaired for nothing. */
  policy: WorksPolicy | null = null;
  /** 3.4: may masons put this piece back (a buttress only once it is bought)? Set by the world when the layout has buttresses. */
  mendable: ((id: number) => boolean) | null = null;
  private sections: RepairSection[];
  private sectionOf: Int16Array;
  private dir: [number, number] = [0, 0];

  constructor(
    private minions: Minions,
    private castle: CastleSim,
    private terrain: Terrain,
    private army: Army,
    private emit: Emit,
  ) {
    this.sections = repairSections(castle.layout);
    this.sectionOf = sectionOf(castle.layout);
    this.crews = [0, 1].map((c) => ({
      castle: c as 0 | 1, wave: -1, masons: [], due: [], job: -1, next: -1, spotX: 0, spotZ: 0, spotJob: -1, hold: WorksHold.Idle, left: 0, laid: 0, cleared: 0, spent: 0,
    }));
  }

  /** A castle's masons, at their yard (the start of a match). */
  spawnCrew(castle: 0 | 1, count = REPAIR.crew) {
    const crew = this.crews[castle];
    if (crew.wave < 0) crew.wave = this.army.newWave(castle, 1, true);
    for (let k = 0; k < count; k++) {
      crew.masons.push(-1);
      crew.due.push(-1);
      this.spawnMason(crew, crew.masons.length - 1);
    }
  }

  private spawnMason(crew: Crew, slot: number) {
    const y = masonYard(crew.castle);
    const x = y.x + ((slot % 2) - 0.5) * 1.2, z = y.z + (Math.floor(slot / 2) - 0.5) * 1.2;
    const m = this.army.spawnAt(crew.castle, crew.wave, Unit.Mason, x, z, 0);
    m.role = Role.Mason;
    m.home = crew.castle;
    m.post = slot;
    m.task = MasonTask.Home;
    m.cool = 0;
    crew.masons[slot] = m.id;
  }

  /** Every crew plans and every mason moves and works (after the army's step, before physics). */
  step(tick: number) {
    for (const crew of this.crews) {
      if (crew.wave < 0) continue;
      for (let k = 0; k < crew.masons.length; k++) {
        const id = crew.masons[k];
        if (id >= 0 && this.minions.list[id].state !== MinionState.Upright) {
          crew.masons[k] = -1;
          crew.due[k] = tick + REPAIR.respawn;
        }
        if (crew.masons[k] < 0 && crew.due[k] >= 0 && tick >= crew.due[k]) {
          crew.due[k] = -1;
          this.spawnMason(crew, k);
        }
      }
      if ((tick + crew.castle * 15) % 30 === 0 || (crew.next < 0 && crew.job >= 0 && tick % 5 === 0)) this.plan(crew);
      for (let k = 0; k < crew.masons.length; k++) {
        const id = crew.masons[k];
        if (id >= 0) this.think(crew, this.minions.list[id], k, tick);
      }
    }
  }

  private allowed(team: number, kind: RepairKind): boolean {
    return this.policy ? this.policy.allowed(team, kind) : true;
  }

  /** Pieces of a section that are down (and that masons may put back). */
  private down(sec: RepairSection): number {
    let n = 0;
    for (const id of sec.stones) if (this.castle.dynamic[id] && this.may(id)) n++;
    return n;
  }

  /** 3.4: may masons put this piece back (not a buttress that is not bought)? */
  private may(id: number): boolean {
    return !this.castle.busy[id] && (this.mendable === null || this.mendable(id));
  }

  /** Does what this piece rests on stand (or is there masonry beside it to bond to)? Gate leaves do not carry the wall over them for this. */
  private supported(id: number): boolean {
    const L = this.castle.layout;
    const s = L.stones[id];
    if (s.grounded) return true;
    const dyn = this.castle.dynamic;
    let any = false;
    for (const b of L.below[id]) {
      if (!dyn[b]) any = true;
      else if (L.stones[b].part !== "gate") return false;
    }
    if (any) return true;
    for (const b of L.side[id]) if (!dyn[b]) return true;
    return false;
  }

  /** Is everything in the way something masons can carry off (rubble, fallen bodies)? */
  private movable(other: number[]): boolean {
    for (const h of other) {
      const mid = this.minions.of(h);
      if (mid === undefined || this.minions.list[mid].state !== MinionState.Frozen) return false;
    }
    return true;
  }

  /** Choose the crew's section (keep it while it has work) and the stone that goes back next. */
  private plan(crew: Crew) {
    const team = crew.castle;
    if (crew.job >= 0) {
      const sec = this.sections[crew.job];
      if (!this.allowed(team, sec.kind) || this.down(sec) === 0) crew.job = -1;
    }
    if (crew.job < 0) crew.job = this.pickJob(crew);
    if (crew.job < 0) {
      crew.next = -1;
      crew.left = 0;
      crew.hold = WorksHold.Idle;
      return;
    }
    const sec = this.sections[crew.job];
    crew.left = this.down(sec);
    // Candidates: pieces that can go back now, in the lowest few courses that have any, nearest the crew first
    // (a course higher costs as much as four metres of walking), so they build up the gap without crossing it for every stone.
    const L = this.castle.layout;
    const cand: number[] = [];
    let lowest = -1;
    for (const id of sec.stones) {
      if (!this.castle.dynamic[id] || !this.may(id) || !this.supported(id)) continue;
      const c = L.stones[id].course;
      if (lowest < 0) lowest = c;
      if (c > lowest + 2) break;
      cand.push(id);
    }
    const here = crew.spotJob === crew.job;
    const score = (id: number) => {
      const s = L.stones[id];
      if (!here) return s.course * 1000 + id * 0.001;
      const w = workSpot(L, sec, id);
      const dx = w.x - crew.spotX, dz = w.z - crew.spotZ;
      return (s.course - lowest) * 4 + dsqrt(dx * dx + dz * dz) + id * 1e-6;
    };
    const keyed = cand.map((id) => ({ id, k: score(id) }));
    keyed.sort((a, b) => a.k - b.k);
    let found = -1, blocked = -1, checks = 0;
    for (const { id } of keyed) {
      if (checks++ >= CHECKS) break;
      const p = this.castle.inPlace(id, this.terrain.handles);
      if (p.other.length && !this.movable(p.other)) {
        if (blocked < 0) blocked = id;
        continue;
      }
      found = id;
      break;
    }
    crew.next = found >= 0 ? found : blocked;
    if (crew.next < 0) {
      // Nothing here can go back yet (what it rests on is down in another section): another job first.
      const other = this.pickJob(crew, crew.job);
      if (other >= 0 && other !== crew.job) {
        crew.job = other;
        this.plan(crew);
        return;
      }
      crew.hold = WorksHold.Idle;
      return;
    }
    // The crew keeps its place while the next stone is within reach of it, so they do not re-form for every stone.
    const w = workSpot(this.castle.layout, sec, crew.next);
    const mx = w.x - crew.spotX, mz = w.z - crew.spotZ;
    if (crew.job !== crew.spotJob || mx * mx + mz * mz > REACH * REACH) {
      crew.spotX = w.x;
      crew.spotZ = w.z;
      crew.spotJob = crew.job;
    }
    crew.hold = found < 0 ? WorksHold.Blocked : this.army.enemyNear(team, w.x, w.z, unsafe(sec)) ? WorksHold.Danger : crew.hold === WorksHold.Gold ? WorksHold.Gold : WorksHold.None;
  }

  /**
   * The most urgent section with work that can start now: the gate, then
   * walls, towers and the keep (as allowed); the lowest gap first, then the
   * most damage. `skip` is left out (a section that must wait for another).
   */
  private pickJob(crew: Crew, skip = -1): number {
    let best = -1, bestScore = Infinity;
    for (let k = 0; k < REPAIR_KINDS.length; k++) {
      const kind = REPAIR_KINDS[k];
      if (!this.allowed(crew.castle, kind)) continue;
      for (const sec of this.sections) {
        if (sec.castle !== crew.castle || sec.kind !== kind || sec.index === skip) continue;
        let n = 0, low = 1000, first = -1;
        for (const id of sec.stones) {
          if (!this.castle.dynamic[id] || !this.may(id)) continue;
          n++;
          const c = this.castle.layout.stones[id].course;
          if (c < low && this.supported(id)) {
            low = c;
            first = id;
          }
        }
        if (!n || first < 0) continue;
        const w = workSpot(this.castle.layout, sec, first);
        if (this.army.enemyNear(crew.castle, w.x, w.z, unsafe(sec))) continue;
        const score = k * 100000 + low * 100 - (n < 99 ? n : 99);
        if (score < bestScore) {
          bestScore = score;
          best = sec.index;
        }
      }
    }
    return best;
  }

  private think(crew: Crew, m: Minion, slot: number, tick: number) {
    const team = crew.castle;
    const army = this.army;
    // On the lookout: run from enemy minions close by, back once it has been calm for a while.
    if ((tick + m.id) % 6 === 0) {
      if (army.enemyNear(team, m.x, m.z, REPAIR.flee)) {
        m.task = MasonTask.Flee;
        m.cool = REPAIR.calmTicks;
      } else if (m.task === MasonTask.Flee && army.enemyNear(team, m.x, m.z, REPAIR.calm)) m.cool = REPAIR.calmTicks;
    }
    if (m.task === MasonTask.Flee) {
      if (--m.cool <= 0) m.task = MasonTask.Home;
      const r = masonRefuge(team);
      const tx = r.x + ((slot % 2) - 0.5) * 1.4, tz = r.z + (Math.floor(slot / 2) - 0.5) * 1.0;
      this.walkTo(m, tx, tz, m.speed * 1.25);
      return;
    }
    const working = crew.job >= 0 && crew.next >= 0 && crew.hold !== WorksHold.Danger;
    let tx: number, tz: number;
    if (working) {
      // Spread along the face, square to the line from the spot to the stone.
      const s = this.castle.layout.stones[crew.next];
      let nx = s.x - crew.spotX, nz = s.z - crew.spotZ;
      const nl = dsqrt(nx * nx + nz * nz) + 1e-9;
      nx /= nl;
      nz /= nl;
      const along = (slot - (crew.masons.length - 1) / 2) * REPAIR.spread;
      tx = crew.spotX - nz * along;
      tz = crew.spotZ + nx * along;
    } else {
      const y = masonYard(team);
      tx = y.x + ((slot % 2) - 0.5) * 1.2;
      tz = y.z + (Math.floor(slot / 2) - 0.5) * 1.2;
    }
    // A mason at work stays at it when he is nudged a little off his place; one on his way stops close to it.
    const dx = tx - m.x, dz = tz - m.z;
    const near = m.task === MasonTask.Work && working ? 0.9 : 0.4;
    if (dx * dx + dz * dz > near * near) {
      m.task = MasonTask.Walk;
      if (!this.walkTo(m, tx, tz, m.speed)) army.move(m, 0, 0, 0, NaN, Action.Stand);
      return;
    }
    if (!working) {
      m.task = MasonTask.Home;
      army.move(m, 0, 0, 0, team === 0 ? DPI : 0, Action.Stand);
      return;
    }
    if (m.task !== MasonTask.Work) {
      m.task = MasonTask.Work;
      // Staggered, so the crew's mallets do not fall together.
      if (m.cool < 12 + slot * 9) m.cool = 12 + slot * 9;
      m.act = (slot * 11) % STROKE;
    }
    const s = this.castle.layout.stones[crew.next];
    const fx = s.x - m.x, fz = s.z - m.z;
    const fl = dsqrt(fx * fx + fz * fz);
    if (--m.cool <= 0) this.work(crew, m);
    army.move(m, 0, 0, 0, fl > 0.05 ? yawOf(fx / fl, fz / fl) : m.yaw, Action.Work);
    if (m.act >= STROKE) m.act = 0;
  }

  /** Walk a mason towards a point in its castle; false if there is no way. */
  private walkTo(m: Minion, x: number, z: number, speed: number): boolean {
    if (!this.army.local.steer(m.home, x, z, m.x, m.z, this.dir)) return false;
    this.army.move(m, this.dir[0], this.dir[1], speed, NaN, Action.Walk);
    return true;
  }

  /** One mason's turn of work on the crew's next stone: carry off what is in the way, or put the stone back. */
  private work(crew: Crew, m: Minion) {
    const id = crew.next;
    const castle = this.castle;
    if (id < 0 || !castle.dynamic[id]) {
      crew.next = -1;
      m.cool = 20;
      return;
    }
    const p = castle.inPlace(id, this.terrain.handles);
    for (const h of p.other) {
      const mid = this.minions.of(h);
      if (mid !== undefined && this.minions.list[mid].state === MinionState.Frozen) {
        const b = this.minions.list[mid].parts[1].translation();
        this.minions.bury(mid);
        this.emit(EventKind.Cleared, -1, b.x, b.y, b.z);
        crew.cleared++;
        m.cool = REPAIR.clear;
        return;
      }
    }
    if (p.other.length) {
      crew.hold = WorksHold.Blocked;
      m.cool = 30;
      return;
    }
    if (p.pieces.length) {
      // Rubble in the place: a stone of this section whose own place is ready goes back there; anything else is carried off.
      const r = p.pieces[0];
      const t = castle.bodies[r].translation();
      if (this.sectionOf[r] === crew.job && this.supported(r)) {
        const q = castle.inPlace(r, this.terrain.handles);
        if (!q.pieces.length && !q.other.length && this.lay(crew, m, r, t.x, t.y, t.z)) return;
        if (crew.hold === WorksHold.Gold) return;
      }
      castle.carryOff(r);
      this.emit(EventKind.Cleared, r, t.x, t.y, t.z);
      crew.cleared++;
      m.cool = REPAIR.clear;
      return;
    }
    const was = castle.shattered[id] ? null : castle.bodies[id].translation();
    if (this.lay(crew, m, id, was ? was.x : 0, was ? was.y : -1000, was ? was.z : 0)) crew.next = -1;
  }

  /** Put a piece back, if the castle can pay for it. */
  private lay(crew: Crew, m: Minion, id: number, wx: number, wy: number, wz: number): boolean {
    const s = this.castle.layout.stones[id];
    const cost = repairCost(s);
    if (this.policy && !this.policy.pay(crew.castle, cost)) {
      crew.hold = WorksHold.Gold;
      m.cool = 30;
      return false;
    }
    this.castle.restore(id);
    this.emit(EventKind.Laid, id, wx, wy, wz);
    if (s.part === "gate") this.army.gateHits.delete(id);
    crew.laid++;
    crew.spent += cost;
    if (crew.hold === WorksHold.Gold) crew.hold = WorksHold.None;
    m.cool = s.part === "gate" ? REPAIR.hang : REPAIR.lay;
    m.act = 0;
    return true;
  }

  /** Repairs under way for the renderer (WORKS_STRIDE each). Returns the count. */
  collect(out: Float32Array): number {
    let n = 0;
    for (const crew of this.crews) {
      if (crew.job < 0 || crew.next < 0 || (n + 1) * WORKS_STRIDE > out.length) continue;
      let at = 0;
      for (const id of crew.masons) if (id >= 0 && this.minions.list[id].task === MasonTask.Work) at++;
      if (!at) continue;
      const s = this.castle.layout.stones[crew.next];
      const o = n * WORKS_STRIDE;
      out[o] = crew.castle;
      out[o + 1] = s.x;
      out[o + 2] = s.y;
      out[o + 3] = s.z;
      out[o + 4] = crew.spotX;
      out[o + 5] = crew.spotZ;
      out[o + 6] = crew.next;
      out[o + 7] = at;
      n++;
    }
    return n;
  }

  /** A crew's state for the HUD: the section's name, pieces left, why it waits, masons standing. */
  status(castle: number): { job: string; left: number; hold: WorksHold; masons: number; laid: number; cleared: number; spent: number } {
    const crew = this.crews[castle];
    let up = 0;
    for (const id of crew.masons) if (id >= 0 && this.minions.list[id].state === MinionState.Upright) up++;
    return { job: crew.job >= 0 ? this.sections[crew.job].name : "", left: crew.left, hold: crew.hold, masons: up, laid: crew.laid, cleared: crew.cleared, spent: crew.spent };
  }

  hashInto(out: number[]) {
    for (const c of this.crews) {
      out.push(c.wave, c.job, c.next, c.hold, c.left, c.laid, c.cleared, c.spent, c.spotX, c.spotZ, ...c.masons, ...c.due);
    }
  }
}

/** How close enemy minions keep masons off a section: a gate is not rehung with the enemy near enough to batter it down again. */
function unsafe(sec: RepairSection): number {
  return sec.kind === "gate" ? REPAIR.gateUnsafe : REPAIR.unsafe;
}
