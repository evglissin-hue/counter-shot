// Flat cards for far trees (look round L3.5). A card is one quad per tree that
// turns about its vertical axis to face the camera, textured with its kind's
// silhouette and shading painted once at load (treeRaster), alpha tested. The
// forests on the hills and the far valley sides, which are seen only from
// afar, cost two triangles a tree.
//
// The switch between model and card is a static split by distance from the
// battlefield (treeShapes.treeEdgeDistance): inside the box a tree is a model;
// beyond it the model fades out and the card fades in over TREE_FADE metres,
// each a dither of the same noise so the two never both show or both miss, so
// nothing pops when the camera orbits.

import * as THREE from "three/webgpu";
import { Fn, abs, attribute, cameraPosition, float, fract, dot, max, normalize, positionWorld, screenCoordinate, smoothstep, sqrt, texture, transformDirection, vec2, vec3, varying, cameraViewMatrix } from "three/tsl";
import { MID_Z } from "@keepfall/content";
import type { CardImage } from "./treeRaster";
import { TREE_FADE, TREE_NEAR_X, TREE_NEAR_Z } from "./treeShapes";
import { plantLean } from "./plantWind";
import type { N } from "./tslUtils";
import type { WindField } from "./windField";
import { applyCloudShadow } from "./clouds";

/** Interleaved gradient noise from the pixel position: a steady dither pattern, 0..1. */
export function ditherNoise(): N {
  return fract(fract(dot(screenCoordinate, vec2(0.06711056, 0.00583715))).mul(52.9829189));
}

/** The share of a tree that has become a card (0..1) at a world xz: the node twin of treeCardShare. */
export function cardShareAt(xz: N): N {
  const dx: N = max(abs(xz.x).sub(TREE_NEAR_X), 0);
  const dz: N = max(abs(xz.y.sub(MID_Z)).sub(TREE_NEAR_Z), 0);
  return smoothstep(0, TREE_FADE, sqrt(dx.mul(dx).add(dz.mul(dz))));
}

/** The model's fade-out: 1 where the model is drawn at this pixel, 0 where it has handed over to its card. Fragment stage. */
export function modelVisible(): N {
  return ditherNoise().greaterThanEqual(cardShareAt(positionWorld.xz)).select(1, 0);
}

export function cardTexture(img: CardImage): THREE.DataTexture {
  // The image is in rows from the top; a texture's first row is the bottom.
  const flipped = new Uint8Array(img.data.length);
  const rowBytes = img.width * 4;
  for (let y = 0; y < img.height; y++) flipped.set(img.data.subarray(y * rowBytes, (y + 1) * rowBytes), (img.height - 1 - y) * rowBytes);
  const tex = new THREE.DataTexture(flipped, img.width, img.height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export interface CardSpot {
  x: number;
  y: number;
  z: number;
  /** Width and height scale (as the model's instance scale), the width negative to mirror the card. */
  sx: number;
  sy: number;
  /** Colour multiplier (the instance tint). */
  r: number;
  g: number;
  b: number;
}

/** One quad per spot, drawn instanced from per-instance origin, scale and tint attributes. */
export function cardGeometry(img: CardImage, spots: CardSpot[]): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const w = img.halfWidth * 2, h = img.tall;
  // Unit-scaled: the vertex stage multiplies by the card's size.
  g.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const origin = new Float32Array(spots.length * 3), scale = new Float32Array(spots.length * 2), tint = new Float32Array(spots.length * 3);
  spots.forEach((s, i) => {
    origin.set([s.x, s.y, s.z], i * 3);
    scale.set([s.sx * w, s.sy * h], i * 2);
    tint.set([s.r, s.g, s.b], i * 3);
  });
  g.setAttribute("aOrigin", new THREE.InstancedBufferAttribute(origin, 3));
  g.setAttribute("aScale", new THREE.InstancedBufferAttribute(scale, 2));
  g.setAttribute("aTint", new THREE.InstancedBufferAttribute(tint, 3));
  g.instanceCount = spots.length;
  let radius = 1;
  for (const s of spots) radius = Math.max(radius, Math.hypot(s.x, s.z) + Math.max(Math.abs(s.sx * w), s.sy * h));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), radius * 1.05);
  return g;
}

/** The card material: faces the camera, leans in the wind with the plants, takes the fog, the sky light and the clouds' shade. */
export function cardMaterial(name: string, tex: THREE.Texture, wind: WindField, time: N, amp: number): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = name;
  mat.metalness = 0;
  mat.roughness = 0.95;
  mat.side = THREE.DoubleSide;
  mat.alphaTest = 0.5;
  const origin: N = attribute("aOrigin", "vec3");
  const size: N = attribute("aScale", "vec2");
  const tint: N = attribute("aTint", "vec3");
  const lp: N = attribute("position", "vec3");
  const uv0: N = attribute("uv", "vec2");
  const toCam: N = vec2(cameraPosition.x.sub(origin.x), cameraPosition.z.sub(origin.z));
  const face: N = normalize(toCam.add(vec2(1e-4, 0)));
  const right: N = vec3(face.y, 0, face.x.negate());
  const at: N = origin.add(right.mul(lp.x.mul(abs(size.x)))).add(vec3(0, lp.y.mul(size.y), 0));
  const lean: N = plantLean(wind, time, vec2(origin.x, origin.z), lp.y, amp, float(1));
  mat.positionNode = at.add(lean);
  const flip: N = size.x.lessThan(0).select(float(1).sub(uv0.x), uv0.x);
  const vOrigin: N = varying(vec2(origin.x, origin.z), "vCardOrigin");
  const vTint: N = varying(tint, "vCardTint");
  const vUv: N = varying(vec2(flip, uv0.y), "vCardUv");
  const tex4: N = texture(tex, vUv);
  mat.colorNode = Fn(() => tex4.rgb.mul(vTint))();
  // Alpha is the tree's coverage, cut by the dither that hands the tree over from its model.
  mat.opacityNode = Fn(() => tex4.a.mul(ditherNoise().lessThan(cardShareAt(vOrigin)).select(1, 0)))();
  // A card is lit as a crown facing the camera and the sky: its normal leans up and toward the viewer.
  const n: N = normalize(vec3(face.x.mul(0.6), 0.8, face.y.mul(0.6)));
  mat.normalNode = transformDirection(n, cameraViewMatrix);
  applyCloudShadow(mat);
  return mat;
}
