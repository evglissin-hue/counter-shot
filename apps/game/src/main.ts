// The game page: a start menu, the Practice range (ride the four Ashwright
// weapons against the target castle) and a match against the AI castle.
// Aiming runs here at a fixed 60 Hz through the same limiter the sim checks;
// a fire sends the exact aim to the worker, which owns everything else.

import { ASHWRIGHT_EMPLACEMENTS, buildLayout, GAME_LAYOUT, KEEP_STOREYS, WEAPONS, type Emplacement, type Stone } from "@keepfall/content";
import {
  aimDir,
  clampAim,
  EVENT_STRIDE,
  EventKind,
  flightCoef,
  G,
  muzzle,
  predictPath,
  PROJECTILE_STRIDE,
  ProjectileKind,
  restAim,
  Spin,
  spinVector,
  stepAim,
  type AimState,
  type FrameData,
} from "@keepfall/sim";
import { Input } from "./input";
import type { FromWorker, MatchInfo, Mode, ToWorker } from "./protocol";
import type { CameraPose, PathHit, QualityTier } from "./render/api";
import { GameRenderer } from "./render/GameRenderer";
import { Sound } from "./sound";
import { Pacer, SCALES } from "./pacing";
import { Timeline } from "./timeline";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("scene");
const renderer = new GameRenderer(canvas);
const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
const send = (m: ToWorker) => worker.postMessage(m);
const input = new Input(canvas);
const sound = new Sound();
const layout = buildLayout(1, GAME_LAYOUT);
/** Sim frames are applied on a render clock a little behind the sim, and shells and stones are drawn between them. */
const timeline = new Timeline(layout);
const EMP: Emplacement[] = ASHWRIGHT_EMPLACEMENTS;

const SPIN_NAMES = ["None", "Top", "Back", "Left", "Right"];
const MOUSE_RAD_PER_PX = 0.0016;
const SEED = 7;
const MINIONS = 12;
if (location.hash.includes("fixed")) send({ t: "manual" });
const MORTAR = WEAPONS.mortar;
const SHELL_G = G * MORTAR.projectile.gravity;
/**
 * Test clock (#fixed in the address): every rendered frame is 1/30 s of game
 * time and the sim steps in lockstep with the page, so a slow headless browser
 * shows exactly what a player sees at full speed.
 */
const FIXED = location.hash.includes("fixed");
/** The mode being played (null while the start menu is up). #practice or #versus in the address skips the menu (tests use #fixed: the Practice range). */
let mode: Mode | null = null;
const hashMode: Mode | null = location.hash.includes("versus") ? "versus" : location.hash.includes("practice") || FIXED ? "practice" : null;
/** The match as the worker last reported it (Versus AI only). */
let matchInfo: MatchInfo | null = null;
let endShownFor = -1;
let endTimer: ReturnType<typeof setTimeout> | undefined;
/** Can each bridge still be crossed (layout order), and is the walk overlay on. */
let bridgesOpen: boolean[] = layout.bridges.map(() => true);
let navOn = false;
let vclock = 0;
let frames = 0;
/** Test clock only: hold game time still (for a screenshot). */
let frozen = false;
const clock = () => (FIXED ? vclock : performance.now());

// ---- state ------------------------------------------------------------------
let current = 0;
const aims: AimState[] = EMP.map((e) => restAim(e, WEAPONS[e.weapon]));
/** Where the player wants the weapon to point; the weapon turns towards it at its own rate. */
const wanted: AimState[] = aims.map((a) => ({ ...a }));
const fov: number[] = EMP.map((e) => WEAPONS[e.weapon].fov[1] * 0.8);
let fuseTicks = 0; // mortar: 0 means burst on impact
/** Aim help: the whole predicted flight (default in the sandbox) or only its first part, as in ranked play. */
let aimHelp: "full" | "partial" = "full";
/** Slow motion when a followed shot lands or a ridden shell bursts (off: the physics plays in real time). */
let slowMo = false;
/** Shot camera per emplacement: on for the mortar (ride the shell), off for the others. */
let shotCam: boolean[] = EMP.map((e) => e.weapon === "mortar");
try {
  if (localStorage.getItem("keepfall.aimHelp") === "partial") aimHelp = "partial";
  slowMo = localStorage.getItem("keepfall.slowmo") === "1";
  const saved = localStorage.getItem("keepfall.shotCam");
  if (saved && saved.length === EMP.length) shotCam = [...saved].map((c) => c === "1");
} catch {}
/** Seconds the current shot is predicted to fly before it lands or bursts. */
let flightSeconds = 0;
/** What the current shot is predicted to hit (full aim help). */
let aimHit: PathHit | null = null;
let spin: Spin = Spin.None;
let view: "sight" | "overview" = "sight";
let reload: number[] = EMP.map(() => 0);
let wind = { x: 0, z: 0 };
let ready = false;
let paused = false;
const trails: Array<Float32Array | null> = EMP.map(() => null);
const recording = new Map<number, { emp: number; pts: number[] }>(); // shot id -> trail
const landing: Array<{ x: number; y: number; z: number } | null> = EMP.map(() => null);
let follow: { id: number; lastX: number; lastY: number; lastZ: number; vx: number; vy: number; vz: number; until: number } | null = null;
let slowUntil = 0;
/** Sim and effects speed (slow motion around impacts). */
let timeScale = 1;
/** Camera shake after a burst: when, and how hard (0..1, by distance). Render only. */
let shake = { at: -1e9, s: 0 };
let lastFrameTick = 0;
let stats = { stepMs: 0, stepPeak: 0, down: 0, standing: 0, awake: 0 };

/** The mortar's observer camera: it eases towards where the shell will land, so small aim changes move the ring, not the world. */
const obs = { x: 0, y: 0, z: 0, primed: false };

