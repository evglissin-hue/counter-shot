// Buttresses for the keep (phase 3, 3.4, rule 11), as data. Kept in a file of
// their own with no imports, so the castle layout and the structures can both
// use them without importing each other.

/** The faces of a keep, in its owner's words: front (towards the gate), back, and its owner's left and right. */
export type ButtressFace = "front" | "back" | "left" | "right";
export const BUTTRESS_FACES: ButtressFace[] = ["front", "back", "left", "right"];

/**
 * Rule 11: a buttress for each face of the keep, laid out with the castle
 * (layout option buttresses) and withdrawn until it is bought. Each is two
 * stone piers against the face, `width` m wide, centred `offset` m either side
 * of the face's middle (a door's width clear between them): `low` courses
 * `deep` m out from the face, then up to `high` courses `step` m out. Its
 * stones are as hard as the keep's.
 */
export const BUTTRESS = {
  gold: 120,
  /** Ticks to rise, like a building (15 s). */
  buildTicks: 15 * 60,
  width: 2.5,
  offset: 2.5,
  low: 8,
  deep: 1.2,
  high: 14,
  step: 0.6,
} as const;
