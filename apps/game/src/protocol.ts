// Messages between the game page and its simulation worker.

import type { Difficulty, RepairKind, RouteName } from "@keepfall/content";
import type { MatchInput, MatchResult, TeamStats } from "@keepfall/rules";
import type { FrameData, SandboxInput, TerrainPatch } from "@keepfall/sim";
import type { NetState } from "./lockstep";
import type { ReplayFile } from "./matchLog";

/**
 * The Practice range (the sandbox: target castle, a patrol, no rules), a match
 * against the AI castle, one against a friend online (M5), or the guided first
 * match against the tutor (M6: GUIDED_OPTIONS in @keepfall/rules).
 */
/** "watch" (S6): a saved match played again from its log (no AI, no lockstep; the file rides in `replay`). */
export type Mode = "practice" | "versus" | "online" | "guided" | "watch";

/** How a match is set up: against the AI at a difficulty, or online as one team (the other is the friend's). */
export interface MatchSetup {
  difficulty?: Difficulty;
  /** The team this page plays (online; Versus AI is always team 1, the castle at z = -DIST). */
  team?: 0 | 1;
  /** Online: the input delay to start with (ticks). */
  delay?: number;
}

export type ToWorker =
  /** A new world. `gen` numbers it: every message the worker sends carries the world's number, so the page drops what an old world said. */
  | { t: "init"; gen: number; mode: Mode; seed: number; minions: number; setup?: MatchSetup; replay?: ReplayFile }
  /** The player's input; in a match it is the player's team's (shots, orders, the barracks' route, the gun you ride). */
  | { t: "input"; input: SandboxInput | MatchInput }
  | { t: "reset"; gen: number; mode: Mode; seed: number; minions: number; setup?: MatchSetup; replay?: ReplayFile }
  /** Online: the page left the match (the lobby, the menu): the old world stops and says nothing more to the friend. */
  | { t: "netStop" }
  /** Online (M5): what the friend's page said (its lockstep state), and a new input delay. */
  | { t: "net"; state: NetState; now: number; rtt: number }
  | { t: "delay"; ticks: number }
  /** Online (M5): the friend has gone; the AI takes their castle at this difficulty and the match goes on here alone. */
  | { t: "takeover"; difficulty: Difficulty }
  /** Sim speed for the shot camera's slow motion (1 = real time). Practice range only. */
  | { t: "speed"; factor: number }
  | { t: "pause"; paused: boolean }
  /** S6: write the match's replay file now (the match goes on); the worker answers with `log`. */
  | { t: "saveLog" }
  /** Send the nav grid with frames while it changes (for the overlay). */
  | { t: "nav"; on: boolean }
  /** Test tools only: a wave of a team's pikemen at a point (not an input: a match with it does not replay). */
  | { t: "spawn"; team: 0 | 1; count: number; x: number; z: number; ladder?: boolean }
  /** Test clock: stop following wall time and step only when the page says how far to go. */
  | { t: "manual" }
  | { t: "advance"; seconds: number };

/** 3.2: one of the page's own team's marks (never the other side's). */
export interface MarkInfo {
  /** Its place, 1 to 6. */
  n: number;
  x: number;
  y: number;
  z: number;
  /** The tick it was made (the newest has the largest). */
  made: number;
  /** Ticks left before it fades, and its whole life. */
  left: number;
  life: number;
  /** From where it lies, as this page's player sees it ("Left bridge", "Their gate", "Field"). */
  place: string;
  /** How many of your guns would fire in a salvo at it now: without the mortar, and with it. */
  bear: number;
  bearM: number;
  /** The same counts if loading did not matter (guns that reach it but may be reloading), and the soonest reload among them in seconds (0: none reloading). */
  reach: number;
  reachM: number;
  loadS: number;
  loadMS: number;
  /** Why nothing could reach it, when the rules hold fire there: one of your own men stands by it ("own"), or a bridge is in the way of the shot ("bridge"). "" otherwise. */
  why: "" | "own" | "bridge";
}

