// Staged animation scenes for the renderer test page (render-test.html
// ?scene=anim): a tiny fake sim that moves figures the way the army does
// (army.ts, ladders.ts, works.ts, specialists.ts): marching at 1.6 m/s with a
// stride of 1.4 m per walk phase, turning at 0.15 rad a tick, blows every 70
// to 110 ticks with act going back to zero at each, a sapper's 75-tick plant
// and his run, a musketeer's shot every 300 ticks, climbing at 1 m/s up a
// ladder, 1.4 m/s across the wall walk and 2 m/s down the rope, a crew
// carrying and raising a ladder, masons' strokes, and a man knocked down.
// Close-ups of these, frame by frame, show how the figures move. Not part of
// the game.

import { CASTLE_SHAPE, LADDER, ladderSpots } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, KEG_STRIDE, LADDER_STRIDE, MINION_PARTS, MINION_STRIDE, PART_STRIDE } from "@keepfall/sim";

const WALK = 0, STAND = 1, FIGHT = 2, BATTER = 3, WORK = 4, CARRY = 5, CLIMB = 6, RAISE = 7, PLANT = 8, AIM = 9;
const PIKE = 0, MASON = 1, CREW = 2, SAPPER = 3, MUSKET = 4;
const STRIDE = 1.4;

/** The ragdoll's standing pose (sim minions.ts POSE): part centres, facing +z. */
const POSE: Array<[number, number, number]> = [
  [0, 0.95, 0],
  [0, 1.25, 0],
  [0, 1.65, 0],
  [0.24, 1.3, 0],
  [0.24, 1.02, 0],
  [-0.24, 1.3, 0],
  [-0.24, 1.02, 0],
  [0.1, 0.72, 0],
  [0.1, 0.3, 0],
  [-0.1, 0.72, 0],
  [-0.1, 0.3, 0],
];

