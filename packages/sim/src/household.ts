// The household (phase 3 milestone 3.6): a castle's named people at their
// stations, the reserve waiting in the keep, and each gun crew's skill.
// CONTRACT (the master's): the types and the public surface below are fixed;
// the executor building the sim fills in the behaviour
// (docs/phase-3/06-household.md, HOUSEHOLD in @keepfall/content).
//
// - Stations, in this fixed order per castle (castle 0's, then castle 1's):
//   one per emplacement of the castle (StationKind.Gun, index the emplacement
//   id, two seats: the layer and the loader; live while the gun is armed),
//   the masons (Mason, index the mason's slot in Works, one seat each; REPAIR.crew),
//   the powder boys (Boy, index the boy's slot in Carriers, one seat each;
//   POWDER.boys; only with powder), the bell ringer and the signaller (Bell,
//   Mast, index 0, one seat; only with organs), the spotter (Spotter, one
//   seat, index the plot of the team's spotter's tower; live while one works,
//   only with plots).
// - People: every person who has been one of the household, in the order
//   they joined (the start's household in station order, then each
//   replacement as he walks out of the keep's door, then a bought gun's crew
//   and the spotter who comes with a newly built tower). Each has a name drawn
//   from HOUSEHOLD_NAMES on a stream of its own (new Rng((hashString("household")
//   ^ seed) >>> 0): never a fork of the world's stream, so the Practice range's
//   hash holds), and his shots: those his gun has fired while he stood at
//   its post (by hand, on its own or in a salvo).
// - Figures: a gun's crew and the keepers are Unit.Crew minions with
//   Role.Crew in the minion list (a wave of their own, as the masons' crew),
//   standing at their posts (content crewPostXZ at the gun's floor, mountFloor;
//   keeperPost): upright kinematic capsules placed there, never walked by
//   the army (isWorker), with action CrewAction.AtGun or AtPost. Anything that
//   knocks a man down knocks them down: balls, bursts, falling masonry, the
//   chain shot's whirl (sweep.ts sweptMen: the chain no longer knocks a gun
//   out by its crew; Mounts.whirl goes). A man on masonry that falls goes with
//   it (Cause.Fall): a gun's crew when its mount gives way (Mounts knocks the
//   gun out by OutCause.Mount), a keeper when his organ goes down or his tower
//   is wrecked. Masons and powder boys stay Works' and Carriers' minions; the
//   household holds their seats and names.
// - Losing someone (afterStep): a seat whose man is no longer upright (or a
//   mason or boy Works or Carriers reports down through lostWorker) becomes
//   Due at the tick it was lost plus HOUSEHOLD.walkOut, and the team's
//   people lost goes up. HouseholdDown event.
// - The reserve: HOUSEHOLD.reserve per team at the start; while it holds
//   fewer, it gains one every HOUSEHOLD.refill (refillAt; the clock starts
//   when it drops below the most). Every tick (step), seats whose due tick has
//   come take a hand from the reserve while it has one, in the order
//   FIRST_ORDER[first[team]] gives (the groups in order; within a group the
//   gun the team rides first, then station order, then the seat lost longest
//   ago). A seat that comes due with the reserve dry waits (state Due, its
//   due tick passed) and takes the next hand the reserve gains. Reserve event
//   when it runs dry and when it gains one back from none.
// - Walking out: a gun's or keeper's replacement is a new Crew minion at the
//   keep's door (keepDoor), walking the courtyard (Army.local.steer, as masons
//   do) to his post's foot (postFoot), where he waits while the post is down
//   (the gun's masonry under GUN_HITS.mountBack, the organ not working, the
//   spotter's tower not working), then is hoisted up (HOUSEHOLD.hoist ticks;
//   CrewAction.Hoist) and stands at his post (HouseholdUp). A mason's or boy's
//   replacement is spawned by Works.refill(castle, slot) or
//   Carriers.refill(castle, slot) at the keep's door (they walk to their work
//   by their own rules) and is up at once.
// - A bought gun (armed) comes with its crew of two at their posts, green,
//   new people (not from the reserve). The spotter comes with a newly built
//   tower the same way; a ruin rebuilt is a place lost (the reserve fills it).
// - Skill: a gun's crew is those at its posts (crew: 0 to 2), its level that
//   of its less skilled man there (content skillLevel). The four guns a castle
//   starts with have HOUSEHOLD.startShots behind each man (trained).
//   reloadScale and scatterScale (content crewReload, crewScatter) are read
//   where the shot is fired (SandboxSim.apply); fired() counts the shot for
//   every man at its posts. A gun with no crew does not fire on its own and
//   takes no part in a salvo (the rules ask crew()); ridden, it loads by your
//   own hands. A knocked-out gun is put back only with one of its crew at it
//   (Mounts: OutWait.Hands while none is).
// - Practice range (no army): no Household (SandboxSim.household is null);
//   every gun fires as a trained crew of two.
//
// Deterministic: stations, seats and people in fixed order, + - * / and
// comparisons, the names' own stream drawn only when a person joins.

