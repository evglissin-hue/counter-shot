// The game page: a start menu, the Practice range (ride the four Ashwright
// weapons against the target castle) and a match against the AI castle.
// Aiming runs here at a fixed 60 Hz through the same limiter the sim checks;
// a fire sends the exact aim to the worker, which owns everything else.

import {
  ASHWRIGHT_EMPLACEMENTS,
  BUILDING_KINDS,
  BUILDINGS,
  buildLayout,
  emplacementWeapon,
  GAME_LAYOUT,
  KEEP_STOREYS,
  MATCH_EMPLACEMENTS,
  MATCH_LAYOUT,
  MATCH_SLOTS,
  MIX_NAMES,
  MIXES,
  mountTakes,
  PLOTS,
  ROUTE_NAMES,
  UNIT_KINDS,
  UNIT_NEEDS,
  UNITS,
  UPGRADE_COST,
  UPGRADE_KINDS,
  UPGRADES,
  WEAPON_COST,
  WEAPON_KINDS,
  WEAPONS,
  type BuildingKind,
  type CastleLayout,
  type Emplacement,
  type MixName,
  type RouteName,
  type Stone,
  type UpgradeKind,
  type WeaponKind,
} from "@keepfall/content";
import {
  aimDir,
  clampAim,
  EVENT_STRIDE,
  EventKind,
  flightCoef,
  G,
  muzzle,
  Order,
  predictPath,
  PROJECTILE_STRIDE,
  MINION_STRIDE,
  ProjectileKind,
  restAim,
  Spin,
  spinVector,
  stepAim,
  type AimState,
  type FrameData,
} from "@keepfall/sim";
import { Input } from "./input";
import type { FromWorker, MatchInfo, Mode, PlotView, SlotView, ToWorker } from "./protocol";
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
/** The Practice range's world, and a match's (plots in both courtyards instead of the houses), built when first needed. */
const practiceLayout = buildLayout(1, GAME_LAYOUT);
let matchLayout: CastleLayout | null = null;
let layout: CastleLayout = practiceLayout;
/** Sim frames are applied on a render clock a little behind the sim, and shells and stones are drawn between them. */
let timeline = new Timeline(layout);
/** Gun slots you can ride: the Practice range's four guns, or your castle's eight slots in a match. */
const MAX_SLOTS = 8;
/** Every gun in a match (your slots 0 to 7, then the enemy's); the Practice range has the first four. Guns are bought and upgraded during a match, so these are copies. */
let ALL_EMP: Emplacement[] = MATCH_EMPLACEMENTS.map((e) => ({ ...e }));
/** The guns you ride. */
let EMP: Emplacement[] = ALL_EMP.slice(0, ASHWRIGHT_EMPLACEMENTS.length);
/** A gun's weapon with its upgrades. */
const wep = (i: number) => emplacementWeapon(EMP[i]);
/** In a match: every slot as the worker last reported it. */
let slotViews: SlotView[] = [];
let plotViews: PlotView[] = [];

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
const aims: AimState[] = ALL_EMP.slice(0, MAX_SLOTS).map((e) => restAim(e, WEAPONS[e.weapon]));
/** Where the player wants the weapon to point; the weapon turns towards it at its own rate. */
const wanted: AimState[] = aims.map((a) => ({ ...a }));
const fov: number[] = ALL_EMP.slice(0, MAX_SLOTS).map((e) => WEAPONS[e.weapon].fov[1] * 0.8);
let fuseTicks = 0; // mortar: 0 means burst on impact
/**
 * Aim help: the first part of the flight, your last shot's trail and where it
 * landed (the standard: you learn by correcting), or the whole predicted
 * flight with the landing ring (easy).
 */
