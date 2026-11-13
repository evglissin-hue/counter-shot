// The observatory's contract (phase 3 milestone 3.1): one JSON line per match
// in tools/.observatory/<run>/matches.jsonl. observe.ts writes these lines;
// tools/observatory.mjs collects them; tools/observatory-report.mjs reads
// them. Pairs are by castle: [castle 0, castle 1]. Castle 0 is the castle at
// the origin (Team.Enemy in the rules), castle 1 the one at z = -DIST.
// Times are in seconds of match time unless a name says otherwise.

/** Bump when a field changes meaning or goes away (adding a field does not need it). */
export const LINE_VERSION = 1;

/** Who commands a castle: an AI level, or nobody. */
export type Side = "squire" | "knight" | "warlord" | "idle";

/** What a shot by hand was for (the gunner's Aim keys, grouped: every raid is "raid", every gun is "gun"). */
export type AimKind = "keep" | "crowd" | "breach" | "raid" | "masons" | "gun" | "range" | "open" | "cut";
export const AIM_KINDS: AimKind[] = ["keep", "crowd", "breach", "raid", "masons", "gun", "range", "open", "cut"];

/** How a match is set up. Everything needed to play it again. */
export interface MatchSetup {
  /** Unique within its run (the pool's resume key), e.g. "knight-knight-s11-base". */
  id: string;
  seed: number;
  sides: [Side, Side];
  /** Each castle's build plan: "stock" (AI_PLANS of its level) or a name for `steps`. */
  plans: [string, string];
  /** A plan that is not stock, as AiStep lists (null: stock). */
  steps?: [unknown[] | null, unknown[] | null];
  /** 3.2: fields merged over each side's AiLevel (null: its own), e.g. { "marks": 0, "salvo": false } for a Knight that does not mark. Put it in the id too. */
  levels?: [Record<string, unknown> | null, Record<string, unknown> | null];
  /** The variant's name ("base": no changes) and its changes by content path, e.g. { "WEAPONS.mortar.reload": 600 }. */
  variant: string;
  tuning: Record<string, unknown>;
  /** Longest the match may run (s); it stops earlier at its result. Default: the match's own time limit (25:00). */
  secs: number;
}

/** Every 30 s of match time (t = 30, 60, ...), and once more at the end. */
export interface Sample {
  t: number;
  gold: [number, number];
  /** Gold spent so far (Match.spent). */
  spent: [number, number];
  /** Each castle's six plots, one letter each: "." empty, b/m/f/k a barracks, mill, foundry or magazine rising, B/M/F/K working, x a ruin. */
  plots: [string, string];
  /** Keep storeys still under each banner (Match.floorsUnder: 3 on the roof, 0 down). */
  floors: [number, number];
  /** Pieces of each castle down (Match.masonryDown). */
  down: [number, number];
  /** Fighting men standing and fallen, by team (Match.armyCounts). */
  standing: [number, number];
  fallen: [number, number];
  /** Storm meters, by castle stormed (Match.storm, ticks). */
  storm: [number, number];
  /** Each castle's guns knocked out now. */
  out: [number, number];
  /** 3.3: charges in each castle's store (Carriers.status). Older lines lack it. */
  stock?: [number, number];
  /** Stones moving now (CastleSim.awakeCount), the most seen in this window, and the slowest Match.step in this window (ms, wall clock). */
  moving: number;
  movingMax: number;
  worstMs: number;
}

/** One applied build step: [tick, castle, what], what as "build mill 1" (plot), "buy mortar 7" (slot 0 to 7), "upgrade heavyShot 0", "buttress front" (3.4). */
export type BuildEntry = [number, 0 | 1, string];

export interface Totals {
  /** Shots by hand by what they were for (the AI gunner's counts). */
  byHand: [Record<AimKind, number>, Record<AimKind, number>];
  /** Shots by hand (Match.shots) and by guns nobody mans (Match.autoShots). */
  shots: [number, number];
  auto: [number, number];
  /** The build order as it happened (every build, buy and upgrade the match applied, rebuilt ruins included). */
  build: BuildEntry[];
  /** Seconds each side held more than 400 unspent gold. */
  richSecs: [number, number];
  /** Trick shots each side made (ricochet, collapse, multi-kill, keep hit: their sum). */
  tricks: [number, number];
  /** Match.stats for each team: gold, masons, ladders, storms, guns silenced and lost. */
  stats: [Record<string, number>, Record<string, number>];
  /** The most stones moving at once and the slowest step (ms) over the whole match. */
  movingMax: number;
  worstMs: number;
  /** Steps slower than 16 ms and slower than 33 ms (wall clock, on the machine that ran it). Optional: older lines lack it. */
  slowSteps?: [number, number];
  /** 3.2: marks made, salvos fired, and shots by guns nobody mans at men on a mark (the last read from Match.autoOnMark), by castle; and the bridges standing at the end (0 to 3). Older lines lack all four: read them as 0 (3 bridges). */
  marks?: [number, number];
  salvos?: [number, number];
  autoOnMark?: [number, number];
  /** 3.2 (A2): guns that fired in salvos, by castle (salvos x guns). Older lines lack it. */
  salvoGuns?: [number, number];
  bridgesUp?: number;
  /**
   * 3.3, by castle (older lines lack all of them): charges made (the cellar's and the mills', what did not fit included),
   * bought at the magazine (20 a buy), spent (the cost of every shot that left a gun) and lost (made with the store full);
   * the tick of the first magazine blown (-1: none) and how many blew; and the seconds the gun the AI rode could not pay.
   */
  powderMade?: [number, number];
  powderBought?: [number, number];
  powderSpent?: [number, number];
  powderLost?: [number, number];
  magazineBlown?: [number, number];
  magazinesBlown?: [number, number];
  dryRideSecs?: [number, number];
  /**
   * 3.4, by castle (older lines lack all of them): the falls of its structures in this match, in order: [time s, kind of
   * structure, how, course it gave way at] (from the Topple and Crush events). And the hand shots its gunner landed on
   * the other castle's keep (a landing within a metre or so of its walls), at the foot (below its lowest floor) and above.
   */
  falls?: [Fall[], Fall[]];
  keepFoot?: [number, number];
  keepTop?: [number, number];
}

/** A structure that fell: [time (s), "keep" or "tower", "topple" or "crush", the course it gave way at]. */
export type Fall = [number, "keep" | "tower", "topple" | "crush", number];

export interface MatchLine {
  v: typeof LINE_VERSION;
  setup: MatchSetup;
  /** Both rules versions the match ran under (sim RULES_VERSION, rules MATCH_RULES_VERSION). */
  rules: { sim: number; match: number };
  /**
   * How it ended. winner: the castle that won, -1 a draw, null no result
   * (stopped at setup.secs before the match's own end). tick: the last tick
   * played. hash: Match.hash() at the end, so any line can be checked by
   * playing its setup again.
   */
  result: {
    winner: 0 | 1 | -1 | null;
    reason: "keep" | "storm" | "surrender" | "time" | null;
    tick: number;
    hash: { state: string; world: string };
    /** 3.4: a keep win in which the losing keep toppled or crushed in this match (else the floors went: "keep (floors)"). Older lines lack it. */
    felled?: boolean;
  };
  samples: Sample[];
  totals: Totals;
  /** Wall-clock cost: ms for the whole match, and match seconds per wall second. */
  wall: { ms: number; speed: number };
}
