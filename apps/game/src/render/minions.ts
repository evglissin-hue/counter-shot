// Minions: a low-detail human figure built from the ragdoll's own capsules
// (MINION_PARTS) plus a kettle helmet and each unit's kit (a pike, a mason's
// mallet and cap and apron, a crewman's axe, a sapper's keg, a musketeer's
// musket and ramrod). Upright minions are posed by the rig (minionRig.ts)
// every rendered frame from what they are doing: a walk whose stride follows
// their real speed, idle life, fights with a wind-up, a thrust and a parry,
// masons' strokes, ladders carried, raised and climbed, kegs set, muskets
// fired and reloaded. Ragdolls take each part's transform from the sim,
// carried on a little between frames; a man knocked down starts his fall
// from the pose he had and drops what he held. The fallen arrive once, when
// they freeze, and are kept until they move again or sink away, so a field
// of bodies costs nothing per frame. One instanced mesh per part shape,
// colours per instance (team tabard, cloth, skin).
//
// Gore (cosmetic only, the sim never knows): a heavy hit can take off an arm
// or a leg of a ragdoll. The renderer hides that limb's two parts, caps the
// stump and throws a loose copy of the limb that falls, tumbles and settles
// with simple kinematics.

import * as THREE from "three/webgpu";
import { EVENT_STRIDE, EventKind, MINION_PARTS, MINION_STRIDE, PART_STRIDE, type FrameData } from "@keepfall/sim";
import { mergeGeometries } from "./geometry";
import {
  HEAD,
  LARM_L,
  MASON,
  POWDER_BOY,
  MUSKETEER,
  NPARTS,
  PELVIS,
  PIKEMAN,
  Rig,
  SAPPER,
  SHOW_KEG,
  SHOW_KIT,
  SHOW_ROD,
  THIGH_L,
  THIGH_R,
  TORSO,
  UARM_L,
  XF_HEAD_GEAR,
  XF_KEG,
  XF_KIT,
  XF_N,
  XF_ROD,
  XF_STRIDE,
  hash01,
  type FigureSink,
} from "./minionRig";
import { applyCloudShadow } from "./clouds";

/** Figures drawn at once: upright, falling and the fallen (the sim keeps at most 240 bodies). */
const MAX_FIGURES = 640;
const MAX_PIKES = 400;
const MAX_LIMBS = 32;
const CAPACITY = MAX_FIGURES + MAX_LIMBS;
const MAX_TOOLS = 160;
const MAX_KIT = 200;
/** Kit dropped by the fallen (pikes, muskets, axes, mallets, unlit kegs). */
const MAX_DROPS = 128;
/** Seconds a falling man takes to go from his last pose to the ragdoll's. */
const HANDOFF = 0.3;
/** Seconds dropped kit lies on the field before it sinks away (sooner if its owner's body goes). */
const DROP_LIFE = 150;
const APRON = 0x5b3f29;
const STUMP = 0x2b0d0a;
const DROP_PIKE = 0, DROP_MUSKET = 1, DROP_AXE = 2, DROP_MALLET = 3, DROP_KEG = 4;

/** Tabard colours: team 0 sickly yellow-green (the attackers' accent), team 1 Ashwright oxblood. */
export const TEAM_COLORS = [0x93a524, 0x7a1519];
const TEAM = TEAM_COLORS;
const CLOTH = 0x4a443b;
const LEGS = 0x2c2925;
const SKINS = [0x8c6d58, 0x7d604c, 0x957563];
const IRON = 0x3b3b39;
const POLE = 0x4f4840;

