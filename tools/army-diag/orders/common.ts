// Shared helpers for the orders and routes diagnosis scripts (untracked, army pass).
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BRIDGES, holdMarker, inCourtyard, MID_Z, MUSTER, ROUTE_NAMES, type RouteName } from "@keepfall/content";
import { MinionState, Role, type Rapier } from "@keepfall/sim";
import type { Match } from "@keepfall/rules";

await RD.init();
export const R = RD as unknown as Rapier;
export const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
export const clock = (tick: number) => `${Math.floor(tick / 3600)}:${String(Math.floor(tick / 60) % 60).padStart(2, "0")}`;
export const ORDER = ["Advance", "Hold", "Push"];
export const ROLE = ["March", "Garrison", "Defend", "Mason", "Gang", "Carrier"];
export const ACTION = ["Walk", "Stand", "Fight", "Batter", "Work", "Carry", "Climb", "Raise", "Plant", "Aim"];
export const UNIT = ["pike", "mason", "ladder", "sapper", "musket", "boy"];

/** Hold markers by team and route index. */
export const HOLD = [0, 1].map((t) => ROUTE_NAMES.map((r) => holdMarker(t as 0 | 1, r as RouteName)));
/** Bridges by route index. */
export const BR = ROUTE_NAMES.map((r) => BRIDGES.find((b) => b.name === r)!);

export function d2(ax: number, az: number, bx: number, bz: number) {
  return Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
}

/** Where a man of a team stands, as a zone name. */
export function zone(team: number, x: number, z: number): string {
  const foe = 1 - team;
  if (inCourtyard(foe, x, z)) return "foeYard";
  if (inCourtyard(team, x, z)) return "ownYard";
  if (d2(x, z, MUSTER[foe].x, MUSTER[foe].z) < 14) return "foeGate";
  for (let r = 0; r < 3; r++) if (d2(x, z, HOLD[team][r].x, HOLD[team][r].z) < 8) return "ownMarker";
  for (let r = 0; r < 3; r++) if (Math.abs(x - BR[r].x) < 6 && Math.abs(z - BR[r].z) < BR[r].length / 2 + 1) return "onBridge";
  for (let r = 0; r < 3; r++) if (d2(x, z, HOLD[foe][r].x, HOLD[foe][r].z) < 8) return "foeMarker";
  if (d2(x, z, MUSTER[team].x, MUSTER[team].z) < 14) return "ownGate";
  // Which half of the field: own side or across the stream.
  const ownSide = team === 0 ? z > MID_Z : z < MID_Z;
  return ownSide ? "ownHalf" : "foeHalf";
}

export function upright(m: Match, team: number, role = Role.March) {
  return m.world.minions.list.filter((x) => x.team === team && x.state === MinionState.Upright && x.wave >= 0 && x.role === role);
}

export function tally(list: string[]): string {
  const c = new Map<string, number>();
  for (const s of list) c.set(s, (c.get(s) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ");
}
