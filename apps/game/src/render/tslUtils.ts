// Small TSL helpers shared by the materials.
//
// TSL's TypeScript types are very strict about node kinds, so node values are
// typed as `N` (any) here and in the material modules.

import * as THREE from "three/webgpu";
import {
  abs,
  clamp,
  cross,
  dot,
  float,
  fwidth,
  max,
  min,
  mix,
  positionView,
  select,
  smoothstep,
  vec2,
  vec3,
  faceDirection,
  normalView,
} from "three/tsl";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any;

/** Rotate vector v by unit quaternion q (xyzw). */
export function qrot(q: N, v: N): N {
  const qv = q.xyz;
  const t = cross(qv, v).mul(2.0);
  return v.add(t.mul(q.w)).add(cross(qv, t));
}

/** Pick 2D coordinates for box mapping from a local position and normal. */
export function boxUV(p: N, n: N): N {
  const an: N = abs(n);
  return select(an.x.greaterThan(max(an.y, an.z)), vec2(p.z, p.y), select(an.y.greaterThan(an.z), vec2(p.x, p.z), vec2(p.x, p.y)));
}

/** Median of three scalars (the distance to the nearest edge of a box face). */
export function median3(a: N, b: N, c: N): N {
  return max(min(a, b), min(max(a, b), c));
}

/**
 * Anti-aliased "line near zero": 1 where d < width, 0 beyond, with the
 * contrast faded out when the pixel footprint is much wider than the line
 * (kills moire on distant masonry).
 */
export function aaLine(d: N, width: number | N): N {
  const w = float(width);
  const fw = max(fwidth(d), float(1e-5));
  const edge = float(1).sub(smoothstep(w.sub(fw), w.add(fw), d));
  return edge.mul(clamp(w.div(fw.mul(1.5)), 0, 1));
}

export function luma(c: N): N {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

export function saturate3(c: N, s: number | N): N {
  return mix(vec3(luma(c)), c, s);
}

/**
 * Bump mapping from any scalar height expression (Mikkelsen's surface
 * gradient method), using screen-space derivatives of the height.
 * Returns a view-space normal for `normalNode`.
 */
export function bumpNormal(height: N, scale: number | N): N {
  const dHx = height.dFdx().mul(scale);
  const dHy = height.dFdy().mul(scale);
  const sigmaX = positionView.dFdx().normalize();
  const sigmaY = positionView.dFdy().normalize();
  const n = normalView;
  const r1 = sigmaY.cross(n);
  const r2 = n.cross(sigmaX);
  const det = sigmaX.dot(r1).mul(faceDirection);
  const grad = det.sign().mul(dHx.mul(r1).add(dHy.mul(r2)));
  return det.abs().mul(n).sub(grad).normalize();
}

export function col(hex: number): THREE.Color {
  return new THREE.Color(hex);
}

/** Linear-space RGB triple of an sRGB hex colour. */
export function linear(hex: number): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
