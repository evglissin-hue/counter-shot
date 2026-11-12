// Trails behind shots in flight (look round L1.4): a faint air-coloured streak
// behind a round or chain-shot ball for its first half second, and a thin grey
// thread of smoke behind a shell. One instanced draw of camera-facing ribbon
// segments; each segment's facing and width are worked out in the shader from
// the camera that is drawing (so the impact cam's inset draws them right
// too). The rules (what is remembered, ages, fades) are in trailLogic.ts.
// Not faded by ClearView: it is the shot itself.

import * as THREE from "three/webgpu";
import {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  color,
  cross,
  float,
  max,
  mix,
  normalize,
  positionGeometry,
  smoothstep,
  varying,
  vec4,
} from "three/tsl";
import type { N } from "./tslUtils";
import { MAX_SEGMENTS, TrailSet } from "./trailLogic";
import { PROJECTILE_STRIDE } from "@keepfall/sim";

/** Widest a ribbon's head may be as a share of the screen's height (ball, shell), and its least width in metres. */
const HEAD_SHARE = [0.0042, 0.0036];
const HEAD_MIN = [0.1, 0.09];

export class Trails {
  readonly root = new THREE.Group();
  readonly set = new TrailSet();
  private mesh: THREE.Mesh;
  private a = new Float32Array(MAX_SEGMENTS * 4);
  private b = new Float32Array(MAX_SEGMENTS * 4);
  private c = new Float32Array(MAX_SEGMENTS * 4);
  private attrs: THREE.InstancedBufferAttribute[];
  private primed = false;

  constructor() {
    this.root.name = "trails";
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(quad.index);
    g.setAttribute("position", quad.attributes.position);
    this.attrs = [this.a, this.b, this.c].map((arr) => {
      const at = new THREE.InstancedBufferAttribute(arr, 4);
      at.setUsage(THREE.DynamicDrawUsage);
      return at;
    });
    g.setAttribute("iA", this.attrs[0]);
    g.setAttribute("iB", this.attrs[1]);
    g.setAttribute("iC", this.attrs[2]);
    g.instanceCount = 0;

    const m = new THREE.MeshBasicNodeMaterial();
    m.name = "trails";
    m.transparent = true;
    m.depthWrite = false;
    m.fog = false;
    const A: N = attribute("iA", "vec4");
    const B: N = attribute("iB", "vec4");
    const C: N = attribute("iC", "vec4");
    const qp: N = positionGeometry.xy;
    const s: N = qp.y.add(0.5);
    const centre: N = mix(A.xyz, B.xyz, s);
    const isShell: N = C.z;
    // Width: a share of the screen's height at this distance (so it reads at 150 m and in a small inset), never thinner than a ball.
    const depth: N = cameraViewMatrix.mul(vec4(centre, 1.0)).z.negate().max(0.1);
    const focal: N = (cameraProjectionMatrix as N).element(1).y; // 1 / tan(fov / 2)
    const share: N = mix(float(HEAD_SHARE[0]), float(HEAD_SHARE[1]), isShell);
    const minW: N = mix(float(HEAD_MIN[0]), float(HEAD_MIN[1]), isShell);
    const wHead: N = max(depth.mul(2.0).mul(share).div(focal), minW);
    const width: N = wHead.mul(mix(A.w, B.w, s));
    const dir: N = B.xyz.sub(A.xyz);
    const dirN: N = dir.div(max(dir.length(), 1e-6));
    const view: N = normalize(cameraPosition.sub(centre));
    const sideRaw: N = cross(dirN, view);
    // Seen end on, the ribbon has no side to show: it collapses rather than turn to noise.
    const side: N = sideRaw.div(max(sideRaw.length(), 1e-4));
    m.positionNode = centre.add(side.mul(qp.x.mul(width)));

    const vAcross: N = varying(qp.x.mul(2.0), "vTrailAcross");
    const vAlpha: N = varying(mix(C.x, C.y, s), "vTrailAlpha");
    const vHead: N = varying(s, "vTrailHead");
    const vShell: N = varying(isShell, "vTrailShell");
    // Air-coloured (pale, slightly blue grey: not the cold white of the aim marks, not fire), a little brighter at the head; a shell's thread is grey smoke.
    const air: N = color(0xc6d1d9).mul(mix(float(0.92), float(1.12), vHead));
    const smoke: N = color(0x85888a);
    const tint: N = mix(air, smoke, vShell);
    m.colorNode = vec4(tint.xyz, 1.0);
    const profile: N = float(1).sub(smoothstep(0.3, 1.0, vAcross.abs()));
    m.opacityNode = clamp(vAlpha.mul(profile), 0.0, 1.0);

    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = "trails";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    this.mesh.visible = false;
    this.root.add(this.mesh);
  }

  /** The projectiles of this frame at renderer clock `now` (the page's interpolated positions), with the match's wind. */
  update(proj: Float32Array, count: number, now: number, windX: number, windZ: number) {
    const set = this.set;
    set.begin();
    const n = Math.max(0, count | 0);
    for (let i = 0; i < n; i++) {
      const o = i * PROJECTILE_STRIDE;
      set.add(proj[o + 1], proj[o], proj[o + 2], proj[o + 3], proj[o + 4], now);
    }
    set.end();
    this.draw(now, windX, windZ);
  }

  /** Lay the ribbons out for the clock `now` (also after a keyframe is put back, before the next frame feeds it). */
  draw(now: number, windX: number, windZ: number) {
    if (this.primed) return;
    const ns = this.set.fill(now, windX, windZ, this.a, this.b, this.c);
    const g = this.mesh.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = ns;
    this.mesh.visible = ns > 0;
    if (ns > 0) {
      for (const at of this.attrs) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, ns * 4);
        at.needsUpdate = true;
      }
    }
  }

  /** Draw one ribbon out of sight, so its shader compiles while loading. */
  prime(on: boolean) {
    const g = this.mesh.geometry as THREE.InstancedBufferGeometry;
    if (on) {
      if (this.mesh.visible) return;
      this.primed = true;
      this.a.set([0, -500, 0, 1]);
      this.b.set([0, -500, 1, 1]);
      this.c.set([0.1, 0.1, 0, 0]);
      for (const at of this.attrs) at.needsUpdate = true;
      g.instanceCount = 1;
      this.mesh.visible = true;
    } else if (this.primed) {
      this.primed = false;
      g.instanceCount = 0;
      this.mesh.visible = false;
    }
  }

  clear() {
    this.set.clear();
    if (!this.primed) {
      (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = 0;
      this.mesh.visible = false;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
