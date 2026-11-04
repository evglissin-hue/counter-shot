// The sandbox page: ride the four Ashwright weapons against the target castle.
// Aiming runs here at a fixed 60 Hz through the same limiter the sim checks;
// a fire sends the exact aim to the worker, which owns everything else.

import { ASHWRIGHT_EMPLACEMENTS, buildLayout, WEAPONS, type Emplacement } from "@keepfall/content";
import {
  aimDir,
  clampAim,
  EVENT_STRIDE,
  EventKind,
  flightCoef,
  muzzle,
  predictPath,
  PROJECTILE_STRIDE,
  restAim,
  Spin,
  spinVector,
  stepAim,
  type AimState,
  type FrameData,
} from "@keepfall/sim";
import { Input } from "./input";
import type { FromWorker, ToWorker } from "./protocol";
import type { QualityTier } from "./render/api";
import { GameRenderer } from "./render/GameRenderer";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("scene");
const renderer = new GameRenderer(canvas);
const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
const send = (m: ToWorker) => worker.postMessage(m);
const input = new Input(canvas);
const layout = buildLayout(1, { mirrorWedges: true });
const EMP: Emplacement[] = ASHWRIGHT_EMPLACEMENTS;

const SPIN_NAMES = ["None", "Top", "Back", "Left", "Right"];
const MOUSE_RAD_PER_PX = 0.0016;
const SEED = 7;
const MINIONS = 12;

// ---- state ------------------------------------------------------------------
let current = 0;
const aims: AimState[] = EMP.map((e) => restAim(e, WEAPONS[e.weapon]));
/** Where the player wants the weapon to point; the weapon turns towards it at its own rate. */
const wanted: AimState[] = aims.map((a) => ({ ...a }));
const fov: number[] = EMP.map((e) => WEAPONS[e.weapon].fov[1] * 0.8);
let fuseTicks = 4 * 60; // mortar: 0 means burst on impact
let spin: Spin = Spin.None;
let view: "sight" | "overview" = "sight";
let shotCam = false;
let reload: number[] = EMP.map(() => 0);
let wind = { x: 0, z: 0 };
let ready = false;
let paused = false;
const trails: Array<Float32Array | null> = EMP.map(() => null);
const recording = new Map<number, { emp: number; pts: number[] }>(); // shot id -> trail
const landing: Array<{ x: number; y: number; z: number } | null> = EMP.map(() => null);
let follow: { id: number; lastX: number; lastY: number; lastZ: number; vx: number; vy: number; vz: number; until: number } | null = null;
let slowUntil = 0;
let lastFrameTick = 0;
let stats = { stepMs: 0, down: 0, standing: 0, awake: 0 };

// ---- worker -------------------------------------------------------------------
worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  if (m.t === "ready") {
    renderer.applyTerrain([m.terrain]);
    ready = true;
    $("loading").hidden = true;
    return;
  }
  if (m.t === "error") {
    showError(m.message);
    return;
  }
  if (m.t === "frame") {
    reload = m.reload;
    stats = { stepMs: m.stepMs, down: m.down, standing: m.standing, awake: m.awake };
    onFrame(m.frame);
  }
};
worker.onerror = (e) => showError(e.message || "The simulation worker failed to start.");

function onFrame(f: FrameData) {
  wind = { x: f.windX, z: f.windZ };
  lastFrameTick = f.tick;
  for (let k = 0; k < f.eventCount; k++) {
    const o = k * EVENT_STRIDE;
    const kind = f.events[o];
    if (kind === EventKind.Muzzle) {
      const emp = f.events[o + 1], id = f.events[o + 2];
      recording.set(id, { emp, pts: [] });
      if (shotCam && emp === current) follow = { id, lastX: 0, lastY: 0, lastZ: 0, vx: 0, vy: 0, vz: 0, until: 0 };
    } else if (kind === EventKind.Landed) {
      const emp = f.events[o + 1];
      landing[emp] = { x: f.events[o + 2], y: f.events[o + 3], z: f.events[o + 4] };
    }
  }
  // Record every live shot's first ball for its ghost trail; follow the chosen one.
  const seen = new Set<number>();
  for (let i = 0; i < f.projectileCount; i++) {
    const o = i * PROJECTILE_STRIDE;
    const id = f.projectiles[o + 1];
    if (seen.has(id)) continue;
    seen.add(id);
    const x = f.projectiles[o + 2], y = f.projectiles[o + 3], z = f.projectiles[o + 4];
    const rec = recording.get(id);
    if (rec && rec.pts.length < 3 * 600) rec.pts.push(x, y, z);
    if (follow && follow.id === id) {
      follow.lastX = x;
      follow.lastY = y;
      follow.lastZ = z;
      follow.vx = f.projectiles[o + 6];
      follow.vy = f.projectiles[o + 7];
      follow.vz = f.projectiles[o + 8];
    }
  }
  for (const [id, rec] of recording) {
    if (seen.has(id)) continue;
    if (rec.pts.length >= 6) trails[rec.emp] = new Float32Array(rec.pts);
    recording.delete(id);
  }
  // The shot camera: slow down when the followed shot lands, then hand back.
  if (follow) {
    const now = performance.now();
    if (!seen.has(follow.id) || landedNow(f, follow.id)) {
      if (!follow.until) {
        follow.until = now + 1600;
        slowUntil = now + 900;
        send({ t: "speed", factor: 0.25 });
      }
    }
  }
  renderer.applyFrame(f);
}

