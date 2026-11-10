// Grass in tufts near the camera (look round L3.3), at High and Ultra
// (TIERS[tier].tufts). Clumps of a few tapered blades, drawn as one instanced
// mesh of plain geometry (no alpha textures). Clumps are scattered over the
// ground near the camera on grid-snapped tiles (see grassLogic.ts): a tile is
// worked out once when it comes into range and given up when it leaves, so a
// moving camera costs a few tiles a step and a still one nothing.
//
// Blades sway with the game's wind (WindField.bend: the gust front runs
// through them), shrink to nothing towards the edge of the ring (and right at
// the lens) so no edge shows, take the cloud shadows, and cast no shadow. They
// stand 0.15 to 0.45 m high: never tall enough to hide a man or a shot.

import * as THREE from "three/webgpu";
import { attribute, cos, float, length, positionGeometry, sin, smoothstep, uniform, varying, vec3 } from "three/tsl";
import { valleyHeight } from "@keepfall/content";
import { applyCloudShadow } from "./clouds";
import { BLADES_PER_CLUMP, CLUMPS_PER_TILE, MAX_TILES, RANGE, TileRing, placeTile, tileKey } from "./grassLogic";
import type { StylePreset } from "./styles";
import type { N } from "./tslUtils";
import type { WindField } from "./windField";

