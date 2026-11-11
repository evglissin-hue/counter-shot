// Dust that stays (look round L2.5): after a great collapse a low haze hangs
// over the rubble for half a minute to a minute, drifting with the game's wind
// and thinning near the aim line and the crosshair (readability rule 6, through
// ClearView). Each haze is a handful of large soft camera-facing billboards
// hugging the ground to about 8 m, drawn as one instanced mesh (3 slots).
//
// It looks the same on every tier: nothing here reads the quality tier, so
// what it hides is the same everywhere (docs/phase-3.md rule 8). The logic
// (when a collapse counts, where it is, the life and drift) is hazeLogic.ts.
//
// This file is the only owner of the live hazes; track S3's replay keyframes
// use capture() and apply() here.

import * as THREE from "three/webgpu";
import {
  Fn,
  clamp,
  cameraWorldMatrix,
  color,
  dot,
  float,
  hash,
  instanceIndex,
  max,
  mix,
  normalize,
  positionGeometry,
  select,
  smoothstep,
  sqrt,
  texture,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
  cameraViewMatrix,
  cos,
  cameraFar,
  cameraNear,
  perspectiveDepthToViewZ,
  positionView,
  viewportDepthTexture,
  sin,
} from "three/tsl";
import type { FrameData } from "@keepfall/sim";
import { EVENT_STRIDE, EventKind } from "@keepfall/sim";
import { sectionOf, type CastleLayout } from "@keepfall/content";
import { screenCap } from "./bursts";
import type { ClearView } from "./clearview";
import { CollapseTracker, HAZE_LIFE, HazeSet, MAX_HAZES, hazeEnvelope, hazeRadius, locateRubble } from "./hazeLogic";
import type { N } from "./tslUtils";

/** Puffs in one haze. */
const PUFFS = 9;
/** The haze's opacity at its thickest. */
const OPACITY = 0.2;
/** How close (m) behind a puff a wall or the ground must be for the puff to fade there. */
const SOFT = 3;
/** How high the puffs reach above the ground (m). */
const HEIGHT = 8;

function rnd(i: N, salt: number): N {
  return hash(i.toUint().mul(9781).add(salt));
}

export class Haze {
  readonly mesh: THREE.Mesh;
  readonly set = new HazeSet();
  private readonly tracker = new CollapseTracker();
  private a: THREE.Vector4[] = [];
  private b: THREE.Vector4[] = [];
  private c: THREE.Vector4[] = [];

  /** Called once per haze when it starts (x, y, z at the ground, radius in m, dust amount 0..1): the master wires it to the stone wear module's dustAround. */
  set onSettle(fn: ((x: number, y: number, z: number, radius: number, amount: number) => void) | null) {
    this.set.onSettle = fn;
  }
  get onSettle() {
    return this.set.onSettle;
  }

  constructor(noise: THREE.Texture, sunDir: N, clear: ClearView | null) {
    for (let i = 0; i < MAX_HAZES; i++) {
      this.a.push(new THREE.Vector4(0, -100, 0, 0)); // x + drift, ground y, z + drift, age
      this.b.push(new THREE.Vector4(1, 1, 0, 0)); // radius now, envelope, seed, spare
      this.c.push(new THREE.Vector4(0, 0, 0, 0));
    }
    const uA: N = uniformArray(this.a, "vec4");
    const uB: N = uniformArray(this.b, "vec4");
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(quad.index);
    geo.setAttribute("position", quad.attributes.position);
    geo.instanceCount = MAX_HAZES * PUFFS;

    const m = new THREE.MeshBasicNodeMaterial();
    m.name = "haze";
    m.transparent = true;
    m.depthWrite = false;
    const idx: N = instanceIndex;
    const slot: N = idx.div(PUFFS);
    const A: N = uA.element(slot);
    const B: N = uB.element(slot);
    const radius: N = B.x;
    const env: N = B.y;
    const salt: N = B.z;
    const r1 = rnd(idx, 7), r2 = rnd(idx, 19), r3 = rnd(idx, 31), r5 = rnd(idx, 59);
    // Spread over the disc, thicker low down; the same puff stays in the same place as the haze spreads.
    const az: N = r1.mul(6.2831853).add(salt);
    const rad: N = sqrt(r2).mul(radius).mul(0.85);
    const size: N = clamp(radius.mul(0.9), 5.0, 14.0).mul(mix(0.75, 1.3, r5));
    const lift: N = r3.mul(r3).mul(HEIGHT - 2.0).add(1.0);
    const centre: N = vec3(A.x.add(cos(az).mul(rad)), A.y.add(lift), A.z.add(sin(az).mul(rad)));
    const right: N = (cameraWorldMatrix as N).element(0).xyz;
    const up: N = (cameraWorldMatrix as N).element(1).xyz;
    const qp: N = positionGeometry.xy;
    const ang: N = r5.mul(6.283);
    const rq: N = vec2(qp.x.mul(cos(ang)).sub(qp.y.mul(sin(ang))), qp.x.mul(sin(ang)).add(qp.y.mul(cos(ang))));
    const cap = screenCap(centre, size);
    const s: N = select(env.greaterThan(0.001), cap.size, float(0.0));
    const wpos: N = centre.add(right.mul(rq.x.mul(s))).add(up.mul(rq.y.mul(s)));
    m.positionNode = wpos;
    const clearFade: N = (clear ? clear.fade(wpos) : float(1)).mul(cap.near);
    const vuv: N = varying(qp.mul(2.0), "vHazeUV");
    const vAlpha: N = varying(env.mul(mix(0.6, 1.0, r2)).mul(OPACITY).mul(clearFade), "vHazeA");
    const vSeed: N = varying(r1.add(salt), "vHazeSeed");
    const sunView: N = normalize(cameraViewMatrix.mul(vec4(sunDir, 0.0)).xyz);
    const base = color(0x938a77);
    m.colorNode = Fn(() => {
      const nz = sqrt(max(float(1).sub(dot(vuv, vuv)), 0.0));
      const lit = clamp(dot(vec3(vuv.x, vuv.y, nz), sunView).mul(0.5).add(0.5), 0.0, 1.0);
      return vec4(base.mul(mix(0.78, 0.98, lit)), 1.0);
    })();
    m.opacityNode = Fn(() => {
      const r2d = dot(vuv, vuv);
      const wisp = texture(noise, vuv.mul(0.18).add(vec2(vSeed, vSeed.mul(1.7)))).r;
      const disc = float(1).sub(smoothstep(0.0, 1.0, r2d));
      // Soft where a puff meets a wall or the ground: fade out within SOFT m of what lies behind it (no hard line where the quad cuts in).
      const sceneZ: N = perspectiveDepthToViewZ(viewportDepthTexture(), cameraNear, cameraFar);
      const soft: N = clamp(positionView.z.sub(sceneZ).div(SOFT), 0.0, 1.0);
      return clamp(disc.mul(disc).mul(wisp.mul(1.1).add(0.5)).mul(vAlpha).mul(soft), 0.0, 1.0);
    })();
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.name = "haze";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.visible = false;
  }

