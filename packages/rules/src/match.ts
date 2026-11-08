// The match (phase 2): two castles and two teams in the valley, a match clock,
// gold, the plots and their buildings, the gun slots, the barracks' waves, the
// teams' orders, the weapons nobody is manning, and who has won. It wraps the
// world simulation and adds what the world does not know about: whose castle
// is whose, gold, timers and the end of the match. Everything that changes a
// match enters as an input tagged with its tick and its team, so a match
// replays from its inputs, and an AI is just another player sending inputs.
//
// Teams are castle indices: team 0 holds the castle at the origin (the enemy
// in a match against the AI), team 1 the one at z = -DIST (the player's).
//
// Phase 2 M3: gold comes from the keep, Powder Mills, bounties for the fallen,
// enemy masonry brought down and trick shots. Plots take buildings, raised
// course by course as physics pieces; a building works while most of it
// stands. Slots take guns bought for gold, the Foundry fits upgrades, and a
// gun falls when the masonry under it does. Each working barracks sends its
// own wave, with its route and mix, on the shared wave clock.

import {
  BRIDGES,
  BUILDING_ALIVE,
  BUILDINGS,
  DEFEND,
  DIST,
  emplacementWeapon,
  ENEMY_PLAN,
  ENEMY_ROUTES,
  MATCH,
  MATCH_EMPLACEMENTS,
  MATCH_SLOTS,
  MID_Z,
  MIXES,
  MIX_NAMES,
  MOUNT_DEFAULT,
  mountTakes,
  MUSTER,
  PLOTS,
  ROUTE_NAMES,
  slotEmplacement,
  START_BARRACKS,
  stoneBounds,
  TRICKS,
  UNIT_KINDS,
  UNIT_NEEDS,
  UNITS,
  UNMANNED,
  UPGRADE_COST,
  UPGRADE_KINDS,
  WAVES,
  WEAPON_COST,
  WEAPONS,
  type BuildingKind,
  type CastleLayout,
  type Emplacement,
  type MixName,
  type PlanStep,
  type PlotSet,
  type RouteName,
  type SlotDef,
  type UnitKind,
  type UnmannedDef,
  type UpgradeKind,
  type WeaponKind,
} from "@keepfall/content";
import { DPI, dcos, dsin, dsqrt, hashBytes, hashString, hex8, Rng } from "@keepfall/core";
import { Felled, MinionState, Order, SandboxSim, solveAim, Spin, stepAim, yawTowards, type Rapier, type SandboxInput } from "@keepfall/sim";

export const enum Team {
  Enemy = 0,
  Player = 1,
}

/** Bump whenever the same match inputs would play out differently because of the match rules (the sim has its own RULES_VERSION). */
export const MATCH_RULES_VERSION = 3;

/** A shot from one of a team's emplacements. */
export type FireInput = Extract<SandboxInput, { kind: "fire" }>;
export type MatchInput =
  | FireInput
  /** All of the team's waves, now and later (SPEC section 8). */
  | { kind: "order"; order: Order }
  /** The route every one of the team's barracks sends its next waves down (L). */
  | { kind: "route"; route: RouteName }
  /**
   * The emplacement the team is riding now (-1: none, in the overview); every
   * other one of its emplacements fires at minions on its own. `left` is the
   * aim of the one being left, so its barrel stays where the gunner put it.
   */
  | { kind: "man"; emplacement: number; left?: { emplacement: number; yaw: number; pitch: number } }
  /** Build on one of the team's plots (an empty one, or one whose building is down: the wreck is cleared first). */
  | { kind: "build"; plot: number; building: BuildingKind }
  /** Buy a gun for one of the team's empty slots (by emplacement id). */
  | { kind: "buy"; emplacement: number; weapon: WeaponKind }
  /** Fit a Foundry upgrade to one of the team's guns. */
  | { kind: "upgrade"; emplacement: number; upgrade: UpgradeKind }
  /** Set one barracks' route or mix. */
  | { kind: "barracks"; plot: number; route?: RouteName; mix?: MixName };

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
  /** The enemy castle follows its plan (default); tests and tools may turn it off. */
  plan?: boolean;
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

export const enum PlotState {
  Empty = 0,
  /** Going up, course by course. */
  Building = 1,
  Working = 2,
  /** Knocked down (or wrecked while going up): it does nothing until something is built there again. */
  Down = 3,
}

