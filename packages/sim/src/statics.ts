// The keep falls by engineering (phase 3, 3.4): a statics pass over each
// keep and tower, beside the masonry's support check. Contract written by the
// master; the rules are docs/phase-3/04-keep.md and content's STRUCTURE.
//
// - Support first: the support check runs as before; this looks only at
//   stones that still stand (CastleSim.dynamic is 0).
// - Crushing (rule 2): per structure and course c, carry(c) is the top area
//   of the course's standing masonry (keep walls, tower wedges, buttress
//   piers; not floors or battlements) as a share of the course as built
//   (buttresses not counted as built: one that stands adds to carry), and
//   load(c) the mass standing above c (every member, floors and buttresses
//   too) as a share of that as built (buttresses not counted). c crushes
//   when load / carry > STRUCTURE.crush.
// - Toppling (rule 3): the footing is the convex hull (x, z) of the top
//   faces of course c's standing masonry, drawn in by STRUCTURE.margin +
//   STRUCTURE.toe * half * load / carry (half: the structure's half width).
//   If the centre of mass of everything standing above c lies outside it
//   (its signed distance inside the hull, the least over the hull's edges,
//   is under the draw-in), the part above c topples about the most violated
//   edge, drawn in: towards the cut.
// - Rule 4: after any change to a structure (a member loosened, shattered,
//   restored, raised), its damaged courses are walked from the lowest up; the
//   first that crushes or topples decides, and must stay so for
//   STRUCTURE.hold ticks before the fall starts (Strain, then Topple or
//   Crush; Saved if it holds again first).
// - Rules 5 to 7: a toppling part turns kinematic and follows one rotation
//   about the hinge, integrated with dsin and dcos from its mass, its moment
//   about the hinge and gravity, from STRUCTURE.tipRate; it is let go at
//   STRUCTURE.tipAngle, when a probe stone meets standing masonry or the
//   ground, or after STRUCTURE.tipTicks. A crush turns the course's standing
//   stones to dust and lets the part above go at once. On release about
//   STRUCTURE.bodies stones stay bodies; the rest are brittle (dust at their
//   first touch).
// - A keep that falls takes its floors with it, so its banner comes down
//   (rule 9).
//
// Deterministic: structures and stones in a fixed order, + - * / and
// comparisons, @keepfall/core's dsin, dcos and dsqrt. Its state is hashed.

import { structureList, type CastleLayout, type StructureDef } from "@keepfall/content";
import type { CastleSim } from "./castleSim";
import type { EventKind } from "./frame";
import type { Terrain } from "./terrain";

type Emit = (kind: EventKind, a: number, b: number, c: number, d: number) => void;

/** Where a structure is in its life. */
export const enum StaticState {
  Standing = 0,
  /** A course crushes or topples: it falls in STRUCTURE.hold ticks unless saved. */
  Groaning = 1,
  /** The part above a course tips about its hinge (kinematic). */
  Toppling = 2,
  /** It fell (toppled and let go, or crushed). */
  Fallen = 3,
}

/** A structure's report, as the mason's eye and the AI read it (refreshed every STRUCTURE.reportEvery ticks). */
export interface StructureStatus {
  index: number;
  state: StaticState;
  /** 0 to 1: how much its weakest course still holds (1 untouched, 0 falling): 1 - the weakest course's heat. */
  holds: number;
  /** Its weakest course (the one nearest falling; -1: no course damaged). */
  weakest: number;
  /** At the weakest course: the share of the way to crushing ((load / carry - 1) / (crush - 1), 0 as built, 1 crushes) and to toppling (1 - margin / margin as built, 0 as built, 1 topples). */
  crushNear: number;
  toppleNear: number;
  /** Signed distance (m) of the centre of mass of what stands above the weakest course inside its drawn-in footing (negative: outside, it topples). */
  margin: number;
  /** Which way it would topple (a unit vector, world x and z; 0, 0 when nothing is damaged). */
  dirX: number;
  dirZ: number;
  /** The centre of mass of what stands above the weakest course (world); the plumb line drops from it. */
  comX: number;
  comY: number;
  comZ: number;
  /** The top of the weakest course (m): where the plumb line meets the footing. */
  footY: number;
  /** The weakest course's footing: its convex hull seen from above (x, z pairs, counter-clockwise; empty when nothing is damaged), and how far it is drawn in (m). */
  hull: number[];
  drawIn: number;
  /** For every course, lowest first: its share of the way to falling (the larger of the two shares above, 0 to 1), 0 when undamaged. */
  heat: number[];
}

export class Statics {
  readonly list: StructureDef[];

  constructor(
    private castle: CastleSim,
    private terrain: Terrain,
    private emit: Emit,
  ) {
    this.list = structureList(castle.layout);
    void this.terrain;
    void this.emit;
  }

  get layout(): CastleLayout {
    return this.castle.layout;
  }

  /** After the world's step (and the bursts of the step): see what changed, judge it, groan, start falls, turn toppling parts, let them go, dust brittle stones. */
  step(tick: number) {
    void tick;
  }

  /** A structure's last report (index into `list`). */
  status(i: number): StructureStatus {
    return { index: i, state: StaticState.Standing, holds: 1, weakest: -1, crushNear: 0, toppleNear: 0, margin: 0, dirX: 0, dirZ: 0, comX: 0, comY: 0, comZ: 0, footY: 0, hull: [], drawIn: 0, heat: [] };
  }

  /** Rule 12: load / carry of a structure's course now (0: nothing above it or undamaged and unloaded; Infinity: nothing of it stands under a load). */
  ratio(i: number, course: number): number {
    void i;
    void course;
    return 1;
  }

  /** The structure a stone belongs to (-1: none). */
  structureOf(id: number): number {
    void id;
    return -1;
  }

  hashInto(out: number[]) {
    void out;
  }
}
