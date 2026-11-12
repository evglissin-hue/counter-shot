// Procedural animation for upright minions (render only: nothing here feeds
// the sim, so it may use Math.sin and friends freely).
//
// The sim sends each upright minion once a frame: where it stands, its yaw,
// its walk phase, its action and `act` (ticks since its last blow, stroke or
// shot). The rig keeps a small record per figure and derives the rest:
// speed, turn rate and acceleration from positions and yaw between frames,
// its own gait phase (stride and cadence follow the real speed, so feet do
// not skate), how long it has been doing what it does, and when an enemy's
// blow comes at it (a parry). Each render frame it extrapolates the figure a
// little past the last frame (smooth on fast screens and in slow motion),
// builds a pose in the figure's own space (x left, y up, z forward), blends
// from the last pose for a few tenths of a second when the figure changes
// what it does, solves knees and elbows (two-bone IK) and writes one
// transform per body part and per piece of kit.
//
// Pure maths and typed arrays, allocation free per frame, testable in Node.

import { haulHands, HAUL_TICKS } from "./powderLogic";

export const NPARTS = 11;
export const PELVIS = 0, TORSO = 1, HEAD = 2, UARM_L = 3, LARM_L = 4, UARM_R = 5, LARM_R = 6, THIGH_L = 7, SHIN_L = 8, THIGH_R = 9, SHIN_R = 10;
/** Upright actions (army.ts Action, specialists.ts). */
export const WALK = 0, STAND = 1, FIGHT = 2, BATTER = 3, WORK = 4, CARRY = 5, CLIMB = 6, RAISE = 7, PLANT = 8, AIM = 9;
/** Unit kinds (content's Unit). */
export const PIKEMAN = 0, MASON = 1, CREW = 2, SAPPER = 3, MUSKETEER = 4, POWDER_BOY = 5;
/** A powder boy's actions (carriers.ts ACTION_KEG, ACTION_HOIST): a keg on his shoulder, hauling one up. */
export const A_KEG = 10, A_HOIST = 11;
/** Where in a mason's stroke the mallet strikes, and the stroke's length (ticks; works.ts STROKE, the page's knock). */
export const MALLET_HIT = 14;
export const MALLET_STROKE = 45;

/** Figures the rig keeps at once (upright only). */
export const MAX_SLOTS = 640;

// Proportions (metres, before a figure's own scale). Thigh and shin are the
// distances between joints; the shin capsule (0.39 m) is stretched to reach
// the ground, so feet stand on it instead of hovering.
const THIGH = 0.42;
const SHIN = 0.47;
export const SHIN_STRETCH = SHIN / 0.39;
const LEG = THIGH + SHIN;
const UPPER = 0.27;
const FORE = 0.25;
/** Pelvis centre standing; hips sit HIP_DROP below it, HIP_X to each side. */
const PELVIS_Y = 0.935;
const HIP_X = 0.1;
const HIP_DROP = 0.05;
/** Torso centre above the pelvis centre, shoulders above the torso centre. */
const SPINE = 0.3;
const SHOULDER_X = 0.235;
const SHOULDER_UP = 0.19;
/** Ankle height when a foot is flat (the sole of the stretched shin). */
const SOLE = 0.012;

// --- pose layout: one figure's pose in its own space ---------------------------
export const P_PEL = 0; // pelvis centre (3)
export const P_PEL_A = 3; // pelvis twist, roll, pitch
export const P_TOR = 6; // torso centre (3)
export const P_TOR_A = 9; // torso twist, roll, pitch (lean)
export const P_HEAD_A = 12; // head yaw, roll, pitch
export const P_ANK_L = 15;
export const P_ANK_R = 18;
export const P_HAND_L = 21;
export const P_HAND_R = 24;
export const P_POLE_L = 27; // elbow pole (direction the elbow bends towards)
export const P_POLE_R = 30;
export const P_KIT = 33; // kit anchor (3): the pike's butt, the musket's butt
export const P_KIT_D = 36; // kit direction (3): along the pike (+Y) or the musket (+Z)
export const P_KIT_M = 39; // kit mode (KM_*)
export const P_KIT_T = 40; // tilt of a tool in the hand (rad)
export const P_KEG = 41; // keg centre (3)
export const P_KEG_A = 44; // keg twist, roll, pitch
export const P_KEG_ON = 47; // 1 while the keg is in his hands or on his shoulder
export const P_ROD = 48; // ramrod's lower end (3)
export const P_ROD_D = 51; // ramrod direction (3)
export const P_ROD_ON = 54;
export const P_SCALE = 55; // the figure's own size (blends to 1 where the world sets heights)
export const POSE_N = 56;

/** Kit modes: none, free (anchor and direction in the pose), in the right hand along the forearm, at the belt, slung across the back. */
export const KM_NONE = 0, KM_FREE = 1, KM_HAND = 2, KM_BELT = 3, KM_BACK = 4;

// --- transforms out: per figure, world space ------------------------------------
/** Per part: x, y, z, qx, qy, qz, qw, sx, sy, sz. */
export const XF_STRIDE = 10;
export const XF_HEAD_GEAR = NPARTS * XF_STRIDE; // helmet or cap
export const XF_KIT = XF_HEAD_GEAR + XF_STRIDE;
export const XF_KEG = XF_KIT + XF_STRIDE;
export const XF_ROD = XF_KEG + XF_STRIDE;
export const XF_N = XF_ROD + XF_STRIDE;
/** Bits of `shows`: kit, keg, ramrod drawn this frame. */
export const SHOW_KIT = 1, SHOW_KEG = 2, SHOW_ROD = 4;

/** Pose families: a change of family blends from the last pose. */
const F_LOCO = 0, F_FIGHT = 1, F_BATTER = 2, F_WORK = 3, F_CARRY = 4, F_RAISE = 5, F_LADDER = 6, F_ROPE = 7, F_PLANT = 8, F_AIM = 9, F_CHOP = 10, F_JAB = 11, F_HOIST = 12;

/** Blows: ticks between blows and from meeting an enemy to the first one (content's UNITS, by unit). */
const BLOW_MIN = [70, 0, 60, 70, 70];
const BLOW_MAX = [110, 0, 95, 110, 110];
const READY_MIN = [15, 0, 12, 20, 20];
const REACH = [2.6, 0, 1.7, 1.3, 1.4];
/** A musketeer's shot: the kick, then the reload (MUSKET.reloadMin is 255 ticks, then 30 of aiming). */
const RECOIL = 14;

/** Per-figure variety, from its id: [scale, build, stride, arm swing, lean, stance width, lead foot, idle style, seed a, seed b, seed c, skin, tint]. */
const VAR_N = 13;
const V_SCALE = 0, V_BUILD = 1, V_STRIDE = 2, V_ARMS = 3, V_LEAN = 4, V_WIDTH = 5, V_LEAD = 6, V_STYLE = 7, V_SA = 8, V_SB = 9, V_SC = 10, V_SKIN = 11, V_TINT = 12;

/** Level of detail by distance (metres, scaled by the camera's zoom): idle life and the pike's sway only near. */
const NEAR = 32;
const MID = 75;

const TAU = Math.PI * 2;

function frac(x: number): number {
  return x - Math.floor(x);
}
function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}
function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** Smooth noise in about [-1, 1] (three sines). */
function noise(t: number, s: number): number {
  return Math.sin(t + s) * 0.55 + Math.sin(t * 1.73 + s * 2.1) * 0.3 + Math.sin(t * 2.91 + s * 3.7) * 0.15;
}
/** A stable hash of (id, k) in [0, 1). */
export function hash01(id: number, k: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** Wrap an angle into (-pi, pi]. */
function wrap(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a <= -Math.PI) a += TAU;
  return a;
}

/** Writes per-figure output: the rig calls it once per upright figure drawn. */
export interface FigureSink {
  figure(slot: number, id: number, team: number, unit: number, shows: number, xf: Float32Array, o: number): void;
}

export class Rig {
  /** Animation clock (sim seconds: slow motion slows it). */
  time = 0;
  /** Sim seconds since the last frame was taken in. */
  since = 0;
  private fresh = false;
  /** Seconds between the last two frames. */
  private frameDt = 1 / 60;
  private lastTick = -1;
  /** Frames taken in. */
  private frame = 0;

  readonly slotOf = new Map<number, number>();
  private freeList = new Int32Array(MAX_SLOTS);
  private nFree = MAX_SLOTS;
  /** Slots in the order of the last frame's list. */
  readonly order = new Int32Array(MAX_SLOTS);
  orderCount = 0;

  readonly id = new Int32Array(MAX_SLOTS).fill(-1);
  private seen = new Int32Array(MAX_SLOTS);
  private samples = new Int32Array(MAX_SLOTS);
  readonly team = new Int8Array(MAX_SLOTS);
  readonly unit = new Int8Array(MAX_SLOTS);
  readonly action = new Int8Array(MAX_SLOTS);
  private act = new Float32Array(MAX_SLOTS);
  /** Ticks the current action has lasted (from frames, so it matches act). */
  private actTicks = new Float32Array(MAX_SLOTS);
  readonly px = new Float32Array(MAX_SLOTS);
  readonly py = new Float32Array(MAX_SLOTS);
  readonly pz = new Float32Array(MAX_SLOTS);
  readonly yaw = new Float32Array(MAX_SLOTS);
  private vx = new Float32Array(MAX_SLOTS);
  private vy = new Float32Array(MAX_SLOTS);
  private vz = new Float32Array(MAX_SLOTS);
  private wy = new Float32Array(MAX_SLOTS);
  /** Smoothed speed over the ground (m/s). */
  readonly svx = new Float32Array(MAX_SLOTS);
  readonly svz = new Float32Array(MAX_SLOTS);
  private sw = new Float32Array(MAX_SLOTS);
  private sax = new Float32Array(MAX_SLOTS);
  private saz = new Float32Array(MAX_SLOTS);
  private phase = new Float32Array(MAX_SLOTS);
  private shuffle = new Float32Array(MAX_SLOTS);
  /** On a climb: 0 not yet known, 1 a ladder, 2 the rope inside. */
  private climbKind = new Int8Array(MAX_SLOTS);
  private family = new Int8Array(MAX_SLOTS);
  private blendAt = new Float32Array(MAX_SLOTS);
  private blendDur = new Float32Array(MAX_SLOTS);
  private parryAt = new Float32Array(MAX_SLOTS);
  private parrySide = new Float32Array(MAX_SLOTS);
  /** When a sapper stopped setting his keg (he runs from it). */
  private fledAt = new Float32Array(MAX_SLOTS);
  /** The pike's sway (pitch and roll, and their rates), near figures only. */
  private sp = new Float32Array(MAX_SLOTS * 4);
  private vars = new Float32Array(MAX_SLOTS * VAR_N);
  readonly pose = new Float32Array(MAX_SLOTS * POSE_N);
  private snap = new Float32Array(MAX_SLOTS * POSE_N);
  /** World transforms of each figure as last drawn (also what a falling body starts from). */
  readonly xf = new Float32Array(MAX_SLOTS * XF_N);
  readonly shows = new Uint8Array(MAX_SLOTS);
  /** Whether the slot was drawn at least once (its xf is valid). */
  readonly drawn = new Uint8Array(MAX_SLOTS);
  /** Sappers who have set their kegs (ids). */
  readonly kegless = new Set<number>();
  /** Blows struck this frame (slots), for parries. */
  private blows = new Int32Array(64);
  private nBlows = 0;

