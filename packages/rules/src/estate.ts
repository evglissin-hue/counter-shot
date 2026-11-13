// A castle's estate (phase 2 M3): what is built on its plots, how each of its
// barracks sends its waves (the mix and the route), and the guns it has
// bought and upgraded. The match routes the players' inputs here (build,
// buy, upgrade, barracks), and the enemy castle follows its build order from
// content until the AI arrives (M5), paying like anyone else. The buildings
// themselves are the world's (sim structures.ts): they rise, work and fall.

import {
  BUILDING_KINDS,
  BUILDING_REBUILD,
  BUILDINGS,
  BUTTRESS,
  BUTTRESS_FACES,
  ENEMY_PLAN,
  MIX_NAMES,
  PLOTS,
  ROUTE_NAMES,
  SLOTS_PER_CASTLE,
  UNIT_NUMBER,
  UPGRADE_KINDS,
  UPGRADES,
  WAVE_MIXES,
  WEAPON_COST,
  WEAPON_KINDS,
  BARREL,
  GUN_HITS,
  POWDER,
  type BuildingKind,
  type ButtressFace,
  type Emplacement,
  type MixName,
  type RouteName,
  type UpgradeKind,
  type WeaponKind,
} from "@keepfall/content";
import { ButtressState, PlotState, type SandboxSim } from "@keepfall/sim";
import type { Economy } from "./economy";

/** How a barracks on a plot sends its waves. */
export interface BarracksSetting {
  mix: MixName;
  route: RouteName;
}

/** The first emplacement id of a team's castle in a match (the player's castle comes first). */
export function firstSlot(team: number): number {
  return team === 1 ? 0 : SLOTS_PER_CASTLE;
}

export class Estate {
  /** Per team, per plot: how a barracks there sends its waves. */
  readonly barracks: BarracksSetting[][];
  /** The enemy's next step in its build order. */
  planStep = 0;

  constructor(
    private world: SandboxSim,
    private economy: Economy,
    /** The match's own copies of the emplacements (empty slots fill in as guns are bought). */
    private emplacements: Emplacement[],
    private teamOfEmp: (emp: number) => number,
  ) {
    this.barracks = [0, 1].map(() => PLOTS.map(() => ({ mix: "pikemen" as MixName, route: "centre" as RouteName })));
  }

  private get structures() {
    return this.world.structures!;
  }

  /** The kind standing (or rising, or ruined) on a plot, or null. */
  kindOn(team: number, plot: number): BuildingKind | null {
    const k = this.structures.slot(team, plot).kind;
    return k >= 0 ? BUILDING_KINDS[k] : null;
  }

  /** Build on an empty plot, or rebuild a ruin there, if the team can pay. */
  build(team: number, plot: number, kind: BuildingKind, tick: number): boolean {
    if (plot < 0 || plot >= PLOTS.length || !BUILDINGS[kind]) return false;
    const s = this.structures.slot(team, plot);
    // 3.3: a team holds one magazine, standing or rising (a ruin does not count): another is refused, and so is rebuilding a ruin beside one.
    if (kind === "magazine") {
      for (let p = 0; p < PLOTS.length; p++) {
        const o = this.structures.slot(team, p);
        if (p !== plot && BUILDING_KINDS[o.kind] === "magazine" && (o.state === PlotState.Standing || o.state === PlotState.Rising)) return false;
      }
    }
    if (s.state === PlotState.Empty) {
      if (!this.economy.pay(team, BUILDINGS[kind].cost)) return false;
      return this.structures.build(team, plot, BUILDING_KINDS.indexOf(kind), tick);
    }
    if (s.state === PlotState.Ruined && BUILDING_KINDS[s.kind] === kind) {
      if (!this.economy.pay(team, Math.round(BUILDINGS[kind].cost * BUILDING_REBUILD))) return false;
      return this.structures.rebuild(team, plot, tick);
    }
    return false;
  }

  /** 3.4: the state of a team's buttress on a face (0 empty, 1 rising, 2 standing). */
  buttressState(team: number, face: ButtressFace): 0 | 1 | 2 {
    const b = this.world.buttresses;
    return b ? b.state(team, BUTTRESS_FACES.indexOf(face)) : 0;
  }

  /** Buy a buttress for the team's keep on a face: only a bare face, and only if the team can pay. */
  buttress(team: number, face: ButtressFace, tick: number): boolean {
    const b = this.world.buttresses;
    const f = BUTTRESS_FACES.indexOf(face);
    if (!b || f < 0 || b.state(team, f) !== ButtressState.Empty) return false;
    if (!this.economy.pay(team, BUTTRESS.gold)) return false;
    return b.build(team, f, tick);
  }

  /** Buy a gun for one of the team's empty slots (after M5: only while the masonry it would stand on stands). */
  buy(team: number, emp: number, weapon: WeaponKind): boolean {
    const e = this.emplacements[emp];
    if (!e || this.teamOfEmp(emp) !== team || !e.empty || !(e.allowed ?? []).includes(weapon)) return false;
    if (this.world.mounts.standing(emp) < GUN_HITS.mountBack) return false;
    if (!this.economy.pay(team, WEAPON_COST[weapon])) return false;
    e.weapon = weapon;
    e.empty = false;
    e.barrel = BARREL[weapon];
    // 3.3: a gun bought later arrives with its box full.
    this.world.carriers?.armed(e);
    return true;
  }

