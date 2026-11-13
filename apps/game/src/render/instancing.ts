import * as THREE from "three/webgpu";

/**
 * Instanced meshes that share their programs.
 *
 * Three draws an instanced mesh whose matrices fit in one uniform block (64 KB on
 * most GPUs, 16 KB in software rendering) through a uniform buffer named after
 * that mesh's own node, so each such mesh links programs of its own (the main
 * pass, the impact cam's pass, the shadow pass) even when many meshes share one
 * material: the crews' thirteen cloth parts alone linked 26 programs at load. A
 * mesh with room for more matrices than a 64 KB block holds takes three's
 * per-instance attribute path instead, whose shader is the same for every mesh
 * on a material, so they share one program. Only the instances in use are sent
 * to the GPU each frame (`markInstances`), so the larger buffer costs memory
 * (64 KB a mesh) and nothing per frame.
 */
export const SHARED_INSTANCES = 65536 / 64 + 1;

/** The capacity to give an instanced mesh that needs room for `n`, so it shares its material's programs. */
export function sharedCapacity(n: number): number {
  return Math.max(n, SHARED_INSTANCES);
}

/** Send the first `count` instances (matrices, and colours if it has them) of a mesh to the GPU this frame. */
export function markInstances(mesh: THREE.InstancedMesh, count = mesh.count) {
  if (count <= 0) return;
  const m = mesh.instanceMatrix;
  m.clearUpdateRanges();
  m.addUpdateRange(0, count * 16);
  m.needsUpdate = true;
  const c = mesh.instanceColor;
  if (c) {
    c.clearUpdateRanges();
    c.addUpdateRange(0, count * 3);
    c.needsUpdate = true;
  }
}
