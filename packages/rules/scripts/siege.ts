// How long does the enemy keep stand against a perfect gunner? The player's
// long gun fires at the keep's face just under the floor the banner stands
// on (left, middle, right in turn) and the mortar drops shells on the banner,
// each as soon as it is loaded, with nobody else on the field (masons on or
// off). Prints when the banner came down and the shots it took.
// 3.4: with `cut`, the perfect gunner of the new way to fell a keep: the enemy gate's leaves are knocked off at the start,
// the long gun fires as soon as it is loaded at the best point on the keep's foot it can see (the choice of a Warlord that
// tries every point, with no error in its aim: the point whose hit, forecast by the mason's eye, leaves the keep holding
// least), the mortar at the foot of the face being cut. Prints when the keep fell and how (topple or crush, course), the
// shots of each gun and the gold the masons spent; with `masons` the enemy holds 3000 gold (rule 13 aims at 2 to 3 minutes
// without masons and 4 to 6 against a full crew).
// npx rolldown packages/rules/scripts/siege.ts --format esm --platform node -o node_modules/.scratch/siege.mjs && node node_modules/.scratch/siege.mjs [cut] [masons] [seeds]
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BUTTRESS_FACES, buildLayout, CASTLE_SHAPE, GAME_LAYOUT, KEEP_STOREYS, keepStructure, structureList, weaponOf, type ButtressFace, type CastleLayout, type Emplacement, type KeepOptions } from "@keepfall/content";
import { aimDir, DEFAULT_SIM, EVENT_STRIDE, EventKind, flightCoef, flightDv, G, muzzle, solveAim, Spin, StaticState, type Rapier } from "@keepfall/sim";
import { Match, Team } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;
// Keep variants: old (the M4 keep), or thick=, hard=, hits=, foot= (3.4: the foot's hardness) (default: the match keep).
const arg = (k: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1];
const keep: KeepOptions | undefined = process.argv.includes("old")
  ? undefined
  : { thick: Number(arg("thick") ?? GAME_LAYOUT.keep?.thick ?? 1.4), hard: Number(arg("hard") ?? GAME_LAYOUT.keep?.hard ?? 1), storeyHits: Number(arg("hits") ?? GAME_LAYOUT.keep?.storeyHits ?? 1), footHard: Number(arg("foot") ?? GAME_LAYOUT.keep?.footHard ?? GAME_LAYOUT.keep?.hard ?? 1) };
const layout = buildLayout(1, { ...GAME_LAYOUT, keep });
console.log("keep", JSON.stringify(keep ?? "old"));
const masons = process.argv.includes("masons");
const seeds = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 3);
const MAX = 60 * Number(arg("secs") ?? 360);
const face = CASTLE_SHAPE.keepZ - CASTLE_SHAPE.keepHalf; // the enemy keep's face towards the player

// ---- 3.4: the perfect gunner's cut ----

interface Cand {
  id: number;
  course: number;
  x: number;
  y: number;
  z: number;
}
const FOOT = KEEP_STOREYS[0] - 1;
const faceNormal = (castle: number, f: ButtressFace): [number, number] => {
  const z = castle === 0 ? -1 : 1, l = castle === 0 ? -1 : 1;
  return f === "front" ? [0, z] : f === "back" ? [0, -z] : f === "left" ? [l, 0] : [-l, 0];
};

