// The game page: a start menu, the Practice range (ride the four Ashwright
// weapons against the target castle) and a match against the AI castle.
// Aiming runs here at a fixed 60 Hz through the same limiter the sim checks;
// a fire sends the exact aim to the worker, which owns everything else.

import {
  AI_LEVELS,
  ASHWRIGHT_EMPLACEMENTS,
  ASHWRIGHT_SLOTS,
  BARREL,
  DIFFICULTIES,
  type Difficulty,
  buildLayout,
  GAME_LAYOUT,
  KEEP_STOREYS,
  MATCH_EMPLACEMENTS,
  REPAIR_KINDS,
  ROUTE_NAMES,
  UPGRADE_KINDS,
  WEAPON_KINDS,
  WEAPONS,
  weaponOf,
  type Emplacement,
  type RepairKind,
  type RouteName,
  type Stone,
} from "@keepfall/content";
import { Estate } from "./estate-page";
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
  ProjectileKind,
  restAim,
  Spin,
  spinVector,
  stepAim,
  MINION_STRIDE,
  type AimState,
  type FrameData,
} from "@keepfall/sim";
import { Input } from "./input";
import type { FromWorker, MasonInfo, MatchInfo, MatchSetup, Mode, ToWorker } from "./protocol";
import { Online, type OnlineStart } from "./online";
import type { CameraPose, PathHit, QualityTier } from "./render/api";
import { GameRenderer } from "./render/GameRenderer";
import { LAY_SECONDS } from "./render/works";
import { Sound } from "./sound";
import { Soundscape } from "./soundscape";
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
/** What the battle sounds like: impacts by material, footfalls, clashes, shouting, the stream, crows. */
const soundscape = new Soundscape(sound, layout);
/** M3: the build wheel, gold coming in, notes and sounds of the plots. */
const estate = new Estate(renderer, sound, send, (text, ms) => showNote(text, ms), $);
/** Sim frames are applied on a render clock a little behind the sim, and shells and stones are drawn between them. */
const timeline = new Timeline(layout);
/**
 * The guns you ride: the Practice range's four, or in a match your castle's
 * eight emplacements (M3: empty slots fill in as you buy guns). A match also
 * has the enemy's, which fire on their own: ALL_EMP holds every one as the
 * worker last reported it (the player's first, the same objects as EMP).
 */
const ALL_EMP: Emplacement[] = MATCH_EMPLACEMENTS.map((e) => ({ ...e }));
let EMP: Emplacement[] = ASHWRIGHT_EMPLACEMENTS;
/** Slots the page keeps aim, zoom, trails and reloads for (the most any mode has). */
const SLOTS = ASHWRIGHT_SLOTS.length;
/**
 * M5: the team this page plays and the other one (team 1 holds the castle at
 * z = -DIST, team 0 the one at the origin), and the first match id of its
 * guns: the page keeps its own guns as slots 0 to 7 and speaks to the worker
 * in the match's emplacement ids (the guest online plays team 0, ids 8 to 15).
 */
