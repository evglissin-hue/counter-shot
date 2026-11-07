// Trees, bushes, reeds, rocks and logs over the valley, seeded so every
// device gets the same landscape:
// - forests of conifers with broadleaf stands and a few dead trees on the
//   valley sides and the hills, thinning into groves on the outer floor,
//   and small copses on the knolls;
// - bushes and gorse over the valley floor, thicker along the stream banks
//   and the ridges;
// - reeds at the water's edge;
// - boulders on the crags, ridges and knolls, and stones in the grass;
// - a few fallen logs at the forest edges.
// Readability first (SPEC 13): nothing tall between the castle fronts, on
// the routes, in the stream or on the castle pads.
//
// Each plant type merges its parts into one geometry (an `aPart` attribute
// tells wood from foliage) so a type is one instanced draw. Things near the
// battlefield cast shadows; far ones do not. Low quality draws half of each.

import * as THREE from "three/webgpu";
import {
  Fn,
  atan,
  attribute,
  color,
  mix,
  positionGeometry,
  positionLocal,
  sin,
  smoothstep,
  texture,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { BRIDGES, MID_Z, STREAM, streamOffset, streamSlope, streamWidth, valleyHeight } from "@keepfall/content";
import { Rng } from "@keepfall/core";
import { mergeByPosition, mergeGeometries, rockGeometry } from "./geometry";
import type { StyleName, StylePreset } from "./styles";
import type { N } from "./tslUtils";
import { bridgeDistance, castleDistance, inFiringLane, routeEdge, streamEdge } from "./valleyNodes";

interface Spot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number;
  tint: number;
  variant: number;
  near: boolean;
  /** Tilt for rocks and logs (radians). */
  tilt?: number;
}

function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** The valley floor's edge on the +x side at u (content's map; the -x side mirrors it). */
function valleyEdge(u: number): number {
  return 64 + 5 * Math.sin(0.031 * u + 0.7) + 3 * Math.sin(0.077 * u + 2.1);
}

/** How far a point lies up the valley sides or behind the castles (m beyond the floor's edge; negative on the floor). */
function beyondFloor(x: number, z: number): number {
  const u = z - MID_Z;
  const side = x >= 0 ? x - valleyEdge(u) : -x - valleyEdge(-u);
  return Math.max(side, Math.abs(u) - 98);
}

