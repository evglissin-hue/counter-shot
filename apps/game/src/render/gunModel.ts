// The geometry and materials of the guns (look round L1): cast bronze barrels turned from a profile, iron mortars and
// swivels, worn carriages, breeching ropes, garlands of shot, powder boxes with their kegs and a linstock in its tub.
// Pieces are built small and merged per material, so a gun is a handful of draws. Render only.

import * as THREE from "three/webgpu";
import { cameraPosition, clamp, color, float, mix, normalWorld, positionLocal, positionWorld, pow, smoothstep, texture, uv, vec2, vec3, vertexColor } from "three/tsl";
import type { N } from "./tslUtils";
import { applyCloudShadow } from "./clouds";
import { mergeGeometries } from "./geometry";

type Geo = THREE.BufferGeometry;

const Y = new THREE.Vector3(0, 1, 0);
export const RADIAL = 18;

// --- geometry helpers --------------------------------------------------------------------------

/** Position, normal and a vertex colour (white unless painted): what every gun piece carries, so any may merge with any. */
function prep(g: Geo): Geo {
  if (g.attributes.uv) g.deleteAttribute("uv");
  if (!g.attributes.color) paint(g, 1, 1, 1);
  return g;
}

/** Paint every vertex one colour (the materials multiply their own colour by it). */
function paint(g: Geo, r: number, gr: number, b: number): Geo {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([r, gr, b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return g;
}

/** Merge pieces (an empty list gives null). */
export function merge(list: Geo[]): Geo | null {
  return list.length ? mergeGeometries(list.map(prep)) : null;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): Geo {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

function cyl(r0: number, r1: number, h: number, seg: number, x: number, y: number, z: number, open = false): Geo {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, open);
  g.translate(x, y, z);
  return g;
}

function ball(r: number, x: number, y: number, z: number, seg = 10): Geo {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2));
  g.translate(x, y, z);
  return g;
}