/** Riding a mortar shell: chase it up and over, stop short of the target, watch the burst in slow motion. */
interface Ride {
  id: number;
  emp: number;
  started: number;
  /** Latest shell state from the sim, and when it arrived. */
  sx: number;
  sy: number;
  sz: number;
  vx: number;
  vy: number;
  vz: number;
  seenAt: number;
  alive: boolean;
  lostAt: number;
  /** Predicted impact and seconds to it (sim time), refreshed in flight. */
  ix: number;
  iy: number;
  iz: number;
  tImpact: number;
  /** The camera's offset from the shell while it follows (eased), and the camera itself: eye and the point it looks at. */
  ox: number;
  oy: number;
  oz: number;
  cx: number;
  cy: number;
  cz: number;
  lx: number;
  ly: number;
  lz: number;
  hold: boolean;
  boomAt: number;
  bx: number;
  by: number;
  bz: number;
}
let ride: Ride | null = null;

/** What the last burst brought down: stones that started moving (or turned to dust) and minions knocked down, shown a few seconds later. */
const everMoved = new Uint8Array(layout.stones.length);
let tally: { until: number; stones: number; down0: number } | null = null;
/** Minions down as of the frame before the one being applied (a burst's own knockdowns count for it). */
let lastDown = 0;
/** Minions down as of each frame not yet applied, by tick. */
const downAt = new Map<number, number>();
let rendererReady = false;

// ---- worker -------------------------------------------------------------------
worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  if (m.t === "ready") {
    renderer.applyTerrain([m.terrain]);
    ready = true;
    if (rendererReady) $("loading").hidden = true;
    if (navOn) send({ t: "nav", on: true });
    return;
  }
  if (m.t === "error") {
    showError(m.message);
    return;
  }
  if (m.t === "frame") {
    const was = reload[current];
    reload = m.reload;
    if (was > 0 && reload[current] === 0) sound.ready(EMP[current].weapon);
    stats = { stepMs: m.stepMs, stepPeak: m.stepPeak, down: m.down, standing: m.standing, awake: m.awake };
    downAt.set(m.frame.tick, m.down);
    timeline.push(m.frame);
    if (m.match) onMatch(m.match);
    if (m.bridges) onBridges(m.bridges);
    if (m.nav) renderer.updateNav(m.nav.kind, m.nav.floor);
  }
};
worker.onerror = (e) => showError(e.message || "The simulation worker failed to start.");

function onFrame(f: FrameData) {
  const now = clock();
  wind = { x: f.windX, z: f.windZ };
  lastFrameTick = f.tick;
  const ear = renderer.listener();
  let impacts = 0;
  for (let k = 0; k < f.eventCount; k++) {
    const o = k * EVENT_STRIDE;
    const kind = f.events[o];
    const a = f.events[o + 1], b = f.events[o + 2], c = f.events[o + 3], d = f.events[o + 4];
    if (kind === EventKind.Muzzle) {
      const emp = a, id = b;
      recording.set(id, { emp, pts: [] });
      const e = EMP[emp];
      if (e) sound.fire(e.weapon, e.x, e.y, e.z, emp === current);
      if (shotCam[emp] && emp === current && e) {
        if (e.weapon === "mortar") startRide(id, emp, now);
        else follow = { id, lastX: 0, lastY: 0, lastZ: 0, vx: 0, vy: 0, vz: 0, until: 0 };
      }
    } else if (kind === EventKind.Explosion) {
      pacer.burst(now);
      if (ride && !ride.boomAt && Math.hypot(a - ride.sx, b - ride.sy, c - ride.sz) < 12) {
        ride.boomAt = now;
        ride.bx = a;
        ride.by = b;
        ride.bz = c;
        ride.hold = true;
        if (slowMo) setSlow(0.3);
      }
      const dist = Math.hypot(a - ear.x, b - ear.y, c - ear.z);
      shake = { at: now, s: Math.max(0.08, Math.min(1, 1.25 - dist / 110)) };
      if (!tally) tally = { until: now + 4500, stones: 0, down0: lastDown };
      sound.explosion(a, b, c, d, timeScale);
    } else if (kind === EventKind.Landed) {
      landing[a] = { x: b, y: c, z: d };
    } else if (kind === EventKind.Impact) {
      if (impacts++ < 3) sound.impact(a, b, c, d);
    } else if (kind === EventKind.Blood) {
      sound.thud(a, b, c, d);
    }
  }
  // Stones moving for the first time count towards the burst's tally.
  for (let i = 0; i < f.stoneCount; i++) {
    const id = f.stones[i * 8] | 0;
    if (id >= 0 && id < everMoved.length && !everMoved[id]) {
      everMoved[id] = 1;
      if (tally) tally.stones++;
    }
  }
  if (tally && now > tally.until) showTally();
  // Where loose masonry is moving, for the rumble and clatter.
  if (f.stoneCount > 0) {
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let i = 0; i < f.stoneCount; i++) {
      const o = i * 8;
      if (f.stones[o + 2] < -100) continue; // shattered
      sx += f.stones[o + 1];
      sy += f.stones[o + 2];
      sz += f.stones[o + 3];
      n++;
    }
    if (n) {
      const r = sound.rubble, k = Math.min(1, n / 20);
      r.x += (sx / n - r.x) * k;
      r.y += (sy / n - r.y) * k;
      r.z += (sz / n - r.z) * k;
    }
  }
  // Record every live shot's first ball for its ghost trail; follow the chosen one; voices for shells and chains.
  const seen = new Set<number>();
  for (let i = 0; i < f.projectileCount; i++) {
    const o = i * PROJECTILE_STRIDE;
    const kind = f.projectiles[o];
    const id = f.projectiles[o + 1];
    if (seen.has(id)) continue;
    seen.add(id);
    const x = f.projectiles[o + 2], y = f.projectiles[o + 3], z = f.projectiles[o + 4];
    const vx = f.projectiles[o + 6], vy = f.projectiles[o + 7], vz = f.projectiles[o + 8];
    const rec = recording.get(id);
    if (rec && rec.pts.length < 3 * 600) rec.pts.push(x, y, z);
    if (follow && follow.id === id) {
      follow.lastX = x;
      follow.lastY = y;
      follow.lastZ = z;
      follow.vx = vx;
      follow.vy = vy;
      follow.vz = vz;
    }
    if (ride && ride.id === id) {
      ride.sx = x;
      ride.sy = y;
      ride.sz = z;
      ride.vx = vx;
      ride.vy = vy;
      ride.vz = vz;
      ride.seenAt = now;
      ride.alive = true;
    }
    if (kind === ProjectileKind.Shell) {
      // Seconds until it comes down: from the ride's prediction, else from its height and fall.
      const t = ride && ride.id === id && !ride.hold ? ride.tImpact : (vy + Math.sqrt(Math.max(0, vy * vy + 2 * SHELL_G * Math.max(0, y)))) / SHELL_G;
      sound.shell(id, x, y, z, vx, vy, vz, t);
    } else if (kind === ProjectileKind.Chain) {
      sound.chain(id, x, y, z);
    }
  }
  sound.endUnseen();
  for (const [id, rec] of recording) {
    if (seen.has(id)) continue;
    if (rec.pts.length >= 6) trails[rec.emp] = new Float32Array(rec.pts);
    recording.delete(id);
  }
  if (ride && ride.alive && !seen.has(ride.id)) {
    ride.alive = false;
    ride.lostAt = now;
  }
  // The shot camera (other weapons): slow down when the followed shot lands, then hand back.
  if (follow) {
    if (!seen.has(follow.id) || landedNow(f)) {
      if (!follow.until) {
        follow.until = now + 1600;
        if (slowMo) {
          slowUntil = now + 900;
          setSlow(0.25);
        }
      }
    }
  }
  lastDown = downAt.get(f.tick) ?? stats.down;
  downAt.delete(f.tick);
  renderer.applyFrame(f);
}

