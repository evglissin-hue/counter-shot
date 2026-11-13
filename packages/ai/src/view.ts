// What the AI sees of the match: the same things a player can see from the
// walls and the overview (where the enemy's men are and how many, where the
// banner stands, which gate and buildings still stand, whether there is a way
// in). Read only: the AI changes the match through inputs alone.

import { BUTTRESS_FACES, CASTLE_SHAPE, KEEP_STOREYS, mirrorZ, MUSTER, PLOTS, plotCentre, ROUTE_NAMES, BRIDGES, inCourtyard, weaponOf, type ButtressFace, type CastleLayout, type Emplacement } from "@keepfall/content";
import { dsqrt } from "@keepfall/core";
import { aimDir, breachField, flightCoef, flightDv, FLOW_INF, G, MinionState, muzzle, PlotState, Role } from "@keepfall/sim";
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

// ---- 3.4: reading a building ----

/** The courses of a keep below its lowest floor: its foot (a course under this index). */
export const FOOT_COURSES = KEEP_STOREYS[0] - 1;

/** A face of a castle's keep in its owner's words, as the world direction it looks (a unit vector: x, z). */
export function faceNormal(castle: number, face: ButtressFace): [number, number] {
  // Castle 0 looks out along -z (its left is -x); castle 1 is castle 0 mirrored across z only (front +z, left +x).
  const z = castle === 0 ? -1 : 1, l = castle === 0 ? -1 : 1;
  switch (face) {
    case "front": return [0, z];
    case "back": return [0, -z];
    case "left": return [l, 0];
    default: return [-l, 0];
  }
}