let aimHelp: "full" | "partial" = "partial";
/** Slow motion when a followed shot lands or a ridden shell bursts (off: the physics plays in real time). */
let slowMo = false;
/** Shot camera per emplacement: on for the mortar (ride the shell), off for the others. */
let shotCam: boolean[] = ALL_EMP.slice(0, MAX_SLOTS).map((e) => e.weapon === "mortar");
try {
  if (localStorage.getItem("keepfall.aimHelp2") === "full") aimHelp = "full";
  slowMo = localStorage.getItem("keepfall.slowmo") === "1";
  const saved = localStorage.getItem("keepfall.shotCam");
  // Saved for the four guns every castle starts with.
  if (saved && saved.length >= 4) for (let i = 0; i < 4; i++) shotCam[i] = saved[i] === "1";
} catch {}
/** Seconds the current shot is predicted to fly before it lands or bursts. */
let flightSeconds = 0;
/** What the current shot is predicted to hit (full aim help). */
let aimHit: PathHit | null = null;
let spin: Spin = Spin.None;
let view: "sight" | "overview" = "sight";
let reload: number[] = ALL_EMP.map(() => 0);
let wind = { x: 0, z: 0 };
let ready = false;
let paused = false;
const trails: Array<Float32Array | null> = Array.from({ length: MAX_SLOTS }, () => null);
const recording = new Map<number, { emp: number; pts: number[] }>(); // shot id -> trail
const landing: Array<{ x: number; y: number; z: number } | null> = Array.from({ length: MAX_SLOTS }, () => null);
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
let everMoved = new Uint8Array(layout.stones.length);
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
    if (was > 0 && reload[current] === 0 && EMP[current]) sound.ready(EMP[current].weapon);
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
      // c is 1 for a shot from a gun nobody mans: heard where it is, never your trail or your shot camera.
      const emp = a, id = b, auto = c === 1;
      const e = ALL_EMP[emp];
      if (e) sound.fire(e.weapon, e.x, e.y, e.z, emp === current && !auto);
      if (!auto && emp < EMP.length && e) {
        recording.set(id, { emp, pts: [] });
        if (shotCam[emp] && emp === current) {
          if (e.weapon === "mortar") startRide(id, emp, now);
          else follow = { id, lastX: 0, lastY: 0, lastZ: 0, vx: 0, vy: 0, vz: 0, until: 0 };
        }
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
      if (a >= 0 && a < EMP.length) landing[a] = { x: b, y: c, z: d }; // (an unmanned shot's is -(id + 1))
    } else if (kind === EventKind.Impact) {
      if (impacts++ < 3) sound.impact(a, b, c, d);
    } else if (kind === EventKind.Blood) {
      sound.thud(a, b, c, d);
    } else if (kind === EventKind.Musket) {
      // Heard where the shooter stands.
      for (let i = 0; i < f.minionCount; i++) {
        const o = i * MINION_STRIDE;
        if ((f.minions[o] | 0) !== (a | 0)) continue;
        sound.musket(f.minions[o + 1], f.minions[o + 2] + 1.4, f.minions[o + 3]);
        break;
      }
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
  watchSappers(f, now);
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
/** Key aiming has weight: each axis's speed, as a share of the gun's top turning speed (signed). */
const keyVel = { yaw: 0, pitch: 0 };

/** Ease a key-driven speed towards its target: `up` a tick while gathering speed, `down` a tick while slowing or turning back. */
function easeSpeed(v: number, target: number, up: number, down: number): number {
  if (v === target) return v;
  const gathering = target !== 0 && (v === 0 || Math.sign(v) === Math.sign(target)) && Math.abs(target) > Math.abs(v);
  const step = gathering ? up : down;
  return target > v ? Math.min(target, v + step) : Math.max(target, v - step);
}

function aimTick() {
  if (ride) {
    // No blind aiming while the camera rides a shell.
    keyVel.yaw = keyVel.pitch = 0;
    return;
  }
  const e = EMP[current];
  const w = wep(current);
  const fine = input.down("ShiftLeft") || input.down("ShiftRight");
  const pad = input.gamepad();
  const one = (v: number) => Math.max(-1, Math.min(1, v));
  // Keys: the gun gathers speed while a key is held and coasts to a stop (heavier guns are slower to start and stop).
  // Positive yaw turns left on screen (towards +X while facing +Z), so "right" is negative.
  const keyYaw = one(input.axis("KeyD", "KeyA") + input.axis("ArrowRight", "ArrowLeft"));
  let keyPitch = one(input.axis("KeyS", "KeyW") + input.axis("ArrowDown", "ArrowUp"));
  if (e.weapon === "mortar") keyPitch = -keyPitch; // forward means farther
  const K = w.keys;
  const top = K.rate * (fine ? w.fine : 1);
  const up = K.rate / (K.spinUp * 60), down = K.rate / (K.coast * 60);
  keyVel.yaw = easeSpeed(keyVel.yaw, keyYaw * top, up, down);
  keyVel.pitch = easeSpeed(keyVel.pitch, keyPitch * top, up, down);
  // A stick turns it directly: how far it is pushed sets the speed.
  let stickYaw = 0, stickPitch = 0;
  let padFine = false;
  if (pad) {
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    const lx = dz(pad.axes[0] ?? 0), ly = dz(pad.axes[1] ?? 0), rx = dz(pad.axes[2] ?? 0), ry = dz(pad.axes[3] ?? 0);
    if (lx || ly) {
      stickYaw = -lx;
      stickPitch = -ly;
    } else if (rx || ry) {
      stickYaw = -rx;
      stickPitch = -ry;
      padFine = true;
    }
    if (e.weapon === "mortar") stickPitch = -stickPitch;
  }
  const ks = fine || padFine ? w.fine : 1;
  const dYaw = ((keyVel.yaw + one(stickYaw) * ks) * w.yawRate) / 60;
  const dPitch = ((keyVel.pitch + one(stickPitch) * ks) * w.pitchRate) / 60;
  if (dYaw || dPitch) {
    // Keys and sticks drive the weapon directly; the wanted aim follows.
    wanted[current] = clampAim({ yaw: aims[current].yaw + dYaw, pitch: aims[current].pitch + dPitch }, e, w);
  }
  const a = aims[current], t = wanted[current];
  aims[current] = stepAim(a, { dYaw: t.yaw - a.yaw, dPitch: t.pitch - a.pitch, fine: fine || padFine }, e, w);
}

function applyMouse() {
  if (!input.locked || view !== "sight" || ride) {
    input.mouseX = input.mouseY = 0;
    return;
  }
  const e = EMP[current], w = wep(current);
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
  if (!ready || reload[current] > 0 || matchInfo?.result || !usable(current)) return;
  const e = EMP[current];
  const a = aims[current];
  send({ t: "input", input: { kind: "fire", emplacement: current, yaw: a.yaw, pitch: a.pitch, charge: 1, fuse: fuseTicks, spin: e.weapon === "longGun" ? spin : Spin.None } });
  reload[current] = wep(current).reload; // until the worker confirms
}

/** Can you ride this slot: always in the Practice range; in a match, a gun bought for it and still standing. */
function usable(i: number): boolean {
  if (mode !== "versus") return i >= 0 && i < EMP.length;
  const s = slotViews[i];
  return !s || (s.armed && !s.down);
}

/**
 * Ride gun i. In a match an empty slot opens the build menu on it instead,
 * and a gun that fell with its wall cannot be taken.
 */
function select(i: number) {
  i = ((i % EMP.length) + EMP.length) % EMP.length;
  if (!usable(i)) {
    const s = slotViews[i];
    if (s && s.down) showNote(`The ${slotName(i)} gun fell with the masonry under it.`, 3000);
    else openBuild({ slot: i });
    return;
  }
  endRide();
  closeBuild();
  const prev = current;
  const wasSight = view === "sight";
  current = i;
  view = "sight";
  obs.primed = false;
  keyVel.yaw = keyVel.pitch = 0;
  if (mode === "versus" && (current !== prev || !wasSight)) man(current, wasSight ? prev : -1);
  updateHud(true);
}

/** The next gun you can ride, from i in direction dir (1 or -1), or -1 if there is none. */
function nextUsable(i: number, dir: number): number {
  for (let k = 1; k <= EMP.length; k++) {
    const j = (((i + dir * k) % EMP.length) + EMP.length) % EMP.length;
    if (usable(j)) return j;
  }
  return -1;
}

/**
 * In a match: ride gun `e` (-1: none, in the overview), leaving gun `left`
 * where you put it. Every gun you do not ride fires at enemy minions near
 * your walls on its own, so you take a gun as it points: it swings back to
 * where you last wanted it at its own rate.
 */
function man(e: number, left: number) {
  const g = matchInfo?.guns;
  if (e >= 0 && g && g.length >= (e + 1) * 2) aims[e] = clampAim({ yaw: g[e * 2], pitch: g[e * 2 + 1] }, EMP[e], wep(e));
  send({ t: "input", input: { kind: "man", emplacement: e, left: left >= 0 ? { emplacement: left, yaw: aims[left].yaw, pitch: aims[left].pitch } : undefined } });
}

/** Orders for all your waves (Ctrl+1, 2, 3) and the route of your next ones (L). */
function giveOrder(order: number) {
  if (mode !== "versus" || !matchInfo || matchInfo.result) return;
  send({ t: "input", input: { kind: "order", order: order as Order } });
  const text = [
    "Your waves advance on the enemy gate.",
    "Your waves hold at the midfield markers, short of the bridges.",
    "Your waves push for the nearest gap in the enemy walls (they make for the gate while there is none).",
  ][order];
  showNote(text, 3200);
  matchInfo.order = order;
  updateWaves();
}
function setRoute(route: RouteName) {
  if (mode !== "versus" || !matchInfo || matchInfo.result) return;
  send({ t: "input", input: { kind: "route", route } });
  showNote(`All your barracks send their next waves down the ${routeName(route)}.`, 2600);
  matchInfo.route = route;
  updateWaves();
}

function routeName(r: RouteName): string {
  return r === "centre" ? "centre road" : `${r} flank`;
}

// ---- camera and aim help ---------------------------------------------------------
/** Test hook (the screenshot tools): a fixed camera, eye and target, instead of the player's view. */
let testCamera: { x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number } | null = null;

function cameraPose(now: number, dt: number): CameraPose {
  if (testCamera) return { mode: "free", ...testCamera };
  if (ride) {
    const p = ridePose(now, dt);
    if (p) return p;
  }
  if (follow && (!follow.until || now < follow.until) && follow.lastY) {
    return { mode: "follow" as const, x: follow.lastX, y: follow.lastY, z: follow.lastZ, vx: follow.vx, vy: follow.vy, vz: follow.vz };
  }
  if (follow && follow.until && now >= follow.until) follow = null;
  if (buildOpen) return castlePose();
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
    // Where it would come down in still air on level ground: a rough cue, not the answer.
    const range = Math.min(240, Math.max(30, stillAirRange(a.pitch)));
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

/** Horizontal distance a mortar shell flies at this elevation in still air, down to level ground (y = 0). */
const rangeCache = new Map<number, number>();
function stillAirRange(pitch: number): number {
  const key = Math.round(pitch * 2000);
  const hit = rangeCache.get(key);
  if (hit !== undefined) return hit;
  const e = EMP.find((m) => m.weapon === "mortar")!;
  const m = muzzle(e, 0, pitch);
  const d = aimDir(0, pitch);
  const path = predictPath(m, [d[0] * MORTAR.speed, d[1] * MORTAR.speed, d[2] * MORTAR.speed], null, 0, 0, flightCoef(MORTAR.projectile), 12, 1);
  const n = path.length;
  const range = Math.hypot(path[n - 3] - m[0], path[n - 1] - m[2]);
  if (rangeCache.size > 4000) rangeCache.clear();
  rangeCache.set(key, range);
  return range;
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
  const e = EMP[current], w = wep(current), a = aims[current];
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
  const guns = mode === "versus" ? matchInfo?.guns : undefined;
  for (let i = 0; i < ALL_EMP.length; i++) {
    const riding = i === current && view === "sight";
    if (guns && !riding && guns.length >= (i + 1) * 2) renderer.setWeaponPose(i, guns[i * 2], guns[i * 2 + 1], false);
    else if (i < EMP.length) renderer.setWeaponPose(i, aims[i].yaw, aims[i].pitch, i === current && view === "sight");
  }
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
  building: "building",
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
const WEAPON_SHORT: Record<WeaponKind, string> = { longGun: "Long gun", mortar: "Mortar", chainShot: "Chain shot", swivel: "Swivel" };
let tabs: HTMLButtonElement[] = [];
/** The gun bar: one tab per slot you can ride (eight in a match), each with its reload. */
function buildTabs() {
  const bar = $("tabs");
  bar.textContent = "";
  tabs = EMP.map((_, i) => {
    const b = document.createElement("button");
    b.dataset.weapon = String(i);
    b.innerHTML = `<span class="t"></span><span class="rl"><i></i></span>`;
    b.addEventListener("click", () => {
      select(i);
      b.blur(); // keep keys like Space for the game, not the button
    });
    bar.appendChild(b);
    return b;
  });
  updateTabs();
}

/** The slot's place on your castle (match slots), for notes and the build menu. */
function slotName(i: number): string {
  return MATCH_SLOTS[i]?.name ?? WEAPONS[EMP[i].weapon].name;
}

function updateTabs() {
  tabs.forEach((b, i) => {
    const s = mode === "versus" ? slotViews[i] : undefined;
    const empty = !!s && !s.armed;
    const down = !!s && s.armed && s.down;
    const label = empty ? "+" : WEAPON_SHORT[EMP[i].weapon];
    const t = b.querySelector(".t")!;
    const text = `${i + 1} ${label}`;
    if (t.textContent !== text) t.textContent = text;
    b.classList.toggle("empty", empty);
    b.classList.toggle("down", down);
    b.title = empty ? `${slotName(i)}: empty. Buy a gun for it (B)` : down ? `${slotName(i)}: knocked out` : `${slotName(i)}: ${WEAPONS[EMP[i].weapon].name}`;
    b.setAttribute("aria-pressed", String(i === current && view === "sight"));
    const fill = b.querySelector<HTMLElement>(".rl > i")!;
    const r = empty || down ? 1 : (reload[i] ?? 0) / Math.max(1, wep(i).reload);
    fill.style.transform = `scaleX(${Math.max(0, Math.min(1, 1 - r))})`;
  });
}

let hudFrame = 0;
function updateHud(force = false) {
  if (!force && (hudFrame++ & 3) !== 0) return;
  const e = EMP[current], w = wep(current);
  const mods = e.mods ? [e.mods.heavy ? UPGRADES[e.weapon].heavy.name : "", e.mods.rifled ? UPGRADES[e.weapon].rifled.name : ""].filter(Boolean) : [];
  hud.name.textContent = w.name;
  hud.slot.textContent = mode === "versus" ? `${current + 1}, ${slotName(current)}${mods.length ? `, ${mods.join(", ").toLowerCase()}` : ""}` : `${current + 1}`;
  updateTabs();
  const r = reload[current];
  hud.reload.textContent = r > 0 ? `Reloading ${(r / 60).toFixed(1)} s` : "Ready";
  hud.reloadFill.style.transform = `scaleX(${1 - r / w.reload})`;
  const hitText = aimHelp === "full" && aimHit ? describeHit(aimHit) : "";
  // What a gunner reads off the quadrant: the barrel's elevation (and, for the mortar, its still-air range).
  const elevation = `Elevation ${((aims[current].pitch * 180) / Math.PI).toFixed(1)}°`;
  if (e.weapon === "mortar") {
    const flight = aimHelp === "full" && flightSeconds ? `, ${flightSeconds.toFixed(1)} s` : "";
    hud.target.textContent = hitText ? `Lands on ${hitText}${flight}` : `${elevation}, ${Math.round(stillAirRange(aims[current].pitch))} m in still air`;
    const air = fuseTicks > 0 && flightSeconds && fuseTicks / 60 <= flightSeconds + 0.02 && !aimHit ? " (bursts in the air)" : fuseTicks > 0 ? " (bounces, then bursts)" : "";
    hud.extra.textContent = (fuseTicks === 0 ? "Fuse: on impact" : `Fuse: ${(fuseTicks / 60).toFixed(1)} s${air}`) + "  ( [ ] )";
  } else {
    hud.target.textContent = hitText ? `Hits ${hitText}` : elevation;
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
  hud.minions.textContent = mode === "versus" ? "" : `${stats.down} down, ${stats.standing} standing`;
  hud.perf.textContent = `step ${stats.stepMs.toFixed(1)} ms (peak ${stats.stepPeak.toFixed(1)}), ${stats.awake} moving, tick ${lastFrameTick}, frame ${pacer.frameMs.toFixed(1)} ms, resolution ${Math.round(SCALES[pacer.scaleIdx] * 100)}%`;
  hud.lock.hidden = input.locked || view !== "sight" || input.usedPad || !!ride || buildOpen;
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
    localStorage.setItem("keepfall.aimHelp2", aimHelp);
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
  closeBuild();
  // A fresh set of guns (a match buys and upgrades its own), and the world for this mode.
  ALL_EMP = MATCH_EMPLACEMENTS.map((e) => ({ ...e }));
  EMP = ALL_EMP.slice(0, m === "versus" ? MAX_SLOTS : ASHWRIGHT_EMPLACEMENTS.length);
  slotViews = [];
  plotViews = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    aims[i] = restAim(ALL_EMP[i], WEAPONS[ALL_EMP[i].weapon]);
    wanted[i] = { ...aims[i] };
  }
  if (current >= EMP.length) current = 0;
  const want = m === "versus" ? (matchLayout ??= buildLayout(1, MATCH_LAYOUT)) : practiceLayout;
  if (want !== layout) {
    layout = want;
    timeline = new Timeline(layout);
    everMoved = new Uint8Array(layout.stones.length);
    if (rendererReady) renderer.setLayout(layout, ALL_EMP);
  } else if (rendererReady) renderer.setEmplacements(ALL_EMP, gunsShown());
  buildTabs();
  $("build-btn").hidden = m !== "versus";
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
  renderer.setGunsShown(gunsShown());
  renderer.setMarkers(m === "versus");
  prevGate = null;
  if (m === "versus") {
    send({ t: "input", input: { kind: "man", emplacement: current } });
    showNote("B opens the build menu: mills for gold, a foundry for upgrades, more barracks, guns for your empty slots. Barracks send a wave every 25 seconds; guns you do not ride fire at enemies near your walls. Ctrl+1, 2, 3: advance, hold, push the breach.", 10000);
  }
}

/** Which guns are drawn: the Practice range's four; in a match, every slot with a gun still standing (before the first report, the ones a castle starts with). */
function gunsShown(): boolean[] {
  return ALL_EMP.map((_, i) => {
    if (mode !== "versus") return i < ASHWRIGHT_EMPLACEMENTS.length;
    const s = slotViews[i];
    return s ? s.armed && !s.down : MATCH_SLOTS[i]?.start != null;
  });
}

/** Forget everything drawn from the old world. */
function resetLocal() {
  endRide();
  $("gains").textContent = "";
  pending.masonry = pending.bounty = pending.n = pending.at = 0;
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

const routeChips = [...document.querySelectorAll<HTMLButtonElement>("[data-route]")];
const orderChips = [...document.querySelectorAll<HTMLButtonElement>("[data-order]")];
routeChips.forEach((b) =>
  b.addEventListener("click", () => {
    setRoute(b.dataset.route as RouteName);
    b.blur();
  }),
);
orderChips.forEach((b) =>
  b.addEventListener("click", () => {
    giveOrder(Number(b.dataset.order));
    b.blur();
  }),
);

/** The match bar's waves line: the next wave, your route and order, and both sides' men. */
function updateWaves() {
  const info = matchInfo;
  if (!info) return;
  const s = Math.ceil(info.nextWave / 60);
  $("next-wave").textContent = info.result ? "" : info.waves[1] === 0 ? `First waves in ${s} s` : `Next waves in ${s} s`;
  routeChips.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.route === info.route)));
  orderChips.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.order) === info.order)));
  $("army-count").textContent = `Your men ${info.standing[1]} (${info.fallen[1]} down), enemy ${info.standing[0]} (${info.fallen[0]} down)`;
}

