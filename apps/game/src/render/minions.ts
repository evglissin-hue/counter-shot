// Minions: a low-detail human figure built from the ragdoll's own capsules
// (MINION_PARTS) plus a kettle helmet and, while upright, a pike. Upright
// minions get a procedural pose from what they are doing (walking, standing,
// pike levelled in a fight or against a gate, with a thrust at each blow);
// ragdolls take each part's transform from the sim. The fallen arrive once,
// when they freeze, and are kept until they move again or sink away, so a
// field of bodies costs nothing per frame. One instanced mesh per part shape,
// colours per instance (team tabard, cloth, skin).
//
// Gore (cosmetic only, the sim never knows): a heavy hit can take off an arm
// or a leg of a ragdoll. The renderer hides that limb's two parts, caps the
// stump and throws a loose copy of the limb that falls, tumbles and settles
// with simple kinematics.

import * as THREE from "three/webgpu";
import { MINION_PARTS, MINION_STRIDE, PART_STRIDE, type FrameData } from "@keepfall/sim";
import { mergeGeometries } from "./geometry";

/** Figures drawn at once: upright, falling and the fallen (the sim keeps at most 240 bodies). */
const MAX_FIGURES = 640;
const MAX_PIKES = 360;
const MAX_LIMBS = 32;
const CAPACITY = MAX_FIGURES + MAX_LIMBS;
/** Upright actions (army.ts Action). */
const STAND = 1, FIGHT = 2, BATTER = 3;
/** M4 actions: a mason at work, carrying a ladder, climbing (a ladder or the rope inside), raising a ladder. */
const WORK = 4, CARRY = 5, CLIMB = 6, RAISE = 7;
/** Unit kinds (content's Unit): masons and ladder crews look different. */
const MASON = 1, CREW = 2;
/** Where in a mason's stroke the mallet strikes (ticks; the page plays the knock then). */
const MALLET_HIT = 14;
const MALLET_STROKE = 45;
const APRON = 0x5b3f29;
const MAX_TOOLS = 96;
/** A thrust's length in ticks. */
const THRUST = 22;
const STUMP = 0x2b0d0a;
const NPARTS = MINION_PARTS.length;
const PELVIS = 0, TORSO = 1, HEAD = 2, UARM_L = 3, LARM_L = 4, UARM_R = 5, LARM_R = 6, THIGH_L = 7, SHIN_L = 8, THIGH_R = 9, SHIN_R = 10;

