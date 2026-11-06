// Blood decals (gore on): dark, desaturated red-brown splats on the ground
// and on masonry that fade over about a minute. A ring of instanced quads
// with a noisy splat mask, each laid on a surface normal. A decal on a stone
// remembers the stone and its offset in the stone's frame, so it rides along
// if the stone moves. Cosmetic only.

import * as THREE from "three/webgpu";
import { Fn, abs, attribute, clamp, color, cos, cross, float, length, mix, normalLocal, normalize, positionGeometry, select, sin, smoothstep, texture, varying, vec2, vec3 } from "three/tsl";
import type { StoneSet } from "./stones";
import type { N } from "./tslUtils";

const MAX = 160;
const FADE_START = 40;
const FADE_END = 60;

export class Decals {
  readonly mesh: THREE.Mesh;
  private a = new Float32Array(MAX * 4);
  private b = new Float32Array(MAX * 4);
  private attrA: THREE.InstancedBufferAttribute;
  private attrB: THREE.InstancedBufferAttribute;
  private n = new Float32Array(MAX * 3);
  private attrN: THREE.InstancedBufferAttribute;
  /** Per slot: stone id (-1 on the ground), spawn time, offset and normal in the stone's frame. */
  private stoneOf = new Int32Array(MAX).fill(-1);
  private born = new Float32Array(MAX);
  private local = new Float32Array(MAX * 6);
  private tmp = new Float32Array(7);
  private scratch = [0, 0, 0, 0, 0, 0];
  private next = 0;
  private used = 0;

