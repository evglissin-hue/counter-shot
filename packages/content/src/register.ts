// Range and register (phase 3 milestone 3.2), as data: marks made from your
// own shots, guns nobody mans shooting true on marked ground, fire for effect
// (a salvo of every gun that bears), and bridge gangs relaying a blown deck.
// Starting numbers for tuning: everything here is data (docs/phase-3/02-range-and-register.md).

export const REGISTER = {
  /** Ticks after a shot by hand comes down during which its landing may be marked (5 s). */
  window: 5 * 60,
  /** A mark's radius (m) around the landing point. */
  radius: 6,
  /** Marks a team holds at once; one more replaces the oldest. */
  max: 6,
  /** Ticks a mark lasts (180 s); a shot by hand of the team landing inside it refreshes it. */
  life: 180 * 60,
  /** A gun nobody mans laying on a man inside one of its team's marks: its error times this (errBase and errPerM). */
  errScale: 0.25,
  /** ... and its reload, as a share of the weapon's own (instead of UNMANNED's reload). */
  reload: 2,
  /** ... and the man is chosen as if he stood at this share of his distance from its gate (and anywhere in its range, not only within DEFEND). */
  nearScale: 0.5,
  /** Fire for effect: the salvo's shots are spread over this many ticks (1.5 s), from the gun nearest the mark outwards. */
  salvoSpan: 90,
  /** Ticks between a team's salvos (20 s). */
  salvoEvery: 20 * 60,
  /** Bridge gangs: men taken from a wave, how close an enemy may be to the bridge's near end (m) before they stop, ticks to relay a deck (40 s), and its cost in gold. */
  gangMen: 2,
  gangClear: 20,
  gangTicks: 40 * 60,
  gangCost: 60,
  /** The AI (from a Knight up): a salvo when this many enemy men stand on a mark, or on its wall mark when its own waves are within `wallNear` m of it. */
  aiSalvoMen: 6,
  aiWallNear: 30,
};