function showTally() {
  if (!tally) return;
  const down = Math.max(0, lastDown - tally.down0);
  const parts = [`${tally.stones} ${tally.stones === 1 ? "stone" : "stones"} down`];
  if (down) parts.push(`${down} ${down === 1 ? "man" : "men"} down`);
  tally = null;
  const el = $("tally");
  el.textContent = parts.join(", ");
  el.hidden = false;
  el.classList.remove("show");
  void el.offsetWidth; // restart the fade
  el.classList.add("show");
  clearTimeout(tallyTimer);
  tallyTimer = setTimeout(() => (el.hidden = true), 3200);
}
let tallyTimer: ReturnType<typeof setTimeout> | undefined;

function landedNow(f: FrameData): boolean {
  for (let k = 0; k < f.eventCount; k++) {
    const kind = f.events[k * EVENT_STRIDE];
    if ((kind === EventKind.Landed && f.events[k * EVENT_STRIDE + 1] === current) || kind === EventKind.Explosion) return true;
  }
  return false;
}

/** Slow motion for the sim (sandbox only), the effects and new sounds. */
function setSlow(factor: number) {
  if (Math.abs(factor - timeScale) < 0.01) return;
  timeScale = factor;
  send({ t: "speed", factor });
  renderer.setTimeScale(factor);
}

// ---- riding a mortar shell ---------------------------------------------------------
function startRide(id: number, emp: number, now: number) {
  const e = EMP[emp], a = aims[emp];
  const [fx, , fz] = aimDir(a.yaw, 0);
  follow = null;
  // Cut to a camera just behind the mortar, looking up along the barrel.
  ride = {
    id, emp, started: now,
    sx: e.x, sy: e.y, sz: e.z, vx: 0, vy: 0, vz: 0, seenAt: now, alive: false, lostAt: 0,
    ix: predicted?.x ?? e.x + fx * 120, iy: predicted?.y ?? 0, iz: predicted?.z ?? e.z + fz * 120, tImpact: flightSeconds || 4,
    ox: -fx * 7, oy: 2.5, oz: -fz * 7,
    cx: e.x - fx * 7, cy: e.y + 2.5, cz: e.z - fz * 7,
    lx: predicted?.x ?? e.x + fx * 120, ly: predicted?.y ?? 0, lz: predicted?.z ?? e.z + fz * 120,
    hold: false, boomAt: 0, bx: 0, by: 0, bz: 0,
  };
  $("ride-hint").hidden = false;
}

function endRide() {
  if (!ride) return;
  ride = null;
  setSlow(1);
  $("ride-hint").hidden = true;
}

/** Where the ridden shell will come down, from its current state (runs every frame, cheap). */
function refreshImpact(r: Ride) {
  if (!r.alive) return;
  const coef = flightCoef(MORTAR.projectile);
  const path = predictPath([r.sx, r.sy, r.sz], [r.vx, r.vy, r.vz], null, wind.x, wind.z, coef, 8, 2);
  const hit = renderer.castPath(path);
  if (!hit) return;
  r.ix = hit.x;
  r.iy = hit.y;
  r.iz = hit.z;
  r.tImpact = pathTime(path, hit);
}

