// The contract between the sandbox page (main.ts, input, HUD) and the
// renderer. The page owns game state; the renderer only draws what it is told.
// Coordinates are metres, Y up; see @keepfall/content for the layout and
// @keepfall/sim (frame.ts) for the flat array formats.

import type { CastleLayout, Emplacement } from "@keepfall/content";
import type { FrameData, TerrainPatch } from "@keepfall/sim";
import type { PowderInfo } from "../protocol";
import type { KeyframePart, RenderKeyframe } from "./keyframe";
export type { KeyframePart, RenderKeyframe } from "./keyframe";

export type QualityTier = "low" | "medium" | "high" | "ultra";

/** Where the camera is. The page decides; the renderer eases between poses. */
export type CameraPose =
  /** Behind the weapon's sight: eye position, aim yaw and pitch (radians, yaw 0 = +Z), field of view in degrees. */
  | { mode: "sight"; x: number; y: number; z: number; yaw: number; pitch: number; fov: number }
  /** Free overview: orbit controls around both castles (mouse drag, wheel, touch). */
  | { mode: "overview" }
  /** Chase a projectile: its position and velocity. */
  | { mode: "follow"; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  /** Placed by the page (the mortar's spotter and its ride): eye position, the point it looks at, field of view. */
  | { mode: "free"; x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number; /** Set the field of view at once instead of easing to it (a replay's camera). */ snap?: boolean };

/** The impact cam's camera: eye position, the point it looks at, field of view in degrees. */
export interface InsetPose {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  fov: number;
}

/** A rectangle on the canvas in CSS pixels from its top left. */
export interface InsetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

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

  /** Everything the sim reported in one frame (stones at their exact positions, minions, events). Events are fired once. Projectiles come through setProjectiles. */
  applyFrame(frame: FrameData): void;
  /** Projectiles to draw now (drawn between sim frames by the page), in the frame format. */
  setProjectiles(proj: Float32Array, count: number, chains: Float32Array, chainCount: number): void;
  /** Loose stones drawn between sim frames: [id, x, y, z, qx, qy, qz, qw] each. */
  setStones(data: Float32Array, count: number): void;
  /** Applied once at start and again for craters. */
  applyTerrain(patches: TerrainPatch[]): void;
  /** Rebuild stones after a sandbox reset. */
  resetWorld(): void;

  /** Turn a weapon model to its current aim (radians). `active` highlights the one you ride. */
  setWeaponPose(emplacement: number, yaw: number, pitch: number, active: boolean): void;
  /**
   * Look round L1: every gun's reload as the match reports it, ticks left per match emplacement id (the page's `reload`
   * array as it is). The renderer turns it into a reload stage for the gun's recoil (the gun rolls back on a shot, stays
   * back while loading and is run out again late in the reload) and, for the crew round, the gun's crew.
   */
  setReloads(left: ArrayLike<number>): void;
  /**
   * Look round L1: how full a gun's ready box is, for the kegs standing in the powder box beside it: none for 0 charges,
   * else the share of `capacity` rounded up, at most four. `setPowder` calls it for every gun from its ready box (3.3);
   * a match without powder shows four.
   */
  setReadyBox(emplacement: number, charges: number, capacity: number): void;
  setCamera(pose: CameraPose): void;
  /**
   * The gunner's glass (L1.6): how much the view is a telescope, 0 (none) to 1 (full): the haze cut by a third inside it,
   * a soft dark ring round it, the edge blurred a little. The renderer eases towards `target` at the rate the field of view
   * eases. Call it after setCamera: a setCamera without a setGlass after it takes the glass back to 0.
   */
  setGlass(target: number): void;

  /** Aim help, as xyz triples; null hides. Partial predicted arc (cold white, outlined). */
  setAimArc(points: Float32Array | null): void;
  /** The last shot's flight from this emplacement (faint). */
  setGhostTrail(points: Float32Array | null): void;
  /** Where the shot will land (or the last one landed). A blast radius (m) adds a faint ring for the area it reaches. */
  setLandingMarker(p: { x: number; y: number; z: number; nx?: number; ny?: number; nz?: number } | null, blastRadius?: number): void;
  /** The first stone or ground a path (xyz triples) runs into, or null. */
  castPath(points: Float32Array): PathHit | null;
  /**
   * After M5: the mortar's marks: its bearing (dashes along the ground from
   * `near` to `far` metres out along the unit direction dx, dz) and the charge
   * ring where the shell would come down (soft, or sharp with a burst's reach
   * as its radius). Nulls hide them.
   */
  setMortarAim(bearing: { x: number; z: number; dx: number; dz: number; near: number; far: number } | null, ring: { x: number; y: number; z: number } | null, radius: number, soft: boolean): void;
  /** The ground's height under a point as drawn (craters included). */
  groundAt(x: number, z: number): number;
  /** After M5: a gun knocked out (it tips over, or with `fell` falls with its masonry) or back on its mount. */
  setGunOut(emplacement: number, out: boolean, fell?: boolean): void;
  /**
   * The impact cam: draw the same world from `pose` into `rect` of the canvas after the main view (null pose: closed).
   * `swapped` draws the main view from the inset's pose and the inset from the gun's.
   */
  setInset(pose: InsetPose | null, rect: InsetRect, swapped: boolean): void;
  /** Is the straight line between two points cut by masonry? */
  sightBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  /** Dynamic resolution: the share of the full resolution the scene is drawn at (0.4..1). */
  setRenderScale(scale: number): void;
  /** GPU time per frame in ms when the browser can measure it, else null. */
  gpuTime(): number | null;
  /** Slow motion for the cosmetic layer (1 = real time). The camera keeps real time. */
  setTimeScale(scale: number): void;
  /** The camera, for positional sound. */
  listener(): Listener;

  /** Show or hide where minions can walk. */
  setNavOverlay(on: boolean): void;
  /** Show the first n emplacements' guns (a match has the enemy castle's too). */
  showEmplacements(n: number): void;
  /** Show the midfield markers, where each team's waves hold (a match). */
  setMarkers(on: boolean): void;
  /** 3.2: your team's marks, drawn as chalk crosses with their numbers (none: clear them). */
  setChalk(marks: Array<{ n: number; x: number; y: number; z: number; life: number }>): void;
  /** 3.3: each castle's powder store and every emplacement's box (BOX_STRIDE each, match order): the kegs under the magazines and the hoists at the guns' feet. */
  setPowder(powder: [PowderInfo, PowderInfo] | null, boxes: Float32Array | null): void;
  /** M3: what each emplacement holds now (a gun bought for an empty slot appears; an empty one shows nothing). */
  setArms(emplacements: Emplacement[]): void;
  /** The nav grid as the worker sent it: kind and walking height per cell. */
  updateNav(kind: Uint8Array, floor: Float32Array): void;
  /** How far a courtyard's storm has gone (0..1; castle 0 is the enemy's) and whether its attackers outnumber its defenders now. */
  setStorm(castle: number, progress: number, holding: boolean): void;

  /**
   * S3: a picture of the renderer's world (every part's state and the last frame applied) that `apply` can put back.
   * Another module's share is added with `registerKeyframePart`.
   */
  capture(): RenderKeyframe;
  /** S3: put the renderer exactly where a keyframe was taken (the parts, then its last frame again without events). */
  apply(k: RenderKeyframe): void;
  registerKeyframePart(name: string, part: KeyframePart): void;

  /** World point under a screen point (terrain or masonry), for the overview. */
  pick(clientX: number, clientY: number): { x: number; y: number; z: number } | null;
  render(dtSeconds: number): void;
  getStats(): RenderStats;
  dispose(): void;
}
