// Frame pacing: dynamic resolution first, the quality tier last (render only).
//
// A heavy moment (a mortar burst seen close up: smoke and dust over much of the
// screen) draws the scene at a slightly lower resolution for a few seconds
// instead of dropping the quality tier: shadows, ambient occlusion, bloom and
// anti-aliasing all stay, and in the middle of a burst the softer picture is
// hard to see. The scale steps down within a fraction of a second when frames
// run long and climbs back once they are quick again. The tier itself only
// drops for slowness that outlasts the lowest resolution in calm play, and
// never when the player picked it.

/** Shares of the full resolution, from best to cheapest. */
export const SCALES = [1, 0.85, 0.72, 0.6] as const;

export interface PaceResult {
  /** The resolution step changed: apply SCALES[scaleIdx]. */
  scaleChanged: boolean;
  /** Drop one quality tier now (and the scale went back to full). */
  dropTier: boolean;
}

export class Pacer {
  scaleIdx = 0;
  /** Smoothed frame time, ms. */
  frameMs = 0;
  /** The player picked the tier: never drop it. */
  tierChosen = false;
  private lastChange = -1e9;
  private quickSince = 0;
  private burstAt = -1e9;
  private guardFrames = 0;
  private slowFrames = 0;

  /** A burst happened now: the tier guard leaves the next seconds alone. */
  burst(now: number) {
    this.burstAt = now;
  }

  /** Back to full resolution (a new tier, a reset). */
  reset(now = 0) {
    this.scaleIdx = 0;
    this.lastChange = now;
    this.guardFrames = this.slowFrames = 0;
  }

  /**
   * One frame: `dtMs` since the last, `gpuMs` the GPU's own time where the
   * browser measures it (not hidden by the screen's refresh), `now` in ms.
   */
  frame(dtMs: number, gpuMs: number | null, now: number): PaceResult {
    const out: PaceResult = { scaleChanged: false, dropTier: false };
    this.frameMs = this.frameMs ? this.frameMs * 0.85 + dtMs * 0.15 : dtMs;
    const slow = this.frameMs > 19 || (gpuMs !== null && gpuMs > 15);
    const quick = this.frameMs < 17.8 && (gpuMs === null || gpuMs < 10.5);
    if (slow) {
      this.quickSince = now;
      if (this.scaleIdx < SCALES.length - 1 && now - this.lastChange > 250) {
        this.scaleIdx++;
        this.lastChange = now;
        out.scaleChanged = true;
      }
    } else if (quick) {
      if (this.scaleIdx > 0 && now - this.quickSince > 2000 && now - this.lastChange > 1000) {
        this.scaleIdx--;
        this.lastChange = now;
        this.quickSince = now;
        out.scaleChanged = true;
      }
    } else this.quickSince = now;

    // The tier guard: five seconds of slow frames at the lowest resolution, in calm play, for a tier the quick test picked.
    if (this.tierChosen || now - this.burstAt < 6000 || this.scaleIdx < SCALES.length - 1) {
      this.guardFrames = this.slowFrames = 0;
      return out;
    }
    this.guardFrames++;
    if (dtMs > 1000 / 45) this.slowFrames++;
    if (this.guardFrames >= 300) {
      const share = this.slowFrames / this.guardFrames;
      this.guardFrames = this.slowFrames = 0;
      if (share > 0.5) {
        out.dropTier = true;
        this.reset(now);
        out.scaleChanged = true;
      }
    }
    return out;
  }
}
