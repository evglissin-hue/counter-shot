// Terrain: one large ground mesh built from terrainHeight() (exactly flat
// inside FIELD, rolling hills outside), a pond carved into the hills outside
// the field, a ring of far mountains, and per-style ground materials with a
// worn road between the two gates and trampled earth around the walls.

import * as THREE from "three/webgpu";
import {
  Fn,
  abs,
  cameraPosition,
  clamp,
  color,
  dot,
  float,
  fract,
  length,
  max,
  min,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  texture,
  vec2,
  vec3,
  attribute,
  varying,
} from "three/tsl";
import { DIST, FIELD, terrainHeight } from "@keepfall/content";
import { Rng } from "@keepfall/core";
import type { Sky } from "./sky";
import type { StyleName, StylePreset } from "./styles";
import { N, aaLine } from "./tslUtils";

export const POND = { x: -86, z: 22, r: 17 };
const POND_DEPTH = 2.2;
let pondLevel = 0;

function pondInit() {
  let lo = Infinity;
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const h = terrainHeight(POND.x + Math.cos(a) * (POND.r + 6), POND.z + Math.sin(a) * (POND.r + 6));
    if (h < lo) lo = h;
  }
  pondLevel = Math.max(0.6, lo - 0.45);
}
pondInit();

export function pondLevelY(): number {
  return pondLevel;
}

/** Render height: the core terrain plus the pond bowl (outside the field only). */
export function groundHeight(x: number, z: number): number {
  const h = terrainHeight(x, z);
  const dx = x - POND.x;
  const dz = z - POND.z;
  const r = Math.hypot(dx, dz);
  const R = POND.r;
  if (r > R + 14) return h;
  const t = Math.min(1, Math.max(0, (R + 14 - r) / 16));
  const f = t * t * (3 - 2 * t);
  const q = r / R;
  const bowl = r < R ? pondLevel - POND_DEPTH * (1 - q * q) : pondLevel + (r - R) * 0.32;
  return h + (Math.min(h, bowl) - h) * f;
}

/** Road centreline between the gates (x as a function of z). Mirrored in the shader. */
export function roadX(z: number): number {
  return 1.3 * Math.sin(z * 0.043 + 0.4) + 0.7 * Math.sin(z * 0.11 + 1.3);
}

function axisLines(lo: number, hi: number, fieldLo: number, fieldHi: number, inner: number, step0: number, growth: number): number[] {
  const out: number[] = [];
  const n = Math.max(1, Math.ceil((fieldHi - fieldLo) / inner));
  for (let i = 0; i <= n; i++) out.push(fieldLo + ((fieldHi - fieldLo) * i) / n);
  let s = step0;
  let x = fieldHi;
  while (x < hi) {
    x += s;
    s *= growth;
    out.push(Math.min(x, hi));
  }
  s = step0;
  x = fieldLo;
  const left: number[] = [];
  while (x > lo) {
    x -= s;
    s *= growth;
    left.push(Math.max(x, lo));
  }
  return [...left.reverse(), ...out];
}

