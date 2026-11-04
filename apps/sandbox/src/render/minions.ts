// Minions: a low-detail human figure built from the ragdoll's own capsules
// (MINION_PARTS) plus a kettle helmet and, while upright, a pike. Upright
// minions get a procedural walk from walkPhase; ragdolls take each part's
// transform from the sim. One instanced mesh per part shape, colours per
// instance (team tabard, cloth, skin).
//
// Gore (cosmetic only, the sim never knows): a heavy hit can take off an arm
// or a leg of a ragdoll. The renderer hides that limb's two parts, caps the
// stump and throws a loose copy of the limb that falls, tumbles and settles
// with simple kinematics.

import * as THREE from "three/webgpu";
import { MINION_PARTS, MINION_STRIDE, PART_STRIDE } from "@keepfall/sim";
import { mergeGeometries } from "./geometry";

const MAX_FIGURES = 128;
const MAX_LIMBS = 32;
const CAPACITY = MAX_FIGURES + MAX_LIMBS;
const STUMP = 0x2b0d0a;
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
const _s = new THREE.Vector3();
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
  private stumps: THREE.InstancedMesh;
  private nStump = 0;
  /** Counts after the frame's figures, before loose limbs are appended. */
  private baseCounts = new Int32Array(NPARTS);
  private baseStumps = 0;
  /** Severed limb per minion id: which limb (0..3) and the stump end along the upper part's axis. */
  private severed = new Map<number, { limb: number; sign: number }>();
  private limbs: Limb[] = [];
  private nextLimb = 0;
  private lastParts = new Float32Array(0);
  private lastPartCount = 0;
  private gore = true;

  constructor() {
    this.root.name = "minions";
    const mat = new THREE.MeshStandardNodeMaterial();
    mat.name = "minion-cloth";
    mat.roughness = 0.92;
    mat.metalness = 0;
    for (let i = 0; i < NPARTS; i++) {
      const p = MINION_PARTS[i];
      const geo = p.half > 0 ? new THREE.CapsuleGeometry(p.radius, p.half * 2, 3, 8) : new THREE.SphereGeometry(p.radius, 10, 8);
      const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
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
    // Stump caps: dark, wet discs where a limb came off.
    const sm = new THREE.MeshStandardNodeMaterial();
    sm.name = "minion-stump";
    sm.color = new THREE.Color(STUMP);
    sm.roughness = 0.4;
    this.stumps = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), sm, MAX_LIMBS * 2 + MAX_FIGURES);
    this.stumps.name = "minion-stumps";
    this.stumps.count = 0;
    this.stumps.frustumCulled = false;
    this.root.add(this.helmet, this.pike, this.stumps);
  }

  setGore(on: boolean) {
    this.gore = on;
  }

  private putStump(pos: THREE.Vector3, q: THREE.Quaternion, r: number) {
    if (this.nStump >= MAX_LIMBS * 2 + MAX_FIGURES) return;
    _s.set(r * 1.08, r * 0.5, r * 1.08);
    _m.compose(pos, q, _s);
    this.stumps.setMatrixAt(this.nStump++, _m);
  }

  /**
   * A heavy hit at (x, y, z): take a limb off the nearest ragdoll within
   * reach (once per minion; which limb is stable per minion id).
   */
  sever(x: number, y: number, z: number): boolean {
    const P = this.lastParts;
    let best = -1;
    let bestD = 2.5 * 2.5;
    for (let i = 0; i < this.lastPartCount; i++) {
      const o = i * PART_STRIDE;
      if ((P[o + 1] | 0) !== PELVIS) continue;
      const id = P[o] | 0;
      if (this.severed.has(id)) continue;
      const d = (P[o + 2] - x) ** 2 + (P[o + 3] - y) ** 2 + (P[o + 4] - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best < 0) return false;
    const limb = (Math.imul(best + 17, 2654435761) >>> 0) % 4;
    const upper = UARM_L + limb * 2;
    // Find the limb's parts and the body part it hangs from.
    let iu = -1, il = -1, ib = -1;
    const anchor = limb < 2 ? TORSO : PELVIS;
    for (let i = 0; i < this.lastPartCount; i++) {
      const o = i * PART_STRIDE;
      if ((P[o] | 0) !== best) continue;
      const part = P[o + 1] | 0;
      if (part === upper) iu = o;
      else if (part === upper + 1) il = o;
      else if (part === anchor) ib = o;
    }
    if (iu < 0 || il < 0) return false;
    const half = MINION_PARTS[upper].half;
    _q.set(P[iu + 5], P[iu + 6], P[iu + 7], P[iu + 8]);
    _d.set(0, half, 0).applyQuaternion(_q);
    let sign = 1;
    if (ib >= 0) {
      const dp = (P[iu + 2] + _d.x - P[ib + 2]) ** 2 + (P[iu + 3] + _d.y - P[ib + 3]) ** 2 + (P[iu + 4] + _d.z - P[ib + 4]) ** 2;
      const dm = (P[iu + 2] - _d.x - P[ib + 2]) ** 2 + (P[iu + 3] - _d.y - P[ib + 3]) ** 2 + (P[iu + 4] - _d.z - P[ib + 4]) ** 2;
      sign = dp <= dm ? 1 : -1;
    }
    this.severed.set(best, { limb, sign });
    // The loose limb: both parts as one rigid piece, thrown away from the hit.
    const c = new THREE.Vector3((P[iu + 2] + P[il + 2]) / 2, (P[iu + 3] + P[il + 3]) / 2, (P[iu + 4] + P[il + 4]) / 2);
    const L: Limb = {
      team: this.teamOf.get(best) ?? 0,
      upper,
      pos: c,
      q: new THREE.Quaternion(),
      offU: new THREE.Vector3(P[iu + 2], P[iu + 3], P[iu + 4]).sub(c),
      offL: new THREE.Vector3(P[il + 2], P[il + 3], P[il + 4]).sub(c),
      qU: new THREE.Quaternion(P[iu + 5], P[iu + 6], P[iu + 7], P[iu + 8]),
      qL: new THREE.Quaternion(P[il + 5], P[il + 6], P[il + 7], P[il + 8]),
      sign,
      vel: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      age: 0,
      settled: false,
    };
    const away = new THREE.Vector3(c.x - x, 0, c.z - z);
    if (away.lengthSq() < 1e-4) away.set(Math.cos(best), 0, Math.sin(best));
    away.normalize();
    const j = ((best * 7919) % 100) / 100;
    L.vel.set(away.x * (1.5 + j * 2), 2.5 + j * 1.5, away.z * (1.5 + j * 2));
    L.spin.set(away.z * (5 + j * 4), (j - 0.5) * 4, -away.x * (5 + j * 4));
    this.limbs[this.nextLimb] = L;
    this.nextLimb = (this.nextLimb + 1) % MAX_LIMBS;
    return true;
  }

  /** Advance the loose limbs and draw them (every rendered frame). */
  step(dt: number, height: (x: number, z: number) => number) {
    const [pu, pl] = this.joints;
    for (const L of this.limbs) {
      if (!L || L.settled) continue;
      L.age += dt;
      L.vel.y -= 9.81 * dt;
      L.pos.addScaledVector(L.vel, dt);
      const w = L.spin.length();
      if (w > 1e-4) {
        _q2.setFromAxisAngle(_a.copy(L.spin).multiplyScalar(1 / w), w * dt);
        L.q.premultiply(_q2);
      }
      pu.copy(L.offU).applyQuaternion(L.q).add(L.pos);
      pl.copy(L.offL).applyQuaternion(L.q).add(L.pos);
      const r = MINION_PARTS[L.upper].radius;
      const g = height(L.pos.x, L.pos.z);
      const low = Math.min(pu.y, pl.y) - r;
      if (low < g) {
        L.pos.y += g - low;
        if (L.vel.y < 0) L.vel.y *= -0.25;
        L.vel.x *= 0.55;
        L.vel.z *= 0.55;
        L.spin.multiplyScalar(0.4);
        // Topple flat: turn the limb's axis towards the horizontal.
        _d.copy(pu).sub(pl).normalize();
        _b.set(_d.x, 0, _d.z);
        if (_b.lengthSq() < 1e-4) _b.set(1, 0, 0);
        _b.normalize();
        _q2.setFromUnitVectors(_d, _b);
        _q.identity().slerp(_q2, 1 - Math.exp(-dt * 8));
        L.q.premultiply(_q);
        if ((L.vel.lengthSq() < 0.2 && Math.abs(_d.y) < 0.15) || L.age > 5) L.settled = true;
      }
    }
    this.drawLimbs();
  }

  private drawLimbs() {
    for (let i = 0; i < NPARTS; i++) this.counts[i] = this.baseCounts[i];
    this.nStump = this.baseStumps;
    if (this.gore) {
      for (const L of this.limbs) {
        if (!L) continue;
        for (let k = 0; k < 2; k++) {
          const part = L.upper + k;
          _p.copy(k === 0 ? L.offU : L.offL).applyQuaternion(L.q).add(L.pos);
          _q.copy(L.q).multiply(k === 0 ? L.qU : L.qL);
          this.put(part, _p, _q, L.team);
          if (k === 0) {
            // Cap on the cut end of the loose limb.
            _a.set(0, L.sign * MINION_PARTS[part].half, 0).applyQuaternion(_q).add(_p);
            this.putStump(_a, _q, MINION_PARTS[part].radius);
          }
        }
      }
    }
    for (let i = 0; i < NPARTS; i++) {
      const mesh = this.parts[i];
      mesh.count = this.counts[i];
      if (mesh.count > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.stumps.count = this.nStump;
    if (this.nStump > 0) this.stumps.instanceMatrix.needsUpdate = true;
  }

  private put(part: number, pos: THREE.Vector3, q: THREE.Quaternion, team: number) {
    const k = this.counts[part];
    if (k >= CAPACITY) return;
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
    this.nStump = 0;
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
    const np = Math.max(0, partCount | 0);
    if (this.lastParts.length < np * PART_STRIDE) this.lastParts = new Float32Array(np * PART_STRIDE * 2);
    this.lastParts.set(parts.subarray(0, np * PART_STRIDE));
    this.lastPartCount = np;
    for (let i = 0; i < np; i++) {
      const o = i * PART_STRIDE;
      const id = parts[o] | 0;
      const part = parts[o + 1] | 0;
      if (part < 0 || part >= NPARTS) continue;
      const team = this.teamOf.get(id) ?? 0;
      _p.set(parts[o + 2], parts[o + 3], parts[o + 4]);
      _q.set(parts[o + 5], parts[o + 6], parts[o + 7], parts[o + 8]);
      const cut = this.gore ? this.severed.get(id) : undefined;
      if (cut && (part === UARM_L + cut.limb * 2 || part === UARM_L + cut.limb * 2 + 1)) {
        if (part === UARM_L + cut.limb * 2) {
          // Stump cap where the limb joined the body.
          _a.set(0, cut.sign * MINION_PARTS[part].half, 0).applyQuaternion(_q).add(_p);
          this.putStump(_a, _q, MINION_PARTS[part].radius);
        }
        continue;
      }
      this.put(part, _p, _q, team);
    }
    this.baseCounts.set(this.counts);
    this.baseStumps = this.nStump;
    this.drawLimbs();
    this.helmet.count = this.nHelmet;
    if (this.nHelmet > 0) this.helmet.instanceMatrix.needsUpdate = true;
    this.pike.count = this.nPike;
    if (this.nPike > 0) this.pike.instanceMatrix.needsUpdate = true;
  }

  /** Forget the team of every minion (after a reset). */
  clear() {
    this.teamOf.clear();
    this.severed.clear();
    this.limbs = [];
    this.nextLimb = 0;
    this.lastPartCount = 0;
    this.baseCounts.fill(0);
    this.baseStumps = 0;
    this.stumps.count = 0;
    for (const m of this.parts) m.count = 0;
    this.helmet.count = 0;
    this.pike.count = 0;
  }

  dispose() {
    for (const m of [...this.parts, this.helmet, this.pike, this.stumps]) m.geometry.dispose();
    (this.stumps.material as THREE.Material).dispose();
    (this.parts[0].material as THREE.Material).dispose();
    (this.helmet.material as THREE.Material).dispose();
    (this.pike.material as THREE.Material).dispose();
  }
}

interface Limb {
  team: number;
  /** Part index of the upper segment (the lower one is upper + 1). */
  upper: number;
  pos: THREE.Vector3;
  q: THREE.Quaternion;
  offU: THREE.Vector3;
  offL: THREE.Vector3;
  qU: THREE.Quaternion;
  qL: THREE.Quaternion;
  sign: number;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  settled: boolean;
}
