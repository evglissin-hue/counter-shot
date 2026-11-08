// The match (phase 2): two castles and two teams in the valley, a match clock,
// the keeps' income, the barracks' waves, the teams' orders, the weapons
// nobody is manning, and who has won. It wraps the world simulation and adds
// what the world does not know about: whose castle is whose, gold, timers and
// the end of the match. Everything that changes a match enters as an input
// tagged with its tick and its team, so a match replays from its inputs, and
// an AI is just another player sending inputs.
//
// Teams are castle indices: team 0 holds the castle at the origin (the enemy
// in a match against the AI), team 1 the one at z = -DIST (the player's).

import {
  BRIDGES,
  DEFEND,
  ENEMY_ROUTES,
  MATCH,
  MATCH_EMPLACEMENTS,
  MID_Z,
  MUSTER,
  ROUTE_NAMES,
  UNMANNED,
  WAVES,
  WEAPONS,
  type CastleLayout,
  type Emplacement,
  type RouteName,
  type UnmannedDef,
} from "@keepfall/content";
import { DPI, dcos, dsin, dsqrt, hashBytes, hashString, hex8, Rng } from "@keepfall/core";
import { MinionState, Order, SandboxSim, solveAim, Spin, stepAim, yawTowards, type Rapier, type SandboxInput } from "@keepfall/sim";

export const enum Team {
  Enemy = 0,
  Player = 1,
}

/** Bump whenever the same match inputs would play out differently because of the match rules (the sim has its own RULES_VERSION). */
export const MATCH_RULES_VERSION = 2;

/** A shot from one of a team's emplacements. */
export type FireInput = Extract<SandboxInput, { kind: "fire" }>;
export type MatchInput =
  | FireInput
  /** All of the team's waves, now and later (SPEC section 8). */
  | { kind: "order"; order: Order }
  /** The route the team's barracks sends its next waves down. */
  | { kind: "route"; route: RouteName }
  /**
   * The emplacement the team is riding now (-1: none, in the overview); every
   * other one of its emplacements fires at minions on its own. `left` is the
   * aim of the one being left, so its barrel stays where the gunner put it.
   */
  | { kind: "man"; emplacement: number; left?: { emplacement: number; yaw: number; pitch: number } };

export interface MatchResult {
  /** The winning team, or -1 for a draw (both keeps fell on the same tick). */
  winner: Team | -1;
  reason: "keep";
  /** Tick the match ended. */
  tick: number;
}

export interface MatchOptions {
  seed: number;
  emplacements?: Emplacement[];
  /** The barracks send waves (default); tests and tools may turn them off. */
  barracks?: boolean;
}

/** An emplacement's barrel and, when nobody mans it, what it is laying on. */
export interface Gun {
  yaw: number;
  pitch: number;
  /** The minion it is laying on (-1: none), the aim it turns to, the charge, and its error offset (m) for that target. */
  target: number;
  aimYaw: number;
  aimPitch: number;
  charge: number;
  errX: number;
  errZ: number;
}

/** Which team an emplacement belongs to: the castle on its side of the field. */
export function teamOf(e: Emplacement): Team {
  return e.z < MID_Z ? Team.Player : Team.Enemy;
}

/** Is a point within r of a bridge (its deck, end to end)? */
function nearBridge(x: number, z: number, r: number): boolean {
  for (const b of BRIDGES) {
    const dx = Math.abs(x - b.x) - b.width / 2, dz = Math.abs(z - b.z) - b.length / 2;
    const ox = dx > 0 ? dx : 0, oz = dz > 0 ? dz : 0;
    if (ox * ox + oz * oz < r * r) return true;
  }
  return false;
}

/**
 * Would a shot from e at (x, z), `range` metres away, put a bridge at risk?
 * A flat gun's miss flies on along its line; a mortar shell falls anywhere
 * within its error, and bursts.
 */
function bridgeAtRisk(e: Emplacement, x: number, z: number, U: UnmannedDef, range: number): boolean {
  if (U.overshoot <= 0) return nearBridge(x, z, U.errBase + U.errPerM * range + U.clearBridge);
  const dx = x - e.x, dz = z - e.z;
  const d = dsqrt(dx * dx + dz * dz) + 1e-9;
  for (let s = 0; s <= U.overshoot; s += 2) if (nearBridge(x + (dx / d) * s, z + (dz / d) * s, U.clearBridge)) return true;
  return false;
}

