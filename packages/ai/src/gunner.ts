// The AI's gunner: it rides one gun at a time, like you, and its other guns
// fire on their own. It lays the gun with the same flight prediction the aim
// help uses (still air), plus an error: a new target's first shot is off by
// the level's first error, every shot adds the hand's noise, and each landing
// it sees takes a share of the miss out of its aim, so the wind and its eye
// are corrected away over a few shots (as you do with your trail and landing
// marker). The barrel turns at the gun's own rates, it waits for the reload,
// and it waits to see where a shot came down before it fires again.

import { MID_Z, MUSTER, SLOTS_PER_CASTLE, weaponOf, type AiLevel, type Emplacement, type WeaponDef, type WeaponKind } from "@keepfall/content";
import { DPI, dcos, dsin, dsqrt, type Rng } from "@keepfall/core";
import { clampAim, clearOfCastle, solveAim, Spin, stepAim, type AimSolution, type AimState } from "@keepfall/sim";
import { firstSlot, type Match, type MatchInput } from "@keepfall/rules";
import * as V from "./view";

/** What a shot is for. */
export const enum Aim {
  Keep = 1,
  Crowd = 2,
  Breach = 3,
  /** A shell on an enemy building: + its plot. */
  Raid = 10,
  Masons = 20,
  /** After M5: an enemy gun, its crew swept off its wall or its pit shelled: + its emplacement. */
  Gun = 30,
}

/** The kinds of target shots are counted by (for tools): Aim.Raid + plot counts as "raid", Aim.Gun + emplacement as "gun". */
export const AIM_GROUPS = ["keep", "crowd", "breach", "raid", "masons", "gun"] as const;

/** The index in AIM_GROUPS of a target's key. */
function aimGroup(key: number): number {
  if (key >= Aim.Gun) return 5;
  if (key >= Aim.Masons) return 4;
  if (key >= Aim.Raid) return 3;
  if (key === Aim.Breach) return 2;
  if (key === Aim.Crowd) return 1;
  return 0;
}

interface Target {
  /** What it is (Aim, a raid with its plot): a new key is a new target, whose first shot carries the eye's first error. */
  key: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
}

/** How the gun is laid for its next shot, and the still-air aim for the point it wants (to learn from the landing). */
interface Lay {
  yaw: number;
  pitch: number;
  charge: number;
  sYaw: number;
  sPitch: number;
  x: number;
  y: number;
  z: number;
}

/** A shot of its own in the air, waiting to see where it comes down. */
interface InFlight {
  emp: number;
  tick: number;
  lobbed: boolean;
  x: number;
  y: number;
  z: number;
  sYaw: number;
  sPitch: number;
}

/** What it has learned about a gun: how far off its aim runs (the wind, its eye), and the target that is for. */
interface Offset {
  yaw: number;
  pitch: number;
  x: number;
  z: number;
  key: number;
}

/** The barrel is on its lay within this (rad). */
const ON_MARK = 0.0015;
/** Ticks between aim inputs while the barrel turns (so the other side sees it move). */
const AIM_EVERY = 8;
/** Longest a shot is waited for (ticks) before it is given up for lost. */
const LOST = 10 * 60;
/** After M5: an enemy gun that hit its castle within this long (ticks) is one it may go after. */
const HURT_TICKS = 20 * 60;

export class Gunner {
  /** The emplacement it rides (-1: none). */
  riding = -1;
  shotsFired = 0;
  /** Shots fired by what they were laid for, indexed as AIM_GROUPS (for tools; sums to shotsFired). */
  readonly byAim = [0, 0, 0, 0, 0, 0];
  private aim: AimState = { yaw: 0, pitch: 0 };
  private target: Target | null = null;
  private lay: Lay | null = null;
  private readyAt = 0;
  private nextThink = 0;
  private flight: InFlight | null = null;
  private offsets = new Map<number, Offset>();
  private aimSentAt = -100;
  private sentYaw = NaN;
  private sentPitch = NaN;
  /** Which of the keep's face it hits next (left, middle, right). */
  private faceStep = 0;
  private breachSide = 1;
  /** A gun it could not lay on its target just now, passed over until then (so it moves on to another gun rather than trying the same one for ever). */
  private stuck = { emp: -1, until: 0 };
  /** After M5: the enemy guns that hit its castle, and when they last did; and the tick until which it leaves guns alone. */
  private hurtBy = new Map<number, number>();
  private counterUntil = 0;

