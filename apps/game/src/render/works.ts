// Repairs on screen (M4). Where a castle's masons are at work a gin pole
// stands over the damage: two timber legs from the courtyard leaning over the
// wall to an apex a little above the next stone's place (taller than the
// wall, so it shows from outside), with the hoist rope hanging from it. Each
// stone the masons put back rises on the rope from the foot of the hoist,
// swings over into its place and settles with a puff of mortar dust; rubble
// they carry off leaves its heap in a puff. Render only: the sim has already
// put the stone back, this only draws how it got there.

import * as THREE from "three/webgpu";
import { CASTLE_SHAPE, mirrorZ, type CastleLayout } from "@keepfall/content";
import { WORKS_STRIDE } from "@keepfall/sim";
import type { StoneSet } from "./stones";

/** Seconds a stone takes from the hoist's foot to its place (the page times its sound to this). */
export const LAY_SECONDS = 1.15;

interface Lay {
  id: number;
  start: number;
  /** Where it starts (the hoist's foot), the height it travels at, and where it goes. */
  fx: number;
  fy: number;
  fz: number;
  hy: number;
  tx: number;
  ty: number;
  tz: number;
  q: THREE.Quaternion;
  /** Its rotation on the way up: a little askew, levelling as it settles. */
  q0: THREE.Quaternion;
  castle: number;
}

interface Hoist {
  group: THREE.Group;
  legs: THREE.Mesh[];
  bar: THREE.Mesh;
  rope: THREE.Mesh;
  /** The apex (where the rope hangs from) and the foot of the work. */
  apex: THREE.Vector3;
  foot: THREE.Vector3;
  shown: boolean;
}

/** Fields per hoist and per lay in a captured state. */
const HOIST_FIELDS = 7 + 4 * 10;
const LAY_FIELDS = 18;

/** What the masons' works remember, for a keyframe. */
export interface WorksState {
  hoists: Float64Array;
  lays: Float64Array;
  lastFoot: number[][];
}

const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);

export class Works {
  readonly root = new THREE.Group();
  private hoists: Hoist[] = [];
  private lays: Lay[] = [];
  private out = new Float32Array(8);
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  /** Where each castle's masons last worked (for a stone laid after the work there has finished). */
  private lastFoot: Array<{ x: number; z: number } | null> = [null, null];
  /** Puffs of dust wanted this frame: [x, y, z, size] (the renderer spawns them). */
  readonly puffs: number[] = [];

