// The director (track S, step S4.3): a pure module that decides how a recorded
// moment is filmed. It takes a clip (frames of moving masonry, shots and
// events), a `Sight` (what the world around the clip's keyframe looks like) and
// returns a `Take`: which ticks are shown, at what speed, and where the camera
// stands at each tick. No renderer, no DOM, no clock, no randomness: the same
// clip and the same sight answers give the same take.

import { EVENT_STRIDE, EventKind, PROJECTILE_STRIDE, STONE_STRIDE } from "@keepfall/sim";
import type { MomentKind } from "./moments";

export interface DirectorMoment {
  kind: MomentKind;
  tick: number;
  /** The tick the moment began, when known. */
  first?: number;
  x: number;
  y: number;
  z: number;
  shot?: number;
  team: number;
}

export interface DirectorFrame {
  tick: number;
  stones: Float32Array;
  stoneCount: number;
  projectiles: Float32Array;
  projectileCount: number;
  events: Float32Array;
  eventCount: number;
}

export interface DirectorClip {
  moment: DirectorMoment;
  from: number;
  to: number;
  frames: readonly DirectorFrame[];
}

/** What the director may ask of the world as it stands when the clip's keyframe has been applied. */
export interface Sight {
  blocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  ground(x: number, z: number): number;
}

export interface CamPose {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  fov: number;
}

export interface Take {
  /** "topple", "beside", "wide-close", "wide" or "orbit". */
  recipe: string;
  /** The clip ticks shown: start >= clip.from, end <= clip.to. */
  start: number;
  end: number;
  /** Seconds of play from start to end at speedAt. */
  seconds: number;
  /** Game ticks per real tick: 1 real speed, 0.25 a quarter. */
  speedAt(tick: number): number;
  /** Continuous in tick, eased. */
  poseAt(tick: number): CamPose;
  /** The inverse of play time, for a player and a film cut. */
  tickAt(seconds: number): number;
}

/** Every number the recipes use, in one place. Metres, ticks (60 a second), metres per second. */
export const DIRECTOR = {
  tps: 60,
  fov: { topple: 50, wide: 50, beside: 40, other: 45 },
  /** Fewest moving stones that count as masonry coming down. */
  movingMin: 6,
  topple: {
    distance: 60,
    /** Eye height above the ground at the eye. */
    height: 5,
    slow: 0.25,
    /** Longest fall counted, in ticks after the release. */
    capTicks: 180,
    /** Mean drop speed (m/s) that says the fall is under way, and the one that says it has landed. */
    fastDrop: 3,
    stopDrop: 1.5,
    /** Frames averaged for the drop speed. */
    window: 5,
    /** Horizontal travel (m) below which the fall has no clear direction. */
    minTravel: 2,
    /** The stones start inside the standing tower, so its sight line stops this short (a tower's half depth). */
    sightStop: 12,
    targetSmooth: 0.15,
  },
  beside: {
    side: 8,
    up: 2,
    /** The look point leads the ball by this much. */
    ahead: 6,
    slow: 0.2,
    slowBeforeTicks: 60,
    slowAfterTicks: 90,
    /** After the ball is gone the target eases to the moment's place over this many ticks. */
    easeTicks: 90,
    /** The eye keeps drifting and slows with this time constant (ticks), its speed capped (m/s). */
    stopTau: 30,
    stopSpeed: 30,
    targetSmooth: 0.2,
  },
  wideClose: { wide: 80, wideUp: 25, close: 25, closeUp: 6, easeTicks: 90, targetSmooth: 0.15 },
  wide: { from: 90, fromUp: 30, to: 60, toUp: 20 },
  orbit: { distance: 40, up: 12, turn: Math.PI / 2 },
  /** Candidate bearings every this many radians from the preferred one, alternating sides. */
  bearingStep: Math.PI / 6,
  /** The eye path and sight lines are sampled this often (ticks). */
  sampleTicks: 15,
  /** The eye stays this far above the ground. */
  eyeClear: 1.5,
  /** The sight line stops this short of its target (a target at a wall's face sits inside it). */
  sightStop: 3,
  /** When no bearing is clear the best one is raised by this much. */
  raise: 10,
} as const;

