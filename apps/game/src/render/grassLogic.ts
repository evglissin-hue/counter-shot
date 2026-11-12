// Grass in tufts (look round L3.3), the logic without three: which ground
// takes grass, the tiles that ring the camera, and the clumps of one tile.
// Cosmetic only: nothing here feeds the match, so the clump scatter uses its
// own integer hash (the same tile always grows the same clumps).

import { BRIDGES, MID_Z, ROUTE_HALF, flankX, roadX, streamOffset, streamSlope, streamWidth } from "@keepfall/content";

/** Side of a tile (m). */
export const TILE = 8;
/** How far from the camera the tufts reach before they have shrunk to nothing (m). */
export const RANGE = 35;
/** Tiles whose centre lies within this of the camera are held (RANGE plus the half diagonal of a tile). */
export const HOLD = RANGE + TILE * 0.71;
/** Clumps in one tile, blades in a clump: at most about 19,000 blades in the ring. */
export const CLUMPS_PER_TILE = 40;
export const BLADES_PER_CLUMP = 6;
/** Slots for tiles: the most tiles any camera position holds, with a little spare. */
export const MAX_TILES = 100;
/** Clump height range (m): short, so a tuft never hides a man or a shot. */
export const HEIGHT_MIN = 0.15;
export const HEIGHT_MAX = 0.45;

/** Ground that is not grass: how far (m) from each thing the tufts keep away. */
export const KEEP_OFF = {
  /** From the edge of a route's worn width (the shader's packed mud with ruts runs to about 3.1 m from the centre). */
  route: 0.9,
  /** From the water's edge (mud banks). */
  stream: 2.4,
  /** From a bridge's footprint. */
  bridge: 2.5,
  /** From the outer wall square (trodden earth outside the walls, bare courtyard inside). */
  wall: 7,
  /** Slopes steeper than this (rise over run) are rock and scree. */
  slope: 0.55,
  /** A crater: the drawn ground this far (m) below the valley's own, or this far above it (a rim of thrown earth). */
  craterDepth: 0.04,
  craterRim: 0.1,
};

export interface GrassGround {
  /** The ground as drawn (the terrain mesh, craters included). */
  drawn(x: number, z: number): number;
}

function streamEdge(x: number, z: number): number {
  const s = streamSlope(x);
  return Math.abs(z - MID_Z - streamOffset(x)) / Math.sqrt(1 + s * s) - streamWidth(x) / 2;
}