/** A rod (a cylinder) from a to b. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6): Geo {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(1e-4, d.length());
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.multiplyScalar(1 / len)));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** A wheel's tyre: an open iron band round a truck, axis along X. */
function tyre(r: number, w: number, x: number, y: number, z: number): Geo {
  const g = new THREE.CylinderGeometry(r, r, w, 14, 1, true);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function truck(r: number, w: number, x: number, y: number, z: number): Geo {
  const g = new THREE.CylinderGeometry(r - 0.004, r - 0.004, w, 14, 1);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** A turned shape about +Z from (radius, z) points, with an optional colour per profile point. */
function turned(points: Array<[number, number]>, seg: number, colors?: Array<[number, number, number]>): Geo {
  const g = new THREE.LatheGeometry(
    points.map(([r, z]) => new THREE.Vector2(Math.max(1e-4, r), z)),
    seg,
  );
  g.rotateX(Math.PI / 2);
  if (colors) {
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    const per = points.length;
    for (let i = 0; i < n; i++) a.set(colors[i % per], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  }
  return g;
}

/** A shape in (z, y) extruded across x (centred on x0, thickness t). */
function profileExtrude(points: Array<[number, number]>, t: number, x0: number): Geo {
  const s = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, steps: 1 });
  // Shape x -> world z, shape y -> world y, depth -> world x.
  g.rotateY(-Math.PI / 2);
  g.translate(x0 + t / 2, 0, 0);
  return g;
}

// --- the cast barrel ---------------------------------------------------------------------------

export interface BarrelSpec {
  /** Radius at the breech, at the chase, z of the breech face and of the muzzle (the pivot is z = 0). */
  r0: number;
  r1: number;
  z0: number;
  z1: number;
  /** The muzzle's flare (1: none). */
  flare: number;
}

/** The bore's radius at the muzzle. */
export function boreRadius(s: BarrelSpec): number {
  return s.r1 * 0.62;
}

function ring(pts: Array<[number, number]>, z: number, r: number, w: number, h: number) {
  // A rounded bump of half width w and height h on a surface of radius r, centred at z.
  for (let k = 0; k <= 4; k++) {
    const a = (Math.PI * k) / 4;
    pts.push([r + h * Math.sin(a), z - w * Math.cos(a)]);
  }
}

/** A long gun's cast profile (radius, z): cascabel, base ring, reinforces and their rings, chase, astragal, neck, tulip, mouth. */
function gunProfile(s: BarrelSpec): Array<[number, number]> {
  const { r0, r1, z0, z1 } = s;
  const L = z1 - z0;
  const Z = (t: number) => z0 + L * t;
  const k = r0 / 0.22;
  const p: Array<[number, number]> = [];
  // The cascabel: a button on a neck.
  const cas: Array<[number, number]> = [[0, -0.36], [0.03, -0.35], [0.062, -0.325], [0.082, -0.28], [0.085, -0.235], [0.07, -0.19], [0.05, -0.16], [0.042, -0.12], [0.045, -0.07], [0.06, -0.03]];
  for (const [r, dz] of cas) p.push([r * k, z0 + dz * k]);
  p.push([r0 * 0.85, z0 - 0.004]);
  p.push([r0 * 1.02, z0 + 0.014 * k]);
  // The base ring at the breech.
  ring(p, z0 + 0.085 * k, r0 * 0.99, 0.055 * k, r0 * 0.08);
  // The first reinforce and its ring.
  p.push([r0 * 0.98, Z(0.085)]);
  p.push([r0 * 0.93, Z(0.3)]);
  p.push([r0 * 1.0, Z(0.305)]);
  p.push([r0 * 1.0, Z(0.33)]);
  p.push([r0 * 0.85, Z(0.337)]);
  // The second reinforce and its ring.
  p.push([r0 * 0.82, Z(0.36)]);
  p.push([r0 * 0.76, Z(0.56)]);
  p.push([r0 * 0.83, Z(0.565)]);
  p.push([r0 * 0.83, Z(0.59)]);
  p.push([Math.max(r1 * 1.22, r0 * 0.7), Z(0.597)]);
  // The chase, tapering.
  p.push([r1 * 1.12, Z(0.86)]);
  // Astragal and its fillets.
  ring(p, Z(0.875), r1 * 1.1, 0.011, r1 * 0.2);
  p.push([r1 * 1.0, Z(0.895)]);
  ring(p, Z(0.905), r1 * 1.0, 0.009, r1 * 0.13);
  p.push([r1 * 0.97, Z(0.925)]);
  // The muzzle swell (the tulip) and its mouth ring.
  const tul = 1 + (s.flare - 1) * 1.8;
  for (let i = 0; i <= 5; i++) {
    const u = i / 5;
    p.push([r1 * (1 + (tul - 1) * Math.pow(u, 1.6)), Z(0.935 + 0.05 * u)]);
  }
  p.push([r1 * tul * 1.05, Z(0.985)]);
  p.push([r1 * tul * 1.05, z1 - 0.012]);
  p.push([r1 * tul * 0.99, z1]);
  p.push([boreRadius(s), z1]);
  return p;
}

/** A mortar's squat cast profile: a stub lug, rings round a thick body, a swelled mouth. */
function mortarProfile(s: BarrelSpec): Array<[number, number]> {
  const { r0, r1, z0, z1 } = s;
  const L = z1 - z0;
  const Z = (t: number) => z0 + L * t;
  const p: Array<[number, number]> = [];
  for (const [r, dz] of [[0, -0.12], [0.07, -0.11], [0.11, -0.05], [0.11, -0.01]] as Array<[number, number]>) p.push([r, z0 + dz]);
  p.push([r0 * 0.7, z0]);
  p.push([r0 * 0.96, z0 + 0.02]);
  ring(p, z0 + 0.11, r0 * 0.99, 0.06, r0 * 0.1);
  p.push([r0 * 0.99, Z(0.28)]);
  ring(p, Z(0.33), r0 * 0.97, 0.035, r0 * 0.12);
  p.push([r0 * 0.96, Z(0.62)]);
  ring(p, Z(0.67), r0 * 0.95, 0.035, r0 * 0.12);
  p.push([r1 * 0.97, Z(0.88)]);
  p.push([r1 * s.flare, Z(0.9)]);
  p.push([r1 * s.flare * 1.02, z1 - 0.02]);
  p.push([r1 * s.flare * 0.97, z1]);
  p.push([boreRadius(s), z1]);
  return p;
}

/** The barrel's pieces (about its pivot, along +Z): the cast body, the trunnions, a vent with its dark hole, the dark bore. All in one material's list. */
export function barrelGeos(s: BarrelSpec, kind: "gun" | "mortar" | "swivel"): Geo[] {
  const out: Geo[] = [];
  const pts = kind === "mortar" ? mortarProfile(s) : gunProfile(s);
  out.push(turned(pts, RADIAL));
  // Trunnions at the pivot, with shoulders.
  const trR = s.r0 * 0.38;
  const tr = new THREE.CylinderGeometry(trR, trR, s.r0 * 2 + 0.2, 10, 1);
  tr.rotateZ(Math.PI / 2);
  out.push(tr);
  for (const sx of [-1, 1]) {
    const sh = new THREE.CylinderGeometry(trR * 1.28, trR * 1.28, 0.04, 10, 1);
    sh.rotateZ(Math.PI / 2);
    sh.translate(sx * (s.r0 * 0.98 + 0.01), 0, 0);
    out.push(sh);
  }
  // The vent, a raised field on top near the breech, with its hole.
  const vz = kind === "mortar" ? s.z0 + 0.25 : s.z0 + 0.2 * (s.r0 / 0.22);
  const top = s.r0 * (kind === "mortar" ? 0.99 : 0.985);
  const vf = cyl(s.r0 * 0.2, s.r0 * 0.24, 0.03, 10, 0, top + 0.002, vz);
  out.push(vf);
  const hole = new THREE.CircleGeometry(s.r0 * 0.07, 8);
  hole.rotateX(-Math.PI / 2);
  hole.translate(0, top + 0.0175, vz);
  out.push(paint(hole, 0.01, 0.01, 0.01));
  // The dark bore.
  const bore = new THREE.CircleGeometry(boreRadius(s), 16);
  bore.translate(0, 0, s.z1 + 0.001);
  out.push(paint(bore, 0.01, 0.01, 0.01));
  return out;
}

// --- the carriage ------------------------------------------------------------------------------

export interface Carriage {
  wood: Geo[];
  iron: Geo[];
  /** The cheek bolt on each side (the carriage's frame) where a breeching rope is made fast, and the ring bolt on the floor it runs to (the gun's yaw frame). */
  bolts: Array<{ a: THREE.Vector3; b: THREE.Vector3 }>;
  /** The top of the stool bed under the breech, and the axial position (from the pivot) the quoin sits at. */
  bedTop: number;
  quoinS: number;
}

/**
 * A long gun's or chain shot's carriage: two cheeks of stepped profile, transoms, axletrees, four trucks with iron tyres,
 * iron cap squares over the trunnions, a stool bed. `ch` is the height of the trunnions over the floor it stands on.
 */
export function carriageGeos(ch: number, chain: boolean, r0: number, z0: number): Carriage {
  const wood: Geo[] = [];
  const iron: Geo[] = [];
  const F = -ch;
  const zRear = chain ? -0.82 : -1.05;
  const zFront = chain ? 0.72 : 0.85;
  const wrF = 0.2, wrR = 0.17;
  const zWF = chain ? 0.28 : 0.3, zWR = chain ? -0.55 : -0.78;
  const yT = -0.05;
  const yB = F + 0.16;
  const span = Math.max(0.1, yT - yB);
  const y1 = yT - 0.28 * span, y2 = yT - 0.55 * span;
  const cheek: Array<[number, number]> = [[zFront, yB], [zFront, yT - 0.04], [zFront - 0.05, yT], [0.15, yT], [0.15, y1], [-0.3, y1], [-0.3, y2], [zRear + 0.33, y2], [zRear, yB + 0.1 * span], [zRear, yB]];
  const CX = 0.3, CT = 0.12;
  for (const sx of [-1, 1]) wood.push(profileExtrude(cheek, CT, sx * CX - CT / 2));
  // Transoms between the cheeks, an axletree under each pair of trucks, the stool bed under the breech.
  wood.push(box(0.5, 0.13, 0.14, 0, yT - 0.2 * span - 0.04, 0.5));
  wood.push(box(0.5, 0.12, 0.14, 0, y2 - 0.03, zRear + 0.2));
  wood.push(box(0.92, 0.12, 0.14, 0, F + wrF, zWF));
  wood.push(box(0.92, 0.11, 0.13, 0, F + wrR, zWR));
  const bedTop = F + wrR + 0.16;
  wood.push(box(0.5, 0.1, 0.5, 0, bedTop - 0.05, zWR + 0.02));
  // Trucks, with iron tyres and linchpins.
  for (const sx of [-1, 1]) {
    for (const [r, z] of [[wrF, zWF], [wrR, zWR]] as Array<[number, number]>) {
      wood.push(truck(r, 0.1, sx * 0.47, F + r, z));
      iron.push(tyre(r + 0.012, 0.115, sx * 0.47, F + r, z));
      iron.push(box(0.03, 0.04, 0.06, sx * 0.55, F + r, z));
    }
  }
  // Iron: cap squares over the trunnions (with bolts), a strap round the front transom, bolt heads on the cheeks.
  for (const sx of [-1, 1]) {
    iron.push(box(0.17, 0.035, 0.26, sx * CX, 0.098, 0));
    iron.push(box(0.17, 0.12, 0.035, sx * CX, 0.05, 0.12));
    iron.push(box(0.17, 0.12, 0.035, sx * CX, 0.05, -0.12));
    for (const dz of [-0.09, 0.09]) iron.push(cyl(0.014, 0.014, 0.03, 6, sx * CX, 0.12, dz));
    for (const [z, top] of [[0.6, yT], [-0.1, y1], [zRear + 0.4, y2]] as Array<[number, number]>) {
      const bh = cyl(0.02, 0.02, 0.025, 6, 0, 0, 0);
      bh.rotateZ(Math.PI / 2);
      bh.translate(sx * (CX + CT / 2 + 0.01), (top + yB) / 2, z);
      iron.push(bh);
    }
  }
  // The eye bolts the breeching ropes are fast to, and the ring bolts on the floor they run to.
  const zb = zFront - 0.13;
  const yb = (yB + yT) / 2;
  const bolts: Carriage["bolts"] = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.TorusGeometry(0.03, 0.009, 5, 8);
    eye.rotateY(Math.PI / 2);
    eye.translate(sx * (CX + CT / 2 + 0.035), yb, zb);
    iron.push(eye);
    const shank = cyl(0.012, 0.012, 0.05, 6, 0, 0, 0);
    shank.rotateZ(Math.PI / 2);
    shank.translate(sx * (CX + CT / 2 + 0.01), yb, zb);
    iron.push(shank);
    bolts.push({ a: new THREE.Vector3(sx * (CX + CT / 2 + 0.06), yb, zb), b: new THREE.Vector3(sx * 0.92, F, 1.2) });
  }
  return { wood, iron, bolts, bedTop, quoinS: z0 + (chain ? 0.3 : 0.33) };
}

