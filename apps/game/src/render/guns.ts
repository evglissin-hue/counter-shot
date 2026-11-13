// Procedural models of the Ashwright weapons, one per emplacement: a long gun
// and a chain-shot gun cast in bronze on worn carriages with breeching ropes, a
// squat iron mortar on its bed and a small iron swivel on a post, each with what
// stands beside it (a garland of shot, a powder box with its kegs, a linstock
// with a slow match glowing). Each turns about its pivot (yaw about Y, then
// pitch about the gun's local X) and rolls back on a shot (look round L1). The
// page sets the pose; nothing here makes a physics decision.
//
// A gun is: root (what it stands on, and the props beside it) > tip (the gun
// itself: it tips over on its own when knocked out) > yaw > slide (the carriage
// and barrel, rolling back along the gun's own -Z) > pitch (the barrel).

import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import type { CastleLayout, Emplacement, WeaponKind } from "@keepfall/content";
import { WEAPONS, stoneBounds } from "@keepfall/content";
import {
  Breeching,
  barrelGeos,
  bronzeMaterial,
  carriageGeos,
  glowGeometry,
  glowMaterial,
  ironMaterial,
  kegGeometry,
  kegMaterial,
  merge,
  mortarBedGeos,
  propsFor,
  quoinGeo,
  ropeMaterial,
  woodMaterial,
  yokeGeos,
  type BarrelSpec,
} from "./gunModel";
import { markInstances, sharedCapacity } from "./instancing";
import { crewSizeFor } from "./crewLogic";
import { BOX_KEGS, RECOIL_BACK, kegCount, kick, newStage, stageFeed, stageFire, stageStep, type Kick, type StageState } from "./recoilLogic";

type Geo = THREE.BufferGeometry;

/** What a gun tells its crew (see `Guns.crewInfo`). */
export interface CrewInfo {
  kind: WeaponKind;
  x: number;
  y: number;
  z: number;
  floorY: number;
  yaw: number;
  baseYaw: number;
  pitch: number;
  barrel: number;
  ridden: boolean;
  stage: number;
  slide: number;
  age: number;
}

export function newCrewInfo(): CrewInfo {
  return { kind: "longGun", x: 0, y: 0, z: 0, floorY: 0, yaw: 0, baseYaw: 0, pitch: 0, barrel: 1, ridden: false, stage: 1, slide: 0, age: 1e6 };
}

interface Gun {
  em: Emplacement;
  root: THREE.Group;
  /** The gun itself (its carriage, bed or yoke and barrel) over what it stands on (a tower's deck, a platform, a post): it tips over on its own. */
  tip: THREE.Group;
  yaw: THREE.Group;
  /** The carriage and barrel together: they roll back along the gun's -Z on a shot (the mortar's bed thuds down instead). */
  slide: THREE.Group;
  pitch: THREE.Group;
  active: { value: number };
  activeTarget: number;
  curYaw: number;
  curPitch: number;
  /** M3: what its model shows ("" for an empty slot). */
  armed: string;
  /**
   * After M5: knocked out. It tips over on its bed, or (its masonry gave
   * way) falls with the stones to the ground below, turning over as it goes.
   */
  out: boolean;
  fell: boolean;
  /** Its fall: height above its pivot's, speed, how far it has turned, and the ground under it. */
  dropY: number;
  dropV: number;
  tumble: number;
  groundY: number;
  /** The way it tips (a turn about the vertical, picked from its id). */
  tipYaw: number;
  // --- look round L1 ---
  /** Its reload stage and the age of its last shot. */
  st: StageState;
  /** Kegs standing in its powder box (0 to 4). */
  kegs: number;
  /** The kick applied now (metres back, metres down, radians of barrel). */
  back: number;
  down: number;
  pitchKick: number;
  /** The world y the crew and the props stand on (null: an empty slot). */
  floorY: number | null;
  rope: Breeching | null;
  quoin: THREE.Mesh | null;
  quoinAt: { bedTop: number; s: number; r: number } | null;
  /** Where the kegs stand and the match burns, in the gun's root frame. */
  kegPos: THREE.Vector3[];
  matchPos: THREE.Vector3 | null;
  /** The same in the world (refreshed when the root moves). */
  matchWorld: THREE.Vector3;
  phase: number;
}