/** One plot of one team's courtyard. */
export interface Plot {
  kind: BuildingKind | null;
  state: PlotState;
  /** Tick the work began, and the tick the last course goes up. */
  started: number;
  done: number;
  /** The building's pieces in the order they go up, and how many are up so far. */
  order: Int32Array;
  due: Int32Array;
  raised: number;
  /** Pieces up and still standing. */
  standing: number;
  /** A barracks' route and mix. */
  route: RouteName;
  mix: MixName;
}

/** One gun slot: does it have a gun, and is that gun still standing (the masonry under it). */
export interface Slot {
  def: SlotDef;
  armed: boolean;
  /** Knocked out: the masonry under it came down, and the gun with it. */
  down: boolean;
  /** The pieces the gun stands on (none for the pit). */
  support: Int32Array;
}

/** Gold a team earned, with its reason and where it happened (for the HUD). */
export interface GoldEvent {
  team: Team;
  amount: number;
  why: string;
  x: number;
  y: number;
  z: number;
}

/** Something a player should hear about: a building done or knocked down, a gun knocked out. */
export type MatchNote =
  | { kind: "built"; team: Team; plot: number; building: BuildingKind }
  | { kind: "down"; team: Team; plot: number; building: BuildingKind }
  | { kind: "gunDown"; team: Team; emplacement: number; weapon: WeaponKind };

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
/** Slots per castle (the player's are emplacements 0 to 7, the enemy's 8 to 15). */
export const SLOTS_PER_TEAM = 8;
/** A gun is knocked out when fewer than this share of the pieces under it still stand. */
const GUN_ALIVE = 0.4;
/** A step of the enemy's plan it could not do yet is tried again this many ticks later. */
const PLAN_RETRY = 300;
/** Waves of a second and third barracks form up this much further out than the first's (m). */
const MUSTER_STEP = 3.4;

/** A plot's ground in world space (x0, x1, z0, z1) for a team's castle. */
export function plotRect(team: Team, plot: number): { x0: number; x1: number; z0: number; z1: number } {
  const p = PLOTS[plot];
  const z = team === Team.Player ? -DIST - p.z : p.z;
  return { x0: p.x - p.hw, x1: p.x + p.hw, z0: z - p.hd, z1: z + p.hd };
}

export class Match {
  readonly world: SandboxSim;
  readonly layout: CastleLayout;
  readonly emplacements: Emplacement[];
  readonly gold: [number, number] = [MATCH.startGold, MATCH.startGold];
  /** Shots each team fired itself, and shots its unmanned weapons fired. */
  readonly shots: [number, number] = [0, 0];
  readonly autoShots: [number, number] = [0, 0];
  /** Each team's default route (L sets it and every barracks'), and waves sent so far (one per barracks per wave tick). */
  readonly route: [RouteName, RouteName] = ["centre", "centre"];
  readonly waves: [number, number] = [0, 0];
  /** The emplacement each team rides (-1: none). */
  readonly manned: [number, number] = [-1, -1];
  /** Every emplacement's barrel (in emplacement order). */
  readonly guns: Gun[];
  /** Each team's plots (PLOTS order) and gun slots (its emplacements in order). */
  readonly plots: [Plot[], Plot[]];
  readonly slots: Slot[];
  /** Gold each team earned from each source (for the end screen): keep, mills, bounties, masonry, tricks, buildings. */
  readonly earned: [Record<string, number>, Record<string, number>] = [{}, {}];
  result: MatchResult | null = null;
  /** Gold events and notes since the page last took them. */
  goldLog: GoldEvent[] = [];
  notes: MatchNote[] = [];
  private inputs = new Map<number, Array<{ team: Team; input: MatchInput }>>();
  private owner: Team[];
  /** The unmanned weapons' aim errors, drawn in the order they lay on targets. */
  private rng: Rng;
  private barracks: boolean;
  /** Pieces of each castle brought down that have not paid yet (one gold for every MATCH.masonryPer). */
  private masonry: [number, number] = [0, 0];
  private downSeen = 0;
  /** Enemy knockdowns put down to each manned shot (for multi-kills). */
  private shotKills = new Map<number, number>();
  /** The enemy's plan: the next step and when it is tried. */
  private planStep = 0;
  private planAt = 0;
  private plan: boolean;
  /** The enemy's first barracks takes the routes in turn (until the AI). */
  private enemyTurn = 0;
  /** Each plot's pieces of each kind, by team (castle), plot and kind. */
  private sets = new Map<string, PlotSet>();

