// Crows (look round L3.4): tiny dark flapping V shapes in one instanced mesh.
// The flocks' behaviour (rest, rise at gunfire, wheel, settle) lives in
// flocks.ts; this file draws them. The flap is in the vertex shader; the CPU
// writes each bird's place and heading once a frame (a few dozen birds). They
// thin out near the aim line and the crosshair (ClearView) and shrink away
// close to the camera, so one never crosses the sight.

import * as THREE from "three/webgpu";
import { attribute, cameraPosition, float, length, positionGeometry, select, sin, smoothstep, vec3 } from "three/tsl";
import type { ClearView } from "./clearview";
import { Flock, makeFlocks } from "./flocks";
import type { N } from "./tslUtils";

/** Wingspan scale: a crow is about a metre across; drawn a little larger so it reads as a speck at 100 m. */
const SPAN = 2.4;

export class Birds {
  readonly root = new THREE.Group();
  readonly flocks: Flock[];
  private mesh: THREE.Mesh;
  private geo = new THREE.InstancedBufferGeometry();
  private mat: THREE.MeshBasicNodeMaterial;
  private aPos: THREE.InstancedBufferAttribute;
  private aDir: THREE.InstancedBufferAttribute;
  private last = -1;
  private total: number;
  private dirty = true;

  constructor(time: N, clear: ClearView | null, flocks: Flock[] = makeFlocks()) {
    this.flocks = flocks;
    this.total = flocks.reduce((n, f) => n + f.birds.length, 0);
    // One bird: a body line and two wings, a flat V (wing tips carry aWing 1, the flap moves them).
    const pos = [0, 0, 0.2, 0, 0, -0.2, -0.5, 0, -0.08, 0, 0, 0.2, 0, 0, -0.2, 0.5, 0, -0.08];
    const wing = [0, 0, 1, 0, 0, 1];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aWing", new THREE.Float32BufferAttribute(wing, 1));
    this.geo.setAttribute("position", g.attributes.position);
    this.geo.setAttribute("aWing", g.attributes.aWing);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(this.total * 4), 4);
    this.aDir = new THREE.InstancedBufferAttribute(new Float32Array(this.total * 4), 4);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aDir.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("aPos", this.aPos);
    this.geo.setAttribute("aDir", this.aDir);
    this.geo.instanceCount = this.total;

    const m = new THREE.MeshBasicNodeMaterial();
    m.name = "birds";
    m.side = THREE.DoubleSide;
    m.colorNode = vec3(0.045, 0.042, 0.04);
    const P: N = attribute("aPos", "vec4");
    const D: N = attribute("aDir", "vec4");
    const w: N = attribute("aWing", "float");
    const lp: N = positionGeometry;
    // Flap: the tips beat up and down, the wing tilting with them.
    const beat: N = sin((time as N).mul(D.w).add(D.z));
    const y: N = w.mul(beat.mul(0.34).add(0.04)).mul(lp.x.abs().mul(2));
    // Keep away from the lens and thin out near the aim line and the crosshair.
    const dist: N = length(P.xyz.sub(cameraPosition));
    let vis: N = smoothstep(18, 55, dist);
    if (clear) vis = vis.mul(smoothstep(0.2, 0.6, clear.fade(P.xyz)));
    const s: N = select(P.w.greaterThan(0.5), P.w.mul(vis), float(0));
    const fx: N = D.x, fz: N = D.y;
    const wx: N = lp.x.mul(fz).add(lp.z.mul(fx));
    const wz: N = lp.x.mul(fx.negate()).add(lp.z.mul(fz));
    m.positionNode = vec3(P.x.add(wx.mul(s)), P.y.add(y.mul(s)), P.z.add(wz.mul(s)));
    this.mat = m;

    this.mesh = new THREE.Mesh(this.geo, m);
    this.mesh.name = "birds";
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    this.root.add(this.mesh);
  }

  /** A shot or a burst at (x, y, z): flocks near it rise. */
  noise(x: number, y: number, z: number, now: number) {
    for (const f of this.flocks) if (f.noise(x, y, z, now)) this.dirty = true;
  }

  /** Once a frame: game time, its step, and the wind (a sampler of the game's wind field). */
  update(now: number, wind: (x: number, z: number, out: { x: number; z: number }) => void) {
    const dt = this.last < 0 ? 0 : Math.max(0, Math.min(0.25, now - this.last));
    this.last = now;
    const out = { x: 0, z: 0 };
    let up = false;
    const P = this.aPos.array as Float32Array, D = this.aDir.array as Float32Array;
    let i = 0;
    for (const f of this.flocks) {
      const wasUp = f.state === "up";
      if (wasUp) {
        const h = f.here;
        wind(h[0], h[2], out);
        f.step(now, dt, out.x, out.z);
      }
      const active = wasUp || this.dirty;
      for (const b of f.birds) {
        if (active) {
          P[i * 4] = b.x;
          P[i * 4 + 1] = b.y;
          P[i * 4 + 2] = b.z;
          P[i * 4 + 3] = b.shown ? SPAN : 0;
          D[i * 4] = b.fx;
          D[i * 4 + 1] = b.fz;
          D[i * 4 + 2] = b.phase;
          D[i * 4 + 3] = b.rate;
        }
        i++;
      }
      if (f.state === "up") up = true;
    }
    if (this.dirty || up) {
      this.aPos.needsUpdate = true;
      this.aDir.needsUpdate = true;
    }
    this.dirty = up;
    this.mesh.visible = up;
  }

  /** Back to rest (a new match). */
  reset() {
    for (const f of this.flocks) {
      f.state = "perched";
      for (const b of f.birds) b.shown = false;
    }
    this.dirty = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