/** Ticks between an unmanned gun's looks for a target (staggered by emplacement). */
const LOOK_EVERY = 30;
/** An unmanned gun fires when it is this close to its aim (rad). */
const ON_MARK = 0.0015;

export class Match {
  readonly world: SandboxSim;
  readonly emplacements: Emplacement[];
  readonly gold: [number, number] = [MATCH.startGold, MATCH.startGold];
  /** Shots each team fired itself, and shots its unmanned weapons fired. */
  readonly shots: [number, number] = [0, 0];
  readonly autoShots: [number, number] = [0, 0];
  /** Each team's barracks route for its next waves, and waves sent so far. */
  readonly route: [RouteName, RouteName] = ["centre", "centre"];
  readonly waves: [number, number] = [0, 0];
  /** The emplacement each team rides (-1: none). */
  readonly manned: [number, number] = [-1, -1];
  /** Every emplacement's barrel (in emplacement order). */
  readonly guns: Gun[];
  result: MatchResult | null = null;
  private inputs = new Map<number, Array<{ team: Team; input: MatchInput }>>();
  private owner: Team[];
  /** The unmanned weapons' aim errors, drawn in the order they lay on targets. */
  private rng: Rng;
  private barracks: boolean;

  constructor(R: Rapier, layout: CastleLayout, opts: MatchOptions) {
    this.emplacements = opts.emplacements ?? MATCH_EMPLACEMENTS;
    this.world = new SandboxSim(R, layout, { seed: opts.seed, minions: 0, emplacements: this.emplacements, army: true });
    this.owner = this.emplacements.map(teamOf);
    this.guns = this.emplacements.map((e) => {
      const w = WEAPONS[e.weapon];
      const pitch = w.restPitch < w.minPitch ? w.minPitch : w.restPitch > w.maxPitch ? w.maxPitch : w.restPitch;
      return { yaw: e.baseYaw, pitch, target: -1, aimYaw: e.baseYaw, aimPitch: pitch, charge: 1, errX: 0, errZ: 0 };
    });
    this.rng = new Rng((hashString("unmanned") ^ opts.seed) >>> 0);
    this.barracks = opts.barracks !== false;
  }

  get tick(): number {
    return this.world.tick;
  }

  /** The world's army (a match always has one). */
  get army() {
    return this.world.army!;
  }

  free() {
    this.world.free();
  }

  /** Queue a team's input for a tick (now or later). Whether it is allowed is decided on that tick. */
  queue(tick: number, team: Team, input: MatchInput) {
    const t = tick < this.tick ? this.tick : tick;
    let list = this.inputs.get(t);
    if (!list) this.inputs.set(t, (list = []));
    list.push({ team, input });
  }

  /** Ticks until both barracks send their next waves. */
  nextWaveIn(): number {
    const t = this.tick;
    if (t <= WAVES.first) return WAVES.first - t;
    const k = (t - WAVES.first) % WAVES.every;
    return k === 0 ? 0 : WAVES.every - k;
  }

  step() {
    const tick = this.tick;
    const list = this.inputs.get(tick);
    if (list) {
      this.inputs.delete(tick);
      // Only while the match is on.
      if (!this.result) for (const { team, input } of list) this.apply(team, input, tick);
    }
    if (!this.result) {
      if (this.barracks && tick >= WAVES.first && (tick - WAVES.first) % WAVES.every === 0) {
        this.sendWave(Team.Player);
        this.sendWave(Team.Enemy);
      }
      this.gunnery(tick);
    }
    this.world.step();
    if (this.result) return;
    if (tick % MATCH.incomeEvery === MATCH.incomeEvery - 1) {
      this.gold[0] += MATCH.keepIncome;
      this.gold[1] += MATCH.keepIncome;
    }
    // A keep is toppled when its banner comes down: the other team wins.
    const [down0, down1] = this.world.castle.toppled;
    if (down0 || down1) {
      const winner: Team | -1 = down0 && down1 ? -1 : down0 ? Team.Player : Team.Enemy;
      this.result = { winner, reason: "keep", tick };
    }
  }