/** The quoin: a wedge of unit height, thick end forward, to be scaled to fit under the breech. */
export function quoinGeo(): Geo {
  const g = profileExtrude([[-0.21, 0], [0.21, 0], [0.21, 1], [-0.21, 0.22]], 0.3, 0);
  return prep(g);
}

/** A mortar's bed: two thick cheeks, a base and cross timbers, with iron straps and trunnion caps. */
export function mortarBedGeos(drop: number): { wood: Geo[]; iron: Geo[] } {
  const wood: Geo[] = [];
  const iron: Geo[] = [];
  const bedH = Math.max(0.3, drop - 0.05);
  const top = -drop + bedH;
  wood.push(box(0.3, bedH, 1.4, 0.55, -drop + bedH / 2, 0));
  wood.push(box(0.3, bedH, 1.4, -0.55, -drop + bedH / 2, 0));
  wood.push(box(1.4, 0.2, 1.5, 0, -drop + 0.1, 0));
  wood.push(box(0.8, 0.14, 0.16, 0, -drop + 0.3, 0.5));
  wood.push(box(0.8, 0.14, 0.16, 0, -drop + 0.3, -0.5));
  for (const sx of [-1, 1]) {
    iron.push(box(0.34, 0.04, 0.3, sx * 0.55, top + 0.02, 0));
    iron.push(box(0.34, 0.07, 0.03, sx * 0.55, top - 0.03, 0.15));
    iron.push(box(0.34, 0.07, 0.03, sx * 0.55, top - 0.03, -0.15));
    for (const z of [-0.55, 0, 0.55]) iron.push(box(0.04, 0.2, 0.1, sx * 0.71, top - 0.2, z));
    for (const z of [-0.6, 0.6]) iron.push(box(0.34, 0.03, 0.1, sx * 0.55, top + 0.005, z));
  }
  iron.push(box(1.42, 0.035, 0.12, 0, -drop + 0.205, 0.55));
  iron.push(box(1.42, 0.035, 0.12, 0, -drop + 0.205, -0.55));
  return { wood, iron };
}