const FLOOR_NAMES = ["on the ground", "on the first floor", "on the second floor", "on the roof"];

/** Both keeps' banners: which floor each stands on (a shell down the shaft drops it one). */
function keepsText(f: [number, number]): string {
  return `Enemy banner <b>${FLOOR_NAMES[f[0]] ?? ""}</b>, yours <b>${FLOOR_NAMES[f[1]] ?? ""}</b>`;
}

/** Guns as the worker reports them: a gun bought for a slot is built and shown, a gun that fell is gone. */
function applySlots(slots: SlotView[]) {
  let rebuild = false, shown = false;
  for (let i = 0; i < slots.length && i < ALL_EMP.length; i++) {
    const v = slots[i], was = slotViews[i], e = ALL_EMP[i];
    if (e.weapon !== v.weapon || e.y !== v.y || e.barrel !== v.barrel) {
      e.weapon = v.weapon;
      e.y = v.y;
      e.barrel = v.barrel;
      rebuild = true;
      if (i < MAX_SLOTS) {
        aims[i] = restAim(e, WEAPONS[v.weapon]);
        wanted[i] = { ...aims[i] };
        fov[i] = WEAPONS[v.weapon].fov[1] * 0.8;
        shotCam[i] = v.weapon === "mortar";
        trails[i] = null;
        landing[i] = null;
      }
    }
    if (!!e.mods?.heavy !== v.heavy || !!e.mods?.rifled !== v.rifled) {
      if (v.heavy || v.rifled) e.mods = { heavy: v.heavy, rifled: v.rifled };
      else delete e.mods;
    }
    if (!was || was.armed !== v.armed || was.down !== v.down) shown = true;
    if (was && v.armed && v.down && !was.down) renderer.gunFalls(e.x, e.y, e.z);
  }
  slotViews = slots;
  if (rebuild) renderer.setEmplacements(ALL_EMP, gunsShown());
  else if (shown) renderer.setGunsShown(gunsShown());
  // The gun you ride fell with its wall: take the next one standing, or the overview.
  if (mode === "versus" && view === "sight" && !usable(current) && !buildOpen) {
    const j = nextUsable(current, 1);
    if (j >= 0) select(j);
    else toggleOverview();
  }
}