import {
  BUILDING_KINDS,
  castleOfEmp,
  crewPostXZ,
  crewReload,
  crewScatter,
  FIRST_KINDS,
  FIRST_ORDER,
  GUN_HITS,
  HOUSEHOLD,
  HOUSEHOLD_NAMES,
  keepDoor,
  keeperPost,
  personName,
  PLOTS,
  POWDER,
  postFoot,
  skillLevel,
  StationKind,
  Unit,
  UNIT_DEFS,
  type Emplacement,
  type FirstKind,
} from "@keepfall/content";
import { dsqrt, hashString, Rng } from "@keepfall/core";
import { Action, type Army, type Emit } from "./army";
import type { Carriers } from "./carriers";
import type { CastleSim } from "./castleSim";
import { EventKind } from "./frame";
import { LOCAL_INF } from "./local";
import { Cause, MinionState, Role, type Minion, type Minions } from "./minions";
import { mountFloor, supportOf, type Mounts } from "./mounts";
import type { Organs } from "./organs";
import { PlotState, type Structures } from "./structures";
import type { Terrain } from "./terrain";
import type { Works } from "./works";

/** What a seat is doing. */
export const enum SeatState {
  /** Nobody there, nobody due (a gun not armed, a spotter's tower not standing). */
  Empty = 0,
  /** Lost: a replacement walks out of the keep at Seat.due (or as soon as the reserve has one, if that has passed). */
  Due = 1,
  /** On his way across the courtyard to the post's foot. */
  Walking = 2,
  /** At the foot, waiting for the post to stand again. */
  Waiting = 3,
  /** Being hoisted up (Seat.cool counts down). */
  Hoisting = 4,
  /** At his post (a mason or a powder boy: at his work). */
  AtPost = 5,
}

/** A crewman's or keeper's action, on top of the army's Action numbers (the frame's minion records carry it; the page draws a gun's crew itself and the keepers as men standing). */
export const enum CrewAction {
  /** At a gun's post: the page's crews pose him (it hides his upright figure). */
  AtGun = 12,
  /** A keeper at his post (bell ringer, signaller, spotter). */
  AtPost = 13,
  /** Being hoisted up at a post's foot. */
  Hoist = 14,
}

export interface Person {
  id: number;
  team: 0 | 1;
  /** HOUSEHOLD_NAMES indices. */
  first: number;
  last: number;
  /** Shots his gun has fired while he stood at its post. */
  shots: number;
}

export interface Seat {
  state: SeatState;
  /** The person in it (-1: none) and his minion (-1: none standing). */
  person: number;
  minion: number;
  /** Tick it was lost (-1: never), and the tick a replacement walks out (-1: none due). */
  lostAt: number;
  due: number;
  /** Ticks left of a hoist. */
  cool: number;
}

export interface Station {
  team: 0 | 1;
  kind: StationKind;
  /** The emplacement id (a gun), the slot (a mason, a powder boy), 0 (the bell, the mast), the plot (the spotter). */
  index: number;
  seats: Seat[];
}

/** What the match decides for the household: which emplacement each team rides (its crew served first within the guns' group). */
export interface HouseholdPolicy {
  riding(team: number): number;
}

/** One seat as the page sees it (its own castle's roster). */
export interface SeatInfo {
  state: SeatState;
  /** Person id (-1: none), his name ("" for none), his shots and skill level (0 green to 3 veteran). */
  person: number;
  name: string;
  shots: number;
  level: number;
  /** Ticks until a replacement walks out (-1: none due; 0: due now, waiting for the reserve). */
  dueIn: number;
}

export interface StationInfo {
  kind: StationKind;
  index: number;
  seats: SeatInfo[];
}

/** A castle's household as its own page sees it (MatchInfo.household). */
export interface HouseholdRoster {
  reserve: number;
  max: number;
  /** Ticks until the reserve gains one (-1: it is full). */
  refillIn: number;
  first: FirstKind;
  /** People it has lost so far this match. */
  lost: number;
  stations: StationInfo[];
}

/** Numbers per emplacement in Household.report: men at its posts (0 to 2), the crew's level (0 to 3), seats with a replacement on the way (walking, waiting or hoisting). */
export const CREW_STRIDE = 3;


/** What the household needs of the world (SandboxSim hands them over once they all exist). */
export interface HouseholdDeps {
  minions: Minions;
  army: Army;
  castle: CastleSim;
  terrain: Terrain;
  mounts: Mounts;
  works: Works | null;
  carriers: Carriers | null;
  structures: Structures | null;
  organs: Organs | null;
}