function slopeAt(x: number, z: number): number {
  const e = 0.8;
  const hx = valleyHeight(x + e, z) - valleyHeight(x - e, z);
  const hz = valleyHeight(x, z + e) - valleyHeight(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}

/** Knolls (content's map: x, u, radius), each mirrored through the middle of the field. */
const KNOLLS: Array<[number, number, number]> = [
  [63, -24, 9],
  [-70, -50, 12],
  [37, 64, 7],
  [-84, 12, 14],
].flatMap(([x, u, r]) => [[x, u + MID_Z, r], [-x, -u + MID_Z, r]] as Array<[number, number, number]>);

function nearBattlefield(x: number, z: number): boolean {
  return Math.abs(x) < 150 && z > MID_Z - 200 && z < MID_Z + 200;
}

/** Forests on the valley sides and hills, groves on the outer floor, copses on the knolls. */
function placeTrees(count: number): Spot[] {
  const rng = new Rng(9101).fork("trees");
  const out: Spot[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    // Most candidates near the valley, where the forests are seen from the walls; the rest out to the horizon.
    const wide = rng.next() < 0.42;
    const x = (rng.next() * 2 - 1) * (wide ? 820 : 230);
    const z = MID_Z + (rng.next() * 2 - 1) * (wide ? 820 : 260);
    const r0 = rng.next(), r1 = rng.next(), r2 = rng.next(), r3 = rng.next(), r4 = rng.next();
    const clump = vnoise(x / 90 + 3.1, z / 90 - 1.7) * 0.7 + vnoise(x / 23, z / 23) * 0.3;
    const up = beyondFloor(x, z);
    // Forest up the sides; open groves beyond the flank paths; nothing on the inner floor.
    let p = up > -2 ? Math.max(0, (clump - 0.3) * 3.4) * Math.min(1, 0.45 + (up + 2) / 14) : Math.abs(x) > 56 ? Math.max(0, (clump - 0.52) * 1.6) : 0;
    const d = Math.hypot(Math.max(0, Math.abs(x) - 100), Math.max(0, Math.abs(z - MID_Z) - 140));
    if (d > 400) p *= Math.max(0.15, 1 - (d - 400) / 500);
    if (r0 > p) continue;
    if (inFiringLane(x, z) || castleDistance(x, z) < 36) continue;
    if (routeEdge(x, z) < 5 || streamEdge(x, z) < 4 || bridgeDistance(x, z) < 10) continue;
    const y = valleyHeight(x, z);
    if (slopeAt(x, z) > 1.05) continue;
    // Species in stands: broadleaf lower down, conifers higher, a few dead trees anywhere.
    const stand = vnoise(x / 60 - 7.7, z / 60 + 2.2) + (y > 14 ? 0.25 : 0) - (y < 5 ? 0.15 : 0);
    const variant = r4 < 0.07 ? 0.97 : stand < 0.42 ? 0.7 + r3 * 0.15 : r3 * 0.6;
    out.push({ x, y: y - 0.15, z, yaw: r1 * Math.PI * 2, s: 0.7 + r2 * 0.75 + Math.max(0, clump - 0.6) * 0.6, tint: rng.next(), variant, near: nearBattlefield(x, z) });
  }
  // Copses on the knolls: a few trees round each, off the rocky tops.
  const rc = new Rng(9102).fork("copses");
  for (const [kx, kz, kr] of KNOLLS) {
    const n = 4 + Math.floor(rc.next() * 5);
    for (let i = 0; i < n; i++) {
      const a = rc.next() * Math.PI * 2;
      const rr = kr * (0.55 + rc.next() * 0.7);
      const x = kx + Math.cos(a) * rr, z = kz + Math.sin(a) * rr;
      const tint = rc.next(), yaw = rc.next() * Math.PI * 2, s = 0.75 + rc.next() * 0.5, v = rc.next();
      if (inFiringLane(x, z) || routeEdge(x, z) < 5 || streamEdge(x, z) < 4 || castleDistance(x, z) < 36) continue;
      out.push({ x, y: valleyHeight(x, z) - 0.15, z, yaw, s, tint, variant: v < 0.5 ? 0.75 : v * 0.6, near: true });
    }
  }
  return out;
}

/** Bushes and gorse over the valley floor, thicker along the banks and the ridges. */
function placeBushes(count: number): Spot[] {
  const rng = new Rng(9103).fork("bushes");
  const out: Spot[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 30) {
    const x = (rng.next() * 2 - 1) * 130;
    const z = MID_Z + (rng.next() * 2 - 1) * 175;
    const r0 = rng.next(), r1 = rng.next(), r2 = rng.next(), r3 = rng.next();
    const clump = vnoise(x / 28 + 9.3, z / 28 - 4.1) * 0.75 + vnoise(x / 7, z / 7) * 0.25;
    const se = streamEdge(x, z);
    const bank = se > 0.8 && se < 7 ? 0.75 : 0;
    const ridge = Math.abs(Math.abs(x) - 24) < 9 && Math.abs(z - MID_Z) < 36 ? 0.35 : 0;
    const p = Math.max(0, (clump - 0.5) * 2.4) + bank * Math.max(0, clump - 0.25) * 2 + ridge * clump;
    if (r0 > p) continue;
    if (routeEdge(x, z) < 1.2 || se < 0.8 || bridgeDistance(x, z) < 2.5 || castleDistance(x, z) < 26) continue;
    const y = valleyHeight(x, z);
    if (slopeAt(x, z) > 0.9) continue;
    out.push({ x, y: y - 0.12, z, yaw: r1 * Math.PI * 2, s: 0.55 + r2 * 0.75, tint: rng.next(), variant: r3, near: Math.abs(x) < 110 });
  }
  return out;
}

/** Reed clumps along both banks at the water's edge (the visible stretch). */
function placeReeds(): Spot[] {
  const rng = new Rng(9104).fork("reeds");
  const out: Spot[] = [];
  for (let x = -240; x <= 240; x += 0.55) {
    for (const side of [-1, 1]) {
      const r0 = rng.next(), r1 = rng.next(), r2 = rng.next(), r3 = rng.next(), r4 = rng.next();
      const clump = vnoise(x / 9 + side * 13.7, 4.4) * 0.8 + vnoise(x / 2.3, side * 3.1) * 0.2;
      if (r0 > Math.max(0, (clump - 0.42) * 2.6)) continue;
      let skip = false;
      for (const b of BRIDGES) if (Math.abs(x - b.x) < b.width / 2 + 1.2) skip = true;
      if (skip) continue;
      const sl = streamSlope(x);
      const l = Math.hypot(1, sl);
      const off = side * (streamWidth(x) / 2 + (r1 - 0.45) * 1.6);
      const px = x + (-sl / l) * off, pz = MID_Z + streamOffset(x) + (1 / l) * off;
      const y = Math.max(valleyHeight(px, pz), STREAM.level - 0.25);
      out.push({ x: px, y: y - 0.1, z: pz, yaw: r2 * Math.PI * 2, s: 0.7 + r3 * 0.6, tint: r4, variant: rng.next(), near: Math.abs(x) < 110 });
    }
  }
  return out;
}

/** Boulders on crags, ridges and knolls; stones in the grass. */
function placeRocks(count: number): Spot[] {
  const rng = new Rng(9105).fork("rocks");
  const out: Spot[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 30) {
    const x = (rng.next() * 2 - 1) * 420;
    const z = MID_Z + (rng.next() * 2 - 1) * 420;
    const r0 = rng.next(), r1 = rng.next(), r2 = rng.next(), r3 = rng.next(), r4 = rng.next(), r5 = rng.next();
    const up = beyondFloor(x, z);
    const ridge = Math.abs(Math.abs(x) - 24) < 6 && Math.abs(z - MID_Z) < 30 ? 1 : 0;
    let knoll = 0;
    for (const [kx, kz, kr] of KNOLLS) if (Math.hypot(x - kx, z - kz) < kr * 0.85) knoll = 1;
    const clump = vnoise(x / 34 - 9.1, z / 34 + 4.2);
    let p = Math.max(0, (clump - 0.45) * 2.2) * (up > 0 ? 1.2 : 0.35) + ridge * 0.5 + knoll * 0.8;
    if (Math.hypot(Math.max(0, Math.abs(x) - 110), Math.max(0, Math.abs(z - MID_Z) - 150)) > 200) p *= 0.4;
    if (r0 > p) continue;
    const big = r1 < (up > 4 || knoll ? 0.22 : 0.06);
    const s = big ? 1.4 + r3 * 1.8 : 0.25 + r3 * 0.75;
    // Keep a stone's own size clear of the routes, the water and the bridges.
    if (routeEdge(x, z) < 1 + s || streamEdge(x, z) < 0.6 + s * 1.2 || bridgeDistance(x, z) < 3 + s || castleDistance(x, z) < 24) continue;
    const y = valleyHeight(x, z);
    out.push({ x, y: y - 0.12, z, yaw: r2 * Math.PI * 2, s, tint: r4, variant: r5, near: nearBattlefield(x, z) && Math.abs(x) < 120, tilt: (r5 - 0.5) * 0.5 });
  }
  return out;
}

/** A few fallen logs at the forest edges and the outer floor. */
function placeLogs(count: number): Spot[] {
  const rng = new Rng(9106).fork("logs");
  const out: Spot[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 400) {
    const x = (rng.next() * 2 - 1) * 160;
    const z = MID_Z + (rng.next() * 2 - 1) * 200;
    const r1 = rng.next(), r2 = rng.next(), r3 = rng.next();
    const up = beyondFloor(x, z);
    if (up < -14 || up > 30) continue;
    if (inFiringLane(x, z) || Math.abs(x) < 40 || routeEdge(x, z) < 3 || streamEdge(x, z) < 2 || castleDistance(x, z) < 30) continue;
    if (slopeAt(x, z) > 0.5) continue;
    out.push({ x, y: valleyHeight(x, z) + 0.12, z, yaw: r1 * Math.PI * 2, s: 0.7 + r2 * 0.6, tint: r3, variant: rng.next(), near: true });
  }
  return out;
}

// --- geometries -----------------------------------------------------------------

function withPart(g: THREE.BufferGeometry, part: number, shadeFn?: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const ng = g;
  if (ng.attributes.uv) ng.deleteAttribute("uv");
  const n = ng.attributes.position.count;
  const partA = new Float32Array(n).fill(part);
  const shade = new Float32Array(n);
  const p = ng.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) shade[i] = shadeFn ? shadeFn(p.getX(i), p.getY(i), p.getZ(i)) : 1;
  ng.setAttribute("aPart", new THREE.BufferAttribute(partA, 1));
  ng.setAttribute("aShade", new THREE.BufferAttribute(shade, 1));
  return ng;
}

