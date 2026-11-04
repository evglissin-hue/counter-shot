// Messages between the sandbox page and its simulation worker.

import type { FrameData, SandboxInput, TerrainPatch } from "@keepfall/sim";

export type ToWorker =
  | { t: "init"; seed: number; minions: number }
  | { t: "input"; input: SandboxInput }
  | { t: "reset"; seed: number; minions: number }
  /** Sim speed for the shot camera's slow motion (1 = real time). Sandbox only. */
  | { t: "speed"; factor: number }
  | { t: "pause"; paused: boolean };

export type FromWorker =
  | { t: "ready"; stones: number; setupMs: number; terrain: TerrainPatch; rulesVersion: number }
  | { t: "frame"; frame: FrameData; reload: number[]; stepMs: number; down: number; standing: number; awake: number }
  | { t: "error"; message: string };
