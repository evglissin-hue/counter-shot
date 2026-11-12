// Smooth motion between sim frames (render only, never fed back to the sim).
//
// The worker posts a frame whenever it has stepped, at uneven moments, and the
// screen draws at its own rate (60 or 120 Hz). Drawing the newest frame as it
// arrives makes fast things jump: a mortar shell covers more than a metre per
// tick, so a frame that arrives a few milliseconds late or two at once shakes
// the shot camera and everything it looks at. Instead the page keeps a render
// clock that runs about two ticks behind the newest frame. Frames are applied
// (events, minions, exact stone positions) when the clock reaches them, and
// shells, chain shot and loose stones are drawn between the last applied
// frame and the next one. Slow motion stays smooth for the same reason.

import type { CastleLayout } from "@keepfall/content";
import { CHAIN_STRIDE, PROJECTILE_STRIDE, ProjectileKind, STONE_STRIDE, type FrameData } from "@keepfall/sim";

/** How far the render clock runs behind the newest frame, in ticks. */
export const RENDER_DELAY = 2;
const MAX_BALLS = 256;
const MAX_CHAINS = 64;
/** Further than this from where it should be, the clock jumps instead of easing (a stall, a reset). */
const SNAP = 8;
/** Without a next frame, moving things are carried on along their velocity for at most this many ticks. */
const MAX_EXTRAPOLATE = 3;

export class Timeline {
  /** The tick being drawn (continuous). */
  tick = 0;
  /** Tick of the newest frame received, or -1 before the first. */
  private latest = -1;
  private queue: FrameData[] = [];
  /** Tick of the last applied frame. */
  private prevTick = 0;
  private prevProj = new Float32Array(MAX_BALLS * PROJECTILE_STRIDE);
  private prevCount = 0;
  /** Per stone: position and rotation as of the last applied frame (x, y, z, qx, qy, qz, qw). */
  private stoneNow: Float32Array;
  private nextIndex = new Map<number, number>();
  /** No frame applied since the last reset: the clock jumps to the first frames instead of easing. */
  private fresh = true;
  private seenCount = new Map<number, number>();

  /** Projectiles to draw now, in the frame format (PROJECTILE_STRIDE per ball). */
  readonly proj = new Float32Array(MAX_BALLS * PROJECTILE_STRIDE);
  projCount = 0;
  /** Chains between chain-shot balls to draw now (CHAIN_STRIDE each). */
  readonly chains = new Float32Array(MAX_CHAINS * CHAIN_STRIDE);
  chainCount = 0;
  /** Loose stones to draw between frames now (STONE_STRIDE each). */
  readonly stones: Float32Array;
  stoneCount = 0;

  constructor(private layout: CastleLayout) {
    this.stoneNow = new Float32Array(layout.stones.length * 7);
    this.stones = new Float32Array(layout.stones.length * STONE_STRIDE);
    this.reset();
  }

  /** Forget everything (the castles were rebuilt). */
  reset() {
    this.queue.length = 0;
    this.latest = -1;
    this.tick = 0;
    this.fresh = true;
    this.prevTick = 0;
    this.prevCount = 0;
    this.projCount = this.chainCount = this.stoneCount = 0;
    this.resetStones();
  }

  /** Every stone's remembered transform back to where the castle was built. */
  private resetStones() {
    for (const s of this.layout.stones) {
      const o = s.id * 7;
      this.stoneNow[o] = s.x;
      this.stoneNow[o + 1] = s.y;
      this.stoneNow[o + 2] = s.z;
      this.stoneNow[o + 3] = s.q[0];
      this.stoneNow[o + 4] = s.q[1];
      this.stoneNow[o + 5] = s.q[2];
      this.stoneNow[o + 6] = s.q[3];
    }
  }

  push(f: FrameData) {
    this.queue.push(f);
    this.latest = f.tick;
  }

  /** Frames received but not applied yet. */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Move the clock on by `dt` seconds of real time at `speed` (below 1 in slow
   * motion) and return the frames now due, oldest first. The caller applies
   * them, then calls interpolate().
   */
  advance(dt: number, speed: number): FrameData[] {
    if (this.latest < 0) return [];
    this.tick += dt * 60 * speed;
    const target = this.latest - RENDER_DELAY;
    const err = target - this.tick;
    if (this.fresh || err > SNAP || err < -SNAP) this.tick = target;
    else this.tick += err * Math.min(1, dt * 4);
    this.fresh = false;
    const due: FrameData[] = [];
    while (this.queue.length && this.queue[0].tick <= this.tick) {
      const f = this.queue.shift()!;
      this.applied(f);
      due.push(f);
    }
    return due;
  }

  private applied(f: FrameData) {
    this.prevTick = f.tick;
    const n = Math.min(MAX_BALLS, f.projectileCount);
    this.prevProj.set(f.projectiles.subarray(0, n * PROJECTILE_STRIDE));
    this.prevCount = n;
    this.noteStones(f.stones, f.stoneCount);
  }

  /** Remember the transforms a frame's stones carry (STONE_STRIDE each). */
  private noteStones(s: Float32Array, count: number) {
    for (let i = 0; i < count; i++) {
      const o = i * STONE_STRIDE;
      if (s[o + 2] < -100) continue; // turned to dust: the renderer removes it
      const id = s[o] | 0;
      const k = id * 7;
      if (k < 0 || k >= this.stoneNow.length) continue;
      this.stoneNow[k] = s[o + 1];
      this.stoneNow[k + 1] = s[o + 2];
      this.stoneNow[k + 2] = s[o + 3];
      this.stoneNow[k + 3] = s[o + 4];
      this.stoneNow[k + 4] = s[o + 5];
      this.stoneNow[k + 5] = s[o + 6];
      this.stoneNow[k + 6] = s[o + 7];
    }
  }

