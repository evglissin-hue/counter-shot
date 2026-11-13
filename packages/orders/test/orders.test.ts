// The steward's ear: sentences in, match inputs out. Fixture castle: team 1,
// 300 gold, a barracks on plot 0, the other plots empty, the Ashwright guns
// with slots 5 to 8 (4 to 7 from zero) empty. For team 1 the plots are named
// by the player's own words: plot 0 is "front right", 1 "front left", 2 "right,
// by the keep", 3 "left, by the keep", 4 "back right", 5 "back left".

import { test } from "node:test";
import assert from "node:assert/strict";
import { ASHWRIGHT_SLOTS, BUTTRESS, type RepairKind } from "@keepfall/content";
import type { MatchInput } from "@keepfall/rules";
import { parse, type GunView, type OrdersView, type ParseResult, type PlotView, type StandingId } from "@keepfall/orders";

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
  const plots: PlotView[] = [{ kind: "barracks", state: "standing" }, ...Array.from({ length: 5 }, (): PlotView => ({ kind: null, state: "empty" }))];
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
    ...over,
  };
}

/** The fixture with a change made by a function (a copy: the fixture is rebuilt every time). */
function viewWith(f: (v: OrdersView) => void, over: Partial<OrdersView> = {}): OrdersView {
  const v = fixture(over);
  f(v);
  return v;
}

function inputs(r: ParseResult): MatchInput[] {
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r.steps.flatMap((s) => (s.kind === "input" ? [s.input] : []));
}

function accepts(view: OrdersView, table: Array<[string, MatchInput[]]>) {
  for (const [line, want] of table) {
    const r = parse(line, view);
    assert.ok(r.ok, `"${line}" refused: ${r.ok ? "" : r.reason}`);
    assert.deepEqual(inputs(r), want, `"${line}"`);
  }
}

function refuses(view: OrdersView, table: Array<[string, string | RegExp]>) {
  for (const [line, why] of table) {
    const r = parse(line, view);
    assert.ok(!r.ok, `"${line}" was accepted`);
    if (r.ok) continue;
    if (typeof why === "string") assert.equal(r.reason, why, `"${line}"`);
    else assert.match(r.reason, why, `"${line}"`);
  }
}

const build = (plot: number, building: "mill" | "barracks" | "foundry"): MatchInput => ({ kind: "build", plot, building });

test("build: a building goes on the first free plot, or the plot named", () => {
  accepts(fixture(), [
    ["mill", [build(4, "mill")]],
    ["a mill", [build(4, "mill")]],
    ["Build a Mill, please!", [build(4, "mill")]],
    ["steward, build a powder mill now", [build(4, "mill")]],
    ["build a mill on the back plot", [build(4, "mill")]],
    ["barracks front left", [build(1, "barracks")]],
    ["barrack back left", [build(5, "barracks")]],
    ["foundry by the keep on the left", [build(3, "foundry")]],
    ["forge right by the keep", [build(2, "foundry")]],
    ["mill on plot 5", [build(4, "mill")]],
    ["gold mill on plot six", [build(5, "mill")]],
    ["mill back left", [build(5, "mill")]],
  ]);
});

test("build: the answer says what and where and the cost", () => {
  const r = parse("mill", fixture());
  assert.ok(r.ok);
  assert.equal(r.say, "Powder Mill on plot 5, back right: 160 gold");
  const s = r.steps[0];
  assert.equal(s.kind === "input" && s.cost, 160);
});

test("build: a ruin of the same kind is rebuilt at half price", () => {
  const ruined = fixture();
  ruined.plots[3] = { kind: "mill", state: "ruined" };
  accepts(ruined, [
    ["rebuild the mill", [build(3, "mill")]],
    ["rebuild", [build(3, "mill")]],
    ["mill on plot 4", [build(3, "mill")]],
    ["mill on the left, by the keep", [build(3, "mill")]],
  ]);
  const r = parse("rebuild the mill", ruined);
  assert.ok(r.ok && r.steps[0].kind === "input" && r.steps[0].cost === 80);
  assert.equal(r.ok && r.say, "Rebuild the Powder Mill on plot 4, left, by the keep: 80 gold");
  refuses(ruined, [
    ["rebuild the barracks", "Nothing ruined to rebuild"],
    ["foundry on plot 4", "Plot 4 is taken"],
  ]);
  refuses(fixture(), [["rebuild", "Nothing ruined to rebuild"]]);
});