/** What happened in the match that you should hear about. */
function onMatchNote(n: MatchInfo["notes"][number]) {
  const yours = n.team === 1;
  if (n.kind === "built") {
    if (yours) {
      showNote(`${BUILDINGS[n.building].name} finished (${PLOTS[n.plot].name} plot).`, 3500);
      sound.built();
    } else showNote(`The enemy has finished a ${BUILDINGS[n.building].name}.`, 3500);
  } else if (n.kind === "down") {
    showNote(yours ? `Your ${BUILDINGS[n.building].name} was knocked down (${PLOTS[n.plot].name} plot).` : `Enemy ${BUILDINGS[n.building].name} knocked down.`, 4500);
  } else if (n.kind === "gunDown") {
    showNote(yours ? `Your ${WEAPONS[n.weapon].name.toLowerCase()} (${slotName(n.emplacement)}) fell with the masonry under it.` : `An enemy ${WEAPONS[n.weapon].name.toLowerCase()} is silenced.`, 4500);
  }
}

// ---- gold as it comes in --------------------------------------------------------
/** Bounties and masonry come in small amounts: gathered a moment before they show. Trick shots and buildings show at once. */
const pending = { masonry: 0, bounty: 0, n: 0, at: 0 };
function addGain(g: MatchInfo["gains"][number]) {
  if (g.why === "Masonry") pending.masonry += g.amount;
  else if (g.why.endsWith(" down") && !g.why.includes("knocked")) {
    pending.bounty += g.amount;
    pending.n++;
  } else {
    popGain(`+${g.amount} ${g.why}`, true);
    sound.coin(g.amount);
    return;
  }
  if (!pending.at) pending.at = performance.now() + 900;
}
function flushGains(now: number) {
  if (!pending.at || now < pending.at) return;
  if (pending.bounty) popGain(`+${pending.bounty} bounty (${pending.n} down)`, false);
  if (pending.masonry) popGain(`+${pending.masonry} masonry`, false);
  sound.coin(pending.bounty + pending.masonry);
  pending.masonry = pending.bounty = pending.n = 0;
  pending.at = 0;
}
function popGain(text: string, big: boolean) {
  const box = $("gains");
  const el = document.createElement("div");
  el.className = big ? "gain big" : "gain";
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 5) box.firstElementChild?.remove();
  setTimeout(() => el.remove(), 2700);
}

