// The household (phase 3, 3.6), as data: a castle is run by named people at
// stations, and there are only so many of them. Each armed gun has a crew of
// two (a layer and a loader), the masons and the powder boys are stations, and
// so are a bell ringer, a signaller and a spotter (while the spotter's tower
// stands). Six more wait in the keep (the reserve): when a station loses
// someone, the next of the reserve walks out after `walkOut` to take the
// place, and the reserve gains one every `refill` up to `reserve`. With none
// left, the place stays empty. A crew's skill comes from the shots its gun
// has fired with it and replaces part of the dice: scatter and reload by
// skill. The household is outside the cap on men standing and the storm's
// counts, as masons are, and each of them pays a bounty of `bounty`.
//
// Places are in a castle's own frame (castle 0's: centre at the origin, the
// gate side at z = -half) and turned into the world by mirrorZ(); a gun's
// posts are in the gun's own frame (x to the gunner's left looking down the
// barrel, z along it), turned by its base yaw onto the floor it stands on.
// Starting numbers for tuning: everything here is data (docs/phase-3/06-household.md).

import { dcos, dsin } from "@keepfall/core";
import { CASTLE_SHAPE } from "./castle";
import { PLOTS } from "./buildings";
import { keepDoor, powderFoot } from "./powder";
import { mirrorZ } from "./siege";
import type { Emplacement, WeaponKind } from "./weapons";

/** The kinds of station, in their fixed order (StationKind numbers them everywhere: the sim, the page, hashes). */
export type StationName = "gun" | "mason" | "boy" | "bell" | "mast" | "spotter";
export const STATION_NAMES: StationName[] = ["gun", "mason", "boy", "bell", "mast", "spotter"];
export const enum StationKind {
  Gun = 0,
  Mason = 1,
  Boy = 2,
  Bell = 3,
  Mast = 4,
  Spotter = 5,
}

/**
 * Who is replaced first (rule 4): one choice, three settings. Each orders the
 * station groups a free hand of the reserve goes to; within a group, the gun
 * the team rides first, then station order (emplacement, slot), then the
 * place lost longest ago.
 */
export type FirstKind = "guns" | "walls" | "powder";
export const FIRST_KINDS: FirstKind[] = ["guns", "walls", "powder"];
/** For each setting, the groups in the order they are served (the keepers of the bell, mast and spotter's tower go with the guns). */
export const FIRST_ORDER: Record<FirstKind, StationKind[][]> = {
  guns: [[StationKind.Gun, StationKind.Bell, StationKind.Mast, StationKind.Spotter], [StationKind.Mason], [StationKind.Boy]],
  walls: [[StationKind.Mason], [StationKind.Gun, StationKind.Bell, StationKind.Mast, StationKind.Spotter], [StationKind.Boy]],
  powder: [[StationKind.Boy], [StationKind.Gun, StationKind.Bell, StationKind.Mast, StationKind.Spotter], [StationKind.Mason]],
};

/** Skill levels by name, lowest first (a crew's level indexes HOUSEHOLD.skill's lists). */
export const SKILL_NAMES = ["green", "trained", "seasoned", "veteran"] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export const HOUSEHOLD = {
  /** Men at every armed gun: the layer (seat 0) and the loader (seat 1). */
  gunCrew: 2,
  /** People waiting in the keep when a match starts, and the most it holds. */
  reserve: 6,
  /** The reserve gains one every this many ticks while it holds fewer than `reserve` (the clock starts when it drops below). */
  refill: 60 * 60,
  /** A place lost is taken by the next of the reserve this long after (ticks): he walks out of the keep's door then. */
  walkOut: 20 * 60,
  /** A replacement at the foot of a post on a wall, a tower or the keep's roof is hoisted (or climbs) up in this long (ticks), as kegs are. */
  hoist: 3 * 60,
  /** Reload with one of a gun's two crew at it, as a multiple of its own. */
  oneHand: 1.5,
  /** Reload with none of its crew, ridden: your own hands. A gun with no crew never fires on its own. */
  ownHands: 2,
  /**
   * Skill from the shots its gun has fired with him at his post (by hand, on
   * its own or in a salvo): the level is the last of `at` the shots reach.
   * Scatter and reload are multiples of the weapon's own, by level. A crew's
   * level is that of its less skilled man at his post; a gun with none scatters as green.
   */
  skill: {
    at: [0, 10, 30, 60],
    scatter: [1.3, 1.0, 0.8, 0.6],
    reload: [1.1, 1.0, 0.95, 0.9],
  },
  /** Shots the crews of the four guns a castle starts with have behind them (trained). A bought gun's crew and every replacement start at 0 (green). */
  startShots: 10,
  /**
   * The owner's choice (November 16, on the first measurements: the reserve ran dry in a minute or two, mostly to shells
   * aimed at the keep): the household drops flat when a shell or a keg bursts, so a burst knocks one of them down only
   * within this share of the reach it knocks men down in. Balls, the chain, falling masonry and the floor going still do.
   */
  cover: 0.5,
  /** A gun's man stands on the masonry within this far of his post (m; a tower's deck: its ring's top): when under GUN_HITS.mountOut of it stands, he falls. */
  footReach: 0.9,
  /** ... and they keep clear of loose stone: only a stone falling at least this fast (m/s) knocks one of them down (anyone else: about 2.4). */
  stone: 5,
  /** Gold for knocking down one of the household (a soldier pays GOLD.bounty). */
  bounty: 8,
  /** Who is replaced first when a match starts. */
  first: "guns" as FirstKind,
};