test("build: refusals", () => {
  const full = fixture();
  full.plots = full.plots.map((_, i) => (i === 0 ? { kind: "barracks", state: "standing" } : { kind: "mill", state: "standing" }));
  refuses(fixture(), [
    ["mill on plot 1", "Plot 1 is taken"],
    ["mill on plot 9", "No plot 9"],
    ["mill on the keep front", "No plot is called that"],
    ["foundry and barracks", /not enough gold: 170 short$/],
  ]);
  refuses(full, [
    ["mill", "No free plot"],
    ["mill, then waves left", '"mill": no free plot'],
    ["mill on the back", "No free plot"],
  ]);
  refuses(fixture({ gold: 100 }), [["mill", "Not enough gold: 60 short"]]);
});

test("build: gold is checked across the parts of a line", () => {
  const v = fixture();
  const r = parse("mill and barracks", v);
  assert.ok(!r.ok);
  assert.equal(!r.ok && r.reason, '"barracks": not enough gold: 80 short');
  // Two buildings that fit take two different plots.
  const ok = parse("mill, then mill", fixture({ gold: 400 }));
  assert.deepEqual(inputs(ok), [build(4, "mill"), build(5, "mill")]);
});

const buy = (emplacement: number, weapon: "longGun" | "mortar" | "chainShot" | "swivel"): MatchInput => ({ kind: "buy", emplacement, weapon });

test("buy: a gun for an empty slot", () => {
  const open2 = viewWith((v) => {
    v.guns[2].empty = true;
  });
  accepts(fixture(), [
    ["buy a swivel", [buy(4, "swivel")]],
    ["swivel gun", [buy(4, "swivel")]],
    ["long gun for the left wall", [buy(4, "longGun")]],
    ["a cannon for the right wall", [buy(5, "longGun")]],
    ["a mortar for slot 8", [buy(7, "mortar")]],
    ["buy a mortar", [buy(7, "mortar")]],
    ["buy a chain shot for slot five", [buy(4, "chainShot")]],
    ["long gun on the back left tower", [buy(6, "longGun")]],
    ["buy a mortar for the second mortar pit", [buy(7, "mortar")]],
    ["buy a gun for slot 8", [buy(7, "mortar")]],
  ]);
  accepts(open2, [
    ["chain shot on the front right tower", [buy(2, "chainShot")]],
    ["chain", [buy(2, "chainShot")]],
  ]);
  const r = parse("buy a swivel", fixture());
  assert.equal(r.ok && r.say, "Swivel gun for slot 5, the front wall, left of the gate: 120 gold");
});

test("buy: refusals", () => {
  const full = viewWith((v) => v.guns.forEach((g) => (g.empty = false)));
  const down = viewWith((v) => v.guns.forEach((g) => (g.mountDown = g.empty)));
  refuses(full, [["buy a swivel", "No empty slot takes a swivel gun"]]);
  refuses(fixture(), [
    ["a swivel for slot 8", "Slot 8 does not take a swivel gun"],
    ["a swivel for slot 1", "Slot 1 is taken"],
    ["a swivel for slot 12", "No slot 12"],
    ["buy a gun", "Which gun? Say a long gun, mortar, chain shot or swivel"],
    ["a mortar for the gate wall", "No empty slot takes a mortar there"],
    ["buy a swivel on the moon", /^Not understood/],
  ]);
  refuses(down, [["buy a swivel", "That slot's masonry is down: masons first"]]);
  refuses(fixture({ gold: 100 }), [["long gun", "Not enough gold: 120 short"]]);
  // A slot whose masonry is down is skipped for the next one that is sound.
  const one = viewWith((v) => {
    v.guns[4].mountDown = true;
  });
  accepts(one, [["buy a swivel", [buy(5, "swivel")]]]);
});

