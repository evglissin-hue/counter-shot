// The game page: a start menu, the Practice range (ride the four Ashwright
// weapons against the target castle) and a match against the AI castle.
// Aiming runs here at a fixed 60 Hz through the same limiter the sim checks;
// a fire sends the exact aim to the worker, which owns everything else.

import {
  AI_LEVELS,
  ASHWRIGHT_EMPLACEMENTS,
  ASHWRIGHT_SLOTS,
  BARREL,
  CASTLE_SHAPE,
  DIFFICULTIES,
  DIST,
  type Difficulty,
  buildLayout,
  GAME_LAYOUT,
  KEEP_STOREYS,
  MATCH_EMPLACEMENTS,
  REMOUNT,
  REPAIR_KINDS,
  repairSections,
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
import { Guide } from "./guide";
import { Coach } from "./coach";
import { GUN_STRIDE, Gun, Minimap, type MinimapState } from "./minimap";
import {
  aimDir,
  castleHeightAt,
  clampAim,
  clearOfCastle,
  EVENT_STRIDE,
  EventKind,
  flightCoef,
  G,
  muzzle,
  Order,
  predictPath,
  PROJECTILE_STRIDE,
  ProjectileKind,
  mountPieces,
  restAim,
  solveAim,
  Spin,
  spinVector,
  stepAim,
  MINION_STRIDE,
  type AimState,
  type FrameData,
} from "@keepfall/sim";
import { Input } from "./input";
import { Feats, bestText, type FeatDef } from "./feats";
import { Moments } from "./moments";
import type { FromWorker, MasonInfo, MatchInfo, MatchSetup, Mode, ToWorker } from "./protocol";
import { Online, type OnlineStart } from "./online";
import type { CameraPose, PathHit, QualityTier } from "./render/api";
import { GameRenderer } from "./render/GameRenderer";
import { LAY_SECONDS } from "./render/works";
import { Sound } from "./sound";
import { Soundscape } from "./soundscape";
import { Pacer, SCALES } from "./pacing";
import { Timeline } from "./timeline";
import { ThreatStrip } from "./threat";
import { OverviewMarks } from "./overviewMarks";

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
/** The minimap: both castles and both armies at a glance (the owner's ask: less reading, more seeing). */
const minimap = new Minimap($<HTMLCanvasElement>("minimap"));
/** M6: the threat strip over the minimap, and the group marks in the overview. */
const threat = new ThreatStrip($("threat"));
const groupMarks = new OverviewMarks($("ovmarks"));
/** The castles' sections as the worker last counted them (twice a second). */
let sectionShares: Uint8Array | null = null;
let mapFrame = 0;
/** The first-match guide: a checklist beside the field that ticks itself off as you play. */
const guide = new Guide($("guide"), $("guide-goal"), $("guide-steps"), $<HTMLButtonElement>("guide-hide"), $("guide-title"));
/** M6: the guided match's coach (its card, highlights and world marks); it only reads what the page knows. */
const coach = new Coach(
  { project: (x, y, z) => renderer.project(x, y, z), size: () => ({ w: canvas.clientWidth, h: canvas.clientHeight }), note: (t, ms) => showNote(t, ms) },
  $,
);
guide.onMark = (s) => coach.did(s);
estate.onBuilt = () => noteBuilt();
/** Sim frames are applied on a render clock a little behind the sim, and shells and stones are drawn between them. */
const timeline = new Timeline(layout);
/** Track S1: what happened that was worth showing, and the player's book of feats (see moments.ts, feats.ts). */
const moments = new Moments({
  layout,
  clock: () => clock(),
  me: () => ME,
  gun: (emp) => {
    const e = ALL_EMP[emp];
    if (!e) return null;
    const slot = emp - BASE;
    return { team: slot >= 0 && slot < SLOTS ? ME : FOE, name: WEAPONS[e.weapon].name.toLowerCase(), x: e.x, y: e.y, z: e.z };
  },
});
const feats = new Feats({ me: 1, onFirsts: (list) => showFeatToast(list) });
moments.onMoment((m) => feats.observe(m));
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
/** The player's own mouse speed (Controls panel), a factor on MOUSE_RAD_PER_PX. */
let mouseSpeed = 1;
try {
  const v = Number(localStorage.getItem("keepfall.mouseSpeed"));
  if (v >= 0.4 && v <= 2.5) mouseSpeed = v;
} catch {}
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
const isMatch = () => mode === "versus" || mode === "online" || mode === "guided";
/** A gun slot's match id, and its reload in ticks. */
const gid = (i: number) => EMP[i]?.id ?? i;
const rl = (i: number) => reload[gid(i)] ?? 0;
const hashMode: Mode | null = location.hash.includes("guided") ? "guided" : location.hash.includes("versus") ? "versus" : location.hash.includes("practice") || FIXED ? "practice" : null;
// #versus=squire (or knight, warlord) picks the difficulty too.
for (const d of ["squire", "knight", "warlord"] as const) if (location.hash.includes(`versus=${d}`)) difficulty = d;
/** The match as the worker last reported it (Versus AI only). */
let matchInfo: MatchInfo | null = null;
/** Test only: fields laid over every match report (a test sets the tutor's stage, a storm, a result). */
let matchPatch: Partial<MatchInfo> | null = null;
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
/** After M5: every emplacement's gun as the worker last reported it: [state (0 up), ticks left] each (protocol's frame `out`). */
let gunOut: Int16Array = new Int16Array(0);
/** Is a slot's gun knocked out now? */
const isOut = (i: number) => (gunOut[gid(i) * 2] ?? 0) > 0 && !EMP[i]?.empty;
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

/**
 * The mortar's spotter (after M5; the owner found the top-down observer weird):
 * a view from over the keep, looking along the mortar's bearing as far out as
 * you look (look close and the spotter steps onto the front wall). The charge
 * sets the range: a ring slides along the ground to where the shell would come
 * down in still air while it goes in.
 */
const spot = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, primed: false };
/** How far along the ground each slot's spotter looks (m): mouse up or W looks farther. */
const lookD: number[] = ASHWRIGHT_SLOTS.map(() => 110);
/** The range the ring shows now (m), while the charge goes in. */
let chargeRange = 0;

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

/**
 * What your last shot did (after M5, for every shot you fire by hand; a
 * burst's only before): enemies knocked down from the moment a ball, chain or
 * grapeshot leaves the muzzle (a chain shot mows men before it first touches
 * anything) or a shell bursts, stones near where it came down that started
 * moving (or turned to dust), and enemy guns it knocked out; shown a moment
 * after it comes down. One shot's tally is open at a time: firing again shows
 * the open one, so nothing is counted twice.
 */
const everMoved = new Uint8Array(layout.stones.length);
interface Tally {
  /** The shot and the gun (its match id) that fired it. */
  shot: number;
  emp: number;
  until: number;
  stones: number;
  down0: number;
  guns: number;
  /** Where it came down, once it has (stones within r of it count). */
  x: number;
  y: number;
  z: number;
  r: number;
  landed: boolean;
}
let tally: Tally | null = null;
/** Your shells in flight (by hand): shot id -> the gun and where it was last seen (its burst opens its tally). */
const myShells = new Map<number, { emp: number; x: number; y: number; z: number }>();
/** Enemies down as of the frame before the one being applied: the other side's fallen in a match, everyone down on the Practice range. */
const foesDown = () => (isMatch() ? lastFoes : lastDown);
/** Open a shot's tally (the open one, if any, is shown first). */
function openTally(shot: number, emp: number, x: number, y: number, z: number, landed: boolean, ms: number, r: number) {
  if (tally) showTally();
  tally = { shot, emp, until: clock() + ms, stones: 0, down0: foesDown(), guns: 0, x, y, z, r, landed };
}
/** Minions down as of the frame before the one being applied (a burst's own knockdowns count for it). */
let lastDown = 0;
/** Minions down as of each frame not yet applied, by tick. */
const downAt = new Map<number, number>();
/** The same for the other side's fallen in a match (the match's info runs ahead of the frame being shown). */
let lastFoes = 0;
const foesAt = new Map<number, number>();
let rendererReady = false;
/** Where in a mason's stroke the mallet strikes (ticks since the stroke began; the renderer's swing matches). */
const MALLET_HIT = 14;
const malletAct = new Map<number, number>();
let laidSounds = 0, clearSounds = 0, cracks = 0;
/** The match as it went, for the end screen: a line per moment that mattered, with the clock. */
let matchLog: Array<{ tick: number; text: string; bad: boolean }> = [];

// ---- worker -------------------------------------------------------------------
/** The number of the world the page wants (startMode bumps it): messages from any other are an old world's, and dropped. */
let gen = 0;
worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  if (m.t !== "error" && m.gen !== gen) return;
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
    onGunsOut(m.out);
    // A shot sent but not fired in the match yet (online it waits out the input delay): the gun stays reloading, no "loaded" clack.
    if (firePending.size) {
      const now = performance.now();
      for (const [g, until] of firePending) {
        if (reload[g] > 0 || now > until) firePending.delete(g);
        else if (ALL_EMP[g]) reload[g] = weaponOf(ALL_EMP[g]).reload;
      }
    }
    soundscape.reload(EMP[current].weapon, rl(current), WEAPONS[EMP[current].weapon].reload, view === "sight" && mode !== null);
    if (was > 0 && rl(current) === 0) {
      sound.ready(EMP[current].weapon);
      flashLoaded();
    }
    stats = { stepMs: m.stepMs, stepPeak: m.stepPeak, down: m.down, standing: m.standing, awake: m.awake };
    downAt.set(m.frame.tick, m.down);
    if (m.match) foesAt.set(m.frame.tick, m.match.fallen[FOE]);
    timeline.push(m.frame);
    if (m.match) onMatch(matchPatch ? { ...m.match, ...matchPatch } : m.match);
    if (m.bridges) onBridges(m.bridges);
    if (m.sections) sectionShares = m.sections;
    if (m.nav) renderer.updateNav(m.nav.kind, m.nav.floor);
  }
};
worker.onerror = (e) => showError(e.message || "The simulation worker failed to start.");

