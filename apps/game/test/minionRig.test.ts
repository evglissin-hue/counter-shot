import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SLOTS, Rig, SHIN_L, SHIN_R, XF_N, XF_STRIDE, type FigureSink } from "../src/render/minionRig";

const SHIN = 0.47;
const flat = () => 0;

/** A sink that keeps each figure's transforms by id. */
class Keep implements FigureSink {
  seen = new Map<number, Float32Array>();
  shows = new Map<number, number>();
  figure(_s: number, id: number, _team: number, _unit: number, shows: number, xf: Float32Array, o: number) {
    this.seen.set(id, xf.slice(o, o + XF_N));
    this.shows.set(id, shows);
  }
}

/** World position of an ankle from a shin transform (its +Y points from the ankle up to the knee). */
function ankle(x: Float32Array, part: number): [number, number, number] {
  const o = part * XF_STRIDE;
  const qx = x[o + 3], qy = x[o + 4], qz = x[o + 5], qw = x[o + 6];
  // q * (0, 1, 0)
  const ax = 2 * (qx * qy - qw * qz), ay = 1 - 2 * (qx * qx + qz * qz), az = 2 * (qy * qz + qw * qx);
  const half = (SHIN * x[o + 7]) / 2;
  return [x[o] - ax * half, x[o + 1] - ay * half, x[o + 2] - az * half];
}

test("a marching man's feet stay planted while they carry him (no skating) and touch the ground", () => {
  const rig = new Rig();
  const sink = new Keep();
  const v = 1.6;
  let planted = 0, slide = 0, minY = Infinity;
  const prev: Array<[number, number, number] | null> = [null, null];
  for (let k = 0; k < 360; k++) {
    const t = k / 60;
    rig.begin(k);
    rig.take(7, 0, 0, v * t, 0, ((v * t) / 1.4) % 1, 0, 0, 600, 0);
    rig.end();
    rig.sweep();
    rig.animate(1 / 60, flat, 0, 1e4, 0, 0.577, sink);
    const x = sink.seen.get(7)!;
    if (k < 60) continue;
    [SHIN_L, SHIN_R].forEach((part, i) => {
      const a = ankle(x, part);
      minY = Math.min(minY, a[1]);
      const p = prev[i];
      if (p && a[1] < 0.03 && p[1] < 0.03) {
        // A foot flat on the ground: how far it moved over the ground this frame, against how far the body went.
        planted++;
        slide += Math.hypot(a[0] - p[0], a[2] - p[2]);
      }
      prev[i] = a;
    });
  }
  assert.ok(planted > 100, `feet on the ground in ${planted} frames`);
  // The body moves v/60 a frame; a planted foot rolls forward a little (heel to toe) but must not skate along with it.
  const perFrame = slide / planted;
  assert.ok(perFrame < (v / 60) * 0.25, `a planted foot moves ${(perFrame * 60).toFixed(2)} m/s over the ground (body ${v} m/s)`);
  assert.ok(minY > -0.02 && minY < 0.03, `soles reach the ground (lowest ${minY.toFixed(3)} m)`);
});

test("every action and unit poses without NaN, kit where it belongs, blends and a sweep", () => {
  const rig = new Rig();
  const sink = new Keep();
  let id = 0;
  for (let unit = 0; unit <= 4; unit++) {
    for (let action = 0; action <= 9; action++) {
      const me = id++;
      for (let k = 0; k < 400; k++) {
        // Each figure walks for a second, then takes its action (a blend), then act cycles as the sim's does.
        const a = k < 60 ? 0 : action;
        const act = a === 4 ? k % 45 : a === 8 ? Math.min(75, k - 60) : (k * 7) % 330;
        const moving = a === 0 || a === 5;
        const z = moving ? k * 0.027 : 60 * 0.027;
        const y = a === 6 ? (k - 60) * 0.016 : 0;
        rig.begin(k);
        rig.take(me, 0, y, z, a === 6 ? 0 : k * 0.01, (z / 1.4) % 1, 1, a, act, unit);
        rig.end();
        rig.sweep();
        rig.animate(1 / 60, flat, 0, 2, -5, 0.577, sink);
        const x = sink.seen.get(me)!;
        for (let i = 0; i < x.length; i++) assert.ok(Number.isFinite(x[i]), `unit ${unit} action ${action} tick ${k}: transform ${i} is ${x[i]}`);
      }
      // Kit: a pikeman always has his pike; a musketeer his musket; a sapper has his keg until he sets it.
      const shows = sink.shows.get(me)!;
      if (unit === 0 || unit === 4) assert.ok(shows & 1, `unit ${unit} action ${action} shows its kit`);
    }
  }
  // Figures not in a frame are let go.
  rig.begin(10000);
  rig.end();
  rig.sweep();
  assert.equal(rig.slotOf.size, 0);
  assert.ok(MAX_SLOTS >= 640);
});

test("a blow that misses makes the man it was aimed at parry", () => {
  const rig = new Rig();
  const sink = new Keep();
  let parried = false, base = 0;
  for (let k = 0; k < 200; k++) {
    rig.begin(k);
    // Two pikemen 2 m apart facing each other; the first strikes at tick 100 (act back to zero).
    rig.take(1, 0, 0, 0, 0, 0, 0, 2, k < 100 ? 80 + k : k - 100, 0);
    rig.take(2, 0, 0, 2, Math.PI, 0, 1, 2, 300, 0);
    rig.end();
    rig.sweep();
    rig.animate(1 / 60, flat, 0, 2, -5, 0.577, sink);
    const head = sink.seen.get(2)!;
    // The parry pulls his head back (towards +z, away from the blow).
    if (k === 99) base = head[2 * XF_STRIDE + 2];
    if (k > 100 && k < 125 && head[2 * XF_STRIDE + 2] > base + 0.03) parried = true;
  }
  assert.ok(parried, "the defender's head went back after the blow");
});
