// Test harness for GameRenderer (served at /render-test.html). Drives the
// renderer with fake FrameData: projectiles of every kind, a chain, walking
// minions, two ragdolls, explosions, muzzle flashes, blood, a crater, the aim
// arc, a ghost trail and a landing marker. Not part of the game.
//
// Keys: 1 overview, 2 sight (long gun), 3 follow a ball, 4 sight (mortar),
// q cycles quality, g toggles gore, r resets the world.
// URL: ?cam=overview|sight|follow|mortar &quality=low|medium|high|ultra
//      &shot=1 (hide text) &dt=0.05 (fixed step) ; #webgl forces WebGL2.

import { ASHWRIGHT_EMPLACEMENTS, WEAPONS, buildLayout } from "@keepfall/content";
import {
  CHAIN_STRIDE,
  EVENT_STRIDE,
  EventKind,
  MINION_PARTS,
  MINION_STRIDE,
  PART_STRIDE,
  PROJECTILE_STRIDE,
  ProjectileKind,
  TERRAIN_GRID,
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

const layout = buildLayout(1);
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
const minions = new Float32Array(16 * MINION_STRIDE);
const parts = new Float32Array(2 * MINION_PARTS.length * PART_STRIDE);
const events = new Float32Array(32 * EVENT_STRIDE);

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
    minions.set([k, x, 0, z, yaw, (t * 0.9 + k * 0.13) % 1, team], nm * MINION_STRIDE);
    nm++;
  }

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
  if (t - lastBlood > 2.2) {
    lastBlood = t;
    ev(EventKind.Blood, -4, 0.9, -26, 0.8);
    ev(EventKind.Blood, 3.5, 0.6, -28.5, 0.5);
  }
  return {
    tick: Math.round(t * 60),
    stones: new Float32Array(0),
    stoneCount: 0,
    projectiles,
    projectileCount: np,
    chains,
    chainCount: 1,
    minions,
    minionCount: nm,
    parts,
    partCount: 2 * MINION_PARTS.length,
    events,
    eventCount: ne,
    terrain,
    windX: 4,
    windZ: 1.5,
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
