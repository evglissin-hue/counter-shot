// Braziers on the castles (look round L3.4): a small iron basket with a warm
// flickering glow (an emissive sprite that feeds the bloom, no real light) and
// a thin thread of smoke leaning with the wind. Two stand either side of each
// gate and one on a tower's rim, each on its stone (brazierLogic.ts): when the
// stone falls or moves, the fire goes out. Fire is the only warm accent in the
// valley (SPEC 13: accents sparingly), so everything here is small.

import * as THREE from "three/webgpu";
import {
  Fn,
  attribute,
  cameraWorldMatrix,
  dot,
  float,
  mix,
  positionGeometry,
  sin,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { CastleLayout } from "@keepfall/content";
import { BrazierFires, pickBraziers } from "./brazierLogic";
import { mergeGeometries } from "./geometry";
import type { N } from "./tslUtils";

/** Seconds between puffs of a lit brazier's smoke. */
const PUFF_EVERY = 1.1;

function basketGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // The bowl (open at the top, a flared cone) and its coals' bed.
  const bowl = new THREE.CylinderGeometry(0.21, 0.11, 0.2, 10, 1, true);
  bowl.translate(0, 0.34, 0);
  parts.push(bowl);
  const bed = new THREE.CylinderGeometry(0.19, 0.19, 0.02, 10);
  bed.translate(0, 0.38, 0);
  parts.push(bed);
  // Three legs, splayed.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const leg = new THREE.CylinderGeometry(0.018, 0.018, 0.36, 5);
    leg.translate(0, 0.18, 0);
    leg.rotateZ(0.0);
    const pivot = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(0.11, 0, 0));
    leg.applyMatrix4(pivot);
    parts.push(leg);
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

export class Braziers {
  readonly root = new THREE.Group();
  private fires: BrazierFires | null = null;
  private baskets: THREE.InstancedMesh | null = null;
  private glow: THREE.Mesh | null = null;
  private glowPos: THREE.InstancedBufferAttribute | null = null;
  private geo: THREE.InstancedBufferGeometry | null = null;
  private mats: THREE.Material[] = [];
  private timers: number[] = [];
  private time: N;
  private layout: CastleLayout | null = null;

  constructor(time: N) {
    this.time = time;
    this.root.name = "braziers";
  }

  /** One brazier's burning: for the tests and the page's inspector. */
  get litCount(): number {
    return this.fires ? this.fires.lit.filter(Boolean).length : 0;
  }

  build(layout: CastleLayout) {
    this.dispose();
    this.layout = layout;
    const spots = pickBraziers(layout);
    this.fires = new BrazierFires(spots, layout);
    this.timers = spots.map((_, i) => (i * 0.37) % PUFF_EVERY);
    const n = spots.length;
    if (!n) return;

    // Baskets: one instanced mesh of dark iron.
    const bm = new THREE.MeshStandardNodeMaterial();
    bm.name = "brazier-iron";
    bm.color = new THREE.Color(0x24211d);
    bm.roughness = 0.62;
    bm.metalness = 0.55;
    this.baskets = new THREE.InstancedMesh(basketGeometry(), bm, n);
    this.baskets.name = "brazier-baskets";
    this.baskets.castShadow = false;
    this.baskets.receiveShadow = true;
    this.baskets.frustumCulled = false;
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => this.baskets!.setMatrixAt(i, m.makeTranslation(s.x, s.y, s.z)));
    this.baskets.instanceMatrix.needsUpdate = true;
    this.root.add(this.baskets);
    this.mats.push(bm);

