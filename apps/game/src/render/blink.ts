// A hit that reads at 150 m (look round L1.7): a bright blink of dust at the
// point of impact, before the cloud. A camera-facing quad per slot of a ring,
// sized in the shader from the distance to the camera that is drawing (so it
// shows in the impact cam's inset too), growing then fading in about 0.18 s.
// Warm pale dust colour with a little glow for the bloom; not additive white.
// One draw, no allocation after construction.

import * as THREE from "three/webgpu";
import {
  cameraPosition,
  cameraWorldMatrix,
  clamp,
  color,
  float,
  instanceIndex,
  mix,
  normalize,
  positionGeometry,
  select,
  smoothstep,
  uniformArray,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import type { N } from "./tslUtils";

export const BLINK_SLOTS = 24;
/** Seconds a blink lasts. */
export const BLINK_LIFE = 0.18;
/** Size is this share of the distance, between these two sizes (m), times the hit's strength. */
const SIZE_PER_M = 0.02;
const SIZE_MIN = 0.5;
const SIZE_MAX = 4;
const DUST = 0xf0e2c4;

export class Blink {
  readonly mesh: THREE.Mesh;
  private a: THREE.Vector4[] = [];
  private b: THREE.Vector4[] = [];
  private next = 0;

  constructor(time: N) {
    for (let i = 0; i < BLINK_SLOTS; i++) {
      this.a.push(new THREE.Vector4(0, -100, 0, -1000));
      this.b.push(new THREE.Vector4(1, 0, 0, 0));
    }
    const uA: N = uniformArray(this.a, "vec4");
    const uB: N = uniformArray(this.b, "vec4");
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(quad.index);
    geo.setAttribute("position", quad.attributes.position);
    geo.instanceCount = BLINK_SLOTS;

    const m = new THREE.MeshBasicNodeMaterial();
    m.name = "blink";
    m.transparent = true;
    m.depthWrite = false;
    m.fog = false;
    const A: N = uA.element(instanceIndex);
    const B: N = uB.element(instanceIndex);
    const t: N = time.sub(A.w);
    const u: N = clamp(t.div(BLINK_LIFE), 0.0, 1.0);
    const alive: N = t.greaterThanEqual(0.0).and(t.lessThan(BLINK_LIFE));
    const dist: N = A.xyz.sub(cameraPosition).length();
    // Quick to bloom, then it eases out to full size as it fades.
    const grow: N = mix(0.45, 1.0, float(1).sub(float(1).sub(u).pow(2.0)));
    const size: N = clamp(dist.mul(SIZE_PER_M), SIZE_MIN, SIZE_MAX).mul(B.x).mul(grow);
    const s: N = select(alive, size, float(0.0));
    const right: N = (cameraWorldMatrix as N).element(0).xyz;
    const up: N = (cameraWorldMatrix as N).element(1).xyz;
    // A little towards the camera, so a hit on a wall is not half sunk into it.
    const toCam: N = normalize(cameraPosition.sub(A.xyz));
    const centre: N = A.xyz.add(toCam.mul(s.mul(0.4)));
    const qp: N = positionGeometry.xy;
    m.positionNode = centre.add(right.mul(qp.x.mul(s))).add(up.mul(qp.y.mul(s)));
    const vuv: N = varying(qp.mul(2.0), "vBlinkUV");
    const vU: N = varying(u, "vBlinkU");
    const r: N = vuv.length();
    const core: N = float(1).sub(smoothstep(0.0, 0.45, r));
    const halo: N = float(1).sub(smoothstep(0.1, 1.0, r));
    // The hot middle runs a little over 1 so the bloom takes it; the rim is dust coloured.
    m.colorNode = vec4(mix(color(DUST).mul(1.25), vec3(1.0, 0.93, 0.78).mul(1.9), core), 1.0);
    const fade: N = float(1).sub(vU).pow(1.4);
    m.opacityNode = clamp(core.add(halo.mul(halo).mul(0.75)).mul(fade).mul(0.95), 0.0, 1.0);
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.name = "blink";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 14;
  }

  /** One blink at a hit: strength is the impact's (a round shot's is about 1 to 2); it scales the size within bounds. */
  spawn(now: number, x: number, y: number, z: number, strength: number) {
    const k = this.next;
    this.next = (k + 1) % BLINK_SLOTS;
    this.a[k].set(x, y, z, now);
    this.b[k].set(Math.max(0.35, Math.min(1.6, strength || 1)), 0, 0, 0);
  }

  clear() {
    for (const a of this.a) a.set(0, -100, 0, -1000);
  }

  /** Keyframe (S3): empty, and the ring back at its first slot, so the same spawns land in the same slots. */
  reset() {
    this.clear();
    this.next = 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
