// A crew at every gun (look round L1): men at their work, drawn so a reload can be read without the bar. Figures on the
// page only (milestone 3.6 makes real crews later). They have the proportions and part shapes of the men
// (MINION_PARTS), dark cloth and skin, a soft cap in their side's colour and a leather apron; the staff (sponge one end,
// rammer the other) and the linstock are thin poles, the match a small glow. What each man does is `crewLogic`'s (a pure
// function of the gun's stage, carriage and shot age); this file turns it into bones and draws them, instanced: one mesh
// per part for every crew. It keeps no state of its own, so a keyframe needs no part for it.

import * as THREE from "three/webgpu";
import { vertexColor } from "three/tsl";
import { MINION_PARTS } from "@keepfall/sim";
import { applyCloudShadow } from "./clouds";
import { mergeGeometries } from "./geometry";
import { glowGeometry, glowMaterial } from "./gunModel";
import { newCrewInfo, type CrewInfo, type Guns } from "./guns";
import { HIDE_NEAR, LINSTOCK, LINSTOCK_TOOL, NO_CARRY, POLE, SHELL, STAFF, CARTRIDGE, liftOf, newCrewGun, newFigures, poseCrew, type CrewGun, type Figure } from "./crewLogic";
import { TEAM_COLORS } from "./minions";

/** Figures drawn at most: 16 guns of four men. */
export const MAX_GUNS = 16;
export const MAX_MEN = MAX_GUNS * 4;
/** Share of the gun's turn the crew's frame follows (the platform does not turn, so they turn only a little with the gun). */
export const FRAME_FOLLOW = 0.3;

const NP = 11;
const CLOTH = 0x4a443b;
const LEGS = 0x2c2925;
const SKINS = [0x8c6d58, 0x7d604c, 0x957563];
const APRON = 0x5b3f29;
const POLE_COLOR = 0x4f4840;
const SPONGE_COLOR = 0x8a8068;
const IRON = 0x2f2f2d;
const BAG = 0xb7a98a;

// Proportions: the same as the rig (minionRig.ts).
const THIGH = 0.42, SHIN = 0.47, UPPER = 0.27, FORE = 0.25;
const PELVIS_Y = 0.935, HIP_X = 0.1, HIP_DROP = 0.05, SPINE = 0.3, SHOULDER_X = 0.235, SHOULDER_UP = 0.19, SOLE = 0.012;

const _c = new THREE.Color();
const lin = (hex: number): [number, number, number] => {
  _c.setHex(hex);
  return [_c.r, _c.g, _c.b];
};
const C_CLOTH = lin(CLOTH), C_LEGS = lin(LEGS), C_APRON = lin(APRON), C_SKIN = SKINS.map(lin), C_TEAM = TEAM_COLORS.map(lin);

type V3 = [number, number, number];
const v3 = (): V3 => [0, 0, 0];

/** Which team's castle a gun stands in: the castle at z = 0 is team 0, the one at z = -150 team 1. */
export function teamOfGun(z: number): number {
  return z < -75 ? 1 : 0;
}

/** The crew's frame yaw: the rest aim, followed a little by the gun's turn. */
export function crewYaw(baseYaw: number, yaw: number): number {
  return baseYaw + (yaw - baseYaw) * FRAME_FOLLOW;
}

// Scratch.
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);
const _zero = new THREE.Vector3(0, 0, 0);
const _id = new THREE.Quaternion();
const _qT = new THREE.Quaternion();
const _qP = new THREE.Quaternion();