function conifer(seed: number, tiers: number, sides = 10): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const trunk = new THREE.CylinderGeometry(0.1, 0.24, 3.4, 6, 1);
  trunk.translate(0, 1.7, 0);
  const parts: THREE.BufferGeometry[] = [withPart(trunk, 0, () => 0.6)];
  let y = 1.6;
  let r = 2.1;
  for (let i = 0; i < tiers; i++) {
    const h = 3.0 - i * 0.35;
    const cone = new THREE.ConeGeometry(r, h, sides, 2, true);
    // Ragged lower rim.
    const pos = cone.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const py = pos.getY(k);
      if (py < -h / 2 + 0.01) {
        const j = 0.75 + rng.next() * 0.5;
        pos.setXYZ(k, pos.getX(k) * j, py - rng.next() * 0.35, pos.getZ(k) * j);
      }
    }
    cone.computeVertexNormals();
    cone.rotateY(rng.next() * Math.PI);
    cone.translate(0, y + h / 2, 0);
    const base = y;
    parts.push(withPart(cone, 1, (_x, yy) => 0.45 + Math.min(1, (yy - base) / h) * 0.55 + i * 0.08));
    y += h * 0.55;
    r *= 0.74;
  }
  return mergeGeometries(parts);
}

function deadTree(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.08, 0.24, 5.2, 6, 1);
  trunk.translate(0, 2.6, 0);
  parts.push(withPart(trunk, 0, () => 0.6));
  for (let i = 0; i < 4; i++) {
    const br = new THREE.CylinderGeometry(0.03, 0.08, 1.8, 4, 1);
    br.translate(0, 0.9, 0);
    br.rotateZ(0.7 + rng.next() * 0.4);
    br.rotateY(rng.next() * Math.PI * 2);
    br.translate(0, 2.2 + i * 0.8, 0);
    parts.push(withPart(br, 0, () => 0.6));
  }
  return mergeGeometries(parts);
}

