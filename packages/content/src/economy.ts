// The match's economy and clock, as data. Phase 2 M1 has only the keep's own
// income; mills, bounties, masonry and trick shots join in M3.

export const MATCH = {
  /** Gold each castle starts with. */
  startGold: 150,
  /** Gold a standing keep earns its castle every `incomeEvery` ticks. */
  keepIncome: 5,
  incomeEvery: 60,
  /** Sudden death (M4) starts here; the clock shows it from the first match. */
  suddenDeathTick: 15 * 60 * 60,
} as const;
