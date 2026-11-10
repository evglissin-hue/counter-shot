// The game's wind over the land (look round L3): one place every swaying
// thing reads it from, so trees, reeds, grass, flags and smoke all move with
// the wind the match sends (FrameData windX, windZ) and nothing invents its
// own.
//
// A gust shows on the land before it reaches the gun. Each frame also says
// where the wind is heading and when it gets there (gustX, gustZ, gustIn: the
// gust easing in now, see Wind.lead in @keepfall/sim). A front carries that
// coming wind towards the gun you ride (the anchor): it starts upwind at
// FRONT_SPEED times the time left and reaches the gun as the gust does. The
// land upwind of the front already moves with the coming wind; the land
// downwind of it moves with the wind now. When a front reaches the gun it
// keeps rolling on downwind as the passing front, fading over PASS_FADE
// seconds, so a gunner sees a gust run on towards the target.
//
// TSL helpers (at, band, gust, bend) evaluate at a world xz point; CPU twins
// (sampleAt, bandAt) serve code that runs per object (flags, birds).

import * as THREE from "three/webgpu";
import { clamp, dot, exp, float, max, min, sin, texture, uniform, vec2 } from "three/tsl";
import type { N } from "./tslUtils";

/** How fast a front crosses the land (m/s). A gust 2 to 5 s out starts 60 to 150 m upwind. */
export const FRONT_SPEED = 30;
/** Half width of a front's band on the land (m). */
export const BAND = 9;
/** How long a passing front rolls on downwind before it has faded (s). */
export const PASS_FADE = 5;
/** The strongest wind the match makes (m/s; sim Wind's maxSpeed with a full gust), for normalising. */
export const WIND_MAX = 13.75;
/** How fast the upwind side eases to a new gust's wind (1/s), so a new front never snaps the far land. */
const NEXT_EASE = 3;

export class WindField {
  /** The wind now at the gun (m/s, x and z). */
  readonly now = uniform(new THREE.Vector2(0, 0));
  /** The wind behind the coming front (m/s, x and z). */
  readonly next = uniform(new THREE.Vector2(0, 0));
  /** The coming front: a point on it (x, z) and the unit direction it travels (downwind). */
  readonly front = uniform(new THREE.Vector4(0, -1e5, 0, 1));
  /** The passing front, the same way; its strength fades to 0. */
  readonly past = uniform(new THREE.Vector4(0, -1e5, 0, 1));
  /** Signed size of each front's change: (|next| - |now|) / max(|now|, 2), so + is a gust and - a lull. x: coming, y: passing (faded). */
  readonly change = uniform(new THREE.Vector2(0, 0));
  /** The wind integrated over time (m): noise that rides the wind scrolls by it. */
  readonly drift = uniform(new THREE.Vector2(0, 0));
  private readonly time: N;
  private readonly noise: THREE.Texture;
  private anchorX = 0;
  private anchorZ = -150;
  private nowX = 0;
  private nowZ = 0;
  private leadX = 0;
  private leadZ = 0;
  private nextX = 0;
  private nextZ = 0;
  /** Seconds until the coming front reaches the anchor. */
  private left = 0;
  private dirX = 0;
  private dirZ = 1;
  private pastAge = PASS_FADE;
  private pastChange = 0;
  private pastX = 0;
  private pastZ = -1e5;
  private pastDirX = 0;
  private pastDirZ = 1;
  private hasLead = false;

  constructor(time: N, noise: THREE.Texture) {
    this.time = time;
    this.noise = noise;
  }

  /** Each sim frame: the wind now and where it is heading (gust fields may be missing in old frames: then no front shows). */
  setFrame(windX: number, windZ: number, gustX?: number, gustZ?: number, gustIn?: number) {
    this.nowX = windX || 0;
    this.nowZ = windZ || 0;
    if (gustX === undefined || gustZ === undefined || gustIn === undefined) {
      this.hasLead = false;
      this.leadX = this.nowX;
      this.leadZ = this.nowZ;
      this.left = 0;
      return;
    }
    const left = gustIn / 60;
    // A new gust began: the front that was coming has reached the gun and rolls on.
    if (this.hasLead && left > this.left + 0.25) {
      this.pastAge = 0;
      this.pastChange = this.changeOf(this.nextX, this.nextZ, this.nowX, this.nowZ);
      this.pastX = this.anchorX;
      this.pastZ = this.anchorZ;
      this.pastDirX = this.dirX;
      this.pastDirZ = this.dirZ;
    }
    this.hasLead = true;
    this.leadX = gustX;
    this.leadZ = gustZ;
    this.left = left;
  }

  /** Where the front is aimed: the gun you ride (or the camera's focus when you ride none). */
  setAnchor(x: number, z: number) {
    this.anchorX = x;
    this.anchorZ = z;
  }

