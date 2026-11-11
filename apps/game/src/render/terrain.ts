// Terrain: the valley (@keepfall/content's valleyHeight) as two ground meshes,
// the stream's water, a ring of far mountains, and the Gritty ground material.
//
// Inside the physics height grid (TERRAIN_GRID, 1 m cells) the field mesh has
// one vertex per grid vertex, so crater patches from the sim map straight
// onto it. A coarse surround with a hole over the grid carries the valley's
// sides, the hills and the stream's gorges out to the horizon. Crater depth
// below the original ground feeds a vertex attribute that darkens the hollow
// to wet black mud with a rim of fresh earth.
//
// The ground material reads the valley per pixel: grass in patches, straw,
// heath and specks of flowers, the road and the flank paths worn into it,
// wet mud, gravel and pebbles along the stream, rock with strata and lichen
// on steep slopes and crags, moss low down, trampled earth by the walls.

import * as THREE from "three/webgpu";
import {
  Fn,
  abs,
  attribute,
  cameraPosition,
  clamp,
  color,
  float,
  floor,
  fract,
  hash,
  length,
  max,
  min,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  texture,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { DIST, MID_Z, STREAM, valleyGrid, valleyHeight } from "@keepfall/content";
import { Rng } from "@keepfall/core";
import { TERRAIN_GRID, type TerrainPatch } from "@keepfall/sim";
import { applyCloudShadow } from "./clouds";
import type { Sky } from "./sky";
import { buildStreamGeometry, makeStreamMaterial } from "./stream";
import type { StylePreset } from "./styles";
import { N, aaLine, bumpNormal } from "./tslUtils";
import { routeDistanceNodes, streamEdgeNode, wallDistanceNode } from "./valleyNodes";
import { applyWindSheen } from "./windSheen";
import type { WindField } from "./windField";

/** Render height everywhere: the valley's own ground. */
export function groundHeight(x: number, z: number): number {
  return valleyHeight(x, z);
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

const TG = TERRAIN_GRID;
const GX1 = TG.x0 + (TG.nx - 1) * TG.cell;
const GZ1 = TG.z0 + (TG.nz - 1) * TG.cell;

export interface TerrainGeometry {
  geometry: THREE.BufferGeometry;
  nx: number;
  nz: number;
  /** Mesh column and row of grid vertex (0, 0). */
  gi0: number;
  gj0: number;
}

/** Normal from heights a small step either side (valleyHeight). */
function analyticNormal(x: number, z: number, out: Float32Array, o: number) {
  const eps = 0.6;
  const hx = valleyHeight(x + eps, z) - valleyHeight(x - eps, z);
  const hz = valleyHeight(x, z + eps) - valleyHeight(x, z - eps);
  const nl = Math.hypot(hx, 2 * eps, hz);
  out[o] = -hx / nl;
  out[o + 1] = (2 * eps) / nl;
  out[o + 2] = -hz / nl;
}

/**
 * The ground in two meshes: the physics grid at 1 m (patched for craters) and
 * a coarse surround with a hole where the grid is. The field hangs a short
 * skirt under its border, so where the coarse edge cannot follow the 1 m
 * border exactly (crags at the grid's edge) no gap opens.
 */
export function buildTerrainGeometry(): { outer: THREE.BufferGeometry; field: TerrainGeometry } {
  const EXT = 2300;
  const cz = MID_Z;
  const xs = axisLines(-EXT, EXT, TG.x0, GX1, 4, 2.4, 1.06);
  // Fine lines across the stream, so its channel and gorges survive in the coarse surround.
  const zs = axisLines(cz - EXT, cz + EXT, TG.z0, GZ1, 4, 2.4, 1.06).filter((z) => Math.abs(z - cz) > 15);
  for (let z = cz - 15; z <= cz + 15; z += 1.5) zs.push(z);
  zs.sort((a, b) => a - b);
  const outer = buildOuter(xs, zs);
  return { outer, field: buildField() };
}

function buildOuter(xs: number[], zs: number[]): THREE.BufferGeometry {
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const nor = new Float32Array(nx * nz * 3);
  const seam = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      let x = xs[i];
      let z = zs[j];
      const inGrid = x >= TG.x0 && x <= GX1 && z >= TG.z0 && z <= GZ1;
      if (!inGrid && i > 0 && i < nx - 1 && j > 0 && j < nz - 1) {
        // Jitter outside the grid so faceted shading does not look like a grid; the seam stays put.
        const sx = (xs[i + 1] - xs[i - 1]) * 0.5;
        const sz = (zs[j + 1] - zs[j - 1]) * 0.5;
        if (Math.abs(z - MID_Z) > 16) x += (hash2(i, j) - 0.5) * sx * 0.5;
        z += (hash2(j + 999, i) - 0.5) * sz * 0.5;
      }
      const o = (j * nx + i) * 3;
      pos[o] = x;
      pos[o + 1] = valleyHeight(x, z);
      pos[o + 2] = z;
      seam[j * nx + i] = inGrid ? 1 : 0;
    }
  }
  // Normals from the neighbouring vertices (cheap); along the seam from the heights themselves, as the field does.
  const P = (i: number, j: number, c: number) => pos[(j * nx + i) * 3 + c];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 3;
      if (seam[j * nx + i]) {
        analyticNormal(pos[o], pos[o + 2], nor, o);
        continue;
      }
      const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(nz - 1, j + 1);
      const ax = P(i1, j, 0) - P(i0, j, 0), ay = P(i1, j, 1) - P(i0, j, 1), az = P(i1, j, 2) - P(i0, j, 2);
      const bx = P(i, j1, 0) - P(i, j0, 0), by = P(i, j1, 1) - P(i, j0, 1), bz = P(i, j1, 2) - P(i, j0, 2);
      // n = b x a (pointing up for a along +x and b along +z).
      let cx = by * az - bz * ay, cy = bz * ax - bx * az, cz = bx * ay - by * ax;
      const l = Math.hypot(cx, cy, cz) || 1;
      cx /= l;
      cy /= l;
      cz /= l;
      if (cy < 0) {
        cx = -cx;
        cy = -cy;
        cz = -cz;
      }
      nor[o] = cx;
      nor[o + 1] = cy;
      nor[o + 2] = cz;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      // A hole where the 1 m field mesh is.
      if (xs[i] >= TG.x0 && xs[i + 1] <= GX1 && zs[j] >= TG.z0 && zs[j + 1] <= GZ1) continue;
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
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
  g.setAttribute("aCrater", new THREE.BufferAttribute(new Float32Array(nx * nz), 1));
  // L2/L3 ground marks: none on the coarse surround (the field mesh carries them).
  g.setAttribute("aMarks", new THREE.BufferAttribute(new Float32Array(nx * nz * 4), 4));
  g.setIndex(new THREE.BufferAttribute(idx.slice(0, k), 1));
  g.computeBoundingSphere();
  return g;
}