function landedNow(f: FrameData, _id: number): boolean {
  for (let k = 0; k < f.eventCount; k++) {
    const kind = f.events[k * EVENT_STRIDE];
    if ((kind === EventKind.Landed && f.events[k * EVENT_STRIDE + 1] === current) || kind === EventKind.Explosion) return true;
  }
  return false;
}

// ---- aiming at a fixed 60 Hz ------------------------------------------------------
let aimAcc = 0;
function aimTick() {
  const e = EMP[current];
  const w = WEAPONS[e.weapon];
  const fine = input.down("ShiftLeft") || input.down("ShiftRight");
  const pad = input.gamepad();
  // Positive yaw turns left on screen (towards +X while facing +Z), so "right" is negative.
  let rateYaw = input.axis("KeyD", "KeyA") + input.axis("ArrowRight", "ArrowLeft");
  let ratePitch = input.axis("KeyS", "KeyW") + input.axis("ArrowDown", "ArrowUp");
  let padFine = false;
  if (pad) {
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    const lx = dz(pad.axes[0] ?? 0), ly = dz(pad.axes[1] ?? 0), rx = dz(pad.axes[2] ?? 0), ry = dz(pad.axes[3] ?? 0);
    if (lx || ly) {
      rateYaw -= lx;
      ratePitch -= ly;
    } else if (rx || ry) {
      rateYaw -= rx;
      ratePitch -= ry;
      padFine = true;
    }
  }
  const k = fine || padFine ? w.fine : 1;
  if (rateYaw || ratePitch) {
    // Keys and sticks drive the weapon directly at its rate; the wanted aim follows.
    wanted[current] = clampAim(
      { yaw: aims[current].yaw + (Math.max(-1, Math.min(1, rateYaw)) * w.yawRate * k) / 60, pitch: aims[current].pitch + (Math.max(-1, Math.min(1, ratePitch)) * w.pitchRate * k) / 60 },
      e,
      w,
    );
  }
  const a = aims[current], t = wanted[current];
  aims[current] = stepAim(a, { dYaw: t.yaw - a.yaw, dPitch: t.pitch - a.pitch, fine: fine || padFine }, e, w);
}

function applyMouse() {
  if (!input.locked || view !== "sight") {
    input.mouseX = input.mouseY = 0;
    return;
  }
  const e = EMP[current], w = WEAPONS[e.weapon];
  const fine = input.down("ShiftLeft") || input.down("ShiftRight");
  const zoomK = fov[current] / w.fov[1]; // slower when zoomed in
  const k = MOUSE_RAD_PER_PX * zoomK * (fine ? 0.35 : 1);
  const t = wanted[current];
  // Mouse right turns the aim right (towards -X when facing +Z), i.e. lower yaw.
  wanted[current] = clampAim({ yaw: t.yaw - input.mouseX * k, pitch: t.pitch - input.mouseY * k }, e, w);
  input.mouseX = input.mouseY = 0;
}

function fire() {
  if (!ready || reload[current] > 0) return;
  const e = EMP[current];
  const a = aims[current];
  send({ t: "input", input: { kind: "fire", emplacement: current, yaw: a.yaw, pitch: a.pitch, charge: 1, fuse: fuseTicks, spin: e.weapon === "longGun" ? spin : Spin.None } });
  reload[current] = WEAPONS[e.weapon].reload; // until the worker confirms
}