/** A swivel gun's yoke (iron, fixed to the post) and its post's top plate. */
export function yokeGeos(): Geo[] {
  return [box(0.04, 0.22, 0.05, 0.11, -0.08, 0), box(0.04, 0.22, 0.05, -0.11, -0.08, 0), box(0.26, 0.04, 0.06, 0, -0.19, 0), box(0.07, 0.05, 0.07, 0.11, 0.035, 0), box(0.07, 0.05, 0.07, -0.11, 0.035, 0)];
}

// --- breeching ropes ------------------------------------------------------------------------------

const ROPE_R = 0.022;

/**
 * Two breeching ropes: each from a bolt on a cheek forward and outward to a ring bolt on the floor, in two sagging
 * segments. The ropes' vertices are rewritten whenever the carriage moves (and only then); the ring bolts are fixed.
 */
export class Breeching {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private nor: Float32Array;
  private geo: THREE.BufferGeometry;
  private bolts: Carriage["bolts"];
  private length: number[];
  private floor: number;
  private last = NaN;
  private s1 = new THREE.Vector3();
  private s2 = new THREE.Vector3();
  private s3 = new THREE.Vector3();
  private s4 = new THREE.Vector3();
  private t = new THREE.Vector3();
  private u = new THREE.Vector3();
  private v = new THREE.Vector3();
  private a = new THREE.Vector3();
  private m = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(bolts: Carriage["bolts"], maxBack: number, floor: number, material: THREE.Material) {
    this.bolts = bolts;
    this.floor = floor;
    // Cut to just reach the ring bolts when the carriage is as far back as it goes, a little slack beyond.
    this.length = bolts.map((bt) => 1.04 * Math.hypot(bt.a.x - bt.b.x, bt.a.y - bt.b.y, bt.a.z - maxBack - bt.b.z));
    // 2 ropes x 3 rings x 4 vertices; the ring bolts follow.
    const ringBolts: Geo[] = bolts.map((bt) => {
      const g = new THREE.TorusGeometry(0.06, 0.012, 5, 10);
      g.rotateX(Math.PI / 2);
      g.translate(bt.b.x, floor + 0.014, bt.b.z);
      return paint(g, 0.3, 0.3, 0.32);
    });
    for (const bt of bolts) ringBolts.push(paint(box(0.12, 0.012, 0.12, bt.b.x, floor + 0.006, bt.b.z), 0.3, 0.3, 0.32));
    const fixed = merge(ringBolts)!;
    const nRope = bolts.length * 12;
    const nVert = nRope + fixed.attributes.position.count;
    this.pos = new Float32Array(nVert * 3);
    this.nor = new Float32Array(nVert * 3);
    const col = new Float32Array(nVert * 3);
    for (let i = 0; i < nRope; i++) col.set([1, 0.9, 0.75], i * 3);
    this.pos.set(fixed.attributes.position.array as Float32Array, nRope * 3);
    this.nor.set(fixed.attributes.normal.array as Float32Array, nRope * 3);
    col.set(fixed.attributes.color.array as Float32Array, nRope * 3);
    const idx: number[] = [];
    for (let r = 0; r < bolts.length; r++) {
      for (let seg = 0; seg < 2; seg++) {
        for (let k = 0; k < 4; k++) {
          const a = r * 12 + seg * 4 + k, a2 = r * 12 + seg * 4 + ((k + 1) % 4);
          const b = a + 4, b2 = a2 + 4;
          idx.push(a, b, a2, a2, b, b2);
        }
      }
    }
    const fi = fixed.index!;
    for (let i = 0; i < fi.count; i++) idx.push(fi.getX(i) + nRope);
    this.geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    const na = new THREE.BufferAttribute(this.nor, 3);
    na.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", pa);
    this.geo.setAttribute("normal", na);
    this.geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    fixed.dispose();
    this.update(0);
  }