function routeEdge(x: number, z: number): number {
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

function bridgeDistance(x: number, z: number): number {
  let best = Infinity;
  for (const b of BRIDGES) {
    const dx = Math.max(0, Math.abs(x - b.x) - b.width / 2 - 0.4);
    const dz = Math.max(0, Math.abs(z - b.z) - b.length / 2 - 0.5);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/** Distance (m) from the nearest castle's outer wall square (negative inside); the walls are 15 m from each centre. */
export function wallDistance(x: number, z: number): number {
  const d0 = Math.max(Math.abs(x) - 15, Math.abs(z) - 15);
  const d1 = Math.max(Math.abs(x) - 15, Math.abs(z + 150) - 15);
  return Math.min(d0, d1);
}

/**
 * Does grass grow at (x, z)? Not on the road and the flank paths, the stream
 * and its banks, the bridges, the castle pads and courtyards, steep rock, or
 * in a crater (or on its rim). `valley` is the valley's own height, `ground`
 * the drawn one.
 */
export function isGrass(x: number, z: number, valley: (x: number, z: number) => number, ground: GrassGround): boolean {
  if (routeEdge(x, z) < KEEP_OFF.route) return false;
  if (streamEdge(x, z) < KEEP_OFF.stream) return false;
  if (bridgeDistance(x, z) < KEEP_OFF.bridge) return false;
  if (wallDistance(x, z) < KEEP_OFF.wall) return false;
  const e = 0.8;
  const hx = valley(x + e, z) - valley(x - e, z);
  const hz = valley(x, z + e) - valley(x, z - e);
  if (Math.hypot(hx, hz) / (2 * e) > KEEP_OFF.slope) return false;
  const d = ground.drawn(x, z) - valley(x, z);
  if (d < -KEEP_OFF.craterDepth || d > KEEP_OFF.craterRim) return false;
  return true;
}

// --- the ring of tiles -----------------------------------------------------------

export function tileKey(tx: number, tz: number): number {
  return (tx + 32768) * 65536 + (tz + 32768);
}

/**
 * The tiles held round the camera. `update` reports the tiles that came into
 * range and those that left; a tile that stays is never reported, so only new
 * ground is worked out as the camera moves.
 */
export class TileRing {
  private held = new Map<number, [number, number]>();
  private lastX = NaN;
  private lastZ = NaN;

  get count(): number {
    return this.held.size;
  }

  has(tx: number, tz: number): boolean {
    return this.held.has(tileKey(tx, tz));
  }

  /** Forget everything: the next update reports every tile in range as entering. */
  reset(leave?: (tx: number, tz: number) => void) {
    if (leave) for (const [tx, tz] of this.held.values()) leave(tx, tz);
    this.held.clear();
    this.lastX = NaN;
  }

  update(camX: number, camZ: number, enter: (tx: number, tz: number) => void, leave: (tx: number, tz: number) => void) {
    // Nothing can have changed until the camera crosses into another quarter tile (cheap early out).
    const qx = Math.floor((camX / TILE) * 4), qz = Math.floor((camZ / TILE) * 4);
    if (qx === this.lastX && qz === this.lastZ) return;
    this.lastX = qx;
    this.lastZ = qz;
    const r = Math.ceil(HOLD / TILE) + 1;
    const cx = Math.floor(camX / TILE), cz = Math.floor(camZ / TILE);
    for (const [key, t] of this.held) {
      if (!this.inRange(t[0], t[1], camX, camZ)) {
        this.held.delete(key);
        leave(t[0], t[1]);
      }
    }
    for (let tz = cz - r; tz <= cz + r; tz++) {
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (!this.inRange(tx, tz, camX, camZ)) continue;
        const key = tileKey(tx, tz);
        if (this.held.has(key)) continue;
        this.held.set(key, [tx, tz]);
        enter(tx, tz);
      }
    }
  }

  private inRange(tx: number, tz: number, camX: number, camZ: number): boolean {
    return Math.hypot((tx + 0.5) * TILE - camX, (tz + 0.5) * TILE - camZ) <= HOLD;
  }
}

// --- the clumps of a tile ----------------------------------------------------------

function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, 7), b = hash(ix + 1, iz, 7), c = hash(ix, iz + 1, 7), d = hash(ix + 1, iz + 1, 7);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Where a tile's clump i would stand (stratified over the tile, jittered) and its look; `out` is [x, z, height, yaw, tint, phase]. */
export function clumpSeed(tx: number, tz: number, i: number, out: number[]) {
  // An 8 by 5 grid of cells over the tile, one clump jittered inside each.
  const cols = 8;
  const cx = i % cols, cz = Math.floor(i / cols);
  const cw = TILE / cols, ch = TILE / (CLUMPS_PER_TILE / cols);
  out[0] = tx * TILE + (cx + hash(tx, tz, i * 7 + 1)) * cw;
  out[1] = tz * TILE + (cz + hash(tx, tz, i * 7 + 2)) * ch;
  out[2] = HEIGHT_MIN + (HEIGHT_MAX - HEIGHT_MIN) * Math.pow(hash(tx, tz, i * 7 + 3), 1.4);
  out[3] = hash(tx, tz, i * 7 + 4) * Math.PI * 2;
  out[4] = hash(tx, tz, i * 7 + 5);
  out[5] = hash(tx, tz, i * 7 + 6) * 6.2831853;
}

/** Meadow patchiness: grass thins into bare patches (the chance, 0..1, that a clump stands here). */
export function density(x: number, z: number): number {
  const n = vnoise(x / 9 + 11.3, z / 9 - 4.1) * 0.65 + vnoise(x / 3.1, z / 3.1) * 0.35;
  return Math.min(1, Math.max(0.12, (n - 0.18) * 2.6));
}

/**
 * Work out one tile: calls `put(x, z, height, yaw, tint, phase)` for every clump
 * that stands (the grass test and the meadow's patchiness decide) and returns
 * how many that was.
 */
export function placeTile(
  tx: number,
  tz: number,
  valley: (x: number, z: number) => number,
  ground: GrassGround,
  put: (x: number, z: number, h: number, yaw: number, tint: number, phase: number) => void,
): number {
  const s: number[] = [0, 0, 0, 0, 0, 0];
  let n = 0;
  for (let i = 0; i < CLUMPS_PER_TILE; i++) {
    clumpSeed(tx, tz, i, s);
    if (hash(tx, tz, i * 7 + 9) > density(s[0], s[1])) continue;
    if (!isGrass(s[0], s[1], valley, ground)) continue;
    put(s[0], s[1], s[2], s[3], s[4], s[5]);
    n++;
  }
  return n;
}
