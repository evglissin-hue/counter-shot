// Paints a tree's soup into an RGBA image from the side (look round L3.5), once
// at load, for the flat cards that stand in for far trees. A small software
// rasteriser with a depth buffer and a 3 by 3 supersample, so the card's edge
// is soft and its alpha is the tree's coverage. It lives apart from three.js so
// Node can test the silhouettes.

import { soupNormals, type Soup } from "./treeShapes";

export interface PlantColors {
  leaf: number;
  leafLight: number;
  leafDark: number;
  trunk: number;
}

export interface CardImage {
  width: number;
  height: number;
  /** RGBA, rows from the top (image order). */
  data: Uint8Array;
  /** Half the card's width in model metres. */
  halfWidth: number;
  /** The card's height in model metres (from the ground up). */
  tall: number;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function rgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function mix3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The plant material's colour for a part and shade, on the CPU (the same mixes as the material). */
export function plantColor(P: PlantColors, part: number, shade: number): [number, number, number] {
  let leaf = mix3(rgb(P.leafDark), rgb(P.leaf), smooth(0.25, 0.75, shade));
  leaf = mix3(leaf, rgb(P.leafLight), smooth(0.75, 1.1, shade));
  const k = shade * 0.5 + 0.6;
  const t = rgb(P.trunk);
  const trunk: [number, number, number] = [t[0] * k, t[1] * k, t[2] * k];
  return mix3(trunk, leaf, part);
}

/** Paint the soup seen from +z (x to the right, y up), `pxHigh` pixels tall. */
export function rasterCard(soup: Soup, P: PlantColors, pxHigh: number): CardImage {
  const ss = 3;
  let maxX = 0.1, maxY = 0.1;
  for (let i = 0; i < soup.pos.length; i += 3) {
    maxX = Math.max(maxX, Math.abs(soup.pos[i]));
    maxY = Math.max(maxY, soup.pos[i + 1]);
  }
  const halfWidth = maxX * 1.04;
  const tall = maxY * 1.02;
  const height = pxHigh;
  const width = Math.max(8, Math.ceil((pxHigh * 2 * halfWidth) / tall));
  const W = width * ss, Hh = height * ss;
  const scale = Hh / tall;
  const depth = new Float32Array(W * Hh).fill(-1e9);
  const col = new Float32Array(W * Hh * 3);
  const nor = soupNormals(soup);
  const L = [-0.35, 0.85, 0.4];
  const ll = Math.hypot(L[0], L[1], L[2]);
  const px = (i: number) => W / 2 + soup.pos[i * 3] * scale;
  const py = (i: number) => Hh - soup.pos[i * 3 + 1] * scale;
  for (let t = 0; t < soup.idx.length; t += 3) {
    const a = soup.idx[t], b = soup.idx[t + 1], c = soup.idx[t + 2];
    const ax = px(a), ay = py(a), bx = px(b), by = py(b), cx = px(c), cy = py(c);
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(Hh - 1, Math.ceil(Math.max(ay, by, cy)));
    const part = (soup.part[a] + soup.part[b] + soup.part[c]) / 3;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const sx = x + 0.5, sy = y + 0.5;
        const l1 = ((by - cy) * (sx - cx) + (cx - bx) * (sy - cy)) / den;
        const l2 = ((cy - ay) * (sx - cx) + (ax - cx) * (sy - cy)) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
        const z = l1 * soup.pos[a * 3 + 2] + l2 * soup.pos[b * 3 + 2] + l3 * soup.pos[c * 3 + 2];
        const o = y * W + x;
        if (z <= depth[o]) continue;
        depth[o] = z;
        const shade = l1 * soup.shade[a] + l2 * soup.shade[b] + l3 * soup.shade[c];
        let nx = l1 * nor[a * 3] + l2 * nor[b * 3] + l3 * nor[c * 3];
        let ny = l1 * nor[a * 3 + 1] + l2 * nor[b * 3 + 1] + l3 * nor[c * 3 + 1];
        let nz = l1 * nor[a * 3 + 2] + l2 * nor[b * 3 + 2] + l3 * nor[c * 3 + 2];
        if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const nl = Math.hypot(nx, ny, nz) || 1;
        const lam = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / (nl * ll));
        const lit = 0.66 + 0.34 * lam;
        const base = plantColor(P, part, shade);
        col[o * 3] = base[0] * lit;
        col[o * 3 + 1] = base[1] * lit;
        col[o * 3 + 2] = base[2] * lit;
      }
    }
  }
  // Down to the card's size: alpha is the covered share, colour the mean of the covered samples.
  const data = new Uint8Array(width * height * 4);
  let mr = 0, mg = 0, mb = 0, mn = 0;
  const n2 = ss * ss;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const o = (y * ss + j) * W + x * ss + i;
          if (depth[o] > -1e8) {
            r += col[o * 3];
            g += col[o * 3 + 1];
            b += col[o * 3 + 2];
            n++;
          }
        }
      }
      const q = (y * width + x) * 4;
      if (n) {
        data[q] = Math.round((r / n) * 255);
        data[q + 1] = Math.round((g / n) * 255);
        data[q + 2] = Math.round((b / n) * 255);
        mr += r / n;
        mg += g / n;
        mb += b / n;
        mn++;
      }
      data[q + 3] = Math.round((n / n2) * 255);
    }
  }
  // Empty pixels take the mean colour, so mipmaps and filtering never bleed black into the edge.
  if (mn) {
    const R = Math.round((mr / mn) * 255), G = Math.round((mg / mn) * 255), B = Math.round((mb / mn) * 255);
    for (let q = 0; q < data.length; q += 4) {
      if (data[q + 3] === 0) {
        data[q] = R;
        data[q + 1] = G;
        data[q + 2] = B;
      }
    }
  }
  return { width, height, data, halfWidth, tall };
}

/** The share of a card's pixels that are mostly covered (alpha over half), and the share of its columns' rows that are open between covered pixels. */
export function cardStats(img: CardImage): { covered: number; gaps: number } {
  let covered = 0, gaps = 0, total = 0;
  for (let y = 0; y < img.height; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 127) {
        covered++;
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first >= 0) {
      for (let x = first; x <= last; x++) if (img.data[(y * img.width + x) * 4 + 3] <= 127) gaps++;
      total += last - first + 1;
    }
  }
  return { covered: covered / (img.width * img.height), gaps: total ? gaps / total : 0 };
}