  /** Once per rendered frame (cosmetic dt). */
  update(dt: number) {
    const d = this.drift.value;
    d.x += this.nowX * dt;
    d.y += this.nowZ * dt;
    // Keep the drift small so the noise lookups stay precise (the wrap is far beyond any noise period used).
    if (Math.abs(d.x) > 4096) d.x -= Math.sign(d.x) * 4096;
    if (Math.abs(d.y) > 4096) d.y -= Math.sign(d.y) * 4096;
    this.now.value.set(this.nowX, this.nowZ);
    const k = 1 - Math.exp(-dt * NEXT_EASE);
    this.nextX += (this.leadX - this.nextX) * k;
    this.nextZ += (this.leadZ - this.nextZ) * k;
    this.next.value.set(this.nextX, this.nextZ);
    this.left = Math.max(0, this.left - dt);
    const sp = Math.hypot(this.nextX, this.nextZ);
    if (sp > 0.05) {
      this.dirX = this.nextX / sp;
      this.dirZ = this.nextZ / sp;
    }
    const dist = this.hasLead ? this.left * FRONT_SPEED : 0;
    this.front.value.set(this.anchorX - this.dirX * dist, this.anchorZ - this.dirZ * dist, this.dirX, this.dirZ);
    this.pastAge += dt;
    const fade = Math.max(0, 1 - this.pastAge / PASS_FADE);
    const travelled = this.pastAge * FRONT_SPEED;
    this.past.value.set(this.pastX + this.pastDirX * travelled, this.pastZ + this.pastDirZ * travelled, this.pastDirX, this.pastDirZ);
    this.change.value.set(this.hasLead ? this.changeOf(this.nextX, this.nextZ, this.nowX, this.nowZ) : 0, this.pastChange * fade);
  }

  private changeOf(ax: number, az: number, bx: number, bz: number): number {
    const a = Math.hypot(ax, az), b = Math.hypot(bx, bz);
    return Math.max(-1, Math.min(1, (a - b) / Math.max(b, 2)));
  }

  // --- TSL: evaluate at a world point (xz is a vec2 node) --------------------

  /** Signed distance of xz downwind of a front (m): negative behind it (upwind), positive ahead of it. */
  private ahead(xz: N, f: N): N {
    return dot(xz.sub(f.xy), f.zw);
  }

  /** The wind at xz (m/s, vec2): the coming wind upwind of the front, the wind now downwind of it, blended across the band. */
  at(xz: N): N {
    const s: N = this.ahead(xz, this.front);
    const behind: N = float(1).sub(clamp(s.div(BAND).mul(0.5).add(0.5), 0, 1));
    return this.now.add(this.next.sub(this.now).mul(behind));
  }

  /** The fronts as a signed band on the land: + where a gust's front is passing, - for a lull, 0 elsewhere (about -1..1). */
  band(xz: N): N {
    const a: N = this.ahead(xz, this.front).div(BAND);
    const b: N = this.ahead(xz, this.past).div(BAND);
    return exp(a.mul(a).negate()).mul(this.change.x).add(exp(b.mul(b).negate()).mul(this.change.y));
  }

  /** Local gustiness at xz (about 0.6..1.6): noise that rides the wind, raised where a gust front passes. */
  gust(xz: N): N {
    const n: N = texture(this.noise, xz.sub(this.drift).mul(1 / 70)).r;
    return max(0.3, n.sub(0.5).mul(0.7).add(1).add(this.band(xz).mul(0.8)));
  }

  /**
   * How a plant at xz bends (vec2, metres per unit of sway): a lean downwind
   * by the wind's speed and a flutter whose speed and size grow with it. Scale
   * by the plant's own amount and by height up the stem. `phase` varies the
   * flutter per plant (any node).
   */
  bend(xz: N, phase: N): N {
    const w: N = this.at(xz);
    const speed: N = w.length();
    const norm: N = min(speed.div(WIND_MAX), 1.2);
    const dir: N = w.div(max(speed, 0.05));
    const g: N = this.gust(xz);
    const lean: N = norm.mul(g);
    const flutter: N = sin(this.time.mul(float(1.4).add(norm.mul(2.2))).add(phase)).mul(float(0.15).add(norm.mul(0.45))).mul(g);
    const side: N = sin(this.time.mul(1.9).add(phase.mul(1.7))).mul(norm.mul(0.18));
    return dir.mul(lean.add(flutter)).add(vec2(dir.y.negate(), dir.x).mul(side));
  }

  // --- CPU twins ---------------------------------------------------------------

  /** The wind at (x, z) as `at` computes it, into out [x, z]. */
  sampleAt(x: number, z: number, out: { x: number; z: number }) {
    const f = this.front.value;
    const s = (x - f.x) * f.z + (z - f.y) * f.w;
    const behind = 1 - Math.min(1, Math.max(0, (s / BAND) * 0.5 + 0.5));
    const n = this.now.value, nx = this.next.value;
    out.x = n.x + (nx.x - n.x) * behind;
    out.z = n.y + (nx.y - n.y) * behind;
  }

  /** The signed band at (x, z) as `band` computes it. */
  bandAt(x: number, z: number): number {
    const f = this.front.value, p = this.past.value, c = this.change.value;
    const a = ((x - f.x) * f.z + (z - f.y) * f.w) / BAND;
    const b = ((x - p.x) * p.z + (z - p.y) * p.w) / BAND;
    return Math.exp(-a * a) * c.x + Math.exp(-b * b) * c.y;
  }
}
