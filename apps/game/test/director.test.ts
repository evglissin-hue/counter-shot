import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_STRIDE, EventKind, PROJECTILE_STRIDE, STONE_STRIDE } from "@keepfall/sim";
import type { MomentKind } from "../src/moments";
import { direct, type DirectorClip, type DirectorFrame, type DirectorMoment, type Sight, type Take } from "../src/director";

interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

/** A world of boxes of masonry on flat ground (or a slope when given). */
function world(boxes: Box[], ground: (x: number, z: number) => number = () => 0): Sight {
  return {
    ground,
    blocked(ax, ay, az, bx, by, bz) {
      for (const b of boxes) {
        let t0 = 0;
        let t1 = 1;
        const a = [ax, ay, az];
        const d = [bx - ax, by - ay, bz - az];
        let hit = true;
        for (let k = 0; k < 3; k++) {
          if (Math.abs(d[k]) < 1e-9) {
            if (a[k] < b.min[k] || a[k] > b.max[k]) hit = false;
          } else {
            let u0 = (b.min[k] - a[k]) / d[k];
            let u1 = (b.max[k] - a[k]) / d[k];
            if (u0 > u1) [u0, u1] = [u1, u0];
            t0 = Math.max(t0, u0);
            t1 = Math.min(t1, u1);
            if (t0 > t1) hit = false;
          }
        }
        if (hit) return true;
      }
      return false;
    },
  };
}
const inside = (b: Box, x: number, y: number, z: number) => x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && z >= b.min[2] && z <= b.max[2];

const TOWER: Box = { min: [0, 0, -5], max: [10, 30, 5] };

function frame(tick: number, o: { stones?: number[][]; balls?: number[][]; events?: number[][] } = {}): DirectorFrame {
  const stones = new Float32Array((o.stones ?? []).flat());
  const projectiles = new Float32Array((o.balls ?? []).flat());
  const events = new Float32Array((o.events ?? []).flat());
  return {
    tick,
    stones,
    stoneCount: stones.length / STONE_STRIDE,
    projectiles,
    projectileCount: projectiles.length / PROJECTILE_STRIDE,
    events,
    eventCount: events.length / EVENT_STRIDE,
  };
}

/** A tower of 40 stones released at tick 100, toppling along +x and landing within about two seconds. */
function toppleFrames(from = 60, to = 400): DirectorFrame[] {
  const out: DirectorFrame[] = [];
  for (let t = from; t <= to; t += 2) {
    const s = Math.max(0, (t - 100) / 60);
    const stones: number[][] = [];
    if (t >= 100) {
      for (let i = 0; i < 40; i++) {
        const y0 = 5 + i * 0.5;
        const y = Math.max(0.5, y0 - 0.5 * 9.8 * s * s);
        stones.push([i, 5 + 12 * s * (1 + i / 40), y, 0, 0, 0, 0, 1]);
      }
    }
    out.push(frame(t, { stones }));
  }
  return out;
}

const moment = (kind: MomentKind, o: Partial<DirectorMoment> = {}): DirectorMoment => ({ kind, tick: 130, x: 5, y: 10, z: 0, team: 0, ...o });
const clipOf = (m: DirectorMoment, frames: DirectorFrame[], from = 60, to = 400): DirectorClip => ({ moment: m, from, to, frames });

/** A ball flying along +x at 60 m/s, last seen at tick 200. */
function shotFrames(shot = 7, from = 120, to = 330): DirectorFrame[] {
  const out: DirectorFrame[] = [];
  for (let t = from; t <= to; t += 2) {
    const balls: number[][] = [];
    if (t <= 200) balls.push([0, shot, -60 + (t - 140), 12, 40, 0.3, 60, 0, 0]);
    out.push(frame(t, { balls }));
  }
  return out;
}

function ticksOf(take: Take, step = 1): number[] {
  const out: number[] = [];
  for (let t = take.start; t <= take.end; t += step) out.push(t);
  return out;
}

