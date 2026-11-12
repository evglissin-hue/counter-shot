// Wind over the valley: a new target every 30 to 60 seconds, reached by a
// smooth 4 second turn, with gusts on top: every 2 to 5 seconds the wind eases
// into a new gust that swells or slackens it by up to a quarter and veers it by
// up to 10 degrees. The gauge, the flags and the smoke show the gusts, so a
// gunner can wait for a lull. Deterministic: driven by its own Rng streams and
// the tick.

import { dcos, dsin, Rng } from "@keepfall/core";

const TURN = 4 * 60;
/** Gusts: strength within 1 +- GUST_STRENGTH of the base wind, direction within +- GUST_VEER radians. */
export const GUST_STRENGTH = 0.25;
export const GUST_VEER = 0.17;

export class Wind {
  /** The wind now, gusts included (m/s along x and z). */
  x = 0;
  z = 0;
  private baseX = 0;
  private baseZ = 0;
  private fromX = 0;
  private fromZ = 0;
  private toX = 0;
  private toZ = 0;
  private changeAt = 0;
  private turnStart = 0;
  private rng: Rng;
  private gustRng: Rng;
  /** The gust easing in now: from and to (strength, veer), when it started and how long it eases. */
  private gust = { fromS: 1, fromV: 0, toS: 1, toV: 0, start: 0, len: 1 };

  constructor(rng: Rng, private maxSpeed = 11) {
    this.rng = rng;
    this.pick(0);
    this.baseX = this.x = this.toX;
    this.baseZ = this.z = this.toZ;
    this.gustRng = rng.fork("gust");
  }

  private pick(tick: number) {
    this.fromX = this.baseX;
    this.fromZ = this.baseZ;
    const speed = this.rng.range(1, this.maxSpeed);
    const dir = this.rng.range(0, 6.283185307179586);
    this.toX = dsin(dir) * speed;
    this.toZ = dcos(dir) * speed;
    this.turnStart = tick;
    this.changeAt = tick + 30 * 60 + Math.floor(this.rng.next() * 30 * 60);
  }

  step(tick: number) {
    if (tick >= this.changeAt) this.pick(tick);
    const t = (tick - this.turnStart) / TURN;
    if (t >= 1) {
      this.baseX = this.toX;
      this.baseZ = this.toZ;
    } else {
      const u = t * t * (3 - 2 * t);
      this.baseX = this.fromX + (this.toX - this.fromX) * u;
      this.baseZ = this.fromZ + (this.toZ - this.fromZ) * u;
    }
    // Gusts: ease from the last gust to the next over its length, then pick another.
    const g = this.gust;
    if (tick >= g.start + g.len) {
      const q = (tick - g.start) / g.len;
      const k = q >= 1 ? 1 : q * q * (3 - 2 * q);
      g.fromS = g.fromS + (g.toS - g.fromS) * k;
      g.fromV = g.fromV + (g.toV - g.fromV) * k;
      g.toS = 1 + this.gustRng.range(-GUST_STRENGTH, GUST_STRENGTH);
      g.toV = this.gustRng.range(-GUST_VEER, GUST_VEER);
      g.start = tick;
      g.len = 2 * 60 + Math.floor(this.gustRng.next() * 3 * 60);
    }
    const q = (tick - g.start) / g.len;
    const k = q * q * (3 - 2 * q);
    const s = g.fromS + (g.toS - g.fromS) * k;
    const v = g.fromV + (g.toV - g.fromV) * k;
    const c = dcos(v), sn = dsin(v);
    this.x = (this.baseX * c - this.baseZ * sn) * s;
    this.z = (this.baseX * sn + this.baseZ * c) * s;
  }

  /**
   * Where the wind is heading: the wind at the end of the gust easing in now
   * (the base wind as it will be then, turned and scaled by the gust's
   * target), and the ticks until then. A pure read for the page (the land
   * shows a gust before it reaches the gun); it draws nothing from the Rng
   * streams, changes no state and is not in the hash.
   */
  lead(tick: number): { x: number; z: number; ticks: number } {
    const g = this.gust;
    const end = g.start + g.len;
    const t = (end - this.turnStart) / TURN;
    let bx = this.toX, bz = this.toZ;
    if (t < 1) {
      const u = t * t * (3 - 2 * t);
      bx = this.fromX + (this.toX - this.fromX) * u;
      bz = this.fromZ + (this.toZ - this.fromZ) * u;
    }
    const c = dcos(g.toV), sn = dsin(g.toV);
    return { x: (bx * c - bz * sn) * g.toS, z: (bx * sn + bz * c) * g.toS, ticks: Math.max(0, end - tick) };
  }

  /** Ticks until the next change starts. */
  nextChangeIn(tick: number): number {
    return this.changeAt - tick;
  }
}