function ridePose(now: number, dt: number): CameraPose | null {
  const r = ride!;
  if ((r.boomAt && now > r.boomAt + 2900) || (!r.boomAt && !r.alive && r.lostAt && now > r.lostAt + 900) || now > r.started + 16000) {
    endRide();
    return null;
  }
  if (r.boomAt && slowMo) {
    // Slow motion through the first second of the burst, then ease back to real time.
    const t = (now - r.boomAt) / 1000;
    setSlow(t < 1.3 ? 0.3 : t < 1.9 ? 0.3 + ((t - 1.3) / 0.6) * 0.7 : 1);
  }
  refreshImpact(r);
  // The shell as it is drawn now (between sim frames), so the camera and the shell move together.
  let sx = r.sx, sy = r.sy, sz = r.sz, vx = r.vx, vy = r.vy, vz = r.vz;
  const drawn = timeline.find(r.id);
  if (drawn >= 0) {
    const o = drawn * PROJECTILE_STRIDE, p = timeline.proj;
    sx = p[o + 2];
    sy = p[o + 3];
    sz = p[o + 4];
    vx = p[o + 6];
    vy = p[o + 7];
    vz = p[o + 8];
  }
  let tx: number, ty: number, tz: number;
  if (!r.hold) {
    // Fly with the shell: behind it, above it and a little to the side, always looking at where it will land,
    // so the target grows in the frame as the shell climbs, turns over and dives.
    let hx = r.ix - sx, hz = r.iz - sz;
    let hl = Math.hypot(hx, hz);
    if (hl < 2) {
      hx = vx;
      hz = vz;
      hl = Math.hypot(hx, hz) || 1;
    }
    hx /= hl;
    hz /= hl;
    const rx = -hz, rz = hx; // right
    const sp = Math.hypot(vx, vy, vz) || 1;
    const dive = Math.max(0, -vy / sp); // 0 climbing, 1 straight down
    const ko = 1 - Math.exp(-dt * 2.5);
    r.ox += (-hx * 12 + rx * 3 - r.ox) * ko;
    r.oy += (4.5 + 9 * dive - r.oy) * ko;
    r.oz += (-hz * 12 + rz * 3 - r.oz) * ko;
    r.cx = sx + r.ox;
    r.cy = sy + r.oy;
    r.cz = sz + r.oz;
    // Look at where it will land, pulled a little towards the shell so both stay in frame.
    tx = r.ix + (sx - r.ix) * 0.25;
    ty = r.iy + (sy - r.iy) * 0.25;
    tz = r.iz + (sz - r.iz) * 0.25;
    // Stop short of the target and let the shell go in alone.
    if (r.alive && (r.tImpact < 0.6 || Math.hypot(sx - r.ix, sy - r.iy, sz - r.iz) < 30)) r.hold = true;
  } else {
    // Holding: drift back and up a little to frame the burst, looking at the shell, then the burst.
    const ax = r.boomAt ? r.bx : r.ix, ay = r.boomAt ? r.by : r.iy, az = r.boomAt ? r.bz : r.iz;
    const dx = r.cx - ax, dy = r.cy - ay, dz = r.cz - az;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const drift = !r.boomAt || now < r.boomAt + 1500 ? 1.6 * dt : 0;
    r.cx += (dx / dl) * drift;
    r.cy += (dy / dl) * drift + 0.5 * drift;
    r.cz += (dz / dl) * drift;
    if (r.boomAt || !r.alive) {
      tx = ax;
      ty = ay + 2;
      tz = az;
    } else {
      tx = (sx + ax) / 2;
      ty = (sy + ay) / 2;
      tz = (sz + az) / 2;
    }
  }
  if (r.cy < 1.5) r.cy = 1.5;
  const kl = 1 - Math.exp(-dt * (r.hold ? 4 : 6));
  r.lx += (tx - r.lx) * kl;
  r.ly += (ty - r.ly) * kl;
  r.lz += (tz - r.lz) * kl;
  return { mode: "free", x: r.cx, y: r.cy, z: r.cz, tx: r.lx, ty: r.ly, tz: r.lz, fov: 55 };
}

// ---- aiming at a fixed 60 Hz ------------------------------------------------------
let aimAcc = 0;
function aimTick() {
  if (ride) return; // no blind aiming while the camera rides a shell
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
  if (e.weapon === "mortar") ratePitch = -ratePitch; // forward means farther
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
  if (!input.locked || view !== "sight" || ride) {
    input.mouseX = input.mouseY = 0;
    return;
  }
  const e = EMP[current], w = WEAPONS[e.weapon];
  const fine = input.down("ShiftLeft") || input.down("ShiftRight");
  const zoomK = fov[current] / w.fov[1]; // slower when zoomed in
  const k = MOUSE_RAD_PER_PX * zoomK * (fine ? 0.35 : 1);
  const t = wanted[current];
  // Mouse right turns the aim right (towards -X when facing +Z), i.e. lower yaw.
  // The mortar ranges by elevation: pushing forward (mouse up) sends the shell farther, i.e. lowers the barrel.
  const py = e.weapon === "mortar" ? 1 : -1;
  wanted[current] = clampAim({ yaw: t.yaw - input.mouseX * k, pitch: t.pitch + py * input.mouseY * k }, e, w);
  input.mouseX = input.mouseY = 0;
}

function fire() {
  if (!ready || reload[current] > 0 || matchInfo?.result) return;
  const e = EMP[current];
  const a = aims[current];
  send({ t: "input", input: { kind: "fire", emplacement: current, yaw: a.yaw, pitch: a.pitch, charge: 1, fuse: fuseTicks, spin: e.weapon === "longGun" ? spin : Spin.None } });
  reload[current] = WEAPONS[e.weapon].reload; // until the worker confirms
}

function select(i: number) {
  endRide();
  current = ((i % EMP.length) + EMP.length) % EMP.length;
  view = "sight";
  obs.primed = false;
  updateHud(true);
}

// ---- camera and aim help ---------------------------------------------------------
function cameraPose(now: number, dt: number): CameraPose {
  if (ride) {
    const p = ridePose(now, dt);
    if (p) return p;
  }
  if (follow && (!follow.until || now < follow.until) && follow.lastY) {
    return { mode: "follow" as const, x: follow.lastX, y: follow.lastY, z: follow.lastZ, vx: follow.vx, vy: follow.vy, vz: follow.vz };
  }
  if (follow && follow.until && now >= follow.until) follow = null;
  if (view === "overview") return { mode: "overview" as const };
  const e = EMP[current], a = aims[current];
  if (e.weapon === "mortar") return observerPose(dt);
  const [dx, dy, dz] = aimDir(a.yaw, a.pitch);
  return { mode: "sight" as const, x: e.x - dx * 3.2, y: e.y + 1.1 - dy * 3.2, z: e.z - dz * 3.2, yaw: a.yaw, pitch: a.pitch - 0.05, fov: fov[current] };
}

/**
 * The mortar's observer: raised over the field, partway to the target, looking
 * down at where the shell will land (or, with partial aim help, at its range
 * in still air). Left and right on screen turn the mortar; up the screen is farther.
 */