const up = (emplacement: number, upgrade: "heavyShot" | "rifled" | "heavyShell" | "quickLoader" | "longChain" | "heavyBalls" | "canister" | "longBarrel"): MatchInput => ({ kind: "upgrade", emplacement, upgrade });

test("upgrade: a Foundry upgrade for a gun", () => {
  const v = fixture({ foundry: true });
  accepts(v, [
    ["heavy shot on the long gun", [up(0, "heavyShot")]],
    ["rifled barrel", [up(0, "rifled")]],
    ["rifling for the long gun", [up(0, "rifled")]],
    ["quick loader for the mortar", [up(1, "quickLoader")]],
    ["heavy shell on the mortar", [up(1, "heavyShell")]],
    ["canister on the swivel", [up(3, "canister")]],
    ["long barrel", [up(3, "longBarrel")]],
    ["long chain", [up(2, "longChain")]],
    ["heavy balls on the chain shot", [up(2, "heavyBalls")]],
  ]);
  assert.equal(parse("heavy shot on the long gun", v).ok && (parse("heavy shot on the long gun", v) as { say: string }).say, "Heavy shot on the long gun, the gate wall: 140 gold");
});

test("upgrade: which gun", () => {
  const two = viewWith(
    (v) => {
      v.guns[4].empty = false;
    },
    { foundry: true },
  );
  refuses(two, [["heavy shot on the long gun", "Which long gun? Say where it stands"]]);
  accepts(two, [
    ["heavy shot on the long gun on the gate wall", [up(0, "heavyShot")]],
    ["rifled barrel for slot 5", [up(4, "rifled")]],
    ["rifled barrel on the left wall", [up(4, "rifled")]],
  ]);
  // The gun you ride answers for it.
  const riding = viewWith(
    (v) => {
      v.guns[4].empty = false;
    },
    { foundry: true, riding: 4 },
  );
  accepts(riding, [["heavy shot", [up(4, "heavyShot")]]]);
});

test("upgrade: refusals", () => {
  refuses(fixture(), [["heavy shot on the long gun", "Needs a working Foundry"]]);
  const f = viewWith((v) => {
    v.guns[0].upgrade = "rifled";
    v.foundry = true;
  });
  refuses(f, [
    ["heavy shot on the long gun", "One upgrade per gun"],
    ["canister on the long gun", "Canister does not fit a long gun"],
    ["heavy shot on slot 6", "Slot 6 is empty"],
    ["heavy shell for slot 1", "Heavy shell does not fit a long gun"],
  ]);
  refuses(fixture({ foundry: true, gold: 100 }), [["rifled barrel", "Not enough gold: 40 short"]]);
});

test("order: advance, hold, push", () => {
  const o = (order: number): MatchInput[] => [{ kind: "order", order: order as never }];
  accepts(fixture(), [
    ["advance", o(0)],
    ["attack", o(0)],
    ["charge", o(0)],
    ["hold", o(1)],
    ["halt", o(1)],
    ["wait", o(1)],
    ["waves hold", o(1)],
    ["push", o(2)],
    ["push the breach", o(2)],
    ["storm the breach", o(2)],
  ]);
  refuses(fixture(), [
    ["hold the quarry", /^Not understood: hold the quarry$/],
    ["advance hold", /^Not understood/],
  ]);
});