const TOPPLE_KINDS: readonly MomentKind[] = [
  "keepFelled",
  "towerFelled",
  "towerDown",
  "breachOpened",
  "buildingWrecked",
  "magazine",
  "gateDown",
  "floorCaved",
  "bannerDown",
  "collapseKill",
  "bridgeDown",
  "lastBlow",
];
const KEG_KINDS: readonly MomentKind[] = ["kegChain", "kegBack"];
const STORM_KINDS: readonly MomentKind[] = ["stormBegun", "stormBeaten"];
const SHOT_KINDS: readonly MomentKind[] = ["multiKill", "ricochetKill", "thrown", "gunSilenced"];

type V3 = [number, number, number];

/** A recipe's plan: where to look, how to run the clock, and how to place the eye for a given bearing. */
interface Plan {
  recipe: string;
  fov: number;
  speed: (tick: number) => number;
  /** The span of the moment that budget trimming keeps longest: [a, b], with the moment's tick inside. */
  core: [number, number];
  target: (tick: number) => V3;
  /** How far short of the target its sight lines stop (a target inside masonry must not hide it). */
  stop: number;
  eye: (offset: number, tick: number) => V3;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (u: number): number => {
  const c = clamp(u, 0, 1);
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/** Turn (x, z) about the vertical by an angle. */
function rot(x: number, z: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - z * s, x * s + z * c];
}

/** The unit horizontal direction from the world's centre to a point (+x when it is at the centre). */
function outward(x: number, z: number): [number, number] {
  const l = Math.sqrt(x * x + z * z);
  return l < 1e-6 ? [1, 0] : [x / l, z / l];
}

/** Samples of a 3D path at integer ticks t0..t0+n-1, read back with linear interpolation (clamped). */
class Path {
  constructor(
    readonly t0: number,
    readonly v: Float64Array,
  ) {}
  get n(): number {
    return this.v.length / 3;
  }
  at(t: number): V3 {
    const n = this.n;
    const f = clamp(t - this.t0, 0, n - 1);
    const i = Math.min(Math.floor(f), Math.max(0, n - 2));
    const u = n > 1 ? f - i : 0;
    const j = Math.min(i + 1, n - 1);
    const v = this.v;
    return [lerp(v[i * 3], v[j * 3], u), lerp(v[i * 3 + 1], v[j * 3 + 1], u), lerp(v[i * 3 + 2], v[j * 3 + 2], u)];
  }
}

/** Zero-phase exponential smoothing: forward and backward passes averaged, so the path does not lag. */
function smoothPath(v: Float64Array, alpha: number): Float64Array {
  const n = v.length / 3;
  const f = new Float64Array(v.length);
  const b = new Float64Array(v.length);
  for (let k = 0; k < 3; k++) {
    f[k] = v[k];
    for (let i = 1; i < n; i++) f[i * 3 + k] = f[(i - 1) * 3 + k] + alpha * (v[i * 3 + k] - f[(i - 1) * 3 + k]);
    b[(n - 1) * 3 + k] = v[(n - 1) * 3 + k];
    for (let i = n - 2; i >= 0; i--) b[i * 3 + k] = b[(i + 1) * 3 + k] + alpha * (v[i * 3 + k] - b[(i + 1) * 3 + k]);
  }
  const out = new Float64Array(v.length);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (f[i] + b[i]);
  return out;
}

/** A sparse series (tick, xyz) turned into a dense path over [t0, t1], gaps filled by interpolation, ends held. */
function densify(t0: number, t1: number, ticks: number[], xyz: number[]): Float64Array {
  const n = t1 - t0 + 1;
  const out = new Float64Array(n * 3);
  const m = ticks.length;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i;
    while (j < m - 2 && ticks[j + 1] <= t) j++;
    for (let k = 0; k < 3; k++) {
      if (m === 1 || t <= ticks[0]) out[i * 3 + k] = xyz[k];
      else if (t >= ticks[m - 1]) out[i * 3 + k] = xyz[(m - 1) * 3 + k];
      else {
        const span = ticks[j + 1] - ticks[j];
        const u = span > 0 ? (t - ticks[j]) / span : 0;
        out[i * 3 + k] = lerp(xyz[j * 3 + k], xyz[(j + 1) * 3 + k], u);
      }
    }
  }
  return out;
}