/** A seat with what a walking replacement needs (where he is making for, and how long he has been getting nowhere). */
interface SeatRun extends Seat {
  /** The goal he walks to (a post's foot) and the place he makes for (the goal, or the nearest point he can get to), looked at again from tick `seek`. */
  gx: number;
  gz: number;
  tx: number;
  tz: number;
  seek: number;
  /** Ticks without getting closer to the goal, and the closest he has been. */
  stuck: number;
  best: number;
}

/** A station with the floor its men stand on (a gun's: 0 is the ground) and the masonry under its post (a keeper's). */
interface StationRun extends Station {
  floor: number;
  pieces: number[];
  seats: SeatRun[];
}

/** A man is at a place when this close (m). */
const ARRIVED = 1.0;
/** Ticks between a walker's looks for a way when his goal is cut off. */
const SEEK = 120;
/** A walker gains ground when he gets this much closer (m). */
const PROGRESS = 0.4;
/** A man at his post stands this far above the stone under him (m): clear of it, so he wakes nothing. */
const LIFT = 0.02;
/** Directions tried around a goal that is cut off (unit vectors in a fixed order). */
const RING: Array<[number, number]> = [
  [1, 0],
  [0.7071067811865476, 0.7071067811865476],
  [0, 1],
  [-0.7071067811865476, 0.7071067811865476],
  [-1, 0],
  [-0.7071067811865476, -0.7071067811865476],
  [0, -1],
  [0.7071067811865476, -0.7071067811865476],
];

const SPOTTER_KIND = BUILDING_KINDS.indexOf("spotter");

export class Household {
  readonly stations: Station[] = [];
  readonly people: Person[] = [];
  /** Hands in each team's reserve, and the tick it gains the next (-1: full). */
  readonly reserve: [number, number] = [HOUSEHOLD.reserve, HOUSEHOLD.reserve];
  readonly refillAt: [number, number] = [-1, -1];
  /** Who is replaced first, per team (the input `household`). */
  readonly first: [FirstKind, FirstKind] = [HOUSEHOLD.first, HOUSEHOLD.first];
  /** People each team has lost so far. */
  readonly lost: [number, number] = [0, 0];
  policy: HouseholdPolicy | null = null;
  /** Whether start() has made the stations (before it every armed gun is a trained crew of two: a world with an army but no match). */
  started = false;
  /** The names' stream: drawn only when a person joins. */
  private names: Rng;
  private deps: HouseholdDeps | null;
  private run: StationRun[] = [];
  /** Per team, the indices (into stations) of its stations, in order. */
  private mine: [number[], number[]] = [[], []];
  /** Per emplacement: its station (-1: none). Per team: its keepers' stations by StationKind (-1: none). */
  private gunSt: number[];
  private keeperSt: [number[], number[]] = [[-1, -1, -1, -1, -1, -1], [-1, -1, -1, -1, -1, -1]];
  /** Each team's wave of household minions. */
  private wave: [number, number] = [-1, -1];
  /** The station index each household minion holds a seat at. */
  private byMinion = new Map<number, number>();
  /** Whether each team's spotter's tower has stood once this match (its first brings its spotter). */
  private spotterSeen: [boolean, boolean] = [false, false];
  private now = 0;
  private dir: [number, number] = [0, 0];

  constructor(
    protected emplacements: Emplacement[],
    seed: number,
    protected emit: Emit,
    deps: HouseholdDeps | null = null,
  ) {
    this.names = new Rng((hashString("household") ^ seed) >>> 0);
    this.deps = deps;
    this.gunSt = emplacements.map(() => -1);
  }

  // ---- Start ---------------------------------------------------------------

  /**
   * The match's start: the stations in their fixed order (per castle: its guns, the masons, the powder boys, the bell
   * ringer, the signaller, the spotter), the people in that order, the crews of every armed gun and the keepers at their
   * posts, and the seats of the masons and powder boys already spawned. Called once, when the masons have been spawned.
   */
  start(): void {
    const d = this.deps;
    if (this.started || !d) return;
    this.started = true;
    const L = d.castle.layout;
    for (const c of [0, 1] as const) {
      this.wave[c] = d.army.newWave(c, 1, true);
      for (const e of this.emplacements) {
        if (castleOfEmp(e) !== c) continue;
        const st = this.addStation(c, StationKind.Gun, e.id, HOUSEHOLD.gunCrew);
        st.floor = mountFloor(L, e);
        this.gunSt[e.id] = this.run.indexOf(st);
        if (e.empty) continue;
        for (let k = 0; k < HOUSEHOLD.gunCrew; k++) this.mount(st, k, this.newPerson(c, HOUSEHOLD.startShots));
      }
      if (d.works) {
        const crew = d.works.crews[c];
        for (let k = 0; k < crew.masons.length; k++) {
          const st = this.addStation(c, StationKind.Mason, k, 1);
          this.seize(st, 0, this.newPerson(c, 0), crew.masons[k]);
        }
      }
      if (d.carriers) {
        for (let k = 0; k < POWDER.boys; k++) {
          const st = this.addStation(c, StationKind.Boy, k, 1);
          this.seize(st, 0, this.newPerson(c, 0), d.carriers.boyMinion(c, k));
        }
      }
      if (d.organs) {
        for (const kind of [StationKind.Bell, StationKind.Mast] as const) {
          const st = this.addStation(c, kind, 0, 1);
          const p = keeperPost(c, kind);
          st.pieces = supportOf(L, c, p.x, p.z, p.y, kind === StationKind.Mast).ids;
          this.mount(st, 0, this.newPerson(c, 0));
        }
      }
      if (d.structures) {
        this.addStation(c, StationKind.Spotter, 0, 1);
        this.spotters(c);
      }
    }
  }