test("route: the player's left and right, in match terms", () => {
  const r = (route: "left" | "centre" | "right"): MatchInput[] => [{ kind: "route", route }];
  // Team 1 is the match's own frame.
  accepts(fixture(), [
    ["waves left", r("left")],
    ["go left", r("left")],
    ["left flank", r("left")],
    ["centre", r("centre")],
    ["center", r("centre")],
    ["middle road", r("centre")],
    ["right road", r("right")],
    ["waves right", r("right")],
  ]);
  // Team 0 faces the other way: its left is the match's right.
  const zero = fixture({ team: 0 });
  accepts(zero, [
    ["waves left", r("right")],
    ["go right", r("left")],
    ["left flank", r("right")],
    ["centre", r("centre")],
    ["right road", r("left")],
  ]);
  const say = parse("waves left", zero);
  assert.equal(say.ok && say.say, "Next waves: left flank");
  refuses(fixture(), [
    ["left", /^Not understood/],
    ["waves left right", /^Not understood/],
  ]);
});

const bar = (plot: number, mix?: "pikemen" | "breach" | "volley" | "mixed", route?: "left" | "centre" | "right"): MatchInput => {
  const i: MatchInput = { kind: "barracks", plot };
  if (mix) i.mix = mix;
  if (route) i.route = route;
  return i;
};

test("barracks: the nth barracks, its mix and its road", () => {
  const two = viewWith((v) => {
    v.plots[3] = { kind: "barracks", state: "standing" };
    v.barracks[3] = { mix: "pikemen", route: "centre" };
  });
  accepts(two, [
    ["second barracks: volley, right", [bar(3, "volley", "right")]],
    ["first barracks breach", [bar(0, "breach")]],
    ["2nd barracks sappers", [bar(3, "breach")]],
    ["barracks on the front right: pikemen, centre", [bar(0, "pikemen", "centre")]],
    ["the barracks on the left by the keep: mixed", [bar(3, "mixed")]],
    ["all barracks volley", [bar(0, "volley"), bar(3, "volley")]],
    ["first barracks left", [bar(0, undefined, "left")]],
    ["first barracks musketeers, then second barracks pikes", [bar(0, "volley"), bar(3, "pikemen")]],
    // No mix and no road: a barracks to build ("a second barracks").
    ["second barracks", [build(4, "barracks")]],
  ]);
  // One barracks: no need to say which.
  accepts(fixture(), [
    ["barracks volley", [bar(0, "volley")]],
    ["barracks: breach, left", [bar(0, "breach", "left")]],
  ]);
  // Team 0: the road is in the player's words, the input in the match's.
  const zero = viewWith((v) => void 0, { team: 0 });
  accepts(zero, [["first barracks volley, left", [bar(0, "volley", "right")]]]);
  const say = parse("second barracks: volley, right", two);
  assert.equal(say.ok && say.say, "Barracks on plot 4, left, by the keep: Volley, right flank");
  refuses(two, [
    ["barracks volley", "Which barracks? Say first, second or all"],
    ["third barracks volley", "No third barracks"],
    ["first barracks volley breach", /^Not understood/],
  ]);
  refuses(viewWith((v) => (v.plots[0] = { kind: "barracks", state: "ruined" })), [["barracks volley", "No barracks standing"]]);
});

const rep = (repair: RepairKind, on: boolean): MatchInput => ({ kind: "repair", repair, on });

test("repair: masons on and off, by kind", () => {
  accepts(fixture(), [
    ["masons off the walls", [rep("walls", false)]],
    ["walls off", [rep("walls", false)]],
    ["stop repairing the towers", [rep("towers", false)]],
    ["masons off the gate, then masons off the keep", [rep("gate", false), rep("keep", false)]],
    ["masons off", [rep("gate", false), rep("walls", false), rep("towers", false), rep("keep", false)]],
  ]);
  const some = viewWith((v) => {
    v.repairs = { gate: false, walls: true, towers: false, keep: false };
  });
  accepts(some, [
    ["masons on the gate", [rep("gate", true)]],
    ["repair the keep", [rep("keep", true)]],
    ["all repairs on", [rep("gate", true), rep("towers", true), rep("keep", true)]],
    // "X first": that kind on, every other kind off, only what changes is sent.
    ["keep first", [rep("walls", false), rep("keep", true)]],
    ["gate first", [rep("gate", true), rep("walls", false)]],
  ]);
  accepts(fixture(), [["keep first", [rep("gate", false), rep("walls", false), rep("towers", false)]]]);
});

