// Crows (look round L3.4), the logic without three: flocks rest on the valley
// sides, rise at gunfire or a burst within REACT metres, wheel above the
// valley for 20 to 40 s and settle again somewhere else. Purely cosmetic:
// birds use their own seeded generator and never touch the match. The wind
// (the game's, passed in) carries a flock's circle a little downwind.

import { MID_Z, valleyHeight } from "@keepfall/content";
import { Rng } from "@keepfall/core";

/** A flock rises for a shot or a burst this near (m). */
export const REACT = 120;
/** Seconds a flock stays up, from the first bird leaving to the last one down. */
export const UP_MIN = 20;
export const UP_MAX = 40;
/** The last seconds of that, spent gliding down to the new perch. */
export const SETTLE = 6;
/** Birds leave over this many seconds, not all at once. */
const SCATTER = 1.6;

export type Site = [number, number, number];

export type FlockState = "perched" | "up";

interface Bird {
  /** Offset from the perch (m). */
  ox: number;
  oy: number;
  oz: number;
  /** Seconds after the flock's rise that this bird leaves, and how long it takes to climb to the circle. */
  delay: number;
  climb: number;
  /** Place on the circle (radians), radius and height factors, bob phase. */
  a0: number;
  rk: number;
  hk: number;
  bob: number;
  /** Flapping rate (rad/s) and phase. */
  rate: number;
  phase: number;
  /** Pose now: position and the direction it faces (unit, horizontal), and whether it is shown. */
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  shown: boolean;
}

function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export class Flock {
  readonly birds: Bird[] = [];
  state: FlockState = "perched";
  /** Where it rests now (index into sites). */
  site = 0;
  /** When it rose and how long it stays up (s). */
  t0 = 0;
  upFor = 0;
  /** The circle it wheels on: centre (x, z), base height above the ground, radius, and turning rate (rad/s, signed). */
  private cx = 0;
  private cz = 0;
  private base = 30;
  private radius = 32;
  private omega = 0.3;
  private next = 0;
  /** How far the wind has carried the circle (m). */
  private dx = 0;
  private dz = 0;
  private rng: Rng;
  readonly sites: Site[];

  constructor(sites: Site[], count: number, seed: number) {
    this.sites = sites;
    this.rng = new Rng(seed);
    const r = this.rng;
    for (let i = 0; i < count; i++) {
      this.birds.push({
        ox: (r.next() - 0.5) * 7,
        oy: (r.next() - 0.5) * 2.5,
        oz: (r.next() - 0.5) * 7,
        delay: r.next() * SCATTER,
        climb: 3 + r.next() * 3,
        a0: r.next() * Math.PI * 2,
        rk: 0.7 + r.next() * 0.6,
        hk: 0.8 + r.next() * 0.45,
        bob: r.next() * 6.28,
        rate: 11 + r.next() * 5,
        phase: r.next() * 6.28,
        x: 0,
        y: 0,
        z: 0,
        fx: 1,
        fz: 0,
        shown: false,
      });
    }
    this.site = Math.floor(r.next() * sites.length) % sites.length;
    this.pose(0, 0);
  }

  /** The flock's resting place now. */
  get here(): Site {
    return this.sites[this.site];
  }

  /** A shot or a burst at (x, y, z) at game time `now`: a perched flock within REACT of it rises. Returns whether it did. */
  noise(x: number, y: number, z: number, now: number): boolean {
    if (this.state !== "perched") return false;
    const s = this.here;
    if (Math.hypot(s[0] - x, s[1] - y, s[2] - z) > REACT) return false;
    const r = this.rng;
    this.state = "up";
    this.t0 = now;
    this.upFor = UP_MIN + r.next() * (UP_MAX - UP_MIN);
    // Settle elsewhere: any other site, not the one it left.
    let n = this.site;
    if (this.sites.length > 1) n = (this.site + 1 + Math.floor(r.next() * (this.sites.length - 1))) % this.sites.length;
    this.next = n;
    // Wheel round the valley's air above the perch: a circle that passes over it and the shot's side.
    this.cx = s[0] + (r.next() - 0.5) * 30;
    this.cz = s[2] + (r.next() - 0.5) * 30;
    this.radius = 24 + r.next() * 22;
    this.base = 26 + r.next() * 22;
    this.omega = (r.next() < 0.5 ? -1 : 1) * (0.2 + r.next() * 0.16);
    this.dx = 0;
    this.dz = 0;
    for (const b of this.birds) {
      b.delay = r.next() * SCATTER;
      b.a0 = r.next() * Math.PI * 2;
    }
    return true;
  }

  /** Advance to game time `now` (dt since the last call); `wind` is the wind (m/s) over the flock. */
  step(now: number, dt: number, windX: number, windZ: number) {
    if (this.state === "perched") return;
    // The wind carries the circle downwind, and a little pull keeps it near home.
    const k = Math.min(1, 0.25 * dt);
    this.dx += windX * 0.5 * dt - this.dx * k;
    this.dz += windZ * 0.5 * dt - this.dz * k;
    const t = now - this.t0;
    if (t >= this.upFor) {
      this.state = "perched";
      this.site = this.next;
      this.pose(0, 0);
      return;
    }
    this.pose(t, dt);
  }

  private orbit(b: Bird, t: number, out: Site) {
    const a = b.a0 + this.omega * t;
    const x = this.cx + this.dx + Math.cos(a) * this.radius * b.rk;
    const z = this.cz + this.dz + Math.sin(a) * this.radius * b.rk;
    out[0] = x;
    out[2] = z;
    out[1] = valleyHeight(x, z) + this.base * b.hk + Math.sin(t * 0.7 + b.bob) * 2.2;
  }

  private tmp: Site = [0, 0, 0];
  private perch(b: Bird, s: Site, out: Site) {
    out[0] = s[0] + b.ox;
    out[2] = s[2] + b.oz;
    // The site's height above the ground, kept over the ground under this bird.
    out[1] = valleyHeight(out[0], out[2]) + (s[1] - valleyHeight(s[0], s[2])) + b.oy;
  }

  /** Where each bird is at `t` seconds after the rise (0 and perched: at rest and hidden). */
  private pose(t: number, dt: number) {
    const perched = this.state === "perched";
    const from = this.here, to = this.sites[this.next];
    const o = this.tmp;
    const p: Site = [0, 0, 0];
    for (const b of this.birds) {
      const px = b.x, pz = b.z;
      if (perched) {
        this.perch(b, from, p);
        b.shown = false;
      } else {
        const tb = t - b.delay;
        if (tb < 0) {
          this.perch(b, from, p);
          b.shown = true;
        } else {
          this.orbit(b, t, o);
          const down = ease((t - (this.upFor - SETTLE)) / SETTLE);
          this.perch(b, from, p);
          // Climb from the perch to the circle, then wheel, then glide down to the new perch.
          const up = ease(tb / b.climb);
          p[0] += (o[0] - p[0]) * up;
          p[1] += (o[1] - p[1]) * up;
          p[2] += (o[2] - p[2]) * up;
          if (down > 0) {
            const q: Site = [0, 0, 0];
            this.perch(b, to, q);
            p[0] += (q[0] - p[0]) * down;
            p[1] += (q[1] - p[1]) * down;
            p[2] += (q[2] - p[2]) * down;
          }
          b.shown = true;
          // Never through the hillside on the way up or down.
          p[1] = Math.max(p[1], valleyHeight(p[0], p[2]) + 2.5);
        }
      }
      b.x = p[0];
      b.y = p[1];
      b.z = p[2];
      if (dt > 0) {
        const vx = b.x - px, vz = b.z - pz;
        const l = Math.hypot(vx, vz);
        if (l > 1e-4) {
          b.fx = vx / l;
          b.fz = vz / l;
        }
      }
    }
  }
}

