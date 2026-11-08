// A castle's guns in a match (phase 2 M3), as data: its eight emplacements
// (the four armed ones plus four empty slots to buy guns for), what a gun
// costs, and the Foundry's upgrades, each a trade-off. armedWeapon() gives
// the weapon a gun fires as, with its upgrade worked in: the sim fires it and
// the page aims with it, so the aim help knows every upgrade.
// Starting numbers for tuning: everything here is data.

import { DPI } from "@keepfall/core";
import { DIST } from "./field";
import { ASHWRIGHT_EMPLACEMENTS, WEAPONS, type Emplacement, type UpgradeKind, type WeaponDef, type WeaponKind } from "./weapons";

/** Gold for a gun in an empty slot. */
export const WEAPON_COST: Record<WeaponKind, number> = { longGun: 220, mortar: 300, chainShot: 160, swivel: 120 };

/** A gun's muzzle distance from its pivot (m): what a slot takes when a gun is bought for it. */
export const BARREL: Record<WeaponKind, number> = { longGun: 1.8, mortar: 0.9, chainShot: 1.6, swivel: 1.1 };

const WALL_GUNS: WeaponKind[] = ["longGun", "chainShot", "swivel"];

/**
 * The player's castle's eight emplacements (castle 1, facing +z): the Practice
 * range's four guns as they are, then four empty slots: the front wall either
 * side of the gate (in a crenel), the back left tower, and a second mortar pit
 * beside the first, in front of the keep. Ids 0 to 7.
 */
export const ASHWRIGHT_SLOTS: Emplacement[] = [
  { ...ASHWRIGHT_EMPLACEMENTS[0], allowed: ["longGun"], place: "the gate wall" },
  { ...ASHWRIGHT_EMPLACEMENTS[1], allowed: ["mortar"], place: "the mortar pit" },
  { ...ASHWRIGHT_EMPLACEMENTS[2], allowed: ["chainShot"], place: "the front right tower" },
  { ...ASHWRIGHT_EMPLACEMENTS[3], allowed: ["swivel"], place: "the front left tower" },
  { id: 4, weapon: "longGun", empty: true, allowed: WALL_GUNS, place: "the front wall, left of the gate", x: 8.1, y: 9.7, z: -133.6, baseYaw: 0, yawLimit: 0.8, barrel: BARREL.longGun },
  { id: 5, weapon: "longGun", empty: true, allowed: WALL_GUNS, place: "the front wall, right of the gate", x: -8.1, y: 9.7, z: -133.6, baseYaw: 0, yawLimit: 0.8, barrel: BARREL.longGun },
  { id: 6, weapon: "longGun", empty: true, allowed: WALL_GUNS, place: "the back left tower, for long shots", x: 15, y: 13.8, z: -165, baseYaw: -0.06, yawLimit: 0.75, barrel: BARREL.longGun },
  // A second pit beside the first, in front of the keep (M5 audit: behind the keep, its shells hit its own keep).
  { id: 7, weapon: "mortar", empty: true, allowed: ["mortar"], place: "the second mortar pit", x: 3.2, y: 0.9, z: -147.2, baseYaw: 0, yawLimit: 0.9, barrel: BARREL.mortar },
];

/**
 * The enemy castle's emplacements: the player's, turned through the middle of
 * the field (both castles are symmetric across x = 0, so each lands on the
 * same wall or tower). Ids follow the player's. Yaws stay near the base yaw
 * (pi plus the player's), so turn limits work unchanged.
 */
export const ENEMY_EMPLACEMENTS: Emplacement[] = ASHWRIGHT_SLOTS.map((e, i) => ({
  ...e,
  id: ASHWRIGHT_SLOTS.length + i,
  x: -e.x,
  z: -DIST - e.z,
  baseYaw: e.baseYaw + DPI,
}));

/** Every emplacement in a match: the player's castle first, then the enemy's. */
export const MATCH_EMPLACEMENTS: Emplacement[] = [...ASHWRIGHT_SLOTS, ...ENEMY_EMPLACEMENTS];

/** Slots per castle in a match. */
export const SLOTS_PER_CASTLE = ASHWRIGHT_SLOTS.length;

export interface UpgradeDef {
  kind: UpgradeKind;
  weapon: WeaponKind;
  name: string;
  /** What it gives and what it costs you, for the build wheel. */
  blurb: string;
  cost: number;
  /** Multiples of the weapon's own: muzzle speed, reload, scatter, a full blast's radius, a weak blast, a burst's reach, the grapeshot cone, the chain, the ball's density. */
  speed?: number;
  reload?: number;
  scatter?: number;
  power?: number;
  blast?: number;
  burst?: number;
  spread?: number;
  chain?: number;
  density?: number;
  /** Grapeshot balls per shot (instead of the weapon's own). */
  pellets?: number;
}