function h01(k: number): number {
  let h = Math.imul(k ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x165667b1);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Ticks since the last blow of a fighter whose blows start at t0 (s) and come every 70..110 ticks (seeded by k); large before the first. */
function sinceBlow(t: number, t0: number, k: number, min = 70, max = 110): number {
  let at = t0;
  if (t < at) return 600;
  for (let i = 0; i < 400; i++) {
    const next = at + (min + Math.floor(h01(k * 131 + i) * (max - min + 1))) / 60;
    if (next > t) return (t - at) * 60;
    at = next;
  }
  return 600;
}

export class AnimScene {
  readonly minions = new Float32Array(512 * MINION_STRIDE);
  minionCount = 0;
  readonly parts = new Float32Array(8 * MINION_PARTS.length * PART_STRIDE);
  partCount = 0;
  readonly ladders = new Float32Array(4 * LADDER_STRIDE);
  ladderCount = 0;
  readonly events = new Float32Array(32 * EVENT_STRIDE);
  eventCount = 0;
  readonly kegs = new Float32Array(2 * KEG_STRIDE);
  kegCount = 0;
  gone = new Int32Array(0);
  private turnYaw = 0;
  private turnTarget = 0;
  private lastFall = -1;
  private lastSapper = -1;
  private prevT = 0;

  constructor(private crowd = 0) {}

  private put(id: number, x: number, y: number, z: number, yaw: number, walk: number, team: number, action: number, act: number, unit: number) {
    if (this.minionCount >= 512) return;
    this.minions.set([id, x, y, z, yaw, ((walk % 1) + 1) % 1, team, action, Math.min(600, act), unit], this.minionCount * MINION_STRIDE);
    this.minionCount++;
  }

  private ev(kind: number, a: number, b: number, c: number, d: number) {
    if (this.eventCount >= 32) return;
    this.events.set([kind, a, b, c, d], this.eventCount * EVENT_STRIDE);
    this.eventCount++;
  }

  /** The scene at time t (s), dt after the last call. */
  build(t: number, dt: number) {
    this.minionCount = 0;
    this.partCount = 0;
    this.ladderCount = 0;
    this.eventCount = 0;
    this.kegCount = 0;
    const gone: number[] = [];
    const tick = t * 60;
    // 1. A column marching along +x (two files), and two men running past it.
    const kinds = [PIKE, PIKE, PIKE, MUSKET, PIKE, SAPPER, PIKE, CREW, PIKE, MASON, PIKE, PIKE];
    for (let k = 0; k < kinds.length; k++) {
      const v = 1.6 * (1 + (h01(k + 7) - 0.5) * 0.04);
      const rank = Math.floor(k / 2), file = k % 2;
      const d = t * v - rank * 1.3;
      const x = -26 + (((d % 52) + 52) % 52), z = -42 + file * 1.1 + Math.sin(d * 0.3 + k) * 0.08;
      this.put(100 + k, x, 0, z, Math.PI / 2, d / STRIDE + k * 0.37, k % 3 === 0 ? 1 : 0, WALK, 600, kinds[k]);
    }
    for (let k = 0; k < 2; k++) {
      const v = 2.0 + k * 0.1;
      const d = t * v + k * 9;
      this.put(120 + k, -26 + (((d % 52) + 52) % 52), 0, -45 - k * 1.2, Math.PI / 2, d / STRIDE, 0, WALK, 600, PIKE);
    }
    // 2. Turning and idling: a pikeman who turns a quarter at the sim's rate every 1.6 s, men at rest, one walking a slow circle.
    if (Math.floor(t / 1.6) !== Math.floor(this.prevT / 1.6)) this.turnTarget += (Math.floor(t / 1.6) % 3 === 2 ? -1 : 1) * (Math.PI / 2);
    const steps = Math.max(1, Math.round(dt * 60));
    for (let i = 0; i < steps; i++) {
      const dd = this.turnTarget - this.turnYaw;
      this.turnYaw += Math.max(-0.15, Math.min(0.15, dd));
    }
    this.put(200, -12, 0, -30, this.turnYaw, 0, 0, STAND, 600, PIKE);
    this.put(201, -13.5, 0, -31, 0.3, 0, 1, STAND, 600, MUSKET);
    this.put(202, -10.6, 0, -31.2, -0.2, 0, 0, STAND, 600, PIKE);
    this.put(203, -11.2, 0, -28.6, 2.8, 0, 1, STAND, 600, PIKE);
    this.put(205, -14.4, 0, -29.2, 0.9, 0, 0, STAND, 600, MASON);
    {
      const r = 2.6, v = 1.2, a = (t * v) / r;
      this.put(204, -16 + Math.cos(a) * r, 0, -34 + Math.sin(a) * r, Math.atan2(-Math.sin(a), Math.cos(a)), (t * v) / STRIDE, 1, WALK, 600, PIKE);
    }
    // 3. Fights: two pikemen, a crewman against a sapper, a musketeer jabbing at a pikeman.
    this.put(210, -6, 0, -30, Math.PI, 0, 0, FIGHT, sinceBlow(t, 0.5, 1), PIKE);
    this.put(211, -6, 0, -32.2, 0, 0, 1, FIGHT, sinceBlow(t, 1.2, 2), PIKE);
    this.put(212, -3.5, 0, -30.8, Math.PI, 0, 0, FIGHT, sinceBlow(t, 0.3, 3, 60, 95), CREW);
    this.put(213, -3.5, 0, -32.1, 0, 0, 1, FIGHT, sinceBlow(t, 0.9, 4), SAPPER);
    this.put(214, -1.2, 0, -30.4, Math.PI, 0, 1, FIGHT, sinceBlow(t, 0.6, 5), MUSKET);
    this.put(215, -1.3, 0, -31.8, 0, 0, 0, FIGHT, sinceBlow(t, 1.5, 6), PIKE);
    // 4. Three battering the gate.
    for (let k = 0; k < 3; k++) this.put(220 + k, -1 + k * 1.15, 0, -16.6 - (k === 2 ? 0.1 : 0), 0, 0, 1, BATTER, sinceBlow(t, 0.2 + k * 0.4, 20 + k), PIKE);
    // 5. Two musketeers: a shot every 300 ticks (the sim: 255..340 to reload, then 30 aiming).
    for (let k = 0; k < 2; k++) {
      const act = (tick + k * 150 + 200) % 300;
      this.put(230 + k, -9 - k * 1.6, 0, -38 - k * 0.6, 0.25 + k * 0.05, 0, 1, AIM, act, MUSKET);
      if (act < dt * 60 + 1e-6) this.ev(EventKind.Musket, 230 + k, -6 + k * 2.5, 1.3, -30);
    }
    // 6. A sapper: walks to the wall, sets his keg (75 ticks), runs 10 m, waits; then the next one.
    {
      const P = 12;
      const loop = Math.floor(t / P), u = t - loop * P;
      const id = 1000 + loop;
      if (loop !== this.lastSapper) {
        if (this.lastSapper >= 0) gone.push(1000 + this.lastSapper);
        this.lastSapper = loop;
      }
      const x = 6.8, wz = -16.75, z0 = -23.5;
      const walk = 4.4, plant = 75 / 60, runV = 2.03, run = 10 / runV;
      if (u < walk) {
        const z = z0 + (wz - z0) * (u / walk);
        this.put(id, x, 0, z, 0, (z - z0) / STRIDE, 1, WALK, 600, SAPPER);
      } else if (u < walk + plant) {
        this.put(id, x, 0, wz, 0, 0, 1, PLANT, (u - walk) * 60, SAPPER);
      } else if (u < walk + plant + run) {
        const k = (u - walk - plant) * runV;
        this.put(id, x, 0, wz - k, Math.PI, k / STRIDE, 1, WALK, 600, SAPPER);
      } else this.put(id, x, 0, wz - 10, Math.PI, 0, 1, STAND, 600, SAPPER);
      const set = walk + plant;
      if (u >= set && u - dt < set) this.ev(EventKind.Keg, id, x, 0.35, -16.45);
      if (u >= set && u < set + 4) {
        this.kegs.set([x, 0.35, -16.45, 240 - (u - set) * 60], 0);
        this.kegCount = 1;
      }
    }
    // 7. Climbers: up a ladder at 1 m/s, across the wall walk at 1.4 m/s, down the rope at 2 m/s, off into the courtyard.
    const spots = ladderSpots().filter((s) => s.castle === 0);
    const sp = spots[3];
    this.ladders.set([0, 1, 2, sp.x, 0, sp.footZ, sp.x, sp.topY, sp.topZ, 1], 0);
    this.ladderCount = 1;
    {
      const top = CASTLE_SHAPE.wallTop;
      const len = LADDER.length;
      const uy = sp.topY / len, uz = (sp.topZ - sp.footZ) / len;
      const up = top / uy;
      const span = sp.innerZ - sp.topZ;
      const P = 16;
      for (let k = 0; k < 3; k++) {
        const u = (((t + k * 4.6) % P) + P) % P;
        const id = 300 + k;
        const tUp = up / LADDER.up, tAcross = span / LADDER.across, tDown = top / LADDER.down;
        if (u < 1) this.put(id, sp.x + 0.6 * (k - 1), 0, sp.footZ - 1, 0, 0, 1, STAND, 600, k === 1 ? CREW : PIKE);
        else if (u < 1 + tUp) {
          const c = (u - 1) * LADDER.up;
          this.put(id, sp.x, uy * c, sp.footZ + uz * c - 0.22, 0, c / 0.7, 1, CLIMB, 600, k === 1 ? CREW : PIKE);
        } else if (u < 1 + tUp + tAcross) {
          const c = (u - 1 - tUp) * LADDER.across;
          this.put(id, sp.x, top, sp.topZ + c, 0, c / 0.7, 1, WALK, 600, k === 1 ? CREW : PIKE);
        } else if (u < 1 + tUp + tAcross + tDown) {
          const c = (u - 1 - tUp - tAcross) * LADDER.down;
          const f = c / top;
          this.put(id, sp.x, top - c, sp.innerZ + (sp.ropeZ - sp.innerZ) * f, Math.PI, c / 0.7, 1, CLIMB, 600, k === 1 ? CREW : PIKE);
        } else {
          const c = (u - 1 - tUp - tAcross - tDown) * 1.6;
          this.put(id, sp.x, 0, sp.ropeZ + c, 0, c / STRIDE, 1, c < 9 ? WALK : STAND, 600, k === 1 ? CREW : PIKE);
        }
      }
    }
    // 8. A crew carrying a ladder to the wall (85% of the pace), raising it in 2 s, then fighting with axes; then again.
    {
      const sp2 = spots[2];
      const P = 14;
      const u = ((t % P) + P) % P;
      const v = 1.6 * 0.85;
      const z0 = -34, zf = sp2.footZ - 0.5;
      const tCarry = (zf - z0) / v;
      let fz: number, action: number;
      if (u < tCarry) {
        fz = z0 + v * u;
        action = CARRY;
      } else {
        fz = zf;
        action = u < tCarry + 2 ? RAISE : FIGHT;
      }
      const bz = action === CARRY ? fz - 3.6 : sp2.footZ - 0.9;
      const bx = action === CARRY ? sp2.x : sp2.x + 0.9;
      const raiseAct = (u - tCarry) * 60;
      this.put(250, sp2.x, 0, fz, 0, (fz - z0) / STRIDE, 1, action, action === FIGHT ? sinceBlow(t, 0.3, 50, 60, 95) : 600, CREW);
      this.put(251, bx, 0, bz, 0, (fz - z0) / STRIDE + 0.5, 1, action, action === FIGHT ? sinceBlow(t, 0.8, 51, 60, 95) : 600, CREW);
      if (action === CARRY) {
        const cy = 1.52;
        this.ladders.set([1, 1, 0, sp2.x, cy, (fz + bz) / 2 - 4.5, sp2.x, cy, (fz + bz) / 2 + 4.5, 0], this.ladderCount * LADDER_STRIDE);
      } else {
        const k = Math.min(1, raiseAct / 120);
        const e = k * k * (3 - 2 * k);
        const lean = Math.atan2(sp2.topY, sp2.topZ - sp2.footZ);
        const th = (Math.PI - lean) * e;
        this.ladders.set([1, 1, k < 1 ? 1 : 2, sp2.x, 0, sp2.footZ, sp2.x, LADDER.length * Math.sin(th), sp2.footZ - LADDER.length * Math.cos(th), k], this.ladderCount * LADDER_STRIDE);
      }
      this.ladderCount++;
    }
    // 9. Masons at work inside the gate's west side.
    for (let k = 0; k < 2; k++) this.put(260 + k, -6.6 + k * 1.1, 0, -12.6, Math.PI, 0, 0, WORK, (tick + k * 17) % 45, MASON);
    // 10. A man knocked down while walking: his body falls back and lies; a new one every 5 s.
    {
      const P = 5;
      const loop = Math.floor(t / P), u = t - loop * P;
      const id = 2000 + loop;
      if (loop !== this.lastFall) {
        if (this.lastFall >= 0) gone.push(2000 + this.lastFall);
        this.lastFall = loop;
      }
      const v = 1.6, tf = 2.0;
      const x0 = 3, z = -27.5;
      if (u < tf) this.put(id, x0 + v * u, 0, z, Math.PI / 2, (v * u) / STRIDE, 0, WALK, 600, PIKE);
      else {
        // Back over about the heels in 0.6 s, sliding on a little with his speed.
        const k = u - tf;
        const th = Math.min(Math.PI / 2 - 0.12, 4.2 * k * k);
        const slide = Math.min(0.5, v * k * 0.6);
        const s = Math.sin(th / 2), c = Math.cos(th / 2);
        // Rotation about the body's local x (falling back: -x rotation), turned to face +x (yaw pi/2).
        const ys = Math.SQRT1_2, yc = Math.SQRT1_2;
        // q = qYaw * qX(-th): qX = (-s, 0, 0, c).
        const qx = yc * -s, qy = ys * c, qz = -(-s) * ys, qw = yc * c;
        for (let p = 0; p < POSE.length; p++) {
          const [lx, ly, lz] = POSE[p];
          // Rotate (lx, ly, lz) about x by -th (top goes back to -z), then yaw.
          const cy = Math.cos(-th), sy = Math.sin(-th);
          const ry = ly * cy - lz * sy, rz = ly * sy + lz * cy;
          const wx = x0 + v * tf + slide + rz, wz = z - lx;
          const o = this.partCount * PART_STRIDE;
          const rad = MINION_PARTS[p].radius;
          this.parts.set([id, p, wx, Math.max(rad, ry), wz, qx, qy, qz, qw], o);
          this.partCount++;
        }
      }
    }
    // 11. A crowd for timing (far behind everything): ranks of ten marching along +x.
    for (let k = 0; k < this.crowd; k++) {
      const rank = Math.floor(k / 10), file = k % 10;
      const d = t * 1.6 - rank * 1.2;
      this.put(5000 + k, -40 + (((d % 80) + 80) % 80), 0, -70 - file * 1.1, Math.PI / 2, d / STRIDE + file * 0.21, k & 1, WALK, 600, k % 7 === 3 ? MUSKET : PIKE);
    }
    this.gone = Int32Array.from(gone);
    this.prevT = t;
    void STAND;
    void BATTER;
  }
}
