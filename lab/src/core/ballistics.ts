// Shot maths shared by the page (aim preview) and the physics (launch).
// Deterministic arithmetic only.

export const G = 9.81;

/** Launch velocity that reaches the target in `time` seconds under gravity alone. */
export function aim(x: number, y: number, z: number, tx: number, ty: number, tz: number, time: number): [number, number, number] {
  return [(tx - x) / time, (ty - y + 0.5 * G * time * time) / time, (tz - z) / time];
}

/** Points along the flight from t0 to t1 seconds, as xyz triples. */
export function arc(x: number, y: number, z: number, vx: number, vy: number, vz: number, t0: number, t1: number, n: number): Float32Array {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / (n - 1);
    out[i * 3] = x + vx * t;
    out[i * 3 + 1] = y + vy * t - 0.5 * G * t * t;
    out[i * 3 + 2] = z + vz * t;
  }
  return out;
}

/** The scripted barrage every device replays: step to fire at, target point, flight time. */
export const SIEGE_SHOTS: Array<{ step: number; target: [number, number, number]; time: number }> = [
  { step: 0, target: [-6, 3, -15.2], time: 2.4 },
  { step: 45, target: [6, 3.5, -15.2], time: 2.4 },
  { step: 90, target: [-1, 6, -15.2], time: 2.3 },
  { step: 135, target: [-13.5, 4, -18.2], time: 2.5 },
  { step: 180, target: [13.5, 5, -18.2], time: 2.5 },
  { step: 240, target: [0, 12, -1.2], time: 2.6 },
  { step: 285, target: [-2.5, 9, -1.2], time: 2.6 },
  { step: 330, target: [2.5, 8, -1.2], time: 2.6 },
  { step: 375, target: [0, 15, -1.2], time: 2.7 },
  { step: 420, target: [-3, 4, -15.2], time: 2.3 },
  { step: 465, target: [3, 2, -15.2], time: 2.3 },
  { step: 510, target: [0, 10, -1.2], time: 2.6 },
];
export const SIEGE_STEPS = 900;