  constructor(R: Rapier, layout: CastleLayout, opts: MatchOptions) {
    this.layout = layout;
    // Each match has its own emplacements: guns are bought and upgraded during it.
    this.emplacements = (opts.emplacements ?? MATCH_EMPLACEMENTS).map((e) => ({ ...e }));
    this.world = new SandboxSim(R, layout, { seed: opts.seed, minions: 0, emplacements: this.emplacements, army: true });
    this.owner = this.emplacements.map(teamOf);
    this.guns = this.emplacements.map((e) => {
      const w = WEAPONS[e.weapon];
      const pitch = w.restPitch < w.minPitch ? w.minPitch : w.restPitch > w.maxPitch ? w.maxPitch : w.restPitch;
      return { yaw: e.baseYaw, pitch, target: -1, aimYaw: e.baseYaw, aimPitch: pitch, charge: 1, errX: 0, errZ: 0 };
    });
    this.rng = new Rng((hashString("unmanned") ^ opts.seed) >>> 0);
    this.barracks = opts.barracks !== false;
    this.plan = opts.plan !== false;
    for (const s of layout.plots) this.sets.set(`${s.castle}:${s.plot}:${s.kind}`, s);
    const plots = (): Plot[] => PLOTS.map(() => ({ kind: null, state: PlotState.Empty, started: 0, done: 0, order: new Int32Array(0), due: new Int32Array(0), raised: 0, standing: 0, route: "centre", mix: "pikemen" }));
    this.plots = [plots(), plots()];
    this.slots = this.emplacements.map((e, i) => {
      const def = MATCH_SLOTS[i] ?? { mount: "tower" as const, x: e.x, z: e.z, floor: e.y, baseYaw: e.baseYaw, yawLimit: e.yawLimit, start: e.weapon, name: "" };
      return { def, armed: i >= MATCH_SLOTS.length || def.start !== null, down: false, support: this.supportOf(def, teamOf(e)) };
    });
    // Each castle starts with a Barracks standing (M2's), when the layout has plots.
    for (const team of [Team.Enemy, Team.Player]) this.startBuilding(team, START_BARRACKS, "barracks", true);
    this.notes = [];
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

  /** Ticks until the barracks send their next waves. */
  nextWaveIn(): number {
    const t = this.tick;
    if (t <= WAVES.first) return WAVES.first - t;
    const k = (t - WAVES.first) % WAVES.every;
    return k === 0 ? 0 : WAVES.every - k;
  }

  /** Does the team have a building of this kind working? */
  has(team: Team, kind: BuildingKind): boolean {
    for (const p of this.plots[team]) if (p.kind === kind && p.state === PlotState.Working) return true;
    return false;
  }

  /** Gold a team earns a second from its keep and mills. */
  income(team: Team): number {
    let n = MATCH.keepIncome;
    for (const p of this.plots[team]) if (p.kind === "mill" && p.state === PlotState.Working) n += MATCH.millIncome;
    return (n * 60) / MATCH.incomeEvery;
  }

  /** The first emplacement id of a team's slots. */
  slotBase(team: Team): number {
    return team === Team.Player ? 0 : SLOTS_PER_TEAM;
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
      if (this.plan) this.followPlan(tick);
      this.construct(tick);
      if (this.barracks && tick >= WAVES.first && (tick - WAVES.first) % WAVES.every === 0) {
        this.sendWaves(Team.Player);
        this.sendWaves(Team.Enemy);
      }
      this.gunnery(tick);
    }
    this.world.step();
    if (this.result) return;
    this.afterStep(tick);
    if (tick % MATCH.incomeEvery === MATCH.incomeEvery - 1) {
      for (const team of [Team.Enemy, Team.Player]) {
        this.earn(team, MATCH.keepIncome, "keep");
        let mills = 0;
        for (const p of this.plots[team]) if (p.kind === "mill" && p.state === PlotState.Working) mills++;
        if (mills) this.earn(team, mills * MATCH.millIncome, "mills");
      }
    }
    // A keep is toppled when its banner comes down: the other team wins.
    const [down0, down1] = this.world.castle.toppled;
    if (down0 || down1) {
      const winner: Team | -1 = down0 && down1 ? -1 : down0 ? Team.Player : Team.Enemy;
      this.result = { winner, reason: "keep", tick };
    }
  }

