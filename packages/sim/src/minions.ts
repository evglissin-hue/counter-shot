// Test minions for the sandbox: pikemen who patrol in front of the target
// castle. Upright, each is one kinematic capsule (cheap). A ball, a blast or a
// falling stone turns it into a ragdoll of eleven jointed capsules, which
// settles and freezes. Deterministic: fixed creation order, Rng streams, and
// every decision from + - * / and comparisons.

import { dcos, dsin, dsqrt, quatY, type Rng } from "@keepfall/core";
import type { Rapier } from "./castleSim";
import { MINION_HEIGHT, MINION_PARTS, MINION_STRIDE, PART_STRIDE } from "./frame";
import type { Terrain } from "./terrain";

type World = InstanceType<Rapier["World"]>;
type Body = ReturnType<World["createRigidBody"]>;

const WALK = 1.3; // m/s
const CAP_HALF = 0.55;
const CAP_R = 0.3;
const PART_GROUP = 0x0002;
/** Parts belong to group 2 and collide with everything except other parts. */
const PART_GROUPS = (PART_GROUP << 16) | (0xffff & ~PART_GROUP);
const MASS_SCALE = 1000; // part density (kg/m^3): about 70 kg per pikeman

/** Standing pose in minion space (facing +Z, feet at 0): part centres. Left is +X. */
const POSE: Array<[number, number, number]> = [
  [0, 0.95, 0], // pelvis
  [0, 1.25, 0], // torso
  [0, 1.65, 0], // head
  [0.24, 1.3, 0], // upper arm L
  [0.24, 1.02, 0], // lower arm L
  [-0.24, 1.3, 0], // upper arm R
  [-0.24, 1.02, 0], // lower arm R
  [0.1, 0.72, 0], // thigh L
  [0.1, 0.3, 0], // shin L
  [-0.1, 0.72, 0], // thigh R
  [-0.1, 0.3, 0], // shin R
];
/** Joints: [parent, child, joint point in minion space, revolute (knee/elbow)]. */
const JOINTS: Array<[number, number, [number, number, number], boolean]> = [
  [0, 1, [0, 1.08, 0], false],
  [1, 2, [0, 1.52, 0], false],
  [1, 3, [0.24, 1.45, 0], false],
  [3, 4, [0.24, 1.16, 0], true],
  [1, 5, [-0.24, 1.45, 0], false],
  [5, 6, [-0.24, 1.16, 0], true],
  [0, 7, [0.1, 0.92, 0], false],
  [7, 8, [0.1, 0.51, 0], true],
  [0, 9, [-0.1, 0.92, 0], false],
  [9, 10, [-0.1, 0.51, 0], true],
];

export const enum MinionState {
  Upright = 0,
  Ragdoll = 1,
  Frozen = 2,
}

export interface Minion {
  id: number;
  team: number;
  state: MinionState;
  x: number;
  z: number;
  yaw: number;
  phase: number;
  /** Patrol between two points. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  toB: boolean;
  capsule: Body | null;
  parts: Body[];
  rest: number;
  /** Tick it fell, for scoring. */
  fellAt: number;
}

export interface Knock {
  minion: number;
  /** Velocity change for the whole body, plus extra for the part nearest the point. */
  vx: number;
  vy: number;
  vz: number;
  px: number;
  py: number;
  pz: number;
  extra: number;
}

export class Minions {
  list: Minion[] = [];
  /** Capsule collider handle -> minion id. */
  private byHandle = new Map<number, number>();
  /** Part collider handle -> minion id. */
  private partHandle = new Map<number, number>();
  /** Minions knocked down this tick (ids), for events and scoring. */
  fell: number[] = [];

  constructor(private R: Rapier, private world: World, private terrain: Terrain) {}

  /** A patrol of pikemen in front of the target castle. */
  spawnPatrol(rng: Rng, count: number, team = 0) {
    for (let k = 0; k < count; k++) {
      const row = k % 3;
      const z = -24 - row * 6 + rng.range(-1, 1);
      const span = 10 + rng.range(0, 6);
      const cx = rng.range(-8, 8);
      const ax = cx - span, bx = cx + span;
      const x = rng.range(ax, bx);
      this.spawn(team, x, z, ax, z, bx, z, rng.next() < 0.5);
    }
  }