  private addStation(team: 0 | 1, kind: StationKind, index: number, seats: number): StationRun {
    const st: StationRun = { team, kind, index, seats: [], floor: 0, pieces: [] };
    for (let k = 0; k < seats; k++) st.seats.push({ state: SeatState.Empty, person: -1, minion: -1, lostAt: -1, due: -1, cool: 0, gx: NaN, gz: NaN, tx: 0, tz: 0, seek: 0, stuck: 0, best: Infinity });
    const i = this.run.length;
    this.run.push(st);
    this.stations.push(st);
    this.mine[team].push(i);
    if (kind === StationKind.Bell || kind === StationKind.Mast || kind === StationKind.Spotter) this.keeperSt[team][kind] = i;
    return st;
  }

  /** A new person joins a team's household. */
  private newPerson(team: 0 | 1, shots: number): number {
    const F = HOUSEHOLD_NAMES.first.length, L = HOUSEHOLD_NAMES.last.length;
    const first = Math.floor(this.names.next() * F), last = Math.floor(this.names.next() * L);
    this.people.push({ id: this.people.length, team, first, last, shots });
    return this.people.length - 1;
  }

  /** A mason's or powder boy's seat: the person holds it with the minion Works or Carriers spawned. */
  private seize(st: StationRun, k: number, person: number, minion: number) {
    const seat = st.seats[k];
    seat.person = person;
    seat.minion = minion;
    seat.state = minion >= 0 ? SeatState.AtPost : SeatState.Due;
    if (minion >= 0) this.byMinion.set(minion, this.run.indexOf(st));
  }

  // ---- Posts and floors -------------------------------------------------------

  /** Where a seat's man stands at his post (world x, y, z), and the way he faces. */
  private postOf(st: StationRun, k: number): { x: number; y: number; z: number; yaw: number } {
    const d = this.deps!;
    if (st.kind === StationKind.Gun) {
      const e = this.emplacements[st.index];
      const p = crewPostXZ(e, k);
      return { x: p.x, y: (st.floor > 0 ? st.floor : d.terrain.heightAt(p.x, p.z)) + LIFT, z: p.z, yaw: e.baseYaw };
    }
    const p = keeperPost(st.team, st.kind as StationKind.Bell | StationKind.Mast | StationKind.Spotter, st.index);
    return { x: p.x, y: p.y + LIFT, z: p.z, yaw: st.team === 0 ? 3.141592653589793 : 0 };
  }

  /** The share of the masonry under a post that stands (a spotter's tower: 1 while it works, else 0). */
  private share(st: StationRun): number {
    const d = this.deps!;
    switch (st.kind) {
      case StationKind.Gun:
        return d.mounts.standing(st.index);
      case StationKind.Spotter:
        return d.structures && this.spotterPlot(st.team) >= 0 ? 1 : 0;
      default: {
        if (!st.pieces.length) return 1;
        const dyn = d.castle.dynamic;
        let n = 0;
        for (const id of st.pieces) if (!dyn[id]) n++;
        return n / st.pieces.length;
      }
    }
  }

  /** May a replacement be hoisted up to this post (its masonry stands again)? */
  private postUp(st: StationRun): boolean {
    return this.share(st) >= GUN_HITS.mountBack;
  }

  /** Does the post still hold a man (under GUN_HITS.mountOut of its masonry down, a man on it falls)? */
  private postHolds(st: StationRun): boolean {
    return this.share(st) >= GUN_HITS.mountOut;
  }

  /** The plot of a team's working spotter's tower (-1: none). */
  private spotterPlot(team: number): number {
    const s = this.deps?.structures;
    if (!s) return -1;
    for (let p = 0; p < PLOTS.length; p++) {
      const slot = s.slot(team, p);
      if (slot.kind === SPOTTER_KIND && slot.state === PlotState.Standing) return p;
    }
    return -1;
  }

  /** The foot a replacement walks to for a station. */
  private footOf(st: StationRun, k: number): { x: number; z: number } {
    void k;
    return postFoot(st.team, st.kind, st.kind === StationKind.Gun ? this.emplacements[st.index] : null, st.index);
  }