  /** The carriage is `back` metres back: lay the ropes (nothing is done if it has not moved). */
  update(back: number) {
    if (Math.abs(back - this.last) < 1e-4) return;
    this.last = back;
    this.bolts.forEach((bt, r) => {
      const a = this.a.set(bt.a.x, bt.a.y, bt.a.z - back);
      const b = this.b.copy(bt.b);
      const d = a.distanceTo(b);
      const L = this.length[r];
      const h = L > d ? Math.sqrt(Math.max(0, (L / 2) * (L / 2) - (d / 2) * (d / 2))) : 0;
      const m = this.m.addVectors(a, b).multiplyScalar(0.5);
      m.y = Math.max(this.floor + ROPE_R + 0.004, m.y - h);
      const s1 = this.s1.subVectors(m, a), s2 = this.s2.subVectors(b, m);
      const mid = this.s3.copy(s1).normalize().add(this.s4.copy(s2).normalize());
      this.ring(r * 12, a, s1);
      this.ring(r * 12 + 4, m, mid);
      this.ring(r * 12 + 8, b, s2);
    });
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
  }

  private ring(o: number, c: THREE.Vector3, dir: THREE.Vector3) {
    const t = this.t.copy(dir).normalize();
    const u = this.u.crossVectors(t, Y);
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
    u.normalize();
    const v = this.v.crossVectors(t, u).normalize();
    for (let k = 0; k < 4; k++) {
      const sx = k === 0 ? 1 : k === 2 ? -1 : 0;
      const sy = k === 1 ? 1 : k === 3 ? -1 : 0;
      const nx = u.x * sx + v.x * sy, ny = u.y * sx + v.y * sy, nz = u.z * sx + v.z * sy;
      const i = (o + k) * 3;
      this.pos[i] = c.x + nx * ROPE_R;
      this.pos[i + 1] = c.y + ny * ROPE_R;
      this.pos[i + 2] = c.z + nz * ROPE_R;
      this.nor[i] = nx;
      this.nor[i + 1] = ny;
      this.nor[i + 2] = nz;
    }
  }

  dispose() {
    this.geo.dispose();
  }
}

// --- the props at the gun's side ---------------------------------------------------------------

export interface Props {
  wood: Geo[];
  iron: Geo[];
  /** Where each of the four kegs of the powder box stands (the props' frame, floor at y = 0), if the gun has one. */
  kegs: THREE.Vector3[];
  /** The glowing tip of the slow match, if it has a linstock. */
  match: THREE.Vector3 | null;
}