/** A lumpy blob: an icosphere with seeded radial jitter (closed and smooth). */
function blob(seed: number, detail: number, rx: number, ry: number, rz: number, rough = 0.28): THREE.BufferGeometry {
  // A low sphere (detail 0: 6 by 4 segments, about 40 triangles; 1: 9 by 6, about 100), closed at its seam,
  // its underside flattened, each vertex pushed in or out a little.
  const s = detail <= 0 ? new THREE.SphereGeometry(1, 6, 4) : new THREE.SphereGeometry(1, 9, 6);
  s.deleteAttribute("uv");
  s.deleteAttribute("normal");
  const g = mergeByPosition(s);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const rng = new Rng(seed + 1);
  for (let i = 0; i < pos.count; i++) {
    const k = 1 + (rng.next() - 0.5) * rough;
    const y = pos.getY(i);
    pos.setXYZ(i, pos.getX(i) * rx * k, (y < 0 ? y * 0.5 : y) * ry * k, pos.getZ(i) * rz * k);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A broadleaf tree late in the year: a short, stout trunk forking into limbs
 * under a broad, uneven crown of overlapping masses that comes down low.
 */
function broadleaf(seed: number, lobes: number, detail: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.36, 3.2, 7, 1);
  trunk.translate(0, 1.6, 0);
  parts.push(withPart(trunk, 0, () => 0.6));
  for (let i = 0; i < 3; i++) {
    const limb = new THREE.CylinderGeometry(0.07, 0.17, 2.6, 5, 1);
    limb.translate(0, 1.3, 0);
    limb.rotateZ(0.55 + rng.next() * 0.35);
    limb.rotateY((i / 3) * Math.PI * 2 + rng.next() * 0.6);
    limb.translate(0, 2.6, 0);
    parts.push(withPart(limb, 0, () => 0.6));
  }
  const shade = (_x: number, yy: number) => 0.3 + Math.min(1, Math.max(0, (yy - 2.6) / 5.4)) * 0.7;
  // The crown: a central mass and a ring of lower, overlapping ones.
  const top = blob(seed * 7, detail, 2.5, 2.8, 2.4, 0.32);
  top.translate(0, 6.0, 0);
  parts.push(withPart(top, 1, shade));
  for (let i = 1; i < lobes + 2; i++) {
    const a = (i / (lobes + 1)) * Math.PI * 2 + rng.next() * 0.7;
    const rr = 1.6 + rng.next() * 0.8;
    const r = 1.5 + rng.next() * 0.8;
    const b = blob(seed * 7 + i, 0, r, r * 1.0, r, 0.34);
    b.translate(Math.cos(a) * rr, 3.9 + rng.next() * 2.4, Math.sin(a) * rr);
    parts.push(withPart(b, 1, shade));
  }
  return mergeGeometries(parts);
}

/** A round shrub: a few squat lumps. */
function shrub(seed: number, detail = 1): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 2; i++) {
    const r = 0.6 + rng.next() * 0.35;
    const b = blob(seed * 5 + i, detail, r * 1.15, r * 0.72, r, 0.35);
    b.translate((rng.next() - 0.5) * 0.9, r * 0.45, (rng.next() - 0.5) * 0.9);
    parts.push(withPart(b, 1, (_x, yy) => 0.3 + Math.min(1, Math.max(0, yy / 1.1)) * 0.7));
  }
  return mergeGeometries(parts);
}

