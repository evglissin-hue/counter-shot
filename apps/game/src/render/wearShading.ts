// The shader side of per-stone wear (look round L2). One instance attribute,
// iWear = [faces, soot, crack, dust] (see wear.ts), read by the five stone
// materials. Everything here is plain TSL nodes; the bit tests use float
// maths (floor and mod) so WebGL2 needs no integer ops.

import {
  abs,
  attribute,
  clamp,
  exp2,
  float,
  floor,
  fwidth,
  max,
  mix,
  mod,
  normalWorld,
  positionWorld,
  select,
  smoothstep,
  step,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import type * as THREE from "three/webgpu";
import type { N } from "./tslUtils";

/** 1 at High and Ultra (chipped edges), 0 below; set from the quality tier. */
export const WEAR_CHIPS = uniform(0);

export function setWearChips(on: boolean) {
  WEAR_CHIPS.value = on ? 1 : 0;
}

/** The instance's [faces, soot, crack, dust], as a varying (the geometry must carry iWear). */
export function wearVarying(): N {
  return varying(attribute("iWear", "vec4"), "vWear");
}

/**
 * Fresh and new from the faces mask and the local face normal: `fresh` is 1 on a
 * face bared by a neighbour's going, `isNew` is 1 on a stone the masons laid.
 * The +0.5 keeps the floor safe against the interpolation of a constant.
 */
export function faceBits(wear: N, localN: N): { fresh: N; isNew: N } {
  const an: N = abs(localN);
  const xDom: N = an.x.greaterThan(max(an.y, an.z));
  const yDom: N = an.y.greaterThan(an.z);
  const comp: N = select(xDom, localN.x, select(yDom, localN.y, localN.z));
  const axis: N = select(xDom, float(0), select(yDom, float(2), float(4)));
  const idx: N = axis.add(select(comp.lessThan(0), float(1), float(0)));
  const fresh: N = mod(floor(wear.x.add(0.5).div(exp2(idx))), 2);
  const isNew: N = step(63.5, wear.x);
  return { fresh, isNew };
}

/** A broken, patchy cover of 0..1: more of it as `amount` rises. */
function patchy(patchNoise: N, amount: N): N {
  const lo: N = float(0.62).sub(amount.mul(0.5));
  return smoothstep(lo, lo.add(0.2), patchNoise).mul(smoothstep(0.0, 0.06, amount));
}

const CHAR = vec3(0.085, 0.07, 0.058);
const DUST = vec3(0.66, 0.61, 0.5);

/** Scorch: dark char in patches, heaviest on faces turned up. Never quite black. */
export function sootOver(c: N, soot: N, patchNoise: N, fine: N): N {
  const up: N = clamp(normalWorld.y.mul(0.6).add(0.4), 0, 1);
  const k: N = clamp(patchy(patchNoise, soot).mul(up.mul(0.45).add(0.55)).mul(soot.mul(0.9).add(0.35)), 0, 0.84);
  return mix(c, CHAR.mul(fine.mul(0.5).add(0.75)), k);
}

/** Settled dust: a pale grey-ochre wash on faces turned up and block tops. */
export function dustOver(c: N, dust: N, fine: N): N {
  const up: N = smoothstep(0.3, 0.9, normalWorld.y);
  const k: N = clamp(dust.mul(up.mul(0.85).add(0.12)).mul(fine.mul(0.3).add(0.8)).mul(0.62), 0, 0.6);
  return mix(c, DUST, k);
}

/**
 * Hairline cracks across a face, growing in number and length with `crack`.
 * Drawn as contours of a noise field measured in pixels, so a crack stays a
 * line or two wide at 150 m in the sight and a hairline close by.
 */
export function crackLines(noise: THREE.Texture, uv: N, crack: N, shade: N): N {
  const field: N = texture(noise, uv.mul(0.62).add(vec2(shade.mul(7.3), 0.21))).r;
  const gateN: N = texture(noise, uv.mul(0.17).add(0.43)).g;
  const px = (d: N): N => d.div(max(fwidth(field), 1e-4));
  const l1: N = float(1).sub(smoothstep(0.35, 1.0, px(abs(field.sub(0.5)))));
  const l2: N = float(1).sub(smoothstep(0.35, 1.0, px(abs(field.sub(0.64))))).mul(smoothstep(0.35, 0.6, crack));
  const reach: N = crack.mul(0.95);
  const gate: N = float(1).sub(smoothstep(reach, reach.add(0.12), gateN)).mul(smoothstep(0.0, 0.05, crack));
  return max(l1, l2).mul(gate);
}

/** One line of scorch and dust for the materials that are not masonry. */
export function wearFinish(c: N, wear: N, noise: THREE.Texture): N {
  const patch: N = texture(noise, vec2(positionWorld.x.add(positionWorld.z).mul(0.45), positionWorld.y.mul(0.45))).g;
  return dustOver(sootOver(c, wear.y, patch, patch), wear.w, patch);
}
