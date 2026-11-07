// The battlefield (map v2): a valley between the two castles, point symmetric
// about the middle of the field, so both players see the same valley from
// their own walls (left is left for both).
//
// Coordinates as in castle.ts: metres, Y up, the enemy castle at the origin
// and the player's at z = -DIST. Along the valley, u = z + DIST / 2 runs from
// the player's castle (u = -75) to the enemy's (u = +75); +x is the player's
// left. The ground at (x, u) equals the ground at (-x, -u).
//
// What is in it:
// - Flat pads under both castles (their stones stand on y = 0).
// - The centre road from gate to gate with a gentle S-bend, and two flank
//   paths that leave each gate, sweep out along the valley at x = +-48 and
//   come back in to the other gate.
// - Two low ridges between the road and the flank paths, with rocky crests.
// - A stream across the middle that meanders but crosses each route square
//   on, under a timber bridge (BRIDGES); it cuts through the ridges and the
//   valley sides in gorges.
// - The valley sides rising into crags, hills behind both castles, rocky
//   knolls as landmarks, and swells and hummocks over the valley floor.
//
// The height function feeds the physics (the sim's height grid) as well as
// the renderer, so it uses deterministic arithmetic only (+ - * /, floor,
// abs, min, max, integer hashing, dsin, dcos, dsqrt): the same bits on every
// machine.

import { DPI, dcos, dsin, dsqrt } from "@keepfall/core";
import { DIST } from "./field";

/** The middle of the field (z): the centre of the point symmetry. */
export const MID_Z = -DIST / 2;

/** The physics height grid, 1 m cells: vertex (i, j) is at x = x0 + i * cell, z = z0 + j * cell. Symmetric about (0, MID_Z). */
export const VALLEY_GRID = { x0: -96, z0: -208, cell: 1, nx: 193, nz: 267 } as const;

export type RouteName = "left" | "centre" | "right";

