// Drawing the mason's eye (3.4): thin translucent bands course by course on a keep or a tower from cool to hot, a plumb
// line from the centre of mass of what stands above the weakest course down to its footing, the footing's edge (drawn
// in), and an arrow where it would fall. Render only; eye.ts decides what to show. Cheap: one instanced mesh of bands
// and one of beams per structure shown, rebuilt only when the structure's report changes.

import * as THREE from "three/webgpu";
import { drawnIn, heatColor } from "../eye";
import type { StructureInfo } from "../protocol";

const BEAMS = 56;
const BAND_FILL = 0.92;
const HUG = 0.12;

interface View {
  group: THREE.Group;
  bands: THREE.InstancedMesh;
  beams: THREE.InstancedMesh;
  keep: boolean;
  /** The report these were built from (rebuilt when a newer one arrives). */
  from: StructureInfo | null;
}

export class MasonEye {
  readonly root = new THREE.Group();
  private views = new Map<number, View>();
  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private cylGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, false);
  private beamGeo = new THREE.BoxGeometry(1, 1, 1);
  private bandMat = new THREE.MeshBasicNodeMaterial();
  private beamMat = new THREE.MeshBasicNodeMaterial();
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();

  constructor() {
    this.root.name = "mason-eye";
    this.bandMat.name = "eye-bands";
    this.bandMat.transparent = true;
    this.bandMat.opacity = 0.3;
    this.bandMat.depthWrite = false;
    this.bandMat.fog = false;
    this.beamMat.name = "eye-beams";
    this.beamMat.transparent = true;
    this.beamMat.opacity = 0.95;
    this.beamMat.depthWrite = false;
    this.beamMat.depthTest = false;
    this.beamMat.fog = false;
  }

  private view(s: StructureInfo): View {
    let v = this.views.get(s.index);
    if (v) return v;
    const keep = s.kind === "keep";
    const group = new THREE.Group();
    group.name = `eye-${s.index}`;
    const bands = new THREE.InstancedMesh(keep ? this.boxGeo : this.cylGeo, this.bandMat, Math.max(1, s.heat.length));
    bands.renderOrder = 19;
    bands.frustumCulled = false;
    bands.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, s.heat.length) * 3), 3);
    const beams = new THREE.InstancedMesh(this.beamGeo, this.beamMat, BEAMS);
    beams.renderOrder = 20;
    beams.frustumCulled = false;
    beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BEAMS * 3), 3);
    beams.count = 0;
    group.add(bands, beams);
    this.root.add(group);
    v = { group, bands, beams, keep, from: null };
    this.views.set(s.index, v);
    return v;
  }

  /** Show the eye on these structures (indices into `list`) and hide it elsewhere. */
  set(list: readonly StructureInfo[], targets: readonly number[]) {
    const want = new Set(targets);
    for (const [i, v] of this.views) if (!want.has(i)) v.group.visible = false;
    for (const i of targets) {
      const s = list[i];
      if (!s) continue;
      const v = this.view(s);
      v.group.visible = true;
      if (v.from === s) continue;
      v.from = s;
      this.build(v, s);
    }
  }

  clear() {
    for (const v of this.views.values()) v.group.visible = false;
  }

  private build(v: View, s: StructureInfo) {
    const n = s.heat.length || 1;
    const ch = (s.topY - s.baseY) / n;
    const r = s.half + HUG;
    const d = this.dummy, c = this.col;
    for (let k = 0; k < n; k++) {
      const h = s.heat[k] ?? 0;
      d.position.set(s.cx, s.baseY + (k + 0.5) * ch, s.cz);
      d.rotation.set(0, 0, 0);
      d.quaternion.identity();
      if (v.keep) d.scale.set(r * 2, ch * BAND_FILL, r * 2);
      else d.scale.set(r, ch * BAND_FILL, r);
      d.updateMatrix();
      v.bands.setMatrixAt(k, d.matrix);
      const [cr, cg, cb] = heatColor(h);
      c.setRGB(cr, cg, cb);
      v.bands.setColorAt(k, c);
    }
    v.bands.count = n;
    v.bands.instanceMatrix.needsUpdate = true;
    if (v.bands.instanceColor) v.bands.instanceColor.needsUpdate = true;

    let b = 0;
    const beam = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, rgb: [number, number, number]) => {
      if (b >= BEAMS) return;
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      if (len < 1e-4) return;
      d.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      d.lookAt(bx, by, bz);
      d.scale.set(t, t, len);
      d.updateMatrix();
      v.beams.setMatrixAt(b, d.matrix);
      c.setRGB(rgb[0], rgb[1], rgb[2]);
      v.beams.setColorAt(b, c);
      b++;
    };
    // Untouched (no damaged course): all cool, no plumb line, no footing.
    if (s.weakest >= 0) {
      const out = s.margin < s.drawIn;
      // The plumb line: from the centre of mass of what stands above to the footing's level.
      beam(s.comX, s.comY, s.comZ, s.comX, s.footY, s.comZ, 0.16, out ? [1, 0.3, 0.2] : [1, 0.95, 0.75]);
      const foot = drawnIn(s.hull, s.drawIn);
      const y = s.footY + 0.05;
      for (let k = 0; k < foot.length; k += 2) {
        const j = (k + 2) % foot.length;
        beam(foot[k], y, foot[k + 1], foot[j], y, foot[j + 1], 0.12, [0.55, 0.95, 0.75]);
      }
      // The arrow: where it would fall, from the structure's middle at the footing.
      if (s.toppleNear > 0.2 && (s.dirX !== 0 || s.dirZ !== 0)) {
        const len = 6 + s.half;
        const ex = s.cx + s.dirX * len, ez = s.cz + s.dirZ * len;
        const ay = s.footY + 0.3;
        beam(s.cx, ay, s.cz, ex, ay, ez, 0.3, [1, 0.45, 0.12]);
        const px = -s.dirZ, pz = s.dirX;
        beam(ex, ay, ez, ex - s.dirX * 1.8 + px * 1.1, ay, ez - s.dirZ * 1.8 + pz * 1.1, 0.3, [1, 0.45, 0.12]);
        beam(ex, ay, ez, ex - s.dirX * 1.8 - px * 1.1, ay, ez - s.dirZ * 1.8 - pz * 1.1, 0.3, [1, 0.45, 0.12]);
      }
    }
    v.beams.count = b;
    v.beams.instanceMatrix.needsUpdate = true;
    if (v.beams.instanceColor) v.beams.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.boxGeo.dispose();
    this.cylGeo.dispose();
    this.beamGeo.dispose();
    this.bandMat.dispose();
    this.beamMat.dispose();
    for (const v of this.views.values()) {
      v.bands.dispose();
      v.beams.dispose();
    }
  }
}
