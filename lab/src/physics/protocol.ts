// Messages between the page and the physics worker.

import type { RubbleResult, SiegeResult } from "./bench";

export type ToWorker =
  | { t: "init" }
  | { t: "fire"; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  | { t: "reset" }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "bench" };

export type FromWorker =
  | { t: "ready"; stones: number; setupMs: number }
  | {
      t: "frame";
      /** [id, x, y, z, qx, qy, qz, qw] per moving piece */
      bodies: Float32Array;
      count: number;
      /** [x, y, z, radius] per ball */
      balls: Float32Array;
      ballCount: number;
      /** [x, y, z, strength] per impact this frame */
      impacts: Float32Array;
      stepMs: number;
      loose: number;
      awake: number;
    }
  | { t: "toppled"; castle: number }
  | { t: "progress"; label: string; fraction: number }
  | {
      t: "bench";
      siegeDet: SiegeResult;
      rubbleDet: RubbleResult;
      siegeSimd: SiegeResult | null;
      rubbleSimd: RubbleResult | null;
    }
  | { t: "error"; message: string };
