// Powder in the world as the eye sees it (3.3): kegs stacked under each
// magazine's lean-to (one for every ten charges in that castle's store, in
// plain sight of both sides), and the hoist at a gun's foot: a rope hanging
// from the gun and a keg rising along it (or, at a mortar pit, a keg sliding
// in to the pit's edge). Render only: it reads the numbers the page was sent
// (MatchInfo.powder and .boxes) and decides nothing.

import * as THREE from "three/webgpu";
import { magazineDoor, powderFoot, type Emplacement } from "@keepfall/content";
import { BOX_STRIDE, type PowderInfo } from "../protocol";
import { applyCloudShadow } from "./clouds";
import { makeKegGeometry, makeKegMaterial } from "./estate";
import { hoistKeg, kegsFor, MAX_STACK, ropeTop, stackSlot } from "./powderLogic";

const MAX_HOISTS = 10;

export class PowderView {
  readonly root = new THREE.Group();
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  /** Kegs under the lean-tos: up to MAX_STACK for each castle. */
  private stacks: THREE.InstancedMesh;
  /** Kegs on their way up, and the ropes they ride. */
  private lifted: THREE.InstancedMesh;
  private ropes: THREE.InstancedMesh;
  private stores: [PowderInfo, PowderInfo] | null = null;
  private boxes: Float32Array | null = null;
  private emps: Emplacement[] = [];
  private feet: Array<{ x: number; z: number }> = [];
  /** The share of each emplacement's hoist drawn now (eased between the page's updates), or -1. */
  private shown: Float32Array = new Float32Array(0);
  private stackKey = "";

  constructor() {
    this.root.name = "powder";
    const kegGeo = makeKegGeometry();
    this.geos.push(kegGeo);
    const kegMat = makeKegMaterial();
    this.mats.push(kegMat);
    this.stacks = new THREE.InstancedMesh(kegGeo, kegMat, MAX_STACK * 2);
    this.lifted = new THREE.InstancedMesh(kegGeo, kegMat, MAX_HOISTS);
    const rope = new THREE.CylinderGeometry(0.018, 0.018, 1, 4, 1);
    rope.deleteAttribute("uv");
    this.geos.push(rope);
    const ropeMat = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(ropeMat);
    ropeMat.color = new THREE.Color(0x9a8a6a);
    ropeMat.roughness = 0.95;
    this.mats.push(ropeMat);
    this.ropes = new THREE.InstancedMesh(rope, ropeMat, MAX_HOISTS);
    for (const m of [this.stacks, this.lifted, this.ropes]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      this.root.add(m);
    }
  }

  /** Every emplacement of the match, in match order (the order of MatchInfo.boxes). */
  setEmplacements(list: Emplacement[]) {
    this.emps = list;
    this.feet = list.map((e) => powderFoot(e));
    this.shown = new Float32Array(list.length).fill(-1);
  }

  /** What the page was last sent: each castle's store and every emplacement's box (null: no powder in this match). */
  set(powder: [PowderInfo, PowderInfo] | null, boxes: Float32Array | null) {
    this.stores = powder;
    this.boxes = boxes;
  }

  /** A new world: nothing stands, nothing is hoisted. */
  clear() {
    this.stores = null;
    this.boxes = null;
    this.shown.fill(-1);
    this.stackKey = "";
    this.stacks.count = 0;
    this.lifted.count = 0;
    this.ropes.count = 0;
  }

  private placeStacks() {
    const s = this.stores;
    let key = "";
    const plan: number[] = [];
    for (let c = 0; c < 2; c++) {
      const st = s ? s[c] : null;
      const plot = st ? st.magazine : -1;
      const n = st ? kegsFor(st.stock, plot >= 0) : 0;
      plan.push(plot, n);
      key += `${plot}:${n};`;
    }
    if (key === this.stackKey) return;
    this.stackKey = key;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)); // lying, its axis along x
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    let k = 0;
    for (let c = 0; c < 2; c++) {
      const plot = plan[c * 2], n = plan[c * 2 + 1];
      if (plot < 0) continue;
      const door = magazineDoor(c, plot);
      for (let i = 0; i < n; i++) {
        const slot = stackSlot(i);
        // A little in towards the plot's wall, so the stack sits under the lean-to's roof.
        p.set(door.x + (door.x > 0 ? -0.3 : 0.3), slot.y, door.z + slot.along);
        m.compose(p, q, one);
        this.stacks.setMatrixAt(k++, m);
      }
    }
    this.stacks.count = k;
    this.stacks.instanceMatrix.needsUpdate = true;
  }

  /** Every rendered frame: the stacks as the stores stand, the hoists as far along as the page says. */
  update(dt: number) {
    this.placeStacks();
    const b = this.boxes;
    const ease = 1 - Math.exp(-dt * 14);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qUp = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const dir = new THREE.Vector3();
    let n = 0, r = 0;
    for (let i = 0; i < this.emps.length; i++) {
      const target = b && (i + 1) * BOX_STRIDE <= b.length ? b[i * BOX_STRIDE + 4] : -1;
      let share = this.shown[i];
      if (target < 0) share = -1;
      else if (share < 0 || target < share - 0.05) share = target;
      else share += (target - share) * ease;
      this.shown[i] = share;
      if (share < 0 || n >= MAX_HOISTS) continue;
      const e = this.emps[i];
      const foot = this.feet[i];
      const at = hoistKeg(share, foot, e);
      p.set(at.x, at.y, at.z);
      m.compose(p, q.identity(), sc.set(1, 1, 1));
      this.lifted.setMatrixAt(n, m);
      n++;
      if (at.rope) {
        const top = ropeTop(e);
        dir.set(top.x - foot.x, top.y - 0.05, top.z - foot.z);
        const len = dir.length();
        p.set((top.x + foot.x) / 2, (top.y + 0.05) / 2, (top.z + foot.z) / 2);
        qUp.setFromUnitVectors(up, dir.multiplyScalar(1 / len));
        m.compose(p, qUp, sc.set(1, len, 1));
        this.ropes.setMatrixAt(r++, m);
      }
    }
    this.lifted.count = n;
    this.ropes.count = r;
    if (n) this.lifted.instanceMatrix.needsUpdate = true;
    if (r) this.ropes.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