/** A crew's skill level (0 green to 3 veteran) for this many shots. */
export function skillLevel(shots: number): number {
  const at = HOUSEHOLD.skill.at;
  let k = 0;
  for (let i = 1; i < at.length; i++) if (shots >= at[i]) k = i;
  return k;
}

/**
 * Reload of a gun as a multiple of its own, by its crew: `crew` men at their
 * posts (0, 1 or 2), at skill `level`. With none it is ridden by your own
 * hands (a gun with no crew does not fire on its own).
 */
export function crewReload(crew: number, level: number): number {
  if (crew <= 0) return HOUSEHOLD.ownHands;
  const k = HOUSEHOLD.skill.reload[level] ?? 1;
  return crew === 1 ? HOUSEHOLD.oneHand * k : k;
}

/** Scatter of a gun as a multiple of its weapon's own, by its crew (none: green). */
export function crewScatter(crew: number, level: number): number {
  return crew <= 0 ? HOUSEHOLD.skill.scatter[0] : (HOUSEHOLD.skill.scatter[level] ?? 1);
}

/**
 * Where a gun's two crew stand, in the gun's own frame (x to the gunner's
 * left looking down the barrel, z along it, metres): [layer, loader], on the
 * floor the gun stands on (the wall walk, the tower top's deck, the pit). The
 * same places the page's crews rest at (look round L1), clear of the carriage.
 * (Moved in the sim's build of 3.6 so that no post overlaps a stone, a wall
 * walk's merlons and the keep's buttresses included: on a wall walk both men
 * stand on the strip behind the parapet, 1.5 to 1.75 m behind the pivot; the
 * mortar's crew stand clear of the keep's front buttresses. Tested in
 * packages/rules/test/household.test.ts.)
 */
export const CREW_POSTS: Record<WeaponKind, [[number, number], [number, number]]> = {
  longGun: [[-1.25, -1.75], [1.55, -1.7]],
  chainShot: [[-1.1, -1.7], [1.7, -1.7]],
  mortar: [[-1.2, -0.2], [1.4, -0.5]],
  swivel: [[-0.7, -1.5], [0.7, -1.5]],
};

/** A gun's post for a seat, in the world (x, z): its frame turned by the emplacement's base yaw. The height is the gun's floor (sim: mountFloor). */
export function crewPostXZ(e: Emplacement, seat: number): { x: number; z: number } {
  const [px, pz] = CREW_POSTS[e.weapon][seat === 0 ? 0 : 1];
  // The gun's frame: z along the barrel (yaw 0 faces +z), x to its left.
  const c = dcos(e.baseYaw), s = dsin(e.baseYaw);
  return { x: e.x + px * c + pz * s, z: e.z - px * s + pz * c };
}

/**
 * The keepers' posts (castle 0's frame, metres; y is the floor they stand on):
 * the bell ringer on the back right tower's top beside the bell (the tower's
 * deck, as a tower gun's crew stands on), the signaller on the keep's roof
 * beside the mast, the spotter on his tower's platform (over the plot's
 * middle). The bell's tower is castle 0's +x, castle 1's -x (organs.ts).
 */
