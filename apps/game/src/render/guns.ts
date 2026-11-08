// Procedural models of the Ashwright weapons, one per emplacement: a long gun
// on a wheeled carriage, a squat wide mortar on its bed, a chain-shot gun with
// a flared muzzle and a small swivel gun on a post. Each turns about its pivot
// (yaw about Y, then pitch about the gun's local X). The page sets the pose;
// nothing here makes a physics decision.

import * as THREE from "three/webgpu";
import { cameraPosition, color, float, mix, normalWorld, positionWorld, pow, smoothstep, texture, uniform, vec2 } from "three/tsl";
import type { CastleLayout, Emplacement, WeaponKind } from "@keepfall/content";
import { stoneBounds } from "@keepfall/content";
import type { N } from "./tslUtils";

interface Gun {
  em: Emplacement;
  root: THREE.Group;
  yaw: THREE.Group;
  pitch: THREE.Group;
  active: { value: number };
  activeTarget: number;
  curYaw: number;
  curPitch: number;
}

function ironMaterial(noise: THREE.Texture, active: N): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.name = "gun-iron";
  const n: N = texture(noise, vec2(positionWorld.x.add(positionWorld.z), positionWorld.y).mul(0.9)).r;
  m.colorNode = mix(color(0x262524), color(0x4b3123), smoothstep(0.55, 0.85, n).mul(0.6));
  m.metalness = 0.65;
  m.roughness = 0.5;
  // The weapon you ride gets a faint cold rim so it reads against the wall.
  const v: N = positionWorld.sub(cameraPosition).normalize();
  const rim: N = pow(float(1).sub(normalWorld.dot(v.negate()).abs()), 3.0);
  m.emissiveNode = color(0xb8c8d8).mul(rim.mul(0.12).add(0.01)).mul(active);
  return m;
}

function woodMaterial(noise: THREE.Texture): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.name = "gun-wood";
  const g: N = texture(noise, vec2(positionWorld.x.add(positionWorld.z).mul(2.5), positionWorld.y.mul(0.4))).g;
  m.colorNode = mix(color(0x2b2824), color(0x4d4841), g.mul(0.8).add(0.1));
  m.roughness = 0.9;
  m.metalness = 0;
  return m;
}

/** A barrel along +Z: rear radius, muzzle radius, from z0 to z1, with a muzzle swell and a cascabel. */
function barrel(r0: number, r1: number, z0: number, z1: number, flare = 1.25): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const len = z1 - z0;
  const body = new THREE.CylinderGeometry(r1, r0, len, 14, 1);
  body.rotateX(Math.PI / 2);
  body.translate(0, 0, (z0 + z1) / 2);
  out.push(body);
  const swell = new THREE.CylinderGeometry(r1 * flare, r1 * flare, Math.min(0.14, len * 0.08), 14, 1);
  swell.rotateX(Math.PI / 2);
  swell.translate(0, 0, z1 - 0.06);
  out.push(swell);
  const ring = new THREE.CylinderGeometry(r0 * 1.08, r0 * 1.08, 0.08, 14, 1);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 0, z0 + 0.06);
  out.push(ring);
  const knob = new THREE.SphereGeometry(r0 * 0.45, 8, 6);
  knob.translate(0, 0, z0 - r0 * 0.3);
  out.push(knob);
  // Trunnions at the pivot.
  const tr = new THREE.CylinderGeometry(r0 * 0.38, r0 * 0.38, r0 * 2 + 0.16, 8, 1);
  tr.rotateZ(Math.PI / 2);
  out.push(tr);
  return out;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function wheel(r: number, w: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, w, 12, 1);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function addAll(parent: THREE.Object3D, geos: THREE.BufferGeometry[], mat: THREE.Material) {
  for (const g of geos) {
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
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
    if (s.castle !== castle || s.material !== "stone" || s.part === "merlon") continue;
    const b = stoneBounds(s, layout.wedge);
    const top = b[4];
    if (top > y + 0.05) continue;
    // Generous margin: a gun may overhang the wall face a little.
    if (x >= b[0] - 0.6 && x <= b[3] + 0.6 && z >= b[2] - 0.6 && z <= b[5] + 0.6) under = Math.max(under, top);
    if (s.shape === "wedge" && Math.hypot(s.x - x, s.z - z) < R) ring = Math.max(ring, top);
  }
  return { under, ring };
}

export class Guns {
  readonly root = new THREE.Group();
  /** How many guns are shown (the rest are another mode's). */
  showN = Infinity;
  private guns: Gun[] = [];
  private noise: THREE.Texture;
  private wood: THREE.MeshStandardNodeMaterial;
  private mats: THREE.Material[] = [];

  constructor(noise: THREE.Texture) {
    this.noise = noise;
    this.root.name = "guns";
    this.wood = woodMaterial(noise);
    this.mats.push(this.wood);
  }

