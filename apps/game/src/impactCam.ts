// The impact cam (show track, step S2): when a shot you fired by hand is about a
// second from landing, an inset opens on the landing from a camera that stands
// clear of the masonry, live, pushes in slowly and closes 3 s after the landing.
//
// The page only draws: nothing here touches a match. A shot's landing is
// predicted the way the aim help does it (predictPath from the shot's own
// state each frame, then the renderer's castPath against the masonry as it
// stands), and corrected by what the sim reports (EventKind.Landed, a shell's
// burst, the shot leaving the frame). Other code asks for the inset with
// openImpactCam (a moment worth seeing opens it the same way).

import { predictPath, type FlightCoef } from "@keepfall/sim";
import type { InsetPose, InsetRect, PathHit } from "./render/api";

/** The inset opens this long before a landing. */
export const LEAD_MS = 1000;
/** It stays this long after the landing. */
export const HOLD_MS = 3000;
/** The fade to black as it closes. */
const CLOSE_FADE_MS = 250;
/** How far the camera stands from the landing (m), and how high above it, in the order tried at each bearing. */
const STANDS: ReadonlyArray<readonly [number, number]> = [
  [35, 9],
  [40, 12],
  [30, 6],
];
/** Bearings tried from the shot's line, in degrees: right and left of it first, then the rest. */
const BEARINGS = [90, -90, 60, -60, 120, -120, 30, -30, 150, -150, 0, 180];
/** The camera ends this much closer than it began. */
const PUSH_IN = 0.15;
const FOV = 45;
const STORE_KEY = "keepfall.impactCam";

export type ImpactReason = "shot" | "moment";

export interface ImpactDeps {
  groundAt(x: number, z: number): number;
  /** Is the straight line between two points cut by masonry? */
  sightBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  /** The first stone or ground a path runs into. */
  castPath(path: Float32Array): PathHit | null;
}

interface Request {
  reason: ImpactReason;
  at: { x: number; y: number; z: number };
  /** The shot's gun (x, z), for the side the camera stands on; null for a moment. */
  from: { x: number; z: number } | null;
  /** When it lands (page ms), and when it did (0: not yet). */
  landsAt: number;
  landedAt: number;
  /** The tracked shot this follows (-1: none). */
  shotId: number;
  /** When it first showed (0: armed, not shown yet). */
  shownAt: number;
  /** The place the camera stands, as an offset from the landing (the stand it was chosen for is `standFor`). */
  stand: { x: number; y: number; z: number } | null;
  standFor: { x: number; y: number; z: number };
}

interface Shot {
  id: number;
  /** The gun's match id: a Landed event names it. */
  emp: number;
  from: { x: number; z: number };
  coef: FlightCoef;
  spin: [number, number, number] | null;
  firedAt: number;
  last: { x: number; y: number; z: number } | null;
  landed: boolean;
}

let enabled = true;
try {
  if (localStorage.getItem(STORE_KEY) === "0") enabled = false;
} catch {
  // Works without storage.
}
let clock: () => number = () => performance.now();
let deps: ImpactDeps | null = null;
/** The frame pacer holds the lowest resolution: the inset stays closed. */
let suspended = false;
/** Tests: ignore the frame pacer (software rendering sits at its floor). */
let ignorePacer = false;
let cur: Request | null = null;
let swapped = false;
/** While the inset fades out: when it is gone (0: not closing) and the pose it holds. */
let closingUntil = 0;
const shots = new Map<number, Shot>();
/** The camera as drawn: eye and the point it looks at (eased), and whether it has been placed. */
const cam = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, placed: false };
let lastPose: InsetPose | null = null;
let frameEl: HTMLElement | null = null;

export function setImpactClock(fn: () => number) {
  clock = fn;
}

export function setImpactDeps(d: ImpactDeps) {
  deps = d;
}

/** The page's frame pacer is at its lowest resolution (or not): the inset closes and stays shut while it is. */
export function setImpactPaced(atFloor: boolean) {
  suspended = atFloor && !ignorePacer;
}

/** Test hook: draw the inset whatever the frame pacer says. */
export function setImpactIgnorePacer(on: boolean) {
  ignorePacer = on;
  if (on) suspended = false;
}

export function impactEnabled(): boolean {
  return enabled;
}

/** K: the impact cam on or off, remembered per viewer. */
export function setImpactEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(STORE_KEY, on ? "1" : "0");
  } catch {
    // Works without storage.
  }
  if (!on) closeImpactCam();
}

export function closeImpactCam() {
  cur = null;
  shots.clear();
  swapped = false;
  closingUntil = 0;
  cam.placed = false;
  lastPose = null;
}