/** Gorse: a spiky clump of thin shoots round a dark core. */
function gorse(seed: number, detail = 1): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const core = blob(seed * 3, detail, 0.55, 0.42, 0.55, 0.4);
  core.translate(0, 0.3, 0);
  parts.push(withPart(core, 1, () => 0.35));
  for (let i = 0; i < 11; i++) {
    const h = 0.8 + rng.next() * 0.7;
    const shoot = new THREE.ConeGeometry(0.11, h, 4, 1, true);
    shoot.translate(0, h / 2, 0);
    shoot.rotateZ((rng.next() - 0.5) * 0.9);
    shoot.rotateX((rng.next() - 0.5) * 0.9);
    shoot.translate((rng.next() - 0.5) * 0.6, 0.05, (rng.next() - 0.5) * 0.6);
    parts.push(withPart(shoot, 1, (_x, yy) => 0.35 + Math.min(1, Math.max(0, yy / h)) * 0.75));
  }
  return mergeGeometries(parts);
}

/** A reed clump: thin curved blades and a few seed heads, leaning out. */
function reeds(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const pos: number[] = [];
  const nrm: number[] = [];
  const shade: number[] = [];
  const idx: number[] = [];
  for (let b = 0; b < 12; b++) {
    const h = 0.9 + rng.next() * 0.9;
    const a = rng.next() * Math.PI * 2;
    const lean = 0.08 + rng.next() * 0.28;
    const w = 0.035 + rng.next() * 0.02;
    const bx = (rng.next() - 0.5) * 0.5, bz = (rng.next() - 0.5) * 0.5;
    const dx = Math.cos(a), dz = Math.sin(a);
    const sx = -dz, sz = dx; // blade width across the lean
    const base = pos.length / 3;
    const segs = 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const off = lean * h * t * t;
      const ww = w * (1 - t * 0.85);
      const cx = bx + dx * off, cy = h * t, cz = bz + dz * off;
      pos.push(cx - sx * ww, cy, cz - sz * ww, cx + sx * ww, cy, cz + sz * ww);
      // Normals face across the blade, tilted up a little.
      nrm.push(dx * 0.8, 0.6, dz * 0.8, dx * 0.8, 0.6, dz * 0.8);
      shade.push(t, t);
    }
    for (let s = 0; s < segs; s++) {
      const i0 = base + s * 2;
      idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("aShade", new THREE.Float32BufferAttribute(shade, 1));
  g.setAttribute("aPart", new THREE.Float32BufferAttribute(new Array(shade.length).fill(1), 1));
  g.setIndex(idx);
  return g;
}

/** A fallen log along X: bark round the sides (part 0), sawn or broken ends (part 1). */
function logGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.28, 0.32, 5, 9, 1, false);
  g.rotateZ(Math.PI / 2);
  const n = g.attributes.position.count;
  const part = new Float32Array(n);
  const nor = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) part[i] = Math.abs(nor.getX(i)) > 0.9 ? 1 : 0;
  g.deleteAttribute("uv");
  g.setAttribute("aPart", new THREE.BufferAttribute(part, 1));
  g.setAttribute("aShade", new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  return g;
}