  constructor(
    private m: Match,
    private team: number,
    private L: AiLevel,
    private rng: Rng,
    private send: (tick: number, input: MatchInput) => void,
    /** M6: the tutor's stage (its hand is still before stage 2, its mortar silent before stage 3); null for every other AI. */
    private stage: (() => number) | null = null,
  ) {
    // No shot by hand before its warm-up is over (it takes and lays its gun meanwhile).
    this.readyAt = L.warmup;
  }

  private get foe(): number {
    return 1 - this.team;
  }

  /** The team's armed guns of a kind (after M5: those not knocked out). */
  private guns(kind: WeaponKind): Emplacement[] {
    const first = firstSlot(this.team);
    const out: Emplacement[] = [];
    const mounts = this.m.world.mounts;
    if (this.stage && kind === "mortar" && this.stage() < 3) return out;
    for (let i = first; i < first + SLOTS_PER_CASTLE; i++) {
      const e = this.m.emplacements[i];
      if (e && !e.empty && e.weapon === kind && mounts.up(i)) out.push(e);
    }
    return out;
  }

  /**
   * After M5: the enemy gun that hit its castle last (within HURT_TICKS), if
   * it stands to be knocked out now.
   */
  private threat(tick: number): Emplacement | null {
    const mounts = this.m.world.mounts;
    let best: Emplacement | null = null, at = -1;
    for (const [emp, t] of this.hurtBy) {
      const e = this.m.emplacements[emp];
      if (tick - t > HURT_TICKS || t <= at || !e || e.empty || !mounts.up(emp)) continue;
      best = e;
      at = t;
    }
    return best;
  }

  /** After M5: note the enemy's shots that came down on its castle (by hand), and its own knock-outs. */
  private watch(tick: number) {
    const m = this.m, cz = m.world.castle.layout.castleZ[this.team];
    for (const l of m.world.landings) {
      if (l.auto || l.emplacement < 0) continue;
      const e = m.emplacements[l.emplacement];
      if (!e || (e.z < MID_Z ? 1 : 0) !== this.foe) continue;
      const dz = l.z - cz;
      if (l.x > -26 && l.x < 26 && dz > -26 && dz < 26) this.hurtBy.set(l.emplacement, tick);
    }
    const outs = m.world.mounts.outs;
    for (let k = 0; k + 2 < outs.length; k += 3) {
      const info = m.world.shotInfo.get(outs[k + 2]);
      if (info && (m.emplacements[info.emplacement].z < MID_Z ? 1 : 0) === this.team) this.counterUntil = tick + this.L.counterRest;
    }
  }

  /** Ticks until a gun could fire if it took it now (its reload, plus settling in if it is not the one it rides). */
  private readyIn(e: Emplacement): number {
    return this.m.world.reload[e.id] + (e.id === this.riding ? 0 : this.L.settle);
  }

  /**
   * The gun of a kind that would be ready first (of those that can reach a
   * point, if one is given, without hitting their own castle on the way: a
   * gun on the back tower cannot fire short over its own front).
   */
  private soonest(kind: WeaponKind, x?: number, y?: number, z?: number): Emplacement | null {
    let best: Emplacement | null = null;
    for (const e of this.guns(kind)) {
      if (best && this.readyIn(e) >= this.readyIn(best)) continue;
      if (e.id === this.stuck.emp && this.m.tick < this.stuck.until) continue;
      if (x !== undefined) {
        const s = reach(e, x, y!, z!);
        if (!s || !clearOfCastle(e, s.yaw, s.pitch, s.charge, this.team, x, z!)) continue;
      }
      best = e;
    }
    return best;
  }