  /** Put a new household minion down (not drawn from any stream): at (x, z) on a floor at y. */
  private spawn(team: 0 | 1, x: number, y: number, z: number, yaw: number, action: number, si: number, k: number): Minion {
    const d = this.deps!;
    const m = d.minions.spawn(team, x, z, x, z, x, z, false);
    m.wave = this.wave[team];
    m.route = 1;
    m.unit = Unit.Crew;
    m.speed = UNIT_DEFS[Unit.Crew].speed;
    m.role = Role.Crew;
    m.home = team;
    m.post = si;
    m.aux = k;
    m.y = y;
    m.yaw = yaw;
    m.action = action;
    d.minions.place(m);
    return m;
  }

  /** A person stands at a post: a new minion there, the seat taken. */
  private mount(st: StationRun, k: number, person: number) {
    const si = this.run.indexOf(st);
    const p = this.postOf(st, k);
    const seat = st.seats[k];
    const m = this.spawn(st.team, p.x, p.y, p.z, p.yaw, st.kind === StationKind.Gun ? CrewAction.AtGun : CrewAction.AtPost, si, k);
    seat.person = person;
    seat.minion = m.id;
    seat.state = SeatState.AtPost;
    seat.lostAt = -1;
    seat.due = -1;
    seat.cool = 0;
    this.byMinion.set(m.id, si);
    this.emit(EventKind.HouseholdUp, st.team, si, k, person);
  }

  /** A man who has been walking, waiting or hoisted takes his post. */
  private arriveAtPost(st: StationRun, k: number) {
    const si = this.run.indexOf(st);
    const seat = st.seats[k];
    const m = this.deps!.minions.list[seat.minion];
    const p = this.postOf(st, k);
    m.x = p.x;
    m.z = p.z;
    m.y = p.y;
    m.yaw = p.yaw;
    m.vx = m.vz = 0;
    m.action = st.kind === StationKind.Gun ? CrewAction.AtGun : CrewAction.AtPost;
    this.deps!.minions.place(m);
    seat.state = SeatState.AtPost;
    seat.cool = 0;
    this.emit(EventKind.HouseholdUp, st.team, si, k, seat.person);
  }

  // ---- What the crews do for their guns -------------------------------------------

  /** Men of a gun's crew at their posts now (0 to 2; 0 for an empty slot). */
  crew(emp: number): number {
    const e = this.emplacements[emp];
    if (!e || e.empty) return 0;
    if (!this.started) return HOUSEHOLD.gunCrew;
    const si = this.gunSt[emp];
    if (si < 0) return 0;
    let n = 0;
    for (const seat of this.run[si].seats) if (seat.state === SeatState.AtPost) n++;
    return n;
  }

  /** The skill level of a gun's crew at their posts (0 green to 3 veteran; 0 with none). */
  level(emp: number): number {
    if (!this.started) return skillLevel(HOUSEHOLD.startShots);
    const si = this.gunSt[emp];
    if (si < 0) return 0;
    let lv = -1;
    for (const seat of this.run[si].seats) {
      if (seat.state !== SeatState.AtPost) continue;
      const l = skillLevel(this.people[seat.person].shots);
      if (lv < 0 || l < lv) lv = l;
    }
    return lv < 0 ? 0 : lv;
  }

  /** A gun's reload as a multiple of its weapon's own, by its crew (content crewReload). */
  reloadScale(emp: number): number {
    return crewReload(this.crew(emp), this.level(emp));
  }

  /** A gun's scatter as a multiple of its weapon's own, by its crew (content crewScatter). */
  scatterScale(emp: number): number {
    return crewScatter(this.crew(emp), this.level(emp));
  }

  /** A shot left this gun: every man at its posts gains one. */
  fired(emp: number): void {
    if (!this.started) return;
    const si = this.gunSt[emp];
    if (si < 0) return;
    for (const seat of this.run[si].seats) if (seat.state === SeatState.AtPost) this.people[seat.person].shots++;
  }

  /** A gun was bought for this emplacement: its crew of two, green and new, at their posts. */
  armed(emp: number): void {
    if (!this.started) return;
    const si = this.gunSt[emp];
    if (si < 0) return;
    const st = this.run[si];
    for (let k = 0; k < st.seats.length; k++) {
      if (st.seats[k].state !== SeatState.Empty) continue;
      this.mount(st, k, this.newPerson(st.team, 0));
    }
  }

  /** Is a team's keeper of the bell, the mast or the spotter's tower at his post? (True where there is none: no organs, no plots.) */
  keeper(team: number, kind: StationKind.Bell | StationKind.Mast | StationKind.Spotter): boolean {
    if (!this.started) return true;
    const si = this.keeperSt[team]?.[kind] ?? -1;
    if (si < 0) return true;
    return this.run[si].seats[0].state === SeatState.AtPost;
  }