/** 3.2: one of the page's own team's bridge gangs (state: GangState; bridge: index into the layout's bridges). */
export interface GangInfo {
  bridge: number;
  state: number;
  men: number;
  progress: number;
}

/** 3.2: the page's own team's register: its marks, when the next salvo may be ordered, and which emplacements' last landings may be marked now. */
export interface RegisterInfo {
  marks: MarkInfo[];
  /** Ticks until the team's next salvo may be ordered (0: now). */
  salvoReady: number;
  /** The match ids of the guns whose last shot by hand may be marked now. */
  canMark: number[];
  /** The team's bridge gangs at work or on their way. */
  gangs: GangInfo[];
}

/** 3.3: one castle's powder store (charges), as the page shows it by the gold. */
export interface PowderInfo {
  stock: number;
  /** What the store holds now (the magazine's, or the cellar's without a working one). */
  cap: number;
  /** Charges a second coming in (the cellar and the mills). */
  rate: number;
  /** The plot of the working magazine, or -1 (the cellar holds the powder). */
  magazine: number;
  /** Charges lost because the store was full, since the match began. */
  lost: number;
}

/** Numbers per emplacement in MatchInfo.boxes: box now, box size, a shot's cost, ticks until the next keg reaches it (-1: none on its way), share of a hoist done at its foot (-1: none at work). */
export const BOX_STRIDE = 5;
/** Numbers per powder boy in MatchInfo.boys: team, minion id (-1 fallen), task (sim BoyTask), emplacement served (-1 none). */
export const BOY_STRIDE = 4;

/** A match's state for the HUD. Pairs are by team (castle): the page's own is `team`. */
export interface MatchInfo extends RegisterInfo {
  /** The team this page plays. */
  team: 0 | 1;
  tick: number;
  gold: [number, number];
  result: MatchResult | null;
  shots: [number, number];
  /** Pieces of each castle brought down (sent once the match has ended). */
  masonry: [number, number] | null;
  /** Ticks until both barracks send their next waves, and the waves each has sent. */
  nextWave: number;
  waves: [number, number];
  /** This page's team's barracks route and standing order (Order). */
  route: RouteName;
  order: number;
  /** Each team's pikemen standing and fallen. */
  standing: [number, number];
  fallen: [number, number];
  /** Shots each team's unmanned weapons fired. */
  autoShots: [number, number];
  /** Every emplacement's barrel as it points: yaw, pitch per emplacement (match order). */
  guns: Float32Array;
  /** Blows each castle's gate has taken (both leaves), and whether it is open (a leaf down). */
  gateHits: [number, number];
  gateOpen: [boolean, boolean];
  /** Per castle: ticks its enemy has held its courtyard (stormHold storms it), and the fighting men of each side inside it. */
  storm: [number, number];
  stormHold: number;
  attackers: [number, number];
  defenders: [number, number];
  /** Each courtyard's garrison standing. */
  garrison: [number, number];
  /** 15:00 on: income doubled, reloads faster. */
  suddenDeath: boolean;
  /** This page's team's repair switches. */
  repairs: Record<RepairKind, boolean>;
  /** Each castle's masons: the section they rebuild (empty: none), pieces left there, why they wait (WorksHold), masons standing, stones put back. */
  masons: [MasonInfo, MasonInfo];
  /** Ladders standing against each castle's walls now. */
  ladders: [number, number];
  /** Pieces of each castle down now (sent every second or so; null between). */
  down: [number, number] | null;
  /** What each team did (sent once the match has ended). */
  stats: [TeamStats, TeamStats] | null;
  // M3: gold coming in, what is built and bought.
  /** Gold a second each team earns now (its keep and its working mills). */
  income: [number, number];
  /** Earnings since the last frame, EARN_STRIDE each: [team, amount, kind (content Earn), x, y, z]. */
  earned: Float32Array;
  /** Gold each team has earned (income included) and spent so far. */
  goldEarned: [number, number];
  goldSpent: [number, number];
  /** Trick shots each team has made, by kind (Earn.Ricochet .. Earn.KeepHit: four numbers). */
  tricks: [number[], number[]];
  /** This page's team's barracks settings per plot: [mix index, route index] (MIX_NAMES, ROUTE_NAMES). */
  barracks: Int8Array;
  /** Every emplacement's gun, match order: [weapon index (-1: empty), upgrade index (-1: none)] (WEAPON_KINDS, UPGRADE_KINDS). */
  arms: Int8Array;
  /** Does each team have a working Foundry? */
  foundry: [boolean, boolean];
  /**
   * Each keep's floors still under its banner: 3 on the roof, 2 and 1 on the
   * floors below it, 0 once it is falling to the ground (read from the
   * banner's body, for the HUD only).
   */
  keeps: [number, number];
  /** How sound the floor under each banner still is, 0 to 1 (cracked boards count a half). */
  keepFloor: [number, number];
  /** M6: per team and road (ROUTE_NAMES order), LANE_STRIDE numbers (threat.ts): men marching, kegs, muskets, ladders, metres to the enemy front wall (-1: nobody), flags. */
  lanes: Int16Array;
  /** M6: the guided match's tutor: its stage (AiPlayer.stage: 0 asleep, higher as it wakes); -1 in any other match. */
  tutor: number;
  /** 3.3: each castle's powder store by team (null when the match plays without powder: every box is then full), every emplacement's ready box (BOX_STRIDE each, match order) and every powder boy's errand (BOY_STRIDE each). */
  powder: [PowderInfo, PowderInfo] | null;
  boxes: Float32Array | null;
  boys: Int16Array | null;
}

