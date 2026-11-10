// The phase 1 sandbox simulation: the masonry of both castles, the four
// Ashwright weapons with real flight (drag, wind, spin), mortar fuses, chain
// shot, grapeshot, craters and test minions. Everything that changes the
// world enters as an input tagged with its tick, so a session is just its
// inputs and replays the same on every machine.

import { BUILDING_KINDS, sectionOf, GUN_HITS, isKeepPiece, MATCH_EMPLACEMENTS, PRACTICE_BUILDINGS, WEAPONS, weaponOf, type BuildingKind, type BurstDef, type CastleLayout, type Emplacement, type WeaponDef } from "@keepfall/content";
import { dsqrt, hashBytes, hashString, hex8, Rng } from "@keepfall/core";
import { aimDir, clampAim, muzzle } from "./aim";
import { Army } from "./army";
import { CastleSim, DEFAULT_SIM, type Rapier } from "./castleSim";
import { flightCoef, flightDv, type FlightCoef } from "./flight";
import {
  CHAIN_STRIDE,
  EVENT_STRIDE,
  EventKind,
  KEG_STRIDE,
  LADDER_STRIDE,
  MINION_STRIDE,
  PART_STRIDE,
  PLOT_STRIDE,
  PROJECTILE_STRIDE,
  ProjectileKind,
  STONE_STRIDE,
  WORKS_STRIDE,
  type FrameData,
  type TerrainPatch,
} from "./frame";
import { Ladders } from "./ladders";
import { Cause, Minions, MinionState } from "./minions";
import { Mounts } from "./mounts";
import { NavGrid } from "./nav";
import { Specialists } from "./specialists";
import { Structures } from "./structures";
import { chainMid, SWEEP, sweptMen, type ChainMove } from "./sweep";
import { Terrain } from "./terrain";
import { Wind } from "./wind";
import { Works } from "./works";

/** Bump whenever the same inputs would play out differently. */
export const RULES_VERSION = 11;

/** M3: what is known about a shot, for bounties and trick shots: whose gun, fired by hand or not, did it glance off stone first, did it strike a keep. */
export interface ShotInfo {
  emplacement: number;
  auto: boolean;
  glanced: boolean;
  /** Tick it left the world (-1: still flying). */
  ended: number;
}

export const enum Spin {
  None = 0,
  Top = 1,
  Back = 2,
  Left = 3,
  Right = 4,
}

export type SandboxInput =
  | {
      kind: "fire";
      emplacement: number;
      yaw: number;
      pitch: number;
      /** 0..1 between the weapon's min and max muzzle speed. */
      charge: number;
      /** Mortar fuse in ticks (0 = burst on impact). */
      fuse: number;
      spin: Spin;
      /** Fired by a weapon nobody is manning (the page leaves its shots out of your trail and landing marker). */
      auto?: boolean;
      /** Reload after this shot as a multiple of the weapon's own (unmanned weapons are slower). */
      reload?: number;
    }
  | { kind: "minions"; count: number };

interface Shot {
  id: number;
  emplacement: number;
  kind: ProjectileKind;
  slots: number[];
  coef: FlightCoef;
  spin: boolean;
  /** Tick the fuse fires, or -1 (no fuse), or 0 for impact. */
  fuseAt: number;
  landed: boolean;
  joint: unknown;
  /** Fired by a weapon nobody mans. */
  auto: boolean;
  /** After M5: the men a chain shot's chain has swept so far (each only once). */
  swept?: Set<number>;
}

export interface SandboxOptions {
  seed: number;
  minions: number;
  emplacements?: Emplacement[];
  /** Waves (a match): flow fields, marching, fighting. The Practice range goes without. */
  army?: boolean;
  /** M3: what stands on the plots at the start (with plots in the layout): the Practice range's set in both castles unless given. */
  buildings?: Array<{ castle: number; plot: number; kind: BuildingKind }>;
}

const MAX_STONES = 12000;
/** Ticks between nav grid refreshes (four a second). */
const NAV_EVERY = 15;
/** Grapeshot pellets do not collide with each other. */
const PELLET_GROUPS = (0x0004 << 16) | (0xffff & ~0x0004);
/** The mortar shell's burst: the default for explode(). */
const SHELL_BURST: BurstDef = WEAPONS.mortar.burst!;