  /** The plot of the team's working magazine (-1: none). */
  magazine(team: number): number {
    for (let p = 0; p < PLOTS.length; p++) if (this.kindOn(team, p) === "magazine" && this.structures.works(team, p)) return p;
    return -1;
  }

  /** Buy powder at the working magazine: POWDER.buy.charges for POWDER.buy.gold, at once; refused without a working magazine, without room for all of it, or without the gold. */
  buyPowder(team: number): boolean {
    const c = this.world.carriers;
    if (!c || this.magazine(team) < 0 || c.room(team) < POWDER.buy.charges) return false;
    if (!this.economy.pay(team, POWDER.buy.gold)) return false;
    c.store(team, POWDER.buy.charges);
    return true;
  }

  /** Upgrade one of the team's guns at its Foundry (one upgrade per gun). */
  upgrade(team: number, emp: number, upgrade: UpgradeKind): boolean {
    const e = this.emplacements[emp];
    const u = UPGRADES[upgrade];
    if (!e || !u || this.teamOfEmp(emp) !== team || e.empty || e.upgrade || u.weapon !== e.weapon || !this.foundry(team)) return false;
    if (!this.economy.pay(team, u.cost)) return false;
    e.upgrade = upgrade;
    return true;
  }

  /** Set a barracks plot's mix and route (either may be left out). */
  setBarracks(team: number, plot: number, mix?: MixName, route?: RouteName) {
    const b = this.barracks[team]?.[plot];
    if (!b) return;
    if (mix && MIX_NAMES.includes(mix)) b.mix = mix;
    if (route && ROUTE_NAMES.includes(route)) b.route = route;
  }

  /** Every barracks of the team takes this route. */
  setRoutes(team: number, route: RouteName) {
    for (const b of this.barracks[team]) b.route = route;
  }

  /** The team's working barracks' plots, in plot order. */
  workingBarracks(team: number): number[] {
    const out: number[] = [];
    for (let p = 0; p < PLOTS.length; p++) if (this.kindOn(team, p) === "barracks" && this.structures.works(team, p)) out.push(p);
    return out;
  }

  /** Working Powder Mills of a team. */
  mills(team: number): number {
    let n = 0;
    for (let p = 0; p < PLOTS.length; p++) if (this.kindOn(team, p) === "mill" && this.structures.works(team, p)) n++;
    return n;
  }

  /** Does the team have a working Foundry? */
  foundry(team: number): boolean {
    for (let p = 0; p < PLOTS.length; p++) if (this.kindOn(team, p) === "foundry" && this.structures.works(team, p)) return true;
    return false;
  }

  /** A barracks' wave: its mix as the sim's unit numbers. */
  waveUnits(team: number, plot: number): number[] {
    return WAVE_MIXES[this.barracks[team][plot].mix].units.map((u) => UNIT_NUMBER[u]);
  }

  /**
   * The enemy castle's build order (until the AI): its next step, once its
   * time has come and it can pay; a step that can no longer be done (the
   * plot is taken, the slot armed) is passed over.
   */
  followPlan(team: number, tick: number) {
    // A ruin comes first: rebuild it (a magazine, then a barracks, before anything else) as soon as it can be paid for.
    for (const kind of ["magazine", "barracks", "mill", "foundry"] as BuildingKind[]) {
      for (let p = 0; p < PLOTS.length; p++) {
        const s = this.structures.slot(team, p);
        if (s.state !== PlotState.Ruined || BUILDING_KINDS[s.kind] !== kind) continue;
        this.build(team, p, kind, tick);
        return;
      }
    }
    const step = ENEMY_PLAN[this.planStep];
    if (!step || tick < step.at) return;
    let done = false, impossible = false;
    if (step.kind === "build") {
      const s = this.structures.slot(team, step.plot);
      if (s.state !== PlotState.Empty) impossible = true;
      else if (this.build(team, step.plot, step.building, tick)) {
        done = true;
        if (step.building === "barracks") this.setBarracks(team, step.plot, (step.mix as MixName) ?? undefined, step.route);
      }
    } else if (step.kind === "buy") {
      const emp = firstSlot(team) + step.emplacement;
      const e = this.emplacements[emp];
      if (!e || !e.empty || !(e.allowed ?? []).includes(step.weapon)) impossible = true;
      else done = this.buy(team, emp, step.weapon);
    } else {
      const emp = firstSlot(team) + step.emplacement;
      const e = this.emplacements[emp];
      const u = UPGRADES[step.upgrade as UpgradeKind];
      if (!e || e.empty || e.upgrade || !u || u.weapon !== e.weapon) impossible = true;
      else if (this.foundry(team)) done = this.upgrade(team, emp, step.upgrade as UpgradeKind);
    }
    if (done || impossible) this.planStep++;
  }

  hashInto(out: number[]) {
    out.push(this.planStep);
    for (const team of [0, 1]) for (const b of this.barracks[team]) out.push(MIX_NAMES.indexOf(b.mix), ROUTE_NAMES.indexOf(b.route));
    for (const e of this.emplacements) out.push(e.empty ? 1 : 0, WEAPON_KINDS.indexOf(e.weapon), e.upgrade ? UPGRADE_KINDS.indexOf(e.upgrade) : -1);
  }
}
