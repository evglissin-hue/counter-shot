// Sappers and musketeers (phase 2 M3): the two Ashwright units that do more
// than march and stab. The army asks steer() first for each of them; when it
// says no, they march and fight like pikemen (weakly: see their UnitDefs).
//
// - A sapper carries a powder keg. Close to the enemy front wall he makes for
//   its foot, away from the gate and the towers, sets the keg, lights it and
//   runs; it bursts after KEG.fuse ticks and blows a breach. A sapper knocked
//   down by a ball, a burst, falling masonry or a musket ball on the way sets
//   his keg off where he lies, among his own wave; a burst near a set keg sets
//   it off too.
// - A musketeer stops for an enemy he can see within MUSKET.range, aims and
//   fires: a hit knocks the man down, more likely close in. Closer than
//   MUSKET.close he fights like anyone else.
//
// Deterministic: minions are steered in the army's order, every roll comes
// from this module's own stream, and the line of sight reads the nav grid.

import { DIST, KEG, MUSKET, Unit, type BurstDef } from "@keepfall/content";
import { dsqrt, Rng } from "@keepfall/core";
import { EventKind, KEG_STRIDE } from "./frame";
import { Cause, MinionState, Role, yawOf, type Minion, type Minions } from "./minions";
import { NavKind, navCell, type NavGrid } from "./nav";
import type { Terrain } from "./terrain";

/** What a sapper is doing (Minion.task). */
export const enum SapperTask {
  /** Carrying his keg with the wave, then to the wall. */
  Carry = 0,
  /** Setting it against the wall (Minion.cool counts down). */
  Plant = 1,
  /** Running from it. */
  Run = 2,
  /** No keg any more: he marches and fights like the rest. */
  Done = 3,
}

/** Actions the renderer knows (army.ts Action continues here). */
export const ACTION_PLANT = 8;
export const ACTION_AIM = 9;

/** One step of steering, written by steer() for the army to carry out. */
export interface Steer {
  mx: number;
  mz: number;
  speed: number;
  /** Yaw to face (NaN: wherever it walks). */
  face: number;
  action: number;
}

interface Keg {
  /** Where it stands, against the wall. */
  x: number;
  y: number;
  z: number;
  /** Where it bursts: packed into the foot of the wall (KEG.into, KEG.up). */
  by: number;
  bz: number;
  /** Tick it bursts. */
  at: number;
  /** The shot that set it off early (-1: none). */
  shot: number;
}

type Emit = (kind: EventKind, a: number, b: number, c: number, d: number) => void;
export type Explode = (x: number, y: number, z: number, burst: BurstDef, shot: number) => void;

/** World z of a castle's front wall's outer face, and which way is out (towards the field). */
const FACE = 16;
function frontFace(castle: number): { z: number; out: number } {
  return castle === 0 ? { z: -FACE, out: -1 } : { z: -DIST + FACE, out: 1 };
}

export class Specialists {
  readonly kegs: Keg[] = [];
  private rng: Rng;
  /** Sappers carrying a keg when last seen standing (ids), to notice the ones who fall with it. */
  private carriers: number[] = [];

  constructor(
    private minions: Minions,
    private nav: NavGrid,
    private terrain: Terrain,
    seed: number,
    private emit: Emit,
    private explode: Explode,
  ) {
    this.rng = new Rng(seed);
  }

  /** What a sapper or musketeer does this tick, if not what a pikeman would: false leaves him to the army. */
  steer(m: Minion, tick: number, out: Steer): boolean {
    if (m.unit === Unit.Sapper) return this.sapper(m, tick, out);
    if (m.unit === Unit.Musketeer) return this.musketeer(m, tick, out);
    return false;
  }

  /** A sapper still carrying, setting or running from his keg: his task and aux are his own (no ladder for him yet). */
  busy(m: Minion): boolean {
    return m.unit === Unit.Sapper && (m.task === SapperTask.Carry || m.task === SapperTask.Plant || m.task === SapperTask.Run);
  }