/** Depth of the skirt hung under the field's border. */
const SKIRT = 5;

/** The field's border vertices in order round the grid (ids into the grid). */
function borderLoop(nx: number, nz: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < nx; i++) out.push(i);
  for (let j = 1; j < nz; j++) out.push(j * nx + nx - 1);
  for (let i = nx - 2; i >= 0; i--) out.push((nz - 1) * nx + i);
  for (let j = nz - 2; j >= 0; j--) out.push(j * nx);
  return out;
}

/** The physics grid's mesh: heights from the shared valley grid, normals from it (the border from the analytic heights, as the surround), and a skirt under the border. */
function buildField(): TerrainGeometry {
  const nx = TG.nx, nz = TG.nz;
  const H = valleyGrid();
  const loop = borderLoop(nx, nz);
  const total = nx * nz + loop.length;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 3;
      const x = TG.x0 + i * TG.cell, z = TG.z0 + j * TG.cell;
      pos[o] = x;
      pos[o + 1] = H[j * nx + i];
      pos[o + 2] = z;
      if (i === 0 || j === 0 || i === nx - 1 || j === nz - 1) {
        analyticNormal(x, z, nor, o);
      } else {
        const hx = H[j * nx + i + 1] - H[j * nx + i - 1];
        const hz = H[(j + 1) * nx + i] - H[(j - 1) * nx + i];
        const two = 2 * TG.cell;
        const l = Math.hypot(hx, two, hz);
        nor[o] = -hx / l;
        nor[o + 1] = two / l;
        nor[o + 2] = -hz / l;
      }
    }
  }
  // The skirt: a copy of each border vertex a few metres down.
  for (let s = 0; s < loop.length; s++) {
    const v = loop[s], o = (nx * nz + s) * 3;
    pos[o] = pos[v * 3];
    pos[o + 1] = pos[v * 3 + 1] - SKIRT;
    pos[o + 2] = pos[v * 3 + 2];
    nor[o] = nor[v * 3];
    nor[o + 1] = nor[v * 3 + 1];
    nor[o + 2] = nor[v * 3 + 2];
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6 + loop.length * 12);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if ((i + j) & 1) {
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      } else {
        idx[k++] = a; idx[k++] = c; idx[k++] = d;
        idx[k++] = a; idx[k++] = d; idx[k++] = b;
      }
    }
  }
  for (let s = 0; s < loop.length; s++) {
    const a = loop[s], b = loop[(s + 1) % loop.length];
    const a2 = nx * nz + s, b2 = nx * nz + ((s + 1) % loop.length);
    // Both windings: the skirt is seen from whichever side a gap opens.
    idx[k++] = a; idx[k++] = a2; idx[k++] = b;
    idx[k++] = b; idx[k++] = a2; idx[k++] = b2;
    idx[k++] = a; idx[k++] = b; idx[k++] = a2;
    idx[k++] = b; idx[k++] = b2; idx[k++] = a2;
  }
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3);
  const na = new THREE.BufferAttribute(nor, 3);
  const ca = new THREE.BufferAttribute(new Float32Array(total), 1);
  pa.setUsage(THREE.DynamicDrawUsage);
  na.setUsage(THREE.DynamicDrawUsage);
  ca.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("position", pa);
  g.setAttribute("normal", na);
  g.setAttribute("aCrater", ca);
  // L2/L3 ground marks: (scorch, dust, trodden, spare) per vertex, written by groundMarks.ts.
  const ma = new THREE.BufferAttribute(new Float32Array(total * 4), 4);
  ma.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("aMarks", ma);
  g.setIndex(new THREE.BufferAttribute(idx.slice(0, k), 1));
  g.computeBoundingSphere();
  return { geometry: g, nx, nz, gi0: 0, gj0: 0 };
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
      const h = r === 0 ? 90 : 120 + (ridge * ridge * 420 + 60) * prof;
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

