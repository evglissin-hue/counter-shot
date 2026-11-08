// The stream's water: a ribbon along the centreline across the whole land
// (through the gorges at both ends), flat at the water level and a little
// wider than the water. Each vertex carries its distance along the stream and
// across it, for ripples that flow downstream; the shader works out the depth
// per pixel from the channel's shape, so the water is murky in the middle and
// brown over the gravel at the edges, with foam in broken lines at the banks
// and wakes behind the bridge piers, and is clipped to the channel.

import * as THREE from "three/webgpu";
import { Fn, abs, attribute, cameraPosition, clamp, color, dot, exp, float, max, mix, normalize, positionWorld, pow, reflect, smoothstep, step, texture, varying, vec2, vec3 } from "three/tsl";
import { STREAM, streamOffset, streamSlope, streamWidth, MID_Z } from "@keepfall/content";
import type { Sky } from "./sky";
import type { StylePreset } from "./styles";
import type { N } from "./tslUtils";
import { PIER_POSTS, streamEdgeNode } from "./valleyNodes";

/** Metres per second the water runs (towards -x). */
const FLOW = 0.45;
const ACROSS = [-1, -0.5, 0, 0.5, 1];

/** The ribbon, from x = -reach to +reach. */
export function buildStreamGeometry(reach = 1500): THREE.BufferGeometry {
  // Fine near the battlefield, coarser out in the hills.
  const xs: number[] = [];
  for (let x = -130; x <= 130; x += 1) xs.push(x);
  let step = 1;
  for (let x = 130; x < reach; ) {
    step *= 1.045;
    x += step;
    xs.push(x);
    xs.unshift(-x);
  }
  const nA = ACROSS.length;
  const pos = new Float32Array(xs.length * nA * 3);
  const along = new Float32Array(xs.length * nA);
  const across = new Float32Array(xs.length * nA);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (i > 0) {
      const px = xs[i - 1];
      s += Math.hypot(x - px, streamOffset(x) - streamOffset(px));
    }
    const zc = MID_Z + streamOffset(x);
    const sl = streamSlope(x);
    const l = Math.hypot(1, sl);
    const nx = -sl / l, nz = 1 / l;
    const half = streamWidth(x) / 2 + 1.0;
    for (let k = 0; k < nA; k++) {
      const off = ACROSS[k] * half;
      const vx = x + nx * off, vz = zc + nz * off;
      const o = i * nA + k;
      pos[o * 3] = vx;
      pos[o * 3 + 1] = STREAM.level;
      pos[o * 3 + 2] = vz;
      along[o] = s;
      across[o] = off;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let k = 0; k < nA - 1; k++) {
      const a = i * nA + k, b = a + 1, c = a + nA, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
  g.setAttribute("aAcross", new THREE.BufferAttribute(across, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function makeStreamMaterial(style: StylePreset, sky: Sky, noise: THREE.Texture, time: N): THREE.MeshStandardNodeMaterial {
  const W = style.water;
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = `${style.name}-stream`;
  mat.metalness = 0;
  const along: N = varying(attribute("aAlong", "float"), "vAlong");
  const across: N = varying(attribute("aAcross", "float"), "vAcross");
  const wp: N = positionWorld;
  // Depth per pixel from the channel's own shape (as content's valleyHeight cuts it):
  // the bed falls as (1 - q^2) from the water's edge (q = 1) to the middle (q = 0).
  const { edge, half } = streamEdgeNode(wp.x, wp.z);
  const q: N = clamp(edge.add(half).div(half), 0.0, 2.0);
  const depth: N = float(STREAM.depth).mul(float(1).sub(q.mul(q)));
  // Only inside the channel: where the coarse far ground dips under the water level, no water shows.
  mat.alphaTest = 0.5;
  mat.opacityNode = float(1).sub(step(0.25, edge));
  // Two layers of ripples drifting downstream at different speeds, and a slow swirl.
  const flow: N = time.mul(FLOW);
  const uv1: N = vec2(along.add(flow).div(9.0), across.div(5.5));
  const uv2: N = vec2(along.add(flow.mul(1.6)).div(3.7), across.div(2.9).add(0.37));
  const uv3: N = vec2(along.add(flow.mul(0.5)).div(23.0), across.div(11.0).add(0.71));
  const n1: N = texture(noise, uv1);
  const n2: N = texture(noise, uv2);
  const n3: N = texture(noise, uv3);
  const ripple: N = vec2(n1.g.sub(n2.g).mul(0.7).add(n3.r.sub(0.5).mul(0.4)), n2.r.add(n1.r).sub(1.0).mul(0.6)).mul(0.22);
  const nrm: N = normalize(vec3(ripple.x, 1.0, ripple.y));
  // Foam: in broken lines at the water's edge, and around and behind each pier post.
  const lap: N = texture(noise, vec2(along.add(flow.mul(0.8)).div(2.3), across.div(1.1).add(0.5))).r;
  const foamEdge: N = float(1).sub(smoothstep(-0.55, -0.05, edge.add(lap.sub(0.5).mul(0.5)))).mul(smoothstep(-0.9, -0.35, edge)).mul(smoothstep(0.35, 0.6, lap));
  let pier: N = float(0);
  for (const [px, pz] of PIER_POSTS) {
    const dx: N = wp.x.sub(px);
    const dz: N = wp.z.sub(pz);
    const ring: N = float(1).sub(smoothstep(0.18, 0.75, dx.mul(dx).add(dz.mul(dz)).sqrt()));
    // The water runs towards -x: the wake trails that way only, widening and fading (none upstream).
    const down: N = max(dx.negate(), 0.0);
    const wake: N = exp(down.mul(-0.45)).mul(float(1).sub(smoothstep(0.05, down.mul(0.18).add(0.3), abs(dz)))).mul(smoothstep(0.0, 0.35, down));
    pier = max(pier, max(ring, wake));
  }
  const streaks: N = smoothstep(0.42, 0.75, texture(noise, vec2(along.add(flow.mul(1.3)).div(1.7), across.div(0.6))).g);
  const foam: N = clamp(foamEdge.mul(0.5).add(pier.mul(0.85)).mul(streaks.mul(0.7).add(0.4)), 0, 1);
  mat.colorNode = Fn(() => {
    const viewDir = normalize(wp.sub(cameraPosition));
    const r: N = reflect(viewDir, nrm);
    const fres = pow(float(1).sub(max(dot(viewDir.negate(), nrm), 0.0)), 5.0).mul(0.55).add(0.15);
    // The overcast sky in the water, a little darker than the sky itself. Low reflections see the valley's
    // banks, trees and hills rather than the bright haze at the horizon, so seen at a low angle the water stays dark.
    const skyRefl = sky.skyColor(normalize(vec3(r.x, max(r.y, 0.02), r.z)), false).mul(0.85);
    const sky0 = mix(color(0x2c322b), skyRefl, smoothstep(0.03, 0.32, r.y));
    // Murky, peaty water: the gravel shows through brown at the edges, dark green-brown in the middle.
    const shallow: N = color(W.shallow);
    const body: N = mix(mix(color(0x4d4838), shallow, smoothstep(0.05, 0.4, depth)), color(W.deep), smoothstep(0.35, 1.0, depth));
    const c: N = mix(body, sky0, clamp(fres.mul(W.reflect), 0.0, 1.0)).toVar();
    // Silt drifting in the current.
    c.mulAssign(n3.g.sub(0.5).mul(0.16).add(1.0));
    c.assign(mix(c, vec3(0.7, 0.72, 0.7), foam.mul(0.5)));
    return c;
  })();
  mat.roughnessNode = mix(float(0.06), float(0.5), foam);
  return mat;
}