  /** Apply a team's input on its tick; true if it was allowed. */
  private apply(team: Team, input: MatchInput, tick: number): boolean {
    switch (input.kind) {
      case "fire": {
        // Only from the team's own emplacements, with a gun standing in them, and only when loaded.
        const e = this.emplacements[input.emplacement];
        if (!e || this.owner[e.id] !== team || this.world.reload[e.id] > 0 || !this.usable(e.id)) return false;
        this.shots[team]++;
        this.world.queue(tick, { ...input, auto: false, reload: 1 });
        this.setGun(e.id, input.yaw, input.pitch);
        return true;
      }
      case "order":
        if (input.order !== Order.Advance && input.order !== Order.Hold && input.order !== Order.Push) return false;
        this.army.setOrder(team, input.order);
        return true;
      case "route":
        if (!ROUTE_NAMES.includes(input.route)) return false;
        this.route[team] = input.route;
        for (const p of this.plots[team]) p.route = input.route;
        return true;
      case "man": {
        const e = input.emplacement;
        if (e !== -1 && (!this.emplacements[e] || this.owner[e] !== team)) return false;
        const left = input.left;
        if (left && this.emplacements[left.emplacement] && this.owner[left.emplacement] === team) this.setGun(left.emplacement, left.yaw, left.pitch);
        this.manned[team] = e;
        if (e >= 0) this.guns[e].target = -1;
        return true;
      }
      case "build":
        return this.build(team, input.plot, input.building, tick);
      case "buy":
        return this.buy(team, input.emplacement, input.weapon);
      case "upgrade":
        return this.upgrade(team, input.emplacement, input.upgrade);
      case "barracks": {
        const p = this.plots[team][input.plot];
        if (!p || p.kind !== "barracks" || p.state === PlotState.Empty) return false;
        if (input.route !== undefined) {
          if (!ROUTE_NAMES.includes(input.route)) return false;
          p.route = input.route;
        }
        if (input.mix !== undefined) {
          if (!MIX_NAMES.includes(input.mix)) return false;
          p.mix = input.mix;
        }
        return true;
      }
    }
    return false;
  }

  /** Can this emplacement fire at all: a gun bought for it, and still standing? */
  usable(id: number): boolean {
    const s = this.slots[id];
    return !!s && s.armed && !s.down;
  }

  /** Why a team cannot build this on that plot now (null: it can). */
  buildBlock(team: Team, plot: number, kind: BuildingKind): string | null {
    const p = this.plots[team][plot];
    const def = BUILDINGS[kind];
    if (!p || !def) return "No such plot.";
    if (!this.sets.has(`${team}:${plot}:${kind}`)) return "No plots in this castle.";
    if (p.state === PlotState.Building) return "Building already.";
    if (p.state === PlotState.Working) return "Built already.";
    if (this.gold[team] < def.cost) return `Needs ${def.cost} gold.`;
    const r = plotRect(team, plot);
    for (const m of this.world.minions.list) {
      if (m.state !== MinionState.Upright || m.team === team) continue;
      if (m.x > r.x0 - 1 && m.x < r.x1 + 1 && m.z > r.z0 - 1 && m.z < r.z1 + 1) return "Enemies are on the plot.";
    }
    return null;
  }

  private build(team: Team, plot: number, kind: BuildingKind, tick: number): boolean {
    if (this.buildBlock(team, plot, kind)) return false;
    this.gold[team] -= BUILDINGS[kind].cost;
    this.startBuilding(team, plot, kind, false, tick);
    return true;
  }

