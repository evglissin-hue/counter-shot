// Messages between the game page and its simulation worker.

import type { MatchResult } from "@keepfall/rules";
import type { FrameData, SandboxInput, TerrainPatch } from "@keepfall/sim";

/** The Practice range (the sandbox: target castle, a patrol, no rules) or a match against the AI castle. */
export type Mode = "practice" | "versus";

export type ToWorker =
  | { t: "init"; mode: Mode; seed: number; minions: number }
  /** The player's input; in a match it is the player's team's. */
  | { t: "input"; input: SandboxInput }
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
