// Procedural, tileable noise textures generated once on the CPU. No network,
// no Math.random: everything is seeded through Rng so the look is identical
// on every device.
//
// One RGBA8 texture, 256 x 256, repeat wrapped and mipmapped:
//   R: smooth fbm, 4 cells across (large blotches)
//   G: detailed fbm, 16 cells across (grain and weathering)
//   B: cellular (worley F2 - F1), 10 cells across (cracks and pits)
//   A: fine value noise, 64 cells across (speckle)

import * as THREE from "three/webgpu";
import { Rng } from "../core/detmath";

const SIZE = 256;

function makePerm(rng: Rng): Uint16Array {
  const p = new Uint16Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 256; i++) p[256 + i] = p[i];
  return p;
}

const GX = new Float32Array(256);
const GY = new Float32Array(256);
{
  const rng = new Rng(0x5eed);
  for (let i = 0; i < 256; i++) {
    const a = rng.next() * Math.PI * 2;
    GX[i] = Math.cos(a);
    GY[i] = Math.sin(a);
  }
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Periodic 2D gradient noise in about [-1, 1]. `period` is in lattice cells. */
function gradNoise(perm: Uint16Array, x: number, y: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const h = perm[perm[ix & 255] + (iy & 255)];
    return GX[h] * dx + GY[h] * dy;
  };
  const n00 = g(x0, y0, xf, yf);
  const n10 = g(x1, y0, xf - 1, yf);
  const n01 = g(x0, y1, xf, yf - 1);
  const n11 = g(x1, y1, xf - 1, yf - 1);
  const u = fade(xf);
  const v = fade(yf);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.4;
}

function valueNoise(perm: Uint16Array, x: number, y: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const h = (ix: number, iy: number) => perm[perm[ix & 255] + (iy & 255)] / 255;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h(x0, y0) + (h(x1, y0) - h(x0, y0)) * u;
  const b = h(x0, y1) + (h(x1, y1) - h(x0, y1)) * u;
  return a + (b - a) * v;
}

function fbm(perm: Uint16Array, u: number, v: number, cells: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let c = cells;
  for (let o = 0; o < octaves; o++) {
    sum += gradNoise(perm, u * c + o * 17.3, v * c - o * 9.1, c) * amp;
    norm += amp;
    amp *= 0.5;
    c *= 2;
  }
  return sum / norm;
}

function worley(points: Float32Array, cells: number, u: number, v: number): [number, number] {
  const x = u * cells;
  const y = v * cells;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;
      const wx = ((cx % cells) + cells) % cells;
      const wy = ((cy % cells) + cells) % cells;
      const k = (wy * cells + wx) * 2;
      const px = cx + points[k];
      const py = cy + points[k + 1];
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return [f1, f2];
}

let cached: THREE.DataTexture | null = null;

/** The shared noise texture (created on first use). */
export function getNoiseTexture(): THREE.DataTexture {
  if (cached) return cached;
  const rng = new Rng(20261103);
  const permA = makePerm(rng.fork("noise-a"));
  const permB = makePerm(rng.fork("noise-b"));
  const permC = makePerm(rng.fork("noise-c"));
  const wCells = 10;
  const wp = new Float32Array(wCells * wCells * 2);
  const wr = rng.fork("worley");
  for (let i = 0; i < wp.length; i++) wp[i] = 0.1 + 0.8 * wr.next();

  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const r = fbm(permA, u, v, 4, 5);
      const g = fbm(permB, u, v, 16, 4);
      const [f1, f2] = worley(wp, wCells, u, v);
      const b = Math.min(1, (f2 - f1) * 1.6);
      const a = valueNoise(permC, u * 64, v * 64, 64) * 0.65 + valueNoise(permC, u * 128 + 7, v * 128 + 3, 128) * 0.35;
      const o = (y * SIZE + x) * 4;
      data[o] = Math.max(0, Math.min(255, Math.round((r * 0.5 + 0.5) * 255)));
      data[o + 1] = Math.max(0, Math.min(255, Math.round((g * 0.5 + 0.5) * 255)));
      data[o + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      data[o + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.name = "lab-noise";
  cached = tex;
  return tex;
}