  /** Set who a team replaces first (refused: anything not in FIRST_KINDS). */
  setFirst(team: number, first: FirstKind): void {
    if ((team === 0 || team === 1) && FIRST_KINDS.includes(first)) this.first[team] = first;
  }

  // ---- Losing and replacing ---------------------------------------------------------

  /** A seat's man is gone: the seat comes due a replacement's walk-out later. */
  private lose(si: number, k: number, tick: number) {
    const st = this.run[si], seat = st.seats[k];
    const person = seat.person;
    if (seat.minion >= 0) this.byMinion.delete(seat.minion);
    seat.minion = -1;
    seat.person = -1;
    seat.state = SeatState.Due;
    seat.lostAt = tick;
    seat.due = tick + HOUSEHOLD.walkOut;
    seat.cool = 0;
    this.lost[st.team]++;
    this.emit(EventKind.HouseholdDown, st.team, si, k, person);
  }

  /** Works or Carriers: one of a team's masons or powder boys (by slot) is down; his seat comes due. */
  lostWorker(team: number, kind: StationKind.Mason | StationKind.Boy, slot: number, tick: number): void {
    if (!this.started) return;
    for (const si of this.mine[team === 1 ? 1 : 0]) {
      const st = this.run[si];
      if (st.kind !== kind || st.index !== slot) continue;
      if (st.seats[0].state === SeatState.AtPost) this.lose(si, 0, tick);
      return;
    }
  }

  /** Before the physics step: the reserve's clock, replacements walking out, walkers walking, hoists, men placed at their posts. */
  step(tick: number): void {
    if (!this.started) return;
    this.now = tick;
    for (const team of [0, 1] as const) {
      // The reserve gains one every HOUSEHOLD.refill while it holds fewer.
      if (this.reserve[team] < HOUSEHOLD.reserve && this.refillAt[team] >= 0 && tick >= this.refillAt[team]) {
        this.reserve[team]++;
        if (this.reserve[team] === 1) this.emit(EventKind.Reserve, team, 1, 0, 0);
        this.refillAt[team] = this.reserve[team] < HOUSEHOLD.reserve ? tick + HOUSEHOLD.refill : -1;
      }
      this.spotters(team);
      this.serve(team, tick);
    }
    for (let si = 0; si < this.run.length; si++) {
      const st = this.run[si];
      if (st.kind === StationKind.Mason || st.kind === StationKind.Boy) continue;
      for (let k = 0; k < st.seats.length; k++) {
        const seat = st.seats[k];
        if (seat.state === SeatState.Walking) this.walk(st, k, tick);
        else if (seat.state === SeatState.Waiting || seat.state === SeatState.Hoisting) this.wait(st, k);
      }
    }
  }

  /** A team's spotter's tower: the first time one works this match it brings its spotter, a new person, at his post; the station follows the plot. */
  private spotters(team: 0 | 1) {
    const si = this.keeperSt[team][StationKind.Spotter];
    if (si < 0) return;
    const plot = this.spotterPlot(team);
    if (plot < 0) return;
    const st = this.run[si];
    st.index = plot;
    if (this.spotterSeen[team]) return;
    this.spotterSeen[team] = true;
    this.mount(st, 0, this.newPerson(team, 0));
  }

  /** Is a seat due, and can a hand go to it now? */
  private servable(st: StationRun, seat: SeatRun, tick: number): boolean {
    if (seat.state !== SeatState.Due || seat.due > tick) return false;
    // A spotter's tower that is a ruin keeps his seat waiting (the hand is not spent on a tower nobody has rebuilt).
    if (st.kind === StationKind.Spotter && this.spotterPlot(st.team) < 0) return false;
    return true;
  }

  /** The reserve sends its hands to the seats that are due, in the team's order (FIRST_ORDER, then the gun it rides, station order, longest lost). */
  private serve(team: 0 | 1, tick: number) {
    while (this.reserve[team] > 0) {
      const order = FIRST_ORDER[this.first[team]];
      const riding = this.policy ? this.policy.riding(team) : -1;
      let bs = -1, bk = -1, bg = 0, br = 0, bl = 0;
      for (const si of this.mine[team]) {
        const st = this.run[si];
        let g = -1;
        for (let i = 0; i < order.length && g < 0; i++) if (order[i].includes(st.kind)) g = i;
        const r = st.kind === StationKind.Gun && st.index === riding ? 0 : 1;
        for (let k = 0; k < st.seats.length; k++) {
          const seat = st.seats[k];
          if (!this.servable(st, seat, tick)) continue;
          const better = bs < 0 || g < bg || (g === bg && (r < br || (r === br && si === bs && seat.lostAt < bl)));
          if (better) {
            bs = si;
            bk = k;
            bg = g;
            br = r;
            bl = seat.lostAt;
          }
        }
      }
      if (bs < 0) return;
      if (!this.take(bs, bk, tick)) this.run[bs].seats[bk].due = tick + 30;
    }
  }