export class SandboxSim {
  readonly R: Rapier;
  readonly castle: CastleSim;
  readonly terrain: Terrain;
  readonly minions: Minions;
  readonly wind: Wind;
  /** Where minions can walk; refreshed every NAV_EVERY ticks for whatever changed. */
  readonly nav: NavGrid;
  /** Waves of pikemen with their flow fields (matches only). */
  readonly army: Army | null;
  /** Ladders carried, raised and climbed (matches only). */
  readonly ladders: Ladders | null;
  /** Each castle's masons and what they rebuild (matches only). */
  readonly works: Works | null;
  /** M3: the plots' buildings (with plots in the layout), and sappers' kegs and musketeers' shots (matches). */
  readonly structures: Structures | null;
  readonly specialists: Specialists | null;
  /** After M5: the masonry each gun stands on, and which guns are knocked out. */
  readonly mounts: Mounts;
  /** Where each ball slot was before the last step (a shot's path through a gun, a chain's sweep). */
  private prevPos = new Float64Array(64 * 3);
  /** M3: which shot each ball slot carries now, what is known about each shot, and keep hits ([shot, castle] pairs) for the match to read. */
  private slotShot = new Int32Array(64).fill(-1);
  readonly shotInfo = new Map<number, ShotInfo>();
  keepHits: number[] = [];
  /**
   * M5: shots that first touched something during the last step (the
   * landing marker's events, kept per step so a player in the sim, the AI,
   * can read where its shots came down).
   */
  readonly landings: Array<{ shot: number; emplacement: number; auto: boolean; x: number; y: number; z: number }> = [];
  readonly emplacements: Emplacement[];
  tick = 0;
  /** Ticks until each emplacement can fire again. */
  reload: number[];
  private inputs = new Map<number, SandboxInput[]>();
  private shots: Shot[] = [];
  private nextShot = 1;
  private events: number[] = [];
  private rng: Rng;
  private pelletRng: Rng;
  /** Each shot's scatter, drawn in the order shots are fired. */
  private scatterRng: Rng;
  private bufs = {
    stones: new Float32Array(MAX_STONES * STONE_STRIDE),
    projectiles: new Float32Array(64 * PROJECTILE_STRIDE),
    chains: new Float32Array(16 * CHAIN_STRIDE),
    minions: new Float32Array(320 * MINION_STRIDE),
    parts: new Float32Array(256 * 11 * PART_STRIDE),
    settled: new Float32Array(64 * 11 * PART_STRIDE),
    ladders: new Float32Array(32 * LADDER_STRIDE),
    works: new Float32Array(4 * WORKS_STRIDE),
    plots: new Float32Array(16 * PLOT_STRIDE),
    kegs: new Float32Array(32 * KEG_STRIDE),
  };
  /** Whether the shot being fired now is an unmanned one (its Shot records it). */
  private firingAuto = false;
  private tmpV: [number, number, number] = [0, 0, 0];
  private tmpS: [number, number, number] = [0, 0, 0];
  private tmpDv: [number, number, number] = [0, 0, 0];

  constructor(R: Rapier, layout: CastleLayout, opts: SandboxOptions) {
    this.R = R;
    this.castle = new CastleSim(R, layout, { ...DEFAULT_SIM, ground: false, settle: true });
    this.terrain = new Terrain(R, this.castle.world);
    this.minions = new Minions(R, this.castle.world, this.terrain);
    this.rng = new Rng(opts.seed);
    this.wind = new Wind(this.rng.fork("wind"));
    this.pelletRng = this.rng.fork("pellets");
    // After M5 the Practice range has the match's emplacements too: the target castle's guns stand as targets (nobody fires them).
    this.emplacements = opts.emplacements ?? MATCH_EMPLACEMENTS;
    this.reload = this.emplacements.map(() => 0);
    this.minions.spawnPatrol(this.rng.fork("patrol"), opts.minions);
    this.scatterRng = this.rng.fork("scatter");
    // M3: every plot's ready buildings leave the world, and what stands at the start goes up, before the nav grid sees the castles.
    this.structures = layout.plots.length ? new Structures(this.castle, this.minions, this.terrain.handles, (k, a, b, c, d) => this.event(k, a, b, c, d)) : null;
    if (this.structures) {
      this.structures.clearAll();
      const start = opts.buildings ?? [0, 1].flatMap((castle) => PRACTICE_BUILDINGS.map((b) => ({ castle, ...b })));
      for (const b of start) this.structures.place(b.castle, b.plot, BUILDING_KINDS.indexOf(b.kind));
    }
    this.nav = new NavGrid(this.castle, this.terrain);
    this.minions.nav = this.nav;
    const emit = (k: EventKind, a: number, b: number, c: number, d: number) => this.event(k, a, b, c, d);
    this.mounts = new Mounts(this.castle, this.emplacements, emit);
    this.army = opts.army ? new Army(this.minions, this.nav, this.castle, this.terrain, (hashString("army") ^ opts.seed) >>> 0, emit) : null;
    this.ladders = this.army ? new Ladders(R, this.castle.world, this.castle, this.terrain, this.minions, emit) : null;
    this.works = this.army ? new Works(this.minions, this.castle, this.terrain, this.army, emit) : null;
    if (this.army && this.ladders) {
      this.army.ladders = this.ladders;
      this.ladders.army = this.army;
    }
    // M3: sappers' kegs and musketeers' shots, on a stream of their own.
    this.specialists = this.army
      ? new Specialists(this.minions, this.nav, this.terrain, (hashString("specialists") ^ opts.seed) >>> 0, emit, (x, y, z, burst, shot) => this.explode(x, y, z, burst, shot))
      : null;
    if (this.army) this.army.specialists = this.specialists;
    this.castle.world.step(); // build the broad phase now: a loading cost, not a frame cost
    this.castle.warmUp(); // and compile the support check, so the first hit does not stall
  }