// ---- the build menu ---------------------------------------------------------------
let buildOpen = false;
/** The row the menu opened on (a plot clicked, an empty slot chosen). */
let buildFocus: { plot?: number; slot?: number } | null = null;
let buildDrawn = 0;
let buildKey = "";

function openBuild(at?: { plot?: number; slot?: number }) {
  if (mode !== "versus" || !matchInfo) return;
  endRide();
  // While you build, the gun you were riding fires on its own like the rest.
  if (!buildOpen && view === "sight") man(-1, current);
  buildOpen = true;
  buildFocus = at ?? null;
  $("build").hidden = false;
  input.muted = true;
  document.exitPointerLock?.();
  renderBuild(true);
  // Keys go to the menu: the first thing you can do on the row it opened on.
  const row = at ? document.querySelector<HTMLElement>(`#build-body [data-row="${at.plot !== undefined ? `p${at.plot}` : `s${at.slot}`}"]`) : null;
  const first = (row ?? $("build-body")).querySelector<HTMLButtonElement>("button:not(:disabled)");
  first?.focus();
  row?.scrollIntoView({ block: "nearest" });
}

function closeBuild() {
  if (!buildOpen) return;
  buildOpen = false;
  buildFocus = null;
  $("build").hidden = true;
  input.muted = false;
  (document.activeElement as HTMLElement | null)?.blur?.();
  // Back to the gun you were riding.
  if (mode === "versus" && view === "sight" && usable(current)) man(current, -1);
}

