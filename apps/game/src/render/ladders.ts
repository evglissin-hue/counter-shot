// Ladders (M4): weathered timber, two rails and their rungs, drawn between
// the ends the sim reports. A carried ladder rides on the crew's right
// shoulders; a planted one leans in a crenel, and once the first climber is
// over, a rope hangs down the inner face of the wall. One instanced mesh for
// the ladders and one for the ropes. Render only.

import * as THREE from "three/webgpu";
import { CASTLE_SHAPE } from "@keepfall/content";
import { LADDER_STRIDE } from "@keepfall/sim";
import { mergeGeometries } from "./geometry";
import { applyCloudShadow } from "./clouds";

const MAX = 32;
/** Length of the ladder model (m): the sim's LADDER.length. */
const LEN = 9;
const CARRIED = 0, PLANTED = 2;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);

export class Ladders {
  readonly root = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private ropes: THREE.InstancedMesh;

  constructor() {
    this.root.name = "ladders";
    const parts: THREE.BufferGeometry[] = [];
    // Two rails, a little apart at the foot, and rungs every half metre.
    for (const x of [-0.24, 0.24]) {
      const rail = new THREE.BoxGeometry(0.07, LEN, 0.075);
      rail.translate(x, LEN / 2, 0);
      parts.push(rail);
    }
    for (let k = 0; k < 17; k++) {
      const rung = new THREE.CylinderGeometry(0.024, 0.024, 0.48, 5, 1);
      rung.rotateZ(Math.PI / 2);
      rung.translate(0, 0.35 + k * 0.5, 0);
      parts.push(rung);
    }
    for (const g of parts) g.deleteAttribute("uv");
    const wood = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(wood);
    wood.name = "ladder-wood";
    wood.color = new THREE.Color(0x6a6055);
    wood.roughness = 0.92;
    this.mesh = new THREE.InstancedMesh(mergeGeometries(parts), wood, MAX);
    this.mesh.name = "ladders";
    const rope = new THREE.CylinderGeometry(0.022, 0.022, 1, 5, 1);
    rope.deleteAttribute("uv");
    rope.translate(0, -0.5, 0);
    const hemp = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(hemp);
    hemp.name = "ladder-rope";
    hemp.color = new THREE.Color(0x8a7a5c);
    hemp.roughness = 0.95;
    this.ropes = new THREE.InstancedMesh(rope, hemp, MAX);
    this.ropes.name = "ladder-ropes";
    for (const m of [this.mesh, this.ropes]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
    }
  }

  /** Every ladder of a frame (LADDER_STRIDE each). */
  update(data: Float32Array, count: number) {
    let n = 0, r = 0;
    for (let i = 0; i < count && n < MAX; i++) {
      const o = i * LADDER_STRIDE;
      const state = data[o + 2];
      let fx = data[o + 3], fy = data[o + 4], fz = data[o + 5];
      let tx = data[o + 6], ty = data[o + 7], tz = data[o + 8];
      if (state === CARRIED) {
        // On the crew's right shoulders: to the right of the way they walk, and a touch higher.
        let dx = tx - fx, dz = tz - fz;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        const rx = -dz * 0.3, rz = dx * 0.3;
        fx += rx;
        tx += rx;
        fz += rz;
        tz += rz;
        fy += 0.1;
        ty += 0.1;
      }
      _d.set(tx - fx, ty - fy, tz - fz);
      const len = _d.length() || LEN;
      _d.multiplyScalar(1 / len);
      _q.setFromUnitVectors(_y, _d);
      // Turn the rungs to lie flat to the wall (or level when carried): spin about the ladder so its width is horizontal.
      const flat = new THREE.Vector3(-_d.z, 0, _d.x);
      if (flat.lengthSq() > 1e-6) {
        flat.normalize();
        const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(_q);
        const angle = Math.atan2(new THREE.Vector3().crossVectors(xAxis, flat).dot(_d), xAxis.dot(flat));
        _q.premultiply(new THREE.Quaternion().setFromAxisAngle(_d, angle));
      }
      _s.set(1, len / LEN, 1);
      _p.set(fx, fy, fz);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(n++, _m);
      if (state === PLANTED && data[o + 9] >= 1 && r < MAX) {
        // The rope down the inner face, from the wall walk's inner edge to the ground inside.
        const inward = Math.sign(tz - fz) || 1;
        const top = CASTLE_SHAPE.wallTop;
        const rz = tz + inward * (CASTLE_SHAPE.wallThick + 0.12);
        _d.set(0, -(top + 0.05), inward * 0.7);
        const rl = _d.length();
        _d.multiplyScalar(1 / rl);
        _q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), _d);
        _p.set(tx, top + 0.05, rz);
        _s.set(1, rl, 1);
        _m.compose(_p, _q, _s);
        this.ropes.setMatrixAt(r++, _m);
      }
    }
    this.mesh.count = n;
    this.ropes.count = r;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
    if (r) this.ropes.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.mesh.count = 0;
    this.ropes.count = 0;
  }

  /** Draw one ladder and one rope out of sight, so their shaders compile while loading. */
  prime(on: boolean) {
    for (const m of [this.mesh, this.ropes]) {
      if (on && m.count === 0) {
        m.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, -500, 0));
        m.instanceMatrix.needsUpdate = true;
        m.count = 1;
        m.userData.primed = true;
      } else if (!on && m.userData.primed) {
        m.count = 0;
        m.userData.primed = false;
      }
    }
  }

  dispose() {
    for (const m of [this.mesh, this.ropes]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