interface TerrainCtx {
  style: StylePreset;
  noise: THREE.Texture;
  sky: Sky;
  /** The game's wind (look round L3): moves a sheen over the grass. */
  wind?: WindField;
}

export function makeTerrainMaterial({ style, noise, sky, wind }: TerrainCtx): THREE.MeshStandardNodeMaterial {
  const G = style.ground;
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = `${style.name}-terrain`;
  mat.metalness = 0;
  const wp: N = positionWorld;
  const x: N = wp.x;
  const z: N = wp.z;
  const y: N = wp.y;
  // Signed crater depth: positive below the original ground, negative on raised rims.
  const crater: N = varying(attribute("aCrater", "float"), "vCrater");
  const dist: N = wp.sub(cameraPosition).length();
  const near: N = float(1).sub(smoothstep(25.0, 160.0, dist));
  const close: N = float(1).sub(smoothstep(6.0, 50.0, dist));

  // Shared lookups.
  const big: N = texture(noise, vec2(x, z).div(180.0));
  const mid: N = texture(noise, vec2(x, z).div(41.0).add(0.37));
  const patch: N = texture(noise, vec2(z, x).div(67.0).add(0.21));
  const fine: N = texture(noise, vec2(x, z).div(7.3).add(0.71));
  const micro: N = texture(noise, vec2(x, z).div(1.37).add(0.13));
  const steep: N = clamp(float(1).sub(normalWorld.y), 0.0, 1.0);
  const { edge: streamEdge } = streamEdgeNode(x, z);
  const routes = routeDistanceNodes(x, z);
  const dWall: N = wallDistanceNode(x, z);
  // How much rock shows: only really steep faces (crags), more where the crag noise says so;
  // gentler slopes (banks, gorge sides) stay grass and scree.
  const rockMask: N = smoothstep(0.33, 0.55, steep.add(mid.b.sub(0.5).mul(0.2)).add(fine.r.sub(0.5).mul(0.08)));
  // Rock strata: tilted, wavering bands broken up by noise, and blocky joints.
  const strataY: N = y.add(x.mul(0.07)).add(z.mul(-0.05)).add(mid.r.sub(0.5).mul(5.0)).add(fine.g.sub(0.5).mul(0.8));
  const strata: N = smoothstep(0.25, 0.75, sin(strataY.mul(1.7)).mul(0.5).add(0.5).mul(0.6).add(fine.r.mul(0.4)));
  const cracks: N = float(1).sub(smoothstep(0.0, 0.08, texture(noise, vec2(x.add(z.mul(0.3)), y.mul(1.7)).div(4.0)).b));

  const colorFn = Fn(() => {
    // Grass: two hues in big patches, darker clumps, fine texture up close.
    const c: N = mix(color(G.grass), color(G.grass2), smoothstep(0.32, 0.7, big.r)).toVar();
    c.assign(mix(c, color(G.grassDark), smoothstep(0.48, 0.75, mid.g).mul(0.6)));
    // Fields of a different cast: rough pasture, yellower; damp meadow, bluer.
    const pasture: N = smoothstep(0.5, 0.66, patch.b.add(big.g.mul(0.3)).sub(0.12));
    c.assign(mix(c, c.mul(vec3(1.2, 1.09, 0.78)), pasture.mul(0.85)));
    const meadowDamp: N = smoothstep(0.52, 0.7, mid.b.mul(0.5).add(big.b.mul(0.5)));
    c.assign(mix(c, c.mul(vec3(0.8, 0.9, 0.88)), meadowDamp.mul(0.75)));
    // Broad light and dark swathes, as wind and cloud shadow leave on grass.
    c.mulAssign(big.r.sub(0.5).mul(0.22).add(1.0));
    c.mulAssign(float(1).add(fine.g.sub(0.5).mul(0.34).mul(mix(0.35, 1.0, near))));
    c.mulAssign(float(1).add(micro.g.sub(0.5).mul(0.35).add(micro.a.sub(0.5).mul(0.2)).mul(close)));
    // Dry straw in drifts, more on the higher ground and the ridge tops.
    const dryness: N = smoothstep(0.52, 0.7, patch.r.add(smoothstep(1.5, 9.0, y).mul(0.14)).add(fine.r.sub(0.5).mul(0.14)));
    c.assign(mix(c, color(G.straw).mul(fine.g.mul(0.3).add(0.8)), dryness.mul(0.75)));
    // Heath on the valley sides: muted brown-purple among the grass.
    const heath: N = smoothstep(3.0, 12.0, y).mul(smoothstep(0.45, 0.65, mid.r.add(patch.g.mul(0.3)).sub(0.15)));
    c.assign(mix(c, color(G.heath).mul(fine.g.mul(0.35).add(0.78)), heath.mul(0.55)));
    // Hills: sunnier tops; damp, darker hollows on the valley floor.
    c.assign(mix(c, color(G.hill), smoothstep(6.0, 40.0, y).mul(0.45)));
    c.mulAssign(mix(float(0.88), float(1.0), smoothstep(-0.6, 0.6, y.add(big.g.sub(0.5)))));
    // Specks of flowers in the grass, close up only (they would shimmer far away).
    {
      const cell: N = floor(vec2(x, z).mul(1.6));
      const h: N = hash(cell.x.add(cell.y.mul(57.0)).add(11.0));
      const h2: N = hash(cell.x.mul(13.0).add(cell.y.mul(7.0)).add(3.0));
      const f: N = fract(vec2(x, z).mul(1.6)).sub(0.5);
      const spot: N = float(1).sub(smoothstep(0.08, 0.16, length(f)));
      const meadow: N = smoothstep(0.5, 0.7, patch.g).mul(float(1).sub(dryness)).mul(float(1).sub(rockMask));
      const on: N = step(0.86, h).mul(spot).mul(meadow).mul(close.mul(1.5).min(1.0));
      const fc: N = mix(mix(color(G.flowerA), color(G.flowerB), step(0.5, h2)), color(G.flowerC), step(0.85, h2));
      c.assign(mix(c, fc, on.mul(0.85)));
    }
    // Steep ground below the rock line: patches of bare soil and grey scree among the grass.
    {
      const bare: N = smoothstep(0.12, 0.3, steep).mul(smoothstep(0.35, 0.6, mid.g.mul(0.6).add(fine.r.mul(0.4))));
      const soil: N = mix(color(G.dirt), color(style.rock), 0.35).mul(0.8);
      const scree: N = mix(soil, color(style.rock).mul(0.75), smoothstep(0.4, 0.7, fine.b)).mul(fine.g.mul(0.35).add(0.72));
      c.assign(mix(c, scree, bare.mul(0.7)));
    }
    // Rock on crags and steep slopes: dark, weathered strata, cracks, lichen on the tops, moss low down,
    // and grass in the ledges.
    {
      const rc: N = mix(color(style.rock).mul(0.62), color(G.rockLight).mul(0.82), strata.mul(0.6).add(fine.r.mul(0.25))).toVar();
      rc.mulAssign(fine.g.mul(0.3).add(0.8));
      rc.assign(mix(rc, rc.mul(0.42), cracks.mul(0.7)));
      const lichen: N = smoothstep(0.64, 0.82, micro.r.mul(0.6).add(mid.g.mul(0.4))).mul(smoothstep(0.3, 0.8, normalWorld.y)).mul(close.mul(0.6).add(0.4));
      rc.assign(mix(rc, color(G.lichen).mul(0.85), lichen.mul(0.45)));
      const moss: N = smoothstep(6.0, 0.0, y).mul(smoothstep(0.45, 0.7, mid.g.add(fine.r.mul(0.3))));
      rc.assign(mix(rc, color(G.moss), moss.mul(0.6)));
      const ledges: N = smoothstep(0.55, 0.75, fine.b.mul(0.5).add(mid.g.mul(0.5))).mul(smoothstep(0.55, 0.8, normalWorld.y));
      rc.assign(mix(rc, color(G.grassDark).mul(1.1), ledges.mul(0.7)));
      c.assign(mix(c, rc, rockMask));
    }

    // Trampled earth just outside the walls and inside the courtyards.
    const band = float(1).sub(smoothstep(0.5, 6.5, dWall.add(mid.r.sub(0.5).mul(5.0)))).mul(smoothstep(-1.6, -0.2, dWall));
    const court = float(1).sub(smoothstep(-2.6, -1.2, dWall));
    const wornOut = band.mul(0.85).mul(smoothstep(0.25, 0.6, big.g.add(fine.r.mul(0.3))).mul(0.6).add(0.45));
    const yardGrass = smoothstep(0.55, 0.75, mid.g.add(fine.r.mul(0.4)));
    const wornIn = court.mul(float(0.92).sub(yardGrass.mul(0.5)));
    const worn = clamp(max(wornOut, wornIn), 0.0, 1.0);
    c.assign(mix(c, color(G.dirt).mul(fine.g.mul(0.25).add(0.88)), worn));
    // Trampled, darker grass around both castles.
    const trampled = float(1).sub(smoothstep(4.0, 30.0, dWall.add(mid.g.sub(0.5).mul(12.0))));
    c.assign(mix(c, c.mul(vec3(0.72, 0.68, 0.6)), trampled.mul(0.7)));

    // The centre road: packed mud with wheel ruts and a grassy crown.
    const edgeNoise: N = mid.g.sub(0.5).mul(1.4).add(fine.r.sub(0.5).mul(0.6));
    const road: N = float(1).sub(smoothstep(2.2, 3.1, routes.road.add(edgeNoise)));
    const ruts: N = aaLine(abs(routes.road.sub(0.95)), 0.3).mul(road);
    const crown: N = float(1).sub(smoothstep(0.18, 0.45, routes.road)).mul(road);
    c.assign(mix(c, color(G.road).mul(fine.g.mul(0.2).add(0.9)), road));
    c.assign(mix(c, color(G.road).mul(0.74), ruts.mul(0.8)));
    c.assign(mix(c, mix(color(G.grass), color(G.road), 0.45), crown.mul(0.55)));
    // The flank paths: narrower tracks of worn earth with two faint ruts and grass between.
    const pathD: N = min(routes.left, routes.right);
    const path: N = float(1).sub(smoothstep(1.35, 2.2, pathD.add(edgeNoise.mul(0.8))));
    const pathRuts: N = aaLine(abs(pathD.sub(0.7)), 0.24).mul(path);
    const pathMid: N = float(1).sub(smoothstep(0.15, 0.4, pathD)).mul(path);
    c.assign(mix(c, color(G.dirt).mul(fine.g.mul(0.3).add(0.85)), path.mul(0.9)));
    c.assign(mix(c, color(G.dirt).mul(0.7), pathRuts.mul(0.7)));
    c.assign(mix(c, mix(color(G.grass2), color(G.dirt), 0.4), pathMid.mul(0.6)));

    // A churned, muddy battlefield between the castles: mud in patches and along the routes.
    {
      const field = float(1).sub(smoothstep(30.0, 60.0, abs(x))).mul(smoothstep(-160.0, -125.0, z)).mul(float(1).sub(smoothstep(-25.0, 10.0, z)));
      const mudA = smoothstep(0.5, 0.64, big.g.mul(0.65).add(mid.r.mul(0.35))).mul(field);
      const mud = clamp(mudA.mul(0.75).add(road.mul(0.6)).add(path.mul(0.35)).add(band.mul(0.6)), 0.0, 1.0);
      c.assign(mix(c, color(G.mud).mul(fine.g.mul(0.3).add(0.82)), mud));
      // Puddles in the mud reflect the overcast sky.
      const puddle = smoothstep(0.6, 0.63, mid.g.mul(0.7).add(fine.r.mul(0.3))).mul(smoothstep(0.6, 0.85, mud));
      const v: N = normalize(wp.sub(cameraPosition));
      const refl = sky.skyColor(normalize(vec3(v.x, abs(v.y), v.z)), false);
      const fres = pow(float(1).sub(abs(v.y)), 4.0).mul(0.75).add(0.2);
      c.assign(mix(c, mix(color(G.mud).mul(0.45), refl, fres), puddle.mul(0.9)));
    }

    // The stream: gravel shoals and pebbles at the water line, wet dark mud up the banks.
    {
      const aboveWater: N = y.sub(STREAM.level);
      const bankZone: N = float(1).sub(smoothstep(2.0, 6.0, streamEdge));
      const wet: N = float(1).sub(smoothstep(0.08, 0.9, aboveWater.add(fine.g.sub(0.5).mul(0.3)))).mul(bankZone);
      // Pebbles and stones: worley cells at two sizes (about 0.2 and 0.45 m), dark between them,
      // each lit a little differently; far away just the gravel's average colour.
      const small: N = texture(noise, vec2(x, z).div(2.0)).b;
      const large: N = texture(noise, vec2(z, x).div(4.6).add(0.31)).b;
      const between: N = smoothstep(0.02, 0.12, min(small, large.mul(1.4)));
      const pshade: N = texture(noise, vec2(x, z).div(0.7).add(0.57)).r.mul(0.5).add(0.72);
      const pebblesNear: N = mix(color(G.gravel).mul(0.42), color(G.gravel).mul(pshade), between);
      const gravel: N = mix(color(G.gravel).mul(0.82), pebblesNear, float(1).sub(smoothstep(12.0, 35.0, dist)));
      // Shoals in patches along the water's edge (on some stretches only), from just under the water to a little above it.
      const shoal: N = smoothstep(0.55, 0.7, mid.r.mul(0.6).add(fine.g.mul(0.25)).add(big.b.mul(0.35)));
      const gravelZone: N = smoothstep(-0.45, -0.1, aboveWater).mul(float(1).sub(smoothstep(0.08, 0.38, aboveWater.sub(shoal.mul(0.15))))).mul(shoal.mul(0.85).add(0.1)).mul(bankZone);
      c.assign(mix(c, color(G.wetMud).mul(fine.g.mul(0.3).add(0.85)), wet.mul(0.85)));
      c.assign(mix(c, gravel, gravelZone.mul(0.9)));
      // Rank grass along the banks, a little greener and darker above the mud.
      const rank: N = smoothstep(0.6, 1.4, aboveWater).mul(float(1).sub(smoothstep(1.4, 4.5, streamEdge))).mul(float(1).sub(rockMask));
      c.assign(mix(c, color(G.grassDark).mul(1.15), rank.mul(0.5)));
    }

    // Craters: thrown-up fresh earth around the rim and on the slopes, wet black mud in the hollow.
    const fresh = clamp(smoothstep(0.02, 0.12, crater.abs()).mul(fine.g.mul(0.5).add(0.6)), 0.0, 1.0);
    c.assign(mix(c, color(0x4e3d2b).mul(fine.r.mul(0.35).add(0.8)), fresh));
    const wetC = smoothstep(0.25, 0.9, crater);
    c.assign(mix(c, color(0x15120f).mul(fine.g.mul(0.3).add(0.85)), wetC.mul(0.9)));
    // L2/L3 ground marks: scorch, a pale dust wash and trodden paths (per vertex, ragged per pixel by the noise).
    {
      const mk: N = varying(attribute("aMarks", "vec4"), "vMarks");
      const grain: N = fine.g.mul(0.5).add(fine.r.mul(0.5));
      const trod: N = smoothstep(0.08, 0.75, mk.z.add(grain.sub(0.5).mul(0.3)));
      c.assign(mix(c, color(G.mud).mul(grain.mul(0.3).add(0.72)), trod.mul(0.75)));
      const wash: N = smoothstep(0.03, 0.5, mk.y.add(grain.sub(0.5).mul(0.2)));
      c.assign(mix(c, color(0xb5ac99).mul(grain.mul(0.2).add(0.9)), wash.mul(0.6)));
      const char: N = smoothstep(0.1, 0.55, mk.x.add(grain.sub(0.5).mul(0.45)));
      const ash: N = smoothstep(0.55, 0.95, mk.x.add(mid.r.sub(0.5).mul(0.5)));
      const burnt: N = mix(color(0x1d1712), color(0x6a655d), ash.mul(0.7)).mul(grain.mul(0.35).add(0.8));
      c.assign(mix(c, burnt, char.mul(0.92)));
    }
    // L3 wind and clouds: the game's wind bends the grass (a pale sheen in streaks) and a gust's front crosses the land.
    if (wind) {
      // Grass areas only: not rock, worn earth, roads, paths, craters, the churned mud of the battlefield, or the stream's banks.
      const earth: N = max(max(worn, road), max(path, smoothstep(0.02, 0.1, crater.abs())));
      const field: N = float(1).sub(smoothstep(30.0, 60.0, abs(x))).mul(smoothstep(-160.0, -125.0, z)).mul(float(1).sub(smoothstep(-25.0, 10.0, z)));
      const mudy: N = smoothstep(0.5, 0.64, big.g.mul(0.65).add(mid.r.mul(0.35))).mul(field);
      const bank: N = float(1).sub(smoothstep(1.5, 5.0, streamEdge)).mul(float(1).sub(smoothstep(0.3, 1.4, y.sub(STREAM.level))));
      const grass: N = float(1).sub(max(max(rockMask, earth), max(mudy, bank)));
      c.assign(applyWindSheen(c, noise, wind, vec2(x, z), dist, grass));
    }
    return c;
  });
  mat.colorNode = colorFn();
  // L3 wind and clouds: the clouds' shade drifts over the ground.
  applyCloudShadow(mat);
  // Wet mud and the banks are shinier, rock and straw rougher, crater bottoms the shiniest.
  {
    const { edge } = streamEdgeNode(x, z);
    const bankWet: N = float(1).sub(smoothstep(0.1, 1.0, y.sub(STREAM.level))).mul(float(1).sub(smoothstep(2.0, 6.0, edge)));
    const wetC: N = smoothstep(0.25, 0.9, crater);
    const base: N = mix(float(G.roughness), float(0.55), smoothstep(0.5, 0.65, big.g).mul(0.5));
    mat.roughnessNode = mix(mix(base, float(0.42), bankWet.mul(0.8)), float(0.38), wetC);
  }
  // Relief: strata and cracks in the rock, a fine grain in the ground close up.
  {
    const h: N = rockMask.mul(strata.mul(0.6).sub(cracks.mul(0.8))).add(fine.g.mul(0.5).add(micro.a.mul(0.25)).mul(close));
    mat.normalNode = bumpNormal(h, float(0.35).mul(float(1).sub(smoothstep(30.0, 120.0, dist))));
  }
  return mat;
}

