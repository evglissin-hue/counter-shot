// The AI castle (phase 2 M5), as data: how quick, how accurate and how
// thrifty each difficulty is, and the build plan each one follows. The AI
// itself (@keepfall/ai) reads the match and sends the same inputs a player
// does; nothing here gives it powers a player lacks.
// Starting numbers for tuning: everything here is data.

import type { BuildingKind } from "./buildings";
import type { MixName } from "./army";
import type { RouteName } from "./map";
import type { RepairKind } from "./siege";
import type { UpgradeKind, WeaponKind } from "./weapons";

export type Difficulty = "squire" | "knight" | "warlord";
export const DIFFICULTIES: Difficulty[] = ["squire", "knight", "warlord"];
/**
 * M6: every AI there is: Versus AI's three difficulties (the menu offers only
 * those), and the tutor, the passive castle of the guided first match that
 * wakes up in stages (TUTOR).
 */
export type AiName = Difficulty | "tutor";

export interface AiLevel {
  name: string;
  /** What it says about itself on the start menu. */
  blurb: string;
  /** Ticks between looks at the field: choosing a target and a gun. */
  think: number;
  /** Ticks from deciding something to doing it (reaction time). */
  react: number;
  /** Ticks after taking a gun before it fires it (getting its eye in). */
  settle: number;
  /** Ticks after a shot lands before the next one leaves (watching, correcting), on top of the reload. */
  look: number;
  /**
   * Ticks into the match before its first shot by hand: you get a moment to
   * take your own gun before its shots come in (it takes its gun and lays it
   * meanwhile, so you can watch the barrel turn).
   */
  warmup: number;
  /**
   * Aim. A new target's first shot is off by up to `firstErr` (rad, either
   * way, for flat fire) or `firstErrM` metres plus `firstErrPerM` of the range
   * (lobbed shells); every shot after adds the hand's own noise (`noise`, rad,
   * or `noiseM` m for shells). After each landing it takes `learn` of the
   * miss out of its aim, so the wind and its first error are corrected away
   * over a few shots, as you do with your trail and landing marker.
   */
  firstErr: number;
  firstErrM: number;
  firstErrPerM: number;
  noise: number;
  noiseM: number;
  learn: number;
  /** Share of its looks at the field in which it picks the best target rather than whatever is in front of it. */
  focus: number;
  /** It fires its mortar on enemy minions at its own gate (big events: only on a crowd of at least this many). */
  crowd: number;
  /** It shells the enemy's buildings and masons, not only walls, gate and keep. */
  raids: boolean;
  /**
   * After M5: in this share of its looks at the field it goes after the enemy
   * gun that has hit its castle in the last 20 seconds: its chain shot sweeps
   * the crew off a wall or tower, its mortar shells a mortar pit. 0: never.
   * After knocking a gun out it leaves the guns alone for `counterRest` ticks.
   */
  counter: number;
  counterRest: number;
  /** Ticks between looks at its build plan, its barracks, its orders and its repairs. */
  plan: number;
  /** Gold it keeps back for its masons before it builds or buys. */
  reserve: number;
  /** It sets its barracks' mixes and routes from what it sees (else it keeps its plan's). */
  adapts: boolean;
  /**
   * 3.2: what it marks (REGISTER), only where its own shot by hand landed:
   * 0 nothing; 1 the road just short of each bridge on its own side and the
   * ground before its own gate (in its warm-up and quiet looks); 2 also an
   * enemy gun it has hit and the foot of the wall it is breaching.
   */
  marks: 0 | 1 | 2;
  /** 3.2: it orders fire for effect (REGISTER.aiSalvoMen men on a mark, or its wall mark as its waves near it). */
  salvo: boolean;
  /** 3.2: when a bridge is down it sends a wave down that road, so a gang relays it (REGISTER.gang*). */
  gangs: boolean;
}

