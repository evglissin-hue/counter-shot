// Cosmetic, GPU-animated effects: impact dust and stone chips, the aim arc
// and the ghost trail of the previous shot. Everything is pooled:
// no allocations after construction.
//
// Impacts live in a ring of 16 slots. Each slot is two vec4 uniforms
// (position + spawn time, strength + seed + bias direction); the chips and
// dust puffs compute their whole motion from those and their instance index.

import * as THREE from "three/webgpu";
import {
  Fn,
  attribute,
  cameraPosition,
  cameraViewMatrix,
  cameraWorldMatrix,
  clamp,
  color,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  max,
  min,
  mix,
  normalGeometry,
  normalLocal,
  normalize,
  positionGeometry,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { chipGeometry } from "./geometry";
import type { StyleName, StylePreset } from "./styles";
import type { ClearView } from "./clearview";
import { screenCap, type FlashLight } from "./bursts";
import { N, qrot } from "./tslUtils";
import { applyCloudShadow } from "./clouds";

const SLOTS = 16;
const CHIPS_PER = 64;
const PUFFS_PER = 22;
const CHIP_LIFE = 3.4;
const DUST_LIFE = 3.0;
const MAX_ARC = 512;
const MAX_TRAIL = 768;

function rnd(i: N, salt: number): N {
  return hash(i.toUint().mul(9781).add(salt));
}

/** Quaternion from axis (unit) and angle. */
function axisAngle(axis: N, angle: N): N {
  const h = angle.mul(0.5);
  return vec4(axis.mul(sin(h)), cos(h));
}

export class Effects {
  readonly root = new THREE.Group();
  private time: N;
  private sunDir: N;
  private noise: THREE.Texture;

  // impacts
  private impA: THREE.Vector4[] = [];
  private impB: THREE.Vector4[] = [];
  private uImpA: N;
  private uImpB: N;
  private nextSlot = 0;
  private now = 0;
  private chips: THREE.Mesh;
  private dust: THREE.Mesh;

  // lines
  private arc: THREE.Mesh;
  private arcArr = new Float32Array(MAX_ARC * 4);
  private arcAttr: THREE.InstancedBufferAttribute;
  private arcLen = uniform(1);
  private trail: THREE.Mesh;
  private trailArr = new Float32Array(MAX_TRAIL * 4);
  private trailAttr: THREE.InstancedBufferAttribute;
  private trailLen = uniform(1);

  private mats = new Map<StyleName, { chips: THREE.Material; dust: THREE.Material; arc: THREE.Material; trail: THREE.Material }>();
  bias = new THREE.Vector3(0, 0, -1);
  /** Wind (m/s, x and z) that drifts the dust. */
  readonly wind = uniform(new THREE.Vector2(0, 0));
  /** Thins the dust near the aim line (set before the first setStyle). */
  clear: ClearView | null = null;
  /** Lights the dust near a burst's flash (set before the first setStyle). */
  flash: FlashLight | null = null;

  constructor(time: N, sunDir: N, noise: THREE.Texture) {
    this.time = time;
    this.sunDir = sunDir;
    this.noise = noise;
    this.root.name = "effects";
    for (let i = 0; i < SLOTS; i++) {
      this.impA.push(new THREE.Vector4(0, -100, 0, -1000));
      this.impB.push(new THREE.Vector4(0, 0, 0, 0));
    }
    this.uImpA = uniformArray(this.impA, "vec4");
    this.uImpB = uniformArray(this.impB, "vec4");

    // Chips.
    const cg = chipGeometry();
    const chipGeo = new THREE.InstancedBufferGeometry();
    chipGeo.setIndex(cg.index);
    chipGeo.setAttribute("position", cg.attributes.position);
    chipGeo.setAttribute("normal", cg.attributes.normal);
    chipGeo.instanceCount = SLOTS * CHIPS_PER;
    this.chips = new THREE.Mesh(chipGeo);
    this.chips.name = "impact-chips";
    this.chips.frustumCulled = false;
    this.chips.castShadow = true;
    this.chips.receiveShadow = true;

    // Dust puffs (camera-facing quads).
    const quad = new THREE.PlaneGeometry(1, 1);
    const dustGeo = new THREE.InstancedBufferGeometry();
    dustGeo.setIndex(quad.index);
    dustGeo.setAttribute("position", quad.attributes.position);
    dustGeo.instanceCount = SLOTS * PUFFS_PER;
    this.dust = new THREE.Mesh(dustGeo);
    this.dust.name = "impact-dust";
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 10;

    // Aim arc and ghost trail: instanced dots.
    const dotGeo = (arr: Float32Array) => {
      const g = new THREE.InstancedBufferGeometry();
      g.setIndex(quad.index);
      g.setAttribute("position", quad.attributes.position);
      const a = new THREE.InstancedBufferAttribute(arr, 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("iDot", a);
      g.instanceCount = 0;
      return { g, a };
    };
    const ad = dotGeo(this.arcArr);
    this.arcAttr = ad.a;
    this.arc = new THREE.Mesh(ad.g);
    this.arc.name = "aim-arc";
    this.arc.frustumCulled = false;
    this.arc.renderOrder = 20;
    this.arc.visible = false;
    const td = dotGeo(this.trailArr);
    this.trailAttr = td.a;
    this.trail = new THREE.Mesh(td.g);
    this.trail.name = "ghost-trail";
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 19;
    this.trail.visible = false;

    this.root.add(this.chips, this.trail, this.arc, this.dust);
  }

  // --- materials ------------------------------------------------------------

  private chipMaterial(style: StylePreset): THREE.Material {
    const m = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(m);
    m.name = `${style.name}-chips`;
    m.flatShading = true;
    m.roughness = 0.9;
    m.metalness = 0;
    const idx: N = instanceIndex;
    const slot: N = idx.div(CHIPS_PER);
    const local: N = idx.mod(CHIPS_PER);
    const A: N = this.uImpA.element(slot);
    const B: N = this.uImpB.element(slot);
    const t: N = this.time.sub(A.w);
    const strength: N = B.x;
    const count: N = floor(float(20).add(strength.mul(40.0)));
    const alive: N = t.greaterThanEqual(0.0).and(t.lessThan(CHIP_LIFE)).and(float(local).lessThan(count));
    const r1: N = rnd(idx, 11);
    const r2: N = rnd(idx, 23);
    const r3: N = rnd(idx, 37);
    const r4: N = rnd(idx, 41);
    const r5: N = rnd(idx, 53);
    const az: N = r1.mul(6.2831853);
    const el: N = mix(0.2, 1.25, r2);
    const speed: N = mix(3.0, 11.0, r3.mul(r3)).mul(strength.mul(0.9).add(0.45));
    const dir: N = vec3(cos(el).mul(cos(az)), sin(el), cos(el).mul(sin(az)));
    const bias: N = vec3(B.z, 0.0, B.w);
    const v0: N = dir.add(bias.mul(0.7)).mul(speed);
    const size: N = mix(0.05, 0.2, r4.mul(r4)).mul(strength.mul(0.8).add(0.6));
    const y0: N = A.y;
    const g = 9.81;
    const floorY: N = size.mul(0.5);
    const tHit: N = v0.y.add(sqrt(max(v0.y.mul(v0.y).add(max(y0.sub(floorY), 0.0).mul(2 * g)), 0.0))).div(g);
    const tf: N = min(t, tHit);
    const pos: N = A.xyz.add(v0.mul(tf)).add(vec3(0.0, -0.5 * g, 0.0).mul(tf.mul(tf)));
    const slide: N = float(1).sub(exp(max(t.sub(tHit), 0.0).mul(-4.0))).mul(0.25);
    const landed: N = vec3(pos.x.add(v0.x.mul(slide)), max(pos.y, floorY), pos.z.add(v0.z.mul(slide)));
    const axis: N = normalize(vec3(r5.sub(0.5), r1.sub(0.5), r3.sub(0.5)).add(0.001));
    const spin: N = mix(6.0, 22.0, r2).mul(tf);
    const q: N = axisAngle(axis, spin);
    const fade: N = float(1).sub(smoothstep(CHIP_LIFE - 0.7, CHIP_LIFE, t));
    const scale: N = select(alive, size.mul(fade), float(0.0));
    m.positionNode = Fn(() => {
      normalLocal.assign(qrot(q, normalGeometry));
      return qrot(q, positionGeometry.mul(scale)).add(landed);
    })();
    const shade: N = varying(r4.mul(0.35).add(0.75), "vChipShade");
    m.colorNode = color(style.chip).mul(shade);
    return m;
  }

  private dustMaterial(style: StylePreset): THREE.Material {
    const m = new THREE.MeshBasicNodeMaterial();
    m.name = `${style.name}-dust`;
    m.transparent = true;
    m.depthWrite = false;
    const idx: N = instanceIndex;
    const slot: N = idx.div(PUFFS_PER);
    const local: N = idx.mod(PUFFS_PER);
    const A: N = this.uImpA.element(slot);
    const B: N = this.uImpB.element(slot);
    const t: N = this.time.sub(A.w);
    const strength: N = B.x;
    // B.y: share of the slot's puffs to show (a burst brings its own smoke and needs fewer).
    const puffs: N = floor(B.y.mul(PUFFS_PER));
    const r1: N = rnd(idx, 101);
    const r2: N = rnd(idx, 131);
    const r3: N = rnd(idx, 151);
    const r4: N = rnd(idx, 173);
    const life: N = mix(DUST_LIFE - 0.8, DUST_LIFE, r4);
    const az: N = r1.mul(6.2831853);
    const el: N = mix(0.05, 1.2, r2);
    const dir: N = vec3(cos(el).mul(cos(az)), sin(el).mul(0.8), cos(el).mul(sin(az))).add(vec3(B.z, 0.0, B.w).mul(0.5));
    const speed: N = mix(1.2, 4.5, r3).mul(strength.mul(0.8).add(0.5));
    const travel: N = float(1).sub(exp(t.mul(-1.7))).div(1.7);
    const size: N = mix(0.7, 1.6, r3).mul(min(strength, 1.3).mul(1.4).add(0.6)).mul(float(1).sub(exp(t.mul(-1.3))).mul(1.7).add(0.35));
    const centre0: N = A.xyz.add(dir.mul(speed).mul(travel)).add(vec3(this.wind.x.mul(0.3), 0.45, this.wind.y.mul(0.3)).mul(t));
    const centre: N = vec3(centre0.x, max(centre0.y, size.mul(0.42)), centre0.z);
    const alive: N = t.greaterThanEqual(0.0).and(t.lessThan(life)).and(float(local).lessThan(puffs));
    const right: N = (cameraWorldMatrix as N).element(0).xyz;
    const up: N = (cameraWorldMatrix as N).element(1).xyz;
    const qp: N = positionGeometry.xy;
    const cap = screenCap(centre, size);
    const s: N = select(alive, cap.size, float(0.0));
    const wpos: N = centre.add(right.mul(qp.x.mul(s))).add(up.mul(qp.y.mul(s)));
    m.positionNode = wpos;
    const clearFade: N = (this.clear ? this.clear.fade(wpos) : float(1)).mul(cap.near);
    const vuv: N = varying(qp.mul(2.0), "vDustUV");
    const vAlpha: N = varying(smoothstep(0.0, 0.12, t).mul(float(1).sub(smoothstep(life.mul(0.35), life, t))).mul(mix(0.45, 0.8, r2)).mul(clearFade), "vDustA");
    const vSeed: N = varying(r1, "vDustSeed");
    const vFlash: N = this.flash ? varying(this.flash.at(centre), "vDustFlash") : float(0);
    const sunView: N = normalize(cameraViewMatrix.mul(vec4(this.sunDir, 0.0)).xyz);
    const dustCol = color(style.dust);
    m.colorNode = Fn(() => {
      const r2d = dot(vuv, vuv);
      const nz = sqrt(max(float(1).sub(r2d), 0.0));
      const n = vec3(vuv.x, vuv.y, nz);
      const lit = clamp(dot(n, sunView).mul(0.5).add(0.5), 0.0, 1.0);
      const c = dustCol.mul(mix(0.5, 1.05, lit)).mul(mix(0.85, 1.0, nz)).add(color(0xff8f45).mul(vFlash));
      return vec4(c, 1.0);
    })();
    m.opacityNode = Fn(() => {
      const r2d = dot(vuv, vuv);
      const wisp = texture(this.noise, vuv.mul(0.22).add(vec2(vSeed, vSeed.mul(1.7)))).r;
      const disc = float(1).sub(smoothstep(0.05, 1.0, r2d));
      return clamp(disc.mul(disc).mul(wisp.mul(1.4).add(0.35)).mul(vAlpha), 0.0, 1.0);
    })();
    return m;
  }

  private dotMaterial(style: StylePreset, trail: boolean): THREE.Material {
    const m = new THREE.MeshBasicNodeMaterial();
    m.name = `${style.name}-${trail ? "trail" : "arc"}`;
    m.transparent = true;
    m.depthWrite = false;
    m.fog = false;
    const d: N = attribute("iDot", "vec4");
    const centre: N = d.xyz;
    const dist: N = centre.sub(cameraPosition).length();
    // A dot keeps about the same size on screen however far along the flight it is. The floor is small: the first
    // dots are a few metres off the muzzle, and a larger one (14 cm) swelled them into a string of beads up the sight.
    const base = trail ? 0.0032 : 0.008;
    const size: N = clamp(dist.mul(base), trail ? 0.015 : 0.035, trail ? 0.8 : 1.6);
    const right: N = (cameraWorldMatrix as N).element(0).xyz;
    const up: N = (cameraWorldMatrix as N).element(1).xyz;
    const qp: N = positionGeometry.xy;
    m.positionNode = centre.add(right.mul(qp.x.mul(size))).add(up.mul(qp.y.mul(size)));
    const vuv: N = varying(qp.mul(2.0), "vDotUV");
    const vs: N = varying(d.w, "vDotS");
    const len: N = trail ? this.trailLen : this.arcLen;
    const r: N = vuv.length();
    if (trail) {
      m.colorNode = vec4(color(style.ghost), 1.0);
      m.opacityNode = float(1).sub(smoothstep(0.55, 1.0, r)).mul(0.32).mul(smoothstep(0.0, 6.0, vs));
    } else {
      const pulse: N = smoothstep(0.55, 1.0, fract(vs.div(7.0).sub(this.time.mul(1.1))));
      const core: N = color(style.aim).mul(float(1.1).add(pulse.mul(0.5)));
      m.colorNode = Fn(() => {
        const ring = smoothstep(0.45, 0.6, r);
        return vec4(mix(core, color(style.aimEdge), ring), 1.0);
      })();
      const endFade: N = float(1).sub(smoothstep(0.75, 1.0, vs.div(max(len, 0.001))));
      m.opacityNode = float(1).sub(smoothstep(0.88, 1.0, r)).mul(endFade).mul(smoothstep(0.0, 3.0, vs).mul(0.6).add(0.4));
    }
    return m;
  }

  setStyle(style: StylePreset) {
    let s = this.mats.get(style.name);
    if (!s) {
      s = {
        chips: this.chipMaterial(style),
        dust: this.dustMaterial(style),
        arc: this.dotMaterial(style, false),
        trail: this.dotMaterial(style, true),
      };
      this.mats.set(style.name, s);
    }
    this.chips.material = s.chips;
    this.dust.material = s.dust;
    this.arc.material = s.arc;
    this.trail.material = s.trail;
  }

  // --- API --------------------------------------------------------------------

  setTime(now: number) {
    this.now = now;
  }

  /** One impact: chips and dust. `dust` is the share of dust puffs to show (0..1). */
  spawnImpact(x: number, y: number, z: number, strength: number, dust = 1) {
    const k = this.nextSlot;
    this.nextSlot = (k + 1) % SLOTS;
    const s = Math.max(0, Math.min(2.5, strength));
    this.impA[k].set(x, y, z, this.now);
    // Bias the debris back towards where the shot came from.
    const bx = this.bias.x, bz = this.bias.z;
    const bl = Math.hypot(bx, bz) || 1;
    this.impB[k].set(s, Math.max(0, Math.min(1, dust)), bx / bl, bz / bl);
  }

  /** Keyframe (S3): no impacts in flight, and the ring back at its first slot (the chips draw their motion from the slot). */
  reset() {
    for (let k = 0; k < this.impA.length; k++) {
      this.impA[k].set(0, -100, 0, -1000);
      this.impB[k].set(0, 0, 0, 0);
    }
    this.nextSlot = 0;
  }

  private fillDots(points: Float32Array | null, arr: Float32Array, attr: THREE.InstancedBufferAttribute, mesh: THREE.Mesh, max: number, spacing: number, lenU: N) {
    const g = mesh.geometry as THREE.InstancedBufferGeometry;
    if (!points || points.length < 6) {
      g.instanceCount = 0;
      mesh.visible = false;
      return;
    }
    const np = Math.floor(points.length / 3);
    let total = 0;
    for (let i = 1; i < np; i++) {
      const dx = points[i * 3] - points[i * 3 - 3];
      const dy = points[i * 3 + 1] - points[i * 3 - 2];
      const dz = points[i * 3 + 2] - points[i * 3 - 1];
      total += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const step = Math.max(spacing, total / (max - 1));
    let n = 0;
    let acc = 0;
    let nextAt = 0;
    for (let i = 1; i < np && n < max; i++) {
      const ax = points[i * 3 - 3], ay = points[i * 3 - 2], az = points[i * 3 - 1];
      const bx = points[i * 3], by = points[i * 3 + 1], bz = points[i * 3 + 2];
      const seg = Math.hypot(bx - ax, by - ay, bz - az);
      while (nextAt <= acc + seg && n < max) {
        const f = seg > 0 ? (nextAt - acc) / seg : 0;
        const o = n * 4;
        arr[o] = ax + (bx - ax) * f;
        arr[o + 1] = ay + (by - ay) * f;
        arr[o + 2] = az + (bz - az) * f;
        arr[o + 3] = nextAt;
        n++;
        nextAt += step;
      }
      acc += seg;
    }
    lenU.value = total;
    g.instanceCount = n;
    mesh.visible = n > 0;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * 4);
    attr.needsUpdate = true;
  }

  setAimArc(points: Float32Array | null) {
    this.fillDots(points, this.arcArr, this.arcAttr, this.arc, MAX_ARC, 0.9, this.arcLen);
  }

  setGhostTrail(points: Float32Array | null) {
    this.fillDots(points, this.trailArr, this.trailAttr, this.trail, MAX_TRAIL, 0.55, this.trailLen);
  }

  dispose() {
    this.chips.geometry.dispose();
    this.dust.geometry.dispose();
    this.arc.geometry.dispose();
    this.trail.geometry.dispose();
    for (const s of this.mats.values()) for (const m of Object.values(s)) m.dispose();
  }
}