export function makeMountainMaterial(style: StylePreset, sky: Sky): THREE.MeshStandardNodeMaterial {
  // A painted backdrop: lit a little by the sun, then mostly dissolved into
  // the aerial haze (bluish) and, further out, the sky's horizon colour.
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = `${style.name}-mountains`;
  mat.roughness = 1;
  mat.metalness = 0;
  mat.fog = false;
  const wp: N = positionWorld;
  const y: N = wp.y;
  const top = 0x6a7072;
  const snow = smoothstep(500.0, 660.0, y).mul(0.4);
  const toFrag: N = wp.sub(cameraPosition);
  const dist: N = toFrag.length();
  const dir: N = normalize(vec3(toFrag.x, max(toFrag.y, 0.0).mul(0.2).add(dist.mul(0.012)), toFrag.z));
  const haze: N = mix(sky.hazeColor(dir), sky.skyColor(dir, false), smoothstep(2600.0, 3700.0, dist).mul(0.6).add(0.2));
  const k: N = clamp(float(style.sky.mountainHaze).add(smoothstep(2500.0, 3700.0, dist).mul(0.25)).sub(smoothstep(150.0, 650.0, y).mul(0.1)), 0.0, 0.95);
  mat.emissiveNode = haze.mul(k);
  mat.colorNode = mix(color(style.sky.mountain), color(top), snow).mul(float(1).sub(k));
  return mat;
}