  free() {
    this.castle.free();
  }

  /** Queue an input for a tick (now or later). Inputs for one tick apply in the order queued. */
  queue(tick: number, input: SandboxInput) {
    const t = tick < this.tick ? this.tick : tick;
    let list = this.inputs.get(t);
    if (!list) this.inputs.set(t, (list = []));
    list.push(input);
  }

  step() {
    const tick = this.tick;
    this.landings.length = 0;
    // After M5: guns knocked out and put back during this step, for the match to read after it.
    this.mounts.outs.length = 0;
    this.mounts.backs.length = 0;
    const list = this.inputs.get(tick);
    if (list) {
      this.inputs.delete(tick);
      for (const input of list) this.apply(input);
    }
    this.wind.step(tick);
    this.applyFlight();
    this.minions.walk(tick);
    this.specialists?.beforeStep();
    this.army?.step(tick);
    this.ladders?.step(tick);
    this.works?.step(tick);
    this.structures?.step(tick);
    this.terrain.rebuild();
    this.notePositions();
    this.castle.step();
    this.afterStep();
    this.specialists?.afterStep(tick);
    if (tick % 60 === 0) this.pruneShots(tick);
    if (tick % NAV_EVERY === NAV_EVERY - 1) this.nav.update();
    for (let i = 0; i < this.reload.length; i++) if (this.reload[i] > 0) this.reload[i]--;
    this.tick++;
  }

  /** For each bridge in the layout (in order): can minions still cross it? */
  bridgesOpen(): boolean[] {
    return this.castle.layout.bridges.map((b) => this.nav.bridgeOpen(b.site));
  }

  private apply(input: SandboxInput) {
    if (input.kind === "minions") {
      this.minions.spawnPatrol(this.rng.fork(`patrol${this.tick}`), input.count);
      return;
    }
    const e = this.emplacements[input.emplacement];
    if (!e || e.empty || this.reload[e.id] > 0) return;
    // After M5: a knocked-out gun cannot fire until its crew has it back on its mount.
    if (!this.mounts.up(e.id)) return;
    // The gun's own weapon, its Foundry upgrade worked in (the same object as WEAPONS[kind] without one).
    const w = weaponOf(e);
    const aim = clampAim({ yaw: input.yaw, pitch: input.pitch }, e, w);
    const charge = input.charge < 0 ? 0 : input.charge > 1 ? 1 : input.charge;
    // The shot leaves a little off the aim, and the charge is never quite the same twice.
    const sc = w.scatter;
    const r = sc.angle * dsqrt(this.scatterRng.next());
    const turn = this.scatterRng.range(0, 6.283185307179586);
    const kick = 1 + sc.speed * (this.scatterRng.next() * 2 - 1);
    const a = { yaw: aim.yaw + r * cosT(turn), pitch: aim.pitch + r * sinT(turn) };
    const speed = (w.minSpeed + (w.speed - w.minSpeed) * charge) * kick;
    this.reload[e.id] = input.reload !== undefined && input.reload > 0 ? Math.round(w.reload * input.reload) : w.reload;
    const id = this.nextShot++;
    this.firingAuto = input.auto === true;
    this.shotInfo.set(id, { emplacement: e.id, auto: this.firingAuto, glanced: false, ended: -1 });
    this.event(EventKind.Muzzle, e.id, id, input.auto ? 1 : 0, 0);
    switch (e.weapon) {
      case "longGun":
        this.fireBall(id, e, w, a.yaw, a.pitch, speed, input.spin);
        break;
      case "mortar":
        this.fireShell(id, e, w, a.yaw, a.pitch, speed, input.fuse);
        break;
      case "chainShot":
        this.fireChain(id, e, w, a.yaw, a.pitch, speed);
        break;
      case "swivel":
        this.fireGrape(id, e, w, a.yaw, a.pitch, speed);
        break;
    }
  }

  private fireBall(id: number, e: Emplacement, w: WeaponDef, yaw: number, pitch: number, speed: number, spin: Spin) {
    const [mx, my, mz] = muzzle(e, yaw, pitch);
    const [dx, dy, dz] = aimDir(yaw, pitch);
    const sv = spinVector(yaw, spin, w.spinRate);
    const p = w.projectile;
    const slot = this.castle.fire(mx, my, mz, dx * speed, dy * speed, dz * speed, {
      radius: p.radius, density: p.density, restitution: p.restitution, blast: p.blast, ricochet: true,
      angvel: sv ? { x: sv[0], y: sv[1], z: sv[2] } : undefined,
      power: p.power,
    });
    if (slot >= 0) this.addShot({ id, emplacement: e.id, kind: ProjectileKind.Ball, slots: [slot], coef: flightCoef(p), spin: sv !== null, fuseAt: -1, landed: false, joint: null, auto: this.firingAuto });
  }

