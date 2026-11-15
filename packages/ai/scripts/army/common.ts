// Shared setup for the army hunts (packages/ai/scripts/army-hunt.ts): the physics engine, the match builder,
// the geometry the hunts measure against, and the result shape. Scenarios are copied and tidied from the army pass's
// diagnosis scripts; nothing here is imported from tools/.
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BRIDGES, buildLayout, GAME_LAYOUT, holdMarker, inCourtyard, MID_Z, ROUTE_NAMES, type RouteName } from "@keepfall/content";
import { breachField, FLOW_INF, MinionState, Order, Role, routeField, type Minion, type Rapier } from "@keepfall/sim";
import { Match, type MatchOptions } from "@keepfall/rules";

await RD.init();
export const R = RD as unknown as Rapier;
export const layout = buildLayout(1, GAME_LAYOUT);
export const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;

/** The thresholds table of army-hunt.ts, passed to every hunt. */
export type Thresholds = Record<string, number>;
/** What a hunt returns: one measurement line, the flags (each a full sentence with its numbers), and detail lines. */
export interface HuntResult {
  measure: string;
  flags: string[];
  detail: string[];
}
export type HuntFn = (T: Thresholds, seed: number) => HuntResult;

export function newMatch(opts: Partial<MatchOptions> & { seed: number }): Match {
  return new Match(R, layout, { plan: false, rotate: false, ...opts } as MatchOptions);
}

export const clock = (tick: number) => `${Math.floor(tick / 3600)}:${String(Math.floor(tick / 60) % 60).padStart(2, "0")}`;
export const ORDER = ["Advance", "Hold", "Push"];
export const d2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
export const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");

/** Hold markers by team and route index; bridges by route index. */
export const HOLD = [0, 1].map((t) => ROUTE_NAMES.map((r) => holdMarker(t as 0 | 1, r as RouteName)));
export const BR = ROUTE_NAMES.map((r) => BRIDGES.find((b) => b.name === r)!);
/** The bridge (route index) whose x is nearest to a crossing point. */
export const bridgeAt = (x: number) => BR.reduce((best, b, k) => (Math.abs(b.x - x) < Math.abs(BR[best].x - x) ? k : best), 0);
/** Has a man of `team` got across the stream (past the middle, towards the enemy)? */
export const across = (team: number, z: number) => (team === 1 ? z > MID_Z : z < MID_Z);

/** A marching soldier: upright, in a wave, role March. */
export const marcher = (x: Minion) => x.state === MinionState.Upright && x.wave >= 0 && x.role === Role.March;

/** The field a man marches on now, or -1 when he holds (mirrors the army's own choice). */
export function marchField(m: Match, x: Minion): number {
  const a = m.army;
  const order = a.order[x.team];
  const route = routeField(x.team, x.route);
  if (order === Order.Push) {
    const b = breachField(x.team);
    return a.flow.at(b, x.x, x.z) < FLOW_INF ? b : route;
  }
  if (order === Order.Hold) {
    const hz = HOLD[x.team][x.route].z;
    const past = x.team === 1 ? x.z - hz : hz - x.z;
    if (past > 1.5) return routeField(1 - x.team, x.route);
    if (past > -0.5) return -1;
  }
  return route;
}

/** Cost (10 per metre) left to the enemy courtyard by the man's own route field (FLOW_INF when cut off). */
export const costOf = (m: Match, x: Minion) => m.army.flow.at(routeField(x.team, x.route), x.x, x.z);

export { BRIDGES, inCourtyard, FLOW_INF, MinionState, Order, Role, routeField, ROUTE_NAMES, MID_Z };
export type { Minion, Match };
