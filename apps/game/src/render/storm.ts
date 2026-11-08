// The storm ring (M4): a ring on the ground of a courtyard being stormed, in
// the attackers' colour, filling round as they hold it (full: stormed), over
// a faint dark ring that shows how far there is to go. It brightens while the
// attackers outnumber the defenders and dims while their storm is held up.
// Readable from the guns and from the overview. Render only.

import * as THREE from "three/webgpu";
import { courtyardMiddle } from "./works";
import { TEAM_COLORS } from "./minions";

const SEGMENTS = 96;
/** It lies in the open ground between the gate and the keep, between the houses. */
const RADIUS = 3.7;

interface Ring {
  group: THREE.Group;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicNodeMaterial;
  shown: number;
  target: number;
  live: boolean;
}

export class Storm {
  readonly root = new THREE.Group();
  private rings: Ring[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  constructor() {
    this.root.name = "storm-rings";
    const base = new THREE.RingGeometry(RADIUS - 0.36, RADIUS + 0.36, SEGMENTS, 1);
    base.rotateX(-Math.PI / 2);
    this.geos.push(base);
    for (let c = 0; c < 2; c++) {
      // Each ring fills on its own: its own geometry for its draw range.
      const fill = new THREE.RingGeometry(RADIUS - 0.26, RADIUS + 0.26, SEGMENTS, 1, Math.PI / 2, Math.PI * 2);
      fill.rotateX(-Math.PI / 2);
      this.geos.push(fill);
      const group = new THREE.Group();
      group.name = `storm-ring-${c}`;
      const m = courtyardMiddle(c);
      group.position.set(m.x, 0.07, m.z);
      const dark = new THREE.MeshBasicNodeMaterial();
      dark.color = new THREE.Color(0x07090b);
      dark.transparent = true;
      dark.opacity = 0.5;
      dark.depthWrite = false;
      dark.fog = false;
      dark.polygonOffset = true;
      dark.polygonOffsetFactor = -4;
      dark.polygonOffsetUnits = -4;
      // The attackers of castle c are the other team.
      const fm = new THREE.MeshBasicNodeMaterial();
      fm.color = new THREE.Color(TEAM_COLORS[1 - c]).multiplyScalar(1.6);
      fm.transparent = true;
      fm.opacity = 0.9;
      fm.depthWrite = false;
      fm.fog = false;
      fm.polygonOffset = true;
      fm.polygonOffsetFactor = -5;
      fm.polygonOffsetUnits = -5;
      this.mats.push(dark, fm);
      const b = new THREE.Mesh(base, dark);
      b.renderOrder = 20;
      const f = new THREE.Mesh(fill, fm);
      f.renderOrder = 21;
      group.add(b, f);
      group.visible = false;
      this.root.add(group);
      this.rings.push({ group, fill: f, fillMat: fm, shown: 0, target: 0, live: false });
    }
  }

  /** How far the storm of castle c's courtyard has gone (0..1), and whether the attackers outnumber its defenders now. */
  set(castle: number, progress: number, holding: boolean) {
    const r = this.rings[castle];
    if (!r) return;
    r.target = Math.max(0, Math.min(1, progress));
    r.live = holding;
  }

  update(dt: number, time: number) {
    for (const r of this.rings) {
      r.shown += (r.target - r.shown) * Math.min(1, dt * 6);
      if (r.target <= 0 && r.shown < 0.004) r.shown = 0;
      r.group.visible = r.shown > 0;
      if (!r.group.visible) continue;
      // Draw the filled share of the ring: the first segments of its index list.
      const segs = Math.max(1, Math.round(SEGMENTS * r.shown));
      r.fill.geometry.setDrawRange(0, segs * 6);
      r.fillMat.opacity = r.live ? 0.75 + 0.2 * Math.sin(time * 6) : 0.4;
    }
  }

  /** Show a ring out of sight, so its shaders compile while loading. */
  prime(on: boolean) {
    const r = this.rings[0];
    if (on && !r.group.visible) {
      r.group.userData.y = r.group.position.y;
      r.group.position.y = -500;
      r.group.visible = true;
      r.group.userData.primed = true;
    } else if (!on && r.group.userData.primed) {
      r.group.position.y = r.group.userData.y;
      r.group.visible = r.shown > 0;
      r.group.userData.primed = false;
    }
  }

  clear() {
    for (const r of this.rings) {
      r.shown = r.target = 0;
      r.group.visible = false;
    }
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
