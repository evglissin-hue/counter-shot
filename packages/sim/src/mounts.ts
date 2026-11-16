// Guns on real masonry (the owner's request after M5: something besides the
// keep worth shooting at). Each emplacement stands on the masonry under it,
// worked out once from the layout: the top two courses of its wall walk near
// it, or the top of its tower's ring. A gun is knocked out when that masonry
// gives way (it falls with it), when a ball strikes the gun itself, or when a
// shell bursts beside it (3.6: a chain shot's balls knock a gun out only by
// striking its body, like any ball; its chain takes the crew as men and the
// gun stays up). A knocked-out gun cannot fire, manned or not. Its crew puts
// it back once REMOUNT.ticks have passed, the masonry under it stands again
// (masons rebuild it like any other damage) and one of the crew is at its
// post (3.6: OutWait.Hands otherwise), paid for through a policy the match
// sets (free without one: the Practice range).
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
  /** Unused since 3.6: a chain shot sweeps a gun's crew down as men and no longer knocks the gun out by them. */
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
  /** 3.6: none of its crew is at it to put it back (a replacement is on his way, or the reserve is dry). */
  Hands = 3,
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
 * The masonry something stands on at (px, pz) with its feet no higher than
 * `py` (+ 0.05), in a castle: on a wall walk, the pieces of its top two
 * courses within GUN_HITS.mountReach; in a tower (its floor is the top of the
 * ring round it), every piece of the ring's top two courses. `any` lets every
 * material count (a keep's floor boards), not only stone. Battlements and a
 * plot's buildings never count. `floor` is the height of the floor (under
 * 0.5: the ground, and no pieces).
 */
export function supportOf(layout: CastleLayout, castle: number, px: number, pz: number, py: number, any = false, reach: number = GUN_HITS.mountReach): { ids: number[]; floor: number } {
  const ringR = layout.wedge.rOut + 0.6;
  let under = 0, ring = 0;
  const near: number[] = [];
  for (const s of layout.stones) {
    // Battlements are a parapet, not what a gun stands on; a plot's buildings are not either.
    if (s.castle !== castle || (!any && s.material !== "stone") || s.part === "merlon" || s.plot !== undefined) continue;
    const dx = s.x - px, dz = s.z - pz;
    if (dx * dx + dz * dz > 36) continue;
    const b = stoneBounds(s, layout.wedge);
    if (b[4] > py + 0.05) continue;
    near.push(s.id);
    if (px >= b[0] - 0.6 && px <= b[3] + 0.6 && pz >= b[2] - 0.6 && pz <= b[5] + 0.6 && b[4] > under) under = b[4];
    if (s.shape === "wedge" && dx * dx + dz * dz < ringR * ringR && b[4] > ring) ring = b[4];
  }
  // (3.6: a wall gun beside a tower sees the tower's ring a course or three above its own wall walk: only a ring well above it, or with nothing under the post at all, is a tower's deck.)
  const tower = ring - under > 3;
  const floor = tower ? ring : under;
  if (floor < 0.5) return { ids: [], floor: 0 };
  const out: number[] = [];
  const R = reach;
  for (const id of near) {
    const s = layout.stones[id];
    const b = stoneBounds(s, layout.wedge);
    if (b[4] < floor - GUN_HITS.mountDepth || b[4] > floor + 0.05) continue;
    if (tower) {
      const dx = s.x - px, dz = s.z - pz;
      if (s.shape !== "wedge" || dx * dx + dz * dz >= ringR * ringR) continue;
    } else {
      // The nearest point of the piece's footprint to the post.
      const cx = px < b[0] ? b[0] : px > b[3] ? b[3] : px;
      const cz = pz < b[2] ? b[2] : pz > b[5] ? b[5] : pz;
      const dx = cx - px, dz = cz - pz;
      if (dx * dx + dz * dz > R * R) continue;
    }
    out.push(id);
  }
  return { ids: out.sort((a, b) => a - b), floor };
}

/**
 * The masonry an emplacement stands on: on a wall walk, the pieces of its top
 * two courses within GUN_HITS.mountReach of the gun; in a tower (its floor is
 * the top of the ring round it), every piece of the ring's top two courses. A
 * gun on the ground (a mortar pit) stands on nothing that can fall.
 */
export function mountPieces(layout: CastleLayout, e: Emplacement): number[] {
  return supportOf(layout, castleAt(e.z), e.x, e.z, e.y).ids;
}

/**
 * 3.6: the floor a gun's crew stand on (metres): the wall walk's top, the top
 * of the tower's ring (its deck), or for a pit 0: the ground (the sim reads
 * the terrain's height there).
 */
export function mountFloor(layout: CastleLayout, e: Emplacement): number {
  return supportOf(layout, castleAt(e.z), e.x, e.z, e.y).floor;
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
  /** 3.6: men of a gun's crew at their posts (the household; null: always enough, the Practice range). A knocked-out gun is put back only with one. */
  crewAt: ((emp: number) => number) | null = null;

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
   * A shot moved from a to b this step: does it pass through a gun? The shot
   * must strike the gun itself (its body's radius plus the ball's): a chain
   * shot's balls too, like any ball (3.6: its chain takes the crew as men,
   * sweep.ts). A gun is never struck by its own shot.
   */
  sweep(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ballR: number, shot: number, own: number, tick: number) {
    for (let i = 0; i < this.emplacements.length; i++) {
      const e = this.emplacements[i];
      if (e.empty || this.guns[i].out || i === own) continue;
      const kind: WeaponKind = e.weapon;
      const r = GUN_HITS.body[kind] + ballR;
      const [cx, cy, cz] = this.centre(i);
      if (segPoint2(ax, ay, az, bx, by, bz, cx, cy, cz) <= r * r) this.knockOut(i, OutCause.Shot, shot, tick);
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
      if (this.crewAt && this.crewAt(i) <= 0) {
        g.wait = OutWait.Hands;
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
   * down, 3 no gold, 4 none of its crew is at it), then the ticks left before its crew could have it back.
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