export const KEEPER_POSTS = {
  bell: { x: 13.6, y: 12, z: 13.6 },
  mast: { x: 0.6, y: 20, z: 5.4 },
  /** Over the plot's middle, this high. */
  spotterY: 12.1,
} as const;

/** A keeper's post in the world (x, y, z). `plot` is the spotter's tower's plot (else ignored). */
export function keeperPost(castle: number, kind: StationKind.Bell | StationKind.Mast | StationKind.Spotter, plot = 0): { x: number; y: number; z: number } {
  if (kind === StationKind.Bell) {
    const p = KEEPER_POSTS.bell;
    return { x: castle === 0 ? p.x : -p.x, y: p.y, z: mirrorZ(castle, p.z) };
  }
  if (kind === StationKind.Mast) {
    const p = KEEPER_POSTS.mast;
    return { x: p.x, y: p.y, z: mirrorZ(castle, p.z) };
  }
  const pl = PLOTS[plot];
  return { x: pl.x, y: KEEPER_POSTS.spotterY, z: mirrorZ(castle, pl.z) };
}

/** Where a replacement is hoisted up to a post from (world x, z): a gun's powder foot, the bell tower's courtyard side, the keep's door, the spotter's tower's courtyard side. */
export function postFoot(castle: number, kind: StationKind, e: Emplacement | null, plot = 0): { x: number; z: number } {
  const T = CASTLE_SHAPE.half;
  if (kind === StationKind.Gun && e) return powderFoot(e);
  if (kind === StationKind.Bell) return { x: castle === 0 ? T - 3.54 : -T + 3.54, z: mirrorZ(castle, T - 3.54) };
  if (kind === StationKind.Spotter) {
    const p = PLOTS[plot];
    return { x: p.x > 0 ? p.x - p.w / 2 - 0.9 : p.x + p.w / 2 + 0.9, z: mirrorZ(castle, p.z) };
  }
  return keepDoor(castle);
}

/**
 * Names, drawn from a stream of their own as people join (the start's
 * household in station order, then each replacement as he walks out): a
 * first name and a surname. The notes use them: "Tam Greaves, layer of the
 * long gun, is down."
 */
export const HOUSEHOLD_NAMES = {
  first: [
    "Tam", "Wat", "Hob", "Dick", "Jack", "Rob", "Will", "Hal", "Ned", "Kit", "Ralf", "Gib", "Col", "Dun", "Piers", "Simkin",
    "Jenkin", "Hodge", "Lewin", "Osric", "Bran", "Eadric", "Godric", "Alard", "Ivo", "Odo", "Reyner", "Tibbe", "Wilkin", "Adam", "Ellis", "Sander",
  ],
  last: [
    "Greaves", "Ashby", "Cole", "Fletcher", "Thatcher", "Mott", "Pike", "Rook", "Hale", "Dunn", "Brack", "Croft", "Tanner", "Wright", "Sawyer", "Loder",
    "Barrow", "Fenn", "Holt", "Marsh", "Stone", "Cobb", "Ward", "Hayes", "Parr", "Ruck", "Slade", "Thorne", "Weller", "Yeo", "Booker", "Cotter",
  ],
} as const;

/** A person's name from its two indices. */
export function personName(first: number, last: number): string {
  const F = HOUSEHOLD_NAMES.first, L = HOUSEHOLD_NAMES.last;
  return `${F[((first % F.length) + F.length) % F.length]} ${L[((last % L.length) + L.length) % L.length]}`;
}

/** What a seat is called in a note ("layer of the long gun", "mason", "bell ringer"). `weapon` names a gun's weapon. */
export function seatTitle(kind: StationKind, seat: number, weapon?: WeaponKind): string {
  const gun: Record<WeaponKind, string> = { longGun: "the long gun", mortar: "the mortar", chainShot: "the chain shot", swivel: "the swivel" };
  switch (kind) {
    case StationKind.Gun:
      return `${seat === 0 ? "layer" : "loader"} of ${weapon ? gun[weapon] : "a gun"}`;
    case StationKind.Mason:
      return "mason";
    case StationKind.Boy:
      return "powder boy";
    case StationKind.Bell:
      return "bell ringer";
    case StationKind.Mast:
      return "signaller";
    default:
      return "spotter";
  }
}
