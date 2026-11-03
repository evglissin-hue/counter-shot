// Castle physics on Rapier. Works with any Rapier build passed in (the
// deterministic one for gameplay and the hash check, the SIMD one for speed
// comparison).
//
// How destruction works:
// - Every castle piece starts as a FIXED body: an intact castle costs almost
//   nothing to simulate, however many stones it has.
// - A cannonball that hits fixed masonry knocks loose every piece within a
//   radius that grows with impact speed: those pieces become dynamic and the
//   ball keeps its momentum, so it ploughs through them for real.
// - Heavy impacts from falling rubble knock pieces loose too (contact forces).
// - After anything comes loose, a support check runs over the remaining fixed
//   pieces: support flows up from the ground through stones resting on each
//   other, and sideways through bonded neighbours for at most SPAN steps
//   (masonry can bridge a small gap, not a big one). Unsupported pieces turn
//   dynamic and fall.
// - Loose pieces that have come to rest freeze back into fixed bodies, so a
//   rubble field costs nothing until something hits it again.
// All decisions use deterministic arithmetic only, so the same shots give the
// same collapse on every machine when used with the deterministic build.

import type RAPIER_NS from "@dimforge/rapier3d-deterministic-compat";
import type { CastleLayout, Stone } from "../core/castle";
import { aim } from "../core/ballistics";
import { hashBytes, hex8 } from "../core/detmath";

export type Rapier = typeof RAPIER_NS;
type World = InstanceType<Rapier["World"]>;
type Body = ReturnType<World["createRigidBody"]>;
type EventQueue = InstanceType<Rapier["EventQueue"]>;

const DENSITY: Record<Stone["material"], number> = { stone: 2300, wood: 600, plaster: 1400, roof: 1100, banner: 400 };
const FRICTION: Record<Stone["material"], number> = { stone: 0.75, wood: 0.6, plaster: 0.65, roof: 0.55, banner: 0.5 };

export interface SimOptions {
  /** How many sideways bonds masonry can bridge before it falls. */
  span: number;
  /** Contact force (newtons) that knocks a fixed piece loose. */
  breakForce: number;
  /** Solver iterations (Rapier default is 4). */
  iterations: number;
  /** Blast radius in metres = blastBase + blastPerSpeed * impact speed (m/s). */
  blastBase: number;
  blastPerSpeed: number;
  /** Share of a loosened piece's momentum-at-ball-speed given as a push. */
  push: number;
}

export const DEFAULT_SIM: SimOptions = { span: 2, breakForce: 220_000, iterations: 4, blastBase: 0.8, blastPerSpeed: 0.034, push: 0.08 };

export interface Ball {
  body: Body;
  handle: number;
  radius: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  alive: boolean;
}

export interface Impact {
  x: number;
  y: number;
  z: number;
  strength: number;
}

const BALL_RADIUS = 0.4;
const BALL_DENSITY = 7800;
const MAX_BALLS = 16;

export class CastleSim {
  readonly R: Rapier;
  readonly layout: CastleLayout;
  readonly opts: SimOptions;
  world: World;
  queue: EventQueue;
  bodies: Body[] = [];
  /** collider handle -> stone id, or -(ball index + 1) for balls */
  private owner = new Map<number, number>();
  dynamic: Uint8Array;
  /** stones that are dynamic, in the order they came loose */
  dynList: number[] = [];
  private awakeLast: Uint8Array;
  /** loose pieces that came to rest and were frozen back into fixed bodies */
  frozen: Uint8Array;
  private frozenList: number[] = [];
  private restSteps: Uint16Array;
  balls: Ball[] = [];
  steps = 0;
  impacts: Impact[] = [];
  toppled: [boolean, boolean] = [false, false];
  private grid = new Map<number, number[]>();
  private cost: Int32Array;
  private deque: Int32Array;

