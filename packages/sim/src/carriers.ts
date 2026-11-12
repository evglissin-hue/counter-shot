// Powder in the world (phase 3 milestone 3.3): each castle's store of powder,
// the ready box beside every gun, and the three powder boys who carry kegs
// from the store to the guns. CONTRACT (the master's): the types and the
// public surface below are fixed; the executor building the sim fills in the
// behaviour (docs/phase-3/03-powder.md, POWDER in @keepfall/content).
//
// - The store: whole charges per team, in its magazine (a working "magazine"
//   building on one of its plots, cap POWDER.magazineCap) or, with no working
//   magazine, in the keep's cellar (cap POWDER.cellarCap). The rules make
//   powder (Economy: the cellar and the mills, whole charges paid every second)
//   and pay it in with store(); what does not fit is lost. A match starts with
//   POWDER.start in the store. The stock never passes the cap: when the cap
//   falls (the magazine stops working) the stock above it is lost, unless the
//   magazine blew (then everything in it is lost anyway).
// - Boxes: per emplacement, its charges now (start full: boxSize; an empty
//   slot holds none; a gun bought later arrives with its box full: armed()).
//   canPay(emp) says whether its box holds a shot's cost (shotCost); pay(emp)
//   takes it when the gun fires (SandboxSim.apply calls it for every shot,
//   by hand, by its crew or in a salvo; it refuses a fire canPay refuses).
// - Boys: POWDER.boys per castle, Unit.PowderBoy minions with Role.Carrier in
//   the minion list (a wave of their own, like the masons' crew), spawned at
//   keepDoor(). Each repeats an errand: choose the gun most in need (POWDER.topUp
//   order: the gun the team rides, then a gun that cannot fire, then the
//   emptiest under topUp), walk to the store (magazineDoor of the working
//   magazine, else keepDoor), take a keg (POWDER.take ticks; the amount is
//   what the gun has room for with what is already on its way, at most
//   POWDER.keg, at most the stock, taken out of the stock then), walk to
//   powderFoot(e), hoist it (POWDER.hoist ticks; then the box gains it, up to
//   its size), and go back. The team that rides a gun is asked through the
//   policy. They run from enemy men within POWDER.flee as masons do, with their
//   kegs. A boy who falls is replaced at keepDoor after POWDER.respawn ticks.
//   A boy who cannot reach a gun's foot for POWDER.stuck ticks hoists from
//   where he stands within POWDER.reach of it, or takes the keg to the next
//   gun in need (that gun passed over for POWDER.skip ticks).
// - Kegs burst: a boy knocked down while he carries a keg, by anything but a
//   blow (a ball, a burst, falling masonry), sets it off where he lies: a
//   sapper's keg (KEG.burst) through SandboxSim.explode, credited to the shot
//   that knocked him down. Knocked down by a blow, the keg drops unlit and is
//   lost. A boy on his way back carries nothing and sets nothing off. A burst
//   that knocks a carrying boy down sets his keg off on the same tick or the
//   next (kegs set off kegs).
// - The magazine blows (afterStep): when a burst's centre comes inside it
//   (POWDER.inside, POWDER.insideY) or it is wrecked (it was working and is a
//   ruin now) with powder in it, the whole stock goes up as one burst at its
//   middle (magazineBurst(stock)); the stock is lost. An empty magazine makes
//   none. A Powder Mill that is wrecked while it works bursts like one keg
//   (KEG.burst at its middle). Each is an event (EventKind.MagazineBlew,
//   EventKind.MillBlew) and a burst like any other (it sets off kegs and
//   knocks men down, credited to the shot that set it off, -1 for none).
// - Practice range: no Carriers (SandboxSim.carriers is null): boxes never
//   empty, every fire is paid for. A match with MatchOptions.powder false
//   (the keep match: a test about the keep alone) has none either.
//
// Deterministic: crews and boys in a fixed order, Rapier's queries sorted,
// + - * / and comparisons, no Rng draws (nothing here is random).

