// Test harness for GameRenderer (served at /render-test.html). Drives the
// renderer with fake FrameData: projectiles of every kind, a chain, walking
// minions, two ragdolls, explosions, muzzle flashes, blood, a crater, the aim
// arc, a ghost trail and a landing marker. Not part of the game.
//
// Keys: 1 overview, 2 sight (long gun), 3 follow a ball, 4 sight (mortar),
// q cycles quality, g toggles gore, r resets the world.
// URL: ?cam=overview|sight|follow|mortar &quality=low|medium|high|ultra
//      &shot=1 (hide text) &dt=0.05 (fixed step) ; #webgl forces WebGL2.

import { ASHWRIGHT_EMPLACEMENTS, GAME_LAYOUT, LADDER, MID_Z, PLOTS, WEAPONS, buildLayout, ladderSpots, streamOffset } from "@keepfall/content";
import {
  CHAIN_STRIDE,
  EVENT_STRIDE,
  EventKind,
  KEG_STRIDE,
  LADDER_STRIDE,
  MINION_PARTS,
  MINION_STRIDE,
  PART_STRIDE,
  PLOT_STRIDE,
  PROJECTILE_STRIDE,
  ProjectileKind,
  TERRAIN_GRID,
  WORKS_STRIDE,
  type FrameData,
  type TerrainPatch,
} from "@keepfall/sim";
import { GameRenderer } from "./render/GameRenderer";
import type { CameraPose, QualityTier } from "./render/api";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("view") as HTMLCanvasElement;
const info = document.getElementById("info") as HTMLDivElement;
const errorEl = document.getElementById("error") as HTMLDivElement;
if (params.get("shot") === "1") document.body.classList.add("shot");
window.addEventListener("error", (e) => (errorEl.textContent += `${e.message}\n`));
window.addEventListener("unhandledrejection", (e) => (errorEl.textContent += `${String(e.reason)}\n`));

const layout = buildLayout(1, GAME_LAYOUT);
const ems = ASHWRIGHT_EMPLACEMENTS;
const r = new GameRenderer(canvas);
const state = { ready: false, frames: 0, backend: "", lost: "" };
(window as unknown as { __test: unknown }).__test = { state, r };
r.onDeviceLost = (m) => (state.lost = m);

const tiers: QualityTier[] = ["low", "medium", "high", "ultra"];
let quality = (params.get("quality") as QualityTier) || "low";
let camMode = params.get("cam") || "overview";
let gore = true;
const fixedDt = params.has("dt") ? Number(params.get("dt")) : 0;
const G = 9.81;

// --- fake sim data -----------------------------------------------------------

const projectiles = new Float32Array(64 * PROJECTILE_STRIDE);
const chains = new Float32Array(8 * CHAIN_STRIDE);
const minions = new Float32Array(48 * MINION_STRIDE);
const parts = new Float32Array(2 * MINION_PARTS.length * PART_STRIDE);
const events = new Float32Array(32 * EVENT_STRIDE);
// M4: ladders and the masons' work, staged at the target castle's front wall.
const ladders = new Float32Array(4 * LADDER_STRIDE);
const works = new Float32Array(1 * WORKS_STRIDE);
const spots = ladderSpots().filter((sp) => sp.castle === 0);
/** A front wall stone left of the gate, about 4 m up: the masons put it back again and again (the renderer animates it each time). */
const laidStone = layout.stones.find((st) => st.castle === 0 && st.part === "wall" && st.course === 8 && Math.abs(st.z + 15) < 0.5 && st.x < -5 && st.x > -7.5)!;
let lastLaid = -10;

function arc(x0: number, y0: number, z0: number, vx: number, vy: number, vz: number, t: number): [number, number, number, number, number, number] {
  return [x0 + vx * t, y0 + vy * t - 0.5 * G * t * t, z0 + vz * t, vx, vy - G * t, vz];
}

function arcPoints(x0: number, y0: number, z0: number, vx: number, vy: number, vz: number, seconds: number, n: number): Float32Array {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = arc(x0, y0, z0, vx, vy, vz, (seconds * i) / (n - 1));
    out[i * 3] = p[0];
    out[i * 3 + 1] = Math.max(0, p[1]);
    out[i * 3 + 2] = p[2];
  }
  return out;
}