function onFrame(f: FrameData) {
  const now = clock();
  moments.frame(f);
  wind = { x: f.windX, z: f.windZ };
  lastFrameTick = f.tick;
  coach.onFrame(f);
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
        guide.mark(e.weapon === "longGun" ? "fire" : e.weapon === "mortar" ? "mortar" : "others");
        recording.set(id, { emp: slot, pts: [] });
        if (e.weapon === "mortar") myShells.set(id, { emp, x: e.x, y: e.y, z: e.z });
        else openTally(id, emp, e.x, e.y, e.z, false, 6000, 9);
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
      // One of your shells bursting: what it does is tallied (others' bursts are not yours to count).
      for (const [id, p] of myShells) {
        if (Math.hypot(a - p.x, b - p.y, c - p.z) > 14) continue;
        myShells.delete(id);
        openTally(id, p.emp, a, b, c, true, 4200, d * 2.4);
        break;
      }
      sound.explosion(a, b, c, d, timeScale);
    } else if (kind === EventKind.Landed) {
      if (a >= 0 && a - BASE >= 0 && a - BASE < EMP.length) {
        landing[a - BASE] = { x: b, y: c, z: d }; // (an unmanned shot's is -(id + 1))
        // Your ball, chain or grapeshot came down: its tally closes a moment later, counting the stones around here.
        if (tally && !tally.landed && tally.emp === a) Object.assign(tally, { x: b, y: c, z: d, landed: true, until: clock() + 2600 });
      }
      soundscape.landed(b, c, d, ALL_EMP[a >= 0 ? a : -a - 1]?.weapon ?? null);
    } else if (kind === EventKind.Impact) {
      soundscape.impact(a, b, c, d, impacts++ < 3);
    } else if (kind === EventKind.Blood) {
      // The cries, falls and thuds of men struck are the soundscape's (frame).
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
    } else if (kind === EventKind.GunOut) {
      gunKnockedOut(a, b, c);
    } else if (kind === EventKind.GunBack) {
      gunBack(a);
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
  // Stones moving for the first time near your shot count towards its tally.
  for (let i = 0; i < f.stoneCount; i++) {
    const id = f.stones[i * 8] | 0;
    if (id >= 0 && id < everMoved.length && !everMoved[id]) {
      everMoved[id] = 1;
      const st = layout.stones[id];
      if (tally && tally.landed && Math.hypot(st.x - tally.x, st.y - tally.y, st.z - tally.z) < tally.r) tally.stones++;
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
    const shell = myShells.get(id);
    if (shell) {
      shell.x = x;
      shell.y = y;
      shell.z = z;
    }
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
  for (const id of myShells.keys()) if (!seen.has(id)) myShells.delete(id);
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
  lastFoes = foesAt.get(f.tick) ?? lastFoes;
  foesAt.delete(f.tick);
  soundscape.frame(f, ear);
  lastApplied = f;
  for (let k = 0; k < f.eventCount; k++) if (f.events[k * EVENT_STRIDE] === EventKind.Keg) groupMarks.kegSet(f.events[k * EVENT_STRIDE + 1] | 0);
  groupMarks.update(f.minions, f.minionCount, f.tick);
  renderer.applyFrame(f);
}
/** The last frame applied (the screenshot tools read figures and ladders from it). */
let lastApplied: FrameData | null = null;

function showTally() {
  if (!tally) return;
  const down = Math.max(0, foesDown() - tally.down0);
  const parts: string[] = [];
  if (tally.guns) parts.push(tally.guns === 1 ? "gun silenced" : `${tally.guns} guns silenced`);
  if (tally.stones) parts.push(`${tally.stones} ${tally.stones === 1 ? "stone" : "stones"} down`);
  if (down) parts.push(`${down} ${down === 1 ? "man" : "men"} down`);
  tally = null;
  if (!parts.length) return;
  parts[0] = parts[0][0].toUpperCase() + parts[0].slice(1);
  const el = $("tally");
  el.textContent = parts.join(", ");
  // One result at a time under the match bar: the tally takes the place of a trick shot's banner.
  $("trick").hidden = true;
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
  if (ride || !$("menu").hidden || !$("end").hidden) {
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
  let dPitch = ((keyVel.pitch + one(stickPitch) * ks) * w.pitchRate) / 60;
  if (e.weapon === "mortar" && !e.empty) {
    // After M5: up and down look farther or nearer along the bearing; the charge sets the elevation.
    lookD[current] = Math.min(LOOK_FAR, Math.max(LOOK_NEAR, lookD[current] * (1 - dPitch * 12)));
    dPitch = 0;
    if (charging && charging.slot === current && needle >= 0) wanted[current] = { yaw: wanted[current].yaw, pitch: mortarLay(e, needle, aims[current].yaw).pitch };
  }
  if (dYaw || dPitch) {
    guide.mark("aim");
    if (!input.locked) playedFree = true;
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
  if (input.mouseX || input.mouseY) guide.mark("aim");
  const e = EMP[current], w = weaponOf(e);
  const fine = input.down("ShiftLeft") || input.down("ShiftRight");
  const zoomK = fov[current] / w.fov[1]; // slower when zoomed in
  const k = MOUSE_RAD_PER_PX * mouseSpeed * zoomK * (fine ? 0.35 : 1);
  const t = wanted[current];
  // Mouse right turns the aim right (towards -X when facing +Z), i.e. lower yaw.
  if (e.weapon === "mortar") {
    // After M5: the mortar's spotter looks farther (mouse up) or nearer along the bearing; the charge sets the range.
    lookD[current] = Math.min(LOOK_FAR, Math.max(LOOK_NEAR, lookD[current] * (1 - input.mouseY * k * 2.5)));
    wanted[current] = clampAim({ yaw: t.yaw - input.mouseX * k, pitch: t.pitch }, e, w);
  } else wanted[current] = clampAim({ yaw: t.yaw - input.mouseX * k, pitch: t.pitch - input.mouseY * k }, e, w);
  input.mouseX = input.mouseY = 0;
}

function fire(charge = 1, pitch?: number) {
  if (!ready || userPause || rl(current) > 0 || matchInfo?.result) return;
  if (!input.locked) playedFree = true;
  const e = EMP[current];
  if (e.empty) {
    estate.openFor(current);
    return;
  }
  if (isOut(current)) {
    showNote(`${outShort(current)}: Q or E for another gun`, 3200);
    return;
  }
  const a = aims[current];
  if (pitch !== undefined) aims[current] = { yaw: a.yaw, pitch };
  send({ t: "input", input: { kind: "fire", emplacement: gid(current), yaw: a.yaw, pitch: pitch ?? a.pitch, charge, fuse: fuseTicks, spin: e.weapon === "longGun" ? spin : Spin.None } });
  reload[gid(current)] = weaponOf(e).reload; // until the worker confirms
  if (isMatch()) firePending.set(gid(current), performance.now() + 1500);
}

/**
 * The mortar's charge. The playtest pass (the owner's ask: aiming it should
 * take a knack) made it a needle that swings from empty to full and back while
 * fire is held, the shell flying when you let go; after M5 (the owner: no top
 * view, show where it lands on the ground as the meter fills, but not too
 * easily) the charge sets the range: the needle sweeps from the nearest range
 * to the farthest at an even pace and back, the elevation following it, and a
 * ring slides along the ground to where the shell would come down in still
 * air (the wind is yours to read; the shell still scatters).
 */
const CHARGE_SWEEP = 1.8;
let charging: { start: number; slot: number; ticks: number } | null = null;
/** The needle (0 to 1) now, while charging (else -1), and where it was let go last, per slot. */
let needle = -1;
const lastNeedle: number[] = ASHWRIGHT_SLOTS.map(() => -1);
let firedAt = { needle: -1, range: 0, until: 0 };
function needleAt(now: number): number {
  if (!charging) return -1;
  const u = (now - charging.start) / 1000 / CHARGE_SWEEP;
  const k = u - 2 * Math.floor(u / 2);
  return k <= 1 ? k : 2 - k;
}
function cancelCharge() {
  charging = null;
  needle = -1;
}
/** Let go of the charge: the shell flies at the elevation and charge the needle gives now. */
function releaseCharge(now: number) {
  const n = needleAt(now);
  cancelCharge();
  const e = EMP[current];
  if (n < 0 || !canFire() || e.weapon !== "mortar") return;
  const lay = mortarLay(e, n, aims[current].yaw);
  lastNeedle[current] = n;
  firedAt = { needle: n, range: lay.range, until: now + 1400 };
  wanted[current] = { yaw: wanted[current].yaw, pitch: lay.pitch };
  fire(lay.charge, lay.pitch);
}
/** The mortar's barrel along the meter: steep and light at its start, the long lob (about its longest reach) at full charge. */
const LOB_LONG = 0.84;
/** The soft ring's radius with the standard aim help (m): about where it comes down, not a bullseye. */
const RING_SOFT = 3.2;
interface RangeTable {
  pitch: Float32Array;
  charge: Float32Array;
  range: Float32Array;
}
const rangeTables = new Map<string, RangeTable>();

/** A mortar as armed, along its meter: the elevation and charge, and the still-air range each gives on level ground. */
function rangeTable(e: Emplacement): RangeTable {
  const w = weaponOf(e);
  const key = `${w.speed}/${w.minSpeed}/${w.minPitch}/${w.maxPitch}/${w.projectile.gravity}`;
  const hit = rangeTables.get(key);
  if (hit) return hit;
  const N = 96;
  const t: RangeTable = { pitch: new Float32Array(N + 1), charge: new Float32Array(N + 1), range: new Float32Array(N + 1) };
  const coef = flightCoef(w.projectile);
  const lo = Math.max(w.minPitch, LOB_LONG);
  const at = { ...e, x: 0, z: 0 };
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    const pitch = w.maxPitch + (lo - w.maxPitch) * p;
    const speed = w.minSpeed + (w.speed - w.minSpeed) * p;
    const d = aimDir(0, pitch);
    const path = predictPath(muzzle(at, 0, pitch), [d[0] * speed, d[1] * speed, d[2] * speed], null, 0, 0, coef, 12, 1);
    const n = path.length;
    t.pitch[i] = pitch;
    t.charge[i] = p;
    t.range[i] = Math.max(i ? t.range[i - 1] + 0.001 : 0, Math.hypot(path[n - 3], path[n - 1]));
  }
  rangeTables.set(key, t);
  return t;
}

/**
 * The nearest still-air range on this bearing (m) whose shell clears your own
 * castle on the way and comes down clear of it (outside its courtyard, and its
 * burst's reach from its masonry): where the meter starts. From the bottom of
 * the table a shell fired off to the side came down on your own front towers,
 * so a tap of fire shelled your own castle. The same flight and height model
 * the guns nobody mans use (sim gunnery.ts); cached per bearing.
 */
const nearCache = new Map<string, number>();
function nearestClear(e: Emplacement, yaw: number): number {
  const t = rangeTable(e), N = t.range.length - 1;
  const w = weaponOf(e);
  const key = `${e.x}/${e.z}/${w.speed}/${w.minSpeed}/${Math.round(yaw * 200)}`;
  const hit = nearCache.get(key);
  if (hit !== undefined) return hit;
  const castle = e.z < -DIST / 2 ? 1 : 0;
  const S = CASTLE_SHAPE, cz = castle === 0 ? 0 : -DIST;
  const [fx, , fz] = aimDir(yaw, 0);
  const reach = (w.burst ? w.burst.radius : 0) + 0.5, diag = reach * 0.7071;
  const ring = [reach, 0, -reach, 0, 0, reach, 0, -reach, diag, diag, diag, -diag, -diag, diag, -diag, -diag];
  let near = t.range[0];
  for (let i = 0; i < N; i++) {
    const R = t.range[i], x = e.x + fx * R, z = e.z + fz * R;
    if (Math.abs(x) < S.half && Math.abs(z - cz) < S.half) continue; // in its own courtyard
    let clear = castleHeightAt(castle, x, z) === 0;
    for (let k = 0; clear && k < ring.length; k += 2) clear = castleHeightAt(castle, x + ring[k], z + ring[k + 1]) === 0;
    if (!clear || !clearOfCastle(e, yaw, t.pitch[i], t.charge[i], castle, x, z)) continue;
    near = R;
    break;
  }
  nearCache.set(key, near);
  return near;
}

/** The elevation and charge that put a shell `m` (0..1) of the way from the nearest clear range on this bearing to the farthest (still air, level ground). */
function mortarLay(e: Emplacement, m: number, yaw: number): { pitch: number; charge: number; range: number } {
  const t = rangeTable(e), N = t.range.length - 1;
  const near = nearestClear(e, yaw);
  const R = near + (t.range[N] - near) * Math.min(1, Math.max(0, m));
  let i = 0;
  while (i < N - 1 && t.range[i + 1] < R) i++;
  const span = t.range[i + 1] - t.range[i];
  const f = span > 1e-6 ? Math.min(1, Math.max(0, (R - t.range[i]) / span)) : 0;
  return { pitch: t.pitch[i] + (t.pitch[i + 1] - t.pitch[i]) * f, charge: t.charge[i] + (t.charge[i + 1] - t.charge[i]) * f, range: R };
}

const chargeBox = $("charge"), chargeFill = $("charge-fill"), chargeLast = $("charge-last"), chargeText = $("charge-text");
let chargeShown = "";
/** The charge gauge under the view while the mortar is yours to fire: the needle, where you let go last time, and the range. */
function updateCharge(now: number) {
  const e = EMP[current];
  const show = mode !== null && view === "sight" && !ride && !follow && !e.empty && e.weapon === "mortar";
  if (chargeBox.hidden === show) chargeBox.hidden = !show;
  if (!show) return;
  const fired = now < firedAt.until;
  const n = needle >= 0 ? needle : fired ? firedAt.needle : 0;
  chargeFill.style.transform = `scaleX(${n.toFixed(4)})`;
  const last = lastNeedle[current];
  chargeLast.hidden = last < 0;
  if (last >= 0) chargeLast.style.left = `${(last * 100).toFixed(2)}%`;
  const t = rangeTable(e), N = t.range.length - 1;
  const text = isOut(current) ? "Knocked out" : needle >= 0 ? `${Math.round(chargeRange)} m` : fired ? `Fired at ${Math.round(firedAt.range)} m` : rl(current) > 0 ? "Reloading" : `Hold Space to charge: ${Math.round(nearestClear(e, aims[current].yaw))} to ${Math.round(t.range[N])} m`;
  if (text !== chargeShown) {
    chargeShown = text;
    chargeText.textContent = text;
  }
  chargeBox.classList.toggle("on", needle >= 0);
}

/** Every gun for the minimap: world x, z and its mark (armed, the one you ride, knocked out, an empty slot). */
const mapGuns = new Float32Array(ALL_EMP.length * GUN_STRIDE);
/** Test only: fields laid over what the minimap draws from (a still of a state the match is slow to reach). */
let mapPatch: Partial<MinimapState> | null = null;

/** The minimap from what the page last heard. */
function drawMap() {
  const f = lastApplied, pf = estate.plotFrame;
  const match = isMatch();
  let guns = 0;
  for (let i = 0; i < ALL_EMP.length; i++) {
    const e = ALL_EMP[i];
    // The Practice range has no empty slots to show; a match shows all sixteen.
    if (e.empty && !match) continue;
    const slot = i - BASE;
    const kind = e.empty ? Gun.Empty : (gunOut[e.id * 2] ?? 0) > 0 ? Gun.Out : slot === current && slot >= 0 && slot < EMP.length ? Gun.Ride : Gun.Armed;
    mapGuns[guns * GUN_STRIDE] = e.x;
    mapGuns[guns * GUN_STRIDE + 1] = e.z;
    mapGuns[guns * GUN_STRIDE + 2] = kind;
    guns++;
  }
  const info = matchInfo;
  const stormOf = (c: 0 | 1) => (info && info.stormHold ? info.storm[c] / info.stormHold : 0);
  minimap.draw({
    me: ME,
    sections: sectionShares,
    keeps: match ? keepsShown : [3, 3],
    gateOpen: info ? info.gateOpen : [false, false],
    bridges: bridgesOpen,
    minions: f ? f.minions : null,
    minionCount: f ? f.minionCount : 0,
    plots: pf.data,
    plotCount: pf.count,
    guns: mapGuns,
    gunCount: guns,
    storm: [stormOf(0), stormOf(1)],
    stormOn: info ? [info.attackers[0] > info.defenders[0] && info.attackers[0] >= 2, info.attackers[1] > info.defenders[1] && info.attackers[1] >= 2] : [false, false],
    match,
    ...mapPatch,
  });
}

/** The minimap grows to twice its size over the scene while it is pointed at or G is held. */
const mapbox = $("mapbox");
let mapHover = false, mapBig = false;
function setMapBig(on: boolean) {
  if (on === mapBig) return;
  mapBig = on;
  if (on) {
    // Twice the size, as far as the screen allows (it grows up and to the left from its corner).
    const r = mapbox.getBoundingClientRect();
    const f = Math.max(1, Math.min(2, (r.right - 12) / r.width, (r.bottom - 12) / r.height));
    mapbox.style.setProperty("--mw", `${(r.width * f).toFixed(1)}px`);
    mapbox.style.setProperty("--mh", `${(r.height * f).toFixed(1)}px`);
  }
  mapbox.classList.toggle("big", on);
  if (mode !== null) drawMap();
}
mapbox.addEventListener("pointerenter", () => {
  mapHover = true;
  setMapBig(true);
});
mapbox.addEventListener("pointerleave", () => {
  mapHover = false;
  if (!input.down("KeyG")) setMapBig(false);
});

/** Can the gun you ride fire now? */
function canFire(): boolean {
  return ready && !userPause && rl(current) === 0 && !matchInfo?.result && !EMP[current].empty && !isOut(current);
}

/** Match ids of guns fired here and not yet seen reloading in the match, until when (ms) to wait for it. */
const firePending = new Map<number, number>();

/** Q and E: the next or the previous gun that is armed (M3: empty slots are passed over). */
function step(dir: number) {
  for (let k = 1; k <= EMP.length; k++) {
    const i = (((current + dir * k) % EMP.length) + EMP.length) % EMP.length;
    if (!EMP[i].empty) return select(i);
  }
}

function select(i: number) {
  endRide();
  cancelCharge();
  const prev = current;
  const wasSight = view === "sight";
  if (i >= EMP.length) return;
  current = ((i % EMP.length) + EMP.length) % EMP.length;
  if (current !== prev) sound.ui("switch");
  view = "sight";
  spot.primed = false;
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

/**
 * Routes and bridges are named from castle 1's side (its left is +x). The
 * guest online holds castle 0 and faces the other way, so its left is the
 * match's right: the HUD speaks the player's own sides (the same swap both ways).
 */
const ownSide = (r: RouteName): RouteName => (ME === 0 && r !== "centre" ? (r === "left" ? "right" : "left") : r);

/** Orders for all your waves (Ctrl+1, 2, 3) and the route of your next ones (L). */
function giveOrder(order: number) {
  if (!isMatch() || !matchInfo || matchInfo.result) return;
  send({ t: "input", input: { kind: "order", order: order as Order } });
  sound.ui("order");
  guide.mark("waves");
  const text = ["Waves advance on the gate", "Waves hold at midfield", "Waves push the breach"][order];
  showNote(text, 3200);
  matchInfo.order = order;
  updateWaves();
}
/** The route of your next waves, as you see it (your own left and right). */
function setRoute(view: RouteName) {
  if (!isMatch() || !matchInfo || matchInfo.result) return;
  const route = ownSide(view);
  send({ t: "input", input: { kind: "route", route } });
  sound.ui("click");
  guide.mark("waves");
  showNote(`Next waves: ${view === "centre" ? "centre road" : `${view} flank`}`, 2200);
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
/** Test hook: a mortar's charge held without a key (the screenshot tools). */
let testHold = false;

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
  if (e.weapon === "mortar") return mortarPose(dt);
  const [dx, dy, dz] = aimDir(a.yaw, a.pitch);
  return { mode: "sight" as const, x: e.x - dx * 3.2, y: e.y + 1.1 - dy * 3.2, z: e.z - dz * 3.2, yaw: a.yaw, pitch: a.pitch - 0.05, fov: fov[current] };
}

/** Smooth 0..1 step. */
function smooth01(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

/** How near and how far the mortar's spotter may look along the bearing (m). */
const LOOK_NEAR = 12, LOOK_FAR = 180;

/**
 * The mortar's spotter (after M5): over the keep, looking along the bearing at
 * the ground as far out as you look; look close and the spotter steps onto the
 * front wall (a few metres to the side of the gun over the gate) to see over
 * the battlements. The charge never moves the camera: only where you look does.
 */
function mortarPose(dt: number): CameraPose {
  const e = EMP[current], a = aims[current];
  const [fx, , fz] = aimDir(a.yaw, 0);
  const D = lookD[current];
  const gx = e.x + fx * D, gz = e.z + fz * D;
  const gy = renderer.groundAt(gx, gz);
  // Where the castle's front wall crosses the bearing (castle 1 faces +z, castle 0 -z).
  const dir = e.z < -DIST / 2 ? 1 : -1;
  const frontZ = (dir > 0 ? -DIST : 0) + dir * CASTLE_SHAPE.half;
  const along = fz * dir > 0.2 ? Math.min(40, Math.max(4, (frontZ - e.z) / fz)) : 12;
  // 0: on the wall, looking down at the ground before the gate; 1: over the keep, looking out over the field.
  const t = smooth01((D - 16) / 34);
  // Never as far out as where it looks (the mortar turned well to the side meets its front wall far along the bearing).
  const f = Math.min(along - 1.2 + (-4 - (along - 1.2)) * t, D - 6);
  const h = 13.5 + 13.5 * t;
  const side = 3.2 * (1 - t);
  const x = e.x + fx * f - fz * side, y = e.y + h, z = e.z + fz * f + fx * side;
  if (!spot.primed) Object.assign(spot, { x, y, z, tx: gx, ty: gy, tz: gz, primed: true });
  const k = 1 - Math.exp(-dt * 7);
  spot.x += (x - spot.x) * k;
  spot.y += (y - spot.y) * k;
  spot.z += (z - spot.z) * k;
  spot.tx += (gx - spot.tx) * k;
  spot.ty += (gy - spot.ty) * k;
  spot.tz += (gz - spot.tz) * k;
  return { mode: "free", x: spot.x, y: spot.y, z: spot.z, tx: spot.tx, ty: spot.ty + 0.5, tz: spot.tz, fov: fov[current] };
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
    renderer.setMortarAim(null, null, 0, true);
    renderer.setAimArc(null);
  } else if (e.weapon === "mortar") {
    // After M5: the mortar's own marks (the bearing, the charge ring); the last landing below as for any gun.
    mortarHelp(e, w, a);
  } else {
    renderer.setMortarAim(null, null, 0, true);
    const m = muzzle(e, a.yaw, a.pitch);
    const d = aimDir(a.yaw, a.pitch);
    const sv = e.weapon === "longGun" ? spinVector(a.yaw, spin, w.spinRate) : null;
    const v: [number, number, number] = [d[0] * w.speed, d[1] * w.speed, d[2] * w.speed];
    const coef = flightCoef(w.projectile);
    // The whole flight, stopped where it first hits masonry or the ground.
    let path = predictPath(m, v, sv, wind.x, wind.z, coef, 12, 2);
    const hit = renderer.castPath(path);
    if (hit) path = cutPath(path, hit);
    flightSeconds = hit ? pathTime(path, hit) : 0;
    if (aimHelp === "full") {
      renderer.setAimArc(path);
      aimHit = hit;
      predicted = hit ? { x: hit.x, y: hit.y, z: hit.z } : null;
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
  // Full aim help marks where this shot will land; partial marks where the last one landed (the mortar's charge ring is its own).
  if (marker) renderer.setLandingMarker(marker, 0);
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

/**
 * The mortar's marks (after M5): the bearing along the ground from its nearest
 * range to its farthest, and while the charge goes in the ring where the shell
 * would come down now. With the standard aim help the ring is a soft patch in
 * still air (the wind is the gunner's to read); with the easy one it is the
 * true landing, with the burst's reach and the whole flight.
 */
function mortarHelp(e: Emplacement, w: ReturnType<typeof weaponOf>, a: AimState) {
  const [fx, , fz] = aimDir(a.yaw, 0);
  const table = rangeTable(e);
  const bearing = { x: e.x, z: e.z, dx: fx, dz: fz, near: Math.max(6, nearestClear(e, a.yaw)), far: table.range[table.range.length - 1] };
  const live = !!charging && charging.slot === current && needle >= 0;
  // Not charging, the flight is still worked out (and not shown) for where you let go last, or the middle of the
  // meter before your first shell: the fuse keys start from its flight time, and the shell ride frames its landing.
  const m = live ? needle : lastNeedle[current] >= 0 ? lastNeedle[current] : 0.5;
  const lay = mortarLay(e, m, a.yaw);
  if (live) chargeRange = lay.range;
  const speed = w.minSpeed + (w.speed - w.minSpeed) * lay.charge;
  const d = aimDir(a.yaw, lay.pitch);
  const easy = aimHelp === "full";
  const burstAt = fuseTicks > 0 ? fuseTicks / 60 : Infinity;
  const coef = flightCoef(w.projectile);
  let path = toGround(predictPath(muzzle(e, a.yaw, lay.pitch), [d[0] * speed, d[1] * speed, d[2] * speed], null, easy ? wind.x : 0, easy ? wind.z : 0, coef, Math.min(12, burstAt), 2), coef.gravity);
  const hit = renderer.castPath(path);
  if (hit) path = cutPath(path, hit);
  const n = path.length;
  const p = hit ? { x: hit.x, y: hit.y, z: hit.z } : { x: path[n - 3], y: path[n - 2], z: path[n - 1] };
  flightSeconds = hit ? pathTime(path, hit) : burstAt < 12 ? burstAt : 0;
  predicted = p;
  if (easy) aimHit = hit;
  renderer.setMortarAim(bearing, live ? p : null, easy && w.burst ? w.burst.radius : RING_SOFT, !easy);
  renderer.setAimArc(live && easy ? path : null);
}

/**
 * A predicted path (a point every 2 ticks) stops at height 0, level ground;
 * where the valley lies lower (most of the field is a little below 0, the
 * stream nearly 2 m) it is carried on down to the ground, so the cast finds
 * where it comes down: the ring lies on the ground, and the flight time the
 * fuse keys start from is known.
 */
function toGround(path: Float32Array, gravity: number): Float32Array {
  const n = path.length / 3;
  if (n < 2) return path;
  let x = path[n * 3 - 3], y = path[n * 3 - 2], z = path[n * 3 - 1];
  if (y > 0.01 || y <= renderer.groundAt(x, z)) return path; // still in the air (time ran out), or already in the ground
  const dt = 2 / 60;
  let vx = (x - path[n * 3 - 6]) / dt, vy = (y - path[n * 3 - 5]) / dt, vz = (z - path[n * 3 - 4]) / dt;
  const more: number[] = [];
  for (let i = 0; i < 60 && y > renderer.groundAt(x, z) - 0.3; i++) {
    vy -= G * gravity * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    more.push(x, y, z);
  }
  const out = new Float32Array(path.length + more.length);
  out.set(path);
  out.set(more, path.length);
  return out;
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
    what = `the ${ownSide(bridge.site.name)} bridge`;
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

// ---- guns knocked out (after M5) ---------------------------------------------------
/** What knocked a gun out (sim OutCause), in a word or two. */
const CAUSE_SHORT = ["", "its masonry fell", "a direct hit", "chain shot", "a shell"];

/** The repairs that put back the masonry under each emplacement (its sections' kinds), worked out once. */
const mountKinds = new Map<number, RepairKind[]>();
function mountRepairs(id: number): RepairKind[] {
  let k = mountKinds.get(id);
  if (k) return k;
  const e = ALL_EMP[id], sections = repairSections(layout), kinds = new Set<RepairKind>();
  if (e) for (const sec of sections) if (sec.castle === (e.z < -DIST / 2 ? 1 : 0)) for (const p of mountPieces(layout, e)) if (sec.stones.includes(p)) kinds.add(sec.kind);
  k = REPAIR_KINDS.filter((r) => kinds.has(r));
  mountKinds.set(id, k);
  return k;
}

/** "Out: back in 24 s" (or what it waits for), for a slot of yours. */
function outShort(i: number): string {
  const id = gid(i), st = gunOut[id * 2] ?? 0, left = gunOut[id * 2 + 1] ?? 0;
  if (st === 2) {
    // Masons put its masonry back, unless you turned those repairs off: then say which, and the key.
    const off = matchInfo ? mountRepairs(id).filter((r) => matchInfo!.repairs[r] === false) : [];
    return off.length ? `Out: ${off[0] === "towers" ? "tower" : off[0] === "walls" ? "wall" : off[0]} repairs off (Alt+${REPAIR_KINDS.indexOf(off[0]) + 1})` : "Out: masonry down";
  }
  if (st === 3) return "Out: needs gold";
  return `Out: back in ${Math.max(1, Math.ceil(left / 60))} s`;
}

/**
 * The worker's report of which guns are out: the tabs and the weapon card
 * follow when it changes. (The gun models follow the GunOut and GunBack events
 * instead, which come with the frame they happen in: the report runs a couple
 * of frames ahead of what is drawn, and only the event says a gun fell.)
 */
let outSeen = "";
function onGunsOut(out: Int16Array) {
  gunOut = out;
  let key = "";
  for (let i = 0; i < out.length; i += 2) key += out[i];
  if (key === outSeen) return;
  outSeen = key;
  tabs.forEach((b, i) => {
    const o = isOut(i);
    b.classList.toggle("out", o);
    if (!EMP[i].empty) b.title = o ? `Slot ${i + 1}: knocked out` : "";
  });
  updateHud(true);
}

/** A gun was knocked out (sim mounts.ts; `shot` is the shot that did it, -1 when its masonry fell): a short note, the log, a crash; the model tips over or falls with its masonry. */
function gunKnockedOut(emp: number, cause: number, shot: number) {
  const e = ALL_EMP[emp];
  if (!e) return;
  sound.woodHit(e.x, e.y, e.z, 1);
  sound.impact(e.x, e.y, e.z, cause === 1 ? 0.9 : 0.6);
  renderer.setGunOut(emp, true, cause === 1);
  const slot = emp - BASE;
  const name = WEAPONS[e.weapon].name.toLowerCase();
  if (slot >= 0 && slot < EMP.length) {
    showNote(`Your ${name} is out: ${CAUSE_SHORT[cause]}`, 4000);
    if (isMatch()) logMoment(`Your ${name} was knocked out (${CAUSE_SHORT[cause]})`, true);
  } else {
    // Your open tally's shot did it, or the masonry it brought down under the gun.
    if (tally && (shot === tally.shot || (shot < 0 && tally.landed && Math.hypot(e.x - tally.x, e.z - tally.z) < tally.r + 8))) tally.guns++;
    showNote(`Enemy ${name} silenced`, 3500);
    if (isMatch()) logMoment(`You silenced the enemy ${name}`);
  }
}

/** A knocked-out gun's crew has it back. */
function gunBack(emp: number) {
  const e = ALL_EMP[emp];
  if (!e) return;
  renderer.setGunOut(emp, false);
  const slot = emp - BASE;
  if (slot >= 0 && slot < EMP.length && !e.empty) {
    // Its crew has it on its mount again and loads it from empty: the loaded clack comes when it is ready.
    showNote(`Your ${WEAPONS[e.weapon].name.toLowerCase()} is back, reloading`, 2600);
  }
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
  outSeen = ""; // the next report marks the new tabs of guns that are out
  tabs = EMP.map((e, i) => {
    const b = document.createElement("button");
    b.dataset.weapon = String(i);
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = String(i + 1);
    b.append(n, e.empty ? "+" : WEAPONS[e.weapon].name);
    if (e.empty) {
      // Empty slots stay short, so eight tabs and the buttons beside them fit one row on a laptop.
      b.className = "emptyslot";
      b.title = `Slot ${i + 1}: empty (click to buy a gun for it)`;
      b.setAttribute("aria-label", `Slot ${i + 1}, empty`);
    }
    b.addEventListener("click", () => {
      select(i);
      b.blur(); // keep keys like Space for the game, not the button
      if (e.empty && isMatch()) estate.openFor(i); // an empty slot: straight to the guns it can take
    });
    group.append(b);
    return b;
  });
}
buildTabs();

// The match bar and the Controls panel sit below the top bar, however many rows it wraps into; gold coming in sits below the match bar.
{
  const topBar = document.querySelector<HTMLElement>(".top");
  const bar = $("matchbar");
  if (topBar) {
    const sync = () => {
      document.documentElement.style.setProperty("--top-h", `${topBar.offsetHeight}px`);
      const bottom = bar.hidden ? topBar.getBoundingClientRect().bottom : bar.getBoundingClientRect().bottom;
      document.documentElement.style.setProperty("--mb-bottom", `${Math.round(bottom)}px`);
    };
    sync();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(sync);
      ro.observe(topBar);
      ro.observe(bar);
    }
  }
}

const LOCK_HINT = "<kbd>Click</kbd> take the gun <kbd>Esc</kbd> free the mouse";
const LOCK_REFUSED = "Mouse not captured: click again, or aim with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> and fire with <kbd>Space</kbd>";
/** The sound button's two faces (a speaker, struck through when muted). */
const SOUND_ICON = (on: boolean) =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor" stroke="none"/>${on ? '<path d="M13 7.2a4 4 0 0 1 0 5.6M15.4 5a7 7 0 0 1 0 10"/>' : '<path d="M13.5 7.5l5 5M18.5 7.5l-5 5"/>'}</svg>`;
let soundShown: boolean | null = null;
/** The player aimed or fired with the keys since the mouse was last free (or since the start): the click hint has done its job. */
let playedFree = false;
let hudFrame = 0;
/** The weapon card's settings line: fixed words, numbers and keycaps only (it is set as HTML), redrawn when it changes. */
function setExtra(html: string) {
  if (hud.extra.dataset.html === html) return;
  hud.extra.dataset.html = html;
  hud.extra.innerHTML = html;
}

/** The sound button's face and the "click to take the gun" hint, whatever gun is up. */
function updateChrome() {
  if (soundShown !== !sound.muted) {
    soundShown = !sound.muted;
    hud.sound.innerHTML = SOUND_ICON(soundShown);
    hud.sound.title = soundShown ? "Sound on (M)" : "Sound off (M)";
    hud.sound.setAttribute("aria-label", soundShown ? "Sound on" : "Sound off");
  }
  hud.sound.setAttribute("aria-pressed", String(!sound.muted));
  // "Click to take the gun" until the player has the mouse, or plays on with the keys without it (then it has done
  // its job); it comes back when the mouse is let go (Esc), until the next click or key.
  if (input.locked) playedFree = false;
  // A click the browser turned down says so for a few seconds (the keys aim all the same).
  const refused = input.lockRefusedAt > 0 && performance.now() - input.lockRefusedAt < 5000;
  const lockText = refused ? LOCK_REFUSED : LOCK_HINT;
  if (hud.lock.dataset.text !== lockText) {
    hud.lock.dataset.text = lockText;
    hud.lock.innerHTML = lockText;
  }
  hud.lock.hidden = input.locked || (playedFree && !refused) || view !== "sight" || input.usedPad || !!ride;
}

function updateHud(force = false) {
  if (!force && (hudFrame++ & 3) !== 0) return;
  updateChrome();
  const e = EMP[current], w = weaponOf(e);
  hud.name.textContent = e.empty ? "Empty slot" : w.name;
  hud.slot.textContent = `${current + 1}`;
  tabs.forEach((b, i) => b.setAttribute("aria-pressed", String(i === current)));
  if (e.empty) {
    // M3: nothing to fire here yet.
    hud.reload.textContent = "No gun";
    hud.reloadFill.style.transform = "scaleX(0)";
    hud.target.textContent = "";
    setExtra("<kbd>Space</kbd> buys one");
    hud.reticle.hidden = true;
    return;
  }
  const r = rl(current);
  const out = isOut(current);
  hud.reload.textContent = out ? outShort(current) : r > 0 ? `Reloading ${(r / 60).toFixed(1)} s` : "Ready";
  hud.reloadFill.style.transform = `scaleX(${out ? 0 : 1 - r / w.reload})`;
  weaponPanel.classList.toggle("loaded", r === 0 && !out);
  weaponPanel.classList.toggle("out", out);
  const hitText = aimHelp === "full" && aimHit ? describeHit(aimHit) : "";
  // What a gunner reads off the quadrant: the barrel's elevation (and, for the mortar, its still-air range).
  const elevation = `${((aims[current].pitch * 180) / Math.PI).toFixed(1)}°`;
  // The settings line is fixed words and numbers only (it is set as HTML for its keycaps).
  let extra = "";
  if (e.weapon === "mortar") {
    // After M5: the range the charge gives now (in still air with the standard aim help), or what to do.
    const flight = aimHelp === "full" && flightSeconds ? `, ${flightSeconds.toFixed(1)} s` : "";
    hud.target.textContent = needle >= 0 ? (hitText ? `Lands on ${hitText}${flight}` : `${Math.round(chargeRange)} m`) : "";
    const air = fuseTicks > 0 && flightSeconds && fuseTicks / 60 <= flightSeconds + 0.02 && !aimHit ? ", airburst" : "";
    extra = `Fuse <b>${fuseTicks === 0 ? "impact" : `${(fuseTicks / 60).toFixed(1)} s${air}`}</b> <kbd>[</kbd><kbd>]</kbd>`;
  } else {
    hud.target.textContent = hitText ? `Hits ${hitText}` : elevation;
    if (e.weapon === "longGun") extra = `Spin <b>${SPIN_NAMES[spin].toLowerCase()}</b> <kbd>R</kbd>`;
  }
  setExtra(extra);
  hud.shotCam.checked = shotCam[current];
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
  // After M5 the mortar is aimed by the ring on the ground, not the middle of the view.
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
const mouseBox = $<HTMLInputElement>("mousespeed");
mouseBox.value = String(mouseSpeed);
mouseBox.addEventListener("input", () => {
  mouseSpeed = Math.max(0.4, Math.min(2.5, Number(mouseBox.value) || 1));
  try {
    localStorage.setItem("keepfall.mouseSpeed", String(mouseSpeed));
  } catch {}
});
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
  setPause(false);
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
  $("mode-name").textContent = m === "versus" ? `Versus AI: ${AI_LEVELS[difficulty].name}` : m === "guided" ? "Guided match" : m === "online" ? `Against ${friendName}` : "Practice range";
  $("keep-theirs-name").textContent = m === "online" ? "Their keep" : "Enemy keep";
  const match = m === "versus" || m === "online" || m === "guided";
  $("matchbar").hidden = !match;
  $("command").hidden = !match;
  threat.setVisible(match);
  threat.setSide(ME);
  groupMarks.reset();
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
  moments.reset();
  feats.me = ME;
  updateBridges();
  view = "sight";
  ready = false;
  if (rendererReady) $("loading").hidden = false;
  const setup: MatchSetup = m === "versus" ? { difficulty } : m === "online" && net ? { team: net.team, delay: net.delay } : {};
  const seed = m === "online" && net ? net.seed : SEED;
  // A new world: what the old one still says (frames, the match, the lockstep) is dropped from here.
  gen++;
  if (first) send({ t: "init", gen, mode: m, seed, minions: MINIONS, setup });
  else {
    resetLocal();
    send({ t: "reset", gen, mode: m, seed, minions: MINIONS, setup });
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
  // After M5 the Practice range shows the target castle's guns too: something to silence.
  renderer.showEmplacements(ALL_EMP.length);
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
  // The first-match guide (the test clock's screenshots leave it out).
  // In the guided match the coach takes the checklist's place.
  guide.start(FIXED || m === "guided" ? null : match ? "match" : "practice");
  coach.start(m === "guided" && !FIXED, ME);
  keepsShown = [3, 3];
  floorShown = [1, 1];
  sectionShares = null;
  showKeeps([3, 3], [1, 1], false);
  advice = { lastBuild: 0, at: -1e9, count: 0, built: 0 };
  if (match) {
    send({ t: "input", input: { kind: "man", emplacement: gid(current) } });
    const goal = guide.open ? "" : ": bring down its keep or storm its courtyard";
    if (m === "online") showNote(`Versus ${friendName}: you hold the ${ME === 1 ? "oxblood" : "green"} castle`, 5000);
    else if (m === "guided") showNote("A real match against the Tutor's castle", 4000);
    else showNote(`Versus the ${AI_LEVELS[difficulty].name}${goal}`, 4500);
  }
  if (m === "online") {
    online.onGone = () => offerTakeover();
    online.onBack = () => friendBack();
  }
}

/** Online: the friend who had gone is back and the match runs again: the dialog goes. */
function friendBack() {
  if (mode !== "online" || $("gone").hidden) return;
  $("gone").hidden = true;
  showNote(`${friendName} is back`, 3000);
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
  void online.leave(false); // the match goes on here, against the AI
  showNote(`The Knight takes over ${friendName}'s castle`, 5000);
  $("netline").hidden = true;
});
$("gone-menu").addEventListener("click", () => {
  $("gone").hidden = true;
  void online.leave();
  // That match is over for this page: there is no going back to it.
  $("menu").hidden = false;
  $("choices").hidden = false;
  $("online").hidden = true;
  $("menu-back").hidden = true;
  surrenderBtn.hidden = true;
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
    const upgraded = !!upgrade && e.upgrade !== upgrade;
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
    if (slot >= 0 && slot < SLOTS && (bought || upgraded)) {
      noteBuilt();
      if (bought) soundscape.purchase(e.x, e.y, e.z);
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
  cancelCharge();
  myShells.clear();
  gunOut = new Int16Array(0);
  outSeen = "";
  spot.primed = false; // the next spotter view starts where it is wanted, not swooping over from the old castle
  for (let i = 0; i < ALL_EMP.length; i++) renderer.setGunOut(i, false);
  tabs.forEach((b) => b.classList.remove("out"));
  renderer.resetWorld();
  timeline.reset();
  downAt.clear();
  foesAt.clear();
  lastFoes = 0;
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
// M6: the guided match, with its "Start here" tag until one has been won.
const guidedTag = $("guided-tag");
function showGuidedTag() {
  let won = false;
  try {
    won = localStorage.getItem("keepfall.guided") === "won";
  } catch {}
  guidedTag.hidden = won;
}
showGuidedTag();
$("guided-go").addEventListener("click", () => {
  $<HTMLButtonElement>("guided-go").blur();
  sound.ui("click");
  startMode("guided");
});
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
  setPause(true);
  $("paused").hidden = true;
  $("menu").hidden = false;
  $("choices").hidden = false;
  $("online").hidden = true;
  surrenderBtn.hidden = !isMatch() || !!matchInfo?.result || (mode === "online" && !online.active);
  $<HTMLButtonElement>("menu-btn").blur();
  document.exitPointerLock?.();
});
$("menu-back").addEventListener("click", () => {
  $("menu").hidden = true;
  setPause(false);
});
$("end-again").addEventListener("click", () => {
  if (mode === "guided") {
    // A win moves on to Versus AI at the Squire; a loss or a draw tries the guided match again.
    if (matchInfo?.result?.winner === ME) {
      difficulty = "squire";
      try {
        localStorage.setItem("keepfall.difficulty", difficulty);
      } catch {}
      showLevels();
      startMode("versus");
    } else startMode("guided");
    return;
  }
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
$("end-guided").addEventListener("click", () => startMode("guided"));
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
  const names: Record<RepairKind, string> = { gate: "Gate", walls: "Wall", towers: "Tower", keep: "Keep" };
  showNote(`${names[kind]} repairs ${now ? "on" : "off"}`, 2400);
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
  setPause(false); // the menu paused the match: the surrender must reach it
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
  $("next-wave").textContent = info.result ? "" : info.waves[ME] === 0 ? `first in ${s} s` : `next in ${s} s`;
  routeChips.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.route === ownSide(info.route))));
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

/** What your masons are doing, in a word or two for the command card, and in full for its tooltip (hold is the sim's WorksHold). */
function masonText(m: MasonInfo): { short: string; long: string } {
  if (!m.up) return { short: "all down", long: "Your masons are all down" };
  if (!m.job) return { short: `${m.up} idle`, long: `${m.up} masons, nothing to repair` };
  switch (m.hold) {
    case 1:
      return { short: "need gold", long: `Your masons need gold to repair ${m.job}` };
    case 2:
      return { short: "waiting", long: `Your masons wait to repair ${m.job}` };
    case 3:
      return { short: "driven off", long: `Your masons were driven off ${m.job}` };
    default:
      return { short: `${m.left} to lay`, long: `Your masons are repairing ${m.job}: ${m.left} pieces to lay` };
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
  const t = masonText(info.masons[ME]);
  if (el.textContent !== t.short) el.textContent = t.short;
  el.title = t.long;
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
  moments.match(info);
  matchInfo = { ...info, masonry: info.masonry ?? prev?.masonry ?? null, stats: info.stats ?? prev?.stats ?? null, down: info.down ?? prev?.down ?? null };
  threat.update(info.lanes, ME);
  updateWaves();
  soundscape.match(info, ME, FOE);
  updateRepairs();
  updateStorm();
  if (!info.result) {
    const was = prevGate;
    if (was) {
      if (!was.open[ME] && info.gateOpen[ME]) {
        showNote("Your gate is down", 4000);
        logMoment("Your gate was broken down", true);
      } else if (!was.open[FOE] && info.gateOpen[FOE]) {
        showNote("The enemy gate is down", 4000);
        logMoment("The enemy gate was broken down");
      } else if (was.hits[ME] === 0 && info.gateHits[ME] > 0) showNote("Your gate is under attack", 4000);
      else if (was.open[ME] && !info.gateOpen[ME]) {
        showNote("Your gate is repaired", 3000);
        logMoment("Your masons rehung your gate");
      } else if (was.open[FOE] && !info.gateOpen[FOE]) {
        showNote("The enemy gate is repaired", 3000);
        logMoment("The enemy rehung its gate", true);
      }
    }
    prevGate = { hits: [info.gateHits[0], info.gateHits[1]], open: [info.gateOpen[0], info.gateOpen[1]] };
    if (prev) momentsOf(prev, info);
    advise(info);
  }
  nudgeBuild(info);
  updateKeeps(info);
  coach.onMatch(info);
  $("clock").textContent = clockText(info.result ? info.result.tick : info.tick);
  $("clock").classList.toggle("sudden", info.suddenDeath);
  $("sudden").hidden = !info.suddenDeath || !!info.result;
  $("gold").textContent = `${info.gold[ME]} gold`;
  // M3: the rate it comes in, what was earned since, the guns as built and bought.
  $("gold-rate").textContent = `+${info.income[ME].toFixed(1)}/s`;
  syncArms(info.arms);
  // After M5: by slot, whether the masonry a gun would stand on is down (none can be bought for it until rebuilt).
  estate.onMatch(info, EMP[current] ?? null, current, EMP, EMP.map((_, i) => (gunOut[gid(i) * 2] ?? 0) === 2));
  const r = info.result;
  $("match-note").textContent = r ? endLine(r).short : "";
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
    showNote("Enemy ladder on your wall", 4500);
    logMoment("The enemy raised a ladder against your wall", true);
  }
  if (info.ladders[FOE] > prev.ladders[FOE]) {
    showNote("Your ladder is up", 3500);
    logMoment("Your crew raised a ladder against the enemy wall");
  }
  // Storms begun and beaten off.
  if (!prev.storm[FOE] && info.storm[FOE]) {
    showNote("Storming their courtyard: hold it for 20 s", 5000);
    logMoment("Your men began to storm the enemy courtyard");
    sound.horn(true);
  } else if (prev.storm[FOE] && !info.storm[FOE]) {
    showNote("Your storm was beaten off", 3500);
    logMoment("The enemy beat your storm off", true);
  }
  if (!prev.storm[ME] && info.storm[ME]) {
    showNote("Your courtyard is being stormed", 5000);
    logMoment("The enemy began to storm your courtyard", true);
    sound.horn(false);
  } else if (prev.storm[ME] && !info.storm[ME]) {
    showNote("Storm beaten off", 3500);
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
      showNote(`Enemy masons repairing ${theirs.job}`, 4000);
    }
    logMoment(`Enemy masons began rebuilding ${theirs.job}`, true);
  }
  if (mine.up && mine.hold === 1 && prev.masons[ME].hold !== 1 && info.tick - lastGoldNote > 30 * 60) {
    lastGoldNote = info.tick;
    showNote("Your masons are waiting for gold", 3500);
  }
  if (info.suddenDeath && !prev.suddenDeath) {
    showNote("Sudden death: double income, faster reloads", 5000);
    logMoment("Sudden death");
    sound.suddenDeath();
  }
  // Time is called at 25:00: the keep with more floors under its banner wins, then the less battered castle.
  for (const [at, text] of [[20, "Five minutes left: then the taller keep wins"], [24, "One minute left"]] as const) {
    const t = at * 3600;
    if (prev.tick < t && info.tick >= t) showNote(text, 5000);
  }
}
let lastEnemyMasonNote = -1e9;
let lastGoldNote = -1e9;

/** Each keep's floors left under its banner as last shown (they only ever go down), and how sound the floor under it is, for notes and the flash. */
let keepsShown: [number, number] = [3, 3];
let floorShown: [number, number] = [1, 1];
const keepMeters = [$("keep-mine"), $("keep-theirs")];
const FLOOR_NAMES = ["", "the lowest floor", "the upper floor", "the roof"];

/**
 * The keep tracker: a pip for each floor left under each banner (lowest
 * first, the roof last), yours first. The top one drains as shells crack and
 * break its boards, so every hit shows; masons laying boards back fill it.
 */
function showKeeps(levels: [number, number], soundness: [number, number], flash: [boolean, boolean] | false) {
  const teams = [ME, FOE];
  keepMeters.forEach((el, k) => {
    const team = teams[k], n = levels[team];
    el.classList.toggle("team0", team === 0);
    el.classList.toggle("low", n <= 1);
    el.querySelectorAll("i").forEach((pip, f) => {
      pip.classList.toggle("lost", f >= n);
      pip.style.setProperty("--fill", f === n - 1 ? String(Math.max(0.08, soundness[team])) : "1");
    });
    el.setAttribute("aria-label", n > 0 ? `${k === 0 ? "Your keep" : "The enemy keep"}: the banner stands on ${FLOOR_NAMES[n]}, ${Math.round(soundness[team] * 100)}% sound, ${n - 1} more ${n === 2 ? "floor" : "floors"} below` : `${k === 0 ? "Your keep" : "The enemy keep"} has fallen`);
    if (flash && flash[team]) {
      el.classList.remove("hit");
      void el.offsetWidth; // restart the flash
      el.classList.add("hit");
    }
  });
}

/** A keep losing a floor under its banner, or a board of it: the tracker, a note and the log. */
function updateKeeps(info: MatchInfo) {
  const k = info.keeps, h = info.keepFloor;
  if (!k || !h) return;
  const was = keepsShown, wasH = floorShown;
  const now: [number, number] = [Math.min(was[0], k[0]), Math.min(was[1], k[1])];
  // Whole boards in twelfths (a crack is half a board of six), so the HUD redraws only when a board changes.
  const hq: [number, number] = [Math.round(h[0] * 12) / 12, Math.round(h[1] * 12) / 12];
  const floorGone = now[0] !== was[0] || now[1] !== was[1];
  if (!floorGone && hq[0] === wasH[0] && hq[1] === wasH[1]) return;
  keepsShown = now;
  floorShown = hq;
  const worse = (t: 0 | 1) => now[t] < was[t] || (now[t] === was[t] && hq[t] < wasH[t]);
  showKeeps(now, hq, [worse(0), worse(1)]);
  if (!floorGone || info.result) return;
  const theirs = mode === "online" ? `${friendName}'s` : "The enemy";
  if (now[FOE] < was[FOE] && now[FOE] > 0) {
    showNote(now[FOE] === 2 ? `${theirs} roof is in: two floors to go` : `${theirs} banner is on its last floor`, 4500);
    logMoment(now[FOE] === 2 ? `${theirs} keep's roof caved in` : `${theirs} banner came down to the lowest floor`);
    sound.horn(true);
  }
  if (now[ME] < was[ME] && now[ME] > 0) {
    showNote(now[ME] === 2 ? "Your roof is in: two floors left" : "Your banner is on its last floor", 4500);
    logMoment(now[ME] === 2 ? "Your keep's roof caved in" : "Your banner came down to the lowest floor", true);
    sound.horn(false);
  }
}

/**
 * Advice for a player whose gold piles up unspent: a few nudges a match,
 * well apart, and never while they are building anyway.
 */
let advice = { lastBuild: 0, at: -1e9, count: 0, built: 0 };
function noteBuilt() {
  guide.mark("build");
  advice.lastBuild = matchInfo?.tick ?? 0;
}
function advise(info: MatchInfo) {
  const t = info.tick, gold = info.gold[ME];
  if (gold < 320 || t < 50 * 60 || t - advice.lastBuild < 45 * 60 || t - advice.at < 80 * 60 || advice.count >= 4 || estate.wheelOpen) return;
  // Only when there is something left to build or buy.
  const plots = estate.emptyPlots(), slots = EMP.filter((e) => e.empty).length;
  if (!plots && !slots) return;
  advice.at = t;
  advice.count++;
  showNote(`${gold} gold unspent: press B to build`, 5000);
}

/** The Build button by your gold: it opens the build menu, and glows while there is gold to spend and nothing built yet, or gold piling up. */
const buildBtn = $<HTMLButtonElement>("build-btn");
buildBtn.addEventListener("click", () => {
  buildBtn.blur();
  if (estate.wheelOpen) estate.wheel.close();
  else estate.openList();
});
function nudgeBuild(info: MatchInfo) {
  const gold = info.gold[ME];
  const room = estate.emptyPlots() > 0 || EMP.some((e) => e.empty);
  buildBtn.classList.toggle("nudge", !info.result && !estate.wheelOpen && room && gold >= 160 && (advice.lastBuild === 0 || gold >= 450));
}

/** Paused by the player (P, or the menu): Versus AI and the Practice range only (a friend's match never waits for a menu). */
let userPause = false;
function setPause(on: boolean) {
  if (on && mode !== "versus" && mode !== "practice" && mode !== "guided") return;
  if (userPause === on) return;
  userPause = on;
  send({ t: "pause", paused: on || document.hidden });
  sound.setPaused(on || document.hidden);
  $("paused").hidden = !on || !$("menu").hidden;
  if (on) document.exitPointerLock?.();
}

/** M3: trick shots as the end screen says them (ricochet, collapse, multi-kill, keep hit counts). */
function trickText(t: number[]): string {
  const names = ["ricochet", "collapse", "multi-kill", "keep hit"];
  const parts = names.map((k, i) => [k, t[i] ?? 0] as const).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}${n > 1 ? "s" : ""}`);
  return parts.length ? parts.join(", ") : "none";
}

/** How a match ended, in a few words and in a sentence. */
function endLine(r: NonNullable<MatchInfo["result"]>): { short: string; long: string } {
  if (r.winner === -1) {
    const why = r.reason === "storm" ? "Both courtyards fell together." : r.reason === "surrender" ? "Both sides gave up at once." : r.reason === "time" ? "Time was called with both keeps standing as high and as battered." : "Both banners came down together.";
    return { short: "A draw", long: why };
  }
  const won = r.winner === ME;
  if (r.reason === "time") return won ? { short: "Time: you held out better", long: "Time was called at 25:00: your keep stood taller (or less battered) than theirs." } : { short: "Time: they held out better", long: "Time was called at 25:00: their keep stood taller (or less battered) than yours." };
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
  // M6: the guided match's own end screen (a win moves on to Versus AI at the Squire).
  const guided = mode === "guided";
  const gwon = guided && r.winner === ME;
  $("end-guided").hidden = !gwon;
  if (gwon) {
    try {
      localStorage.setItem("keepfall.guided", "won");
    } catch {}
    showGuidedTag();
  }
  if (guided) {
    $("end-line").textContent = gwon ? "You won your first match." : r.winner === FOE ? "The enemy won this time." : endLine(r).long;
    $("end-again").textContent = gwon ? "Versus AI: Squire" : "Try again";
  }
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
    // After M5: guns knocked out.
    ["Guns silenced", st ? st[a].gunsSilenced : "", st ? st[b].gunsSilenced : ""],
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
  // Castle 1's left is +x, castle 0's is -x.
  const leftFirst = ME === 1 ? -1 : 1;
  const parts = layout.bridges
    .map((b, k) => ({ name: ownSide(b.site.name), open: bridgesOpen[k] ?? true, x: b.site.x }))
    .sort((a, b) => leftFirst * (a.x - b.x))
    .map((b) => `${b.name} <b class="${b.open ? "" : "down"}">${b.open ? "open" : "down"}</b>`);
  $("bridges").innerHTML = `Bridges: ${parts.join(", ")}`;
}

function onBridges(open: boolean[]) {
  const was = bridgesOpen;
  bridgesOpen = open;
  moments.bridges(was, open);
  updateBridges();
  for (let k = 0; k < open.length; k++) {
    if (was[k] && !open[k]) showNote(`The ${ownSide(layout.bridges[k].site.name)} bridge is down: that route is closed`, 4500);
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

/** A feat earned for the first time: one short line in the corner, never over the middle of the screen. */
let featTimer: ReturnType<typeof setTimeout> | undefined;
let featToastMs = 5200;
function showFeatToast(list: Array<{ def: FeatDef; value: number }>) {
  const el = $("feat-toast");
  const { def, value } = list[0];
  const size = def.unit && value > 1 ? ` (${value} ${def.unit})` : "";
  $("feat-toast-name").textContent = def.name + size;
  $("feat-toast-hint").textContent = list.length > 1 ? `And ${list.slice(1).map((x) => x.def.name).join(", ")}` : def.hint;
  el.hidden = false;
  el.classList.remove("show");
  void el.offsetWidth; // restart the slide
  el.classList.add("show");
  clearTimeout(featTimer);
  featTimer = setTimeout(() => (el.hidden = true), featToastMs);
}

/** The book of feats: earned ones with their date and best, the rest dimmed with their hint. */
function showBook() {
  const rows = feats.list();
  $("book-count").textContent = `${feats.earned()} of ${rows.length} feats`;
  const list = $("book-list");
  list.textContent = "";
  for (const { def, record } of rows) {
    const li = document.createElement("li");
    li.className = record ? "got" : "not";
    const name = document.createElement("b");
    name.textContent = def.name;
    const hint = document.createElement("span");
    hint.textContent = def.hint;
    const meta = document.createElement("i");
    meta.textContent = record ? [bestText(def, record) && `best ${bestText(def, record)}`, record.first].filter(Boolean).join(", ") : "";
    li.append(name, hint, meta);
    list.append(li);
  }
  $("menu").classList.add("behind");
  $("book").hidden = false;
}
$("book-open").addEventListener("click", showBook);
$("book-close").addEventListener("click", () => {
  $("book").hidden = true;
  $("menu").classList.remove("behind");
});

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
$("guide-show").addEventListener("click", () => {
  $<HTMLButtonElement>("guide-show").blur();
  if (mode === "guided") coach.show();
  else guide.start(mode === null ? null : isMatch() ? "match" : "practice", true);
  help.hidden = true;
});
// A checkbox or a slider keeps no focus once changed: the game's keys stay the game's (Space never toggles it again).
for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[type=checkbox], input[type=range], select")) el.addEventListener("change", () => el.blur());
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
  cancelCharge();
  view = view === "sight" ? "overview" : "sight";
  if (view === "overview") {
    document.exitPointerLock?.();
    guide.mark("overview");
  }
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
/** Is the build wheel open, as the page's layout last knew (notes move under it). */
let wheelShown = false;
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
  // Behind the menu, the end screen or the friend-gone dialog the field takes no keys (only M and H).
  const blocked = !$("menu").hidden || !$("end").hidden || !$("gone").hidden;
  if (blocked) {
    const keep = { mute: p.mute, help: p.help };
    for (const k of Object.keys(p) as Array<keyof typeof p>) (p as unknown as Record<string, unknown>)[k] = typeof p[k] === "number" ? -1 : false;
    Object.assign(p, keep);
    keyVel.yaw = keyVel.pitch = 0;
  }
  // M3: while the build wheel is open, numbers, Backspace and Esc are its own; B opens and closes it.
  const wheelKeys = estate.keys(p, isMatch());
  if (!wheelKeys && p.weapon >= 0) select(p.weapon);
  if (p.next) step(1);
  if (p.prev) step(-1);
  if (p.overview) toggleOverview();
  if (p.help) help.hidden = !help.hidden;
  if (p.pause && $("menu").hidden && $("end").hidden) setPause(!userPause);
  if (p.shotCam) toggleShotCam();
  if (p.mute) {
    sound.setMuted(!sound.muted);
    updateHud(true);
  }
  if (p.nav) toggleNav();
  if (p.order >= 0) giveOrder(p.order);
  if (p.orderNext && matchInfo) giveOrder((matchInfo.order + 1) % 3);
  if (p.route && matchInfo) setRoute(ROUTE_NAMES[(ROUTE_NAMES.indexOf(ownSide(matchInfo.route)) + 1) % ROUTE_NAMES.length]);
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
    cancelCharge();
  } else if (view !== "sight" || estate.wheelOpen || blocked) {
    cancelCharge();
  } else if (EMP[current].weapon === "mortar" && !EMP[current].empty) {
    // The mortar: the press starts the charge, letting go fires it (a knocked-out one says when it is back).
    if (p.fire && !charging) {
      if (canFire()) charging = { start: now, slot: current, ticks: 0 };
      else if (isOut(current)) fire();
    }
    if (charging) {
      needle = needleAt(now);
      const k = Math.floor(((now - charging.start) / 1000) * 9);
      if (k > charging.ticks) {
        charging.ticks = k;
        sound.chargeTick(needle);
      }
      if ((!input.fireHeld() && !testHold) || !canFire()) releaseCharge(now);
    }
  } else if (p.fire) fire();

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
  updateCharge(now);
  coach.render(now, { marksOn: !ride && !follow && blocked === false, weapon: current, charging: !!charging });
  setMapBig(mapHover || input.down("KeyG"));
  if (mode !== null && (mapFrame++ % 3 === 0 || FIXED)) drawMap();
  placeWanted();
  {
    const cam = renderer.listener();
    groupMarks.place(mode !== null && view === "overview", (x, y, z) => renderer.project(x, y, z), cam, innerWidth, innerHeight, dt);
  }
  if (!paused) renderer.render(dt);
  estate.update(now);
  if (estate.wheelOpen !== wheelShown) {
    wheelShown = estate.wheelOpen;
    document.body.classList.toggle("wheel-open", wheelShown);
  }
  sound.update(renderer.listener(), dt, { wind: Math.hypot(wind.x, wind.z), awake: stats.awake, slow: timeScale });
  soundscape.update(dt, renderer.listener());
  calibrate(dt);
  pace(dt, now);
  requestAnimationFrame(frame);
}

// Leaving the page mid-charge (another tab or window) drops the charge: the keys let go on blur, and that is no release to fire on.
window.addEventListener("blur", () => cancelCharge());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelCharge();
  paused = document.hidden;
  send({ t: "pause", paused: paused || userPause });
  sound.setPaused(paused || userPause);
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
  renderer.showEmplacements(ALL_EMP.length);
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
  /** L0 test hook: lay fields over what the minimap draws from (null: none), and read its draw times. */
  patchMap(p: Partial<MinimapState> | null) {
    mapPatch = p;
  },
  /** L0: draw the minimap now (a still wants the very frame), and time n draws of it (ms each). */
  redrawMap() {
    drawMap();
  },
  benchMinimap(n: number) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) drawMap();
    return (performance.now() - t0) / n;
  },
  get minimapMs() {
    return { last: minimap.lastMs, avg: minimap.avgMs, draws: minimap.draws };
  },
  /** L0: the worker's last section shares for the minimap (SECTION_COUNT per castle, two bytes each), and where each gun stands. */
  get mapShares() {
    return sectionShares ? Array.from(sectionShares) : null;
  },
  get guns() {
    return ALL_EMP.map((e) => ({ x: e.x, z: e.z }));
  },
  get mapBig() {
    return mapBig;
  },
  /** M6 test hook: lay fields over every match report the page gets (null: none). */
  patchMatch(p: Partial<MatchInfo> | null) {
    matchPatch = p;
  },
  /** M6: the coach (tests set its stage, fake keep hits and read its card). */
  get coach() {
    return coach;
  },
  get bridges() {
    return bridgesOpen.slice();
  },
  startMode,
  /** S1: every moment found this match, and the book (tests read them; fakeMoment feeds one in as if the match had made it). */
  get moments() {
    return moments.log.slice();
  },
  feats,
  /** Test hook: how long a feat's toast stays (ms), so a slow software-rendered screenshot can catch it. */
  setFeatToastMs(ms: number) {
    featToastMs = ms;
  },
  fakeMoment(m: Partial<import("./moments").Moment>) {
    const full = { atMs: 0, tick: lastFrameTick, x: 0, y: 0, z: 0, kind: "multiKill", team: ME, score: 100, text: "", size: 3, ...m } as import("./moments").Moment;
    feats.observe(full);
  },
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
  /** Test clock: stop following wall time and step the match this many game seconds (the worker takes 0.2 s a message). */
  advance(seconds: number) {
    send({ t: "manual" });
    for (let t = 0; t < seconds - 1e-9; t += 0.2) send({ t: "advance", seconds: Math.min(0.2, seconds - t) });
  },
  /** M6: the group marks showing now. */
  get groupMarks() {
    return groupMarks.visible;
  },
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
  /** After M5: lay a slot's gun on a point in still air (the aim solver the AI uses); false if it cannot reach. */
  aimAtPoint(emp: number, x: number, y: number, z: number) {
    const sol = solveAim(EMP[emp], x, y, z);
    if (!sol) return false;
    aims[emp] = clampAim({ yaw: sol.yaw, pitch: sol.pitch }, EMP[emp], weaponOf(EMP[emp]));
    wanted[emp] = { ...aims[emp] };
    return true;
  },
  /** After M5: how far the mortar's spotter looks along the bearing (m). */
  lookAt(emp: number, d: number) {
    lookD[emp] = d;
  },
  /** After M5: hold the mortar's charge at a level (0..1) without a key, or (null) let it go: the shell leaves at that level. */
  holdCharge(level: number | null) {
    const now = clock();
    if (level === null) {
      testHold = false;
      releaseCharge(now);
      return;
    }
    testHold = true;
    charging = { start: now - level * CHARGE_SWEEP * 1000, slot: current, ticks: 0 };
    needle = level;
  },
  get chargeRange() {
    return chargeRange;
  },
  /** After M5: every emplacement's knocked-out state as last reported ([state, ticks left] each). */
  get gunOut() {
    return Array.from(gunOut);
  },
};
