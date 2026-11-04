// The contract between the sandbox page (main.ts, input, HUD) and the
// renderer. The page owns game state; the renderer only draws what it is told.
// Coordinates are metres, Y up; see @keepfall/content for the layout and
// @keepfall/sim (frame.ts) for the flat array formats.

import type { CastleLayout, Emplacement } from "@keepfall/content";
import type { FrameData, TerrainPatch } from "@keepfall/sim";

export type QualityTier = "low" | "medium" | "high" | "ultra";

/** Where the camera is. The page decides; the renderer eases between poses. */
export type CameraPose =
  /** Behind the weapon's sight: eye position, aim yaw and pitch (radians, yaw 0 = +Z), field of view in degrees. */
  | { mode: "sight"; x: number; y: number; z: number; yaw: number; pitch: number; fov: number }
  /** Free overview: orbit controls around both castles (mouse drag, wheel, touch). */
  | { mode: "overview" }
  /** Chase a projectile: its position and velocity. */
  | { mode: "follow"; x: number; y: number; z: number; vx: number; vy: number; vz: number };

export interface RenderStats {
  backend: "WebGPU" | "WebGL2";
  gpuMs: number | null;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  width: number;
  height: number;
}

export interface GameRendererApi {
  init(opts?: { forceWebGL?: boolean }): Promise<{ backend: "WebGPU" | "WebGL2" }>;
  /** Called if the graphics device is lost after init. */
  onDeviceLost: ((message: string) => void) | null;
  /** Castle 1 is the Ashwright castle (brick), castle 0 the granite target. */
  setLayout(layout: CastleLayout, emplacements: Emplacement[]): void;
  setQuality(tier: QualityTier): void;
  /** Gore on or off (blood decals). Cosmetic only. */
  setGore(on: boolean): void;
  resize(): void;

  /** Everything the sim reported since the last frame. Events are fired once. */
  applyFrame(frame: FrameData): void;
  /** Applied once at start and again for craters. */
  applyTerrain(patches: TerrainPatch[]): void;
  /** Rebuild stones after a sandbox reset. */
  resetWorld(): void;

  /** Turn a weapon model to its current aim (radians). `active` highlights the one you ride. */
  setWeaponPose(emplacement: number, yaw: number, pitch: number, active: boolean): void;
  setCamera(pose: CameraPose): void;

  /** Aim help, as xyz triples; null hides. Partial predicted arc (cold white, outlined). */
  setAimArc(points: Float32Array | null): void;
  /** The last shot's flight from this emplacement (faint). */
  setGhostTrail(points: Float32Array | null): void;
  /** Where the last shot from this emplacement first landed. */
  setLandingMarker(p: { x: number; y: number; z: number } | null): void;

  /** World point under a screen point (terrain or masonry), for the overview. */
  pick(clientX: number, clientY: number): { x: number; y: number; z: number } | null;
  render(dtSeconds: number): void;
  getStats(): RenderStats;
  dispose(): void;
}
