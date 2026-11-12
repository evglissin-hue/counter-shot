// The gun's kick and its reload stage (look round L1): pure rules, no three, so Node can test them.
//
// A gun that has fired leaps back on its carriage, stays back while the crew load, and is run out again late in
// the reload, so a gun that sits run out is a loaded gun. All of it is a function of two numbers the renderer keeps
// per gun: the age of the shot (seconds on the renderer's clock) and the reload stage (0 just fired, 1 loaded).
// Nothing here feeds the match.

import type { WeaponKind } from "@keepfall/content";

/** Metres the gun's carriage and barrel roll back on a shot (the mortar's and the swivel's are their own kick, see `kick`). */
export const RECOIL_BACK: Record<WeaponKind, number> = { longGun: 0.55, chainShot: 0.6, mortar: 0, swivel: 0.12 };
/** How long the leap back takes (s), eased to a stop. */
export const LEAP_TIME = 0.07;
/** The run out: from this reload stage to that one the crew heave the gun forward again. */
export const RUN_OUT_FROM = 0.75;
export const RUN_OUT_TO = 0.92;
/** The mortar's bed thuds down this far (m), comes back in MORTAR_TIME, and its barrel kicks up a little (radians). */
export const MORTAR_DIP = 0.05;
export const MORTAR_PITCH = 0.03;
export const MORTAR_TIME = 0.25;
/** The swivel's barrel springs back along its axis in this time (s). */
export const SWIVEL_TIME = 0.2;
/** Guns that are run out again late in the reload (the mortar and the swivel are not). */
export function runsOut(kind: WeaponKind): boolean {
  return kind === "longGun" || kind === "chainShot";
}

export function smooth01(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

/** What a gun's carriage is doing: `back` metres back along its own -Z (the swivel's: its barrel along its axis), `down` metres (the mortar's bed), `pitch` radians of extra barrel elevation. */
export interface Kick {
  back: number;
  down: number;
  pitch: number;
}

/** The kick of `kind`, `age` seconds after its shot, at reload stage `stage` (1 for a gun that never fired: age Infinity). */
export function kick(kind: WeaponKind, age: number, stage: number, out: Kick = { back: 0, down: 0, pitch: 0 }): Kick {
  out.back = 0;
  out.down = 0;
  out.pitch = 0;
  if (age < 0) age = 0;
  if (kind === "longGun" || kind === "chainShot") {
    const u = Math.min(1, age / LEAP_TIME);
    const leap = 1 - (1 - u) * (1 - u) * (1 - u);
    const run = smooth01((stage - RUN_OUT_FROM) / (RUN_OUT_TO - RUN_OUT_FROM));
    out.back = RECOIL_BACK[kind] * leap * (1 - run);
  } else if (kind === "mortar") {
    if (age < MORTAR_TIME) {
      const rise = Math.min(1, age / 0.03);
      const fall = 1 - smooth01((age - 0.03) / (MORTAR_TIME - 0.03));
      out.down = MORTAR_DIP * rise * fall;
      out.pitch = MORTAR_PITCH * rise * fall;
    }
  } else if (age < SWIVEL_TIME) {
    const rise = Math.min(1, age / 0.025);
    out.back = RECOIL_BACK.swivel * rise * (1 - smooth01((age - 0.025) / (SWIVEL_TIME - 0.025)));
  }
  return out;
}

// --- the reload stage ----------------------------------------------------------------------------

/** One gun's reload stage and what it is following. */
export interface StageState {
  /** 0 just fired .. 1 loaded. */
  stage: number;
  /** Ticks the whole reload takes (a first guess from the content, then the largest the feed has shown). */
  full: number;
  /** The stage the last feed since the shot gave, or -1 when none has come. */
  fed: number;
  /** Seconds since the last shot on the renderer's clock; Infinity for a gun that never fired. */
  age: number;
}

export function newStage(): StageState {
  return { stage: 1, full: 1, fed: -1, age: Infinity };
}

/** A shot: the reload starts over, and its length is a guess until the feed says. */
export function stageFire(s: StageState, fullGuess: number) {
  s.stage = 0;
  s.full = Math.max(1, fullGuess);
  s.fed = -1;
  s.age = 0;
}

/** The page's reload for this gun (ticks left, as the match reports it). A feed only ever moves the stage forward. */
export function stageFeed(s: StageState, left: number) {
  if (left > 0) {
    s.full = Math.max(s.full, left);
    const f = 1 - left / s.full;
    s.fed = f;
    if (f > s.stage) s.stage = f;
  } else {
    s.fed = 1;
    s.stage = 1;
  }
}

/** A frame of the renderer's own clock (slow motion slows it): the stage creeps on between feeds, never far past the last one. */
export function stageStep(s: StageState, dt: number) {
  if (dt > 0) s.age += dt;
  if (s.stage >= 1 || !(dt > 0)) return;
  const next = s.stage + (dt * 60) / s.full;
  const limit = s.fed >= 0 ? Math.min(1, s.fed + 2 / s.full) : 1;
  const to = Math.min(limit, next);
  if (to > s.stage) s.stage = to;
}

// --- the powder box --------------------------------------------------------------------------------

export const BOX_KEGS = 4;

/** Kegs shown in a gun's powder box: none for no charges, else the share of its capacity, rounded up, at most four. */
export function kegCount(charges: number, capacity: number): number {
  if (!(charges > 0)) return 0;
  if (!(capacity > 0)) return BOX_KEGS;
  return Math.min(BOX_KEGS, Math.max(1, Math.ceil((BOX_KEGS * charges) / capacity)));
}