let ME: 0 | 1 = 1;
let FOE: 0 | 1 = 0;
let BASE = 0;
/** Versus AI's difficulty (remembered). */
let difficulty: Difficulty = "knight";
try {
  const d = localStorage.getItem("keepfall.difficulty") as Difficulty | null;
  if (d && DIFFICULTIES.includes(d)) difficulty = d;
} catch {}
/** Online: who the friend is, as the lobby found them. */
let friendName = "";

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
/** In a match (against the AI or a friend), not the Practice range. */
const isMatch = () => mode === "versus" || mode === "online";
/** A gun slot's match id, and its reload in ticks. */
const gid = (i: number) => EMP[i]?.id ?? i;
const rl = (i: number) => reload[gid(i)] ?? 0;
const hashMode: Mode | null = location.hash.includes("versus") ? "versus" : location.hash.includes("practice") || FIXED ? "practice" : null;
// #versus=squire (or knight, warlord) picks the difficulty too.
for (const d of ["squire", "knight", "warlord"] as const) if (location.hash.includes(`versus=${d}`)) difficulty = d;
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
// Per slot (eight, the most a mode has): the aim, where the player wants it, the zoom.
const aims: AimState[] = ASHWRIGHT_SLOTS.map((e) => restAim(e, WEAPONS[e.weapon]));
/** Where the player wants the weapon to point; the weapon turns towards it at its own rate. */
const wanted: AimState[] = aims.map((a) => ({ ...a }));
const fov: number[] = ASHWRIGHT_SLOTS.map((e) => WEAPONS[e.weapon].fov[1] * 0.8);
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
let shotCam: boolean[] = ASHWRIGHT_SLOTS.map((e) => e.weapon === "mortar");
try {
  if (localStorage.getItem("keepfall.aimHelp2") === "full") aimHelp = "full";
  slowMo = localStorage.getItem("keepfall.slowmo") === "1";
  const saved = localStorage.getItem("keepfall.shotCam");
  if (saved && saved.length >= 4) [...saved].slice(0, SLOTS).forEach((c, i) => (shotCam[i] = c === "1"));
} catch {}
/** Seconds the current shot is predicted to fly before it lands or bursts. */
let flightSeconds = 0;
/** What the current shot is predicted to hit (full aim help). */
let aimHit: PathHit | null = null;
let spin: Spin = Spin.None;
let view: "sight" | "overview" = "sight";
let reload: number[] = ASHWRIGHT_SLOTS.map(() => 0);
let wind = { x: 0, z: 0 };
let ready = false;
let paused = false;
const trails: Array<Float32Array | null> = ASHWRIGHT_SLOTS.map(() => null);
const recording = new Map<number, { emp: number; pts: number[] }>(); // shot id -> trail
const landing: Array<{ x: number; y: number; z: number } | null> = ASHWRIGHT_SLOTS.map(() => null);
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
/** Where in a mason's stroke the mallet strikes (ticks since the stroke began; the renderer's swing matches). */
const MALLET_HIT = 14;
const malletAct = new Map<number, number>();
let laidSounds = 0, clearSounds = 0, cracks = 0;
/** The match as it went, for the end screen: a line per moment that mattered, with the clock. */
let matchLog: Array<{ tick: number; text: string; bad: boolean }> = [];

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
  if (m.t === "net") {
    online.fromWorker(m.state, m.waiting, m.desync);
    return;
  }
  if (m.t === "frame") {
    const was = rl(current);
    reload = m.reload;
    soundscape.reload(EMP[current].weapon, rl(current), WEAPONS[EMP[current].weapon].reload, view === "sight" && mode !== null);
    if (was > 0 && rl(current) === 0) {
      sound.ready(EMP[current].weapon);
      flashLoaded();
    }
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
      // Your own gun slot (the match id less your first one), or out of range for the other side's.
      const slot = emp - BASE;
      const yours = slot >= 0 && slot < EMP.length;
      if (e) sound.fire(e.weapon, e.x, e.y, e.z, yours && slot === current && !auto);
      if (!auto && yours && e) {
        recording.set(id, { emp: slot, pts: [] });
        if (shotCam[slot] && slot === current) {
          if (e.weapon === "mortar") startRide(id, slot, now);
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
      if (a >= 0 && a - BASE >= 0 && a - BASE < EMP.length) landing[a - BASE] = { x: b, y: c, z: d }; // (an unmanned shot's is -(id + 1))
      soundscape.landed(b, c, d, ALL_EMP[a >= 0 ? a : -a - 1]?.weapon ?? null);
    } else if (kind === EventKind.Impact) {
      if (impacts++ < 3) soundscape.impact(a, b, c, d);
    } else if (kind === EventKind.Blood) {
      sound.thud(a, b, c, d);
    } else if (kind === EventKind.Laid) {
      // Masons put a piece back: it rises on the hoist and settles (the renderer), then the sound of it bedding in.
      const s = layout.stones[a | 0];
      if (s) {
        everMoved[s.id] = 0;
        if (laidSounds++ < 3) sound.stoneSet(s.x, s.y, s.z, s.part === "gate" ? 2 : s.part === "storey" ? 1 : 0, LAY_SECONDS);
      }
    } else if (kind === EventKind.Cleared) {
      if (clearSounds++ < 2) sound.scrape(b, Math.max(0.3, c), d);
    } else if (kind === EventKind.Ladder) {
      if (b === 2) sound.ladderUp(c, 7.5, d);
      else sound.ladderDown(c, 1, d);
    } else if (kind === EventKind.Raised && a >= 0 && a < everMoved.length) {
      everMoved[a] = 0; // M3: a building's piece back up: its next fall counts again
    } else if (kind === EventKind.Cracked) {
      // M5: a shell cracked a keep floor board that held: timber splitting (the renderer throws splinters).
      if (cracks++ < 2) sound.woodHit(b, c, d, 0.8);
    }
  }
  laidSounds = clearSounds = cracks = 0;
  // Masons at work: a mallet stroke whenever one comes down (act counts ticks since each stroke began).
  let strokes = 0;
  for (let i = 0; i < f.minionCount; i++) {
    const o = i * MINION_STRIDE;
    if (f.minions[o + 9] !== 1 || f.minions[o + 7] !== 4) continue;
    const id = f.minions[o] | 0, act = f.minions[o + 8];
    const was = malletAct.get(id) ?? 0;
    malletAct.set(id, act);
    if (was < MALLET_HIT && act >= MALLET_HIT && strokes++ < 3) sound.mallet(f.minions[o + 1], f.minions[o + 2] + 1, f.minions[o + 3], id);
  }
  // M3: the plots' notes and sounds, muskets and kegs heard.
  estate.onFrame(f, now);
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
  soundscape.frame(f, ear);
  lastApplied = f;
  renderer.applyFrame(f);
}
/** The last frame applied (the screenshot tools read figures and ladders from it). */
let lastApplied: FrameData | null = null;

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
    if ((kind === EventKind.Landed && f.events[k * EVENT_STRIDE + 1] === gid(current)) || kind === EventKind.Explosion) return true;
  }
  return false;
}

/** Slow motion for the sim (sandbox only), the effects and new sounds. */
function setSlow(factor: number) {
  // Online the sim's clock is both players': slowing it here would slow your friend's game too.
  if (mode === "online") factor = 1;
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
  const w = weaponOf(e);
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
  const e = EMP[current], w = weaponOf(e);
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
  if (!ready || rl(current) > 0 || matchInfo?.result) return;
  const e = EMP[current];
  if (e.empty) {
    estate.openFor(current);
    return;
  }
  const a = aims[current];
  send({ t: "input", input: { kind: "fire", emplacement: gid(current), yaw: a.yaw, pitch: a.pitch, charge: 1, fuse: fuseTicks, spin: e.weapon === "longGun" ? spin : Spin.None } });
  reload[gid(current)] = weaponOf(e).reload; // until the worker confirms
}

/** Q and E: the next or the previous gun that is armed (M3: empty slots are passed over). */
function step(dir: number) {
  for (let k = 1; k <= EMP.length; k++) {
    const i = (((current + dir * k) % EMP.length) + EMP.length) % EMP.length;
    if (!EMP[i].empty) return select(i);
  }
}

function select(i: number) {
  endRide();
  const prev = current;
  const wasSight = view === "sight";
  if (i >= EMP.length) return;
  current = ((i % EMP.length) + EMP.length) % EMP.length;
  if (current !== prev) sound.ui("switch");
  view = "sight";
  obs.primed = false;
  keyVel.yaw = keyVel.pitch = 0;
  if (isMatch() && (current !== prev || !wasSight)) man(current, wasSight ? prev : -1);
  updateHud(true);
}

/**
 * In a match: ride gun `e` (-1: none, in the overview), leaving gun `left`
 * where you put it. Every gun you do not ride fires at enemy minions near
 * your walls on its own, so you take a gun as it points: it swings back to
 * where you last wanted it at its own rate.
 */
