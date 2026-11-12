// Cloud shadows (look round L3): soft patches of shade that drift over the
// valley with the game's wind. One shared set of uniforms (one renderer per
// page), updated once a frame by the renderer; any material that receives the
// sun's shadow can take the cloud shade through applyCloudShadow, which dims
// only the sun's direct light (the sky fill stays), as a real cloud does.

import * as THREE from "three/webgpu";
import { Fn, float, positionWorld, smoothstep, texture, uniform, vec2 } from "three/tsl";
import type { N } from "./tslUtils";

/** How fast the clouds' shadows cross the land per m/s of wind at the ground (winds aloft run faster). */
export const CLOUD_SPEED = 1.6;

export const CLOUDS = {
  /** Where the cloud pattern has drifted to (m, x and z). */
  offset: uniform(new THREE.Vector2(0, 0)),
  /** Share of the sky covered (0..1). */
  cover: uniform(0.45),
  /** How much of the sun a cloud takes away (0..1). */
  depth: uniform(0.42),
  /** Size of a cloud's shadow on the land (m across, roughly). */
  scale: uniform(260),
  /** Softness of a shadow's edge (0..0.5). */
  soft: uniform(0.16),
};

let noiseTex: THREE.Texture | null = null;

/** The noise texture the shade is drawn from (the renderer sets it once). */
export function setCloudNoise(noise: THREE.Texture) {
  noiseTex = noise;
}

/** Drift the clouds with the wind (m/s at the ground) once a frame. */
export function updateClouds(windX: number, windZ: number, dt: number) {
  const o = CLOUDS.offset.value;
  o.x += windX * CLOUD_SPEED * dt;
  o.y += windZ * CLOUD_SPEED * dt;
  if (Math.abs(o.x) > 1e5) o.x = 0;
  if (Math.abs(o.y) > 1e5) o.y = 0;
}

/** The sun's share left by the clouds at a world position (1 in the open, 1 - depth under a cloud). */
export function cloudLight(p: N = positionWorld): N {
  if (!noiseTex) return float(1);
  const uv: N = vec2(p.x, p.z).sub(CLOUDS.offset).div(CLOUDS.scale);
  const n: N = texture(noiseTex, uv).r.mul(0.65).add(texture(noiseTex, uv.mul(2.3).add(0.37)).g.mul(0.35));
  const thr: N = float(1).sub(CLOUDS.cover);
  const c: N = smoothstep(thr.sub(CLOUDS.soft), thr.add(CLOUDS.soft), n);
  return float(1).sub(c.mul(CLOUDS.depth));
}

/** Dim the sun's direct light on this material under the clouds' shadows (shadows from the sun only). */
export function applyCloudShadow(mat: THREE.NodeMaterial) {
  (mat as unknown as { receivedShadowNode: unknown }).receivedShadowNode = Fn(([shadow]: [N]) => shadow.mul(cloudLight()));
}
