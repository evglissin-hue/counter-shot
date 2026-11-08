// The match's economy and clock, as data. Phase 2 M1 has only the keep's own
// income; mills, bounties, masonry and trick shots join in M3. Since M4 gold
// pays for repairs (see siege.ts).

export const MATCH = {
  /** Gold each castle starts with. */
  startGold: 150,
  /** Gold a standing keep earns its castle every `incomeEvery` ticks. */
  keepIncome: 5,
  incomeEvery: 60,
  /** Sudden death starts here: income doubles and every gun reloads in `suddenReload` of its time. */
  suddenDeathTick: 15 * 60 * 60,
  suddenIncome: 2,
  suddenReload: 0.6,
} as const;
