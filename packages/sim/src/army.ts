// Waves (phase 2 M2, M4): pikemen who march out of their gate along their
// route's flow field, keep their spacing in loose ranks, walk on the nav
// grid's floors (bridge decks, rubble, the fallen), stop at the midfield
// marker on Hold, push into a breach on Push, fight the enemy minions they
// meet (a blow knocks the loser down, with the odds in UNITS drawn from the
// army's seeded stream) and batter a closed gate until its leaves come loose.
// Since M4 each courtyard also holds a garrison that fights whoever gets in,
// a wave mustered inside a courtyard under attack defends it before it
// marches, ladder crews carry ladders to intact walls and the waves climb
// them (ladders.ts), and masons rebuild (works.ts); all of them move with
// this module's walking step.
// Upright minions are kinematic capsules placed here every tick, before the
// physics step; a knockdown makes ragdolls of them (minions.ts).
//
// Deterministic: minions think in id order and see each other's latest
// positions in that order, every decision uses + - * / and comparisons, and
// every random draw comes from the army's own stream, in that order.

import {
  BRIDGES,
  COURTYARD,
  GARRISON,
  GATE_BLOWS,
  garrisonPost,
  inCourtyard,
  MID_Z,
  mirrorZ,
  MUSTER,
  ROUTE_HALF,
  ROUTE_NAMES,
  Unit,
  UNIT_DEFS,
  UNITS,
  WAVES,
  holdMarker,
  MARCH,
  routeDistance,
  type BridgeSite,
  type UnitDef,
} from "@keepfall/content";
import { DPI, dsqrt, Rng } from "@keepfall/core";
import type { CastleSim } from "./castleSim";
import { EventKind } from "./frame";
import { FLOW_INF, FLOW_REGION, FlowFields, type FieldSpec } from "./flow";
import type { Ladders } from "./ladders";
import type { Gangs } from "./gangs";
import { LocalFields } from "./local";
import { Cause, MinionState, Role, isWorker, yawOf, type Minion, type Minions } from "./minions";
import type { Specialists, Steer } from "./specialists";
import { NAV_GRID, NavKind, navCell, navWalkable, type NavGrid } from "./nav";
import type { Terrain } from "./terrain";

/** Orders a team gives all its waves (SPEC section 8). */
export const enum Order {
  /** March on the enemy gate along the wave's route (the default). */
  Advance = 0,
  /** Stop at the midfield marker of the wave's route. */
  Hold = 1,
  /** Head for the nearest walkable gap in the enemy walls (as Advance while there is none). */
  Push = 2,
}

/** What an upright minion is doing (sent to the renderer). */
export const enum Action {
  Walk = 0,
  Stand = 1,
  Fight = 2,
  Batter = 3,
  /** A mason at work (mallet strokes). */
  Work = 4,
  /** Carrying a ladder on the shoulder. */
  Carry = 5,
  /** On a ladder or the rope inside a wall. */
  Climb = 6,
  /** Raising a ladder against a wall. */
  Raise = 7,
}

/** Steps of a minion on its way over a wall by a ladder (Minion.task); ladders.ts moves those from Wait on. */
export const enum Climb {
  None = 0,
  /** Walking to the foot of a ladder (aux: the ladder). */
  ToLadder = 10,
  /** Waiting at the foot for room on it. */
  Wait = 11,
  /** On the ladder (aux: metres up it). */
  Up = 12,
  /** Across the wall walk. */
  Across = 13,
  /** Down the rope inside. */
  Down = 14,
}

export interface WaveOptions {
  /** Two of its men carry a ladder at the back of the wave. */
  ladder?: boolean;
  /** It musters inside its own courtyard (under attack) and defends it, then marches. */
  inside?: boolean;
}

/** Cell visits per tick spent refreshing flow fields: a full refresh of all eight takes about a second and a half. */
const FLOW_BUDGET = 2500;
/** Minions closer than this push each other apart (m), up to SEP_PUSH m/s at full overlap. */
const SEP = 0.95;
const SEP_PUSH = 1.4;
/** Spatial hash bucket (m). */
const BUCKET = 5;
/** The walking height eases over steps by at most this much a tick (m). */
const CLIMB = 0.04;
/** A floor this far below a minion's feet has dropped out from under it (m): it falls. */
const DROP = 1.1;
/** Ticks between looks for an enemy, staggered by id. */
const LOOK_EVERY = 6;
/** Facing turns by at most this much a tick (rad). */
const TURN = 0.15;
/** How far ahead (m) a marching minion looks for the door it will batter. */
const DOOR_REACH = 0.7;
/** Wave cohesion: field cost per metre on a route (5 per step times weight 2), and how much a minion ahead of its wave slows (per metre ahead, at most). */
const COST_PER_M = 10;
const PACE_PER_M = 0.05;
const PACE_SLOW = 0.3;
const PACE_FAST = 0.12;
/** Stride length (m) of one walk cycle. */
const STRIDE = 1.4;
const TWO_PI = 2 * DPI;
/** Ticks between a marcher's looks for a ladder to climb (staggered by id). */
const LADDER_LOOK = 20;
/** Each team's hold line box (m): across the whole valley floor between the flank roads, and this far either side of the middle of its markers' z (its own bank, not the far one). */
const HOLD_LINE_X = 60;
const HOLD_LINE_Z = 18;
/** The eight neighbouring cells in a fixed order (four straight, then four diagonal) for a boxed-in man's sidestep. */
const SIDE_DI = [-1, 1, 0, 0, -1, 1, -1, 1];
const SIDE_DJ = [0, 0, -1, 1, -1, -1, 1, 1];

/** Field index of a team's route field (routes in ROUTE_NAMES order) and its breach field. */
export function routeField(team: number, route: number): number {
  return team * 3 + route;
}
export function breachField(team: number): number {
  return 6 + team;
}
/** The team whose waves use a field. */
function fieldTeam(f: number): number {
  return f < 6 ? (f / 3) | 0 : f - 6;
}

let weightCache: Uint8Array[] | null = null;

/** Per route, a weight per nav cell: 2 on the route (and near the gates), up to 6 far off it. Computed once. */
function routeWeights(): Uint8Array[] {
  if (weightCache) return weightCache;
  const G = NAV_GRID;
  const cells = G.nx * G.nz;
  weightCache = ROUTE_NAMES.map((name) => {
    const w = new Uint8Array(cells).fill(2);
    for (let j = 0; j < G.nz; j++) {
      const z = G.z0 + (j + 0.5) * G.cell;
      const u = z - MID_Z;
      if (u > 57 || u < -57 || z < FLOW_REGION.z0 || z > FLOW_REGION.z1) continue;
      for (let i = 0; i < G.nx; i++) {
        const x = G.x0 + (i + 0.5) * G.cell;
        if (x < FLOW_REGION.x0 || x > FLOW_REGION.x1) continue;
        const off = routeDistance(name, x, z) - ROUTE_HALF[name] - 2;
        if (off <= 0) continue;
        const k = Math.floor(off / 3);
        w[j * G.nx + i] = 2 + (k < 4 ? k : 4);
      }
    }
    return w;
  });
  return weightCache;
}