/** A shot garland: a low timber tray with a rail along each edge, and its round shot. */
function garland(kind: "round" | "chain", x: number, z: number, ry: number, wood: Geo[], iron: Geo[]) {
  const t = (g: Geo) => g.rotateY(ry).translate(x, 0, z);
  wood.push(t(box(1.1, 0.04, 0.42, 0, 0.02, 0)));
  wood.push(t(box(1.1, 0.07, 0.035, 0, 0.075, 0.19)));
  wood.push(t(box(1.1, 0.07, 0.035, 0, 0.075, -0.19)));
  wood.push(t(box(0.04, 0.09, 0.42, 0.53, 0.065, 0)));
  wood.push(t(box(0.04, 0.09, 0.42, -0.53, 0.065, 0)));
  if (kind === "round") {
    for (let i = 0; i < 4; i++) for (const dz of [-0.1, 0.1]) iron.push(t(ball(0.08, -0.42 + i * 0.28, 0.12, dz)));
  } else {
    for (let i = 0; i < 4; i++) {
      const cx = -0.39 + i * 0.26;
      iron.push(t(ball(0.07, cx, 0.11, -0.11)));
      iron.push(t(ball(0.07, cx, 0.11, 0.11)));
      iron.push(t(rod(new THREE.Vector3(cx, 0.11, -0.04), new THREE.Vector3(cx, 0.11, 0.04), 0.008, 5)));
    }
  }
}

/** The powder box: an open chest of planks, with iron corner straps; the kegs stand in it (see `kegGeometry`). */
function powderBox(x: number, z: number, ry: number, wood: Geo[], iron: Geo[]): THREE.Vector3[] {
  const t = (g: Geo) => g.rotateY(ry).translate(x, 0, z);
  const W = 0.62, D = 0.5, H = 0.34;
  wood.push(t(box(W, 0.04, D, 0, 0.02, 0)));
  wood.push(t(box(W, H, 0.03, 0, H / 2, D / 2 - 0.015)));
  wood.push(t(box(W, H, 0.03, 0, H / 2, -D / 2 + 0.015)));
  wood.push(t(box(0.03, H, D - 0.06, W / 2 - 0.015, H / 2, 0)));
  wood.push(t(box(0.03, H, D - 0.06, -W / 2 + 0.015, H / 2, 0)));
  wood.push(t(box(W + 0.04, 0.03, 0.05, 0, H + 0.005, D / 2 - 0.0)));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) iron.push(t(box(0.04, H + 0.03, 0.04, sx * (W / 2 - 0.0), H / 2, sz * (D / 2 - 0.0))));
  iron.push(t(box(W + 0.01, 0.025, 0.035, 0, 0.19, D / 2 + 0.003)));
  iron.push(t(box(W + 0.01, 0.025, 0.035, 0, 0.19, -D / 2 - 0.003)));
  const ks: THREE.Vector3[] = [];
  for (const [kx, kz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const p = new THREE.Vector3(kx * 0.14, 0.04, kz * 0.11).applyAxisAngle(Y, ry);
    ks.push(p.add(new THREE.Vector3(x, 0, z)));
  }
  return ks;
}

/** A shell crate for a mortar: an open crate with four shells. */
function shellCrate(x: number, z: number, ry: number, wood: Geo[], iron: Geo[]) {
  const t = (g: Geo) => g.rotateY(ry).translate(x, 0, z);
  const W = 0.92, D = 0.92, H = 0.26;
  wood.push(t(box(W, 0.04, D, 0, 0.02, 0)));
  wood.push(t(box(W, H, 0.035, 0, H / 2, D / 2 - 0.0175)));
  wood.push(t(box(W, H, 0.035, 0, H / 2, -D / 2 + 0.0175)));
  wood.push(t(box(0.035, H, D - 0.07, W / 2 - 0.0175, H / 2, 0)));
  wood.push(t(box(0.035, H, D - 0.07, -W / 2 + 0.0175, H / 2, 0)));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      iron.push(t(ball(0.17, sx * 0.21, 0.04 + 0.17, sz * 0.21, 12)));
      wood.push(t(cyl(0.025, 0.025, 0.1, 6, sx * 0.21, 0.04 + 0.34, sz * 0.21)));
    }
  }
}