// --- materials -----------------------------------------------------------------

interface Palette {
  leaf: number;
  leafLight: number;
  leafDark: number;
  trunk: number;
}

function plantMaterial(name: string, id: string, P: Palette, time: N, swayAmount: number, swayFrom: number, swayTo: number, doubleSided = false): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = name;
  mat.metalness = 0;
  mat.roughness = 0.95;
  if (doubleSided) mat.side = THREE.DoubleSide;
  const part: N = attribute("aPart", "float");
  const shade: N = attribute("aShade", "float");
  const vPart: N = varying(part, `v${id}Part`);
  const vShade: N = varying(shade, `v${id}Shade`);
  // Sway in the wind, phase from the instance's position.
  const lp: N = positionLocal;
  const sway: N = smoothstep(swayFrom, swayTo, positionGeometry.y).mul(part).mul(swayAmount);
  const ph: N = lp.x.mul(0.13).add(lp.z.mul(0.11));
  mat.positionNode = lp.add(vec3(sin(time.mul(1.3).add(ph)), 0.0, sin(time.mul(1.1).add(ph.mul(1.7)))).mul(sway));
  mat.colorNode = Fn(() => {
    const leaf = mix(color(P.leafDark), color(P.leaf), smoothstep(0.25, 0.75, vShade)).toVar();
    leaf.assign(mix(leaf, color(P.leafLight), smoothstep(0.75, 1.1, vShade)));
    const trunk = color(P.trunk).mul(vShade.mul(0.5).add(0.6));
    return mix(trunk, leaf, vPart);
  })();
  return mat;
}

function rockMaterial(style: StylePreset, noise: THREE.Texture): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = `${style.name}-rocks`;
  mat.flatShading = true;
  mat.metalness = 0;
  mat.roughness = 0.92;
  const p: N = positionGeometry;
  const n: N = texture(noise, vec2(p.x.add(p.z), p.y).mul(0.6));
  const n2: N = texture(noise, vec2(p.x.sub(p.z), p.y.add(p.x)).mul(1.7));
  const moss = smoothstep(0.35, 0.9, p.y).mul(0.55);
  const lichen = smoothstep(0.66, 0.8, n2.g).mul(smoothstep(0.2, 0.8, p.y)).mul(0.6);
  const base = mix(color(style.rock).mul(n.g.mul(0.35).add(0.8)), color(style.stone.mossColor), moss.mul(smoothstep(0.45, 0.7, n.r)));
  mat.colorNode = mix(base, color(style.ground.lichen), lichen);
  return mat;
}

function logMaterial(style: StylePreset, noise: THREE.Texture): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = `${style.name}-logs`;
  mat.metalness = 0;
  mat.roughness = 0.95;
  const p: N = positionGeometry;
  const part: N = varying(attribute("aPart", "float"), "vLogPart");
  // Bark: grooves along the log; ends: pale wood with rings.
  const groove: N = texture(noise, vec2(p.x.mul(0.15), atan(p.y, p.z).mul(1.2))).g;
  const bark: N = mix(color(style.trees.trunk).mul(0.7), color(style.woodDark), groove);
  const ring: N = sin(p.y.mul(p.y).add(p.z.mul(p.z)).sqrt().mul(60.0)).mul(0.5).add(0.5);
  const end: N = mix(color(0x8a7a62), color(0x6b5c47), ring.mul(0.6));
  mat.colorNode = mix(bark, end, part);
  return mat;
}