  /** The next of the reserve takes a seat: he walks out of the keep's door (a mason or powder boy is spawned by Works or Carriers there and is at work at once). */
  private take(si: number, k: number, tick: number): boolean {
    const d = this.deps!;
    const st = this.run[si], seat = st.seats[k];
    const team = st.team;
    let minion = -1;
    if (st.kind === StationKind.Mason) {
      minion = d.works ? d.works.refill(team, st.index) : -1;
      if (minion < 0) return false;
    } else if (st.kind === StationKind.Boy) {
      minion = d.carriers ? d.carriers.refill(team, st.index) : -1;
      if (minion < 0) return false;
    }
    if (this.reserve[team] === HOUSEHOLD.reserve) this.refillAt[team] = tick + HOUSEHOLD.refill;
    this.reserve[team]--;
    if (this.reserve[team] === 0) this.emit(EventKind.Reserve, team, 0, 0, 0);
    const person = this.newPerson(team, 0);
    seat.person = person;
    seat.due = -1;
    seat.cool = 0;
    if (minion >= 0) {
      seat.minion = minion;
      seat.state = SeatState.AtPost;
      this.byMinion.set(minion, si);
      this.emit(EventKind.HouseholdUp, team, si, k, person);
      return true;
    }
    const door = keepDoor(team);
    const m = this.spawn(team, door.x, d.terrain.heightAt(door.x, door.z), door.z, team === 0 ? 3.141592653589793 : 0, Action.Walk, si, k);
    seat.minion = m.id;
    seat.state = SeatState.Walking;
    seat.gx = NaN;
    seat.gz = NaN;
    seat.stuck = 0;
    seat.best = Infinity;
    seat.seek = 0;
    this.byMinion.set(m.id, si);
    return true;
  }

  /**
   * Where a walker makes for to reach his post's foot: the foot itself while he can get to it; when the way is cut off
   * (rubble, a ruin, a crater), the nearest point within POWDER.reach of it he can get to, looked at again every SEEK ticks.
   */
  private retarget(seat: SeatRun, m: Minion, gx: number, gz: number, tick: number) {
    if (seat.gx === gx && seat.gz === gz && tick < seat.seek) return;
    seat.gx = gx;
    seat.gz = gz;
    seat.seek = tick + SEEK;
    seat.tx = gx;
    seat.tz = gz;
    const local = this.deps!.army.local;
    if (local.cost(m.home, gx, gz, m.x, m.z) < LOCAL_INF) return;
    for (let r = 1; r <= POWDER.reach; r++) {
      for (const [ux, uz] of RING) {
        const cx = gx + ux * r, cz = gz + uz * r;
        if (local.cost(m.home, m.x, m.z, cx, cz) < LOCAL_INF) {
          seat.tx = cx;
          seat.tz = cz;
          return;
        }
      }
    }
  }

  /** A replacement walks the courtyard to the foot of his post. */
  private walk(st: StationRun, k: number, tick: number) {
    const d = this.deps!;
    const seat = st.seats[k];
    const m = d.minions.list[seat.minion];
    if (m.state !== MinionState.Upright) return;
    const foot = this.footOf(st, k);
    const dx = foot.x - m.x, dz = foot.z - m.z;
    const dist = dsqrt(dx * dx + dz * dz);
    let arrived = dist <= ARRIVED;
    if (!arrived) {
      this.retarget(seat, m, foot.x, foot.z, tick);
      const tx = seat.tx - m.x, tz = seat.tz - m.z;
      if (tx * tx + tz * tz <= ARRIVED * ARRIVED) arrived = true;
      else {
        if (dist < seat.best - PROGRESS) {
          seat.best = dist;
          seat.stuck = 0;
        } else seat.stuck++;
        if (seat.stuck >= POWDER.stuck && dist <= POWDER.reach) arrived = true;
        else if (d.army.local.steer(m.home, seat.tx, seat.tz, m.x, m.z, this.dir)) d.army.move(m, this.dir[0], this.dir[1], m.speed, NaN, Action.Walk);
        else {
          // No way from here: look round the goal again soon.
          d.army.move(m, 0, 0, 0, NaN, Action.Stand);
          if (seat.seek > tick + 30) seat.seek = tick + 30;
        }
      }
    }
    if (!arrived) return;
    m.vx = m.vz = 0;
    seat.best = Infinity;
    seat.stuck = 0;
    if (this.postUp(st)) this.beginHoist(st, k);
    else {
      seat.state = SeatState.Waiting;
      m.action = Action.Stand;
    }
  }

  private beginHoist(st: StationRun, k: number) {
    const seat = st.seats[k];
    seat.state = SeatState.Hoisting;
    seat.cool = HOUSEHOLD.hoist;
    this.deps!.minions.list[seat.minion].action = CrewAction.Hoist;
  }