/** Points on the foot of a castle's keep and of its buttress piers (one for each piece's outward face, the piers' flanks too). */
function candidates(lay: CastleLayout, castle: number): Cand[] {
  const out: Cand[] = [];
  const kp = structureList(lay)[keepStructure(castle)];
  const faceOf = new Map<number, [number, number]>();
  for (const b of lay.buttresses) {
    if (b.castle !== castle) continue;
    const n = faceNormal(castle, b.face);
    for (let id = b.first; id < b.first + b.count; id++) faceOf.set(id, n);
  }
  for (const s of lay.stones) {
    if (s.castle !== castle || s.course >= FOOT) continue;
    if (s.part === "keep") {
      const rx = s.x - kp.cx, rz = s.z - kp.cz;
      const alongX = Math.abs(rz) > Math.abs(rx);
      out.push({ id: s.id, course: s.course, x: alongX ? s.x : s.x + (rx < 0 ? -s.hx : s.hx), y: s.y, z: alongX ? s.z + (rz < 0 ? -s.hz : s.hz) : s.z });
    } else if (s.part === "buttress") {
      const n = faceOf.get(s.id);
      if (!n) continue;
      const ax = n[0] !== 0 ? s.hx : s.hz, at = n[0] !== 0 ? s.hz : s.hx;
      out.push({ id: s.id, course: s.course, x: s.x + n[0] * ax, y: s.y, z: s.z + n[1] * ax });
      out.push({ id: s.id, course: s.course, x: s.x - n[1] * at, y: s.y, z: s.z + n[0] * at });
      out.push({ id: s.id, course: s.course, x: s.x + n[1] * at, y: s.y, z: s.z - n[0] * at });
    }
  }
  return out;
}

/** Axis aligned half extents of each stone (a turned one or a wedge by its widest extent): enough to say whether a path meets it. */
function halfBoxes(lay: CastleLayout): Float32Array {
  const wp = lay.wedge.points;
  let w = 0;
  for (let i = 0; i < wp.length; i++) w = Math.max(w, Math.abs(wp[i]));
  const out = new Float32Array(lay.stones.length * 3);
  for (const s of lay.stones) {
    const turned = Math.abs(s.q[3]) < 0.999999 || s.shape === "wedge";
    const wide = s.shape === "wedge" ? w : Math.max(s.hx, s.hy, s.hz);
    out.set(turned ? [wide, wide, wide] : [s.hx, s.hy, s.hz], s.id * 3);
  }
  return out;
}

/** A shot's flight in still air from a gun laid at (yaw, pitch) to as far out as (tx, tz): points a metre apart near the end, and the speed and direction on arrival. */
function flight(e: Emplacement, yaw: number, pitch: number, tx: number, tz: number) {
  const w = weaponOf(e), c = flightCoef(w.projectile);
  const [mx, my, mz] = muzzle(e, yaw, pitch);
  const [ux, uy, uz] = aimDir(yaw, pitch);
  const v: [number, number, number] = [ux * w.speed, uy * w.speed, uz * w.speed];
  const dv: [number, number, number] = [0, 0, 0];
  const reach = Math.hypot(tx - e.x, tz - e.z);
  let px = mx, py = my, pz = mz;
  const path: number[] = [];
  for (let i = 0; i < 9 * 60; i++) {
    flightDv(v, null, 0, 0, c, dv);
    v[0] += dv[0];
    v[1] += dv[1] - (G * c.gravity) / 60;
    v[2] += dv[2];
    const qx = px + v[0] / 60, qy = py + v[1] / 60, qz = pz + v[2] / 60;
    const a = Math.hypot(px - e.x, pz - e.z), b = Math.hypot(qx - e.x, qz - e.z);
    const done = b >= reach;
    const f = done ? (b > a ? (reach - a) / (b - a) : 1) : 1;
    const ex = px + (qx - px) * f, ey = py + (qy - py) * f, ez = pz + (qz - pz) * f;
    if (b >= reach - 60) {
      const n = Math.max(1, Math.ceil(Math.hypot(ex - px, ey - py, ez - pz)));
      for (let k = 1; k <= n; k++) path.push(px + ((ex - px) * k) / n, py + ((ey - py) * k) / n, pz + ((ez - pz) * k) / n);
    }
    if (done) {
      const sp = Math.hypot(v[0], v[1], v[2]);
      return { path, speed: sp, dx: v[0] / sp, dy: v[1] / sp, dz: v[2] / sp };
    }
    px = qx;
    py = qy;
    pz = qz;
    if (py < -5) return null;
  }
  return null;
}

/** The enemy keep's face being cut (its owner's words): the face its weakest course would fall towards, the front while undamaged. */
function cutFace(dirX: number, dirZ: number, weakest: number): ButtressFace {
  if (weakest < 0) return "front";
  let best: ButtressFace = "front", bd = -Infinity;
  for (const f of BUTTRESS_FACES) {
    const [nx, nz] = faceNormal(0, f);
    if (nx * dirX + nz * dirZ > bd) {
      bd = nx * dirX + nz * dirZ;
      best = f;
    }
  }
  return best;
}