  // The figure being posed.
  private P = new Float32Array(POSE_N);
  private s = 0;
  private u = 0;
  private a = 0;
  private cAct = 0;
  private cAT = 0;
  private cV = 0;
  private cVf = 0;
  private cVs = 0;
  private cW = 0;
  private cR = 0;
  private cG = 0;
  private cAcc = 0;
  /** Stride: metres per walk cycle (two steps). */
  private cL = 1.4;
  private cLod = 0;
  private cVar = 0;
  private cGround = 0;
  private cY = 0;
  // Vector scratch (rot() output, IK output).
  private rx = 0;
  private ry = 0;
  private rz = 0;
  /** Quaternion scratch (euler(), toward(), rot() read it). */
  qx = 0;
  qy = 0;
  qz = 0;
  qw = 1;
  private j = new Float64Array(3 * 12);

  constructor() {
    for (let i = 0; i < MAX_SLOTS; i++) this.freeList[i] = MAX_SLOTS - 1 - i;
  }

  // --- frames in -----------------------------------------------------------------

  /** Seconds between the last two frames. */
  get frameSeconds(): number {
    return this.frameDt;
  }

  /** Start taking in a frame at `tick`. */
  begin(tick: number) {
    if (this.lastTick >= 0 && tick > this.lastTick) this.frameDt = Math.min(0.25, (tick - this.lastTick) / 60);
    else this.frameDt = 1 / 60;
    this.lastTick = tick;
    this.frame++;
    this.orderCount = 0;
    this.nBlows = 0;
    this.since = 0;
    this.fresh = true;
  }

  /** One upright minion of the frame. Returns its slot (-1 when full). */
  take(id: number, x: number, y: number, z: number, yaw: number, walk: number, team: number, action: number, act: number, unit: number): number {
    let s = this.slotOf.get(id);
    const dt = this.frameDt;
    if (s === undefined) {
      if (this.nFree === 0) return -1;
      s = this.freeList[--this.nFree];
      this.slotOf.set(id, s);
      this.id[s] = id;
      this.samples[s] = 0;
      this.vx[s] = this.vy[s] = this.vz[s] = this.wy[s] = 0;
      this.svx[s] = this.svz[s] = this.sw[s] = this.sax[s] = this.saz[s] = 0;
      this.phase[s] = walk;
      this.shuffle[s] = 0;
      this.climbKind[s] = 0;
      this.family[s] = -1;
      this.blendAt[s] = -100;
      this.blendDur[s] = 0;
      this.parryAt[s] = -100;
      this.fledAt[s] = -100;
      this.actTicks[s] = 0;
      this.action[s] = action;
      this.drawn[s] = 0;
      const sp = s * 4;
      this.sp[sp] = this.sp[sp + 1] = this.sp[sp + 2] = this.sp[sp + 3] = 0;
      const v = s * VAR_N;
      const V = this.vars;
      V[v + V_SCALE] = (0.94 + hash01(id, 1) * 0.12) * (unit === POWDER_BOY ? 0.9 : 1);
      V[v + V_BUILD] = 0.9 + hash01(id, 2) * 0.22;
      V[v + V_STRIDE] = 0.94 + hash01(id, 3) * 0.12;
      V[v + V_ARMS] = 0.75 + hash01(id, 4) * 0.5;
      V[v + V_LEAN] = (hash01(id, 5) - 0.5) * 0.08;
      V[v + V_WIDTH] = (hash01(id, 6) - 0.5) * 0.06;
      V[v + V_LEAD] = hash01(id, 7) < 0.5 ? -1 : 1;
      V[v + V_STYLE] = Math.floor(hash01(id, 8) * 4);
      V[v + V_SA] = hash01(id, 9) * 100;
      V[v + V_SB] = hash01(id, 10) * 100;
      V[v + V_SC] = hash01(id, 11) * 100;
      V[v + V_SKIN] = Math.floor(hash01(id, 12) * 3);
      V[v + V_TINT] = 0.9 + hash01(id, 13) * 0.18;
    } else {
      const gap = this.seen[s] !== this.frame - 1;
      const dx = x - this.px[s], dy = y - this.py[s], dz = z - this.pz[s];
      const d2 = dx * dx + dz * dz;
      if (gap || d2 > 2.5 * 2.5 || dy * dy > 1.5 * 1.5) {
        // A jump (placed at the foot of a ladder or the rope, or a figure we lost for a frame): no speed from it.
        this.vx[s] = this.vy[s] = this.vz[s] = this.wy[s] = 0;
      } else {
        this.vx[s] = dx / dt;
        this.vy[s] = dy / dt;
        this.vz[s] = dz / dt;
        this.wy[s] = wrap(yaw - this.yaw[s]) / dt;
      }
      const k = this.samples[s] <= 1 ? 1 : 1 - Math.exp(-dt / 0.12);
      const ox = this.svx[s], oz = this.svz[s];
      this.svx[s] += (this.vx[s] - this.svx[s]) * k;
      this.svz[s] += (this.vz[s] - this.svz[s]) * k;
      this.sw[s] += (this.wy[s] - this.sw[s]) * (this.samples[s] <= 1 ? 1 : 1 - Math.exp(-dt / 0.1));
      if (this.samples[s] > 1) {
        const ka = 1 - Math.exp(-dt / 0.15);
        this.sax[s] += ((this.svx[s] - ox) / dt - this.sax[s]) * ka;
        this.saz[s] += ((this.svz[s] - oz) / dt - this.saz[s]) * ka;
      }
      // A blow, a stroke or a shot: act went back to zero.
      if (act < this.act[s] - 0.5 && action === this.action[s] && (action === FIGHT || action === BATTER) && this.nBlows < this.blows.length) this.blows[this.nBlows++] = s;
      if (action !== this.action[s]) {
        if (this.action[s] === PLANT) this.fledAt[s] = this.time;
        this.actTicks[s] = 0;
      } else this.actTicks[s] += dt * 60;
    }
    this.seen[s] = this.frame;
    this.samples[s]++;
    this.px[s] = x;
    this.py[s] = y;
    this.pz[s] = z;
    this.yaw[s] = yaw;
    this.team[s] = team;
    this.unit[s] = unit;
    this.action[s] = action;
    this.act[s] = act;
    if (action !== CLIMB) this.climbKind[s] = 0;
    else if (this.climbKind[s] === 0 || this.samples[s] > 1) {
      // Down the rope inside or up a ladder: by which way he moves (kept while he waits).
      if (this.vy[s] < -0.5) this.climbKind[s] = 2;
      else if (this.vy[s] > 0.3) this.climbKind[s] = 1;
    }
    if (this.orderCount < MAX_SLOTS) this.order[this.orderCount++] = s;
    return s;
  }

  /**
   * After the frame's figures: whoever a blow was aimed at and still stands
   * parries it. Then figures not in this frame are let go (call after any
   * use of their last transforms, such as a fall).
   */
  end() {
    for (let b = 0; b < this.nBlows; b++) {
      const s = this.blows[b];
      if (this.action[s] !== FIGHT) continue;
      const reach = (REACH[this.unit[s]] || 2) + 0.6;
      const fx = Math.sin(this.yaw[s]), fz = Math.cos(this.yaw[s]);
      let best = -1, bd = reach * reach;
      for (let k = 0; k < this.orderCount; k++) {
        const t = this.order[k];
        if (this.team[t] === this.team[s]) continue;
        const dx = this.px[t] - this.px[s], dz = this.pz[t] - this.pz[s];
        const d2 = dx * dx + dz * dz;
        if (d2 >= bd || dx * fx + dz * fz < 0.5 * Math.sqrt(d2)) continue;
        bd = d2;
        best = t;
      }
      if (best >= 0) {
        this.parryAt[best] = this.time;
        // Which way the point is beaten aside (stable per pair of figures).
        this.parrySide[best] = hash01(this.id[s], this.id[best]) < 0.5 ? -1 : 1;
      }
    }
  }

  /** Let go of figures not seen in the last frame. */
  sweep() {
    for (let s = 0; s < MAX_SLOTS; s++) {
      const id = this.id[s];
      if (id < 0 || this.seen[s] === this.frame) continue;
      this.slotOf.delete(id);
      this.id[s] = -1;
      this.freeList[this.nFree++] = s;
    }
  }

  /** The slot of an upright minion seen in the last frame (or still held), or -1. */
  slot(id: number): number {
    return this.slotOf.get(id) ?? -1;
  }

  /** Per-figure variety for the renderer: skin tone (0..2) and cloth tint. */
  skin(s: number): number {
    return this.vars[s * VAR_N + V_SKIN];
  }
  tint(s: number): number {
    return this.vars[s * VAR_N + V_TINT];
  }
  build(s: number): number {
    return this.vars[s * VAR_N + V_BUILD];
  }

  forget() {
    for (let s = 0; s < MAX_SLOTS; s++) {
      if (this.id[s] >= 0) this.slotOf.delete(this.id[s]);
      this.id[s] = -1;
      this.freeList[s] = MAX_SLOTS - 1 - s;
    }
    this.nFree = MAX_SLOTS;
    this.orderCount = 0;
    this.kegless.clear();
    this.lastTick = -1;
  }

  // --- render frames ---------------------------------------------------------------

