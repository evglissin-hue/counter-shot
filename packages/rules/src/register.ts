// Range and register (phase 3 milestone 3.2): each team's marks and its fire
// for effect. CONTRACT (the master's): the types and the public surface below
// are fixed; the executor building the rules fills in the behaviour.
//
// - A mark is made by the input { kind: "mark", emplacement } within
//   REGISTER.markWindow ticks after a shot fired by hand from that emplacement of
//   the team came down (the world's `landings`, auto false). It is the landing
//   point with REGISTER.radius. A team holds REGISTER.max marks in numbered
//   places 1 to 6: a new mark takes the lowest free place, or the oldest
//   mark's place. A mark fades REGISTER.life ticks after it was made; a shot
//   by hand of the team landing inside it refreshes it.
// - Fire for effect: { kind: "salvo", mark, mortar? } (mark 1 to 6). Every gun
//   of the team that is armed, loaded, standing (mounts.up) and can reach the
//   mark without hitting its own castle (solveAim, clearOfCastle) fires one
//   shot at it with the error of a gun nobody mans times REGISTER.errScale
//   (drawn from the register's own Rng stream "register"), one after another
//   over REGISTER.salvoSpan ticks from the gun nearest the mark outwards. The
//   mortar joins only when `mortar` is true. One salvo per team every
//   REGISTER.salvoEvery ticks; a salvo at a mark with no gun to fire is
//   refused and does not start the 20 s.
// - Marks are the team's alone: the match never tells the other side (the
//   page shows only its own team's).
//
// The Practice range uses the same class on its SandboxSim (one team, its four
// guns), so nothing here may depend on Match.

import { REGISTER, UNMANNED } from "@keepfall/content";
import type { Emplacement } from "@keepfall/content";
import { DPI, dcos, dsin, dsqrt, hashString, Rng } from "@keepfall/core";
import { clearOfCastle, solveAim, Spin, yawTowards, type SandboxSim } from "@keepfall/sim";

export interface Mark {
  /** Its place, 1 to 6 (what the page shows and a salvo names). */
  n: number;
  /** The landing point. */
  x: number;
  y: number;
  z: number;
  /** The emplacement whose shot made it. */
  emplacement: number;
  /** Tick it was made (the oldest is replaced first), and tick it fades (refreshed by a shot landing inside). */
  made: number;
  fades: number;
}

/** A team's last shot by hand that came down, per emplacement: where and when (for marking within the window). */
export interface Landing {
  x: number;
  y: number;
  z: number;
  tick: number;
}

/** A shot of a salvo waiting for its tick. */
export interface SalvoShot {
  tick: number;
  team: number;
  emplacement: number;
  mark: number;
  /** The `made` tick of the mark it was ordered at: a mark replaced in place meanwhile is a different mark, and the shot is dropped. */
  made: number;
}

export interface RegisterHost {
  world: SandboxSim;
  emplacements: Emplacement[];
  /** The team an emplacement belongs to (-1: none). */
  owner(emplacement: number): number;
  /** The emplacement each team rides now (-1: none). */
  manned(team: number): number;
  /** Reloads as a share of each weapon's own now (sudden death). */
  reloadScale(): number;
  /** A salvo shot is about to fire from an emplacement at this aim (the match turns the barrel of a gun nobody rides, so the page can draw it). */
  /** Is one of the team's own men within r of a point? (Absent: no check.) */
  ownNear?(team: number, x: number, z: number, r: number): boolean;
  /** Would a shot from the emplacement at a point put a bridge at risk, its error scaled by errScale? (Absent: no check.) */
  bridgeAtRisk?(e: Emplacement, x: number, z: number, errScale: number): boolean;
  aimed?(emplacement: number, yaw: number, pitch: number): void;
}

/** Ground distance between two points. */
function ground(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx, dz = az - bz;
  return dsqrt(dx * dx + dz * dz);
}