function man(e: number, left: number) {
  const g = matchInfo?.guns;
  const id = e >= 0 ? gid(e) : -1;
  if (e >= 0 && g && g.length >= (id + 1) * 2) aims[e] = clampAim({ yaw: g[id * 2], pitch: g[id * 2 + 1] }, EMP[e], weaponOf(EMP[e]));
  send({ t: "input", input: { kind: "man", emplacement: id, left: left >= 0 ? { emplacement: gid(left), yaw: aims[left].yaw, pitch: aims[left].pitch } : undefined } });
}

/** Orders for all your waves (Ctrl+1, 2, 3) and the route of your next ones (L). */
function giveOrder(order: number) {
  if (!isMatch() || !matchInfo || matchInfo.result) return;
  send({ t: "input", input: { kind: "order", order: order as Order } });
  sound.ui("order");
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
  if (!isMatch() || !matchInfo || matchInfo.result) return;
  send({ t: "input", input: { kind: "route", route } });
  sound.ui("click");
  showNote(`Your next waves march down the ${route === "centre" ? "centre road" : `${route} flank`}.`, 2600);
  matchInfo.route = route;
  updateWaves();
}

/** Online (M5): where the gun you ride points, a few times a second while it turns, so your friend sees it move. */
const aimSent = { yaw: NaN, pitch: NaN, at: 0, slot: -1 };
function sendAim(now: number) {
  if (mode !== "online" || view !== "sight" || ride || EMP[current].empty || matchInfo?.result) return;
  const a = aims[current];
  const moved = aimSent.slot !== current || Math.abs(a.yaw - aimSent.yaw) > 0.003 || Math.abs(a.pitch - aimSent.pitch) > 0.003;
  if (!moved || now - aimSent.at < 250) return;
  aimSent.yaw = a.yaw;
  aimSent.pitch = a.pitch;
  aimSent.at = now;
  aimSent.slot = current;
  send({ t: "input", input: { kind: "aim", emplacement: gid(current), yaw: a.yaw, pitch: a.pitch } });
}

// ---- camera and aim help ---------------------------------------------------------
/** Test hook (the screenshot tools): a fixed camera, eye and target, instead of the player's view. */
let testCamera: { x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number } | null = null;

