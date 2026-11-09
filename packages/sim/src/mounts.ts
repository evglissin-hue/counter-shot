// Guns on real masonry (the owner's request after M5: something besides the
// keep worth shooting at). Each emplacement stands on the masonry under it,
// worked out once from the layout: the top two courses of its wall walk near
// it, or the top of its tower's ring. A gun is knocked out when that masonry
// gives way (it falls with it), when a ball strikes the gun itself, when a
// chain shot sweeps the crew around it off the wall, or when a shell bursts
// beside it. A knocked-out gun cannot fire, manned or not. Its crew puts it
// back once REMOUNT.ticks have passed and the masonry under it stands again
// (masons rebuild it like any other damage), paid for through a policy the
// match sets (free without one: the Practice range).
//
// Deterministic: emplacements in id order, plain arithmetic, the castle's own
// record of which pieces stand.

import { DIST, GUN_HITS, REMOUNT, remountCost, stoneBounds, type CastleLayout, type Emplacement, type WeaponKind } from "@keepfall/content";
import type { CastleSim } from "./castleSim";
import { EventKind } from "./frame";

/** What knocked a gun out. */
export const enum OutCause {
  /** The masonry under it gave way. */
  Mount = 1,
  /** A ball struck it. */
  Shot = 2,
  /** A chain shot swept its crew off the wall. */
  Chain = 3,
  /** A shell burst beside it. */
  Burst = 4,
}

/** Why a knocked-out gun is not back yet (for the page). */
export const enum OutWait {
  /** Its crew is at work (the delay). */
  Crew = 0,
  /** The masonry under it is down: masons must rebuild it first. */
  Masonry = 1,
  /** Its side has no gold to pay for it. */
  Gold = 2,
}

/** Who pays for putting a gun back (the match: its side's gold). */
export interface MountPolicy {
  /** Pay `cost` for team `team`; false if it cannot now. */
  pay(team: number, cost: number): boolean;
}

export interface GunMount {
  /** Knocked out (cannot fire). */
  out: boolean;
  /** Tick it was knocked out, what did it (OutCause) and the shot that did (-1: none). */
  at: number;
  cause: number;
  shot: number;
  /** Why it is not back yet (OutWait), while out. */
  wait: number;
}

/** The castle a point belongs to: castle 1 holds z < -DIST / 2. */
function castleAt(z: number): 0 | 1 {
  return z < -DIST / 2 ? 1 : 0;
}

/**
 * The masonry an emplacement stands on: on a wall walk, the pieces of its top
 * two courses within GUN_HITS.mountReach of the gun; in a tower (its floor is
 * the top of the ring round it), every piece of the ring's top two courses. A
 * gun on the ground (a mortar pit) stands on nothing that can fall.
 */
export function mountPieces(layout: CastleLayout, e: Emplacement): number[] {
  const castle = castleAt(e.z);
  const ringR = layout.wedge.rOut + 0.6;
  let under = 0, ring = 0;
  const near: number[] = [];
  for (const s of layout.stones) {
    // Battlements are a parapet, not what a gun stands on; a plot's buildings are not either.
    if (s.castle !== castle || s.material !== "stone" || s.part === "merlon" || s.plot !== undefined) continue;
    const dx = s.x - e.x, dz = s.z - e.z;
    if (dx * dx + dz * dz > 36) continue;
    const b = stoneBounds(s, layout.wedge);
    if (b[4] > e.y + 0.05) continue;
    near.push(s.id);
    if (e.x >= b[0] - 0.6 && e.x <= b[3] + 0.6 && e.z >= b[2] - 0.6 && e.z <= b[5] + 0.6 && b[4] > under) under = b[4];
    if (s.shape === "wedge" && dx * dx + dz * dz < ringR * ringR && b[4] > ring) ring = b[4];
  }
  const tower = ring - under > 1.5;
  const floor = tower ? ring : under;
  if (floor < 0.5) return [];
  const out: number[] = [];
  const R = GUN_HITS.mountReach;
  for (const id of near) {
    const s = layout.stones[id];
    const b = stoneBounds(s, layout.wedge);
    if (b[4] < floor - GUN_HITS.mountDepth || b[4] > floor + 0.05) continue;
    if (tower) {
      const dx = s.x - e.x, dz = s.z - e.z;
      if (s.shape !== "wedge" || dx * dx + dz * dz >= ringR * ringR) continue;
    } else {
      // The nearest point of the piece's footprint to the gun.
      const cx = e.x < b[0] ? b[0] : e.x > b[3] ? b[3] : e.x;
      const cz = e.z < b[2] ? b[2] : e.z > b[5] ? b[5] : e.z;
      const dx = cx - e.x, dz = cz - e.z;
      if (dx * dx + dz * dz > R * R) continue;
    }
    out.push(id);
  }
  return out.sort((a, b) => a - b);
}

