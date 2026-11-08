// Waves (phase 2 M2): pikemen who march out of their gate along their
// route's flow field, keep their spacing in loose ranks, walk on the nav
// grid's floors (bridge decks, rubble, the fallen), stop at the midfield
// marker on Hold, push into a breach on Push, fight the enemy minions they
// meet (a blow knocks the loser down, with the odds in UNITS drawn from the
// army's seeded stream) and batter a closed gate until its leaves come loose.
// Upright minions are kinematic capsules placed here every tick, before the
// physics step; a knockdown makes ragdolls of them (minions.ts).
//
// Deterministic: minions think in id order and see each other's latest
// positions in that order, every decision uses + - * / and comparisons, and
// every random draw comes from the army's own stream, in that order.

import { BRIDGES, COURTYARD, GATE_BLOWS, MID_Z, MUSTER, ROUTE_HALF, ROUTE_NAMES, UNITS, WAVES, holdMarker, routeDistance, type BridgeSite, type UnitDef } from "@keepfall/content";
import { DPI, dsqrt, Rng } from "@keepfall/core";
import type { CastleSim } from "./castleSim";
import { EventKind } from "./frame";
import { FLOW_INF, FLOW_REGION, FlowFields, type FieldSpec } from "./flow";
import { MinionState, yawOf, type Minion, type Minions } from "./minions";
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