  /** M3: a new shot, with the ball slots it carries noted for whatever they hit. */
  private addShot(shot: Shot) {
    this.shots.push(shot);
    for (const s of shot.slots) if (s < this.slotShot.length) this.slotShot[s] = shot.id;
  }

  /** M3: the shot a ball slot carries (-1: none known). */
  private shotOf(slot: number): number {
    return slot >= 0 && slot < this.slotShot.length ? this.slotShot[slot] : -1;
  }

  /** M3: forget shots that left the world more than ten seconds ago. */
  private pruneShots(tick: number) {
    for (const [id, s] of this.shotInfo) if (s.ended >= 0 && tick - s.ended > 600) this.shotInfo.delete(id);
  }

  private fireShell(id: number, e: Emplacement, w: WeaponDef, yaw: number, pitch: number, speed: number, fuse: number) {
    const [mx, my, mz] = muzzle(e, yaw, pitch);
    const [dx, dy, dz] = aimDir(yaw, pitch);
    const p = w.projectile;
    const slot = this.castle.fire(mx, my, mz, dx * speed, dy * speed, dz * speed, {
      radius: p.radius, density: p.density, restitution: p.restitution, blast: 0, ricochet: false, life: 60 * 20, gravity: p.gravity,
    });
    const f = fuse <= 0 ? 0 : this.tick + clampInt(fuse, w.fuseMin, w.fuseMax);
    if (slot >= 0) this.addShot({ id, emplacement: e.id, kind: ProjectileKind.Shell, slots: [slot], coef: flightCoef(p), spin: false, fuseAt: f, landed: false, joint: null, auto: this.firingAuto });
  }

  private fireChain(id: number, e: Emplacement, w: WeaponDef, yaw: number, pitch: number, speed: number) {
    const [mx, my, mz] = muzzle(e, yaw, pitch);
    const [dx, dy, dz] = aimDir(yaw, pitch);
    // The chain lies across the shot (along "right") and the pair spins about the vertical.
    const rx = -dz, rz = dx; // right = forward x up, flattened
    const rl = dsqrt(rx * rx + rz * rz) + 1e-9;
    const h = w.chainLength / 2;
    const ux = rx / rl, uz = rz / rl;
    const tang = w.chainSpin * h; // tangential speed of each ball
    // up x right = forward (flattened): one ball runs ahead, the other lags, so the pair turns.
    const fx = dx, fz = dz;
    const fl = dsqrt(fx * fx + fz * fz) + 1e-9;
    const p = w.projectile;
    const opts = { radius: p.radius, density: p.density, restitution: p.restitution, blast: p.blast, ricochet: true };
    const s1 = this.castle.fire(mx + ux * h, my, mz + uz * h, dx * speed + (fx / fl) * tang, dy * speed, dz * speed + (fz / fl) * tang, opts);
    const s2 = this.castle.fire(mx - ux * h, my, mz - uz * h, dx * speed - (fx / fl) * tang, dy * speed, dz * speed - (fz / fl) * tang, opts);
    if (s1 < 0 || s2 < 0) return;
    const b1 = this.castle.balls[s1].body, b2 = this.castle.balls[s2].body;
    const joint = this.castle.world.createImpulseJoint(this.R.JointData.rope(w.chainLength, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), b1, b2, true);
    this.addShot({ id, emplacement: e.id, kind: ProjectileKind.Chain, slots: [s1, s2], coef: flightCoef(p), spin: false, fuseAt: -1, landed: false, joint, auto: this.firingAuto });
  }

  private fireGrape(id: number, e: Emplacement, w: WeaponDef, yaw: number, pitch: number, speed: number) {
    const [mx, my, mz] = muzzle(e, yaw, pitch);
    const p = w.projectile;
    const slots: number[] = [];
    for (let i = 0; i < w.pellets; i++) {
      // Uniform over a disc of directions: radius from sqrt of a uniform.
      const r = w.spread * dsqrt(this.pelletRng.next());
      const t = this.pelletRng.range(0, 6.283185307179586);
      const [dx, dy, dz] = aimDir(yaw + r * cosT(t), pitch + r * sinT(t));
      const sp = speed * this.pelletRng.range(0.92, 1.05);
      const s = this.castle.fire(mx, my, mz, dx * sp, dy * sp, dz * sp, { radius: p.radius, density: p.density, restitution: p.restitution, blast: 0, ricochet: true, life: 60 * 4, groups: PELLET_GROUPS });
      if (s >= 0) slots.push(s);
    }
    if (slots.length) this.addShot({ id, emplacement: e.id, kind: ProjectileKind.Grape, slots, coef: flightCoef(p), spin: false, fuseAt: -1, landed: false, joint: null, auto: this.firingAuto });
  }

