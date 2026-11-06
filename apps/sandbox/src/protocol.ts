// Messages between the sandbox page and its simulation worker.

import type { FrameData, SandboxInput, TerrainPatch } from "@keepfall/sim";

export type ToWorker =
  | { t: "init"; seed: number; minions: number }
  | { t: "input"; input: SandboxInput }
  | { t: "reset"; seed: number; minions: number }
  /** Sim speed for the shot camera's slow motion (1 = real time). Sandbox only. */
  | { t: "speed"; factor: number }
  | { t: "pause"; paused: boolean }
  /** Test clock: stop following wall time and step only when the page says how far to go. */
  | { t: "manual" }
  | { t: "advance"; seconds: number };

export type FromWorker =
  | { t: "ready"; stones: number; setupMs: number; terrain: TerrainPatch; rulesVersion: number }
  /** stepMs: average physics step; stepPeak: the slowest step in about the last second. */
  | { t: "frame"; frame: FrameData; reload: number[]; stepMs: number; stepPeak: number; down: number; standing: number; awake: number }
  | { t: "error"; message: string };
