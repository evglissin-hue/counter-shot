// Water thrown up where things fall into the stream (render only): shots
// (round shot, chain shot, grapeshot, shells), loose timber and stones from a
// blown bridge, bodies knocked off a deck, and a shell bursting in the water.
// A splash is a burst of droplets that fall back and vanish under the surface,
// and a drift of spray that the wind carries off. It watches what the page
// draws (projectiles, loose stones, ragdolls) for a downward crossing of the
// water's surface over the channel, and says so to the page (for the sound).
// Purely cosmetic, pooled, no allocations per frame after the first.

import * as THREE from "three/webgpu";
import { MID_Z, STREAM, streamOffset, streamWidth } from "@keepfall/content";
import { MINION_PARTS, PART_STRIDE, PROJECTILE_STRIDE } from "@keepfall/sim";
import { Burst, type FlashLight } from "./bursts";
import type { ClearView } from "./clearview";
import type { N } from "./tslUtils";

/** At most this many new splashes a frame (a blown bridge drops dozens of pieces at once). */
const PER_FRAME = 6;

export class Splashes {
  readonly root = new THREE.Group();
  /** The page's sound for a splash at (x, y, z) of a size (0..1.5). */
  onSplash: ((x: number, y: number, z: number, size: number) => void) | null = null;
  private drops: Burst;
  private spray: Burst;
  /** Last height of each projectile (by shot id and its order in the shot), loose stone (by id) and body (by minion id). */
  private shotY = new Map<number, number>();
  private shotSeen = new Map<number, number>();
  private stoneY = new Float32Array(0);
  private bodyY = new Map<number, number>();
  private budget = PER_FRAME;
  private frame = 0;

  constructor(time: N, wind: N, sunDir: N, noise: THREE.Texture, clear: ClearView, flash: FlashLight) {
    this.root.name = "splashes";
    this.drops = new Burst(
      { name: "splash", slots: 12, per: 40, life: [0.6, 1.4], color: 0xd3d9d7, colorEnd: 0xaab4b4, additive: false, glow: 1.05, speed: [2.8, 8.5], size: [0.05, 0.16], grow: 2, gravity: 9.8, rise: 0, drag: 0.45, windScale: 0.12, spread: 0.3, opacity: 0.95, floor: false, lighting: 0.8, clearAim: true, sink: STREAM.level - 0.05 },
      time, wind, sunDir, noise, clear, flash,
    );
    this.spray = new Burst(
      { name: "splashmist", slots: 12, per: 8, life: [0.8, 2.0], color: 0xa9b2b3, additive: false, glow: 1.0, speed: [0.8, 2.6], size: [0.25, 1.1], grow: 2.0, gravity: 0, rise: 0.25, drag: 2.4, windScale: 0.55, spread: 1.0, opacity: 0.16, floor: false, lighting: 0.85, clearAim: true, sink: STREAM.level - 0.3 },
      time, wind, sunDir, noise, clear, flash,
    );
    this.root.add(this.drops.mesh, this.spray.mesh);
  }

  /** Is (x, z) over the stream's open water? `ground` is the terrain's height there. */
  static overWater(x: number, z: number, ground: number): boolean {
    if (ground > STREAM.level - 0.04) return false;
    const dz = z - (MID_Z + streamOffset(x));
    const half = streamWidth(x) / 2 + 0.4;
    return dz > -half && dz < half;
  }

  /** A splash of a size (0.1 a grapeshot ball, 1 a stone or a shell, 2.5 a shell bursting in the water). */
  spawn(now: number, x: number, z: number, size: number, sound = true) {
    const y = STREAM.level + 0.04;
    this.drops.spawn(now, x, y, z, 0.4 + size * 0.6, 0, 1, 0);
    if (size > 0.4) this.spray.spawn(now, x, y + 0.2, z, 0.3 + size * 0.5, 0, 0.6, 0);
    if (sound) this.onSplash?.(x, y, z, size);
  }

