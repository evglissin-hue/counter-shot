// Messages between the game page and its simulation worker.

import type { RouteName } from "@keepfall/content";
import type { MatchInput, MatchResult } from "@keepfall/rules";
import type { FrameData, SandboxInput, TerrainPatch } from "@keepfall/sim";

/** The Practice range (the sandbox: target castle, a patrol, no rules) or a match against the AI castle. */
export type Mode = "practice" | "versus";

export type ToWorker =
  | { t: "init"; mode: Mode; seed: number; minions: number }
  /** The player's input; in a match it is the player's team's (shots, orders, the barracks' route, the gun you ride). */
  | { t: "input"; input: SandboxInput | MatchInput }
  | { t: "reset"; mode: Mode; seed: number; minions: number }
  /** Sim speed for the shot camera's slow motion (1 = real time). Practice range only. */
  | { t: "speed"; factor: number }
  | { t: "pause"; paused: boolean }
  /** Send the nav grid with frames while it changes (for the overlay). */
  | { t: "nav"; on: boolean }
  /** Test clock: stop following wall time and step only when the page says how far to go. */
  | { t: "manual" }
  | { t: "advance"; seconds: number };

/** A match's state for the HUD. */
export interface MatchInfo {
  tick: number;
  gold: [number, number];
  result: MatchResult | null;
  shots: [number, number];
  /** Pieces of each castle brought down (sent once the match has ended). */
  masonry: [number, number] | null;
  /** Ticks until both barracks send their next waves, and the waves each has sent. */
  nextWave: number;
  waves: [number, number];
  /** The player's barracks route and standing order (Order). */
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
  /** The player's barracks settings per plot: [mix index, route index] (MIX_NAMES, ROUTE_NAMES). */
  barracks: Int8Array;
  /** Every emplacement's gun, match order: [weapon index (-1: empty), upgrade index (-1: none)] (WEAPON_KINDS, UPGRADE_KINDS). */
  arms: Int8Array;
  /** Does each team have a working Foundry? */
  foundry: [boolean, boolean];
}

/** Floats per earning in MatchInfo.earned. */
export const EARN_STRIDE = 6;

/** The nav grid for the overlay: kind and floor height per cell. */
export interface NavInfo {
  version: number;
  kind: Uint8Array;
  floor: Float32Array;
}

export type FromWorker =
  | { t: "ready"; mode: Mode; stones: number; setupMs: number; terrain: TerrainPatch; rulesVersion: number }
  /** stepMs: average physics step; stepPeak: the slowest step in about the last second. */
  | {
      t: "frame";
      frame: FrameData;
      reload: number[];
      stepMs: number;
      stepPeak: number;
      down: number;
      standing: number;
      awake: number;
      match: MatchInfo | null;
      /** Can each bridge still be crossed (layout order), when it changed. */
      bridges: boolean[] | null;
      nav: NavInfo | null;
    }
  | { t: "error"; message: string };