export class Register {
  /** Per team, places 1 to 6 (index n - 1): a mark or null. */
  readonly marks: [Array<Mark | null>, Array<Mark | null>] = [new Array(REGISTER.max).fill(null), new Array(REGISTER.max).fill(null)];
  /** Per emplacement: its last shot by hand that came down (null: none yet). */
  readonly landings: Array<Landing | null>;
  /** Per team: the tick of its last salvo (-1e9: none). */
  readonly salvoAt: [number, number] = [-1e9, -1e9];
  /** Salvo shots waiting for their tick, in the order they fire. */
  readonly queued: SalvoShot[] = [];
  private rng: Rng;
  /** Draws taken from the register's stream (the Rng keeps its state private: this stands for it in the hash). */
  private draws = 0;

  constructor(
    protected host: RegisterHost,
    seed: number,
  ) {
    this.landings = host.emplacements.map(() => null);
    this.rng = new Rng((hashString("register") ^ seed) >>> 0);
  }

  /** The team's mark at place n (1 to 6), or null. */
  mark(team: number, n: number): Mark | null {
    return this.marks[team]?.[n - 1] ?? null;
  }

  /** The team's marks that stand, oldest first. */
  list(team: number): Mark[] {
    return this.marks[team].filter((m): m is Mark => m !== null).sort((a, b) => a.made - b.made || a.n - b.n);
  }

  /** May the team mark the last landing of this emplacement now (its own gun, a shot by hand, within the window)? */
  canMark(team: number, emplacement: number, tick: number): boolean {
    if (team !== 0 && team !== 1) return false;
    if (this.host.owner(emplacement) !== team) return false;
    const l = this.landings[emplacement];
    return !!l && tick - l.tick <= REGISTER.markWindow;
  }

  /** The input { kind: "mark" }: make the mark (true) or refuse it (false). */
  makeMark(team: number, emplacement: number, tick: number): boolean {
    if (!this.canMark(team, emplacement, tick)) return false;
    const l = this.landings[emplacement]!;
    const places = this.marks[team];
    let at = places.indexOf(null);
    if (at < 0) {
      at = 0;
      for (let i = 1; i < places.length; i++) if (places[i]!.made < places[at]!.made) at = i;
    }
    places[at] = { n: at + 1, x: l.x, y: l.y, z: l.z, emplacement, made: tick, fades: tick + REGISTER.life };
    this.landings[emplacement] = null;
    return true;
  }

  /** The height a shot at a point of a mark is aimed at: the mark's own if it lay on masonry, else a man's chest above the ground. */
  private aimY(m: Mark, x: number, z: number): number {
    const t = this.host.world.terrain;
    return m.y > t.heightAt(m.x, m.z) + 0.5 ? m.y : t.heightAt(x, z) + 1;
  }

  /** The aim of an emplacement at a point of a mark, or null (outside its arc, out of reach, or into its own castle). */
  private solve(team: number, e: Emplacement, m: Mark, x: number, z: number) {
    if (yawTowards(e, x, z) === null) return null;
    const s = solveAim(e, x, this.aimY(m, x, z), z);
    if (!s || !clearOfCastle(e, s.yaw, s.pitch, s.charge, team, x, z)) return null;
    return s;
  }

  /** Would a salvo shot of e at the mark land near the team's own men or put a bridge at risk? (The same guards as the gun nobody mans.) */
  private unsafe(team: number, e: Emplacement, m: Mark): boolean {
    const U = UNMANNED[e.weapon] ?? UNMANNED.longGun!;
    if (this.host.ownNear?.(team, m.x, m.z, U.clearOwn)) return true;
    return !!this.host.bridgeAtRisk?.(e, m.x, m.z, REGISTER.errScale);
  }

  /**
   * The guns of the team that would fire in a salvo at mark n now, nearest first (empty: none bears, or no such mark).
   * With loaded = false the reload test is skipped (the page tells "guns loading" from "no gun bears").
   */
  bearing(team: number, n: number, mortar: boolean, loaded = true): number[] {
    const m = this.mark(team, n);
    if (!m) return [];
    const found: Array<{ id: number; d: number }> = [];
    for (const e of this.host.emplacements) {
      if (e.empty || this.host.owner(e.id) !== team) continue;
      if (e.weapon === "mortar" && !mortar) continue;
      if ((loaded && this.host.world.reload[e.id] !== 0) || !this.host.world.mounts.up(e.id)) continue;
      if (!this.solve(team, e, m, m.x, m.z)) continue;
      if (this.unsafe(team, e, m)) continue;
      found.push({ id: e.id, d: ground(e.x, e.z, m.x, m.z) });
    }
    found.sort((a, b) => a.d - b.d || a.id - b.id);
    return found.map((f) => f.id);
  }