export type Emit = (kind: EventKind, a: number, b: number, c: number, d: number) => void;

/**
 * CastleSim.shove(id, ix, iy, iz): an impulse on a piece already loose (false
 * if it is not). It lands with the flow work of the army pass; typed here so
 * battering compiles before it does. Drop this once CastleSim has it.
 */
type Shoves = CastleSim & { shove?(id: number, ix: number, iy: number, iz: number): boolean };

export class Army {
  /** Fields: each team's three route fields (doors: the enemy gate), then each team's breach field. */
  readonly flow: FlowFields;
  /** Short walks in and around each castle (masons, the garrison, defenders, crews at the wall). */
  readonly local: LocalFields;
  /** Each team's standing order. */
  readonly order: [Order, Order] = [Order.Advance, Order.Advance];
  /** Blows each gate leaf has taken (stone id -> blows). */
  readonly gateHits = new Map<number, number>();
  /** Per castle: its enemy's fighting minions inside its courtyard, and its own, as of this tick (minions on the walls do not count). */
  readonly attackers: [number, number] = [0, 0];
  readonly defenders: [number, number] = [0, 0];
  /** Waves sent so far (both teams, with the garrisons' and the masons' own). */
  waves = 0;
  /** Set by the world when it has ladders (matches). */
  ladders: Ladders | null = null;
  private rng: Rng;
  /** Where each team's waves hold, per route: the marker's z and x. */
  private holdZ: number[][];
  private holdX: number[][];
  /** Each team's hold line: walks along its own bank from one marker to another (a wave sent down another road while it holds). */
  private holdLine: LocalFields;
  private bnx: number;
  private bnz: number;
  private head: Int32Array;
  private next = new Int32Array(256);
  /** Each minion's cost to its route's goal this tick, and each wave's sum and count of those (for cohesion). */
  private cost = new Float64Array(256);
  private waveSum = new Float64Array(64);
  private waveN = new Int32Array(64);
  private dir: [number, number] = [0, 0];
  private near: number[] = [];
  /** Each route's bridge (ROUTE_NAMES order), whether it can still be crossed, and the nav topology that was judged at. */
  private bridges: BridgeSite[];
  readonly bridgeOpen = [true, true, true];
  private bridgeTopo = -1;
  /** Per wave: its team and its route now (it changes when its bridge goes down before it crosses), and whether it is a crew that never marches (a garrison, the masons). */
  private waveTeam = new Int8Array(64);
  private waveRoute = new Int8Array(64);
  private waveCrew = new Uint8Array(64);
  private waveX = new Float64Array(64);
  private waveZ = new Float64Array(64);
  /** Each team's garrison wave (-1 until it has one). */
  private garrisonWave: [number, number] = [-1, -1];
  /** Per castle, the z of its front wall: the middle of its gate leaves. */
  private frontZ: [number, number] = [0, 0];
  /** M3: sappers and musketeers are steered here first (the sandbox sets it in a match). */
  specialists: Specialists | null = null;
  /** 3.2: bridge gangs take two men of a wave sent down a road whose bridge is down (the sandbox sets it in a match). */
  gangs: Gangs | null = null;
  private steerOut: Steer = { mx: 0, mz: 0, speed: 0, face: NaN, action: 0 };

  constructor(
    private minions: Minions,
    private nav: NavGrid,
    private castle: CastleSim,
    private terrain: Terrain,
    seed: number,
    private emit: Emit,
  ) {
    this.rng = new Rng(seed);
    const w = routeWeights();
    const specs: FieldSpec[] = [];
    for (const team of [0, 1]) for (let r = 0; r < 3; r++) specs.push({ goal: COURTYARD[1 - team], weight: w[r], doors: 1 - team });
    for (const team of [0, 1]) specs.push({ goal: COURTYARD[1 - team], weight: null, doors: -1 });
    this.flow = new FlowFields(nav, castle, specs);
    this.flow.buildAll();
    this.local = new LocalFields(nav, castle.layout.castleZ);
    this.holdZ = [0, 1].map((team) => ROUTE_NAMES.map((r) => holdMarker(team as 0 | 1, r).z));
    this.holdX = [0, 1].map((team) => ROUTE_NAMES.map((r) => holdMarker(team as 0 | 1, r).x));
    this.holdLine = new LocalFields(nav, this.holdZ.map((z) => (z[0] + z[1] + z[2]) / 3), HOLD_LINE_X, HOLD_LINE_Z);
    this.bridges = ROUTE_NAMES.map((r) => BRIDGES.find((b) => b.name === r)!);
    for (const c of [0, 1]) {
      let sum = 0, n = 0;
      for (const s of castle.layout.stones) {
        if (s.part !== "gate" || s.castle !== c) continue;
        sum += s.z;
        n++;
      }
      // A layout with no gate: its front wall's face, 16 m out from the castle's middle towards the other castle.
      this.frontZ[c] = n ? sum / n : castle.layout.castleZ[c] + (c === 0 ? -16 : 16);
    }
    this.bnx = Math.ceil((NAV_GRID.nx * NAV_GRID.cell) / BUCKET);
    this.bnz = Math.ceil((NAV_GRID.nz * NAV_GRID.cell) / BUCKET);
    this.head = new Int32Array(this.bnx * this.bnz).fill(-1);
  }

  setOrder(team: number, order: Order) {
    this.order[team] = order;
  }

  /**
   * A team's route order: every marching wave of the team (not a crew) that
   * has not crossed its own route's bridge yet (its men's middle, as
   * reroute() judges it) takes `route`, all its men together, if that
   * route's bridge stands; so waves holding at a marker walk to the new one.
   * Gang men keep their bridge's road.
   */
  setRoute(team: number, route: number) {
    if (route < 0 || route > 2 || !this.nav.bridgeOpen(this.bridges[route])) return;
    const list = this.minions.list;
    for (let w = 0; w < this.waves; w++) {
      if (this.waveTeam[w] !== team || this.waveCrew[w] || this.waveRoute[w] === route) continue;
      let n = 0, z = 0;
      for (const m of list) {
        if (m.wave !== w || m.state !== MinionState.Upright || m.role === Role.Gang) continue;
        n++;
        z += m.z;
      }
      if (!n) continue;
      z /= n;
      const b = this.bridges[this.waveRoute[w]];
      if (team === 1 ? z > b.z : z < b.z) continue; // already across
      this.waveRoute[w] = route;
      for (const m of list) if (m.wave === w && m.role !== Role.Gang) m.route = route;
    }
  }