  /**
   * Replays (S4): start from a keyframe's world. `moved` lists the stones that are not where the castle
   * was built, in the frame's own layout (STONE_STRIDE each: id, position, rotation), so the first frame
   * interpolated towards starts where the keyframe put the stones.
   */
  seed(moved: Float32Array) {
    this.resetStones();
    this.noteStones(moved, Math.floor(moved.length / STONE_STRIDE));
  }

  /**
   * Replays (S4): set the clock to `tick` at once, with no easing and no delay behind the newest
   * frame, and return the frames now due (oldest first). The caller applies them, then interpolate().
   */
  seek(tick: number): FrameData[] {
    this.tick = tick;
    this.fresh = false;
    const due: FrameData[] = [];
    while (this.queue.length && this.queue[0].tick <= tick) {
      const f = this.queue.shift()!;
      this.applied(f);
      due.push(f);
    }
    return due;
  }

  /** Fill proj, chains and stones for the current clock. */
  interpolate() {
    const next = this.queue[0];
    const span = next ? next.tick - this.prevTick : 0;
    const a = next && span > 0 ? Math.max(0, Math.min(1, (this.tick - this.prevTick) / span)) : 0;
    const ahead = Math.max(0, Math.min(MAX_EXTRAPOLATE, this.tick - this.prevTick)) / 60;

    // Balls: matched between frames by shot id and their order within the shot.
    const idx = this.nextIndex, seen = this.seenCount;
    idx.clear();
    seen.clear();
    if (next) {
      const np = Math.min(MAX_BALLS, next.projectileCount);
      for (let i = 0; i < np; i++) {
        const id = next.projectiles[i * PROJECTILE_STRIDE + 1];
        const k = seen.get(id) ?? 0;
        seen.set(id, k + 1);
        idx.set(id * 1024 + k, i);
      }
      seen.clear();
    }
    const P = PROJECTILE_STRIDE, src = this.prevProj, out = this.proj;
    for (let i = 0; i < this.prevCount; i++) {
      const o = i * P;
      out.set(src.subarray(o, o + P), o);
      const id = src[o + 1];
      const k = seen.get(id) ?? 0;
      seen.set(id, k + 1);
      const j = next ? idx.get(id * 1024 + k) : undefined;
      if (j !== undefined) {
        const q = j * P, np = next!.projectiles;
        for (const c of [2, 3, 4, 6, 7, 8]) out[o + c] = src[o + c] + (np[q + c] - src[o + c]) * a;
      } else {
        // Gone in the next frame (it burst), or no next frame yet: carry it on along its velocity.
        const t = next ? (a * span) / 60 : ahead;
        out[o + 2] = src[o + 2] + src[o + 6] * t;
        out[o + 3] = src[o + 3] + src[o + 7] * t;
        out[o + 4] = src[o + 4] + src[o + 8] * t;
      }
    }
    this.projCount = this.prevCount;

    // Chains run between the two balls of each chain-shot pair (listed one after the other).
    let nc = 0;
    for (let i = 0; i + 1 < this.projCount && nc < MAX_CHAINS; i++) {
      const o = i * P, q = (i + 1) * P;
      if (out[o] !== ProjectileKind.Chain || out[q] !== ProjectileKind.Chain || out[o + 1] !== out[q + 1]) continue;
      const c = nc * CHAIN_STRIDE;
      this.chains[c] = out[o + 2];
      this.chains[c + 1] = out[o + 3];
      this.chains[c + 2] = out[o + 4];
      this.chains[c + 3] = out[q + 2];
      this.chains[c + 4] = out[q + 3];
      this.chains[c + 5] = out[q + 4];
      nc++;
      i++;
    }
    this.chainCount = nc;

    // Stones moving in the next frame: from where they are now towards where they will be.
    let ns = 0;
    if (next && a > 0) {
      const s = next.stones, now = this.stoneNow, o8 = this.stones;
      for (let i = 0; i < next.stoneCount; i++) {
        const o = i * STONE_STRIDE;
        if (s[o + 2] < -100) continue;
        const id = s[o] | 0;
        const k = id * 7;
        if (k < 0 || k >= now.length) continue;
        let qx = s[o + 4], qy = s[o + 5], qz = s[o + 6], qw = s[o + 7];
        const px = now[k + 3], py = now[k + 4], pz = now[k + 5], pw = now[k + 6];
        if (px * qx + py * qy + pz * qz + pw * qw < 0) {
          qx = -qx;
          qy = -qy;
          qz = -qz;
          qw = -qw;
        }
        let rx = px + (qx - px) * a, ry = py + (qy - py) * a, rz = pz + (qz - pz) * a, rw = pw + (qw - pw) * a;
        const len = Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw) || 1;
        rx /= len;
        ry /= len;
        rz /= len;
        rw /= len;
        const w = ns * STONE_STRIDE;
        o8[w] = id;
        o8[w + 1] = now[k] + (s[o + 1] - now[k]) * a;
        o8[w + 2] = now[k + 1] + (s[o + 2] - now[k + 1]) * a;
        o8[w + 3] = now[k + 2] + (s[o + 3] - now[k + 2]) * a;
        o8[w + 4] = rx;
        o8[w + 5] = ry;
        o8[w + 6] = rz;
        o8[w + 7] = rw;
        ns++;
      }
    }
    this.stoneCount = ns;
  }

  /** Index of the first drawn ball of a shot, or -1. */
  find(id: number): number {
    for (let i = 0; i < this.projCount; i++) if (this.proj[i * PROJECTILE_STRIDE + 1] === id) return i;
    return -1;
  }
}