function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function buildTerrainGeometry(): THREE.BufferGeometry {
  const EXT = 2300;
  const cz = (FIELD.z0 + FIELD.z1) / 2;
  const xs = axisLines(-EXT, EXT, FIELD.x0, FIELD.x1, 4, 2.4, 1.055);
  const zs = axisLines(cz - EXT, cz + EXT, FIELD.z0, FIELD.z1, 4, 2.4, 1.055);
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const nor = new Float32Array(nx * nz * 3);
  const eps = 0.6;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      let x = xs[i];
      let z = zs[j];
      const inside = x >= FIELD.x0 && x <= FIELD.x1 && z >= FIELD.z0 && z <= FIELD.z1;
      if (!inside && i > 0 && i < nx - 1 && j > 0 && j < nz - 1) {
        // Jitter outside the field so faceted shading does not look like a grid.
        const sx = (xs[i + 1] - xs[i - 1]) * 0.5;
        const sz = (zs[j + 1] - zs[j - 1]) * 0.5;
        const onEdgeX = x === FIELD.x0 || x === FIELD.x1;
        const onEdgeZ = z === FIELD.z0 || z === FIELD.z1;
        if (!onEdgeX) x += (hash2(i, j) - 0.5) * sx * 0.5;
        if (!onEdgeZ) z += (hash2(j + 999, i) - 0.5) * sz * 0.5;
      }
      const y = groundHeight(x, z);
      const o = (j * nx + i) * 3;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
      const hx = groundHeight(x + eps, z) - groundHeight(x - eps, z);
      const hz = groundHeight(x, z + eps) - groundHeight(x, z - eps);
      const nl = Math.hypot(hx, 2 * eps, hz);
      nor[o] = -hx / nl;
      nor[o + 1] = (2 * eps) / nl;
      nor[o + 2] = -hz / nl;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Alternate the diagonal for a less regular look.
      if ((i + j) & 1) {
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      } else {
        idx[k++] = a; idx[k++] = c; idx[k++] = d;
        idx[k++] = a; idx[k++] = d; idx[k++] = b;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** A ring of distant mountains for a layered horizon. */
export function buildMountainGeometry(): THREE.BufferGeometry {
  const seg = 220;
  // The first row sits under the terrain's rising rim so there is never a gap.
  const rows = [1900, 2550, 2850, 3150, 3550];
  const rng = new Rng(4242).fork("mountains");
  const peaks: number[] = [];
  for (let i = 0; i < 24; i++) peaks.push(rng.next());
  const peaks2: number[] = [];
  for (let i = 0; i < 61; i++) peaks2.push(rng.next());
  const periodic = (arr: number[], t: number) => {
    const n = arr.length;
    const x = t * n;
    const i0 = Math.floor(x) % n;
    const i1 = (i0 + 1) % n;
    const f = x - Math.floor(x);
    const u = f * f * (3 - 2 * f);
    return arr[i0] * (1 - u) + arr[i1] * u;
  };
  const pos: number[] = [];
  const cz = -DIST / 2;
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const a = t * Math.PI * 2;
      const ridge = periodic(peaks, t) * 0.7 + periodic(peaks2, t) * 0.3;
      const prof = [0, 0.7, 1.0, 0.75, 0.25][r];
      const h = r === 0 ? 70 : 110 + (ridge * ridge * 420 + 60) * prof;
      const rr = rows[r] + (r === 0 ? 0 : (periodic(peaks2, (t + 0.37) % 1) - 0.5) * 300);
      pos.push(Math.cos(a) * rr, h, cz + Math.sin(a) * rr);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < seg; i++) {
      const a = r * (seg + 1) + i;
      const b = a + 1;
      const c = a + seg + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Water surface for the pond, with depth per vertex. */
export function buildWaterGeometry(): THREE.BufferGeometry {
  const R = POND.r + 6;
  const ring = new THREE.RingGeometry(0.01, R, 64, 8);
  ring.rotateX(-Math.PI / 2);
  const pos = ring.attributes.position as THREE.BufferAttribute;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + POND.x;
    const z = pos.getZ(i) + POND.z;
    pos.setXYZ(i, x, pondLevel, z);
    depth[i] = pondLevel - groundHeight(x, z);
  }
  ring.setAttribute("depth", new THREE.BufferAttribute(depth, 1));
  ring.deleteAttribute("uv");
  ring.computeVertexNormals();
  return ring;
}

interface TerrainCtx {
  style: StylePreset;
  noise: THREE.Texture;
  sky: Sky;
}

const W = { x0: FIELD.x0, x1: FIELD.x1, z0: FIELD.z0, z1: FIELD.z1 };

export function makeTerrainMaterial({ style, noise, sky }: TerrainCtx): THREE.MeshStandardNodeMaterial {
  const G = style.ground;
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = `${style.name}-terrain`;
  mat.flatShading = style.geometry.flat;
  mat.metalness = 0;
  const wp: N = positionWorld;
  const x: N = wp.x;
  const z: N = wp.z;
  const flat = style.geometry.flat;

  const colorFn = Fn(() => {
    const big = texture(noise, vec2(x, z).div(180.0));
    const mid = texture(noise, vec2(x, z).div(41.0).add(0.37));
    const fine = texture(noise, vec2(x, z).div(7.3).add(0.71));
    const dist = wp.sub(cameraPosition).length();
    const near = float(1).sub(smoothstep(25.0, 140.0, dist));

    // Grass: two hues in big patches, darker clumps, fine texture up close.
    const c: N = mix(color(G.grass), color(G.grass2), smoothstep(0.35, 0.68, big.r)).toVar();
    c.assign(mix(c, color(G.grassDark), smoothstep(0.5, 0.75, mid.g).mul(0.55)));
    if (!flat) {
      c.mulAssign(float(1).add(fine.g.sub(0.5).mul(0.28).mul(mix(0.35, 1.0, near))));
      const micro = texture(noise, vec2(x, z).div(1.37).add(0.13));
      const close = float(1).sub(smoothstep(6.0, 45.0, dist));
      c.mulAssign(float(1).add(micro.g.sub(0.5).mul(0.35).add(micro.a.sub(0.5).mul(0.2)).mul(close)));
    }
    else c.assign(mix(c, color(G.grass2), smoothstep(0.62, 0.66, mid.r).mul(0.35)));

    // Hills: lighter, sunnier tops and darker hollows.
    const hgt = wp.y;
    c.assign(mix(c, color(G.hill), smoothstep(4.0, 40.0, hgt).mul(0.6)));
    // Steep slopes show earth.
    const slope = float(1).sub(normalWorld.y);
    c.assign(mix(c, color(G.dirt).mul(0.9), smoothstep(0.18, 0.4, slope).mul(0.7)));

    // Distance to each castle's outer wall square (castle 0 at z=0, castle 1 at z=-DIST).
    const ax = abs(x);
    const d0 = max(ax.sub(15.0), abs(z).sub(15.0));
    const d1 = max(ax.sub(15.0), abs(z.add(DIST)).sub(15.0));
    const dWall = min(d0, d1);
    // Trampled earth just outside the walls and inside the courtyards.
    const band = float(1).sub(smoothstep(0.5, 6.5, dWall.add(mid.r.sub(0.5).mul(5.0)))).mul(smoothstep(-1.6, -0.2, dWall));
    const court = float(1).sub(smoothstep(-2.6, -1.2, dWall));
    const nearWall = band;
    const wornOut = band.mul(0.85).mul(smoothstep(0.25, 0.6, big.g.add(fine.r.mul(0.3))).mul(0.6).add(0.45));
    // Courtyards: packed earth with a few grassy tufts.
    const yardGrass = smoothstep(0.55, 0.75, mid.g.add(fine.r.mul(0.4)));
    const wornIn = court.mul(float(0.92).sub(yardGrass.mul(0.5)));
    const worn = clamp(max(wornOut, wornIn), 0.0, 1.0);
    c.assign(mix(c, color(G.dirt).mul(fine.g.mul(0.25).add(0.88)), worn));

    // The road between the gates, with wheel ruts and a grassy crown.
    const rx = sin(z.mul(0.043).add(0.4)).mul(1.3).add(sin(z.mul(0.11).add(1.3)).mul(0.7));
    const dr = abs(x.sub(rx));
    const zin = smoothstep(-DIST + 12.0, -DIST + 16.5, z).mul(float(1).sub(smoothstep(-16.5, -12.0, z)));
    const edgeNoise = mid.g.sub(0.5).mul(1.4).add(fine.r.sub(0.5).mul(0.6));
    const road = float(1).sub(smoothstep(2.0, 2.9, dr.add(edgeNoise))).mul(zin);
    const ruts = aaLine(abs(dr.sub(0.95)), 0.32).mul(road);
    const crown = float(1).sub(smoothstep(0.18, 0.45, dr)).mul(road);
    c.assign(mix(c, color(G.road), road));
    if (!flat) {
      c.assign(mix(c, color(G.road).mul(0.78), ruts.mul(0.8)));
      c.assign(mix(c, mix(color(G.grass), color(G.road), 0.45), crown.mul(0.6)));
    }

    if (style.name === "gritty") {
      // Trampled, darker grass around both castles.
      const trampled = float(1).sub(smoothstep(4.0, 30.0, dWall.add(mid.g.sub(0.5).mul(12.0))));
      c.assign(mix(c, c.mul(vec3(0.72, 0.68, 0.6)), trampled.mul(0.7)));
      // A churned, muddy battlefield in the middle of the field.
      const field = smoothstep(-6.0, 6.0, float(W.x1).sub(ax)).mul(smoothstep(W.z0 + 10, W.z0 + 40, z)).mul(float(1).sub(smoothstep(W.z1 - 40, W.z1 - 10, z)));
      const mudA = smoothstep(0.47, 0.62, big.g.mul(0.65).add(mid.r.mul(0.35))).mul(field);
      const mud = clamp(mudA.mul(0.85).add(road.mul(0.7)).add(nearWall.mul(0.6)), 0.0, 1.0);
      c.assign(mix(c, color(G.mud).mul(fine.g.mul(0.3).add(0.82)), mud));
      // Puddles in the mud reflect the overcast sky.
      const puddle = smoothstep(0.6, 0.63, mid.g.mul(0.7).add(fine.r.mul(0.3))).mul(smoothstep(0.6, 0.85, mud));
      const v: N = normalize(wp.sub(cameraPosition));
      const refl = sky.skyColor(normalize(vec3(v.x, abs(v.y), v.z)), false);
      const fres = pow(float(1).sub(abs(v.y)), 4.0).mul(0.75).add(0.2);
      c.assign(mix(c, mix(color(G.mud).mul(0.45), refl, fres), puddle.mul(0.9)));
    }
    if (G.flowers > 0) {
      // Speckles of flowers in the meadow, near the camera only.
      const f = texture(noise, vec2(x, z).div(2.1)).a;
      const fl = smoothstep(0.86, 0.9, f).mul(smoothstep(0.5, 0.7, mid.r)).mul(near).mul(float(1).sub(road)).mul(float(1).sub(worn)).mul(G.flowers);
      const hue = fract(f.mul(37.0));
      const fc = mix(vec3(1.0, 0.95, 0.85), mix(vec3(1.0, 0.82, 0.25), vec3(0.95, 0.55, 0.7), smoothstep(0.5, 0.8, hue)), smoothstep(0.3, 0.6, hue));
      c.assign(mix(c, fc, fl));
    }
    // Pond shore: damp, darker earth.
    const pd = length(vec2(x.sub(POND.x), z.sub(POND.z)));
    const shore = float(1).sub(smoothstep(POND.r - 1.0, POND.r + 4.0, pd));
    c.assign(mix(c, mix(color(G.dirt), color(G.grassDark), 0.5).mul(flat ? 1.1 : 0.8), shore.mul(flat ? 0.8 : 0.45)));
    return c;
  });
  mat.colorNode = colorFn();
  if (style.name === "gritty") {
    // Wet mud is shinier.
    const big: N = texture(noise, vec2(x, z).div(180.0));
    mat.roughnessNode = mix(float(G.roughness), float(0.5), smoothstep(0.5, 0.65, big.g).mul(0.6));
  } else {
    mat.roughness = G.roughness;
  }
  return mat;
}

export function makeMountainMaterial(style: StylePreset, sky: Sky): THREE.MeshStandardNodeMaterial {
  // A painted backdrop: lit a little by the sun, then mostly dissolved into
  // the aerial haze (bluish) and, further out, the sky's horizon colour.
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = `${style.name}-mountains`;
  mat.flatShading = style.geometry.flat;
  mat.roughness = 1;
  mat.metalness = 0;
  mat.fog = false;
  const wp: N = positionWorld;
  const y: N = wp.y;
  const top = style.name === "gritty" ? 0x6a7072 : 0xf4f6fa;
  const snow = smoothstep(style.name === "lowpoly" ? 430.0 : 500.0, style.name === "lowpoly" ? 450.0 : 660.0, y).mul(style.name === "gritty" ? 0.4 : 1.0);
  const toFrag: N = wp.sub(cameraPosition);
  const dist: N = toFrag.length();
  const dir: N = normalize(vec3(toFrag.x, max(toFrag.y, 0.0).mul(0.2).add(dist.mul(0.012)), toFrag.z));
  const haze: N = mix(sky.hazeColor(dir), sky.skyColor(dir, false), smoothstep(2600.0, 3700.0, dist).mul(0.6).add(0.2));
  const k: N = clamp(float(style.sky.mountainHaze).add(smoothstep(2500.0, 3700.0, dist).mul(0.25)).sub(smoothstep(150.0, 650.0, y).mul(0.1)), 0.0, 0.95);
  mat.emissiveNode = haze.mul(k);
  mat.colorNode = mix(color(style.sky.mountain), color(top), snow).mul(float(1).sub(k));
  return mat;
}

export function makeWaterMaterial(style: StylePreset, sky: Sky, noise: THREE.Texture, time: N): THREE.MeshStandardNodeMaterial {
  const W2 = style.water;
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = `${style.name}-water`;
  mat.metalness = 0;
  mat.roughness = style.name === "lowpoly" ? 0.6 : 0.08;
  mat.flatShading = style.geometry.flat;
  const depth: N = varying(attribute("depth", "float"));
  const wp: N = positionWorld;
  const uv1: N = vec2(wp.x, wp.z).div(26.0).add(vec2(time.mul(0.006), time.mul(0.004)));
  const uv2: N = vec2(wp.z, wp.x).div(17.0).sub(vec2(time.mul(0.005), time.mul(-0.006)));
  const n1: N = texture(noise, uv1);
  const n2: N = texture(noise, uv2);
  const ripple: N = vec2(n1.r.sub(n2.r), n2.r.add(n1.r).sub(1.0)).mul(style.name === "lowpoly" ? 0.0 : 0.16);
  const nrm: N = normalize(vec3(ripple.x, 1.0, ripple.y));
  mat.colorNode = Fn(() => {
    const viewDir = normalize(wp.sub(cameraPosition));
    const r: N = reflect(viewDir, nrm);
    const fres = pow(float(1).sub(max(dot(viewDir.negate(), nrm), 0.0)), 3.0).mul(0.8).add(0.1);
    const sky0 = sky.skyColor(normalize(vec3(r.x, max(r.y, 0.02), r.z)), false);
    const body = mix(color(W2.shallow), color(W2.deep), smoothstep(0.1, 1.8, depth));
    const c: N = mix(body, sky0, clamp(fres.mul(W2.reflect), 0.0, 1.0)).toVar();
    // A soft light rim where the water is shallow.
    const foam = float(1).sub(smoothstep(0.05, 0.35, depth));
    c.assign(mix(c, vec3(0.95, 0.97, 0.95), foam.mul(style.name === "gritty" ? 0.1 : 0.45)));
    return c;
  })();
  return mat;
}

export class Terrain {
  readonly ground: THREE.Mesh;
  readonly mountains: THREE.Mesh;
  readonly water: THREE.Mesh;
  private materials = new Map<StyleName, { ground: THREE.Material; mountains: THREE.Material; water: THREE.Material }>();
  private noise: THREE.Texture;
  private sky: Sky;
  private time: N;

  constructor(noise: THREE.Texture, sky: Sky, time: N) {
    this.noise = noise;
    this.sky = sky;
    this.time = time;
    this.ground = new THREE.Mesh(buildTerrainGeometry());
    this.ground.name = "terrain";
    this.ground.receiveShadow = true;
    this.mountains = new THREE.Mesh(buildMountainGeometry());
    this.mountains.name = "mountains";
    this.mountains.frustumCulled = false;
    this.water = new THREE.Mesh(buildWaterGeometry());
    this.water.name = "water";
    this.water.receiveShadow = true;
  }

  setStyle(style: StylePreset) {
    let m = this.materials.get(style.name);
    if (!m) {
      m = {
        ground: makeTerrainMaterial({ style, noise: this.noise, sky: this.sky }),
        mountains: makeMountainMaterial(style, this.sky),
        water: makeWaterMaterial(style, this.sky, this.noise, this.time),
      };
      this.materials.set(style.name, m);
    }
    this.ground.material = m.ground;
    this.mountains.material = m.mountains;
    this.water.material = m.water;
  }

  dispose() {
    this.ground.geometry.dispose();
    this.mountains.geometry.dispose();
    this.water.geometry.dispose();
    for (const m of this.materials.values()) {
      m.ground.dispose();
      m.mountains.dispose();
      m.water.dispose();
    }
  }
}

