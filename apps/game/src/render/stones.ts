// All castle pieces as a handful of instanced meshes (one per geometry and
// material group). Positions and rotations live in one interleaved, dynamic
// instance buffer per group: [x, y, z, shade, qx, qy, qz, qw]. Moving a stone
// is eight float writes; the GPU applies the rotation in the vertex shader.

import * as THREE from "three/webgpu";
import type { CastleLayout, Stone } from "@keepfall/content";
import { boxStoneGeometry, wedgeStoneGeometry } from "./geometry";
import { GroupKind, makeGroupMaterial, makeProxyMaterial } from "./stoneMaterials";

/** Layer seen only by the shadow cameras (stone shadow proxies live there). */
export const SHADOW_LAYER = 1;
import type { StyleName, StylePreset } from "./styles";

const KINDS: GroupKind[] = ["stone", "wedge", "wood", "plaster", "roof", "pole"];

function kindOf(s: Stone): GroupKind {
  if (s.material === "stone") return s.shape === "wedge" ? "wedge" : "stone";
  if (s.material === "wood") return "wood";
  if (s.material === "plaster") return "plaster";
  if (s.material === "roof") return "roof";
  return "pole";
}

interface Group {
  kind: GroupKind;
  count: number;
  ids: Int32Array;
  dyn: THREE.InstancedInterleavedBuffer;
  stat: THREE.InstancedInterleavedBuffer;
  dynArray: Float32Array;
  statArray: Float32Array;
  initial: Float32Array;
  geometries: Map<StyleName, THREE.InstancedBufferGeometry>;
  materials: Map<StyleName, THREE.MeshStandardNodeMaterial>;
  mesh: THREE.Mesh;
  proxy: THREE.Mesh;
  dmin: number;
  dmax: number;
}

const _c = new THREE.Color();

function frac(x: number): number {
  return x - Math.floor(x);
}

export class StoneSet {
  readonly root = new THREE.Group();
  layout: CastleLayout;
  groups: Group[] = [];
  /** Per stone id: group index and slot inside the group. */
  groupOf: Uint8Array;
  slotOf: Int32Array;
  private noise: THREE.Texture;
  private styleName: StyleName | null = null;
  /** Stone ids per group (castle 0, castle 1, the bridges), for picking. */
  private castleIds: [Int32Array, Int32Array, Int32Array];
  /** Half extents per stone id (x is negative for wedges). */
  private half: Float32Array;
  private wedgePlanes = new Float64Array(24);
  private local = new Float64Array(6);
  private wedgeR = 0;