  /** Drag against the wind for everything in the air, Magnus lift for spinning shot that has not touched anything. */
  private applyFlight() {
    const v = this.tmpV, sp = this.tmpS, dv = this.tmpDv;
    for (const shot of this.shots) {
      for (const slot of shot.slots) {
        const ball = this.castle.balls[slot];
        if (!ball || !ball.alive) continue;
        const lv = ball.body.linvel();
        v[0] = lv.x;
        v[1] = lv.y;
        v[2] = lv.z;
        let spin: [number, number, number] | null = null;
        if (shot.spin && !ball.touched) {
          const av = ball.body.angvel();
          sp[0] = av.x;
          sp[1] = av.y;
          sp[2] = av.z;
          spin = sp;
        }
        flightDv(v, spin, this.wind.x, this.wind.z, shot.coef, dv);
        ball.body.setLinvel({ x: v[0] + dv[0], y: v[1] + dv[1], z: v[2] + dv[2] }, true);
      }
    }
  }

  /** Turn what the minions and the masonry logged into page events (Down, Fell). State is untouched. */
  private drainLogs() {
    const dl = this.minions.downLog;
    for (let k = 0; k + 3 < dl.length; k += 4) this.event(EventKind.Down, dl[k], dl[k + 1], dl[k + 2], dl[k + 3]);
    dl.length = 0;
    const ll = this.castle.looseLog;
    if (ll.length) {
      const secs = sectionOf(this.castle.layout);
      const stones = this.castle.layout.stones;
      const counts = new Map<number, number>();
      for (const id of ll) {
        const key = stones[id].castle * 1000 + (secs[id] + 1);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const key of [...counts.keys()].sort((a, b) => a - b)) this.event(EventKind.Fell, Math.floor(key / 1000), (key % 1000) - 1, counts.get(key)!, 0);
      ll.length = 0;
    }
  }

  private afterStep() {
    const castle = this.castle;
    this.drainLogs();
    for (const im of castle.impacts) this.event(EventKind.Impact, im.x, im.y, im.z, im.strength);
    // M5: tough pieces (keep floor boards) cracked by a blast but still standing.
    for (const id of castle.cracked) {
      const s = this.castle.layout.stones[id];
      this.event(EventKind.Cracked, id, s.x, s.y, s.z);
    }
    castle.cracked.length = 0;
    // M3: a ball that glances off stone keeps that on its shot's record (a ricochet kill, if it fells a man after).
    for (const [bi] of castle.glances) {
      const info = this.shotInfo.get(this.shotOf(bi));
      if (info) info.glanced = true;
    }

    // Balls that touched minions: knock them down and keep most of the momentum.
    for (const [bi, handle] of castle.foreign) {
      const mid = this.minions.of(handle);
      const ball = castle.balls[bi];
      if (mid === undefined) {
        // A ladder against a wall: a shot knocks it off (a ball that left the world this step is gone).
        if (ball && ball.alive && this.ladders && this.ladders.isLadder(handle)) this.ladders.hitByBall(handle, ball.vx, ball.vy, ball.vz, ball.body.mass(), this.tick);
        continue;
      }
      if (!ball || !ball.alive) continue;
      const speed2 = ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz;
      if (speed2 < 16) continue;
      const mass = ball.body.mass();
      const share = mass / (mass + 70); // momentum shared with a 70 kg body
      const p = ball.body.translation();
      this.minions.knock({ minion: mid, vx: ball.vx * share, vy: ball.vy * share + 1.5, vz: ball.vz * share, px: p.x, py: p.y, pz: p.z, extra: 1.5, cause: Cause.Ball, shot: this.shotOf(bi) }, this.tick);
      ball.body.setLinvel({ x: ball.vx * (1 - share * 0.5), y: ball.vy * (1 - share * 0.5), z: ball.vz * (1 - share * 0.5) }, true);
      this.event(EventKind.Blood, p.x, p.y, p.z, Math.min(1, dsqrt(speed2) / 60));
    }
    // Falling stones on minions.
    for (const [stoneId, handle] of castle.foreignStones) {
      const mid = this.minions.of(handle);
      if (mid === undefined) {
        if (this.ladders && this.ladders.isLadder(handle)) {
          const lv = castle.bodies[stoneId].linvel();
          this.ladders.hitByStone(handle, lv.x, lv.y, lv.z, this.tick);
        }
        continue;
      }
      const v = castle.bodies[stoneId].linvel();
      const s2 = v.x * v.x + v.y * v.y + v.z * v.z;
      if (s2 < 6) continue;
      const p = castle.bodies[stoneId].translation();
      this.minions.knock({ minion: mid, vx: v.x * 0.4, vy: v.y * 0.2, vz: v.z * 0.4, px: p.x, py: p.y, pz: p.z, extra: 0.5, cause: Cause.Masonry, stone: stoneId }, this.tick);
      this.event(EventKind.Blood, p.x, p.y, p.z, 0.5);
    }

    // After M5: shots through guns, and the chain shot's chain sweeping men, ladders and gun crews.
    this.sweepShots();

    for (let k = this.shots.length - 1; k >= 0; k--) {
      const shot = this.shots[k];
      let alive = 0;
      for (const slot of shot.slots) {
        const ball = castle.balls[slot];
        if (!ball || !ball.alive) continue;
        alive++;
        if (ball.touchedNow && !shot.landed) {
          shot.landed = true;
          const p = ball.body.translation();
          this.event(EventKind.Landed, shot.auto ? -(shot.emplacement + 1) : shot.emplacement, p.x, p.y, p.z);
          this.landings.push({ shot: shot.id, emplacement: shot.emplacement, auto: shot.auto, x: p.x, y: p.y, z: p.z });
          // M3: its first touch is a keep (a keep hit, for the match to pay for).
          if (ball.struck >= 0 && this.army) {
            const s = castle.layout.stones[ball.struck];
            if (s && isKeepPiece(s)) this.keepHits.push(shot.id, s.castle);
          }
          // A heavy, fast ball into the ground digs a small crater.
          if (shot.kind === ProjectileKind.Ball) {
            const speed2 = ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz;
            if (speed2 > 900 && p.y - this.terrain.heightAt(p.x, p.z) < ball.radius + 0.4) {
              if (this.terrain.crater(p.x, p.z, 1.3, 0.45)) castle.thawAt(p.x, p.y, p.z, 2.5);
            }
          }
        }
      }
      // Fuses.
      if (shot.kind === ProjectileKind.Shell && alive) {
        const ball = castle.balls[shot.slots[0]];
        const due = shot.fuseAt === 0 ? ball.touchedNow : shot.fuseAt > 0 && this.tick + 1 >= shot.fuseAt;
        if (due) {
          const p = ball.body.translation();
          let x = p.x, y = p.y, z = p.z;
          const burst = weaponOf(this.emplacements[shot.emplacement]).burst ?? SHELL_BURST;
          if (shot.fuseAt === 0 && ball.struck >= 0) {
            // A shell that strikes masonry bursts inside it, along its flight: roofs and wall tops cave in.
            const sp = dsqrt(ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz) + 1e-9;
            x += (ball.vx / sp) * burst.bite;
            y += (ball.vy / sp) * burst.bite;
            z += (ball.vz / sp) * burst.bite;
          }
          castle.removeBall(shot.slots[0]);
          this.explode(x, y, z, burst, shot.id);
          alive = 0;
        }
      }
      if (!alive) {
        if (shot.joint) shot.joint = null; // removed with its bodies
        this.shots.splice(k, 1);
        const info = this.shotInfo.get(shot.id);
        if (info) info.ended = this.tick;
      }
    }
    this.minions.settle(this.tick);
    // After M5: guns whose masonry gave way fall with it; guns whose crews have them back are loaded afresh.
    const M = this.mounts;
    M.step(this.tick);
    for (let k = 0; k + 1 < M.backs.length; k += 2) {
      const e = this.emplacements[M.backs[k]];
      if (e && !e.empty) this.reload[e.id] = weaponOf(e).reload;
    }
  }