function toggleBuild() {
  if (buildOpen) closeBuild();
  else openBuild();
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function btn(act: string, label: string, enabled: boolean, title: string, pressed = false): string {
  return `<button data-act="${act}"${enabled ? "" : " disabled"}${pressed ? ' aria-pressed="true"' : ""} title="${esc(title)}">${esc(label)}</button>`;
}

/** Does the player have a building of this kind working? */
function playerHas(kind: BuildingKind): boolean {
  return plotViews.some((p) => p.team === 1 && p.kind === kind && p.state === 2);
}

function renderBuild(force = false) {
  if (!buildOpen || !matchInfo) return;
  const now = performance.now();
  if (!force && now - buildDrawn < 200) return;
  buildDrawn = now;
  const gold = matchInfo.gold[1];
  $("build-gold").textContent = `${gold} gold, +${matchInfo.income} a second`;
  const rows: string[] = [];
  rows.push(`<h3>Plots</h3>`);
  const mine = plotViews.filter((p) => p.team === 1);
  for (const p of mine) {
    const name = PLOTS[p.plot].name;
    const focus = buildFocus?.plot === p.plot ? " focus" : "";
    let what = "", acts = "";
    if (p.state === 0 || p.state === 3) {
      what = p.state === 0 ? `<small>Empty</small>` : `${BUILDINGS[p.kind!].name} <small>knocked down: build again (the wreck is cleared)</small>`;
      acts = BUILDING_KINDS.map((k) => btn(`build:${p.plot}:${k}`, `${BUILDINGS[k].name} ${BUILDINGS[k].cost}`, gold >= BUILDINGS[k].cost, gold >= BUILDINGS[k].cost ? BUILDINGS[k].blurb : `Needs ${BUILDINGS[k].cost} gold. ${BUILDINGS[k].blurb}`)).join("");
    } else if (p.state === 1) {
      what = `${BUILDINGS[p.kind!].name} <small>going up, ${Math.round(p.progress * 100)}%</small>`;
      acts = `<div class="bar prog"><i style="transform: scaleX(${p.progress.toFixed(3)})"></i></div>`;
    } else {
      what = `${BUILDINGS[p.kind!].name} <small>${p.kind === "mill" ? "2 gold a second" : p.kind === "foundry" ? "upgrades and musketeers" : "working"}${p.standing < 0.999 ? `, ${Math.round(p.standing * 100)}% standing` : ""}</small>`;
      if (p.kind === "barracks") {
        acts = `<span class="lbl">Route</span>` + ROUTE_NAMES.map((r) => btn(`route:${p.plot}:${r}`, r === "centre" ? "Centre" : r === "left" ? "Left" : "Right", true, `Its waves march down the ${routeName(r)}`, p.route === r)).join("");
        acts += `<span class="lbl">Mix</span>` + MIX_NAMES.map((m) => btn(`mix:${p.plot}:${m}`, MIXES[m].name, true, mixTitle(m), p.mix === m)).join("");
      }
    }
    rows.push(`<div class="brow${focus}" data-row="p${p.plot}"><span class="num">${p.plot + 1}</span><div class="what">${esc(capital(name))}: ${what}</div><div class="acts">${acts}</div></div>`);
  }
  rows.push(`<h3>Guns</h3>`);
  const foundry = playerHas("foundry");
  for (let i = 0; i < MAX_SLOTS && i < slotViews.length; i++) {
    const v = slotViews[i], def = MATCH_SLOTS[i];
    const focus = buildFocus?.slot === i ? " focus" : "";
    let what = "", acts = "";
    if (v.armed && v.down) what = `${WEAPONS[v.weapon].name} <small>knocked out: the masonry under it is down</small>`;
    else if (!v.armed) {
      what = `<small>Empty${def.mount === "pit" ? " (a mortar pit)" : def.mount === "wall" ? " (no mortar on the wall walk)" : ""}</small>`;
      acts = WEAPON_KINDS.filter((w) => mountTakes(def.mount, w)).map((w) => btn(`buy:${i}:${w}`, `${WEAPONS[w].name} ${WEAPON_COST[w]}`, gold >= WEAPON_COST[w], gold >= WEAPON_COST[w] ? `Buy a ${WEAPONS[w].name.toLowerCase()} for this slot` : `Needs ${WEAPON_COST[w]} gold`)).join("");
    } else {
      what = WEAPONS[v.weapon].name;
      acts = UPGRADE_KINDS.map((u) => {
        const U = UPGRADES[v.weapon][u];
        if ((u === "heavy" && v.heavy) || (u === "rifled" && v.rifled)) return `<span class="lbl">${esc(U.name)} fitted</span>`;
        const ok = foundry && gold >= UPGRADE_COST;
        const why = !foundry ? "Needs a Foundry. " : gold < UPGRADE_COST ? `Needs ${UPGRADE_COST} gold. ` : "";
        return btn(`up:${i}:${u}`, `${U.name} ${UPGRADE_COST}`, ok, `${why}${U.blurb}`);
      }).join("");
      if (!foundry) acts += `<span class="lbl">upgrades need a Foundry</span>`;
    }
    rows.push(`<div class="brow${focus}" data-row="s${i}"><span class="num">${i + 1}</span><div class="what">${esc(capital(def.name))}: ${what}</div><div class="acts">${acts}</div></div>`);
  }
  const html = rows.join("");
  if (html === buildKey) return;
  buildKey = html;
  const had = (document.activeElement as HTMLElement | null)?.dataset?.act;
  $("build-body").innerHTML = html;
  if (had) document.querySelector<HTMLButtonElement>(`#build-body [data-act="${had}"]`)?.focus();
}

function capital(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function mixTitle(m: MixName): string {
  const counts = new Map<string, number>();
  for (const u of MIXES[m].units) counts.set(u, (counts.get(u) ?? 0) + 1);
  let cost = 0;
  const parts: string[] = [];
  for (const [u, n] of counts) {
    const unit = UNITS[u as keyof typeof UNITS];
    cost += unit.cost * n;
    parts.push(`${n} ${unit.name.toLowerCase()}${n > 1 ? "s" : ""}`);
  }
  const needs = [...counts.keys()].map((u) => UNIT_NEEDS[u as keyof typeof UNIT_NEEDS]).filter((b): b is BuildingKind => !!b && !playerHas(b));
  const missing = needs.length ? ` Without a ${[...new Set(needs)].map((b) => BUILDINGS[b].name).join(" and a ")} they march as pikemen.` : "";
  return `${parts.join(", ")}${cost ? `: ${cost} gold a wave` : ""}.${missing}`;
}

/** A button in the build menu was pressed. */
function doAct(act: string) {
  if (mode !== "versus" || !matchInfo || matchInfo.result) return;
  const [kind, a, b] = act.split(":");
  const n = Number(a);
  if (kind === "build") {
    send({ t: "input", input: { kind: "build", plot: n, building: b as BuildingKind } });
    showNote(`${BUILDINGS[b as BuildingKind].name} going up on the ${PLOTS[n].name} plot.`, 2500);
  } else if (kind === "route") send({ t: "input", input: { kind: "barracks", plot: n, route: b as RouteName } });
  else if (kind === "mix") send({ t: "input", input: { kind: "barracks", plot: n, mix: b as MixName } });
  else if (kind === "buy") {
    send({ t: "input", input: { kind: "buy", emplacement: n, weapon: b as WeaponKind } });
    showNote(`A ${WEAPONS[b as WeaponKind].name.toLowerCase()} for the ${slotName(n)}: press ${n + 1} to ride it once it is loaded.`, 3500);
  } else if (kind === "up") send({ t: "input", input: { kind: "upgrade", emplacement: n, upgrade: b as UpgradeKind } });
  buildDrawn = 0;
}

$("build-body").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
  if (b && !b.disabled) doAct(b.dataset.act!);
});
$("build-btn").addEventListener("click", () => {
  toggleBuild();
  $<HTMLButtonElement>("build-btn").blur();
});