/** Squared distance from point p to the segment a-b. */
export function segPoint2(ax: number, ay: number, az: number, bx: number, by: number, bz: number, px: number, py: number, pz: number): number {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const l2 = ux * ux + uy * uy + uz * uz;
  let t = l2 > 1e-12 ? ((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + ux * t - px, dy = ay + uy * t - py, dz = az + uz * t - pz;
  return dx * dx + dy * dy + dz * dz;
}

export class Mounts {
  readonly guns: GunMount[];
  /** The masonry under each emplacement (empty: it stands on the ground). */
  readonly pieces: Int32Array[];
  /** Knocked out this step: [emplacement, cause, shot] each (the match pays for them). */
  readonly outs: number[] = [];
  /** Put back this step: [emplacement, gold paid] each. */
  readonly backs: number[] = [];
  policy: MountPolicy | null = null;

  constructor(
    private castle: CastleSim,
    private emplacements: Emplacement[],
    private emit: (kind: EventKind, a: number, b: number, c: number, d: number) => void,
  ) {
    const layout = castle.layout;
    this.pieces = emplacements.map((e) => Int32Array.from(mountPieces(layout, e)));
    this.guns = emplacements.map(() => ({ out: false, at: -1, cause: 0, shot: -1, wait: 0 }));
  }

  /** The share of the masonry under an emplacement that stands now (1 on the ground). */
  standing(emp: number): number {
    const p = this.pieces[emp];
    if (!p || !p.length) return 1;
    const dyn = this.castle.dynamic;
    let n = 0;
    for (let i = 0; i < p.length; i++) if (!dyn[p[i]]) n++;
    return n / p.length;
  }

  /** Can this emplacement's gun fire (as far as its mount goes)? */
  up(emp: number): boolean {
    const g = this.guns[emp];
    return !!g && !g.out;
  }

  /** The point a gun is struck at (its trunnions, a little lower: the carriage and the crew round it). */
  centre(emp: number): [number, number, number] {
    const e = this.emplacements[emp];
    return [e.x, e.y - 0.3, e.z];
  }

  /** Knock an armed gun out (once: a gun already out stays out as it was). */
  knockOut(emp: number, cause: OutCause, shot: number, tick: number) {
    const e = this.emplacements[emp], g = this.guns[emp];
    if (!e || !g || e.empty || g.out) return;
    g.out = true;
    g.at = tick;
    g.cause = cause;
    g.shot = shot;
    g.wait = OutWait.Crew;
    this.outs.push(emp, cause, shot);
    this.emit(EventKind.GunOut, emp, cause, shot, 0);
  }

  /** A burst at a point: guns within GUN_HITS.burst of its radius are blown off their beds. */
  burst(x: number, y: number, z: number, radius: number, shot: number, tick: number) {
    const r = radius * GUN_HITS.burst, r2 = r * r;
    for (let i = 0; i < this.emplacements.length; i++) {
      if (this.emplacements[i].empty || this.guns[i].out) continue;
      const [cx, cy, cz] = this.centre(i);
      const dx = cx - x, dy = cy - y, dz = cz - z;
      if (dx * dx + dy * dy + dz * dz <= r2) this.knockOut(i, OutCause.Burst, shot, tick);
    }
  }

  /**
   * A shot moved from a to b this step: does it pass through a gun? `crew`
   * (a chain shot) sweeps the crew around a gun; otherwise the shot must
   * strike the gun itself (its body's radius plus the ball's). A gun is never
   * struck by its own shot.
   */
  sweep(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ballR: number, crew: boolean, shot: number, own: number, tick: number) {
    for (let i = 0; i < this.emplacements.length; i++) {
      const e = this.emplacements[i];
      if (e.empty || this.guns[i].out || i === own) continue;
      const kind: WeaponKind = e.weapon;
      const r = crew ? GUN_HITS.crew[kind] : GUN_HITS.body[kind] + ballR;
      const [cx, cy, cz] = this.centre(i);
      if (segPoint2(ax, ay, az, bx, by, bz, cx, cy, cz) <= r * r) this.knockOut(i, crew ? OutCause.Chain : OutCause.Shot, shot, tick);
    }
  }

  /**
   * A chain shot's whirl (radius `half`) passes a point this step: the crew of
   * any gun whose trunnions lie within GUN_HITS.crew of the whirl's edge (and
   * as high or low) is swept off the wall.
   */
  whirl(x: number, y: number, z: number, half: number, shot: number, own: number, tick: number) {
    for (let i = 0; i < this.emplacements.length; i++) {
      const e = this.emplacements[i];
      if (e.empty || this.guns[i].out || i === own) continue;
      const crew = GUN_HITS.crew[e.weapon];
      const [cx, cy, cz] = this.centre(i);
      const dy = cy - y;
      if (dy > crew || dy < -crew) continue;
      const dx = cx - x, dz = cz - z, r = half + crew;
      if (dx * dx + dz * dz <= r * r) this.knockOut(i, OutCause.Chain, shot, tick);
    }
  }

  /**
   * After the world's step: guns whose masonry gave way fall with it, and
   * knocked-out guns whose time has come and whose masonry stands are put
   * back (paid for). Returns nothing; `outs` and `backs` list what happened.
   */
  step(tick: number) {
    for (let i = 0; i < this.emplacements.length; i++) {
      const e = this.emplacements[i], g = this.guns[i];
      if (e.empty) {
        // An empty slot holds nothing to knock out (a gun bought for it comes up as it stands).
        if (g.out) {
          g.out = false;
          g.wait = OutWait.Crew;
        }
        continue;
      }
      const share = this.pieces[i].length ? this.standing(i) : 1;
      if (!g.out) {
        if (share < GUN_HITS.mountOut) this.knockOut(i, OutCause.Mount, -1, tick);
        continue;
      }
      if (tick - g.at < REMOUNT.ticks) {
        g.wait = OutWait.Crew;
        continue;
      }
      if (share < GUN_HITS.mountBack) {
        g.wait = OutWait.Masonry;
        continue;
      }
      const cost = remountCost(e.weapon);
      const team = castleAt(e.z);
      if (this.policy && !this.policy.pay(team, cost)) {
        g.wait = OutWait.Gold;
        continue;
      }
      g.out = false;
      g.wait = OutWait.Crew;
      g.shot = -1;
      const paid = this.policy ? cost : 0;
      this.backs.push(i, paid);
      this.emit(EventKind.GunBack, i, paid, 0, 0);
    }
  }

  /**
   * For the page: per emplacement, 0 when up (or empty with its masonry
   * standing), else 1 + OutWait (1 its crew is at work, 2 its masonry is
   * down, 3 no gold), then the ticks left before its crew could have it back.
   * An empty slot whose masonry is down reads 2.
   */
  report(tick: number, out: Int16Array) {
    for (let i = 0; i < this.emplacements.length; i++) {
      const e = this.emplacements[i], g = this.guns[i];
      let state = 0, left = 0;
      if (e.empty) {
        if (this.pieces[i].length && this.standing(i) < GUN_HITS.mountBack) state = 1 + OutWait.Masonry;
      } else if (g.out) {
        left = REMOUNT.ticks - (tick - g.at);
        if (left < 0) left = 0;
        state = 1 + (left > 0 ? OutWait.Crew : g.wait);
        if (left > 0 && this.pieces[i].length && this.standing(i) < GUN_HITS.mountBack) state = 1 + OutWait.Masonry;
      }
      out[i * 2] = state;
      out[i * 2 + 1] = left > 32767 ? 32767 : left;
    }
  }

  hashInto(out: number[]) {
    for (const g of this.guns) out.push(g.out ? 1 : 0, g.at, g.cause, g.shot, g.wait);
  }
}