  /** Where every ball in flight is before the step (after M5: a shot's path, a chain's sweep). */
  private notePositions() {
    const prev = this.prevPos;
    for (const shot of this.shots) {
      if (shot.kind !== ProjectileKind.Ball && shot.kind !== ProjectileKind.Chain) continue;
      for (const slot of shot.slots) {
        const ball = this.castle.balls[slot];
        if (!ball || !ball.alive || slot * 3 + 2 >= prev.length) continue;
        const t = ball.body.translation();
        prev[slot * 3] = t.x;
        prev[slot * 3 + 1] = t.y;
        prev[slot * 3 + 2] = t.z;
      }
    }
  }

  /**
   * After M5, after the world's step: a ball that passed through a gun this
   * step knocks it out (a round shot must strike the gun itself; a chain
   * shot's balls take its crew), and a chain shot's chain, swept from where
   * it was to where it is, knocks down every man standing in its way, knocks
   * planted ladders off the walls and sweeps gun crews away. Each man it
   * takes slows it.
   */
  private sweepShots() {
    const castle = this.castle, prev = this.prevPos, tick = this.tick;
    const min2 = GUN_HITS.minSpeed * GUN_HITS.minSpeed;
    for (const shot of this.shots) {
      if (shot.kind !== ProjectileKind.Ball && shot.kind !== ProjectileKind.Chain) continue;
      const chain = shot.kind === ProjectileKind.Chain;
      for (const slot of shot.slots) {
        const ball = castle.balls[slot];
        if (!ball || !ball.alive || slot * 3 + 2 >= prev.length) continue;
        const v = ball.body.linvel();
        if (v.x * v.x + v.y * v.y + v.z * v.z < min2) continue;
        const t = ball.body.translation();
        this.mounts.sweep(prev[slot * 3], prev[slot * 3 + 1], prev[slot * 3 + 2], t.x, t.y, t.z, ball.radius, chain, shot.id, shot.emplacement, tick);
      }
      if (!chain || shot.slots.length < 2) continue;
      const A = castle.balls[shot.slots[0]], B = castle.balls[shot.slots[1]];
      if (!A || !B || !A.alive || !B.alive) continue;
      const va = A.body.linvel(), vb = B.body.linvel();
      const vx = (va.x + vb.x) / 2, vy = (va.y + vb.y) / 2, vz = (va.z + vb.z) / 2;
      if (vx * vx + vy * vy + vz * vz < SWEEP.minSpeed * SWEEP.minSpeed) continue;
      const ta = A.body.translation(), tb = B.body.translation();
      const oa = shot.slots[0] * 3, ob = shot.slots[1] * 3;
      const mv: ChainMove = {
        a0: [prev[oa], prev[oa + 1], prev[oa + 2]],
        b0: [prev[ob], prev[ob + 1], prev[ob + 2]],
        a1: [ta.x, ta.y, ta.z],
        b1: [tb.x, tb.y, tb.z],
      };
      // The whirl is as wide as the chain (its weapon's, with any upgrade).
      const half = weaponOf(this.emplacements[shot.emplacement]).chainLength / 2;
      // Men in its way.
      const swept = (shot.swept ??= new Set<number>());
      let keep = 1;
      for (const hit of sweptMen(this.minions, mv, half, swept)) {
        swept.add(hit.id);
        const k = SWEEP.share * keep;
        this.minions.knock({ minion: hit.id, vx: vx * k, vy: vy * k + SWEEP.lift, vz: vz * k, px: hit.x, py: hit.y, pz: hit.z, extra: 1.2, cause: Cause.Ball, shot: shot.id }, tick);
        this.event(EventKind.Blood, hit.x, hit.y, hit.z, 0.7);
        this.event(EventKind.Swept, hit.id, hit.x, hit.y, hit.z);
        keep *= SWEEP.keep;
      }
      if (keep < 1) {
        A.body.setLinvel({ x: va.x * keep, y: va.y * keep, z: va.z * keep }, true);
        B.body.setLinvel({ x: vb.x * keep, y: vb.y * keep, z: vb.z * keep }, true);
      }
      // Ladders it passes come off the wall; the crews of guns it passes are swept away.
      this.ladders?.sweptBy(mv, half, vx, vy, vz, tick);
      for (let k = 0; k <= SWEEP.steps; k++) {
        const c = chainMid(mv, k);
        this.mounts.whirl(c[0], c[1], c[2], half, shot.id, shot.emplacement, tick);
      }
    }
  }

