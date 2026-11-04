// Minions: a low-detail human figure built from the ragdoll's own capsules
// (MINION_PARTS) plus a kettle helmet and, while upright, a pike. Upright
// minions get a procedural walk from walkPhase; ragdolls take each part's
// transform from the sim. One instanced mesh per part shape, colours per
// instance (team tabard, cloth, skin).

import * as THREE from "three/webgpu";
import { MINION_PARTS, MINION_STRIDE, PART_STRIDE } from "@keepfall/sim";
import { mergeGeometries } from "./geometry";

const MAX_FIGURES = 128;
const NPARTS = MINION_PARTS.length;
const PELVIS = 0, TORSO = 1, HEAD = 2, UARM_L = 3, LARM_L = 4, UARM_R = 5, LARM_R = 6, THIGH_L = 7, SHIN_L = 8, THIGH_R = 9, SHIN_R = 10;

/** Tabard colours: team 0 sickly yellow-green (the attackers' accent), team 1 Ashwright oxblood. */
const TEAM = [0x93a524, 0x7a1519];
const CLOTH = 0x4a443b;
const LEGS = 0x2c2925;
const SKIN = 0x8c6d58;
const IRON = 0x3b3b39;
const POLE = 0x4f4840;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _y = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(1, 0, 0);
const _z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color();

export class Minions {
  readonly root = new THREE.Group();
  private parts: THREE.InstancedMesh[] = [];
  private helmet: THREE.InstancedMesh;
  private pike: THREE.InstancedMesh;
  private counts = new Int32Array(NPARTS);
  private teamOf = new Map<number, number>();
  private nHelmet = 0;
  private nPike = 0;
  private yawQ = new THREE.Quaternion();
  private base = new THREE.Vector3();
  private joints = Array.from({ length: 6 }, () => new THREE.Vector3());