/** What is open, for tests and the HUD. */
export function impactState(): { open: boolean; shown: boolean; reason: ImpactReason | null; swapped: boolean; enabled: boolean; msToLanding: number } {
  const now = clock();
  return {
    open: !!cur,
    shown: !!cur && cur.shownAt > 0,
    reason: cur ? cur.reason : null,
    swapped,
    enabled,
    msToLanding: cur ? Math.round(cur.landsAt - now) : 0,
  };
}

/**
 * Ask for the inset on a point that is about to be worth seeing: `at` is where, `landsInMs` how long from now
 * (0: it is happening). It opens LEAD_MS before then and stays HOLD_MS after. A newer request replaces the open
 * one only if it is a "shot", or the open one is a "moment". `from` (the shot's gun) is where the shot came from,
 * so the camera stands to one side of its line.
 */
export function openImpactCam(at: { x: number; y: number; z: number }, landsInMs: number, reason: ImpactReason, from: { x: number; z: number } | null = null): void {
  openRequest(at, landsInMs, reason, from, -1);
}

function openRequest(at: { x: number; y: number; z: number }, landsInMs: number, reason: ImpactReason, from: { x: number; z: number } | null, shotId: number) {
  if (!enabled || suspended) return;
  if (cur && !(reason === "shot" || cur.reason === "moment")) return;
  const now = clock();
  const keep = cur && cur.shownAt > 0 ? cur : null;
  cur = {
    reason,
    at: { x: at.x, y: at.y, z: at.z },
    from,
    landsAt: now + Math.max(0, landsInMs),
    landedAt: 0,
    shotId,
    shownAt: keep ? keep.shownAt : 0,
    stand: null,
    standFor: { x: at.x, y: at.y, z: at.z },
  };
  closingUntil = 0;
}

// ---- shots you fire by hand ---------------------------------------------------------------

/** A shot you fired by hand left the muzzle (not the swivel; not a mortar shell the main view rides). */
export function shotFired(id: number, emp: number, from: { x: number; z: number }, coef: FlightCoef, spin: [number, number, number] | null): void {
  if (shots.size > 12) for (const [k, s] of shots) if (clock() - s.firedAt > 20000) shots.delete(k);
  shots.set(id, { id, emp, from, coef, spin, firedAt: clock(), last: null, landed: false });
}

/** Seconds of flight along a path sampled every 2 ticks, up to a hit. */
export function pathTime(path: Float32Array, hit: PathHit): number {
  const i = hit.index;
  const ax = path[i * 3], ay = path[i * 3 + 1], az = path[i * 3 + 2];
  const bx = path[i * 3 + 3] ?? ax, by = path[i * 3 + 4] ?? ay, bz = path[i * 3 + 5] ?? az;
  const seg = Math.hypot(bx - ax, by - ay, bz - az);
  const frac = seg > 0 ? Math.min(1, Math.hypot(hit.x - ax, hit.y - ay, hit.z - az) / seg) : 0;
  return ((i + frac) * 2) / 60;
}

/** Where a shot in this state comes down, and in how many seconds of sim time. */
export function predictLanding(
  p: [number, number, number],
  v: [number, number, number],
  spin: [number, number, number] | null,
  wind: { x: number; z: number },
  coef: FlightCoef,
  d: Pick<ImpactDeps, "groundAt" | "castPath">,
): { x: number; y: number; z: number; t: number } | null {
  const path = predictPath(p, v, spin, wind.x, wind.z, coef, 14, 2);
  const hit = d.castPath(path);
  if (hit) return { x: hit.x, y: hit.y, z: hit.z, t: pathTime(path, hit) };
  // The path stops at y = 0, level ground; the valley lies lower in places, so carry it on down to the ground.
  const n = path.length / 3;
  const ex = path[n * 3 - 3], ey = path[n * 3 - 2], ez = path[n * 3 - 1];
  if (ey > 1) return null; // still in the air after 14 s: it never lands
  return { x: ex, y: Math.min(ey, d.groundAt(ex, ez)), z: ez, t: ((n - 1) * 2) / 60 };
}