interface Fall {
  found: boolean;
  release: number;
  ground: number;
  /** Centroid of the moving stones at each frame (ticks and xyz), empty when none ever moved. */
  ticks: number[];
  xyz: number[];
  /** Per frame: did it have masonry moving? */
  moving: boolean[];
}

/** Find the fall in the frames: the release, the ground and the centroid of what moves. */
function findFall(frames: readonly DirectorFrame[], from: number, to: number): Fall {
  const D = DIRECTOR.topple;
  const ticks: number[] = [];
  const xyz: number[] = [];
  const moving: boolean[] = [];
  const counts: number[] = [];
  const drops: number[] = [];
  let prev = new Map<number, number>();
  let prevTick = 0;
  let havePrev = false;
  for (const f of frames) {
    const cur = new Map<number, number>();
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let dropSum = 0;
    let dropN = 0;
    const dt = havePrev ? (f.tick - prevTick) / DIRECTOR.tps : 0;
    for (let i = 0; i < f.stoneCount; i++) {
      const o = i * STONE_STRIDE;
      const y = f.stones[o + 2];
      if (y < -100) continue;
      n++;
      sx += f.stones[o + 1];
      sy += y;
      sz += f.stones[o + 3];
      const id = f.stones[o];
      cur.set(id, y);
      const py = prev.get(id);
      if (py !== undefined && dt > 0) {
        dropSum += Math.max(0, (py - y) / dt);
        dropN++;
      }
    }
    counts.push(n);
    moving.push(n > 0);
    drops.push(dropN > 0 ? dropSum / dropN : 0);
    if (n > 0) {
      ticks.push(f.tick);
      xyz.push(sx / n, sy / n, sz / n);
    }
    prev = cur;
    prevTick = f.tick;
    havePrev = true;
  }
  const none: Fall = { found: false, release: from, ground: from, ticks, xyz, moving };
  let r = -1;
  for (let i = 0; i < frames.length; i++) {
    if (counts[i] >= DIRECTOR.movingMin) {
      r = i;
      break;
    }
  }
  if (r < 0) return none;
  const release = frames[r].tick;
  const cap = Math.min(to, release + D.capTicks);
  // Drop speed averaged over a few frames, so one odd frame does not end the fall.
  const avg = (i: number): number => {
    let s = 0;
    let c = 0;
    for (let k = Math.max(r, i - D.window + 1); k <= i; k++) {
      s += drops[k];
      c++;
    }
    return c > 0 ? s / c : 0;
  };
  let ground = cap;
  let fast = false;
  for (let i = r + 1; i < frames.length; i++) {
    if (frames[i].tick >= cap) break;
    const a = avg(i);
    if (a >= D.fastDrop) fast = true;
    else if (fast && a < D.stopDrop) {
      ground = frames[i].tick;
      break;
    }
  }
  return { found: true, release, ground: Math.max(release, ground), ticks, xyz, moving };
}

/** The centroid of moving stones as a dense path over [t0, t1]; the moment's place where none moved. */
function centroidPath(fall: Fall, t0: number, t1: number, at: V3): Float64Array {
  if (fall.ticks.length === 0) return densify(t0, t1, [t0], [at[0], at[1], at[2]]);
  return densify(t0, t1, fall.ticks, fall.xyz);
}