  constructor() {
    this.root.name = "minions";
    const mat = new THREE.MeshStandardNodeMaterial();
    mat.name = "minion-cloth";
    mat.roughness = 0.92;
    mat.metalness = 0;
    for (let i = 0; i < NPARTS; i++) {
      const p = MINION_PARTS[i];
      const geo = p.half > 0 ? new THREE.CapsuleGeometry(p.radius, p.half * 2, 3, 8) : new THREE.SphereGeometry(p.radius, 10, 8);
      const mesh = new THREE.InstancedMesh(geo, mat, MAX_FIGURES);
      mesh.name = `minion-${p.name}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Allocate the colour buffer up front.
      mesh.setColorAt(0, _c.setHex(CLOTH));
      this.parts.push(mesh);
      this.root.add(mesh);
    }
    // Kettle helmet: a shallow dome on a wide brim.
    const dome = new THREE.SphereGeometry(0.135, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.deleteAttribute("uv");
    dome.translate(0, 0.02, 0);
    const brim = new THREE.CylinderGeometry(0.2, 0.21, 0.025, 12, 1);
    brim.deleteAttribute("uv");
    brim.translate(0, 0.02, 0);
    const iron = new THREE.MeshStandardNodeMaterial();
    iron.name = "minion-iron";
    iron.color = new THREE.Color(IRON);
    iron.metalness = 0.55;
    iron.roughness = 0.55;
    this.helmet = new THREE.InstancedMesh(mergeGeometries([dome, brim]), iron, MAX_FIGURES);
    this.helmet.name = "minion-helmet";
    this.helmet.count = 0;
    this.helmet.frustumCulled = false;
    this.helmet.castShadow = true;
    // Pike: a 4.4 m shaft with an iron head (local +Y up from the butt).
    const shaft = new THREE.CylinderGeometry(0.022, 0.028, 4.2, 5, 1);
    shaft.deleteAttribute("uv");
    shaft.translate(0, 2.1, 0);
    const head = new THREE.ConeGeometry(0.045, 0.32, 5, 1);
    head.deleteAttribute("uv");
    head.translate(0, 4.36, 0);
    const pikeGeo = mergeGeometries([shaft, head]);
    const pm = new THREE.MeshStandardNodeMaterial();
    pm.name = "minion-pike";
    pm.color = new THREE.Color(POLE);
    pm.roughness = 0.8;
    this.pike = new THREE.InstancedMesh(pikeGeo, pm, MAX_FIGURES);
    this.pike.name = "minion-pike";
    this.pike.count = 0;
    this.pike.frustumCulled = false;
    this.pike.castShadow = true;
    this.root.add(this.helmet, this.pike);
  }

  private put(part: number, pos: THREE.Vector3, q: THREE.Quaternion, team: number) {
    const k = this.counts[part];
    if (k >= MAX_FIGURES) return;
    this.counts[part] = k + 1;
    const mesh = this.parts[part];
    _m.compose(pos, q, _one);
    mesh.setMatrixAt(k, _m);
    let hex = CLOTH;
    if (part === TORSO || part === PELVIS) hex = TEAM[team & 1];
    else if (part === HEAD) hex = SKIN;
    else if (part >= THIGH_L) hex = LEGS;
    _c.setHex(hex);
    if (part === PELVIS) _c.multiplyScalar(0.8);
    mesh.setColorAt(k, _c);
    if (part === HEAD && this.nHelmet < MAX_FIGURES) {
      // Helmet rides on the head, along the head's own up.
      _a.set(0, 0.05, 0).applyQuaternion(q).add(pos);
      _m.compose(_a, q, _one);
      this.helmet.setMatrixAt(this.nHelmet++, _m);
    }
  }

  /** A segment from a to b as a capsule centred between them, axis along a->b. */
  private segment(part: number, a: THREE.Vector3, b: THREE.Vector3, yawQ: THREE.Quaternion, base: THREE.Vector3, team: number) {
    _p.copy(a).add(b).multiplyScalar(0.5).applyQuaternion(yawQ).add(base);
    _d.copy(b).sub(a).normalize();
    _q2.setFromUnitVectors(_y, _d);
    _q.copy(yawQ).multiply(_q2);
    this.put(part, _p, _q, team);
  }

  update(minions: Float32Array, minionCount: number, parts: Float32Array, partCount: number) {
    this.counts.fill(0);
    this.nHelmet = 0;
    this.nPike = 0;
    const yawQ = this.yawQ;
    const base = this.base;
    const n = Math.min(minionCount | 0, MAX_FIGURES);
    const [hip, knee, ankle, sh, elbow, hand] = this.joints;
    for (let i = 0; i < n; i++) {
      const o = i * MINION_STRIDE;
      const id = minions[o] | 0;
      const team = minions[o + 6] | 0;
      this.teamOf.set(id, team);
      base.set(minions[o + 1], minions[o + 2], minions[o + 3]);
      yawQ.setFromAxisAngle(_y, minions[o + 4]);
      const ph = minions[o + 5] * Math.PI * 2;
      const bob = Math.abs(Math.cos(ph)) * 0.035;
      const pikeman = team === 0;
      // Legs: swing forward and back, knee bends on the forward swing.
      for (let side = 1; side >= -1; side -= 2) {
        const s = Math.sin(ph + (side > 0 ? 0 : Math.PI));
        const a = s * 0.42;
        const bend = Math.max(0, Math.cos(ph + (side > 0 ? 0 : Math.PI))) * 0.65;
        hip.set(side * 0.1, 0.9 + bob, 0);
        knee.set(0, -Math.cos(a), Math.sin(a)).multiplyScalar(0.42).add(hip);
        ankle.set(0, -Math.cos(a - bend), Math.sin(a - bend)).multiplyScalar(0.4).add(knee);
        this.segment(side > 0 ? THIGH_L : THIGH_R, hip, knee, yawQ, base, team);
        this.segment(side > 0 ? SHIN_L : SHIN_R, knee, ankle, yawQ, base, team);
        // Arms swing against the leg on the same side; a pikeman's right hand holds the pike.
        sh.set(side * 0.25, 1.46 + bob, 0);
        let c = -a * 0.75;
        let e = 0.35;
        if (pikeman && side < 0) {
          c = 0.35;
          e = 1.35;
        }
        elbow.set(side * 0.03, -Math.cos(c), Math.sin(c)).multiplyScalar(0.27).add(sh);
        hand.set(0, -Math.cos(c + e), Math.sin(c + e)).multiplyScalar(0.25).add(elbow);
        this.segment(side > 0 ? UARM_L : UARM_R, sh, elbow, yawQ, base, team);
        this.segment(side > 0 ? LARM_L : LARM_R, elbow, hand, yawQ, base, team);
        if (pikeman && side < 0 && this.nPike < MAX_FIGURES) {
          // Pike held upright at the hand, leaning slightly forward.
          _q2.setFromAxisAngle(_x, 0.12);
          _q.copy(yawQ).multiply(_q2);
          _a.set(hand.x - 0.02, 0.15 + bob, hand.z).applyQuaternion(yawQ).add(base);
          _m.compose(_a, _q, _one);
          this.pike.setMatrixAt(this.nPike++, _m);
        }
      }
      // Pelvis lies sideways (wide hips), torso leans a touch into the walk.
      _q2.setFromAxisAngle(_z, Math.PI / 2);
      _q.copy(yawQ).multiply(_q2);
      _p.set(0, 0.97 + bob, 0).applyQuaternion(yawQ).add(base);
      this.put(PELVIS, _p, _q, team);
      _q2.setFromAxisAngle(_x, 0.07);
      _q.copy(yawQ).multiply(_q2);
      _p.set(0, 1.27 + bob, 0.01).applyQuaternion(yawQ).add(base);
      this.put(TORSO, _p, _q, team);
      _p.set(0, 1.62 + bob, 0.04).applyQuaternion(yawQ).add(base);
      this.put(HEAD, _p, yawQ, team);
    }
    // Ragdolls: one capsule per part straight from the sim.
    const np = partCount | 0;
    for (let i = 0; i < np; i++) {
      const o = i * PART_STRIDE;
      const part = parts[o + 1] | 0;
      if (part < 0 || part >= NPARTS) continue;
      const team = this.teamOf.get(parts[o] | 0) ?? 0;
      _p.set(parts[o + 2], parts[o + 3], parts[o + 4]);
      _q.set(parts[o + 5], parts[o + 6], parts[o + 7], parts[o + 8]);
      this.put(part, _p, _q, team);
    }
    for (let i = 0; i < NPARTS; i++) {
      const mesh = this.parts[i];
      mesh.count = this.counts[i];
      if (mesh.count > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.helmet.count = this.nHelmet;
    if (this.nHelmet > 0) this.helmet.instanceMatrix.needsUpdate = true;
    this.pike.count = this.nPike;
    if (this.nPike > 0) this.pike.instanceMatrix.needsUpdate = true;
  }

  /** Forget the team of every minion (after a reset). */
  clear() {
    this.teamOf.clear();
    for (const m of this.parts) m.count = 0;
    this.helmet.count = 0;
    this.pike.count = 0;
  }

  dispose() {
    for (const m of [...this.parts, this.helmet, this.pike]) m.geometry.dispose();
    (this.parts[0].material as THREE.Material).dispose();
    (this.helmet.material as THREE.Material).dispose();
    (this.pike.material as THREE.Material).dispose();
  }
}