  /** Call once per rendered frame before the checks below. */
  begin() {
    this.budget = PER_FRAME;
    this.frame++;
  }

  /** Projectiles as drawn now (PROJECTILE_STRIDE each): any crossing the surface over the water splashes. */
  projectiles(now: number, proj: Float32Array, count: number, ground: (x: number, z: number) => number) {
    const L = STREAM.level;
    const seen = this.shotSeen;
    seen.clear();
    for (let i = 0; i < count; i++) {
      const o = i * PROJECTILE_STRIDE;
      const id = proj[o + 1];
      const k = seen.get(id) ?? 0;
      seen.set(id, k + 1);
      const key = id * 32 + k;
      const x = proj[o + 2], y = proj[o + 3], z = proj[o + 4], r = proj[o + 5];
      const prev = this.shotY.get(key);
      this.shotY.set(key, y);
      if (prev === undefined || prev <= L || y > L || this.budget <= 0) continue;
      if (!Splashes.overWater(x, z, ground(x, z))) continue;
      this.budget--;
      // By the ball's size: grapeshot 0.05 m, chain shot 0.16, round shot 0.22, a shell 0.28.
      this.spawn(now, x, z, r < 0.08 ? 0.12 : r < 0.18 ? 0.55 : r < 0.25 ? 0.85 : 1.0);
    }
    // Forget shots that are gone (keys keep the map small).
    if (this.shotY.size > 512) {
      for (const k of this.shotY.keys()) if (!seen.has(Math.floor(k / 32))) this.shotY.delete(k);
    }
  }

  /** Loose stones drawn between frames ([id, x, y, z, ...] STONE_STRIDE 8): timber and stone falling in. */
  stones(now: number, data: Float32Array, count: number, half: (id: number) => number, ground: (x: number, z: number) => number) {
    const L = STREAM.level;
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      const id = data[o] | 0;
      if (id < 0) continue;
      if (id >= this.stoneY.length) {
        const grown = new Float32Array(Math.max(id + 1, this.stoneY.length * 2, 1024)).fill(NaN);
        grown.set(this.stoneY);
        this.stoneY = grown;
      }
      const y = data[o + 2];
      const prev = this.stoneY[id];
      this.stoneY[id] = y;
      if (!(prev === prev) || y < -100) continue;
      const h = half(id);
      if (prev - h <= L || y - h > L || this.budget <= 0) continue;
      const x = data[o + 1], z = data[o + 3];
      if (!Splashes.overWater(x, z, ground(x, z))) continue;
      this.budget--;
      this.spawn(now, x, z, Math.min(1.3, 0.45 + h * 1.4));
    }
  }

  /** Ragdoll parts from a sim frame: a body falling into the water splashes once. */
  bodies(now: number, parts: Float32Array, count: number, ground: (x: number, z: number) => number) {
    const L = STREAM.level;
    for (let i = 0; i < count; i++) {
      const o = i * PART_STRIDE;
      if ((parts[o + 1] | 0) !== 0) continue; // the pelvis stands for the body
      const id = parts[o] | 0;
      const y = parts[o + 3] - MINION_PARTS[0].radius;
      const prev = this.bodyY.get(id);
      this.bodyY.set(id, y);
      if (prev === undefined || prev <= L || y > L || this.budget <= 0) continue;
      const x = parts[o + 2], z = parts[o + 4];
      if (!Splashes.overWater(x, z, ground(x, z))) continue;
      this.budget--;
      this.spawn(now, x, z, 0.7);
    }
    if (this.bodyY.size > 800) this.bodyY.clear();
  }

  clear() {
    this.drops.clear();
    this.spray.clear();
    this.shotY.clear();
    this.bodyY.clear();
    this.stoneY.fill(NaN);
  }

  dispose() {
    this.drops.dispose();
    this.spray.dispose();
  }
}