    // Glow: a camera-facing sprite per brazier, flickering. P = (x, y, z, lit).
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(quad.index);
    geo.setAttribute("position", quad.attributes.position);
    geo.instanceCount = n;
    const pos = new Float32Array(n * 4);
    spots.forEach((s, i) => {
      pos[i * 4] = s.x;
      pos[i * 4 + 1] = s.y + 0.5;
      pos[i * 4 + 2] = s.z;
      pos[i * 4 + 3] = 1;
    });
    this.glowPos = new THREE.InstancedBufferAttribute(pos, 4);
    this.glowPos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aGlow", this.glowPos);
    this.geo = geo;
    const gm = new THREE.MeshBasicNodeMaterial();
    gm.name = "brazier-glow";
    gm.transparent = true;
    gm.depthWrite = false;
    gm.blending = THREE.AdditiveBlending;
    gm.fog = false;
    const P: N = attribute("aGlow", "vec4");
    const t: N = this.time;
    // Each brazier flickers on its own beat (from where it stands).
    const ph: N = P.x.mul(1.7).add(P.z.mul(2.3));
    const flick: N = float(0.78).add(sin(t.mul(13.0).add(ph)).mul(sin(t.mul(7.3).add(ph.mul(2.1)))).mul(0.22)).add(sin(t.mul(31.0).add(ph.mul(3.0))).mul(0.06));
    const right: N = (cameraWorldMatrix as N).element(0).xyz;
    const up: N = (cameraWorldMatrix as N).element(1).xyz;
    const qp: N = positionGeometry.xy;
    // A flame a little taller than wide, leaning its tip with the flicker.
    const w: N = float(0.36).mul(P.w);
    const h: N = float(0.62).mul(P.w).mul(flick.mul(0.35).add(0.75));
    const base: N = vec3(P.x, P.y.sub(0.12), P.z);
    gm.positionNode = base.add(right.mul(qp.x.mul(w))).add(up.mul(qp.y.add(0.5).mul(h)));
    gm.colorNode = Fn(() => {
      const uv: N = vec2(qp.x.mul(2.0), qp.y.mul(2.0));
      const r2: N = dot(uv, uv);
      const core: N = float(1).sub(smoothstep(0.0, 0.55, r2));
      const c: N = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.68, 0.28), core.mul(core));
      return vec4(c.mul(flick.mul(1.35)), 1.0);
    })();
    gm.opacityNode = Fn(() => {
      const uv: N = vec2(qp.x.mul(2.0), qp.y.mul(2.0));
      const r2: N = dot(uv, uv);
      const d: N = float(1).sub(smoothstep(0.0, 1.0, r2));
      return d.mul(d).mul(flick.mul(0.5).add(0.5));
    })();
    this.glow = new THREE.Mesh(geo, gm);
    this.glow.name = "brazier-glow";
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 12;
    this.root.add(this.glow);
    this.mats.push(gm);
  }

  /** Stone poses from a frame: a brazier whose stone has moved goes out. */
  bodies(data: ArrayLike<number>, count: number) {
    this.fires?.bodies(data, count, (i) => this.hide(i));
  }

  private hide(i: number) {
    if (this.glowPos) {
      (this.glowPos.array as Float32Array)[i * 4 + 3] = 0;
      this.glowPos.needsUpdate = true;
    }
    if (this.baskets) {
      this.baskets.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      this.baskets.instanceMatrix.needsUpdate = true;
    }
  }

  /** A new match: every brazier burns again. */
  reset() {
    const f = this.fires;
    if (!f) return;
    f.relight();
    const m = new THREE.Matrix4();
    f.spots.forEach((s, i) => {
      this.baskets?.setMatrixAt(i, m.makeTranslation(s.x, s.y, s.z));
      if (this.glowPos) (this.glowPos.array as Float32Array)[i * 4 + 3] = 1;
    });
    if (this.baskets) this.baskets.instanceMatrix.needsUpdate = true;
    if (this.glowPos) this.glowPos.needsUpdate = true;
  }

  /** Which braziers burn and their smoke timers (S3 keyframes): n flags, then n timers, in spot order. */
  capture(): Float32Array {
    const f = this.fires;
    if (!f) return new Float32Array(0);
    const n = f.lit.length;
    const out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      out[i] = f.lit[i] ? 1 : 0;
      out[n + i] = this.timers[i] ?? 0;
    }
    return out;
  }

  /** Put captured flags and timers back: every brazier burns, then those that were out go out again. */
  apply(saved: ArrayLike<number>) {
    this.reset();
    const f = this.fires;
    if (!f || saved.length < f.lit.length * 2) return;
    const n = f.lit.length;
    for (let i = 0; i < n; i++) {
      this.timers[i] = saved[n + i];
      if (saved[i]) continue;
      f.lit[i] = false;
      this.hide(i);
    }
  }

  /** Once a frame: each lit brazier lets out a puff of thin smoke now and then. */
  update(dt: number, puff: (x: number, y: number, z: number) => void) {
    const f = this.fires;
    if (!f) return;
    for (let i = 0; i < f.spots.length; i++) {
      if (!f.lit[i]) continue;
      this.timers[i] += dt;
      if (this.timers[i] >= PUFF_EVERY) {
        this.timers[i] -= PUFF_EVERY;
        const s = f.spots[i];
        puff(s.x, s.y + 0.5, s.z);
      }
    }
  }

  dispose() {
    this.geo?.dispose();
    this.baskets?.geometry.dispose();
    this.baskets?.dispose();
    for (const m of this.mats) m.dispose();
    this.mats = [];
    if (this.baskets) this.root.remove(this.baskets);
    if (this.glow) this.root.remove(this.glow);
    this.baskets = null;
    this.glow = null;
    this.glowPos = null;
    this.geo = null;
    this.fires = null;
  }
}