  /** A replacement at the foot: waits while his post is down, is hoisted when it stands. */
  private wait(st: StationRun, k: number) {
    const seat = st.seats[k];
    const m = this.deps!.minions.list[seat.minion];
    if (m.state !== MinionState.Upright) return;
    // The post moved (a spotter's tower rebuilt on another plot): walk to its foot.
    const foot = this.footOf(st, k);
    if (foot.x !== seat.gx || foot.z !== seat.gz) {
      seat.state = SeatState.Walking;
      seat.seek = 0;
      seat.best = Infinity;
      seat.stuck = 0;
      m.action = Action.Walk;
      return;
    }
    if (seat.state === SeatState.Waiting) {
      if (this.postUp(st)) this.beginHoist(st, k);
      return;
    }
    if (!this.postHolds(st)) {
      seat.state = SeatState.Waiting;
      seat.cool = 0;
      m.action = Action.Stand;
      return;
    }
    if (--seat.cool <= 0) this.arriveAtPost(st, k);
  }

  /** After the physics step: who is down (seats come due), men whose masonry fell under them, keepers whose organ or tower went down. */
  afterStep(tick: number): void {
    if (!this.started) return;
    const d = this.deps!;
    for (let si = 0; si < this.run.length; si++) {
      const st = this.run[si];
      if (st.kind === StationKind.Mason || st.kind === StationKind.Boy) continue;
      // A man on masonry that gives way goes with it.
      let posted = false;
      for (const seat of st.seats) if (seat.state === SeatState.AtPost) posted = true;
      if (posted && !this.postHolds(st)) {
        for (const seat of st.seats) {
          if (seat.state !== SeatState.AtPost) continue;
          const m = d.minions.list[seat.minion];
          if (m.state !== MinionState.Upright) continue;
          d.minions.knock({ minion: m.id, vx: 0, vy: 0, vz: 0, px: m.x, py: m.y + 1, pz: m.z, extra: 0, cause: Cause.Fall }, tick);
        }
      }
      for (let k = 0; k < st.seats.length; k++) {
        const seat = st.seats[k];
        if (seat.state < SeatState.Walking || seat.minion < 0) continue;
        if (d.minions.list[seat.minion].state !== MinionState.Upright) this.lose(si, k, tick);
      }
    }
  }

  /** The station index a minion holds a seat at (-1: none), for the page and tools. */
  stationOf(minion: number): number {
    return this.byMinion.get(minion) ?? -1;
  }

  /** Per emplacement, CREW_STRIDE numbers (men at its posts, level, replacements on the way). */
  report(out: Int8Array): void {
    for (let i = 0; i < this.emplacements.length; i++) {
      out[i * CREW_STRIDE] = this.crew(i);
      out[i * CREW_STRIDE + 1] = this.level(i);
      let coming = 0;
      const si = this.started ? this.gunSt[i] : -1;
      if (si >= 0) for (const seat of this.run[si].seats) if (seat.state === SeatState.Walking || seat.state === SeatState.Waiting || seat.state === SeatState.Hoisting) coming++;
      out[i * CREW_STRIDE + 2] = coming;
    }
  }

  /** A team's roster for its own page. */
  roster(team: number): HouseholdRoster {
    const t = team === 1 ? 1 : 0;
    const stations: StationInfo[] = [];
    for (const si of this.mine[t]) {
      const st = this.run[si];
      stations.push({
        kind: st.kind,
        index: st.index,
        seats: st.seats.map((seat) => {
          const p = seat.person >= 0 ? this.people[seat.person] : null;
          return {
            state: seat.state,
            person: seat.person,
            name: p ? personName(p.first, p.last) : "",
            shots: p ? p.shots : 0,
            level: p ? skillLevel(p.shots) : 0,
            dueIn: seat.state === SeatState.Due ? Math.max(0, seat.due - this.now) : -1,
          };
        }),
      });
    }
    return {
      reserve: this.reserve[t],
      max: HOUSEHOLD.reserve,
      refillIn: this.refillAt[t] < 0 ? -1 : Math.max(0, this.refillAt[t] - this.now),
      first: this.first[t],
      lost: this.lost[t],
      stations,
    };
  }

  /** A person's name. */
  nameOf(person: number): string {
    const p = this.people[person];
    return p ? personName(p.first, p.last) : "";
  }

  hashInto(out: number[]) {
    if (!this.started) return;
    out.push(this.reserve[0], this.reserve[1], this.refillAt[0], this.refillAt[1], FIRST_KINDS.indexOf(this.first[0]), FIRST_KINDS.indexOf(this.first[1]), this.lost[0], this.lost[1], this.spotterSeen[0] ? 1 : 0, this.spotterSeen[1] ? 1 : 0);
    for (const s of this.run) {
      out.push(s.index);
      for (const t of s.seats) out.push(t.state, t.person, t.minion, t.lostAt, t.due, t.cool, t.seek, t.stuck);
    }
    for (const p of this.people) out.push(p.first, p.last, p.shots);
  }
}