/** A tracked shot's state in the frame just applied (page ms `now`, the sim's speed `timeScale`). */
export function shotSeen(id: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, wind: { x: number; z: number }, timeScale: number): void {
  const s = shots.get(id);
  if (!s || s.landed || !deps || !enabled || suspended) return;
  s.last = { x, y, z };
  const hit = predictLanding([x, y, z], [vx, vy, vz], s.spin, wind, s.coef, deps);
  if (!hit) return;
  const ms = (hit.t * 1000) / Math.max(0.05, timeScale);
  if (!Number.isFinite(ms)) return;
  if (cur && cur.shotId === id) {
    // The same shot, better known: move the landing and its time (the camera glides).
    cur.at.x = hit.x;
    cur.at.y = hit.y;
    cur.at.z = hit.z;
    if (!cur.landedAt) cur.landsAt = clock() + ms;
  } else {
    // Another of your shots in the air: the newest one is the one shown.
    const open = cur && cur.shotId >= 0 ? shots.get(cur.shotId) : null;
    if (cur && cur.reason === "shot" && open && !open.landed && open.firedAt > s.firedAt) return;
    openRequest(hit, ms, "shot", s.from, id);
  }
}

/** Shots the frame no longer holds are down: the landing is where each was last seen. */
export function shotsGone(seen: Set<number>): void {
  for (const [id, s] of shots) {
    if (seen.has(id) || s.landed) continue;
    if (s.last) landed(s, s.last.x, s.last.y, s.last.z);
    else shots.delete(id);
  }
}

/** EventKind.Landed for a gun's shot: where its first touch was. */
export function shotLanded(emp: number, x: number, y: number, z: number): void {
  for (const s of shots.values()) if (s.emp === emp && !s.landed) return void landed(s, x, y, z);
}

/** A shell burst at a point: a tracked shot that was near it is down there. */
export function shotBurst(x: number, y: number, z: number): void {
  for (const s of shots.values()) if (!s.landed && s.last && Math.hypot(s.last.x - x, s.last.y - y, s.last.z - z) < 14) return void landed(s, x, y, z);
}

function landed(s: Shot, x: number, y: number, z: number) {
  s.landed = true;
  if (!enabled || suspended) return;
  const now = clock();
  if (cur && cur.shotId === s.id) {
    cur.at.x = x;
    cur.at.y = y;
    cur.at.z = z;
    cur.landedAt = now;
    cur.landsAt = now;
  } else if (!cur || cur.reason === "moment") {
    // It came down before it was predicted to (it hit something on the way, or the prediction failed): open at once.
    openRequest({ x, y, z }, 0, "shot", s.from, s.id);
    if (cur) (cur as Request).landedAt = now;
  }
}

// ---- where to stand --------------------------------------------------------------------------

/**
 * A place 30 to 40 m to one side of the landing and 6 to 12 m above it, looking at it: the first of the bearings
 * (right and left of the shot's line, then the rest) whose line of sight to the landing point is clear of masonry
 * and the ground. Returned as an offset from the landing.
 */
export function chooseStand(at: { x: number; y: number; z: number }, from: { x: number; z: number } | null, d: Pick<ImpactDeps, "groundAt" | "sightBlocked">): { x: number; y: number; z: number } {
  // The shot's line; a moment with no gun is seen along the valley.
  const lx = from ? at.x - from.x : 0, lz = from ? at.z - from.z : -1;
  const base = Math.atan2(lx, lz);
  const ty = at.y + 1;
  for (const deg of BEARINGS) {
    const a = base + (deg * Math.PI) / 180;
    const sx = Math.sin(a), sz = Math.cos(a);
    for (const [r, h] of STANDS) {
      const cx = at.x + sx * r, cz = at.z + sz * r;
      const cy = Math.max(at.y + h, d.groundAt(cx, cz) + 3);
      if (lineClear(cx, cy, cz, at.x, ty, at.z, d)) return { x: cx - at.x, y: cy - at.y, z: cz - at.z };
    }
  }
  // Nothing was clear: stand high on the right of the line.
  const a = base + Math.PI / 2;
  const r = 36;
  return { x: Math.sin(a) * r, y: 14, z: Math.cos(a) * r };
}

/** Is the line from the camera to the landing point clear of masonry and ground (the last 2.5 m, at the landing's own surface, are not tested)? */
function lineClear(cx: number, cy: number, cz: number, tx: number, ty: number, tz: number, d: Pick<ImpactDeps, "groundAt" | "sightBlocked">): boolean {
  const dx = tx - cx, dy = ty - cy, dz = tz - cz;
  const len = Math.hypot(dx, dy, dz);
  const k = Math.max(0, (len - 2.5) / len);
  const ex = cx + dx * k, ey = cy + dy * k, ez = cz + dz * k;
  for (let i = 1; i <= 10; i++) {
    const f = i / 10;
    const x = cx + (ex - cx) * f, y = cy + (ey - cy) * f, z = cz + (ez - cz) * f;
    if (y < d.groundAt(x, z) + 0.3) return false;
  }
  return !d.sightBlocked(cx, cy, cz, ex, ey, ez);
}