function assertContinuous(take: Take, max = 2) {
  let prev = take.poseAt(take.start);
  for (let t = take.start + 1; t <= take.end; t++) {
    const p = take.poseAt(t);
    for (const [a, b] of [
      [p.x, prev.x],
      [p.y, prev.y],
      [p.z, prev.z],
      [p.tx, prev.tx],
      [p.ty, prev.ty],
      [p.tz, prev.tz],
    ]) {
      assert.ok(Math.abs(a - b) <= max, `pose steps ${Math.abs(a - b)} m at tick ${t}`);
    }
    prev = p;
  }
}

function assertSame(a: Take, b: Take) {
  assert.equal(a.recipe, b.recipe);
  assert.equal(a.start, b.start);
  assert.equal(a.end, b.end);
  assert.equal(a.seconds, b.seconds);
  for (let t = a.start; t <= a.end; t++) {
    assert.deepEqual(a.poseAt(t), b.poseAt(t));
    assert.equal(a.speedAt(t), b.speedAt(t));
  }
}

test("a toppling tower is filmed side on, slow from release to ground", () => {
  const sight = world([TOWER]);
  const take = direct(clipOf(moment("towerDown"), toppleFrames()), sight);
  assert.equal(take.recipe, "topple");
  assert.equal(take.start, 60);
  assert.equal(take.end, 400);
  const slow = ticksOf(take).filter((t) => take.speedAt(t) === 0.25);
  assert.ok(slow.length > 60, "a slow stretch");
  assert.ok(slow[0] >= 100 && slow[0] <= 101, `release ${slow[0]}`);
  assert.ok(slow[slow.length - 1] <= 100 + 180, "within the cap");
  assert.equal(take.speedAt(99), 1);
  assert.equal(take.speedAt(slow[slow.length - 1] + 3), 1);
  assert.equal(take.speedAt(399), 1);
  // Side on: the fall runs along +x, so the eye is out along z, 60 m from its line, low.
  const p = take.poseAt(150);
  assert.ok(Math.abs(Math.abs(p.z) - 60) < 1, `eye z ${p.z}`);
  assert.ok(p.y >= 3 && p.y <= 8, `eye height ${p.y}`);
  assert.equal(p.fov, 50);
  // It looks at the falling stones, which travelled along +x.
  assert.ok(take.poseAt(200).tx > take.poseAt(100).tx);
  assert.ok(take.seconds > 340 / 60, "slow motion lengthens it");
  assertContinuous(take);
});

test("every kind gets its recipe", () => {
  const sight = world([TOWER]);
  const frames = toppleFrames();
  const topple: MomentKind[] = ["towerDown", "breachOpened", "buildingWrecked", "gateDown", "floorCaved", "bannerDown", "collapseKill", "bridgeDown", "lastBlow"];
  for (const k of topple) assert.equal(direct(clipOf(moment(k), frames), sight).recipe, "topple", k);
  for (const k of ["kegChain", "kegBack"] as const) assert.equal(direct(clipOf(moment(k), frames), sight).recipe, "wide-close", k);
  for (const k of ["stormBegun", "stormBeaten"] as const) assert.equal(direct(clipOf(moment(k), frames), sight).recipe, "wide", k);
  for (const k of ["multiKill", "ricochetKill", "thrown", "gunSilenced"] as const) {
    assert.equal(direct(clipOf(moment(k, { shot: 7, x: 0, y: 1, z: 40 }), shotFrames(), 120, 330), sight).recipe, "beside", k);
  }
  // A masonry kind with a shot stays a topple; a kegBack with a shot stays wide-close.
  assert.equal(direct(clipOf(moment("gateDown", { shot: 7 }), shotFrames(), 120, 330), sight).recipe, "topple");
  assert.equal(direct(clipOf(moment("kegBack", { shot: 7 }), shotFrames(), 120, 330), sight).recipe, "wide-close");
});