// Two ragdolls lying on the ground near the target castle's gate.
function layRagdoll(at: number, id: number, x: number, z: number, heading: number) {
  // Standing heights of each part's centre, then laid flat along `heading`.
  const h = [0.97, 1.27, 1.62, 1.35, 1.1, 1.35, 1.1, 0.7, 0.28, 0.7, 0.28];
  const side = [0, 0, 0, 0.25, 0.3, -0.25, -0.3, 0.1, 0.1, -0.1, -0.1];
  const ch = Math.cos(heading), sh = Math.sin(heading);
  // Body axis along (sh, 0, ch); the part capsules lie along it (local Y -> heading).
  const ax = sh, az = ch;
  // Quaternion turning +Y onto (ax, 0, az): axis = Y x d = (az, 0, -ax), angle 90 degrees.
  const s = Math.SQRT1_2;
  for (let p = 0; p < MINION_PARTS.length; p++) {
    const o = (at * MINION_PARTS.length + p) * PART_STRIDE;
    const along = h[p] - 0.9;
    const across = side[p];
    parts[o] = id;
    parts[o + 1] = p;
    parts[o + 2] = x + ax * along + az * across;
    parts[o + 3] = MINION_PARTS[p].radius;
    parts[o + 4] = z + az * along - ax * across;
    if (p === 0) {
      // Pelvis lies across the body.
      parts[o + 5] = 0;
      parts[o + 6] = 0;
      parts[o + 7] = s;
      parts[o + 8] = s;
    } else {
      parts[o + 5] = az * s;
      parts[o + 6] = 0;
      parts[o + 7] = -ax * s;
      parts[o + 8] = s;
    }
  }
}
layRagdoll(0, 100, -4, -26, 0.4);
layRagdoll(1, 101, 3.5, -28.5, 2.2);

function craterPatch(cx: number, cz: number, radius: number, depth: number): TerrainPatch {
  const R = Math.ceil(radius * 1.6);
  const i0 = Math.round(cx - TERRAIN_GRID.x0) - R;
  const j0 = Math.round(cz - TERRAIN_GRID.z0) - R;
  const ni = R * 2 + 1, nj = R * 2 + 1;
  const h = new Float32Array(ni * nj);
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const x = TERRAIN_GRID.x0 + (i0 + i) * TERRAIN_GRID.cell;
      const z = TERRAIN_GRID.z0 + (j0 + j) * TERRAIN_GRID.cell;
      const d = Math.hypot(x - cx, z - cz) / radius;
      h[j * ni + i] = d < 1 ? -depth * (1 - d * d) + 0.25 * d * d : d < 1.5 ? 0.25 * (1 - (d - 1) / 0.5) : 0;
    }
  }
  return { i0, j0, ni, nj, h };
}

const longGun = ems[0];
const mortar = ems[1];
const lgDir = { yaw: 0.05, pitch: 0.04 };

// A few loose merlons on the target's front wall wobble slowly (dust trickle test).
const loose = layout.stones.filter((s) => s.castle === 0 && s.part === "merlon" && s.z < -14 && s.x > 2 && s.x < 9);

// M3: buildings on the target castle's plots (plot, kind, share up): a barracks
// and a Foundry at the front, a Powder Mill half risen beside the keep, a mill
// standing at the back; the other two plots are empty.
const built: Array<[number, number, number]> = [
  [0, 0, 1],
  [1, 2, 1],
  [2, 1, 0.5],
  [5, 1, 1],
];
const shown: number[] = [];
for (const [plot, kind, share] of built) {
  const range = layout.plots.find((p) => p.castle === 0 && p.plot === plot && p.kind === kind);
  if (range) for (let k = 0; k < Math.round(range.count * share); k++) shown.push(range.first + k);
}
const plotBuf = new Float32Array(PLOTS.length * PLOT_STRIDE);
PLOTS.forEach((_, i) => {
  const b = built.find(([plot]) => plot === i);
  plotBuf.set([0, i, b ? b[1] : -1, b ? (b[2] < 1 ? 1 : 2) : 0, b ? b[2] : 0, b ? b[2] : 0], i * PLOT_STRIDE);
});
const kegBuf = new Float32Array(KEG_STRIDE);