/** A linstock stood in a small tub of sand: a pole with a forked head, a coil of slow match and its burning end. Returns the burning end. */
function linstock(x: number, z: number, lean: THREE.Vector3, wood: Geo[]): THREE.Vector3 {
  const tubPts: Array<[number, number]> = [[0, 0], [0.17, 0], [0.18, 0.02], [0.2, 0.26], [0.2, 0.28], [0.185, 0.28], [0.18, 0.24], [0.17, 0.215], [0, 0.215]];
  const tubCols: Array<[number, number, number]> = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [0.7, 0.7, 0.7], [0.7, 0.7, 0.7], [0.5, 0.5, 0.5], [1.6, 1.5, 1.2], [1.6, 1.5, 1.2]];
  const tub = turned(tubPts, 14, tubCols);
  tub.rotateX(-Math.PI / 2);
  tub.translate(x, 0, z);
  wood.push(tub);
  // Hoops on the tub.
  for (const h of [0.07, 0.2]) {
    const hp = new THREE.TorusGeometry(0.19 + (h - 0.07) * 0.04, 0.012, 4, 14);
    hp.rotateX(Math.PI / 2);
    hp.translate(x, h, z);
    wood.push(paint(hp, 0.35, 0.33, 0.3));
  }
  const dir = lean.clone().setY(0).normalize().multiplyScalar(Math.sin(0.12)).setY(Math.cos(0.12));
  const base = new THREE.Vector3(x, 0.2, z);
  const top = base.clone().addScaledVector(dir, 1.55);
  wood.push(rod(base, top, 0.017, 6));
  // The forked head: two prongs and a crosspiece.
  const side = new THREE.Vector3().crossVectors(dir, Y).normalize();
  const p1 = top.clone().addScaledVector(side, 0.05).addScaledVector(dir, 0.13);
  const p2 = top.clone().addScaledVector(side, -0.05).addScaledVector(dir, 0.13);
  wood.push(rod(top, p1, 0.01, 5));
  wood.push(rod(top, p2, 0.01, 5));
  // The coil of match round the pole, and a tail to the fork.
  for (let i = 0; i < 4; i++) {
    const c = new THREE.TorusGeometry(0.03, 0.007, 4, 9);
    c.rotateX(Math.PI / 2);
    c.translate(0, 0, 0);
    paint(c, 0.28, 0.26, 0.22);
    c.translate(base.x + dir.x * (0.95 + i * 0.022), base.y + dir.y * (0.95 + i * 0.022), base.z + dir.z * (0.95 + i * 0.022));
    wood.push(c);
  }
  const tip = p1.clone().addScaledVector(dir, 0.07).addScaledVector(side, 0.02);
  wood.push(paint(rod(base.clone().addScaledVector(dir, 1.05), tip, 0.006, 4), 0.25, 0.22, 0.18));
  return tip;
}

/** The things stood beside a gun (the gun's rest frame: +Z ahead, +X to the gunner's left, y = 0 the floor). Swivel: none. */
export function propsFor(kind: "longGun" | "mortar" | "chainShot" | "swivel"): Props {
  const wood: Geo[] = [];
  const iron: Geo[] = [];
  let kegs: THREE.Vector3[] = [];
  let match: THREE.Vector3 | null = null;
  const toGun = (x: number, z: number) => new THREE.Vector3(-x, 0, -z);
  if (kind === "longGun") {
    kegs = powderBox(1.95, -1.75, 0, wood, iron);
    garland("round", -1.95, -1.75, 0, wood, iron);
    match = linstock(1.2, -1.95, toGun(1.2, -1.95), wood);
  } else if (kind === "chainShot") {
    kegs = powderBox(1.35, -0.85, 0, wood, iron);
    garland("chain", -1.5, -0.5, Math.PI / 2, wood, iron);
    match = linstock(1.15, 0.8, toGun(1.15, 0.8), wood);
  } else if (kind === "mortar") {
    kegs = powderBox(1.9, -0.9, 0, wood, iron);
    shellCrate(-1.9, -0.5, 0, wood, iron);
    match = linstock(1.5, 0.6, toGun(1.5, 0.6), wood);
  }
  return { wood, iron, kegs, match };
}

/** One powder keg standing on its base (y from 0 to 0.36), axis up, with iron hoops painted in. */
export function kegGeometry(): Geo {
  const pts: Array<[number, number]> = [];
  const cols: Array<[number, number, number]> = [];
  const wood: [number, number, number] = [1, 1, 1];
  const band: [number, number, number] = [0.34, 0.32, 0.3];
  const prof: Array<[number, number, boolean]> = [[0, 0, false], [0.085, 0, false], [0.095, 0.03, false], [0.103, 0.09, false], [0.108, 0.095, true], [0.108, 0.12, true], [0.11, 0.125, false], [0.116, 0.18, false], [0.11, 0.235, false], [0.108, 0.24, true], [0.108, 0.265, true], [0.103, 0.27, false], [0.097, 0.33, false], [0.088, 0.355, false], [0.085, 0.36, false], [0, 0.36, false]];
  for (const [r, y, b] of prof) {
    pts.push([r, y]);
    cols.push(b ? band : wood);
  }
  const g = new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)),
    12,
  );
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(cols[i % pts.length], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  g.deleteAttribute("uv");
  return g;
}

