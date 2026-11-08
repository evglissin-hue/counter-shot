// Marks over minions in the overview (readability, render only): from high up
// a pikeman is a few pixels, so each upright one gets a small diamond in its
// team's colour with a dark rim, hovering over its head at a near constant
// size on screen. They fade out as the camera comes close (the figures read on
// their own there) and show only in the overview. One instanced draw of
// camera-facing quads; positions come with each sim frame.

import * as THREE from "three/webgpu";
import { Fn, abs, attribute, cameraPosition, cameraWorldMatrix, clamp, color, float, max, mix, positionGeometry, select, smoothstep, varying, vec3, vec4 } from "three/tsl";
import { MINION_STRIDE } from "@keepfall/sim";
import type { N } from "./tslUtils";

const MAX = 640;
/** Brighter than the tabards, so the marks hold their colour against the ground from far away: the attackers' yellow-green and Ashwright oxblood. */
const MARK_COLORS = [0xc8d43a, 0xd8424a];

export class Marks {
  readonly mesh: THREE.Mesh;
  private data = new Float32Array(MAX * 4);
  private attr: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(quad.index);
    geo.setAttribute("position", quad.attributes.position);
    this.attr = new THREE.InstancedBufferAttribute(this.data, 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aMark", this.attr);
    geo.instanceCount = 0;
    this.geo = geo;
    const m = new THREE.MeshBasicNodeMaterial();
    m.name = "overview-marks";
    m.transparent = true;
    m.depthWrite = false;
    m.fog = false;
    const a: N = attribute("aMark", "vec4");
    // Hover over the head; about 11 px tall at 1280 x 720 whatever the distance, never smaller than a metre and a half.
    const head: N = a.xyz.add(vec3(0, 2.7, 0));
    const dist: N = head.sub(cameraPosition).length();
    const size: N = max(dist.mul(0.016), 1.5);
    const right: N = (cameraWorldMatrix as N).element(0).xyz;
    const up: N = (cameraWorldMatrix as N).element(1).xyz;
    const q: N = positionGeometry.xy;
    m.positionNode = head.add(right.mul(q.x.mul(size))).add(up.mul(q.y.mul(size).add(size.mul(0.35))));
    const uv: N = varying(q.mul(2.0), "vMarkUV");
    const team: N = varying(a.w, "vMarkTeam");
    // Seen up close the figures speak for themselves: fade the marks in from 35 m to 60 m.
    const fade: N = varying(smoothstep(35.0, 60.0, dist), "vMarkFade");
    m.colorNode = Fn(() => {
      const d: N = abs(uv.x).add(abs(uv.y));
      const fill: N = mix(color(MARK_COLORS[0]), color(MARK_COLORS[1]), team);
      return vec4(select(d.greaterThan(0.62), color(0x0b0c0d), fill), 1.0);
    })();
    m.opacityNode = Fn(() => {
      const d: N = abs(uv.x).add(abs(uv.y));
      return clamp(float(1).sub(smoothstep(0.9, 1.0, d)), 0.0, 1.0).mul(fade).mul(0.92);
    })();
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.name = "overview-marks";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
  }

  /** Upright minions of a sim frame (MINION_STRIDE each). */
  update(minions: Float32Array, count: number) {
    const n = Math.min(count, MAX);
    const d = this.data;
    for (let i = 0; i < n; i++) {
      const o = i * MINION_STRIDE;
      d[i * 4] = minions[o + 1];
      d[i * 4 + 1] = minions[o + 2];
      d[i * 4 + 2] = minions[o + 3];
      d[i * 4 + 3] = minions[o + 6];
    }
    this.geo.instanceCount = n;
    this.attr.clearUpdateRanges();
    this.attr.addUpdateRange(0, n * 4);
    this.attr.needsUpdate = true;
  }

  clear() {
    this.geo.instanceCount = 0;
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