function cutRun(seed: number) {
  // Every gun at its full rate (the keep match turns powder off); `powder=on` plays it with the powder rules.
  const m = new Match(R, layout, { seed, barracks: false, garrison: false, masons, gunnery: false, plan: false, powder: arg("powder") === "on" });
  const castle = m.world.castle, st = m.world.statics!;
  const lg = m.emplacements[0], mo = m.emplacements[1];
  const ki = keepStructure(0), def = st.list[ki];
  for (const s of layout.stones) if (s.castle === 0 && s.part === "gate") castle.knockLoose(s.id, 0, 0, 0);
  if (masons) m.gold[0] = 3000;
  const cands = candidates(layout, 0), box = halfBoxes(layout), dyn = castle.dynamic;
  const near: number[] = [];
  let lgShots = 0, moShots = 0, blind = 0;
  let fell: string | null = null, fellAt = 0;
  let evSeen = 0;
  const events = (m.world as unknown as { events: number[] }).events;
  const t0 = performance.now();
  const clear = (path: number[], c: Cand): boolean => {
    for (let i = 0; i + 2 < path.length; i += 3) {
      const x = path[i], y = path[i + 1], z = path[i + 2];
      if ((x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2 <= 1) continue;
      near.length = 0;
      castle.standingNear(x, y, z, 3, near);
      for (const id of near) {
        const s = layout.stones[id];
        if (s.castle !== 0) continue;
        const k = id * 3;
        if (Math.abs(x - s.x) <= box[k] + 0.1 && Math.abs(y - s.y) <= box[k + 1] + 0.1 && Math.abs(z - s.z) <= box[k + 2] + 0.1) return false;
      }
    }
    return true;
  };
  for (let t = 0; t < MAX && !m.result; t++) {
    if (m.world.reload[0] === 0 && t % 6 === 0 && st.status(ki).state === StaticState.Standing) {
      // Every point it can see; the one whose forecast hit leaves the keep holding least (ties: lower course, lower id).
      let best: { c: Cand; yaw: number; pitch: number } | null = null, bestHolds = Infinity;
      const w = weaponOf(lg);
      for (const c of cands) {
        if (dyn[c.id]) continue;
        const a = solveAim(lg, c.x, c.y, c.z);
        if (!a) continue;
        const f = flight(lg, a.yaw, a.pitch, c.x, c.z);
        if (!f || !clear(f.path, c)) continue;
        const r = (DEFAULT_SIM.blastBase + f.speed * DEFAULT_SIM.blastPerSpeed) * (w.projectile.power ?? 1);
        const gone: number[] = [];
        for (const id of def.stones) {
          if (dyn[id]) continue;
          const s = layout.stones[id], h = s.hard ?? 1;
          if (((s.x - (c.x + f.dx)) ** 2 + (s.y - (c.y + f.dy)) ** 2 + (s.z - (c.z + f.dz)) ** 2) * h * h <= r * r) gone.push(id);
        }
        const holds = st.whatIf(ki, gone).holds;
        if (best === null || holds < bestHolds - 1e-9 || (Math.abs(holds - bestHolds) <= 1e-9 && (c.course < best.c.course || (c.course === best.c.course && c.id < best.c.id)))) {
          best = { c, yaw: a.yaw, pitch: a.pitch };
          bestHolds = holds;
        }
      }
      if (best) {
        m.queue(t, Team.Player, { kind: "fire", emplacement: 0, yaw: best.yaw, pitch: best.pitch, charge: 1, fuse: 0, spin: Spin.None });
        lgShots++;
      } else blind++;
    }
    if (m.world.reload[1] === 0 && t % 6 === 3 && st.status(ki).state === StaticState.Standing) {
      // A shell at the foot of the face being cut, just outside it; if that is beyond the mortar's reach, the nearest point towards it that is not.
      const sv = st.status(ki);
      const [nx, nz] = faceNormal(0, cutFace(sv.dirX, sv.dirZ, sv.weakest));
      const x = def.cx + nx * (def.half + 0.8), z = def.cz + nz * (def.half + 0.8);
      let a = null;
      for (let back = 0; back < 8 && !a; back += 0.25) a = solveAim(mo, x - nx * back, 0.4, z - nz * back);
      if (a) {
        m.queue(t, Team.Player, { kind: "fire", emplacement: 1, yaw: a.yaw, pitch: a.pitch, charge: a.charge, fuse: 0, spin: Spin.None });
        moShots++;
      }
    }
    m.step();
    for (; evSeen + EVENT_STRIDE <= events.length; evSeen += EVENT_STRIDE) {
      const k = events[evSeen];
      if ((k === EventKind.Topple || k === EventKind.Crush) && events[evSeen + 1] === ki && !fell) {
        fell = `${k === EventKind.Topple ? "topple" : "crush"} at course ${events[evSeen + 2]}`;
        fellAt = t;
      }
    }
  }
  const r = m.result;
  console.log(`cut seed ${seed} ${masons ? "with masons and 3000 gold" : "no masons"}: ${fell ? `keep fell at ${(fellAt / 60).toFixed(1)} s (${fell})` : "keep still standing"}${r ? `, match over at ${(r.tick / 60).toFixed(1)} s (${r.reason})` : ""}; shots by hand ${m.shots[Team.Player]} (long gun orders ${lgShots}, ${blind} loaded with nothing in sight; mortar orders ${moShots}); enemy keep pieces down ${m.masonryDown(0)}; masons spent ${m.spent[0]} gold (crew ${JSON.stringify(m.world.works!.status(0))}); ${((performance.now() - t0) / 1000).toFixed(1)} s wall`);
  m.free();
}

if (process.argv.includes("cut")) {
  for (let seed = 1; seed <= seeds; seed++) cutRun(seed);
  process.exit(0);
}

for (let seed = 1; seed <= seeds; seed++) {
  const m = new Match(R, layout, { seed, barracks: false, garrison: false, masons, gunnery: false, plan: false });
  const lg = m.emplacements[0], mo = m.emplacements[1];
  let lgShots = 0, moShots = 0;
  const floors: string[] = [];
  let lastFloor = 99;
  const t0 = performance.now();
  for (let t = 0; t < MAX && !m.result; t++) {
    const b = m.world.castle.bodies[layout.bannerIds[0]].translation();
    const floor = b.y > 17 ? 3 : b.y > 10.5 ? 2 : b.y > 4 ? 1 : 0;
    if (floor < lastFloor) {
      if (lastFloor !== 99) floors.push(`${floor}@${(t / 60).toFixed(0)}s(${lgShots}lg,${moShots}mo)`);
      lastFloor = floor;
    }
    if (m.world.reload[0] === 0 && t % 6 === 0) {
      const x = [-2.6, 0, 2.6][lgShots % 3];
      const s = solveAim(lg, x, b.y - 1.6, face);
      if (s) {
        m.queue(t, Team.Player, { kind: "fire", emplacement: 0, yaw: s.yaw, pitch: s.pitch, charge: 1, fuse: 0, spin: Spin.None });
        lgShots++;
      }
    }
    if (m.world.reload[1] === 0 && t % 6 === 3) {
      // The keep's middle is beyond the mortar's reach: the nearest point towards the player that is not.
      let s = null;
      for (let dz = 0; dz < 8 && !s; dz += 0.25) s = solveAim(mo, b.x, b.y - 0.3, b.z - dz);
      if (s) {
        m.queue(t, Team.Player, { kind: "fire", emplacement: 1, yaw: s.yaw, pitch: s.pitch, charge: s.charge, fuse: 0, spin: Spin.None });
        moShots++;
      }
    }
    m.step();
  }
  const r = m.result;
  console.log(`seed ${seed}: ${r ? `keep down at ${(r.tick / 60).toFixed(1)} s` : "still standing"} after ${lgShots} long gun and ${moShots} mortar shots; enemy keep pieces down ${m.masonryDown(0)}; floors ${floors.join(" ")}; gold spent ${m.spent[0]}; ${((performance.now() - t0) / 1000).toFixed(1)} s wall`);
  m.free();
}