const stoneBuf = new Float32Array(Math.max(1, loose.length + shown.length) * 8);
function wobble(): Float32Array {
  loose.forEach((s, i) => {
    const w = Math.sin(t * 2 + i) * 0.04;
    stoneBuf.set([s.id, s.x + w, s.y, s.z - Math.abs(w), s.q[0], s.q[1], s.q[2], s.q[3]], i * 8);
  });
  shown.forEach((id, i) => {
    const s = layout.stones[id];
    stoneBuf.set([s.id, s.x, s.y, s.z, s.q[0], s.q[1], s.q[2], s.q[3]], (loose.length + i) * 8);
  });
  return stoneBuf;
}

let t = 0;
let lastExplosion = -10;
let lastMuzzle = -10;
let muzzleIdx = 0;
let lastBlood = -10;
let craterDone = false;

function buildFrame(dt: number): FrameData {
  t += dt;
  let np = 0;
  const put = (kind: number, id: number, p: number[], radius: number) => {
    const o = np * PROJECTILE_STRIDE;
    projectiles.set([kind, id, p[0], p[1], p[2], radius, p[3], p[4], p[5]], o);
    np++;
  };
  // A round shot towards the target castle, looping every 1.6 s.
  const tb = t % 1.6;
  put(ProjectileKind.Ball, 1, arc(0, 11.5, -131, 0, 3, 112, tb), WEAPONS.longGun.projectile.radius);
  // A mortar shell high over the field (long, lobbed), looping every 7 s.
  const ts = t % 7;
  put(ProjectileKind.Shell, 2, arc(0, 2, -146, 0.4, 34, 21, ts), WEAPONS.mortar.projectile.radius);
  // A chain-shot pair spinning, flying low.
  const tc = t % 2;
  const c = arc(-15, 15, -133, 1, 2, 78, tc);
  const ang = tc * WEAPONS.chainShot.chainSpin;
  const half = WEAPONS.chainShot.chainLength / 2;
  const ox = Math.cos(ang) * half, oy = Math.sin(ang) * half;
  put(ProjectileKind.Chain, 3, [c[0] + ox, c[1] + oy, c[2], c[3], c[4], c[5]], WEAPONS.chainShot.projectile.radius);
  put(ProjectileKind.Chain, 4, [c[0] - ox, c[1] - oy, c[2], c[3], c[4], c[5]], WEAPONS.chainShot.projectile.radius);
  chains.set([c[0] + ox, c[1] + oy, c[2], c[0] - ox, c[1] - oy, c[2]], 0);
  // A cone of grapeshot from the swivel gun.
  const tg = t % 1.2;
  for (let k = 0; k < 12; k++) {
    const a = k * 2.399, s = 0.05 * Math.sqrt(k / 12);
    put(ProjectileKind.Grape, 10 + k, arc(15, 14.5, -133.5, -4 + Math.cos(a) * s * 70, Math.sin(a) * s * 70, 69, tg), WEAPONS.swivel.projectile.radius);
  }

  // Eight pikemen (team 0) marching from the target castle, two Ashwright men (team 1).
  let nm = 0;
  for (let k = 0; k < 10; k++) {
    const team = k < 8 ? 0 : 1;
    const row = k % 4, col = Math.floor(k / 4);
    const speed = 1.3;
    const z = team === 0 ? -22 - ((t * speed) % 10) - col * 1.6 : -40 + Math.sin(t * 0.3 + k) * 2;
    const x = team === 0 ? -3 + row * 1.6 : 6 + k;
    const yaw = team === 0 ? Math.PI : Math.PI / 2;
    minions.set([k, x, 0, z, yaw, (t * 0.9 + k * 0.13) % 1, team, 0, 0], nm * MINION_STRIDE);
    nm++;
  }
  // Two pairs fighting with levelled pikes (a thrust every 1.5 s), three battering the target castle's gate, one standing.
  const staged: Array<[number, number, number, number, number]> = [
    // x, z, yaw, team, action (1 stand, 2 fight, 3 batter)
    [-6, -30, Math.PI, 0, 2],
    [-6, -32.2, 0, 1, 2],
    [-3.5, -30.4, Math.PI, 0, 2],
    [-3.6, -32.6, 0, 1, 2],
    [-1, -16.6, 0, 1, 3],
    [0.2, -16.6, 0, 1, 3],
    [1.3, -16.7, 0, 1, 3],
    [4, -31, Math.PI, 0, 1],
  ];
  staged.forEach(([x, z, yaw, team, action], j) => {
    minions.set([20 + j, x, 0, z, yaw, 0, team, action, (t * 60 + j * 23) % 90, 0], nm * MINION_STRIDE);
    nm++;
  });
  // M3: Ashwright musketeers (two aiming, a shot every 4 s each, one marching,
  // one jabbing at a pikeman) and sappers (one with his keg on his shoulder,
  // one setting his keg at the target castle's wall beside a burning one).
  const kit: Array<[number, number, number, number, number, number, number]> = [
    // x, z, yaw, team, action (0 walk, 2 fight, 8 plant, 9 aim), act, unit (3 sapper, 4 musketeer)
    [-9, -38, 0.25, 1, 9, (t * 60) % 240, 4],
    [-10.6, -38.6, 0.3, 1, 9, (t * 60 + 120) % 240, 4],
    [-11.4, -41, 0, 1, 0, 0, 4],
    [-1.2, -30.2, Math.PI, 0, 2, (t * 60 + 50) % 90, 0],
    [-1.3, -31.8, 0, 1, 2, (t * 60 + 10) % 90, 4],
    [-8.2, -42, 0, 1, 0, 0, 3],
    [6.8, -17.3, 0, 1, 8, 0, 3],
  ];
  kit.forEach(([x, z, yaw, team, action, act, unit], j) => {
    minions.set([60 + j, x, 0, z, yaw, (t * 0.9 + j * 0.31) % 1, team, action, act, unit], nm * MINION_STRIDE);
    nm++;
  });
  kegBuf.set([5.6, 0.35, -16.45, 240 - ((t * 60) % 240)], 0); // the sim reports a keg 0.35 m over the ground

  // M4: a ladder planted in the crenel at x = 8.1 with two men climbing it, a crew raising another at 4.5,
  // a crew carrying a third towards the wall, and two masons at work inside behind a hoist.
  let nl = 0;
  const putLadder = (id: number, team: number, state: number, f: number[], top: number[], k: number) => {
    ladders.set([id, team, state, f[0], f[1], f[2], top[0], top[1], top[2], k], nl * LADDER_STRIDE);
    nl++;
  };
  const sp = spots[3], sp2 = spots[2];
  putLadder(0, 1, 2, [sp.x, 0, sp.footZ], [sp.x, sp.topY, sp.topZ], 1);
  for (const [k, d] of [[0, 2.6], [1, 5.4]] as const) {
    const u = d / LADDER.length;
    minions.set([40 + k, sp.x, sp.topY * u, sp.footZ + (sp.topZ - sp.footZ) * u - 0.22, 0, (t * 0.7 + k * 0.5) % 1, 1, 6, 0, 0], nm * MINION_STRIDE);
    nm++;
  }
  // Raising: the top swings up from behind the foot.
  const rk = (t % 4) / 4;
  const lean = Math.atan2(sp2.topY, sp2.topZ - sp2.footZ);
  const th = (Math.PI - lean) * (rk * rk * (3 - 2 * rk));
  putLadder(1, 1, 1, [sp2.x, 0, sp2.footZ], [sp2.x, LADDER.length * Math.sin(th), sp2.footZ - LADDER.length * Math.cos(th)], rk);
  minions.set([42, sp2.x, 0, sp2.footZ - 0.5, 0, 0, 1, 7, 0, 2], nm * MINION_STRIDE);
  nm++;
  minions.set([43, sp2.x + 0.9, 0, sp2.footZ - 0.9, 0, 0, 1, 7, 0, 2], nm * MINION_STRIDE);
  nm++;
  // Carrying: two men 3.6 m apart walking at the wall.
  const cz = -27 + ((t * 1.3) % 5);
  minions.set([44, 12, 0, cz, 0, (t * 0.95) % 1, 1, 5, 0, 2], nm * MINION_STRIDE);
  nm++;
  minions.set([45, 12, 0, cz - 3.6, 0, (t * 0.95 + 0.5) % 1, 1, 5, 0, 2], nm * MINION_STRIDE);
  nm++;
  putLadder(2, 1, 0, [12, 1.52, cz - 1.8 - 4.5], [12, 1.52, cz - 1.8 + 4.5], 0);
  // Masons inside the gate's west side, under a hoist, mallets going.
  for (const [k, x] of [[0, -6.6], [1, -5.5]] as const) {
    minions.set([46 + k, x, 0, -12.6, Math.PI, 0, 0, 4, (t * 60 + k * 17) % 45, 1], nm * MINION_STRIDE);
    nm++;
  }
  works.set([0, laidStone.x, laidStone.y, laidStone.z, -6, -12.6, laidStone.id, 2], 0);

  // Events.
  let ne = 0;
  const ev = (k: number, a: number, b: number, c2: number, d: number) => {
    events.set([k, a, b, c2, d], ne * EVENT_STRIDE);
    ne++;
  };
  let terrain: TerrainPatch[] = [];
  if (t - lastExplosion > 3.5) {
    lastExplosion = t;
    ev(EventKind.Explosion, 8, 0.3, -45, 4);
    if (!craterDone) {
      craterDone = true;
      terrain = [craterPatch(8, -45, 3, 1.2)];
    }
  }
  if (t - lastMuzzle > 1.3) {
    lastMuzzle = t;
    ev(EventKind.Muzzle, muzzleIdx % 4, 0, 0, 0);
    muzzleIdx++;
  }
  if (tb < dt) ev(EventKind.Impact, 0, 6, -15.2, 0.8);
  // A shot into the stream by the centre bridge every 1.4 s, and a stone every 2.6 s (splashes).
  if (t % 1.4 < dt) ev(EventKind.Impact, 12, -0.8, MID_Z + streamOffset(12), 0.8);
  if (t % 2.6 < dt) ev(EventKind.Impact, 16.5, -0.8, MID_Z + streamOffset(16.5) - 1, 1.2);
  // M3: the aiming musketeers fire as their kick starts (a flash and a puff at the muzzle).
  if ((t * 60) % 240 < dt * 60) ev(EventKind.Musket, 60, -6, 1.3, -30);
  if ((t * 60 + 120) % 240 < dt * 60) ev(EventKind.Musket, 61, -3.5, 1.3, -30.4);
  if (t - lastBlood > 2.2) {
    lastBlood = t;
    ev(EventKind.Blood, -4, 0.9, -26, 0.9);
    ev(EventKind.Blood, 3.5, 0.6, -28.5, 0.5);
    // Against the target castle's front wall (blood on stone).
    ev(EventKind.Blood, -6, 1.3, -16.6, 0.7);
  }
  if (t - lastLaid > 2.5) {
    lastLaid = t;
    ev(EventKind.Laid, laidStone.id, 0, -1000, 0);
  }
  return {
    tick: Math.round(t * 60),
    stones: wobble(),
    stoneCount: loose.length + shown.length,
    projectiles,
    projectileCount: np,
    chains,
    chainCount: 1,
    minions,
    minionCount: nm,
    parts,
    partCount: 2 * MINION_PARTS.length,
    settled: new Float32Array(0),
    settledCount: 0,
    gone: new Int32Array(0),
    ladders: ladders.slice(0, nl * LADDER_STRIDE),
    ladderCount: nl,
    works: works.slice(),
    worksCount: 1,
    events,
    eventCount: ne,
    terrain,
    windX: 4,
    windZ: 1.5,
    plots: plotBuf,
    plotCount: PLOTS.length,
    kegs: kegBuf,
    kegCount: 1,
  };
}

