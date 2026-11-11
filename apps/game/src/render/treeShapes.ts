// Tree shapes (look round L3.5), as plain triangle soups with no three.js in
// them, so the geometry, the silhouettes and the near and far split can be
// tested in Node and drawn into card textures at load.
//
// Three kinds, each meant to be known as a black shape against the sky:
// - the spruce: whorls of drooping, ragged branch fingers tier on tier, a
//   narrow bare spire at the top, the trunk showing low down;
// - the oak: a stout trunk that forks into limbs, which fork again, and a
//   crown of separate clumps at the limb tips with gaps between them;
// - the dead tree: a bent trunk and bare forked limbs with twigs.
// Every builder takes a seed, so each variant is the same on every device.
// Parts: 0 wood, 1 foliage. Shade (0..1.1) is the baked darkening towards the
// inside and underside of a crown, read by the plant material.

import { MID_Z } from "@keepfall/content";
import { Rng } from "@keepfall/core";

export type V3 = [number, number, number];

export interface Soup {
  pos: number[];
  idx: number[];
  part: number[];
  shade: number[];
}

export function newSoup(): Soup {
  return { pos: [], idx: [], part: [], shade: [] };
}

export function triangleCount(s: Soup): number {
  return s.idx.length / 3;
}

// --- the near and far split ------------------------------------------------------

/** The box round the battlefield inside which trees are full models (half width in x, half length in z from the field's middle). */
export const TREE_NEAR_X = 112;
export const TREE_NEAR_Z = 172;
/** Beyond the box a model fades into its card over this many metres (a dithered crossfade, so nothing pops in the orbit). */
export const TREE_FADE = 24;

/** How far (m) a point lies outside the battlefield box: 0 inside it. */
export function treeEdgeDistance(x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x) - TREE_NEAR_X);
  const dz = Math.max(0, Math.abs(z - MID_Z) - TREE_NEAR_Z);
  return Math.hypot(dx, dz);
}

/** 0 (all model) to 1 (all card) at a distance outside the box. */
export function treeCardShare(d: number): number {
  const t = Math.min(1, Math.max(0, d / TREE_FADE));
  return t * t * (3 - 2 * t);
}

/** A tree is drawn as a model when it is not wholly a card yet. */
export function drawsAsModel(d: number): boolean {
  return d < TREE_FADE;
}

/** A tree is drawn as a card once any of it is one. */
export function drawsAsCard(d: number): boolean {
  return d > 0;
}

// --- builders --------------------------------------------------------------------

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function add(a: V3, b: V3, k = 1): V3 {
  return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
}

function vert(s: Soup, p: V3, part: number, shade: number): number {
  s.pos.push(p[0], p[1], p[2]);
  s.part.push(part);
  s.shade.push(shade);
  return s.pos.length / 3 - 1;
}

/** A tapered open tube from a to b (2 * sides triangles). */
export function addTube(s: Soup, a: V3, b: V3, ra: number, rb: number, sides: number, part: number, shadeA: number, shadeB: number, twist = 0) {
  const axis = norm(sub(b, a));
  const ref: V3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(axis, ref));
  const v = cross(axis, u);
  const base = s.pos.length / 3;
  for (let ring = 0; ring < 2; ring++) {
    const c = ring === 0 ? a : b;
    const r = ring === 0 ? ra : rb;
    for (let k = 0; k < sides; k++) {
      const ang = (k / sides) * Math.PI * 2 + twist;
      const p = add(add(c, u, Math.cos(ang) * r), v, Math.sin(ang) * r);
      vert(s, p, part, ring === 0 ? shadeA : shadeB);
    }
  }
  for (let k = 0; k < sides; k++) {
    const k2 = (k + 1) % sides;
    s.idx.push(base + k, base + k2, base + sides + k, base + k2, base + sides + k2, base + sides + k);
  }
}

/**
 * A drooping branch finger from the trunk: a folded kite (4 triangles) that
 * rises a little along its spine and hangs at its tip, so a whorl of them
 * makes a ragged, drooping tier.
 */