  step(tick: number) {
    // The tutor asleep or stirring takes no gun, lays none and fires none.
    if (this.stage && this.stage() < 2) return;
    this.learn(tick);
    this.watch(tick);
    // After M5: the gun it rides was knocked out: drop what it was laying on and look again.
    if (this.riding >= 0 && !this.m.world.mounts.up(this.riding) && this.target) {
      this.target = null;
      this.lay = null;
      this.nextThink = tick;
    }
    if (tick >= this.nextThink) {
      this.think(tick);
      this.nextThink = tick + this.L.think;
    }
    if (this.riding < 0 || !this.target || !this.m.world.mounts.up(this.riding)) return;
    const e = this.m.emplacements[this.riding];
    const w = weaponOf(e);
    if (!this.lay) {
      this.lay = this.layFor(e, w, this.target);
      if (!this.lay) {
        // It cannot lay this gun on it now: pass the gun over for a while and look again at once.
        this.stuck = { emp: e.id, until: tick + 8 * 60 };
        this.target = null;
        this.nextThink = tick + 1;
        return;
      }
    }
    // Turn towards the lay at the gun's own rates (the limiter the page aims through).
    const a = stepAim(this.aim, { dYaw: this.lay.yaw - this.aim.yaw, dPitch: this.lay.pitch - this.aim.pitch, fine: false }, e, w);
    this.aim = a;
    if ((a.yaw !== this.sentYaw || a.pitch !== this.sentPitch) && tick - this.aimSentAt >= AIM_EVERY) {
      this.send(tick, { kind: "aim", emplacement: e.id, yaw: a.yaw, pitch: a.pitch });
      this.aimSentAt = tick;
      this.sentYaw = a.yaw;
      this.sentPitch = a.pitch;
    }
    // Fire once laid, loaded and settled, and once the last shot has been seen to land.
    if (this.flight || tick < this.readyAt || this.m.world.reload[e.id] > 0) return;
    const dy = a.yaw - this.lay.yaw, dp = a.pitch - this.lay.pitch;
    if (dy > ON_MARK || dy < -ON_MARK || dp > ON_MARK || dp < -ON_MARK) return;
    this.send(tick, { kind: "fire", emplacement: e.id, yaw: a.yaw, pitch: a.pitch, charge: this.lay.charge, fuse: 0, spin: Spin.None });
    this.sentYaw = a.yaw;
    this.sentPitch = a.pitch;
    this.shotsFired++;
    this.byAim[aimGroup(this.target.key)]++;
    const L = this.lay;
    this.flight = { emp: e.id, tick, lobbed: w.minSpeed < w.speed, x: L.x, y: L.y, z: L.z, sYaw: L.sYaw, sPitch: L.sPitch };
    if (this.target.key === Aim.Keep) this.faceStep++;
    // The next shot is laid afresh: the target may have moved, and the hand is never the same twice.
    this.lay = null;
  }

  /** For tools: what it is doing. */
  debug(): string {
    const t = this.target, l = this.lay, f = this.flight;
    return `riding ${this.riding} target ${t ? `${t.key}@(${t.x.toFixed(1)},${t.y.toFixed(1)},${t.z.toFixed(1)})` : "-"} lay ${l ? `${l.yaw.toFixed(3)}/${l.pitch.toFixed(3)}` : "-"} aim ${this.aim.yaw.toFixed(3)}/${this.aim.pitch.toFixed(3)} flight ${f ? f.tick : "-"} readyAt ${this.readyAt} reload ${this.riding >= 0 ? this.m.world.reload[this.riding] : "-"}`;
  }

  /** Where its last shot came down: take a share of the miss out of the gun's aim. */
  private learn(tick: number) {
    const f = this.flight;
    if (!f) return;
    if (tick - f.tick > LOST) {
      this.flight = null;
      return;
    }
    for (const l of this.m.world.landings) {
      if (l.emplacement !== f.emp || l.auto) continue;
      this.flight = null;
      this.readyAt = Math.max(this.readyAt, tick + this.L.look);
      const o = this.offset(f.emp);
      const k = this.L.learn;
      if (f.lobbed) {
        // A shell: the miss on the ground, taken off the point it lays on.
        o.x -= k * (l.x - f.x);
        o.z -= k * (l.z - f.z);
        o.x = clamp(o.x, 25);
        o.z = clamp(o.z, 25);
      } else {
        // Flat fire: the aim that would have put the shot where it landed, against the aim for the point it wanted.
        const s = solveAim(this.m.emplacements[f.emp], l.x, l.y, l.z);
        if (s) {
          o.yaw = clamp(o.yaw + k * (f.sYaw - s.yaw), 0.08);
          o.pitch = clamp(o.pitch + k * (f.sPitch - s.pitch), 0.08);
        }
      }
      return;
    }
  }

  private offset(emp: number): Offset {
    let o = this.offsets.get(emp);
    if (!o) this.offsets.set(emp, (o = { yaw: 0, pitch: 0, x: 0, z: 0, key: -1 }));
    return o;
  }

