// The logic of the trails behind shots in flight (look round L1.4), with no
// three import so Node tests can run it: which shots keep a trail, the points
// each one remembers, how they age and fade, and the ribbon segments they make.
// trails.ts draws them.
//
// Times are the renderer's clock (never wall time). A keyframe (S3) holds each
// live trail's points as ages relative to `now`, and puts them back at any
// later clock, so a replay draws the same picture twice.

/** Shots that keep a trail at once, and the points one trail remembers. */
export const MAX_SHOTS = 64;
export const MAX_POINTS = 24;
/** Ribbon segments: one fewer than the points, plus the segment up to the live head. */
export const MAX_SEGMENTS = MAX_SHOTS * MAX_POINTS;

/** Round shot and chain-shot balls: a streak for the first half second of flight, fading over its last 0.15 s. */
export const BALL_LIFE = 0.5;
export const BALL_FADE = 0.15;
/** The streak is the last 0.06 s of the ball's path. */
export const BALL_PATH = 0.06;
export const BALL_ALPHA = 0.34;
/** Shells: a thread of smoke along the last 1.5 s of the path, thinning and fading with age. */
export const SHELL_PATH = 1.5;
export const SHELL_ALPHA = 0.5;
/** A shell's thread comes in over its first 0.15 s so it does not start with a line at the muzzle. */
export const SHELL_FADE_IN = 0.15;
/** How much of the wind's speed carries a shell's thread, and how fast it climbs (m/s). */
export const SHELL_DRIFT = 0.25;
export const SHELL_RISE = 0.15;

/** Min time between two remembered points of one shot (s). */
export const BALL_SPACING = 0.004;
export const SHELL_SPACING = SHELL_PATH / (MAX_POINTS - 1) + 0.0001;

export const TRAIL_BALL = 0;
export const TRAIL_SHELL = 1;

/** The trail kind of a projectile kind (sim's ProjectileKind: 0 ball, 1 shell, 2 chain, 3 grape), or -1 for none. */
export function trailKind(projectileKind: number): number {
  if (projectileKind === 0 || projectileKind === 2) return TRAIL_BALL;
  if (projectileKind === 1) return TRAIL_SHELL;
  return -1;
}

