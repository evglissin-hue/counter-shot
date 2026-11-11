// The logic of the dust that stays (look round L2.5), with no three import so
// Node tests can run it: when a great collapse counts, where it is, and the
// live hazes (their age, drift and fade). haze.ts draws them.
//
// This file is the only owner of the haze state (the tracker's recent Fell
// events and the live hazes); track S3's replay keyframes read and write it
// through capture() and apply() and nowhere else.

/** Pieces of one castle section that must come loose inside the window for a haze to start. */
export const COLLAPSE_PIECES = 25;
/** The sliding window the pieces are summed over (ticks at 60 Hz: 1.5 s). */
export const COLLAPSE_WINDOW_TICKS = 90;
/** The most hazes at once; a new one drops the oldest. */
export const MAX_HAZES = 3;
/** A haze lives 30 to 60 s, fades in over 3 s and out over its last 10 s. */
export const HAZE_LIFE: [number, number] = [30, 60];
export const HAZE_FADE_IN = 3;
export const HAZE_FADE_OUT = 10;
/** How much of the wind's speed carries a haze (it hangs low and heavy). */
export const HAZE_DRIFT = 0.15;
/** A haze this near a younger one (in radii) is the same collapse: no second one starts. */
const SAME_PLACE = 0.7;
const SAME_AGE = 20;

/** Sums Fell events per castle and section over a sliding window; says when a section's total reaches the threshold. */
export class CollapseTracker {
  private groups = new Map<number, number[]>();

  /** One Fell event (castle, section, piece count) at a tick. Returns the pieces summed when it just reached the threshold (and starts the sum afresh), else 0. */
  add(tick: number, castle: number, section: number, count: number, threshold = COLLAPSE_PIECES, windowTicks = COLLAPSE_WINDOW_TICKS): number {
    const key = castle * 1000 + (section + 1);
    let g = this.groups.get(key);
    if (!g) {
      g = [];
      this.groups.set(key, g);
    }
    // A tick that went backwards (a restart, a replay seek): forget what was counted.
    if (g.length && tick < g[g.length - 2]) g.length = 0;
    let keep = 0;
    while (keep < g.length && tick - g[keep] >= windowTicks) keep += 2;
    if (keep) g.splice(0, keep);
    g.push(tick, count);
    let sum = 0;
    for (let k = 1; k < g.length; k += 2) sum += g[k];
    if (sum >= threshold) {
      this.groups.delete(key);
      return sum;
    }
    return 0;
  }

  clear() {
    this.groups.clear();
  }

  /** Flat [key, tick, count, key, tick, count, ...]. */
  capture(): number[] {
    const out: number[] = [];
    for (const [key, g] of this.groups) for (let k = 0; k < g.length; k += 2) out.push(key, g[k], g[k + 1]);
    return out;
  }

  apply(flat: ArrayLike<number>) {
    this.groups.clear();
    for (let k = 0; k + 2 < flat.length; k += 3) {
      let g = this.groups.get(flat[k]);
      if (!g) {
        g = [];
        this.groups.set(flat[k], g);
      }
      g.push(flat[k + 1], flat[k + 2]);
    }
  }
}

export interface Rubble {
  x: number;
  y: number;
  z: number;
  /** Root mean square distance of the pieces from the centre in x and z (m). */
  spread: number;
  n: number;
}

/**
 * Where a collapse is: the centroid and spread of the stones that moved this
 * frame (data: 8 floats each) of the section, or failing that of the
 * section's own stones in the layout (`home`).
 */