test("repair: nothing to change is Already so", () => {
  const r = parse("masons on the walls", fixture());
  assert.deepEqual(r, { ok: true, steps: [], say: "Already so" });
  const r2 = parse("all repairs on", fixture());
  assert.deepEqual(r2, { ok: true, steps: [], say: "Already so" });
  refuses(fixture(), [["masons off the moat", /^Not understood/]]);
});

const man = (emplacement: number): MatchInput => ({ kind: "man", emplacement });

test("man: take a gun, or leave it for the overview", () => {
  accepts(fixture(), [
    ["take the long gun", [man(0)]],
    ["man the mortar", [man(1)]],
    ["the gate wall gun", [man(0)]],
    ["gun three", [man(2)]],
    ["take slot 4", [man(3)]],
    ["man the swivel", [man(3)]],
    ["overview", [man(-1)]],
    ["leave the gun", [man(-1)]],
  ]);
  // The input never carries the aim of the gun left: the page fills that in.
  const r = parse("leave the gun", fixture());
  assert.ok(r.ok && r.steps[0].kind === "input" && !("left" in r.steps[0].input));
  refuses(fixture(), [
    ["gun five", "Slot 5 is empty"],
    ["take the long gun on the moon", /^Not understood/],
    ["gun", "Which gun? Say where it stands"],
    ["take the mortar on the left wall", "No mortar stands there"],
  ]);
  const two = viewWith((v) => {
    v.guns[4].empty = false;
  });
  refuses(two, [["take the long gun", "Which long gun? Say where it stands"]]);
  accepts(two, [["take the long gun on the left wall", [man(4)]]]);
});

const stand = (r: ParseResult) => (r.ok ? r.steps.map((s) => (s.kind === "standing" ? [s.id, s.on] : ["input"])) : r.reason);

test("standing orders: a switch that stays, told from the one-off repair order", () => {
  for (const line of ["keep the gate mended first", "gate first always", "always mend the gate first", "always keep the gate mended first"]) {
    assert.deepEqual(stand(parse(line, fixture())), [["gateFirst", true]], line);
  }
  for (const line of ["rebuild what falls", "always rebuild", "keep rebuilding"]) {
    assert.deepEqual(stand(parse(line, fixture())), [["rebuild", true]], line);
  }
  const both = fixture({ standing: ["gateFirst", "rebuild"] as StandingId[] });
  assert.deepEqual(stand(parse("stop rebuilding", both)), [["rebuild", false]]);
  assert.deepEqual(stand(parse("cancel gate first", both)), [["gateFirst", false]]);
  assert.deepEqual(stand(parse("forget the gate", both)), [["gateFirst", false]]);
  assert.deepEqual(stand(parse("no standing orders", both)), [["gateFirst", false], ["rebuild", false]]);
  assert.deepEqual(stand(parse("standing orders off", both)), [["gateFirst", false], ["rebuild", false]]);
  // Already so.
  assert.deepEqual(parse("stop rebuilding", fixture()), { ok: true, steps: [], say: "Already so" });
  assert.deepEqual(parse("rebuild what falls", both), { ok: true, steps: [], say: "Already so" });
  const say = parse("rebuild what falls", fixture());
  assert.equal(say.ok && say.say, "Standing order: rebuild what falls");
  // "gate first" with no always, keep or mended is the one-off repair order, not a rule.
  const one = viewWith((v) => void 0, {});
  one.repairs = { gate: false, walls: true, towers: true, keep: true };
  assert.deepEqual(inputs(parse("gate first", one)), [rep("gate", true), rep("walls", false), rep("towers", false), rep("keep", false)]);
  assert.deepEqual(stand(parse("gate first", one)).length, 4);
  refuses(fixture(), [
    ["always", /^Not understood/],
    ["rebuild what falls on the moon", /^Not understood/],
  ]);
});