// ---------------------------------------------------------------------------
// Small deterministic helpers.

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in [0, 1). */
function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Fractal noise, roughly in [-0.5, 0.5]. */
function fbm(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += (vnoise(x * f + o * 17.3, z * f - o * 11.1, seed + o) - 0.5) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Ridged noise in [0, 1]: sharp crests, for crags and rocky tops. */
function ridged(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    const n = vnoise(x * f + o * 7.7, z * f + o * 3.9, seed + 31 * o);
    const r = 1 - Math.abs(2 * n - 1);
    sum += r * r * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}

/** Point-symmetric noise: the same at (x, u) and (-x, -u). */
function symFbm(x: number, u: number, scale: number, seed: number, octaves: number): number {
  return (fbm(x / scale, u / scale, seed, octaves) + fbm(-x / scale, -u / scale, seed, octaves)) * 0.7071067811865476;
}
function symRidged(x: number, u: number, scale: number, seed: number, octaves: number): number {
  return (ridged(x / scale, u / scale, seed, octaves) + ridged(-x / scale, -u / scale, seed, octaves)) * 0.5;
}

// ---------------------------------------------------------------------------
// The stream.

/** Water surface height; the bed lies `depth` below it in the middle of the channel; banks climb to the valley floor. */
export const STREAM = { level: -0.8, depth: 1.1, bank: 3 } as const;

const SK = (2 * DPI) / 144;

/**
 * The stream's centreline: z = MID_Z + streamOffset(x). Odd in x (point
 * symmetric), and each term has zero slope at x = 0 and x = +-48, so the
 * stream runs straight across where the routes cross it.
 */
export function streamOffset(x: number): number {
  const a = SK * x;
  return 4 * (dsin(a) - 0.5 * dsin(2 * a)) + 1.5 * (dsin(2 * a) - 0.5 * dsin(4 * a)) + 0.6 * (dsin(4 * a) - 0.5 * dsin(8 * a));
}

/** Slope dz/dx of the centreline. */
export function streamSlope(x: number): number {
  const a = SK * x;
  return SK * (4 * (dcos(a) - dcos(2 * a)) + 1.5 * (2 * dcos(2 * a) - 2 * dcos(4 * a)) + 0.6 * (4 * dcos(4 * a) - 4 * dcos(8 * a)));
}

/** Width of the water at x (even in x). */
export function streamWidth(x: number): number {
  return 6.6 + 1.4 * dcos(0.07 * x) + 0.6 * dcos(0.19 * x);
}

// ---------------------------------------------------------------------------
// Routes: the centre road and the two flank paths.

const FLANK_X = 48;

/** x of the centre road at u: an S-bend through the middle, straight at the gates and over the bridge. Odd in u. */
export function roadX(u: number): number {
  const a = Math.abs(u);
  if (a <= 6 || a >= 56) return 0;
  const s = dsin((DPI * (a - 6)) / 50);
  return (u < 0 ? -3.2 : 3.2) * s * s;
}

function roadSlope(u: number): number {
  const a = Math.abs(u);
  if (a <= 6 || a >= 56) return 0;
  return ((3.2 * DPI) / 50) * dsin((2 * DPI * (a - 6)) / 50);
}

/** x of the left flank path at u (the right flank is its mirror, -flankX(u)). Even in u. */
export function flankX(u: number): number {
  const a = Math.abs(u);
  if (a <= 30) return FLANK_X;
  if (a >= 57) return 0;
  const t = (a - 30) / 27;
  return FLANK_X * (1 - t * t * (3 - 2 * t));
}

function flankSlope(u: number): number {
  const a = Math.abs(u);
  if (a <= 30 || a >= 57) return 0;
  const t = (a - 30) / 27;
  const d = (-FLANK_X * 6 * t * (1 - t)) / 27;
  return u < 0 ? -d : d;
}

/** Half widths of the worn routes. */
export const ROUTE_HALF: Record<RouteName, number> = { left: 1.8, centre: 2.6, right: 1.8 };

/** The routes from the player's gate (u = -59.6) to the enemy's (u = +59.6), as x, z points 2 m apart along the valley. */
export interface Route {
  name: RouteName;
  half: number;
  /** x, z pairs. */
  points: Float64Array;
}

export function routes(): Route[] {
  const make = (name: RouteName, fx: (u: number) => number): Route => {
    const pts: number[] = [];
    for (let u = -59.6; u <= 59.61; u += 2) pts.push(fx(u), u + MID_Z);
    return { name, half: ROUTE_HALF[name], points: new Float64Array(pts) };
  };
  return [make("left", (u) => flankX(u)), make("centre", roadX), make("right", (u) => -flankX(u))];
}

/** How much a point lies on a route (1 on it, 0 off it), from the distance to the nearest route's centreline. */
export function routeWeight(x: number, z: number): number {
  const u = z - MID_Z;
  const a = Math.abs(u);
  if (a > 62) return 0;
  const dist = (x0: number, slope: number) => Math.abs(x - x0) / dsqrt(1 + slope * slope);
  const dRoad = dist(roadX(u), roadSlope(u)) - ROUTE_HALF.centre;
  const fx = flankX(u), fs = flankSlope(u);
  const dLeft = dist(fx, fs) - ROUTE_HALF.left;
  const dRight = dist(-fx, -fs) - ROUTE_HALF.right;
  const d = Math.min(dRoad, dLeft, dRight);
  const end = a > 59 ? smooth((a - 59) / 3) : 0;
  return (1 - smooth((d + 0.4) / 2.2)) * (1 - end);
}

// ---------------------------------------------------------------------------
// Bridges: one per route, square across the stream.

export interface BridgeSite {
  name: RouteName;
  /** The crossing's centre, on the stream's centreline. */
  x: number;
  z: number;
  /** Deck width (across the route) and length between the sills on the two banks (along it). */
  width: number;
  length: number;
}

function site(name: RouteName, x: number, width: number): BridgeSite {
  return { name, x, z: MID_Z + streamOffset(x), width, length: streamWidth(x) + 2 * (STREAM.bank + 0.4) };
}

/** In order of x, which is also the order of their pieces in the layout. */
export const BRIDGES: BridgeSite[] = [site("right", -FLANK_X, 3), site("centre", 0, 4), site("left", FLANK_X, 3)];

/** How much the ground at a point is levelled for a bridge's abutments (1 under the bridge ends, 0 away from them). */
function bridgePad(x: number, z: number): number {
  let w = 0;
  for (const b of BRIDGES) {
    const dx = Math.abs(x - b.x) - (b.width / 2 + 2.5);
    const dz = Math.abs(z - b.z) - (b.length / 2 + 2.5);
    const ox = dx > 0 ? dx : 0, oz = dz > 0 ? dz : 0;
    const d = dsqrt(ox * ox + oz * oz);
    const k = 1 - smooth(d / 4);
    if (k > w) w = k;
  }
  return w;
}

// ---------------------------------------------------------------------------
// The ground.

/** The castle pads: exactly flat within `half` of each castle centre, blending out over `blend`. */
const PAD = { half: 22, blend: 12 };

function padWeight(x: number, u: number): number {
  const ox = Math.abs(x) - PAD.half;
  const ou = Math.abs(Math.abs(u) - DIST / 2) - PAD.half;
  const dx = ox > 0 ? ox : 0, du = ou > 0 ? ou : 0;
  if (dx === 0 && du === 0) return 1;
  const d = dsqrt(dx * dx + du * du);
  return 1 - smooth(d / PAD.blend);
}

/** Craggy knolls: landmarks and cover. Each is mirrored through the middle of the field. */
const KNOLLS: Array<[number, number, number, number]> = [
  // x, u, radius, height
  [63, -24, 9, 4.6],
  [-70, -50, 12, 6.2],
  [37, 64, 7, 3.2],
  [-84, 12, 14, 7.5],
];

/** How far the valley floor reaches on the +x side at u (the -x side mirrors it: valleyEdge(-u)). */
function valleyEdge(u: number): number {
  return 64 + 5 * dsin(0.031 * u + 0.7) + 3 * dsin(0.077 * u + 2.1);
}

/** A slope that starts gently, steepens, then levels off into hills about 35 m up. */
function rise(d: number): number {
  if (d <= 0) return 0;
  if (d < 22) return 0.011 * d * d;
  const e = d - 22 < 120 ? d - 22 : 120;
  return 5.324 + 0.484 * e - 0.002 * e * e;
}

/** Ground height without the stream: the valley's shape and its surface. */
function landHeight(x: number, z: number): number {
  const u = z - MID_Z;
  const ax = Math.abs(x);
  // The valley sides and the hills behind the castles.
  const side = x >= 0 ? rise(x - valleyEdge(u)) : rise(-x - valleyEdge(-u));
  const back = rise(Math.abs(u) - 98) * 0.9;
  const shape = side + back;
  // Crags on the slopes, more the steeper and higher they get.
  const steep = shape > 0 ? smooth(shape / 7) : 0;
  let h = shape;
  if (steep > 0) h += (symRidged(x, u, 23, 101, 4) - 0.35) * 5.5 * steep + symFbm(x, u, 61, 102, 3) * 9 * steep;
  // Rolling hills far out, beyond the valley.
  const far = smooth((ax - 110) / 90) + smooth((Math.abs(u) - 150) / 90);
  if (far > 0) h += (symFbm(x, u, 140, 103, 4) + 0.25) * 30 * (far > 1 ? 1 : far);
  // The two ridges between the road and the flank paths, with rocky crests.
  const au = Math.abs(u);
  if (au < 36) {
    const wob = (s: number) => 24 + 2.5 * dsin(0.09 * s + 0.5) + 1.2 * dsin(0.23 * s + 1.9);
    const rc = x >= 0 ? wob(u) : -wob(-u);
    const t = (x - rc) / 10;
    if (t > -1 && t < 1) {
      const along = au <= 20 ? 1 : 1 - smooth((au - 20) / 16);
      const b = 1 - t * t;
      const crest = symRidged(x, u, 7, 104, 3);
      h += 3.6 * along * b * b * (0.7 + 0.6 * crest);
    }
  }
  // Knolls.
  for (const [kx, ku, r, kh] of KNOLLS) {
    for (const s of [1, -1]) {
      const dx = x - kx * s, du = u - ku * s;
      const d2 = dx * dx + du * du;
      if (d2 >= r * r) continue;
      const q = 1 - d2 / (r * r);
      h += kh * q * q * (0.55 + 0.9 * symRidged(x, u, 5.5, 105, 3));
    }
  }
  // Swells and hummocks over the floor, quieter on the routes.
  const onRoute = routeWeight(x, z);
  const floor = symFbm(x, u, 48, 106, 3) * 1.1 + symFbm(x, u, 13, 107, 3) * 0.36 + symFbm(x, u, 4.2, 108, 2) * 0.13;
  h += floor * (1 - 0.75 * onRoute);
  // Routes are worn a little into the ground.
  h -= 0.14 * onRoute;
  // Level ground under the castles and the bridge ends.
  const pad = padWeight(x, u);
  if (pad > 0) h *= 1 - pad;
  const bp = bridgePad(x, z);
  if (bp > 0) h *= 1 - bp;
  return h;
}

/**
 * Ground height at a point (deterministic). The stream cuts its channel into
 * the land: a gravel bed below the water, banks that climb to the land
 * around it, wider where the land is higher (gorges through the ridges and
 * the valley sides).
 */
export function valleyHeight(x: number, z: number): number {
  const land = landHeight(x, z);
  const half = streamWidth(x) / 2;
  const d = Math.abs(z - MID_Z - streamOffset(x)) / dsqrt(1 + streamSlope(x) * streamSlope(x));
  const lift = land > 0 ? land : 0;
  const bank = STREAM.bank + 0.8 * lift;
  if (d >= half + bank) return land;
  const L = STREAM.level;
  if (d < half) {
    const q = d / half;
    const u = z - MID_Z;
    const gravel = symFbm(x, u, 2.6, 109, 2) * 0.22;
    return L - STREAM.depth * (1 - q * q) + gravel * (1 - q);
  }
  const t = smooth((d - half) / bank);
  return L + (land - L) * t;
}

/** How wet the ground is near the stream (1 at the water's edge, 0 a few metres up the bank). Render use. */
export function bankWetness(x: number, z: number): number {
  const half = streamWidth(x) / 2;
  const d = Math.abs(z - MID_Z - streamOffset(x)) / dsqrt(1 + streamSlope(x) * streamSlope(x));
  return 1 - smooth((d - half) / (STREAM.bank + 1.5));
}

/** Castle footprints where craters may not dig (their stones stand on y = 0). */
export const NO_DIG: Array<{ x0: number; x1: number; z0: number; z1: number }> = [
  { x0: -19, x1: 19, z0: -19, z1: 19 },
  { x0: -19, x1: 19, z0: -DIST - 19, z1: -DIST + 19 },
];

let gridCache: Float32Array | null = null;

/** The ground over VALLEY_GRID (row by row, j outer), computed once and shared. Do not modify it. */
export function valleyGrid(): Float32Array {
  if (gridCache) return gridCache;
  const G = VALLEY_GRID;
  const h = new Float32Array(G.nx * G.nz);
  for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) h[j * G.nx + i] = valleyHeight(G.x0 + i * G.cell, G.z0 + j * G.cell);
  gridCache = h;
  return h;
}