function addFinger(s: Soup, root: V3, yaw: number, len: number, width: number, droop: number, rise: number, shadeRoot: number, shadeTip: number) {
  const dx = Math.cos(yaw), dz = Math.sin(yaw);
  const sx = -dz, sz = dx;
  const at = (t: number, side: number, dy: number): V3 => [root[0] + dx * len * t + sx * side, root[1] + dy, root[2] + dz * len * t + sz * side];
  const r = vert(s, at(0.04, 0, 0), 1, shadeRoot);
  const l = vert(s, at(0.5, -width, -droop * 0.2), 1, (shadeRoot + shadeTip) / 2 - 0.08);
  const m = vert(s, at(0.5, 0, rise), 1, (shadeRoot + shadeTip) / 2);
  const q = vert(s, at(0.5, width, -droop * 0.2), 1, (shadeRoot + shadeTip) / 2 - 0.08);
  const t = vert(s, at(1, 0, -droop), 1, shadeTip);
  s.idx.push(r, l, m, r, m, q, l, t, m, m, t, q);
}

/** A jagged low clump: a squashed sphere with radial jitter and a flatter underside. */
function addClump(s: Soup, c: V3, rx: number, ry: number, rz: number, rng: Rng, radial: number, rings: number, shadeAt: (y: number) => number) {
  const base = s.pos.length / 3;
  const jit = () => 0.62 + rng.next() * 0.76;
  const top = vert(s, [c[0], c[1] + ry * jit(), c[2]], 1, shadeAt(c[1] + ry));
  const rot = rng.next() * Math.PI * 2;
  for (let i = 1; i < rings; i++) {
    const pol = (i / rings) * Math.PI;
    const yy = Math.cos(pol);
    const ring = Math.sin(pol);
    for (let k = 0; k < radial; k++) {
      const a = rot + (k / radial) * Math.PI * 2;
      const j = jit();
      const y = (yy < 0 ? yy * 0.45 : yy) * ry * j;
      vert(s, [c[0] + Math.cos(a) * ring * rx * j, c[1] + y, c[2] + Math.sin(a) * ring * rz * j], 1, shadeAt(c[1] + y));
    }
  }
  const bottom = vert(s, [c[0], c[1] - ry * 0.45 * jit(), c[2]], 1, shadeAt(c[1] - ry * 0.45));
  for (let k = 0; k < radial; k++) {
    const k2 = (k + 1) % radial;
    s.idx.push(top, base + 1 + k2, base + 1 + k);
  }
  for (let i = 0; i < rings - 2; i++) {
    const a0 = base + 1 + i * radial, a1 = a0 + radial;
    for (let k = 0; k < radial; k++) {
      const k2 = (k + 1) % radial;
      s.idx.push(a0 + k, a0 + k2, a1 + k, a0 + k2, a1 + k2, a1 + k);
    }
  }
  const last = base + 1 + (rings - 2) * radial;
  for (let k = 0; k < radial; k++) {
    const k2 = (k + 1) % radial;
    s.idx.push(bottom, last + k, last + k2);
  }
}

export interface ConiferSpec {
  seed: number;
  /** Branch tiers. */
  whorls: number;
  /** Fingers in the lowest tier (the top tier has about half). */
  fingers: number;
  height: number;
  radius: number;
}

/** The spruce: a slim trunk, tiers of drooping fingers narrowing to a bare spire. */
export function spruce(spec: ConiferSpec): Soup {
  const rng = new Rng(spec.seed);
  const s = newSoup();
  const H = spec.height;
  const y0 = 2.2; // the lowest tier: the trunk shows below it
  const yTop = H - 1.5; // the highest tier: the spire stands above it
  addTube(s, [0, 0, 0], [0.03, yTop, 0], 0.27, 0.07, 6, 0, 0.6, 0.6);
  addTube(s, [0.03, yTop - 0.2, 0], [0, H, 0], 0.08, 0.012, 4, 0, 0.7, 0.9);
  let yaw = rng.next() * Math.PI * 2;
  for (let i = 0; i < spec.whorls; i++) {
    const t = i / Math.max(1, spec.whorls - 1);
    const y = y0 + (yTop - y0) * Math.pow(t, 0.92);
    const r = spec.radius * Math.pow(1 - t, 0.82) * (0.9 + rng.next() * 0.2) + 0.32;
    const n = Math.max(3, Math.round(spec.fingers * (1 - 0.48 * t)));
    yaw += 2.4 + rng.next();
    for (let k = 0; k < n; k++) {
      // Some fingers are missing or short: gaps and ragged outline.
      const roll = rng.next();
      if (roll > 0.95 && t < 0.7) continue;
      const a = yaw + (k / n) * Math.PI * 2 + (rng.next() - 0.5) * 0.5;
      const lenK = r * (roll < 0.14 ? 0.55 : 0.82 + rng.next() * 0.3);
      const width = Math.max(0.22, lenK * 0.34 + rng.next() * 0.12);
      const droop = (0.2 + rng.next() * 0.18) * lenK * (1 - 0.55 * t) + 0.12;
      const rise = 0.1 + lenK * 0.06;
      addFinger(s, [0, y - rng.next() * 0.25, 0], a, lenK, width, droop, rise, 0.35 + t * 0.35, 0.75 + t * 0.2 + rng.next() * 0.12);
    }
  }
  return s;
}