export class Crews {
  readonly root = new THREE.Group();
  /** Time spent posing and drawing (ms, smoothed), for the report and the HUD. */
  cost = 0;
  /** Men drawn this frame. */
  men = 0;
  private parts: THREE.InstancedMesh[] = [];
  private cap: THREE.InstancedMesh;
  private apron: THREE.InstancedMesh;
  private staff: THREE.InstancedMesh;
  private linstock: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;
  private bag: THREE.InstancedMesh;
  private shot: THREE.InstancedMesh;
  private mats: THREE.Material[] = [];
  private info: CrewInfo = newCrewInfo();
  private gun: CrewGun = newCrewGun();
  private figs: Figure[] = newFigures(4);
  private nStaff = 0;
  private nLin = 0;
  private nBag = 0;
  private nShot = 0;
  private nMen = 0;
  private now = 0;
  private camQ = new THREE.Quaternion();
  // Bones (world), per figure, reused.
  private fl = v3();
  private fr = v3();
  private pel = v3();
  private tor = v3();
  private head = v3();
  private sl = v3();
  private sr = v3();
  private hl = v3();
  private hr = v3();
  private kl = v3();
  private kr = v3();
  private el = v3();
  private er = v3();
  private hipl = v3();
  private hipr = v3();
  private ph = v3();