test("a shot is filmed beside the ball at a fifth speed around the impact", () => {
  const sight = world([TOWER]);
  const m = moment("multiKill", { shot: 7, tick: 230, x: 0, y: 1, z: 40 });
  const take = direct(clipOf(m, shotFrames(), 120, 330), sight);
  assert.equal(take.recipe, "beside");
  assert.equal(take.poseAt(150).fov, 40);
  // The ball's last frame is tick 200: a fifth speed from 1 s before to 1.5 s after.
  assert.equal(take.speedAt(130), 1);
  assert.equal(take.speedAt(139), 1);
  assert.equal(take.speedAt(141), 0.2);
  assert.equal(take.speedAt(200), 0.2);
  assert.equal(take.speedAt(289), 0.2);
  assert.equal(take.speedAt(291), 1);
  // Beside the ball: about 8 m to its side and 2 m above it.
  const p = take.poseAt(170);
  const ball = [-60 + 30, 12, 40];
  const dist = Math.hypot(p.x - ball[0], p.z - ball[2]);
  assert.ok(Math.abs(dist - 8) < 0.5, `side distance ${dist}`);
  assert.ok(Math.abs(p.y - ball[1] - 2) < 0.5, `height ${p.y}`);
  // Looking a little ahead of it.
  assert.ok(p.tx > ball[0]);
  // After the ball is gone it looks at the moment's place.
  const end = take.poseAt(330);
  assert.ok(Math.hypot(end.tx - m.x, end.ty - m.y, end.tz - m.z) < 1.5, "looks at the moment");
  assertContinuous(take);
});

test("kegs: wide first, then close as the stones come down", () => {
  const sight = world([]);
  const take = direct(clipOf(moment("kegChain", { x: 5, y: 10, z: 0 }), toppleFrames()), sight);
  assert.equal(take.recipe, "wide-close");
  const far = take.poseAt(70);
  const near = take.poseAt(300);
  const dFar = Math.hypot(far.x - 5, far.z);
  const dNear = Math.hypot(near.x - 5, near.z);
  assert.ok(Math.abs(dFar - 80) < 1 && Math.abs(far.y - 35) < 1, `wide ${dFar} ${far.y}`);
  assert.ok(Math.abs(dNear - 25) < 1 && Math.abs(near.y - 16) < 1, `close ${dNear} ${near.y}`);
  assertContinuous(take);
  // An explosion event also starts the close-up.
  const ex = [frame(60), frame(100, { events: [[EventKind.Explosion, 5, 10, 0, 6]] }), frame(200)];
  const t2 = direct(clipOf(moment("kegBack", { tick: 100 }), ex, 60, 200), sight);
  assert.ok(Math.hypot(t2.poseAt(99).x - 5, t2.poseAt(99).z) > 79);
  assert.ok(Math.hypot(t2.poseAt(200).x - 5, t2.poseAt(200).z) < 26);
});

test("wide pushes in at real speed; orbit turns a quarter", () => {
  const sight = world([]);
  const w = direct(clipOf(moment("stormBegun", { x: 20, y: 0, z: 30 }), [], 0, 300), sight);
  assert.equal(w.recipe, "wide");
  assert.equal(w.speedAt(150), 1);
  assert.ok(Math.hypot(w.poseAt(300).x - 20, w.poseAt(300).z - 30) < Math.hypot(w.poseAt(0).x - 20, w.poseAt(0).z - 30));
  assert.ok(Math.abs(w.seconds - 5) < 1e-9);
  assert.equal(w.poseAt(10).fov, 50);
  assertContinuous(w);
  // A kind the director does not know falls to the orbit.
  const orb = direct(clipOf({ ...moment("lastBlow"), kind: "unknown" as MomentKind, x: 0, y: 0, z: 0 }, [], 0, 240), sight);
  assert.equal(orb.recipe, "orbit");
  const a = orb.poseAt(0);
  const b = orb.poseAt(240);
  assert.ok(Math.abs(Math.hypot(a.x, a.z) - 40) < 1e-6 && Math.abs(a.y - 12) < 1e-6);
  const cos = (a.x * b.x + a.z * b.z) / (Math.hypot(a.x, a.z) * Math.hypot(b.x, b.z));
  assert.ok(Math.abs(cos) < 1e-6, "a quarter turn");
  assert.equal(orb.poseAt(10).fov, 45);
  assertContinuous(orb);
});

