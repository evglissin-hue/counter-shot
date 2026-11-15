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
// Trees (look round L3.5) are the shapes in treeShapes: inside the battlefield
// box full models, beyond it flat cards painted from the same models
// (treeCards), the model fading into its card by a dither over TREE_FADE
// metres. Every plant leans in the match's wind (plantWind, WindField.bend)
// and takes the clouds' shade.

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
} from "three/tsl";
import { BRIDGES, MID_Z, STREAM, streamOffset, streamSlope, streamWidth, valleyHeight } from "@keepfall/content";
import { Rng } from "@keepfall/core";
import { mergeByPosition, mergeGeometries, rockGeometry } from "./geometry";
import type { StyleName, StylePreset } from "./styles";
import type { N } from "./tslUtils";
import { applyCloudShadow } from "./clouds";
import { plantLean } from "./plantWind";
import { cardGeometry, cardMaterial, cardTexture, modelVisible, type CardSpot } from "./treeCards";
import { rasterCard } from "./treeRaster";
import { TREE_KINDS, TREE_FADE, drawsAsCard, drawsAsModel, soupNormals, treeEdgeDistance, type Soup, type TreeKind } from "./treeShapes";
import type { WindField } from "./windField";
import { bridgeDistance, castleDistance, inFiringLane, routeEdge, streamEdge } from "./valleyNodes";
import { sharedCapacity } from "./instancing";

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
  // Full detail and shadows (the sun's shadow map covers the battlefield only); the outer slopes are seen from afar.
  return Math.abs(x) < 112 && z > MID_Z - 172 && z < MID_Z + 172;
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
  for (let x = -170; x <= 170; x += 0.55) {
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

/** A lumpy blob: an icosphere with seeded radial jitter (closed and smooth). */
function blob(seed: number, detail: number, rx: number, ry: number, rz: number, rough = 0.28): THREE.BufferGeometry {
  // A low sphere (detail 0: 6 by 4 segments, about 40 triangles; 1: 9 by 6, about 100), closed at its seam,
  // its underside flattened, each vertex pushed in or out a little.
  const s = detail < 0 ? new THREE.SphereGeometry(1, 5, 3) : detail === 0 ? new THREE.SphereGeometry(1, 6, 4) : new THREE.SphereGeometry(1, 9, 6);
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

/** A tree soup (treeShapes) as an indexed geometry with the plant attributes. */
function soupGeometry(soup: Soup): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(soup.pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(soupNormals(soup), 3));
  g.setAttribute("aPart", new THREE.Float32BufferAttribute(soup.part, 1));
  g.setAttribute("aShade", new THREE.Float32BufferAttribute(soup.shade, 1));
  g.setIndex(soup.idx);
  g.computeBoundingSphere();
  return g;
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
  for (let i = 0; i < 6; i++) {
    const h = 0.8 + rng.next() * 0.7;
    const shoot = new THREE.ConeGeometry(0.13, h, 4, 1, true);
    shoot.translate(0, h / 2, 0);
    shoot.rotateZ((rng.next() - 0.5) * 0.9);
    shoot.rotateX((rng.next() - 0.5) * 0.9);
    shoot.translate((rng.next() - 0.5) * 0.6, 0.05, (rng.next() - 0.5) * 0.6);
    parts.push(withPart(shoot, 1, (_x, yy) => 0.35 + Math.min(1, Math.max(0, yy / h)) * 0.75));
  }
  return mergeGeometries(parts);
}

/** A reed clump: thin curved blades and a few seed heads, leaning out. */
function reeds(seed: number, blades = 12): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const pos: number[] = [];
  const nrm: number[] = [];
  const shade: number[] = [];
  const idx: number[] = [];
  for (let b = 0; b < blades; b++) {
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

interface PlantWind {
  /** The plant's height (model units) that counts as 1 up the stem. */
  height: number;
  /** Lean of the top per unit of the wind's bend (m). */
  amp: number;
  /** Trees fade into their cards beyond the battlefield (a dither on the model). */
  fade?: boolean;
}

function plantMaterial(name: string, id: string, P: Palette, time: N, wind: WindField, W: PlantWind, doubleSided = false): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = name;
  mat.metalness = 0;
  mat.roughness = 0.95;
  if (doubleSided) mat.side = THREE.DoubleSide;
  const part: N = attribute("aPart", "float");
  const shade: N = attribute("aShade", "float");
  const vPart: N = varying(part, `v${id}Part`);
  const vShade: N = varying(shade, `v${id}Shade`);
  // Lean in the match's wind, the same as the flags'; the stem leans more the higher the point.
  const lp: N = positionLocal;
  const h: N = positionGeometry.y.div(W.height);
  mat.positionNode = lp.add(plantLean(wind, time, vec2(lp.x, lp.z), h, W.amp, part));
  mat.colorNode = Fn(() => {
    const leaf = mix(color(P.leafDark), color(P.leaf), smoothstep(0.25, 0.75, vShade)).toVar();
    leaf.assign(mix(leaf, color(P.leafLight), smoothstep(0.75, 1.1, vShade)));
    const trunk = color(P.trunk).mul(vShade.mul(0.5).add(0.6));
    return mix(trunk, leaf, vPart);
  })();
  if (W.fade) {
    mat.alphaTest = 0.5;
    mat.opacityNode = Fn(() => modelVisible())();
  }
  applyCloudShadow(mat);
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
  // Weathered grey stone, lighter on the faces the rain washes, so boulders in shadow stay grey, not black.
  const stone: N = mix(color(style.rock), color(style.ground.rockLight), n.g.mul(0.45).add(0.25)).mul(n.r.mul(0.25).add(0.85));
  const base = mix(stone, color(style.stone.mossColor), moss.mul(smoothstep(0.45, 0.7, n.r)));
  mat.colorNode = mix(base, color(style.ground.lichen), lichen);
  // Light bounced from the ground: a backlit boulder reads as dark stone, not a hole.
  mat.emissiveNode = base.mul(0.07);
  applyCloudShadow(mat);
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
  applyCloudShadow(mat);
  return mat;
}

interface StyleScatter {
  meshes: THREE.InstancedMesh[];
  fullCounts: number[];
  materials: THREE.Material[];
  /** The far trees' cards: one mesh per kind, drawn from an instanced geometry. */
  cards: THREE.Mesh[];
  cardCounts: number[];
  textures: THREE.Texture[];
}

/** Trees whose foot is less than this far outside the box draw without the fade (the card's share there is under 0.5%). */
const NEAR_FADE = TREE_FADE / 24;
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
  private wind: WindField;

  constructor(noise: THREE.Texture, time: N, sunDir: N, wind: WindField) {
    this.noise = noise;
    this.time = time;
    this.sunDir = sunDir;
    this.wind = wind;
    this.trees = placeTrees(3400);
    this.bushes = placeBushes(1600);
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
      // Room past one uniform block, so the meshes on one material share its programs (see instancing.ts).
      const mesh = new THREE.InstancedMesh(near ? geo : farGeo, mat, sharedCapacity(list.length));
      mesh.count = list.length;
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
    const out: StyleScatter = { meshes: [], fullCounts: [], materials: [], cards: [], cardCounts: [], textures: [] };
    const T = style.trees;
    const conMat = plantMaterial(`${style.name}-conifers`, "Conifer", T, this.time, this.wind, { height: 9.6, amp: 0.6, fade: true }, true);
    const leafMat = plantMaterial(`${style.name}-broadleaf`, "Broadleaf", style.broadleaf, this.time, this.wind, { height: 8.5, amp: 0.7, fade: true });
    const deadMat = plantMaterial(`${style.name}-dead`, "Dead", T, this.time, this.wind, { height: 6.4, amp: 0.3, fade: true });
    // The same trees inside the battlefield, where none fades: no alpha test, so the depth test can skip hidden leaves early.
    const conSolid = plantMaterial(`${style.name}-conifers-near`, "Conifer", T, this.time, this.wind, { height: 9.6, amp: 0.6 }, true);
    const leafSolid = plantMaterial(`${style.name}-broadleaf-near`, "Broadleaf", style.broadleaf, this.time, this.wind, { height: 8.5, amp: 0.7 });
    const deadSolid = plantMaterial(`${style.name}-dead-near`, "Dead", T, this.time, this.wind, { height: 6.4, amp: 0.3 });
    const bushMat = plantMaterial(`${style.name}-bushes`, "Bush", style.bushes, this.time, this.wind, { height: 1.4, amp: 0.25 });
    const reedMat = plantMaterial(`${style.name}-reeds`, "Reed", style.reeds, this.time, this.wind, { height: 1.8, amp: 0.7 }, true);
    const rmat = rockMaterial(style, this.noise);
    const lmat = logMaterial(style, this.noise);
    out.materials.push(conMat, leafMat, deadMat, conSolid, leafSolid, deadSolid, bushMat, reedMat, rmat, lmat);

    const tree: Placer = (s, m, c) => {
      _p.set(s.x, s.y, s.z);
      _q.setFromEuler(_e.set(0, s.yaw, 0));
      const ss = s.s * 1.1;
      _s.set(ss, ss * (0.9 + s.tint * 0.25), ss);
      m.compose(_p, _q, _s);
      c.offsetHSL((s.tint - 0.5) * 0.06, (s.variant - 0.5) * 0.1, 0);
      c.multiplyScalar(0.82 + s.tint * 0.3);
    };
    // Trees: conifers (variant < 0.6), broadleaf (0.6 to 0.95), dead (0.95 and up); two variants of the first two kinds by turns.
    const con = this.trees.filter((s) => s.variant < 0.6);
    const leaf = this.trees.filter((s) => s.variant >= 0.6 && s.variant < 0.95);
    const dead = this.trees.filter((s) => s.variant >= 0.95);
    const lists: Record<string, Spot[]> = {
      "spruce-a": con.filter((_, i) => i % 2 === 0),
      "spruce-b": con.filter((_, i) => i % 2 === 1),
      "oak-a": leaf.filter((_, i) => i % 2 === 0),
      "oak-b": leaf.filter((_, i) => i % 2 === 1),
      dead,
    };
    const mats: Record<TreeKind["species"], THREE.Material> = { conifer: conMat, broadleaf: leafMat, dead: deadMat };
    const solids: Record<TreeKind["species"], THREE.Material> = { conifer: conSolid, broadleaf: leafSolid, dead: deadSolid };
    const pals: Record<TreeKind["species"], Palette> = { conifer: T, broadleaf: style.broadleaf, dead: T };
    const amps: Record<TreeKind["species"], number> = { conifer: 0.6, broadleaf: 0.7, dead: 0.3 };
    for (const kind of TREE_KINDS) this.treeKind(style, kind, lists[kind.id], mats[kind.species], solids[kind.species], pals[kind.species], amps[kind.species], tree, out);

    const bush: Placer = (s, m, c) => {
      _p.set(s.x, s.y, s.z);
      _q.setFromEuler(_e.set(0, s.yaw, 0));
      _s.set(s.s * (0.85 + s.tint * 0.3), s.s * (0.8 + s.variant * 0.4), s.s);
      m.compose(_p, _q, _s);
      c.offsetHSL((s.tint - 0.5) * 0.05, (s.variant - 0.5) * 0.12, 0);
      c.multiplyScalar(0.78 + s.tint * 0.35);
    };
    const shrubs = this.bushes.filter((s) => s.variant < 0.62), gorses = this.bushes.filter((s) => s.variant >= 0.62);
    this.instance(`bushes-${style.name}-shrub`, shrub(51, 0), bushMat, shrubs, bush, out, shrub(51, -1));
    this.instance(`bushes-${style.name}-gorse`, gorse(52, -1), bushMat, gorses, bush, out);

    const reed: Placer = (s, m, c) => {
      _p.set(s.x, s.y, s.z);
      _q.setFromEuler(_e.set(0, s.yaw, 0));
      _s.set(s.s, s.s * (0.85 + s.variant * 0.35), s.s);
      m.compose(_p, _q, _s);
      c.offsetHSL((s.tint - 0.5) * 0.05, 0, 0);
      c.multiplyScalar(0.8 + s.tint * 0.3);
    };
    this.instance(`reeds-${style.name}`, reeds(61), reedMat, this.reeds, reed, out, reeds(61, 6));

    const rock: Placer = (s, m, c) => {
      _p.set(s.x, s.y, s.z);
      _q.setFromEuler(_e.set(s.tilt ?? 0, s.yaw, (s.tint - 0.5) * 0.5));
      _s.set(s.s * (0.8 + s.variant * 0.5), s.s * (0.6 + s.tint * 0.5), s.s);
      m.compose(_p, _q, _s);
      c.multiplyScalar(0.8 + s.tint * 0.35);
    };
    // Boulders get a finely faceted rock of their own; stones in the grass are rounder or blockier.
    const boulders = this.rocks.filter((s) => s.s > 1.2);
    const rocksA = this.rocks.filter((s) => s.s <= 1.2 && s.variant < 0.5), rocksB = this.rocks.filter((s) => s.s <= 1.2 && s.variant >= 0.5);
    this.instance(`rocks-${style.name}-boulders`, rockGeometry(2, 13, true), rmat, boulders, rock, out, rockGeometry(1, 13, true));
    this.instance(`rocks-${style.name}-a`, rockGeometry(1, 5, true), rmat, rocksA, rock, out, rockGeometry(0, 5, true));
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

  /**
   * One tree kind: a model mesh for the trees inside the fade (it casts shadows,
   * and the shadow map reaches only the battlefield), and a card mesh for the
   * trees beyond the battlefield's edge, painted from the same shape.
   */
  private treeKind(style: StylePreset, kind: TreeKind, spots: Spot[], mat: THREE.Material, solid: THREE.Material, pal: Palette, amp: number, place: Placer, out: StyleScatter) {
    const soup = kind.build();
    const modelGeo = soupGeometry(soup);
    // Trees well inside the box never fade (a crown reaching NEAR_FADE out is still all model), so they draw without the dither's alpha test.
    const inside = spots.filter((s) => treeEdgeDistance(s.x, s.z) < NEAR_FADE);
    const fading = spots.filter((s) => treeEdgeDistance(s.x, s.z) >= NEAR_FADE && drawsAsModel(treeEdgeDistance(s.x, s.z)));
    for (const [models, m, tag] of [[inside, solid, ""], [fading, mat, "-fade"]] as const) {
      if (!models.length) continue;
      const mesh = new THREE.InstancedMesh(modelGeo, m, models.length);
      mesh.name = `trees-${style.name}-${kind.id}${tag}`;
      models.forEach((s, i) => {
        _c.setRGB(1, 1, 1);
        place(s, _m, _c);
        mesh.setMatrixAt(i, _m);
        mesh.setColorAt(i, _c);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      out.meshes.push(mesh);
      out.fullCounts.push(models.length);
    }
    const far = spots.filter((s) => drawsAsCard(treeEdgeDistance(s.x, s.z)));
    if (!far.length) return;
    const img = rasterCard(soup, pal, 160);
    const tex = cardTexture(img);
    const cards: CardSpot[] = far.map((s) => {
      _c.setRGB(1, 1, 1);
      place(s, _m, _c);
      const ss = s.s * 1.1;
      return { x: s.x, y: s.y, z: s.z, sx: s.yaw > Math.PI ? -ss : ss, sy: ss * (0.9 + s.tint * 0.25), r: _c.r, g: _c.g, b: _c.b };
    });
    const geo = cardGeometry(img, cards);
    const cmat = cardMaterial(`${style.name}-card-${kind.id}`, tex, this.wind, this.time, amp);
    const mesh = new THREE.Mesh(geo, cmat);
    mesh.name = `cards-${style.name}-${kind.id}`;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    out.cards.push(mesh);
    out.cardCounts.push(cards.length);
    out.materials.push(cmat);
    out.textures.push(tex);
  }

  setStyle(style: StylePreset) {
    let s = this.styles.get(style.name);
    if (!s) {
      s = this.build(style);
      this.styles.set(style.name, s);
    }
    if (this.current) for (const m of [...this.current.meshes, ...this.current.cards]) this.root.remove(m);
    this.current = s;
    for (const m of [...s.meshes, ...s.cards]) this.root.add(m);
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
    s.cards.forEach((c, i) => {
      (c.geometry as THREE.InstancedBufferGeometry).instanceCount = this.half ? Math.ceil(s.cardCounts[i] / 2) : s.cardCounts[i];
    });
  }

  dispose() {
    for (const s of this.styles.values()) {
      for (const m of [...s.meshes, ...s.cards]) m.geometry.dispose();
      for (const m of s.materials) m.dispose();
      for (const t of s.textures) t.dispose();
    }
  }
}