  /**
   * Each sim frame: reads the Fell events, and starts a haze where a section's
   * collapse reaches the threshold. groundAt gives the ground height.
   */
  frame(frame: FrameData, layout: CastleLayout | null, now: number, groundAt: (x: number, z: number) => number) {
    const ev = frame.events;
    for (let i = 0; i < frame.eventCount; i++) {
      const o = i * EVENT_STRIDE;
      if (ev[o] !== EventKind.Fell) continue;
      const castle = ev[o + 1] | 0, section = ev[o + 2] | 0;
      const total = this.tracker.add(frame.tick, castle, section, ev[o + 3]);
      if (!total || !layout) continue;
      const secs = sectionOf(layout);
      const stones = layout.stones;
      const inSection = (id: number) => id >= 0 && id < stones.length && stones[id].castle === castle && secs[id] === section;
      const home = stones.filter((s) => s.castle === castle && secs[s.id] === section);
      const r = locateRubble(frame.stones, frame.stoneCount, inSection, home);
      if (!r) continue;
      const radius = hazeRadius(r.spread);
      const life = HAZE_LIFE[0] + (HAZE_LIFE[1] - HAZE_LIFE[0]) * ((Math.abs(Math.sin(r.x * 12.9898 + r.z * 78.233)) * 43758.5453) % 1);
      this.set.spawn(now, r.x, groundAt(r.x, r.z), r.z, radius, life, Math.min(1, Math.max(0.4, total / 60)));
    }
  }

  /** Once per rendered frame: carry the hazes on the wind and set the shader's slots. */
  update(now: number, dt: number, sample: (x: number, z: number, out: { x: number; z: number }) => void) {
    this.set.update(now, dt, sample);
    const list = this.set.list;
    for (let k = 0; k < MAX_HAZES; k++) {
      const h = list[k];
      if (!h) {
        this.b[k].y = 0;
        continue;
      }
      const age = now - h.born;
      this.a[k].set(h.x + h.ox, h.y, h.z + h.oz, age);
      this.b[k].set(h.radius * (1 + age / 60), hazeEnvelope(age, h.life), (h.x * 0.37 + h.z * 0.11) % 6.28, 0);
    }
    this.mesh.visible = list.length > 0;
  }

  clear() {
    this.set.clear();
    this.tracker.clear();
    for (const b of this.b) b.y = 0;
    this.mesh.visible = false;
  }

  /** The live hazes (and the recent Fell counts) for a replay keyframe. */
  capture(now: number): { hazes: Float32Array; recent: number[] } {
    return { hazes: this.set.capture(now), recent: this.tracker.capture() };
  }

  apply(saved: { hazes: ArrayLike<number>; recent: ArrayLike<number> }, now: number) {
    this.set.apply(saved.hazes, now);
    this.tracker.apply(saved.recent);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