function planTopple(clip: DirectorClip, t0: number, t1: number, sight: Sight): Plan {
  const m = clip.moment;
  const D = DIRECTOR.topple;
  const fall = findFall(clip.frames, t0, t1);
  const at: V3 = [m.x, m.y, m.z];
  const cen = smoothPath(centroidPath(fall, t0, t1, at), D.targetSmooth);
  const path = new Path(t0, cen);
  const a = path.at(fall.release);
  const b = path.at(fall.ground);
  // The line of the fall: the way the centroid travelled, else away from the castle's centre.
  let dx = b[0] - a[0];
  let dz = b[2] - a[2];
  if (!fall.found || Math.sqrt(dx * dx + dz * dz) < D.minTravel) [dx, dz] = outward((a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
  else {
    const l = Math.sqrt(dx * dx + dz * dz);
    dx /= l;
    dz /= l;
  }
  const ax = (a[0] + b[0]) / 2;
  const az = (a[2] + b[2]) / 2;
  const nx = -dz;
  const nz = dx;
  const eye = (offset: number): V3 => {
    const [ox, oz] = rot(nx, nz, offset);
    const ex = ax + ox * D.distance;
    const ez = az + oz * D.distance;
    return [ex, sight.ground(ex, ez) + D.height, ez];
  };
  const slow = fall.found;
  const core: [number, number] = [Math.min(fall.release, m.tick), Math.max(fall.ground, m.tick)];
  return {
    recipe: "topple",
    fov: DIRECTOR.fov.topple,
    speed: (t) => (slow && t >= fall.release && t < fall.ground ? D.slow : 1),
    core,
    stop: D.sightStop,
    target: (t) => path.at(t),
    eye: (offset) => eye(offset),
  };
}

interface Ball {
  ticks: number[];
  xyz: number[];
}

/** The shot's projectile in the frames: the first row whose shot id matches, per frame. */
function findBall(frames: readonly DirectorFrame[], shot: number): Ball {
  const ticks: number[] = [];
  const xyz: number[] = [];
  for (const f of frames) {
    for (let i = 0; i < f.projectileCount; i++) {
      const o = i * PROJECTILE_STRIDE;
      if (f.projectiles[o + 1] === shot) {
        ticks.push(f.tick);
        xyz.push(f.projectiles[o + 2], f.projectiles[o + 3], f.projectiles[o + 4]);
        break;
      }
    }
  }
  return { ticks, xyz };
}

function planBeside(clip: DirectorClip, t0: number, t1: number, ball: Ball): Plan {
  const m = clip.moment;
  const D = DIRECTOR.beside;
  const n = ball.ticks.length;
  const last = ball.ticks[n - 1];
  const pos = new Path(t0, densify(t0, t1, ball.ticks, ball.xyz));
  // The ball's direction at each tick (from the frames either side), held where it is still.
  const dirs = new Float64Array((t1 - t0 + 1) * 3);
  let hx = 0;
  let hy = 0;
  let hz = 0;
  const overall = [ball.xyz[(n - 1) * 3] - ball.xyz[0], ball.xyz[(n - 1) * 3 + 1] - ball.xyz[1], ball.xyz[(n - 1) * 3 + 2] - ball.xyz[2]];
  const ol = Math.sqrt(overall[0] ** 2 + overall[1] ** 2 + overall[2] ** 2);
  if (ol > 1e-6) [hx, hy, hz] = [overall[0] / ol, overall[1] / ol, overall[2] / ol];
  else [hx, hy, hz] = [1, 0, 0];
  for (let i = 0; i <= t1 - t0; i++) {
    const t = t0 + i;
    const p = pos.at(t - 2);
    const q = pos.at(t + 2);
    const vx = q[0] - p[0];
    const vy = q[1] - p[1];
    const vz = q[2] - p[2];
    const l = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (l > 0.05) [hx, hy, hz] = [vx / l, vy / l, vz / l];
    dirs[i * 3] = hx;
    dirs[i * 3 + 1] = hy;
    dirs[i * 3 + 2] = hz;
  }
  const dirPath = new Path(t0, dirs);
  // The look point: ahead of the ball while it flies, then easing to the moment's place.
  const tgt = new Float64Array((t1 - t0 + 1) * 3);
  const lastDir = dirPath.at(last);
  const lastPos = pos.at(last);
  const lastLook: V3 = [lastPos[0] + lastDir[0] * D.ahead, lastPos[1] + lastDir[1] * D.ahead, lastPos[2] + lastDir[2] * D.ahead];
  for (let i = 0; i <= t1 - t0; i++) {
    const t = t0 + i;
    let v: V3;
    if (t <= last) {
      const p = pos.at(t);
      const d = dirPath.at(t);
      v = [p[0] + d[0] * D.ahead, p[1] + d[1] * D.ahead, p[2] + d[2] * D.ahead];
    } else {
      const u = smoothstep((t - last) / D.easeTicks);
      v = [lerp(lastLook[0], m.x, u), lerp(lastLook[1], m.y, u), lerp(lastLook[2], m.z, u)];
    }
    tgt[i * 3] = v[0];
    tgt[i * 3 + 1] = v[1];
    tgt[i * 3 + 2] = v[2];
  }
  const target = new Path(t0, smoothPath(tgt, D.targetSmooth));
  // The eye runs 8 m to the ball's side, a fixed side for the whole shot.
  let sx = -(ball.xyz[(n - 1) * 3 + 2] - ball.xyz[2]);
  let sz = ball.xyz[(n - 1) * 3] - ball.xyz[0];
  const sl = Math.sqrt(sx * sx + sz * sz);
  if (sl > 1e-6) {
    sx /= sl;
    sz /= sl;
  } else [sx, sz] = [0, 1];
  // Once the ball is gone the eye drifts on and eases to a stop.
  const endDir = dirPath.at(last);
  const speed = n > 1 ? Math.min(D.stopSpeed, Math.sqrt((ball.xyz[(n - 1) * 3] - ball.xyz[(n - 2) * 3]) ** 2 + (ball.xyz[(n - 1) * 3 + 1] - ball.xyz[(n - 2) * 3 + 1]) ** 2 + (ball.xyz[(n - 1) * 3 + 2] - ball.xyz[(n - 2) * 3 + 2]) ** 2) / Math.max(1, ball.ticks[n - 1] - ball.ticks[n - 2]) * DIRECTOR.tps) : 0;
  const eye = (offset: number, t: number): V3 => {
    const [ox, oz] = rot(sx * D.side, sz * D.side, offset);
    const tt = Math.min(t, last);
    const p = pos.at(tt);
    const e: V3 = [p[0] + ox, p[1] + D.up, p[2] + oz];
    if (t > last) {
      const travel = (speed / DIRECTOR.tps) * D.stopTau * (1 - Math.exp(-(t - last) / D.stopTau));
      e[0] += endDir[0] * travel;
      e[1] += endDir[1] * travel;
      e[2] += endDir[2] * travel;
    }
    return e;
  };
  const slowFrom = last - D.slowBeforeTicks;
  const slowTo = last + D.slowAfterTicks;
  return {
    recipe: "beside",
    fov: DIRECTOR.fov.beside,
    speed: (t) => (t >= slowFrom && t < slowTo ? D.slow : 1),
    core: [Math.min(slowFrom, m.tick), Math.max(slowTo, m.tick)],
    stop: DIRECTOR.sightStop,
    target: (t) => target.at(t),
    eye,
  };
}

/** Stones or men coming down: the tick of the first explosion, else the first masonry moving, else the moment's start. */
function closeTick(clip: DirectorClip): number {
  const m = clip.moment;
  for (const f of clip.frames) {
    for (let i = 0; i < f.eventCount; i++) if (f.events[i * EVENT_STRIDE] === EventKind.Explosion) return f.tick;
  }
  for (const f of clip.frames) {
    let c = 0;
    for (let i = 0; i < f.stoneCount; i++) if (f.stones[i * STONE_STRIDE + 2] >= -100) c++;
    if (c >= DIRECTOR.movingMin) return f.tick;
  }
  return m.first ?? m.tick;
}

function planWideClose(clip: DirectorClip, t0: number, t1: number): Plan {
  const m = clip.moment;
  const D = DIRECTOR.wideClose;
  const tc = closeTick(clip);
  const fall = findFall(clip.frames, t0, t1);
  const at: V3 = [m.x, m.y, m.z];
  // The look point follows the stones once they move, and rests at the moment's place before.
  const raw = centroidPath(fall, t0, t1, at);
  const rel = fall.found ? fall.release : t1 + 1;
  for (let i = 0; i <= t1 - t0; i++) {
    if (t0 + i < rel) {
      raw[i * 3] = at[0];
      raw[i * 3 + 1] = at[1];
      raw[i * 3 + 2] = at[2];
    }
  }
  const target = new Path(t0, smoothPath(raw, D.targetSmooth));
  const [ux, uz] = outward(m.x, m.z);
  return {
    recipe: "wide-close",
    fov: DIRECTOR.fov.other,
    speed: () => 1,
    core: [m.tick, m.tick],
    stop: DIRECTOR.sightStop,
    target: (t) => target.at(t),
    eye: (offset, t) => {
      const u = smoothstep((t - tc) / D.easeTicks);
      const d = lerp(D.wide, D.close, u);
      const h = lerp(D.wideUp, D.closeUp, u);
      const [ox, oz] = rot(ux, uz, offset);
      return [m.x + ox * d, m.y + h, m.z + oz * d];
    },
  };
}

function planWide(clip: DirectorClip, t0: number, t1: number): Plan {
  const m = clip.moment;
  const D = DIRECTOR.wide;
  const [ux, uz] = outward(m.x, m.z);
  const span = Math.max(1, t1 - t0);
  return {
    recipe: "wide",
    fov: DIRECTOR.fov.wide,
    speed: () => 1,
    core: [m.tick, m.tick],
    stop: DIRECTOR.sightStop,
    target: () => [m.x, m.y, m.z],
    eye: (offset, t) => {
      const u = clamp((t - t0) / span, 0, 1);
      const d = lerp(D.from, D.to, smoothstep(u));
      const h = lerp(D.fromUp, D.toUp, smoothstep(u));
      const [ox, oz] = rot(ux, uz, offset);
      return [m.x + ox * d, m.y + h, m.z + oz * d];
    },
  };
}

function planOrbit(clip: DirectorClip, t0: number, t1: number): Plan {
  const m = clip.moment;
  const D = DIRECTOR.orbit;
  const [ux, uz] = outward(m.x, m.z);
  const span = Math.max(1, t1 - t0);
  return {
    recipe: "orbit",
    fov: DIRECTOR.fov.other,
    speed: () => 1,
    core: [m.tick, m.tick],
    stop: DIRECTOR.sightStop,
    target: () => [m.x, m.y, m.z],
    eye: (offset, t) => {
      const u = clamp((t - t0) / span, 0, 1);
      const [ox, oz] = rot(ux, uz, offset + D.turn * u);
      return [m.x + ox * D.distance, m.y + D.up, m.z + oz * D.distance];
    },
  };
}

/** The bearings tried, in order: the preferred one, then 30 degrees either side, alternating, then the far side. */
function bearings(): number[] {
  const out = [0];
  const s = DIRECTOR.bearingStep;
  const k = Math.round(Math.PI / s);
  for (let i = 1; i < k; i++) out.push(i * s, -i * s);
  out.push(k * s);
  return out;
}

/** How many samples of an eye path are bad: the eye too low, a segment of its path cut, or its sight line to the target cut. */
function badSamples(plan: Plan, offset: number, raise: number, sight: Sight, t0: number, t1: number): number {
  const D = DIRECTOR;
  let bad = 0;
  let prev: V3 | null = null;
  const ticks: number[] = [];
  for (let t = t0; t < t1; t += D.sampleTicks) ticks.push(t);
  ticks.push(t1);
  for (const t of ticks) {
    const e = plan.eye(offset, t);
    e[1] += raise;
    const g = plan.target(t);
    if (e[1] < sight.ground(e[0], e[2]) + D.eyeClear) bad++;
    if (prev && sight.blocked(prev[0], prev[1], prev[2], e[0], e[1], e[2])) bad++;
    // The sight line stops a little short of the target.
    const dx = g[0] - e[0];
    const dy = g[1] - e[1];
    const dz = g[2] - e[2];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const k = l > plan.stop ? (l - plan.stop) / l : 0;
    if (sight.blocked(e[0], e[1], e[2], e[0] + dx * k, e[1] + dy * k, e[2] + dz * k)) bad++;
    prev = e;
  }
  return bad;
}

/** Pick a bearing: the first clear one in order, else the clearest, raised. */
function chooseBearing(plan: Plan, sight: Sight, t0: number, t1: number): { offset: number; raise: number } {
  let best = 0;
  let bestBad = Infinity;
  for (const o of bearings()) {
    const bad = badSamples(plan, o, 0, sight, t0, t1);
    if (bad === 0) return { offset: o, raise: 0 };
    if (bad < bestBad) {
      bestBad = bad;
      best = o;
    }
  }
  return { offset: best, raise: DIRECTOR.raise };
}

function hasBall(frames: readonly DirectorFrame[], shot: number): boolean {
  for (const f of frames) for (let i = 0; i < f.projectileCount; i++) if (f.projectiles[i * PROJECTILE_STRIDE + 1] === shot) return true;
  return false;
}

function makePlan(clip: DirectorClip, t0: number, t1: number, sight: Sight): Plan {
  const m = clip.moment;
  const kind = m.kind;
  if (TOPPLE_KINDS.includes(kind)) return planTopple(clip, t0, t1, sight);
  if (KEG_KINDS.includes(kind)) return planWideClose(clip, t0, t1);
  if (STORM_KINDS.includes(kind)) return planWide(clip, t0, t1);
  if ((SHOT_KINDS.includes(kind) || m.shot !== undefined) && m.shot !== undefined && hasBall(clip.frames, m.shot)) {
    return planBeside(clip, t0, t1, findBall(clip.frames, m.shot));
  }
  return planOrbit(clip, t0, t1);
}

export function direct(clip: DirectorClip, sight: Sight, opts?: { budget?: number }): Take {
  const t0 = Math.round(clip.from);
  const t1 = Math.max(t0, Math.round(clip.to));
  const frames = [...clip.frames].sort((a, b) => a.tick - b.tick);
  const c: DirectorClip = { ...clip, frames };
  const plan = makePlan(c, t0, t1, sight);
  const pick = chooseBearing(plan, sight, t0, t1);

  // Play time: seconds from the clip's first tick to each whole tick, at the speed of the tick's middle.
  const cum = new Float64Array(t1 - t0 + 1);
  for (let i = 1; i < cum.length; i++) cum[i] = cum[i - 1] + 1 / (DIRECTOR.tps * plan.speed(t0 + i - 0.5));
  const secAt = (t: number): number => cum[clamp(Math.round(t), t0, t1) - t0];

  let start = t0;
  let end = t1;
  const budget = opts?.budget;
  if (budget !== undefined && secAt(end) - secAt(start) > budget) {
    const mt = clamp(Math.round(clip.moment.tick), t0, t1);
    const coreA = clamp(Math.round(plan.core[0]), t0, mt);
    const coreB = clamp(Math.round(plan.core[1]), mt, t1);
    const fits = () => secAt(end) - secAt(start) <= budget;
    // Cut the lead-in first, then the tail; each stage stops at the part of the moment worth keeping, and
    // only when the budget still is not met does the cut go on into the core, toward the moment's own tick.
    const cutStart = (limit: number) => {
      let lo = start;
      let hi = limit;
      if (lo >= hi) return;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        start = mid;
        if (fits()) hi = mid;
        else lo = mid + 1;
      }
      start = lo;
    };
    const cutEnd = (limit: number) => {
      let lo = limit;
      let hi = end;
      if (lo >= hi) return;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        end = mid;
        if (fits()) lo = mid;
        else hi = mid - 1;
      }
      end = lo;
    };
    cutStart(coreA);
    if (!fits()) cutEnd(coreB);
    if (!fits()) cutStart(mt);
    if (!fits()) cutEnd(mt);
  }

  const eyeAt = (t: number): V3 => {
    const e = plan.eye(pick.offset, clamp(t, t0, t1));
    e[1] += pick.raise;
    return e;
  };
  const s0 = start;
  const total = secAt(end) - secAt(start);
  return {
    recipe: plan.recipe,
    start,
    end,
    seconds: total,
    speedAt: (t) => plan.speed(t),
    poseAt: (t) => {
      const tc = clamp(t, t0, t1);
      const e = eyeAt(tc);
      const g = plan.target(tc);
      return { x: e[0], y: e[1], z: e[2], tx: g[0], ty: g[1], tz: g[2], fov: plan.fov };
    },
    tickAt: (seconds) => {
      const want = secAt(s0) + clamp(seconds, 0, total);
      // The last whole tick whose play time does not pass `want`, then the share of the next tick.
      let lo = s0 - t0;
      let hi = end - t0;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (cum[mid] <= want) lo = mid;
        else hi = mid - 1;
      }
      if (lo >= end - t0) return end;
      const span = cum[lo + 1] - cum[lo];
      return t0 + lo + (span > 0 ? clamp((want - cum[lo]) / span, 0, 1) : 0);
    },
  };
}
