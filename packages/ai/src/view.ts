// What the AI sees of the match: the same things a player can see from the
// walls and the overview (where the enemy's men are and how many, where the
// banner stands, which gate and buildings still stand, whether there is a way
// in). Read only: the AI changes the match through inputs alone.

import { CASTLE_SHAPE, KEEP_STOREYS, mirrorZ, MUSTER, PLOTS, plotCentre, ROUTE_NAMES, BRIDGES, inCourtyard } from "@keepfall/content";
import { dsqrt } from "@keepfall/core";
import { breachField, FLOW_INF, MinionState, PlotState, Role } from "@keepfall/sim";
import type { Match } from "@keepfall/rules";

/** A knot of men: where its middle is, how many, and how fast it moves. */
export interface Crowd {
  x: number;
  z: number;
  n: number;
  vx: number;
  vz: number;
}

/** Storey heights (m) under the roof, lowest first: 7, 13.5 and 20. */
export const STOREY_Y = KEEP_STOREYS.map((c) => c * CASTLE_SHAPE.course);

/**
 * The densest knot of a team's marching men within `r` of a point (x, z):
 * the man with the most of his side within `spread`, and the middle of those.
 * Null if no knot has at least `min` men.
 */
export function crowdNear(m: Match, team: number, x: number, z: number, r: number, spread: number, min: number, inside = -1): Crowd | null {
  const list = m.world.minions.list;
  const near: number[] = [];
  const r2 = r * r;
  for (const mi of list) {
    if (mi.team !== team || mi.state !== MinionState.Upright || mi.wave < 0 || mi.role !== Role.March) continue;
    const dx = mi.x - x, dz = mi.z - z;
    if (dx * dx + dz * dz <= r2 || (inside >= 0 && inCourtyard(inside, mi.x, mi.z))) near.push(mi.id);
  }
  if (near.length < min) return null;
  const s2 = spread * spread;
  let best = -1, bestN = 0;
  for (const a of near) {
    const ma = list[a];
    let n = 0;
    for (const b of near) {
      const mb = list[b];
      const dx = mb.x - ma.x, dz = mb.z - ma.z;
      if (dx * dx + dz * dz <= s2) n++;
    }
    if (n > bestN) {
      bestN = n;
      best = a;
    }
  }
  if (bestN < min) return null;
  const c = list[best];
  let sx = 0, sz = 0, svx = 0, svz = 0, k = 0;
  for (const b of near) {
    const mb = list[b];
    const dx = mb.x - c.x, dz = mb.z - c.z;
    if (dx * dx + dz * dz > s2) continue;
    sx += mb.x;
    sz += mb.z;
    svx += mb.vx;
    svz += mb.vz;
    k++;
  }
  return { x: sx / k, z: sz / k, n: k, vx: svx / k, vz: svz / k };
}

/** A team's marching men standing, all told and within r of a point. */
export function marchers(m: Match, team: number, x = 0, z = 0, r = 1e9): number {
  let n = 0;
  const r2 = r * r;
  for (const mi of m.world.minions.list) {
    if (mi.team !== team || mi.state !== MinionState.Upright || mi.wave < 0 || mi.role !== Role.March) continue;
    const dx = mi.x - x, dz = mi.z - z;
    if (dx * dx + dz * dz <= r2) n++;
  }
  return n;
}

/** Is one of a team's own men (anyone upright, masons and garrison too) within r of a point? */
export function ownNear(m: Match, team: number, x: number, z: number, r: number): boolean {
  const r2 = r * r;
  for (const mi of m.world.minions.list) {
    if (mi.team !== team || mi.state !== MinionState.Upright) continue;
    const dx = mi.x - x, dz = mi.z - z;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

/**
 * Can a team's men walk into the enemy courtyard (a breach in its walls, or
 * its gate down)? The team's breach field reaches the ground in front of the
 * enemy gate only if there is a way in.
 */
export function wayIn(m: Match, team: number): boolean {
  const g = MUSTER[1 - team];
  const f = m.army.flow;
  const b = breachField(team);
  return f.at(b, g.x, g.z) < FLOW_INF || f.at(b, g.x - 12, g.z) < FLOW_INF || f.at(b, g.x + 12, g.z) < FLOW_INF;
}

/** Does a castle's gate still stand (both leaves fixed)? */
export function gateStands(m: Match, castle: number, leaves: number[][]): boolean {
  for (const id of leaves[castle]) if (m.world.castle.dynamic[id]) return false;
  return true;
}

/** Each castle's gate leaves (stone ids). */
export function gateLeaves(m: Match): number[][] {
  const out: number[][] = [[], []];
  for (const s of m.world.castle.layout.stones) if (s.part === "gate" && s.castle < 2) out[s.castle].push(s.id);
  return out;
}

/** Where a castle's banner is, and the height of the floor it stands on. */
export function banner(m: Match, castle: number): { x: number; y: number; z: number; floor: number } {
  const p = m.world.castle.bodies[m.world.castle.layout.bannerIds[castle]].translation();
  let floor = STOREY_Y[0];
  for (const y of STOREY_Y) if (y <= p.y - 0.5) floor = y;
  return { x: p.x, y: p.y, z: p.z, floor };
}

/** The face of a castle's keep that looks at the other castle (world z). */
export function keepFaceZ(castle: number): number {
  return mirrorZ(castle, CASTLE_SHAPE.keepZ - CASTLE_SHAPE.keepHalf);
}

/** The outer face of a castle's front wall (world z). */
export function frontFaceZ(castle: number): number {
  return mirrorZ(castle, -CASTLE_SHAPE.half - CASTLE_SHAPE.wallThick / 2);
}

/** A castle's plots that hold a working building of a kind (plot numbers, in order). */
export function working(m: Match, castle: number, kind: number): number[] {
  const st = m.world.structures!;
  const out: number[] = [];
  for (let p = 0; p < PLOTS.length; p++) {
    const s = st.slot(castle, p);
    if (s.kind === kind && s.state === PlotState.Standing) out.push(p);
  }
  return out;
}

/** A plot's middle and roof height, for a shell. */
export function plotTarget(castle: number, plot: number): { x: number; y: number; z: number } {
  const c = plotCentre(castle, plot);
  return { x: c.x, y: 3, z: c.z };
}

/** Where a team's waves cross the stream on a route (its bridge). */
export function bridgeOf(route: number): { x: number; z: number } {
  const b = BRIDGES.find((s) => s.name === ROUTE_NAMES[route])!;
  return { x: b.x, z: b.z };
}

/** Distance in the ground plane. */
export function flat(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx, dz = az - bz;
  return dsqrt(dx * dx + dz * dz);
}

/** Is a point within r of a bridge (its deck, end to end)? A shell there would cut a route for both sides. */
export function nearBridge(x: number, z: number, r: number): boolean {
  for (const b of BRIDGES) {
    const dx = (x > b.x ? x - b.x : b.x - x) - b.width / 2, dz = (z > b.z ? z - b.z : b.z - z) - b.length / 2;
    const ox = dx > 0 ? dx : 0, oz = dz > 0 ? dz : 0;
    if (ox * ox + oz * oz < r * r) return true;
  }
  return false;
}
