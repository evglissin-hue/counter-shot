// Readability rule 6: smoke and dust thin out near the aim line and the
// crosshair, so effects never hide a shot. The page's aim arc is projected to
// the screen on the CPU each frame (a few points); particle shaders measure
// their own screen distance to that polyline and to the screen centre.

import * as THREE from "three/webgpu";
import { cameraProjectionMatrix, cameraViewMatrix, float, length, max, min, mix, select, smoothstep, uniform, uniformArray, vec2, vec4 } from "three/tsl";
import type { N } from "./tslUtils";

const POINTS = 9;

export class ClearView {
  private pts: THREE.Vector4[] = [];
  private uPts: N;
  /** 1 while riding a weapon (fade around the crosshair). */
  readonly crosshair = uniform(0);
  private aspect = uniform(16 / 9);
  private count = uniform(0);
  private world: Float32Array | null = null;
  private v = new THREE.Vector3();

  constructor() {
    for (let i = 0; i < POINTS; i++) this.pts.push(new THREE.Vector4(10, 10, 0, 0));
    this.uPts = uniformArray(this.pts, "vec4");
  }

  setArc(points: Float32Array | null) {
    this.world = points && points.length >= 6 ? points : null;
  }

  /** Project the arc with the current camera (once per frame). */
  update(camera: THREE.PerspectiveCamera) {
    this.aspect.value = camera.aspect;
    const w = this.world;
    if (!w) {
      this.count.value = 0;
      return;
    }
    const np = Math.floor(w.length / 3);
    let n = 0;
    for (let k = 0; k < POINTS; k++) {
      const i = Math.min(np - 1, Math.round((k * (np - 1)) / (POINTS - 1)));
      this.v.set(w[i * 3], w[i * 3 + 1], w[i * 3 + 2]).applyMatrix4(camera.matrixWorldInverse);
      // Points behind the camera: clamp just in front so the segment still points the right way.
      if (this.v.z > -0.5) this.v.z = -0.5;
      this.v.applyMatrix4(camera.projectionMatrix);
      this.pts[n++].set(this.v.x * camera.aspect, this.v.y, 0, 0);
    }
    this.count.value = n;
  }

  /** Off for a second camera (the impact cam's inset): the aim line and crosshair are the main view's. The next update() turns it back on. */
  suspend() {
    this.count.value = 0;
    this.crosshair.value = 0;
  }

  /**
   * Opacity factor (0..1) for a world position: low near the aim line and,
   * when riding a weapon, near the crosshair. Evaluate in the vertex stage.
   */
  fade(world: N): N {
    const clip: N = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));
    const w: N = max(clip.w, 0.01);
    const p: N = vec2(clip.x.div(w).mul(this.aspect), clip.y.div(w));
    let d: N = float(10);
    for (let k = 0; k < POINTS - 1; k++) {
      const a: N = (this.uPts as N).element(k).xy;
      const b: N = (this.uPts as N).element(k + 1).xy;
      const ab: N = b.sub(a);
      const t: N = p.sub(a).dot(ab).div(max(ab.dot(ab), 1e-6)).clamp(0.0, 1.0);
      const dk: N = length(p.sub(a.add(ab.mul(t))));
      d = min(d, mix(float(10), dk, select(this.count.greaterThan(k + 1), float(1), float(0))));
    }
    const line: N = smoothstep(0.02, 0.14, d);
    const centre: N = mix(float(1), smoothstep(0.04, 0.22, length(p)), this.crosshair);
    // In front of the camera only.
    const front: N = select(clip.w.greaterThan(0.0), float(1), float(0));
    return mix(float(1), mix(0.12, 1.0, min(line, centre)), front);
  }
}