export const AI_LEVELS: Record<AiName, AiLevel> = {
  squire: {
    name: "Squire",
    blurb: "Slow to aim and slow to learn; spends when it remembers. The level to start on after the guided match",
    think: 4 * 60,
    react: 50,
    settle: 4 * 60,
    look: 6 * 60,
    warmup: 40 * 60,
    firstErr: 0.03,
    firstErrM: 9,
    firstErrPerM: 0.06,
    noise: 0.011,
    noiseM: 4,
    learn: 0.35,
    focus: 0.35,
    crowd: 7,
    raids: false,
    counter: 0,
    counterRest: 0,
    plan: 9 * 60,
    reserve: 40,
    adapts: false,
    marks: 0,
    salvo: false,
    gangs: false,
  },
  knight: {
    name: "Knight",
    blurb: "A fair gunner who corrects every shot and runs a tidy castle",
    think: 2 * 60,
    react: 30,
    settle: 2 * 60,
    look: 100,
    warmup: 15 * 60,
    firstErr: 0.018,
    firstErrM: 6,
    firstErrPerM: 0.04,
    noise: 0.005,
    noiseM: 2.2,
    learn: 0.6,
    focus: 0.7,
    crowd: 5,
    raids: true,
    counter: 0.2,
    counterRest: 75 * 60,
    plan: 4 * 60,
    reserve: 60,
    adapts: true,
    marks: 1,
    salvo: true,
    gangs: true,
  },
  warlord: {
    name: "Warlord",
    blurb: "Quick, sharp-eyed and ruthless with its gold",
    think: 60,
    react: 18,
    settle: 70,
    look: 40,
    warmup: 5 * 60,
    firstErr: 0.01,
    firstErrM: 3.5,
    firstErrPerM: 0.025,
    noise: 0.0028,
    noiseM: 1.2,
    learn: 0.8,
    focus: 0.92,
    crowd: 4,
    raids: true,
    counter: 0.3,
    counterRest: 45 * 60,
    plan: 2 * 60,
    reserve: 80,
    adapts: true,
    marks: 2,
    salvo: true,
    gangs: true,
  },
  // M6: the guided first match's castle. Placeholder numbers (a slower,
  // looser Squire); the tutor's stages (TUTOR) decide when it does anything at all.
  tutor: {
    name: "Tutor",
    blurb: "The guided first match: asleep at first, it wakes up slowly",
    think: 8 * 60,
    react: 90,
    settle: 8 * 60,
    look: 14 * 60,
    warmup: 0, // its stages (TUTOR) decide when it fires by hand at all
    firstErr: 0.06,
    firstErrM: 20,
    firstErrPerM: 0.1,
    noise: 0.02,
    noiseM: 8,
    learn: 0.15,
    focus: 0.3,
    crowd: 9,
    raids: false,
    counter: 0,
    counterRest: 0,
    plan: 6 * 60,
    reserve: 40,
    adapts: false,
    marks: 0,
    salvo: false,
    gangs: false,
  },
};

/**
 * One step of an AI's build plan. Steps are taken in order, each as soon as
 * it can be paid for above the reserve; one that can no longer be done (the
 * plot is taken, the slot armed) is passed over. `after` holds a step back
 * until that many seconds of the match have passed. Slots are the castle's
 * own (0 to 7), plots its own (0 to 5).
 */
export type AiStep =
  | { kind: "build"; plot: number; building: BuildingKind; mix?: MixName; route?: RouteName; after?: number; stage?: number }
  | { kind: "buy"; slot: number; weapon: WeaponKind; after?: number; stage?: number }
  | { kind: "upgrade"; slot: number; upgrade: UpgradeKind; after?: number; stage?: number };