  /** A new wave slot for a team (a crew never marches: no route, no cohesion, no rerouting). */
  newWave(team: number, route: number, crew = false): number {
    const wave = this.waves++;
    if (wave >= this.waveSum.length) {
      const size = this.waveSum.length * 2;
      this.waveSum = grow64(this.waveSum, size);
      this.waveX = grow64(this.waveX, size);
      this.waveZ = grow64(this.waveZ, size);
      const n = new Int32Array(size);
      n.set(this.waveN);
      this.waveN = n;
      for (const k of ["waveTeam", "waveRoute"] as const) {
        const a = new Int8Array(size);
        a.set(this[k]);
        this[k] = a;
      }
      const c = new Uint8Array(size);
      c.set(this.waveCrew);
      this.waveCrew = c;
    }
    this.waveTeam[wave] = team;
    this.waveRoute[wave] = route;
    this.waveCrew[wave] = crew ? 1 : 0;
    return wave;
  }

  /** A minion of a wave, standing at (x, z), facing yaw. */
  spawnAt(team: number, wave: number, unit: Unit, x: number, z: number, yaw: number): Minion {
    const def = UNIT_DEFS[unit];
    const m = this.minions.spawn(team, x, z, x, z, x, z, false);
    m.wave = wave;
    m.route = this.waveRoute[wave];
    m.unit = unit;
    m.speed = def.speed * (1 + this.rng.range(-def.speedJitter, def.speedJitter));
    m.yaw = yaw;
    const c = navCell(x, z);
    m.y = c >= 0 ? this.surface(x, z, c) : this.terrain.heightAt(x, z);
    m.action = Action.Stand;
    this.minions.place(m);
    return m;
  }

  /**
   * A wave forms up in ranks in front of its team's gate (or at `at`, for
   * tests and scripts; or inside its courtyard when it is under attack) and
   * marches down a route (index into ROUTE_NAMES). With a ladder, its last
   * two men carry it, one behind the other at the back. Returns the number
   * spawned.
   */
  spawnWave(team: 0 | 1, route: number, count: number, at?: { x: number; z: number }, opts: WaveOptions = {}): number {
    const W = WAVES;
    const inside = opts.inside === true && !at;
    const ladder = opts.ladder === true && !inside && count >= 3 && this.ladders !== null;
    const M = at ? { x: at.x, z: at.z, dir: MUSTER[team].dir } : MUSTER[team];
    const wave = this.newWave(team, route);
    this.bridgeTopo = -1; // judge the new wave's bridge on the next step
    const face = M.dir > 0 ? 0 : DPI;
    const pikes = ladder ? count - 2 : count;
    for (let k = 0; k < pikes; k++) {
      let x: number, z: number;
      if (inside) {
        const G = GARRISON.muster;
        const rank = Math.floor(k / G.file), file = k % G.file;
        x = G.x + file * G.spacing + this.rng.range(-0.1, 0.1);
        z = mirrorZ(team, G.z - rank * G.spacing) + this.rng.range(-0.1, 0.1);
      } else {
        const rank = Math.floor(k / W.file), file = k % W.file;
        const across = (file - (W.file - 1) / 2) * W.spacing;
        x = M.x + across * M.dir + this.rng.range(-0.15, 0.15);
        z = M.z - M.dir * rank * W.spacing + this.rng.range(-0.15, 0.15);
      }
      const m = this.spawnAt(team, wave, Unit.Pikeman, x, z, face);
      if (inside) {
        m.role = Role.Defend;
        m.home = team;
      }
    }
    if (ladder) {
      // The crew beside the files (the wall is close behind the ranks), the back man a ladder's carry behind the front man.
      const side = M.x + 3.6 * M.dir;
      const a = this.spawnAt(team, wave, Unit.Ladder, side, M.z + M.dir * 3.0, face);
      const b = this.spawnAt(team, wave, Unit.Ladder, side, M.z + M.dir * (3.0 - 3.6), face);
      this.ladders!.makeCrew(team, a, b);
    }
    return count;
  }

  /**
   * M3: a wave of mixed units (content's Unit numbers, rank by rank from the
   * front, WAVES.file abreast) forms up at its muster point, offset along the
   * wall by `offset` metres (barracks side by side), and marches down a route.
   * M4's options carry over: with a ladder its crew of two comes out of the
   * pikemen (each other kind keeps its place, or takes the hindmost pikeman's
   * if the crew has it); mustered inside a courtyard under attack, it forms
   * up where the garrison's muster is (no offset). Returns the number spawned.
   */
  spawnMix(team: 0 | 1, route: number, units: number[], offset = 0, at?: { x: number; z: number }, opts: WaveOptions = {}): number {
    const first = this.minions.list.length;
    const inside = opts.inside === true && !at;
    const base = at ?? MUSTER[team];
    const n = inside ? this.spawnWave(team, route, units.length, undefined, opts) : this.spawnWave(team, route, units.length, { x: base.x + offset, z: base.z }, opts);
    const pikes: Minion[] = [];
    for (let k = 0; k < n; k++) {
      const m = this.minions.list[first + k];
      if (m && m.unit === Unit.Pikeman) pikes.push(m);
    }
    const used = new Uint8Array(pikes.length);
    let back = pikes.length - 1;
    for (let k = 0; k < units.length; k++) {
      const kind = units[k] ?? 0;
      if (kind === 0) continue;
      let i = k < pikes.length && !used[k] ? k : -1;
      if (i < 0) {
        while (back >= 0 && used[back]) back--;
        i = back;
      }
      if (i < 0) break;
      used[i] = 1;
      const m = pikes[i];
      const unit = UNIT_DEFS[kind] ?? UNITS.pikeman;
      m.unit = kind;
      // Re-draw the speed for its kind from its own pikeman draw, so the army's stream is not touched.
      m.speed = (m.speed / UNITS.pikeman.speed) * unit.speed;
    }
    // 3.2: a road with its bridge down gets a gang from this wave.
    if (!inside && this.gangs) this.gangs.form(team, route, this.minions.list.slice(first, first + n));
    return n;
  }

  /**
   * Who takes a ladder over a wall: anyone but masons, and (M3) but musketeers
   * (they stay out and shoot; their aux counts their aim) and sappers still on
   * their keg's errand (their task and aux are their own until then).
   */
  private climbs(m: Minion): boolean {
    if (m.role === Role.Gang || m.unit === Unit.Mason || m.unit === Unit.PowderBoy || m.unit === Unit.Musketeer) return false;
    return !(this.specialists !== null && this.specialists.busy(m));
  }

  /** Garrison pikemen for a team's courtyard: at their posts (the start of a match) or out of the barracks inside, walking to them. */
  spawnGarrison(team: 0 | 1, count: number, atPosts: boolean): number {
    if (this.garrisonWave[team] < 0) this.garrisonWave[team] = this.newWave(team, 1, true);
    const wave = this.garrisonWave[team];
    const taken = new Uint8Array(GARRISON.size);
    for (const m of this.minions.list) if (m.wave === wave && m.state === MinionState.Upright && m.post >= 0) taken[m.post] = 1;
    let n = 0;
    for (let k = 0; k < GARRISON.size && n < count; k++) {
      if (taken[k]) continue;
      const p = garrisonPost(team, k);
      const G = GARRISON.muster;
      const x = atPosts ? p.x : G.x + (n % G.file) * G.spacing;
      const z = atPosts ? p.z : mirrorZ(team, G.z - Math.floor(n / G.file) * G.spacing);
      const m = this.spawnAt(team, wave, Unit.Pikeman, x, z, team === 0 ? DPI : 0);
      m.role = Role.Garrison;
      m.home = team;
      m.post = k;
      n++;
    }
    return n;
  }