  /** Choose what to shoot and with which gun. */
  private think(tick: number) {
    if (this.flight) return; // watching a shot come down
    const m = this.m, L = this.L, foe = this.foe;
    const home = MUSTER[this.team];
    let pick: { e: Emplacement; t: Target } | null = null;
    // 1. A crowd at its own gate or inside: only a shell fired by hand breaks them up there (no gun depresses that far).
    const crowd = this.guns("mortar").length ? V.crowdNear(m, foe, home.x, home.z, 48, 6, L.crowd, this.team) : null;
    // Never near a bridge: a shell that falls short or long would cut a route for both sides (the burst's reach and its aim's error).
    if (crowd && !V.nearBridge(crowd.x, crowd.z, 4.6 + L.firstErrM + L.noiseM)) {
      const g = m.world.terrain.heightAt(crowd.x, crowd.z);
      const t: Target = { key: Aim.Crowd, x: crowd.x, y: g + 0.4, z: crowd.z, vx: crowd.vx, vz: crowd.vz };
      const e = this.soonest("mortar", t.x, t.y, t.z);
      if (e && this.readyIn(e) < 5 * 60) pick = { e, t };
    }
    if (!pick && L.counter > 0 && tick >= this.counterUntil && this.rng.next() < L.counter) {
      // After M5: the gun that has been hitting it. On a wall or a tower its crew is swept off by the chain shot; a mortar in its pit takes a shell.
      const g = this.threat(tick);
      if (g) {
        const t: Target = { key: Aim.Gun + g.id, x: g.x, y: g.y - 0.3, z: g.z, vx: 0, vz: 0 };
        const e = g.y > 5 ? this.soonest("chainShot", t.x, t.y, t.z) : this.soonest("mortar", t.x, g.y, t.z);
        // Loaded or nearly (its reload, not the time to settle in on it, as for the mortar below).
        if (e && this.m.world.reload[e.id] < (e.weapon === "mortar" ? 90 : 3 * 60)) pick = { e, t };
      }
    }
    if (!pick) {
      // 2. A loaded mortar: on the keep, or (from a Knight up) now and then on the enemy's buildings or masons.
      const t = this.shellTarget();
      const e = this.soonest("mortar", t.x, t.y, t.z);
      // Loaded or nearly: its reload, not the time to settle in on it (which would rule out every level but the Warlord).
      if (e && this.m.world.reload[e.id] < 90) pick = { e, t };
    }
    if (!pick) {
      // 3. The long gun: a way in for its waves, or the keep.
      const t = this.longTarget();
      const e = this.soonest("longGun", t.x, t.y, t.z);
      if (e) pick = { e, t };
    }
    if (!pick) return;
    // A less focused gunner is slow to change guns: it may stay on the one it rides for now.
    if (pick.e.id !== this.riding && this.riding >= 0 && this.rng.next() > L.focus) return;
    if (pick.e.id !== this.riding) this.take(pick.e, tick);
    // Its target as it stands now (a crowd moves, a banner drops a floor); a gun's first error comes only with a new kind of target.
    this.target = pick.t;
    this.lay = null;
  }

  /** What a loaded mortar shells: the keep's floor under the banner, or a raid. */
  private shellTarget(): Target {
    const foe = this.foe, m = this.m;
    if (this.L.raids && this.rng.next() < 0.3) {
      // Mills first (its gold), then barracks (its waves), then the Foundry; or the masons putting the keep back.
      for (const kind of [1, 0, 2]) {
        const plots = V.working(m, foe, kind);
        if (plots.length) {
          const p = plots[(this.rng.next() * plots.length) | 0];
          const t = V.plotTarget(foe, p);
          return { key: Aim.Raid + p, x: t.x, y: t.y, z: t.z, vx: 0, vz: 0 };
        }
      }
      const crew = m.world.works!.crews[foe];
      if (m.world.works!.status(foe).masons >= 2 && crew.job >= 0) {
        const g = m.world.terrain.heightAt(crew.spotX, crew.spotZ);
        return { key: Aim.Masons, x: crew.spotX, y: g + 0.4, z: crew.spotZ, vx: 0, vz: 0 };
      }
    }
    const b = V.banner(m, foe);
    return { key: Aim.Keep, x: b.x, y: b.floor, z: b.z, vx: 0, vz: 0 };
  }

  /** What the long gun shoots: the foot of the enemy front wall when its waves are near and there is no way in, else the keep's face. */
  private longTarget(): Target {
    const m = this.m, foe = this.foe;
    const gate = MUSTER[foe];
    const leaves = (this._leaves ??= V.gateLeaves(m));
    // M6: the tutor never opens a way in for its waves (a castle that never sent its waves had its wall breached
    // beside the gate and was stormed at 8:00); it shells your keep, where you can watch the damage on the tracker.
    if (!this.stage && V.marchers(m, this.team, gate.x, gate.z, 45) >= 3 && !V.wayIn(m, this.team) && V.gateStands(m, foe, leaves)) {
      const x = 7 * this.breachSide;
      if (!V.ownNear(m, this.team, x, V.frontFaceZ(foe), 6)) return { key: Aim.Breach, x, y: 1.1, z: V.frontFaceZ(foe), vx: 0, vz: 0 };
      this.breachSide = -this.breachSide;
    }
    const b = V.banner(m, foe);
    // Just under the floor the banner stands on (its wall gives way, the floor with it), above the front wall.
    const y = b.floor - 1.5 > 10.5 ? b.floor - 1.5 : 10.5;
    const x = [-2.6, 0, 2.6][this.faceStep % 3];
    return { key: Aim.Keep, x, y, z: V.keepFaceZ(foe), vx: 0, vz: 0 };
  }
  private _leaves: number[][] | undefined;