  constructor(private layout: CastleLayout) {
    this.root.name = "works";
    const leg = new THREE.CylinderGeometry(0.1, 0.13, 1, 6, 1);
    leg.deleteAttribute("uv");
    leg.translate(0, 0.5, 0);
    const bar = new THREE.CylinderGeometry(0.09, 0.09, 1, 6, 1);
    bar.deleteAttribute("uv");
    bar.rotateZ(Math.PI / 2);
    const rope = new THREE.CylinderGeometry(0.028, 0.028, 1, 4, 1);
    rope.deleteAttribute("uv");
    rope.translate(0, -0.5, 0);
    this.geos.push(leg, bar, rope);
    const wood = new THREE.MeshStandardNodeMaterial();
    wood.name = "hoist-wood";
    wood.color = new THREE.Color(0x5d554b);
    wood.roughness = 0.9;
    const hemp = new THREE.MeshStandardNodeMaterial();
    hemp.name = "hoist-rope";
    hemp.color = new THREE.Color(0x8a7a5c);
    hemp.roughness = 0.95;
    this.mats.push(wood, hemp);
    for (let k = 0; k < 2; k++) {
      const group = new THREE.Group();
      group.name = `hoist-${k}`;
      const legs = [new THREE.Mesh(leg, wood), new THREE.Mesh(leg, wood)];
      const b = new THREE.Mesh(bar, wood);
      const r = new THREE.Mesh(rope, hemp);
      for (const m of [...legs, b, r]) {
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
      group.visible = false;
      this.root.add(group);
      this.hoists.push({ group, legs, bar: b, rope: r, apex: new THREE.Vector3(), foot: new THREE.Vector3(), shown: false });
    }
  }

  /** Repairs under way in a frame (WORKS_STRIDE each): place each castle's hoist. */
  update(data: Float32Array, count: number) {
    const seen = [false, false];
    for (let i = 0; i < count; i++) {
      const o = i * WORKS_STRIDE;
      const c = data[o] | 0;
      if (c < 0 || c > 1) continue;
      seen[c] = true;
      const sx = data[o + 1], sy = data[o + 2], sz = data[o + 3], wx = data[o + 4], wz = data[o + 5];
      this.lastFoot[c] = { x: wx, z: wz };
      this.place(this.hoists[c], sx, sy, sz, wx, wz, c);
    }
    for (let c = 0; c < 2; c++) {
      // A hoist stays up while a stone it lifted is still on its way.
      const busy = this.lays.some((l) => l.castle === c);
      if (!seen[c] && !busy) this.hoists[c].group.visible = this.hoists[c].shown = false;
    }
  }

  /** The gin pole for a stone at (sx, sy, sz) worked from (wx, wz). */
  private place(h: Hoist, sx: number, sy: number, sz: number, wx: number, wz: number, castle: number) {
    // The apex leans out over the place, a little to the courtyard side of it, and stands taller than the wall.
    let dx = sx - wx, dz = sz - wz;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    const top = Math.max(sy + 1.9, CASTLE_SHAPE.wallTop + 1.6);
    h.apex.set(sx - dx * 0.5, top, sz - dz * 0.5);
    h.foot.set(wx - dx * 0.6, 0, wz - dz * 0.6);
    // Two legs from the ground either side of the foot, square to the line to the wall.
    const px = -dz * 1.3, pz = dx * 1.3;
    const ends = [
      [h.foot.x + px, h.foot.z + pz],
      [h.foot.x - px, h.foot.z - pz],
    ];
    h.legs.forEach((leg, k) => {
      _p.set(ends[k][0], 0, ends[k][1]);
      _v.copy(h.apex).sub(_p);
      const len = _v.length();
      _q.setFromUnitVectors(_y, _v.multiplyScalar(1 / len));
      leg.position.copy(_p);
      leg.quaternion.copy(_q);
      leg.scale.set(1, len + 0.25, 1);
    });
    // The crossbar at the apex, along the line between the legs' feet.
    h.bar.position.copy(h.apex);
    h.bar.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-dz, 0, dx));
    h.bar.scale.set(0.9, 1, 1);
    // The rope hangs to the foot of the work unless a stone is on it (set every frame by animate).
    this.rope(h, h.foot.y + 0.3);
    h.group.visible = h.shown = true;
    void castle;
  }

  private rope(h: Hoist, bottom: number) {
    const len = Math.max(0.3, h.apex.y - bottom);
    h.rope.position.copy(h.apex);
    h.rope.quaternion.identity();
    h.rope.scale.set(1, len, 1);
  }

  /** Masons put a piece back (the Laid event): from where its body lay (y < -100: from dust) to its place. */
  laid(id: number, now: number, wx: number, wy: number, wz: number) {
    const s = this.layout.stones[id];
    if (!s || s.castle > 1) return;
    const c = s.castle as 0 | 1;
    const h = this.hoists[c];
    // From the foot of the hoist (or of the last work there, or just inside the wall).
    let fx: number, fz: number;
    if (h.shown) {
      fx = h.foot.x;
      fz = h.foot.z;
    } else if (this.lastFoot[c]) {
      fx = this.lastFoot[c]!.x;
      fz = this.lastFoot[c]!.z;
    } else {
      const cz = this.layout.castleZ[c];
      const dx = -s.x, dz = cz - s.z, dl = Math.hypot(dx, dz) || 1;
      fx = s.x + (dx / dl) * 1.8;
      fz = s.z + (dz / dl) * 1.8;
    }
    // Inside the keep, the floors come in over its walls.
    const over = s.part === "storey" ? this.layout.keepTop + 1.2 : s.y + 0.6;
    const q = new THREE.Quaternion(s.q[0], s.q[1], s.q[2], s.q[3]);
    const q0 = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0.4).normalize(), 0.22));
    this.lays.push({ id, start: now, fx, fy: s.hy + 0.05, fz, hy: over, tx: s.x, ty: s.y, tz: s.z, q, q0, castle: c });
    if (wy > -100 && Math.hypot(wx - s.x, wz - s.z) < 30) this.puffs.push(wx, wy, wz, 0.7);
  }

  /** Rubble carried off (the Cleared event): a puff where it lay. */
  cleared(x: number, y: number, z: number) {
    this.puffs.push(x, y, z, 0.9);
  }

  /** Draw every stone on its way (call each frame after the frame's own stone positions are in). */
  animate(now: number, stones: StoneSet) {
    const o = this.out;
    for (let k = this.lays.length - 1; k >= 0; k--) {
      const L = this.lays[k];
      const t = (now - L.start) / LAY_SECONDS;
      let x: number, y: number, z: number;
      const qq = _q;
      if (t >= 1) {
        x = L.tx;
        y = L.ty;
        z = L.tz;
        qq.copy(L.q);
        this.lays.splice(k, 1);
        this.puffs.push(x, y + 0.1, z, 0.55);
      } else if (t < 0.62) {
        // Up the rope from the foot of the hoist.
        const u = t / 0.62;
        const e = u * u * (3 - 2 * u);
        x = L.fx;
        z = L.fz;
        y = L.fy + (L.hy - L.fy) * e;
        qq.copy(L.q0);
        this.rope(this.hoists[L.castle], y + 0.4);
      } else {
        // Over and down into its place.
        const u = (t - 0.62) / 0.38;
        const e = u * u * (3 - 2 * u);
        x = L.fx + (L.tx - L.fx) * e;
        z = L.fz + (L.tz - L.fz) * e;
        y = L.hy + (L.ty - L.hy) * e * e;
        qq.copy(L.q0).slerp(L.q, e);
        this.rope(this.hoists[L.castle], y + 0.4);
      }
      o[0] = L.id;
      o[1] = x;
      o[2] = y;
      o[3] = z;
      o[4] = qq.x;
      o[5] = qq.y;
      o[6] = qq.z;
      o[7] = qq.w;
      stones.updateBodies(o, 1);
    }
  }

  /**
   * Keyframe (S3): per hoist whether it stands, its apex, foot and the transform of its four
   * timbers (position, rotation, scale), the stones on their way (with their age), and where
   * each castle's masons last worked.
   */
  captureState(now: number): WorksState {
    const hoists = new Float64Array(this.hoists.length * HOIST_FIELDS);
    this.hoists.forEach((h, i) => {
      const r = i * HOIST_FIELDS;
      hoists[r] = h.shown ? 1 : 0;
      h.apex.toArray(hoists, r + 1);
      h.foot.toArray(hoists, r + 4);
      [...h.legs, h.bar, h.rope].forEach((m, k) => {
        const o = r + 7 + k * 10;
        m.position.toArray(hoists, o);
        m.quaternion.toArray(hoists, o + 3);
        m.scale.toArray(hoists, o + 7);
      });
    });
    const lays = new Float64Array(this.lays.length * LAY_FIELDS);
    this.lays.forEach((L, i) => {
      lays.set([L.id, now - L.start, L.fx, L.fy, L.fz, L.hy, L.tx, L.ty, L.tz, L.q.x, L.q.y, L.q.z, L.q.w, L.q0.x, L.q0.y, L.q0.z, L.q0.w, L.castle], i * LAY_FIELDS);
    });
    return { hoists, lays, lastFoot: this.lastFoot.map((f) => (f ? [f.x, f.z] : [])) };
  }

  /** Keyframe (S3): hoists and stones in the lift as captured. */
  restoreState(st: WorksState, now: number) {
    this.clear();
    this.hoists.forEach((h, i) => {
      const r = i * HOIST_FIELDS;
      h.shown = st.hoists[r] > 0.5;
      h.group.visible = h.shown;
      h.apex.fromArray(st.hoists, r + 1);
      h.foot.fromArray(st.hoists, r + 4);
      [...h.legs, h.bar, h.rope].forEach((m, k) => {
        const o = r + 7 + k * 10;
        m.position.fromArray(st.hoists, o);
        m.quaternion.fromArray(st.hoists, o + 3);
        m.scale.fromArray(st.hoists, o + 7);
      });
    });
    for (let i = 0; i * LAY_FIELDS < st.lays.length; i++) {
      const r = i * LAY_FIELDS, a = st.lays;
      this.lays.push({
        id: a[r],
        start: now - a[r + 1],
        fx: a[r + 2],
        fy: a[r + 3],
        fz: a[r + 4],
        hy: a[r + 5],
        tx: a[r + 6],
        ty: a[r + 7],
        tz: a[r + 8],
        q: new THREE.Quaternion(a[r + 9], a[r + 10], a[r + 11], a[r + 12]),
        q0: new THREE.Quaternion(a[r + 13], a[r + 14], a[r + 15], a[r + 16]),
        castle: a[r + 17],
      });
    }
    this.lastFoot = st.lastFoot.map((f) => (f.length ? { x: f[0], z: f[1] } : null)) as Array<{ x: number; z: number } | null>;
  }

  /** Show a hoist out of sight, so its shaders compile while loading. */
  prime(on: boolean) {
    const h = this.hoists[0];
    if (on && !h.shown) {
      h.group.position.set(0, -500, 0);
      h.group.visible = true;
      h.group.userData.primed = true;
    } else if (!on && h.group.userData.primed) {
      h.group.position.set(0, 0, 0);
      h.group.visible = h.shown;
      h.group.userData.primed = false;
    }
  }

  clear() {
    this.lays = [];
    this.lastFoot = [null, null];
    this.puffs.length = 0;
    for (const h of this.hoists) h.group.visible = h.shown = false;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

/** Where a castle's storm ring lies (world): the open ground between its gate and its keep (local (0, -8)). */
export function courtyardMiddle(castle: number): { x: number; z: number } {
  return { x: 0, z: mirrorZ(castle, -8) };
}