  /** The input { kind: "salvo" }: queue it (true) or refuse it (false). */
  salvo(team: number, n: number, mortar: boolean, tick: number): boolean {
    if (team !== 0 && team !== 1) return false;
    if (!this.mark(team, n) || tick - this.salvoAt[team] < REGISTER.salvoEvery) return false;
    const guns = this.bearing(team, n, mortar);
    if (guns.length === 0) return false;
    const gap = REGISTER.salvoSpan / Math.max(1, guns.length - 1);
    for (let k = 0; k < guns.length; k++) this.queued.push({ tick: tick + 1 + Math.round(k * gap), team, emplacement: guns[k], mark: n, made: this.mark(team, n)!.made });
    this.salvoAt[team] = tick;
    return true;
  }

  /** Is a point inside one of the team's marks? (Guns nobody mans read this when they lay on a man.) */
  onMark(team: number, x: number, z: number): boolean {
    for (const m of this.marks[team]) if (m && ground(m.x, m.z, x, z) <= REGISTER.radius) return true;
    return false;
  }

  /** Before the world steps: fade marks, fire the salvo shots due this tick (queued into the world). */
  beforeStep(tick: number) {
    for (const places of this.marks) for (let i = 0; i < places.length; i++) if (places[i] && places[i]!.fades <= tick) places[i] = null;
    if (this.queued.length === 0 || !this.queued.some((q) => q.tick <= tick)) return;
    const due = this.queued.filter((q) => q.tick <= tick);
    const rest = this.queued.filter((q) => q.tick > tick);
    this.queued.length = 0;
    this.queued.push(...rest);
    for (const q of due) this.fire(q, tick);
  }

  private fire(q: SalvoShot, tick: number) {
    const { world } = this.host;
    const e = this.host.emplacements[q.emplacement];
    const m = this.mark(q.team, q.mark);
    if (!e || !m || m.made !== q.made || e.empty || world.reload[e.id] !== 0 || !world.mounts.up(e.id)) return;
    if (this.unsafe(q.team, e, m)) return;
    const U = UNMANNED[e.weapon] ?? UNMANNED.longGun!;
    const r = (U.errBase + U.errPerM * ground(e.x, e.z, m.x, m.z)) * REGISTER.errScale;
    const rr = r * dsqrt(this.rng.next());
    const th = this.rng.range(0, 2 * DPI);
    this.draws += 2;
    const s = this.solve(q.team, e, m, m.x + rr * dcos(th), m.z + rr * dsin(th)) ?? this.solve(q.team, e, m, m.x, m.z);
    if (!s) return;
    const ridden = this.host.manned(q.team) === e.id;
    world.queue(tick, { kind: "fire", emplacement: e.id, yaw: s.yaw, pitch: s.pitch, charge: s.charge, fuse: 0, spin: Spin.None, auto: true, reload: (ridden ? 1 : REGISTER.reload) * this.host.reloadScale() });
    this.host.aimed?.(e.id, s.yaw, s.pitch);
  }

  /** After the world steps: read its landings (remember shots by hand, refresh marks they land in). */
  afterStep(tick: number) {
    for (const l of this.host.world.landings) {
      if (l.auto) continue;
      const team = this.host.owner(l.emplacement);
      if (team !== 0 && team !== 1) continue;
      this.landings[l.emplacement] = { x: l.x, y: l.y, z: l.z, tick };
      for (const m of this.marks[team]) if (m && ground(m.x, m.z, l.x, l.z) <= REGISTER.radius) m.fades = tick + REGISTER.life;
    }
  }

  /** Everything above, into the match's hash. */
  hashInto(out: number[]) {
    for (const places of this.marks) for (const m of places) out.push(...(m ? [1, m.n, m.x, m.y, m.z, m.emplacement, m.made, m.fades] : [0]));
    for (const l of this.landings) out.push(...(l ? [1, l.x, l.y, l.z, l.tick] : [0]));
    out.push(this.salvoAt[0], this.salvoAt[1], this.queued.length, this.draws);
    for (const q of this.queued) out.push(q.tick, q.team, q.emplacement, q.mark, q.made);
  }
}