/** Linear RGB of an sRGB hex colour (what setColorAt would store). */
function lin(hex: number): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
const C_TEAM = TEAM.map(lin);
const C_CLOTH = lin(CLOTH);
const C_LEGS = lin(LEGS);
const C_SKIN = SKINS.map(lin);
const C_APRON = lin(APRON);
/** A powder boy's plain smock: undyed linen over his body and thighs. */
const C_SMOCK = lin(0xcbbf9f);
/** How a unit is dressed: 1 a mason (apron, cap), 2 a powder boy (smock, cap), 0 a soldier (helmet). */
function dressOf(unit: number | undefined): number {
  return unit === MASON ? 1 : unit === POWDER_BOY ? 2 : 0;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Write a matrix from position, rotation (unit quaternion) and scale at instance k. */
function writeMat(a: Float32Array, k: number, px: number, py: number, pz: number, x: number, y: number, z: number, w: number, sx: number, sy: number, sz: number) {
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  const e = k * 16;
  a[e] = (1 - (yy + zz)) * sx;
  a[e + 1] = (xy + wz) * sx;
  a[e + 2] = (xz - wy) * sx;
  a[e + 3] = 0;
  a[e + 4] = (xy - wz) * sy;
  a[e + 5] = (1 - (xx + zz)) * sy;
  a[e + 6] = (yz + wx) * sy;
  a[e + 7] = 0;
  a[e + 8] = (xz + wy) * sz;
  a[e + 9] = (yz - wx) * sz;
  a[e + 10] = (1 - (xx + yy)) * sz;
  a[e + 11] = 0;
  a[e + 12] = px;
  a[e + 13] = py;
  a[e + 14] = pz;
  a[e + 15] = 1;
}
/** writeMat from a rig transform (x, y, z, qx, qy, qz, qw, sx, sy, sz) at X[o]. */
function writeXf(a: Float32Array, k: number, X: Float32Array, o: number) {
  writeMat(a, k, X[o], X[o + 1], X[o + 2], X[o + 3], X[o + 4], X[o + 5], X[o + 6], X[o + 7], X[o + 8], X[o + 9]);
}

/** A falling body's parts as the sim sent them, for drawing between frames and for its first moments (starting from the upright pose). */
interface Body {
  id: number;
  /** Per part: x, y, z, qx, qy, qz, qw (this frame and the one before). */
  cur: Float32Array;
  prev: Float32Array;
  hasPrev: boolean;
  /** Seconds between prev and cur. */
  dt: number;
  seen: number;
  /** Created this frame (a knock-down, or a frozen body hit again). */
  fresh: boolean;
  /** When it went over from upright (anim time; -1: no hand-off), and per part the offset, rotation and scale it started from. */
  hand: number;
  off: Float32Array;
  dq: Float32Array;
  sc: Float32Array;
}

/** Fields of a captured drop and limb (Float64 each). */
const DROP_FIELDS = 20;
const LIMB_FIELDS = 32;

/** What the figures remember between frames, for a keyframe (see Minions.captureState). */
export interface MinionsState {
  frozen: Map<number, Float32Array>;
  teamOf: Map<number, number>;
  unitOf: Map<number, number>;
  severed: Map<number, number[]>;
  kegless: number[];
  drops: Float64Array[];
  nextDrop: number;
  limbs: Float64Array[];
  nextLimb: number;
  lastParts: Float32Array;
  /** The figures' own clock (seconds): their idle sway, breath and a fallen man's last pose go by it. */
  time: number;
}

/** A piece of kit lying where it fell (a two-point stick, verlet). */
interface Drop {
  on: boolean;
  kind: number;
  owner: number;
  len: number;
  r: number;
  /** Its two ends: x, y, z, vx, vy, vz each. */
  a: Float32Array;
  b: Float32Array;
  age: number;
  still: number;
  sinkAt: number;
}

export class Minions implements FigureSink {
  readonly root = new THREE.Group();
  private parts: THREE.InstancedMesh[] = [];
  private helmet: THREE.InstancedMesh;
  private pike: THREE.InstancedMesh;
  /** Masons' mallets, ladder crews' and sappers' axes, and masons' caps. */
  private mallet: THREE.InstancedMesh;
  private axe: THREE.InstancedMesh;
  private cap: THREE.InstancedMesh;
  private nMallet = 0;
  private nAxe = 0;
  private nCap = 0;
  private counts = new Int32Array(NPARTS);
  private teamOf = new Map<number, number>();
  /** The unit kind of every minion seen upright (so a fallen mason still wears his cap and apron). */
  private unitOf = new Map<number, number>();
  private nHelmet = 0;
  private nPike = 0;
  private stumps: THREE.InstancedMesh;
  private nStump = 0;
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
  private frozenCaps = 0;
  // M3: a sapper's keg on his shoulder, a musketeer's musket and ramrod.
  private keg: THREE.InstancedMesh;
  private musket: THREE.InstancedMesh;
  private rod: THREE.InstancedMesh;
  private nKeg = 0;
  private nMusket = 0;
  private nRod = 0;
  /** The pose of every upright figure. */
  readonly rig = new Rig();
  /** Falling bodies by minion id, and spare ones. */
  private bodies = new Map<number, Body>();
  /** The same, as a list (drawn every frame without iterating the map). */
  private bodyList: Body[] = [];
  private spare: Body[] = [];
  private frameNo = 0;
  private drops: Drop[] = [];
  private nextDrop = 0;
  /** Time spent posing and drawing (ms, smoothed), for tests and the HUD. */
  cost = 0;

  constructor() {
    this.root.name = "minions";
    const mat = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(mat);
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
    applyCloudShadow(iron);
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
    applyCloudShadow(pm);
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
    applyCloudShadow(sm);
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
    // M3: a powder keg (black staves, two iron hoops; its axis along local X) and a musket (barrel and stock along local +Z from the butt).
    const staves = new THREE.CylinderGeometry(0.2, 0.2, 0.46, 10, 1);
    staves.deleteAttribute("uv");
    const bulge = new THREE.SphereGeometry(0.23, 10, 6);
    bulge.deleteAttribute("uv");
    bulge.scale(1, 0.95, 1);
    const hoopA = new THREE.TorusGeometry(0.215, 0.018, 4, 12);
    hoopA.deleteAttribute("uv");
    hoopA.rotateX(Math.PI / 2);
    hoopA.translate(0, 0.15, 0);
    const hoopB = hoopA.clone();
    hoopB.translate(0, -0.3, 0);
    const kegGeo = mergeGeometries([staves, bulge, hoopA, hoopB]);
    kegGeo.rotateZ(Math.PI / 2);
    const kegMat = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(kegMat);
    kegMat.name = "minion-keg";
    kegMat.color = new THREE.Color(0x231c15);
    kegMat.roughness = 0.75;
    this.keg = new THREE.InstancedMesh(kegGeo, kegMat, MAX_KIT);
    this.keg.name = "minion-keg";
    this.keg.count = 0;
    this.keg.frustumCulled = false;
    this.keg.castShadow = true;
    const tube = new THREE.CylinderGeometry(0.014, 0.018, 1.15, 6, 1);
    tube.deleteAttribute("uv");
    tube.rotateX(Math.PI / 2);
    tube.translate(0, 0.035, 0.85);
    const stock = new THREE.BoxGeometry(0.05, 0.11, 0.55);
    stock.deleteAttribute("uv");
    stock.translate(0, 0, 0.27);
    const lock = new THREE.BoxGeometry(0.035, 0.05, 0.1);
    lock.deleteAttribute("uv");
    lock.translate(0.03, 0.04, 0.52);
    const musketGeo = mergeGeometries([tube, stock, lock]);
    const musketMat = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(musketMat);
    musketMat.name = "minion-musket";
    musketMat.color = new THREE.Color(0x3a2f26);
    musketMat.roughness = 0.6;
    musketMat.metalness = 0.25;
    this.musket = new THREE.InstancedMesh(musketGeo, musketMat, MAX_KIT);
    this.musket.name = "minion-musket";
    this.musket.count = 0;
    this.musket.frustumCulled = false;
    this.musket.castShadow = true;
    // The ramrod: a thin iron rod a metre long (local +Y from its lower end), out only while he loads.
    const rodGeo = new THREE.CylinderGeometry(0.006, 0.006, 1.0, 4, 1);
    rodGeo.deleteAttribute("uv");
    rodGeo.translate(0, 0.5, 0);
    this.rod = new THREE.InstancedMesh(rodGeo, iron, MAX_KIT);
    this.rod.name = "minion-ramrod";
    this.rod.count = 0;
    this.rod.frustumCulled = false;
    this.root.add(this.keg, this.musket, this.rod);
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push({ on: false, kind: 0, owner: -1, len: 1, r: 0.03, a: new Float32Array(6), b: new Float32Array(6), age: 0, still: 0, sinkAt: -1 });
  }

  /** M3: a sapper set his keg against the wall: draw him without it from now on. */
  kegSet(id: number) {
    this.rig.kegless.add(id);
  }

  /** M3: where an upright minion stood in the last frame, and its yaw (for a musket's flash), or null. */
  positionOf(id: number): [number, number, number, number] | null {
    const s = this.rig.slot(id);
    if (s < 0) return null;
    const r = this.rig;
    return [r.px[s], r.py[s], r.pz[s], r.yaw[s]];
  }

  /** Draw the stump caps, helmets and kit once out of sight, so their shaders compile while loading, not at the first severed limb. */
  prime(on: boolean) {
    for (const mesh of [this.stumps, this.helmet, this.mallet, this.axe, this.cap, this.keg, this.musket, this.rod]) {
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

  // --- per sim frame -------------------------------------------------------------------

  /** One sim frame: upright figures, moving bodies, and the fallen that froze or left since the last one. */
  update(f: Pick<FrameData, "tick" | "minions" | "minionCount" | "parts" | "partCount" | "settled" | "settledCount" | "gone"> & Partial<Pick<FrameData, "events" | "eventCount">>) {
    const { minions, minionCount, parts, partCount, settled, settledCount, gone } = f;
    const rig = this.rig;
    this.frameNo++;
    // The fallen: who left, who moves again, who froze.
    for (let i = 0; i < gone.length; i++) {
      const id = gone[i];
      if (this.frozen.delete(id)) this.frozenDirty = true;
      this.teamOf.delete(id);
      this.unitOf.delete(id);
      this.severed.delete(id);
      for (const d of this.drops) if (d.on && d.owner === id && d.sinkAt < 0) d.sinkAt = rig.time;
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
    // Upright figures into the rig.
    rig.begin(f.tick ?? 0);
    const n = Math.min(minionCount | 0, MAX_FIGURES);
    for (let i = 0; i < n; i++) {
      const o = i * MINION_STRIDE;
      const id = minions[o] | 0;
      const team = minions[o + 6] | 0;
      const unit = minions[o + 9] | 0;
      this.teamOf.set(id, team);
      if (unit) this.unitOf.set(id, unit);
      rig.take(id, minions[o + 1], minions[o + 2], minions[o + 3], minions[o + 4], minions[o + 5], team, minions[o + 7] | 0, minions[o + 8], unit);
    }
    rig.end();
    // Moving bodies: this frame's parts, the last frame's kept for drawing between them.
    for (let i = 0; i < np; i++) {
      const o = i * PART_STRIDE;
      const id = parts[o] | 0, part = parts[o + 1] | 0;
      if (part < 0 || part >= NPARTS || parts[o + 2] !== parts[o + 2]) continue;
      let b = this.bodies.get(id);
      if (!b) {
        b = this.spare.pop() ?? newBody();
        b.id = id;
        b.seen = -1;
        b.hasPrev = false;
        b.hand = -1;
        b.fresh = true;
        b.cur.fill(NaN);
        this.bodies.set(id, b);
      }
      if (b.seen !== this.frameNo) {
        if (b.seen === this.frameNo - 1) {
          b.prev.set(b.cur);
          b.hasPrev = true;
          b.dt = rig.frameSeconds;
        } else b.hasPrev = false;
        b.seen = this.frameNo;
      }
      const c = part * 7;
      for (let k = 0; k < 7; k++) b.cur[c + k] = parts[o + 2 + k];
    }
    this.bodyList.length = 0;
    for (const b of this.bodies.values()) {
      if (b.seen !== this.frameNo) {
        this.bodies.delete(b.id);
        this.spare.push(b);
        continue;
      }
      this.bodyList.push(b);
      if (b.fresh) {
        b.fresh = false;
        this.handOff(b, f);
      }
    }
    rig.sweep();
    if (this.lastParts.length < np * PART_STRIDE) this.lastParts = new Float32Array(np * PART_STRIDE * 2);
    this.lastParts.set(parts.subarray(0, np * PART_STRIDE));
    this.lastPartCount = np;
    if (this.frozenDirty) this.drawFrozen();
  }

  /** A man just knocked down: his fall starts from the pose he had, and what he held falls from his hands. */
  private handOff(b: Body, f: Partial<Pick<FrameData, "events" | "eventCount">>) {
    const rig = this.rig;
    const s = rig.slot(b.id);
    if (s < 0 || !rig.drawn[s]) return;
    const X = rig.xf, xo = s * XF_N;
    for (let p = 0; p < NPARTS; p++) {
      const c = p * 7, x = xo + p * XF_STRIDE;
      if (b.cur[c] !== b.cur[c]) {
        b.off.fill(0, p * 3, p * 3 + 3);
        b.dq.fill(0, p * 4, p * 4 + 3);
        b.dq[p * 4 + 3] = 1;
        b.sc.fill(1, p * 3, p * 3 + 3);
        continue;
      }
      b.off[p * 3] = X[x] - b.cur[c];
      b.off[p * 3 + 1] = X[x + 1] - b.cur[c + 1];
      b.off[p * 3 + 2] = X[x + 2] - b.cur[c + 2];
      // dq = q_upright * conj(q_ragdoll).
      const ax = X[x + 3], ay = X[x + 4], az = X[x + 5], aw = X[x + 6];
      const bx = -b.cur[c + 3], by = -b.cur[c + 4], bz = -b.cur[c + 5], bw = b.cur[c + 6];
      let qx = aw * bx + ax * bw + ay * bz - az * by;
      let qy = aw * by - ax * bz + ay * bw + az * bx;
      let qz = aw * bz + ax * by - ay * bx + az * bw;
      let qw = aw * bw - ax * bx - ay * by - az * bz;
      if (qw < 0) {
        qx = -qx;
        qy = -qy;
        qz = -qz;
        qw = -qw;
      }
      b.dq[p * 4] = qx;
      b.dq[p * 4 + 1] = qy;
      b.dq[p * 4 + 2] = qz;
      b.dq[p * 4 + 3] = qw;
      b.sc[p * 3] = X[x + 7];
      b.sc[p * 3 + 1] = X[x + 8];
      b.sc[p * 3 + 2] = X[x + 9];
    }
    b.hand = rig.time;
    // His kit falls: the pike, musket, axe or mallet; a sapper's keg unless it went off with him.
    const shows = rig.shows[s];
    const unit = rig.unit[s];
    const vx = rig.svx[s], vz = rig.svz[s];
    if (shows & SHOW_KIT) {
      const kind = unit === PIKEMAN ? DROP_PIKE : unit === MUSKETEER ? DROP_MUSKET : unit === MASON ? DROP_MALLET : DROP_AXE;
      this.drop(kind, b.id, X, xo + XF_KIT, vx, vz);
    }
    if (shows & SHOW_KEG && (unit === SAPPER || unit === POWDER_BOY)) {
      let burst = false;
      const ev = f.events, ne = f.eventCount ?? 0;
      if (ev) {
        for (let i = 0; i < ne; i++) {
          const o = i * EVENT_STRIDE;
          if (ev[o] !== EventKind.Explosion) continue;
          const dx = ev[o + 1] - rig.px[s], dz = ev[o + 3] - rig.pz[s];
          if (dx * dx + dz * dz < 9) burst = true;
        }
      }
      if (!burst) this.drop(DROP_KEG, b.id, X, xo + XF_KEG, vx, vz);
    }
  }

  /** Let a piece of kit fall from its transform at X[o], with the man's speed and a toss of its own. */
  private drop(kind: number, owner: number, X: Float32Array, o: number, vx: number, vz: number) {
    const d = this.drops[this.nextDrop];
    this.nextDrop = (this.nextDrop + 1) % MAX_DROPS;
    d.on = true;
    d.kind = kind;
    d.owner = owner;
    d.age = 0;
    d.still = 0;
    d.sinkAt = -1;
    d.len = kind === DROP_PIKE ? 4.52 : kind === DROP_MUSKET ? 1.43 : kind === DROP_AXE ? 0.74 : kind === DROP_MALLET ? 0.42 : 0.46;
    d.r = kind === DROP_KEG ? 0.22 : kind === DROP_MUSKET ? 0.04 : kind === DROP_MALLET ? 0.05 : 0.028;
    _q.set(X[o + 3], X[o + 4], X[o + 5], X[o + 6]);
    if (kind === DROP_MUSKET) _d.set(0, 0, 1);
    else if (kind === DROP_KEG) _d.set(1, 0, 0);
    else _d.set(0, 1, 0);
    _d.applyQuaternion(_q);
    // The keg's anchor is its middle; the rest hang from one end.
    const k = kind === DROP_KEG ? -0.5 : 0;
    const ax = X[o] + _d.x * d.len * k, ay = X[o + 1] + _d.y * d.len * k, az = X[o + 2] + _d.z * d.len * k;
    const h = hash01(owner, 31) - 0.5, h2 = hash01(owner, 32) - 0.5;
    // The man's speed, a little up, and the far end pushed sideways so it topples.
    const tx = vx + h * 1.2, tz = vz + h2 * 1.2;
    const A = d.a, B = d.b;
    A[0] = ax;
    A[1] = ay;
    A[2] = az;
    A[3] = tx;
    A[4] = 0.6;
    A[5] = tz;
    B[0] = ax + _d.x * d.len;
    B[1] = ay + _d.y * d.len;
    B[2] = az + _d.z * d.len;
    B[3] = tx + h2 * 1.5;
    B[4] = 0;
    B[5] = tz - h * 1.5;
  }

  // --- per rendered frame ---------------------------------------------------------------

  /** Advance the figures, the falling bodies, dropped kit and loose limbs, and draw them (every rendered frame). */
  step(dt: number, height: (x: number, z: number) => number, camera?: THREE.PerspectiveCamera) {
    const t0 = performance.now();
    this.counts.set(this.frozenCounts);
    this.nStump = this.frozenStumps;
    this.nHelmet = this.frozenHelmets;
    this.nCap = this.frozenCaps;
    this.nPike = this.nKeg = this.nMusket = this.nRod = this.nMallet = this.nAxe = 0;
    // Upright figures.
    const cam = camera?.position;
    const zoom = camera ? Math.tan((camera.fov * Math.PI) / 360) / Math.max(0.2, camera.zoom || 1) : 0.577;
    this.rig.animate(dt, height, cam ? cam.x : 0, cam ? cam.y : 1e4, cam ? cam.z : 0, zoom, this);
    // Bodies falling, between sim frames.
    this.drawBodies();
    // Dropped kit.
    this.stepDrops(dt, height);
    // Loose limbs.
    this.stepLimbs(dt, height);
    this.flush();
    this.cost = this.cost * 0.9 + (performance.now() - t0) * 0.1;
  }

  /** The rig's output for one upright figure: its parts, headgear and kit. */
  figure(s: number, _id: number, team: number, unit: number, shows: number, X: Float32Array, o: number) {
    const dress = dressOf(unit);
    const tint = this.rig.tint(s), skin = this.rig.skin(s);
    for (let p = 0; p < NPARTS; p++) {
      const k = this.counts[p];
      if (k >= CAPACITY) continue;
      this.counts[p] = k + 1;
      const mesh = this.parts[p];
      writeXf(mesh.instanceMatrix.array as Float32Array, k, X, o + p * XF_STRIDE);
      this.paint(mesh, k, p, team, dress, tint, skin);
    }
    const g = o + XF_HEAD_GEAR;
    if (dress) {
      if (this.nCap < MAX_TOOLS) {
        writeXf(this.cap.instanceMatrix.array as Float32Array, this.nCap, X, g);
        this.cap.setColorAt(this.nCap, _c.setHex(TEAM[team & 1]).multiplyScalar(0.75));
        this.nCap++;
      }
    } else if (this.nHelmet < MAX_FIGURES) writeXf(this.helmet.instanceMatrix.array as Float32Array, this.nHelmet++, X, g);
    if (shows & SHOW_KIT) {
      if (unit === PIKEMAN) {
        if (this.nPike < MAX_PIKES) writeXf(this.pike.instanceMatrix.array as Float32Array, this.nPike++, X, o + XF_KIT);
      } else if (unit === MUSKETEER) {
        if (this.nMusket < MAX_KIT) writeXf(this.musket.instanceMatrix.array as Float32Array, this.nMusket++, X, o + XF_KIT);
      } else if (unit === MASON) {
        if (this.nMallet < MAX_TOOLS) writeXf(this.mallet.instanceMatrix.array as Float32Array, this.nMallet++, X, o + XF_KIT);
      } else if (this.nAxe < MAX_TOOLS) writeXf(this.axe.instanceMatrix.array as Float32Array, this.nAxe++, X, o + XF_KIT);
    }
    if (shows & SHOW_KEG && this.nKeg < MAX_KIT) writeXf(this.keg.instanceMatrix.array as Float32Array, this.nKeg++, X, o + XF_KEG);
    if (shows & SHOW_ROD && this.nRod < MAX_KIT) writeXf(this.rod.instanceMatrix.array as Float32Array, this.nRod++, X, o + XF_ROD);
  }

  /** Colour of a part at instance k: the team's tabard, cloth sleeves, dark legs, skin; a mason's apron over hips and thighs. */
  private paint(mesh: THREE.InstancedMesh, k: number, part: number, team: number, dress: number, tint: number, skin: number) {
    let c = C_CLOTH;
    let f = tint;
    if (part === TORSO || part === PELVIS) {
      c = C_TEAM[team & 1];
      f = 1 + (tint - 1) * 0.4;
    } else if (part === HEAD) {
      c = C_SKIN[skin] ?? C_SKIN[0];
      f = 1;
    } else if (part >= THIGH_L) c = C_LEGS;
    if (dress === 1 && (part === PELVIS || part === THIGH_L || part === THIGH_R)) c = C_APRON;
    else if (dress === 2 && (part === TORSO || part === PELVIS || part === THIGH_L || part === THIGH_R)) {
      c = C_SMOCK;
      f = 1 + (tint - 1) * 0.5;
    }
    if (part === PELVIS) f *= 0.8;
    const a = mesh.instanceColor!.array as Float32Array;
    a[k * 3] = c[0] * f;
    a[k * 3 + 1] = c[1] * f;
    a[k * 3 + 2] = c[2] * f;
  }

  /** Falling bodies, carried on along their motion between sim frames; for a man just knocked down, eased out of his last pose. */
  private drawBodies() {
    const rig = this.rig;
    const since = Math.min(rig.since, 0.05);
    for (let i = 0; i < this.bodyList.length; i++) {
      const b = this.bodyList[i];
      const team = this.teamOf.get(b.id) ?? 0;
      const dress = dressOf(this.unitOf.get(b.id));
      const s = b.hasPrev && b.dt > 0 && b.dt < 0.1 ? Math.min(1.5, since / b.dt) : 0;
      let w = 0;
      if (b.hand >= 0) {
        const k = (rig.time - b.hand) / HANDOFF;
        if (k >= 1) b.hand = -1;
        else w = 1 - (k <= 0 ? 0 : k * k * (3 - 2 * k));
      }
      for (let p = 0; p < NPARTS; p++) {
        const c = p * 7, C = b.cur;
        if (C[c] !== C[c]) continue;
        let px = C[c], py = C[c + 1], pz = C[c + 2];
        let qx = C[c + 3], qy = C[c + 4], qz = C[c + 5], qw = C[c + 6];
        if (s > 0) {
          const Pv = b.prev;
          if (Pv[c] === Pv[c]) {
            px += (px - Pv[c]) * s;
            py += (py - Pv[c + 1]) * s;
            pz += (pz - Pv[c + 2]) * s;
            // d = cur * conj(prev), scaled by s (nlerp from identity), then times cur.
            const bx = -Pv[c + 3], by = -Pv[c + 4], bz = -Pv[c + 5], bw = Pv[c + 6];
            let dx = qw * bx + qx * bw + qy * bz - qz * by;
            let dy = qw * by - qx * bz + qy * bw + qz * bx;
            let dz = qw * bz + qx * by - qy * bx + qz * bw;
            let dw = qw * bw - qx * bx - qy * by - qz * bz;
            if (dw < 0) {
              dx = -dx;
              dy = -dy;
              dz = -dz;
              dw = -dw;
            }
            dx *= s;
            dy *= s;
            dz *= s;
            dw = 1 + (dw - 1) * s;
            const l = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw) || 1;
            dx /= l;
            dy /= l;
            dz /= l;
            dw /= l;
            const nx = dw * qx + dx * qw + dy * qz - dz * qy;
            const ny = dw * qy - dx * qz + dy * qw + dz * qx;
            const nz = dw * qz + dx * qy - dy * qx + dz * qw;
            const nw = dw * qw - dx * qx - dy * qy - dz * qz;
            qx = nx;
            qy = ny;
            qz = nz;
            qw = nw;
          }
        }
        let sx = 1, sy = 1, sz = 1;
        if (w > 0) {
          px += b.off[p * 3] * w;
          py += b.off[p * 3 + 1] * w;
          pz += b.off[p * 3 + 2] * w;
          let dx = b.dq[p * 4] * w, dy = b.dq[p * 4 + 1] * w, dz = b.dq[p * 4 + 2] * w, dw = 1 + (b.dq[p * 4 + 3] - 1) * w;
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw) || 1;
          dx /= l;
          dy /= l;
          dz /= l;
          dw /= l;
          const nx = dw * qx + dx * qw + dy * qz - dz * qy;
          const ny = dw * qy - dx * qz + dy * qw + dz * qx;
          const nz = dw * qz + dx * qy - dy * qx + dz * qw;
          const nw = dw * qw - dx * qx - dy * qy - dz * qz;
          qx = nx;
          qy = ny;
          qz = nz;
          qw = nw;
          sx = 1 + (b.sc[p * 3] - 1) * w;
          sy = 1 + (b.sc[p * 3 + 1] - 1) * w;
          sz = 1 + (b.sc[p * 3 + 2] - 1) * w;
        }
        this.drawPart(b.id, p, px, py, pz, qx, qy, qz, qw, sx, sy, sz, team, dress);
      }
    }
  }

  /** One part of a fallen or falling body (with gore, a severed limb is left out and its stump capped). */
  private drawPart(id: number, part: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number, sx: number, sy: number, sz: number, team: number, dress: number) {
    const cut = this.gore ? this.severed.get(id) : undefined;
    if (cut && (part === UARM_L + cut.limb * 2 || part === UARM_L + cut.limb * 2 + 1)) {
      if (part === UARM_L + cut.limb * 2) {
        // Stump cap where the limb joined the body.
        _p.set(px, py, pz);
        _q.set(qx, qy, qz, qw);
        _a.set(0, cut.sign * MINION_PARTS[part].half, 0).applyQuaternion(_q).add(_p);
        this.putStump(_a, _q, MINION_PARTS[part].radius);
      }
      return;
    }
    const k = this.counts[part];
    if (k >= CAPACITY) return;
    this.counts[part] = k + 1;
    const mesh = this.parts[part];
    writeMat(mesh.instanceMatrix.array as Float32Array, k, px, py, pz, qx, qy, qz, qw, sx, sy, sz);
    this.paint(mesh, k, part, team, dress, 1, 0);
    if (part !== HEAD) return;
    // Headgear rides on the head, along the head's own up.
    _q.set(qx, qy, qz, qw);
    _a.set(0, 0.05 * sy, 0).applyQuaternion(_q);
    if (dress) {
      if (this.nCap < MAX_TOOLS) {
        writeMat(this.cap.instanceMatrix.array as Float32Array, this.nCap, px + _a.x, py + _a.y, pz + _a.z, qx, qy, qz, qw, sx, sy, sz);
        this.cap.setColorAt(this.nCap, _c.setHex(TEAM[team & 1]).multiplyScalar(0.75));
        this.nCap++;
      }
    } else if (this.nHelmet < MAX_FIGURES) writeMat(this.helmet.instanceMatrix.array as Float32Array, this.nHelmet++, px + _a.x, py + _a.y, pz + _a.z, qx, qy, qz, qw, sx, sy, sz);
  }

  /** Rewrite the fallen, which come first in every mesh. */
  private drawFrozen() {
    this.counts.fill(0);
    this.nStump = 0;
    this.nHelmet = 0;
    this.nCap = 0;
    for (const [id, body] of this.frozen) {
      const team = this.teamOf.get(id) ?? 0;
      const dress = dressOf(this.unitOf.get(id));
      for (let k = 0; k < NPARTS; k++) {
        const o = k * PART_STRIDE;
        if (body[o + 2] !== body[o + 2]) continue;
        this.drawPart(id, k, body[o + 2], body[o + 3], body[o + 4], body[o + 5], body[o + 6], body[o + 7], body[o + 8], 1, 1, 1, team, dress);
      }
    }
    this.frozenCounts.set(this.counts);
    this.frozenStumps = this.nStump;
    this.frozenHelmets = this.nHelmet;
    this.frozenCaps = this.nCap;
    this.frozenDirty = false;
  }

  /** Kit on the ground: falling as a stick with two ends, toppling, settling; sinking away once old or its owner's body goes. */
  private stepDrops(dt: number, height: (x: number, z: number) => number) {
    const steps = dt <= 0 ? 0 : Math.min(4, Math.ceil(dt * 60 - 1e-6));
    const h = steps ? dt / steps : 0;
    const time = this.rig.time;
    for (const d of this.drops) {
      if (!d.on) continue;
      d.age += dt;
      if (d.sinkAt < 0 && d.age > DROP_LIFE) d.sinkAt = time;
      if (d.sinkAt >= 0 && time - d.sinkAt > 1.5) {
        d.on = false;
        continue;
      }
      if (d.still < 0.4) {
        const A = d.a, B = d.b;
        for (let n = 0; n < steps; n++) {
          fall(A, h);
          fall(B, h);
          // Keep its length: positions, and no stretching speed along it.
          let dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = ((l - d.len) / l) * 0.5;
          A[0] += dx * diff;
          A[1] += dy * diff;
          A[2] += dz * diff;
          B[0] -= dx * diff;
          B[1] -= dy * diff;
          B[2] -= dz * diff;
          dx /= l;
          dy /= l;
          dz /= l;
          const vr = ((B[3] - A[3]) * dx + (B[4] - A[4]) * dy + (B[5] - A[5]) * dz) * 0.5;
          A[3] += dx * vr;
          A[4] += dy * vr;
          A[5] += dz * vr;
          B[3] -= dx * vr;
          B[4] -= dy * vr;
          B[5] -= dz * vr;
          // The ground: no sinking in, a dull bounce and friction while touching.
          const touching = ground(A, d.r, h, height) + ground(B, d.r, h, height);
          const v2 = A[3] * A[3] + A[4] * A[4] + A[5] * A[5] + B[3] * B[3] + B[4] * B[4] + B[5] * B[5];
          if (touching === 2 && v2 < 0.02) d.still += h;
          else d.still = 0;
        }
      }
      // Draw it from its ends.
      const A = d.a, B = d.b;
      let dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      const sink = d.sinkAt >= 0 ? Math.min(1, (time - d.sinkAt) / 1.5) * (d.r * 2 + 0.05) : 0;
      _d.set(dx, dy, dz);
      if (d.kind === DROP_MUSKET) _q.setFromUnitVectors(_zAxis, _d);
      else if (d.kind === DROP_KEG) _q.setFromUnitVectors(_xAxis, _d);
      else _q.setFromUnitVectors(_yAxis, _d);
      let ox = A[0], oy = A[1] - sink, oz = A[2];
      if (d.kind === DROP_KEG) {
        ox = (A[0] + B[0]) / 2;
        oy = (A[1] + B[1]) / 2 - sink;
        oz = (A[2] + B[2]) / 2;
      }
      const mesh = d.kind === DROP_PIKE ? this.pike : d.kind === DROP_MUSKET ? this.musket : d.kind === DROP_AXE ? this.axe : d.kind === DROP_MALLET ? this.mallet : this.keg;
      const n = d.kind === DROP_PIKE ? this.nPike++ : d.kind === DROP_MUSKET ? this.nMusket++ : d.kind === DROP_AXE ? this.nAxe++ : d.kind === DROP_MALLET ? this.nMallet++ : this.nKeg++;
      const cap = d.kind === DROP_PIKE ? MAX_PIKES : d.kind === DROP_AXE || d.kind === DROP_MALLET ? MAX_TOOLS : MAX_KIT;
      if (n >= cap) continue;
      writeMat(mesh.instanceMatrix.array as Float32Array, n, ox, oy, oz, _q.x, _q.y, _q.z, _q.w, 1, 1, 1);
    }
    this.nPike = Math.min(this.nPike, MAX_PIKES);
    this.nMusket = Math.min(this.nMusket, MAX_KIT);
    this.nKeg = Math.min(this.nKeg, MAX_KIT);
    this.nAxe = Math.min(this.nAxe, MAX_TOOLS);
    this.nMallet = Math.min(this.nMallet, MAX_TOOLS);
  }

  /** Advance the loose limbs and draw them. */
  private stepLimbs(dt: number, height: (x: number, z: number) => number) {
    const pu = _limbU, pl = _limbL;
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
    if (!this.gore) return;
    for (const L of this.limbs) {
      if (!L) continue;
      for (let k = 0; k < 2; k++) {
        const part = L.upper + k;
        _p.copy(k === 0 ? L.offU : L.offL).applyQuaternion(L.q).add(L.pos);
        _q.copy(L.q).multiply(k === 0 ? L.qU : L.qL);
        const n = this.counts[part];
        if (n >= CAPACITY) continue;
        this.counts[part] = n + 1;
        writeMat(this.parts[part].instanceMatrix.array as Float32Array, n, _p.x, _p.y, _p.z, _q.x, _q.y, _q.z, _q.w, 1, 1, 1);
        this.paint(this.parts[part], n, part, L.team, 0, 1, 0);
        if (k === 0) {
          // Cap on the cut end of the loose limb.
          _a.set(0, L.sign * MINION_PARTS[part].half, 0).applyQuaternion(_q).add(_p);
          this.putStump(_a, _q, MINION_PARTS[part].radius);
        }
      }
    }
  }

  /** Counts and uploads for every mesh. */
  private flush() {
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
    show(this.helmet, this.nHelmet);
    show(this.pike, this.nPike);
    show(this.keg, this.nKeg);
    show(this.musket, this.nMusket);
    show(this.rod, this.nRod);
    show(this.mallet, this.nMallet);
    show(this.axe, this.nAxe);
    show(this.cap, this.nCap);
  }

  /**
   * Keyframe (S3): what the figures remember between frames: the fallen as they froze, whose side and
   * trade each man was, severed limbs, kegs set down, dropped kit, loose limbs. Moving bodies and
   * upright figures are not kept: they come back with the frame applied after a restore.
   */
  captureState(): MinionsState {
    const frozen = new Map<number, Float32Array>();
    for (const [id, body] of this.frozen) frozen.set(id, body.slice());
    const severed = new Map<number, number[]>();
    for (const [id, c] of this.severed) severed.set(id, [c.limb, c.sign]);
    const time = this.rig.time;
    const drops: Float64Array[] = [];
    this.drops.forEach((d, slot) => {
      if (!d.on) return;
      const r = new Float64Array(DROP_FIELDS);
      r.set([slot, d.kind, d.owner, d.len, d.r], 0);
      r.set(d.a, 5);
      r.set(d.b, 11);
      r[17] = d.age;
      r[18] = d.still;
      r[19] = d.sinkAt < 0 ? -1 : time - d.sinkAt;
      drops.push(r);
    });
    const limbs: Float64Array[] = [];
    for (const L of this.limbs) {
      if (!L) continue;
      const r = new Float64Array(LIMB_FIELDS);
      r[0] = L.team;
      r[1] = L.upper;
      L.pos.toArray(r, 2);
      L.q.toArray(r, 5);
      L.offU.toArray(r, 9);
      L.offL.toArray(r, 12);
      L.qU.toArray(r, 15);
      L.qL.toArray(r, 19);
      r[23] = L.sign;
      L.vel.toArray(r, 24);
      L.spin.toArray(r, 27);
      r[30] = L.age;
      r[31] = L.settled ? 1 : 0;
      limbs.push(r);
    }
    return {
      frozen,
      teamOf: new Map(this.teamOf),
      unitOf: new Map(this.unitOf),
      severed,
      kegless: [...this.rig.kegless],
      drops,
      nextDrop: this.nextDrop,
      limbs,
      nextLimb: this.nextLimb,
      lastParts: this.lastParts.slice(0, this.lastPartCount * PART_STRIDE),
      time,
    };
  }

  /** Keyframe (S3): forget everything, then put the captured state back. */
  restoreState(st: MinionsState) {
    this.clear();
    for (const [id, body] of st.frozen) this.frozen.set(id, body.slice());
    for (const [id, t] of st.teamOf) this.teamOf.set(id, t);
    for (const [id, u] of st.unitOf) this.unitOf.set(id, u);
    for (const [id, [limb, sign]] of st.severed) this.severed.set(id, { limb, sign });
    for (const id of st.kegless) this.rig.kegless.add(id);
    // The figures' clock goes back too, so a man knocked down after a restore leaves the same pose each time (S4).
    this.rig.time = st.time;
    this.rig.since = 0;
    const time = this.rig.time;
    for (const r of st.drops) {
      const d = this.drops[r[0]];
      if (!d) continue;
      d.on = true;
      d.kind = r[1];
      d.owner = r[2];
      d.len = r[3];
      d.r = r[4];
      for (let k = 0; k < 6; k++) {
        d.a[k] = r[5 + k];
        d.b[k] = r[11 + k];
      }
      d.age = r[17];
      d.still = r[18];
      d.sinkAt = r[19] < 0 ? -1 : time - r[19];
    }
    this.nextDrop = st.nextDrop;
    this.limbs = st.limbs.map((r) => ({
      team: r[0],
      upper: r[1],
      pos: new THREE.Vector3().fromArray(r, 2),
      q: new THREE.Quaternion().fromArray(r, 5),
      offU: new THREE.Vector3().fromArray(r, 9),
      offL: new THREE.Vector3().fromArray(r, 12),
      qU: new THREE.Quaternion().fromArray(r, 15),
      qL: new THREE.Quaternion().fromArray(r, 19),
      sign: r[23],
      vel: new THREE.Vector3().fromArray(r, 24),
      spin: new THREE.Vector3().fromArray(r, 27),
      age: r[30],
      settled: r[31] > 0.5,
    }));
    this.nextLimb = st.nextLimb;
    this.lastParts = st.lastParts.slice();
    this.lastPartCount = st.lastParts.length / PART_STRIDE;
    this.drawFrozen();
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
    this.frozenCaps = 0;
    this.frozenDirty = false;
    this.limbs = [];
    this.nextLimb = 0;
    this.lastPartCount = 0;
    this.stumps.count = 0;
    for (const m of this.parts) m.count = 0;
    this.helmet.count = 0;
    this.pike.count = 0;
    this.mallet.count = this.axe.count = this.cap.count = 0;
    this.keg.count = 0;
    this.musket.count = 0;
    this.rod.count = 0;
    this.rig.forget();
    for (const b of this.bodies.values()) this.spare.push(b);
    this.bodies.clear();
    this.bodyList.length = 0;
    for (const d of this.drops) d.on = false;
  }

  dispose() {
    for (const m of [...this.parts, this.helmet, this.pike, this.stumps, this.mallet, this.axe, this.cap, this.keg, this.musket, this.rod]) m.geometry.dispose();
    (this.stumps.material as THREE.Material).dispose();
    (this.parts[0].material as THREE.Material).dispose();
    (this.helmet.material as THREE.Material).dispose();
    (this.pike.material as THREE.Material).dispose();
    (this.keg.material as THREE.Material).dispose();
    (this.musket.material as THREE.Material).dispose();
  }
}

/** Draw the first n instances of a mesh (unless it is primed for loading). */
function show(mesh: THREE.InstancedMesh, n: number) {
  if (mesh.userData.primed) return;
  mesh.count = n;
  if (n > 0) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/** One end of a dropped piece of kit: gravity for h seconds. */
function fall(e: Float32Array, h: number) {
  e[4] -= 9.81 * h;
  e[0] += e[3] * h;
  e[1] += e[4] * h;
  e[2] += e[5] * h;
}

/** Keep an end of dropped kit (radius r) on the ground: 1 if it touches. */
function ground(e: Float32Array, r: number, h: number, height: (x: number, z: number) => number): number {
  const g = height(e[0], e[2]) + r;
  if (e[1] >= g) return 0;
  e[1] = g;
  if (e[4] < 0) e[4] *= -0.15;
  const f = Math.exp(-h * 14);
  e[3] *= f;
  e[5] *= f;
  return 1;
}

const _xAxis = new THREE.Vector3(1, 0, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _limbU = new THREE.Vector3();
const _limbL = new THREE.Vector3();

function newBody(): Body {
  return {
    id: -1,
    cur: new Float32Array(NPARTS * 7),
    prev: new Float32Array(NPARTS * 7),
    hasPrev: false,
    dt: 1 / 60,
    seen: -1,
    fresh: false,
    hand: -1,
    off: new Float32Array(NPARTS * 3),
    dq: new Float32Array(NPARTS * 4),
    sc: new Float32Array(NPARTS * 3),
  };
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