/** Floats a keyframe holds per shot before its points, and per point. */
const HEAD = 8;
const PT = 4;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class TrailSet {
  private ids = new Float64Array(MAX_SHOTS).fill(-1);
  private kinds = new Uint8Array(MAX_SHOTS);
  private born = new Float64Array(MAX_SHOTS);
  private lastT = new Float64Array(MAX_SHOTS);
  private count = new Uint8Array(MAX_SHOTS);
  private start = new Uint8Array(MAX_SHOTS);
  private seen = new Uint8Array(MAX_SHOTS);
  /** Per shot, MAX_POINTS ring slots of x, y, z, t. */
  private pts = new Float64Array(MAX_SHOTS * MAX_POINTS * PT);
  private head = new Float64Array(MAX_SHOTS * 3);

  /** Shots with a trail now. */
  get live(): number {
    let n = 0;
    for (let i = 0; i < MAX_SHOTS; i++) if (this.ids[i] >= 0) n++;
    return n;
  }

  /** Whether a shot has a trail. */
  has(id: number): boolean {
    return this.find(id) >= 0;
  }

  /** How many points a shot has remembered (-1: no trail). */
  points(id: number): number {
    const s = this.find(id);
    return s < 0 ? -1 : this.count[s];
  }

  private find(id: number): number {
    for (let i = 0; i < MAX_SHOTS; i++) if (this.ids[i] === id) return i;
    return -1;
  }

  clear() {
    this.ids.fill(-1);
    this.count.fill(0);
    this.start.fill(0);
    this.seen.fill(0);
  }

  /** Start a frame's feed: every shot is unseen until `add` names it. */
  begin() {
    this.seen.fill(0);
  }

  /** One projectile of this frame (its position as drawn, at renderer clock `now`). Kinds without a trail are ignored. */
  add(id: number, projectileKind: number, x: number, y: number, z: number, now: number) {
    const kind = trailKind(projectileKind);
    if (kind < 0) return;
    let s = this.find(id);
    if (s < 0) {
      for (let i = 0; i < MAX_SHOTS; i++) {
        if (this.ids[i] < 0) {
          s = i;
          break;
        }
      }
      if (s < 0) return;
      this.ids[s] = id;
      this.kinds[s] = kind;
      this.born[s] = now;
      this.lastT[s] = -1e9;
      this.count[s] = 0;
      this.start[s] = 0;
    }
    this.seen[s] = 1;
    this.head[s * 3] = x;
    this.head[s * 3 + 1] = y;
    this.head[s * 3 + 2] = z;
    // The clock went back (a replay was set earlier): forget what lies in the future.
    if (now < this.lastT[s] - 1e-9) {
      this.count[s] = 0;
      this.start[s] = 0;
      this.lastT[s] = -1e9;
      if (now < this.born[s]) this.born[s] = now;
    }
    const spacing = kind === TRAIL_BALL ? BALL_SPACING : SHELL_SPACING;
    if (kind === TRAIL_BALL && now - this.born[s] >= BALL_LIFE) return;
    if (now - this.lastT[s] < spacing) return;
    const n = this.count[s];
    const slot = n < MAX_POINTS ? (this.start[s] + n) % MAX_POINTS : this.start[s];
    if (n < MAX_POINTS) this.count[s] = n + 1;
    else this.start[s] = (this.start[s] + 1) % MAX_POINTS;
    const o = (s * MAX_POINTS + slot) * PT;
    this.pts[o] = x;
    this.pts[o + 1] = y;
    this.pts[o + 2] = z;
    this.pts[o + 3] = now;
    this.lastT[s] = now;
  }

  /** End a frame's feed: a shot that was not named has landed or gone, and its trail goes with it. */
  end() {
    for (let i = 0; i < MAX_SHOTS; i++) {
      if (this.ids[i] >= 0 && !this.seen[i]) {
        this.ids[i] = -1;
        this.count[i] = 0;
        this.start[i] = 0;
      }
    }
  }

  /**
   * The ribbon segments to draw at clock `now`, into three arrays of 4 floats a segment:
   * A = older end (x, y, z, width share 0..1), B = newer end (same), C = (alpha at A, alpha at B, kind, 0).
   * Returns the segment count. Allocation free.
   */
  fill(now: number, windX: number, windZ: number, A: Float32Array, B: Float32Array, C: Float32Array): number {
    let ns = 0;
    for (let s = 0; s < MAX_SHOTS && ns < MAX_SEGMENTS; s++) {
      if (this.ids[s] < 0) continue;
      const kind = this.kinds[s];
      const shotAge = now - this.born[s];
      let window: number, peak: number;
      if (kind === TRAIL_BALL) {
        if (shotAge >= BALL_LIFE) continue;
        window = BALL_PATH;
        peak = BALL_ALPHA * clamp01((BALL_LIFE - shotAge) / BALL_FADE);
      } else {
        window = SHELL_PATH;
        peak = SHELL_ALPHA * clamp01(shotAge / SHELL_FADE_IN);
      }
      if (peak <= 0) continue;
      const n = this.count[s];
      // Walk the remembered points oldest to newest, then the live head as the last point.
      let px = 0, py = 0, pz = 0, pa = 0;
      for (let k = 0; k <= n && ns < MAX_SEGMENTS; k++) {
        let x: number, y: number, z: number, age: number;
        if (k < n) {
          const o = (s * MAX_POINTS + ((this.start[s] + k) % MAX_POINTS)) * PT;
          x = this.pts[o];
          y = this.pts[o + 1];
          z = this.pts[o + 2];
          age = now - this.pts[o + 3];
        } else {
          x = this.head[s * 3];
          y = this.head[s * 3 + 1];
          z = this.head[s * 3 + 2];
          age = 0;
        }
        if (age < 0) age = 0;
        if (k > 0 && age < window) {
          // The segment from the previous point to this one; cut the old end where the path's window begins.
          let ax = px, ay = py, az = pz, aa = pa;
          if (aa > window) {
            const f = (aa - window) / (aa - age);
            ax += (x - ax) * f;
            ay += (y - ay) * f;
            az += (z - az) * f;
            aa = window;
          }
          const len = Math.abs(x - ax) + Math.abs(y - ay) + Math.abs(z - az);
          if (len > 1e-4) {
            const u0 = aa / window, u1 = age / window;
            let dx0 = 0, dy0 = 0, dz0 = 0, dx1 = 0, dy1 = 0, dz1 = 0;
            if (kind === TRAIL_SHELL) {
              dx0 = windX * SHELL_DRIFT * aa;
              dz0 = windZ * SHELL_DRIFT * aa;
              dy0 = SHELL_RISE * aa;
              dx1 = windX * SHELL_DRIFT * age;
              dz1 = windZ * SHELL_DRIFT * age;
              dy1 = SHELL_RISE * age;
            }
            const o = ns * 4;
            A[o] = ax + dx0;
            A[o + 1] = ay + dy0;
            A[o + 2] = az + dz0;
            B[o] = x + dx1;
            B[o + 1] = y + dy1;
            B[o + 2] = z + dz1;
            if (kind === TRAIL_BALL) {
              // Tapering to nothing at the tail.
              A[o + 3] = 1 - u0;
              B[o + 3] = 1 - u1;
            } else {
              // Thinning with age, but never to nothing before it has faded.
              A[o + 3] = 0.35 + 0.65 * (1 - u0);
              B[o + 3] = 0.35 + 0.65 * (1 - u1);
            }
            C[o] = peak * (1 - u0);
            C[o + 1] = peak * (1 - u1);
            C[o + 2] = kind;
            C[o + 3] = 0;
            ns++;
          }
        }
        px = x;
        py = y;
        pz = z;
        pa = age;
      }
    }
    return ns;
  }

  /**
   * Keyframe state: [shots, then per shot id, kind, age of its birth, age of its last point, points, head x y z,
   * then each point as x, y, z, age]. Ages are relative to `now` (rounded to float32, so a round trip is exact).
   */
  capture(now: number): Float64Array {
    let total = 1;
    let shots = 0;
    for (let s = 0; s < MAX_SHOTS; s++) {
      if (this.ids[s] < 0) continue;
      shots++;
      total += HEAD + this.count[s] * PT;
    }
    const out = new Float64Array(total);
    out[0] = shots;
    let o = 1;
    for (let s = 0; s < MAX_SHOTS; s++) {
      if (this.ids[s] < 0) continue;
      const n = this.count[s];
      out[o] = this.ids[s];
      out[o + 1] = this.kinds[s];
      out[o + 2] = Math.fround(now - this.born[s]);
      out[o + 3] = n > 0 ? Math.fround(now - this.lastT[s]) : -1;
      out[o + 4] = n;
      out[o + 5] = this.head[s * 3];
      out[o + 6] = this.head[s * 3 + 1];
      out[o + 7] = this.head[s * 3 + 2];
      o += HEAD;
      for (let k = 0; k < n; k++) {
        const p = (s * MAX_POINTS + ((this.start[s] + k) % MAX_POINTS)) * PT;
        out[o] = this.pts[p];
        out[o + 1] = this.pts[p + 1];
        out[o + 2] = this.pts[p + 2];
        out[o + 3] = Math.fround(now - this.pts[p + 3]);
        o += PT;
      }
    }
    return out;
  }

  /** Put a keyframe's trails back, their times rebased to `now`. A shot seen again afterwards continues its trail. */
  apply(state: ArrayLike<number>, now: number) {
    this.clear();
    const shots = Math.min(MAX_SHOTS, state[0] | 0);
    let o = 1;
    for (let s = 0; s < shots; s++) {
      this.ids[s] = state[o];
      this.kinds[s] = state[o + 1];
      this.born[s] = now - state[o + 2];
      const n = Math.min(MAX_POINTS, state[o + 4] | 0);
      this.lastT[s] = n > 0 ? now - state[o + 3] : -1e9;
      this.count[s] = n;
      this.start[s] = 0;
      this.head[s * 3] = state[o + 5];
      this.head[s * 3 + 1] = state[o + 6];
      this.head[s * 3 + 2] = state[o + 7];
      o += HEAD;
      for (let k = 0; k < n; k++) {
        const p = (s * MAX_POINTS + k) * PT;
        this.pts[p] = state[o];
        this.pts[p + 1] = state[o + 1];
        this.pts[p + 2] = state[o + 2];
        this.pts[p + 3] = now - state[o + 3];
        o += PT;
      }
    }
  }
}