  /** Upright members of a team's garrison. */
  garrisonCount(team: number): number {
    const w = this.garrisonWave[team];
    if (w < 0) return 0;
    let n = 0;
    for (const m of this.minions.list) if (m.wave === w && m.state === MinionState.Upright) n++;
    return n;
  }

  /** Upright minions of a team (masons do not count). */
  standing(team: number): number {
    let n = 0;
    for (const m of this.minions.list) if (m.team === team && m.wave >= 0 && m.state === MinionState.Upright && !isWorker(m)) n++;
    return n;
  }

  /** Every army minion thinks and moves (before the physics step), then the flow fields get their share of work. */
  step(tick: number) {
    const list = this.minions.list;
    this.rebuildHash();
    if (this.cost.length < list.length) this.cost = grow64(this.cost, list.length);
    this.waveSum.fill(0, 0, this.waves);
    this.waveN.fill(0, 0, this.waves);
    this.waveX.fill(0, 0, this.waves);
    this.waveZ.fill(0, 0, this.waves);
    this.attackers[0] = this.attackers[1] = this.defenders[0] = this.defenders[1] = 0;
    const counted = new Int32Array(this.waves);
    for (const m of list) {
      if (m.state !== MinionState.Upright || m.wave < 0) continue;
      if (!isWorker(m) && !onWall(m)) {
        for (let c = 0; c < 2; c++) {
          if (!inCourtyard(c, m.x, m.z)) continue;
          if (m.team === c) this.defenders[c]++;
          else this.attackers[c]++;
        }
      }
      if (this.waveCrew[m.wave] || m.role === Role.Gang) continue; // a gang man is not on his wave's march
      counted[m.wave]++;
      this.waveX[m.wave] += m.x;
      this.waveZ[m.wave] += m.z;
      const c = this.flow.at(routeField(m.team, m.route), m.x, m.z);
      this.cost[m.id] = c;
      if (c < FLOW_INF) {
        this.waveSum[m.wave] += c;
        this.waveN[m.wave]++;
      }
    }
    if (this.nav.topo !== this.bridgeTopo) this.reroute(counted);
    for (const m of list) if (m.state === MinionState.Upright && m.wave >= 0) this.think(m, tick);
    this.flow.step(FLOW_BUDGET);
  }