export class Terrain {
  /** The coarse surround (valley sides, hills, gorges), with a hole over the physics grid. */
  readonly ground: THREE.Mesh;
  /** The physics grid at 1 m: crater patches land here. */
  readonly field: THREE.Mesh;
  readonly mountains: THREE.Mesh;
  /** The stream's water. */
  readonly water: THREE.Mesh;
  private noise: THREE.Texture;
  private sky: Sky;
  private time: N;
  private wind?: WindField;
  private built = false;
  private nx: number;
  private gi0: number;
  private gj0: number;
  private pos: THREE.BufferAttribute;
  private nor: THREE.BufferAttribute;
  private crater: THREE.BufferAttribute;
  /** L2/L3: the field's per-vertex ground marks (scorch, dust, trodden, spare), shared with groundMarks.ts. */
  readonly marks: THREE.BufferAttribute;
  /** Current heights of the physics grid (render copy), and the original ones. */
  readonly heights = new Float32Array(TG.nx * TG.nz);
  private base = new Float32Array(TG.nx * TG.nz);
  private rowMin = Infinity;
  private rowMax = -Infinity;

  constructor(noise: THREE.Texture, sky: Sky, time: N, wind?: WindField) {
    this.wind = wind;
    this.noise = noise;
    this.sky = sky;
    this.time = time;
    const geos = buildTerrainGeometry();
    const tg = geos.field;
    this.nx = tg.nx;
    this.gi0 = tg.gi0;
    this.gj0 = tg.gj0;
    this.ground = new THREE.Mesh(geos.outer);
    this.ground.name = "terrain";
    this.ground.receiveShadow = true;
    this.field = new THREE.Mesh(tg.geometry);
    this.field.name = "terrain-field";
    this.field.receiveShadow = true;
    this.pos = tg.geometry.attributes.position as THREE.BufferAttribute;
    this.nor = tg.geometry.attributes.normal as THREE.BufferAttribute;
    this.crater = tg.geometry.attributes.aCrater as THREE.BufferAttribute;
    this.marks = tg.geometry.attributes.aMarks as THREE.BufferAttribute;
    const H = valleyGrid();
    this.heights.set(H);
    this.base.set(H);
    this.mountains = new THREE.Mesh(buildMountainGeometry());
    this.mountains.name = "mountains";
    this.mountains.frustumCulled = false;
    this.water = new THREE.Mesh(buildStreamGeometry());
    this.water.name = "stream";
    this.water.receiveShadow = true;
  }

