// Wind over the valley: a new target every 30 to 60 seconds, reached by a
// smooth 4 second turn. Deterministic: driven by its own Rng stream and the tick.

import { dcos, dsin, Rng } from "@keepfall/core";

const TURN = 4 * 60;

export class Wind {
  x = 0;
  z = 0;
  private fromX = 0;
  private fromZ = 0;
  private toX = 0;
  private toZ = 0;
  private changeAt = 0;
  private turnStart = 0;
  private rng: Rng;

  constructor(rng: Rng, private maxSpeed = 11) {
    this.rng = rng;
    this.pick(0);
    this.x = this.toX;
    this.z = this.toZ;
  }

  private pick(tick: number) {
    this.fromX = this.x;
    this.fromZ = this.z;
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
      this.x = this.toX;
      this.z = this.toZ;
    } else {
      const u = t * t * (3 - 2 * t);
      this.x = this.fromX + (this.toX - this.fromX) * u;
      this.z = this.fromZ + (this.toZ - this.fromZ) * u;
    }
  }

  /** Ticks until the next change starts. */
  nextChangeIn(tick: number): number {
    return this.changeAt - tick;
  }
}
