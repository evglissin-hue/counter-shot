// Trees and rocks scattered outside the field (seeded, so every device gets
// the same landscape): dark conifers and a few dead trees. Trunk and foliage
// are merged into one geometry per tree type (an `aPart` attribute tells them
// apart) so a tree type is one instanced draw. Trees near the field cast
// shadows; far ones do not.

import * as THREE from "three/webgpu";
import {
  Fn,
  attribute,
  cameraPosition,
  clamp,
  color,
  dot,
  float,
  max,
  mix,
  normalize,
  positionGeometry,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  texture,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { FIELD } from "@keepfall/content";
import { Rng } from "@keepfall/core";
import { mergeGeometries, rockGeometry } from "./geometry";
import type { StyleName, StylePreset } from "./styles";
import { POND, groundHeight } from "./terrain";
import type { N } from "./tslUtils";

interface TreeSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number;
  tint: number;
  variant: number;
  near: boolean;
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

function fieldDistance(x: number, z: number): number {
  const dx = Math.max(FIELD.x0 - x, 0, x - FIELD.x1);
  const dz = Math.max(FIELD.z0 - z, 0, z - FIELD.z1);
  return Math.hypot(dx, dz);
}

function placeTrees(count: number): TreeSpot[] {
  const rng = new Rng(9001).fork("trees");
  const out: TreeSpot[] = [];
  const cz = (FIELD.z0 + FIELD.z1) / 2;
  let guard = 0;
  while (out.length < count && guard++ < count * 60) {
    const x = (rng.next() * 2 - 1) * 820;
    const z = cz + (rng.next() * 2 - 1) * 820;
    const d = fieldDistance(x, z);
    if (d < 7) continue;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 3) continue;
    const clump = vnoise(x / 95 + 3.1, z / 95 - 1.7) * 0.75 + vnoise(x / 21, z / 21) * 0.25;
    let p = Math.max(0, (clump - 0.5) * 4.5);
    p *= d < 30 ? 0.35 + d / 46 : 1;
    p *= d > 450 ? Math.max(0.15, 1 - (d - 450) / 500) : 1;
    // A few lone trees along the field edge.
    if (d < 40 && rng.next() < 0.012) p = 1;
    if (rng.next() > p) continue;
    const y = groundHeight(x, z);
    out.push({
      x,
      y: y - 0.15,
      z,
      yaw: rng.next() * Math.PI * 2,
      s: 0.75 + rng.next() * 0.6,
      tint: rng.next(),
      variant: rng.next(),
      near: d < 110,
    });
  }
  return out;
}

function placeRocks(count: number): TreeSpot[] {
  const rng = new Rng(9002).fork("rocks");
  const out: TreeSpot[] = [];
  const cz = (FIELD.z0 + FIELD.z1) / 2;
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const x = (rng.next() * 2 - 1) * 520;
    const z = cz + (rng.next() * 2 - 1) * 520;
    const d = fieldDistance(x, z);
    if (d < 4) continue;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r - 1) continue;
    const clump = vnoise(x / 40 - 9.1, z / 40 + 4.2);
    const p = Math.max(0, (clump - 0.5) * 3) * (d < 60 ? 1.2 : 0.7);
    if (rng.next() > p) continue;
    const big = rng.next();
    out.push({
      x,
      y: groundHeight(x, z) - 0.1,
      z,
      yaw: rng.next() * Math.PI * 2,
      s: big < 0.08 ? 1.6 + rng.next() * 1.6 : 0.3 + rng.next() * 0.8,
      tint: rng.next(),
      variant: rng.next(),
      near: d < 120,
    });
  }
  return out;
}

// --- tree geometries -------------------------------------------------------