function observerPose(dt: number): CameraPose {
  const e = EMP[current], a = aims[current];
  let t = predicted;
  if (!t || aimHelp === "partial") {
    // Still-air range at this elevation: a rough cue, not the answer.
    const v = MORTAR.speed, p = a.pitch;
    const range = Math.min(240, Math.max(30, (v * v * Math.sin(2 * p)) / SHELL_G));
    const [fx, , fz] = aimDir(a.yaw, 0);
    t = { x: e.x + fx * range, y: 0, z: e.z + fz * range };
  }
  if (!obs.primed) {
    obs.x = t.x;
    obs.y = t.y;
    obs.z = t.z;
    obs.primed = true;
  }
  const k = 1 - Math.exp(-dt * 3);
  obs.x += (t.x - obs.x) * k;
  obs.y += (t.y - obs.y) * k;
  obs.z += (t.z - obs.z) * k;
  const dx = obs.x - e.x, dz = obs.z - e.z;
  const D = Math.max(30, Math.hypot(dx, dz));
  const ux = dx / D, uz = dz / D;
  const rx = -uz, rz = ux; // right
  return {
    mode: "free",
    x: e.x + ux * D * 0.42 + rx * D * 0.1,
    y: e.y + 24 + D * 0.32,
    z: e.z + uz * D * 0.42 + rz * D * 0.1,
    tx: obs.x,
    ty: obs.y + 1,
    tz: obs.z,
    fov: fov[current],
  };
}

/** Seconds of flight to a hit on a path sampled every 2 ticks. */
function pathTime(path: Float32Array, hit: PathHit): number {
  const i = hit.index;
  const ax = path[i * 3], ay = path[i * 3 + 1], az = path[i * 3 + 2];
  const bx = path[i * 3 + 3] ?? ax, by = path[i * 3 + 4] ?? ay, bz = path[i * 3 + 5] ?? az;
  const seg = Math.hypot(bx - ax, by - ay, bz - az);
  const frac = seg > 0 ? Math.min(1, Math.hypot(hit.x - ax, hit.y - ay, hit.z - az) / seg) : 0;
  return ((i + frac) * 2) / 60;
}

/** The path up to its hit, ending exactly at the hit point. */
function cutPath(path: Float32Array, hit: PathHit): Float32Array {
  const out = new Float32Array((hit.index + 2) * 3);
  out.set(path.subarray(0, (hit.index + 1) * 3));
  out[(hit.index + 1) * 3] = hit.x;
  out[(hit.index + 1) * 3 + 1] = hit.y;
  out[(hit.index + 1) * 3 + 2] = hit.z;
  return out;
}

let predicted: { x: number; y: number; z: number } | null = null;
function updateAimHelp() {
  const e = EMP[current], w = WEAPONS[e.weapon], a = aims[current];
  const showing = view === "sight" && !follow && !ride;
  aimHit = null;
  let marker: { x: number; y: number; z: number; nx?: number; ny?: number; nz?: number } | null = null;
  if (!showing) {
    renderer.setAimArc(null);
  } else {
    const m = muzzle(e, a.yaw, a.pitch);
    const d = aimDir(a.yaw, a.pitch);
    const sv = e.weapon === "longGun" ? spinVector(a.yaw, spin, w.spinRate) : null;
    const v: [number, number, number] = [d[0] * w.speed, d[1] * w.speed, d[2] * w.speed];
    const coef = flightCoef(w.projectile);
    // The whole flight, stopped where it first hits masonry or the ground. A mortar
    // fuse shorter than the flight bursts the shell in the air: the arc stops there.
    const burstAt = e.weapon === "mortar" && fuseTicks > 0 ? fuseTicks / 60 : Infinity;
    let path = predictPath(m, v, sv, wind.x, wind.z, coef, Math.min(12, burstAt), 2);
    const hit = renderer.castPath(path);
    if (hit) path = cutPath(path, hit);
    flightSeconds = hit ? pathTime(path, hit) : burstAt < 12 ? burstAt : 0;
    const n = path.length;
    if (aimHelp === "full") {
      renderer.setAimArc(path);
      aimHit = hit;
      predicted = hit ? { x: hit.x, y: hit.y, z: hit.z } : burstAt < 12 && n >= 3 ? { x: path[n - 3], y: path[n - 2], z: path[n - 1] } : null;
      marker = hit ? { x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz } : predicted;
    } else {
      // Ranked style: only the first part of the flight (still stopped by walls).
      const part = predictPath(m, v, sv, wind.x, wind.z, coef, w.arcSeconds, 2);
      const ph = renderer.castPath(part);
      renderer.setAimArc(ph ? cutPath(part, ph) : part);
      predicted = null;
    }
  }
  renderer.setGhostTrail(showing ? trails[current] : null);
  // Full aim help marks where this shot will land or burst, with the reach of a burst; partial marks where the last one landed.
  if (marker) renderer.setLandingMarker(marker, e.weapon === "mortar" && w.burst ? w.burst.radius : 0);
  else renderer.setLandingMarker(showing ? landing[current] : null);
  for (let i = 0; i < EMP.length; i++) renderer.setWeaponPose(i, aims[i].yaw, aims[i].pitch, i === current);
}

/** The keep's top storey is its roof. */
const KEEP_TOP_COURSE = KEEP_STOREYS[KEEP_STOREYS.length - 1] - 1;
const PART_NAMES: Record<Stone["part"], string> = {
  wall: "wall",
  tower: "tower",
  keep: "keep",
  merlon: "battlements",
  house: "house",
  roof: "roof",
  gate: "gate",
  floor: "keep roof",
  storey: "keep floor",
  banner: "banner",
  bridge: "bridge",
};

/** "the target keep, 151 m" for the HUD. */
function describeHit(h: PathHit | null): string {
  if (!h) return "";
  const e = EMP[current];
  const dist = Math.hypot(h.x - e.x, h.z - e.z);
  let what = "the ground";
  for (const c of [0, 1] as const) {
    if (h.stone < 0 && Math.abs(h.x) < 14 && Math.abs(h.z - layout.castleZ[c]) < 14) what = c === 0 ? "the target courtyard" : "your own courtyard";
  }
  const bridge = h.stone >= 0 ? layout.bridges.find((b) => h.stone >= b.first && h.stone < b.first + b.count) : undefined;
  if (bridge) {
    what = `the ${bridge.site.name} bridge`;
  } else if (h.stone >= 0) {
    const s = layout.stones[h.stone];
    const part = s && s.part === "storey" && s.course === KEEP_TOP_COURSE ? "keep roof" : s ? PART_NAMES[s.part] : "";
    what = s ? `${s.castle === 0 ? "the target" : "your own"} ${part}` : "rubble";
  }
  return `${what}, ${Math.round(dist)} m`;
}

