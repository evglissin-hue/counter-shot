// Army diag (page): every phrase a player might type for an order or a route, through the order line's parser, for both seats.
import { ASHWRIGHT_SLOTS } from "@keepfall/content";
import { parse, type GunView, type OrdersView, type PlotView } from "@keepfall/orders";

function view(team: 0 | 1, order = 1): OrdersView {
  const guns: GunView[] = ASHWRIGHT_SLOTS.map((e, slot) => ({ slot, id: e.id, place: e.place ?? "", empty: e.empty === true, weapon: e.weapon, allowed: [...(e.allowed ?? [e.weapon])], upgrade: null, mountDown: false }));
  const plots: PlotView[] = [{ kind: "barracks", state: "standing" }, ...Array.from({ length: 5 }, (): PlotView => ({ kind: null, state: "empty" }))];
  return { team, gold: 300, plots, guns, foundry: false, barracks: [{ mix: "pikemen", route: "centre" }, null, null, null, null, null], repairs: { gate: true, walls: true, towers: true, keep: true }, order, route: "centre", riding: -1, standing: [] } as OrdersView;
}

// [phrase, what a player means]: "o0" advance, "o1" hold, "o2" push, "rL"/"rC"/"rR" route in the player's own words. A road with an order gives the road first (army pass).
const table: Array<[string, string]> = [
  ["advance", "o0"], ["Advance!", "o0"], ["ADVANCE", "o0"], ["attack", "o0"], ["charge", "o0"], ["forward", "o0"],
  ["go", "o0"], ["march", "o0"], ["go forward", "o0"], ["move", "o0"], ["move out", "o0"], ["move forward", "o0"],
  ["send them in", "o0"], ["send the waves in", "o0"], ["send in the waves", "o0"], ["go in", "o0"], ["waves advance", "o0"],
  ["all advance", "o0"], ["everyone advance", "o0"], ["advance on the gate", "o0"], ["attack the gate", "o0"], ["attack the enemy", "o0"],
  ["attack enemy minions", "o0"], ["attack the enemy minions", "o0"], ["fight", "o0"], ["engage", "o0"], ["go go go", "o0"], ["onward", "o0"],
  ["men advance", "o0"], ["troops attack", "o0"], ["advance waves", "o0"], ["resume", "o0"], ["go on", "o0"], ["keep going", "o0"], ["continue", "o0"],
  ["march on the gate", "o0"], ["advance the army", "o0"], ["kill them", "o0"], ["get them", "o0"], ["release", "o0"], ["unhold", "o0"], ["stop holding", "o0"],
  ["hold", "o1"], ["hold the line", "o1"], ["stop", "o1"], ["halt", "o1"], ["wait", "o1"], ["retreat", "o1"], ["fall back", "o1"], ["defend", "o1"], ["stay", "o1"], ["hold position", "o1"],
  ["push", "o2"], ["push the breach", "o2"], ["storm", "o2"], ["storm the breach", "o2"], ["through the breach", "o2"], ["into the breach", "o2"], ["storm the gate", "o2"], ["breach", "o2"],
  ["left", "rL"], ["go left", "rL"], ["waves left", "rL"], ["left flank", "rL"], ["left road", "rL"], ["take the left", "rL"], ["take the left road", "rL"], ["send waves left", "rL"], ["march left", "rL"], ["next waves left", "rL"], ["left side", "rL"], ["route left", "rL"],
  ["right", "rR"], ["go right", "rR"], ["right flank", "rR"], ["waves right", "rR"], ["right road", "rR"],
  ["centre", "rC"], ["center", "rC"], ["middle", "rC"], ["middle road", "rC"], ["go centre", "rC"], ["go middle", "rC"], ["go straight", "rC"], ["centre road", "rC"],
  ["advanced", "o0"], ["Advanced.", "o0"], ["advancing", "o0"], ["attacking", "o0"], ["attack!", "o0"], ["charging", "o0"], ["go ahead", "o0"], ["holding", "o1"], ["hold on", "o1"], ["pushing", "o2"], ["pushed", "o2"], ["Push.", "o2"], ["hold.", "o1"], ["Waves, advance.", "o0"],
  ["advance left", "rL+o0"], ["attack left", "rL+o0"], ["go left and advance", "rL+o0"], ["left then advance", "rL+o0"], ["advance on the left", "rL+o0"], ["waves left and attack", "rL+o0"], ["go left, attack", "rL+o0"],
];

const out: Array<{ phrase: string; meant: string; team: number; ok: boolean; got: string; say: string }> = [];
for (const team of [1, 0] as const) {
  for (const [phrase, meant] of table) {
    const r = parse(phrase, view(team));
    if (!r.ok) {
      out.push({ phrase, meant, team, ok: false, got: "", say: r.reason });
      continue;
    }
    const got = r.steps
      .map((s) => (s.kind === "input" ? s.input : null))
      .filter((i): i is NonNullable<typeof i> => !!i)
      .map((i) => (i.kind === "order" ? `o${i.order}` : i.kind === "route" ? `r${i.route[0].toUpperCase()}` : JSON.stringify(i)))
      .join("+");
    out.push({ phrase, meant, team, ok: true, got, say: r.say });
  }
}
console.log(JSON.stringify(out));
