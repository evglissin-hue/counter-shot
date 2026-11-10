// Scorch, dust and trodden paths on the ground (look rounds L2.3 and L3.4):
// the glue between the three-free GroundMarksData and the terrain's field
// mesh. The marks live in the mesh's `aMarks` attribute (the data array IS the
// attribute's array, so there is no copy); each frame the rows touched are
// uploaded as one update range, as crater patches are.
//
// This file is the only owner of the marks' state (through groundMarksLogic);
// track S3's replay keyframes use capture() and apply() here.

import type { FrameData } from "@keepfall/sim";
import { EVENT_STRIDE, EventKind } from "@keepfall/sim";
import { GroundMarksData } from "./groundMarksLogic";
import type { Terrain } from "./terrain";

/** Kegs are sampled at 4 Hz and the men at 2 Hz (in sim ticks). */
const KEG_TICKS = 15;
const WALK_TICKS = 30;

export class GroundMarks {
  readonly data: GroundMarksData;
  private terrain: Terrain;
  private lastKeg = -1e9;
  private lastWalk = -1e9;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.data = new GroundMarksData(undefined, terrain.marks.array as Float32Array);
  }

  /** Each sim frame: shells that burst near the ground, burning kegs (4 Hz) and the men's feet (2 Hz). */
  frame(frame: FrameData, groundAt: (x: number, z: number) => number) {
    const tick = frame.tick;
    // A tick that went back (restart, replay seek): sample again at once.
    if (tick < this.lastKeg) this.lastKeg = -1e9;
    if (tick < this.lastWalk) this.lastWalk = -1e9;
    const ev = frame.events;
    for (let i = 0; i < frame.eventCount; i++) {
      const o = i * EVENT_STRIDE;
      if (ev[o] === EventKind.Explosion) this.data.explosion(ev[o + 1], ev[o + 2], ev[o + 3], ev[o + 4] || 3, groundAt(ev[o + 1], ev[o + 3]));
    }
    if (frame.kegCount > 0 && tick - this.lastKeg >= KEG_TICKS) {
      this.lastKeg = tick;
      this.data.kegs(frame.kegs, frame.kegCount);
    }
    if (frame.minionCount > 0 && tick - this.lastWalk >= WALK_TICKS) {
      this.lastWalk = tick;
      this.data.walkers(frame.minions, frame.minionCount, groundAt);
    }
  }

  /** A pale wash on the ground round a collapse. */
  dust(x: number, z: number, radius: number, amount: number) {
    this.data.dust(x, z, radius, amount);
  }

  /** Once per rendered frame: the dust fades, and what changed goes to the GPU. */
  update(dt: number) {
    this.data.update(dt);
    const rows = this.data.takeDirty();
    if (rows) this.terrain.flushMarks(rows[0], rows[1]);
  }

  clear() {
    this.data.clear();
    this.lastKeg = this.lastWalk = -1e9;
  }

  capture(): Float32Array {
    return this.data.capture();
  }

  apply(saved: ArrayLike<number>) {
    this.data.apply(saved);
  }
}