// ---- HUD -------------------------------------------------------------------------
const hud = {
  name: $("w-name"),
  slot: $("w-slot"),
  reload: $("w-reload"),
  reloadFill: $("w-reload-fill"),
  target: $("w-target"),
  extra: $("w-extra"),
  windArrow: $("wind-arrow"),
  windSpeed: $("wind-speed"),
  minions: $("minions"),
  perf: $("perf"),
  reticle: $("reticle"),
  want: $("want"),
  lock: $("lock-hint"),
  shotCam: $<HTMLInputElement>("shotcam"),
  sound: $<HTMLButtonElement>("sound-btn"),
};
const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-weapon]")];
tabs.forEach((b) =>
  b.addEventListener("click", () => {
    select(Number(b.dataset.weapon));
    b.blur(); // keep keys like Space for the game, not the button
  }),
);

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
  const hitText = aimHelp === "full" && aimHit ? describeHit(aimHit) : "";
  if (e.weapon === "mortar") {
    const flight = aimHelp === "full" && flightSeconds ? `, ${flightSeconds.toFixed(1)} s` : "";
    hud.target.textContent = hitText ? `Lands on ${hitText}${flight}` : "";
    const air = fuseTicks > 0 && flightSeconds && fuseTicks / 60 <= flightSeconds + 0.02 && !aimHit ? " (bursts in the air)" : fuseTicks > 0 ? " (bounces, then bursts)" : "";
    hud.extra.textContent = (fuseTicks === 0 ? "Fuse: on impact" : `Fuse: ${(fuseTicks / 60).toFixed(1)} s${air}`) + "  ( [ ] )";
  } else {
    hud.target.textContent = hitText ? `Hits ${hitText}` : "";
    if (e.weapon === "longGun") hud.extra.textContent = `Spin: ${SPIN_NAMES[spin]}  (R)`;
    else if (e.weapon === "chainShot") hud.extra.textContent = "Two balls on a spinning chain";
    else hud.extra.textContent = `${w.pellets} balls of grapeshot`;
  }
  hud.shotCam.checked = shotCam[current];
  hud.sound.textContent = sound.muted ? "Sound off (M)" : "Sound on (M)";
  hud.sound.setAttribute("aria-pressed", String(!sound.muted));
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
  hud.perf.textContent = `step ${stats.stepMs.toFixed(1)} ms (peak ${stats.stepPeak.toFixed(1)}), ${stats.awake} moving, tick ${lastFrameTick}, frame ${pacer.frameMs.toFixed(1)} ms, resolution ${Math.round(SCALES[pacer.scaleIdx] * 100)}%`;
  hud.lock.hidden = input.locked || view !== "sight" || input.usedPad || !!ride;
  hud.reticle.hidden = view !== "sight" || !!ride || !!follow || e.weapon === "mortar";
}

/** Where the wanted aim is on screen, relative to the barrel, for the lead marker. */
function placeWanted() {
  const a = aims[current], t = wanted[current];
  if (view !== "sight" || follow || ride || EMP[current].weapon === "mortar" || (Math.abs(a.yaw - t.yaw) < 0.002 && Math.abs(a.pitch - t.pitch) < 0.002)) {
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
  // Your own pick is kept: the frame guard never lowers it (dynamic resolution still helps in heavy moments).
  pacer.tierChosen = true;
  pacer.reset(performance.now());
  renderer.setRenderScale(SCALES[0]);
  try {
    localStorage.setItem("keepfall.quality", quality.value);
    localStorage.setItem("keepfall.qualityChosen", "1");
  } catch {}
});
const aimHelpSel = $<HTMLSelectElement>("aimhelp");
aimHelpSel.value = aimHelp;
aimHelpSel.addEventListener("change", () => {
  aimHelp = aimHelpSel.value === "partial" ? "partial" : "full";
  try {
    localStorage.setItem("keepfall.aimHelp", aimHelp);
  } catch {}
});
const slowBox = $<HTMLInputElement>("slowmo");
slowBox.checked = slowMo;
slowBox.addEventListener("change", () => {
  slowMo = slowBox.checked;
  if (!slowMo) setSlow(1);
  try {
    localStorage.setItem("keepfall.slowmo", slowMo ? "1" : "0");
  } catch {}
});
const gore = $<HTMLInputElement>("gore");
gore.addEventListener("change", () => renderer.setGore(gore.checked));
const volume = $<HTMLInputElement>("volume");
volume.value = String(Math.round(sound.volume * 100));
volume.addEventListener("input", () => sound.setVolume(Number(volume.value) / 100));
hud.sound.addEventListener("click", () => {
  sound.unlock();
  sound.setMuted(!sound.muted);
  hud.sound.blur();
  updateHud(true);
});
/** Start (or restart) a mode: the worker builds a fresh world for it. */
function startMode(m: Mode) {
  const first = mode === null;
  mode = m;
  $("menu").hidden = true;
  $("end").hidden = true;
  $("mode-name").textContent = m === "versus" ? "Versus AI" : "Practice range";
  $("matchbar").hidden = m !== "versus";
  $("more").hidden = m !== "practice";
  $("reset").textContent = m === "versus" ? "Restart the match" : "Rebuild the castles";
  $("menu-back").hidden = false;
  matchInfo = null;
  endShownFor = -1;
  clearTimeout(endTimer);
  bridgesOpen = layout.bridges.map(() => true);
  updateBridges();
  view = "sight";
  ready = false;
  if (rendererReady) $("loading").hidden = false;
  if (first) send({ t: "init", mode: m, seed: SEED, minions: MINIONS });
  else {
    resetLocal();
    send({ t: "reset", mode: m, seed: SEED, minions: MINIONS });
  }
  if (m === "versus") showNote("The enemy castle does not fight back yet. Bring its keep's banner to the ground.", 6000);
}

/** Forget everything drawn from the old world. */
function resetLocal() {
  endRide();
  renderer.resetWorld();
  timeline.reset();
  downAt.clear();
  everMoved.fill(0);
  tally = null;
  trails.fill(null);
  landing.fill(null);
  recording.clear();
  follow = null;
}

$("reset").addEventListener("click", () => {
  if (mode) startMode(mode);
});

