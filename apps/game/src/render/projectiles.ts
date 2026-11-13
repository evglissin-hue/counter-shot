// Projectiles in flight: iron round shot, mortar shells with a glowing fuse
// spark (readability rule 3: threats glow), chain-shot balls and the chain
// between each pair, and grapeshot pellets. All instanced; the page sends the
// flat arrays from the sim every frame.

import * as THREE from "three/webgpu";
import {
  attribute,
  cameraPosition,
  cameraWorldMatrix,
  clamp,
  color,
  float,
  hash,
  mix,
  positionGeometry,
  select,
  sin,
  smoothstep,
  texture,
  varying,
  vec3,
  vec4,
  positionWorld,
} from "three/tsl";
import { CHAIN_STRIDE, PROJECTILE_STRIDE, ProjectileKind } from "@keepfall/sim";
import type { StylePreset } from "./styles";
import { noAoNormal, type N } from "./tslUtils";
import { applyCloudShadow } from "./clouds";

const MAX_BALLS = 256;
const MAX_SPARKS = 32;
const MAX_CHAINS = 32;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Projectiles {
  readonly root = new THREE.Group();
  private balls: THREE.Mesh;
  private ballArr = new Float32Array(MAX_BALLS * 4);
  private kindArr = new Float32Array(MAX_BALLS);
  private ballAttr: THREE.InstancedBufferAttribute;
  private kindAttr: THREE.InstancedBufferAttribute;
  private sparks: THREE.Mesh;
  private sparkArr = new Float32Array(MAX_SPARKS * 4);
  private sparkAttr: THREE.InstancedBufferAttribute;
  private chains: THREE.InstancedMesh;

  constructor(style: StylePreset, time: N, noise: THREE.Texture) {
    this.root.name = "projectiles";
    const ico = new THREE.IcosahedronGeometry(1, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", ico.attributes.position);
    g.setAttribute("normal", ico.attributes.normal);
    this.ballAttr = new THREE.InstancedBufferAttribute(this.ballArr, 4);
    this.ballAttr.setUsage(THREE.DynamicDrawUsage);
    this.kindAttr = new THREE.InstancedBufferAttribute(this.kindArr, 1);
    this.kindAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("iBall", this.ballAttr);
    g.setAttribute("iKind", this.kindAttr);
    g.instanceCount = 0;
    const bm = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(bm);
    bm.name = "projectiles";
    const b: N = attribute("iBall", "vec4");
    const kind: N = attribute("iKind", "float");
    bm.positionNode = positionGeometry.mul(b.w).add(b.xyz);
    const vKind: N = varying(kind, "vProjKind");
    const rust: N = texture(noise, positionGeometry.xy.mul(0.8).add(b.xz.mul(0.01))).r;
    const iron: N = mix(color(style.iron), color(0x4a3426), smoothstep(0.55, 0.8, rust).mul(0.5));
    // Shells: dull black cast iron; grape pellets tiny and dark.
    bm.colorNode = select(vKind.equal(1), color(0x161514), select(vKind.equal(3), color(0x1d1c1b), iron));
    bm.metalness = 0.6;
    bm.roughness = 0.6;
    this.balls = new THREE.Mesh(g, bm);
    this.balls.name = "projectile-balls";
    this.balls.frustumCulled = false;
    this.balls.castShadow = true;
    this.balls.receiveShadow = true;
    this.balls.visible = false;

    // Fuse sparks: camera-facing glow quads, a little larger with distance so they stay visible.
    const quad = new THREE.PlaneGeometry(1, 1);
    const sg = new THREE.InstancedBufferGeometry();
    sg.setIndex(quad.index);
    sg.setAttribute("position", quad.attributes.position);
    this.sparkAttr = new THREE.InstancedBufferAttribute(this.sparkArr, 4);
    this.sparkAttr.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute("iSpark", this.sparkAttr);
    sg.instanceCount = 0;
    const sm = new THREE.MeshBasicNodeMaterial();
    sm.name = "fuse-sparks";
    sm.transparent = true;
    sm.depthWrite = false;
    sm.blending = THREE.AdditiveBlending;
    noAoNormal(sm);
    sm.fog = false;
    const sp: N = attribute("iSpark", "vec4");
    const dist: N = sp.xyz.sub(cameraPosition).length();
    const flicker: N = sin(time.mul(53.0).add(sp.w.mul(17.0))).mul(0.25).add(sin(time.mul(31.0).add(sp.w)).mul(0.15)).add(1.0);
    const size: N = clamp(dist.mul(0.012), 0.35, 3.0).mul(flicker);
    const right: N = (cameraWorldMatrix as N).element(0).xyz;
    const upv: N = (cameraWorldMatrix as N).element(1).xyz;
    const qp: N = positionGeometry.xy;
    sm.positionNode = sp.xyz.add(right.mul(qp.x.mul(size))).add(upv.mul(qp.y.mul(size)));
    const vuv: N = varying(qp.mul(2.0), "vSparkUV");
    const r: N = vuv.length();
    const core: N = float(1).sub(smoothstep(0.0, 0.25, r));
    const halo: N = float(1).sub(smoothstep(0.1, 1.0, r));
    sm.colorNode = vec4(mix(vec3(1.0, 0.42, 0.08).mul(2.2), vec3(1.0, 0.85, 0.55).mul(5.0), core), 1.0);
    sm.opacityNode = clamp(core.add(halo.mul(halo).mul(0.55)), 0.0, 1.0);
    this.sparks = new THREE.Mesh(sg, sm);
    this.sparks.name = "fuse-sparks";
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 13;
    this.sparks.visible = false;

    // Chains: thin dark cylinders between the two balls.
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    const cm = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(cm);
    cm.name = "chains";
    cm.colorNode = color(0x1c1b1a).mul(hash(positionWorld.y.mul(40.0).floor()).mul(0.4).add(0.8));
    cm.metalness = 0.5;
    cm.roughness = 0.6;
    this.chains = new THREE.InstancedMesh(cyl, cm, MAX_CHAINS);
    this.chains.name = "chains";
    this.chains.count = 0;
    this.chains.frustumCulled = false;
    this.chains.castShadow = true;
    this.root.add(this.balls, this.chains, this.sparks);
  }

  private primed = false;
  /** Draw shells, sparks and chains once out of sight, so their shaders compile while loading. */
  prime(on: boolean) {
    const g = this.balls.geometry as THREE.InstancedBufferGeometry;
    const sg = this.sparks.geometry as THREE.InstancedBufferGeometry;
    if (on) {
      if (this.balls.visible || this.sparks.visible || this.chains.count) return;
      this.primed = true;
      this.ballArr.set([0, -500, 0, 0.1], 0);
      this.sparkArr.set([0, -500, 0, 0], 0);
      g.instanceCount = 1;
      sg.instanceCount = 1;
      this.ballAttr.needsUpdate = this.kindAttr.needsUpdate = this.sparkAttr.needsUpdate = true;
      this.balls.visible = this.sparks.visible = true;
      _m.makeTranslation(0, -500, 0);
      this.chains.setMatrixAt(0, _m);
      this.chains.count = 1;
      this.chains.instanceMatrix.needsUpdate = true;
    } else if (this.primed) {
      this.primed = false;
      g.instanceCount = 0;
      sg.instanceCount = 0;
      this.balls.visible = this.sparks.visible = false;
      this.chains.count = 0;
    }
  }

  update(proj: Float32Array, count: number, chains: Float32Array, chainCount: number) {
    const n = Math.max(0, Math.min(MAX_BALLS, count | 0));
    let ns = 0;
    for (let i = 0; i < n; i++) {
      const o = i * PROJECTILE_STRIDE;
      const kind = proj[o];
      const r = proj[o + 5];
      this.ballArr[i * 4] = proj[o + 2];
      this.ballArr[i * 4 + 1] = proj[o + 3];
      this.ballArr[i * 4 + 2] = proj[o + 4];
      this.ballArr[i * 4 + 3] = r;
      this.kindArr[i] = kind;
      if (kind === ProjectileKind.Shell && ns < MAX_SPARKS) {
        // The fuse sits on the shell, trailing a little against the flight.
        const vx = proj[o + 6], vy = proj[o + 7], vz = proj[o + 8];
        const vl = Math.hypot(vx, vy, vz) || 1;
        const k = ns * 4;
        this.sparkArr[k] = proj[o + 2] - (vx / vl) * r * 0.9;
        this.sparkArr[k + 1] = proj[o + 3] - (vy / vl) * r * 0.9 + r * 0.4;
        this.sparkArr[k + 2] = proj[o + 4] - (vz / vl) * r * 0.9;
        this.sparkArr[k + 3] = proj[o + 1];
        ns++;
      }
    }
    const g = this.balls.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = n;
    this.balls.visible = n > 0;
    if (n > 0) {
      this.ballAttr.clearUpdateRanges();
      this.ballAttr.addUpdateRange(0, n * 4);
      this.ballAttr.needsUpdate = true;
      this.kindAttr.clearUpdateRanges();
      this.kindAttr.addUpdateRange(0, n);
      this.kindAttr.needsUpdate = true;
    }
    const sg = this.sparks.geometry as THREE.InstancedBufferGeometry;
    sg.instanceCount = ns;
    this.sparks.visible = ns > 0;
    if (ns > 0) {
      this.sparkAttr.clearUpdateRanges();
      this.sparkAttr.addUpdateRange(0, ns * 4);
      this.sparkAttr.needsUpdate = true;
    }

    const nc = Math.max(0, Math.min(MAX_CHAINS, chainCount | 0));
    for (let i = 0; i < nc; i++) {
      const o = i * CHAIN_STRIDE;
      _p.set((chains[o] + chains[o + 3]) / 2, (chains[o + 1] + chains[o + 4]) / 2, (chains[o + 2] + chains[o + 5]) / 2);
      _d.set(chains[o + 3] - chains[o], chains[o + 4] - chains[o + 1], chains[o + 5] - chains[o + 2]);
      const len = _d.length();
      if (len > 1e-4) _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
      else _q.identity();
      _s.set(0.035, Math.max(len, 0.01), 0.035);
      _m.compose(_p, _q, _s);
      this.chains.setMatrixAt(i, _m);
    }
    this.chains.count = nc;
    if (nc > 0) this.chains.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.balls.geometry.dispose();
    this.sparks.geometry.dispose();
    this.chains.geometry.dispose();
    for (const m of [this.balls, this.sparks, this.chains]) (m.material as THREE.Material).dispose();
  }
}
