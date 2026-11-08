// Gun slots of a match castle and the Foundry's upgrades (phase 2 M3), as
// data. Each castle has eight slots on its walls, towers and courtyard pit;
// four come with guns (M2's), four start empty and take a gun bought for
// gold. A gun stands on the masonry under it: when that comes down, the gun
// falls with it. The Foundry fits upgrades, each a trade-off.

import { DPI } from "@keepfall/core";
import { DIST } from "./field";
import { WEAPONS, type Emplacement, type Mods, type WeaponDef, type WeaponKind } from "./weapons";

export type Mount = "wall" | "tower" | "pit";

export interface SlotDef {
  mount: Mount;
  /** The gun's pivot over the ground (the player's castle), and the height of the floor it stands on (wall walk, tower top or ground). */
  x: number;
  z: number;
  floor: number;
  baseYaw: number;
  yawLimit: number;
  /** The gun it starts a match with, or null (an empty slot). */
  start: WeaponKind | null;
  /** Seen from the player's castle. */
  name: string;
}

/** A gun's pivot above its floor, and its barrel (muzzle distance from the pivot). */
export const MOUNT: Record<WeaponKind, { height: number; barrel: number }> = {
  longGun: { height: 1.7, barrel: 1.8 },
  mortar: { height: 0.9, barrel: 0.9 },
  chainShot: { height: 1.8, barrel: 1.6 },
  swivel: { height: 1.8, barrel: 1.1 },
};

export const WEAPON_COST: Record<WeaponKind, number> = { swivel: 100, chainShot: 175, longGun: 250, mortar: 350 };
/** In the build menu's order: cheapest first. */
export const WEAPON_KINDS: WeaponKind[] = ["swivel", "chainShot", "longGun", "mortar"];

/** Which guns a mount takes: the pit only a mortar, the wall walk no mortar, a tower any. */
export function mountTakes(m: Mount, w: WeaponKind): boolean {
  if (m === "pit") return w === "mortar";
  if (m === "wall") return w !== "mortar";
  return true;
}

/** The player's castle (castle 1) has eight slots; the first four are M2's guns, with their ids and places. */
export const PLAYER_SLOTS: SlotDef[] = [
  { mount: "wall", x: 0, z: -133.6, floor: 8, baseYaw: 0, yawLimit: 0.7, start: "longGun", name: "gatehouse" },
  { mount: "pit", x: 0, z: -146.5, floor: 0, baseYaw: 0, yawLimit: 0.9, start: "mortar", name: "courtyard pit" },
  { mount: "tower", x: -15, z: -135, floor: 12, baseYaw: 0.08, yawLimit: 0.9, start: "chainShot", name: "front right tower" },
  { mount: "tower", x: 15, z: -135, floor: 12, baseYaw: -0.08, yawLimit: 1.2, start: "swivel", name: "front left tower" },
  { mount: "wall", x: 7.5, z: -133.6, floor: 8, baseYaw: 0, yawLimit: 0.7, start: null, name: "left wall" },
  { mount: "wall", x: -7.5, z: -133.6, floor: 8, baseYaw: 0, yawLimit: 0.7, start: null, name: "right wall" },
  { mount: "tower", x: 15, z: -165, floor: 12, baseYaw: -0.04, yawLimit: 0.9, start: null, name: "back left tower" },
  { mount: "tower", x: -15, z: -165, floor: 12, baseYaw: 0.04, yawLimit: 0.9, start: null, name: "back right tower" },
];

/** The weapon an empty slot is drawn and described with until a gun is bought for it. */
export const MOUNT_DEFAULT: Record<Mount, WeaponKind> = { wall: "longGun", tower: "swivel", pit: "mortar" };

/** The enemy castle's slots: the player's, turned through the middle of the field (ids follow the player's). */
export const ENEMY_SLOTS: SlotDef[] = PLAYER_SLOTS.map((s) => ({ ...s, x: -s.x, z: -DIST - s.z, baseYaw: s.baseYaw + DPI }));

/** Every slot in a match: the player's castle first, then the enemy's. */
export const MATCH_SLOTS: SlotDef[] = [...PLAYER_SLOTS, ...ENEMY_SLOTS];

/** The emplacement a slot makes with a gun of this kind in it. */
export function slotEmplacement(id: number, s: SlotDef, weapon: WeaponKind, mods?: Mods): Emplacement {
  const m = MOUNT[weapon];
  return { id, weapon, x: s.x, y: s.floor + m.height, z: s.z, baseYaw: s.baseYaw, yawLimit: s.yawLimit, barrel: m.barrel, ...(mods && (mods.heavy || mods.rifled) ? { mods: { ...mods } } : {}) };
}

export type UpgradeKind = "heavy" | "rifled";
export const UPGRADE_KINDS: UpgradeKind[] = ["heavy", "rifled"];

export const UPGRADE_COST = 150;

export const UPGRADES: Record<WeaponKind, Record<UpgradeKind, { name: string; blurb: string }>> = {
  longGun: {
    heavy: { name: "Heavy shot", blurb: "A heavier ball: breaches more, but leaves slower and drops sooner." },
    rifled: { name: "Rifled barrel", blurb: "Half the scatter, a third slower to reload." },
  },
  mortar: {
    heavy: { name: "Heavy shell", blurb: "Bursts wider, but reaches less far." },
    rifled: { name: "Rifled barrel", blurb: "Half the scatter, a third slower to reload." },
  },
  chainShot: {
    heavy: { name: "Heavy chain", blurb: "Heavier balls: break more, but leave slower and drop sooner." },
    rifled: { name: "Rifled barrel", blurb: "Half the scatter, a third slower to reload." },
  },
  swivel: {
    heavy: { name: "Heavy charge", blurb: "Half as many balls again, flung wider." },
    rifled: { name: "Choke", blurb: "A tighter spread, a third slower to reload." },
  },
};

const cache = new Map<string, WeaponDef>();

/** A weapon with the Foundry's upgrades fitted (the plain one when there are none). */
export function weaponWith(kind: WeaponKind, mods?: Mods): WeaponDef {
  const base = WEAPONS[kind];
  if (!mods || (!mods.heavy && !mods.rifled)) return base;
  const key = `${kind}:${mods.heavy ? 1 : 0}${mods.rifled ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w: WeaponDef = { ...base, projectile: { ...base.projectile }, scatter: { ...base.scatter }, burst: base.burst ? { ...base.burst } : null };
  if (mods.heavy) {
    if (kind === "swivel") {
      w.pellets = Math.round(base.pellets * 1.5);
      w.spread = base.spread * 1.4;
    } else if (kind === "mortar") {
      w.speed = base.speed * 0.9;
      w.minSpeed = base.minSpeed * 0.9;
      const b = w.burst!;
      b.radius *= 1.2;
      b.knock *= 1.15;
      b.crater *= 1.15;
    } else {
      w.speed = base.speed * 0.85;
      w.minSpeed = base.minSpeed * 0.85;
      w.projectile.density = base.projectile.density * 1.3;
      w.projectile.blast = base.projectile.blast * 1.15;
    }
  }
  if (mods.rifled) {
    w.reload = Math.round(base.reload * 1.33);
    if (kind === "swivel") w.spread = w.spread * 0.6;
    else {
      w.scatter.angle = base.scatter.angle * 0.5;
      w.scatter.speed = base.scatter.speed * 0.5;
    }
  }
  cache.set(key, w);
  return w;
}

/** The weapon an emplacement fires, upgrades and all. */
export function emplacementWeapon(e: Emplacement): WeaponDef {
  return weaponWith(e.weapon, e.mods);
}