  /**
   * Work starts on a plot: whatever is left of an earlier building there (of
   * any kind, wherever its pieces lie) and rubble lying on the plot is
   * cleared away, then the pieces go up course by course over the build
   * time (or all at once, for a castle's first barracks).
   */
  private startBuilding(team: Team, plot: number, kind: BuildingKind, instant: boolean, tick = 0) {
    const set = this.sets.get(`${team}:${plot}:${kind}`);
    if (!set) return;
    const castle = this.world.castle;
    const clear: number[] = [];
    for (const s of this.layout.plots) {
      if (s.castle !== team || s.plot !== plot) continue;
      for (let id = s.first; id < s.first + s.count; id++) if (!castle.absent[id]) clear.push(id);
    }
    const r = plotRect(team, plot);
    for (const id of castle.rubbleIn(r.x0 - 0.4, r.x1 + 0.4, -2, 8, r.z0 - 0.4, r.z1 + 0.4)) if (!clear.includes(id)) clear.push(id);
    clear.sort((a, b) => a - b);
    if (clear.length) castle.clear(clear);
    // Course by course: pieces by the height of their bottoms, then by id.
    const ids: number[] = [];
    for (let id = set.first; id < set.first + set.count; id++) ids.push(id);
    const bottom = (id: number) => stoneBounds(this.layout.stones[id], this.layout.wedge)[1];
    const level = (id: number) => Math.round(bottom(id) * 4);
    ids.sort((a, b) => level(a) - level(b) || a - b);
    const levels: number[] = [];
    for (const id of ids) if (!levels.includes(level(id))) levels.push(level(id));
    const build = instant ? 0 : BUILDINGS[kind].build;
    const due = Int32Array.from(ids.map((id) => Math.round(((levels.indexOf(level(id)) + 1) * build) / levels.length)));
    const p = this.plots[team][plot];
    const keep = p.kind === "barracks" ? { route: p.route, mix: p.mix } : { route: this.route[team], mix: "pikemen" as MixName };
    Object.assign(p, { kind, state: PlotState.Building, started: tick, done: tick + build, order: Int32Array.from(ids), due, raised: 0, standing: 0, route: keep.route, mix: keep.mix });
    if (instant) this.construct(tick);
  }

  /** Raise the courses that are due, and judge every building: done, or knocked down. */
  private construct(tick: number) {
    const castle = this.world.castle;
    for (const team of [Team.Enemy, Team.Player]) {
      for (let k = 0; k < this.plots[team].length; k++) {
        const p = this.plots[team][k];
        if (p.state !== PlotState.Building && p.state !== PlotState.Working) continue;
        if (p.state === PlotState.Building) {
          const from = p.raised;
          while (p.raised < p.order.length && p.started + p.due[p.raised] <= tick) p.raised++;
          if (p.raised > from) {
            castle.raise(p.order.subarray(from, p.raised));
            // Anything raised with nothing under it would fall at once (a building's own courses hold it up).
            castle.checkSupport();
          }
        }
        let standing = 0;
        for (let i = 0; i < p.raised; i++) if (!castle.dynamic[p.order[i]]) standing++;
        p.standing = standing;
        // Wrecked: fewer than BUILDING_ALIVE of what is up still stands (once a few courses are up).
        if (p.raised >= 8 && standing < p.raised * BUILDING_ALIVE) {
          const was = p.state;
          p.state = PlotState.Down;
          this.notes.push({ kind: "down", team, plot: k, building: p.kind! });
          // Knocking down a finished enemy building pays a share of what it cost.
          if (was === PlotState.Working) {
            const pr = plotRect(team, k);
            this.earn(1 - team, Math.round(BUILDINGS[p.kind!].cost * MATCH.buildingBounty), "building", `${BUILDINGS[p.kind!].name} knocked down`, (pr.x0 + pr.x1) / 2, 3, (pr.z0 + pr.z1) / 2);
          }
          continue;
        }
        if (p.state === PlotState.Building && p.raised === p.order.length) {
          p.state = PlotState.Working;
          this.notes.push({ kind: "built", team, plot: k, building: p.kind! });
        }
      }
    }
  }

  private buy(team: Team, id: number, weapon: WeaponKind): boolean {
    const block = this.buyBlock(team, id, weapon);
    if (block) return false;
    const s = this.slots[id];
    this.gold[team] -= WEAPON_COST[weapon];
    const e = slotEmplacement(id, s.def, weapon);
    Object.assign(this.emplacements[id], e);
    delete this.emplacements[id].mods;
    s.armed = true;
    const w = WEAPONS[weapon];
    const g = this.guns[id];
    g.yaw = g.aimYaw = e.baseYaw;
    g.pitch = g.aimPitch = w.restPitch < w.minPitch ? w.minPitch : w.restPitch > w.maxPitch ? w.maxPitch : w.restPitch;
    g.target = -1;
    // A new gun is not loaded yet.
    this.world.reload[id] = w.reload;
    return true;
  }