/** Tabard colours: team 0 sickly yellow-green (the attackers' accent), team 1 Ashwright oxblood. */
export const TEAM_COLORS = [0x93a524, 0x7a1519];
const TEAM = TEAM_COLORS;
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
  /** Masons' mallets, ladder crews' axes and masons' caps. */
  private mallet: THREE.InstancedMesh;
  private axe: THREE.InstancedMesh;
  private cap: THREE.InstancedMesh;
  private nMallet = 0;
  private nAxe = 0;
  private nCap = 0;
  /** The figure being drawn is a mason (cap and apron) rather than a soldier (helmet and tabard). */
  private dress = 0;
  private counts = new Int32Array(NPARTS);
  private teamOf = new Map<number, number>();
  /** The unit kind of every minion seen upright (so a fallen mason still wears his cap and apron). */
  private unitOf = new Map<number, number>();
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
  /** The fallen, by minion id: their parts as they froze (PART_STRIDE each). Drawn first, rewritten only when this changes. */
  private frozen = new Map<number, Float32Array>();
  private frozenDirty = false;
  private frozenCounts = new Int32Array(NPARTS);
  private frozenStumps = 0;
  private frozenHelmets = 0;

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
    this.pike = new THREE.InstancedMesh(pikeGeo, pm, MAX_PIKES);
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
    // A mason's wooden mallet: a short handle and a round-ended head (local +Y from the grip to the head).
    const handle = new THREE.CylinderGeometry(0.016, 0.02, 0.34, 5, 1);
    handle.deleteAttribute("uv");
    handle.translate(0, 0.17, 0);
    const mhead = new THREE.CylinderGeometry(0.055, 0.055, 0.17, 7, 1);
    mhead.deleteAttribute("uv");
    mhead.rotateZ(Math.PI / 2);
    mhead.translate(0, 0.36, 0);
    this.mallet = new THREE.InstancedMesh(mergeGeometries([handle, mhead]), pm, MAX_TOOLS);
    this.mallet.name = "minion-mallet";
    // A crew's axe: a longer haft and a dark iron head.
    const haft = new THREE.CylinderGeometry(0.017, 0.021, 0.74, 5, 1);
    haft.deleteAttribute("uv");
    haft.translate(0, 0.37, 0);
    const blade = new THREE.BoxGeometry(0.02, 0.15, 0.13);
    blade.deleteAttribute("uv");
    blade.translate(0, 0.67, 0.07);
    this.axe = new THREE.InstancedMesh(mergeGeometries([haft, blade]), iron, MAX_TOOLS);
    this.axe.name = "minion-axe";
    // A mason's soft cloth cap, in his side's colour.
    const capGeo = new THREE.SphereGeometry(0.128, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    capGeo.deleteAttribute("uv");
    capGeo.scale(1, 0.62, 1.05);
    capGeo.translate(0, 0.035, -0.01);
    this.cap = new THREE.InstancedMesh(capGeo, mat, MAX_TOOLS);
    this.cap.name = "minion-cap";
    this.cap.setColorAt(0, _c.setHex(CLOTH));
    for (const t of [this.mallet, this.axe, this.cap]) {
      t.count = 0;
      t.frustumCulled = false;
      t.castShadow = true;
      this.root.add(t);
    }
  }

  /** Draw the stump caps and helmets once out of sight, so their shaders compile while loading, not at the first severed limb. */
  prime(on: boolean) {
    for (const mesh of [this.stumps, this.helmet, this.mallet, this.axe, this.cap]) {
      if (on && mesh.count === 0) {
        _m.makeTranslation(0, -500, 0);
        mesh.setMatrixAt(0, _m);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.count = 1;
        mesh.userData.primed = true;
      } else if (!on && mesh.userData.primed) {
        mesh.count = 0;
        mesh.userData.primed = false;
      }
    }
  }

  setGore(on: boolean) {
    this.gore = on;
    this.frozenDirty = true;
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
    // A mason's leather apron covers his hips and thighs.
    if (this.dress === 1 && (part === PELVIS || part === THIGH_L || part === THIGH_R)) hex = APRON;
    _c.setHex(hex);
    if (part === PELVIS) _c.multiplyScalar(0.8);
    mesh.setColorAt(k, _c);
    if (part === HEAD && this.dress === 1) {
      // A mason wears a cloth cap in his side's colour, not a helmet.
      if (this.nCap < MAX_TOOLS) {
        _a.set(0, 0.05, 0).applyQuaternion(q).add(pos);
        _m.compose(_a, q, _one);
        this.cap.setMatrixAt(this.nCap, _m);
        this.cap.setColorAt(this.nCap, _c.setHex(TEAM[team & 1]).multiplyScalar(0.75));
        this.nCap++;
      }
    } else if (part === HEAD && this.nHelmet < MAX_FIGURES) {
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

  /** One sim frame: upright figures, moving bodies, and the fallen that froze or left since the last one. */
  update(f: Pick<FrameData, "minions" | "minionCount" | "parts" | "partCount" | "settled" | "settledCount" | "gone">) {
    const { minions, minionCount, parts, partCount, settled, settledCount, gone } = f;
    // The fallen: who left, who moves again, who froze.
    for (let i = 0; i < gone.length; i++) {
      const id = gone[i];
      if (this.frozen.delete(id)) this.frozenDirty = true;
      this.teamOf.delete(id);
      this.unitOf.delete(id);
      this.severed.delete(id);
    }
    const np = Math.max(0, partCount | 0);
    for (let i = 0; i < np; i++) {
      const id = parts[i * PART_STRIDE] | 0;
      if (this.frozen.delete(id)) this.frozenDirty = true;
    }
    for (let i = 0; i < (settledCount | 0); i++) {
      const o = i * PART_STRIDE;
      const id = settled[o] | 0, part = settled[o + 1] | 0;
      if (part < 0 || part >= NPARTS) continue;
      let body = this.frozen.get(id);
      if (!body) {
        body = new Float32Array(NPARTS * PART_STRIDE).fill(NaN);
        this.frozen.set(id, body);
      }
      body.set(settled.subarray(o, o + PART_STRIDE), part * PART_STRIDE);
      this.frozenDirty = true;
    }
    if (this.frozenDirty) this.drawFrozen();
    this.counts.set(this.frozenCounts);
    this.nStump = this.frozenStumps;
    this.nHelmet = this.frozenHelmets;
    this.nPike = 0;
    this.nMallet = this.nAxe = this.nCap = 0;
    const yawQ = this.yawQ;
    const base = this.base;
    const n = Math.min(minionCount | 0, MAX_FIGURES);
    const [hip, knee, ankle, sh, elbow, hand] = this.joints;
    for (let i = 0; i < n; i++) {
      const o = i * MINION_STRIDE;
      const id = minions[o] | 0;
      const team = minions[o + 6] | 0;
      const action = minions[o + 7] | 0;
      const act = minions[o + 8];
      const unit = minions[o + 9] | 0;
      this.teamOf.set(id, team);
      if (unit) this.unitOf.set(id, unit);
      base.set(minions[o + 1], minions[o + 2], minions[o + 3]);
      yawQ.setFromAxisAngle(_y, minions[o + 4]);
      // M4: masons, ladder crews and climbers have their own figures.
      if (unit === MASON) {
        this.drawMason(team, action, act, minions[o + 5] * Math.PI * 2);
        continue;
      }
      if (action === CLIMB) {
        this.drawClimber(team, unit, minions[o + 5] * Math.PI * 2);
        continue;
      }
      if (action === CARRY || action === RAISE) {
        this.drawCarrier(team, action, minions[o + 5] * Math.PI * 2);
        continue;
      }
      if (unit === CREW && action === FIGHT) {
        this.drawAxeman(team, act);
        continue;
      }
      if (action === FIGHT || action === BATTER) {
        this.drawLevelled(team, act, action === BATTER);
        continue;
      }
      const standing = action === STAND;
      const ph = minions[o + 5] * Math.PI * 2;
      const bob = standing ? 0 : Math.abs(Math.cos(ph)) * 0.035;
      // Legs: swing forward and back, knee bends on the forward swing (straight when standing).
      for (let side = 1; side >= -1; side -= 2) {
        const s = standing ? 0 : Math.sin(ph + (side > 0 ? 0 : Math.PI));
        const a = s * 0.42;
        const bend = standing ? 0.04 : Math.max(0, Math.cos(ph + (side > 0 ? 0 : Math.PI))) * 0.65;
        hip.set(side * 0.1, 0.9 + bob, 0);
        knee.set(0, -Math.cos(a), Math.sin(a)).multiplyScalar(0.42).add(hip);
        ankle.set(0, -Math.cos(a - bend), Math.sin(a - bend)).multiplyScalar(0.4).add(knee);
        this.segment(side > 0 ? THIGH_L : THIGH_R, hip, knee, yawQ, base, team);
        this.segment(side > 0 ? SHIN_L : SHIN_R, knee, ankle, yawQ, base, team);
        // Arms swing against the leg on the same side; the right hand holds the pike.
        sh.set(side * 0.25, 1.46 + bob, 0);
        let c = standing ? 0.06 : -a * 0.75;
        let e = 0.35;
        if (side < 0) {
          c = 0.35;
          e = 1.35;
        }
        elbow.set(side * 0.03, -Math.cos(c), Math.sin(c)).multiplyScalar(0.27).add(sh);
        hand.set(0, -Math.cos(c + e), Math.sin(c + e)).multiplyScalar(0.25).add(elbow);
        this.segment(side > 0 ? UARM_L : UARM_R, sh, elbow, yawQ, base, team);
        this.segment(side > 0 ? LARM_L : LARM_R, elbow, hand, yawQ, base, team);
        if (side < 0 && unit === CREW) this.tool(this.axe, hand, elbow, 0.2);
        else if (side < 0 && this.nPike < MAX_PIKES) {
          // Pike held upright at the hand, leaning slightly forward.
          _q2.setFromAxisAngle(_x, standing ? 0.05 : 0.12);
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
      _q2.setFromAxisAngle(_x, standing ? 0.02 : 0.07);
      _q.copy(yawQ).multiply(_q2);
      _p.set(0, 1.27 + bob, 0.01).applyQuaternion(yawQ).add(base);
      this.put(TORSO, _p, _q, team);
      _p.set(0, 1.62 + bob, 0.04).applyQuaternion(yawQ).add(base);
      this.put(HEAD, _p, yawQ, team);
    }
    // Ragdolls: one capsule per part straight from the sim.
    if (this.lastParts.length < np * PART_STRIDE) this.lastParts = new Float32Array(np * PART_STRIDE * 2);
    this.lastParts.set(parts.subarray(0, np * PART_STRIDE));
    this.lastPartCount = np;
    for (let i = 0; i < np; i++) this.putPart(parts, i * PART_STRIDE);
    this.baseCounts.set(this.counts);
    this.baseStumps = this.nStump;
    this.drawLimbs();
    this.helmet.count = this.nHelmet;
    if (this.nHelmet > 0) this.helmet.instanceMatrix.needsUpdate = true;
    this.pike.count = this.nPike;
    if (this.nPike > 0) this.pike.instanceMatrix.needsUpdate = true;
    this.mallet.count = this.nMallet;
    this.axe.count = this.nAxe;
    this.cap.count = this.nCap;
    for (const t of [this.mallet, this.axe, this.cap]) {
      if (t.count > 0) {
        t.instanceMatrix.needsUpdate = true;
        if (t.instanceColor) t.instanceColor.needsUpdate = true;
      }
    }
  }

  /** A tool in a hand (minion space), along the forearm from the elbow, turned down by `tilt` (rad) at the wrist. */
  private tool(mesh: THREE.InstancedMesh, hand: THREE.Vector3, elbow: THREE.Vector3, tilt: number) {
    const n = mesh === this.mallet ? this.nMallet : this.nAxe;
    if (n >= MAX_TOOLS) return;
    _d.copy(hand).sub(elbow).normalize();
    _q2.setFromUnitVectors(_y, _d);
    _q.copy(this.yawQ).multiply(_q2);
    if (tilt) {
      _q2.setFromAxisAngle(_x, tilt);
      _q.multiply(_q2);
    }
    _a.copy(hand).applyQuaternion(this.yawQ).add(this.base);
    _m.compose(_a, _q, _one);
    mesh.setMatrixAt(n, _m);
    if (mesh === this.mallet) this.nMallet++;
    else this.nAxe++;
  }

  /** Legs for a figure: walking on `ph` (radians), or braced (feet apart, knees a little bent). */
  private legs(team: number, ph: number, walking: boolean, drop: number, brace = 0.16) {
    const yawQ = this.yawQ, base = this.base;
    const [hip, knee, ankle] = this.joints;
    const bob = walking ? Math.abs(Math.cos(ph)) * 0.035 : 0;
    for (let side = 1; side >= -1; side -= 2) {
      const sw = walking ? Math.sin(ph + (side > 0 ? 0 : Math.PI)) : 0;
      const a = walking ? sw * 0.42 : side > 0 ? brace : -brace * 0.7;
      const bend = walking ? Math.max(0, Math.cos(ph + (side > 0 ? 0 : Math.PI))) * 0.65 : 0.12 + drop * 2;
      hip.set(side * 0.1, 0.9 + bob - drop, 0);
      knee.set(0, -Math.cos(a), Math.sin(a)).multiplyScalar(0.42).add(hip);
      ankle.set(0, -Math.cos(a - bend), Math.sin(a - bend)).multiplyScalar(0.4).add(knee);
      this.segment(side > 0 ? THIGH_L : THIGH_R, hip, knee, yawQ, base, team);
      this.segment(side > 0 ? SHIN_L : SHIN_R, knee, ankle, yawQ, base, team);
    }
    return bob;
  }

  /** Pelvis, torso and head, the torso leaning forward by `lean`. */
  private trunk(team: number, y: number, lean: number) {
    const yawQ = this.yawQ, base = this.base;
    _q2.setFromAxisAngle(_z, Math.PI / 2);
    _q.copy(yawQ).multiply(_q2);
    _p.set(0, 0.97 + y, 0).applyQuaternion(yawQ).add(base);
    this.put(PELVIS, _p, _q, team);
    _q2.setFromAxisAngle(_x, lean);
    _q.copy(yawQ).multiply(_q2);
    _p.set(0, 1.27 + y, 0.01 + lean * 0.12).applyQuaternion(yawQ).add(base);
    this.put(TORSO, _p, _q, team);
    _p.set(0, 1.62 + y - lean * 0.05, 0.04 + lean * 0.33).applyQuaternion(yawQ).add(base);
    this.put(HEAD, _p, yawQ, team);
  }

  /** One arm from the shoulder to a hand (minion space), bending down and out. */
  private arm(team: number, side: number, shoulder: THREE.Vector3, hand: THREE.Vector3, elbow: THREE.Vector3) {
    this.elbowFor(shoulder, hand, side, elbow);
    this.segment(side > 0 ? UARM_L : UARM_R, shoulder, elbow, this.yawQ, this.base, team);
    this.segment(side > 0 ? LARM_L : LARM_R, elbow, hand, this.yawQ, this.base, team);
  }

  /**
   * A mason: a cloth cap and a leather apron over his tabard, a mallet in his
   * right hand. At work he holds a chisel to the stone with his left and
   * swings the mallet up and down onto it once a stroke.
   */
  private drawMason(team: number, action: number, act: number, ph: number) {
    this.dress = 1;
    const [, , , sh, elbow, hand] = this.joints;
    const working = action === WORK;
    const walking = action === 0;
    const drop = working ? 0.05 : 0;
    const bob = this.legs(team, ph, walking, drop, 0.22);
    const lean = working ? 0.2 : walking ? 0.07 : 0.03;
    // Left arm: the chisel to the stone at work, a swing on the walk.
    sh.set(0.25, 1.44 + bob - drop, lean * 0.3);
    if (working) hand.set(0.06, 1.18 - drop, 0.46);
    else {
      const sw = walking ? -Math.sin(ph) * 0.3 : 0.05;
      hand.set(0.27, 0.95 + bob, Math.sin(sw) * 0.35);
    }
    this.arm(team, 1, sh, hand, elbow);
    // Right arm: the mallet, raised and brought down on the chisel.
    sh.set(-0.25, 1.44 + bob - drop, lean * 0.3);
    let a: number;
    if (!working) a = walking ? 0.25 + Math.sin(ph) * 0.25 : 0.3;
    else {
      const t = act % MALLET_STROKE;
      if (t < 9) a = 1.15 + (t / 9) * 1.35;
      else if (t < MALLET_HIT) a = 2.5 - ((t - 9) / (MALLET_HIT - 9)) * 1.65;
      else a = 0.85 + Math.min(1, (t - MALLET_HIT) / (MALLET_STROKE - MALLET_HIT)) * 0.3;
    }
    hand.set(-0.2, sh.y - Math.cos(a) * 0.47, sh.z + Math.sin(a) * 0.47);
    this.arm(team, -1, sh, hand, elbow);
    this.tool(this.mallet, hand, elbow, working ? -0.5 : 0.25);
    this.trunk(team, bob - drop, lean);
    this.dress = 0;
  }

  /** A crewman with the ladder on his right shoulder (walking), or both hands up pushing it as it rises. */
  private drawCarrier(team: number, action: number, ph: number) {
    const [, , , sh, elbow, hand] = this.joints;
    const raising = action === RAISE;
    const bob = this.legs(team, ph, !raising, raising ? 0.06 : 0, 0.28);
    const lean = raising ? 0.12 : 0.08;
    for (let side = 1; side >= -1; side -= 2) {
      sh.set(side * 0.25, 1.44 + bob, lean * 0.3);
      if (raising) hand.set(side * 0.18, 2.02, 0.32);
      else hand.set(side > 0 ? -0.06 : -0.3, side > 0 ? 1.62 + bob : 1.7 + bob, side > 0 ? 0.08 : 0.02);
      this.arm(team, side, sh, hand, elbow);
    }
    this.trunk(team, bob, lean);
  }

  /** On a ladder or the rope inside: facing the wall, hands up on the rails, a knee raised in turn; a pikeman's pike slung across his back. */
  private drawClimber(team: number, unit: number, ph: number) {
    const yawQ = this.yawQ, base = this.base;
    const [hip, knee, ankle, sh, elbow, hand] = this.joints;
    const s = Math.sin(ph);
    for (let side = 1; side >= -1; side -= 2) {
      const up = Math.max(0, s * side);
      hip.set(side * 0.1, 0.9, -0.04);
      knee.set(side * 0.02, -0.42 + up * 0.32, 0.12 + up * 0.22).add(hip);
      ankle.set(side * 0.01, -0.4 + up * 0.08, -0.06 + up * 0.04).add(knee);
      this.segment(side > 0 ? THIGH_L : THIGH_R, hip, knee, yawQ, base, team);
      this.segment(side > 0 ? SHIN_L : SHIN_R, knee, ankle, yawQ, base, team);
      sh.set(side * 0.24, 1.44, 0.06);
      hand.set(side * 0.2, 1.78 + 0.16 * Math.max(0, -s * side), 0.3);
      this.arm(team, side, sh, hand, elbow);
    }
    this.trunk(team, 0, 0.22);
    if (unit !== CREW && this.nPike < MAX_PIKES) {
      // The pike across his back, butt low on the right, point up past his left shoulder.
      _d.set(0.32, 0.94, -0.08).normalize();
      _q2.setFromUnitVectors(_y, _d);
      _q.copy(yawQ).multiply(_q2);
      _a.set(-0.42, 0.25, -0.2).applyQuaternion(yawQ).add(base);
      _m.compose(_a, _q, _one);
      this.pike.setMatrixAt(this.nPike++, _m);
    }
  }

  /** A crewman fighting with his axe: feet braced, a chop at each blow (act counts ticks since it began). */
  private drawAxeman(team: number, act: number) {
    const [, , , sh, elbow, hand] = this.joints;
    const bob = this.legs(team, 0, false, 0.06, 0.3);
    const t = act / THRUST;
    const a = t >= 1 ? 1.2 : t < 0.3 ? 1.2 + (t / 0.3) * 1.5 : 2.7 - ((t - 0.3) / 0.7) * 2.1;
    sh.set(0.25, 1.4 + bob, 0.05);
    hand.set(0.22, 1.12, 0.3);
    this.arm(team, 1, sh, hand, elbow);
    sh.set(-0.25, 1.4 + bob, 0.05);
    hand.set(-0.16, sh.y - Math.cos(a) * 0.5, sh.z + Math.sin(a) * 0.5);
    this.arm(team, -1, sh, hand, elbow);
    this.tool(this.axe, hand, elbow, -0.35);
    this.trunk(team, bob - 0.06, 0.18);
  }

  /** One ragdoll part from a parts array at offset o (with gore, a severed limb is left out and its stump capped). */
  private putPart(parts: Float32Array, o: number) {
    const id = parts[o] | 0;
    const part = parts[o + 1] | 0;
    if (part < 0 || part >= NPARTS || parts[o + 2] !== parts[o + 2]) return;
    const team = this.teamOf.get(id) ?? 0;
    this.dress = this.unitOf.get(id) === MASON ? 1 : 0;
    _p.set(parts[o + 2], parts[o + 3], parts[o + 4]);
    _q.set(parts[o + 5], parts[o + 6], parts[o + 7], parts[o + 8]);
    const cut = this.gore ? this.severed.get(id) : undefined;
    if (cut && (part === UARM_L + cut.limb * 2 || part === UARM_L + cut.limb * 2 + 1)) {
      if (part === UARM_L + cut.limb * 2) {
        // Stump cap where the limb joined the body.
        _a.set(0, cut.sign * MINION_PARTS[part].half, 0).applyQuaternion(_q).add(_p);
        this.putStump(_a, _q, MINION_PARTS[part].radius);
      }
      this.dress = 0;
      return;
    }
    this.put(part, _p, _q, team);
    this.dress = 0;
  }

  /** Rewrite the fallen, which come first in every mesh. */
  private drawFrozen() {
    this.counts.fill(0);
    this.nStump = 0;
    this.nHelmet = 0;
    for (const body of this.frozen.values()) for (let k = 0; k < NPARTS; k++) this.putPart(body, k * PART_STRIDE);
    this.frozenCounts.set(this.counts);
    this.frozenStumps = this.nStump;
    this.frozenHelmets = this.nHelmet;
    this.frozenDirty = false;
  }

  /**
   * A pikeman with his pike levelled at an enemy or a gate: feet apart, left
   * foot forward, both hands on the shaft, and a thrust that drives the pike
   * out and back at each blow (`act` counts ticks since the blow began).
   */
  private drawLevelled(team: number, act: number, gate: boolean) {
    const yawQ = this.yawQ, base = this.base;
    const [hip, knee, ankle, sh, elbow, hand] = this.joints;
    const t = act / THRUST;
    const thrust = t >= 1 ? 0 : (t < 0.23 ? t / 0.23 : 1 - (t - 0.23) / 0.77) * (gate ? 0.6 : 0.5);
    const lean = 0.16 + thrust * 0.25;
    const drop = 0.05 + thrust * 0.05;
    for (let side = 1; side >= -1; side -= 2) {
      const a = side > 0 ? 0.32 : -0.24;
      const bend = side > 0 ? 0.32 : 0.12;
      hip.set(side * 0.11, 0.9 - drop, 0);
      knee.set(0, -Math.cos(a), Math.sin(a)).multiplyScalar(0.42).add(hip);
      ankle.set(0, -Math.cos(a - bend), Math.sin(a - bend)).multiplyScalar(0.4).add(knee);
      this.segment(side > 0 ? THIGH_L : THIGH_R, hip, knee, yawQ, base, team);
      this.segment(side > 0 ? SHIN_L : SHIN_R, knee, ankle, yawQ, base, team);
    }
    // The shaft runs along the right side, rising a little towards the head: rear hand at the hip, front hand ahead.
    const shaftX = -0.16;
    const rearZ = -0.05 + thrust * 0.75, frontZ = 0.42 + thrust * 0.75;
    const rearY = (gate ? 1.0 : 1.05) - drop, frontY = (gate ? 1.08 : 1.16) - drop;
    for (let side = 1; side >= -1; side -= 2) {
      sh.set(side * 0.25, 1.44 - drop, lean * 0.35);
      hand.set(shaftX + (side > 0 ? 0.04 : 0), side > 0 ? frontY : rearY, side > 0 ? frontZ : rearZ);
      this.elbowFor(sh, hand, side, elbow);
      this.segment(side > 0 ? UARM_L : UARM_R, sh, elbow, yawQ, base, team);
      this.segment(side > 0 ? LARM_L : LARM_R, elbow, hand, yawQ, base, team);
    }
    if (this.nPike < MAX_PIKES) {
      // The butt sits a metre behind the rear hand, the shaft through both hands.
      _d.set(0, frontY - rearY, frontZ - rearZ).normalize();
      _a.set(shaftX, rearY, rearZ).addScaledVector(_d, -1.0);
      _q2.setFromUnitVectors(_y, _d);
      _q.copy(yawQ).multiply(_q2);
      _a.applyQuaternion(yawQ).add(base);
      _m.compose(_a, _q, _one);
      this.pike.setMatrixAt(this.nPike++, _m);
    }
    _q2.setFromAxisAngle(_z, Math.PI / 2);
    _q.copy(yawQ).multiply(_q2);
    _p.set(0, 0.97 - drop, 0).applyQuaternion(yawQ).add(base);
    this.put(PELVIS, _p, _q, team);
    _q2.setFromAxisAngle(_x, lean);
    _q.copy(yawQ).multiply(_q2);
    _p.set(0, 1.27 - drop, 0.04 + lean * 0.12).applyQuaternion(yawQ).add(base);
    this.put(TORSO, _p, _q, team);
    _p.set(0, 1.6 - drop, 0.08 + lean * 0.3).applyQuaternion(yawQ).add(base);
    this.put(HEAD, _p, yawQ, team);
  }

  /** Two-bone arm: where the elbow goes for a hand at `hand` (minion space), bending down and out. */
  private elbowFor(shoulder: THREE.Vector3, hand: THREE.Vector3, side: number, out: THREE.Vector3) {
    const L1 = 0.27, L2 = 0.25;
    _b.copy(hand).sub(shoulder);
    let d = _b.length();
    if (d > L1 + L2 - 0.005) {
      // Out of reach: straight arm towards the hand (the hand is drawn where the arm ends).
      _b.multiplyScalar((L1 + L2 - 0.005) / d);
      hand.copy(shoulder).add(_b);
      d = L1 + L2 - 0.005;
    }
    const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    _b.normalize();
    // Bend direction: down and outward, square to the arm.
    _d.set(side * 0.6, -1, -0.15);
    _d.addScaledVector(_b, -_d.dot(_b)).normalize();
    out.copy(shoulder).addScaledVector(_b, along).addScaledVector(_d, h);
  }

  /** Forget the team of every minion (after a reset). */
  clear() {
    this.teamOf.clear();
    this.unitOf.clear();
    this.severed.clear();
    this.frozen.clear();
    this.frozenCounts.fill(0);
    this.frozenStumps = 0;
    this.frozenHelmets = 0;
    this.frozenDirty = false;
    this.limbs = [];
    this.nextLimb = 0;
    this.lastPartCount = 0;
    this.baseCounts.fill(0);
    this.baseStumps = 0;
    this.stumps.count = 0;
    for (const m of this.parts) m.count = 0;
    this.helmet.count = 0;
    this.pike.count = 0;
    this.mallet.count = this.axe.count = this.cap.count = 0;
  }

  dispose() {
    for (const m of [...this.parts, this.helmet, this.pike, this.stumps, this.mallet, this.axe, this.cap]) m.geometry.dispose();
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