  spawn(team: number, x: number, z: number, ax: number, az: number, bx: number, bz: number, toB: boolean): Minion {
    const R = this.R;
    const y = this.terrain.heightAt(x, z);
    const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + CAP_HALF + CAP_R, z));
    const col = this.world.createCollider(
      R.ColliderDesc.capsule(CAP_HALF, CAP_R).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const m: Minion = { id: this.list.length, team, state: MinionState.Upright, x, z, yaw: 0, phase: 0, ax, az, bx, bz, toB, capsule: body, parts: [], rest: 0, fellAt: -1 };
    this.byHandle.set(col.handle, m.id);
    this.list.push(m);
    return m;
  }

  /** Minion id for a capsule or part collider, or undefined. */
  of(handle: number): number | undefined {
    return this.byHandle.get(handle) ?? this.partHandle.get(handle);
  }

  /** Walk the upright ones (before the physics step). */
  walk(tick: number) {
    for (const m of this.list) {
      if (m.state !== MinionState.Upright || !m.capsule) continue;
      const tx = m.toB ? m.bx : m.ax, tz = m.toB ? m.bz : m.az;
      const dx = tx - m.x, dz = tz - m.z;
      const d = dsqrt(dx * dx + dz * dz);
      if (d < 0.2) {
        m.toB = !m.toB;
        continue;
      }
      const step = WALK / 60;
      m.x += (dx / d) * step;
      m.z += (dz / d) * step;
      // Face the way it walks: yaw from the direction, by quadrant (no atan2).
      m.yaw = yawOf(dx / d, dz / d);
      m.phase = (m.phase + step / 1.4) % 1;
      const y = this.terrain.heightAt(m.x, m.z);
      m.capsule.setNextKinematicTranslation({ x: m.x, y: y + CAP_HALF + CAP_R, z: m.z });
      const q = quatY(m.yaw);
      m.capsule.setNextKinematicRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
      void tick;
    }
  }

  /** Turn an upright minion into a ragdoll and push it. */
  knock(k: Knock, tick: number) {
    const m = this.list[k.minion];
    if (!m) return;
    if (m.state === MinionState.Frozen) this.thaw(m);
    if (m.state === MinionState.Upright) this.toRagdoll(m, tick);
    // Push every part, and the part nearest the hit point extra.
    let best = 0, bestD = 1e9;
    for (let i = 0; i < m.parts.length; i++) {
      const p = m.parts[i].translation();
      const d = (p.x - k.px) * (p.x - k.px) + (p.y - k.py) * (p.y - k.py) + (p.z - k.pz) * (p.z - k.pz);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    for (let i = 0; i < m.parts.length; i++) {
      const b = m.parts[i];
      const s = i === best ? 1 + k.extra : 1;
      const v = b.linvel();
      b.setLinvel({ x: v.x + k.vx * s, y: v.y + k.vy * s, z: v.z + k.vz * s }, true);
    }
  }

  private toRagdoll(m: Minion, tick: number) {
    const R = this.R;
    if (m.capsule) {
      this.world.removeRigidBody(m.capsule);
      m.capsule = null;
    }
    m.state = MinionState.Ragdoll;
    m.fellAt = tick;
    this.fell.push(m.id);
    const y0 = this.terrain.heightAt(m.x, m.z);
    const s = dsin(m.yaw), c = dcos(m.yaw);
    const q = quatY(m.yaw);
    const rot = { x: q[0], y: q[1], z: q[2], w: q[3] };
    // Minion space to world: rotate (x, z) by yaw. Facing +Z at yaw 0, so x' = x cos + z sin, z' = -x sin + z cos.
    const toWorld = (p: [number, number, number]) => ({ x: m.x + p[0] * c + p[2] * s, y: y0 + p[1], z: m.z - p[0] * s + p[2] * c });
    // Walking speed carries into the fall.
    const tx = m.toB ? m.bx : m.ax, tz = m.toB ? m.bz : m.az;
    const dx = tx - m.x, dz = tz - m.z;
    const d = dsqrt(dx * dx + dz * dz) + 1e-6;
    for (let i = 0; i < POSE.length; i++) {
      const w = toWorld(POSE[i]);
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic().setTranslation(w.x, w.y, w.z).setRotation(rot).setLinvel((dx / d) * WALK, 0, (dz / d) * WALK).setLinearDamping(0.05).setAngularDamping(0.6),
      );
      const shape = MINION_PARTS[i];
      const cd = shape.half > 0 ? R.ColliderDesc.capsule(shape.half, shape.radius) : R.ColliderDesc.ball(shape.radius);
      const col = this.world.createCollider(cd.setDensity(MASS_SCALE).setFriction(0.8).setCollisionGroups(PART_GROUPS), body);
      this.partHandle.set(col.handle, m.id);
      m.parts.push(body);
    }
    for (const [a, b, p, hinge] of JOINTS) {
      const pa = POSE[a], pb = POSE[b];
      const a1 = { x: p[0] - pa[0], y: p[1] - pa[1], z: p[2] - pa[2] };
      const a2 = { x: p[0] - pb[0], y: p[1] - pb[1], z: p[2] - pb[2] };
      const data = hinge ? R.JointData.revolute(a1, a2, { x: 1, y: 0, z: 0 }) : R.JointData.spherical(a1, a2);
      this.world.createImpulseJoint(data, m.parts[a], m.parts[b], true);
    }
  }

  private thaw(m: Minion) {
    for (const b of m.parts) {
      b.setBodyType(this.R.RigidBodyType.Dynamic, true);
      b.wakeUp();
    }
    m.state = MinionState.Ragdoll;
    m.rest = 0;
  }

  /** After the physics step: freeze ragdolls that have settled. */
  settle() {
    for (const m of this.list) {
      if (m.state !== MinionState.Ragdoll) continue;
      let asleep = true;
      for (const b of m.parts) {
        const v = b.linvel();
        if (v.x * v.x + v.y * v.y + v.z * v.z > 0.04) {
          asleep = false;
          break;
        }
      }
      if (!asleep) {
        m.rest = 0;
        continue;
      }
      if (++m.rest >= 60) {
        for (const b of m.parts) b.setBodyType(this.R.RigidBodyType.Fixed, false);
        m.state = MinionState.Frozen;
      }
    }
  }

  /** Minions whose body is within `radius` of a point (fixed order). */
  near(x: number, y: number, z: number, radius: number): Array<{ id: number; d: number; cx: number; cy: number; cz: number }> {
    const out: Array<{ id: number; d: number; cx: number; cy: number; cz: number }> = [];
    const r2 = radius * radius;
    for (const m of this.list) {
      let cx: number, cy: number, cz: number;
      if (m.state === MinionState.Upright) {
        cx = m.x;
        cy = this.terrain.heightAt(m.x, m.z) + MINION_HEIGHT / 2;
        cz = m.z;
      } else {
        const p = m.parts[1].translation();
        cx = p.x;
        cy = p.y;
        cz = p.z;
      }
      const d2 = (cx - x) * (cx - x) + (cy - y) * (cy - y) + (cz - z) * (cz - z);
      if (d2 <= r2) out.push({ id: m.id, d: dsqrt(d2), cx, cy, cz });
    }
    return out;
  }

  collectUpright(out: Float32Array): number {
    let n = 0;
    for (const m of this.list) {
      if (m.state !== MinionState.Upright || (n + 1) * MINION_STRIDE > out.length) continue;
      const o = n * MINION_STRIDE;
      out[o] = m.id;
      out[o + 1] = m.x;
      out[o + 2] = this.terrain.heightAt(m.x, m.z);
      out[o + 3] = m.z;
      out[o + 4] = m.yaw;
      out[o + 5] = m.phase;
      out[o + 6] = m.team;
      n++;
    }
    return n;
  }

  collectParts(out: Float32Array): number {
    let n = 0;
    for (const m of this.list) {
      if (m.state === MinionState.Upright) continue;
      for (let i = 0; i < m.parts.length; i++) {
        if ((n + 1) * PART_STRIDE > out.length) return n;
        const t = m.parts[i].translation();
        const r = m.parts[i].rotation();
        const o = n * PART_STRIDE;
        out[o] = m.id;
        out[o + 1] = i;
        out[o + 2] = t.x;
        out[o + 3] = t.y;
        out[o + 4] = t.z;
        out[o + 5] = r.x;
        out[o + 6] = r.y;
        out[o + 7] = r.z;
        out[o + 8] = r.w;
        n++;
      }
    }
    return n;
  }

  /** Positions of every body, for the state hash. */
  hashInto(out: number[]) {
    for (const m of this.list) {
      out.push(m.state, m.x, m.z, m.yaw);
      for (const b of m.parts) {
        const t = b.translation();
        const r = b.rotation();
        out.push(t.x, t.y, t.z, r.x, r.y, r.z, r.w);
      }
    }
  }
}

/** Yaw (0 = +Z, positive towards +X) of a unit direction (dx, dz), without atan2. */
export function yawOf(dx: number, dz: number): number {
  const a = asin(dx < -1 ? -1 : dx > 1 ? 1 : dx);
  if (dz >= 0) return a;
  return dx >= 0 ? 3.141592653589793 - a : -3.141592653589793 - a;
}

/** asin by bisection on dsin over [-pi/2, pi/2] (monotonic there). */
function asin(v: number): number {
  let lo = -1.5707963267948966, hi = 1.5707963267948966;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (dsin(mid) < v) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