export interface MasonInfo {
  job: string;
  left: number;
  hold: number;
  up: number;
  laid: number;
}

/** Floats per earning in MatchInfo.earned. */
export const EARN_STRIDE = 6;

/** The nav grid for the overlay: kind and floor height per cell. */
export interface NavInfo {
  version: number;
  kind: Uint8Array;
  floor: Float32Array;
}

export type FromWorker = { gen?: number } & (
  | { t: "ready"; mode: Mode; stones: number; setupMs: number; terrain: TerrainPatch; rulesVersion: number }
  /** stepMs: average physics step; stepPeak: the slowest step in about the last second. */
  | {
      t: "frame";
      frame: FrameData;
      reload: number[];
      /**
       * After M5: every emplacement's gun, two numbers each: 0 up (or an empty
       * slot whose masonry stands), else 1 its crew is getting it back, 2 the
       * masonry under it is down, 3 its side has no gold; then the ticks left
       * before its crew could have it back.
       */
      out: Int16Array;
      stepMs: number;
      stepPeak: number;
      down: number;
      standing: number;
      awake: number;
      match: MatchInfo | null;
      /** 3.2: the Practice range's register (a match carries its own in `match`); null in a match. */
      reg: RegisterInfo | null;
      /** Can each bridge still be crossed (layout order), when it changed. */
      bridges: boolean[] | null;
      /**
       * For the minimap, twice a second: per castle SECTION_COUNT (30) sections (minimap.ts: the four walls in six cells each, the gate, the four
       * towers, the keep), two bytes each: the share standing and the share of its foot standing (0 to 100). Index: (castle * SECTION_COUNT + section) * 2.
       */
      sections: Uint8Array | null;
      nav: NavInfo | null;
    }
  | { t: "error"; message: string }
  /** S6: the replay file asked for by saveLog. */
  | { t: "log"; text: string }
  /** S6: a replay being watched has reached the saved match's last tick; `ok`: its hash is the saved one. */
  | { t: "watchEnd"; tick: number; hash: { state: string; world: string }; ok: boolean }
  /**
   * Online (M5): this side's lockstep state for the friend's page, how long the
   * match has been waiting for the friend (ms), the input delay, inputs not yet
   * acknowledged, and the tick where the two sides first disagreed (null: none).
   */
  | { t: "net"; state: NetState; waiting: number; delay: number; unacked: number; desync: number | null }
);