/** Cosmetic jitter of the blades (fixed: every device grows the same tuft). */
function blade(i: number): { r: number; a: number; lean: number; h: number; w: number } {
  const s = (k: number) => {
    const v = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  return { r: 0.1 + s(1) * 0.28, a: s(2) * Math.PI * 2, lean: 0.12 + s(3) * 0.38, h: 0.62 + s(4) * 0.38, w: 0.075 + s(5) * 0.04 };
}

/** One clump: a few blades fanned out from the middle, in unit height (scaled per clump). */
export function clumpGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const t: number[] = [];
  const shade: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let b = 0; b < BLADES_PER_CLUMP; b++) {
    const j = blade(b);
    // The blade's own frame: u along its width, v the way it leans.
    const ya = (b / BLADES_PER_CLUMP) * Math.PI * 2 + j.a * 0.3;
    const ux = Math.cos(ya), uz = Math.sin(ya);
    const vx = -uz, vz = ux;
    const bx = Math.cos(j.a) * j.r, bz = Math.sin(j.a) * j.r;
    // Lean away from the middle of the clump.
    const lx = bx * j.lean * 2.2 + vx * j.lean * 0.3, lz = bz * j.lean * 2.2 + vz * j.lean * 0.3;
    const base = pos.length / 3;
    const rows: Array<[number, number, number]> = [
      [0, j.w, 0],
      [0.5 * j.h, j.w * 0.62, 0.22],
      [j.h, 0.0, 1],
    ];
    for (const [y, w, k] of rows) {
      const off = k * k;
      if (w > 0) {
        pos.push(bx + lx * off - ux * w, y, bz + lz * off - uz * w, bx + lx * off + ux * w, y, bz + lz * off + uz * w);
        t.push(y / j.h, y / j.h);
        shade.push(b / BLADES_PER_CLUMP, b / BLADES_PER_CLUMP);
        nor.push(0, 1, 0, 0, 1, 0);
      } else {
        pos.push(bx + lx * off, y, bz + lz * off);
        t.push(1);
        shade.push(b / BLADES_PER_CLUMP);
        nor.push(0, 1, 0);
      }
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute("aShade", new THREE.Float32BufferAttribute(shade, 1));
  g.setIndex(idx);
  return g;
}

export class GrassTufts {
  readonly root = new THREE.Group();
  /** Clumps standing now (blades are this times BLADES_PER_CLUMP). */
  clumps = 0;
  private mesh: THREE.Mesh;
  private geo = new THREE.InstancedBufferGeometry();
  private mat: THREE.MeshStandardNodeMaterial;
  private aPos: THREE.InstancedBufferAttribute;
  private aVar: THREE.InstancedBufferAttribute;
  private ring = new TileRing();
  private slots = new Map<number, number>();
  private used: Uint8Array = new Uint8Array(MAX_TILES);
  private perSlot = new Int32Array(MAX_TILES);
  private high = 0;
  private enabled = false;
  private stale = false;
  private lastStale = -10;
  private cam = uniform(new THREE.Vector2(0, 0));
  private cDark = uniform(new THREE.Color());
  private cGrass = uniform(new THREE.Color());
  private cGrass2 = uniform(new THREE.Color());
  private dirty = false;
  private groundFn: { drawn(x: number, z: number): number };

  /** `drawn` is the terrain's height as drawn (craters included). */
  constructor(wind: WindField, drawn: (x: number, z: number) => number) {
    this.groundFn = { drawn };
    const base = clumpGeometry();
    this.geo.setIndex(base.index);
    for (const name of ["position", "normal", "aT", "aShade"]) this.geo.setAttribute(name, base.attributes[name]);
    const n = MAX_TILES * CLUMPS_PER_TILE;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.aVar = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aVar.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) this.aPos.array[i * 4 + 1] = -1000;
    this.geo.setAttribute("aPos", this.aPos);
    this.geo.setAttribute("aVar", this.aVar);
    this.geo.instanceCount = 0;

    const m = new THREE.MeshStandardNodeMaterial();
    m.name = "grass-tufts";
    m.side = THREE.DoubleSide;
    m.roughness = 1;
    m.metalness = 0;
    const P: N = attribute("aPos", "vec4");
    const V: N = attribute("aVar", "vec4");
    const t: N = attribute("aT", "float");
    const lp: N = positionGeometry;
    // Full size within the ring, shrinking to nothing at its edge (and at the lens).
    const d: N = length(P.xz.sub(this.cam));
    const fade: N = float(1).sub(smoothstep(RANGE - 10, RANGE, d)).mul(smoothstep(0.5, 2.0, d));
    const h: N = P.w.mul(fade);
    const cy: N = cos(V.x), sy: N = sin(V.x);
    const rx: N = lp.x.mul(cy).add(lp.z.mul(sy));
    const rz: N = lp.z.mul(cy).sub(lp.x.mul(sy));
    const b: N = wind.bend(P.xz, V.z);
    const sway: N = t.mul(t).mul(h).mul(0.3);
    m.positionNode = vec3(P.x.add(rx.mul(h)).add(b.x.mul(sway)), P.y.add(lp.y.mul(h)), P.z.add(rz.mul(h)).add(b.y.mul(sway)));
    const vT: N = varying(t, "vTuftT");
    const vTint: N = varying(V.y, "vTuftTint");
    const vShade: N = varying(attribute("aShade", "float"), "vTuftShade");
    // The ground's grass palette: dark at the root, paler at the tip, a little variety from clump to clump.
    const body: N = (this.cGrass as N).add((this.cGrass2 as N).sub(this.cGrass as N).mul(vTint));
    const root: N = (this.cDark as N).add(body.sub(this.cDark as N).mul(smoothstep(0.0, 0.7, vT)));
    m.colorNode = root.mul(float(0.88).add(vShade.mul(0.2)).add(vT.mul(0.14)));
    applyCloudShadow(m);
    this.mat = m;

    this.mesh = new THREE.Mesh(this.geo, m);
    this.mesh.name = "grass-tufts";
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.root.name = "grass";
    this.root.add(this.mesh);
  }

  setStyle(style: StylePreset) {
    (this.cDark.value as THREE.Color).setHex(style.ground.grassDark);
    (this.cGrass.value as THREE.Color).setHex(style.ground.grass);
    (this.cGrass2.value as THREE.Color).setHex(style.ground.grass2);
  }

  /** On at High and Ultra only (TIERS[tier].tufts). Off gives every tile back. */
  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    this.mesh.visible = on;
    if (!on) this.releaseAll();
  }

  /** The ground changed under the ring (a crater, a reset): the tiles in range are worked out again soon. */
  invalidate() {
    this.stale = true;
  }

  /** Blades standing now. */
  get blades(): number {
    return this.clumps * BLADES_PER_CLUMP;
  }

  /** Once a frame with the camera's position and the game's clock. */
  update(camX: number, camZ: number, now: number) {
    if (!this.enabled) return;
    this.cam.value.set(camX, camZ);
    if (this.stale && now - this.lastStale > 0.5) {
      this.stale = false;
      this.lastStale = now;
      this.releaseAll();
    }
    this.ring.update(
      camX,
      camZ,
      (tx, tz) => this.enter(tx, tz),
      (tx, tz) => this.leave(tx, tz),
    );
    if (this.dirty) {
      this.dirty = false;
      this.aPos.needsUpdate = true;
      this.aVar.needsUpdate = true;
      this.geo.instanceCount = this.high * CLUMPS_PER_TILE;
    }
  }

  private releaseAll() {
    this.ring.reset((tx, tz) => this.leave(tx, tz));
  }

  private enter(tx: number, tz: number) {
    let s = -1;
    for (let i = 0; i < MAX_TILES; i++) {
      if (!this.used[i]) {
        s = i;
        break;
      }
    }
    if (s < 0) return;
    this.used[s] = 1;
    this.slots.set(tileKey(tx, tz), s);
    if (s + 1 > this.high) this.high = s + 1;
    const P = this.aPos.array as Float32Array, V = this.aVar.array as Float32Array;
    let k = s * CLUMPS_PER_TILE;
    const end = k + CLUMPS_PER_TILE;
    const n = placeTile(tx, tz, valleyHeight, this.groundFn, (x, z, h, yaw, tint, phase) => {
      P[k * 4] = x;
      P[k * 4 + 1] = this.groundFn.drawn(x, z) - 0.02;
      P[k * 4 + 2] = z;
      P[k * 4 + 3] = h;
      V[k * 4] = yaw;
      V[k * 4 + 1] = tint;
      V[k * 4 + 2] = phase;
      k++;
    });
    this.perSlot[s] = n;
    this.clumps += n;
    for (; k < end; k++) {
      P[k * 4 + 1] = -1000;
      P[k * 4 + 3] = 0;
    }
    this.dirty = true;
  }

  private leave(tx: number, tz: number) {
    const key = tileKey(tx, tz);
    const s = this.slots.get(key);
    if (s === undefined) return;
    this.slots.delete(key);
    this.used[s] = 0;
    this.clumps -= this.perSlot[s];
    this.perSlot[s] = 0;
    const P = this.aPos.array as Float32Array;
    for (let k = s * CLUMPS_PER_TILE; k < (s + 1) * CLUMPS_PER_TILE; k++) {
      P[k * 4 + 1] = -1000;
      P[k * 4 + 3] = 0;
    }
    while (this.high > 0 && !this.used[this.high - 1]) this.high--;
    this.dirty = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
