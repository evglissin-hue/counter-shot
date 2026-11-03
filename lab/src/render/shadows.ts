// Sun shadows: one directional light whose orthographic shadow camera is
// fitted (in light space) to the battlefield box, and a PCF filter whose tap
// count and radius come from the quality tier and the style.

import * as THREE from "three/webgpu";
import {
  Fn,
  float,
  int,
  interleavedGradientNoise,
  reference,
  renderGroup,
  screenCoordinate,
  texture,
  vec2,
  vogelDiskSample,
} from "three/tsl";
import type { N } from "./tslUtils";

/** Region the shadow map must cover: both castles and the field between. */
export const SHADOW_BOX = { x0: -62, x1: 62, y0: -1, y1: 34, z0: -198, z1: 48 };

/**
 * PCF with `taps` hardware-compared samples on a Vogel disk, rotated per
 * pixel by interleaved gradient noise. radius is read from shadow.radius
 * (texels), so softness can change without rebuilding shaders.
 */
export function makeSoftShadowFilter(taps: number) {
  return Fn(({ depthTexture, shadowCoord, shadow }: { depthTexture: N; shadowCoord: N; shadow: N }) => {
    const mapSize: N = (reference("mapSize", "vec2", shadow) as N).setGroup(renderGroup);
    const radius: N = (reference("radius", "float", shadow) as N).setGroup(renderGroup);
    const texel: N = vec2(1).div(mapSize);
    const r: N = texel.mul(radius);
    const phi: N = interleavedGradientNoise(screenCoordinate.xy).mul(6.28318530718);
    let sum: N = float(0);
    for (let i = 0; i < taps; i++) {
      const off: N = vogelDiskSample(int(i), int(taps), phi).mul(r);
      sum = sum.add((texture(depthTexture, shadowCoord.xy.add(off)) as N).compare(shadowCoord.z));
    }
    return sum.mul(1 / taps);
  });
}

const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());

/** Fit the light's orthographic shadow camera tightly around SHADOW_BOX. */
export function fitShadowCamera(light: THREE.DirectionalLight, sunDir: THREE.Vector3) {
  const b = SHADOW_BOX;
  const centre = new THREE.Vector3((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
  const dist = 400;
  light.position.copy(centre).addScaledVector(sunDir, dist);
  light.target.position.copy(centre);
  light.target.updateMatrixWorld();
  const cam = light.shadow.camera as THREE.OrthographicCamera;
  // Align the map's vertical axis with the long side of the box (world Z) when possible.
  const up = Math.abs(sunDir.z) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  cam.up.copy(up);
  cam.position.copy(light.position);
  cam.lookAt(centre);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse;
  let i = 0;
  for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) _corners[i++].set(x, y, z).applyMatrix4(inv);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of _corners) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
    minZ = Math.min(minZ, c.z);
    maxZ = Math.max(maxZ, c.z);
  }
  cam.left = minX;
  cam.right = maxX;
  cam.bottom = minY;
  cam.top = maxY;
  // Camera looks down -Z: near/far are distances along the view direction.
  cam.near = Math.max(0.5, -maxZ - 20);
  cam.far = -minZ + 20;
  cam.updateProjectionMatrix();
  light.shadow.camera.up.copy(up);
}