  /** A powder burst: masonry, minions, a crater if it is near the ground. `shot` is the shell's (-1: none, a keg left to burn). */
  explode(x: number, y: number, z: number, burst: BurstDef = SHELL_BURST, shot = -1) {
    const E = burst;
    this.castle.burst(x, y, z, E.radius, E.shatter, E.power, E.lift);
    this.event(EventKind.Explosion, x, y, z, E.radius);
    // After M5: a gun beside the burst is blown off its bed.
    this.mounts.burst(x, y, z, E.radius, shot, this.tick);
    this.ladders?.blast(x, y, z, E.knock * 0.5, this.tick);
    // M3: kegs set within its reach go off with it.
    this.specialists?.burstNear(x, y, z, E.radius * 1.3, shot, this.tick);
    for (const n of this.minions.near(x, y, z, E.knock)) {
      const d = n.d + 0.3;
      const f = E.knockSpeed * (1 - n.d / E.knock);
      const ex = (n.cx - x) / d, ey = (n.cy - y) / d, ez = (n.cz - z) / d;
      this.minions.knock({ minion: n.id, vx: ex * f, vy: ey * f + f * 0.6, vz: ez * f, px: x, py: y, pz: z, extra: 0.6, cause: Cause.Burst, shot }, this.tick);
      this.event(EventKind.Blood, n.cx, n.cy, n.cz, 1 - n.d / E.knock);
    }
    const g = this.terrain.heightAt(x, z);
    if (y - g < 1.6) {
      const up = y - g > 0 ? y - g : 0;
      const depth = E.depth * (1 - (up / 1.6) * 0.6);
      if (this.terrain.crater(x, z, E.crater, depth)) this.castle.thawAt(x, y, z, E.crater + 1.5);
    }
  }

  private event(kind: EventKind, a: number, b: number, c: number, d: number) {
    this.events.push(kind, a, b, c, d);
  }

