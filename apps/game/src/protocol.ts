// Messages between the game page and its simulation worker.

import type { BuildingKind, MixName, RouteName, WeaponKind } from "@keepfall/content";
import type { MatchInput, MatchNote, MatchResult } from "@keepfall/rules";
import type { FrameData, SandboxInput, TerrainPatch } from "@keepfall/sim";

/** One plot of either courtyard, as the HUD and the build menu show it. */
export interface PlotView {
  team: 0 | 1;
  plot: number;
  kind: BuildingKind | null;
  /** PlotState: 0 empty, 1 going up, 2 working, 3 down. */
  state: number;
  /** How far up it is (0..1), and the share of what is up that still stands. */
  progress: number;
  standing: number;
  route: RouteName;
  mix: MixName;
}

/** One gun slot (by emplacement id): the gun in it (or the one it would be drawn with), and its state. */
export interface SlotView {
  weapon: WeaponKind;
  armed: boolean;
  down: boolean;
  heavy: boolean;
  rifled: boolean;
  /** The pivot's height and the barrel (they change with the gun). */
  y: number;
  barrel: number;
}

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
  /** The player's gold a second (keep and mills). */
  income: number;
  /** Both courtyards' plots (enemy first) and every gun slot (emplacement order). */
  plots: PlotView[];
  slots: SlotView[];
  /** Gold the player earned since the last frame, with the reason and where. */
  gains: Array<{ amount: number; why: string; x: number; y: number; z: number }>;
  /** Buildings done or knocked down, guns knocked out (either side), since the last frame. */
  notes: MatchNote[];
  /** Which floor each keep's banner stands on: 3 the roof, 2 and 1 the timber floors, 0 the ground (toppled). */
  keepFloor: [number, number];
  /** Gold the player earned by source (sent once the match has ended). */
  earned: Record<string, number> | null;
}

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