export interface OakSpec {
  seed: number;
  /** Primary limbs off the fork (3 or 4). */
  limbs: number;
  /** Crown scale. */
  size: number;
}

/** The oak (or ash): a stout trunk, a fork of limbs, each forking again, a clump at every tip with gaps between. */
export function oak(spec: OakSpec): Soup {
  const rng = new Rng(spec.seed);
  const s = newSoup();
  const wood = 0.6;
  const forkY = 2.1 + rng.next() * 0.5;
  const lean = (rng.next() - 0.5) * 0.4;
  addTube(s, [0, 0, 0], [lean, forkY, 0], 0.4, 0.27, 7, 0, wood, wood);
  const shade = (y: number) => 0.3 + Math.min(1, Math.max(0, (y - 2.6) / 5.6)) * 0.7;
  const tips: V3[] = [];
  const lows: V3[] = [];
  const a0 = rng.next() * Math.PI * 2;
  const fork: V3 = [lean, forkY, 0];
  for (let i = 0; i < spec.limbs; i++) {
    const az = a0 + (i / spec.limbs) * Math.PI * 2 + (rng.next() - 0.5) * 0.7;
    const el = 0.5 + rng.next() * 0.35; // from the vertical
    const len = (1.9 + rng.next() * 0.7) * spec.size;
    const d: V3 = [Math.sin(el) * Math.cos(az), Math.cos(el), Math.sin(el) * Math.sin(az)];
    const p = add(fork, d, len);
    addTube(s, fork, p, 0.22, 0.12, 5, 0, wood, wood);
    // Each limb forks in two.
    for (const sgn of [-1, 1]) {
      const az2 = az + sgn * (0.55 + rng.next() * 0.5);
      const el2 = 0.25 + rng.next() * 0.95;
      const len2 = (1.3 + rng.next() * 0.7) * spec.size;
      const d2: V3 = [Math.sin(el2) * Math.cos(az2), Math.cos(el2), Math.sin(el2) * Math.sin(az2)];
      const q = add(p, d2, len2);
      addTube(s, p, q, 0.11, 0.05, 4, 0, wood, wood);
      tips.push(q);
    }
    if (rng.next() < 0.7) lows.push(add(p, [0, -0.15, 0]));
  }
  // A leader from the fork carries the top clump.
  const top = add(fork, [0.1, 1, 0.05], 2.9 * spec.size);
  addTube(s, fork, top, 0.2, 0.07, 5, 0, wood, wood);
  tips.push(top);
  for (let i = 0; i < tips.length; i++) {
    const big = i === tips.length - 1 ? 1.15 : 0.85 + rng.next() * 0.4;
    const r = 1.05 * spec.size * big;
    const c: V3 = [tips[i][0], tips[i][1] + r * 0.35, tips[i][2]];
    addClump(s, c, r * (1.0 + rng.next() * 0.25), r * (0.85 + rng.next() * 0.3), r * (1.0 + rng.next() * 0.25), rng, r > 1.15 ? 7 : 6, r > 1.15 ? 4 : 3, shade);
  }
  for (const l of lows) addClump(s, l, 0.7 * spec.size, 0.6 * spec.size, 0.7 * spec.size, rng, 6, 3, shade);
  return s;
}

export interface DeadSpec {
  seed: number;
  /** Bare limbs off the trunk. */
  limbs: number;
}