function select(i: number) {
  current = ((i % EMP.length) + EMP.length) % EMP.length;
  view = "sight";
  updateHud(true);
}

// ---- camera and aim help ---------------------------------------------------------
function cameraPose() {
  const now = performance.now();
  if (follow && (!follow.until || now < follow.until) && follow.lastY) {
    return { mode: "follow" as const, x: follow.lastX, y: follow.lastY, z: follow.lastZ, vx: follow.vx, vy: follow.vy, vz: follow.vz };
  }
  if (follow && follow.until && now >= follow.until) follow = null;
  if (view === "overview") return { mode: "overview" as const };
  const e = EMP[current], a = aims[current];
  const [fx, , fz] = aimDir(a.yaw, 0);
  if (e.weapon === "mortar") {
    // The mortar points at the sky: look out over the wall towards where it is aimed.
    return { mode: "sight" as const, x: e.x - fx * 7, y: e.y + 12.5, z: e.z - fz * 7, yaw: a.yaw, pitch: -0.02, fov: fov[current] };
  }
  const [dx, dy, dz] = aimDir(a.yaw, a.pitch);
  return { mode: "sight" as const, x: e.x - dx * 3.2, y: e.y + 1.1 - dy * 3.2, z: e.z - dz * 3.2, yaw: a.yaw, pitch: a.pitch - 0.05, fov: fov[current] };
}

function updateAimHelp() {
  const e = EMP[current], w = WEAPONS[e.weapon], a = aims[current];
  if (view !== "sight" || follow) {
    renderer.setAimArc(null);
  } else {
    const m = muzzle(e, a.yaw, a.pitch);
    const d = aimDir(a.yaw, a.pitch);
    const sv = e.weapon === "longGun" ? spinVector(a.yaw, spin, w.spinRate) : null;
    const v: [number, number, number] = [d[0] * w.speed, d[1] * w.speed, d[2] * w.speed];
    renderer.setAimArc(predictPath(m, v, sv, wind.x, wind.z, flightCoef(w.projectile), w.arcSeconds, 2));
  }
  renderer.setGhostTrail(trails[current]);
  renderer.setLandingMarker(landing[current]);
  for (let i = 0; i < EMP.length; i++) renderer.setWeaponPose(i, aims[i].yaw, aims[i].pitch, i === current);
}

// ---- HUD -------------------------------------------------------------------------
const hud = {
  name: $("w-name"),
  slot: $("w-slot"),
  reload: $("w-reload"),
  reloadFill: $("w-reload-fill"),
  extra: $("w-extra"),
  windArrow: $("wind-arrow"),
  windSpeed: $("wind-speed"),
  minions: $("minions"),
  perf: $("perf"),
  crosshair: $("crosshair"),
  want: $("want"),
  lock: $("lock-hint"),
};
const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-weapon]")];
tabs.forEach((b) => b.addEventListener("click", () => select(Number(b.dataset.weapon))));

let hudFrame = 0;
function updateHud(force = false) {
  if (!force && (hudFrame++ & 3) !== 0) return;
  const e = EMP[current], w = WEAPONS[e.weapon];
  hud.name.textContent = w.name;
  hud.slot.textContent = `${current + 1}`;
  tabs.forEach((b, i) => b.setAttribute("aria-pressed", String(i === current)));
  const r = reload[current];
  hud.reload.textContent = r > 0 ? `Reloading ${(r / 60).toFixed(1)} s` : "Ready";
  hud.reloadFill.style.transform = `scaleX(${1 - r / w.reload})`;
  if (e.weapon === "mortar") hud.extra.textContent = fuseTicks === 0 ? "Fuse: on impact  ( [ ] )" : `Fuse: ${(fuseTicks / 60).toFixed(1)} s  ( [ ] )`;
  else if (e.weapon === "longGun") hud.extra.textContent = `Spin: ${SPIN_NAMES[spin]}  (R)`;
  else if (e.weapon === "chainShot") hud.extra.textContent = "Two balls on a spinning chain";
  else hud.extra.textContent = `${w.pellets} balls of grapeshot`;
  // Wind relative to where you look: up on the gauge is straight ahead.
  const a = aims[current];
  const [fx, , fz] = aimDir(a.yaw, 0);
  const rx = -fz, rz = fx; // right
  const ahead = wind.x * fx + wind.z * fz, side = wind.x * rx + wind.z * rz;
  const ang = (Math.atan2(side, ahead) * 180) / Math.PI;
  hud.windArrow.style.transform = `rotate(${ang}deg)`;
  const ws = Math.hypot(wind.x, wind.z);
  hud.windSpeed.textContent = `${ws.toFixed(1)} m/s`;
  hud.minions.textContent = `${stats.down} down, ${stats.standing} standing`;
  hud.perf.textContent = `step ${stats.stepMs.toFixed(1)} ms, ${stats.awake} moving, tick ${lastFrameTick}`;
  hud.lock.hidden = input.locked || view !== "sight" || input.usedPad;
}