/** The slow match's bead and glow: a small sphere and a camera facing quad in one geometry (uv at the sphere's middle, so it burns brightest), drawn additively as one instanced mesh for every gun. */
export function glowGeometry(): Geo {
  const quad = new THREE.PlaneGeometry(0.17, 0.17);
  const bead = new THREE.SphereGeometry(0.018, 6, 4);
  const uv = new Float32Array(bead.attributes.position.count * 2).fill(0.5);
  bead.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return mergeGeometries([quad, bead]);
}

// --- materials ------------------------------------------------------------------------------------

const vc = (): N => vertexColor();

/** Texture coordinates fixed to the part (not the world), so a gun rolling back does not slide its grain. */
function localUV(k: number): N {
  return vec2(positionLocal.z.mul(1.7).add(positionLocal.x.mul(0.6)), positionLocal.y.mul(1.3).add(positionLocal.x.mul(0.45))).mul(k);
}

function rimOf(active: N): N {
  const v: N = positionWorld.sub(cameraPosition).normalize();
  const rim: N = pow(float(1).sub(normalWorld.dot(v.negate()).abs()), 3.0);
  return color(0xb8c8d8).mul(rim.mul(0.12).add(0.01)).mul(active);
}

export function ironMaterial(noise: THREE.Texture, active: N): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  applyCloudShadow(m);
  m.name = "gun-iron";
  const n: N = texture(noise, localUV(0.9)).r;
  m.colorNode = mix(color(0x262524), color(0x4b3123), smoothstep(0.55, 0.85, n).mul(0.6)).mul(vc().rgb);
  m.metalness = 0.65;
  m.roughness = 0.5;
  m.emissiveNode = rimOf(active);
  return m;
}

/** Cast bronze: warm brown-gold with darker green-brown patina low on the barrel and in the recesses; never a mirror. */
export function bronzeMaterial(noise: THREE.Texture, active: N): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  applyCloudShadow(m);
  m.name = "gun-bronze";
  const n: N = texture(noise, localUV(1.5)).r;
  const fine: N = texture(noise, localUV(5.5)).g;
  const base: N = mix(color(0x7b5223), color(0x52341a), smoothstep(0.35, 0.8, n).mul(0.7));
  // Patina gathers on the down-facing side and wherever the noise is deep.
  const low: N = smoothstep(0.15, -0.8, normalWorld.y);
  const green: N = clamp(low.mul(0.55).add(smoothstep(0.62, 0.95, n).mul(0.35)).add(smoothstep(0.85, 1.0, fine).mul(0.1)), 0, 1);
  const col: N = mix(base, color(0x3d4c33), green);
  m.colorNode = col.mul(vc().rgb);
  m.metalness = 0.8;
  m.roughness = 0.5;
  m.emissiveNode = rimOf(active).add(vec3(0.012, 0.007, 0.003).mul(vc().r));
  return m;
}

/** Weathered timber: grey-brown, paler on worn top faces, grain along the part. */
export function woodMaterial(noise: THREE.Texture): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  applyCloudShadow(m);
  m.name = "gun-wood";
  const g: N = texture(noise, vec2(positionLocal.x.add(positionLocal.z).mul(2.5), positionLocal.y.mul(0.4))).g;
  const grain: N = texture(noise, vec2(positionLocal.z.mul(0.5).add(positionLocal.x.mul(0.3)), positionLocal.y.mul(5.0))).b;
  const base: N = mix(color(0x3b352d), color(0x645b50), g.mul(0.7).add(grain.mul(0.25)).add(0.05));
  const top: N = smoothstep(0.55, 0.95, normalWorld.y);
  m.colorNode = mix(base, color(0x7d7465), top.mul(0.22)).mul(vc().rgb);
  m.roughness = 0.92;
  m.metalness = 0;
  return m;
}

/** Hemp rope and the dark ring bolts (the vertex colour says which). */
export function ropeMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  applyCloudShadow(m);
  m.name = "gun-rope";
  m.colorNode = color(0x8d7650).mul(vc().rgb);
  m.roughness = 1;
  m.metalness = 0;
  return m;
}

/** The kegs' staves and hoops (the vertex colour darkens the hoops). */
export function kegMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  applyCloudShadow(m);
  m.name = "gun-keg";
  m.colorNode = color(0x4d3b27).mul(vc().rgb);
  m.roughness = 0.85;
  m.metalness = 0;
  return m;
}

/** The slow match's glow: additive, warm orange, brightest at the middle of its quad. */
export function glowMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.name = "gun-glow";
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  m.toneMapped = false;
  const d: N = uv().sub(0.5).length().mul(2);
  const f: N = float(1).sub(smoothstep(0, 1, d));
  const f2: N = f.mul(f);
  m.colorNode = vec3(1.0, 0.38, 0.08).mul(f2.mul(1.3));
  m.opacityNode = f2;
  return m;
}