import type { Emplacement } from "@keepfall/content";

/** What a boy is doing (Minion.task). */
export const enum BoyTask {
  /** Waiting at the store for a gun in need. */
  Idle = 0,
  /** Walking to the store for a keg. */
  ToStore = 1,
  /** Taking a keg (Minion.cool counts down). */
  Take = 2,
  /** Carrying a keg to a gun's foot. */
  Carry = 3,
  /** Hoisting it up (Minion.cool counts down). */
  Hoist = 4,
  /** Walking back to the store, empty handed. */
  Back = 5,
  /** Running from enemy men (with his keg, if he has one). */
  Flee = 6,
}

/** What the match decides about powder: which emplacement each team rides (served first). */
export interface CarriersPolicy {
  /** The emplacement the team rides now (-1: none). */
  riding(team: number): number;
}

/** One boy's errand, for the page and the AI. */
export interface BoyErrand {
  team: number;
  /** Minion id (-1: fallen, waiting to be replaced). */
  minion: number;
  task: BoyTask;
  /** The emplacement he serves (-1: none), and the charges in his keg (0: none). */
  emplacement: number;
  keg: number;
}

export interface CarriersStatus {
  /** Charges in the team's store, the most it holds now, and the plot of its working magazine (-1: none, the cellar). */
  stock: number;
  cap: number;
  magazine: number;
  /** Charges lost because the store was full, since the match began (the HUD says "Magazine full" while it grows). */
  lost: number;
}

export class Carriers {
  /** Set by the match; without one, no gun is served first. */
  policy: CarriersPolicy | null = null;

  /** The team's store now. */
  status(team: number): CarriersStatus {
    void team;
    throw new Error("3.3: Carriers is not built yet");
  }

  /** Pay made powder into the team's store; returns the charges that did not fit (lost). */
  store(team: number, charges: number): number {
    void team;
    void charges;
    throw new Error("3.3: Carriers is not built yet");
  }

  /** Room left in the team's store (cap minus stock). */
  room(team: number): number {
    void team;
    throw new Error("3.3: Carriers is not built yet");
  }

  /** Charges in an emplacement's ready box now, and the most it holds. */
  box(emp: number): number {
    void emp;
    throw new Error("3.3: Carriers is not built yet");
  }
  boxCap(emp: number): number {
    void emp;
    throw new Error("3.3: Carriers is not built yet");
  }

  /** Does the box hold a shot's cost now? (An empty slot: false.) */
  canPay(emp: number): boolean {
    void emp;
    throw new Error("3.3: Carriers is not built yet");
  }

  /** The gun fires: take a shot's cost from its box (false, and nothing taken, if it cannot pay). */
  pay(emp: number): boolean {
    void emp;
    throw new Error("3.3: Carriers is not built yet");
  }

  /** A gun was bought for an empty slot (the rules call it): its box starts full. */
  armed(e: Emplacement): void {
    void e;
    throw new Error("3.3: Carriers is not built yet");
  }

  /** For the page: ticks until the next keg reaches this emplacement's box (-1: none on its way), and the share of a hoist done at its foot (-1: none at work). */
  eta(emp: number): number {
    void emp;
    throw new Error("3.3: Carriers is not built yet");
  }
  hoisting(emp: number): number {
    void emp;
    throw new Error("3.3: Carriers is not built yet");
  }

  /** Every boy of both castles, castle 0's first, in a fixed order. */
  errands(): BoyErrand[] {
    throw new Error("3.3: Carriers is not built yet");
  }

  /** Boys think and move (after the army's step, before physics). */
  step(tick: number): void {
    void tick;
    throw new Error("3.3: Carriers is not built yet");
  }

  /** After the physics step and the bursts of the step: kegs that go off with fallen boys, the magazine and mills that blow. */
  afterStep(tick: number): void {
    void tick;
    throw new Error("3.3: Carriers is not built yet");
  }

  hashInto(out: number[]): void {
    void out;
    throw new Error("3.3: Carriers is not built yet");
  }
}
