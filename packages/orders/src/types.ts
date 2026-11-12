import type { BuildingKind, MixName, RepairKind, RouteName, UpgradeKind, WeaponKind } from "@keepfall/content";
import type { MatchInput } from "@keepfall/rules";

/** One of the player's plots (index 0 to 5, PLOTS order), as the page last saw it. */
export interface PlotView {
  kind: BuildingKind | null;
  state: "empty" | "rising" | "standing" | "ruined";
}

/** One of the player's eight gun slots, in slot order. */
export interface GunView {
  /** The slot as the player numbers it (0 to 7) and the match emplacement id the inputs carry. */
  slot: number;
  id: number;
  /** Where it stands, in the player's words ("the gate wall", "the front wall, left of the gate"). */
  place: string;
  empty: boolean;
  /** The gun it holds (meaningless when empty) and the kinds the slot can take. */
  weapon: WeaponKind;
  allowed: WeaponKind[];
  upgrade: UpgradeKind | null;
  /** The masonry under it is down: no gun can be bought for it until masons rebuild it. */
  mountDown: boolean;
}

/** What the page knows of its own castle: everything parse() needs. Routes are in match terms. */
export interface OrdersView {
  /** The page's team: plot names and left and right follow it (team 0 faces the other way). */
  team: 0 | 1;
  gold: number;
  plots: PlotView[];
  guns: GunView[];
  foundry: boolean;
  /** Per plot: a standing barracks' mix and route (match terms), or null. */
  barracks: Array<{ mix: MixName; route: RouteName } | null>;
  repairs: Record<RepairKind, boolean>;
  /** The standing order for all waves (sim Order: 0 advance, 1 hold, 2 push) and the route of the next waves (match terms). */
  order: number;
  route: RouteName;
  /** The slot the player rides now, or -1 in the overview. */
  riding: number;
  /** Standing orders on now. */
  standing: StandingId[];
}

/** Standing orders (V3): rules the page keeps until told otherwise. */
export type StandingId = "gateFirst" | "rebuild";

export type Step =
  /** An input for the match, what the steward says of it, and the gold it costs (0: free). */
  | { kind: "input"; input: MatchInput; say: string; cost: number }
  /** A standing order switched on or off. */
  | { kind: "standing"; id: StandingId; on: boolean; say: string };

/** Every step of a line, or why the line is refused (then nothing is sent). */
export type ParseResult = { ok: true; steps: Step[]; say: string } | { ok: false; reason: string };