// Keys in the build menu: arrows move between its buttons, Enter or Space presses one, Esc closes it.
window.addEventListener(
  "keydown",
  (e) => {
    if (!buildOpen) return;
    const list = [...document.querySelectorAll<HTMLButtonElement>("#build-body button:not(:disabled)")];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (k: number) => {
      const b = list[Math.max(0, Math.min(list.length - 1, k))];
      b?.focus();
      b?.closest(".brow")?.scrollIntoView({ block: "nearest" });
    };
    const rowOf = (b: HTMLElement | undefined) => b?.closest(".brow");
    if (e.code === "ArrowRight" || e.code === "ArrowLeft") {
      go(at < 0 ? 0 : at + (e.code === "ArrowRight" ? 1 : -1));
    } else if (e.code === "ArrowDown" || e.code === "ArrowUp") {
      const dir = e.code === "ArrowDown" ? 1 : -1;
      const row = rowOf(list[at]);
      let k = at < 0 ? 0 : at;
      while (k >= 0 && k < list.length && rowOf(list[k]) === row) k += dir;
      // The first button of the row it lands in.
      if (dir < 0) while (k > 0 && rowOf(list[k - 1]) === rowOf(list[k])) k--;
      go(k);
    } else if (e.code === "Enter" || e.code === "Space") {
      if (at >= 0) list[at].click();
    } else if (e.code === "Escape") {
      closeBuild();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  },
  { capture: true },
);

// ---- clicks on the scene: in the overview (or with the build menu open), your guns and plots -----------------
let clickFrom: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.button === 0) clickFrom = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointerup", (e) => {
  const from = clickFrom;
  clickFrom = null;
  if (e.button !== 0 || !from || Math.hypot(e.clientX - from.x, e.clientY - from.y) > 6) return;
  if (mode !== "versus" || (view === "sight" && !buildOpen)) return;
  const p = renderer.pick(e.clientX, e.clientY);
  if (!p) return;
  // One of your guns (a click near its pivot).
  for (let i = 0; i < MAX_SLOTS; i++) {
    const g = ALL_EMP[i];
    if (Math.hypot(p.x - g.x, p.z - g.z) < 3 && Math.abs(p.y - g.y) < 5) {
      select(i);
      return;
    }
  }
  // One of your plots.
  for (const pl of PLOTS) {
    const z = -layout.dist - pl.z;
    if (Math.abs(p.x - pl.x) < pl.hw + 0.8 && Math.abs(p.z - z) < pl.hd + 0.8) {
      openBuild({ plot: pl.id });
      return;
    }
  }
});