  constructor() {
    this.root.name = "crews";
    const cloth = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(cloth);
    cloth.name = "crew-cloth";
    cloth.roughness = 0.92;
    cloth.metalness = 0;
    const tool = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(tool);
    tool.name = "crew-tool";
    tool.roughness = 0.85;
    tool.colorNode = vertexColor();
    const iron = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(iron);
    iron.name = "crew-iron";
    iron.color = new THREE.Color(IRON);
    iron.metalness = 0.55;
    iron.roughness = 0.5;
    this.mats.push(cloth, tool, iron);
    const mk = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, n: number, colors: boolean) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.name = name;
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      if (colors) m.setColorAt(0, _c.setHex(CLOTH));
      this.root.add(m);
      return m;
    };
    for (let i = 0; i < NP; i++) {
      const p = MINION_PARTS[i];
      const geo = p.half > 0 ? new THREE.CapsuleGeometry(p.radius, p.half * 2, 3, 8) : new THREE.SphereGeometry(p.radius, 10, 8);
      this.parts.push(mk(`crew-${p.name}`, geo, cloth, MAX_MEN, true));
    }
    // A soft cap in the team's colour, and a leather apron (a hanging sheet).
    const capGeo = new THREE.SphereGeometry(0.128, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    capGeo.deleteAttribute("uv");
    capGeo.scale(1, 0.62, 1.05);
    capGeo.translate(0, 0.035, -0.01);
    this.cap = mk("crew-cap", capGeo, cloth, MAX_MEN, true);
    const apronGeo = new THREE.BoxGeometry(0.25, 0.42, 0.025);
    apronGeo.deleteAttribute("uv");
    this.apron = mk("crew-apron", apronGeo, cloth, MAX_MEN, true);
    // The staff: from its head (local y 0) to its butt (y = POLE): a drum of sponge or rammer at the head end.
    const shaft = new THREE.CylinderGeometry(0.026, 0.03, POLE, 6, 1);
    shaft.deleteAttribute("uv");
    shaft.translate(0, POLE / 2, 0);
    const drum = new THREE.CylinderGeometry(0.085, 0.085, 0.2, 10, 1);
    drum.deleteAttribute("uv");
    drum.translate(0, 0.1, 0);
    paintGeo(shaft, lin(POLE_COLOR));
    paintGeo(drum, lin(SPONGE_COLOR));
    this.staff = mk("crew-staff", mergeGeometries([shaft, drum]), tool, MAX_MEN, false);
    // The linstock: a pole from its burning tip (y 0) to its butt, a forked head.
    const lp = new THREE.CylinderGeometry(0.017, 0.02, LINSTOCK, 5, 1);
    lp.deleteAttribute("uv");
    lp.translate(0, LINSTOCK / 2, 0);
    const prong = (sx: number) => {
      const g = new THREE.CylinderGeometry(0.008, 0.01, 0.16, 4, 1);
      g.deleteAttribute("uv");
      g.rotateZ(sx * 0.35);
      g.translate(sx * 0.03, 0.06, 0);
      return g;
    };
    const lg = mergeGeometries([lp, prong(1), prong(-1)]);
    paintGeo(lg, lin(POLE_COLOR));
    this.linstock = mk("crew-linstock", lg, tool, MAX_GUNS, false);
    // The match's glow (the guns' own look: a bead and a camera facing glow).
    const glowMat = glowMaterial();
    this.mats.push(glowMat);
    this.glow = new THREE.InstancedMesh(glowGeometry(), glowMat, MAX_GUNS);
    this.glow.name = "crew-match-glow";
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 3;
    this.root.add(this.glow);
    // A cartridge (a cloth bag), a ball and a shell (iron: one sphere, the shell scaled up).
    const bagGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.3, 8, 1);
    bagGeo.deleteAttribute("uv");
    bagGeo.rotateX(Math.PI / 2);
    paintGeo(bagGeo, lin(BAG));
    this.bag = mk("crew-cartridge", bagGeo, tool, MAX_GUNS, false);
    const ball = new THREE.SphereGeometry(0.085, 10, 8);
    ball.deleteAttribute("uv");
    this.shot = mk("crew-shot", ball, iron, MAX_GUNS * 2, false);
    this.root.visible = true;
  }

  /**
   * A frame: pose and draw every crew from its gun. `camera` is the view's (a man whose head comes within HIDE_NEAR of it
   * is not drawn); `now` and `dt` are the renderer's own clock (slow motion slows the men's idle sway with it).
   */
  update(guns: Guns, now: number, camera: THREE.Camera) {
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    const cam = camera.position;
    this.camQ.copy(camera.quaternion);
    this.now = now;
    let nm = 0;
    this.nStaff = 0;
    this.nLin = 0;
    this.nBag = 0;
    this.nShot = 0;
    const n = Math.min(MAX_GUNS, guns.count());
    for (let k = 0; k < n; k++) {
      const id = guns.idAt(k);
      const info = this.info;
      if (!guns.crewInfo(id, info)) continue;
      const g = this.gun;
      const yawC = crewYaw(info.baseYaw, info.yaw);
      g.kind = info.kind;
      g.stage = info.stage;
      g.slide = info.slide;
      g.age = info.age;
      g.pitch = info.pitch;
      g.barrel = info.barrel;
      g.drop = info.y - info.floorY;
      g.lift = liftOf(info.kind, g.drop);
      g.turn = info.yaw - yawC;
      g.propTurn = info.baseYaw - yawC;
      g.ridden = info.ridden;
      const men = poseCrew(g, this.figs);
      const team = teamOfGun(info.z);
      const cy = Math.cos(yawC), sy = Math.sin(yawC);
      for (let i = 0; i < men; i++) {
        if (nm >= MAX_MEN) break;
        nm = this.drawMan(this.figs[i], nm, id * 4 + i, team, info.x, info.floorY, info.z, cy, sy, yawC, now, cam);
      }
    }
    this.nMen = nm;
    this.men = nm;
    for (const m of this.parts) {
      m.count = nm;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    for (const m of [this.cap, this.apron]) {
      m.count = nm;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.staff.count = this.nStaff;
    this.linstock.count = this.nLin;
    this.glow.count = this.nLin;
    this.bag.count = this.nBag;
    this.shot.count = this.nShot;
    for (const m of [this.staff, this.linstock, this.glow, this.bag, this.shot]) m.instanceMatrix.needsUpdate = true;
    if (typeof performance !== "undefined") this.cost += (performance.now() - t0 - this.cost) * 0.1;
  }

  /** A gun-frame point (x, y from the floor, z) into the world, with the crew's frame turned `yaw`. */
  private world(o: V3, x: number, y: number, z: number, ox: number, oy: number, oz: number, cy: number, sy: number) {
    o[0] = ox + x * cy + z * sy;
    o[1] = oy + y;
    o[2] = oz - x * sy + z * cy;
  }

  private drawMan(f: Figure, k: number, id: number, team: number, ox: number, oy: number, oz: number, cy: number, sy: number, yawC: number, now: number, cam: THREE.Vector3): number {
    const phi = yawC + f.face;
    const fx = Math.sin(phi), fz = Math.cos(phi);
    const lx = Math.cos(phi), lz = -Math.sin(phi);
    // A little life: breathing and sway, by the renderer's clock.
    const sway = 0.02 * Math.sin(now * 1.3 + id * 1.9) + 0.012 * Math.sin(now * 2.7 + id * 0.7);
    const lean = f.lean + sway;
    const crouch = f.crouch;
    // Feet.
    const cx = ox + f.px * cy + f.pz * sy, cz = oz - f.px * sy + f.pz * cy;
    const fy = oy + f.py;
    const half = f.stride / 2;
    set(this.fl, cx + lx * 0.1 + fx * half, fy + SOLE, cz + lz * 0.1 + fz * half);
    set(this.fr, cx - lx * 0.1 - fx * half, fy + SOLE, cz - lz * 0.1 - fz * half);
    // Pelvis, torso, head.
    const pyH = PELVIS_Y - crouch;
    const sl = Math.sin(lean), cl = Math.cos(lean);
    set(this.pel, cx + fx * (0.22 * sl + 0.04 * crouch), fy + pyH, cz + fz * (0.22 * sl + 0.04 * crouch));
    const sx = fx * sl, sz = fz * sl; // spine direction: up, leaned forward
    set(this.tor, this.pel[0] + sx * SPINE, this.pel[1] + cl * SPINE, this.pel[2] + sz * SPINE);
    set(this.head, this.tor[0] + sx * 0.4, this.tor[1] + cl * 0.4, this.tor[2] + sz * 0.4);
    // Quaternions: yaw, then lean about the left axis.
    _q.setFromAxisAngle(_y, phi);
    _a.set(1, 0, 0);
    _q2.setFromAxisAngle(_a, lean);
    const qTor = _qT.copy(_q).multiply(_q2);
    _q2.setFromAxisAngle(_a, lean * 0.4);
    const qPel = _qP.copy(_q).multiply(_q2);
    // Shoulders and hips.
    const ux = sx, uy = cl, uz = sz;
    set(this.sl, this.tor[0] + ux * SHOULDER_UP + lx * SHOULDER_X, this.tor[1] + uy * SHOULDER_UP, this.tor[2] + uz * SHOULDER_UP + lz * SHOULDER_X);
    set(this.sr, this.tor[0] + ux * SHOULDER_UP - lx * SHOULDER_X, this.tor[1] + uy * SHOULDER_UP, this.tor[2] + uz * SHOULDER_UP - lz * SHOULDER_X);
    set(this.hipl, this.pel[0] + lx * HIP_X, this.pel[1] - HIP_DROP, this.pel[2] + lz * HIP_X);
    set(this.hipr, this.pel[0] - lx * HIP_X, this.pel[1] - HIP_DROP, this.pel[2] - lz * HIP_X);
    // Hands: the work, or hanging.
    const w = f.hw;
    this.hands(f, w, ox, oy, oz, cy, sy, fx, fz, lx, lz);
    // Hide a man whose head comes near the camera.
    const dxh = this.head[0] - cam.x, dyh = this.head[1] - cam.y, dzh = this.head[2] - cam.z;
    if (dxh * dxh + dyh * dyh + dzh * dzh < HIDE_NEAR * HIDE_NEAR) return k;
    // Legs (the knees bend forward), arms (the elbows bend down and out).
    this.ik(this.hipl, this.fl, THIGH, SHIN, fx, 0, fz, this.kl);
    this.ik(this.hipr, this.fr, THIGH, SHIN, fx, 0, fz, this.kr);
    const kl = this.kl, kr = this.kr;
    this.ik(this.sl, this.hl, UPPER, FORE, -fx * 0.3 + lx * 0.8, -1, -fz * 0.3 + lz * 0.8, this.el);
    this.ik(this.sr, this.hr, UPPER, FORE, -fx * 0.3 - lx * 0.8, -1, -fz * 0.3 - lz * 0.8, this.er);
    // Colours: his own skin from his id.
    const skin = C_SKIN[(id * 7 + 3) % C_SKIN.length];
    const parts = this.parts;
    // pelvis, torso, head
    put(parts[0], k, this.pel, qPel, 1, 1, 1, C_LEGS);
    put(parts[1], k, this.tor, qTor, 1, 1, 1, C_CLOTH);
    put(parts[2], k, this.head, qTor, 1, 1, 1, skin);
    // arms: upper (shoulder to elbow), lower (elbow to hand)
    this.limb(parts[3], k, this.sl, this.el, 3, C_CLOTH);
    this.limb(parts[4], k, this.el, this.hl, 4, skin);
    this.limb(parts[5], k, this.sr, this.er, 5, C_CLOTH);
    this.limb(parts[6], k, this.er, this.hr, 6, skin);
    // legs
    this.limb(parts[7], k, this.hipl, kl, 7, C_LEGS);
    this.limb(parts[8], k, kl, this.fl, 8, C_LEGS);
    this.limb(parts[9], k, this.hipr, kr, 9, C_LEGS);
    this.limb(parts[10], k, kr, this.fr, 10, C_LEGS);
    // cap and apron
    _p.set(this.head[0] + ux * 0.03, this.head[1] + uy * 0.03, this.head[2] + uz * 0.03);
    this.cap.setMatrixAt(k, _m4.compose(_p, qTor, _one));
    setColor(this.cap, k, C_TEAM[team & 1], 0.75);
    _p.set(this.pel[0] + ux * 0.1 + fx * 0.15, this.pel[1] + uy * 0.1 + 0.02, this.pel[2] + uz * 0.1 + fz * 0.15);
    // Hangs from the chest: its long side along the spine, a little forward of the belly.
    this.apron.setMatrixAt(k, _m4.compose(_p, qTor, _one));
    setColor(this.apron, k, C_APRON, 1);
    // Tools and cargo.
    this.tools(f, ox, oy, oz, cy, sy);
    return k + 1;
  }

  /** Hands: the work's, blended with hanging by the figure's hand weight. */
  private hands(f: Figure, w: number, ox: number, oy: number, oz: number, cy: number, sy: number, fx: number, fz: number, lx: number, lz: number) {
    // Hanging: down at the sides, a little forward.
    const hang = (s: V3, side: number, o: V3) => {
      o[0] = s[0] + lx * side * 0.03 + fx * 0.06;
      o[1] = s[1] - (UPPER + FORE) * 0.96;
      o[2] = s[2] + lz * side * 0.03 + fz * 0.06;
    };
    const a: V3 = v3(), b: V3 = v3();
    hang(this.sl, 1, a);
    hang(this.sr, -1, b);
    if (w > 0) {
      this.world(this.hl, f.hl[0], f.hl[1], f.hl[2], ox, oy, oz, cy, sy);
      this.world(this.hr, f.hr[0], f.hr[1], f.hr[2], ox, oy, oz, cy, sy);
      for (let i = 0; i < 3; i++) {
        this.hl[i] = a[i] + (this.hl[i] - a[i]) * w;
        this.hr[i] = b[i] + (this.hr[i] - b[i]) * w;
      }
    } else {
      set(this.hl, a[0], a[1], a[2]);
      set(this.hr, b[0], b[1], b[2]);
    }
  }

  /** Two-bone reach: from `a` towards `t` with bones l1 and l2, the middle joint pushed along (px, py, pz); the target is held at the reach if it is too far. Fills `m`. */
  private ik(a: V3, t: V3, l1: number, l2: number, px: number, py: number, pz: number, m: V3) {
    let dx = t[0] - a[0], dy = t[1] - a[1], dz = t[2] - a[2];
    let d = Math.hypot(dx, dy, dz);
    const max = (l1 + l2) * 0.999;
    if (d > max) {
      // Too far: the hand stops at the reach (the target moves).
      const s = max / d;
      t[0] = a[0] + dx * s;
      t[1] = a[1] + dy * s;
      t[2] = a[2] + dz * s;
      dx *= s;
      dy *= s;
      dz *= s;
      d = max;
    }
    if (d < 1e-4) d = 1e-4;
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const aa = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - aa * aa));
    // The pole with its part along the bone taken out.
    const dp = px * ux + py * uy + pz * uz;
    let qx = px - ux * dp, qy = py - uy * dp, qz = pz - uz * dp;
    const ql = Math.hypot(qx, qy, qz) || 1;
    qx /= ql;
    qy /= ql;
    qz /= ql;
    m[0] = a[0] + ux * aa + qx * h;
    m[1] = a[1] + uy * aa + qy * h;
    m[2] = a[2] + uz * aa + qz * h;
  }

  /** A capsule part stretched between two joints. */
  private limb(mesh: THREE.InstancedMesh, k: number, a: V3, b: V3, part: number, col: [number, number, number]) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _a.length() || 1e-4;
    _a.multiplyScalar(1 / len);
    _q.setFromUnitVectors(_y, _a);
    const shape = MINION_PARTS[part];
    const total = shape.half * 2 + shape.radius * 2;
    _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    mesh.setMatrixAt(k, _m4.compose(_p, _q, _s.set(1, len / total, 1)));
    setColor(mesh, k, col, 1);
  }

  private tools(f: Figure, ox: number, oy: number, oz: number, cy: number, sy: number) {
    const a = this.ph, b = this.pel;
    if (f.tool === STAFF || f.tool === LINSTOCK_TOOL) {
      this.world(a, f.ta[0], f.ta[1], f.ta[2], ox, oy, oz, cy, sy);
      this.world(b, f.tb[0], f.tb[1], f.tb[2], ox, oy, oz, cy, sy);
      _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      _q.setFromUnitVectors(_y, _a);
      _p.set(a[0], a[1], a[2]);
      if (f.tool === STAFF) {
        if (this.nStaff < MAX_MEN) this.staff.setMatrixAt(this.nStaff++, _m4.compose(_p, _q, _one));
      } else if (this.nLin < MAX_GUNS) {
        this.linstock.setMatrixAt(this.nLin, _m4.compose(_p, _q, _one));
        // The glow sits at the tip (its quad turned to the camera by `faceCamera`).
        const t = this.now, i = this.nLin;
        const fl = 0.9 + 0.12 * Math.sin(t * 7.3 + i * 1.7) + 0.08 * Math.sin(t * 19.1 + i * 2.1) + 0.05 * Math.sin(t * 41 + i * 3.7);
        this.glow.setMatrixAt(i, _m4.compose(_p, this.camQ, _s.setScalar(fl)));
        this.nLin++;
      }
    }
    if (f.carry !== NO_CARRY) {
      this.world(a, f.cp[0], f.cp[1], f.cp[2], ox, oy, oz, cy, sy);
      _p.set(a[0], a[1], a[2]);
      if (f.carry === CARTRIDGE) {
        if (this.nBag < MAX_GUNS) {
          _q.setFromAxisAngle(_y, Math.atan2(a[0] - ox, a[2] - oz));
          this.bag.setMatrixAt(this.nBag++, _m4.compose(_p, _q, _one));
        }
      } else if (this.nShot < MAX_GUNS * 2) {
        this.shot.setMatrixAt(this.nShot++, _m4.compose(_p, _id, _s.setScalar(f.carry === SHELL ? 2 : 1)));
      }
    }
  }

  dispose() {
    for (const m of [...this.parts, this.cap, this.apron, this.staff, this.linstock, this.glow, this.bag, this.shot]) {
      m.geometry.dispose();
      m.dispose();
    }
    for (const m of this.mats) m.dispose();
  }
}

function set(o: V3, x: number, y: number, z: number) {
  o[0] = x;
  o[1] = y;
  o[2] = z;
}

/** A part at a joint with this orientation. */
function put(mesh: THREE.InstancedMesh, k: number, p: V3, q: THREE.Quaternion, sx: number, sy: number, sz: number, col: [number, number, number]) {
  _p.set(p[0], p[1], p[2]);
  mesh.setMatrixAt(k, _m4.compose(_p, q, _s.set(sx, sy, sz)));
  setColor(mesh, k, col, 1);
}

function setColor(mesh: THREE.InstancedMesh, k: number, c: [number, number, number], mul: number) {
  const a = mesh.instanceColor!.array as Float32Array;
  a[k * 3] = c[0] * mul;
  a[k * 3 + 1] = c[1] * mul;
  a[k * 3 + 2] = c[2] * mul;
}

/** Vertex colours for a merged geometry. */
function paintGeo(g: THREE.BufferGeometry, c: [number, number, number]) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(c, i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
}