/** Where the wanted aim is on screen, relative to the barrel, for the lead marker. */
function placeWanted() {
  const a = aims[current], t = wanted[current];
  if (view !== "sight" || follow || (Math.abs(a.yaw - t.yaw) < 0.002 && Math.abs(a.pitch - t.pitch) < 0.002)) {
    hud.want.hidden = true;
    return;
  }
  const f = fov[current];
  const tanH = Math.tan(((f * Math.PI) / 180) / 2);
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const sx = -(t.yaw - a.yaw) / (tanH * aspect);
  const sy = -(t.pitch - a.pitch) / tanH;
  hud.want.hidden = false;
  hud.want.style.transform = `translate(${(sx * canvas.clientWidth) / 2}px, ${(sy * canvas.clientHeight) / 2}px)`;
}

// ---- panel controls -----------------------------------------------------------------
const quality = $<HTMLSelectElement>("quality");
quality.addEventListener("change", () => {
  renderer.setQuality(quality.value as QualityTier);
  renderer.resize();
  try {
    localStorage.setItem("keepfall.quality", quality.value);
  } catch {}
});
const gore = $<HTMLInputElement>("gore");
gore.addEventListener("change", () => renderer.setGore(gore.checked));
$("reset").addEventListener("click", () => {
  send({ t: "reset", seed: SEED, minions: MINIONS });
  renderer.resetWorld();
  trails.fill(null);
  landing.fill(null);
  recording.clear();
  follow = null;
});
$("more").addEventListener("click", () => send({ t: "input", input: { kind: "minions", count: 6 } }));
const help = $("help");
$("help-btn").addEventListener("click", () => (help.hidden = !help.hidden));
$("help-close").addEventListener("click", () => (help.hidden = true));
$("shotcam").addEventListener("change", (e) => (shotCam = (e.target as HTMLInputElement).checked));
$("overview-btn").addEventListener("click", () => toggleOverview());

// First launch: a quick graphics test. Starting at Ultra, each tier renders
// the live scene for about 1.5 seconds; the first whose 95th-percentile frame
// fits 60 fps (with a little slack) is kept and saved.
let calib: { tier: number; frames: number[]; warm: number } | null = null;
function calibrate(dt: number) {
  if (!calib || !ready || paused) return;
  if (calib.warm > 0) {
    calib.warm--;
    return;
  }
  calib.frames.push(dt);
  if (calib.frames.length < 90) return;
  const sorted = calib.frames.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  if (p95 <= 1 / 60 * 1.12 || calib.tier === 0) {
    const tier = TIER_ORDER[calib.tier];
    calib = null;
    try {
      localStorage.setItem("keepfall.quality", tier);
    } catch {}
    const note = $("note");
    note.textContent = `Quality set to ${tier} for this machine. Change it under Controls.`;
    note.hidden = false;
    setTimeout(() => (note.hidden = true), 5000);
    return;
  }
  calib.tier--;
  calib.frames = [];
  calib.warm = 30;
  quality.value = TIER_ORDER[calib.tier];
  renderer.setQuality(quality.value as QualityTier);
  renderer.resize();
}

// Frame-time guard: after 5 seconds of missed frames, drop one quality tier and say so.
const TIER_ORDER: QualityTier[] = ["low", "medium", "high", "ultra"];
let slowFrames = 0, guardFrames = 0;
function guard(dt: number) {
  if (!ready || paused || calib) return;
  guardFrames++;
  if (dt > 1 / 45) slowFrames++;
  if (guardFrames < 300) return;
  const share = slowFrames / guardFrames;
  guardFrames = slowFrames = 0;
  const i = TIER_ORDER.indexOf(quality.value as QualityTier);
  if (share > 0.5 && i > 0) {
    quality.value = TIER_ORDER[i - 1];
    renderer.setQuality(quality.value as QualityTier);
    renderer.resize();
    const note = $("note");
    note.textContent = `Frames were slow, so quality dropped to ${quality.value}. Change it under Controls.`;
    note.hidden = false;
    setTimeout(() => (note.hidden = true), 6000);
  }
}