  /** Why a team cannot buy this gun for that slot now (null: it can). */
  buyBlock(team: Team, id: number, weapon: WeaponKind): string | null {
    const s = this.slots[id];
    if (!s || this.owner[id] !== team || !WEAPONS[weapon]) return "Not your slot.";
    if (s.down) return "The masonry under it is down.";
    if (s.armed) return "It has a gun.";
    if (!mountTakes(s.def.mount, weapon)) return s.def.mount === "pit" ? "The pit takes a mortar." : "No mortar on the wall walk.";
    if (this.gold[team] < WEAPON_COST[weapon]) return `Needs ${WEAPON_COST[weapon]} gold.`;
    return null;
  }

  private upgrade(team: Team, id: number, up: UpgradeKind): boolean {
    if (this.upgradeBlock(team, id, up)) return false;
    this.gold[team] -= UPGRADE_COST;
    const e = this.emplacements[id];
    e.mods = { ...(e.mods ?? {}), [up]: true };
    return true;
  }

  /** Why a team cannot fit this upgrade to that gun now (null: it can). */
  upgradeBlock(team: Team, id: number, up: UpgradeKind): string | null {
    const s = this.slots[id];
    if (!s || this.owner[id] !== team || !UPGRADE_KINDS.includes(up)) return "Not your gun.";
    if (!s.armed || s.down) return "No gun here.";
    if (this.emplacements[id].mods?.[up]) return "Fitted already.";
    if (!this.has(team, "foundry")) return "Needs a Foundry.";
    if (this.gold[team] < UPGRADE_COST) return `Needs ${UPGRADE_COST} gold.`;
    return null;
  }

  /** A gunner put this barrel here (clamped to its limits). */
  private setGun(id: number, yaw: number, pitch: number) {
    const e = this.emplacements[id], w = WEAPONS[e.weapon];
    const g = this.guns[id];
    g.yaw = yaw < e.baseYaw - e.yawLimit ? e.baseYaw - e.yawLimit : yaw > e.baseYaw + e.yawLimit ? e.baseYaw + e.yawLimit : yaw;
    g.pitch = pitch < w.minPitch ? w.minPitch : pitch > w.maxPitch ? w.maxPitch : pitch;
    g.target = -1;
  }

  /** The units a barracks sends with this mix, as far as the team can pay and has what each needs. Pays for them. */
  private recruit(team: Team, mix: MixName, room: number): UnitKind[] {
    const out: UnitKind[] = [];
    for (const kind of MIXES[mix].units) {
      if (out.length >= room) break;
      const need = UNIT_NEEDS[kind];
      const cost = UNITS[kind].cost;
      if ((need && !this.has(team, need)) || this.gold[team] < cost) {
        out.push("pikeman");
        continue;
      }
      this.gold[team] -= cost;
      out.push(kind);
    }
    return out;
  }

  /** Every working barracks of a team sends its wave, as many as its standing cap allows (the first barracks first). */
  private sendWaves(team: Team) {
    let k = 0;
    for (let i = 0; i < this.plots[team].length; i++) {
      const p = this.plots[team][i];
      if (p.kind !== "barracks" || p.state !== PlotState.Working) continue;
      // Until the AI arrives (M5), the enemy's first barracks takes the routes in turn.
      const route = team === Team.Enemy && i === START_BARRACKS ? ENEMY_ROUTES[this.enemyTurn++ % ENEMY_ROUTES.length] : p.route;
      const room = WAVES.maxStanding - this.army.standing(team);
      const units = room > 0 ? this.recruit(team, p.mix, room < WAVES.size ? room : WAVES.size) : [];
      this.waves[team]++;
      if (units.length) {
        const M = MUSTER[team];
        this.army.spawnWave(team, ROUTE_NAMES.indexOf(route), units, k ? { x: M.x, z: M.z + M.dir * MUSTER_STEP * k } : undefined);
      }
      k++;
    }
  }

  /** The enemy's plan: its next step when due, tried again later when it cannot be done yet. */
  private followPlan(tick: number) {
    if (this.planStep >= ENEMY_PLAN.length) return;
    const step = ENEMY_PLAN[this.planStep];
    if (tick < step.at || tick < this.planAt) return;
    const input = planInput(step, this.slotBase(Team.Enemy));
    if (this.apply(Team.Enemy, input, tick)) this.planStep++;
    else this.planAt = tick + PLAN_RETRY;
  }

