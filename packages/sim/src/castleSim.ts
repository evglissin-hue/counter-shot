// Castle physics on Rapier. Works with any Rapier build passed in (the
// deterministic one for gameplay and the hash check, the SIMD one for speed
// comparison).
//
// How destruction works:
// - Every castle piece starts as a FIXED body: an intact castle costs almost
//   nothing to simulate, however many stones it has.
// - A cannonball that hits fixed masonry shatters the pieces at the core of
//   the impact (they turn to dust and chips, which the renderer draws, and
//   leave the simulation) and knocks loose the ring around it, scattering it.
//   The ball keeps its momentum, so it ploughs on through the loose pieces.
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
import type { CastleLayout, Stone } from "@keepfall/content";
import { aim } from "./ballistics";
import { dsqrt, hashBytes, hex8 } from "@keepfall/core";

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
  /** Share of the blast radius that shatters outright. */
  shatter: number;
  /** Share of a loosened piece's momentum-at-ball-speed given as a push. */
  push: number;
  /** Build the flat ground slab (the sandbox brings its own terrain instead). */
  ground?: boolean;
}

export const DEFAULT_SIM: SimOptions = { span: 2, breakForce: 450_000, iterations: 4, blastBase: 0.8, blastPerSpeed: 0.034, push: 0.25, shatter: 0.65 };

export interface Ball {
  body: Body;
  handle: number;
  radius: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  alive: boolean;
  /** Blast strength on masonry (1 = full cannon blast, 0 = none). */
  blast: number;
  /** Shallow hits on masonry glance off instead of breaching. */
  ricochet: boolean;
  /** Touched anything since launch. */
  touched: boolean;
  /** Touched something during the last step. */
  touchedNow: boolean;
  /** The first stone it struck during the last step, or -1. */
  struck: number;
  /** Lifetime in steps before it is removed. */
  life: number;
  /** A full blast's radius as a multiple of a cannonball's (heavy shot, M3). */
  power: number;
}

export interface FireOptions {
  /** A full blast's radius as a multiple of a cannonball's (heavy shot, M3). Default 1. */
  power?: number;
  radius?: number;
  density?: number;
  restitution?: number;
  blast?: number;
  ricochet?: boolean;
  life?: number;
  angvel?: { x: number; y: number; z: number };
  /** Rapier collision groups (membership << 16 | filter). */
  groups?: number;
  /** Gravity multiplier for this ball. */
  gravity?: number;
}

export interface Impact {
  x: number;
  y: number;
  z: number;
  strength: number;
}

/** Contact force (N) that breaks a keep storey board: far above any falling rubble. */
const STOREY_BREAK = 8_000_000;
/**
 * Collision groups (membership << 16 | filter) for layouts with keep floors.
 * Intact keep walls and storeys carry the STRUCTURE bit and lose it when they
 * come loose; a banner collides only with colliders that have it (the ground,
 * shots and intact keep structure), so rubble never lifts it off its keep.
 */
const STRUCTURE = 0x0010;
const BANNER = 0x0008;
const STRUCTURE_GROUPS = 0xffffffff;
const RUBBLE_GROUPS = (((0xffff & ~STRUCTURE) << 16) | 0xffff) >>> 0;
const BANNER_GROUPS = ((BANNER << 16) | STRUCTURE) >>> 0;