// ---------------------------------------------------------------------------
// Bridge pieces. Timber, built square across the stream along z: sills on the
// banks, a pier in the stream (two posts and a cap), stringers from sill to
// pier, a deck of planks across them and a railing on each side. Pieces are
// fixed until hit, like masonry: blow the middle out and the deck falls in.

export interface BridgePiece {
  hx: number;
  hy: number;
  hz: number;
  x: number;
  y: number;
  z: number;
  /** A beam that needs both of its supports (a stringer between the bank and the pier). */
  span: boolean;
}

const BGAP = 0.004;
/** Deck top above the banks: low enough for a step up (0.6 m). */
export const DECK_TOP = 0.52;

export function bridgePieces(b: BridgeSite): BridgePiece[] {
  const out: BridgePiece[] = [];
  const add = (hx: number, hy: number, hz: number, x: number, y: number, z: number, span = false) => out.push({ hx: hx - BGAP, hy: hy - BGAP, hz: hz - BGAP, x, y, z, span });
  const W = b.width, L = b.length;
  const zs = b.z - L / 2, ze = b.z + L / 2;
  // Sills on both banks, and the pier's cap: tops at 0.2.
  add(W / 2 + 0.35, 0.1, 0.22, b.x, 0.1, zs);
  add(W / 2 + 0.35, 0.1, 0.22, b.x, 0.1, ze);
  // Pier posts from the stream bed up to the cap.
  const px = W / 2 - 0.35;
  for (const s of [-1, 1]) {
    const bed = valleyHeight(b.x + s * px, b.z) - 0.05;
    add(0.14, -bed / 2, 0.14, b.x + s * px, bed / 2, b.z);
  }
  add(W / 2 + 0.2, 0.1, 0.2, b.x, 0.1, b.z);
  // Stringers, three per span, resting on the sills and the cap: tops at 0.44.
  for (const [z0, z1] of [[zs - 0.2, b.z - 0.01], [b.z + 0.01, ze + 0.2]] as const) {
    for (const sx of [-px, 0, px]) add(0.12, 0.12, (z1 - z0) / 2, b.x + sx, 0.32, (z0 + z1) / 2, true);
  }
  // Deck planks across the stringers.
  const deck0 = zs - 0.3, deck1 = ze + 0.3;
  const n = Math.round((deck1 - deck0) / 0.5);
  const pw = (deck1 - deck0) / n;
  for (let i = 0; i < n; i++) add(W / 2 + 0.1, 0.04, pw / 2, b.x, 0.48, deck0 + pw * (i + 0.5));
  // Railings: posts on the planks along both edges, a rail from post to post.
  const m = Math.max(2, Math.floor(L / 2.2) + 1);
  const step = L / (m - 1);
  for (const s of [-1, 1]) {
    const rx = b.x + s * (W / 2 - 0.02);
    for (let i = 0; i < m; i++) add(0.06, 0.5, 0.06, rx, DECK_TOP + 0.5, zs + step * i);
    for (let i = 0; i < m - 1; i++) add(0.04, 0.05, (step - 0.12) / 2, rx, DECK_TOP + 0.95, zs + step * (i + 0.5));
  }
  return out;
}