export const AI_PLANS: Record<AiName, AiStep[]> = {
  // A slow, plain plan: a mill, then guns, a second barracks late.
  squire: [
    { kind: "build", plot: 1, building: "mill", after: 60 },
    { kind: "buy", slot: 4, weapon: "swivel", after: 150 },
    { kind: "build", plot: 2, building: "barracks", mix: "pikemen", route: "centre", after: 240 },
    { kind: "build", plot: 4, building: "mill", after: 330 },
    { kind: "buy", slot: 5, weapon: "chainShot", after: 420 },
    { kind: "build", plot: 3, building: "foundry", after: 540 },
    { kind: "upgrade", slot: 0, upgrade: "heavyShot", after: 600 },
  ],
  // Economy first, then a second front and a second mortar.
  knight: [
    { kind: "build", plot: 1, building: "mill", after: 20 },
    { kind: "build", plot: 2, building: "barracks", mix: "breach", route: "left", after: 90 },
    { kind: "build", plot: 4, building: "mill", after: 150 },
    { kind: "buy", slot: 4, weapon: "chainShot", after: 200 },
    { kind: "build", plot: 3, building: "foundry", after: 240 },
    { kind: "upgrade", slot: 0, upgrade: "heavyShot" },
    { kind: "buy", slot: 7, weapon: "mortar", after: 330 },
    { kind: "buy", slot: 5, weapon: "swivel" },
    { kind: "build", plot: 5, building: "barracks", mix: "volley", route: "right", after: 450 },
    { kind: "upgrade", slot: 1, upgrade: "quickLoader" },
    { kind: "buy", slot: 6, weapon: "longGun", after: 600 },
  ],
  // Fast mills, three barracks and the guns to break a keep.
  warlord: [
    { kind: "build", plot: 1, building: "mill" },
    { kind: "build", plot: 4, building: "mill", after: 45 },
    { kind: "build", plot: 2, building: "barracks", mix: "breach", route: "left", after: 70 },
    { kind: "build", plot: 3, building: "foundry", after: 120 },
    { kind: "upgrade", slot: 1, upgrade: "quickLoader" },
    { kind: "buy", slot: 7, weapon: "mortar", after: 180 },
    { kind: "upgrade", slot: 0, upgrade: "heavyShot" },
    { kind: "build", plot: 5, building: "barracks", mix: "volley", route: "right", after: 240 },
    { kind: "buy", slot: 4, weapon: "chainShot" },
    { kind: "buy", slot: 6, weapon: "longGun", after: 330 },
    { kind: "upgrade", slot: 7, upgrade: "heavyShell" },
    { kind: "buy", slot: 5, weapon: "swivel" },
    { kind: "upgrade", slot: 6, upgrade: "rifled" },
  ],
  // M6: the tutor raises its barracks when it stirs (its castle starts without one: GUIDED_OPTIONS in @keepfall/rules), then a mill, then a swivel once it fights.
  // `stage` holds a step back until the tutor has reached that stage (TUTOR below).
  tutor: [
    { kind: "build", plot: 0, building: "barracks", mix: "pikemen", route: "left", stage: 1 },
    { kind: "build", plot: 1, building: "mill", stage: 1 },
    { kind: "buy", slot: 4, weapon: "swivel", stage: 3 },
  ],
};

/**
 * M6: the tutor's stages (seconds of match time; the AI turns them to ticks).
 * Stage 0 asleep, 1 stirs, 2 wakes, 3 fights. The stage only goes up, one at a
 * time, judged from the match alone (what the player has built, bought and
 * ordered), so a guided match replays from its seed and the player's inputs.
 */
export const TUTOR = {
  /** Stage 1: once the player has built, bought or ordered, but not before `stirsFrom`; at `stirsBy` at the latest. */
  stirsFrom: 90,
  stirsBy: 320,
  /** Stage 2: this long after stage 1, or once the player's order is Advance or Push, but not before `wakesSoonest` after stage 1. */
  wakesAfter: 90,
  wakesSoonest: 30,
  /** Stage 3: this long after stage 2. */
  fightsAfter: 150,
  /**
   * Its first `sneak` waves come down a road the player's waves are not
   * holding (something to stop with the guns: the guided match's lesson);
   * later ones take the road the player's waves hold or are sent down, so a
   * castle that never sends its waves is not ground down by the tutor. One:
   * with two, a castle that never moved was stormed at about 8:00 on two
   * seeds of five (sixteen men at its gate before its defence mustered).
   */
  sneak: 1,
  /** Its barracks' mix at each stage (sappers carry kegs from stage 3: something to shoot). */
  mixes: ["pikemen", "pikemen", "pikemen", "breach"] as MixName[],
  /**
   * What it repairs at each stage: never its keep, and never its gate (the
   * player's chair: its masons hung gate leaves back as fast as the player's
   * pikemen battered them off, so waves alone could never break in; ten
   * minutes of waves at its gate and no storm began). Walls and towers mended
   * show the masons at work and close the breaches a long gun opens.
   */
  repairs: [[], [], ["walls"], ["walls", "towers"]] as RepairKind[][],
};