function cameraPose(now: number, dt: number): CameraPose {
  if (testCamera) return { mode: "free", ...testCamera };
  if (mode === null) return titlePose(now);
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
  const e = EMP[current], w = weaponOf(e), a = aims[current];
  const showing = view === "sight" && !follow && !ride && !e.empty;
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
  const guns = isMatch() ? matchInfo?.guns : undefined;
  for (let i = 0; i < ALL_EMP.length; i++) {
    // The renderer's guns go by match id; yours are your slots from BASE on.
    const slot = i - BASE;
    const yours = slot >= 0 && slot < EMP.length;
    const riding = yours && slot === current && view === "sight";
    if (guns && !riding && guns.length >= (i + 1) * 2) renderer.setWeaponPose(i, guns[i * 2], guns[i * 2 + 1], false);
    else if (yours) renderer.setWeaponPose(i, aims[slot].yaw, aims[slot].pitch, slot === current);
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
};

/** "the target keep, 151 m" for the HUD. */
function describeHit(h: PathHit | null): string {
  if (!h) return "";
  const e = EMP[current];
  const dist = Math.hypot(h.x - e.x, h.z - e.z);
  let what = "the ground";
  for (const c of [0, 1] as const) {
    if (h.stone < 0 && Math.abs(h.x) < 14 && Math.abs(h.z - layout.castleZ[c]) < 14) what = c === FOE ? "the target courtyard" : "your own courtyard";
  }
  const bridge = h.stone >= 0 ? layout.bridges.find((b) => h.stone >= b.first && h.stone < b.first + b.count) : undefined;
  if (bridge) {
    what = `the ${bridge.site.name} bridge`;
  } else if (h.stone >= 0) {
    const s = layout.stones[h.stone];
    const part = s && s.part === "storey" && s.course === KEEP_TOP_COURSE ? "keep roof" : s ? PART_NAMES[s.part] : "";
    what = s ? `${s.castle === FOE ? "the target" : "your own"} ${part}` : "rubble";
  }
  return `${what}, ${Math.round(dist)} m`;
}

/**
 * The title screen's camera (before a mode is chosen): a slow circuit of the
 * valley at the height of the hills, always looking over the field between
 * the castles, so the menu sits over a living view.
 */
function titlePose(now: number): CameraPose {
  const t = now / 1000;
  const a = 0.35 + t * 0.02;
  // Above the trees on a loop round the valley floor; looking ahead along the valley, so the hills and the sky fill the top of the frame.
  const x = Math.sin(a) * 58, z = -75 - Math.cos(a) * 100;
  const y = 24 + 4 * Math.sin(t * 0.05);
  const b = a + 1.1;
  return { mode: "free", x, y, z, tx: Math.sin(b) * 29, ty: 5, tz: -75 - Math.cos(b) * 50, fov: 50 };
}

/** The weapon panel's reload bar lights up for a moment when the gun is loaded. */
const weaponPanel = document.querySelector<HTMLElement>(".weapon")!;
let freshTimer: ReturnType<typeof setTimeout> | undefined;
function flashLoaded() {
  weaponPanel.classList.remove("fresh");
  void weaponPanel.offsetWidth; // restart the animation
  weaponPanel.classList.add("fresh");
  clearTimeout(freshTimer);
  freshTimer = setTimeout(() => weaponPanel.classList.remove("fresh"), 800);
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
/** M3: one tab per gun you can ride (eight in a match, the empty ones dimmed), rebuilt when a gun is bought. */
let tabs: HTMLButtonElement[] = [];
function buildTabs() {
  const group = $("weapons");
  group.innerHTML = "";
  tabs = EMP.map((e, i) => {
    const b = document.createElement("button");
    b.dataset.weapon = String(i);
    b.textContent = e.empty ? `${i + 1} +` : `${i + 1} ${WEAPONS[e.weapon].name}`;
    if (e.empty) {
      // Empty slots stay short, so eight tabs and the buttons beside them fit one row on a laptop.
      b.className = "emptyslot";
      b.title = `Slot ${i + 1}: empty (buy a gun for it in the build menu, B)`;
      b.setAttribute("aria-label", `Slot ${i + 1}, empty`);
    }
    b.addEventListener("click", () => {
      select(i);
      b.blur(); // keep keys like Space for the game, not the button
    });
    group.append(b);
    return b;
  });
}
buildTabs();

// The match bar and the Controls panel sit below the top bar, however many rows it wraps into.
{
  const topBar = document.querySelector<HTMLElement>(".top");
  if (topBar) {
    const sync = () => document.documentElement.style.setProperty("--top-h", `${topBar.offsetHeight}px`);
    sync();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(sync).observe(topBar);
  }
}

let hudFrame = 0;
function updateHud(force = false) {
  if (!force && (hudFrame++ & 3) !== 0) return;
  const e = EMP[current], w = weaponOf(e);
  hud.name.textContent = e.empty ? "Empty emplacement" : w.name;
  hud.slot.textContent = `${current + 1}`;
  tabs.forEach((b, i) => b.setAttribute("aria-pressed", String(i === current)));
  if (e.empty) {
    // M3: nothing to fire here yet.
    hud.reload.textContent = e.place ? `On ${e.place}` : "";
    hud.reloadFill.style.transform = "scaleX(0)";
    hud.target.textContent = "B or a click: buy a gun for it";
    hud.extra.textContent = "";
    hud.reticle.hidden = true;
    return;
  }
  const r = rl(current);
  hud.reload.textContent = r > 0 ? `Reloading ${(r / 60).toFixed(1)} s` : "Ready";
  hud.reloadFill.style.transform = `scaleX(${1 - r / w.reload})`;
  weaponPanel.classList.toggle("loaded", r === 0);
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
  hud.minions.textContent = isMatch() ? "" : `${stats.down} down, ${stats.standing} standing`;
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
/** Start (or restart) a mode: the worker builds a fresh world for it. Online, `net` says which castle is yours and the host's seed. */
function startMode(m: Mode, net?: OnlineStart) {
  const first = mode === null;
  if (mode === "online" && m !== "online") void online.leave();
  mode = m;
  ME = m === "online" && net ? net.team : 1;
  FOE = ME === 1 ? 0 : 1;
  BASE = ME === 1 ? 0 : SLOTS;
  friendName = net?.friend ?? "";
  $("menu").hidden = true;
  $("choices").hidden = false;
  $("online").hidden = true;
  $("gone").hidden = true;
  document.body.classList.remove("title-screen");
  $("end").hidden = true;
  $("mode-name").textContent = m === "versus" ? `Versus AI: ${AI_LEVELS[difficulty].name}` : m === "online" ? `Against ${friendName}` : "Practice range";
  const match = m === "versus" || m === "online";
  $("matchbar").hidden = !match;
  $("netline").hidden = m !== "online";
  $("more").hidden = m !== "practice";
  // Online, a restart would leave the friend's page behind: a new match goes through the lobby.
  $("reset").hidden = m === "online";
  $("reset").textContent = match ? "Restart the match" : "Rebuild the castles";
  $("menu-back").hidden = false;
  matchInfo = null;
  endShownFor = -1;
  clearTimeout(endTimer);
  bridgesOpen = layout.bridges.map(() => true);
  updateBridges();
  view = "sight";
  ready = false;
  if (rendererReady) $("loading").hidden = false;
  const setup: MatchSetup = m === "versus" ? { difficulty } : m === "online" && net ? { team: net.team, delay: net.delay } : {};
  const seed = m === "online" && net ? net.seed : SEED;
  if (first) send({ t: "init", mode: m, seed, minions: MINIONS, setup });
  else {
    resetLocal();
    send({ t: "reset", mode: m, seed, minions: MINIONS, setup });
  }
  // M3: a match starts with its emplacements as built (empty slots empty); your guns are your castle's eight.
  MATCH_EMPLACEMENTS.forEach((e, i) => Object.assign(ALL_EMP[i], e, { upgrade: undefined }));
  EMP = match ? ALL_EMP.slice(BASE, BASE + SLOTS) : ASHWRIGHT_EMPLACEMENTS;
  if (current >= EMP.length || EMP[current].empty) current = 0;
  aims.forEach((_, i) => {
    if (i >= EMP.length) return;
    aims[i] = restAim(EMP[i], weaponOf(EMP[i]));
    wanted[i] = { ...aims[i] };
  });
  renderer.setArms(ALL_EMP);
  renderer.setSide(ME);
  buildTabs();
  estate.reset(m, ME);
  renderer.showEmplacements(match ? ALL_EMP.length : EMP.length);
  renderer.setMarkers(match);
  prevGate = null;
  matchLog = [];
  malletAct.clear();
  lastEnemyMasonNote = lastGoldNote = -1e9;
  $("storm").hidden = true;
  $("sudden").hidden = true;
  $("clock").classList.remove("sudden");
  surrenderBtn.hidden = true;
  sound.setStorm(0, 0);
  if (match) {
    send({ t: "input", input: { kind: "man", emplacement: gid(current) } });
    const how = "Every barracks sends a wave every 25 seconds, some with ladders. B: build on your plots and buy guns for your empty emplacements; gold comes from your keep, mills, every enemy and every stone you bring down, and pays your masons. Ctrl+1, 2, 3: advance, hold, push the breach. L: your route. Alt+1 to 4: repairs.";
    if (m === "online") showNote(`You hold the ${ME === 1 ? "oxblood" : "green"} castle against ${friendName}. Topple their keep or storm their courtyard. ${how}`, 12000);
    else showNote(`Topple the enemy keep or storm its courtyard. The ${AI_LEVELS[difficulty].name} commands the enemy: it builds, aims and repairs by the same rules as you. ${how}`, 12000);
  }
  if (m === "online") online.onGone = () => offerTakeover();
}

/** Online: the friend has gone (or gone quiet for long): keep playing against the AI, or leave. */
function offerTakeover() {
  if (mode !== "online" || matchInfo?.result) return;
  $("gone-line").textContent = `${friendName} has left the match, or their connection dropped.`;
  $("gone").hidden = false;
  document.exitPointerLock?.();
}
$("gone-ai").addEventListener("click", () => {
  $("gone").hidden = true;
  send({ t: "takeover", difficulty: "knight" });
  void online.leave();
  showNote(`The Knight takes ${friendName}'s castle from here.`, 5000);
  $("netline").hidden = true;
});
$("gone-menu").addEventListener("click", () => {
  $("gone").hidden = true;
  void online.leave();
  $("menu").hidden = false;
});

/**
 * M3: what each emplacement holds, as the worker reported it: a gun bought
 * for an empty slot gets its aim and zoom, the tabs and the gun models follow.
 */
function syncArms(arms: Int8Array) {
  let changed = false;
  for (let i = 0; i < ALL_EMP.length && i * 2 + 1 < arms.length; i++) {
    const e = ALL_EMP[i];
    const w = arms[i * 2], u = arms[i * 2 + 1];
    const kind = w >= 0 ? WEAPON_KINDS[w] : e.weapon;
    const upgrade = u >= 0 ? UPGRADE_KINDS[u] : undefined;
    const empty = w < 0;
    if (e.empty === empty && e.weapon === kind && e.upgrade === upgrade) continue;
    const bought = !!e.empty && !empty;
    e.empty = empty;
    e.weapon = kind;
    e.upgrade = upgrade;
    e.barrel = BARREL[kind];
    changed = true;
    const slot = i - BASE;
    if (slot >= 0 && slot < SLOTS && bought) {
      const wd = weaponOf(e);
      aims[slot] = restAim(e, wd);
      wanted[slot] = { ...aims[slot] };
      fov[slot] = wd.fov[1] * 0.8;
      shotCam[slot] = kind === "mortar";
      reload[i] = 0;
    }
  }
  if (!changed) return;
  renderer.setArms(ALL_EMP);
  buildTabs();
  updateHud(true);
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
    sound.ui("click");
    startMode(b.dataset.mode === "versus" ? "versus" : "practice");
  }),
);
// M5: Versus AI's three difficulties (the card starts a match at the one picked).
const levelBtns = [...document.querySelectorAll<HTMLButtonElement>("[data-level]")];
function showLevels() {
  levelBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.level === difficulty)));
  $("level-blurb").textContent = AI_LEVELS[difficulty].blurb;
}
levelBtns.forEach((b) =>
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    b.blur();
    difficulty = b.dataset.level as Difficulty;
    try {
      localStorage.setItem("keepfall.difficulty", difficulty);
    } catch {}
    sound.ui("click");
    showLevels();
  }),
);
showLevels();
$("versus-go").addEventListener("click", () => {
  sound.ui("click");
  startMode("versus");
});
// M5: Play a friend: the lobby.
const online = new Online(
  {
    panel: $("online"),
    status: $("online-status"),
    list: $("online-list"),
    hostBtn: $<HTMLButtonElement>("online-host"),
    wait: $("online-wait"),
    code: $("online-code"),
    cancel: $<HTMLButtonElement>("online-cancel"),
    line: $("netline"),
  },
  send,
  (st) => {
    sound.ui("click");
    startMode("online", st);
  },
  (text, ms) => showNote(text, ms),
);
$("online-go").addEventListener("click", () => {
  $<HTMLButtonElement>("online-go").blur();
  sound.ui("click");
  $("choices").hidden = true;
  void online.open();
});
$("online-back").addEventListener("click", () => {
  $<HTMLButtonElement>("online-back").blur();
  void online.leave();
  $("online").hidden = true;
  $("choices").hidden = false;
});
$("menu-btn").addEventListener("click", () => {
  $("menu").hidden = false;
  $("choices").hidden = false;
  $("online").hidden = true;
  surrenderBtn.hidden = !isMatch() || !!matchInfo?.result;
  $<HTMLButtonElement>("menu-btn").blur();
  document.exitPointerLock?.();
});
$("menu-back").addEventListener("click", () => ($("menu").hidden = true));
$("end-again").addEventListener("click", () => {
  if (mode !== "online") {
    startMode("versus");
    return;
  }
  // Online, another match goes through the lobby (both pages start it together).
  void online.leave();
  $("end").hidden = true;
  $("menu").hidden = false;
  $("choices").hidden = true;
  void online.open();
});
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
const repairChips = [...document.querySelectorAll<HTMLButtonElement>("[data-repair]")];
repairChips.forEach((b) =>
  b.addEventListener("click", () => {
    toggleRepair(b.dataset.repair as RepairKind);
    b.blur();
  }),
);