export function locateRubble(
  data: Float32Array,
  count: number,
  inSection: (id: number) => boolean,
  home: Array<{ id: number; x: number; y: number; z: number }>,
): Rubble | null {
  let n = 0, sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 8;
    if (data[o + 2] < -100 || !inSection(data[o] | 0)) continue;
    n++;
    sx += data[o + 1];
    sy += data[o + 2];
    sz += data[o + 3];
  }
  if (n >= 3) {
    const cx = sx / n, cz = sz / n;
    let q = 0;
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      if (data[o + 2] < -100 || !inSection(data[o] | 0)) continue;
      q += (data[o + 1] - cx) ** 2 + (data[o + 3] - cz) ** 2;
    }
    return { x: cx, y: sy / n, z: cz, spread: Math.sqrt(q / n), n };
  }
  n = 0;
  sx = sy = sz = 0;
  for (const s of home) {
    if (!inSection(s.id)) continue;
    n++;
    sx += s.x;
    sy += s.y;
    sz += s.z;
  }
  if (!n) return null;
  const cx = sx / n, cz = sz / n;
  let q = 0;
  for (const s of home) if (inSection(s.id)) q += (s.x - cx) ** 2 + (s.z - cz) ** 2;
  return { x: cx, y: sy / n, z: cz, spread: Math.sqrt(q / n), n };
}

/** The haze radius for a rubble spread (m). */
export function hazeRadius(spread: number): number {
  return Math.min(30, Math.max(5, spread * 1.6 + 3));
}

export interface HazeState {
  x: number;
  y: number;
  z: number;
  /** Radius at birth (m); it spreads slowly. */
  radius: number;
  born: number;
  life: number;
  /** How far the wind has carried it (m). */
  ox: number;
  oz: number;
}

/** The haze's opacity envelope (0..1) at an age: in over 3 s, out over its last 10 s. */
export function hazeEnvelope(age: number, life: number): number {
  if (age < 0 || age >= life) return 0;
  const a = Math.min(1, age / HAZE_FADE_IN);
  const b = Math.min(1, (life - age) / HAZE_FADE_OUT);
  const s = (t: number) => t * t * (3 - 2 * t);
  return s(a) * s(b);
}

const STRIDE = 8;

export class HazeSet {
  readonly list: HazeState[] = [];
  /** Called once per haze when it starts: where, how wide, and how much dust it lays (0..1). */
  onSettle: ((x: number, y: number, z: number, radius: number, amount: number) => void) | null = null;

  /** Start a haze (the oldest is dropped past MAX_HAZES). Returns null when a younger one already hangs in that place. */
  spawn(now: number, x: number, y: number, z: number, radius: number, life: number, amount = 1): HazeState | null {
    for (const h of this.list) {
      if (now - h.born < SAME_AGE && Math.hypot(h.x + h.ox - x, h.z + h.oz - z) < Math.max(h.radius, radius) * SAME_PLACE) return null;
    }
    const h: HazeState = { x, y, z, radius, born: now, life: Math.min(HAZE_LIFE[1], Math.max(HAZE_LIFE[0], life)), ox: 0, oz: 0 };
    this.list.push(h);
    while (this.list.length > MAX_HAZES) this.list.shift();
    this.onSettle?.(x, y, z, radius, amount);
    return h;
  }

  /** Once a frame: carry the hazes on the wind (sample: the game's wind at a point) and drop the finished. */
  update(now: number, dt: number, sample: (x: number, z: number, out: { x: number; z: number }) => void) {
    const w = { x: 0, z: 0 };
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i];
      if (now - h.born >= h.life) {
        this.list.splice(i, 1);
        continue;
      }
      sample(h.x + h.ox, h.z + h.oz, w);
      h.ox += w.x * HAZE_DRIFT * dt;
      h.oz += w.z * HAZE_DRIFT * dt;
    }
  }

  clear() {
    this.list.length = 0;
  }

  /** [x, y, z, radius, age, life, ox, oz] per haze (age rather than birth, so a replay at another clock lines up). */
  capture(now: number): Float32Array {
    const out = new Float32Array(this.list.length * STRIDE);
    this.list.forEach((h, i) => out.set([h.x, h.y, h.z, h.radius, now - h.born, h.life, h.ox, h.oz], i * STRIDE));
    return out;
  }

  apply(data: ArrayLike<number>, now: number) {
    this.list.length = 0;
    for (let o = 0; o + STRIDE <= data.length; o += STRIDE) {
      this.list.push({ x: data[o], y: data[o + 1], z: data[o + 2], radius: data[o + 3], born: now - data[o + 4], life: data[o + 5], ox: data[o + 6], oz: data[o + 7] });
    }
  }
}