interface StyleScatter {
  meshes: THREE.InstancedMesh[];
  fullCounts: number[];
  materials: THREE.Material[];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _e = new THREE.Euler();

type Placer = (s: Spot, m: THREE.Matrix4, c: THREE.Color) => void;

export class Scatter {
  readonly root = new THREE.Group();
  private trees: Spot[];
  private bushes: Spot[];
  private reeds: Spot[];
  private rocks: Spot[];
  private logs: Spot[];
  private styles = new Map<StyleName, StyleScatter>();
  private current: StyleScatter | null = null;
  private half = false;
  private noise: THREE.Texture;
  private time: N;
  private sunDir: N;

  constructor(noise: THREE.Texture, time: N, sunDir: N) {
    this.noise = noise;
    this.time = time;
    this.sunDir = sunDir;
    this.trees = placeTrees(3400);
    this.bushes = placeBushes(1900);
    this.reeds = placeReeds();
    this.rocks = placeRocks(1700);
    this.logs = placeLogs(28);
    this.root.name = "scatter";
  }

  /** One instanced mesh per (geometry, near or far), casting shadows when near; far ones may use a simpler geometry. */
  private instance(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, spots: Spot[], place: Placer, out: StyleScatter, farGeo = geo) {
    for (const near of [true, false]) {
      const list = spots.filter((s) => s.near === near);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(near ? geo : farGeo, mat, list.length);
      mesh.name = `${name}-${near ? "near" : "far"}`;
      list.forEach((s, i) => {
        _c.setRGB(1, 1, 1);
        place(s, _m, _c);
        mesh.setMatrixAt(i, _m);
        mesh.setColorAt(i, _c);
      });
      mesh.castShadow = near;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      out.meshes.push(mesh);
      out.fullCounts.push(list.length);
    }
  }