  constructor(R: Rapier, layout: CastleLayout, opts: SimOptions = DEFAULT_SIM) {
    this.R = R;
    this.layout = layout;
    this.opts = opts;
    const n = layout.stones.length;
    this.dynamic = new Uint8Array(n);
    this.awakeLast = new Uint8Array(n);
    this.frozen = new Uint8Array(n);
    this.restSteps = new Uint16Array(n);
    this.cost = new Int32Array(n);
    this.deque = new Int32Array(n * 4 + 16);

    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.world.numSolverIterations = opts.iterations;
    this.queue = new R.EventQueue(true);

    // The field: one big fixed slab whose top is y = 0.
    const ground = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -1, -75));
    this.world.createCollider(R.ColliderDesc.cuboid(160, 1, 220).setFriction(0.85), ground);

    const wedgePts = layout.wedge.points;
    for (const s of layout.stones) {
      const loose = s.part === "banner"; // the banner pole is a free body from the start
      const desc = (loose ? R.RigidBodyDesc.dynamic() : R.RigidBodyDesc.fixed())
        .setTranslation(s.x, s.y, s.z)
        .setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] });
      const body = this.world.createRigidBody(desc);
      const cd = s.shape === "wedge" ? R.ColliderDesc.convexHull(wedgePts)! : R.ColliderDesc.cuboid(s.hx, s.hy, s.hz);
      cd.setDensity(DENSITY[s.material]).setFriction(FRICTION[s.material]).setRestitution(0.02);
      if (!loose) {
        cd.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(opts.breakForce);
      }
      const col = this.world.createCollider(cd, body);
      this.owner.set(col.handle, s.id);
      this.bodies.push(body);
      if (loose) {
        this.dynamic[s.id] = 1;
        this.dynList.push(s.id);
      }
    }

    // Spatial grid of stone centres for blast queries (2 m cells).
    for (const s of layout.stones) {
      const k = this.cellKey(Math.floor(s.x / 2), Math.floor(s.y / 2), Math.floor(s.z / 2));
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, (list = []));
      list.push(s.id);
    }
  }

  private cellKey(cx: number, cy: number, cz: number): number {
    return ((cx + 512) * 1024 + (cy + 512)) * 1024 + (cz + 512);
  }

  free() {
    this.queue.free();
    this.world.free();
  }

  /** Launch a cannonball. Returns false if too many are in flight. */
  fire(x: number, y: number, z: number, vx: number, vy: number, vz: number): boolean {
    let slot = this.balls.findIndex((b) => !b.alive);
    if (slot < 0) {
      if (this.balls.length >= MAX_BALLS) return false;
      slot = this.balls.length;
    }
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinvel(vx, vy, vz).setCcdEnabled(true).setCanSleep(false),
    );
    const col = this.world.createCollider(
      R.ColliderDesc.ball(BALL_RADIUS)
        .setDensity(BALL_DENSITY)
        .setFriction(0.4)
        .setRestitution(0.1)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    if (slot < this.balls.length) {
      const old = this.balls[slot];
      this.owner.delete(old.handle);
    }
    this.owner.set(col.handle, -(slot + 1));
    this.balls[slot] = { body, handle: col.handle, radius: BALL_RADIUS, vx, vy, vz, age: 0, alive: true };
    return true;
  }

  /** Launch velocity that reaches (tx, ty, tz) from (x, y, z) in `time` seconds (gravity only). */
  static aim = aim;

  /** Advance one fixed step (1/60 s). */
  step() {
    const R = this.R;
    // Remember each ball's velocity before the step: on hitting fixed masonry
    // it would bounce off, so we give it its momentum back after loosening.
    for (const b of this.balls) {
      if (!b.alive) continue;
      const v = b.body.linvel();
      b.vx = v.x;
      b.vy = v.y;
      b.vz = v.z;
    }
    this.impacts.length = 0;
    this.world.step(this.queue);
    this.steps++;

    // Ball hits on fixed pieces, gathered then handled in a fixed order.
    const hits: Array<[number, number]> = [];
    this.queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.owner.get(h1);
      const b = this.owner.get(h2);
      if (a === undefined || b === undefined) return;
      if (a < 0 && b >= 0) hits.push([-a - 1, b]);
      else if (b < 0 && a >= 0) hits.push([-b - 1, a]);
    });
    const breaks: number[] = [];
    this.queue.drainContactForceEvents((e) => {
      const a = this.owner.get(e.collider1());
      const b = this.owner.get(e.collider2());
      if (a !== undefined && a >= 0 && (!this.dynamic[a] || this.frozen[a])) breaks.push(a);
      if (b !== undefined && b >= 0 && (!this.dynamic[b] || this.frozen[b])) breaks.push(b);
    });
    hits.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    breaks.sort((p, q) => p - q);

    let changed = false;
    let lastBall = -1;
    for (const [bi, stoneId] of hits) {
      if (bi === lastBall) continue; // one blast per ball per step
      const ball = this.balls[bi];
      if (!ball || !ball.alive || (this.dynamic[stoneId] && !this.frozen[stoneId])) continue;
      const speed2 = ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz;
      if (speed2 < 64) continue; // under 8 m/s: just a bump
      lastBall = bi;
      const speed = Math.sqrt(speed2);
      const p = ball.body.translation();
      const radius = this.opts.blastBase + speed * this.opts.blastPerSpeed;
      this.blast(p.x, p.y, p.z, radius, ball.vx / speed, ball.vy / speed, ball.vz / speed, speed);
      // Give the ball its momentum back (minus what breaking the bond cost).
      ball.body.setLinvel({ x: ball.vx * 0.85, y: ball.vy * 0.85, z: ball.vz * 0.85 }, true);
      this.impacts.push({ x: p.x, y: p.y, z: p.z, strength: Math.min(1, speed / 80) });
      changed = true;
    }
    let breakFx = 0;
    for (const id of breaks) {
      if (this.frozen[id]) {
        const p = this.bodies[id].translation();
        this.thaw(p.x, p.y, p.z, 2.5);
        continue;
      }
      if (this.dynamic[id]) continue;
      this.loosen(id);
      changed = true;
      if (breakFx < 4) {
        const s = this.layout.stones[id];
        this.impacts.push({ x: s.x, y: s.y, z: s.z, strength: 0.25 });
        breakFx++;
      }
    }
    if (changed) this.supportCheck();
    this.freezeResting();

    // Balls: age out, drop the ones that left the field.
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (!b.alive) continue;
      b.age++;
      const p = b.body.translation();
      if (b.age > 60 * 12 || p.y < -10) {
        this.world.removeRigidBody(b.body);
        b.alive = false;
      }
    }

    // Win check: a banner that falls well below its keep's walls.
    for (let c = 0; c < 2; c++) {
      if (this.toppled[c]) continue;
      const p = this.bodies[this.layout.bannerIds[c]].translation();
      if (p.y < this.layout.keepTop * 0.6) this.toppled[c] = true;
    }
    void R;
  }

  /** Loosen every fixed piece whose centre lies within `radius`, with a push along the shot. */
  private blast(x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, speed: number) {
    const r2 = radius * radius;
    const c0x = Math.floor((x - radius) / 2), c1x = Math.floor((x + radius) / 2);
    const c0y = Math.floor((y - radius) / 2), c1y = Math.floor((y + radius) / 2);
    const c0z = Math.floor((z - radius) / 2), c1z = Math.floor((z + radius) / 2);
    const found: number[] = [];
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cy = c0y; cy <= c1y; cy++)
        for (let cz = c0z; cz <= c1z; cz++) {
          const list = this.grid.get(this.cellKey(cx, cy, cz));
          if (!list) continue;
          for (const id of list) {
            if (this.dynamic[id]) continue;
            const s = this.layout.stones[id];
            const ex = s.x - x, ey = s.y - y, ez = s.z - z;
            if (ex * ex + ey * ey + ez * ez <= r2) found.push(id);
          }
        }
    this.thaw(x, y, z, radius);
    found.sort((p, q) => p - q);
    for (const id of found) {
      this.loosen(id);
      const s = this.layout.stones[id];
      const body = this.bodies[id];
      const ex = s.x - x, ey = s.y - y, ez = s.z - z;
      const d2 = ex * ex + ey * ey + ez * ez;
      const fall = 1 - d2 / r2; // 1 at the centre, 0 at the edge
      const k = body.mass() * speed * this.opts.push * fall;
      body.applyImpulse({ x: dx * k, y: dy * k + k * 0.15, z: dz * k }, true);
    }
  }

  /** Loose pieces asleep for 1.5 s become fixed again. The banner never freezes. */
  private freezeResting() {
    const fixed = this.R.RigidBodyType.Fixed;
    const banners = this.layout.bannerIds;
    for (const id of this.dynList) {
      if (this.frozen[id] || id === banners[0] || id === banners[1]) continue;
      if (this.bodies[id].isSleeping()) {
        if (++this.restSteps[id] >= 90) {
          this.bodies[id].setBodyType(fixed, false);
          this.frozen[id] = 1;
          this.frozenList.push(id);
          this.restSteps[id] = 0;
        }
      } else {
        this.restSteps[id] = 0;
      }
    }
  }

  /** Unfreeze rubble near a point so it can be knocked about again. */
  private thaw(x: number, y: number, z: number, radius: number) {
    if (!this.frozenList.length) return;
    const r2 = radius * radius;
    const keep: number[] = [];
    for (const id of this.frozenList) {
      const p = this.bodies[id].translation();
      const ex = p.x - x, ey = p.y - y, ez = p.z - z;
      if (ex * ex + ey * ey + ez * ez <= r2) {
        this.frozen[id] = 0;
        const body = this.bodies[id];
        body.setBodyType(this.R.RigidBodyType.Dynamic, true);
        body.recomputeMassPropertiesFromColliders();
        body.wakeUp();
      } else {
        keep.push(id);
      }
    }
    this.frozenList = keep;
  }

  private loosen(id: number) {
    if (this.dynamic[id]) return;
    this.dynamic[id] = 1;
    this.dynList.push(id);
    const body = this.bodies[id];
    body.setBodyType(this.R.RigidBodyType.Dynamic, true);
    body.recomputeMassPropertiesFromColliders();
    body.wakeUp();
  }

  /**
   * Support flows up from grounded fixed pieces. Resting on a supported piece
   * keeps full support; a sideways bond (or hanging under a piece) costs one
   * step. Pieces with no path within the span come loose.
   */
  private supportCheck() {
    const { below, above, side, stones } = this.layout;
    const n = stones.length;
    const INF = 1 << 30;
    const cost = this.cost;
    const dq = this.deque;
    const cap = dq.length;
    let head = 0, tail = 0; // ring buffer: front at head, back at tail
    cost.fill(INF);
    for (let i = 0; i < n; i++) {
      if (!this.dynamic[i] && stones[i].grounded) {
        cost[i] = 0;
        dq[tail] = i;
        tail = (tail + 1) % cap;
      }
    }
    const span = this.opts.span;
    while (head !== tail) {
      const u = dq[head];
      head = (head + 1) % cap;
      const cu = cost[u];
      const up = above[u];
      for (let k = 0; k < up.length; k++) {
        const v = up[k];
        if (this.dynamic[v] || cost[v] <= cu) continue;
        cost[v] = cu;
        head = (head - 1 + cap) % cap; // push front: zero cost
        dq[head] = v;
      }
      const c1 = cu + 1;
      if (c1 > span) continue;
      const sd = side[u];
      for (let k = 0; k < sd.length; k++) {
        const v = sd[k];
        if (this.dynamic[v] || cost[v] <= c1) continue;
        cost[v] = c1;
        dq[tail] = v;
        tail = (tail + 1) % cap;
      }
      const dn = below[u];
      for (let k = 0; k < dn.length; k++) {
        const v = dn[k];
        if (this.dynamic[v] || cost[v] <= c1) continue;
        cost[v] = c1;
        dq[tail] = v;
        tail = (tail + 1) % cap;
      }
    }
    for (let i = 0; i < n; i++) {
      if (!this.dynamic[i] && cost[i] === INF) this.loosen(i);
    }
  }

  /**
   * Writes [id, x, y, z, qx, qy, qz, qw] for every loose piece that moved this
   * step (awake now, or fell asleep since the last call). Returns the count.
   */
  collectMoving(out: Float32Array): number {
    let n = 0;
    const max = Math.floor(out.length / 8);
    for (const id of this.dynList) {
      const body = this.bodies[id];
      const awake = !this.frozen[id] && !body.isSleeping();
      if (!awake && !this.awakeLast[id]) continue;
      this.awakeLast[id] = awake ? 1 : 0;
      if (n >= max) continue;
      const t = body.translation();
      const r = body.rotation();
      const o = n * 8;
      out[o] = id;
      out[o + 1] = t.x;
      out[o + 2] = t.y;
      out[o + 3] = t.z;
      out[o + 4] = r.x;
      out[o + 5] = r.y;
      out[o + 6] = r.z;
      out[o + 7] = r.w;
      n++;
    }
    return n;
  }

  /** Writes [x, y, z, radius] per live ball. Returns the count. */
  collectBalls(out: Float32Array): number {
    let n = 0;
    for (const b of this.balls) {
      if (!b.alive || n * 4 + 4 > out.length) continue;
      const t = b.body.translation();
      out[n * 4] = t.x;
      out[n * 4 + 1] = t.y;
      out[n * 4 + 2] = t.z;
      out[n * 4 + 3] = b.radius;
      n++;
    }
    return n;
  }

  awakeCount(): number {
    let n = 0;
    for (const id of this.dynList) if (!this.frozen[id] && !this.bodies[id].isSleeping()) n++;
    return n;
  }

  /** Hash of every piece's position and rotation, plus Rapier's own snapshot. */
  hash(): { state: string; snapshot: string } {
    const n = this.layout.stones.length;
    const f = new Float32Array(n * 7);
    for (let i = 0; i < n; i++) {
      const t = this.bodies[i].translation();
      const r = this.bodies[i].rotation();
      f.set([t.x, t.y, t.z, r.x, r.y, r.z, r.w], i * 7);
    }
    const state = hex8(hashBytes(new Uint8Array(f.buffer)));
    const snapshot = hex8(hashBytes(this.world.takeSnapshot()));
    return { state, snapshot };
  }
}
