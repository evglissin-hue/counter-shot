// The four Ashwright weapons and where they sit on the player's castle.
// Angles in radians. Yaw 0 points along +Z (towards the target castle),
// positive yaw turns towards +X. Pitch 0 is level, positive is up.
// Starting numbers for tuning: everything here is data.

export type WeaponKind = "longGun" | "mortar" | "chainShot" | "swivel";

export interface ProjectileDef {
  /** Ball radius in metres (each ball, for chain shot and grapeshot). */
  radius: number;
  /** Material density, kg per cubic metre. */
  density: number;
  /** Gravity multiplier: lobbed shells fall faster than real so they land in seconds, not ages. */
  gravity: number;
  /** Drag coefficient of the shape (a sphere is about 0.47). */
  cd: number;
  /** How hard a hit on masonry blasts it: 1 is a full cannon blast, 0 none. */
  blast: number;
  restitution: number;
}

/** A powder burst (mortar shells): what it does to masonry, minions and the ground. */
export interface BurstDef {
  /** Fixed masonry within this radius (m) is hit; loose rubble out to 1.3 times it is thrown. */
  radius: number;
  /** Share of the radius that turns to dust outright. */
  shatter: number;
  /** Throw speed (m/s) given to masonry at the centre; a quarter of it at the edge. */
  power: number;
  /** Upward share of the throw, so debris goes up and out rather than sideways. */
  lift: number;
  /** A shell that strikes masonry bursts this far inside it (m), so roofs and wall tops cave in. */
  bite: number;
  /** Minions within this radius (m) are thrown, at `knockSpeed` (m/s) at the centre. */
  knock: number;
  knockSpeed: number;
  /** Crater radius and depth (m) when it bursts at or near the ground. */
  crater: number;
  depth: number;
}

export interface WeaponDef {
  kind: WeaponKind;
  name: string;
  /** Muzzle speed in m/s at full charge. */
  speed: number;
  /** Lowest muzzle speed (weapons with a charge); equal to speed if fixed. */
  minSpeed: number;
  minPitch: number;
  maxPitch: number;
  /** Elevation the weapon starts at (render and page only). */
  restPitch: number;
  /** Top turning speeds, rad/s. Fine aim multiplies them by `fine`. */
  yawRate: number;
  pitchRate: number;
  fine: number;
  /** Ticks between shots (60 per second). */
  reload: number;
  projectile: ProjectileDef;
  /** Balls per shot (grapeshot) and their cone half-angle. */
  pellets: number;
  spread: number;
  /** Mortar fuse range in ticks; 0 means the shell bursts on impact. */
  fuseMin: number;
  fuseMax: number;
  /** Chain shot: chain length (m) and launch spin (rad/s) of the pair. */
  chainLength: number;
  chainSpin: number;
  /** Long gun: spin (rad/s) given by the spin setting. */
  spinRate: number;
  /** Seconds of the predicted arc the aim help shows. */
  arcSeconds: number;
  /**
   * Shot to shot scatter, so two identical aims do not land on the same
   * stone: the barrel throws up to `angle` (radians) off the aim and the
   * charge varies by up to `speed` (a share of the muzzle speed). Rifled
   * barrels (a Foundry upgrade) will tighten it.
   */
  scatter: { angle: number; speed: number };
  /** The shell's powder burst, for weapons whose shot explodes. */
  burst: BurstDef | null;
  /** Sight field of view range in degrees (render only). */
  fov: [number, number];
}

