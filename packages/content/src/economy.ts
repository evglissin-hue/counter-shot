// The match's economy and clock, as data (phase 2 M1 and M3): where gold comes
// from and what it costs. Building, gun and upgrade prices live with their
// own data (buildings.ts, slots.ts), unit costs and bounties with the units.

export const MATCH = {
  /** Gold each castle starts with. */
  startGold: 250,
  /** Gold a standing keep earns its castle every `incomeEvery` ticks, and each working Powder Mill. */
  keepIncome: 5,
  millIncome: 2,
  incomeEvery: 60,
  /** One gold for every this many pieces of enemy masonry (castle and buildings) brought down. */
  masonryPer: 4,
  /** Knocking down an enemy building pays this share of its cost. */
  buildingBounty: 1 / 3,
  /** Sudden death (M4) starts here; the clock shows it from the first match. */
  suddenDeathTick: 15 * 60 * 60,
} as const;

/** Trick shots: bonuses for what a gunner's own shot does (never the guns nobody rides). */
export const TRICKS = {
  /** A ball that glanced off masonry and then knocked an enemy down. */
  ricochet: 20,
  /** Each enemy knocked down by masonry the shot brought down. */
  collapse: 10,
  /** Three or more enemies down from one shot: this much, plus `multiEach` for every one beyond three. */
  multi: 15,
  multiEach: 5,
  multiFrom: 3,
  /** A shot that strikes the enemy keep (its walls or floors). */
  keep: 10,
  /** A sapper's keg set off on its way, by the shot. */
  keg: 20,
} as const;