export class Army {
  /** Fields: each team's three route fields (doors: the enemy gate), then each team's breach field. */
  readonly flow: FlowFields;
  /** Each team's standing order. */
  readonly order: [Order, Order] = [Order.Advance, Order.Advance];
  /** Blows each gate leaf has taken (stone id -> blows). */
  readonly gateHits = new Map<number, number>();
  /** Waves sent so far (both teams). */
  waves = 0;
  private rng: Rng;
  /** Where each team's waves hold, per route: the marker's z. */
  private holdZ: number[][];
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
  /** Per wave: its team and its route now (it changes when its bridge goes down before it crosses). */
  private waveTeam = new Int8Array(64);
  private waveRoute = new Int8Array(64);
  private waveX = new Float64Array(64);
  private waveZ = new Float64Array(64);

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
    this.holdZ = [0, 1].map((team) => ROUTE_NAMES.map((r) => holdMarker(team as 0 | 1, r).z));
    this.bridges = ROUTE_NAMES.map((r) => BRIDGES.find((b) => b.name === r)!);
    this.bnx = Math.ceil((NAV_GRID.nx * NAV_GRID.cell) / BUCKET);
    this.bnz = Math.ceil((NAV_GRID.nz * NAV_GRID.cell) / BUCKET);
    this.head = new Int32Array(this.bnx * this.bnz).fill(-1);
  }

  setOrder(team: number, order: Order) {
    this.order[team] = order;
  }

  /**
   * A wave forms up in ranks in front of its team's gate (or at `at`, for
   * tests and scripts) and marches down a route (index into ROUTE_NAMES).
   * Returns the number spawned.
   */
  spawnWave(team: 0 | 1, route: number, count: number, at?: { x: number; z: number }): number {
    const W = WAVES, unit = UNITS.pikeman;
    const M = at ? { x: at.x, z: at.z, dir: MUSTER[team].dir } : MUSTER[team];
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
    }
    this.waveTeam[wave] = team;
    this.waveRoute[wave] = route;
    this.bridgeTopo = -1; // judge the new wave's bridge on the next step
    for (let k = 0; k < count; k++) {
      const rank = Math.floor(k / W.file), file = k % W.file;
      const across = (file - (W.file - 1) / 2) * W.spacing;
      const x = M.x + across * M.dir + this.rng.range(-0.15, 0.15);
      const z = M.z - M.dir * rank * W.spacing + this.rng.range(-0.15, 0.15);
      const m = this.minions.spawn(team, x, z, x, z, x, z, false);
      m.wave = wave;
      m.route = route;
      m.speed = unit.speed * (1 + this.rng.range(-unit.speedJitter, unit.speedJitter));
      m.yaw = M.dir > 0 ? 0 : DPI;
      const c = navCell(x, z);
      m.y = c >= 0 ? this.surface(x, z, c) : this.terrain.heightAt(x, z);
      m.action = Action.Stand;
      this.minions.place(m);
    }
    return count;
  }

  /** Upright minions of a team. */
  standing(team: number): number {
    let n = 0;
    for (const m of this.minions.list) if (m.team === team && m.wave >= 0 && m.state === MinionState.Upright) n++;
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
    const counted = new Int32Array(this.waves);
    for (const m of list) {
      if (m.state !== MinionState.Upright || m.wave < 0) continue;
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
    const unit = UNITS.pikeman;
    const nav = this.nav;
    const c = navCell(m.x, m.z);
    // The floor went from under it (a deck blown away, a crater): it falls.
    if (c < 0 || !navWalkable(nav.kind[c]) || m.y - this.surface(m.x, m.z, c) > DROP) {
      this.fall(m, tick);
      return;
    }
    let mx = 0, mz = 0, speed = 0;
    let face = NaN; // the yaw to turn to (NaN: wherever it walks)
    let action = Action.Walk;
    const t = this.target(m, unit, tick);
    if (t) {
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
    } else {
      const f = this.marchField(m);
      if (f >= 0 && this.flow.dir(f, m.x, m.z, this.dir)) {
        const ux = this.dir[0], uz = this.dir[1];
        const door = f < 6 && fieldTeam(f) === m.team ? this.flow.doorAhead(f, m.x, m.z, ux, uz, DOOR_REACH) : -1;
        if (door >= 0) {
          action = Action.Batter;
          face = yawOf(ux, uz);
          if (--m.cool <= 0) this.batter(m, door, ux, uz, unit);
        } else {
          mx = ux;
          mz = uz;
          speed = m.speed * (f === routeField(m.team, m.route) ? this.pace(m) : 1);
        }
      } else action = Action.Stand;
    }
    // Keep apart from everyone close by, friend or foe.
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
    if (this.canStep(c, nx, nz)) {
      m.x = nx;
      m.z = nz;
    } else if (this.canStep(c, nx, z0)) m.x = nx;
    else if (this.canStep(c, x0, nz)) m.z = nz;
    const dx = m.x - x0, dz = m.z - z0;
    m.vx = dx * 60;
    m.vz = dz * 60;
    const moved = dsqrt(dx * dx + dz * dz);
    m.phase = (m.phase + moved / STRIDE) % 1;
    if (action === Action.Walk && moved < 0.002) action = Action.Stand;
    // Face where it is going, or what it fights.
    if (face !== face && moved > 0.004) face = yawOf(dx / moved, dz / moved);
    if (face === face) {
      let d = face - m.yaw;
      while (d > DPI) d -= TWO_PI;
      while (d < -DPI) d += TWO_PI;
      m.yaw += d > TURN ? TURN : d < -TURN ? -TURN : d;
      if (m.yaw > DPI) m.yaw -= TWO_PI;
      else if (m.yaw < -DPI) m.yaw += TWO_PI;
    }
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
      if (!n || this.bridgeOpen[r]) continue;
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
      if (t.state !== MinionState.Upright || dx * dx + dz * dz > far * far) {
        t = null;
        m.target = -1;
      }
    }
    if (!t && (tick + m.id) % LOOK_EVERY === 0) {
      t = this.nearestEnemy(m, unit.sight);
      if (t) {
        m.target = t.id;
        m.cool = unit.readyMin + Math.floor(this.rng.next() * (unit.readyMax - unit.readyMin + 1));
      }
    }
    return t;
  }

  /** The nearest upright enemy within `sight` that it could walk straight to (up to three tries, nearest first). */
  private nearestEnemy(m: Minion, sight: number): Minion | null {
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
          if (n.team === m.team || n.state !== MinionState.Upright) continue;
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
  private walkLine(ax: number, az: number, bx: number, bz: number): boolean {
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

  /** A pike thrust at an enemy in reach: it may knock it down. */
  private blow(m: Minion, t: Minion, ux: number, uz: number, unit: UnitDef, tick: number) {
    m.act = 0;
    m.cool = unit.blowMin + Math.floor(this.rng.next() * (unit.blowMax - unit.blowMin + 1));
    if (this.rng.next() >= unit.hit) return;
    this.minions.knock({ minion: t.id, vx: ux * unit.knock, vy: 1.4, vz: uz * unit.knock, px: t.x - ux * 0.25, py: t.y + 1.25, pz: t.z - uz * 0.25, extra: 0.8 }, tick);
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
    if (hits >= GATE_BLOWS) this.castle.knockLoose(leaf, ux * 2.2, 0.3, uz * 2.2);
  }

  /** Its floor is gone: it falls, keeping its own speed. */
  private fall(m: Minion, tick: number) {
    this.minions.knock({ minion: m.id, vx: m.vx, vy: 0, vz: m.vz, px: m.x, py: m.y + 1, pz: m.z, extra: 0 }, tick);
  }

  /** Height of the floor at a point: the ground's own shape on open ground, the cell's floor on a deck, a heap or a body. */
  private surface(x: number, z: number, c: number): number {
    if (c < 0) return this.terrain.heightAt(x, z);
    const k = this.nav.kind[c];
    return k === NavKind.Raised || k === NavKind.Rubble ? this.nav.floor[c] : this.terrain.heightAt(x, z);
  }

  /** May a minion standing in cell c step to (x, z)? Corners are passed only round an open side. */
  private canStep(c: number, x: number, z: number): boolean {
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

  private bucketI(x: number): number {
    return Math.floor((x - NAV_GRID.x0) / BUCKET);
  }
  private bucketJ(z: number): number {
    return Math.floor((z - NAV_GRID.z0) / BUCKET);
  }

  /** Upright minions by bucket, each bucket in id order. */
  private rebuildHash() {
    const list = this.minions.list;
    if (this.next.length < list.length) this.next = new Int32Array(Math.max(list.length, this.next.length * 2));
    this.head.fill(-1);
    for (let k = list.length - 1; k >= 0; k--) {
      const m = list[k];
      if (m.state !== MinionState.Upright) continue;
      const i = this.bucketI(m.x), j = this.bucketJ(m.z);
      if (i < 0 || j < 0 || i >= this.bnx || j >= this.bnz) continue;
      const b = j * this.bnx + i;
      this.next[k] = this.head[b];
      this.head[b] = k;
    }
  }

  /** The army's own state, for the world hash. */
  hashInto(out: number[]) {
    out.push(this.order[0], this.order[1], this.waves, this.flow.builds, this.bridgeTopo);
    for (let w = 0; w < this.waves; w++) out.push(this.waveRoute[w]);
    const ids = [...this.gateHits.keys()].sort((a, b) => a - b);
    for (const id of ids) out.push(id, this.gateHits.get(id)!);
  }
}

function grow64(a: Float64Array, min = 0): Float64Array<ArrayBuffer> {
  const n = new Float64Array(Math.max(min, a.length * 2));
  n.set(a);
  return n;
}
