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
  FIRST_KINDS,
  HOUSEHOLD,
  crewReload,
  crewScatter,
  personName,
  skillLevel,
  StationKind,
  type Emplacement,
  type FirstKind,
} from "@keepfall/content";
import { hashString, Rng } from "@keepfall/core";
import type { Emit } from "./army";

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
  /** The names' stream: drawn only when a person joins. */
  private names: Rng;

  constructor(
    protected emplacements: Emplacement[],
    seed: number,
    protected emit: Emit,
  ) {
    this.names = new Rng((hashString("household") ^ seed) >>> 0);
  }

  /** Men of a gun's crew at their posts now (0 to 2; 0 for an empty slot). */
  crew(emp: number): number {
    const e = this.emplacements[emp];
    return !e || e.empty ? 0 : HOUSEHOLD.gunCrew;
  }

  /** The skill level of a gun's crew at their posts (0 green to 3 veteran; 0 with none). */
  level(emp: number): number {
    void emp;
    return skillLevel(HOUSEHOLD.startShots);
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
    void emp;
  }

  /** A gun was bought for this emplacement: its crew of two, green and new, at their posts. */
  armed(emp: number): void {
    void emp;
  }

  /** Is a team's keeper of the bell, the mast or the spotter's tower at his post? */
  keeper(team: number, kind: StationKind.Bell | StationKind.Mast | StationKind.Spotter): boolean {
    void team;
    void kind;
    return true;
  }

  /** Set who a team replaces first (refused: anything not in FIRST_KINDS). */
  setFirst(team: number, first: FirstKind): void {
    if ((team === 0 || team === 1) && FIRST_KINDS.includes(first)) this.first[team] = first;
  }

  /** Works or Carriers: one of a team's masons or powder boys (by slot) is down; his seat comes due. */
  lostWorker(team: number, kind: StationKind.Mason | StationKind.Boy, slot: number, tick: number): void {
    void team;
    void kind;
    void slot;
    void tick;
  }

  /** Before the physics step: the reserve's clock, replacements walking out, walkers walking, hoists, men placed at their posts. */
  step(tick: number): void {
    void tick;
  }

  /** After the physics step: who is down (seats come due), men whose masonry fell under them, keepers whose organ or tower went down. */
  afterStep(tick: number): void {
    void tick;
  }

  /** The station index a minion holds a seat at (-1: none), for the page and tools. */
  stationOf(minion: number): number {
    void minion;
    return -1;
  }

  /** Per emplacement, CREW_STRIDE numbers (men at its posts, level, replacements on the way). */
  report(out: Int8Array): void {
    for (let i = 0; i < this.emplacements.length; i++) {
      out[i * CREW_STRIDE] = this.crew(i);
      out[i * CREW_STRIDE + 1] = this.level(i);
      out[i * CREW_STRIDE + 2] = 0;
    }
  }

  /** A team's roster for its own page. */
  roster(team: number): HouseholdRoster {
    return { reserve: this.reserve[team] ?? 0, max: HOUSEHOLD.reserve, refillIn: -1, first: this.first[team] ?? HOUSEHOLD.first, lost: this.lost[team] ?? 0, stations: [] };
  }

  /** A person's name. */
  nameOf(person: number): string {
    const p = this.people[person];
    return p ? personName(p.first, p.last) : "";
  }

  hashInto(out: number[]) {
    out.push(this.reserve[0], this.reserve[1], this.refillAt[0], this.refillAt[1], FIRST_KINDS.indexOf(this.first[0]), FIRST_KINDS.indexOf(this.first[1]), this.lost[0], this.lost[1]);
    for (const s of this.stations) for (const t of s.seats) out.push(t.state, t.person, t.minion, t.lostAt, t.due, t.cool);
    for (const p of this.people) out.push(p.first, p.last, p.shots);
    void this.names;
  }
}