/** Numbers over your plots in the overview and with the build menu open. */
const plotLabels: HTMLDivElement[] = [];
function updateLabels() {
  const box = $("plot-labels");
  const on = mode === "versus" && (view === "overview" || buildOpen) && !ride && !testCamera;
  if (!on) {
    if (plotLabels.length) plotLabels.forEach((l) => (l.hidden = true));
    return;
  }
  for (const pl of PLOTS) {
    let el = plotLabels[pl.id];
    if (!el) {
      el = document.createElement("div");
      el.className = "plabel";
      box.appendChild(el);
      plotLabels[pl.id] = el;
    }
    const v = plotViews.find((q) => q.team === 1 && q.plot === pl.id);
    const what = !v || v.state === 0 ? "empty" : v.state === 1 ? `${BUILDINGS[v.kind!].name} ${Math.round(v.progress * 100)}%` : v.state === 3 ? `${BUILDINGS[v.kind!].name}, down` : BUILDINGS[v.kind!].name;
    const text = `${pl.id + 1} ${what}`;
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle("sel", buildFocus?.plot === pl.id);
    const s = renderer.project(pl.x, 4.2, -layout.dist - pl.z);
    el.hidden = !s;
    if (s) el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}

/**
 * A view over your own courtyard while the build menu is open: from high
 * behind the keep, looking towards the enemy as you do from your guns (so a
 * plot on your left is on the left), the castle to the left of the menu.
 */
function castlePose(): CameraPose {
  const cz = layout.castleZ[1];
  return { mode: "free", x: -11, y: 66, z: cz - 26, tx: -11, ty: 0, tz: cz + 3, fov: 48 };
}

// ---- pause -------------------------------------------------------------------------
let userPaused = false;
function togglePause() {
  userPaused = !userPaused;
  $("paused").hidden = !userPaused;
  send({ t: "pause", paused: paused || userPaused });
  sound.setPaused(paused || userPaused);
}

let sapperWarned = -1e9;
/** Enemy sappers with their kegs close to your gate: say so (at most every 20 s). */
function watchSappers(f: FrameData, now: number) {
  if (mode !== "versus" || now - sapperWarned < 20000) return;
  const gz = layout.castleZ[1] + 15;
  for (let i = 0; i < f.minionCount; i++) {
    const o = i * MINION_STRIDE;
    if ((f.minions[o + 6] | 0) !== 0 || (f.minions[o + 9] | 0) !== UNIT_KINDS.indexOf("sapper") || f.minions[o + 10] < 0.5) continue;
    if (Math.hypot(f.minions[o + 1], f.minions[o + 3] - gz) < 32) {
      sapperWarned = now;
      showNote("Enemy sappers with powder kegs at your gate: shoot the kegs before they reach it.", 4500);
      return;
    }
  }
}

function clockText(ticks: number): string {
  const s = Math.floor(ticks / 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Gate state as last shown, for notes when it changes. */
let prevGate: { hits: [number, number]; open: [boolean, boolean] } | null = null;

function onMatch(info: MatchInfo) {
  const prev = matchInfo;
  matchInfo = { ...info, masonry: info.masonry ?? prev?.masonry ?? null, earned: info.earned ?? prev?.earned ?? null };
  plotViews = info.plots;
  applySlots(info.slots);
  for (const g of info.gains) addGain(g);
  for (const n of info.notes) onMatchNote(n);
  $("keeps").innerHTML = keepsText(info.keepFloor);
  renderBuild();
  updateWaves();
  if (!info.result) {
    const was = prevGate;
    if (was) {
      if (!was.open[1] && info.gateOpen[1]) showNote("Your gate is down: enemy pikemen can get into your courtyard.", 5000);
      else if (!was.open[0] && info.gateOpen[0]) showNote("The enemy gate is down.", 4000);
      else if (was.hits[1] === 0 && info.gateHits[1] > 0) showNote("Enemy pikemen are battering your gate.", 4000);
    }
    prevGate = { hits: [info.gateHits[0], info.gateHits[1]], open: [info.gateOpen[0], info.gateOpen[1]] };
  }
  $("clock").textContent = clockText(info.result ? info.result.tick : info.tick);
  $("gold").textContent = `${info.gold[1]} gold, +${info.income} a second`;
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
  const pieces = (n: number) => `${n} ${n === 1 ? "piece" : "pieces"}`;
  $("end-enemy").textContent = mas ? pieces(mas[0]) : "";
  $("end-yours").textContent = mas ? pieces(mas[1]) : "";
  $("end-shots").textContent = `${info.shots[1]}`;
  $("end-lost").textContent = `${info.fallen[1]}`;
  $("end-downed").textContent = `${info.fallen[0]}`;
  const earned = info.earned ?? {};
  const total = Object.values(earned).reduce((a, b) => a + b, 0);
  const NAMES: Record<string, string> = { keep: "keep", mills: "mills", bounty: "bounties", masonry: "masonry", tricks: "trick shots", building: "buildings" };
  const parts = Object.entries(earned).filter(([, v]) => v > 0).map(([k, v]) => `${NAMES[k] ?? k} ${v}`);
  $("end-gold").textContent = parts.length ? `${total} (${parts.join(", ")})` : `${total}`;
  closeBuild();
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
  if (buildOpen) {
    // Tab from the build menu: to the overview.
    closeBuild();
    if (view === "overview") return;
  }
  // Back to the sight only on a gun you can ride.
  if (view === "overview" && !usable(current)) {
    const j = nextUsable(current, 1);
    if (j < 0) return;
    current = j;
  }
  view = view === "sight" ? "overview" : "sight";
  if (view === "overview") document.exitPointerLock?.();
  if (mode === "versus") man(view === "sight" ? current : -1, view === "sight" ? -1 : current);
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
  input.lockable = view === "sight" && !buildOpen && !ride;
  const p = input.read();
  if (p.weapon >= 0) select(p.weapon);
  if (p.next || p.prev) {
    const j = nextUsable(current, p.next ? 1 : -1);
    if (j >= 0) select(j);
  }
  if (p.build) toggleBuild();
  if (p.pause) togglePause();
  if (p.overview) toggleOverview();
  if (p.help) help.hidden = !help.hidden;
  if (p.shotCam) toggleShotCam();
  if (p.mute) {
    sound.setMuted(!sound.muted);
    updateHud(true);
  }
  if (p.nav) toggleNav();
  if (p.order >= 0) giveOrder(p.order);
  if (p.orderNext && matchInfo) giveOrder((matchInfo.order + 1) % 3);
  if (p.route && matchInfo) setRoute(ROUTE_NAMES[(ROUTE_NAMES.indexOf(matchInfo.route) + 1) % ROUTE_NAMES.length]);
  if (p.spin && EMP[current].weapon === "longGun") spin = ((spin + 1) % 5) as Spin;
  const w = wep(current);
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
  if (!testCamera && !buildOpen && (pose.mode === "sight" || (pose.mode === "free" && !ride))) pose.fov = shownFov;
  applyShake(pose, now);
  renderer.setCamera(pose);
  updateAimHelp();
  updateHud();
  placeWanted();
  updateLabels();
  flushGains(performance.now());
  if (!paused) renderer.render(dt);
  sound.update(renderer.listener(), dt, { wind: Math.hypot(wind.x, wind.z), awake: stats.awake, slow: timeScale });
  calibrate(dt);
  pace(dt, now);
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  paused = document.hidden;
  send({ t: "pause", paused: paused || userPaused });
  sound.setPaused(paused || userPaused);
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
  renderer.setLayout(layout, ALL_EMP);
  renderer.setGunsShown(gunsShown());
  renderer.setMarkers(mode === "versus");
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
buildTabs();
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
  giveOrder,
  setRoute,
  toggleOverview,
  get view() {
    return view;
  },
  /** Rendered frames so far (with #fixed, 30 per game second). */
  get frames() {
    return frames;
  },
  /** With #fixed: stop or restart game time. */
  freeze(on: boolean) {
    frozen = on;
  },
  aimAt(emp: number, yaw: number, pitch: number) {
    aims[emp] = clampAim({ yaw, pitch }, EMP[emp], wep(emp));
    wanted[emp] = { ...aims[emp] };
  },
  openBuild,
  closeBuild,
  doAct,
  togglePause,
  get slots() {
    return slotViews.slice();
  },
  get plots() {
    return plotViews.slice();
  },
  get buildOpen() {
    return buildOpen;
  },
  select,
  fire,
  /** Point a fixed camera (null: back to the game's own). */
  look(cam: typeof testCamera) {
    testCamera = cam;
  },
  setFov(emp: number, f: number) {
    fov[emp] = f;
  },
};