  setStyle(style: StylePreset) {
    if (this.built) return;
    this.built = true;
    this.ground.material = makeTerrainMaterial({ style, noise: this.noise, sky: this.sky, wind: this.wind });
    this.field.material = this.ground.material;
    this.mountains.material = makeMountainMaterial(style, this.sky);
    this.water.material = makeStreamMaterial(style, this.sky, this.noise, this.time);
  }

  /** Write sim height patches into the mesh (positions, normals, crater shading). */
  applyPatches(patches: TerrainPatch[]) {
    for (const pt of patches) {
      const i0 = Math.max(0, pt.i0), j0 = Math.max(0, pt.j0);
      const i1 = Math.min(TG.nx - 1, pt.i0 + pt.ni - 1), j1 = Math.min(TG.nz - 1, pt.j0 + pt.nj - 1);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const h = pt.h[(j - pt.j0) * pt.ni + (i - pt.i0)];
          if (Number.isFinite(h)) this.heights[j * TG.nx + i] = h;
        }
      }
      if (i1 >= i0 && j1 >= j0) this.refresh(i0, j0, i1, j1);
    }
  }

  /** Back to the original ground everywhere in the grid. */
  resetHeights() {
    this.heights.set(this.base);
    this.refresh(0, 0, TG.nx - 1, TG.nz - 1);
  }

  private refresh(i0: number, j0: number, i1: number, j1: number) {
    const p = this.pos.array as Float32Array;
    const nrm = this.nor.array as Float32Array;
    const cr = this.crater.array as Float32Array;
    const H = this.heights;
    const nx = TG.nx;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const v = (j + this.gj0) * this.nx + i + this.gi0;
        const k = j * nx + i;
        p[v * 3 + 1] = H[k];
        cr[v] = this.base[k] - H[k];
      }
    }
    // Normals one vertex beyond the patch too (central differences on the grid); the border keeps its own.
    const a0 = Math.max(1, i0 - 1), a1 = Math.min(nx - 2, i1 + 1);
    const b0 = Math.max(1, j0 - 1), b1 = Math.min(TG.nz - 2, j1 + 1);
    for (let j = b0; j <= b1; j++) {
      for (let i = a0; i <= a1; i++) {
        const v = (j + this.gj0) * this.nx + i + this.gi0;
        const hx = H[j * nx + i + 1] - H[j * nx + i - 1];
        const hz = H[(j + 1) * nx + i] - H[(j - 1) * nx + i];
        const two = 2 * TG.cell;
        const l = Math.hypot(hx, two, hz);
        nrm[v * 3] = -hx / l;
        nrm[v * 3 + 1] = two / l;
        nrm[v * 3 + 2] = -hz / l;
      }
    }
    this.rowMin = Math.min(this.rowMin, Math.max(0, j0 - 1) + this.gj0);
    this.rowMax = Math.max(this.rowMax, Math.min(TG.nz - 1, j1 + 1) + this.gj0);
  }

  /** Push changed rows to the GPU (once per frame). */
  flush() {
    if (this.rowMin > this.rowMax) return;
    const start = this.rowMin * this.nx;
    const count = (this.rowMax - this.rowMin + 1) * this.nx;
    for (const [attr, n] of [[this.pos, 3], [this.nor, 3], [this.crater, 1]] as const) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(start * n, count * n);
      attr.needsUpdate = true;
    }
    this.rowMin = Infinity;
    this.rowMax = -Infinity;
  }

  /** L2/L3: upload the ground marks of grid rows j0..j1 (the field mesh's vertices run row by row from the grid's). */
  flushMarks(j0: number, j1: number) {
    this.marks.clearUpdateRanges();
    this.marks.addUpdateRange(j0 * this.nx * 4, (j1 - j0 + 1) * this.nx * 4);
    this.marks.needsUpdate = true;
  }

  /** Render ground height: the patched grid inside it (bilinear), the valley outside. */
  heightAt(x: number, z: number): number {
    const fx = (x - TG.x0) / TG.cell, fz = (z - TG.z0) / TG.cell;
    if (fx < 0 || fz < 0 || fx > TG.nx - 1 || fz > TG.nz - 1) return groundHeight(x, z);
    const i = Math.min(TG.nx - 2, Math.floor(fx)), j = Math.min(TG.nz - 2, Math.floor(fz));
    const u = fx - i, v = fz - j;
    const H = this.heights, n = TG.nx;
    const a = H[j * n + i], b = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  dispose() {
    this.ground.geometry.dispose();
    this.field.geometry.dispose();
    this.mountains.geometry.dispose();
    this.water.geometry.dispose();
    for (const m of [this.ground, this.mountains, this.water]) (m.material as THREE.Material).dispose();
  }
}