/** Switch your masons on or off for one kind of section (Alt+1 to 4). */
function toggleRepair(kind: RepairKind, on?: boolean) {
  if (!isMatch() || !matchInfo || matchInfo.result) return;
  const now = on ?? !matchInfo.repairs[kind];
  send({ t: "input", input: { kind: "repair", repair: kind, on: now } });
  matchInfo.repairs = { ...matchInfo.repairs, [kind]: now };
  updateRepairs();
  const names: Record<RepairKind, string> = { gate: "the gate", walls: "the walls", towers: "the towers", keep: "the keep" };
  showNote(now ? `Your masons repair ${names[kind]}.` : `Your masons leave ${names[kind]} alone.`, 2400);
}

/** Give up the match (a second press within a few seconds confirms). */
let surrenderArmed = 0;
const surrenderBtn = $<HTMLButtonElement>("menu-surrender");
surrenderBtn.addEventListener("click", () => {
  if (!isMatch() || !matchInfo || matchInfo.result) return;
  const now = performance.now();
  if (now - surrenderArmed > 3500) {
    surrenderArmed = now;
    surrenderBtn.textContent = "Press again to surrender";
    surrenderBtn.classList.add("confirm");
    setTimeout(() => {
      if (performance.now() - surrenderArmed >= 3400) {
        surrenderBtn.textContent = "Surrender";
        surrenderBtn.classList.remove("confirm");
      }
    }, 3600);
    return;
  }
  surrenderArmed = 0;
  surrenderBtn.textContent = "Surrender";
  surrenderBtn.classList.remove("confirm");
  send({ t: "input", input: { kind: "surrender" } });
  $("menu").hidden = true;
});
orderChips.forEach((b) =>
  b.addEventListener("click", () => {
    giveOrder(Number(b.dataset.order));
    b.blur();
  }),
);