// ---- the frame ---------------------------------------------------------------------------------

/** What the page draws this frame: the pose to draw from (null: closed), and whether the views are swapped. */
export interface ImpactFrame {
  pose: InsetPose | null;
  swapped: boolean;
  /** 0 to 1: how closed it is (a fade to black while closing, and as it opens). */
  fade: number;
}

/** One frame (page ms `now`, `dt` seconds): decide whether it is open, and where its camera is. */
export function updateImpactCam(now: number, dt: number): ImpactFrame {
  const none: ImpactFrame = { pose: null, swapped: false, fade: 1 };
  if (!deps) return none;
  if ((!enabled || suspended) && cur) closeImpactCam();
  if (cur) {
    const closeAt = (cur.landedAt || cur.landsAt) + HOLD_MS;
    if (now >= closeAt) {
      // Fade out holding the last view, then closed (the views go back).
      if (cur.shownAt && lastPose) closingUntil = now + CLOSE_FADE_MS;
      cur = null;
      swapped = false;
      cam.placed = false;
    } else if (!cur.shownAt && now >= cur.landsAt - LEAD_MS) {
      cur.shownAt = now;
      cur.stand = null;
    }
  }
  if (cur && cur.shownAt) {
    const r = cur;
    // Stand again when the landing has moved well away from where the stand was chosen.
    if (!r.stand || Math.hypot(r.at.x - r.standFor.x, r.at.z - r.standFor.z) > 8) {
      r.stand = chooseStand(r.at, r.from, deps);
      r.standFor = { x: r.at.x, y: r.at.y, z: r.at.z };
    }
    const closeAt = (r.landedAt || r.landsAt) + HOLD_MS;
    const prog = Math.max(0, Math.min(1, (now - r.shownAt) / Math.max(1, closeAt - r.shownAt)));
    const k = 1 - PUSH_IN * prog;
    const wx = r.at.x + r.stand.x * k, wy = r.at.y + r.stand.y * k, wz = r.at.z + r.stand.z * k;
    const lx = r.at.x, ly = r.at.y + 1, lz = r.at.z;
    if (!cam.placed) {
      Object.assign(cam, { px: wx, py: wy, pz: wz, lx, ly, lz, placed: true });
    } else {
      const e = 1 - Math.exp(-Math.max(0, dt) * 4);
      cam.px += (wx - cam.px) * e;
      cam.py += (wy - cam.py) * e;
      cam.pz += (wz - cam.pz) * e;
      cam.lx += (lx - cam.lx) * e;
      cam.ly += (ly - cam.ly) * e;
      cam.lz += (lz - cam.lz) * e;
    }
    lastPose = { x: cam.px, y: cam.py, z: cam.pz, tx: cam.lx, ty: cam.ly, tz: cam.lz, fov: FOV };
    const opening = Math.max(0, 1 - (now - r.shownAt) / 300);
    return { pose: lastPose, swapped, fade: opening };
  }
  if (closingUntil && now < closingUntil && lastPose) {
    return { pose: lastPose, swapped: false, fade: 1 - (closingUntil - now) / CLOSE_FADE_MS };
  }
  closingUntil = 0;
  lastPose = null;
  return none;
}

// ---- the frame on the page -----------------------------------------------------------------------

/** Click on the inset: it swaps with the main view until it closes. */
export function swapImpactViews() {
  if (cur && cur.shownAt) swapped = !swapped;
}

/**
 * Bind the HUD's frame: shown while the inset is open, a click on it swaps the views.
 * `onSwap` lets the page restyle itself (the gun's reticle is not the swapped view's).
 */
export function bindImpactFrame(el: HTMLElement, onSwap: (on: boolean) => void) {
  frameEl = el;
  el.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    swapImpactViews();
    onSwap(swapped);
  });
  el.addEventListener("mousedown", (e) => e.stopPropagation());
}

/** Show or hide the frame and measure where it sits on the canvas (CSS pixels from the canvas's top left). */
export function placeImpactFrame(f: ImpactFrame, canvas: HTMLCanvasElement): InsetRect {
  const el = frameEl;
  const open = !!f.pose;
  if (el) {
    if (el.hidden === open) el.hidden = !open;
    el.style.setProperty("--shade", String(Math.round(f.fade * 100) / 100));
    el.classList.toggle("swapped", f.swapped);
  }
  if (!open || !el) return { x: 0, y: 0, w: 0, h: 0 };
  const r = el.getBoundingClientRect(), c = canvas.getBoundingClientRect();
  return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
}