function withPart(g: THREE.BufferGeometry, part: number, shadeFn?: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const ng = g;
  ng.deleteAttribute("uv");
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

interface TreeType {
  geometry: THREE.BufferGeometry;
  /** Fraction of spots that get this type (spots pick by `variant`). */
  share: number;
}

function treeTypes(far: boolean): TreeType[] {
  return [{ geometry: conifer(31, far ? 3 : 4, far ? 6 : 9), share: 0.86 }, { geometry: deadTree(5), share: 0.14 }];
}

function treeMaterial(style: StylePreset, time: N, sunDir: N): THREE.MeshStandardNodeMaterial {
  const T = style.trees;
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = `${style.name}-trees`;
  mat.metalness = 0;
  mat.roughness = 0.95;
  const part: N = attribute("aPart", "float");
  const shade: N = attribute("aShade", "float");
  const vPart: N = varying(part, "vPart");
  const vShade: N = varying(shade, "vTreeShade");
  // Gentle sway of the foliage, phase from the tree's world position.
  const lp: N = positionLocal;
  const sway: N = smoothstep(1.5, 7.0, positionGeometry.y).mul(part).mul(0.08);
  const ph: N = lp.x.mul(0.13).add(lp.z.mul(0.11));
  mat.positionNode = lp.add(vec3(sin(time.mul(1.3).add(ph)), 0.0, sin(time.mul(1.1).add(ph.mul(1.7)))).mul(sway));
  mat.colorNode = Fn(() => {
    const leaf = mix(color(T.leafDark), color(T.leaf), smoothstep(0.25, 0.75, vShade)).toVar();
    leaf.assign(mix(leaf, color(T.leafLight), smoothstep(0.75, 1.1, vShade)));
    const trunk = color(T.trunk).mul(vShade.mul(0.5).add(0.6));
    return mix(trunk, leaf, vPart);
  })();
  void sunDir;
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
  const moss = smoothstep(0.35, 0.9, p.y).mul(0.55);
  mat.colorNode = mix(color(style.rock).mul(n.g.mul(0.35).add(0.8)), color(style.stone.mossColor), moss.mul(smoothstep(0.45, 0.7, n.r)));
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
const _y = new THREE.Vector3(0, 1, 0);

export class Scatter {
  readonly root = new THREE.Group();
  private trees: TreeSpot[];
  private rocks: TreeSpot[];
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
    this.trees = placeTrees(1900);
    this.rocks = placeRocks(700);
    this.root.name = "scatter";
  }

  private build(style: StylePreset): StyleScatter {
    const meshes: THREE.InstancedMesh[] = [];
    const fullCounts: number[] = [];
    const tmat = treeMaterial(style, this.time, this.sunDir);
    const typesNear = treeTypes(false);
    const typesFar = treeTypes(true);
    const types = typesNear;
    let acc = 0;
    const ranges = types.map((t) => {
      const r = [acc, acc + t.share];
      acc += t.share;
      return r;
    });
    for (let ti = 0; ti < types.length; ti++) {
      for (const near of [true, false]) {
        const spots = this.trees.filter((s) => s.near === near && s.variant >= ranges[ti][0] && s.variant < ranges[ti][1] + (ti === types.length - 1 ? 1 : 0));
        if (spots.length === 0) continue;
        const mesh = new THREE.InstancedMesh((near ? typesNear : typesFar)[ti].geometry, tmat, spots.length);
        mesh.name = `trees-${style.name}-${ti}-${near ? "near" : "far"}`;
        spots.forEach((s, i) => {
          _p.set(s.x, s.y, s.z);
          _q.setFromAxisAngle(_y, s.yaw);
          const ss = s.s * 1.1;
          _s.set(ss, ss * (0.9 + s.tint * 0.25), ss);
          _m.compose(_p, _q, _s);
          mesh.setMatrixAt(i, _m);
          _c.setRGB(1, 1, 1);
          _c.offsetHSL((s.tint - 0.5) * 0.06, (s.variant - 0.5) * 0.1, 0);
          _c.multiplyScalar(0.82 + s.tint * 0.3);
          mesh.setColorAt(i, _c);
        });
        mesh.castShadow = near;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        meshes.push(mesh);
        fullCounts.push(spots.length);
      }
    }
    const rmat = rockMaterial(style, this.noise);
    const rgeo = rockGeometry(1, 5, true);
    for (const near of [true, false]) {
      const spots = this.rocks.filter((s) => s.near === near);
      const mesh = new THREE.InstancedMesh(rgeo, rmat, spots.length);
      mesh.name = `rocks-${style.name}-${near ? "near" : "far"}`;
      spots.forEach((s, i) => {
        _p.set(s.x, s.y, s.z);
        _q.setFromEuler(new THREE.Euler(s.variant * 0.6 - 0.3, s.yaw, s.tint * 0.5 - 0.25));
        _s.set(s.s * (0.8 + s.variant * 0.5), s.s * (0.6 + s.tint * 0.5), s.s);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);
        _c.setRGB(1, 1, 1).multiplyScalar(0.8 + s.tint * 0.35);
        mesh.setColorAt(i, _c);
      });
      mesh.castShadow = near;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      meshes.push(mesh);
      fullCounts.push(spots.length);
    }
    return { meshes, fullCounts, materials: [tmat, rmat] };
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
    });
  }

  dispose() {
    for (const s of this.styles.values()) {
      for (const m of s.meshes) m.geometry.dispose();
      for (const m of s.materials) m.dispose();
    }
  }
}