// --- camera ---------------------------------------------------------------------

function pose(): CameraPose {
  if (camMode === "sight" || camMode === "mortar") {
    const em = camMode === "sight" ? longGun : mortar;
    const yaw = camMode === "sight" ? lgDir.yaw : 0;
    const pitch = camMode === "sight" ? lgDir.pitch : 0.25;
    const back = camMode === "sight" ? 4.5 : -3;
    const up = camMode === "sight" ? 1.4 : 9;
    return { mode: "sight", x: em.x - Math.sin(yaw) * back, y: em.y + up, z: em.z - Math.cos(yaw) * back, yaw, pitch, fov: camMode === "sight" ? 34 : 55 };
  }
  if (camMode === "follow") {
    const o = 0;
    return { mode: "follow", x: projectiles[o + 2], y: projectiles[o + 3], z: projectiles[o + 4], vx: projectiles[o + 6], vy: projectiles[o + 7], vz: projectiles[o + 8] };
  }
  return { mode: "overview" };
}

window.addEventListener("keydown", (e) => {
  if (e.key === "1") camMode = "overview";
  else if (e.key === "2") camMode = "sight";
  else if (e.key === "3") camMode = "follow";
  else if (e.key === "4") camMode = "mortar";
  else if (e.key === "q") {
    quality = tiers[(tiers.indexOf(quality) + 1) % tiers.length];
    r.setQuality(quality);
  } else if (e.key === "g") {
    gore = !gore;
    r.setGore(gore);
  } else if (e.key === "r") r.resetWorld();
});
window.addEventListener("resize", () => r.resize());