function toggleOverview() {
  view = view === "sight" ? "overview" : "sight";
  if (view === "overview") document.exitPointerLock?.();
}

function showError(msg: string) {
  const el = $("error");
  el.hidden = false;
  el.textContent = msg;
}

// ---- main loop ----------------------------------------------------------------------
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const p = input.read();
  if (p.weapon >= 0) select(p.weapon);
  if (p.next) select(current + 1);
  if (p.prev) select(current - 1);
  if (p.overview) toggleOverview();
  if (p.help) help.hidden = !help.hidden;
  if (p.shotCam) {
    shotCam = !shotCam;
    ($("shotcam") as HTMLInputElement).checked = shotCam;
  }
  if (p.spin && EMP[current].weapon === "longGun") spin = ((spin + 1) % 5) as Spin;
  const w = WEAPONS[EMP[current].weapon];
  const fuseStep = (dir: number) => {
    if (EMP[current].weapon !== "mortar") return;
    if (fuseTicks === 0 && dir > 0) fuseTicks = w.fuseMin;
    else if (fuseTicks <= w.fuseMin && dir < 0) fuseTicks = 0;
    else if (fuseTicks !== 0) fuseTicks = Math.max(w.fuseMin, Math.min(w.fuseMax, fuseTicks + dir * 15));
  };
  if (p.fuseUp) fuseStep(1);
  if (p.fuseDown) fuseStep(-1);
  if (input.wheelAlt) {
    fuseStep(-input.wheelAlt);
    input.wheelAlt = 0;
  }
  const pad = input.gamepad();
  const zoomIn = input.zoomHeld || input.down("KeyZ") || (pad ? (pad.buttons[6]?.value ?? 0) > 0.5 : false);
  if (input.wheel) {
    fov[current] = Math.max(w.fov[0], Math.min(w.fov[1], fov[current] * (input.wheel > 0 ? 1.12 : 1 / 1.12)));
    input.wheel = 0;
  }
  const shownFov = zoomIn ? w.fov[0] : fov[current];
  if (p.fire && view === "sight") fire();

  applyMouse();
  aimAcc += dt;
  while (aimAcc >= 1 / 60) {
    aimTick();
    aimAcc -= 1 / 60;
  }
  if (slowUntil && now > slowUntil) {
    slowUntil = 0;
    send({ t: "speed", factor: 1 });
  }
  const pose = cameraPose();
  if (pose.mode === "sight") pose.fov = shownFov;
  renderer.setCamera(pose);
  updateAimHelp();
  updateHud();
  placeWanted();
  if (!paused) renderer.render(dt);
  calibrate(dt);
  guard(dt);
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  paused = document.hidden;
  send({ t: "pause", paused });
});

// ---- start ------------------------------------------------------------------------------
async function start() {
  try {
    const info = await renderer.init({ forceWebGL: location.hash.includes("webgl") });
    $("backend").textContent = info.backend;
    renderer.onDeviceLost = (message) => showError(`The graphics device was lost (${message}). Reload the page, or add #webgl to the address.`);
  } catch (err) {
    showError(`Could not start the renderer: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  // A saved choice wins; otherwise the quick test starts at Ultra (High if storage is unavailable).
  let tier: QualityTier = "high";
  let saved: QualityTier | null = null;
  let storage = true;
  try {
    saved = localStorage.getItem("keepfall.quality") as QualityTier | null;
  } catch {
    storage = false;
  }
  if (saved && TIER_ORDER.includes(saved)) tier = saved;
  else if (storage && !location.hash.includes("low")) {
    tier = "ultra";
    calib = { tier: 3, frames: [], warm: 60 };
  }
  if (location.hash.includes("low")) tier = "low";
  quality.value = tier;
  renderer.setLayout(layout, EMP);
  renderer.setQuality(tier);
  renderer.setGore(gore.checked);
  renderer.resize();
  window.addEventListener("resize", () => renderer.resize());
  send({ t: "init", seed: SEED, minions: MINIONS });
  updateHud(true);
  requestAnimationFrame(frame);
}
void start();