/** The Foundry's upgrades: one per gun, two to choose from for each kind. */
export const UPGRADES: Record<UpgradeKind, UpgradeDef> = {
  heavyShot: { kind: "heavyShot", weapon: "longGun", name: "Heavy shot", blurb: "A 20% bigger breach; 12% slower, so it drops more", cost: 140, power: 1.2, speed: 0.88, density: 1.35 },
  rifled: { kind: "rifled", weapon: "longGun", name: "Rifled barrel", blurb: "Scatter cut to 40%; reloads 30% slower", cost: 140, scatter: 0.4, reload: 1.3 },
  heavyShell: { kind: "heavyShell", weapon: "mortar", name: "Heavy shell", blurb: "A 20% bigger burst; a little less reach", cost: 140, burst: 1.2, speed: 0.93 },
  quickLoader: { kind: "quickLoader", weapon: "mortar", name: "Quick loader", blurb: "Reloads in 70% of the time; scatters 60% more", cost: 140, reload: 0.7, scatter: 1.6 },
  longChain: { kind: "longChain", weapon: "chainShot", name: "Long chain", blurb: "Scythes 40% wider; weaker on stone", cost: 140, chain: 1.4, blast: 0.85 },
  heavyBalls: { kind: "heavyBalls", weapon: "chainShot", name: "Heavy balls", blurb: "50% harder on stone; 10% slower", cost: 140, blast: 1.5, speed: 0.9, density: 1.3 },
  canister: { kind: "canister", weapon: "swivel", name: "Canister", blurb: "18 balls in a wider cone", cost: 140, pellets: 18, spread: 1.35 },
  longBarrel: { kind: "longBarrel", weapon: "swivel", name: "Long barrel", blurb: "A tighter cone and 15% faster; reloads 25% slower", cost: 140, spread: 0.6, speed: 1.15, reload: 1.25 },
};

/** Weapon and upgrade kinds in a fixed order, wherever they are numbered (the page's messages, hashes). */
export const WEAPON_KINDS: WeaponKind[] = ["longGun", "mortar", "chainShot", "swivel"];
export const UPGRADE_KINDS: UpgradeKind[] = ["heavyShot", "rifled", "heavyShell", "quickLoader", "longChain", "heavyBalls", "canister", "longBarrel"];

/** The two upgrades a weapon kind can take. */
export function upgradesFor(kind: WeaponKind): UpgradeDef[] {
  return Object.values(UPGRADES).filter((u) => u.weapon === kind);
}

const armed = new Map<string, WeaponDef>();

/**
 * The weapon a gun fires as: its kind's, with its upgrade worked in (the same
 * object as WEAPONS[kind] when it has none, so a gun without an upgrade fires
 * exactly as before). Deterministic: only + - * / of the weapon's numbers.
 */
export function armedWeapon(kind: WeaponKind, upgrade?: UpgradeKind): WeaponDef {
  const base = WEAPONS[kind];
  const u = upgrade ? UPGRADES[upgrade] : undefined;
  if (!u || u.weapon !== kind) return base;
  const key = `${kind}:${upgrade}`;
  const hit = armed.get(key);
  if (hit) return hit;
  const sp = u.speed ?? 1;
  const w: WeaponDef = {
    ...base,
    speed: base.speed * sp,
    minSpeed: base.minSpeed * sp,
    reload: Math.round(base.reload * (u.reload ?? 1)),
    scatter: { angle: base.scatter.angle * (u.scatter ?? 1), speed: base.scatter.speed * (u.scatter ?? 1) },
    projectile: {
      ...base.projectile,
      blast: base.projectile.blast * (u.blast ?? 1),
      density: base.projectile.density * (u.density ?? 1),
      power: (base.projectile.power ?? 1) * (u.power ?? 1),
    },
    pellets: u.pellets ?? base.pellets,
    spread: base.spread * (u.spread ?? 1),
    chainLength: base.chainLength * (u.chain ?? 1),
    burst: base.burst
      ? { ...base.burst, radius: base.burst.radius * (u.burst ?? 1), knock: base.burst.knock * (u.burst ?? 1), crater: base.burst.crater * (u.burst ?? 1) }
      : null,
  };
  armed.set(key, w);
  return w;
}

/** The weapon an emplacement fires as now (its kind and upgrade). */
export function weaponOf(e: Emplacement): WeaponDef {
  return armedWeapon(e.weapon, e.upgrade);
}