/** One gun's share of a keyframe. */
export interface GunState {
  armed: string;
  out: boolean;
  fell: boolean;
  dropY: number;
  dropV: number;
  tumble: number;
  groundY: number;
  yaw: number;
  pitch: number;
  /** Reload stage, the reload's length in ticks, the stage the last feed gave, the seconds since the last shot (L1). */
  stage: number;
  full: number;
  fed: number;
  age: number;
  /** Kegs in its powder box. */
  kegs: number;
}

/**
 * Height of the masonry top under a point (wall walk or ground), and of the
 * masonry ring around it (a tower top, which is hollow inside).
 */
function supportHeight(layout: CastleLayout, x: number, y: number, z: number): { under: number; ring: number } {
  let under = 0;
  let ring = 0;
  const R = layout.wedge.rOut + 0.6;
  // The castle on the gun's own side of the field (the enemy's guns stand on the enemy's walls).
  const castle = z < (layout.castleZ[0] + layout.castleZ[1]) / 2 ? 1 : 0;
  for (const s of layout.stones) {
    // M3: the plots' buildings are not what a gun stands on.
    if (s.castle !== castle || s.material !== "stone" || s.part === "merlon" || s.plot !== undefined) continue;
    const b = stoneBounds(s, layout.wedge);
    const top = b[4];
    if (top > y + 0.05) continue;
    // Generous margin: a gun may overhang the wall face a little.
    if (x >= b[0] - 0.6 && x <= b[3] + 0.6 && z >= b[2] - 0.6 && z <= b[5] + 0.6) under = Math.max(under, top);
    if (s.shape === "wedge" && Math.hypot(s.x - x, s.z - z) < R) ring = Math.max(ring, top);
  }
  return { under, ring };
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _zero = new THREE.Vector3(0, 0, 0);
const _id = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class Guns {
  readonly root = new THREE.Group();
  /** How many guns are shown (the rest are another mode's). */
  showN = Infinity;
  private guns: Gun[] = [];
  private noise: THREE.Texture;
  private wood: THREE.MeshStandardNodeMaterial;
  private rope: THREE.MeshStandardNodeMaterial;
  private kegMat: THREE.MeshStandardNodeMaterial;
  private glowMat: THREE.MeshBasicNodeMaterial;
  /**
   * One iron and one bronze for every gun (a material per gun compiled its own
   * programs at load: about 60 of them). The cold rim of the gun you ride reads
   * each mesh's own fade (`userData.gunActive`) as it is drawn.
   */
  private iron: THREE.MeshStandardNodeMaterial;
  private bronze: THREE.MeshStandardNodeMaterial;
  /** Every gun's four kegs in one instanced mesh (a hidden keg is scaled to nothing), and every match's glow in another. */
  private kegMesh: THREE.InstancedMesh | null = null;
  private glowMesh: THREE.InstancedMesh | null = null;
  private k: Kick = { back: 0, down: 0, pitch: 0 };

  constructor(noise: THREE.Texture) {
    this.noise = noise;
    this.root.name = "guns";
    this.wood = woodMaterial(noise);
    this.rope = ropeMaterial();
    this.kegMat = kegMaterial();
    this.glowMat = glowMaterial();
    const active = uniform(0).onObjectUpdate(({ object }) => (object?.userData.gunActive as { value: number } | undefined)?.value ?? 0);
    this.iron = ironMaterial(noise, active);
    this.bronze = bronzeMaterial(noise, active);
  }

  build(layout: CastleLayout, emplacements: Emplacement[]) {
    for (const g of this.guns) {
      this.root.remove(g.root);
      g.rope?.dispose();
      g.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    for (const im of [this.kegMesh, this.glowMesh]) {
      if (!im) continue;
      this.root.remove(im);
      im.geometry.dispose();
      im.dispose();
    }
    this.guns = [];
    this.layout = layout;
    for (const em of emplacements) {
      const active = { value: 0 };
      const root = new THREE.Group();
      root.name = `gun-${em.id}-${em.weapon}`;
      root.position.set(em.x, em.y, em.z);
      const tip = new THREE.Group();
      const yaw = new THREE.Group();
      const slide = new THREE.Group();
      const pitch = new THREE.Group();
      root.add(tip);
      tip.add(yaw);
      yaw.add(slide);
      slide.add(pitch);
      const gun: Gun = {
        em: { ...em },
        root,
        tip,
        yaw,
        slide,
        pitch,
        active,
        activeTarget: 0,
        curYaw: em.baseYaw,
        curPitch: 0,
        armed: "",
        out: false,
        fell: false,
        dropY: 0,
        dropV: 0,
        tumble: 0,
        groundY: 0,
        tipYaw: (em.id * 2.399) % (Math.PI * 2),
        st: newStage(),
        kegs: BOX_KEGS,
        back: 0,
        down: 0,
        pitchKick: 0,
        floorY: null,
        rope: null,
        quoin: null,
        quoinAt: null,
        kegPos: [],
        matchPos: null,
        matchWorld: new THREE.Vector3(),
        phase: (em.id * 1.7) % 6.28,
      };
      this.guns.push(gun);
      this.root.add(root);
    }
    const n = Math.max(1, this.guns.length);
    this.kegMesh = new THREE.InstancedMesh(kegGeometry(), this.kegMat, n * BOX_KEGS);
    this.kegMesh.name = "gun-kegs";
    this.kegMesh.frustumCulled = false;
    this.kegMesh.castShadow = true;
    this.kegMesh.receiveShadow = true;
    // Room past one uniform block, so it shares the crews' match glow program (see instancing.ts).
    this.glowMesh = new THREE.InstancedMesh(glowGeometry(), this.glowMat, sharedCapacity(n));
    this.glowMesh.count = n;
    this.glowMesh.name = "gun-match-glow";
    this.glowMesh.frustumCulled = false;
    this.glowMesh.renderOrder = 3;
    for (let i = 0; i < n * BOX_KEGS; i++) this.kegMesh.setMatrixAt(i, _m.compose(_zero, _id, _zero));
    for (let i = 0; i < n; i++) this.glowMesh.setMatrixAt(i, _m.compose(_zero, _id, _zero));
    this.root.add(this.kegMesh, this.glowMesh);
    for (const g of this.guns) {
      this.mount(g, g.em);
      this.setPose(g.em.id, g.em.baseYaw, kindRestPitch(g.em.weapon), false);
    }
    this.placeInstances();
  }

  private layout: CastleLayout | null = null;

  private mesh(parent: THREE.Object3D, geos: Geo[], mat: THREE.Material, shadow = true, gun?: Gun): THREE.Mesh | null {
    const g = merge(geos);
    if (!g) return null;
    const m = new THREE.Mesh(g, mat);
    if (gun) m.userData.gunActive = gun.active;
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** Build (or take down) a gun's model for what its slot holds now: nothing in an empty slot (M3). */
  private mount(g: Gun, em: Emplacement) {
    const keep = new Set<THREE.Object3D>([g.tip, g.yaw, g.slide, g.pitch]);
    for (const group of [g.root, g.tip, g.yaw, g.slide, g.pitch]) {
      for (const child of [...group.children]) {
        if (keep.has(child)) continue;
        group.remove(child);
        child.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      }
    }
    g.rope?.dispose();
    g.rope = null;
    g.quoin = null;
    g.quoinAt = null;
    g.kegPos = [];
    g.matchPos = null;
    g.floorY = null;
    g.em = { ...em };
    g.armed = em.empty ? "" : `${em.weapon}`;
    g.root.name = `gun-${em.id}-${em.empty ? "empty" : em.weapon}`;
    // A new gun in the slot: loaded, run out, at rest.
    g.st = newStage();
    g.back = 0;
    g.down = 0;
    g.pitchKick = 0;
    g.slide.position.set(0, 0, 0);
    g.pitch.position.set(0, 0, 0);
    if (em.empty || !this.layout) return;
    const layout = this.layout;
    const sup = supportHeight(layout, em.x, em.y, em.z);
    let floor = sup.under;
    const rootWood: Geo[] = [];
    const rootIron: Geo[] = [];
    if (sup.ring - sup.under > 1.5) {
      // Inside a tower: a timber deck across the top of the ring.
      floor = sup.ring;
      const deck = new THREE.CylinderGeometry(layout.wedge.rIn + 0.05, layout.wedge.rIn + 0.05, 0.25, 20, 1);
      deck.translate(0, floor - 0.125 - em.y, 0);
      rootWood.push(deck);
    }
    const drop = Math.max(0.3, em.y - floor);
    g.floorY = em.y - drop;
    this.model(g, em.weapon, em.barrel, drop, rootWood);
    // What stands beside it, on the floor, turned with the gun's rest aim (it does not turn when the gun does).
    const props = propsFor(em.weapon);
    const place = (geos: Geo[], into: Geo[]) => {
      for (const p of geos) {
        p.rotateY(em.baseYaw);
        p.translate(0, -drop, 0);
        into.push(p);
      }
    };
    place(props.wood, rootWood);
    place(props.iron, rootIron);
    g.kegPos = props.kegs.map((v) => v.clone().applyAxisAngle(Y_AXIS, em.baseYaw).setY(-drop + v.y));
    if (props.match) g.matchPos = props.match.clone().applyAxisAngle(Y_AXIS, em.baseYaw).setY(-drop + props.match.y);
    this.mesh(g.root, rootWood, this.wood);
    this.mesh(g.root, rootIron, this.iron, true, g);
    g.root.updateWorldMatrix(true, false);
    if (g.matchPos) g.matchWorld.copy(g.matchPos).applyMatrix4(g.root.matrixWorld);
    this.applyKick(g, true);
  }

  /** The gun's model: carriage or bed or post, and the barrel. */
  private model(g: Gun, kind: WeaponKind, len: number, drop: number, rootWood: Geo[]) {
    const { yaw, slide, pitch } = g;
    if (kind === "longGun" || kind === "chainShot") {
      const chain = kind === "chainShot";
      const spec: BarrelSpec = { r0: chain ? 0.24 : 0.22, r1: chain ? 0.17 : 0.13, z0: chain ? -0.7 : -1.2, z1: len, flare: chain ? 1.45 : 1.25 };
      this.mesh(pitch, barrelGeos(spec, "gun"), this.bronze, true, g);
      // Carriage: cheeks, transoms, axletrees and four trucks, below the trunnions.
      const ch = Math.min(drop, 0.85);
      const car = carriageGeos(ch, chain, spec.r0, spec.z0);
      this.mesh(slide, car.wood, this.wood);
      this.mesh(slide, car.iron, this.iron, true, g);
      const q = new THREE.Mesh(quoinGeo(), this.wood);
      q.castShadow = true;
      q.receiveShadow = true;
      slide.add(q);
      g.quoin = q;
      g.quoinAt = { bedTop: car.bedTop, s: car.quoinS, r: spec.r0 * 0.9 };
      g.rope = new Breeching(car.bolts, RECOIL_BACK[kind], -ch, this.rope);
      g.rope.mesh.castShadow = false;
      yaw.add(g.rope.mesh);
      if (drop > ch + 0.05) {
        // A timber platform makes up the rest of the height to the wall walk: courses of beams, each a little proud or shy of the next.
        const h = drop - ch;
        const n = Math.max(1, Math.round(h / 0.3));
        const t = h / n;
        for (let i = 0; i < n; i++) {
          const inset = (i % 2) * 0.04 + (i % 3) * 0.015;
          const p = new THREE.BoxGeometry(2.0 - inset * 2, t - 0.014, 2.6 - inset * 2);
          p.translate(0, -ch - (i + 0.5) * t, 0);
          rootWood.push(p);
        }
      }
    } else if (kind === "mortar") {
      // Squat, wide bore; the bed sits under the trunnions.
      const spec: BarrelSpec = { r0: 0.42, r1: 0.4, z0: -0.35, z1: len, flare: 1.12 };
      this.mesh(pitch, barrelGeos(spec, "mortar"), this.iron, true, g);
      const bed = mortarBedGeos(drop);
      this.mesh(slide, bed.wood, this.wood);
      this.mesh(slide, bed.iron, this.iron, true, g);
    } else {
      // Swivel gun: a short cast barrel in an iron yoke on a wooden post, tiller at the back.
      const spec: BarrelSpec = { r0: 0.075, r1: 0.055, z0: -0.45, z1: len, flare: 1.3 };
      const tiller = new THREE.BoxGeometry(0.035, 0.035, 0.6);
      tiller.translate(0, 0, -0.72);
      this.mesh(pitch, [...barrelGeos(spec, "swivel"), tiller], this.iron, true, g);
      this.mesh(yaw, yokeGeos(), this.iron, true, g);
      const post = new THREE.CylinderGeometry(0.1, 0.13, drop - 0.2, 8, 1);
      post.translate(0, -0.2 - (drop - 0.2) / 2, 0);
      rootWood.push(post);
    }
  }

  /** M3: what each slot holds now (a gun bought for an empty slot appears; nothing else changes). */
  arm(emplacements: Emplacement[]) {
    let changed = false;
    for (const em of emplacements) {
      const g = this.guns.find((x) => x.em.id === em.id);
      if (!g) continue;
      const want = em.empty ? "" : `${em.weapon}`;
      if (want !== g.armed) {
        this.mount(g, em);
        this.setPose(g.em.id, g.curYaw, g.curPitch, g.activeTarget > 0);
        changed = true;
      }
    }
    if (changed) this.placeInstances();
  }

  private find(i: number): Gun | undefined {
    return this.guns.find((x) => x.em.id === i) ?? this.guns[i];
  }

  setPose(i: number, yaw: number, pitch: number, active: boolean) {
    const g = this.find(i);
    if (!g) return;
    g.curYaw = yaw;
    g.curPitch = pitch;
    g.yaw.rotation.set(0, yaw, 0);
    this.applyPitch(g);
    g.activeTarget = active ? 1 : 0;
  }

  /** Rotating about local X by -pitch lifts the barrel (+Z) towards +Y; the mortar's kick adds to it; the quoin follows the breech. */
  private applyPitch(g: Gun) {
    g.pitch.rotation.set(-(g.curPitch + g.pitchKick), 0, 0);
    const q = g.quoin, at = g.quoinAt;
    if (q && at) {
      const p = g.curPitch;
      const under = at.s * Math.sin(p) - at.r * Math.cos(p);
      q.position.set(0, at.bedTop, at.s * Math.cos(p));
      q.scale.y = Math.max(0.01, under - at.bedTop);
    }
  }

  /** Lay the kick of the gun's last shot on its parts: the carriage back (the ropes follow), the mortar's bed down, the swivel's barrel along its axis. */
  private applyKick(g: Gun, force = false) {
    if (g.armed === "") return;
    const k = kick(g.em.weapon, g.st.age, g.st.stage, this.k);
    if (g.em.weapon === "longGun" || g.em.weapon === "chainShot") {
      if (force || Math.abs(k.back - g.back) > 1e-5) {
        g.back = k.back;
        g.slide.position.z = -k.back;
        g.rope?.update(k.back);
      }
    } else if (g.em.weapon === "mortar") {
      if (force || Math.abs(k.down - g.down) > 1e-5 || Math.abs(k.pitch - g.pitchKick) > 1e-5) {
        g.down = k.down;
        g.pitchKick = k.pitch;
        g.slide.position.y = -k.down;
        this.applyPitch(g);
      }
    } else if (force || Math.abs(k.back - g.back) > 1e-5) {
      g.back = k.back;
      g.pitch.position.z = -k.back;
    }
  }

  // --- the shot, the reload and the box ---------------------------------------------------------

  /** A Muzzle event: the gun fires (its kick begins, its reload stage starts over). Says what fired and whether it is the one you ride. */
  fire(i: number): { kind: WeaponKind; active: boolean } | null {
    const g = this.find(i);
    if (!g || g.armed === "") return null;
    stageFire(g.st, WEAPONS[g.em.weapon].reload);
    this.applyKick(g);
    return { kind: g.em.weapon, active: g.activeTarget > 0 };
  }

  /** The page's reload array: ticks left per match emplacement id. A gun with ticks left has begun its reload. */
  setReloads(left: ArrayLike<number>) {
    for (const g of this.guns) {
      if (g.armed === "") continue;
      const v = left[g.em.id];
      if (v === undefined) continue;
      stageFeed(g.st, v);
    }
  }

  /** The ready box beside a gun holds this many charges of this capacity: kegs show 0 for none, else the share rounded up (at most four). */
  setReadyBox(i: number, charges: number, capacity: number) {
    const g = this.find(i);
    if (!g) return;
    const n = kegCount(charges, capacity);
    if (n === g.kegs) return;
    g.kegs = n;
    this.placeInstances();
  }

  /** Reload stage of a gun, 0 just fired to 1 loaded (1 for a gun that never fired or an empty slot). */
  stage(i: number): number {
    const g = this.find(i);
    return g && g.armed !== "" ? g.st.stage : 1;
  }

  /** How far the gun has rolled back now, in metres (the mortar: how far its bed has dropped; the swivel: its barrel along its axis). */
  slide(i: number): number {
    const g = this.find(i);
    if (!g || g.armed === "") return 0;
    return g.em.weapon === "mortar" ? g.down : g.back;
  }

  /** Seconds since the gun's last shot on the renderer clock (1e6 for a gun that never fired, or an empty slot). */
  shotAge(i: number): number {
    const g = this.find(i);
    return g && g.armed !== "" ? g.st.age : 1e6;
  }

  /**
   * What its crew needs (look round L1): false when no crew stands there (an empty slot, a gun knocked out and swept
   * away, a gun not shown now). Else fills the gun's weapon, where its pivot is, the world y of its floor, which way it
   * points and its rest aim, the barrel's length from the pivot, whether it is the one you ride, and its stage, slide
   * and shot age.
   */
  crewInfo(i: number, o: CrewInfo): boolean {
    const g = this.find(i);
    if (!g || crewSizeFor(g.armed, g.out, g.root.visible) === 0 || g.floorY === null) return false;
    o.kind = g.em.weapon;
    o.x = g.em.x;
    o.y = g.em.y;
    o.z = g.em.z;
    o.floorY = g.floorY;
    o.yaw = g.curYaw;
    o.baseYaw = g.em.baseYaw;
    o.pitch = g.curPitch;
    o.barrel = g.em.barrel;
    o.ridden = g.activeTarget > 0;
    o.stage = g.st.stage;
    o.slide = g.em.weapon === "mortar" ? g.down : g.back;
    o.age = g.st.age;
    return true;
  }

  /** How many guns (slots) there are. */
  count(): number {
    return this.guns.length;
  }

  /** The match id of the gun in slot k. */
  idAt(k: number): number {
    return this.guns[k].em.id;
  }

  /** The world y the crew and the props stand on; null for an empty slot. */
  floor(i: number): number | null {
    const g = this.find(i);
    return g ? g.floorY : null;
  }

  /** Write every gun's kegs into the instanced mesh (and the world places of the matches): after a gun moves, appears, or is shown or hidden. */
  private placeInstances() {
    const km = this.kegMesh;
    if (!km) return;
    this.guns.forEach((g, gi) => {
      const show = g.root.visible && g.armed !== "";
      if (show) g.root.updateWorldMatrix(true, false);
      if (show) g.root.getWorldQuaternion(_q);
      for (let k = 0; k < BOX_KEGS; k++) {
        if (show && k < g.kegs && k < g.kegPos.length) km.setMatrixAt(gi * BOX_KEGS + k, _m.compose(_p.copy(g.kegPos[k]).applyMatrix4(g.root.matrixWorld), _q, _one));
        else km.setMatrixAt(gi * BOX_KEGS + k, _m.compose(_zero, _id, _zero));
      }
      if (show && g.matchPos) g.matchWorld.copy(g.matchPos).applyMatrix4(g.root.matrixWorld);
    });
    km.instanceMatrix.needsUpdate = true;
  }

  /**
   * After M5: a gun knocked out (or back). `fell`: its masonry gave
   * way, so it falls to `groundY`; otherwise it tips over on its bed. Back: it stands as
   * it was at once (its crew has put it back).
   */
  setOut(i: number, out: boolean, fell: boolean, groundY: number) {
    const g = this.guns.find((x) => x.em.id === i);
    if (!g || g.out === out) return;
    g.out = out;
    g.fell = out && fell;
    g.dropY = 0;
    g.dropV = 0;
    g.tumble = 0;
    g.groundY = groundY;
    if (g.rope) g.rope.mesh.visible = !out;
    if (!out) {
      g.root.position.set(g.em.x, g.em.y, g.em.z);
      g.root.rotation.set(0, 0, 0);
      g.tip.position.set(0, 0, 0);
      g.tip.rotation.set(0, 0, 0);
      this.placeInstances();
    }
  }

  /** Keyframe (S3): per gun, what it holds, whether it is out or fell, how far its fall has gone, where it points, its reload and its box. */
  captureState(): GunState[] {
    return this.guns.map((g) => ({
      armed: g.armed,
      out: g.out,
      fell: g.fell,
      dropY: g.dropY,
      dropV: g.dropV,
      tumble: g.tumble,
      groundY: g.groundY,
      yaw: g.curYaw,
      pitch: g.curPitch,
      stage: g.st.stage,
      full: g.st.full,
      fed: g.st.fed,
      age: g.st.age,
      kegs: g.kegs,
    }));
  }

  /** Keyframe (S3): put every gun as captured, a fall standing where it had got to (not replayed). */
  restoreState(states: GunState[]) {
    states.forEach((st, i) => {
      const g = this.guns[i];
      if (!g) return;
      if (st.armed !== g.armed) this.mount(g, st.armed === "" ? { ...g.em, empty: true } : { ...g.em, empty: false, weapon: st.armed as WeaponKind });
      g.out = st.out;
      g.fell = st.fell;
      g.dropY = st.dropY;
      g.dropV = st.dropV;
      g.tumble = st.tumble;
      g.groundY = st.groundY;
      g.kegs = st.kegs ?? BOX_KEGS;
      g.st.stage = st.stage ?? 1;
      g.st.full = st.full ?? 1;
      g.st.fed = st.fed ?? -1;
      g.st.age = st.age ?? 1e6;
      if (g.rope) g.rope.mesh.visible = !g.out;
      // Upright again, then (if out) where its fall had got to.
      g.root.position.set(g.em.x, g.em.y, g.em.z);
      g.root.rotation.set(0, 0, 0);
      g.tip.position.set(0, 0, 0);
      g.tip.rotation.set(0, 0, 0);
      if (g.out) this.animateOut(g, 0);
      this.setPose(g.em.id, st.yaw, st.pitch, g.activeTarget > 0);
      this.applyKick(g, true);
    });
    this.placeInstances();
  }

  /** Show the first n guns (the rest belong to a castle that has none in this mode). */
  setShown(n: number) {
    this.guns.forEach((g, i) => (g.root.visible = i < n));
    this.placeInstances();
  }

  /** World position of an emplacement's muzzle at its current pose, and the barrel direction. */
  muzzle(i: number, out: THREE.Vector3, dir: THREE.Vector3): boolean {
    const g = this.find(i);
    if (!g) return false;
    const cp = Math.cos(g.curPitch);
    dir.set(Math.sin(g.curYaw) * cp, Math.sin(g.curPitch), Math.cos(g.curYaw) * cp);
    out.set(g.em.x, g.em.y, g.em.z).addScaledVector(dir, g.em.barrel);
    return true;
  }

  /** A frame: `dt` seconds of the renderer's own clock (slow motion slows it), `now` that clock, and the camera's turn (the matches' glows face it). */
  update(dt: number, now = 0, camQuat?: THREE.Quaternion) {
    const k = 1 - Math.exp(-dt * 6);
    let moved = false;
    for (const g of this.guns) {
      g.active.value += (g.activeTarget - g.active.value) * k;
      stageStep(g.st, dt);
      this.applyKick(g);
      if (g.out) {
        this.animateOut(g, dt);
        if (g.fell) moved = true;
      }
    }
    if (moved) this.placeInstances();
    const gm = this.glowMesh;
    if (gm) {
      this.guns.forEach((g, gi) => {
        const on = g.matchPos !== null && g.armed !== "" && g.root.visible && !g.out;
        if (!on) {
          gm.setMatrixAt(gi, _m.compose(_zero, _id, _zero));
          return;
        }
        // A slow match flickers: a few slow waves and a quick one, by the renderer's clock.
        const f = 0.9 + 0.12 * Math.sin(now * 7.3 + g.phase) + 0.08 * Math.sin(now * 19.1 + g.phase * 2.1) + 0.05 * Math.sin(now * 41 + g.phase * 3.7);
        gm.setMatrixAt(gi, _m.compose(g.matchWorld, camQuat ?? _id, _s.setScalar(f)));
      });
      markInstances(gm);
    }
  }

  /**
   * A knocked-out gun: tipping over on its bed (what it stands on stays put:
   * a tower's deck, a wall gun's platform, a swivel's post, and the props beside it), or falling with
   * its masonry, all of it, and coming to rest on the ground.
   */
  private animateOut(g: Gun, dt: number) {
    const em = g.em;
    // Tip about a horizontal axis turned by tipYaw.
    const ax = Math.cos(g.tipYaw), az = Math.sin(g.tipYaw);
    if (g.fell) {
      const floor = g.groundY + 0.35 - em.y;
      if (g.dropY > floor) {
        g.dropV -= 9.81 * dt;
        g.dropY = Math.max(floor, g.dropY + g.dropV * dt);
        g.tumble = Math.min(Math.PI * 0.62, g.tumble + dt * 2.2);
      }
      g.root.position.set(em.x, em.y + g.dropY, em.z);
      g.root.rotation.set(ax * g.tumble, 0, az * g.tumble);
    } else {
      // Over on its side, a little lower: smashed, its crew gone.
      g.dropY += (-0.3 - g.dropY) * Math.min(1, dt * 5);
      g.tumble += (Math.PI * 0.42 - g.tumble) * Math.min(1, dt * 6);
      g.tip.position.set(0, g.dropY, 0);
      g.tip.rotation.set(ax * g.tumble, 0, az * g.tumble);
    }
  }

  dispose() {
    for (const g of this.guns) {
      g.rope?.dispose();
      g.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    for (const im of [this.kegMesh, this.glowMesh]) {
      im?.geometry.dispose();
      im?.dispose();
    }
    for (const m of [this.wood, this.rope, this.kegMat, this.glowMat, this.iron, this.bronze]) m.dispose();
  }
}

function kindRestPitch(kind: WeaponKind): number {
  return kind === "mortar" ? 0.9 : 0.05;
}