  /**
   * Advance the clock by dt (sim seconds) and pose every figure of the last
   * frame: `ground` gives the terrain height, `eye` and `zoom` (tan of half
   * the vertical field of view) set the level of detail.
   */
  animate(dt: number, ground: (x: number, z: number) => number, ex: number, ey: number, ez: number, zoom: number, sink: FigureSink) {
    this.time += dt;
    if (this.fresh) this.fresh = false;
    else this.since += dt;
    const since = Math.min(this.since, 0.05);
    const lodK = zoom / 0.577;
    for (let k = 0; k < this.orderCount; k++) {
      const s = this.order[k];
      // Where it is now: the last frame carried on along its velocity for a moment.
      const x = this.px[s] + this.vx[s] * since;
      const y = this.py[s] + this.vy[s] * since;
      const z = this.pz[s] + this.vz[s] * since;
      const turn = clamp(this.wy[s] * since, -0.12, 0.12);
      const yaw = this.yaw[s] + turn;
      const dx = x - ex, dy = y - ey, dz = z - ez;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) * lodK;
      this.cLod = dist < NEAR ? 0 : dist < MID ? 1 : 2;
      this.cGround = ground(x, z);
      this.cY = y;
      this.posePrep(s, dt, since, yaw);
      this.solve(s, x, y, z, yaw);
      this.drawn[s] = 1;
      sink.figure(s, this.id[s], this.team[s], this.unit[s], this.shows[s], this.xf, s * XF_N);
    }
  }

  /** Work out the figure's state for this render frame, build its pose and blend it. */
  private posePrep(s: number, dt: number, since: number, yaw: number) {
    this.s = s;
    this.u = this.unit[s];
    this.a = this.action[s];
    this.cVar = s * VAR_N;
    const V = this.vars, vo = this.cVar;
    // Speed, in the figure's own frame.
    const vx = this.svx[s], vz = this.svz[s];
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    this.cVf = vx * sy + vz * cy;
    this.cVs = vx * cy - vz * sy;
    this.cV = Math.sqrt(vx * vx + vz * vz);
    this.cW = this.sw[s];
    this.cAcc = this.sax[s] * sy + this.saz[s] * cy;
    this.cAct = Math.min(600, this.act[s] + since * 60);
    this.cAT = (this.actTicks[s] + since * 60) / 60;
    // Gait: weight, running, stride, phase.
    const v = this.cV;
    this.cG = smooth(0.05, 0.32, v);
    this.cR = smooth(1.85, 2.15, v);
    let L = clamp(0.5 + 0.58 * v, 0.6, 1.75) * V[vo + V_STRIDE];
    if (this.a === CARRY) L *= 0.82;
    this.cL = L;
    this.phase[s] = frac(this.phase[s] + (v * dt) / L);
    // Turning on the spot: the feet step round.
    const tw = Math.abs(this.cW);
    this.shuffle[s] = frac(this.shuffle[s] + Math.min(tw / 1.6, 2.4) * dt);
    // Climbing: which way, if not known yet.
    if (this.a === CLIMB && this.climbKind[s] === 0) this.climbKind[s] = this.cY - this.cGround > 4 ? 2 : 1;
    const fam = this.familyOf();
    const P = this.P;
    if (fam !== this.family[s]) {
      if (this.family[s] >= 0 && this.drawn[s]) {
        this.snap.set(this.pose.subarray(s * POSE_N, s * POSE_N + POSE_N), s * POSE_N);
        this.blendAt[s] = this.time;
        this.blendDur[s] = fam === F_LADDER || fam === F_ROPE || this.family[s] === F_PLANT ? 0.18 : this.family[s] === F_FIGHT || this.family[s] === F_CHOP ? 0.3 : 0.25;
      }
      this.family[s] = fam;
    }
    // Kit anchors start where they were (a pose without free kit leaves them), so a blend never pulls kit towards stale numbers.
    const po = s * POSE_N;
    for (let i = P_KIT; i < P_KIT + 6; i++) P[i] = this.pose[po + i];
    for (let i = P_KEG; i < P_KEG + 6; i++) P[i] = this.pose[po + i];
    for (let i = P_ROD; i < P_ROD + 6; i++) P[i] = this.pose[po + i];
    P[P_SCALE] = V[vo + V_SCALE];
    P[P_KEG_ON] = 0;
    P[P_ROD_ON] = 0;
    P[P_KIT_M] = KM_NONE;
    P[P_KIT_T] = 0;
    switch (fam) {
      case F_FIGHT:
        this.fight(false);
        break;
      case F_BATTER:
        this.fight(true);
        break;
      case F_JAB:
        this.fight(false);
        break;
      case F_CHOP:
        this.chop();
        break;
      case F_WORK:
        this.masonWork();
        break;
      case F_CARRY:
        this.carry();
        break;
      case F_RAISE:
        this.raise();
        break;
      case F_LADDER:
        this.ladder();
        break;
      case F_ROPE:
        this.rope();
        break;
      case F_PLANT:
        this.plant();
        break;
      case F_HOIST:
        this.hoist();
        break;
      case F_AIM:
        this.aim();
        break;
      default:
        this.loco(dt);
    }
    if (fam !== F_LADDER && fam !== F_ROPE && fam !== F_PLANT && fam !== F_CARRY) this.turnSteps(fam === F_LOCO ? 1 - this.cG : 1);
    if (this.cLod === 0 && (fam === F_FIGHT || fam === F_JAB || fam === F_CHOP || fam === F_LOCO)) this.parry();
    // Blend from the pose it had when it began this.
    const o = s * POSE_N;
    const bt = (this.time - this.blendAt[s]) / (this.blendDur[s] || 1);
    if (bt < 1 && this.cLod < 2) {
      const w = bt <= 0 ? 0 : bt * bt * (3 - 2 * bt);
      const S = this.snap;
      for (let i = 0; i < POSE_N; i++) {
        if (i === P_KIT_M || i === P_KEG_ON || i === P_ROD_ON) {
          if (w < 0.5) P[i] = S[o + i];
          continue;
        }
        P[i] = S[o + i] + (P[i] - S[o + i]) * w;
      }
      // Directions stay unit length.
      norm(P, P_KIT_D);
      norm(P, P_ROD_D);
    }
    this.pose.set(P, o);
  }

  private familyOf(): number {
    const a = this.a, u = this.u;
    if (a === CLIMB) return this.climbKind[this.s] === 2 ? F_ROPE : F_LADDER;
    if (a === CARRY) return F_CARRY;
    if (a === RAISE) return F_RAISE;
    if (u === POWDER_BOY) return a === A_HOIST ? F_HOIST : F_LOCO;
    if (u === MASON) return a === WORK ? F_WORK : F_LOCO;
    if (a === FIGHT) return u === CREW || u === SAPPER ? F_CHOP : u === MUSKETEER ? F_JAB : F_FIGHT;
    if (a === BATTER) return F_BATTER;
    if (a === PLANT) return F_PLANT;
    if (a === AIM && u === MUSKETEER) return F_AIM;
    return F_LOCO;
  }

  // --- pose building blocks --------------------------------------------------------

  private set3(i: number, x: number, y: number, z: number) {
    const P = this.P;
    P[i] = x;
    P[i + 1] = y;
    P[i + 2] = z;
  }

  /** Pelvis, torso and head: positions and angles (absolute, in the figure's frame). The torso stands on the pelvis. */
  private trunk(px: number, py: number, pz: number, pTwist: number, pRoll: number, pPitch: number, tTwist: number, tRoll: number, lean: number, hYaw: number, hRoll: number, hPitch: number) {
    const P = this.P;
    this.set3(P_PEL, px, py, pz);
    this.set3(P_PEL_A, pTwist, pRoll, pPitch);
    this.set3(P_TOR_A, tTwist, tRoll, lean);
    euler(tTwist, tRoll, lean, this);
    this.rot(0, SPINE, 0);
    this.set3(P_TOR, px + this.rx, py + this.ry, pz + this.rz);
    this.set3(P_HEAD_A, hYaw, hRoll, hPitch);
    void P;
  }

  /** Where a shoulder will be (side +1 left, -1 right), from the torso already in the pose: into rx, ry, rz. */
  private shoulder(side: number) {
    const P = this.P;
    euler(P[P_TOR_A], P[P_TOR_A + 1], P[P_TOR_A + 2], this);
    this.rot(side * SHOULDER_X, SHOULDER_UP, 0);
    this.rx += P[P_TOR];
    this.ry += P[P_TOR + 1];
    this.rz += P[P_TOR + 2];
  }

  /** An arm swinging from its shoulder by `swing` (rad, + forward), the elbow a little bent; writes the hand and its pole. */
  private swingArm(side: number, swing: number, bend: number, out: number) {
    this.shoulder(side);
    const sx = this.rx, sy = this.ry, sz = this.rz;
    const reach = 0.5 - bend * 0.12;
    const lift = Math.max(0, swing) * bend * 0.1;
    this.set3(side > 0 ? P_HAND_L : P_HAND_R, sx + side * (0.035 + out), sy - Math.cos(swing) * reach + lift, sz + Math.sin(swing) * reach);
    this.set3(side > 0 ? P_POLE_L : P_POLE_R, side * 0.35, -0.4, -1);
  }

  private hand(side: number, x: number, y: number, z: number, polex: number, poley: number, polez: number) {
    this.set3(side > 0 ? P_HAND_L : P_HAND_R, x, y, z);
    this.set3(side > 0 ? P_POLE_L : P_POLE_R, polex, poley, polez);
  }

  /** With both hands busy: a pike or a musket slung across the back, a tool at the belt. */
  private slung(): number {
    return this.u === PIKEMAN || this.u === MUSKETEER ? KM_BACK : KM_BELT;
  }

  private kit(mode: number, ax: number, ay: number, az: number, dx: number, dy: number, dz: number) {
    const P = this.P;
    P[P_KIT_M] = mode;
    this.set3(P_KIT, ax, ay, az);
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    this.set3(P_KIT_D, dx / l, dy / l, dz / l);
  }

  private keg(x: number, y: number, z: number, twist: number, roll: number, pitch: number) {
    const P = this.P;
    P[P_KEG_ON] = 1;
    this.set3(P_KEG, x, y, z);
    this.set3(P_KEG_A, twist, roll, pitch);
  }

  /** Braced feet: left and right ankles at (x, z), flat. */
  private feet(lx: number, lz: number, rx: number, rz: number) {
    this.set3(P_ANK_L, lx, SOLE, lz);
    this.set3(P_ANK_R, rx, SOLE, rz);
  }

  /** Idle life near the camera: a slow sway, breathing and looking about (0 far away). */
  private idle(scale: number): { sway: number; breath: number; look: number; nod: number } {
    const o = this.idleOut;
    if (this.cLod > 0 || scale <= 0) {
      o.sway = o.breath = o.look = o.nod = 0;
      return o;
    }
    const V = this.vars, vo = this.cVar, t = this.time;
    o.sway = noise(t * 0.45, V[vo + V_SA]) * scale;
    o.breath = Math.sin(t * 1.7 + V[vo + V_SB]) * scale;
    o.look = noise(t * 0.3, V[vo + V_SB]) * scale;
    o.nod = noise(t * 0.5, V[vo + V_SC]) * scale;
    return o;
  }
  private idleOut = { sway: 0, breath: 0, look: 0, nod: 0 };

  // --- locomotion: walk, run, stand, turn ---------------------------------------------

  private loco(dt: number) {
    const P = this.P, V = this.vars, vo = this.cVar;
    const s = this.s, u = this.u;
    const g = this.cG, r = this.cR, v = this.cV;
    const ph = this.phase[s];
    const lead = V[vo + V_LEAD];
    // Sappers running from a lit keg look back over their shoulder.
    const fleeing = u === SAPPER && this.time - this.fledAt[s] < 6 && v > 1;
    // Stance feet (standing) and the walk's feet, blended by the gait weight.
    const width = 0.125 + V[vo + V_WIDTH];
    const dirx = v > 0.05 ? this.cVs / v : 0, dirz = v > 0.05 ? this.cVf / v : 1;
    const L = this.cL;
    const beta = mix(0.62, 0.4, r);
    // The ankle sweeps back a little less than the body travels while the foot is down: the foot rolls from heel to toe.
    const sweep = 0.85 * beta * L;
    const back = this.cVf < -0.1 ? -1 : 1;
    const Af = sweep * 0.5 - 0.04 * back, Ab = sweep * 0.5 + 0.04 * back;
    const lift = (0.075 + 0.12 * r) * clamp(v / 1.2, 0.35, 1);
    const heel = 0.045 + 0.06 * r;
    const footW = mix(0.095, 0.065, r);
    let pelY = PELVIS_Y - 0.012 * g - 0.035 * r;
    // Running: lowest at mid-stance, highest in flight.
    pelY -= r * 0.028 * Math.cos(TAU * 2 * (ph - beta * 0.5));
    for (let side = 1; side >= -1; side -= 2) {
      const uu = frac(ph + (side > 0 ? 0 : 0.5));
      let along: number, y: number;
      if (uu < beta) {
        const st = uu / beta;
        along = Af - (Af + Ab) * st;
        y = SOLE + heel * smooth(0.55, 1, st);
      } else {
        const w = (uu - beta) / (1 - beta);
        along = -Ab + (Af + Ab) * w * w * (3 - 2 * w);
        y = (SOLE + heel) * (1 - w) + 0.02 * w + lift * Math.sin(Math.PI * w) * (1 - 0.3 * w);
      }
      const wx = side * footW + dirx * along, wz = dirz * along;
      const sx = side * width, sz = side === lead ? 0.07 : -0.04;
      const ai = side > 0 ? P_ANK_L : P_ANK_R;
      P[ai] = mix(sx, wx, g);
      P[ai + 1] = mix(SOLE, y, g);
      P[ai + 2] = mix(sz, wz, g);
      if (g > 0.01 && uu < beta) {
        // The stance leg must reach: the hips come down between steps.
        const hx = side * HIP_X - P[ai], hz = -P[ai + 2];
        const reach = 0.985 * LEG;
        const h2 = reach * reach - hx * hx - hz * hz;
        const maxPel = P[ai + 1] + Math.sqrt(Math.max(0.01, h2)) + HIP_DROP;
        pelY = smin(pelY, mix(PELVIS_Y + 0.1, maxPel, g), 0.04);
      }
    }
    // Weight, twist and list of the hips; shoulders against them.
    const c = Math.cos(TAU * ph);
    const sn = Math.sin(TAU * ph);
    const idle = this.idle(1 - g);
    const swayX = (0.022 * sn * (1 - r * 0.6)) * g + (0.028 * idle.sway + V[vo + V_LEAD] * 0.008) * (1 - g);
    const pTwist = -0.07 * (1 + r * 0.5) * c * g - clamp(this.cW * 0.02, -0.08, 0.08);
    const pRoll = 0.045 * sn * g * (1 - r * 0.5) + swayX * 1.4 * (1 - g);
    const load = (u === SAPPER && !this.kegless.has(this.id[s])) || (u === POWDER_BOY && this.a === A_KEG) ? 1 : 0;
    let lean = 0.035 + V[vo + V_LEAN] + 0.03 * Math.min(v, 2) * g + 0.14 * r + clamp(this.cAcc * 0.05, -0.1, 0.14) + load * 0.04;
    lean += 0.01 * idle.breath;
    let tTwist = 0.07 * (1 + r * 0.6) * c * g + clamp(this.cW * 0.06, -0.25, 0.25);
    let tRoll = load * -0.05 + 0.02 * sn * g;
    let hYaw = -tTwist * 0.8 + clamp(this.cW * 0.1, -0.45, 0.45) + 0.45 * idle.look;
    let hPitch = -lean * 0.7 + 0.06 * idle.nod;
    if (fleeing) {
      // A look back at the keg, once, about a second into the run.
      const k = this.time - this.fledAt[s];
      const look = smooth(0.6, 1.0, k) * (1 - smooth(1.6, 2.1, k));
      hYaw += look * 1.2 * lead;
      tTwist += look * 0.35 * lead;
      hPitch += look * 0.1;
    }
    this.trunk(swayX, pelY + 0.003 * idle.breath, 0, pTwist, pRoll, 0.02 * g, tTwist, tRoll, lean, hYaw, -tRoll * 0.5, hPitch);
    // Arms: swing against the legs, more when running; a hand busy with kit swings less or not at all.
    const A = (0.32 + 0.3 * r) * V[vo + V_ARMS] * g * clamp(v / 1.3, 0.4, 1.2);
    const swingL = -A * c, swingR = A * c;
    const bend = 0.25 + r * 1.1;
    const style = V[vo + V_STYLE];
    // Left arm.
    if (load) {
      // Steadying the keg on his left shoulder.
      this.shoulder(1);
      this.hand(1, this.rx + 0.02, this.ry + 0.2, this.rz + 0.12 + 0.02 * c * g, 0.5, -0.6, -0.4);
    } else if (u === MASON && style === 0 && g < 0.5) {
      // A mason at rest, a hand on his hip.
      this.shoulder(1);
      this.hand(1, this.rx - 0.06, this.ry - 0.42, this.rz - 0.02, 1, -0.2, -0.6);
    } else this.swingArm(1, swingL + 0.04 * idle.breath, bend, 0);
    // Right arm and the kit.
    if (u === PIKEMAN) this.pikeLoco(swingR, idle.sway, dt);
    else if (u === MUSKETEER) this.musketLoco(swingR);
    else if (u === MASON || u === CREW) {
      this.swingArm(-1, swingR * 0.7 + 0.05, bend + 0.35, 0.02);
      P[P_KIT_M] = KM_HAND;
      P[P_KIT_T] = u === MASON ? 0.3 : 0.2;
    } else if (u === POWDER_BOY) {
      // A powder boy: both arms free, nothing at his belt.
      this.swingArm(-1, swingR, bend, 0);
    } else {
      // A sapper: a free right arm, his hatchet at his belt.
      this.swingArm(-1, swingR, bend, 0);
      P[P_KIT_M] = KM_BELT;
    }
    if (load) this.keg(0.2, P[P_TOR + 1] + 0.36, P[P_TOR + 2] - 0.05, 0, 0, 0);
  }

  /** A pikeman's pike on the move: upright at his right side, its butt off the ground; grounded when he stands; slanted forward when he runs. */
  private pikeLoco(swing: number, sway: number, dt: number) {
    const P = this.P, s = this.s, g = this.cG, r = this.cR;
    const V = this.vars, vo = this.cVar;
    this.shoulder(-1);
    const sx = this.rx, sy = this.ry, sz = this.rz;
    // Walking: the hand at the hip, a little forward, the pike leaning forward and swaying with the step.
    const wx = sx - 0.05, wy = sy - 0.36 + 0.02 * Math.cos(TAU * this.phase[s] * 2), wz = sz + 0.15 + swing * 0.08;
    // Standing: the butt grounded by the right foot, the hand on the shaft at shoulder height; now and then he shifts his grip.
    const t = this.time;
    const grip = this.cLod === 0 ? frac(t / (6.5 + V[vo + V_SA] * 0.04) + V[vo + V_SB] * 0.01) : 0.5;
    const shift = grip < 0.08 ? Math.sin((grip / 0.08) * Math.PI) : 0;
    const stx = sx - 0.07, sty = sy - 0.18 + 0.08 * shift, stz = sz + 0.13;
    // Running: across the body, the point forward and up, both hands on it.
    const hx = mix(mix(stx, wx, g), sx + 0.05, r), hy = mix(mix(sty, wy, g), sy - 0.3, r), hz = mix(mix(stz, wz, g), sz + 0.28, r);
    this.hand(-1, hx, hy, hz, -0.4, -0.5, -1);
    // The pike's lean: forward with the walk, and its sway (a damped spring driven by the body's acceleration) near the camera.
    let pitch = mix(0.04 + 0.015 * sway, 0.11 + 0.025 * this.cV, g);
    let roll = mix(-0.04 - 0.02 * shift, -0.02, g);
    const o = s * 4, SP = this.sp;
    if (this.cLod === 0 && dt > 0) {
      const h = Math.min(dt, 1 / 30);
      for (let k = 0; k < 2; k++) {
        const target = k === 0 ? pitch : roll;
        const drive = k === 0 ? -this.cAcc * 0.05 + 0.25 * Math.sin(TAU * this.phase[s] * 2) * g : -this.cW * 0.03;
        const a = -70 * (SP[o + k * 2] - target) - 9 * SP[o + k * 2 + 1] + drive * 40;
        SP[o + k * 2 + 1] += a * h;
        SP[o + k * 2] += SP[o + k * 2 + 1] * h;
        SP[o + k * 2] = clamp(SP[o + k * 2], target - 0.25, target + 0.25);
      }
      pitch = SP[o];
      roll = SP[o + 2];
    } else {
      SP[o] = pitch;
      SP[o + 2] = roll;
      SP[o + 1] = SP[o + 3] = 0;
    }
    // Direction: up, tipped forward by pitch and outward by roll; slanting to 50 degrees when he runs.
    const run = r * 0.85;
    const dx = -Math.sin(roll) * (1 - run) - 0.12 * run, dy = Math.cos(pitch + run) * Math.cos(roll), dz = Math.sin(pitch + run);
    // The butt: below the hand along the pike; grounded when standing.
    const below = mix(mix(hy - 0.0, hy - 0.17, g), 0.75, r);
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const k = below / (dy / l);
    this.kit(KM_FREE, hx - (dx / l) * k, hy - below, hz - (dz / l) * k, dx, dy, dz);
    if (r > 0.01) {
      // The left hand comes over to the shaft when he runs.
      const lx = P[P_HAND_L], ly = P[P_HAND_L + 1], lz = P[P_HAND_L + 2];
      const ax = hx + (dx / l) * 0.45, ay = hy + (dy / l) * 0.45, az = hz + (dz / l) * 0.45;
      this.hand(1, mix(lx, ax, r), mix(ly, ay, r), mix(lz, az, r), 0.5, -0.6, -0.6);
    }
  }

  /** A musketeer on the move: the musket at the slope on his right shoulder; at order (butt grounded) when he stands. */
  private musketLoco(swing: number) {
    const g = this.cG;
    this.shoulder(-1);
    const sx = this.rx, sy = this.ry, sz = this.rz;
    // Slope: butt in the hand at the hip, the barrel up and back over the shoulder.
    const hx = mix(sx - 0.02, sx + 0.01, g), hy = mix(sy - 0.33, sy - 0.4, g), hz = mix(sz + 0.12, sz + 0.13 + swing * 0.03, g);
    this.hand(-1, hx, hy, hz, -0.5, -0.4, -1);
    // Order: butt on the ground beside the right foot, the barrel up past the hand; the hand holds it near the muzzle.
    const ox = sx - 0.08, oz = sz + 0.16;
    const odx = 0.02, ody = 1, odz = -0.06;
    const sdx = 0.04, sdy = 0.87 + swing * 0.05, sdz = -0.5;
    const t = g;
    const ax = mix(ox, hx + 0.03, t), ay = mix(0.02, hy + 0.02, t), az = mix(oz, hz, t);
    this.kit(KM_FREE, ax, ay, az, mix(odx, sdx, t), mix(ody, sdy, t), mix(odz, sdz, t));
    if (g < 0.99) {
      // At order the hand moves up the barrel.
      const P = this.P;
      const k = 1 - g;
      P[P_HAND_R] = mix(P[P_HAND_R], ox + 0.04, k);
      P[P_HAND_R + 1] = mix(P[P_HAND_R + 1], 1.0, k);
      P[P_HAND_R + 2] = mix(P[P_HAND_R + 2], oz - 0.02, k);
    }
  }

  /** Turning on the spot: the feet step round in turn instead of the figure spinning on its heels. */
  private turnSteps(weight: number) {
    const tw = Math.abs(this.cW);
    const amp = clamp((tw - 0.3) / 2.2, 0, 1) * weight;
    if (amp < 0.01) return;
    const P = this.P;
    const ps = this.shuffle[this.s];
    const dir = this.cW > 0 ? 1 : -1;
    for (let side = 1; side >= -1; side -= 2) {
      const uu = frac(ps + (side > 0 ? 0 : 0.5));
      const ai = side > 0 ? P_ANK_L : P_ANK_R;
      // Swing for the first half (lift and catch up with the body), planted for the second (the body turns over it).
      let ang: number, lift = 0;
      if (uu < 0.5) {
        const w = uu / 0.5;
        ang = -0.35 + 0.7 * w * w * (3 - 2 * w);
        lift = Math.sin(Math.PI * w) * 0.07;
      } else ang = 0.35 - 0.7 * ((uu - 0.5) / 0.5);
      ang *= dir * amp;
      const x = P[ai], z = P[ai + 2];
      const c = Math.cos(ang), s = Math.sin(ang);
      P[ai] = x * c + z * s;
      P[ai + 2] = -x * s + z * c;
      P[ai + 1] += lift * amp;
    }
  }

  /** A parry or a flinch: the point beaten aside, the body pulled back (an enemy's blow came at him and missed). */
  private parry() {
    const k = (this.time - this.parryAt[this.s]) / 0.38;
    if (k < 0 || k >= 1) return;
    const P = this.P;
    const e = Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - k);
    const side = this.parrySide[this.s];
    P[P_TOR_A + 2] -= 0.16 * e;
    P[P_TOR + 2] -= 0.05 * e;
    P[P_PEL + 2] -= 0.04 * e;
    P[P_HEAD_A + 2] -= 0.22 * e;
    P[P_HEAD_A] += 0.2 * side * e;
    // The front hand (and so the point) knocked aside and up.
    P[P_HAND_L] += 0.12 * side * e;
    P[P_HAND_L + 1] += 0.06 * e;
    if (P[P_KIT_M] === KM_FREE) {
      P[P_KIT_D] += 0.12 * side * e;
      P[P_KIT_D + 1] += 0.05 * e;
      norm(P, P_KIT_D);
    }
  }

  // --- fighting ----------------------------------------------------------------------------

  /**
   * Levelled weapon (a pike, or a musket for a jab) at an enemy or a gate:
   * guard, a wind-up as the next blow comes due, the thrust when the blow
   * lands (act goes back to zero), a recovery. At a gate, the whole body
   * drives the pike in, and the blow jars back.
   */
  private fight(gate: boolean) {
    const P = this.P, u = this.u;
    const V = this.vars, vo = this.cVar;
    const act = this.cAct;
    const musket = u === MUSKETEER;
    const bMin = BLOW_MIN[u] || 70, bMax = BLOW_MAX[u] || 110;
    // The thrust: out in 3 ticks, held, back by 26.
    const out = act < 3 ? smooth(0, 3, act) : act < 8 ? 1 : 1 - smooth(8, 26, act);
    // Has he struck in this fight yet? If so the next blow is due bMin..bMax after the last, else readyMin after he closed.
    const struck = act <= this.actTicks[this.s] + 1;
    const due = struck ? act : this.cAT * 60 + bMin - READY_MIN[u];
    let wind = smooth(bMin - 18, bMin - 2, due) * (1 - smooth(bMax + 12, bMax + 40, due));
    if (act < 26) wind = 0;
    // Waiting cocked: small feints and a tremble.
    const t = this.time;
    const probe = this.cLod < 2 ? Math.sin(t * 2.3 + V[vo + V_SA]) * 0.04 * (1 - wind) + Math.sin(t * 13 + V[vo + V_SB]) * 0.006 * wind : 0;
    const k = gate ? 1.5 : 1;
    // Body: back on the rear foot in the wind-up, driving forward in the thrust.
    const drive = out * 0.6 * k - wind * 0.22 * k + probe;
    // At a gate the point stops hard against the timber: a jolt back after the impact.
    const jolt = gate && act >= 3 && act < 14 ? Math.sin(((act - 3) / 11) * Math.PI) * 0.1 : 0;
    const reach = drive - jolt;
    const drop = 0.06 + out * 0.05 * k + wind * 0.02;
    const pz = 0.02 + reach * 0.22;
    const lean = 0.14 + reach * 0.22 + V[vo + V_LEAN];
    // Feet braced: left forward, right back; at the gate a longer lunge.
    const fl = musket ? 0.26 : 0.3 * (gate ? 1.15 : 1), fr = musket ? -0.22 : -0.26 * (gate ? 1.2 : 1);
    this.feet(0.14, fl, -0.13, fr);
    // The rear heel comes up in the thrust.
    P[P_ANK_R + 1] += out * 0.05 * k;
    this.trunk(0, PELVIS_Y - drop, pz, -0.28 + out * 0.1, 0.02, 0.03, -0.22 + out * 0.18 - wind * 0.08, 0.02, lean, 0.25 - out * 0.1, 0, -lean * 0.6 + 0.05);
    // Hands on the shaft along his right side: rear at the hip, front ahead, both driven out in the thrust.
    const shaftX = -0.16;
    const rearZ = -0.04 + reach * 0.75, frontZ = (musket ? 0.34 : 0.42) + reach * 0.75;
    const rearY = (gate ? 1.0 : 1.05) - drop + wind * 0.05, frontY = (gate ? 1.08 : 1.16) - drop + wind * 0.02;
    this.hand(1, shaftX + 0.04, frontY, frontZ, 0.6, -1, -0.15);
    this.hand(-1, shaftX, rearY, rearZ, -0.6, -1, -0.15);
    let dx = 0, dy = frontY - rearY, dz = frontZ - rearZ;
    const l = Math.sqrt(dy * dy + dz * dz) || 1;
    dy /= l;
    dz /= l;
    dx = 0.01;
    if (musket) {
      // The musket in both hands, the butt just behind the rear hand.
      this.kit(KM_FREE, shaftX, rearY - dy * 0.28, rearZ - dz * 0.28, dx, dy, dz);
    } else {
      // The butt a metre behind the rear hand.
      this.kit(KM_FREE, shaftX, rearY - dy * 1.0, rearZ - dz * 1.0, dx, dy, dz);
    }
  }

  /** A ladder crewman's axe (or a sapper's hatchet): guard, wind-up overhead, a chop as the blow lands, recovery. */
  private chop() {
    const P = this.P, u = this.u;
    const act = this.cAct;
    const bMin = BLOW_MIN[u] || 60, bMax = BLOW_MAX[u] || 95;
    const struck = act <= this.actTicks[this.s] + 1;
    const due = struck ? act : this.cAT * 60 + bMin - READY_MIN[u];
    let wind = smooth(bMin - 16, bMin - 2, due) * (1 - smooth(bMax + 12, bMax + 40, due));
    if (act < 24) wind = 0;
    // The chop: down in 4 ticks, follow-through, back up to guard.
    const down = act < 4 ? smooth(0, 4, act) : 1 - smooth(10, 24, act);
    const guard = 1.35;
    const a = mix(mix(guard, 2.75, wind), 0.35, down);
    const drop = 0.07 + down * 0.05;
    const lean = 0.12 + down * 0.25 - wind * 0.08;
    this.feet(0.14, 0.24, -0.13, -0.2);
    this.trunk(0, PELVIS_Y - drop, 0.02 + down * 0.05, -0.15 + down * 0.15, 0, 0.02, -0.25 * wind + 0.2 * down, 0, lean, 0.15 - 0.2 * down, 0, -lean * 0.5 + 0.08);
    // Left fist forward as a guard.
    this.shoulder(1);
    this.hand(1, this.rx - 0.06, this.ry - 0.2, this.rz + 0.3, 0.6, -1, -0.3);
    // Right arm: the axe swung on an arc from overhead behind to low in front.
    this.shoulder(-1);
    this.hand(-1, this.rx + 0.05, this.ry - Math.cos(a) * 0.5, this.rz + Math.sin(a) * 0.5, -0.8, -0.3, -0.6);
    P[P_KIT_M] = KM_HAND;
    P[P_KIT_T] = -0.35 - wind * 0.4;
    if (u === SAPPER && !this.kegless.has(this.id[this.s])) this.keg(0.2, P[P_TOR + 1] + 0.36, P[P_TOR + 2] - 0.05, 0, 0, 0);
  }

  // --- powder boys -------------------------------------------------------------------------------

  /** A powder boy at the foot of a gun, hauling a keg up on its rope hand over hand: feet braced, leaning back, the hands one over the other at the rope, pulling down in turn (HAUL_TICKS a pull). */
  private hoist() {
    const P = this.P;
    const act = this.cAct;
    const u = (act % HAUL_TICKS) / HAUL_TICKS;
    const hands = haulHands(act);
    const V = this.vars, vo = this.cVar;
    this.feet(0.16, 0.2, -0.16, -0.14);
    const dip = 0.02 + 0.03 * Math.sin(TAU * u);
    const lean = -0.12 + V[vo + V_LEAN];
    this.trunk(0, PELVIS_Y - 0.05 - dip, -0.04, 0.05 * Math.sin(TAU * u), 0, -0.02, 0.1 * Math.sin(TAU * u), 0, lean, 0, 0, -0.35);
    // The rope hangs in front of his face; each hand reaches up, takes it and pulls down to the hip.
    this.shoulder(1);
    this.hand(1, this.rx - 0.1, this.ry - 0.55 + hands.left * 0.75, this.rz + 0.3 - (1 - hands.left) * 0.05, 0.8, -0.8, -0.3);
    this.shoulder(-1);
    this.hand(-1, this.rx + 0.1, this.ry - 0.55 + hands.right * 0.75, this.rz + 0.3 - (1 - hands.right) * 0.05, -0.8, -0.8, -0.3);
    P[P_KIT_M] = KM_NONE;
    void P;
  }

  // --- the masons -----------------------------------------------------------------------------

  /** A mason at work: the chisel held to the stone in his left hand, the mallet raised and brought down on it once a stroke. */
  private masonWork() {
    const P = this.P;
    const t = this.cAct % MALLET_STROKE;
    // Raise (0..9), strike (9..14), a bounce off the chisel, rest, raise again.
    let a: number;
    if (t < 9) a = mix(1.0, 2.55, smooth(0, 9, t));
    else if (t < MALLET_HIT) a = mix(2.55, 0.82, ((t - 9) / (MALLET_HIT - 9)) ** 1.6);
    else if (t < MALLET_HIT + 6) a = 0.82 + Math.sin(((t - MALLET_HIT) / 6) * Math.PI) * 0.18;
    else a = mix(0.82, 1.0, smooth(MALLET_HIT + 6, MALLET_STROKE, t));
    const hit = t >= MALLET_HIT && t < MALLET_HIT + 5 ? 1 - (t - MALLET_HIT) / 5 : 0;
    const raise = smooth(0, 9, t) * (1 - smooth(9, MALLET_HIT, t));
    const V = this.vars, vo = this.cVar;
    this.feet(0.15, 0.16, -0.15, -0.12);
    const lean = 0.22 + V[vo + V_LEAN] + hit * 0.04 - raise * 0.04;
    this.trunk(0, PELVIS_Y - 0.06 - hit * 0.015, 0.02, -0.05, 0, 0.04, -0.12 * raise + 0.06 * hit, 0.02, lean, 0.05, 0, 0.3 - lean * 0.3 + hit * 0.06);
    // The chisel hand at the stone; it shifts a little between strokes.
    const shift = this.cLod === 0 ? Math.sin(this.time * 0.9 + V[vo + V_SA]) * 0.02 : 0;
    this.hand(1, 0.06 + shift, 1.13 + hit * -0.015, 0.46, 0.8, -0.6, -0.3);
    this.shoulder(-1);
    this.hand(-1, -0.2, this.ry - Math.cos(a) * 0.47, this.rz + Math.sin(a) * 0.47, -0.8, -0.2, -0.6);
    P[P_KIT_M] = KM_HAND;
    P[P_KIT_T] = -0.5;
  }

  // --- ladder crews and climbers ------------------------------------------------------------------

  /** Carrying the ladder on the right shoulder: both hands up on its rails, a heavier, shorter step (the legs come from the walk). */
  private carry() {
    // Legs and trunk from the walk, then the arms on the ladder (it rides steady at 1.62 m; the shoulders bob under it).
    this.loco(0);
    const P = this.P;
    const g = this.cG;
    P[P_PEL + 1] -= 0.025 * g;
    P[P_TOR + 1] -= 0.025 * g;
    P[P_TOR_A + 1] = 0.06;
    P[P_TOR_A + 2] += 0.05;
    P[P_TOR_A] *= 0.4;
    P[P_PEL_A] *= 0.6;
    P[P_HEAD_A] = 0.1;
    P[P_HEAD_A + 1] = -0.08;
    this.hand(-1, -0.42, 1.6, 0.08, -0.6, -0.4, -0.8);
    this.hand(1, -0.08, 1.58, 0.24, 0.8, -0.6, -0.2);
    P[P_KIT_M] = this.slung();
    P[P_SCALE] = 1;
  }

  /** Raising a ladder: crouched and heaving it up from the ground, then pushing it up over the head and on towards the wall (2 s). */
  private raise() {
    const k = clamp(this.cAT / 2, 0, 1);
    // Hands follow the ladder: low at first, overhead at about two thirds, then pushed forward.
    const lift = smooth(0.12, 0.62, k);
    const push = smooth(0.6, 0.95, k);
    const crouch = (1 - smooth(0.05, 0.55, k)) * smooth(0, 0.1, k);
    const hy = mix(0.55, 2.0, lift) + push * 0.08;
    const hz = mix(0.18, 0.3, lift) + push * 0.32;
    this.feet(0.15, 0.2, -0.15, -0.22);
    const P = this.P;
    P[P_ANK_R + 1] += push * 0.06;
    const lean = mix(0.45, -0.08, lift) + push * 0.3;
    this.trunk(0, PELVIS_Y - 0.03 - crouch * 0.28, -crouch * 0.05 + push * 0.06, 0, 0, 0.1 * crouch, 0, 0, lean, 0, 0, -0.3 * lift + 0.1);
    this.hand(1, 0.2, hy, hz, 0.8, -0.8, -0.2);
    this.hand(-1, -0.2, hy + 0.03, hz, -0.8, -0.8, -0.2);
    P[P_KIT_M] = this.slung();
    P[P_SCALE] = 1;
  }

  /**
   * Up a ladder (it leans at about 71 degrees, its rung line 0.22 m in front
   * of his feet): hand over hand on the rungs, feet stepping up in turn, the
   * body at arm's length; each limb holds still against the ladder while
   * the body rises past it, then moves up two rungs.
   */
  private ladder() {
    const P = this.P;
    // Climb cycle: one per metre along the ladder; each limb moves once a cycle, two rungs up.
    const c = (this.cY - this.cGround) / 0.944;
    for (let limb = 0; limb < 4; limb++) {
      const handLimb = limb < 2;
      const side = limb % 2 === 0 ? 1 : -1;
      // Diagonal pairs move together: the left hand with the right foot.
      const off = handLimb ? (side > 0 ? 0 : 0.5) : side > 0 ? 0.5 : 0;
      const uu = frac(c + off);
      const top = handLimb ? 1.52 : 0.4;
      let h: number, outz = 0;
      if (uu < 0.5) h = top - 0.944 * uu;
      else {
        const w = (uu - 0.5) / 0.5;
        h = top - 0.472 + 0.472 * w * w * (3 - 2 * w);
        outz = Math.sin(Math.PI * w) * (handLimb ? 0.07 : 0.1);
      }
      const lz = 0.22 + 0.348 * h;
      if (handLimb) this.hand(side, side * 0.2, h, lz - 0.02 - outz, side * 0.9, -0.5, -0.5);
      else this.set3(side > 0 ? P_ANK_L : P_ANK_R, side * 0.12, h, lz - 0.03 - outz);
    }
    // The body parallel to the ladder, 0.32 m off it; his weight shifts towards the pushing leg.
    const sway = Math.sin(TAU * c) * 0.03;
    const py = 0.78;
    this.trunk(sway, py, 0.22 + 0.348 * py - 0.34, sway * -2, sway * 2, 0.25, -sway, 0, 0.335, 0, 0, -0.25 + 0.06 * Math.sin(TAU * c * 0.5));
    P[P_KIT_M] = this.slung();
    P[P_SCALE] = 1;
  }

  /** Down the rope inside the wall, facing it: hand under hand, legs round the rope, sliding fast. */
  private rope() {
    const P = this.P;
    const c = (this.cY - this.cGround) / 0.9;
    for (let side = 1; side >= -1; side -= 2) {
      const uu = frac(c + (side > 0 ? 0 : 0.5));
      // Each hand holds while the body slides down past it (so it rises against him), then moves down below the other.
      let h: number;
      if (uu < 0.5) h = 1.5 + 0.35 * (uu / 0.5);
      else {
        const w = (uu - 0.5) / 0.5;
        h = 1.85 - 0.35 * w * w * (3 - 2 * w);
      }
      this.hand(side, side * 0.03, h, 0.2, side * 0.9, -0.6, -0.3);
    }
    // Legs round the rope: knees forward and bent, feet crossed on it.
    this.set3(P_ANK_L, 0.03, 0.18, 0.2);
    this.set3(P_ANK_R, -0.03, 0.12, 0.17);
    this.trunk(0, 0.86, -0.06, 0, 0, -0.1, 0, 0, -0.08, 0.3 * Math.sin(this.time * 0.8), 0, 0.35);
    P[P_KIT_M] = this.slung();
    P[P_SCALE] = 1;
  }

  // --- sappers ----------------------------------------------------------------------------------

  /**
   * Setting the keg (75 ticks): he kneels and swings it off his shoulder to
   * stand against the wall, packs it, strikes a light, lights the fuse and
   * starts to rise; the keg is where the burning one will stand.
   */
  private plant() {
    const P = this.P;
    const t = this.cAct;
    const kneel = smooth(0, 14, t) * (1 - smooth(69, 75, t) * 0.5);
    // Feet: left forward, flat; right knee down behind.
    this.set3(P_ANK_L, 0.13, SOLE, mix(0.06, 0.24, kneel));
    this.set3(P_ANK_R, -0.13, mix(SOLE, 0.05, kneel), mix(-0.04, -0.42, kneel));
    const lean = mix(0.08, 0.38, kneel);
    this.trunk(0, PELVIS_Y - kneel * 0.42, -kneel * 0.06, 0, 0, 0.05, 0, 0, lean, 0, 0, 0.25 * kneel);
    // The keg: off the left shoulder (lying across it) to standing on the ground in front.
    const down = smooth(2, 16, t);
    const kx = mix(0.2, 0, down), ky = mix(P[P_TOR + 1] + 0.36, 0.23, down), kz = mix(-0.05, 0.3, down);
    const arc = Math.sin(down * Math.PI) * 0.18;
    this.keg(kx, ky + arc, kz + arc * 0.5, 0, mix(0, Math.PI / 2, down), 0);
    // Hands: on the keg as it comes down and while he packs it, then flint and steel, then the fuse.
    // Each step eases into the next over a few ticks.
    const pack = t > 18 ? Math.sin((t - 18) * 0.7) * 0.03 : 0;
    const strike = t > 40 ? Math.abs(Math.sin((t - 40) * 0.9)) * 0.07 : 0;
    const w1 = smooth(37, 42, t), w2 = smooth(55, 60, t), w3 = smooth(68, 73, t);
    // On the keg; striking a light over the fuse (the right hand strikes down on the left); the light held to the fuse on top; rising.
    const lx = mix(mix(mix(kx + 0.2, 0.04, w1), 0.18, w2), 0.22, w3);
    const ly = mix(mix(mix(ky + arc + 0.05, 0.62, w1), 0.5, w2), 0.75, w3);
    const lz = mix(mix(mix(kz + arc * 0.5 - 0.05 + pack, 0.24, w1), 0.12, w2), 0.08, w3);
    const rx = mix(mix(mix(kx - 0.2, -0.04, w1), -0.02, w2), -0.2, w3);
    const ry = mix(mix(mix(ky + arc + 0.05, 0.66 + strike, w1), 0.5, w2), 0.8, w3);
    const rz = mix(mix(mix(kz + arc * 0.5 - 0.05 - pack, 0.22, w1), 0.28, w2), 0.1, w3);
    this.hand(1, lx, ly, lz, 0.8, -0.3, -0.5);
    this.hand(-1, rx, ry, rz, -0.8, -0.3, -0.5);
    P[P_KIT_M] = this.slung();
  }

  // --- musketeers --------------------------------------------------------------------------------

  /**
   * Aiming and firing, and the reload between shots (act counts from the
   * shot; a reload takes at least 255 ticks, then 30 of aiming): the kick,
   * down to the ground, a cartridge bitten and poured, the ramrod drawn,
   * three strokes, the rod back, the pan primed, up to the shoulder, aim.
   */
  private aim() {
    const P = this.P, V = this.vars, vo = this.cVar;
    const t = this.cAct;
    const kick = t < RECOIL ? Math.sin((t / RECOIL) * Math.PI) * (1 - t / RECOIL) : 0;
    // Down to the reload (butt grounded), up to make ready, then present: to the shoulder again.
    const down = smooth(14, 36, t);
    const ready = smooth(166, 196, t);
    const present = smooth(196, 230, t);
    const lower = down * (1 - present);
    // Feet: side-on, left forward.
    this.feet(0.13, 0.2, -0.12, -0.16);
    const sway = this.cLod < 2 ? noise(this.time * 0.9, V[vo + V_SA]) : 0;
    const breath = Math.sin(this.time * 1.6 + V[vo + V_SB]);
    const aimW = 1 - lower;
    const lean = mix(0.06 - kick * 0.12, 0.1, lower) + V[vo + V_LEAN];
    this.trunk(0, PELVIS_Y - 0.01 - lower * 0.03, 0, -0.18 * aimW, 0, 0.02, -0.3 * aimW + 0.004 * sway, 0, lean, 0.12 * aimW, 0.22 * aimW - kick * 0.1, -0.02 - kick * 0.15 + lower * 0.3);
    // Aimed: the butt at the right shoulder, the barrel along the left hand at the mark.
    const ay = 1.42 + kick * 0.05 + 0.006 * breath * aimW, az = 0.06 - kick * 0.1;
    const apitch = -0.03 - kick * 0.35 + 0.006 * sway;
    const adx = -0.004 * sway, ady = Math.sin(-apitch), adz = Math.cos(apitch);
    // At the reload: the musket upright in front of his right side, butt on the ground.
    const rdx = 0.02, rdy = 1, rdz = 0.1;
    // Make ready: across the waist, muzzle up and forward.
    const mdx = 0.15, mdy = 0.7, mdz = 0.7;
    const dx = mix(mix(mix(adx, rdx, down), mdx, ready), adx, present), dy = mix(mix(mix(ady, rdy, down), mdy, ready), ady, present), dz = mix(mix(mix(adz, rdz, down), mdz, ready), adz, present);
    const bx = mix(mix(-0.1, -0.15, ready), -0.1, present), by = mix(mix(mix(ay, 0.02, down), 0.82, ready), ay, present), bz = mix(mix(mix(az - 0.1, 0.24, down), 0.0, ready), az - 0.1, present);
    this.kit(KM_FREE, bx, by, bz, dx, dy, dz);
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const ux = dx / l, uy = dy / l, uz = dz / l;
    // Hands: the left supports the barrel (0.6 m up it), the right at the lock; the reload is the right hand's work.
    const la = mix(0.6, 1.0, lower);
    this.hand(1, bx + ux * la + 0.08 * aimW, by + uy * la - 0.02, bz + uz * la, 0.7, -1, -0.2);
    let rx = bx + ux * 0.14, ry = by + uy * 0.14 - 0.02 * aimW, rz = bz + uz * 0.14 + 0.05 * aimW;
    const muzzle = 1.43;
    const mx = bx + ux * muzzle, my = by + uy * muzzle, mz = bz + uz * muzzle;
    if (lower > 0.5 && t >= 36 && t < 196) {
      // The reload, with the musket grounded (the muzzle about at his chin).
      let ramrod = 0;
      if (t < 48) {
        // To the cartridge box at his right hip.
        const k = smooth(36, 46, t);
        rx = mix(rx, -0.2, k);
        ry = mix(ry, 0.92, k);
        rz = mix(rz, -0.02, k);
      } else if (t < 56) {
        // Bite it open.
        const k = smooth(48, 54, t);
        rx = mix(-0.2, -0.05, k);
        ry = mix(0.92, 1.56, k);
        rz = mix(-0.02, 0.14, k);
      } else if (t < 74) {
        // Pour it down the barrel.
        const k = smooth(56, 62, t);
        rx = mix(-0.05, mx - 0.02, k);
        ry = mix(1.56, my + 0.1 + Math.sin(t * 1.3) * 0.015 * k, k);
        rz = mix(0.14, mz, k);
      } else if (t < 90) {
        // Draw the ramrod from under the barrel.
        const k = smooth(74, 80, t), k2 = smooth(80, 90, t);
        rx = mx - 0.04;
        ry = mix(mix(my + 0.1, by + uy * 0.9, k), my + 0.75, k2);
        rz = mz + 0.03;
        ramrod = k2;
      } else if (t < 150) {
        // Ram it home: three strokes.
        const k = (t - 90) / 20;
        const stroke = 0.5 - 0.5 * Math.cos(TAU * frac(k));
        rx = mx;
        ry = my + 0.06 + (1 - stroke) * 0.4;
        rz = mz;
        ramrod = 1;
      } else if (t < 166) {
        // Back under the barrel.
        const k = smooth(150, 158, t), k2 = smooth(158, 166, t);
        rx = mx - 0.04;
        ry = mix(mix(my + 0.46, my + 0.75, k), by + uy * 0.9, k2);
        rz = mz + 0.03;
        ramrod = 1 - k2;
      }
      if (ramrod > 0.02) {
        // The rod from the hand down into the barrel (it goes in as the hand comes down).
        P[P_ROD_ON] = 1;
        this.set3(P_ROD_D, ux, uy, uz);
        const len = 1.0;
        this.set3(P_ROD, rx - ux * len, ry - uy * len, rz - uz * len);
      }
    } else if (ready > 0.3 && present < 0.6) {
      // Priming the pan and cocking: the right hand at the lock.
      rx = bx + ux * 0.5 - 0.05;
      ry = by + uy * 0.5 + 0.03;
      rz = bz + uz * 0.5;
    }
    this.hand(-1, rx, ry, rz, -0.7, -1, -0.3);
  }

  // --- solving ----------------------------------------------------------------------------

  /** Rotate (x, y, z) by the quaternion in qx..qw: into rx, ry, rz. */
  private rot(x: number, y: number, z: number) {
    const qx = this.qx, qy = this.qy, qz = this.qz, qw = this.qw;
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    this.rx = x + qw * tx + qy * tz - qz * ty;
    this.ry = y + qw * ty + qz * tx - qx * tz;
    this.rz = z + qw * tz + qx * ty - qy * tx;
  }

  /** Two-bone IK: the middle joint for an end at e from a root at r (lengths a, b), bending towards the pole. Writes it at j[o]; pulls e in when out of reach. */
  private ik(r: number, e: number, a: number, b: number, px: number, py: number, pz: number, o: number) {
    const J = this.j;
    let dx = J[e] - J[r], dy = J[e + 1] - J[r + 1], dz = J[e + 2] - J[r + 2];
    let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const max = (a + b) * 0.999;
    if (d > max) {
      const k = max / d;
      dx *= k;
      dy *= k;
      dz *= k;
      J[e] = J[r] + dx;
      J[e + 1] = J[r + 1] + dy;
      J[e + 2] = J[r + 2] + dz;
      d = max;
    }
    if (d < 1e-4) {
      J[o] = J[r];
      J[o + 1] = J[r + 1] - a;
      J[o + 2] = J[r + 2];
      return;
    }
    const along = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - along * along));
    const ux = dx / d, uy = dy / d, uz = dz / d;
    // The pole, square to the limb.
    const pd = px * ux + py * uy + pz * uz;
    let qx = px - ux * pd, qy = py - uy * pd, qz = pz - uz * pd;
    const ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (ql < 1e-5) {
      qx = 0;
      qy = 0;
      qz = 1;
    } else {
      qx /= ql;
      qy /= ql;
      qz /= ql;
    }
    J[o] = J[r] + ux * along + qx * h;
    J[o + 1] = J[r + 1] + uy * along + qy * h;
    J[o + 2] = J[r + 2] + uz * along + qz * h;
  }

  /** Joints from the pose and the figure's world transform: every part and piece of kit into xf. */
  private solve(s: number, x: number, y: number, z: number, yaw: number) {
    const P = this.pose, o = s * POSE_N;
    const X = this.xf, xo = s * XF_N;
    const J = this.j;
    const sc = P[o + P_SCALE];
    const build = this.vars[s * VAR_N + V_BUILD];
    const hs = Math.sin(yaw * 0.5), hc = Math.cos(yaw * 0.5);
    const ys = Math.sin(yaw), yc = Math.cos(yaw);
    let shows = 0;
    // Local joints: 0 hipL, 3 kneeL, 6 ankleL, 9 hipR, 12 kneeR, 15 ankleR, 18 shL, 21 elL, 24 handL, 27 shR, 30 elR, 33 handR.
    euler(P[o + P_PEL_A], P[o + P_PEL_A + 1], P[o + P_PEL_A + 2], this);
    const pqx = this.qx, pqy = this.qy, pqz = this.qz, pqw = this.qw;
    for (let side = 1; side >= -1; side -= 2) {
      const h = side > 0 ? 0 : 9;
      this.rot(side * HIP_X, -HIP_DROP, 0);
      J[h] = P[o + P_PEL] + this.rx;
      J[h + 1] = P[o + P_PEL + 1] + this.ry;
      J[h + 2] = P[o + P_PEL + 2] + this.rz;
      const ai = side > 0 ? P_ANK_L : P_ANK_R;
      J[h + 6] = P[o + ai];
      J[h + 7] = P[o + ai + 1];
      J[h + 8] = P[o + ai + 2];
      // Knees forward (with the hips' twist) and a little out.
      this.rot(side * 0.15, 0, 1);
      this.ik(h, h + 6, THIGH, SHIN, this.rx, this.ry, this.rz, h + 3);
    }
    // Pelvis: its capsule lies across the hips.
    this.put(X, xo + PELVIS * XF_STRIDE, P[o + P_PEL], P[o + P_PEL + 1], P[o + P_PEL + 2], pqx, pqy, pqz, pqw, true, sc, sc * build, sc * build, sc * build, x, y, z, hs, hc, ys, yc);
    euler(P[o + P_TOR_A], P[o + P_TOR_A + 1], P[o + P_TOR_A + 2], this);
    const tqx = this.qx, tqy = this.qy, tqz = this.qz, tqw = this.qw;
    this.put(X, xo + TORSO * XF_STRIDE, P[o + P_TOR], P[o + P_TOR + 1], P[o + P_TOR + 2], tqx, tqy, tqz, tqw, false, sc, sc * build, sc, sc * build, x, y, z, hs, hc, ys, yc);
    for (let side = 1; side >= -1; side -= 2) {
      const h = side > 0 ? 18 : 27;
      this.qx = tqx;
      this.qy = tqy;
      this.qz = tqz;
      this.qw = tqw;
      this.rot(side * SHOULDER_X * (0.94 + build * 0.06), SHOULDER_UP, 0);
      J[h] = P[o + P_TOR] + this.rx;
      J[h + 1] = P[o + P_TOR + 1] + this.ry;
      J[h + 2] = P[o + P_TOR + 2] + this.rz;
      const hi = side > 0 ? P_HAND_L : P_HAND_R, pi = side > 0 ? P_POLE_L : P_POLE_R;
      J[h + 6] = P[o + hi];
      J[h + 7] = P[o + hi + 1];
      J[h + 8] = P[o + hi + 2];
      this.ik(h, h + 6, UPPER, FORE, P[o + pi], P[o + pi + 1], P[o + pi + 2], h + 3);
    }
    // Neck and head.
    this.qx = tqx;
    this.qy = tqy;
    this.qz = tqz;
    this.qw = tqw;
    this.rot(0, 0.3, 0.02);
    const nx = P[o + P_TOR] + this.rx, ny = P[o + P_TOR + 1] + this.ry, nz = P[o + P_TOR + 2] + this.rz;
    euler(P[o + P_HEAD_A], P[o + P_HEAD_A + 1], P[o + P_HEAD_A + 2], this);
    const hqx = this.qx, hqy = this.qy, hqz = this.qz, hqw = this.qw;
    this.rot(0, 0.1, 0.02);
    const hx = nx + this.rx, hy = ny + this.ry, hz = nz + this.rz;
    this.put(X, xo + HEAD * XF_STRIDE, hx, hy, hz, hqx, hqy, hqz, hqw, false, sc, sc, sc, sc, x, y, z, hs, hc, ys, yc);
    this.rot(0, 0.05, 0);
    this.put(X, xo + XF_HEAD_GEAR, hx + this.rx, hy + this.ry, hz + this.rz, hqx, hqy, hqz, hqw, false, sc, sc, sc, sc, x, y, z, hs, hc, ys, yc);
    // Limbs as segments.
    this.seg(X, xo + THIGH_L * XF_STRIDE, 0, 3, sc, 1, x, y, z, hs, hc, ys, yc);
    this.seg(X, xo + SHIN_L * XF_STRIDE, 3, 6, sc, SHIN_STRETCH, x, y, z, hs, hc, ys, yc);
    this.seg(X, xo + THIGH_R * XF_STRIDE, 9, 12, sc, 1, x, y, z, hs, hc, ys, yc);
    this.seg(X, xo + SHIN_R * XF_STRIDE, 12, 15, sc, SHIN_STRETCH, x, y, z, hs, hc, ys, yc);
    this.seg(X, xo + UARM_L * XF_STRIDE, 18, 21, sc, 1, x, y, z, hs, hc, ys, yc);
    this.seg(X, xo + LARM_L * XF_STRIDE, 21, 24, sc, 1, x, y, z, hs, hc, ys, yc);
    this.seg(X, xo + UARM_R * XF_STRIDE, 27, 30, sc, 1, x, y, z, hs, hc, ys, yc);
    this.seg(X, xo + LARM_R * XF_STRIDE, 30, 33, sc, 1, x, y, z, hs, hc, ys, yc);
    // Kit.
    const mode = P[o + P_KIT_M];
    const u = this.unit[s];
    if (mode === KM_FREE) {
      // The pike's axis is +Y, the musket's +Z.
      this.toward(u === MUSKETEER ? 2 : 1, P[o + P_KIT_D], P[o + P_KIT_D + 1], P[o + P_KIT_D + 2]);
      this.put(X, xo + XF_KIT, P[o + P_KIT], P[o + P_KIT + 1], P[o + P_KIT + 2], this.qx, this.qy, this.qz, this.qw, false, sc, 1, 1, 1, x, y, z, hs, hc, ys, yc);
      shows |= SHOW_KIT;
    } else if (mode === KM_HAND) {
      // Along the forearm from the hand, turned down at the wrist by the tilt.
      let dx = J[33] - J[30], dy = J[34] - J[31], dz = J[35] - J[32];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      this.toward(1, dx, dy, dz);
      const t = P[o + P_KIT_T];
      if (t) mulX(this, t);
      this.put(X, xo + XF_KIT, J[33], J[34], J[35], this.qx, this.qy, this.qz, this.qw, false, sc, 1, 1, 1, x, y, z, hs, hc, ys, yc);
      shows |= SHOW_KIT;
    } else if (mode === KM_BELT && u !== PIKEMAN && u !== MUSKETEER) {
      // Hanging at the right hip, head up, following the hips.
      this.qx = pqx;
      this.qy = pqy;
      this.qz = pqz;
      this.qw = pqw;
      this.rot(-0.2, -0.4, 0.04);
      const bx = P[o + P_PEL] + this.rx, by = P[o + P_PEL + 1] + this.ry, bz = P[o + P_PEL + 2] + this.rz;
      this.rot(0.08, 1, 0.1);
      this.toward(1, this.rx, this.ry, this.rz);
      this.put(X, xo + XF_KIT, bx, by, bz, this.qx, this.qy, this.qz, this.qw, false, sc, 1, 1, 1, x, y, z, hs, hc, ys, yc);
      shows |= SHOW_KIT;
    } else if (mode === KM_BACK && (u === PIKEMAN || u === MUSKETEER)) {
      // Slung across his back: butt low on the right, point (or muzzle) up past the left shoulder.
      const musket = u === MUSKETEER;
      this.qx = tqx;
      this.qy = tqy;
      this.qz = tqz;
      this.qw = tqw;
      this.rot(musket ? -0.3 : -0.42, musket ? -0.45 : -0.95, -0.2);
      const bx = P[o + P_TOR] + this.rx, by = P[o + P_TOR + 1] + this.ry, bz = P[o + P_TOR + 2] + this.rz;
      this.rot(0.32, 0.94, -0.08);
      this.toward(musket ? 2 : 1, this.rx, this.ry, this.rz);
      this.put(X, xo + XF_KIT, bx, by, bz, this.qx, this.qy, this.qz, this.qw, false, sc, 1, 1, 1, x, y, z, hs, hc, ys, yc);
      shows |= SHOW_KIT;
    }
    if (P[o + P_KEG_ON] > 0.5 && (u === POWDER_BOY || (u === SAPPER && !this.kegless.has(this.id[s])))) {
      euler(P[o + P_KEG_A], P[o + P_KEG_A + 1], P[o + P_KEG_A + 2], this);
      this.put(X, xo + XF_KEG, P[o + P_KEG], P[o + P_KEG + 1], P[o + P_KEG + 2], this.qx, this.qy, this.qz, this.qw, false, sc, 1, 1, 1, x, y, z, hs, hc, ys, yc);
      shows |= SHOW_KEG;
    }
    if (P[o + P_ROD_ON] > 0.5 && u === MUSKETEER) {
      this.toward(1, P[o + P_ROD_D], P[o + P_ROD_D + 1], P[o + P_ROD_D + 2]);
      this.put(X, xo + XF_ROD, P[o + P_ROD], P[o + P_ROD + 1], P[o + P_ROD + 2], this.qx, this.qy, this.qz, this.qw, false, sc, 1, 1, 1, x, y, z, hs, hc, ys, yc);
      shows |= SHOW_ROD;
    }
    this.shows[s] = shows;
  }

  /** Quaternion turning the axis (1 = +Y, 2 = +Z) onto a unit direction: into qx..qw. */
  private toward(axis: number, dx: number, dy: number, dz: number) {
    let x: number, y: number, z: number, w: number;
    if (axis === 1) {
      // From +Y: cross (0, 1, 0) x d = (dz, 0, -dx), w = 1 + dy.
      x = dz;
      y = 0;
      z = -dx;
      w = 1 + dy;
      if (w < 1e-6) {
        x = 1;
        z = 0;
        w = 0;
      }
    } else {
      // From +Z: cross (0, 0, 1) x d = (-dy, dx, 0), w = 1 + dz.
      x = -dy;
      y = dx;
      z = 0;
      w = 1 + dz;
      if (w < 1e-6) {
        x = 0;
        y = 1;
        w = 0;
      }
    }
    const l = Math.sqrt(x * x + y * y + z * z + w * w);
    this.qx = x / l;
    this.qy = y / l;
    this.qz = z / l;
    this.qw = w / l;
  }

  /**
   * A limb part between joints a (nearer the body) and b (local): its
   * capsule's +Y points from b back up to a, as a ragdoll's parts do when
   * they stand, so a falling man's limbs turn the short way into the
   * ragdoll's.
   */
  private seg(X: Float32Array, xo: number, a: number, b: number, sc: number, stretch: number, x: number, y: number, z: number, hs: number, hc: number, ys: number, yc: number) {
    const J = this.j;
    const dx = J[a] - J[b], dy = J[a + 1] - J[b + 1], dz = J[a + 2] - J[b + 2];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    this.toward(1, dx / l, dy / l, dz / l);
    this.put(X, xo, (J[a] + J[b]) * 0.5, (J[a + 1] + J[b + 1]) * 0.5, (J[a + 2] + J[b + 2]) * 0.5, this.qx, this.qy, this.qz, this.qw, false, sc, sc, sc * stretch, sc, x, y, z, hs, hc, ys, yc);
  }

  /**
   * One transform into xf: a local position (scaled by `ps`, the figure's
   * size) and rotation, turned by the yaw and placed at the figure, with the
   * instance's scale. `across` turns the capsule to lie along x (the pelvis).
   */
  private put(X: Float32Array, o: number, lx: number, ly: number, lz: number, qx: number, qy: number, qz: number, qw: number, across: boolean, ps: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, hs: number, hc: number, ys: number, yc: number) {
    lx *= ps;
    ly *= ps;
    lz *= ps;
    X[o] = x + lx * yc + lz * ys;
    X[o + 1] = y + ly;
    X[o + 2] = z - lx * ys + lz * yc;
    // Yaw first: (0, hs, 0, hc) * q.
    let ax = hc * qx + hs * qz, ay = hc * qy + hs * qw, az = hc * qz - hs * qx, aw = hc * qw - hs * qy;
    if (across) {
      // Times a quarter turn about z: (0, 0, s, s) with s = sqrt(1/2).
      const r = Math.SQRT1_2;
      const bx = (ax + ay) * r, by = (ay - ax) * r, bz = (az + aw) * r, bw = (aw - az) * r;
      ax = bx;
      ay = by;
      az = bz;
      aw = bw;
    }
    X[o + 3] = ax;
    X[o + 4] = ay;
    X[o + 5] = az;
    X[o + 6] = aw;
    X[o + 7] = sx;
    X[o + 8] = sy;
    X[o + 9] = sz;
  }
}