  build(layout: CastleLayout, emplacements: Emplacement[]) {
    for (const g of this.guns) {
      this.root.remove(g.root);
      g.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    for (const m of this.mats) if (m !== this.wood) m.dispose();
    this.mats = [this.wood];
    this.guns = [];
    for (const em of emplacements) {
      const active = uniform(0);
      const iron = ironMaterial(this.noise, active);
      this.mats.push(iron);
      const root = new THREE.Group();
      root.name = `gun-${em.id}-${em.weapon}`;
      root.position.set(em.x, em.y, em.z);
      const yaw = new THREE.Group();
      const pitch = new THREE.Group();
      root.add(yaw);
      yaw.add(pitch);
      const sup = supportHeight(layout, em.x, em.y, em.z);
      let floor = sup.under;
      if (sup.ring - sup.under > 1.5) {
        // Inside a tower: a timber deck across the top of the ring.
        floor = sup.ring;
        const deck = new THREE.CylinderGeometry(layout.wedge.rIn + 0.05, layout.wedge.rIn + 0.05, 0.25, 20, 1);
        deck.translate(0, floor - 0.125 - em.y, 0);
        addAll(root, [deck], this.wood);
      }
      const drop = Math.max(0.3, em.y - floor);
      this.model(em.weapon, em.barrel, drop, root, yaw, pitch, iron);
      this.root.add(root);
      const gun: Gun = { em, root, yaw, pitch, active, activeTarget: 0, curYaw: em.baseYaw, curPitch: 0 };
      this.guns.push(gun);
      this.setPose(em.id, em.baseYaw, kindRestPitch(em.weapon), false);
    }
  }

  private model(kind: WeaponKind, len: number, drop: number, root: THREE.Group, yaw: THREE.Group, pitch: THREE.Group, iron: THREE.Material) {
    const wood = this.wood;
    if (kind === "longGun" || kind === "chainShot") {
      const chain = kind === "chainShot";
      const r0 = chain ? 0.24 : 0.22;
      const r1 = chain ? 0.17 : 0.13;
      addAll(pitch, barrel(r0, r1, chain ? -0.7 : -1.2, len, chain ? 1.45 : 1.25), iron);
      // Carriage: two cheeks, an axle bed and four trucks, below the trunnions.
      const ch = Math.min(drop, 0.85);
      const cheekH = ch * 0.75;
      const cy = -ch + 0.18 + cheekH / 2 - 0.1;
      addAll(yaw, [box(0.12, cheekH, 1.5, 0.3, cy, -0.25), box(0.12, cheekH, 1.5, -0.3, cy, -0.25), box(0.72, 0.14, 1.3, 0, -ch + 0.25, -0.25)], wood);
      const wr = 0.2;
      addAll(yaw, [wheel(wr, 0.1, 0.42, -ch + wr, 0.25), wheel(wr, 0.1, -0.42, -ch + wr, 0.25), wheel(wr * 0.85, 0.1, 0.42, -ch + wr * 0.85, -0.8), wheel(wr * 0.85, 0.1, -0.42, -ch + wr * 0.85, -0.8)], wood);
      if (drop > ch + 0.05) {
        // A timber platform makes up the rest of the height to the wall walk.
        const h = drop - ch;
        addAll(root, [box(1.9, h, 2.6, 0, -ch - h / 2, -0.2)], wood);
      }
    } else if (kind === "mortar") {
      // Squat, wide bore; the bed sits under the trunnions.
      addAll(pitch, barrel(0.42, 0.4, -0.35, len, 1.12), iron);
      const bore = new THREE.CircleGeometry(0.3, 16);
      bore.translate(0, 0, len + 0.001);
      const boreMat = new THREE.MeshBasicNodeMaterial();
      boreMat.colorNode = color(0x050505);
      this.mats.push(boreMat);
      pitch.add(new THREE.Mesh(bore, boreMat));
      const bedH = Math.max(0.3, drop - 0.05);
      addAll(yaw, [box(0.3, bedH, 1.4, 0.55, -drop + bedH / 2, 0), box(0.3, bedH, 1.4, -0.55, -drop + bedH / 2, 0), box(1.4, 0.2, 1.5, 0, -drop + 0.1, 0)], wood);
    } else {
      // Swivel gun: a short barrel in an iron yoke on a wooden post, tiller at the back.
      addAll(pitch, barrel(0.075, 0.055, -0.45, len, 1.3), iron);
      addAll(pitch, [box(0.035, 0.035, 0.6, 0, 0, -0.72)], iron);
      addAll(yaw, [box(0.04, 0.22, 0.05, 0.11, -0.08, 0), box(0.04, 0.22, 0.05, -0.11, -0.08, 0), box(0.26, 0.04, 0.06, 0, -0.19, 0)], iron);
      const post = new THREE.CylinderGeometry(0.1, 0.13, drop - 0.2, 8, 1);
      post.translate(0, -0.2 - (drop - 0.2) / 2, 0);
      addAll(root, [post], wood);
    }
  }

  setPose(i: number, yaw: number, pitch: number, active: boolean) {
    const g = this.guns.find((x) => x.em.id === i) ?? this.guns[i];
    if (!g) return;
    g.curYaw = yaw;
    g.curPitch = pitch;
    g.yaw.rotation.set(0, yaw, 0);
    // Rotating about local X by -pitch lifts the barrel (+Z) towards +Y.
    g.pitch.rotation.set(-pitch, 0, 0);
    g.activeTarget = active ? 1 : 0;
  }

  /** Show the first n guns (the rest belong to a castle that has none in this mode). */
  setShown(n: number) {
    this.guns.forEach((g, i) => (g.root.visible = i < n));
  }

  /** World position of an emplacement's muzzle at its current pose, and the barrel direction. */
  muzzle(i: number, out: THREE.Vector3, dir: THREE.Vector3): boolean {
    const g = this.guns.find((x) => x.em.id === i) ?? this.guns[i];
    if (!g) return false;
    const cp = Math.cos(g.curPitch);
    dir.set(Math.sin(g.curYaw) * cp, Math.sin(g.curPitch), Math.cos(g.curYaw) * cp);
    out.set(g.em.x, g.em.y, g.em.z).addScaledVector(dir, g.em.barrel);
    return true;
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 6);
    for (const g of this.guns) g.active.value += (g.activeTarget - g.active.value) * k;
  }

  dispose() {
    for (const g of this.guns) g.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of this.mats) m.dispose();
  }
}

function kindRestPitch(kind: WeaponKind): number {
  return kind === "mortar" ? 0.9 : 0.05;
}
