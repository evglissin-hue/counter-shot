// Per-stone wear (look round L2, "stone that remembers"): the one place per-stone
// looks live. Per stone id four floats [faces, soot, crack, dust], held by the
// three-free WearModel (wearLogic.ts, which has the rules and the tests) and
// pushed to the stones' iWear instance attribute once a frame. Nothing else in
// the renderer keeps per-stone wear: track S3's replay keyframes take
// capture() and give back apply(), and a reset calls clear().
//
// The renderer feeds it: stone moves (through StoneSet.onBody), the Laid,
// Raised, Impact, Explosion and Muzzle events, and the burning kegs.

import type { CastleLayout } from "@keepfall/content";
import { EventKind } from "@keepfall/sim";
import type { StoneSet } from "./stones";
import { WearModel, WEAR_STRIDE } from "./wearLogic";

export class StoneWear {
  readonly model: WearModel;

  constructor(
    layout: CastleLayout,
    private readonly stones: StoneSet,
  ) {
    this.model = new WearModel(layout.stones);
    stones.onBody = (id, x, y, z) => this.model.moved(id, x, y, z);
  }

  /** One sim event of a frame: [kind, x, y, z, v] as the renderer reads them. */
  event(kind: number, x: number, y: number, z: number, v: number) {
    if (kind === EventKind.Impact) this.model.impact(x, y, z, v);
    else if (kind === EventKind.Explosion) this.model.explosion(x, y, z, v);
    else if (kind === EventKind.Laid) this.model.laid(x | 0);
    else if (kind === EventKind.Raised) this.raised(x | 0);
  }

  /** The masons laid stone `id` back (EventKind.Laid). */
  laid(id: number) {
    this.model.laid(id);
  }

  /** A plot building piece rose (EventKind.Raised); id -1 means rubble carried off. */
  raised(id: number) {
    if (id >= 0) this.model.raised(id);
  }

  impact(x: number, y: number, z: number, strength: number) {
    this.model.impact(x, y, z, strength);
  }

  explosion(x: number, y: number, z: number, radius: number) {
    this.model.explosion(x, y, z, radius);
  }

  /** A gun fired from this muzzle point towards this direction. */
  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number) {
    this.model.muzzle(x, y, z, dx, dy, dz);
  }

  /** The frame's burning kegs (KEG_STRIDE 4: x, y, z, ticks left). */
  setKegs(data: ArrayLike<number> | null | undefined, count: number) {
    this.model.setKegs(data ?? null, count);
  }

  /**
   * Crack 0..1 on one stone. Until milestone 3.4 sends its crushing report the
   * cracks come from blows a stone took and held (impact, explosion); that
   * report will call this.
   */
  setCrack(id: number, value: number) {
    this.model.setCrack(id, value);
  }

  /** A pale wash of dust on the stones within radius of a point (the haze module calls this); it halves every 90 s. */
  dustAround(x: number, y: number, z: number, radius: number, amount: number) {
    this.model.dustAround(x, y, z, radius, amount);
  }

  /** Every stone's wear by id (a copy), for replay keyframes. */
  capture(): Float32Array {
    return this.model.capture();
  }

  /** Put a captured state back and flush every stone. */
  apply(state: Float32Array) {
    this.model.apply(state);
    this.push();
  }

  /** A reset: no wear, every stone back in its place. */
  clear() {
    this.model.clear();
    this.push();
  }

  /** Once a frame, before StoneSet.flush(): kegs, the dust's decay, and the touched stones to the GPU buffer. */
  update(now: number, dt: number) {
    this.model.now = now;
    this.model.update(dt);
    this.push();
  }

  private push() {
    const w = this.model.wear;
    this.model.drain((id) => {
      const o = id * WEAR_STRIDE;
      this.stones.setWear(id, w[o], w[o + 1], w[o + 2], w[o + 3]);
    });
  }

  dispose() {
    this.stones.onBody = null;
  }
}
