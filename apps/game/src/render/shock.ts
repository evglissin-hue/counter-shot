// The shock of a powder burst: a hot sphere that swells and fades in a blink,
// and a ring of dust that races out along the ground. A small pool, animated
// on the CPU (a handful of uniforms per frame). Cosmetic only.

import * as THREE from "three/webgpu";
import { Fn, abs, color, dot, float, normalView, positionGeometry, smoothstep, texture, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import type { N } from "./tslUtils";

const POOL = 4;
const SPHERE_LIFE = 0.14;
const RING_LIFE = 1.1;

interface Slot {
  sphere: THREE.Mesh;
  ring: THREE.Mesh;
  sphereO: N;
  ringO: N;
  born: number;
  radius: number;
  ground: boolean;
}

export class Shock {
  readonly root = new THREE.Group();
  private slots: Slot[] = [];
  private next = 0;

  constructor(noise: THREE.Texture) {
    this.root.name = "shock";
    const sphereGeo = new THREE.IcosahedronGeometry(1, 3);
    const ringGeo = new THREE.RingGeometry(0.55, 1, 96, 1);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < POOL; i++) {
      const sphereO = uniform(0);
      const sm = new THREE.MeshBasicNodeMaterial();
      sm.name = "shock-sphere";
      sm.transparent = true;
      sm.depthWrite = false;
      sm.blending = THREE.AdditiveBlending;
      sm.fog = false;
      // Brightest at the rim, like a wall of hot air seen edge on.
      sm.colorNode = Fn(() => {
        const rim = float(1).sub(abs(dot(normalView, vec3(0, 0, 1))));
        const k = smoothstep(0.0, 1.0, rim).mul(0.7).add(0.3);
        return vec4(color(0xffd2a0).mul(k.mul(2.2)), 1.0);
      })();
      sm.opacityNode = sphereO;
      const sphere = new THREE.Mesh(sphereGeo, sm);
      sphere.name = "shock-sphere";
      sphere.visible = false;
      sphere.renderOrder = 12;
      sphere.frustumCulled = false;

      const ringO = uniform(0);
      const rm = new THREE.MeshBasicNodeMaterial();
      rm.name = "shock-ring";
      rm.transparent = true;
      rm.depthWrite = false;
      rm.side = THREE.DoubleSide;
      rm.polygonOffset = true;
      rm.polygonOffsetFactor = -3;
      rm.polygonOffsetUnits = -3;
      // A dusty band, thick at its leading edge and torn by noise.
      rm.colorNode = vec4(color(0x8c7f6c), 1.0);
      rm.opacityNode = Fn(() => {
        const p: N = positionGeometry;
        const r: N = vec2(p.x, p.z).length();
        // A narrow, ragged band at the leading edge.
        const band = smoothstep(0.78, 0.95, r).mul(float(1).sub(smoothstep(0.96, 1.0, r)));
        const n = texture(noise, uv().mul(vec2(9.0, 2.0)).add(float(i * 0.37))).r;
        return band.mul(smoothstep(0.25, 0.75, n)).mul(ringO);
      })();
      const ring = new THREE.Mesh(ringGeo, rm);
      ring.name = "shock-ring";
      ring.visible = false;
      ring.renderOrder = 11;
      ring.frustumCulled = false;
      this.root.add(sphere, ring);
      this.slots.push({ sphere, ring, sphereO, ringO, born: -100, radius: 1, ground: false });
    }
  }

  /** A burst of `radius` metres at a point; `groundY` is the ground under it, or null if it is high above. */
  spawn(now: number, x: number, y: number, z: number, radius: number, groundY: number | null) {
    const s = this.slots[this.next];
    this.next = (this.next + 1) % POOL;
    s.born = now;
    s.radius = radius;
    s.ground = groundY !== null;
    s.sphere.position.set(x, y, z);
    s.ring.position.set(x, (groundY ?? y) + 0.25, z);
  }

  update(now: number) {
    for (const s of this.slots) {
      const t = now - s.born;
      const sphereOn = t >= 0 && t < SPHERE_LIFE;
      s.sphere.visible = sphereOn;
      if (sphereOn) {
        const u = t / SPHERE_LIFE;
        s.sphere.scale.setScalar(s.radius * (0.4 + 1.6 * (1 - (1 - u) * (1 - u))));
        s.sphereO.value = 0.22 * (1 - u) * (1 - u) * (1 - u);
      }
      const ringOn = s.ground && t >= 0 && t < RING_LIFE;
      s.ring.visible = ringOn;
      if (ringOn) {
        const u = t / RING_LIFE;
        // Fast at first, then slowing as the dust drags.
        const grow = 1 - Math.pow(1 - u, 2.6);
        s.ring.scale.setScalar(s.radius * (0.8 + 4.6 * grow));
        s.ringO.value = 0.7 * Math.min(1, t / 0.06) * (1 - u) * (1 - u);
      }
    }
  }

  clear() {
    for (const s of this.slots) s.born = -100;
  }

  /** Keyframe (S3): nothing in flight, and the ring back at its first slot. */
  reset() {
    this.clear();
    this.next = 0;
  }

  /** Draw every mesh once, invisible, so its shader compiles now (loading) and not at the first burst. */
  prime(on: boolean) {
    for (const s of this.slots) {
      if (on) {
        s.sphereO.value = 0;
        s.ringO.value = 0;
        s.sphere.position.set(0, -500, 0);
        s.ring.position.set(0, -500, 0);
      }
      s.sphere.visible = on;
      s.ring.visible = on;
    }
  }

  dispose() {
    for (const s of this.slots) {
      (s.sphere.material as THREE.Material).dispose();
      (s.ring.material as THREE.Material).dispose();
    }
    this.slots[0]?.sphere.geometry.dispose();
    this.slots[0]?.ring.geometry.dispose();
  }
}