/** The face of a castle's keep whose outward normal is nearest a direction (the way it would fall), in its owner's words. */
export function faceTowards(castle: number, dx: number, dz: number): ButtressFace {
  let best: ButtressFace = "front", bd = -Infinity;
  for (const f of BUTTRESS_FACES) {
    const [nx, nz] = faceNormal(castle, f);
    const d = nx * dx + nz * dz;
    if (d > bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

/** Every stone's axis aligned bounds at its layout pose (min xyz, max xyz), computed once per layout. */
const BOUNDS = new WeakMap<CastleLayout, Float32Array>();
function boundsOf(layout: CastleLayout): Float32Array {
  const hit = BOUNDS.get(layout);
  if (hit) return hit;
  const wp = layout.wedge.points;
  let wx = 0, wy = 0, wz = 0;
  for (let i = 0; i < 8; i++) {
    wx = Math.max(wx, Math.abs(wp[i * 3]));
    wy = Math.max(wy, Math.abs(wp[i * 3 + 1]));
    wz = Math.max(wz, Math.abs(wp[i * 3 + 2]));
  }
  const out = new Float32Array(layout.stones.length * 6);
  for (const s of layout.stones) {
    const hx = s.shape === "wedge" ? wx : s.hx, hy = s.shape === "wedge" ? wy : s.hy, hz = s.shape === "wedge" ? wz : s.hz;
    const [qx, qy, qz, qw] = s.q;
    const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wxq = qw * qx, wyq = qw * qy, wzq = qw * qz;
    const ex = Math.abs(1 - 2 * (yy + zz)) * hx + Math.abs(2 * (xy - wzq)) * hy + Math.abs(2 * (xz + wyq)) * hz;
    const ey = Math.abs(2 * (xy + wzq)) * hx + Math.abs(1 - 2 * (xx + zz)) * hy + Math.abs(2 * (yz - wxq)) * hz;
    const ez = Math.abs(2 * (xz - wyq)) * hx + Math.abs(2 * (yz + wxq)) * hy + Math.abs(1 - 2 * (xx + yy)) * hz;
    out.set([s.x - ex, s.y - ey, s.z - ez, s.x + ex, s.y + ey, s.z + ez], s.id * 6);
  }
  BOUNDS.set(layout, out);
  return out;
}

const nearIds: number[] = [];

/**
 * Is the way clear for a flight path (x, y, z triples, a metre or so apart) to the point (tx, ty, tz): does it meet no
 * standing piece of the castle on the way, except within 1 m of the point? What a gunner sees looking down the barrel.
 */
export function lineClear(m: Match, castle: number, path: ArrayLike<number>, tx: number, ty: number, tz: number): boolean {
  const cs = m.world.castle, layout = cs.layout, b = boundsOf(layout);
  for (let i = 0; i + 2 < path.length; i += 3) {
    const x = path[i], y = path[i + 1], z = path[i + 2];
    const dx = x - tx, dy = y - ty, dz = z - tz;
    if (dx * dx + dy * dy + dz * dz <= 1) continue;
    nearIds.length = 0;
    cs.standingNear(x, y, z, 3, nearIds);
    for (const id of nearIds) {
      if (layout.stones[id].castle !== castle) continue;
      const k = id * 6;
      if (x >= b[k] - 0.1 && x <= b[k + 3] + 0.1 && y >= b[k + 1] - 0.1 && y <= b[k + 4] + 0.1 && z >= b[k + 2] - 0.1 && z <= b[k + 5] + 0.1) return false;
    }
  }
  return true;
}

/** A still-air flight to a point: its last stretch (x, y, z triples about a metre apart) and the shot's speed and direction on arrival. */
export interface Flight {
  path: number[];
  speed: number;
  dx: number;
  dy: number;
  dz: number;
}

/**
 * Fly the shot a gun laid like this would fire, in still air, until it is as far out as (toX, toZ), as the aim help
 * does. Only the last `from` metres (flat) are kept, a metre apart.
 */
export function flightTo(e: Emplacement, yaw: number, pitch: number, charge: number, toX: number, toZ: number, from = 60): Flight | null {
  const w = weaponOf(e);
  const speed0 = w.minSpeed + (w.speed - w.minSpeed) * (charge < 0 ? 0 : charge > 1 ? 1 : charge);
  const c = flightCoef(w.projectile);
  const [mx, my, mz] = muzzle(e, yaw, pitch);
  const [ux, uy, uz] = aimDir(yaw, pitch);
  const v: [number, number, number] = [ux * speed0, uy * speed0, uz * speed0];
  const dv: [number, number, number] = [0, 0, 0];
  const tx = toX - e.x, tz = toZ - e.z;
  const reach = dsqrt(tx * tx + tz * tz);
  const keep = Math.max(0, reach - from);
  const dt = 1 / 60;
  let px = mx, py = my, pz = mz;
  const path: number[] = [];
  for (let i = 1; i <= 9 * 60; i++) {
    flightDv(v, null, 0, 0, c, dv);
    v[0] += dv[0];
    v[1] += dv[1] - G * c.gravity * dt;
    v[2] += dv[2];
    const qx = px + v[0] * dt, qy = py + v[1] * dt, qz = pz + v[2] * dt;
    const gx = qx - e.x, gz = qz - e.z;
    const b = dsqrt(gx * gx + gz * gz);
    const reached = b >= reach;
    let ex = qx, ey = qy, ez = qz;
    if (reached) {
      // The last stretch ends where the shot is as far out as the target.
      const ax = px - e.x, az = pz - e.z;
      const a = dsqrt(ax * ax + az * az);
      const f = b > a ? (reach - a) / (b - a) : 1;
      ex = px + (qx - px) * f;
      ey = py + (qy - py) * f;
      ez = pz + (qz - pz) * f;
    }
    if (b >= keep) {
      const len = dsqrt((ex - px) * (ex - px) + (ey - py) * (ey - py) + (ez - pz) * (ez - pz));
      const n = Math.max(1, Math.ceil(len));
      for (let k = 1; k <= n; k++) path.push(px + ((ex - px) * k) / n, py + ((ey - py) * k) / n, pz + ((ez - pz) * k) / n);
    }
    if (reached) {
      const sp = dsqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      return { path, speed: sp, dx: v[0] / sp, dy: v[1] / sp, dz: v[2] / sp };
    }
    px = qx;
    py = qy;
    pz = qz;
    if (py < -5) return null;
  }
  return null;
}