  constructor(layout: CastleLayout, noise: THREE.Texture) {
    this.layout = layout;
    this.noise = noise;
    const n = layout.stones.length;
    this.groupOf = new Uint8Array(n).fill(255);
    this.slotOf = new Int32Array(n).fill(-1);
    this.root.name = "stones";
    this.half = new Float32Array(n * 3);
    const groups: [number[], number[], number[]] = [[], [], []];
    for (const s of layout.stones) {
      groups[s.castle].push(s.id);
      this.half[s.id * 3] = s.shape === "wedge" ? -1 : s.hx;
      this.half[s.id * 3 + 1] = s.hy;
      this.half[s.id * 3 + 2] = s.hz;
    }
    this.castleIds = [Int32Array.from(groups[0]), Int32Array.from(groups[1]), Int32Array.from(groups[2])];
    {
      const w = layout.wedge;
      const sa = Math.sin(w.halfAngle);
      const ca = Math.cos(w.halfAngle);
      const zIn = w.rIn * ca - w.rc;
      const zOut = w.rOut * ca - w.rc;
      this.wedgePlanes.set([ca, 0, -sa, sa * w.rc, -ca, 0, -sa, sa * w.rc, 0, 1, 0, w.hy, 0, -1, 0, w.hy, 0, 0, 1, zOut, 0, 0, -1, -zIn]);
    }

    const buckets = new Map<GroupKind, Stone[]>();
    for (const k of KINDS) buckets.set(k, []);
    for (const s of layout.stones) buckets.get(kindOf(s))!.push(s);

    for (const kind of KINDS) {
      const list = buckets.get(kind)!;
      const count = list.length;
      const gi = this.groups.length;
      const dynArray = new Float32Array(Math.max(1, count) * 8);
      const statArray = new Float32Array(Math.max(1, count) * 8);
      const ids = new Int32Array(count);
      let roofPair = 0;
      for (let i = 0; i < count; i++) {
        const s = list[i];
        ids[i] = s.id;
        this.groupOf[s.id] = gi;
        this.slotOf[s.id] = i;
        const o = i * 8;
        dynArray[o] = s.x;
        dynArray[o + 1] = s.y;
        dynArray[o + 2] = s.z;
        dynArray[o + 3] = s.shade;
        dynArray[o + 4] = s.q[0];
        dynArray[o + 5] = s.q[1];
        dynArray[o + 6] = s.q[2];
        dynArray[o + 7] = s.q[3];
        statArray[o] = s.hx;
        statArray[o + 1] = s.hy;
        statArray[o + 2] = s.hz;
        if (kind === "roof") {
          // Which way local +Z points along the slope (for the tile rows).
          const [qx, qy, qz, qw] = s.q;
          const zy = 2 * (qy * qz - qw * qx);
          statArray[o + 7] = zy > 0 ? 1 : -1;
          statArray[o + 3] = roofPair++ >> 1; // house index, temporarily
        } else {
          statArray[o + 7] = frac(s.shade * 7.31);
        }
      }
      const dyn = new THREE.InstancedInterleavedBuffer(dynArray, 8, 1);
      dyn.setUsage(THREE.DynamicDrawUsage);
      const stat = new THREE.InstancedInterleavedBuffer(statArray, 8, 1);
      const mesh = new THREE.Mesh(new THREE.InstancedBufferGeometry());
      mesh.name = `stones-${kind}`;
      mesh.frustumCulled = false;
      // Shadows come from the plain-box proxy below (12 triangles per stone).
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.visible = count > 0;
      this.root.add(mesh);
      const proxyBase = kind === "wedge" ? wedgeStoneGeometry(layout.wedge, 0, 0) : boxStoneGeometry(0);
      const proxyGeo = new THREE.InstancedBufferGeometry();
      proxyGeo.setIndex(proxyBase.index);
      proxyGeo.setAttribute("position", proxyBase.attributes.position);
      proxyGeo.setAttribute("normal", proxyBase.attributes.normal);
      proxyGeo.setAttribute("iPosShade", new THREE.InterleavedBufferAttribute(dyn, 4, 0));
      proxyGeo.setAttribute("iQuat", new THREE.InterleavedBufferAttribute(dyn, 4, 4));
      proxyGeo.setAttribute("iSize", new THREE.InterleavedBufferAttribute(stat, 4, 0));
      proxyGeo.setAttribute("iColor", new THREE.InterleavedBufferAttribute(stat, 4, 4));
      proxyGeo.instanceCount = count;
      const proxy = new THREE.Mesh(proxyGeo, makeProxyMaterial(kind === "wedge"));
      proxy.name = `stones-${kind}-shadow`;
      proxy.frustumCulled = false;
      proxy.castShadow = true;
      proxy.receiveShadow = false;
      proxy.layers.set(SHADOW_LAYER);
      proxy.visible = count > 0;
      this.root.add(proxy);
      this.groups.push({
        kind,
        count,
        ids,
        dyn,
        stat,
        dynArray,
        statArray,
        initial: dynArray.slice(),
        geometries: new Map(),
        materials: new Map(),
        mesh,
        proxy,
        dmin: Infinity,
        dmax: -Infinity,
      });
    }
  }

