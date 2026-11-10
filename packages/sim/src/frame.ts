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
 * Upright minions: [id, x, y, z, yaw, walkPhase (0..1), team, action, act, unit].
 * Feet at y. Action (army.ts): 0 walking, 1 standing, 2 fighting, 3
 * battering a gate, 4 a mason at work, 5 carrying a ladder, 6 climbing
 * (a ladder or the rope inside), 7 raising a ladder, 8 a sapper setting his
 * keg, 9 a musketeer with his musket up; act counts ticks since its last
 * blow (or mallet stroke, or shot) began. Unit is content's Unit (0 pikeman,
 * 1 mason, 2 ladder crew, 3 sapper, 4 musketeer).
 */
export const MINION_STRIDE = 10;

/**
 * Plot buildings (M3): [castle, plot, kind, state, share raised, health].
 * Kind is an index into BUILDING_KINDS (-1: none); state is structures.ts
 * PlotState (0 empty, 1 rising, 2 standing, 3 ruined); share raised and
 * health are 0..1 (health: the share of its pieces standing).
 */
export const PLOT_STRIDE = 6;

/** Kegs set against a wall (M3): [x, y, z, ticks left]. */
export const KEG_STRIDE = 4;

/**
 * Ladders: [id, team, state, footX, footY, footZ, topX, topY, topZ, t].
 * State (ladders.ts LadderState): 0 carried, 1 being raised (t: 0..1), 2
 * planted against a wall, 3 down (knocked off a wall or dropped: its ends as
 * its body lies). t is the share raised, or for a planted ladder 1 once a
 * rope hangs down inside.
 */
export const LADDER_STRIDE = 10;

/**
 * Repairs under way, one per castle at work: [castle, slotX, slotY, slotZ,
 * workX, workZ, stoneId, masonsAtWork]. The slot is where the next stone
 * goes; the work spot is where its masons stand (the hoist's foot).
 */
export const WORKS_STRIDE = 8;

/** Ragdoll parts: [minionId, part, x, y, z, qx, qy, qz, qw]. Part shapes are in MINION_PARTS. */
export const PART_STRIDE = 9;

export const enum EventKind {
  Impact = 0, // [kind, x, y, z, strength 0..1]: ball on masonry or ground
  Explosion = 1, // [kind, x, y, z, radius]
  Muzzle = 2, // [kind, emplacement, shot id, unmanned (1) or not (0), 0]
  Blood = 3, // [kind, x, y, z, strength]: cosmetic, the renderer may ignore it
  Landed = 4, // [kind, emplacement, x, y, z]: first touch of a shot, for the landing marker; emplacement is -(id + 1) for an unmanned shot
  /** [kind, stone id, x, y, z]: masons put a piece back at its place (x, y, z is where its body was; y < -100 if it had turned to dust). */
  Laid = 5,
  /** [kind, stone id, x, y, z]: masons carried a piece of rubble out of the way (it leaves the world). */
  Cleared = 6,
  /** [kind, ladder id, state, x, z]: a ladder was raised against a wall (state 2) or came down (state 3); x, z is its foot. */
  Ladder = 7,
  /** [kind, stone id, x, y, z]: a piece of a plot's building rose into its place (M3); x, y, z is the place. */
  Raised = 8,
  /** [kind, shooter (minion id), x, y, z]: a musketeer fired at the point x, y, z (M3). */
  Musket = 9,
  /** [kind, minion id, x, y, z]: a sapper set and lit his keg at x, y, z (M3). */
  Keg = 10,
  /** [kind, castle, plot, building kind, 0]: a plot's building is finished (M3). */
  Built = 11,
  /** [kind, stone id, x, y, z]: a blast cracked a tough piece (a keep floor board) without breaking it (M5); x, y, z is the piece's place. */
  Cracked = 12,
  /** [kind, emplacement, cause (mounts.ts OutCause), shot id (-1: none), 0]: a gun was knocked out (after M5). */
  GunOut = 13,
  /** [kind, emplacement, gold paid, 0, 0]: a knocked-out gun's crew put it back on its mount. */
  GunBack = 14,
  /** [kind, minion id, x, y, z]: a chain shot's chain swept a man off his feet (after M5); x, y, z is where. */
  Swept = 15,
  /** [kind, minion id, cause (minions.ts Cause), shot id (-1: none), speed m/s]: a man was knocked down; speed is his body's fastest part just after the blow. */
  Down = 16,
  /** [kind, castle, section (content sectionOf, -1: no section), count, 0]: pieces of a castle that came loose this tick, one event per castle and section. */
  Fell = 17,
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
  /** Every ladder on the field (LADDER_STRIDE each). */
  ladders: Float32Array;
  ladderCount: number;
  /** Repairs under way (WORKS_STRIDE each). */
  works: Float32Array;
  worksCount: number;
  events: Float32Array;
  eventCount: number;
  terrain: TerrainPatch[];
  /** Wind in m/s along x and z. */
  windX: number;
  windZ: number;
  /** Where the wind is heading (m/s along x and z) and the ticks until it gets there (the gust easing in now; for the page only, see Wind.lead). */
  gustX?: number;
  gustZ?: number;
  gustIn?: number;
  /** Every plot's building (M3, PLOT_STRIDE each; empty without plots). */
  plots: Float32Array;
  plotCount: number;
  /** Kegs burning at the foot of a wall (M3, KEG_STRIDE each). */
  kegs: Float32Array;
  kegCount: number;
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