  /** Gold for a team, logged with its reason (for the HUD and the end screen). */
  private earn(team: Team, amount: number, source: string, why = "", x = 0, y = 0, z = 0) {
    if (amount <= 0) return;
    this.gold[team] += amount;
    this.earned[team][source] = (this.earned[team][source] ?? 0) + amount;
    if (why) this.goldLog.push({ team, amount, why, x, y, z });
  }

  /** After the world's step: bounties, trick shots, masonry, and guns whose masonry came down. */
  private afterStep(tick: number) {
    const world = this.world;
    const list = world.minions.list;
    const fell = world.minions.fellNow;
    world.minions.fellNow = [];
    for (const id of fell) {
      const m = list[id];
      if (m.wave < 0) continue;
      const foe = (1 - m.team) as Team;
      const unit = UNITS[UNIT_KINDS[m.kind]];
      this.earn(foe, unit.bounty, "bounty", `${unit.name} down`, m.x, m.y + 1, m.z);
      // Trick shots: only a gunner's own shot, against the other side's minions.
      const owner = world.shotOwner(m.cause);
      if (!owner || owner.auto || this.owner[owner.emplacement] !== foe) continue;
      if (m.how === Felled.Ricochet) this.earn(foe, TRICKS.ricochet, "tricks", "Ricochet kill", m.x, m.y + 1, m.z);
      if (m.how === Felled.Stone) this.earn(foe, TRICKS.collapse, "tricks", "Collapse kill", m.x, m.y + 1, m.z);
      if (m.kind === 1 && m.hadKeg) this.earn(foe, TRICKS.keg, "tricks", "Keg set off", m.x, m.y + 1, m.z);
      const n = (this.shotKills.get(m.cause) ?? 0) + 1;
      this.shotKills.set(m.cause, n);
      if (n === TRICKS.multiFrom) this.earn(foe, TRICKS.multi, "tricks", `Multi-kill: ${n}`, m.x, m.y + 1, m.z);
      else if (n > TRICKS.multiFrom) this.earn(foe, TRICKS.multiEach, "tricks", `Multi-kill: ${n}`, m.x, m.y + 1, m.z);
    }
    for (const h of world.keepHits) {
      const owner = world.shotOwner(h.shot);
      if (!owner || owner.auto || h.castle > 1) continue;
      const team = this.owner[owner.emplacement];
      if (team === h.castle) continue;
      const lz = h.castle === 0 ? 4 : -DIST - 4;
      this.earn(team, TRICKS.keep, "tricks", "Keep hit", 0, 14, lz);
    }
    // Masonry brought down: castle pieces and buildings (not the bridges) pay the other side.
    const castle = world.castle;
    const log = castle.downLog;
    const px = [0, 0], py = [0, 0], pz = [0, 0], pn = [0, 0];
    for (; this.downSeen < log.length; this.downSeen++) {
      const s = this.layout.stones[log[this.downSeen]];
      if (s.castle > 1 || s.part === "banner") continue;
      const foe = 1 - s.castle;
      this.masonry[foe]++;
      px[foe] += s.x;
      py[foe] += s.y;
      pz[foe] += s.z;
      pn[foe]++;
    }
    for (const team of [Team.Enemy, Team.Player]) {
      const pay = Math.floor(this.masonry[team] / MATCH.masonryPer);
      if (!pay) continue;
      this.masonry[team] -= pay * MATCH.masonryPer;
      const n = pn[team] || 1;
      this.earn(team, pay, "masonry", "Masonry", px[team] / n, py[team] / n, pz[team] / n);
    }
    // Guns whose masonry came down fall with it.
    for (let id = 0; id < this.slots.length; id++) {
      const s = this.slots[id];
      if (s.down || !s.support.length) continue;
      let standing = 0;
      for (let k = 0; k < s.support.length; k++) if (!castle.dynamic[s.support[k]]) standing++;
      if (standing >= s.support.length * GUN_ALIVE) continue;
      s.down = true;
      const team = this.owner[id];
      if (this.manned[team] === id) this.manned[team] = -1;
      this.guns[id].target = -1;
      if (s.armed) this.notes.push({ kind: "gunDown", team, emplacement: id, weapon: this.emplacements[id].weapon });
    }
    void tick;
  }