  private sapper(m: Minion, tick: number, out: Steer): boolean {
    // Done with his keg (or climbing a ladder since: M4's tasks): the army has him.
    if (!this.busy(m)) return false;
    const castle = 1 - m.team;
    const f = frontFace(castle);
    if (m.task === SapperTask.Carry) {
      // Still on the way: march with the wave until the wall is near.
      const before = (f.z - m.z) * f.out < 0; // outside the wall, on the field side
      const d = (m.z - f.z) * f.out;
      if (!before || d > KEG.near) return false;
      if (m.aux <= 0) {
        // Choose where to set it (aux: 1 once chosen): the foot of the wall nearest him, clear of the gate and the towers.
        const lo = KEG.gateClear, hi = 15 - KEG.towerClear;
        let side = m.x > 0 ? 1 : m.x < 0 ? -1 : (m.id & 1) === 0 ? 1 : -1;
        let ax = m.x * side;
        ax = ax < lo ? lo : ax > hi ? hi : ax;
        m.tx = ax * side;
        m.tz = f.z + f.out * 0.75;
        m.aux = 1;
        // A breach there already: no need for the keg.
        const c = navCell(m.tx, f.z - f.out * 1.0);
        if (c >= 0 && this.nav.kind[c] !== NavKind.Raised && this.nav.kind[c] !== NavKind.Blocked) {
          m.task = SapperTask.Done;
          return false;
        }
      }
      const dx = m.tx - m.x, dz = m.tz - m.z;
      const dd = dsqrt(dx * dx + dz * dz);
      if (dd < 0.7) {
        m.task = SapperTask.Plant;
        m.cool = KEG.plant;
        m.act = 0;
        return this.hold(m, out, faceOf(0, -f.out), ACTION_PLANT);
      }
      out.mx = dx / dd;
      out.mz = dz / dd;
      out.speed = m.speed;
      out.face = NaN;
      out.action = 0;
      return true;
    }
    if (m.task === SapperTask.Plant) {
      if (--m.cool <= 0) {
        const kz = f.z + f.out * 0.45;
        const ky = this.terrain.heightAt(m.x, kz) + 0.35;
        this.kegs.push({ x: m.x, y: ky, z: kz, by: ky - 0.35 + KEG.up, bz: f.z - f.out * KEG.into, at: tick + KEG.fuse, shot: -1 });
        this.emit(EventKind.Keg, m.id, m.x, ky, kz);
        m.task = SapperTask.Run;
        m.tx = m.x;
        m.tz = f.z + f.out * KEG.run;
      }
      return this.hold(m, out, faceOf(0, -f.out), ACTION_PLANT);
    }
    // Running from the keg.
    const dx = m.tx - m.x, dz = m.tz - m.z;
    const dd = dsqrt(dx * dx + dz * dz);
    if (dd < 0.8) {
      m.task = SapperTask.Done;
      return false;
    }
    out.mx = dx / dd;
    out.mz = dz / dd;
    out.speed = m.speed * 1.35;
    out.face = NaN;
    out.action = 0;
    return true;
  }

  private musketeer(m: Minion, tick: number, out: Steer): boolean {
    // m.target is his mark; m.cool his reload; m.aux the ticks he has aimed (a new minion's aux is -1).
    if (m.aux < 0) m.aux = 0;
    let t = m.target >= 0 ? this.minions.list[m.target] : null;
    if (t && (t.state !== MinionState.Upright || t.team === m.team)) t = null;
    if (t) {
      const dx = t.x - m.x, dz = t.z - m.z;
      if (dx * dx + dz * dz > MUSKET.range * MUSKET.range * 1.1) t = null;
    }
    if (!t && (tick + m.id) % 10 === 0) t = this.mark(m);
    if (m.cool > 0) m.cool--;
    if (!t) {
      m.target = -1;
      m.aux = 0;
      return false;
    }
    m.target = t.id;
    const dx = t.x - m.x, dz = t.z - m.z;
    const d = dsqrt(dx * dx + dz * dz) + 1e-9;
    if (d < MUSKET.close) {
      // Too close for the musket: the butt, as anyone would.
      m.aux = 0;
      return false;
    }
    if (m.cool <= 0) {
      if (++m.aux >= MUSKET.aim) {
        m.aux = 0;
        m.cool = MUSKET.reloadMin + Math.floor(this.rng.next() * (MUSKET.reloadMax - MUSKET.reloadMin + 1));
        m.act = 0;
        this.fire(m, t, d, tick);
      }
    }
    return this.hold(m, out, yawOf(dx / d, dz / d), ACTION_AIM);
  }

