// The adapter from what the page knows each frame to the orders package's view.
// A pure function over plain data, so it can be tested without the page.

import { BUILDING_KINDS, MIX_NAMES, ROUTE_NAMES, type Emplacement, type RepairKind, type RouteName } from "@keepfall/content";
import type { GunView, OrdersView, PlotView, StandingId } from "@keepfall/orders";

const STATES: PlotView["state"][] = ["empty", "rising", "standing", "ruined"];

export interface ViewData {
  team: 0 | 1;
  gold: number;
  /** The player's plots as the estate saw them: kind index (-1 none) and state (sim PlotState). */
  plots: Array<{ kind: number; state: number }>;
  /** The player's gun slots, in slot order, and by slot whether the masonry under each is down. */
  guns: Emplacement[];
  mountDown: boolean[];
  foundry: boolean;
  /** MatchInfo.barracks: [mix index, route index] per plot, or null. */
  barracks: Int8Array | null;
  repairs: Record<RepairKind, boolean>;
  order: number;
  route: RouteName;
  /** The slot ridden now, or -1 in the overview. */
  riding: number;
  standing: StandingId[];
  /** 3.3: your store, or null (a match without powder). */
  powder?: { stock: number; cap: number; magazine: number } | null;
}

export function buildView(d: ViewData): OrdersView {
  const plots: PlotView[] = d.plots.map((p) => ({ kind: p.kind >= 0 ? BUILDING_KINDS[p.kind] : null, state: STATES[p.state] ?? "empty" }));
  const guns: GunView[] = d.guns.map((e, slot) => ({
    slot,
    id: e.id,
    place: e.place ?? `slot ${slot + 1}`,
    empty: !!e.empty,
    weapon: e.weapon,
    allowed: e.allowed ?? [e.weapon],
    upgrade: e.upgrade ?? null,
    mountDown: !!d.mountDown[slot],
  }));
  const barracks = plots.map((p, i) => {
    if (p.kind !== "barracks" || p.state !== "standing" || !d.barracks) return null;
    const mix = MIX_NAMES[d.barracks[i * 2]], route = ROUTE_NAMES[d.barracks[i * 2 + 1]];
    return mix && route ? { mix, route } : null;
  });
  return { team: d.team, gold: d.gold, plots, guns, foundry: d.foundry, barracks, repairs: { ...d.repairs }, order: d.order, route: d.route, riding: d.riding, standing: d.standing, powder: d.powder ?? null };
}