test("the camera stays out of masonry: a wall on the preferred side sends it round", () => {
  // The preferred side is +z (the fall runs along +x); a long wall stands there.
  const wall: Box = { min: [-40, 0, 20], max: [80, 40, 30] };
  const sight = world([TOWER, wall]);
  const take = direct(clipOf(moment("towerDown"), toppleFrames()), sight);
  assert.equal(take.recipe, "topple");
  const side = take.poseAt(150);
  assert.ok(side.z < 20, `eye is not behind the wall: z ${side.z}`);
  assert.ok(Math.abs(side.z) < 1 || side.z < -20, "it moved round the wall");
  assert.ok(!sight.blocked(side.x, side.y, side.z, side.tx, side.ty, side.tz), "clear sight line");
  for (const t of ticksOf(take)) {
    const p = take.poseAt(t);
    assert.ok(!inside(TOWER, p.x, p.y, p.z) && !inside(wall, p.x, p.y, p.z));
    assert.ok(p.y >= sight.ground(p.x, p.z) + 1.5);
  }
});

test("a beside camera in a world of masonry never enters it and stays above the ground", () => {
  const house: Box = { min: [-45, 0, 30], max: [-15, 20, 36] };
  const sight = world([TOWER, house], (x) => 0.02 * x);
  const m = moment("ricochetKill", { shot: 7, tick: 230, x: 0, y: 1, z: 40 });
  const take = direct(clipOf(m, shotFrames(), 120, 330), sight);
  for (const t of ticksOf(take)) {
    const p = take.poseAt(t);
    assert.ok(!inside(TOWER, p.x, p.y, p.z) && !inside(house, p.x, p.y, p.z), `eye in masonry at ${t}`);
    assert.ok(p.y >= sight.ground(p.x, p.z) + 1.5, `eye under the ground at ${t}`);
  }
  assertContinuous(take);
});

test("when no bearing is clear the clearest wins, raised by 10 m", () => {
  // A ring of walls round the fall leaves no way in at ground level.
  const ring: Box[] = [
    { min: [-200, 0, 30], max: [200, 12, 80] },
    { min: [-200, 0, -80], max: [200, 12, -30] },
    { min: [-200, 0, -80], max: [-60, 12, 80] },
    { min: [60, 0, -80], max: [200, 12, 80] },
  ];
  const take = direct(clipOf(moment("towerDown"), toppleFrames()), world(ring));
  assert.equal(take.recipe, "topple");
  assert.ok(take.poseAt(150).y >= 10 + 3);
  assertContinuous(take);
});

test("the same input gives the same take", () => {
  const sight = world([TOWER, { min: [-40, 0, 20], max: [80, 40, 30] }]);
  const cases: Array<[DirectorMoment, DirectorFrame[], number, number]> = [
    [moment("towerDown"), toppleFrames(), 60, 400],
    [moment("multiKill", { shot: 7, tick: 230, x: 0, y: 1, z: 40 }), shotFrames(), 120, 330],
    [moment("kegChain"), toppleFrames(), 60, 400],
  ];
  for (const [m, f, a, b] of cases) assertSame(direct(clipOf(m, f, a, b), sight), direct(clipOf(m, f, a, b), sight));
});

