// Blood decals on the ground (gore on): dark, desaturated red-brown splats
// that fade over about a minute. A ring of instanced flat quads with a noisy
// splat mask; cosmetic only.

import * as THREE from "three/webgpu";
import { Fn, attribute, clamp, color, cos, float, length, mix, normalLocal, positionGeometry, sin, smoothstep, texture, varying, vec2, vec3 } from "three/tsl";
import type { N } from "./tslUtils";

const MAX = 160;
const FADE_START = 40;
const FADE_END = 60;

export class Decals {
  readonly mesh: THREE.Mesh;
  private a = new Float32Array(MAX * 4);
  private b = new Float32Array(MAX * 4);
  private attrA: THREE.InstancedBufferAttribute;
  private attrB: THREE.InstancedBufferAttribute;
  private next = 0;
  private used = 0;

  constructor(time: N, noise: THREE.Texture) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(quad.index);
    geo.setAttribute("position", quad.attributes.position);
    this.attrA = new THREE.InstancedBufferAttribute(this.a, 4);
    this.attrB = new THREE.InstancedBufferAttribute(this.b, 4);
    this.attrA.setUsage(THREE.DynamicDrawUsage);
    this.attrB.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iDecalA", this.attrA);
    geo.setAttribute("iDecalB", this.attrB);
    geo.instanceCount = 0;
    const m = new THREE.MeshStandardNodeMaterial();
    m.name = "blood-decals";
    m.transparent = true;
    m.depthWrite = false;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    m.roughness = 0.45;
    m.metalness = 0;
    const A: N = attribute("iDecalA", "vec4");
    const B: N = attribute("iDecalB", "vec4");
    const qp: N = positionGeometry.xy;
    const ca: N = cos(B.y), sa: N = sin(B.y);
    const r: N = vec2(qp.x.mul(ca).sub(qp.y.mul(sa)), qp.x.mul(sa).add(qp.y.mul(ca))).mul(B.x);
    m.positionNode = Fn(() => {
      normalLocal.assign(vec3(0, 1, 0));
      return vec3(A.x.add(r.x), A.y.add(0.03), A.z.add(r.y));
    })();
    const vuv: N = varying(qp.mul(2.0), "vDecalUV");
    const vSeed: N = varying(B.z, "vDecalSeed");
    const vAge: N = varying(time.sub(A.w), "vDecalAge");
    const vStr: N = varying(B.w, "vDecalStr");
    m.colorNode = Fn(() => {
      const n = texture(noise, vuv.mul(0.3).add(vSeed)).g;
      return mix(color(0x2a0c09), color(0x3e1712), n);
    })();
    m.opacityNode = Fn(() => {
      const d = length(vuv);
      const n1 = texture(noise, vuv.mul(0.35).add(vec2(vSeed, vSeed.mul(1.3)))).r;
      const n2 = texture(noise, vuv.mul(1.1).add(vSeed.mul(2.1))).g;
      // A blotch with ragged edges and a few droplets around it.
      const splat = float(1).sub(smoothstep(0.35, 0.6, d.add(n1.sub(0.5).mul(0.7))));
      const drops = smoothstep(0.72, 0.8, n2).mul(float(1).sub(smoothstep(0.6, 1.0, d)));
      const fade = float(1).sub(smoothstep(FADE_START, FADE_END, vAge)).mul(smoothstep(0.0, 0.15, vAge));
      return clamp(splat.add(drops), 0.0, 1.0).mul(fade).mul(mix(0.6, 0.92, vStr));
    })();
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.name = "blood-decals";
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  add(now: number, x: number, y: number, z: number, strength: number, seed: number) {
    const k = this.next;
    this.next = (k + 1) % MAX;
    this.used = Math.min(MAX, this.used + 1);
    const s = Math.max(0, Math.min(1, strength));
    this.a.set([x, y, z, now], k * 4);
    this.b.set([0.5 + s * 1.1, seed * 6.283, seed * 7.31 % 1, s], k * 4);
    const g = this.mesh.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = this.used;
    this.mesh.visible = true;
    this.attrA.needsUpdate = true;
    this.attrB.needsUpdate = true;
  }

  clear() {
    this.used = 0;
    this.next = 0;
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