  private apply(team: Team, input: MatchInput, tick: number) {
    switch (input.kind) {
      case "fire": {
        // Only from the team's own emplacements, and only when loaded.
        const e = this.emplacements[input.emplacement];
        if (!e || this.owner[e.id] !== team || this.world.reload[e.id] > 0) return;
        this.shots[team]++;
        this.world.queue(tick, { ...input, auto: false, reload: 1 });
        this.setGun(e.id, input.yaw, input.pitch);
        return;
      }
      case "order":
        if (input.order === Order.Advance || input.order === Order.Hold || input.order === Order.Push) this.army.setOrder(team, input.order);
        return;
      case "route":
        if (ROUTE_NAMES.includes(input.route)) this.route[team] = input.route;
        return;
      case "man": {
        const e = input.emplacement;
        if (e !== -1 && (!this.emplacements[e] || this.owner[e] !== team)) return;
        const left = input.left;
        if (left && this.emplacements[left.emplacement] && this.owner[left.emplacement] === team) this.setGun(left.emplacement, left.yaw, left.pitch);
        this.manned[team] = e;
        if (e >= 0) this.guns[e].target = -1;
        return;
      }
    }
  }

  /** A gunner put this barrel here (clamped to its limits). */
  private setGun(id: number, yaw: number, pitch: number) {
    const e = this.emplacements[id], w = WEAPONS[e.weapon];
    const g = this.guns[id];
    g.yaw = yaw < e.baseYaw - e.yawLimit ? e.baseYaw - e.yawLimit : yaw > e.baseYaw + e.yawLimit ? e.baseYaw + e.yawLimit : yaw;
    g.pitch = pitch < w.minPitch ? w.minPitch : pitch > w.maxPitch ? w.maxPitch : pitch;
    g.target = -1;
  }

  /** A team's barracks sends a wave down its route (the enemy's in turn, until the AI arrives), as many as its cap allows. */
  private sendWave(team: Team) {
    const route = team === Team.Player ? this.route[team] : ENEMY_ROUTES[this.waves[team] % ENEMY_ROUTES.length];
    const room = WAVES.maxStanding - this.army.standing(team);
    const count = room < WAVES.size ? room : WAVES.size;
    this.waves[team]++;
    if (count > 0) this.army.spawnWave(team, ROUTE_NAMES.indexOf(route), count);
  }

  /**
   * Weapons nobody mans lay on the enemy minion nearest their own gate within
   * reach, turn towards it at the weapon's own rates and fire when on their
   * mark: a slower reload, an aim that ignores the wind, and an error that
   * grows with the range.
   */
  private gunnery(tick: number) {
    for (const e of this.emplacements) {
      const team = this.owner[e.id];
      const U = UNMANNED[e.weapon];
      if (!U || this.manned[team] === e.id) continue;
      const g = this.guns[e.id];
      const w = WEAPONS[e.weapon];
      if ((tick + e.id * 7) % LOOK_EVERY === 0 && this.world.reload[e.id] <= 60) this.lay(e, g, team, U);
      if (g.target < 0) continue;
      const a = stepAim({ yaw: g.yaw, pitch: g.pitch }, { dYaw: g.aimYaw - g.yaw, dPitch: g.aimPitch - g.pitch, fine: false }, e, w);
      g.yaw = a.yaw;
      g.pitch = a.pitch;
      if (this.world.reload[e.id] > 0) continue;
      const dy = g.yaw - g.aimYaw, dp = g.pitch - g.aimPitch;
      if (dy > ON_MARK || dy < -ON_MARK || dp > ON_MARK || dp < -ON_MARK) continue;
      const m = this.world.minions.list[g.target];
      g.target = -1;
      if (!m || m.state !== MinionState.Upright) continue;
      this.autoShots[team]++;
      this.world.queue(tick, { kind: "fire", emplacement: e.id, yaw: g.yaw, pitch: g.pitch, charge: g.charge, fuse: 0, spin: Spin.None, auto: true, reload: U.reload });
    }
  }