  /** Everything since the last call, for the renderer. Arrays are fresh copies (transferable). */
  collect(): FrameData {
    const b = this.bufs;
    const lead = this.wind.lead(this.tick);
    const stoneCount = this.castle.collectMoving(b.stones);
    let pc = 0, cc = 0;
    for (const shot of this.shots) {
      let first: { x: number; y: number; z: number } | null = null;
      for (const slot of shot.slots) {
        const ball = this.castle.balls[slot];
        if (!ball || !ball.alive || (pc + 1) * PROJECTILE_STRIDE > b.projectiles.length) continue;
        const t = ball.body.translation();
        const v = ball.body.linvel();
        const o = pc * PROJECTILE_STRIDE;
        b.projectiles.set([shot.kind, shot.id, t.x, t.y, t.z, ball.radius, v.x, v.y, v.z], o);
        pc++;
        if (shot.kind === ProjectileKind.Chain) {
          if (!first) first = t;
          else if ((cc + 1) * CHAIN_STRIDE <= b.chains.length) {
            b.chains.set([first.x, first.y, first.z, t.x, t.y, t.z], cc * CHAIN_STRIDE);
            cc++;
          }
        }
      }
    }
    const mc = this.minions.collectUpright(b.minions);
    const partCount = this.minions.collectParts(b.parts);
    const settledCount = this.minions.collectSettled(b.settled);
    const gone = Int32Array.from(this.minions.collectGone());
    const ladderCount = this.ladders ? this.ladders.collect(b.ladders) : 0;
    const worksCount = this.works ? this.works.collect(b.works) : 0;
    const terrain: TerrainPatch[] = this.terrain.patches;
    this.terrain.patches = [];
    this.drainLogs();
    const events = new Float32Array(this.events);
    this.events.length = 0;
    const plotCount = this.structures ? this.structures.collect(b.plots) : 0;
    const kegCount = this.specialists ? this.specialists.collect(b.kegs, this.tick) : 0;
    return {
      plots: b.plots.slice(0, plotCount * PLOT_STRIDE),
      plotCount,
      kegs: b.kegs.slice(0, kegCount * KEG_STRIDE),
      kegCount,
      tick: this.tick,
      stones: b.stones.slice(0, stoneCount * STONE_STRIDE),
      stoneCount,
      projectiles: b.projectiles.slice(0, pc * PROJECTILE_STRIDE),
      projectileCount: pc,
      chains: b.chains.slice(0, cc * CHAIN_STRIDE),
      chainCount: cc,
      minions: b.minions.slice(0, mc * MINION_STRIDE),
      minionCount: mc,
      parts: b.parts.slice(0, partCount * PART_STRIDE),
      partCount,
      settled: b.settled.slice(0, settledCount * PART_STRIDE),
      settledCount,
      gone,
      ladders: b.ladders.slice(0, ladderCount * LADDER_STRIDE),
      ladderCount,
      works: b.works.slice(0, worksCount * WORKS_STRIDE),
      worksCount,
      events,
      eventCount: events.length / EVENT_STRIDE,
      terrain,
      windX: this.wind.x,
      windZ: this.wind.z,
      gustX: lead.x,
      gustZ: lead.z,
      gustIn: lead.ticks,
    };
  }

  /** Minions down (ragdoll or frozen) and standing. */
  minionCounts(): { down: number; standing: number } {
    let down = 0;
    for (const m of this.minions.list) if (m.state !== MinionState.Upright) down++;
    return { down, standing: this.minions.list.length - down };
  }

  /** Hash of the whole gameplay state: masonry, Rapier's snapshot, terrain, minions, shots, wind. */
  hash(): { state: string; world: string } {
    const c = this.castle.hash();
    const extra: number[] = [this.tick, this.wind.x, this.wind.z, ...this.reload];
    this.minions.hashInto(extra);
    this.army?.hashInto(extra);
    this.ladders?.hashInto(extra);
    this.works?.hashInto(extra);
    this.structures?.hashInto(extra);
    this.specialists?.hashInto(extra);
    this.mounts.hashInto(extra);
    for (const s of this.shots) {
      extra.push(s.id, s.kind, s.fuseAt, s.landed ? 1 : 0);
      for (const slot of s.slots) {
        const ball = this.castle.balls[slot];
        if (!ball.alive) continue;
        const t = ball.body.translation();
        extra.push(t.x, t.y, t.z);
      }
    }
    const f = new Float64Array(extra);
    let h = hashBytes(new Uint8Array(f.buffer));
    h = hashBytes(new Uint8Array(this.terrain.h.buffer), h);
    h = hashBytes(new Uint8Array(new Uint32Array([parseInt(c.state, 16)]).buffer), h);
    return { state: hex8(h), world: c.snapshot };
  }
}

export function spinVector(yaw: number, spin: Spin, rate: number): [number, number, number] | null {
  if (spin === Spin.None || rate <= 0) return null;
  const [fx, , fz] = aimDir(yaw, 0);
  const rx = -fz, rz = fx; // right
  switch (spin) {
    case Spin.Back:
      return [rx * rate, 0, rz * rate];
    case Spin.Top:
      return [-rx * rate, 0, -rz * rate];
    case Spin.Left:
      return [0, rate, 0];
    case Spin.Right:
      return [0, -rate, 0];
  }
  return null;
}

function clampInt(v: number, lo: number, hi: number): number {
  const r = Math.round(v);
  return r < lo ? lo : r > hi ? hi : r;
}

function cosT(t: number): number {
  return aimDir(t, 0)[2];
}
function sinT(t: number): number {
  return aimDir(t, 0)[0];
}