test("a budget trims the lead-in, then the tail, and keeps the moment", () => {
  const sight = world([TOWER]);
  const m = moment("towerDown", { tick: 130 });
  const full = direct(clipOf(m, toppleFrames()), sight);
  const t = direct(clipOf(m, toppleFrames()), sight, { budget: 8 });
  assert.ok(full.seconds > 8);
  assert.ok(t.seconds <= 8, `seconds ${t.seconds}`);
  assert.ok(t.start <= 130 && t.end >= 130, "the moment's tick is inside");
  assert.ok(t.start >= 60 && t.end <= 400);
  assert.ok(t.start > full.start, "lead-in cut");
  // The camera does not change with the budget.
  assert.deepEqual(t.poseAt(150), full.poseAt(150));
  // A tight budget still keeps the moment.
  const tight = direct(clipOf(m, toppleFrames()), sight, { budget: 1 });
  assert.ok(tight.seconds <= 1 && tight.start <= 130 && tight.end >= 130, `${tight.start} ${tight.end}`);
  // A budget the take already meets changes nothing.
  const same = direct(clipOf(m, toppleFrames()), sight, { budget: 1000 });
  assert.equal(same.start, full.start);
  assert.equal(same.end, full.end);
  // A shot take under budget too.
  const sm = moment("multiKill", { shot: 7, tick: 230, x: 0, y: 1, z: 40 });
  const st = direct(clipOf(sm, shotFrames(), 120, 330), sight, { budget: 6 });
  assert.ok(st.seconds <= 6 && st.start <= 230 && st.end >= 230);
});

test("tickAt inverts the play time", () => {
  const sight = world([TOWER]);
  const take = direct(clipOf(moment("towerDown"), toppleFrames()), sight);
  assert.equal(take.tickAt(0), take.start);
  assert.equal(take.tickAt(take.seconds), take.end);
  assert.equal(take.tickAt(take.seconds + 5), take.end);
  let prev = take.start;
  for (let s = 0; s <= take.seconds; s += take.seconds / 97) {
    const t = take.tickAt(s);
    assert.ok(t >= prev - 1e-9, "monotone");
    prev = t;
  }
  // Real speed: half a second is thirty ticks; at a quarter speed, fifteen.
  assert.ok(Math.abs(take.tickAt(0.5) - (take.start + 30)) < 1e-6);
  const slowStart = ticksOf(take).find((t) => take.speedAt(t) === 0.25)!;
  const secs = (slowStart - take.start) / 60;
  assert.ok(Math.abs(take.tickAt(secs + 1) - (slowStart + 15)) < 1e-6);
  // A cut take starts and ends where it says.
  const cut = direct(clipOf(moment("towerDown"), toppleFrames()), sight, { budget: 5 });
  assert.equal(cut.tickAt(0), cut.start);
  assert.ok(Math.abs(cut.tickAt(cut.seconds) - cut.end) < 1e-9);
});

test("clips with no moving stones, no projectile or no frames still get a valid take", () => {
  const sight = world([TOWER]);
  const empty = [frame(60), frame(120), frame(180)];
  const cases: DirectorMoment[] = [
    moment("towerDown", { tick: 120 }),
    moment("multiKill", { tick: 120, shot: 99 }),
    moment("thrown", { tick: 120 }),
    moment("kegChain", { tick: 120 }),
    moment("stormBeaten", { tick: 120 }),
    moment("bannerDown", { tick: 120, x: 0, y: 0, z: 0 }),
  ];
  for (const m of cases) {
    for (const frames of [empty, []]) {
      const take = direct(clipOf(m, frames, 60, 180), sight, { budget: 3 });
      assert.ok(Number.isFinite(take.seconds) && take.seconds <= 3, m.kind);
      assert.ok(take.start >= 60 && take.end <= 180 && take.start <= take.end);
      for (const t of ticksOf(take, 10)) {
        const p = take.poseAt(t);
        for (const v of [p.x, p.y, p.z, p.tx, p.ty, p.tz, p.fov]) assert.ok(Number.isFinite(v), `${m.kind} at ${t}`);
        assert.ok(take.speedAt(t) > 0);
      }
      assertContinuous(take);
    }
  }
  // A shot that never shows in the frames falls back to the orbit.
  assert.equal(direct(clipOf(moment("multiKill", { shot: 99 }), empty, 60, 180), sight).recipe, "orbit");
  // A one-tick clip.
  const one = direct(clipOf(moment("towerDown", { tick: 60 }), [frame(60)], 60, 60), sight);
  assert.equal(one.start, 60);
  assert.equal(one.end, 60);
  assert.equal(one.seconds, 0);
});