/** The match bar's waves line: the next wave, your route and order, and both sides' pikemen. */
function updateWaves() {
  const info = matchInfo;
  if (!info) return;
  const s = Math.ceil(info.nextWave / 60);
  $("next-wave").textContent = info.result ? "" : info.waves[ME] === 0 ? `First waves in ${s} s` : `Next waves in ${s} s`;
  routeChips.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.route === info.route)));
  orderChips.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.order) === info.order)));
  $("army-count").textContent = `Pikemen ${info.standing[ME]} (${info.fallen[ME]} down), enemy ${info.standing[FOE]} (${info.fallen[FOE]} down)`;
}

function clockText(ticks: number): string {
  const s = Math.floor(ticks / 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Gate state as last shown, for notes when it changes. */
let prevGate: { hits: [number, number]; open: [boolean, boolean] } | null = null;

/** Note a moment for the end screen's log (and maybe show it). */
function logMoment(text: string, bad = false, tick = matchInfo?.tick ?? 0) {
  matchLog.push({ tick, text, bad });
  if (matchLog.length > 60) matchLog.shift();
}

/** What the masons are doing, in words (hold is the sim's WorksHold). */
function masonText(m: MasonInfo, own: boolean): string {
  if (!m.up) return own ? "Masons: all down, more on the way" : "";
  if (!m.job) return own ? `Masons: ${m.up} in the yard, nothing to repair` : "";
  const what = `${m.job} (${m.left} ${m.left === 1 ? "piece" : "pieces"} down)`;
  switch (m.hold) {
    case 1:
      return `Masons wait for gold: ${what}`;
    case 2:
      return `Masons wait for the way to clear: ${what}`;
    case 3:
      return `Masons driven off ${m.job} by the enemy`;
    default:
      return `Masons rebuilding ${what}`;
  }
}

function updateRepairs() {
  const info = matchInfo;
  if (!info) return;
  repairChips.forEach((b) => {
    const on = info.repairs[b.dataset.repair as RepairKind] !== false;
    b.setAttribute("aria-pressed", String(on));
    b.classList.toggle("off", !on);
  });
  const el = $("masons");
  el.textContent = masonText(info.masons[ME], true);
  el.classList.toggle("wait", info.masons[ME].hold === 1 || info.masons[ME].hold === 3);
}

/** The storm meter: whoever is storming a courtyard now, how many against how many, how long they have held it. */
function updateStorm() {
  const info = matchInfo;
  const box = $("storm");
  if (!info || info.result) {
    box.hidden = true;
    sound.setStorm(0, 0);
    if (!info) for (const c of [0, 1]) renderer.setStorm(c, 0, false);
    return;
  }
  // storm[c] is how long the enemy of castle c has held its courtyard: ours is the storm of the enemy castle.
  const ours = info.storm[FOE] / info.stormHold, theirs = info.storm[ME] / info.stormHold;
  sound.setStorm(ours, theirs);
  for (const c of [0, 1]) renderer.setStorm(c, info.storm[c] / info.stormHold, info.attackers[c] > info.defenders[c] && info.attackers[c] >= 2);
  if (!info.storm[0] && !info.storm[1]) {
    box.hidden = true;
    return;
  }
  // The one nearer to winning shows.
  const mine = info.storm[FOE] >= info.storm[ME];
  const c = mine ? FOE : ME;
  const held = Math.floor(info.storm[c] / 60), of = Math.round(info.stormHold / 60);
  const a = info.attackers[c], d = info.defenders[c];
  const holding = a > d && a >= 2;
  box.hidden = false;
  box.classList.toggle("ours", mine);
  box.classList.toggle("theirs", !mine);
  $("storm-title").textContent = mine ? (holding ? "Storming the enemy courtyard" : "Your storm is held up") : holding ? "Your courtyard is being stormed" : "The enemy storm is held up";
  $("storm-count").textContent = `${a} against ${d}, ${held} of ${of} s`;
  $("storm-fill").style.transform = `scaleX(${Math.min(1, info.storm[c] / info.stormHold)})`;
}

function onMatch(info: MatchInfo) {
  const prev = matchInfo;
  matchInfo = { ...info, masonry: info.masonry ?? prev?.masonry ?? null, stats: info.stats ?? prev?.stats ?? null, down: info.down ?? prev?.down ?? null };
  updateWaves();
  updateRepairs();
  updateStorm();
  if (!info.result) {
    const was = prevGate;
    if (was) {
      if (!was.open[ME] && info.gateOpen[ME]) {
        showNote("Your gate is down: enemy pikemen can get into your courtyard.", 5000);
        logMoment("Your gate was broken down", true);
      } else if (!was.open[FOE] && info.gateOpen[FOE]) {
        showNote("The enemy gate is down.", 4000);
        logMoment("The enemy gate was broken down");
      } else if (was.hits[ME] === 0 && info.gateHits[ME] > 0) showNote("Enemy pikemen are battering your gate.", 4000);
      else if (was.open[ME] && !info.gateOpen[ME]) {
        showNote("Your masons have the gate back on its hinges.", 4000);
        logMoment("Your masons rehung your gate");
      } else if (was.open[FOE] && !info.gateOpen[FOE]) {
        showNote("Enemy masons have rehung their gate.", 4000);
        logMoment("The enemy rehung its gate", true);
      }
    }
    prevGate = { hits: [info.gateHits[0], info.gateHits[1]], open: [info.gateOpen[0], info.gateOpen[1]] };
    if (prev) momentsOf(prev, info);
  }
  $("clock").textContent = clockText(info.result ? info.result.tick : info.tick);
  $("clock").classList.toggle("sudden", info.suddenDeath);
  $("sudden").hidden = !info.suddenDeath || !!info.result;
  $("gold").textContent = `${info.gold[ME]} gold`;
  // M3: the rate it comes in, what was earned since, the guns as built and bought.
  $("gold-rate").textContent = `+${info.income[ME].toFixed(1)}/s`;
  syncArms(info.arms);
  estate.onMatch(info, EMP[current] ?? null, current);
  const r = info.result;
  $("match-note").textContent = r ? endLine(r).short : "Topple the enemy keep or storm its courtyard";
  // The end screen a moment after the end, so the collapse (or the storm) can be seen.
  if (r && endShownFor !== r.tick) {
    endShownFor = r.tick;
    clearTimeout(endTimer);
    if (r.reason === "keep" || r.reason === "storm") sound.matchEnd(r.winner === ME);
    endTimer = setTimeout(showEnd, FIXED ? 0 : r.reason === "surrender" ? 300 : 2600);
  }
}

/** Notes, the log and sounds for what changed since the last report. */
function momentsOf(prev: MatchInfo, info: MatchInfo) {
  // Ladders up against a wall.
  if (info.ladders[ME] > prev.ladders[ME]) {
    showNote("A ladder is up against your wall: the enemy is climbing in. Your guns cannot reach the foot of your own wall; the garrison fights them inside.", 6500);
    logMoment("The enemy raised a ladder against your wall", true);
  }
  if (info.ladders[FOE] > prev.ladders[FOE]) {
    showNote("Your ladder is up against the enemy wall: your men are climbing.", 4500);
    logMoment("Your crew raised a ladder against the enemy wall");
  }
  // Storms begun and beaten off.
  if (!prev.storm[FOE] && info.storm[FOE]) {
    showNote("Your men are storming the enemy courtyard: hold it for 20 seconds with more men inside than its defenders.", 6000);
    logMoment("Your men began to storm the enemy courtyard");
    sound.horn(true);
  } else if (prev.storm[FOE] && !info.storm[FOE]) {
    showNote("Your storm was beaten off.", 3500);
    logMoment("The enemy beat your storm off", true);
  }
  if (!prev.storm[ME] && info.storm[ME]) {
    showNote("The enemy is storming your courtyard! Your next wave musters inside to defend it.", 6000);
    logMoment("The enemy began to storm your courtyard", true);
    sound.horn(false);
  } else if (prev.storm[ME] && !info.storm[ME]) {
    showNote("Your courtyard is clear: the storm is beaten off.", 4000);
    logMoment("You beat the enemy's storm off");
  }
  // The garrisons.
  if (prev.garrison[ME] > 0 && info.garrison[ME] === 0) logMoment("Your garrison fell", true);
  if (prev.garrison[FOE] > 0 && info.garrison[FOE] === 0) logMoment("The enemy garrison fell");
  // Masons starting on damage.
  const mine = info.masons[ME], theirs = info.masons[FOE];
  if (mine.job && !prev.masons[ME].job) logMoment(`Your masons began rebuilding ${mine.job}`);
  if (theirs.job && !prev.masons[FOE].job) {
    if (info.tick - lastEnemyMasonNote > 40 * 60) {
      lastEnemyMasonNote = info.tick;
      showNote(`Enemy masons are rebuilding ${theirs.job}: shoot them to keep it open.`, 5000);
    }
    logMoment(`Enemy masons began rebuilding ${theirs.job}`, true);
  }
  if (mine.up && mine.hold === 1 && prev.masons[ME].hold !== 1 && info.tick - lastGoldNote > 30 * 60) {
    lastGoldNote = info.tick;
    showNote("Your masons are waiting for gold.", 3500);
  }
  if (info.suddenDeath && !prev.suddenDeath) {
    showNote("Sudden death: income doubles and every gun reloads faster.", 6000);
    logMoment("Sudden death");
    sound.suddenDeath();
  }
}
let lastEnemyMasonNote = -1e9;
let lastGoldNote = -1e9;

/** M3: trick shots as the end screen says them (ricochet, collapse, multi-kill, keep hit counts). */
function trickText(t: number[]): string {
  const names = ["ricochet", "collapse", "multi-kill", "keep hit"];
  const parts = names.map((k, i) => [k, t[i] ?? 0] as const).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}${n > 1 ? "s" : ""}`);
  return parts.length ? parts.join(", ") : "none";
}

/** How a match ended, in a few words and in a sentence. */
function endLine(r: NonNullable<MatchInfo["result"]>): { short: string; long: string } {
  if (r.winner === -1) return { short: "A draw", long: r.reason === "storm" ? "Both courtyards fell together." : "Both banners came down together." };
  const won = r.winner === ME;
  if (r.reason === "surrender") return won ? { short: "The enemy surrendered", long: mode === "online" ? `${friendName} surrendered.` : "The enemy surrendered." } : { short: "You surrendered", long: "You gave up the match." };
  if (r.reason === "storm") return won ? { short: "The enemy courtyard is yours", long: "Your men held the enemy courtyard." } : { short: "Your courtyard has fallen", long: "The enemy held your courtyard." };
  return won ? { short: "The enemy keep has fallen", long: "The enemy keep's banner is on the ground." } : { short: "Your keep has fallen", long: "Your keep's banner is on the ground." };
}

function showEnd() {
  const info = matchInfo;
  if (!info || !info.result || !isMatch()) return;
  const r = info.result;
  $("end-title").textContent = r.winner === ME ? "Victory" : r.winner === FOE ? "Defeat" : "Draw";
  $("end-them").textContent = mode === "online" ? friendName : "Enemy";
  $("end-again").textContent = mode === "online" ? "Back to the lobby" : "Play again";
  $("end-line").textContent = `${endLine(r).long} ${clockText(r.tick)} on the clock.`;
  const mas = info.masonry ?? info.down;
  const st = info.stats;
  const [a, b] = [ME, FOE];
  const rows: Array<[string, string | number, string | number]> = [
    ["Masonry lost", mas ? mas[a] : "", mas ? mas[b] : ""],
    ["Stones rebuilt", st ? st[a].stonesRebuilt : "", st ? st[b].stonesRebuilt : ""],
    ["Gold earned", st ? st[a].goldEarned : "", st ? st[b].goldEarned : ""],
    ["Gold spent", st ? st[a].goldSpent : "", st ? st[b].goldSpent : ""],
    // M3: trick shots by kind.
    ["Trick shots", trickText(info.tricks[a]), trickText(info.tricks[b])],
    ["Men lost", info.fallen[a], info.fallen[b]],
    ["Waves sent", info.waves[a], info.waves[b]],
    ["Ladders raised", st ? st[a].laddersRaised : "", st ? st[b].laddersRaised : ""],
    ["Storms begun", st ? st[a].stormsBegun : "", st ? st[b].stormsBegun : ""],
    ["Shots fired", info.shots[a], info.shots[b]],
  ];
  const table = $("end-table");
  table.textContent = "";
  for (const [label, you, them] of rows) {
    const tr = document.createElement("tr");
    for (const v of [label, you, them]) {
      const td = document.createElement("td");
      td.textContent = String(v);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  const log = $("end-log");
  log.textContent = "";
  log.hidden = matchLog.length === 0;
  for (const m of matchLog) {
    const li = document.createElement("li");
    if (m.bad) li.className = "bad";
    const b = document.createElement("b");
    b.textContent = clockText(m.tick);
    li.append(b, m.text);
    log.appendChild(li);
  }
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
// M3: in the overview, a click (not a drag) on one of your plots opens the build wheel on it.
let downAtPx: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  downAtPx = view === "overview" ? { x: e.clientX, y: e.clientY } : null;
});
canvas.addEventListener("pointerup", (e) => {
  const d = downAtPx;
  downAtPx = null;
  if (!d || view !== "overview" || !isMatch() || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
  const p = renderer.pick(e.clientX, e.clientY);
  const plot = p ? estate.plotAt(p.x, p.z) : -1;
  if (plot >= 0) estate.openPlot(plot);
});
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
  if (isMatch()) man(view === "sight" ? current : -1, view === "sight" ? -1 : current);
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
  // M3: while the build wheel is open, numbers, Backspace and Esc are its own; B opens and closes it.
  const wheelKeys = estate.keys(p, isMatch());
  if (!wheelKeys && p.weapon >= 0) select(p.weapon);
  if (p.next) step(1);
  if (p.prev) step(-1);
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
  if (p.repair >= 0) toggleRepair(REPAIR_KINDS[p.repair]);
  if (p.spin && EMP[current].weapon === "longGun") spin = ((spin + 1) % 5) as Spin;
  const w = weaponOf(EMP[current]);
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
  } else if (p.fire && view === "sight" && !estate.wheelOpen) fire();

  applyMouse();
  aimAcc += dt;
  while (aimAcc >= 1 / 60) {
    aimTick();
    aimAcc -= 1 / 60;
  }
  sendAim(now);
  soundscape.gun(EMP[current].weapon, aims[current].yaw, aims[current].pitch, WEAPONS[EMP[current].weapon].yawRate, dt, view === "sight" && !ride && mode !== null);
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
  if (!testCamera && (pose.mode === "sight" || (pose.mode === "free" && !ride))) pose.fov = shownFov;
  applyShake(pose, now);
  renderer.setCamera(pose);
  updateAimHelp();
  updateHud();
  placeWanted();
  if (!paused) renderer.render(dt);
  estate.update(now);
  sound.update(renderer.listener(), dt, { wind: Math.hypot(wind.x, wind.z), awake: stats.awake, slow: timeScale });
  soundscape.update(dt, renderer.listener());
  calibrate(dt);
  pace(dt, now);
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  paused = document.hidden;
  send({ t: "pause", paused });
  sound.setPaused(paused);
  // Online, the friend's match waits for this page while it is hidden: say so.
  if (mode === "online") online.setPaused(paused);
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
    renderer.onSplash = (x, y, z, size) => sound.splash(x, y, z, size);
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
  renderer.showEmplacements(isMatch() ? ALL_EMP.length : EMP.length);
  renderer.setMarkers(isMatch());
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
else {
  view = "overview";
  document.body.classList.add("title-screen");
}

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
  /** M3: send a match input as the player (the screenshot tools build and buy with it). */
  input(i: unknown) {
    send({ t: "input", input: i as never });
  },
  /** M3: the build wheel. */
  wheel(open: boolean, target = -1) {
    if (open) estate.wheel.open(target);
    else estate.wheel.close();
  },
  toggleNav,
  giveOrder,
  setRoute,
  toggleRepair,
  get matchLog() {
    return matchLog.slice();
  },
  /** Upright figures [id, x, y, z, yaw, phase, team, action, act, unit] and ladders [id, team, state, foot xyz, top xyz, t] of the last frame drawn. */
  get frame() {
    const f = lastApplied;
    return f ? { tick: f.tick, minions: Array.from(f.minions), ladders: Array.from(f.ladders), works: Array.from(f.works) } : null;
  },
  surrender() {
    send({ t: "input", input: { kind: "surrender" } });
  },
  /** Test tools only: a wave of pikemen at a point. */
  spawn(team: 0 | 1, count: number, x: number, z: number, ladder = false) {
    send({ t: "spawn", team, count, x, z, ladder });
  },
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
    aims[emp] = clampAim({ yaw, pitch }, EMP[emp], weaponOf(EMP[emp]));
    wanted[emp] = { ...aims[emp] };
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