  constructor(time: N, noise: THREE.Texture) {
    const quad = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(quad.index);
    geo.setAttribute("position", quad.attributes.position);
    geo.setAttribute("normal", quad.attributes.normal);
    this.attrA = new THREE.InstancedBufferAttribute(this.a, 4);
    this.attrB = new THREE.InstancedBufferAttribute(this.b, 4);
    this.attrA.setUsage(THREE.DynamicDrawUsage);
    this.attrB.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iDecalA", this.attrA);
    geo.setAttribute("iDecalB", this.attrB);
    this.attrN = new THREE.InstancedBufferAttribute(this.n, 3);
    this.attrN.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iDecalN", this.attrN);
    geo.instanceCount = 0;
    const m = new THREE.MeshStandardNodeMaterial();
    m.name = "blood-decals";
    m.transparent = true;
    m.depthWrite = false;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    m.roughness = 0.45;
    m.metalness = 0;
    const A: N = attribute("iDecalA", "vec4");
    const B: N = attribute("iDecalB", "vec4");
    const qp: N = positionGeometry.xy;
    const ca: N = cos(B.y), sa: N = sin(B.y);
    const r: N = vec2(qp.x.mul(ca).sub(qp.y.mul(sa)), qp.x.mul(sa).add(qp.y.mul(ca))).mul(B.x);
    // A tangent frame around the surface normal.
    const nrm: N = normalize(attribute("iDecalN", "vec3"));
    const helper: N = select(abs(nrm.y).greaterThan(0.9), vec3(1, 0, 0), vec3(0, 1, 0));
    const t1: N = normalize(cross(helper, nrm));
    const t2: N = cross(nrm, t1);
    m.side = THREE.DoubleSide;
    m.positionNode = Fn(() => {
      normalLocal.assign(nrm);
      return A.xyz.add(t1.mul(r.x)).add(t2.mul(r.y)).add(nrm.mul(0.03));
    })();
    const vuv: N = varying(qp, "vDecalUV");
    const vSeed: N = varying(B.z, "vDecalSeed");
    const vAge: N = varying(time.sub(A.w), "vDecalAge");
    const vStr: N = varying(B.w, "vDecalStr");
    m.colorNode = Fn(() => {
      const n = texture(noise, vuv.mul(0.3).add(vSeed)).g;
      return mix(color(0x2a0c09), color(0x3e1712), n);
    })();
    m.opacityNode = Fn(() => {
      const d = length(vuv);
      const n1 = texture(noise, vuv.mul(0.35).add(vec2(vSeed, vSeed.mul(1.3)))).r;
      const n2 = texture(noise, vuv.mul(1.1).add(vSeed.mul(2.1))).g;
      // A blotch with ragged edges and a few droplets around it.
      const splat = float(1).sub(smoothstep(0.35, 0.6, d.add(n1.sub(0.5).mul(0.7))));
      const drops = smoothstep(0.72, 0.8, n2).mul(float(1).sub(smoothstep(0.6, 1.0, d)));
      const fade = float(1).sub(smoothstep(FADE_START, FADE_END, vAge)).mul(smoothstep(0.0, 0.15, vAge));
      return clamp(splat.add(drops), 0.0, 1.0).mul(fade).mul(mix(0.6, 0.92, vStr));
    })();
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.name = "blood-decals";
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /**
   * One splat at (x, y, z) facing (nx, ny, nz). With a stone (and its set),
   * the decal follows that stone from then on.
   */
  add(now: number, x: number, y: number, z: number, strength: number, seed: number, nx = 0, ny = 1, nz = 0, stone = -1, stones: StoneSet | null = null) {
    const k = this.next;
    this.next = (k + 1) % MAX;
    this.used = Math.min(MAX, this.used + 1);
    const s = Math.max(0, Math.min(1, strength));
    this.a.set([x, y, z, now], k * 4);
    // Smaller on walls: a spray, not a pool.
    const size = stone >= 0 ? 0.45 + s * 0.6 : 0.8 + s * 1.2;
    this.b.set([size, seed * 6.283, (seed * 7.31) % 1, s], k * 4);
    this.n.set([nx, ny, nz], k * 3);
    this.stoneOf[k] = stones ? stone : -1;
    this.born[k] = now;
    if (stones && stone >= 0) {
      // Offset and normal in the stone's frame.
      stones.getTransform(stone, this.tmp);
      const t = this.tmp;
      const qx = -t[3], qy = -t[4], qz = -t[5], qw = t[6];
      rot(this.local, k * 6, qx, qy, qz, qw, x - t[0], y - t[1], z - t[2]);
      rot(this.local, k * 6 + 3, qx, qy, qz, qw, nx, ny, nz);
    }
    const g = this.mesh.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = this.used;
    this.mesh.visible = true;
    this.attrA.needsUpdate = true;
    this.attrB.needsUpdate = true;
    this.attrN.needsUpdate = true;
  }

  /** Draw one long-faded decal out of sight, so the shader compiles while loading, not at the first hit. */
  prime(on: boolean) {
    const g = this.mesh.geometry as THREE.InstancedBufferGeometry;
    if (this.used > 0) return;
    if (on) {
      this.a.set([0, -500, 0, -1e6], 0);
      this.b.set([0.1, 0, 0, 0], 0);
      this.attrA.needsUpdate = this.attrB.needsUpdate = true;
    }
    g.instanceCount = on ? 1 : 0;
    this.mesh.visible = on;
  }

  /** Move decals that sit on stones along with them (once per frame). */
  follow(stones: StoneSet | null, now: number) {
    if (!stones) return;
    let moved = false;
    const t = this.tmp;
    for (let k = 0; k < this.used; k++) {
      const id = this.stoneOf[k];
      if (id < 0) continue;
      if (now - this.born[k] > FADE_END) {
        this.stoneOf[k] = -1;
        continue;
      }
      stones.getTransform(id, t);
      const o = k * 6;
      const L = this.local;
      const p = this.scratch;
      rotArr(p, 0, t[3], t[4], t[5], t[6], L[o], L[o + 1], L[o + 2]);
      rotArr(p, 3, t[3], t[4], t[5], t[6], L[o + 3], L[o + 4], L[o + 5]);
      const x = t[0] + p[0], y = t[1] + p[1], z = t[2] + p[2];
      const a = this.a;
      if (Math.abs(a[k * 4] - x) + Math.abs(a[k * 4 + 1] - y) + Math.abs(a[k * 4 + 2] - z) < 1e-4) continue;
      a[k * 4] = x;
      a[k * 4 + 1] = y;
      a[k * 4 + 2] = z;
      this.n[k * 3] = p[3];
      this.n[k * 3 + 1] = p[4];
      this.n[k * 3 + 2] = p[5];
      moved = true;
    }
    if (moved) {
      this.attrA.needsUpdate = true;
      this.attrN.needsUpdate = true;
    }
  }

  clear() {
    this.stoneOf.fill(-1);
    this.used = 0;
    this.next = 0;
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

function rot(out: Float32Array, at: number, qx: number, qy: number, qz: number, qw: number, x: number, y: number, z: number) {
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[at] = x + qw * tx + (qy * tz - qz * ty);
  out[at + 1] = y + qw * ty + (qz * tx - qx * tz);
  out[at + 2] = z + qw * tz + (qx * ty - qy * tx);
}

function rotArr(out: number[], at: number, qx: number, qy: number, qz: number, qw: number, x: number, y: number, z: number) {
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[at] = x + qw * tx + (qy * tz - qz * ty);
  out[at + 1] = y + qw * ty + (qz * tx - qx * tz);
  out[at + 2] = z + qw * tz + (qx * ty - qy * tx);
}