/** Quaternion of twist (about y), then roll (about z), then pitch (about x), applied pitch first: into t.qx..qw. */
function euler(twist: number, roll: number, pitch: number, t: { qx: number; qy: number; qz: number; qw: number }) {
  const sy = Math.sin(twist * 0.5), cy = Math.cos(twist * 0.5);
  const sz = Math.sin(roll * 0.5), cz = Math.cos(roll * 0.5);
  const sx = Math.sin(pitch * 0.5), cx = Math.cos(pitch * 0.5);
  t.qx = cy * cz * sx + sy * sz * cx;
  t.qy = sy * cz * cx + cy * sz * sx;
  t.qz = cy * sz * cx - sy * cz * sx;
  t.qw = cy * cz * cx - sy * sz * sx;
}

/** q = q * (rotation about x by a). */
function mulX(t: { qx: number; qy: number; qz: number; qw: number }, a: number) {
  const s = Math.sin(a * 0.5), c = Math.cos(a * 0.5);
  const x = t.qx, y = t.qy, z = t.qz, w = t.qw;
  t.qx = w * s + x * c;
  t.qy = y * c + z * s;
  t.qz = z * c - y * s;
  t.qw = w * c - x * s;
}

function norm(P: Float32Array, i: number) {
  const l = Math.sqrt(P[i] * P[i] + P[i + 1] * P[i + 1] + P[i + 2] * P[i + 2]);
  if (l > 1e-6) {
    P[i] /= l;
    P[i + 1] /= l;
    P[i + 2] /= l;
  } else {
    P[i] = 0;
    P[i + 1] = 1;
    P[i + 2] = 0;
  }
}

/** Smooth minimum (polynomial, width k). */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
