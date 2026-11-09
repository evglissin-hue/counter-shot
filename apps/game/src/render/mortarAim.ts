// The mortar's marks on the ground (after M5; the owner found the old top-down
// observer view weird). The bearing: dashes along the ground in the direction
// the mortar points, from its nearest range to its farthest. The charge ring:
// where the shell would come down as the charge builds, a soft patch about
// the size of the shell's scatter (in still air with the standard aim help:
// reading the wind is the gunner's job), or a sharp ring with the burst's
// reach with the easy aim help. Cold white over a dark outline (readability
// rule 4). Render only: the page works out where everything goes.

import * as THREE from "three/webgpu";
import { float, length, smoothstep, uniform, uv, vec2 } from "three/tsl";
import type { N } from "./tslUtils";

/** Dashes along the bearing: this long, this far apart (m). */
const DASH = 2.2;
const EVERY = 5;
const MAX_DASHES = 48;

function flatMaterial(hex: number, opacity: number, order: number): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.color = new THREE.Color(hex);
  m.transparent = true;
  m.opacity = opacity;
  m.depthWrite = false;
  m.fog = false;
  m.side = THREE.DoubleSide;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -4;
  m.polygonOffsetUnits = -4;
  void order;
  return m;
}

export class MortarAim {
  readonly root = new THREE.Group();
  private dashGeo = new THREE.BufferGeometry();
  private dashPos = new Float32Array(MAX_DASHES * 4 * 3);
  /** The bearing the dashes were last laid for (they are rebuilt only when it changes). */
  private laid = { shown: false, x: 0, z: 0, dx: 0, dz: 0, near: 0, far: 0 };
  private dashes: THREE.Mesh[] = [];
  private ring = new THREE.Group();
  private soft: THREE.Mesh;
  private sharp = new THREE.Group();
  private softOpacity = uniform(0.75);
  /**
   * An upright mark over the ring, facing the camera and drawn over walls: a
   * ring lying on a keep's roof is seen edge on from the spotter, behind its
   * battlements. It keeps about the same size on screen.
   */
  private pin = new THREE.Group();
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];

  constructor() {
    this.root.name = "mortar-aim";
    // The bearing: quads, two triangles each, rebuilt when the mortar turns (a few dozen vertices).
    const idx: number[] = [];
    for (let i = 0; i < MAX_DASHES; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3);
    this.dashGeo.setIndex(idx);
    this.dashGeo.setAttribute("position", new THREE.BufferAttribute(this.dashPos, 3));
    this.dashGeo.setDrawRange(0, 0);
    const under = flatMaterial(0x07090b, 0.3, 20);
    const over = flatMaterial(0xeef4ff, 0.45, 21);
    this.mats.push(under, over);
    // The dark outline is the same strip drawn first, a touch lower: it shows as an edge where the ground is lit.
    const a = new THREE.Mesh(this.dashGeo, under);
    a.renderOrder = 20;
    a.scale.set(1, 1, 1);
    const b = new THREE.Mesh(this.dashGeo, over);
    b.renderOrder = 21;
    b.position.y = 0.03;
    this.dashes.push(a, b);
    this.root.add(a, b);
    this.geos.push(this.dashGeo);

    // The soft patch: a disc that fades out to its edge.
    const disc = new THREE.CircleGeometry(1, 48);
    disc.rotateX(-Math.PI / 2);
    this.geos.push(disc);
    const softMat = new THREE.MeshBasicNodeMaterial();
    softMat.color = new THREE.Color(0xeef4ff);
    softMat.transparent = true;
    softMat.depthWrite = false;
    softMat.fog = false;
    softMat.polygonOffset = true;
    softMat.polygonOffsetFactor = -4;
    softMat.polygonOffsetUnits = -4;
    const r: N = length(uv().sub(vec2(0.5, 0.5))).mul(2);
    // Brightest in a band just inside the edge, faint in the middle: "about here", not a bullseye.
    softMat.opacityNode = smoothstep(float(1.0), float(0.82), r).mul(smoothstep(float(0.2), float(0.8), r).mul(0.75).add(0.25)).mul(this.softOpacity);
    this.mats.push(softMat);
    this.soft = new THREE.Mesh(disc, softMat);
    this.soft.renderOrder = 22;
    this.ring.add(this.soft);

    // The sharp ring (easy aim help): the burst's reach, an outline and a dot.
    const ringGeo = (r0: number, r1: number) => {
      const g = new THREE.RingGeometry(r0, r1, 72, 1);
      g.rotateX(-Math.PI / 2);
      this.geos.push(g);
      return g;
    };
    const dark = flatMaterial(0x07090b, 0.6, 21), light = flatMaterial(0xeef4ff, 0.85, 22), dot = flatMaterial(0xeef4ff, 0.95, 22);
    this.mats.push(dark, light, dot);
    const m1 = new THREE.Mesh(ringGeo(0.95, 1.0), dark);
    const m2 = new THREE.Mesh(ringGeo(0.965, 0.99), light);
    const m3 = new THREE.Mesh(ringGeo(0, 0.05), dot);
    m1.renderOrder = 21;
    m2.renderOrder = 22;
    m3.renderOrder = 22;
    this.sharp.add(m1, m2, m3);
    this.ring.add(this.sharp);
    this.ring.visible = false;
    this.root.add(this.ring);

    // The pin: a small open circle and a stem down to the ring, cold white over a dark edge, never hidden.
    const onTop = (hex: number, opacity: number) => {
      const m = new THREE.MeshBasicNodeMaterial();
      m.color = new THREE.Color(hex);
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = false;
      m.depthTest = false;
      m.fog = false;
      this.mats.push(m);
      return m;
    };
    const darkTop = onTop(0x07090b, 0.6), lightTop = onTop(0xeef4ff, 0.95);
    const circle = (r0: number, r1: number) => {
      const g = new THREE.RingGeometry(r0, r1, 40, 1);
      g.translate(0, 1.6, 0);
      this.geos.push(g);
      return g;
    };
    const stem = (w: number) => {
      const g = new THREE.PlaneGeometry(w, 1.0);
      g.translate(0, 0.5, 0);
      this.geos.push(g);
      return g;
    };
    const parts: Array<[THREE.BufferGeometry, THREE.Material, number]> = [
      [circle(0.36, 0.6), darkTop, 30],
      [stem(0.16), darkTop, 30],
      [circle(0.42, 0.54), lightTop, 31],
      [stem(0.06), lightTop, 31],
    ];
    for (const [g, m, order] of parts) {
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      this.pin.add(mesh);
    }
    this.pin.visible = false;
    this.root.add(this.pin);
  }

  /** Each frame: the pin faces the camera and keeps about the same size on screen. */
  update(camera: THREE.Camera) {
    if (!this.pin.visible) return;
    this.pin.quaternion.copy(camera.quaternion);
    const d = this.pin.position.distanceTo(camera.position);
    this.pin.scale.setScalar(Math.max(0.35, d * 0.012));
  }

  /**
   * The bearing: from (x0, z0) along the unit direction (dx, dz), dashes from
   * `near` to `far` metres out, lying on the ground (height(x, z)). Null hides it.
   */
  setBearing(b: { x: number; z: number; dx: number; dz: number; near: number; far: number } | null, height: (x: number, z: number) => number) {
    // Called every frame: rebuilt only when the bearing (or its range) changes.
    const L = this.laid;
    if (!b) {
      if (L.shown) this.dashGeo.setDrawRange(0, 0);
      L.shown = false;
      return;
    }
    if (L.shown && L.x === b.x && L.z === b.z && Math.abs(L.dx - b.dx) < 1e-5 && Math.abs(L.dz - b.dz) < 1e-5 && Math.abs(L.near - b.near) < 0.05 && L.far === b.far) return;
    Object.assign(L, { shown: true, x: b.x, z: b.z, dx: b.dx, dz: b.dz, near: b.near, far: b.far });
    const p = this.dashPos;
    const rx = -b.dz, rz = b.dx; // across the bearing
    let n = 0;
    for (let d = b.near; d + DASH <= b.far && n < MAX_DASHES; d += EVERY) {
      // Wider farther out, so a dash at the enemy keep still reads.
      const w0 = 0.07 + d * 0.0042, w1 = 0.07 + (d + DASH) * 0.0042;
      const ax = b.x + b.dx * d, az = b.z + b.dz * d, bx = b.x + b.dx * (d + DASH), bz = b.z + b.dz * (d + DASH);
      const ay = height(ax, az) + 0.12, by = height(bx, bz) + 0.12;
      const o = n * 12;
      p[o] = ax - rx * w0;
      p[o + 1] = ay;
      p[o + 2] = az - rz * w0;
      p[o + 3] = ax + rx * w0;
      p[o + 4] = ay;
      p[o + 5] = az + rz * w0;
      p[o + 6] = bx - rx * w1;
      p[o + 7] = by;
      p[o + 8] = bz - rz * w1;
      p[o + 9] = bx + rx * w1;
      p[o + 10] = by;
      p[o + 11] = bz + rz * w1;
      n++;
    }
    (this.dashGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    this.dashGeo.setDrawRange(0, n * 6);
    this.dashGeo.computeBoundingSphere();
  }

  /** The charge ring at a point (null hides it): soft (standard aim help) or sharp with the burst's reach (easy). */
  setRing(p: { x: number; y: number; z: number } | null, radius: number, soft: boolean) {
    this.ring.visible = !!p;
    this.pin.visible = !!p;
    if (!p) return;
    this.pin.position.set(p.x, p.y + 0.12, p.z);
    this.ring.position.set(p.x, p.y + 0.12, p.z);
    this.ring.scale.setScalar(radius);
    this.soft.visible = soft;
    this.sharp.visible = !soft;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