  private build(style: StylePreset): StyleScatter {
    const out: StyleScatter = { meshes: [], fullCounts: [], materials: [] };
    const T = style.trees;
    const conMat = plantMaterial(`${style.name}-conifers`, "Conifer", T, this.time, 0.08, 1.5, 7.0);
    const leafMat = plantMaterial(`${style.name}-broadleaf`, "Broadleaf", style.broadleaf, this.time, 0.1, 2.5, 7.5);
    const bushMat = plantMaterial(`${style.name}-bushes`, "Bush", style.bushes, this.time, 0.05, 0.2, 1.4);
    const reedMat = plantMaterial(`${style.name}-reeds`, "Reed", style.reeds, this.time, 0.12, 0.2, 1.8, true);
    const rmat = rockMaterial(style, this.noise);
    const lmat = logMaterial(style, this.noise);
    out.materials.push(conMat, leafMat, bushMat, reedMat, rmat, lmat);

    const tree: Placer = (s, m, c) => {
      _p.set(s.x, s.y, s.z);
      _q.setFromEuler(_e.set(0, s.yaw, 0));
      const ss = s.s * 1.1;
      _s.set(ss, ss * (0.9 + s.tint * 0.25), ss);
      m.compose(_p, _q, _s);
      c.offsetHSL((s.tint - 0.5) * 0.06, (s.variant - 0.5) * 0.1, 0);
      c.multiplyScalar(0.82 + s.tint * 0.3);
    };
    // Trees: conifers (variant < 0.6), broadleaf (0.6 to 0.95), dead (0.95 and up).
    const con = this.trees.filter((s) => s.variant < 0.6);
    const leaf = this.trees.filter((s) => s.variant >= 0.6 && s.variant < 0.95);
    const dead = this.trees.filter((s) => s.variant >= 0.95);
    const conA = con.filter((_, i) => i % 2 === 0), conB = con.filter((_, i) => i % 2 === 1);
    this.instance(`trees-${style.name}-conifer-a`, conifer(31, 4, 9), conMat, conA, tree, out, conifer(31, 3, 6));
    this.instance(`trees-${style.name}-conifer-b`, conifer(47, 5, 8), conMat, conB, tree, out, conifer(47, 3, 6));
    const leafA = leaf.filter((_, i) => i % 2 === 0), leafB = leaf.filter((_, i) => i % 2 === 1);
    this.instance(`trees-${style.name}-broadleaf-a`, broadleaf(12, 4, 1), leafMat, leafA, tree, out, broadleaf(12, 2, 0));
    this.instance(`trees-${style.name}-broadleaf-b`, broadleaf(29, 3, 1), leafMat, leafB, tree, out, broadleaf(29, 2, 0));
    this.instance(`trees-${style.name}-dead`, deadTree(5), conMat, dead, tree, out);

    const bush: Placer = (s, m, c) => {
      _p.set(s.x, s.y, s.z);
      _q.setFromEuler(_e.set(0, s.yaw, 0));
      _s.set(s.s * (0.85 + s.tint * 0.3), s.s * (0.8 + s.variant * 0.4), s.s);
      m.compose(_p, _q, _s);
      c.offsetHSL((s.tint - 0.5) * 0.05, (s.variant - 0.5) * 0.12, 0);
      c.multiplyScalar(0.78 + s.tint * 0.35);
    };
    const shrubs = this.bushes.filter((s) => s.variant < 0.62), gorses = this.bushes.filter((s) => s.variant >= 0.62);
    this.instance(`bushes-${style.name}-shrub`, shrub(51, 0), bushMat, shrubs, bush, out);
    this.instance(`bushes-${style.name}-gorse`, gorse(52, 0), bushMat, gorses, bush, out);

    const reed: Placer = (s, m, c) => {
      _p.set(s.x, s.y, s.z);
      _q.setFromEuler(_e.set(0, s.yaw, 0));
      _s.set(s.s, s.s * (0.85 + s.variant * 0.35), s.s);
      m.compose(_p, _q, _s);
      c.offsetHSL((s.tint - 0.5) * 0.05, 0, 0);
      c.multiplyScalar(0.8 + s.tint * 0.3);
    };
    this.instance(`reeds-${style.name}`, reeds(61), reedMat, this.reeds, reed, out);

    const rock: Placer = (s, m, c) => {
      _p.set(s.x, s.y, s.z);
      _q.setFromEuler(_e.set(s.tilt ?? 0, s.yaw, (s.tint - 0.5) * 0.5));
      _s.set(s.s * (0.8 + s.variant * 0.5), s.s * (0.6 + s.tint * 0.5), s.s);
      m.compose(_p, _q, _s);
      c.multiplyScalar(0.8 + s.tint * 0.35);
    };
    const rocksA = this.rocks.filter((s) => s.variant < 0.5), rocksB = this.rocks.filter((s) => s.variant >= 0.5);
    this.instance(`rocks-${style.name}-a`, rockGeometry(1, 5, true), rmat, rocksA, rock, out);
    this.instance(`rocks-${style.name}-b`, rockGeometry(0, 9, true), rmat, rocksB, rock, out);

    const log: Placer = (s, m, c) => {
      _p.set(s.x, s.y + 0.1 * s.s, s.z);
      _q.setFromEuler(_e.set(0, s.yaw, (s.variant - 0.5) * 0.12));
      _s.set(s.s * (0.8 + s.tint * 0.5), s.s * 0.9, s.s * 0.9);
      m.compose(_p, _q, _s);
      c.multiplyScalar(0.85 + s.tint * 0.25);
    };
    this.instance(`logs-${style.name}`, logGeometry(), lmat, this.logs, log, out);
    return out;
  }

  setStyle(style: StylePreset) {
    let s = this.styles.get(style.name);
    if (!s) {
      s = this.build(style);
      this.styles.set(style.name, s);
    }
    if (this.current) for (const m of this.current.meshes) this.root.remove(m);
    this.current = s;
    for (const m of s.meshes) this.root.add(m);
    this.applyDensity();
  }

  /** Half density (low tier): instances are in random order, so the first half is an even subset. */
  setHalfDensity(half: boolean) {
    this.half = half;
    this.applyDensity();
  }

  private applyDensity() {
    if (!this.current) return;
    const s = this.current;
    s.meshes.forEach((m, i) => {
      m.count = this.half ? Math.ceil(s.fullCounts[i] / 2) : s.fullCounts[i];
      // On Low only the trees cast shadows; bushes, reeds, stones and logs do not.
      if (m.name.endsWith("-near") && !m.name.startsWith("trees-")) m.castShadow = !this.half;
    });
  }

  dispose() {
    for (const s of this.styles.values()) {
      for (const m of s.meshes) m.geometry.dispose();
      for (const m of s.materials) m.dispose();
    }
  }
}

