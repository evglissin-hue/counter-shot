// The AI's gunner: it rides one gun at a time, like you, and its other guns
// fire on their own. It lays the gun with the same flight prediction the aim
// help uses (still air), plus an error: a new target's first shot is off by
// the level's first error, every shot adds the hand's noise, and each landing
// it sees takes a share of the miss out of its aim, so the wind and its eye
// are corrected away over a few shots (as you do with your trail and landing
// marker). The barrel turns at the gun's own rates, it waits for the reload,
// and it waits to see where a shot came down before it fires again.

import { MUSTER, SLOTS_PER_CASTLE, weaponOf, type AiLevel, type Emplacement, type WeaponDef, type WeaponKind } from "@keepfall/content";
import { DPI, dcos, dsin, dsqrt, type Rng } from "@keepfall/core";
import { clampAim, solveAim, Spin, stepAim, type AimSolution, type AimState } from "@keepfall/sim";
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

export class Gunner {
  /** The emplacement it rides (-1: none). */
  riding = -1;
  shotsFired = 0;
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

  constructor(
    private m: Match,
    private team: number,
    private L: AiLevel,
    private rng: Rng,
    private send: (tick: number, input: MatchInput) => void,
  ) {}

  private get foe(): number {
    return 1 - this.team;
  }

  /** The team's armed guns of a kind. */
  private guns(kind: WeaponKind): Emplacement[] {
    const first = firstSlot(this.team);
    const out: Emplacement[] = [];
    for (let i = first; i < first + SLOTS_PER_CASTLE; i++) {
      const e = this.m.emplacements[i];
      if (e && !e.empty && e.weapon === kind) out.push(e);
    }
    return out;
  }

  /** Ticks until a gun could fire if it took it now (its reload, plus settling in if it is not the one it rides). */
  private readyIn(e: Emplacement): number {
    return this.m.world.reload[e.id] + (e.id === this.riding ? 0 : this.L.settle);
  }

  /** The gun of a kind that would be ready first (of those that can reach a point, if one is given: a mortar pit behind the keep cannot reach the far keep). */
  private soonest(kind: WeaponKind, x?: number, y?: number, z?: number): Emplacement | null {
    let best: Emplacement | null = null;
    for (const e of this.guns(kind)) {
      if (best && this.readyIn(e) >= this.readyIn(best)) continue;
      if (x !== undefined && !reach(e, x, y!, z!)) continue;
      best = e;
    }
    return best;
  }

  step(tick: number) {
    this.learn(tick);
    if (tick >= this.nextThink) {
      this.think(tick);
      this.nextThink = tick + this.L.think;
    }
    if (this.riding < 0 || !this.target) return;
    const e = this.m.emplacements[this.riding];
    const w = weaponOf(e);
    if (!this.lay) {
      this.lay = this.layFor(e, w, this.target);
      if (!this.lay) {
        this.target = null;
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
    if (!pick) {
      // 2. A loaded mortar: on the keep, or (from a Knight up) now and then on the enemy's buildings or masons.
      const t = this.shellTarget();
      const e = this.soonest("mortar", t.x, t.y, t.z);
      if (e && this.readyIn(e) < 90) pick = { e, t };
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
    if (V.marchers(m, this.team, gate.x, gate.z, 45) >= 3 && !V.wayIn(m, this.team) && V.gateStands(m, foe, leaves)) {
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
      return { yaw: c.yaw, pitch: c.pitch, charge: s.charge, sYaw: s.yaw, sPitch: s.pitch, x, y: t.y, z };
    }
    const s = reach(e, x, t.y, z);
    if (!s) return null;
    const c = clampAim({ yaw: s.yaw + o.yaw + rng.range(-1, 1) * L.noise, pitch: s.pitch + o.pitch + rng.range(-1, 1) * L.noise * 0.5 }, e, w);
    return { yaw: c.yaw, pitch: c.pitch, charge: 1, sYaw: s.yaw, sPitch: s.pitch, x, y: t.y, z };
  }
}

/** The still-air aim for a point, or for the nearest point short of it that can be reached (a shell against a headwind). */
function reach(e: Emplacement, x: number, y: number, z: number): AimSolution | null {
  const dx = x - e.x, dz = z - e.z;
  const d = dsqrt(dx * dx + dz * dz) + 1e-9;
  for (let back = 0; back <= 6; back += 0.5) {
    const s = solveAim(e, x - (dx / d) * back, y, z - (dz / d) * back);
    if (s) return s;
  }
  return null;
}

function clamp(v: number, r: number): number {
  return v < -r ? -r : v > r ? r : v;
}