/** The dead tree: a bent trunk, bare kinked limbs and twigs, a split top. */
export function deadTree(spec: DeadSpec): Soup {
  const rng = new Rng(spec.seed);
  const s = newSoup();
  const w = 0.6;
  // The trunk bends over three joints.
  const joints: V3[] = [[0, 0, 0]];
  const drift = (rng.next() - 0.5) * 0.5;
  const drift2 = (rng.next() - 0.5) * 0.5;
  for (let i = 1; i <= 3; i++) joints.push([joints[i - 1][0] + drift * 0.5, i * 1.55, joints[i - 1][2] + drift2 * 0.5]);
  const radii = [0.27, 0.19, 0.12, 0.06];
  for (let i = 0; i < 3; i++) addTube(s, joints[i], joints[i + 1], radii[i], radii[i + 1], 5, 0, w, w);
  // The top splits in two.
  const crown = joints[3];
  for (const sg of [-1, 1]) {
    const tip = add(crown, [sg * (0.5 + rng.next() * 0.4), 1.3 + rng.next() * 0.5, (rng.next() - 0.5) * 0.6]);
    addTube(s, crown, tip, 0.06, 0.012, 4, 0, w, w);
  }
  for (let i = 0; i < spec.limbs; i++) {
    const h = 1.5 + (i / spec.limbs) * 3.1 + rng.next() * 0.3;
    const at: V3 = [joints[Math.min(2, Math.floor(h / 1.55))][0] * 0.9 + drift * 0.2, h, joints[Math.min(2, Math.floor(h / 1.55))][2] * 0.9];
    const az = i * 2.4 + rng.next() * 1.0;
    const el = 1.0 + rng.next() * 0.45;
    const len = 1.5 + rng.next() * 1.0;
    const mid = add(at, [Math.sin(el) * Math.cos(az), Math.cos(el) * 0.5, Math.sin(el) * Math.sin(az)], len * 0.55);
    addTube(s, at, mid, 0.09, 0.055, 4, 0, w, w);
    const az2 = az + (rng.next() - 0.5) * 0.9;
    const el2 = el - 0.45 - rng.next() * 0.4;
    const tip = add(mid, [Math.sin(el2) * Math.cos(az2), Math.cos(el2), Math.sin(el2) * Math.sin(az2)], len * 0.6);
    addTube(s, mid, tip, 0.055, 0.012, 4, 0, w, w);
    // A twig forking off the outer part.
    const az3 = az2 + (rng.next() < 0.5 ? -1 : 1) * (0.7 + rng.next() * 0.5);
    const tw = add(mid, [Math.cos(az3) * 0.8, 0.45 + rng.next() * 0.4, Math.sin(az3) * 0.8], len * 0.45);
    addTube(s, mid, tw, 0.04, 0.01, 3, 0, w, w);
  }
  return s;
}

/** Smooth vertex normals for a soup (flat tubes and kites share their vertices, so they come out soft). */
export function soupNormals(s: Soup): Float32Array {
  const n = new Float32Array(s.pos.length);
  for (let i = 0; i < s.idx.length; i += 3) {
    const ia = s.idx[i] * 3, ib = s.idx[i + 1] * 3, ic = s.idx[i + 2] * 3;
    const a: V3 = [s.pos[ia], s.pos[ia + 1], s.pos[ia + 2]];
    const b: V3 = [s.pos[ib], s.pos[ib + 1], s.pos[ib + 2]];
    const c: V3 = [s.pos[ic], s.pos[ic + 1], s.pos[ic + 2]];
    const f = cross(sub(b, a), sub(c, a));
    for (const o of [ia, ib, ic]) {
      n[o] += f[0];
      n[o + 1] += f[1];
      n[o + 2] += f[2];
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

/** The kinds and their variants, in one place: the scatter and the card painter both read this list. */
export interface TreeKind {
  id: string;
  /** conifer, broadleaf or dead: picks the palette and the wind's stiffness. */
  species: "conifer" | "broadleaf" | "dead";
  build: () => Soup;
}

export const TREE_KINDS: TreeKind[] = [
  { id: "spruce-a", species: "conifer", build: () => spruce({ seed: 31, whorls: 11, fingers: 9, height: 9.6, radius: 2.4 }) },
  { id: "spruce-b", species: "conifer", build: () => spruce({ seed: 47, whorls: 11, fingers: 8, height: 8.6, radius: 2.1 }) },
  { id: "oak-a", species: "broadleaf", build: () => oak({ seed: 12, limbs: 3, size: 1 }) },
  { id: "oak-b", species: "broadleaf", build: () => oak({ seed: 29, limbs: 3, size: 0.9 }) },
  { id: "dead", species: "dead", build: () => deadTree({ seed: 5, limbs: 5 }) },
];