  /** Take a gun: the one it rode goes back to its crew, laid where it last aimed. */
  private take(e: Emplacement, tick: number) {
    const left = this.riding >= 0 ? { emplacement: this.riding, yaw: this.aim.yaw, pitch: this.aim.pitch } : undefined;
    this.send(tick, { kind: "man", emplacement: e.id, left });
    this.riding = e.id;
    const g = this.m.guns[e.id];
    this.aim = { yaw: g.yaw, pitch: g.pitch };
    this.sentYaw = this.sentPitch = NaN;
    this.readyAt = Math.max(this.readyAt, tick + this.L.react + this.L.settle);
    this.lay = null;
  }

  /** Lay a gun on a target: the still-air aim plus what it has learned, its first error on a new target, and the hand's noise. */
  private layFor(e: Emplacement, w: WeaponDef, t: Target): Lay | null {
    const L = this.L, rng = this.rng;
    const lobbed = w.minSpeed < w.speed;
    const o = this.offset(e.id);
    if (o.key !== t.key) {
      // A new target: what it learned of the wind on this gun half holds; its eye is off afresh.
      o.key = t.key;
      o.yaw *= 0.5;
      o.pitch *= 0.5;
      o.x *= 0.5;
      o.z *= 0.5;
      if (lobbed) {
        const r = (L.firstErrM + L.firstErrPerM * V.flat(e.x, e.z, t.x, t.z)) * dsqrt(rng.next());
        const th = rng.range(0, 2 * DPI);
        o.x += r * dcos(th);
        o.z += r * dsin(th);
      } else {
        o.yaw += rng.range(-1, 1) * L.firstErr;
        o.pitch += rng.range(-1, 1) * L.firstErr * 0.5;
      }
    }
    // Lead a moving target by the shot's flight.
    const first = reach(e, t.x, t.y, t.z);
    if (!first) return null;
    const x = t.x + t.vx * first.time, z = t.z + t.vz * first.time;
    if (lobbed) {
      const ax = x + o.x + rng.range(-1, 1) * L.noiseM, az = z + o.z + rng.range(-1, 1) * L.noiseM;
      const s = reach(e, ax, t.y, az);
      if (!s) return null;
      const c = clampAim({ yaw: s.yaw, pitch: s.pitch }, e, w);
      if (!clearOfCastle(e, c.yaw, c.pitch, s.charge, this.team, ax, az)) return null;
      return { yaw: c.yaw, pitch: c.pitch, charge: s.charge, sYaw: s.yaw, sPitch: s.pitch, x, y: t.y, z };
    }
    const s = reach(e, x, t.y, z);
    if (!s) return null;
    const c = clampAim({ yaw: s.yaw + o.yaw + rng.range(-1, 1) * L.noise, pitch: s.pitch + o.pitch + rng.range(-1, 1) * L.noise * 0.5 }, e, w);
    if (!clearOfCastle(e, c.yaw, c.pitch, 1, this.team, x, z)) return null;
    return { yaw: c.yaw, pitch: c.pitch, charge: 1, sYaw: s.yaw, sPitch: s.pitch, x, y: t.y, z };
  }
}

/**
 * The still-air aim for a point, or for the nearest point short of it that
 * can be reached (a shell against a headwind, or an aim its corrections have
 * pushed past the gun's reach: the playtest pass found a Squire stalled there).
 */
function reach(e: Emplacement, x: number, y: number, z: number): AimSolution | null {
  const dx = x - e.x, dz = z - e.z;
  const d = dsqrt(dx * dx + dz * dz) + 1e-9;
  for (let back = 0; back <= 30; back += back < 6 ? 0.5 : 2) {
    const s = solveAim(e, x - (dx / d) * back, y, z - (dz / d) * back);
    if (s) return s;
  }
  return null;
}

function clamp(v: number, r: number): number {
  return v < -r ? -r : v > r ? r : v;
}