  private geometryFor(g: Group, style: StylePreset): THREE.InstancedBufferGeometry {
    let geo = g.geometries.get(style.name);
    if (geo) return geo;
    const seg = style.geometry.bevelSegments;
    let base: THREE.BufferGeometry;
    if (g.kind === "wedge") base = wedgeStoneGeometry(this.layout.wedge, seg, style.geometry.bevelRadius);
    else base = boxStoneGeometry(g.kind === "pole" ? Math.min(seg, 1) : seg);
    geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute("position", base.attributes.position);
    geo.setAttribute("normal", base.attributes.normal);
    geo.setAttribute("iPosShade", new THREE.InterleavedBufferAttribute(g.dyn, 4, 0));
    geo.setAttribute("iQuat", new THREE.InterleavedBufferAttribute(g.dyn, 4, 4));
    geo.setAttribute("iSize", new THREE.InterleavedBufferAttribute(g.stat, 4, 0));
    geo.setAttribute("iColor", new THREE.InterleavedBufferAttribute(g.stat, 4, 4));
    geo.instanceCount = g.count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -75), 400);
    g.geometries.set(style.name, geo);
    return geo;
  }

  /** Per-style instance data: bevel radius and base colour. */
  private writeStyleData(g: Group, style: StylePreset) {
    const a = g.statArray;
    const S = style.stone;
    const seg = style.geometry.bevelSegments;
    const roofPairs: number[] = [];
    for (let i = 0; i < g.count; i++) {
      const id = g.ids[i];
      const s = this.layout.stones[id];
      const o = i * 8;
      const shade = s.shade;
      // Bevel radius (box stones only; the wedge geometry carries its own).
      const minH = Math.min(s.hx, s.hy, s.hz);
      a[o + 3] = seg > 0 && g.kind !== "wedge" ? Math.min(style.geometry.bevelRadius * (0.75 + 0.5 * frac(shade * 3.7)), minH * 0.42) : 0;
      // A slightly irregular, hand-laid look: shrink each block a little (visual only).
      const j = g.kind === "stone" && s.part !== "merlon" ? S.sizeJitter : 0;
      a[o] = s.hx - j * frac(shade * 17.3);
      a[o + 1] = s.hy - j * 0.4 * frac(shade * 23.9);
      a[o + 2] = s.hz - j * frac(shade * 31.1);
      if (g.kind === "stone" || g.kind === "wedge") {
        const brick = s.castle === 1;
        const pal = brick ? style.brick.colors : S.colors;
        // Castle flag for the shader (brick or granite).
        a[o + 7] = brick ? 1 : 0;
        const idx = Math.floor(frac(shade * 5.123) * pal.length) % pal.length;
        _c.setHex(pal[idx]);
        const hj = (frac(shade * 13.7) - 0.5) * S.hueJitter;
        const vj = (frac(shade * 7.9) - 0.5) * S.valueJitter;
        _c.offsetHSL(hj, style.geometry.flat ? 0 : (frac(shade * 3.3) - 0.5) * 0.06, 0);
        let v = 1 + vj * 2;
        // A few notably darker or lighter blocks.
        const odd = frac(shade * 29.3);
        if (odd < 0.025) v *= 0.78;
        else if (odd > 0.975) v *= 1.1;
        _c.multiplyScalar(v);
      } else if (g.kind === "roof") {
        if (roofPairs.length === 0) for (let k = 0; k < g.count; k++) roofPairs.push(k >> 1);
        const house = roofPairs[i];
        const pal = style.roof;
        const pick = Math.floor(frac(house * 0.618 + 0.13) * pal.length);
        _c.setHex(pal[pick]);
        _c.multiplyScalar(1 + (frac(shade * 5.7) - 0.5) * 0.12);
      } else {
        _c.setRGB(1, 1, 1);
      }
      a[o + 4] = _c.r;
      a[o + 5] = _c.g;
      a[o + 6] = _c.b;
    }
    g.stat.needsUpdate = true;
  }

  setStyle(style: StylePreset) {
    if (this.styleName === style.name) return;
    this.styleName = style.name;
    for (const g of this.groups) {
      if (g.count === 0) continue;
      this.writeStyleData(g, style);
      g.mesh.geometry = this.geometryFor(g, style);
      let mat = g.materials.get(style.name);
      if (!mat) {
        mat = makeGroupMaterial(g.kind, { style, wedge: this.layout.wedge, noise: this.noise });
        g.materials.set(style.name, mat);
      }
      g.mesh.material = mat;
    }
    this.wedgeR = style.geometry.bevelRadius;
  }

  /** Per moving body 8 floats: [id, x, y, z, qx, qy, qz, qw]. */
  updateBodies(data: Float32Array, count: number) {
    const groups = this.groups;
    const groupOf = this.groupOf;
    const slotOf = this.slotOf;
    const n = groupOf.length;
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      const id = data[o] | 0;
      if (id < 0 || id >= n) continue;
      const gi = groupOf[id];
      if (gi === 255) continue;
      const g = groups[gi];
      const s = slotOf[id];
      const a = g.dynArray;
      const k = s * 8;
      a[k] = data[o + 1];
      a[k + 1] = data[o + 2];
      a[k + 2] = data[o + 3];
      a[k + 4] = data[o + 4];
      a[k + 5] = data[o + 5];
      a[k + 6] = data[o + 6];
      a[k + 7] = data[o + 7];
      if (s < g.dmin) g.dmin = s;
      if (s > g.dmax) g.dmax = s;
    }
  }

  resetStones() {
    for (const g of this.groups) {
      g.dynArray.set(g.initial);
      g.dmin = 0;
      g.dmax = g.count - 1;
    }
  }

  /** Push the touched instance ranges to the GPU (once per frame). */
  flush() {
    for (const g of this.groups) {
      if (g.dmin > g.dmax) continue;
      g.dyn.clearUpdateRanges();
      g.dyn.addUpdateRange(g.dmin * 8, (g.dmax - g.dmin + 1) * 8);
      g.dyn.needsUpdate = true;
      g.dmin = Infinity;
      g.dmax = -Infinity;
    }
  }

  /** Current transform of a stone: writes [x, y, z, qx, qy, qz, qw] into out. */
  getTransform(id: number, out: Float32Array | number[]) {
    const g = this.groups[this.groupOf[id]];
    const k = this.slotOf[id] * 8;
    const a = g.dynArray;
    out[0] = a[k];
    out[1] = a[k + 1];
    out[2] = a[k + 2];
    out[3] = a[k + 4];
    out[4] = a[k + 5];
    out[5] = a[k + 6];
    out[6] = a[k + 7];
  }

  /**
   * Nearest hit of a ray against the stones of one castle. Exact convex test
   * per stone (6 planes) after a bounding sphere reject. Returns t or -1.
   * No allocations.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, castle: 0 | 1 | 2, maxT = Infinity): number {
    const ids = this.castleIds[castle];
    const half = this.half;
    const P = this.wedgePlanes;
    const wedgeR2 = 0.9 * 0.9;
    const L = this.local;
    let best = maxT;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      const g = this.groups[this.groupOf[id]];
      const o = this.slotOf[id] * 8;
      const a = g.dynArray;
      const px = a[o] - ox, py = a[o + 1] - oy, pz = a[o + 2] - oz;
      const hx = half[id * 3], hy = half[id * 3 + 1], hz = half[id * 3 + 2];
      const isWedge = hx < 0;
      const r2 = isWedge ? wedgeR2 : hx * hx + hy * hy + hz * hz;
      const tc = px * dx + py * dy + pz * dz;
      if (tc < -1) continue;
      const d2 = px * px + py * py + pz * pz - tc * tc;
      if (d2 > r2) continue;
      if (tc - Math.sqrt(r2) > best) continue;
      // Ray into the stone's frame: rotate by the conjugate quaternion.
      const qx = -a[o + 4], qy = -a[o + 5], qz = -a[o + 6], qw = a[o + 7];
      rotateInto(L, 0, qx, qy, qz, qw, -px, -py, -pz);
      rotateInto(L, 3, qx, qy, qz, qw, dx, dy, dz);
      let t0 = 0;
      let t1 = best;
      let hit = true;
      if (isWedge) {
        for (let p = 0; p < 24 && hit; p += 4) {
          const den = P[p] * L[3] + P[p + 1] * L[4] + P[p + 2] * L[5];
          const dist = P[p + 3] - (P[p] * L[0] + P[p + 1] * L[1] + P[p + 2] * L[2]);
          if (Math.abs(den) < 1e-9) {
            if (dist < 0) hit = false;
          } else {
            const t = dist / den;
            if (den < 0) {
              if (t > t0) t0 = t;
            } else if (t < t1) t1 = t;
            if (t0 > t1) hit = false;
          }
        }
      } else {
        for (let ax = 0; ax < 3 && hit; ax++) {
          const h = ax === 0 ? hx : ax === 1 ? hy : hz;
          const lo = L[ax], ld = L[3 + ax];
          if (Math.abs(ld) < 1e-9) {
            if (lo < -h || lo > h) hit = false;
          } else {
            let ta = (-h - lo) / ld, tb = (h - lo) / ld;
            if (ta > tb) {
              const t = ta;
              ta = tb;
              tb = t;
            }
            if (ta > t0) t0 = ta;
            if (tb < t1) t1 = tb;
            if (t0 > t1) hit = false;
          }
        }
      }
      if (hit && t0 < best) {
        best = t0;
        this.lastHitId = id;
      }
    }
    return best === maxT ? -1 : best;
  }

  /** Stone id of the nearest hit of the last raycast that hit something. */
  lastHitId = -1;

  /**
   * Outward face normal of a stone at a world point on its surface (boxes:
   * the face the point is nearest to; wedges: against the ray).
   */
  faceNormal(id: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, out: number[]) {
    const g = this.groups[this.groupOf[id]];
    const o = this.slotOf[id] * 8;
    const a = g.dynArray;
    const hx = this.half[id * 3];
    if (hx < 0) {
      out[0] = -dx;
      out[1] = -dy;
      out[2] = -dz;
      return;
    }
    const hy = this.half[id * 3 + 1], hz = this.half[id * 3 + 2];
    const L = this.local;
    rotateInto(L, 0, -a[o + 4], -a[o + 5], -a[o + 6], a[o + 7], x - a[o], y - a[o + 1], z - a[o + 2]);
    const rx = Math.abs(L[0]) / hx, ry = Math.abs(L[1]) / hy, rz = Math.abs(L[2]) / hz;
    let nx = 0, ny = 0, nz = 0;
    if (rx >= ry && rx >= rz) nx = Math.sign(L[0]) || 1;
    else if (ry >= rz) ny = Math.sign(L[1]) || 1;
    else nz = Math.sign(L[2]) || 1;
    rotateInto(L, 3, a[o + 4], a[o + 5], a[o + 6], a[o + 7], nx, ny, nz);
    out[0] = L[3];
    out[1] = L[4];
    out[2] = L[5];
  }

  get wedgeRadius() {
    return this.wedgeR;
  }

  dispose() {
    for (const g of this.groups) {
      for (const geo of g.geometries.values()) geo.dispose();
      for (const m of g.materials.values()) m.dispose();
      g.proxy.geometry.dispose();
      (g.proxy.material as THREE.Material).dispose();
    }
  }
}

function rotateInto(out: Float64Array, at: number, qx: number, qy: number, qz: number, qw: number, x: number, y: number, z: number) {
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[at] = x + qw * tx + (qy * tz - qz * ty);
  out[at + 1] = y + qw * ty + (qz * tx - qx * tz);
  out[at + 2] = z + qw * tz + (qx * ty - qy * tx);
}
