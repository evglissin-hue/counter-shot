// 3.2: the marks of your own battery, drawn as chalk crosses on the ground (or on
// the masonry a shot came down on) with the mark's number standing over each, so
// they read in the sight and from the overview. A cross fades with the mark's time.
// Render only: the marks come from the worker (MatchInfo.marks, your team's alone).

import * as THREE from "three/webgpu";

const MAX = 6;
/** Chalk white, and how long (m) a cross's arms are and how wide. */
const CHALK = 0xf3eedb;
const ARM = 3.4, WIDTH = 0.42;

export interface ChalkMark {
  n: number;
  x: number;
  y: number;
  z: number;
  /** 0..1 of its life still to run. */
  life: number;
}

export class Chalk {
  readonly root = new THREE.Group();
  private slots: Array<{ g: THREE.Group; cross: THREE.Group; tag: THREE.Mesh; mats: THREE.MeshBasicNodeMaterial[]; shown: boolean }> = [];
  private geos: THREE.BufferGeometry[] = [];
  private textures: THREE.Texture[] = [];

  constructor() {
    this.root.name = "chalk-marks";
    const arm = new THREE.PlaneGeometry(2 * ARM, WIDTH);
    arm.rotateX(-Math.PI / 2);
    const tagGeo = new THREE.PlaneGeometry(1.8, 1.8);
    this.geos.push(arm, tagGeo);
    for (let i = 0; i < MAX; i++) {
      const g = new THREE.Group();
      g.name = `chalk-${i + 1}`;
      g.visible = false;
      const mats: THREE.MeshBasicNodeMaterial[] = [];
      const make = (hex: number, map?: THREE.Texture) => {
        const m = new THREE.MeshBasicNodeMaterial();
        m.color = new THREE.Color(hex);
        if (map) m.map = map;
        m.transparent = true;
        m.depthWrite = false;
        m.fog = false;
        m.polygonOffset = true;
        m.polygonOffsetFactor = -4;
        m.polygonOffsetUnits = -4;
        mats.push(m);
        return m;
      };
      const cross = new THREE.Group();
      for (const [ang, order] of [[Math.PI / 4, 23], [-Math.PI / 4, 23]] as const) {
        const a = new THREE.Mesh(arm, make(CHALK));
        a.rotation.y = ang;
        a.renderOrder = order;
        cross.add(a);
      }
      // A dark underlay a little wider, so the chalk holds against pale ground.
      for (const ang of [Math.PI / 4, -Math.PI / 4]) {
        const u = new THREE.Mesh(arm, make(0x0b0d10));
        u.rotation.y = ang;
        u.scale.set(1.04, 1, 2.1);
        u.position.y = -0.01;
        u.renderOrder = 22;
        cross.add(u);
      }
      g.add(cross);
      const tex = this.numberTexture(i + 1);
      this.textures.push(tex);
      const tag = new THREE.Mesh(tagGeo, make(0xffffff, tex));
      tag.renderOrder = 24;
      tag.position.y = 2.6;
      g.add(tag);
      this.root.add(g);
      this.slots.push({ g, cross, tag, mats, shown: false });
    }
  }

  /** The number as a white figure on a dark disc (a canvas texture). */
  private numberTexture(n: number): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgba(11, 13, 16, 0.78)";
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#f3eedb";
    ctx.stroke();
    ctx.fillStyle = "#f3eedb";
    ctx.font = "700 84px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Your team's marks as the worker last said them (none: clear). `height` is the ground's height at a point. */
  set(marks: ChalkMark[], height: (x: number, z: number) => number) {
    const have = new Set<number>();
    for (const m of marks) {
      const s = this.slots[m.n - 1];
      if (!s) continue;
      have.add(m.n);
      s.shown = true;
      s.g.visible = true;
      const ground = height(m.x, m.z);
      // On masonry the cross lies on the surface the shot hit; on the ground, on the ground.
      s.g.position.set(m.x, (m.y > ground + 0.5 ? m.y : ground) + 0.07, m.z);
      // Fades over the last fifth of its life, so a mark is plain until it is nearly gone.
      const op = Math.max(0.15, Math.min(1, m.life / 0.2));
      // The materials are the two chalk arms, the two underlays, then the number.
      s.mats.forEach((mat, k) => (mat.opacity = k < 2 ? 0.92 * op : k < 4 ? 0.55 * op : op));
    }
    for (let i = 0; i < this.slots.length; i++) {
      if (have.has(i + 1)) continue;
      this.slots[i].shown = false;
      this.slots[i].g.visible = false;
    }
  }

  /** Every frame: the numbers face the camera, and everything grows a little with distance so it reads from the overview. */
  face(cam: THREE.Camera) {
    for (const s of this.slots) {
      if (!s.shown) continue;
      const d = cam.position.distanceTo(s.g.position);
      const k = Math.max(1, Math.min(4.5, d / 70));
      s.cross.scale.setScalar(k);
      s.tag.scale.setScalar(k);
      s.tag.position.y = 2.6 * k;
      s.tag.quaternion.copy(cam.quaternion);
    }
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const t of this.textures) t.dispose();
    for (const s of this.slots) for (const m of s.mats) m.dispose();
  }
}