const IRON = 7800;

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  longGun: {
    kind: "longGun",
    name: "Long gun",
    speed: 115,
    minSpeed: 115,
    minPitch: -0.2,
    maxPitch: 0.35,
    restPitch: 0.06,
    yawRate: 0.35,
    pitchRate: 0.25,
    fine: 0.2,
    reload: 4 * 60,
    projectile: { radius: 0.22, density: IRON, gravity: 1, cd: 0.47, blast: 1, restitution: 0.1 },
    pellets: 1,
    spread: 0,
    fuseMin: 0,
    fuseMax: 0,
    chainLength: 0,
    chainSpin: 0,
    spinRate: 40,
    arcSeconds: 0.5,
    scatter: { angle: 0.004, speed: 0.008 },
    burst: null,
    fov: [14, 55],
  },
  mortar: {
    kind: "mortar",
    name: "Mortar",
    speed: 82,
    minSpeed: 36,
    minPitch: 0.68,
    maxPitch: 1.35,
    restPitch: 1.0,
    yawRate: 0.5,
    pitchRate: 0.3,
    fine: 0.2,
    reload: 6 * 60,
    projectile: { radius: 0.28, density: 3200, gravity: 3.2, cd: 0.47, blast: 0, restitution: 0.35 },
    pellets: 1,
    spread: 0,
    fuseMin: 30,
    fuseMax: 8 * 60,
    chainLength: 0,
    chainSpin: 0,
    spinRate: 0,
    arcSeconds: 1.0,
    scatter: { angle: 0.006, speed: 0.008 },
    burst: { radius: 4.6, shatter: 0.45, power: 30, lift: 1.1, bite: 0.9, knock: 12, knockSpeed: 18, crater: 4.0, depth: 1.6 },
    fov: [12, 55],
  },
  chainShot: {
    kind: "chainShot",
    name: "Chain shot",
    speed: 80,
    minSpeed: 80,
    minPitch: -0.3,
    maxPitch: 0.45,
    restPitch: 0.06,
    yawRate: 0.6,
    pitchRate: 0.4,
    fine: 0.25,
    reload: 5 * 60,
    projectile: { radius: 0.16, density: IRON, gravity: 1, cd: 0.9, blast: 0.35, restitution: 0.1 },
    pellets: 2,
    spread: 0,
    fuseMin: 0,
    fuseMax: 0,
    chainLength: 2.4,
    chainSpin: 14,
    spinRate: 0,
    arcSeconds: 0.4,
    scatter: { angle: 0.008, speed: 0.01 },
    burst: null,
    fov: [18, 55],
  },
  swivel: {
    kind: "swivel",
    name: "Swivel gun",
    speed: 70,
    minSpeed: 70,
    minPitch: -0.6,
    maxPitch: 0.4,
    restPitch: 0.06,
    yawRate: 1.6,
    pitchRate: 1.2,
    fine: 0.25,
    reload: 2 * 60,
    projectile: { radius: 0.05, density: 7000, gravity: 1, cd: 0.47, blast: 0, restitution: 0.25 },
    pellets: 12,
    spread: 0.06,
    fuseMin: 0,
    fuseMax: 0,
    chainLength: 0,
    chainSpin: 0,
    spinRate: 0,
    arcSeconds: 0.3,
    scatter: { angle: 0.004, speed: 0.01 },
    burst: null,
    fov: [30, 65],
  },
};

export interface Emplacement {
  id: number;
  weapon: WeaponKind;
  /** Pivot point of the weapon in world space. */
  x: number;
  y: number;
  z: number;
  /** Rest aim, and how far it may turn either side of it. */
  baseYaw: number;
  yawLimit: number;
  /** Muzzle distance from the pivot along the barrel: shots start there. */
  barrel: number;
}

/** The player's castle (castle 1, centred at z = -150, facing +Z). */
export const ASHWRIGHT_EMPLACEMENTS: Emplacement[] = [
  { id: 0, weapon: "longGun", x: 0, y: 9.7, z: -133.6, baseYaw: 0, yawLimit: 0.7, barrel: 1.8 },
  { id: 1, weapon: "mortar", x: 0, y: 0.9, z: -146.5, baseYaw: 0, yawLimit: 0.9, barrel: 0.9 },
  { id: 2, weapon: "chainShot", x: -15, y: 13.8, z: -135, baseYaw: 0.08, yawLimit: 0.9, barrel: 1.6 },
  { id: 3, weapon: "swivel", x: 15, y: 13.8, z: -135, baseYaw: -0.08, yawLimit: 1.2, barrel: 1.1 },
];

/** Gameplay air: drag uses real sphere drag scaled by this, so wind and drag read in a 150 m valley. */
export const AIR_DENSITY = 1.225;
export const AIR_SCALE = 8;