// ---- the start menu, the match and the end screen ----------------------------------
document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    b.blur();
    startMode(b.dataset.mode === "versus" ? "versus" : "practice");
  }),
);
$("menu-btn").addEventListener("click", () => {
  $("menu").hidden = false;
  $<HTMLButtonElement>("menu-btn").blur();
  document.exitPointerLock?.();
});
$("menu-back").addEventListener("click", () => ($("menu").hidden = true));
$("end-again").addEventListener("click", () => startMode("versus"));
$("end-practice").addEventListener("click", () => startMode("practice"));
$("end-look").addEventListener("click", () => {
  $("end").hidden = true;
  view = "overview";
});

function clockText(ticks: number): string {
  const s = Math.floor(ticks / 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function onMatch(info: MatchInfo) {
  const prev = matchInfo;
  matchInfo = { ...info, masonry: info.masonry ?? prev?.masonry ?? null };
  $("clock").textContent = clockText(info.result ? info.result.tick : info.tick);
  $("gold").textContent = `${info.gold[1]} gold`;
  const r = info.result;
  $("match-note").textContent = r ? (r.winner === 1 ? "The enemy keep has fallen" : r.winner === 0 ? "Your keep has fallen" : "Both keeps fell") : "Topple the enemy keep";
  // The end screen a moment after the banner falls, so the collapse can be seen.
  if (r && endShownFor !== r.tick) {
    endShownFor = r.tick;
    clearTimeout(endTimer);
    endTimer = setTimeout(showEnd, FIXED ? 0 : 2600);
  }
}

function showEnd() {
  const info = matchInfo;
  if (!info || !info.result || mode !== "versus") return;
  const r = info.result;
  $("end-title").textContent = r.winner === 1 ? "Victory" : r.winner === 0 ? "Defeat" : "Draw";
  $("end-line").textContent = r.winner === 1 ? "The enemy keep's banner is on the ground." : r.winner === 0 ? "Your keep's banner is on the ground." : "Both banners came down together.";
  $("end-time").textContent = clockText(r.tick);
  const mas = info.masonry;
  $("end-enemy").textContent = mas ? `${mas[0]} pieces` : "";
  $("end-yours").textContent = mas ? `${mas[1]} pieces` : "";
  $("end-shots").textContent = `${info.shots[1]}`;
  $("end").hidden = false;
  document.exitPointerLock?.();
}

/** The bridges from the player's left to right, as the overlay's status line shows them. */
function updateBridges() {
  const parts = layout.bridges
    .map((b, k) => ({ name: b.site.name, open: bridgesOpen[k] ?? true, x: b.site.x }))
    .sort((a, b) => b.x - a.x)
    .map((b) => `${b.name} <b class="${b.open ? "" : "down"}">${b.open ? "open" : "down"}</b>`);
  $("bridges").innerHTML = `Bridges: ${parts.join(", ")}`;
}

function onBridges(open: boolean[]) {
  const was = bridgesOpen;
  bridgesOpen = open;
  updateBridges();
  for (let k = 0; k < open.length; k++) {
    if (was[k] && !open[k]) showNote(`The ${layout.bridges[k].site.name} bridge is down: that route is closed.`, 4500);
  }
}

function toggleNav(on = !navOn) {
  navOn = on;
  send({ t: "nav", on });
  renderer.setNavOverlay(on);
  $("bridges").hidden = !on;
  navBox.checked = on;
}
const navBox = $<HTMLInputElement>("navbox");
navBox.addEventListener("change", () => toggleNav(navBox.checked));

let noteTimer: ReturnType<typeof setTimeout> | undefined;
function showNote(text: string, ms: number) {
  const note = $("note");
  note.textContent = text;
  note.hidden = false;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => (note.hidden = true), ms);
}
$("more").addEventListener("click", () => send({ t: "input", input: { kind: "minions", count: 6 } }));
const help = $("help");
$("help-btn").addEventListener("click", () => (help.hidden = !help.hidden));
$("help-close").addEventListener("click", () => (help.hidden = true));
hud.shotCam.addEventListener("change", () => toggleShotCam(hud.shotCam.checked));
$("overview-btn").addEventListener("click", () => toggleOverview());

function toggleShotCam(on = !shotCam[current]) {
  shotCam[current] = on;
  if (!on) endRide();
  try {
    localStorage.setItem("keepfall.shotCam", shotCam.map((b) => (b ? "1" : "0")).join(""));
  } catch {}
  updateHud(true);
}

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

// ---- frame pacing: dynamic resolution first, the quality tier last (see pacing.ts) ----------
const TIER_ORDER: QualityTier[] = ["low", "medium", "high", "ultra"];
const pacer = new Pacer();

function pace(dt: number, now: number) {
  if (!ready || paused || calib || FIXED) return;
  const r = pacer.frame(dt * 1000, renderer.gpuTime(), now);
  if (r.dropTier) {
    const i = TIER_ORDER.indexOf(quality.value as QualityTier);
    if (i > 0) {
      quality.value = TIER_ORDER[i - 1];
      renderer.setQuality(quality.value as QualityTier);
      renderer.resize();
      const note = $("note");
      note.textContent = `Frames stayed slow, so quality dropped to ${quality.value}. Change it under Controls.`;
      note.hidden = false;
      setTimeout(() => (note.hidden = true), 6000);
    }
  }
  if (r.scaleChanged) renderer.setRenderScale(SCALES[pacer.scaleIdx]);
}

function toggleOverview() {
  endRide();
  view = view === "sight" ? "overview" : "sight";
  if (view === "overview") document.exitPointerLock?.();
}

function showError(msg: string) {
  const el = $("error");
  el.hidden = false;
  el.textContent = msg;
}

/** Shake and a quick widening of the view after a burst, stronger when it is close. */
function applyShake(pose: CameraPose, now: number) {
  const age = (now - shake.at) / 1000;
  if (age > 1.1 || (pose.mode !== "sight" && pose.mode !== "free")) return;
  const fall = Math.exp(-age / 0.22);
  const amp = 0.03 * shake.s * fall;
  const jx = amp * (Math.sin(now * 0.083) + 0.5 * Math.sin(now * 0.191));
  const jy = amp * (Math.sin(now * 0.109 + 1.7) + 0.5 * Math.sin(now * 0.157 + 0.4));
  const kick = 7 * shake.s * Math.exp(-age / 0.12) * Math.min(1, age / 0.03);
  if (pose.mode === "sight") {
    pose.yaw += jx;
    pose.pitch += jy;
    pose.fov += kick;
  } else {
    const dx = pose.tx - pose.x, dy = pose.ty - pose.y, dz = pose.tz - pose.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    // Turn the look point sideways and up by the shake angle.
    const rx = -dz / d, rz = dx / d;
    pose.tx += rx * jx * d;
    pose.tz += rz * jx * d;
    pose.ty += jy * d;
    pose.fov += kick;
  }
}

// ---- main loop ----------------------------------------------------------------------
let last = performance.now();
function frame(wall: number) {
  let dt = Math.min(0.1, (wall - last) / 1000);
  last = wall;
  if (FIXED) {
    dt = frozen ? 0 : 1 / 30;
    if (!frozen) {
      vclock += 1000 / 30;
      send({ t: "advance", seconds: dt });
      frames++;
    }
  } else frames++;
  const now = clock();
  const p = input.read();
  if (p.weapon >= 0) select(p.weapon);
  if (p.next) select(current + 1);
  if (p.prev) select(current - 1);
  if (p.overview) toggleOverview();
  if (p.help) help.hidden = !help.hidden;
  if (p.shotCam) toggleShotCam();
  if (p.mute) {
    sound.setMuted(!sound.muted);
    updateHud(true);
  }
  if (p.nav) toggleNav();
  if (p.spin && EMP[current].weapon === "longGun") spin = ((spin + 1) % 5) as Spin;
  const w = WEAPONS[EMP[current].weapon];
  const fuseStep = (dir: number) => {
    if (EMP[current].weapon !== "mortar") return;
    // Leaving impact starts the fuse at the predicted flight time, so one press gives a burst just as it lands.
    if (fuseTicks === 0 && dir > 0) fuseTicks = flightSeconds ? Math.max(w.fuseMin, Math.min(w.fuseMax, Math.round((flightSeconds * 60) / 15) * 15)) : w.fuseMin;
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
    if (!ride) fov[current] = Math.max(w.fov[0], Math.min(w.fov[1], fov[current] * (input.wheel > 0 ? 1.12 : 1 / 1.12)));
    input.wheel = 0;
  }
  const shownFov = zoomIn ? w.fov[0] : fov[current];
  if (ride) {
    // Any fire or skip key takes you back to the gun; it never fires.
    if (p.fire || p.skip) endRide();
  } else if (p.fire && view === "sight") fire();

  applyMouse();
  aimAcc += dt;
  while (aimAcc >= 1 / 60) {
    aimTick();
    aimAcc -= 1 / 60;
  }
  if (slowUntil && now > slowUntil) {
    slowUntil = 0;
    if (!ride) setSlow(1);
  }
  // Sim frames due on the render clock, then shells and stones between frames.
  for (const f of timeline.advance(dt, timeScale)) onFrame(f);
  timeline.interpolate();
  renderer.setProjectiles(timeline.proj, timeline.projCount, timeline.chains, timeline.chainCount);
  if (timeline.stoneCount) renderer.setStones(timeline.stones, timeline.stoneCount);
  if (follow) {
    const i = timeline.find(follow.id);
    if (i >= 0) {
      const o = i * PROJECTILE_STRIDE, p = timeline.proj;
      follow.lastX = p[o + 2];
      follow.lastY = p[o + 3];
      follow.lastZ = p[o + 4];
      follow.vx = p[o + 6];
      follow.vy = p[o + 7];
      follow.vz = p[o + 8];
    }
  }
  const pose = cameraPose(now, dt);
  if (pose.mode === "sight" || (pose.mode === "free" && !ride)) pose.fov = shownFov;
  applyShake(pose, now);
  renderer.setCamera(pose);
  updateAimHelp();
  updateHud();
  placeWanted();
  if (!paused) renderer.render(dt);
  sound.update(renderer.listener(), dt, { wind: Math.hypot(wind.x, wind.z), awake: stats.awake, slow: timeScale });
  calibrate(dt);
  pace(dt, now);
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  paused = document.hidden;
  send({ t: "pause", paused });
  sound.setPaused(paused);
});
// Browsers start sound only after a click or a key press on the page.
const unlock = () => sound.unlock();
window.addEventListener("pointerdown", unlock, { capture: true });
window.addEventListener("keydown", unlock, { capture: true });

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
    pacer.tierChosen = !!saved && localStorage.getItem("keepfall.qualityChosen") === "1";
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
  rendererReady = true;
  if (ready) $("loading").hidden = true;
  else if (mode) $("loading").hidden = false;
  updateHud(true);
  requestAnimationFrame(frame);
}
void start();
if (hashMode) startMode(hashMode);
else view = "overview";