test("refused for good: surrender and friends are never sent", () => {
  const why = "Not by words: surrender or leave from the menu";
  const lines = ["surrender", "give up", "I give up", "yield", "quit", "leave", "leave the match", "restart", "resign", "concede", "exit", "please surrender now", "mill, surrender"];
  for (const line of lines) {
    const r = parse(line, fixture());
    assert.ok(!r.ok, line);
    assert.match(r.ok ? "" : r.reason, /not by words: surrender or leave from the menu$/i, line);
  }
  assert.equal((parse("surrender", fixture()) as { reason: string }).reason, why);
  assert.equal((parse("mill, surrender", fixture()) as { reason: string }).reason, `"surrender": not by words: surrender or leave from the menu`);
  // No sentence gives a surrender input.
  for (const line of ["mill", "give up the gun", "leave the gun", "surrender the keep first"]) {
    const r = parse(line, fixture());
    if (r.ok) assert.ok(r.steps.every((s) => s.kind !== "input" || s.input.kind !== "surrender"));
  }
});

test("refused for good: fire and aim are yours", () => {
  const why = "Fire and aim are yours: the steward only gives orders";
  refuses(fixture(), [
    ["fire", why],
    ["shoot", why],
    ["fire the long gun", why],
    ["aim left", why],
    ["aim at the gate", why],
    ["fire for effect", why],
  ]);
});

test("refused: what it is not sure of is not sent", () => {
  refuses(fixture(), [
    ["", "Say an order"],
    ["   ", "Say an order"],
    ["banana split", "Not understood: banana split"],
    ["build a castle", "Not understood: build a castle"],
    ["mill on the moon", "Not understood: mill on the moon"],
    ["long gun and then some", /^Not understood/],
    ["hello", "Not understood: hello"],
    ["constructor", "Not understood: constructor"],
  ]);
  // One bad part refuses the whole line, and names itself.
  const r = parse("mill, flurble", fixture());
  assert.deepEqual(r, { ok: false, reason: "Not understood: flurble" });
  assert.deepEqual(parse("mill, then barracks, then foundry, then mill, then mill, then mill, then mill", fixture({ gold: 9000 })), { ok: false, reason: "Too many orders: six at most in a line" });
});

test("several orders in one line, in order", () => {
  const r = parse("mill, then waves left", fixture());
  assert.ok(r.ok);
  assert.deepEqual(inputs(r), [build(4, "mill"), { kind: "route", route: "left" }]);
  assert.equal(r.say, "Powder Mill on plot 5, back right: 160 gold; next waves: left flank");
  const r2 = parse("mill and advance; hold. waves right", fixture());
  assert.deepEqual(inputs(r2), [build(4, "mill"), { kind: "order", order: 0 as never }, { kind: "order", order: 1 as never }, { kind: "route", route: "right" }]);
  // Each part sees what the ones before it did: a plot just taken, a gun just bought.
  const r3 = parse("buy a swivel, buy a swivel, rifled barrel", fixture({ gold: 1000, foundry: true }));
  assert.ok(r3.ok);
  assert.deepEqual(inputs(r3).slice(0, 2), [buy(4, "swivel"), buy(5, "swivel")]);
});

test("the examples in the spec all parse", () => {
  const two = viewWith(
    (v) => {
      v.plots[3] = { kind: "barracks", state: "standing" };
      v.foundry = true;
      v.repairs.keep = false;
    },
    { gold: 1000, team: 0 },
  );
  for (const line of [
    "mill",
    "build a mill on the back plot",
    "barracks front right",
    "buy a swivel",
    "long gun for the left wall",
    "heavy shot on the long gun",
    "waves left",
    "advance",
    "hold",
    "push the breach",
    "second barracks: volley, right",
    "masons off the walls",
    "keep first",
    "mill, then waves left",
    "keep the gate mended first",
    "rebuild what falls",
  ]) {
    const r = parse(line, two);
    assert.ok(r.ok, `"${line}": ${r.ok ? "" : r.reason}`);
  }
});

