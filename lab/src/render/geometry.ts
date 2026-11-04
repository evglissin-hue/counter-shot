// Geometry builders for the instanced stones and small props.
//
// Box stones use one shared geometry for every size: the `position` attribute
// holds the corner sign (+-1 per axis) and `normal` the surface normal. The
// vertex shader places each vertex at sign * (halfExtent - r) + normal * r,
// which is the Minkowski sum of a shrunken box and a sphere of radius r: a box
// with evenly rounded edges whatever its size. With r = 0 it is a plain box.

import * as THREE from "three/webgpu";
import type { WedgeSpec } from "@keepfall/content";
import { Rng } from "@keepfall/core";

function sgn(v: number): number {
  return v < 0 ? -1 : 1;
}

/** Box stone base geometry. segments 0 = sharp (12 triangles), 1 = 108, 2 = 300. */
export function boxStoneGeometry(segments: number): THREE.BufferGeometry {
  const m = segments <= 0 ? 1 : segments * 2 + 1;
  const box = new THREE.BoxGeometry(1, 1, 1, m, m, m);
  const pos = box.attributes.position as THREE.BufferAttribute;
  const nor = box.attributes.normal as THREE.BufferAttribute;
  const half = 0.5 / m;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (segments > 0) {
      n.set(p.x - sgn(p.x) * half, p.y - sgn(p.y) * half, p.z - sgn(p.z) * half).normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    pos.setXYZ(i, sgn(p.x), sgn(p.y), sgn(p.z));
  }
  box.deleteAttribute("uv");
  return box;
}

/**
 * The tower wedge (8 corners, 6 faces, same topology as a cube) with edges
 * rounded by radius r. Built in metres; every wedge is the same shape.
 */
export function wedgeStoneGeometry(spec: WedgeSpec, segments: number, radius: number): THREE.BufferGeometry {
  const sa = Math.sin(spec.halfAngle);
  const ca = Math.cos(spec.halfAngle);
  const zIn = spec.rIn * ca - spec.rc;
  const zOut = spec.rOut * ca - spec.rc;
  // Outward face normals and plane offsets (n . p = d) per axis and sign.
  const faceN = (axis: number, s: number): THREE.Vector3 => {
    if (axis === 0) return new THREE.Vector3(s * ca, 0, -sa);
    if (axis === 1) return new THREE.Vector3(0, s, 0);
    return new THREE.Vector3(0, 0, s);
  };
  const faceD = (axis: number, s: number): number => {
    if (axis === 0) return sa * spec.rc;
    if (axis === 1) return spec.hy;
    return s > 0 ? zOut : -zIn;
  };
  const r = segments > 0 ? radius : 0;
  // Inset corner for each sign combination: solve the three offset planes.
  const inset = new Map<number, THREE.Vector3>();
  const key = (sx: number, sy: number, sz: number) => (sx > 0 ? 4 : 0) + (sy > 0 ? 2 : 0) + (sz > 0 ? 1 : 0);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const a = faceN(0, sx), b = faceN(1, sy), c = faceN(2, sz);
        const m3 = new THREE.Matrix3().set(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        const rhs = new THREE.Vector3(faceD(0, sx) - r, faceD(1, sy) - r, faceD(2, sz) - r);
        const sol = rhs.applyMatrix3(m3.clone().invert());
        inset.set(key(sx, sy, sz), sol);
      }
    }
  }
  const m = segments <= 0 ? 1 : segments * 2 + 1;
  const box = new THREE.BoxGeometry(1, 1, 1, m, m, m);
  const pos = box.attributes.position as THREE.BufferAttribute;
  const nor = box.attributes.normal as THREE.BufferAttribute;
  const half = 0.5 / m;
  const p = new THREE.Vector3();
  const nb = new THREE.Vector3();
  const nw = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const sx = sgn(p.x), sy = sgn(p.y), sz = sgn(p.z);
    if (segments > 0) nb.set(p.x - sx * half, p.y - sy * half, p.z - sz * half).normalize();
    else nb.fromBufferAttribute(nor, i);
    nw.set(0, 0, 0)
      .addScaledVector(faceN(0, sx), Math.abs(nb.x))
      .addScaledVector(faceN(1, sy), Math.abs(nb.y))
      .addScaledVector(faceN(2, sz), Math.abs(nb.z))
      .normalize();
    const c = inset.get(key(sx, sy, sz))!;
    pos.setXYZ(i, c.x + nw.x * r, c.y + nw.y * r, c.z + nw.z * r);
    nor.setXYZ(i, nw.x, nw.y, nw.z);
  }
  box.deleteAttribute("uv");
  box.computeBoundingSphere();
  return box;
}

/** A small irregular stone chip (unit size). */
export function chipGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const rng = new Rng(77);
  // Icosahedron vertices are duplicated per face; jitter by position so shared corners stay shared.
  const jitter = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let j = jitter.get(k);
    if (!j) {
      j = [0.7 + rng.next() * 0.5, 0.55 + rng.next() * 0.4, 0.7 + rng.next() * 0.5];
      jitter.set(k, j);
    }
    pos.setXYZ(i, pos.getX(i) * j[0], pos.getY(i) * j[1], pos.getZ(i) * j[2]);
  }
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  return g;
}

/** An irregular boulder: an icosphere with seeded vertex jitter. */
export function rockGeometry(detail: number, seed: number, flat: boolean): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  if (!flat) {
    // Merge duplicated corners so the jitter keeps the surface closed and smooth.
    g = mergeByPosition(g);
  }
  const pos = g.attributes.position as THREE.BufferAttribute;
  const rng = new Rng(seed);
  const jitter = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let j = jitter.get(k);
    if (j === undefined) {
      j = 0.78 + rng.next() * 0.4;
      jitter.set(k, j);
    }
    // Flatter underside so rocks sit on the ground.
    const yy = y < 0 ? y * 0.45 : y * 0.85;
    pos.setXYZ(i, x * j, yy * j, z * j);
  }
  g.computeVertexNormals();
  return g;
}

/** Merge vertices that share a position (keeps the index). */
export function mergeByPosition(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = src.attributes.position as THREE.BufferAttribute;
  const index = src.index;
  const map = new Map<string, number>();
  const out: number[] = [];
  const remap: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let j = map.get(k);
    if (j === undefined) {
      j = out.length / 3;
      map.set(k, j);
      out.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    remap.push(j);
  }
  const idx: number[] = [];
  if (index) for (let i = 0; i < index.count; i++) idx.push(remap[index.getX(i)]);
  else for (let i = 0; i < pos.count; i++) idx.push(remap[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  g.setIndex(idx);
  return g;
}

/** Concatenate indexed geometries that share the same attribute set. */
export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = Object.keys(list[0].attributes);
  const arrays: Record<string, number[]> = {};
  const sizes: Record<string, number> = {};
  for (const n of names) {
    arrays[n] = [];
    sizes[n] = list[0].attributes[n].itemSize;
  }
  const idx: number[] = [];
  let base = 0;
  for (const g of list) {
    const ng = g;
    const count = ng.attributes.position.count;
    for (const n of names) {
      const a = ng.attributes[n] as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arrays[n].push(a.array[i * a.itemSize + c]);
    }
    if (ng.index) for (let i = 0; i < ng.index.count; i++) idx.push(ng.index.getX(i) + base);
    else for (let i = 0; i < count; i++) idx.push(i + base);
    base += count;
  }
  const out = new THREE.BufferGeometry();
  for (const n of names) out.setAttribute(n, new THREE.Float32BufferAttribute(arrays[n], sizes[n]));
  out.setIndex(idx);
  return out;
}
