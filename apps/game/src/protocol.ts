// Messages between the game page and its simulation worker.

import type { Difficulty, RepairKind, RouteName } from "@keepfall/content";
import type { MatchInput, MatchResult, TeamStats } from "@keepfall/rules";
import type { FrameData, SandboxInput, TerrainPatch } from "@keepfall/sim";
import type { NetState } from "./lockstep";

/**
 * The Practice range (the sandbox: target castle, a patrol, no rules), a match
 * against the AI castle, one against a friend online (M5), or the guided first
 * match against the tutor (M6: GUIDED_OPTIONS in @keepfall/rules).
 */
export type Mode = "practice" | "versus" | "online" | "guided";

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
  | { t: "init"; gen: number; mode: Mode; seed: number; minions: number; setup?: MatchSetup }
  /** The player's input; in a match it is the player's team's (shots, orders, the barracks' route, the gun you ride). */
  | { t: "input"; input: SandboxInput | MatchInput }
  | { t: "reset"; gen: number; mode: Mode; seed: number; minions: number; setup?: MatchSetup }
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
  /** Send the nav grid with frames while it changes (for the overlay). */
  | { t: "nav"; on: boolean }
  /** Test tools only: a wave of a team's pikemen at a point (not an input: a match with it does not replay). */
  | { t: "spawn"; team: 0 | 1; count: number; x: number; z: number; ladder?: boolean }
  /** Test clock: stop following wall time and step only when the page says how far to go. */
  | { t: "manual" }
  | { t: "advance"; seconds: number };

/** A match's state for the HUD. Pairs are by team (castle): the page's own is `team`. */
export interface MatchInfo {
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
  /** M6: the guided match's tutor: its stage (AiPlayer.stage: 0 asleep, higher as it wakes); -1 in any other match. */
  tutor: number;
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
      /** Can each bridge still be crossed (layout order), when it changed. */
      bridges: boolean[] | null;
      /** For the minimap, twice a second: per castle and section (minimap.ts), the share standing and the share of its foot standing (0 to 100). */
      sections: Uint8Array | null;
      nav: NavInfo | null;
    }
  | { t: "error"; message: string }
  /**
   * Online (M5): this side's lockstep state for the friend's page, how long the
   * match has been waiting for the friend (ms), the input delay, inputs not yet
   * acknowledged, and the tick where the two sides first disagreed (null: none).
   */
  | { t: "net"; state: NetState; waiting: number; delay: number; unacked: number; desync: number | null }
);