/** Seeded picks on the valley sides, near where the forests stand (the floor's edge is ~64 m out, the trees start there). */
function sidePicks(rng: Rng, sign: number, z0: number, z1: number, n: number): Site[] {
  const out: Site[] = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 60) {
    const x = sign * (74 + rng.next() * 70);
    const z = z0 + rng.next() * (z1 - z0);
    const y = valleyHeight(x, z);
    // Up a tree or on a crag: a few metres above the ground; keep to gentle ground (trees stand there).
    const sl = Math.hypot(valleyHeight(x + 1, z) - valleyHeight(x - 1, z), valleyHeight(x, z + 1) - valleyHeight(x, z - 1)) / 2;
    if (sl > 0.9) continue;
    out.push([x, y + 4 + rng.next() * 5, z]);
  }
  return out;
}

/** The valley's crows: 3 flocks of 8 to 15 on its sides. */
export function makeFlocks(seed = 6502): Flock[] {
  const r = new Rng(seed).fork("crows");
  const flocks: Flock[] = [];
  // Left side and right side, and one over the far end of the right side; each has places along its stretch to hop between.
  const plan: Array<[number, number, number]> = [
    [-1, MID_Z - 100, MID_Z + 10],
    [1, MID_Z - 20, MID_Z + 100],
    [-1, MID_Z + 10, MID_Z + 110],
  ];
  for (const [sign, z0, z1] of plan) {
    const sites = sidePicks(r, sign, z0, z1, 5);
    flocks.push(new Flock(sites, 8 + Math.floor(r.next() * 8), Math.floor(r.next() * 1e9)));
  }
  return flocks;
}
