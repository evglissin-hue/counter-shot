// The valley's routes and stream for the renderer: shader (TSL) versions of
// content's map functions, so a material can tell per pixel how far it is
// from the road, a flank path or the stream, and CPU distances for placing
// scatter. Render only: these follow @keepfall/content's map.ts formulas but
// never feed the physics.

import { abs, clamp, cos, float, max, min, select, sin, smoothstep, sqrt } from "three/tsl";
import { BRIDGES, MID_Z, ROUTE_HALF, STREAM, flankX, roadX, streamOffset, streamSlope, streamWidth } from "@keepfall/content";
import type { N } from "./tslUtils";

const SK = (2 * Math.PI) / 144;

/** Offset of the stream's centreline from MID_Z at x (as content's streamOffset). */
export function streamOffsetNode(x: N): N {
  const a: N = x.mul(SK);
  const s1 = sin(a), s2 = sin(a.mul(2)), s4 = sin(a.mul(4)), s8 = sin(a.mul(8));
  return s1.sub(s2.mul(0.5)).mul(4).add(s2.sub(s4.mul(0.5)).mul(1.5)).add(s4.sub(s8.mul(0.5)).mul(0.6));
}

/** Slope dz/dx of the centreline. */
export function streamSlopeNode(x: N): N {
  const a: N = x.mul(SK);
  const c1 = cos(a), c2 = cos(a.mul(2)), c4 = cos(a.mul(4)), c8 = cos(a.mul(8));
  return c1.sub(c2).mul(4).add(c2.sub(c4).mul(3)).add(c4.sub(c8).mul(2.4)).mul(SK);
}

export function streamWidthNode(x: N): N {
  return float(6.6).add(cos(x.mul(0.07)).mul(1.4)).add(cos(x.mul(0.19)).mul(0.6));
}

/** Signed distance from the water's edge (negative in the water), and the stream half width. */
export function streamEdgeNode(x: N, z: N): { edge: N; half: N } {
  const s: N = streamSlopeNode(x);
  const d: N = abs(z.sub(MID_Z).sub(streamOffsetNode(x))).div(sqrt(s.mul(s).add(1)));
  const half: N = streamWidthNode(x).mul(0.5);
  return { edge: d.sub(half), half };
}

/**
 * Distances (m) from the centrelines of the three routes, and how far along
 * the valley they run: { road, left, right }. Large away from the routes.
 */
export function routeDistanceNodes(x: N, z: N): { road: N; left: N; right: N } {
  const u: N = z.sub(MID_Z);
  const a: N = abs(u);
  const inRange: N = float(1).sub(smoothstep(59.5, 62, a));
  const far = float(1e4);
  // Road: +-3.2 sin^2(pi t), t = (|u| - 6) / 50, straight beyond.
  const t: N = clamp(a.sub(6).div(50), 0, 1);
  const s: N = sin(t.mul(Math.PI));
  const rx: N = s.mul(s).mul(3.2).mul(select(u.lessThan(0), float(-1), float(1)));
  const rs: N = sin(t.mul(2 * Math.PI)).mul((3.2 * Math.PI) / 50);
  const road: N = abs(x.sub(rx)).div(sqrt(rs.mul(rs).add(1)));
  // Flank paths: 48 (1 - smoothstep(30, 57, |u|)).
  const f: N = clamp(a.sub(30).div(27), 0, 1);
  const fx: N = float(48).mul(float(1).sub(f.mul(f).mul(float(3).sub(f.mul(2)))));
  const fs: N = f.mul(float(1).sub(f)).mul((48 * 6) / 27);
  const k: N = sqrt(fs.mul(fs).add(1));
  const left: N = abs(x.sub(fx)).div(k);
  const right: N = abs(x.add(fx)).div(k);
  const off: N = far.mul(float(1).sub(inRange));
  return { road: road.add(off), left: left.add(off), right: right.add(off) };
}

/** Distance to the nearest castle's outer wall square (negative inside). */
export function wallDistanceNode(x: N, z: N): N {
  const ax: N = abs(x);
  const d0: N = max(ax.sub(15), abs(z).sub(15));
  const d1: N = max(ax.sub(15), abs(z.add(150)).sub(15));
  return min(d0, d1);
}

// --- CPU helpers for placing scatter ---------------------------------------------

/** Distance (m) from the water's edge: negative in the water. */
export function streamEdge(x: number, z: number): number {
  const s = streamSlope(x);
  return Math.abs(z - MID_Z - streamOffset(x)) / Math.sqrt(1 + s * s) - streamWidth(x) / 2;
}

/** Distance (m) from the nearest route's edge (negative on it); Infinity beyond the routes. */
export function routeEdge(x: number, z: number): number {
  const u = z - MID_Z;
  if (Math.abs(u) > 61) return Infinity;
  const e = 0.05;
  const slope = (fn: (u: number) => number) => (fn(u + e) - fn(u - e)) / (2 * e);
  const rs = slope(roadX), fs = slope(flankX);
  const road = Math.abs(x - roadX(u)) / Math.sqrt(1 + rs * rs) - ROUTE_HALF.centre;
  const k = Math.sqrt(1 + fs * fs);
  const left = Math.abs(x - flankX(u)) / k - ROUTE_HALF.left;
  const right = Math.abs(x + flankX(u)) / k - ROUTE_HALF.right;
  return Math.min(road, left, right);
}

/** Distance (m) from the nearest bridge's footprint. */
export function bridgeDistance(x: number, z: number): number {
  let best = Infinity;
  for (const b of BRIDGES) {
    const dx = Math.max(0, Math.abs(x - b.x) - b.width / 2 - 0.4);
    const dz = Math.max(0, Math.abs(z - b.z) - b.length / 2 - 0.5);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/** Distance (m) from the nearest castle centre's square (Chebyshev). */
export function castleDistance(x: number, z: number): number {
  return Math.min(Math.max(Math.abs(x), Math.abs(z)), Math.max(Math.abs(x), Math.abs(z + 150)));
}

/** Between the castle fronts, where shots fly: keep tall things out. */
export function inFiringLane(x: number, z: number): boolean {
  return Math.abs(x) < 30 && z > -170 && z < 20;
}

/** Pier posts in the stream: x, z of each (two per bridge). */
export const PIER_POSTS: Array<[number, number]> = BRIDGES.flatMap((b) => [
  [b.x - (b.width / 2 - 0.35), b.z] as [number, number],
  [b.x + (b.width / 2 - 0.35), b.z] as [number, number],
]);

export const WATER_LEVEL = STREAM.level;