const BALL_RADIUS = 0.4;
const BALL_DENSITY = 7800;
const MAX_BALLS = 64;

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
  /** pieces shattered by a direct hit: gone from the simulation */
  shattered: Uint8Array;
  private shatterReported: Uint8Array;
  private frozenList: number[] = [];
  private restSteps: Uint16Array;
  balls: Ball[] = [];
  steps = 0;
  impacts: Impact[] = [];
  toppled: [boolean, boolean] = [false, false];
  /** Ball contacts with colliders the castle does not own (minions, terrain): [ball index, collider handle]. */
  foreign: Array<[number, number]> = [];
  /** Stone contacts with colliders the castle does not own (minions): [stone id, collider handle]. */
  foreignStones: Array<[number, number]> = [];
  /** Glancing hits this step: [ball index, stone id]. */
  glances: Array<[number, number]> = [];
  private grid = new Map<number, number[]>();
  private cost: Int32Array;
  private deque: Int32Array;
  /** The neighbour graph as flat arrays (offsets per stone, then ids), for a fast support check. */
  private nbAbove: { off: Int32Array; ids: Int32Array };
  private nbSide: { off: Int32Array; ids: Int32Array };
  private nbBelow: { off: Int32Array; ids: Int32Array };
  private grounded: Uint8Array;
  private castleOf: Uint8Array;
  /** Beams that need all their supports (bridge stringers), in id order. */
  private spans: Int32Array;
  /**
   * First and one-past-last stone id of each support group: the two castles,
   * then the field's bridges (stones are numbered group by group).
   */
  private castleRange: Array<[number, number]>;
  /** Groups whose fixed pieces changed since their last support check (bit per group). All at first. */
  private supportDirty = 7;
  /** Pieces put back at their places since the last collectMoving (reported once, at their layout poses). */
  private restoredSince: number[] = [];
  /** Shapes for testing whether a piece's place is clear: a box per size, and the wedge, a little smaller than the pieces. */
  private slotShapes = new Map<string, InstanceType<Rapier["Cuboid"]> | InstanceType<Rapier["ConvexPolyhedron"]>>();
  /** M3: when set, every piece that goes from standing to loose (or dust) is listed in `fell`, for the match to pay for. */
  recordFalls = false;
  fell: number[] = [];

  constructor(R: Rapier, layout: CastleLayout, opts: SimOptions = DEFAULT_SIM) {
    this.R = R;
    this.layout = layout;
    this.opts = opts;
    const n = layout.stones.length;
    this.dynamic = new Uint8Array(n);
    this.awakeLast = new Uint8Array(n);
    this.frozen = new Uint8Array(n);
    this.shattered = new Uint8Array(n);
    this.shatterReported = new Uint8Array(n);
    this.restSteps = new Uint16Array(n);
    this.cost = new Int32Array(n);
    this.deque = new Int32Array(n * 4 + 16);
    const flat = (lists: number[][]) => {
      const off = new Int32Array(n + 1);
      for (let i = 0; i < n; i++) off[i + 1] = off[i] + lists[i].length;
      const ids = new Int32Array(off[n]);
      for (let i = 0; i < n; i++) ids.set(lists[i], off[i]);
      return { off, ids };
    };
    this.nbAbove = flat(layout.above);
    this.nbSide = flat(layout.side);
    this.nbBelow = flat(layout.below);
    this.grounded = new Uint8Array(n);
    this.castleOf = new Uint8Array(n);
    const spans: number[] = [];
    for (let i = 0; i < n; i++) {
      this.grounded[i] = layout.stones[i].grounded ? 1 : 0;
      this.castleOf[i] = layout.stones[i].castle;
      if (layout.stones[i].span) spans.push(i);
    }
    this.spans = Int32Array.from(spans);
    // Stones come group by group (castle 0, castle 1, bridges); if they ever did not, check everything as one range.
    const ends = [0, 0, 0];
    let k = 0;
    let contiguous = true;
    for (let g = 0; g < 3; g++) {
      while (k < n && this.castleOf[k] === g) k++;
      ends[g] = k;
    }
    if (k !== n) contiguous = false;
    this.castleRange = contiguous ? [[0, ends[0]], [ends[0], ends[1]], [ends[1], ends[2]]] : [[0, n], [n, n], [n, n]];
    if (!contiguous) this.castleOf.fill(0);

    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.world.numSolverIterations = opts.iterations;
    this.queue = new R.EventQueue(true);

    // The field: one big fixed slab whose top is y = 0.
    if (opts.ground !== false) {
      const ground = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -1, -75));
      this.world.createCollider(R.ColliderDesc.cuboid(160, 1, 220).setFriction(0.85), ground);
    }

    const wedgePts = layout.wedge.points;
    for (const s of layout.stones) {
      const loose = s.part === "banner"; // the banner pole is a free body from the start
      const desc = (loose ? R.RigidBodyDesc.dynamic() : R.RigidBodyDesc.fixed())
        .setTranslation(s.x, s.y, s.z)
        .setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] });
      const body = this.world.createRigidBody(desc);
      const cd = s.shape === "wedge" ? R.ColliderDesc.convexHull(wedgePts)! : R.ColliderDesc.cuboid(s.hx, s.hy, s.hz);
      cd.setDensity(DENSITY[s.material]).setFriction(FRICTION[s.material]).setRestitution(0.02);
      if (layout.keepFloors) cd.setCollisionGroups(s.part === "banner" ? BANNER_GROUPS : s.part === "keep" || s.part === "storey" ? STRUCTURE_GROUPS : RUBBLE_GROUPS);
      if (!loose) {
        // Keep floors carry falling rubble: only a burst or a direct hit breaks a storey board.
        const threshold = s.part === "storey" ? STOREY_BREAK : opts.breakForce;
        cd.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(threshold);
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

  /** Launch a ball. Returns its slot, or -1 if too many are in flight. Defaults are the lab's cannonball. */
  fire(x: number, y: number, z: number, vx: number, vy: number, vz: number, o: FireOptions = {}): number {
    let slot = this.balls.findIndex((b) => !b.alive);
    if (slot < 0) {
      if (this.balls.length >= MAX_BALLS) return -1;
      slot = this.balls.length;
    }
    const R = this.R;
    const radius = o.radius ?? BALL_RADIUS;
    const bd = R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinvel(vx, vy, vz).setCcdEnabled(true).setCanSleep(false);
    if (o.angvel) bd.setAngvel(o.angvel);
    if (o.gravity !== undefined && o.gravity !== 1) bd.setGravityScale(o.gravity);
    const body = this.world.createRigidBody(bd);
    const col = this.world.createCollider(
      R.ColliderDesc.ball(radius)
        .setDensity(o.density ?? BALL_DENSITY)
        .setFriction(0.4)
        .setRestitution(o.restitution ?? 0.1)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
        .setCollisionGroups(o.groups ?? 0xffffffff),
      body,
    );
    if (slot < this.balls.length) {
      const old = this.balls[slot];
      this.owner.delete(old.handle);
    }
    this.owner.set(col.handle, -(slot + 1));
    this.balls[slot] = {
      body, handle: col.handle, radius, vx, vy, vz, age: 0, alive: true,
      blast: o.blast ?? 1, ricochet: o.ricochet ?? false, touched: false, touchedNow: false, struck: -1, life: o.life ?? 60 * 12, power: o.power ?? 1,
    };
    return slot;
  }

  /** Remove a ball now (a fuse went off, a pellet spent). */
  removeBall(slot: number) {
    const b = this.balls[slot];
    if (!b || !b.alive) return;
    this.world.removeRigidBody(b.body);
    b.alive = false;
  }

  /** Register a collider this sim does not own, so contacts with balls are reported in `foreign`. */
  isOwned(handle: number): boolean {
    return this.owner.has(handle);
  }

  /**
   * An explosion at a point: shatters and loosens masonry like a hit with no
   * direction, thaws rubble around it. `power` plays the role of impact speed.
   */
  explode(x: number, y: number, z: number, radius: number, power: number) {
    this.blast(x, y, z, radius, 0, 0, 0, power);
    this.impacts.push({ x, y, z, strength: Math.min(1, radius / 3) });
    this.supportCheck();
  }

  /**
   * A powder burst at a point (a mortar shell): shatters the masonry at its
   * core, loosens the ring around it and throws it up and out, and throws
   * loose rubble out to 1.3 times the radius. Unlike a ball's blast it has no
   * direction of its own. `power` is the throw speed (m/s) at the centre,
   * falling to a quarter at the edge; `lift` tips the throw upwards.
   */
  burst(x: number, y: number, z: number, radius: number, shatter: number, power: number, lift: number) {
    const reach = radius * 1.3;
    const r2 = radius * radius, reach2 = reach * reach;
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
    // Rubble already lying loose nearby is thrown too: thaw it first.
    this.thaw(x, y, z, reach);
    const rubble: number[] = [];
    const banners = this.layout.bannerIds;
    for (const id of this.dynList) {
      // A banner is never thrown: it comes down with the floor under it.
      if (this.shattered[id] || this.frozen[id] || id === banners[0] || id === banners[1]) continue;
      const p = this.bodies[id].translation();
      const ex = p.x - x, ey = p.y - y, ez = p.z - z;
      if (ex * ex + ey * ey + ez * ez <= reach2) rubble.push(id);
    }
    found.sort((p, q) => p - q);
    const core2 = r2 * shatter * shatter;
    for (const id of found) {
      const s = this.layout.stones[id];
      const ex = s.x - x, ey = s.y - y, ez = s.z - z;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 <= core2 && s.part !== "banner") {
        this.shatter(id);
        continue;
      }
      this.loosen(id);
      this.throwPiece(id, ex, ey, ez, d2, r2, power, lift);
    }
    for (const id of rubble) {
      const p = this.bodies[id].translation();
      const ex = p.x - x, ey = p.y - y, ez = p.z - z;
      this.throwPiece(id, ex, ey, ez, ex * ex + ey * ey + ez * ez, reach2, power, lift);
    }
    this.impacts.push({ x, y, z, strength: 1 });
    this.supportCheck();
  }

  /** Throw a loose piece away from a burst: up and out, harder near the centre. */
  private throwPiece(id: number, ex: number, ey: number, ez: number, d2: number, r2: number, power: number, lift: number) {
    const body = this.bodies[id];
    const d = dsqrt(d2) + 0.001;
    // Pieces below the centre would only be driven into the ground: they go up and out too.
    let px = ex / d, py = (ey > 0 ? ey / d : (ey / d) * 0.3) + lift, pz = ez / d;
    const pl = dsqrt(px * px + py * py + pz * pz) + 0.001;
    px /= pl;
    py /= pl;
    pz /= pl;
    const fall = 1 - d2 / r2; // 1 at the centre, 0 at the edge
    const k = body.mass() * power * (0.25 + 0.75 * (fall > 0 ? fall : 0));
    body.applyImpulse({ x: px * k, y: py * k, z: pz * k }, true);
  }

  /** Stone id for a collider handle, or undefined. */
  stoneOf(handle: number): number | undefined {
    const o = this.owner.get(handle);
    return o !== undefined && o >= 0 ? o : undefined;
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
    this.foreign.length = 0;
    this.foreignStones.length = 0;
    this.glances.length = 0;
    for (const b of this.balls) {
      b.touchedNow = false;
      b.struck = -1;
    }
    this.world.step(this.queue);
    this.steps++;

    // Ball hits on fixed pieces, gathered then handled in a fixed order.
    const hits: Array<[number, number]> = [];
    this.queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.owner.get(h1);
      const b = this.owner.get(h2);
      for (const [o, other] of [[a, h2], [b, h1]] as const) {
        if (o === undefined || o >= 0) continue;
        const ball = this.balls[-o - 1];
        if (!ball) continue;
        ball.touched = true;
        ball.touchedNow = true;
        if (!this.owner.has(other)) this.foreign.push([-o - 1, other]);
      }
      if (a !== undefined && a >= 0 && b === undefined) this.foreignStones.push([a, h2]);
      else if (b !== undefined && b >= 0 && a === undefined) this.foreignStones.push([b, h1]);
      if (a === undefined || b === undefined) return;
      if (a < 0 && b >= 0) hits.push([-a - 1, b]);
      else if (b < 0 && a >= 0) hits.push([-b - 1, a]);
    });
    this.foreign.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    this.foreignStones.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
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
      const struck = this.balls[bi];
      if (struck && struck.struck < 0) struck.struck = stoneId;
      if (bi === lastBall) continue; // one blast per ball per step
      const ball = this.balls[bi];
      if (!ball || !ball.alive || (this.dynamic[stoneId] && !this.frozen[stoneId])) continue;
      const speed2 = ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz;
      if (speed2 < 64) continue; // under 8 m/s: just a bump
      lastBall = bi;
      const speed = dsqrt(speed2);
      const p = ball.body.translation();
      if (ball.ricochet && this.glancing(ball, stoneId, speed)) {
        this.glances.push([bi, stoneId]);
        this.impacts.push({ x: p.x, y: p.y, z: p.z, strength: Math.min(0.5, speed / 160) });
        continue;
      }
      if (ball.blast <= 0) {
        this.impacts.push({ x: p.x, y: p.y, z: p.z, strength: Math.min(0.3, (speed / 200) * (ball.radius / 0.1)) });
        continue;
      }
      if (ball.blast < 1) {
        // A weak shot: knocks the piece it hit loose (and maybe a neighbour), no shatter core.
        const r = (this.opts.blastBase + speed * this.opts.blastPerSpeed) * ball.blast;
        const dx = ball.vx / speed, dy = ball.vy / speed, dz = ball.vz / speed;
        this.loosenAround(p.x + dx * 0.4, p.y + dy * 0.4, p.z + dz * 0.4, r, dx, dy, dz, speed * ball.blast);
        ball.body.setLinvel({ x: ball.vx * 0.7, y: ball.vy * 0.7, z: ball.vz * 0.7 }, true);
        this.impacts.push({ x: p.x, y: p.y, z: p.z, strength: Math.min(0.6, speed / 120) });
        changed = true;
        continue;
      }
      const radius = (this.opts.blastBase + speed * this.opts.blastPerSpeed) * ball.power;
      const dx = ball.vx / speed, dy = ball.vy / speed, dz = ball.vz / speed;
      // The ball touches the face; the damage centres inside the masonry, a metre along the shot.
      this.blast(p.x + dx, p.y + dy, p.z + dz, radius, dx, dy, dz, speed);
      // Give the ball its momentum back (minus what breaking the bond cost).
      ball.body.setLinvel({ x: ball.vx * 0.85, y: ball.vy * 0.85, z: ball.vz * 0.85 }, true);
      this.impacts.push({ x: p.x, y: p.y, z: p.z, strength: Math.min(1, speed / 80) });
      changed = true;
    }
    let breakFx = 0;
    for (const id of breaks) {
      if (this.shattered[id]) continue;
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
      if (b.age > b.life || p.y < -10) {
        this.world.removeRigidBody(b.body);
        b.alive = false;
      }
    }

    // Win check: a banner that falls well below its keep's walls.
    for (let c = 0; c < 2; c++) {
      if (this.toppled[c]) continue;
      const p = this.bodies[this.layout.bannerIds[c]].translation();
      if (p.y < this.layout.bannerFallY) this.toppled[c] = true;
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
    const core2 = r2 * this.opts.shatter * this.opts.shatter;
    for (const id of found) {
      const s = this.layout.stones[id];
      const ex = s.x - x, ey = s.y - y, ez = s.z - z;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 <= core2 && s.part !== "banner") {
        this.shatter(id);
        continue;
      }
      this.loosen(id);
      const body = this.bodies[id];
      const fall = 1 - d2 / r2; // 1 at the centre, 0 at the edge
      // Debris flies along the shot and bursts out from the point of impact, with a little lift.
      const d = dsqrt(d2) + 0.001;
      let px = dx + 0.6 * (ex / d), py = dy + 0.6 * (ey / d) + 0.25, pz = dz + 0.6 * (ez / d);
      const pl = dsqrt(px * px + py * py + pz * pz) + 0.001;
      px /= pl; py /= pl; pz /= pl;
      const k = body.mass() * speed * this.opts.push * (0.25 + 0.75 * fall);
      body.applyImpulse({ x: px * k, y: py * k, z: pz * k }, true);
    }
  }

  /**
   * Is this a glancing hit? Looks up the contact normal between the ball and
   * the stone; a shot within about 20 degrees of the face glances off.
   * The ball is sent on along the face with a little of its normal speed back.
   */
  private glancing(ball: Ball, stoneId: number, speed: number): boolean {
    const stoneCol = this.bodies[stoneId].collider(0);
    const ballCol = ball.body.collider(0);
    let nx = 0, ny = 0, nz = 0, found = false;
    this.world.contactPair(ballCol, stoneCol, (manifold, flipped) => {
      if (found) return;
      const n = manifold.normal();
      const s = flipped ? -1 : 1; // normal from the ball towards the stone
      nx = n.x * s; ny = n.y * s; nz = n.z * s;
      found = true;
    });
    if (!found) return false;
    const into = (ball.vx * nx + ball.vy * ny + ball.vz * nz) / speed; // cosine to the normal
    if (into > 0.34) return false; // steeper than about 20 degrees off the face
    const vn = ball.vx * nx + ball.vy * ny + ball.vz * nz;
    const keep = 0.88;
    ball.body.setLinvel(
      { x: (ball.vx - vn * nx) * keep - vn * nx * 0.3, y: (ball.vy - vn * ny) * keep - vn * ny * 0.3, z: (ball.vz - vn * nz) * keep - vn * nz * 0.3 },
      true,
    );
    return true;
  }

  /** Loosen (never shatter) fixed pieces within `radius`, with a push along the shot. */
  private loosenAround(x: number, y: number, z: number, radius: number, dx: number, dy: number, dz: number, speed: number) {
    const r2 = radius * radius;
    const found: number[] = [];
    const c0x = Math.floor((x - radius) / 2), c1x = Math.floor((x + radius) / 2);
    const c0y = Math.floor((y - radius) / 2), c1y = Math.floor((y + radius) / 2);
    const c0z = Math.floor((z - radius) / 2), c1z = Math.floor((z + radius) / 2);
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
      const body = this.bodies[id];
      const k = body.mass() * speed * this.opts.push * 0.5;
      body.applyImpulse({ x: dx * k, y: dy * k + 0.2 * k, z: dz * k }, true);
    }
  }

  /**
   * Knock one standing piece loose with an impulse (a battered gate leaf).
   * Pieces it held up fall too. Returns false if it was already loose.
   */
  knockLoose(id: number, ix: number, iy: number, iz: number): boolean {
    if (this.dynamic[id]) return false;
    this.loosen(id);
    this.bodies[id].applyImpulse({ x: ix, y: iy, z: iz }, true);
    const s = this.layout.stones[id];
    this.impacts.push({ x: s.x, y: s.y, z: s.z, strength: 0.4 });
    this.supportCheck();
    return true;
  }

  /** Thaw frozen rubble around a point (craters, explosions near rubble). */
  thawAt(x: number, y: number, z: number, radius: number) {
    this.thaw(x, y, z, radius);
  }

  /**
   * What lies in a piece's place (its layout pose), apart from the piece
   * itself and the standing masonry around it: loose pieces (ids, in order)
   * and anything else (minions, bodies, shots, ladders: collider handles, in
   * order). The ground does not count. Uses the world as of the last step.
   */
  inPlace(id: number, terrain: ReadonlySet<number>): { pieces: number[]; other: number[] } {
    const s = this.layout.stones[id];
    const R = this.R;
    const key = s.shape === "wedge" ? "wedge" : `${s.hx.toFixed(3)},${s.hy.toFixed(3)},${s.hz.toFixed(3)}`;
    let shape = this.slotShapes.get(key);
    if (!shape) {
      if (s.shape === "wedge") {
        // The wedge, shrunk towards its middle by 8%.
        const p = this.layout.wedge.points, q = new Float32Array(p.length);
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < 8; i++) {
          cx += p[i * 3] / 8;
          cy += p[i * 3 + 1] / 8;
          cz += p[i * 3 + 2] / 8;
        }
        for (let i = 0; i < 8; i++) {
          q[i * 3] = cx + (p[i * 3] - cx) * 0.92;
          q[i * 3 + 1] = cy + (p[i * 3 + 1] - cy) * 0.92;
          q[i * 3 + 2] = cz + (p[i * 3 + 2] - cz) * 0.92;
        }
        shape = new R.ConvexPolyhedron(q, null);
      } else {
        shape = new R.Cuboid(s.hx * 0.92, s.hy * 0.85, s.hz * 0.92);
      }
      this.slotShapes.set(key, shape);
    }
    const pieces: number[] = [];
    const other: number[] = [];
    const own = this.bodies[id].collider(0);
    this.world.intersectionsWithShape({ x: s.x, y: s.y, z: s.z }, { x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, shape, (col) => {
      const h = col.handle;
      const o = this.owner.get(h);
      if (o !== undefined && o >= 0) {
        // Standing masonry around the place is fine; loose pieces are in the way.
        if (o !== id && this.dynamic[o] && !this.shattered[o]) pieces.push(o);
      } else if (!terrain.has(h)) other.push(h);
      return true;
    }, undefined, undefined, own);
    pieces.sort((a, b) => a - b);
    other.sort((a, b) => a - b);
    return { pieces, other };
  }

  /**
   * Masons put a piece back where it was built (wherever its body lies, or
   * from dust): fixed again, standing masonry. The caller checks that its
   * place is clear and that what it rests on stands. Returns false if it was
   * standing already.
   */
  restore(id: number): boolean {
    if (!this.dynamic[id]) return false;
    const s = this.layout.stones[id];
    const body = this.bodies[id];
    if (this.shattered[id]) {
      this.shattered[id] = 0;
      this.shatterReported[id] = 0;
      body.setEnabled(true);
    }
    if (this.frozen[id]) {
      this.frozen[id] = 0;
      const k = this.frozenList.indexOf(id);
      if (k >= 0) this.frozenList.splice(k, 1);
    } else {
      body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    }
    body.setBodyType(this.R.RigidBodyType.Fixed, false);
    body.setTranslation({ x: s.x, y: s.y, z: s.z }, false);
    body.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, false);
    if (this.layout.keepFloors && (s.part === "keep" || s.part === "storey")) body.collider(0).setCollisionGroups(STRUCTURE_GROUPS);
    this.dynamic[id] = 0;
    this.awakeLast[id] = 0;
    this.restSteps[id] = 0;
    const k = this.dynList.indexOf(id);
    if (k >= 0) this.dynList.splice(k, 1);
    this.restoredSince.push(id);
    return true;
  }

  /** Masons carry a loose piece out of the way: it leaves the world, like dust, and can be put back later. */
  carryOff(id: number): boolean {
    if (!this.dynamic[id] || this.shattered[id]) return false;
    if (this.frozen[id]) {
      this.frozen[id] = 0;
      const k = this.frozenList.indexOf(id);
      if (k >= 0) this.frozenList.splice(k, 1);
    }
    this.shattered[id] = 1;
    this.bodies[id].setEnabled(false);
    return true;
  }

  /**
   * M3: take a standing piece out of the world without a sound (a building
   * that is not built yet): it counts as gone, like dust, until restore()
   * puts it up. No support check, no impact, nothing recorded as fallen.
   */
  withdraw(id: number): boolean {
    if (this.dynamic[id]) return false;
    this.dynamic[id] = 1;
    this.dynList.push(id);
    this.shattered[id] = 1;
    this.shatterReported[id] = 1; // never drawn: no dust to show for it
    this.bodies[id].setEnabled(false);
    return true;
  }

  /** Loose pieces asleep for 1.5 s become fixed again. The banner never freezes. */
  private freezeResting() {
    const fixed = this.R.RigidBodyType.Fixed;
    const banners = this.layout.bannerIds;
    for (const id of this.dynList) {
      if (this.frozen[id] || this.shattered[id] || id === banners[0] || id === banners[1]) continue;
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

  /** A direct hit turns the piece to dust and chips: it leaves the simulation. */
  private shatter(id: number) {
    if (this.shattered[id]) return;
    if (!this.dynamic[id]) {
      this.dynamic[id] = 1;
      this.dynList.push(id);
      this.supportDirty |= 1 << this.castleOf[id];
      if (this.recordFalls) this.fell.push(id);
    }
    this.shattered[id] = 1;
    this.frozen[id] = 0;
    this.bodies[id].setEnabled(false);
    if (this.layout.stones[id].part === "storey") this.thawAbove(id);
  }

  private loosen(id: number) {
    if (this.dynamic[id]) return;
    this.dynamic[id] = 1;
    this.dynList.push(id);
    this.supportDirty |= 1 << this.castleOf[id];
    if (this.recordFalls) this.fell.push(id);
    const body = this.bodies[id];
    body.setBodyType(this.R.RigidBodyType.Dynamic, true);
    body.recomputeMassPropertiesFromColliders();
    body.wakeUp();
    const part = this.layout.stones[id].part;
    if (this.layout.keepFloors && (part === "keep" || part === "storey")) body.collider(0).setCollisionGroups(RUBBLE_GROUPS);
    if (part === "storey") this.thawAbove(id);
  }

  /**
   * Frozen rubble lying on a storey board that just gave way falls with it:
   * thaw everything frozen over the board's footprint, up to 3 m above it.
   */
  private thawAbove(id: number) {
    if (!this.frozenList.length) return;
    const s = this.layout.stones[id];
    const x0 = s.x - s.hx - 0.5, x1 = s.x + s.hx + 0.5;
    const z0 = s.z - s.hz - 0.5, z1 = s.z + s.hz + 0.5;
    const y0 = s.y - s.hy, y1 = s.y + s.hy + 3;
    const keep: number[] = [];
    for (const f of this.frozenList) {
      const p = this.bodies[f].translation();
      if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1 && p.y >= y0 && p.y <= y1) {
        this.frozen[f] = 0;
        const body = this.bodies[f];
        body.setBodyType(this.R.RigidBodyType.Dynamic, true);
        body.recomputeMassPropertiesFromColliders();
        body.wakeUp();
      } else {
        keep.push(f);
      }
    }
    this.frozenList = keep;
  }

  /**
   * Support flows up from grounded fixed pieces. Resting on a supported piece
   * keeps full support; a sideways bond (or hanging under a piece) costs one
   * step. Pieces with no path within the span come loose.
   *
   * Only castles whose fixed masonry changed since their last check are
   * walked: a castle nothing happened to cannot have lost support (frozen
   * rubble never carries support). The result is the same as walking both.
   */
  private supportCheck() {
    for (let c = 0; c < 3; c++) {
      if (!(this.supportDirty & (1 << c))) continue;
      const [s, e] = this.castleRange[c];
      this.supportPass(s, e, true);
      this.supportDirty &= ~(1 << c);
    }
  }

  /**
   * Compiles the support check ahead of the first hit (it is slow the first
   * few times a JavaScript engine runs it). Walks both castles and changes nothing.
   */
  warmUp() {
    for (let k = 0; k < 4; k++) for (const [s, e] of this.castleRange) this.supportPass(s, e, false);
  }

  /** 0-1 breadth-first search over stones s..e-1; loosens what has no support if `apply`. */
  private supportPass(s: number, e: number, apply: boolean) {
    if (e <= s) return;
    const INF = 1 << 30;
    const cost = this.cost;
    const dq = this.deque;
    const cap = dq.length;
    const dynamic = this.dynamic;
    const grounded = this.grounded;
    const aOff = this.nbAbove.off, aIds = this.nbAbove.ids;
    const sOff = this.nbSide.off, sIds = this.nbSide.ids;
    const bOff = this.nbBelow.off, bIds = this.nbBelow.ids;
    // A beam that lost either of its supports falls, whatever else holds it.
    if (apply) {
      for (const i of this.spans) {
        if (i < s || i >= e || dynamic[i]) continue;
        for (let k = bOff[i], k1 = bOff[i + 1]; k < k1; k++) {
          if (dynamic[bIds[k]]) {
            this.loosen(i);
            break;
          }
        }
      }
    }
    let head = 0, tail = 0; // ring buffer: front at head, back at tail
    cost.fill(INF, s, e);
    for (let i = s; i < e; i++) {
      if (!dynamic[i] && grounded[i]) {
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
      for (let k = aOff[u], k1 = aOff[u + 1]; k < k1; k++) {
        const v = aIds[k];
        if (dynamic[v] || cost[v] <= cu) continue;
        cost[v] = cu;
        head = (head - 1 + cap) % cap; // push front: zero cost
        dq[head] = v;
      }
      const c1 = cu + 1;
      if (c1 > span) continue;
      for (let k = sOff[u], k1 = sOff[u + 1]; k < k1; k++) {
        const v = sIds[k];
        if (dynamic[v] || cost[v] <= c1) continue;
        cost[v] = c1;
        dq[tail] = v;
        tail = (tail + 1) % cap;
      }
      for (let k = bOff[u], k1 = bOff[u + 1]; k < k1; k++) {
        const v = bIds[k];
        if (dynamic[v] || cost[v] <= c1) continue;
        cost[v] = c1;
        dq[tail] = v;
        tail = (tail + 1) % cap;
      }
    }
    if (!apply) return;
    for (let i = s; i < e; i++) {
      if (!dynamic[i] && cost[i] === INF) this.loosen(i);
    }
  }

  /**
   * Writes [id, x, y, z, qx, qy, qz, qw] for every loose piece that moved this
   * step (awake now, or fell asleep since the last call). Returns the count.
   */
  collectMoving(out: Float32Array): number {
    let n = 0;
    const max = Math.floor(out.length / 8);
    // Pieces put back: their layout poses, once.
    let r = 0;
    for (; r < this.restoredSince.length && n < max; r++) {
      const id = this.restoredSince[r];
      if (this.dynamic[id]) continue; // loose again already: reported below
      const s = this.layout.stones[id];
      const o = n * 8;
      out[o] = id;
      out[o + 1] = s.x;
      out[o + 2] = s.y;
      out[o + 3] = s.z;
      out[o + 4] = s.q[0];
      out[o + 5] = s.q[1];
      out[o + 6] = s.q[2];
      out[o + 7] = s.q[3];
      n++;
    }
    this.restoredSince.splice(0, r);
    for (const id of this.dynList) {
      if (this.shattered[id]) {
        if (this.shatterReported[id] || n >= max) continue;
        this.shatterReported[id] = 1;
        const o = n * 8;
        out[o] = id;
        out[o + 1] = 0;
        out[o + 2] = -1000; // gone: the renderer draws dust and chips where it was
        out[o + 3] = 0;
        out[o + 4] = 0;
        out[o + 5] = 0;
        out[o + 6] = 0;
        out[o + 7] = 1;
        n++;
        continue;
      }
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
    for (const id of this.dynList) if (!this.frozen[id] && !this.shattered[id] && !this.bodies[id].isSleeping()) n++;
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
