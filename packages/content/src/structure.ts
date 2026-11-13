// The keep falls by engineering (phase 3, 3.4), as data: when a keep or a
// tower crushes or topples, how a toppling part tips and is let go, and the
// buttresses a castle can raise against its keep's faces. The rules are in
// docs/phase-3/04-keep.md; the sim's statics pass (packages/sim statics.ts)
// applies them. Starting numbers for tuning: everything here is data.
//
// A structure is a keep or one of the four towers of a castle: the masons'
// sections of kind "keep" and "towers" (repairSections), plus, for the keep,
// its buttresses. Curtain walls keep today's support rule alone.

import { DPI } from "@keepfall/core";
import type { CastleLayout } from "./castle";
import { CASTLE_SHAPE } from "./castle";
import { mirrorZ, repairSections } from "./siege";

export { BUTTRESS, BUTTRESS_FACES, type ButtressFace } from "./buttress";

export const STRUCTURE = {
  /**
   * Rule 2: course c crushes when load(c) / carry(c) is above this. carry(c)
   * is the top area of the course's masonry standing, as a share of the course
   * as built; load(c) the mass standing above c, as a share of that as built.
   * With everything above standing, a course holds until less than 1 / crush
   * (38%) of it stands.
   */
  crush: 2.6,
  /** Rule 3: the footing's convex hull (seen from above) is drawn in by this (m) ... */
  margin: 0.3,
  /**
   * ... plus toe * the structure's half width * load(c) / carry(c) (the
   * master's reading of rule 3, November 13): a heavily loaded footing
   * crushes at its edge, so the line it tips about moves in as the load on
   * what is left grows. Without it, a symmetric keep cut along one face and a
   * third of each side would never topple (its centre of mass stays over what
   * is left); with it, it does, and a face cut alone still holds.
   */
  toe: 0.2,
  /** Rule 4: ticks a course must keep crushing or toppling before the fall starts (half a second of groaning). */
  hold: 30,
  /** Rule 5: a toppling part starts turning at this rate (rad/s) ... */
  tipRate: 0.05,
  /** ... and is let go at this tip (rad), when a probe stone meets standing masonry or the ground, or after `tipTicks`. */
  tipAngle: (25 / 180) * DPI,
  tipTicks: 210,
  /** Rule 6: a crushed part is let go at once, its walls bursting outward at this speed (m/s) as they come down. */
  splay: 1.2,
  /** Rule 7: of the stones let go, about this many stay bodies; the rest are brittle (dust at their first touch). */
  bodies: 450,
  /** Rule 7: a brittle stone that touches anything at this speed (m/s) or more turns to dust. */
  brittleSpeed: 9,
  /** A brittle stone still flying after this many ticks turns to dust anyway (it never left the air: a guard). */
  brittleTicks: 360,
  /** The structures' report (the mason's eye, the AI) is refreshed this often (ticks). */
  reportEvery: 15,
  /** The world tells without the eye: dark cracks across a course past this share of the way to falling, dust trickling past `dust`. */
  cracks: 0.7,
  dust: 0.85,
  /** Rule 12: masons drop other work for a keep or a tower past this share of the way to falling (its "holds" under 1 - urgent). */
  urgent: 0.5,
} as const;

/** What kind of structure: a keep (one a castle) or a tower (four a castle). */
export type StructureKind = "keep" | "tower";

export interface StructureDef {
  /** Index in structureList: castle c's keep is c * 5, its towers c * 5 + 1 to 4 (front left, front right, back left, back right, in its owner's words). */
  index: number;
  castle: 0 | 1;
  kind: StructureKind;
  /** Its masons' section (index into repairSections). */
  section: number;
  /** As its owner would say it: "the keep", "the front left tower". */
  name: string;
  /** Its middle (world x, z) and half its width (m): 5 for the keep, the tower's outer radius for a tower. */
  cx: number;
  cz: number;
  half: number;
  /**
   * Its pieces, in id order: the section's (walls or wedges, the keep's
   * floors, the battlements) and, for a keep, every piece of its buttresses
   * (bought or not: one not bought is withdrawn, so it neither stands nor counts).
   */
  stones: number[];
}

const cache = new WeakMap<CastleLayout, StructureDef[]>();

/**
 * The structures of both castles (castle 0's keep, then its four towers, then
 * castle 1's), each with its pieces. Same layout, same list, on every machine.
 */
export function structureList(layout: CastleLayout): StructureDef[] {
  const hit = cache.get(layout);
  if (hit) return hit;
  const S = CASTLE_SHAPE;
  const secs = repairSections(layout);
  const out: StructureDef[] = [];
  for (const castle of [0, 1] as const) {
    const keep = secs.find((s) => s.castle === castle && s.kind === "keep")!;
    const towers = secs.filter((s) => s.castle === castle && s.kind === "towers");
    for (const sec of [keep, ...towers]) {
      const isKeep = sec.kind === "keep";
      const stones = [...sec.stones];
      let cx: number, cz: number;
      if (isKeep) {
        cx = 0;
        cz = mirrorZ(castle, S.keepZ);
      } else {
        // The tower's wedges ring its middle: the mean of their places.
        let sx = 0, sz = 0, n = 0;
        for (const id of sec.stones) {
          const s = layout.stones[id];
          if (s.part !== "tower") continue;
          sx += s.x;
          sz += s.z;
          n++;
        }
        cx = Math.round((sx / n) * 1000) / 1000;
        cz = Math.round((sz / n) * 1000) / 1000;
      }
      stones.sort((a, b) => a - b);
      out.push({ index: out.length, castle, kind: isKeep ? "keep" : "tower", section: sec.index, name: sec.name, cx, cz, half: isKeep ? S.keepHalf : S.towerOut, stones });
    }
  }
  cache.set(layout, out);
  return out;
}

/** Index in structureList of a castle's keep. */
export function keepStructure(castle: number): number {
  return castle * 5;
}
