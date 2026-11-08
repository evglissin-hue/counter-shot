import { VALLEY_GRID } from "@keepfall/content";

// What the simulation reports to the renderer every frame, as flat arrays so
// the worker can transfer them without copying. Strides are fixed here.

/** Moving masonry: [id, x, y, z, qx, qy, qz, qw]. A shattered stone reports y = -1000 once. */
export const STONE_STRIDE = 8;

export const enum ProjectileKind {
  Ball = 0, // long gun round shot
  Shell = 1, // mortar shell (fuse lit)
  Chain = 2, // one ball of a chain-shot pair
  Grape = 3, // grapeshot pellet
}

/** Projectiles: [kind, shot id, x, y, z, radius, vx, vy, vz]. A shot id matches its Muzzle event. */
export const PROJECTILE_STRIDE = 9;

/** Chains between chain-shot balls: [x1, y1, z1, x2, y2, z2]. */
export const CHAIN_STRIDE = 6;

/**
 * Upright minions: [id, x, y, z, yaw, walkPhase (0..1), team, action, act].
 * Feet at y. Action (army.ts): 0 walking, 1 standing, 2 fighting, 3
 * battering a gate; act counts ticks since its last blow began.
 */
export const MINION_STRIDE = 9;

/** Ragdoll parts: [minionId, part, x, y, z, qx, qy, qz, qw]. Part shapes are in MINION_PARTS. */
export const PART_STRIDE = 9;

export const enum EventKind {
  Impact = 0, // [kind, x, y, z, strength 0..1]: ball on masonry or ground
  Explosion = 1, // [kind, x, y, z, radius]
  Muzzle = 2, // [kind, emplacement, shot id, unmanned (1) or not (0), 0]
  Blood = 3, // [kind, x, y, z, strength]: cosmetic, the renderer may ignore it
  Landed = 4, // [kind, emplacement, x, y, z]: first touch of a shot, for the landing marker; emplacement is -(id + 1) for an unmanned shot
}
export const EVENT_STRIDE = 5;

/** A rectangle of the terrain height grid that changed (craters). */
export interface TerrainPatch {
  /** First vertex column and row in TERRAIN_GRID, and the size of the patch. */
  i0: number;
  j0: number;
  ni: number;
  nj: number;
  /** Heights, row by row (j outer, i inner). */
  h: Float32Array;
}

/** The physics terrain grid (the valley's): vertex (i, j) is at x = x0 + i * cell, z = z0 + j * cell. */
export const TERRAIN_GRID = VALLEY_GRID;

export interface FrameData {
  tick: number;
  stones: Float32Array;
  stoneCount: number;
  projectiles: Float32Array;
  projectileCount: number;
  chains: Float32Array;
  chainCount: number;
  minions: Float32Array;
  minionCount: number;
  /** Parts of moving bodies (ragdolls, and frozen bodies sinking into the ground). */
  parts: Float32Array;
  partCount: number;
  /** Parts of bodies that froze since the last frame, sent once: keep drawing them until their id moves again or is gone. */
  settled: Float32Array;
  settledCount: number;
  /** Minions whose bodies left the world (sank into the ground). */
  gone: Int32Array;
  events: Float32Array;
  eventCount: number;
  terrain: TerrainPatch[];
  /** Wind in m/s along x and z. */
  windX: number;
  windZ: number;
}

/** Ragdoll body parts: capsule half-length (between sphere centres) and radius, in metres. */
export const MINION_PARTS = [
  { name: "pelvis", half: 0.08, radius: 0.14 },
  { name: "torso", half: 0.14, radius: 0.16 },
  { name: "head", half: 0.0, radius: 0.12 },
  { name: "upperArmL", half: 0.1, radius: 0.05 },
  { name: "lowerArmL", half: 0.1, radius: 0.045 },
  { name: "upperArmR", half: 0.1, radius: 0.05 },
  { name: "lowerArmR", half: 0.1, radius: 0.045 },
  { name: "thighL", half: 0.14, radius: 0.07 },
  { name: "shinL", half: 0.14, radius: 0.055 },
  { name: "thighR", half: 0.14, radius: 0.07 },
  { name: "shinR", half: 0.14, radius: 0.055 },
] as const;
/** Upright minion: total height and the capsule used for hits. */
export const MINION_HEIGHT = 1.75;