  /** The nearest enemy he can see within range, or null. */
  private mark(m: Minion): Minion | null {
    let best: Minion | null = null, bd = MUSKET.range * MUSKET.range;
    for (const n of this.minions.list) {
      if (n.team === m.team || n.state !== MinionState.Upright || n.wave < 0 || n.role === Role.Carrier) continue;
      const dx = n.x - m.x, dz = n.z - m.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= bd) continue;
      if (!this.sees(m.x, m.y + MUSKET.eye, m.z, n.x, n.y + 1.2, n.z)) continue;
      bd = d2;
      best = n;
    }
    return best;
  }

  /** Is the line from a to b clear of masonry and ground (half-metre samples over the nav grid)? */
  private sees(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dz = bz - az;
    const len = dsqrt(dx * dx + dz * dz);
    const steps = Math.ceil(len / 0.5);
    const c0 = navCell(ax, az), c1 = navCell(bx, bz);
    for (let s = 1; s < steps; s++) {
      const f = s / steps;
      const x = ax + dx * f, z = az + dz * f, y = ay + (by - ay) * f;
      const c = navCell(x, z);
      if (c < 0) return false;
      if (c === c0 || c === c1) continue;
      const k = this.nav.kind[c];
      if (k === NavKind.Blocked) return false;
      const floor = k === NavKind.Raised || k === NavKind.Rubble ? this.nav.floor[c] : this.terrain.heightAt(x, z);
      if (floor > y) return false;
    }
    return true;
  }

  private fire(m: Minion, t: Minion, d: number, tick: number) {
    const M = MUSKET;
    const k = d <= M.near ? 0 : (d - M.near) / (M.range - M.near);
    const p = M.hitNear + (M.hitFar - M.hitNear) * (k > 1 ? 1 : k);
    const ux = (t.x - m.x) / d, uz = (t.z - m.z) / d;
    const hit = this.rng.next() < p;
    if (hit) {
      this.minions.knock({ minion: t.id, vx: ux * M.knock, vy: 1.0, vz: uz * M.knock, px: t.x - ux * 0.2, py: t.y + 1.3, pz: t.z - uz * 0.2, extra: 0.6, cause: Cause.Musket }, tick);
      this.emit(EventKind.Blood, t.x, t.y + 1.3, t.z, 0.35);
      this.emit(EventKind.Musket, m.id, t.x, t.y + 1.3, t.z);
    } else {
      // A miss: the ball goes by, a little off.
      const sx = (this.rng.next() - 0.5) * 2.4, sy = this.rng.next() * 1.2;
      this.emit(EventKind.Musket, m.id, t.x + uz * sx, t.y + 0.6 + sy, t.z - ux * sx);
    }
  }

  /** Stand where he is, facing `face`, doing `action`. */
  private hold(m: Minion, out: Steer, face: number, action: number): boolean {
    out.mx = 0;
    out.mz = 0;
    out.speed = 0;
    out.face = face;
    out.action = action;
    return true;
  }

  /** Before the army thinks: note the sappers (once each), so one who falls with his keg is noticed after the step. */
  beforeStep() {
    for (let i = this.seen; i < this.minions.list.length; i++) if (this.minions.list[i].unit === Unit.Sapper) this.carriers.push(i);
    this.seen = this.minions.list.length;
  }
  /** Minions looked at so far by beforeStep. */
  private seen = 0;

  /**
   * After the physics step: a sapper knocked down with his keg, by anything
   * but a blow, sets it off where he lies (credited to whatever shot knocked
   * him down); set kegs whose fuse has burnt down burst. Bursts may set off more.
   */
  afterStep(tick: number) {
    this.beforeStep();
    for (let round = 0; round < 8; round++) {
      let any = false;
      for (const id of this.carriers) {
        const m = this.minions.list[id];
        if (m.unit !== Unit.Sapper || m.state === MinionState.Upright || !this.busy(m)) continue;
        // Only a keg still in his hands goes off with him (running from a set keg, he has none).
        const armed = m.task === SapperTask.Carry || m.task === SapperTask.Plant;
        m.task = SapperTask.Done;
        if (!armed || m.downCause === Cause.Blow) continue; // knocked down in a fight: the keg drops, unlit
        const p = m.parts.length > 1 ? m.parts[1].translation() : { x: m.x, y: m.y + 1, z: m.z };
        this.explode(p.x, p.y, p.z, KEG.burst, m.downShot ?? -1);
        any = true;
      }
      for (let k = 0; k < this.kegs.length; k++) {
        const g = this.kegs[k];
        if (tick < g.at) continue;
        this.kegs.splice(k--, 1);
        this.explode(g.x, g.by, g.bz, KEG.burst, g.shot);
        any = true;
      }
      if (!any) break;
    }
  }

  /** A burst at a point: set kegs within its reach go off with it, on this tick. */
  burstNear(x: number, y: number, z: number, radius: number, shot: number, tick: number) {
    const r2 = radius * radius;
    for (const g of this.kegs) {
      const dx = g.x - x, dy = g.y - y, dz = g.z - z;
      if (dx * dx + dy * dy + dz * dz <= r2 && g.at > tick) {
        g.at = tick;
        g.shot = shot;
      }
    }
  }

  /** [x, y, z, ticks left] per set keg. */
  collect(out: Float32Array, tick: number): number {
    let n = 0;
    for (const g of this.kegs) {
      if ((n + 1) * KEG_STRIDE > out.length) break;
      out.set([g.x, g.y, g.z, g.at - tick], n * KEG_STRIDE);
      n++;
    }
    return n;
  }

  hashInto(out: number[]) {
    out.push(this.kegs.length);
    for (const g of this.kegs) out.push(g.x, g.y, g.z, g.by, g.bz, g.at, g.shot);
  }
}

/** Yaw facing along (dx, dz) (unit). */
function faceOf(dx: number, dz: number): number {
  return yawOf(dx, dz);
}
