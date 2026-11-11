// How plants lean in the match's wind (look round L3): every tree, bush, reed
// and far card reads the one WindField, so they bend the way the flags fly,
// treetops and reeds show a gust front before it reaches the gun, and nothing
// here invents a wind of its own.

import { float, min, sin, vec3 } from "three/tsl";
import { WIND_MAX, type WindField } from "./windField";
import type { N } from "./tslUtils";

/**
 * The offset (metres, vec3 with y 0) to add to a point of a plant that stands
 * at world xz (vec2 node). `h` is the point's height up the plant (0 at the
 * ground, 1 at the top; more is fine): the lean grows with its square, so the
 * whole crown leans and the top most. `amp` is the lean at the top per unit of
 * `WindField.bend` (metres). `branch` (0 trunk, 1 foliage) weights a stiffer
 * trunk and a flutter on the branches on top of the lean.
 */
export function plantLean(wind: WindField, time: N, xz: N, h: N, amp: number, branch: N): N {
  const ph: N = xz.x.mul(0.13).add(xz.y.mul(0.11));
  const b: N = wind.bend(xz, ph);
  const speed: N = min(wind.at(xz).length().div(WIND_MAX), 1.2);
  const stiff: N = float(0.7).add(branch.mul(0.3));
  const lean: N = h.mul(h).mul(amp).mul(stiff);
  // Branches and foliage shiver a little faster and wider than the trunk sways.
  const shiver: N = sin(time.mul(3.1).add(ph.mul(2.3))).mul(speed.mul(0.12)).mul(h.mul(amp)).mul(branch);
  const shiverZ: N = sin(time.mul(2.7).add(ph.mul(1.9))).mul(speed.mul(0.1)).mul(h.mul(amp)).mul(branch);
  return vec3(b.x.mul(lean).add(shiver), float(0), b.y.mul(lean).add(shiverZ));
}