test("parse does not change the view it is given", () => {
  const v = fixture({ gold: 1000, foundry: true });
  const before = JSON.stringify(v);
  parse("mill, then buy a swivel, then rifled barrel, then masons off the gate, then rebuild what falls", v);
  assert.equal(JSON.stringify(v), before);
});

test("the player's chair: words a newcomer tries", () => {
  const v = viewWith(() => {});
  const steps = (t: string) => {
    const r = parse(t, v);
    assert.ok(r.ok, `${t}: ${r.ok ? "" : r.reason}`);
    return r.steps.map((s) => (s.kind === "input" ? s.input : s));
  };
  assert.deepEqual(steps("everyone advance"), [{ kind: "order", order: 0 }]);
  assert.deepEqual(steps("retreat"), [{ kind: "order", order: 1 }]);
  assert.deepEqual(steps("switch to the mortar"), [{ kind: "man", emplacement: 1 }]);
  const up = parse("upgrade the mortar", v);
  assert.equal(up.ok, false);
  assert.equal(!up.ok && up.reason, "Which upgrade? Heavy shell or Quick loader");
});

test("buttresses: words for each face, the steward's line, and the refusals the match would make", () => {
  const v = viewWith(() => {});
  const one = (t: string, w = v) => {
    const r = parse(t, w);
    assert.ok(r.ok, `${t}: ${r.ok ? "" : r.reason}`);
    assert.equal(r.steps.length, 1);
    const s = r.steps[0];
    assert.ok(s.kind === "input");
    return s;
  };
  for (const [line, face] of [
    ["buttress the front", "front"],
    ["buttress the keep", "front"],
    ["Buttress the left", "left"],
    ["buttress the back face", "back"],
    ["build a buttress on the right", "right"],
    ["buttresses on the left side of the keep", "left"],
  ] as const) {
    const s = one(line);
    assert.deepEqual(s.input, { kind: "buttress", face }, line);
    assert.equal(s.cost, BUTTRESS.gold);
  }
  assert.equal(one("buttress the front").say, `Buttress the front of the keep: ${BUTTRESS.gold} gold`);
  // The player's own left, whichever castle it is (faces are in the owner's words).
  assert.deepEqual(one("buttress the left", fixture({ team: 0 })).input, { kind: "buttress", face: "left" });
  // Refused as the match would: a face that has one (rising or standing), not enough gold.
  const rising = fixture({ buttresses: ["rising", "empty", "empty", "empty"] });
  const r1 = parse("buttress the front", rising);
  assert.ok(!r1.ok && r1.reason === "The front has a buttress", !r1.ok ? r1.reason : "");
  const r2 = parse("buttress the back", fixture({ buttresses: ["empty", "standing", "empty", "empty"] }));
  assert.ok(!r2.ok && r2.reason === "The back has a buttress");
  assert.ok(parse("buttress the left", rising).ok, "another face is free");
  const r3 = parse("buttress the left", fixture({ gold: BUTTRESS.gold - 1 }));
  assert.ok(!r3.ok && r3.reason === `Not enough gold: ${BUTTRESS.gold} needed`);
  // Within a line, the first buttress takes the face and the gold.
  const twice = parse("buttress the front and buttress the front", v);
  assert.ok(!twice.ok && /has a buttress/.test(twice.reason));
  const both = parse("buttress the front and buttress the back", fixture({ gold: BUTTRESS.gold * 2 - 1 }));
  assert.ok(!both.ok && /not enough gold/i.test(both.reason));
  const fine = parse("buttress the front and buttress the back", fixture({ gold: BUTTRESS.gold * 2 }));
  assert.ok(fine.ok && fine.steps.length === 2);
  // Nonsense is not understood; two faces at once are refused.
  assert.ok(!parse("buttress the dragon", v).ok);
  assert.ok(!parse("buttress the front back", v).ok);
});