async function main() {
  const { backend } = await r.init({ forceWebGL: location.hash === "#webgl" });
  state.backend = backend;
  r.setLayout(layout, ems);
  // Test only: hide scene objects by name (?hide=stream,ground) to see what draws what.
  for (const name of (params.get("hide") ?? "").split(",").filter(Boolean)) {
    const o = (r as unknown as { scene: { getObjectByName(n: string): { visible: boolean } | undefined } }).scene.getObjectByName(name);
    if (o) o.visible = false;
  }
  // A storm two thirds of the way through on the target castle's courtyard.
  r.setStorm(0, 0.65, true);
  r.setQuality(quality);
  r.setGore(gore);
  r.resize();
  // Aim help for the long gun: the predicted arc, last shot's trail and where it landed.
  const sp = WEAPONS.longGun.speed;
  const dx = Math.sin(lgDir.yaw) * Math.cos(lgDir.pitch), dy = Math.sin(lgDir.pitch), dz = Math.cos(lgDir.yaw) * Math.cos(lgDir.pitch);
  const mx = longGun.x + dx * longGun.barrel, my = longGun.y + dy * longGun.barrel, mz = longGun.z + dz * longGun.barrel;
  r.setAimArc(arcPoints(mx, my, mz, dx * sp, dy * sp, dz * sp, 1.2, 40));
  const trail = arcPoints(mx, my, mz, dx * sp - 3, dy * sp - 2, dz * sp, 1.18, 60);
  r.setGhostTrail(trail);
  const n = trail.length / 3 - 1;
  r.setLandingMarker({ x: trail[n * 3], y: 0, z: trail[n * 3 + 2] });
  if (params.has("eye")) {
    // Test only: place the overview orbit (reaches into the renderer's camera).
    const [ex, ey, ez, tx, ty, tz] = params.get("eye")!.split(",").map(Number);
    r.setCamera({ mode: "overview" });
    const views = (r as unknown as { views: { camera: { position: { set(x: number, y: number, z: number): void } }; controls: { target: { set(x: number, y: number, z: number): void }; update(): void } } }).views;
    views.camera.position.set(ex, ey, ez);
    views.controls.target.set(tx, ty, tz);
    (views.controls as unknown as { minDistance: number }).minDistance = 1;
    views.controls.update();
  }
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    const dt = fixedDt > 0 ? fixedDt : Math.min(0.1, (now - last) / 1000);
    last = now;
    r.setWeaponPose(0, lgDir.yaw, lgDir.pitch, camMode === "sight");
    r.setWeaponPose(1, 0, 0.9 + Math.sin(t * 0.4) * 0.2, camMode === "mortar");
    r.setWeaponPose(2, 0.08 + Math.sin(t * 0.5) * 0.3, 0.05, false);
    r.setWeaponPose(3, -0.08 + Math.sin(t * 0.7) * 0.5, -0.1, false);
    r.applyFrame(buildFrame(dt));
    r.setCamera(pose());
    r.render(dt);
    state.frames++;
    state.ready = true;
    if (state.frames % 10 === 0) {
      const s = r.getStats();
      info.textContent = `${s.backend} ${quality} ${camMode}\n${s.drawCalls} draws ${s.triangles} tris\n${s.width}x${s.height}${state.lost ? `\nlost: ${state.lost}` : ""}`;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
main().catch((e) => (errorEl.textContent += `${e?.stack || e}\n`));