  /** The masonry a slot's gun stands on: the top courses under the wall walk, or the tower's top rings. */
  private supportOf(def: SlotDef, team: Team): Int32Array {
    if (def.mount === "pit") return new Int32Array(0);
    const out: number[] = [];
    const L = this.layout;
    const R = L.wedge.rOut + 0.4;
    for (const s of L.stones) {
      if (s.castle !== team || s.part === "merlon" || s.plot !== undefined) continue;
      const b = stoneBounds(s, L.wedge);
      if (b[4] > def.floor + 0.05 || b[4] < def.floor - 1.05) continue;
      if (def.mount === "tower") {
        if (s.shape !== "wedge") continue;
        const dx = s.x - def.x, dz = s.z - def.z;
        if (dx * dx + dz * dz < R * R) out.push(s.id);
      } else if (def.x >= b[0] - 1.25 && def.x <= b[3] + 1.25 && def.z >= b[2] - 1.2 && def.z <= b[5] + 1.2) out.push(s.id);
    }
    return Int32Array.from(out);
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
      if (!U || this.manned[team] === e.id || !this.usable(e.id)) continue;
      const g = this.guns[e.id];
      const w = emplacementWeapon(e);
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

  /** Pieces of a castle that have come loose or turned to dust (its buildings not counted). */
  masonryDown(castle: 0 | 1): number {
    const c = this.world.castle;
    let n = 0;
    for (const s of c.layout.stones) if (s.castle === castle && s.plot === undefined && c.dynamic[s.id]) n++;
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

  /** Hash of the whole match: the world's state plus gold, shots, the result, waves, orders, guns, plots, slots and the plan. */
  hash(): { state: string; world: string } {
    const w = this.world.hash();
    const r = this.result;
    const nums = [this.tick, this.gold[0], this.gold[1], this.shots[0], this.shots[1], this.autoShots[0], this.autoShots[1], r ? r.winner : -2, r ? r.tick : -1, parseInt(w.state, 16)];
    nums.push(ROUTE_NAMES.indexOf(this.route[0]), ROUTE_NAMES.indexOf(this.route[1]), this.waves[0], this.waves[1], this.manned[0], this.manned[1]);
    for (const g of this.guns) nums.push(g.yaw, g.pitch, g.target, g.aimYaw, g.aimPitch, g.charge, g.errX, g.errZ);
    for (const team of [0, 1]) {
      for (const p of this.plots[team]) nums.push(p.kind ? BUILDINGS_ORDER.indexOf(p.kind) : -1, p.state, p.started, p.raised, p.standing, ROUTE_NAMES.indexOf(p.route), MIX_NAMES.indexOf(p.mix));
    }
    for (let id = 0; id < this.slots.length; id++) {
      const s = this.slots[id], e = this.emplacements[id];
      nums.push(s.armed ? 1 : 0, s.down ? 1 : 0, WEAPON_ORDER.indexOf(e.weapon), e.mods?.heavy ? 1 : 0, e.mods?.rifled ? 1 : 0);
    }
    nums.push(this.masonry[0], this.masonry[1], this.planStep, this.planAt, this.enemyTurn);
    const f = new Float64Array(nums);
    return { state: hex8(hashBytes(new Uint8Array(f.buffer))), world: w.world };
  }
}

const BUILDINGS_ORDER: BuildingKind[] = ["barracks", "mill", "foundry"];
const WEAPON_ORDER: WeaponKind[] = ["longGun", "mortar", "chainShot", "swivel"];

/** A step of the enemy's plan as the input it sends (its slots are numbered from its first emplacement). */
export function planInput(step: PlanStep, base: number): MatchInput {
  if ("build" in step) return { kind: "build", plot: step.build.plot, building: step.build.kind };
  if ("buy" in step) return { kind: "buy", emplacement: base + step.buy.slot, weapon: step.buy.weapon };
  if ("upgrade" in step) return { kind: "upgrade", emplacement: base + step.upgrade.slot, upgrade: step.upgrade.upgrade };
  if ("mix" in step) return { kind: "barracks", plot: step.mix.plot, mix: step.mix.mix };
  return { kind: "barracks", plot: step.route.plot, route: step.route.route };
}

/** The gun an empty slot is drawn with until one is bought (for the page). */
export function slotShowing(def: SlotDef): WeaponKind {
  return def.start ?? MOUNT_DEFAULT[def.mount];
}
