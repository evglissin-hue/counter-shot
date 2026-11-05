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
  | { mode: "follow"; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  /** Placed by the page (the mortar's observer and its ride): eye position, the point it looks at, field of view. */
  | { mode: "free"; x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number };

/** The first thing a predicted flight hits. */
export interface PathHit {
  /** Index of the path point just before the hit. */
  index: number;
  x: number;
  y: number;
  z: number;
  /** Stone id, or -1 for the ground. */
  stone: number;
  /** Surface normal at the hit. */
  nx: number;
  ny: number;
  nz: number;
}

/** Where the camera is, for sound: position, right and forward unit vectors. */
export interface Listener {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  fx: number;
  fy: number;
  fz: number;
}

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
  /** Where the shot will land (or the last one landed). A blast radius (m) adds a faint ring for the area it reaches. */
  setLandingMarker(p: { x: number; y: number; z: number; nx?: number; ny?: number; nz?: number } | null, blastRadius?: number): void;
  /** The first stone or ground a path (xyz triples) runs into, or null. */
  castPath(points: Float32Array): PathHit | null;
  /** Slow motion for the cosmetic layer (1 = real time). The camera keeps real time. */
  setTimeScale(scale: number): void;
  /** The camera, for positional sound. */
  listener(): Listener;

  /** World point under a screen point (terrain or masonry), for the overview. */
  pick(clientX: number, clientY: number): { x: number; y: number; z: number } | null;
  render(dtSeconds: number): void;
  getStats(): RenderStats;
  dispose(): void;
}