  /** Choose a target for an unmanned gun and work out its aim (leading it, plus the gun's error). */
  private lay(e: Emplacement, g: Gun, team: Team, U: UnmannedDef) {
    const gate = MUSTER[team];
    let best = -1, bestD = Infinity;
    for (const m of this.world.minions.list) {
      if (m.state !== MinionState.Upright || m.wave < 0 || m.team === team) continue;
      const dx = m.x - e.x, dz = m.z - e.z;
      const r2 = dx * dx + dz * dz;
      if (r2 < U.minRange * U.minRange || r2 > U.maxRange * U.maxRange) continue;
      if (yawTowards(e, m.x, m.z) === null) continue;
      const gx = m.x - gate.x, gz = m.z - gate.z;
      const threat = gx * gx + gz * gz;
      if (threat > DEFEND * DEFEND || threat >= bestD) continue;
      if (bridgeAtRisk(e, m.x, m.z, U, dsqrt(r2))) continue;
      if (this.ownNear(team, m.x, m.z, U.clearOwn)) continue;
      bestD = threat;
      best = m.id;
    }
    if (best < 0) {
      g.target = -1;
      return;
    }
    const m = this.world.minions.list[best];
    const first = solveAim(e, m.x, m.y + 1, m.z);
    if (!first) {
      g.target = -1;
      return;
    }
    if (g.target !== best) {
      // A new target: the gun's error for it, drawn once.
      const dx = m.x - e.x, dz = m.z - e.z;
      const r = U.errBase + U.errPerM * dsqrt(dx * dx + dz * dz);
      const rr = r * dsqrt(this.rng.next());
      const th = this.rng.range(0, 2 * DPI);
      g.errX = rr * dcos(th);
      g.errZ = rr * dsin(th);
    }
    // Lead it: where it will be when the shot arrives, give or take the error.
    const x = m.x + m.vx * first.time + g.errX, z = m.z + m.vz * first.time + g.errZ;
    const s = solveAim(e, x, this.world.terrain.heightAt(x, z) + 1, z);
    if (!s) {
      g.target = -1;
      return;
    }
    g.target = best;
    g.aimYaw = s.yaw;
    g.aimPitch = s.pitch;
    g.charge = s.charge;
  }

  /** Is one of the team's own upright minions within r of a point? */
  private ownNear(team: Team, x: number, z: number, r: number): boolean {
    const r2 = r * r;
    for (const m of this.world.minions.list) {
      if (m.team !== team || m.state !== MinionState.Upright || m.wave < 0) continue;
      const dx = m.x - x, dz = m.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }

  /** Pieces of a castle that have come loose or turned to dust. */
  masonryDown(castle: 0 | 1): number {
    const c = this.world.castle;
    let n = 0;
    for (const s of c.layout.stones) if (s.castle === castle && c.dynamic[s.id]) n++;
    return n;
  }

  /** Each team's minions standing and fallen. */
  armyCounts(): { standing: [number, number]; fallen: [number, number] } {
    const standing: [number, number] = [0, 0], fallen: [number, number] = [0, 0];
    for (const m of this.world.minions.list) {
      if (m.wave < 0) continue;
      if (m.state === MinionState.Upright) standing[m.team]++;
      else fallen[m.team]++;
    }
    return { standing, fallen };
  }

  /** Hash of the whole match: the world's state plus gold, shots, the result, waves, orders and guns. */
  hash(): { state: string; world: string } {
    const w = this.world.hash();
    const r = this.result;
    const nums = [this.tick, this.gold[0], this.gold[1], this.shots[0], this.shots[1], this.autoShots[0], this.autoShots[1], r ? r.winner : -2, r ? r.tick : -1, parseInt(w.state, 16)];
    nums.push(ROUTE_NAMES.indexOf(this.route[0]), ROUTE_NAMES.indexOf(this.route[1]), this.waves[0], this.waves[1], this.manned[0], this.manned[1]);
    for (const g of this.guns) nums.push(g.yaw, g.pitch, g.target, g.aimYaw, g.aimPitch, g.charge, g.errX, g.errZ);
    const f = new Float64Array(nums);
    return { state: hex8(hashBytes(new Uint8Array(f.buffer))), world: w.world };
  }
}
