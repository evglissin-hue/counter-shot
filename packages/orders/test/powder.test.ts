// Orders by words about powder (3.3): "powder", "buy powder", "more powder", "build a magazine"
// and the standing order "buy powder under twenty", with every refusal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ASHWRIGHT_SLOTS } from "@keepfall/content";
import { parse, STANDING_ORDERS, type GunView, type OrdersView, type ParseResult, type PlotView } from "@keepfall/orders";

function fixture(over: Partial<OrdersView> = {}): OrdersView {
  const guns: GunView[] = ASHWRIGHT_SLOTS.map((e, slot) => ({
    slot,
    id: e.id,
    place: e.place ?? "",
    empty: e.empty === true,
    weapon: e.weapon,
    allowed: [...(e.allowed ?? [e.weapon])],
    upgrade: null,
    mountDown: false,
  }));
  const plots: PlotView[] = [{ kind: "barracks", state: "standing" }, ...Array.from({ length: 4 }, (): PlotView => ({ kind: null, state: "empty" })), { kind: "magazine", state: "standing" }];
  return {
    team: 1,
    gold: 300,
    plots,
    guns,
    foundry: false,
    barracks: [{ mix: "pikemen", route: "centre" }, null, null, null, null, null],
    repairs: { gate: true, walls: true, towers: true, keep: true },
    order: 0,
    route: "centre",
    riding: -1,
    standing: [],
    powder: { stock: 40, cap: 120, magazine: 5 },
    ...over,
  };
}

const why = (r: ParseResult) => (r.ok ? "ok" : r.reason);
const steps = (r: ParseResult) => (r.ok ? r.steps : []);

test("powder, buy powder, more powder: the buy input, said and costed", () => {
  for (const line of ["powder", "buy powder", "more powder", "Buy more powder please", "get some powder", "buy powder at the magazine", "purchase 20 powder"]) {
    const r = parse(line, fixture());
    assert.ok(r.ok, `${line}: ${why(r)}`);
    assert.deepEqual(r.steps.map((s) => (s.kind === "input" ? [s.input.kind, s.say, s.cost] : null)), [["powder", "Powder: 20 for 60 gold", 60]], line);
  }
});

test("powder refusals: no working magazine, the magazine full, gold short", () => {
  assert.equal(why(parse("buy powder", fixture({ powder: { stock: 0, cap: 30, magazine: -1 } }))), "No working magazine");
  assert.equal(why(parse("buy powder", fixture({ powder: null }))), "No working magazine");
  assert.equal(why(parse("buy powder", fixture({ powder: undefined }))), "No working magazine");
  assert.equal(why(parse("buy powder", fixture({ powder: { stock: 101, cap: 120, magazine: 5 } }))), "The magazine is full");
  assert.ok(parse("buy powder", fixture({ powder: { stock: 100, cap: 120, magazine: 5 } })).ok, "room for exactly 20 is enough");
  assert.equal(why(parse("buy powder", fixture({ gold: 25 }))), "Not enough gold: 35 short");
  assert.ok(why(parse("buy powder please now boys", fixture())).startsWith("Not understood"), "an unknown word is not powder");
});

test("two buys in a line see the first one's stock and gold", () => {
  const r = parse("buy powder, then buy powder", fixture({ gold: 100 }));
  assert.equal(why(r), '"buy powder": not enough gold: 20 short');
  const ok = parse("buy powder, then buy powder", fixture({ gold: 120, powder: { stock: 70, cap: 120, magazine: 5 } }));
  assert.equal(steps(ok).length, 2);
  assert.equal(why(parse("buy powder, then buy powder, then buy powder", fixture({ gold: 300, powder: { stock: 70, cap: 120, magazine: 5 } }))), '"buy powder": the magazine is full');
});

test("the Powder Mill is still a building, not a powder purchase", () => {
  const r = parse("build a powder mill", fixture());
  assert.ok(r.ok);
  const s = steps(r)[0];
  assert.ok(s.kind === "input" && s.input.kind === "build" && s.input.building === "mill");
});

test("build a magazine: the free plot rule, and one at a time", () => {
  const none = fixture();
  none.plots[5] = { kind: null, state: "empty" };
  const r = parse("build a magazine", none);
  assert.ok(r.ok, why(r));
  const s = steps(r)[0];
  assert.ok(s.kind === "input" && s.input.kind === "build" && s.input.building === "magazine" && s.cost === 140);
  assert.equal(why(parse("build a magazine", fixture())), "You have a magazine already");
  const rising = fixture();
  rising.plots[5] = { kind: "magazine", state: "rising" };
  assert.equal(why(parse("build a magazine", rising)), "You have a magazine already");
  assert.equal(why(parse("build a magazine", { ...none, gold: 100 })), "Not enough gold: 40 short");
  // A ruin is rebuilt for half when none stands.
  const ruin = fixture();
  ruin.plots[5] = { kind: "magazine", state: "ruined" };
  const rb = parse("rebuild the magazine", ruin);
  assert.ok(rb.ok, why(rb));
  const first = steps(rb)[0];
  assert.equal(first.kind === "input" && first.cost, 70);
  const both = fixture();
  both.plots[4] = { kind: "magazine", state: "ruined" };
  assert.equal(why(parse("rebuild the magazine", both)), "You have a magazine already");
});

test("buy powder under twenty: the standing order, on and off", () => {
  assert.equal(STANDING_ORDERS.powder.name, "Buy powder under twenty");
  assert.equal(STANDING_ORDERS.powder.blurb, "Powder is bought whenever the stock is under 20 and the gold is there");
  for (const line of ["buy powder under twenty", "buy powder under 20", "always buy powder", "buy powder whenever it is below twenty"]) {
    const r = parse(line, fixture());
    assert.ok(r.ok, `${line}: ${why(r)}`);
    assert.deepEqual(r.steps.map((s) => (s.kind === "standing" ? [s.id, s.on, s.say] : null)), [["powder", true, "Standing order: buy powder under twenty"]], line);
  }
  const on = fixture({ standing: ["powder"] });
  for (const line of ["stop buying powder", "cancel buy powder under twenty", "forget the powder order"]) {
    const r = parse(line, on);
    assert.ok(r.ok, `${line}: ${why(r)}`);
    assert.deepEqual(r.steps.map((s) => (s.kind === "standing" ? [s.id, s.on] : null)), [["powder", false]], line);
  }
  assert.deepEqual(steps(parse("no standing orders", on)).map((s) => (s.kind === "standing" ? [s.id, s.on] : null)), [["powder", false]]);
  assert.equal(steps(parse("buy powder under twenty", on)).length, 0, "already on: nothing to do");
});

test("a mixed line: powder with other orders", () => {
  const r = parse("buy powder and hold", fixture());
  assert.ok(r.ok, why(r));
  assert.deepEqual(steps(r).map((s) => (s.kind === "input" ? s.input.kind : s.kind)), ["powder", "order"]);
});
