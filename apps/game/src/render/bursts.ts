// Pooled, GPU-animated particle bursts: muzzle flash and smoke, explosion
// fire and smoke, blood spray, dust puffs. One Burst is one instanced draw of
// camera-facing quads; each spawn takes the next of a ring of slots (two vec4
// uniforms: position + spawn time, scale + direction) and every particle
// computes its own motion from those and its instance index. Purely
// cosmetic, no allocations after construction.

import * as THREE from "three/webgpu";
import {
  Fn,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cameraWorldMatrix,
  clamp,
  color,
  cos,
  dot,
  exp,
  float,
  hash,
  instanceIndex,
  max,
  min,
  mix,
  normalize,
  positionGeometry,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { ClearView } from "./clearview";
import type { N } from "./tslUtils";

export interface BurstConfig {
  name: string;
  slots: number;
  /** Particles per spawn. */
  per: number;
  /** Lifetime range per particle, seconds. */
  life: [number, number];
  color: number;
  /** Colour the particles cool to as they age (fire). Defaults to `color`. */
  colorEnd?: number;
  /** Additive and unlit (flashes, fire); otherwise alpha blended and lit by the sun. */
  additive: boolean;
  /** Brightness multiplier (above 1 feeds the bloom). */
  glow: number;
  /** Launch speed range, m/s (times the spawn scale). */
  speed: [number, number];
  /** Quad size at birth and fully grown, metres (times the spawn scale). */
  size: [number, number];
  /** How fast the size grows towards its end value (1/s). */
  grow: number;
  gravity: number;
  /** Buoyant rise, m/s. */
  rise: number;
  /** Air drag on the launch speed (1/s). */
  drag: number;
  /** How much the wind carries the particles (0..1). */
  windScale: number;
  /** 0 = all along the spawn direction, larger = more random. */
  spread: number;
  opacity: number;
  /** Keep particles above y = 0 (the field). */
  floor: boolean;
  /** How much the sun shades the puffs (0 flat, 1 fully lit). Defaults to 1. */
  lighting?: number;
  /** Thin out near the aim line and crosshair (readability rule 6). */
  clearAim?: boolean;
}

/** The flash light of muzzles and bursts, for particles that should glow near it. */
export interface FlashLight {
  /** Warm glow (0..~1.5) at a world point. */
  at(p: N): N;
}

/** Largest share of the screen's height one particle may cover. Close up, big puffs would otherwise fill the screen many times over. */
export const MAX_SCREEN_SHARE = 0.3;

/**
 * A particle's size, capped so it covers at most MAX_SCREEN_SHARE of the
 * screen's height, and a fade for particles right at the camera. Overdraw
 * (the same pixel drawn under many transparent puffs) is what makes a burst
 * seen close up expensive; at normal distances nothing changes.
 */
export function screenCap(centre: N, size: N): { size: N; near: N } {
  const depth: N = cameraViewMatrix.mul(vec4(centre, 1.0)).z.negate().max(0.1);
  const focal: N = (cameraProjectionMatrix as N).element(1).y; // 1 / tan(fov / 2)
  return { size: min(size, depth.mul(2 * MAX_SCREEN_SHARE).div(focal)), near: smoothstep(1.5, 5.0, depth) };
}

function rnd(i: N, salt: number): N {
  return hash(i.toUint().mul(9781).add(salt));
}

export class Burst {
  readonly mesh: THREE.Mesh;
  private a: THREE.Vector4[] = [];
  private b: THREE.Vector4[] = [];
  private next = 0;
  private cfg: BurstConfig;

  constructor(cfg: BurstConfig, time: N, wind: N, sunDir: N, noise: THREE.Texture, clear: ClearView | null = null, flash: FlashLight | null = null) {
    this.cfg = cfg;
    for (let i = 0; i < cfg.slots; i++) {
      this.a.push(new THREE.Vector4(0, -100, 0, -1000));
      this.b.push(new THREE.Vector4(0, 0, 1, 0));
    }
    const uA: N = uniformArray(this.a, "vec4");
    const uB: N = uniformArray(this.b, "vec4");
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(quad.index);
    geo.setAttribute("position", quad.attributes.position);
    geo.instanceCount = cfg.slots * cfg.per;

    const m = new THREE.MeshBasicNodeMaterial();
    m.name = `burst-${cfg.name}`;
    m.transparent = true;
    m.depthWrite = false;
    if (cfg.additive) {
      m.blending = THREE.AdditiveBlending;
      m.fog = false;
    }
    const idx: N = instanceIndex;
    const slot: N = idx.div(cfg.per);
    const A: N = uA.element(slot);
    const B: N = uB.element(slot);
    const t: N = time.sub(A.w);
    const scale: N = B.x;
    const r1 = rnd(idx, 7), r2 = rnd(idx, 19), r3 = rnd(idx, 31), r4 = rnd(idx, 43), r5 = rnd(idx, 59);
    const life: N = mix(cfg.life[0], cfg.life[1], r4);
    const az: N = r1.mul(6.2831853);
    const cz: N = r2.mul(2.0).sub(1.0);
    const sz: N = sqrt(max(float(1).sub(cz.mul(cz)), 0.0));
    const rand: N = vec3(sz.mul(cos(az)), cz, sz.mul(sin(az)));
    const dir: N = normalize(vec3(B.y, B.z, B.w).add(rand.mul(cfg.spread)).add(vec3(0, 0.0001, 0)));
    const speed: N = mix(cfg.speed[0], cfg.speed[1], r3).mul(scale);
    const travel: N = float(1).sub(exp(t.mul(-cfg.drag))).div(cfg.drag);
    const drift: N = vec3((wind as N).x.mul(cfg.windScale), cfg.rise, (wind as N).y.mul(cfg.windScale)).mul(t);
    const size: N = mix(cfg.size[0], cfg.size[1], float(1).sub(exp(t.mul(-cfg.grow)))).mul(scale).mul(mix(0.7, 1.3, r5));
    const p0: N = A.xyz.add(dir.mul(speed).mul(travel)).add(drift).add(vec3(0, -0.5 * cfg.gravity, 0).mul(t.mul(t)));
    const centre: N = cfg.floor ? vec3(p0.x, max(p0.y, size.mul(0.3)), p0.z) : p0;
    const alive: N = t.greaterThanEqual(0.0).and(t.lessThan(life));
    const right: N = (cameraWorldMatrix as N).element(0).xyz;
    const up: N = (cameraWorldMatrix as N).element(1).xyz;
    const qp: N = positionGeometry.xy;
    // Spin each quad a little so overlapping puffs do not line up.
    const ang: N = r5.mul(6.283);
    const rq: N = vec2(qp.x.mul(cos(ang)).sub(qp.y.mul(sin(ang))), qp.x.mul(sin(ang)).add(qp.y.mul(cos(ang))));
    const cap = screenCap(centre, size);
    const s: N = select(alive, cap.size, float(0.0));
    const wpos: N = centre.add(right.mul(rq.x.mul(s))).add(up.mul(rq.y.mul(s)));
    m.positionNode = wpos;
    const clearFade: N = (clear && cfg.clearAim ? clear.fade(wpos) : float(1)).mul(cap.near);

    const vuv: N = varying(qp.mul(2.0), `v${cfg.name}UV`);
    const age: N = clamp(t.div(life), 0.0, 1.0);
    const vAge: N = varying(age, `v${cfg.name}Age`);
    const vAlpha: N = varying(
      smoothstep(0.0, 0.04, age).mul(float(1).sub(smoothstep(0.35, 1.0, age))).mul(mix(0.6, 1.0, r2)).mul(cfg.opacity).mul(clearFade),
      `v${cfg.name}A`,
    );
    const vSeed: N = varying(r1, `v${cfg.name}Seed`);
    // Lit from inside by a burst's flash: warm, falling off over about 12 m.
    const vFlash: N = flash && !cfg.additive ? varying(flash.at(centre), `v${cfg.name}Flash`) : float(0);
    const sunView: N = normalize(cameraViewMatrix.mul(vec4(sunDir, 0.0)).xyz);
    const c0 = color(cfg.color);
    const c1 = color(cfg.colorEnd ?? cfg.color);
    m.colorNode = Fn(() => {
      const r2d = dot(vuv, vuv);
      const nz = sqrt(max(float(1).sub(r2d), 0.0));
      const base: N = mix(c0, c1, smoothstep(0.0, 0.6, vAge));
      if (cfg.additive) return vec4(base.mul(cfg.glow), 1.0);
      const n = vec3(vuv.x, vuv.y, nz);
      const lit = clamp(dot(n, sunView).mul(0.5).add(0.5), 0.0, 1.0);
      const L = cfg.lighting ?? 1;
      return vec4(base.mul(mix(1.0 - 0.5 * L, 1.0 + 0.05 * L, lit)).mul(cfg.glow).add(color(0xff8f45).mul(vFlash)), 1.0);
    })();
    m.opacityNode = Fn(() => {
      const r2d = dot(vuv, vuv);
      const wisp = texture(noise, vuv.mul(0.22).add(vec2(vSeed, vSeed.mul(1.7)))).r;
      const disc = float(1).sub(smoothstep(cfg.additive ? 0.0 : 0.05, 1.0, r2d));
      return clamp(disc.mul(disc).mul(wisp.mul(1.2).add(0.45)).mul(vAlpha), 0.0, 1.0);
    })();
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.name = `burst-${cfg.name}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = cfg.additive ? 12 : 11;
  }

  /** Start one burst. (dx, dy, dz) biases the launch direction (unit or zero). */
  spawn(now: number, x: number, y: number, z: number, scale: number, dx = 0, dy = 0.3, dz = 0) {
    const k = this.next;
    this.next = (k + 1) % this.cfg.slots;
    this.a[k].set(x, y, z, now);
    this.b[k].set(Math.max(0.01, scale), dx, dy, dz);
  }

  clear() {
    for (const a of this.a) a.set(0, -100, 0, -1000);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
