// Cloth banners at the top of each keep's pole. One instanced mesh with two
// instances (enemy, player) that copy the pole's current transform every
// frame, so a falling pole takes its flag along. The cloth waves in the
// vertex shader with an analytic normal.

import * as THREE from "three/webgpu";
import {
  Fn,
  abs,
  attribute,
  color,
  cos,
  float,
  length,
  max,
  min,
  mix,
  normalGeometry,
  normalLocal,
  normalize,
  positionGeometry,
  pow,
  select,
  sin,
  smoothstep,
  texture,
  uv,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import type { CastleLayout } from "@keepfall/content";
import { mergeGeometries } from "./geometry";
import type { StoneSet } from "./stones";
import type { StyleName, StylePreset } from "./styles";
import { N, qrot } from "./tslUtils";

export class Flags {
  readonly mesh: THREE.Mesh;
  private dyn: THREE.InstancedInterleavedBuffer;
  private arr: Float32Array;
  private materials = new Map<StyleName, THREE.MeshStandardNodeMaterial>();
  private tmp = new Float32Array(7);
  private layout: CastleLayout;
  private time: N;
  private noise: THREE.Texture;

  constructor(layout: CastleLayout, time: N, noise: THREE.Texture) {
    this.layout = layout;
    this.time = time;
    this.noise = noise;
    const { w, h } = layout.flag;
    const cloth = new THREE.PlaneGeometry(w, h, 28, 14);
    cloth.translate(w / 2, -h / 2, 0);
    const finial = new THREE.IcosahedronGeometry(0.17, 2);
    finial.translate(0, 0.16, 0);
    finial.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(finial.attributes.position.count * 2), 2));
    const kindCloth = new Float32Array(cloth.attributes.position.count).fill(0);
    const kindFinial = new Float32Array(finial.attributes.position.count).fill(1);
    cloth.setAttribute("aKind", new THREE.BufferAttribute(kindCloth, 1));
    finial.setAttribute("aKind", new THREE.BufferAttribute(kindFinial, 1));
    const base = mergeGeometries([cloth, finial]);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute("position", base.attributes.position);
    geo.setAttribute("normal", base.attributes.normal);
    geo.setAttribute("uv", base.attributes.uv);
    geo.setAttribute("aKind", base.attributes.aKind);
    this.arr = new Float32Array(16);
    this.dyn = new THREE.InstancedInterleavedBuffer(this.arr, 8, 1);
    this.dyn.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iPosShade", new THREE.InterleavedBufferAttribute(this.dyn, 4, 0));
    geo.setAttribute("iQuat", new THREE.InterleavedBufferAttribute(this.dyn, 4, 4));
    geo.instanceCount = 2;
    this.mesh = new THREE.Mesh(geo);
    this.mesh.name = "flags";
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.arr[3] = 0;
    this.arr[11] = 1;
  }

  private material(style: StylePreset): THREE.MeshStandardNodeMaterial {
    let m = this.materials.get(style.name);
    if (m) return m;
    const { w, h } = this.layout.flag;
    const poleHy = this.layout.stones[this.layout.bannerIds[0]].hy;
    const poleR = this.layout.stones[this.layout.bannerIds[0]].hx;
    m = new THREE.MeshStandardNodeMaterial();
    m.name = `${style.name}-flags`;
    m.side = THREE.DoubleSide;
    m.flatShading = style.geometry.flat;
    m.metalness = 0;
    m.roughness = 0.8;
    const iPS: N = attribute("iPosShade", "vec4");
    const iQ: N = attribute("iQuat", "vec4");
    const kind: N = attribute("aKind", "float");
    const g: N = positionGeometry;
    const t: N = this.time;
    const idx: N = iPS.w;
    const u: N = g.x.div(w).clamp(0, 1);
    const v: N = g.y.negate().div(h);
    const k1 = 6.5;
    const ph: N = u.mul(k1).sub(t.mul(4.6)).add(idx.mul(1.7));
    const ph2: N = u.mul(14.0).sub(t.mul(7.1)).add(v.mul(2.3)).add(idx.mul(0.9));
    const amp: N = pow(u, 0.85).mul(0.2);
    const amp2: N = u.mul(0.055);
    const dz: N = sin(ph).mul(amp).add(sin(ph2).mul(amp2));
    // Analytic slope for the normal.
    const dzdx: N = cos(ph).mul(amp).mul(k1 / w).add(cos(ph2).mul(amp2).mul(14.0 / w));
    const dzdy: N = cos(ph2).mul(amp2).mul(-2.3 / h);
    const droop: N = u.mul(u).mul(0.16).add(sin(ph.mul(0.5)).mul(u).mul(0.04));
    const isCloth: N = kind.lessThan(0.5);
    const top = poleHy - 0.02;
    const clothLocal: N = vec3(g.x.add(poleR), g.y.add(top).sub(droop), dz);
    const finialLocal: N = g.add(vec3(0, poleHy, 0));
    const local: N = select(isCloth, clothLocal, finialLocal);
    const n: N = select(isCloth, normalize(vec3(dzdx.negate(), dzdy.negate(), 1.0)), normalGeometry);
    m.positionNode = Fn(() => {
      normalLocal.assign(qrot(iQ, n));
      return qrot(iQ, local).add(iPS.xyz);
    })();
    const vKind: N = varying(kind, "vKind");
    const vIdx: N = varying(idx, "vFlagIdx");
    const fuv: N = uv();
    const base: N = mix(color(style.bannerEnemy), color(style.bannerPlayer), vIdx);
    m.colorNode = Fn(() => {
      const c: N = base.toVar();
      // Emblem: a ring with a bar, plus a border along the hoist and edges.
      const d = length(fuv.sub(vec2(0.42, 0.5)).mul(vec2(w / h, 1.0)));
      const ring = float(1).sub(smoothstep(0.01, 0.03, abs(d.sub(0.26)))).add(float(1).sub(smoothstep(0.11, 0.13, d)));
      const border = max(float(1).sub(smoothstep(0.06, 0.075, fuv.y)), smoothstep(0.925, 0.94, fuv.y));
      const em = min(ring.add(border), 1.0);
      c.assign(mix(c, color(style.emblem), em.mul(style.name === "gritty" ? 0.55 : 0.95)));
      if (style.name !== "lowpoly") {
        const weave = texture(this.noise, fuv.mul(vec2(3.0, 2.0))).g;
        c.mulAssign(weave.mul(0.25).add(0.88));
      }
      return select(vKind.greaterThan(0.5), color(style.finial), c);
    })();
    m.roughnessNode = select(vKind.greaterThan(0.5), float(0.35), float(0.85));
    m.metalnessNode = select(vKind.greaterThan(0.5), float(0.8), float(0.0));
    if (style.tattered) {
      // Ragged free edge and a few holes.
      const n1: N = texture(this.noise, fuv.mul(vec2(1.6, 2.2)).add(vIdx.mul(0.37))).r;
      const n2: N = texture(this.noise, fuv.mul(vec2(4.0, 3.0))).b;
      const ragged: N = fuv.x.sub(0.68).mul(2.4).greaterThan(n1);
      const hole: N = n2.lessThan(0.05).and(fuv.x.greaterThan(0.3));
      m.maskNode = vKind.greaterThan(0.5).or(ragged.or(hole).not());
    }
    // Slight glow so the shaded side of the cloth is not dead.
    m.emissiveNode = base.mul(0.06).mul(float(1).sub(vKind));
    this.materials.set(style.name, m);
    return m;
  }

  setStyle(style: StylePreset) {
    this.mesh.material = this.material(style);
  }

  /** Copy the poles' current transforms into the flag instances. */
  update(stones: StoneSet) {
    for (let i = 0; i < 2; i++) {
      stones.getTransform(this.layout.bannerIds[i], this.tmp);
      const o = i * 8;
      this.arr[o] = this.tmp[0];
      this.arr[o + 1] = this.tmp[1];
      this.arr[o + 2] = this.tmp[2];
      this.arr[o + 4] = this.tmp[3];
      this.arr[o + 5] = this.tmp[4];
      this.arr[o + 6] = this.tmp[5];
      this.arr[o + 7] = this.tmp[6];
    }
    this.dyn.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    for (const m of this.materials.values()) m.dispose();
  }
}
