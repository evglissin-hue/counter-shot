// A structure going down, as the world tells it (3.4), render only: dark cracks across the weakest course past
// STRUCTURE.cracks, dust trickling from it past STRUCTURE.dust, and the great cloud where a fall lands. The cloud is
// built from a few of the bursts the renderer already has (see eye.ts cloudPlan), standing for the hundreds of stones
// that turn to dust at once, so a fall never costs a frame more than a shell's burst does.

import * as THREE from "three/webgpu";
import { EventKind } from "@keepfall/sim";
import { cloudPlan, landing, tells, type Puff, type PuffKind } from "../eye";
import type { StructureInfo } from "../protocol";

export type Spawn = (kind: PuffKind | "trickle", x: number, y: number, z: number, scale: number, dx: number, dy: number, dz: number) => void;

/** A few dark jagged lines on a clear ground, drawn once. */
function crackTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  g.clearRect(0, 0, 256, 64);
  g.strokeStyle = "rgba(12,9,7,0.92)";
  g.lineCap = "round";
  g.lineJoin = "round";
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 7; k++) {
    let x = 12 + k * 36 + rnd() * 14, y = 0;
    g.lineWidth = 2 + rnd() * 2;
    g.beginPath();
    g.moveTo(x, y);
    while (y < 64) {
      y += 6 + rnd() * 9;
      x += (rnd() - 0.5) * 16;
      g.lineTo(x, Math.min(64, y));
      if (rnd() < 0.25) {
        // A branch.
        g.moveTo(x, y);
        g.lineTo(x + (rnd() - 0.5) * 26, y + 6 + rnd() * 8);
        g.moveTo(x, y);
      }
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

interface Crack {
  mesh: THREE.Mesh;
  course: number;
}

export class Collapse {
  readonly root = new THREE.Group();
  private cracks = new Map<number, Crack>();
  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private cylGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
  private mat = new THREE.MeshBasicNodeMaterial();
  private tex: THREE.Texture | null;
  /** The puffs of the clouds still to come: [due (renderer seconds), puff, x, y, z, along dir x, along dir z]. */
  private queue: Array<{ due: number; puff: Puff; x: number; y: number; z: number; dx: number; dz: number }> = [];
  private dust = new Map<number, number>();
  /** The last fall direction a Topple told, per structure. */
  private dirs = new Map<number, [number, number]>();
  /** Puffs spawned by the last update (a test and a measure). */
  spawned = 0;

  constructor(private spawn: Spawn) {
    this.root.name = "collapse";
    this.tex = crackTexture();
    this.mat.name = "cracks";
    this.mat.transparent = true;
    this.mat.depthWrite = false;
    this.mat.fog = false;
    this.mat.polygonOffset = true;
    this.mat.polygonOffsetFactor = -2;
    this.mat.polygonOffsetUnits = -2;
    if (this.tex) this.mat.map = this.tex;
    else this.mat.color = new THREE.Color(0x120d09);
    this.mat.opacity = 0.9;
  }

  /** The world's tells for the structures as last reported: cracks where the weakest course is past STRUCTURE.cracks. */
  setStructures(list: readonly StructureInfo[]) {
    for (const s of list) {
      const t = tells(s);
      let c = this.cracks.get(s.index);
      if (!t.cracks) {
        if (c) c.mesh.visible = false;
        continue;
      }
      const n = s.heat.length || 1;
      const ch = (s.topY - s.baseY) / n;
      if (!c) {
        const mesh = new THREE.Mesh(s.kind === "keep" ? this.boxGeo : this.cylGeo, this.mat);
        mesh.renderOrder = 8;
        mesh.frustumCulled = false;
        this.root.add(mesh);
        c = { mesh, course: -1 };
        this.cracks.set(s.index, c);
      }
      c.mesh.visible = true;
      c.course = t.course;
      // Two courses tall, hugging the wall a hair outside it.
      const r = s.half + 0.05;
      const y = s.baseY + (t.course + 0.5) * ch;
      c.mesh.position.set(s.cx, y, s.cz);
      c.mesh.scale.set(s.kind === "keep" ? r * 2 : r, ch * 2.4, s.kind === "keep" ? r * 2 : r);
    }
  }

  /** Dust trickling from structures past STRUCTURE.dust, a few puffs a second, at a spot on the weakest course. */
  update(now: number, dt: number, list: readonly StructureInfo[], ground: (x: number, z: number) => number) {
    this.spawned = 0;
    for (const s of list) {
      const t = tells(s);
      if (!t.dust) continue;
      const n = s.heat.length || 1;
      const ch = (s.topY - s.baseY) / n;
      const acc = (this.dust.get(s.index) ?? 0) + dt * 5;
      if (acc >= 1) {
        const a = Math.random() * Math.PI * 2;
        const rr = s.half + 0.1;
        const x = s.kind === "keep" ? s.cx + Math.max(-rr, Math.min(rr, Math.cos(a) * rr * 1.4)) : s.cx + Math.cos(a) * rr;
        const z = s.kind === "keep" ? s.cz + Math.max(-rr, Math.min(rr, Math.sin(a) * rr * 1.4)) : s.cz + Math.sin(a) * rr;
        this.spawn("trickle", x, s.baseY + (t.course + 0.2) * ch, z, 1.2, 0, -1, 0);
        this.spawned++;
        this.dust.set(s.index, acc - 1);
      } else this.dust.set(s.index, acc);
    }
    const q = this.queue;
    for (let i = q.length - 1; i >= 0; i--) {
      const e = q[i];
      if (e.due > now) continue;
      q.splice(i, 1);
      const w = 5 * 0.6;
      const x = e.x + e.dx * e.puff.along * w + -e.dz * e.puff.across * w;
      const z = e.z + e.dz * e.puff.along * w + e.dx * e.puff.across * w;
      const y = Math.max(e.y, ground(x, z)) + 0.3;
      this.spawn(e.puff.kind, x, y, z, e.puff.scale, 0, e.puff.kind === "column" ? 1 : 0.3, 0);
      this.spawned++;
    }
  }

  /** A structure event of a frame (Topple, Crush, Released): the lean's direction is remembered; a release or a crush raises the great cloud. Returns where it lands, or null. */
  event(kind: number, a: number, b: number, c: number, d: number, list: readonly StructureInfo[], now: number): { x: number; z: number; y: number } | null {
    const s = list[a | 0];
    if (kind === EventKind.Topple) {
      this.dirs.set(a | 0, [c, d]);
      return null;
    }
    if (!s || (kind !== EventKind.Released && kind !== EventKind.Crush)) return null;
    const dir = kind === EventKind.Crush ? [0, 0] : (this.dirs.get(a | 0) ?? [s.dirX, s.dirZ]);
    const at = landing(s, dir[0], dir[1]);
    const len = Math.hypot(dir[0], dir[1]) || 1;
    const k = s.kind === "keep" ? 1 : 0.6;
    for (const puff of cloudPlan(k)) this.queue.push({ due: now + puff.t, puff, x: at.x, y: at.y, z: at.z, dx: dir[0] / len, dz: dir[1] / len });
    return at;
  }

  /** The renderer started again (a new world, a replay seek): forget what was queued. */
  clear() {
    this.queue.length = 0;
    this.dust.clear();
    this.dirs.clear();
    for (const c of this.cracks.values()) c.mesh.visible = false;
  }

  dispose() {
    this.boxGeo.dispose();
    this.cylGeo.dispose();
    this.mat.dispose();
    this.tex?.dispose();
  }
}