  private think(m: Minion, tick: number) {
    if (isWorker(m)) return; // works.ts and carriers.ts
    if (this.ladders && this.ladders.controls(m)) return;
    if (this.gangs && this.gangs.controls(m)) return; // gangs.ts
    const unit = UNIT_DEFS[m.unit] ?? UNITS.pikeman;
    const nav = this.nav;
    const c = navCell(m.x, m.z);
    // The floor went from under it (a deck blown away, a crater): it falls.
    if (c < 0 || !navWalkable(nav.kind[c]) || m.y - this.surface(m.x, m.z, c) > DROP) {
      this.fall(m, tick);
      return;
    }
    if (this.clearKeg(m, tick)) return;
    let mx = 0, mz = 0, speed = 0;
    let face = NaN; // the yaw to turn to (NaN: wherever it walks)
    let action = Action.Walk;
    const home = m.role === Role.Garrison || m.role === Role.Defend;
    // M3: a sapper or a musketeer may have his own business this tick (specialists.ts).
    const sp = this.specialists !== null && this.specialists.steer(m, tick, this.steerOut);
    const t = sp ? null : home ? this.targetInside(m, unit, tick) : this.target(m, unit, tick);
    if (sp) {
      const s = this.steerOut;
      mx = s.mx;
      mz = s.mz;
      speed = s.speed;
      face = s.face;
      action = s.action;
    } else if (t) {
      const dx = t.x - m.x, dz = t.z - m.z;
      const d = dsqrt(dx * dx + dz * dz) + 1e-9;
      if (d <= unit.reach) {
        action = Action.Fight;
        face = yawOf(dx / d, dz / d);
        if (--m.cool <= 0) this.blow(m, t, dx / d, dz / d, unit, tick);
      } else {
        mx = dx / d;
        mz = dz / d;
        speed = m.speed * unit.charge;
      }
    } else if (m.role === Role.Garrison) {
      // Back to its post, then face the gate.
      const p = garrisonPost(m.home, m.post);
      if (this.local.steer(m.home, p.x, p.z, m.x, m.z, this.dir)) {
        mx = this.dir[0];
        mz = this.dir[1];
        speed = m.speed;
      } else {
        action = Action.Stand;
        face = m.home === 0 ? DPI : 0;
      }
    } else if (m.role === Role.Defend && this.attackers[m.home] > 0) {
      // After whoever is in the courtyard, by the courtyard's own ways.
      const e = this.nearestIntruder(m);
      if (e && this.local.steer(m.home, e.x, e.z, m.x, m.z, this.dir)) {
        mx = this.dir[0];
        mz = this.dir[1];
        speed = m.speed * unit.charge;
      } else action = Action.Stand;
    } else {
      if (m.role === Role.Defend) {
        // The courtyard is clear: the wave marches.
        m.role = Role.March;
        m.home = -1;
      }
      if (m.task === Climb.ToLadder && this.ladders) {
        const foot = this.ladders.foot(m.aux);
        if (!foot) m.task = Climb.None;
        else {
          const dx = foot.x - m.x, dz = foot.z - m.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < 1.2 * 1.2) {
            this.ladders.arrive(m);
            m.action = Action.Stand;
            this.minions.place(m);
            return;
          }
          const castle = foot.castle;
          if (this.local.covers(castle, m.x, m.z) && this.local.steer(castle, foot.x, foot.z, m.x, m.z, this.dir)) {
            mx = this.dir[0];
            mz = this.dir[1];
          } else {
            const d = dsqrt(d2);
            mx = dx / d;
            mz = dz / d;
          }
          speed = m.speed;
        }
      } else if (this.ladders && this.climbs(m) && (tick + m.id) % LADDER_LOOK === 0 && this.order[m.team] !== Order.Hold) {
        this.ladders.claim(m, this.flow.at(breachField(m.team), m.x, m.z) < FLOW_INF);
      }
      if (m.task !== Climb.ToLadder) {
        this.march(m, unit);
        return;
      }
    }
    this.move(m, mx, mz, speed, face, action);
  }

  /**
   * A marching man with nothing to fight goes by his team's order: on along
   * his march field, battering a gate that stands (or, if he cannot batter,
   * waiting MARCH.doorStandOff short of it), back onto his field when he
   * stands where it cannot reach the goal, or waiting.
   */
  private march(m: Minion, unit: UnitDef) {
    if (this.holdAside(m, this.dir)) {
      this.move(m, this.dir[0], this.dir[1], m.speed, NaN, Action.Walk);
      return;
    }
    let mx = 0, mz = 0, speed = 0;
    let face = NaN;
    let action = Action.Walk;
    const f = this.marchField(m);
    const home = inCourtyard(m.team, m.x, m.z);
    if (f >= 0 && !home && this.flow.at(f, m.x, m.z) >= FLOW_INF) {
      // Cut off from his field (a pocket of rubble, a heap the field has not caught up with): back to the nearest cell on it.
      if (this.backToField(m, f)) {
        mx = this.dir[0];
        mz = this.dir[1];
        speed = m.speed;
      } else action = Action.Stand;
    } else if (f >= 0 && this.flow.dir(f, m.x, m.z, this.dir)) {
      const ux = this.dir[0], uz = this.dir[1];
      const own = f < 6 && fieldTeam(f) === m.team;
      const door = own ? this.flow.doorAhead(f, m.x, m.z, ux, uz, DOOR_REACH) : -1;
      if (door >= 0 && unit.batters !== false) {
        face = yawOf(ux, uz);
        action = Action.Batter;
        if (--m.cool <= 0) this.batter(m, door, ux, uz, unit);
      } else if (own && unit.batters === false && (door >= 0 || this.doorWithin(f, m.x, m.z, ux, uz, MARCH.doorStandOff))) {
        // M3: sappers and musketeers leave a gate to the pikes: they wait short of it, out of the doorway, facing it.
        face = yawOf(ux, uz);
        action = Action.Stand;
      } else {
        mx = ux;
        mz = uz;
        speed = m.speed * (f === routeField(m.team, m.route) ? this.pace(m) : 1);
      }
    } else if (home) {
      // Shut in its own courtyard (the gate stands): it waits behind the garrison until there is a way out.
      const p = garrisonPost(m.team, m.id % GARRISON.size);
      const rz = mirrorZ(m.team, mirrorZ(m.team, p.z) + 1.8);
      if (this.local.steer(m.team, p.x, rz, m.x, m.z, this.dir)) {
        mx = this.dir[0];
        mz = this.dir[1];
        speed = m.speed;
      } else action = Action.Stand;
    } else action = Action.Stand;
    this.move(m, mx, mz, speed, face, action, speed > 0 ? f : -1);
  }

  /** Is a door that field f leads into within `reach` m ahead of (x, z) along (ux, uz)? Looked for every half metre from DOOR_REACH out. */
  private doorWithin(f: number, x: number, z: number, ux: number, uz: number, reach: number): boolean {
    for (let r = DOOR_REACH; r <= reach; r += 0.5) if (this.flow.doorAhead(f, x, z, ux, uz, r) >= 0) return true;
    return false;
  }

  /**
   * A man on a cell his march field cannot reach the goal from: the way (into
   * this.dir) to the middle of the nearest cell within MARCH.cutOffSearch m
   * that it can, and that he can walk to in a straight line (cells scanned in
   * a fixed order, the first of the nearest wins). False when there is none.
   */
  private backToField(m: Minion, f: number): boolean {
    const G = NAV_GRID;
    const c = navCell(m.x, m.z);
    if (c < 0) return false;
    const D = this.flow.dist[f];
    const ci = c % G.nx, cj = (c - ci) / G.nx;
    const k = Math.floor(MARCH.cutOffSearch / G.cell);
    const r2 = (MARCH.cutOffSearch / G.cell) * (MARCH.cutOffSearch / G.cell);
    let best = -1, bd = Infinity;
    for (let dj = -k; dj <= k; dj++) {
      for (let di = -k; di <= k; di++) {
        const d2 = di * di + dj * dj;
        if (d2 > r2 || d2 >= bd) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) continue;
        const n = j * G.nx + i;
        if (D[n] >= FLOW_INF) continue;
        if (!this.walkLine(m.x, m.z, G.x0 + (i + 0.5) * G.cell, G.z0 + (j + 0.5) * G.cell)) continue;
        bd = d2;
        best = n;
      }
    }
    if (best < 0) return false;
    const bi = best % G.nx, bj = (best - bi) / G.nx;
    const dx = G.x0 + (bi + 0.5) * G.cell - m.x, dz = G.z0 + (bj + 0.5) * G.cell - m.z;
    const d = dsqrt(dx * dx + dz * dz);
    if (d < 1e-6) return false;
    this.dir[0] = dx / d;
    this.dir[1] = dz / d;
    return true;
  }

  /**
   * A set keg whose fuse still burns, within MARCH.kegClear m: any upright
   * soldier (not a sapper still on his keg's errand) walks straight away from
   * it at his full speed, whatever his order or his fight. True if he did.
   */
  private clearKeg(m: Minion, tick: number): boolean {
    const sp = this.specialists;
    if (!sp || !sp.kegs.length || sp.busy(m) || climbing(m) || m.role === Role.Gang) return false;
    const r2 = MARCH.kegClear * MARCH.kegClear;
    let best = -1, bd = r2;
    for (let k = 0; k < sp.kegs.length; k++) {
      const g = sp.kegs[k];
      if (g.at <= tick) continue;
      const d2 = (m.x - g.x) * (m.x - g.x) + (m.z - g.z) * (m.z - g.z);
      if (d2 < bd) {
        bd = d2;
        best = k;
      }
    }
    if (best < 0) return false;
    const g = sp.kegs[best];
    let dx = m.x - g.x, dz = m.z - g.z;
    const d = dsqrt(bd);
    if (d > 1e-6) {
      dx /= d;
      dz /= d;
    } else {
      // On top of it: straight out from the wall it stands against (castle 0's field side is -z, castle 1's +z).
      dx = 0;
      dz = g.z > MID_Z ? -1 : 1;
    }
    this.move(m, dx, dz, m.speed, NaN, Action.Walk);
    return true;
  }

  /**
   * One tick of walking for any upright minion: keep apart from everyone
   * close by, slide along whatever it cannot step onto, turn to face where it
   * goes (or `face`), and keep its feet on the floor. Masons and ladder crews
   * walk with it too. A marching man passes his march field: refused on both
   * axes, he steps instead towards the neighbouring cell he can step to that
   * is cheapest on it.
   */
  move(m: Minion, mx: number, mz: number, speed: number, face: number, action: Action, field = -1) {
    const c = navCell(m.x, m.z);
    let sx = 0, sz = 0;
    const bi = this.bucketI(m.x), bj = this.bucketJ(m.z);
    for (let j = bj - 1; j <= bj + 1; j++) {
      if (j < 0 || j >= this.bnz) continue;
      for (let i = bi - 1; i <= bi + 1; i++) {
        if (i < 0 || i >= this.bnx) continue;
        for (let k = this.head[j * this.bnx + i]; k >= 0; k = this.next[k]) {
          if (k === m.id) continue;
          const n = this.minions.list[k];
          if (n.state !== MinionState.Upright) continue;
          const dx = m.x - n.x, dz = m.z - n.z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= SEP * SEP) continue;
          if (d2 < 1e-8) {
            sx += m.id < n.id ? 0.5 : -0.5;
            continue;
          }
          const d = dsqrt(d2);
          const q = (SEP - d) / SEP;
          sx += (dx / d) * q;
          sz += (dz / d) * q;
        }
      }
    }
    const push = speed > 0 ? SEP_PUSH : SEP_PUSH * 0.5;
    let vx = mx * speed + sx * push, vz = mz * speed + sz * push;
    const cap = (speed > 0.6 ? speed : 0.6) * 1.3;
    const v2 = vx * vx + vz * vz;
    if (v2 > cap * cap) {
      const k = cap / dsqrt(v2);
      vx *= k;
      vz *= k;
    }
    // Move, sliding along whatever it cannot step onto.
    const x0 = m.x, z0 = m.z;
    const nx = x0 + vx / 60, nz = z0 + vz / 60;
    if (c >= 0) {
      if (this.canStep(c, nx, nz)) {
        m.x = nx;
        m.z = nz;
      } else if (this.canStep(c, nx, z0)) m.x = nx;
      else if (this.canStep(c, x0, nz)) m.z = nz;
      else if (field >= 0) this.sidestep(m, c, field, speed / 60);
    }
    const dx = m.x - x0, dz = m.z - z0;
    m.vx = dx * 60;
    m.vz = dz * 60;
    const moved = dsqrt(dx * dx + dz * dz);
    m.phase = (m.phase + moved / STRIDE) % 1;
    if (action === Action.Walk && moved < 0.002) action = Action.Stand;
    // Face where it is going, or what it fights.
    if (face !== face && moved > 0.004) face = yawOf(dx / moved, dz / moved);
    if (face === face) this.turn(m, face);
    // Feet on the floor: ease over steps up onto a deck or a heap.
    const nc = navCell(m.x, m.z);
    const want = this.surface(m.x, m.z, nc);
    const dy = want - m.y;
    m.y = dy > CLIMB ? m.y + CLIMB : dy < -CLIMB ? m.y - CLIMB : want;
    m.action = action;
    if (m.act < 600) m.act++;
    this.minions.place(m);
  }

  /**
   * A marching man boxed in (his step refused on both axes) steps `len` m
   * towards the middle of the neighbouring cell (the eight in a fixed order)
   * that his cell can step to, the step itself allowed, cheapest on field f
   * and not cut off from its goal. He stays put when there is none.
   */
  private sidestep(m: Minion, c: number, f: number, len: number) {
    const G = NAV_GRID;
    const D = this.flow.dist[f];
    const ci = c % G.nx, cj = (c - ci) / G.nx;
    let bx = 0, bz = 0, bc = FLOW_INF;
    for (let k = 0; k < 8; k++) {
      const i = ci + SIDE_DI[k], j = cj + SIDE_DJ[k];
      if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) continue;
      const cost = D[j * G.nx + i];
      if (cost >= bc) continue;
      const tx = G.x0 + (i + 0.5) * G.cell, tz = G.z0 + (j + 0.5) * G.cell;
      if (!this.canStep(c, tx, tz)) continue;
      const dx = tx - m.x, dz = tz - m.z;
      const d = dsqrt(dx * dx + dz * dz);
      if (d < 1e-6) continue;
      const s = len < d ? len / d : 1;
      const px = m.x + dx * s, pz = m.z + dz * s;
      if (!this.canStep(c, px, pz)) continue;
      bc = cost;
      bx = px;
      bz = pz;
    }
    if (bc >= FLOW_INF) return;
    m.x = bx;
    m.z = bz;
  }

  /** The road's name (ROUTE_NAMES order). */
  routeName(route: number): string {
    return ROUTE_NAMES[route];
  }

  /** Is the floor still under this minion (else he falls: think handles it)? */
  standsFirm(m: Minion): boolean {
    const c = navCell(m.x, m.z);
    return c >= 0 && navWalkable(this.nav.kind[c]) && m.y - this.surface(m.x, m.z, c) <= DROP;
  }

  /**
   * 3.3: where a figure whose cell is no longer walkable (a fallen post or
   * beam across it) steps to: null while its cell is walkable; else the middle
   * of the nearest walkable cell within `r` m (rings of cells outwards, each in
   * a fixed order), or null when there is none.
   */
  stepOff(x: number, z: number, r: number): { x: number; z: number } | null {
    const c = navCell(x, z);
    if (c < 0 || navWalkable(this.nav.kind[c])) return null;
    const G = NAV_GRID;
    const ci = c % G.nx, cj = (c - ci) / G.nx;
    const rings = Math.ceil(r / G.cell);
    for (let k = 1; k <= rings; k++) {
      let best = -1, bd = Infinity;
      for (let dj = -k; dj <= k; dj++) {
        for (let di = -k; di <= k; di++) {
          if (di !== -k && di !== k && dj !== -k && dj !== k) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) continue;
          const n = j * G.nx + i;
          if (!navWalkable(this.nav.kind[n])) continue;
          const d = di * di + dj * dj;
          if (d < bd) {
            bd = d;
            best = n;
          }
        }
      }
      if (best >= 0) {
        const bi = best % G.nx, bj = (best - bi) / G.nx;
        return { x: G.x0 + (bi + 0.5) * G.cell, z: G.z0 + (bj + 0.5) * G.cell };
      }
    }
    return null;
  }

  /** Turn towards a yaw at the turning rate. */
  turn(m: Minion, face: number) {
    let d = face - m.yaw;
    while (d > DPI) d -= TWO_PI;
    while (d < -DPI) d += TWO_PI;
    m.yaw += d > TURN ? TURN : d < -TURN ? -TURN : d;
    if (m.yaw > DPI) m.yaw -= TWO_PI;
    else if (m.yaw < -DPI) m.yaw += TWO_PI;
  }

  /**
   * When the nav grid's shape changes: which bridges still stand, and any
   * wave whose bridge is down before it has crossed takes the nearest one
   * that stands, all together (on a tie, its own left).
   */
  private reroute(counted: Int32Array) {
    this.bridgeTopo = this.nav.topo;
    for (let r = 0; r < 3; r++) this.bridgeOpen[r] = this.nav.bridgeOpen(this.bridges[r]);
    for (let w = 0; w < this.waves; w++) {
      const n = counted[w];
      const r = this.waveRoute[w];
      if (!n || this.waveCrew[w] || this.bridgeOpen[r]) continue;
      const team = this.waveTeam[w];
      const x = this.waveX[w] / n, z = this.waveZ[w] / n;
      const b = this.bridges[r];
      if (team === 1 ? z > b.z : z < b.z) continue; // already across
      let best = -1, bestD = Infinity;
      for (let k = 0; k < 3; k++) {
        if (!this.bridgeOpen[k]) continue;
        const dx = this.bridges[k].x - x, dz = this.bridges[k].z - z;
        // A team's left is +x for team 1 and -x for team 0: on a tie the left one wins.
        const d = dsqrt(dx * dx + dz * dz) - (team === 1 ? this.bridges[k].x : -this.bridges[k].x) * 1e-6;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      if (best < 0) continue;
      this.waveRoute[w] = best;
      for (const m of this.minions.list) if (m.wave === w) m.route = best;
    }
  }

  /** The field a minion marches on by its team's order, or -1 to stand where it is (on the Hold line). */
  private marchField(m: Minion): number {
    const team = m.team, r = m.route;
    const route = routeField(team, r);
    const order = this.order[team];
    if (order === Order.Push) {
      // On his road until the enemy wall is near; then through a breach, if one reaches the courtyard from where he stands.
      if (this.toFront(m) > MARCH.pushNear) return route;
      const b = breachField(team);
      return this.flow.at(b, m.x, m.z) < FLOW_INF ? b : route;
    }
    if (order === Order.Hold) {
      const hz = this.holdZ[team][r];
      const past = team === 1 ? m.z - hz : hz - m.z;
      if (past > 1.5) return routeField(1 - team, r); // back the way it came
      if (past > -0.5) return -1;
    }
    return route;
  }

  /**
   * On Hold, a man well along the bank from his route's marker (his wave was
   * sent down another road, or its bridge went down, while it held there):
   * the way along his own bank to his road a little behind that marker, into
   * `out`; from there he comes up the road to the line. False when he is near
   * the marker along the bank or off the hold line's box (every road runs
   * within 4 m of its marker inside it): his march field and the line do then.
   */
  private holdAside(m: Minion, out: [number, number]): boolean {
    const team = m.team, r = m.route;
    if (this.order[team] !== Order.Hold || r < 0 || r > 2) return false;
    const hx = this.holdX[team][r], hz = this.holdZ[team][r];
    const dx = m.x - hx;
    if (dx <= MARCH.holdAlong && dx >= -MARCH.holdAlong) return false;
    const gz = team === 1 ? hz - MARCH.holdRejoin : hz + MARCH.holdRejoin;
    return this.holdLine.covers(team, m.x, m.z) && this.holdLine.steer(team, hx, gz, m.x, m.z, out);
  }

  /** How far (m, along z) a minion stands out from the front wall of the castle his team marches on (less than 0 inside it). */
  private toFront(m: Minion): number {
    return m.team === 1 ? this.frontZ[0] - m.z : m.z - this.frontZ[1];
  }

  /** The way a minion would march now by its order (no doors, no fighting): for a ladder crew. False where there is none. */
  marchDir(m: Minion, out: [number, number]): boolean {
    if (this.holdAside(m, out)) return true;
    const f = this.marchField(m);
    return f >= 0 && this.flow.dir(f, m.x, m.z, out);
  }

  /** The nav cell under a point. */
  cellAt(x: number, z: number): number {
    return navCell(x, z);
  }

  /** Marching speed factor that keeps a wave together: those ahead of its middle slow down, those behind catch up. */
  private pace(m: Minion): number {
    const n = this.waveN[m.wave];
    const c = this.cost[m.id];
    if (n < 2 || c >= FLOW_INF) return 1;
    const ahead = (this.waveSum[m.wave] / n - c) / COST_PER_M;
    const k = ahead * PACE_PER_M;
    return 1 - (k > PACE_SLOW ? PACE_SLOW : k < -PACE_FAST ? -PACE_FAST : k);
  }

  /** The enemy a minion fights or closes on: keeps its target while it stands and is near, else looks for the nearest it can walk to. */
  private target(m: Minion, unit: UnitDef, tick: number): Minion | null {
    const list = this.minions.list;
    let t = m.target >= 0 ? list[m.target] : null;
    if (t) {
      const dx = t.x - m.x, dz = t.z - m.z;
      const far = unit.sight * 1.4;
      if (t.state !== MinionState.Upright || dx * dx + dz * dz > far * far || climbing(t)) {
        t = null;
        m.target = -1;
      }
    }
    if (!t && unit.sight > 0 && (tick + m.id) % LOOK_EVERY === 0) {
      t = this.nearestEnemy(m, unit.sight, -1);
      if (t) {
        m.target = t.id;
        m.cool = unit.readyMin + Math.floor(this.rng.next() * (unit.readyMax - unit.readyMin + 1));
      }
    }
    return t;
  }

  /** As target(), for the garrison and defenders: only enemies inside their own courtyard. */
  private targetInside(m: Minion, unit: UnitDef, tick: number): Minion | null {
    const list = this.minions.list;
    let t = m.target >= 0 ? list[m.target] : null;
    if (t && (t.state !== MinionState.Upright || !inCourtyard(m.home, t.x, t.z) || climbing(t))) {
      t = null;
      m.target = -1;
    }
    if (!t && (tick + m.id) % LOOK_EVERY === 0 && this.attackers[m.home] > 0) {
      t = this.nearestEnemy(m, GARRISON.sight, m.home);
      if (t) {
        m.target = t.id;
        m.cool = unit.readyMin + Math.floor(this.rng.next() * (unit.readyMax - unit.readyMin + 1));
      }
    }
    return t;
  }

  /** The nearest enemy fighting man inside a defender's courtyard (any distance), or null. */
  private nearestIntruder(m: Minion): Minion | null {
    let best: Minion | null = null, bd = Infinity;
    for (const n of this.minions.list) {
      if (n.team === m.team || n.state !== MinionState.Upright || n.wave < 0 || isWorker(n) || climbing(n)) continue;
      if (!inCourtyard(m.home, n.x, n.z)) continue;
      const d = (n.x - m.x) * (n.x - m.x) + (n.z - m.z) * (n.z - m.z);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** The nearest upright enemy within `sight` that it could walk straight to (up to three tries, nearest first); inside courtyard `inside` only if that is a castle. */
  private nearestEnemy(m: Minion, sight: number, inside: number): Minion | null {
    const list = this.minions.list;
    const near = this.near;
    near.length = 0;
    const r = Math.ceil(sight / BUCKET);
    const bi = this.bucketI(m.x), bj = this.bucketJ(m.z);
    const s2 = sight * sight;
    for (let j = bj - r; j <= bj + r; j++) {
      if (j < 0 || j >= this.bnz) continue;
      for (let i = bi - r; i <= bi + r; i++) {
        if (i < 0 || i >= this.bnx) continue;
        for (let k = this.head[j * this.bnx + i]; k >= 0; k = this.next[k]) {
          const n = list[k];
          if (n.team === m.team || n.state !== MinionState.Upright || n.role === Role.Carrier) continue;
          if (inside >= 0 && !inCourtyard(inside, n.x, n.z)) continue;
          const dx = n.x - m.x, dz = n.z - m.z;
          if (dx * dx + dz * dz <= s2) near.push(k);
        }
      }
    }
    if (!near.length) return null;
    const d2 = (k: number) => (list[k].x - m.x) * (list[k].x - m.x) + (list[k].z - m.z) * (list[k].z - m.z);
    near.sort((a, b) => d2(a) - d2(b) || a - b);
    for (let k = 0; k < near.length && k < 3; k++) {
      const n = list[near[k]];
      if (this.walkLine(m.x, m.z, n.x, n.z)) return n;
    }
    return null;
  }

  /** Can you walk in a straight line from a to b on the nav grid (half-metre samples)? */
  walkLine(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax, dz = bz - az;
    const len = dsqrt(dx * dx + dz * dz);
    const steps = Math.ceil(len / 0.5);
    let prev = navCell(ax, az);
    for (let s = 1; s <= steps; s++) {
      const c = navCell(ax + (dx * s) / steps, az + (dz * s) / steps);
      if (c === prev) continue;
      if (c < 0 || !this.nav.passable(prev, c)) return false;
      prev = c;
    }
    return true;
  }

  /** A blow at an enemy in reach: it may knock it down. */
  private blow(m: Minion, t: Minion, ux: number, uz: number, unit: UnitDef, tick: number) {
    m.act = 0;
    m.cool = unit.blowMin + Math.floor(this.rng.next() * (unit.blowMax - unit.blowMin + 1));
    if (this.rng.next() >= unit.hit) return;
    this.minions.knock({ minion: t.id, vx: ux * unit.knock, vy: 1.4, vz: uz * unit.knock, px: t.x - ux * 0.25, py: t.y + 1.25, pz: t.z - uz * 0.25, extra: 0.8, cause: Cause.Blow }, tick);
    this.emit(EventKind.Blood, t.x, t.y + 1.25, t.z, 0.45);
    m.target = -1;
  }

  /** A blow on a gate leaf; enough of them and it comes loose, pushed into the courtyard. */
  private batter(m: Minion, leaf: number, ux: number, uz: number, unit: UnitDef) {
    m.act = 0;
    m.cool = unit.blowMin + Math.floor(this.rng.next() * (unit.blowMax - unit.blowMin + 1));
    const hits = (this.gateHits.get(leaf) ?? 0) + 1;
    this.gateHits.set(leaf, hits);
    this.emit(EventKind.Impact, m.x + ux * 1.6, m.y + 1.2, m.z + uz * 1.6, 0.12);
    // A leaf already loose but still in its place takes the same push as a shove, or men would batter it for ever.
    if (hits >= GATE_BLOWS && !this.castle.knockLoose(leaf, ux * 2.2, 0.3, uz * 2.2)) (this.castle as Shoves).shove?.(leaf, ux * 2.2, 0.3, uz * 2.2);
  }

  /** Its floor is gone: it falls, keeping its own speed. */
  fall(m: Minion, tick: number) {
    this.minions.knock({ minion: m.id, vx: m.vx, vy: 0, vz: m.vz, px: m.x, py: m.y + 1, pz: m.z, extra: 0, cause: Cause.Fall }, tick);
  }

  /** Height of the floor at a point: the ground's own shape on open ground, the cell's floor on a deck, a heap or a body. */
  surface(x: number, z: number, c: number): number {
    if (c < 0) return this.terrain.heightAt(x, z);
    const k = this.nav.kind[c];
    return k === NavKind.Raised || k === NavKind.Rubble ? this.nav.floor[c] : this.terrain.heightAt(x, z);
  }

  /** May a minion standing in cell c step to (x, z)? Corners are passed only round an open side. */
  canStep(c: number, x: number, z: number): boolean {
    const d = navCell(x, z);
    if (d === c) return true;
    if (d < 0) return false;
    const nav = this.nav;
    const nx = NAV_GRID.nx;
    const ci = c % nx, di = d % nx;
    if (ci !== di && (c - ci) / nx !== (d - di) / nx) {
      // Diagonal: through one of the two cells beside both.
      const a = c - ci + di, b = d - di + ci;
      return (nav.passable(c, a) && nav.passable(a, d)) || (nav.passable(c, b) && nav.passable(b, d));
    }
    return nav.passable(c, d);
  }

  /** The nearest upright enemy minion (any kind) within r of a point, or null: for masons on the lookout. */
  enemyNear(team: number, x: number, z: number, r: number): Minion | null {
    const list = this.minions.list;
    const rb = Math.ceil(r / BUCKET);
    const bi = this.bucketI(x), bj = this.bucketJ(z);
    let best: Minion | null = null, bd = r * r;
    for (let j = bj - rb; j <= bj + rb; j++) {
      if (j < 0 || j >= this.bnz) continue;
      for (let i = bi - rb; i <= bi + rb; i++) {
        if (i < 0 || i >= this.bnx) continue;
        for (let k = this.head[j * this.bnx + i]; k >= 0; k = this.next[k]) {
          const n = list[k];
          if (n.team === team || n.state !== MinionState.Upright || isWorker(n)) continue;
          const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
          if (d < bd || (d === bd && best !== null && n.id < best.id)) {
            bd = d;
            best = n;
          }
        }
      }
    }
    return best;
  }

  private bucketI(x: number): number {
    return Math.floor((x - NAV_GRID.x0) / BUCKET);
  }
  private bucketJ(z: number): number {
    return Math.floor((z - NAV_GRID.z0) / BUCKET);
  }

  /** Upright minions by bucket, each bucket in id order (climbers on a ladder or a wall are left out: they are above everyone). */
  private rebuildHash() {
    const list = this.minions.list;
    if (this.next.length < list.length) this.next = new Int32Array(Math.max(list.length, this.next.length * 2));
    this.head.fill(-1);
    for (let k = list.length - 1; k >= 0; k--) {
      const m = list[k];
      if (m.state !== MinionState.Upright || climbing(m)) continue;
      const i = this.bucketI(m.x), j = this.bucketJ(m.z);
      if (i < 0 || j < 0 || i >= this.bnx || j >= this.bnz) continue;
      const b = j * this.bnx + i;
      this.next[k] = this.head[b];
      this.head[b] = k;
    }
  }

  /** The army's own state, for the world hash. */
  hashInto(out: number[]) {
    out.push(this.order[0], this.order[1], this.waves, this.flow.builds, this.bridgeTopo, this.garrisonWave[0], this.garrisonWave[1], this.local.builds, this.holdLine.builds);
    for (let w = 0; w < this.waves; w++) out.push(this.waveRoute[w], this.waveCrew[w]);
    const ids = [...this.gateHits.keys()].sort((a, b) => a - b);
    for (const id of ids) out.push(id, this.gateHits.get(id)!);
  }
}

/** On a ladder, the wall walk or the rope inside: above the courtyard and the field. */
export function climbing(m: Minion): boolean {
  return m.task >= Climb.Up && m.task <= Climb.Down;
}
function onWall(m: Minion): boolean {
  return climbing(m);
}

function grow64(a: Float64Array, min = 0): Float64Array<ArrayBuffer> {
  const n = new Float64Array(Math.max(min, a.length * 2));
  n.set(a);
  return n;
}

/** For tests and tools: the pikeman's numbers. */
export const PIKEMAN = UNITS.pikeman;