// Test hook for the headless screenshot script: read-only views of the page state.
(window as unknown as { __sandbox: unknown }).__sandbox = {
  get ride() {
    return ride ? { hold: ride.hold, boom: !!ride.boomAt, tImpact: ride.tImpact, alive: ride.alive } : null;
  },
  get aimHit() {
    return aimHit;
  },
  get flightSeconds() {
    return flightSeconds;
  },
  get timeScale() {
    return timeScale;
  },
  get stats() {
    return { ...stats };
  },
  get reload() {
    return reload.slice();
  },
  get mode() {
    return mode;
  },
  get match() {
    return matchInfo;
  },
  get bridges() {
    return bridgesOpen.slice();
  },
  startMode,
  toggleNav,
  /** Rendered frames so far (with #fixed, 30 per game second). */
  get frames() {
    return frames;
  },
  /** With #fixed: stop or restart game time. */
  freeze(on: boolean) {
    frozen = on;
  },
  aimAt(emp: number, yaw: number, pitch: number) {
    aims[emp] = clampAim({ yaw, pitch }, EMP[emp], WEAPONS[EMP[emp].weapon]);
    wanted[emp] = { ...aims[emp] };
  },
  select,
  fire,
  setFov(emp: number, f: number) {
    fov[emp] = f;
  },
};
