// Powder on the page (3.3): the words and numbers of the HUD, and the standing order that buys it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { POWDER, powderCost, WEAPON_KINDS, type WeaponKind } from "@keepfall/content";
import type { MatchInput } from "@keepfall/rules";
import { BOX_STRIDE, BOY_STRIDE, type MatchInfo, type PowderInfo } from "../src/protocol";
import { anyDry, boxOf, boyServing, canPay, DryNotes, dryNote, dryState, magazineBlewNote, markTabs, millBlewNote, millsOf, pips, powderBuyWhy, powderLine, type BoxView } from "../src/powder";
import { Standing, type StandingCtx } from "../src/steward/standing";

const box = (over: Partial<BoxView> = {}): BoxView => ({ box: 12, size: 12, cost: 4, eta: -1, hoist: -1, ...over });
const store = (over: Partial<PowderInfo> = {}): PowderInfo => ({ stock: 86, cap: 120, rate: 1.4, magazine: 5, lost: 0, ...over });

test("pips: one per shot a full box holds, lit for each shot it holds now", () => {
  const at = (kind: WeaponKind, held: number, upgrade?: "heavyShot" | "heavyShell") => {
    const cost = powderCost(kind, upgrade);
    return pips(box({ box: held, size: POWDER.box[kind], cost }));
  };
  assert.deepEqual(at("longGun", 12), { total: 3, lit: 3 });
  assert.deepEqual(at("longGun", 7), { total: 3, lit: 1 }, "7 charges is one shot of 4 and a part");
  assert.deepEqual(at("longGun", 3), { total: 3, lit: 0 });
  assert.deepEqual(at("mortar", 20), { total: 2, lit: 2 });
  assert.deepEqual(at("mortar", 10), { total: 2, lit: 1 });
  assert.deepEqual(at("chainShot", 9), { total: 3, lit: 3 });
  assert.deepEqual(at("swivel", 6), { total: 6, lit: 6 });
  assert.deepEqual(at("swivel", 1), { total: 6, lit: 1 });
  assert.deepEqual(at("longGun", 12, "heavyShot"), { total: 2, lit: 2 }, "heavy shot costs 5");
  assert.deepEqual(at("mortar", 20, "heavyShell"), { total: 1, lit: 1 }, "a heavy shell costs 12");
  assert.deepEqual(pips(null), { total: 0, lit: 0 }, "no powder in the match: no pips");
});

test("a box pays when it holds a shot's cost; without a box to read it always does", () => {
  assert.equal(canPay(null), true);
  assert.equal(canPay(box({ box: 4 })), true);
  assert.equal(canPay(box({ box: 3 })), false);
  assert.equal(canPay(box({ box: 0, cost: 1 })), false);
});

function infoWith(boxes: number[][], boys: number[][] = []): Pick<MatchInfo, "boxes" | "boys"> {
  const b = new Float32Array(boxes.length * BOX_STRIDE);
  boxes.forEach((r, i) => b.set(r, i * BOX_STRIDE));
  const y = new Int16Array(boys.length * BOY_STRIDE);
  boys.forEach((r, i) => y.set(r, i * BOY_STRIDE));
  return { boxes: b, boys: y };
}

test("boxOf reads MatchInfo.boxes; an empty slot and a match without powder have none", () => {
  const info = infoWith([[3, 12, 4, 360, -1], [0, 0, 0, -1, -1]]);
  assert.deepEqual(boxOf(info, 0), { box: 3, size: 12, cost: 4, eta: 360, hoist: -1 });
  assert.equal(boxOf(info, 1), null, "an empty slot");
  assert.equal(boxOf(info, 2), null, "out of range");
  assert.equal(boxOf({ boxes: null }, 0), null);
  assert.equal(boxOf(null, 0), null);
});

test("the store by the gold: stock and rate, the cellar form, and Magazine full", () => {
  const n = powderLine(store());
  assert.equal(n.text, "86 +1.4/s");
  assert.equal(n.full, false);
  assert.equal(n.title, "Powder: 86 in the magazine (holds 120), +1.4 a second from the cellar and 2 mills");
  const cellar = powderLine(store({ stock: 24, cap: 30, rate: 0.4, magazine: -1 }));
  assert.equal(cellar.text, "Cellar 24/30 +0.4/s");
  assert.match(cellar.title, /^Powder: 24 in the keep's cellar \(holds 30\), \+0\.4 a second from the cellar and no mills/);
  const full = powderLine(store({ stock: 120, rate: 1.4 }));
  assert.equal(full.text, "Magazine full");
  assert.equal(full.full, true);
  assert.equal(powderLine(store({ stock: 120, rate: 0 })).full, false, "at the cap with nothing coming in is not worth a warning");
  assert.equal(powderLine(store({ stock: 30, cap: 30, rate: 0.4, magazine: -1 })).text, "Cellar full");
  assert.equal(millsOf(0.4, false), 0);
  assert.equal(millsOf(1.4, false), 2);
  assert.equal(millsOf(2.8, true), 2, "sudden death doubles all of it");
  assert.equal(millsOf(1.9, false), 3);
  assert.equal(powderLine(store({ rate: 0.9 })).title.endsWith("from the cellar and 1 mill"), true);
});

test("the dry note says why: eta, a boy on his way, an empty magazine, busy boys", () => {
  assert.equal(dryNote("Long gun", box({ box: 0, eta: 360 }), 80, false), "No powder at the long gun: a boy is 6 s away");
  assert.equal(dryNote("Long gun", box({ box: 0, eta: 61 }), 80, false), "No powder at the long gun: a boy is 2 s away", "rounded up");
  assert.equal(dryNote("Mortar", box({ box: 0, eta: 5 }), 80, false), "No powder at the mortar: a boy is 1 s away");
  assert.equal(dryNote("Swivel", box({ box: 0 }), 80, true), "No powder at the swivel: a boy is on his way");
  assert.equal(dryNote("Chain shot", box({ box: 0 }), 0, false), "No powder at the chain shot: the magazine is empty");
  assert.equal(dryNote("Chain shot", box({ box: 0 }), 0, false, true), "No powder at the chain shot: the cellar is empty");
  assert.equal(dryNote("Long gun", box({ box: 0 }), 50, false), "No powder at the long gun: the boys are busy");
  assert.equal(dryNote("Long gun", box({ box: 0, eta: 120 }), 0, true), "No powder at the long gun: a boy is 2 s away", "the eta comes first");
});

test("dry notes come at most once every 2 s", () => {
  const n = new DryNotes();
  assert.equal(n.take(1000), true);
  assert.equal(n.take(1500), false);
  assert.equal(n.take(2999), false);
  assert.equal(n.take(3000), true);
  n.reset();
  assert.equal(n.take(3001), true);
});

test("a boy serving a gun is read from MatchInfo.boys", () => {
  const info = infoWith([], [[1, 40, 3, 5], [1, -1, 0, 6], [0, 70, 3, 2]]);
  assert.equal(boyServing(info, 1, 5), true);
  assert.equal(boyServing(info, 1, 6), false, "a fallen boy serves nobody");
  assert.equal(boyServing(info, 1, 2), false, "the other castle's boy");
  assert.equal(boyServing({ boys: null }, 1, 5), false);
});

test("anyDry looks only at the team's own guns", () => {
  const info = infoWith([[12, 12, 4, -1, -1], [0, 20, 10, -1, -1], [0, 0, 0, -1, -1]]);
  assert.equal(anyDry(info, (i) => i === 0), false);
  assert.equal(anyDry(info, (i) => i === 1), true);
  assert.equal(anyDry(info, (i) => i === 2), false, "an empty slot is not dry");
  assert.equal(anyDry({ boxes: null }, () => true), false);
});

test("tabs dim while dry and carry a keg mark while a keg is on its way", () => {
  const mk = () => {
    const set = new Set<string>();
    return {
      classList: {
        contains: (c: string) => set.has(c),
        toggle: (c: string, on?: boolean) => (on ? set.add(c) : set.delete(c)),
      },
    } as unknown as HTMLElement;
  };
  const tabs = [mk(), mk(), mk()];
  const info = infoWith([[0, 12, 4, 300, -1], [12, 12, 4, -1, -1], [0, 20, 10, -1, -1]]);
  markTabs(tabs, info, (i) => i);
  assert.deepEqual(tabs.map((t) => [t.classList.contains("dry"), t.classList.contains("kegged")]), [[true, true], [false, false], [true, false]]);
  markTabs(tabs, infoWith([[4, 12, 4, -1, -1], [12, 12, 4, -1, -1], [10, 20, 10, -1, -1]]), (i) => i);
  assert.deepEqual(tabs.map((t) => [t.classList.contains("dry"), t.classList.contains("kegged")]), [[false, false], [false, false], [false, false]]);
  markTabs(tabs, { boxes: null }, (i) => i);
  assert.equal(tabs[0].classList.contains("dry"), false, "a match without powder: nothing is dry");
  assert.ok(WEAPON_KINDS.length > 0);
});

test("the build menu's powder choice says why not", () => {
  const ok = { stock: 40, cap: 120, magazine: 5 };
  assert.equal(powderBuyWhy(ok, 60), "");
  assert.equal(powderBuyWhy(null, 500), "Needs a working magazine");
  assert.equal(powderBuyWhy({ stock: 10, cap: 30, magazine: -1 }, 500), "Needs a working magazine");
  assert.equal(powderBuyWhy({ stock: 101, cap: 120, magazine: 5 }, 500), "The magazine is full");
  assert.equal(powderBuyWhy(ok, 45), "Not enough gold: 15 short");
  assert.equal(powderBuyWhy({ stock: 101, cap: 120, magazine: 5 }, 0), "The magazine is full", "the magazine's state comes before the gold");
});

test("blow-up notes", () => {
  assert.equal(magazineBlewNote(true, 86).note, "Our magazine blew up: 86 powder lost");
  assert.equal(magazineBlewNote(false, 86).note, "Their magazine went up");
  assert.equal(millBlewNote(true).note, "Our Powder Mill blew up");
  assert.equal(millBlewNote(false).note, "Their Powder Mill went up");
});

function rig(ctx: Partial<StandingCtx> = {}) {
  const inputs: MatchInput[] = [];
  const notes: string[] = [];
  const s = new Standing({ act: (i) => inputs.push(i), note: (t) => notes.push(t) });
  const c: StandingCtx = { gateOpen: false, gold: 1000, repairs: { gate: true, walls: true, towers: true, keep: true }, plots: [], powder: { stock: 12, cap: 120, magazine: 5 }, ...ctx };
  return { s, inputs, notes, c };
}

test("the standing order buys powder under twenty, at most once every 5 s", () => {
  const { s, inputs, notes, c } = rig();
  s.tick(0, c);
  assert.equal(inputs.length, 0, "off: nothing");
  s.set("powder", true);
  s.tick(500, c);
  assert.deepEqual(inputs, [{ kind: "powder" }]);
  assert.deepEqual(notes, ["Steward: bought powder"]);
  s.tick(1000, c);
  s.tick(5000, c);
  assert.equal(inputs.length, 1, "less than 5 s since the last buy");
  s.tick(5600, c);
  assert.equal(inputs.length, 2, "5 s on, it buys again");
});

test("the standing order waits for the stock, a working magazine, room and gold", () => {
  const cases: Array<[string, Partial<StandingCtx>]> = [
    ["twenty is not under twenty", { powder: { stock: 20, cap: 120, magazine: 5 } }],
    ["no working magazine", { powder: { stock: 5, cap: 30, magazine: -1 } }],
    ["a match without powder", { powder: null }],
    ["no powder field at all", { powder: undefined }],
    ["gold short", { gold: 59 }],
  ];
  for (const [what, over] of cases) {
    const { s, inputs, c } = rig(over);
    s.set("powder", true);
    s.tick(500, c);
    assert.equal(inputs.length, 0, what);
  }
  const room = rig({ powder: { stock: 19, cap: 30, magazine: 5 } });
  room.s.set("powder", true);
  room.s.tick(500, room.c);
  assert.equal(room.inputs.length, 0, "no room for all of 20");
  const edge = rig({ powder: { stock: 19, cap: 120, magazine: 5 }, gold: 60 });
  edge.s.set("powder", true);
  edge.s.tick(500, edge.c);
  assert.equal(edge.inputs.length, 1, "19 powder and exactly 60 gold: buys");
});

test("a new match resets the standing order's clock", () => {
  const { s, inputs, c } = rig();
  s.set("powder", true);
  s.tick(500, c);
  s.reset();
  s.set("powder", true);
  s.tick(1100, c);
  assert.equal(inputs.length, 2);
});

test("a loaded gun whose box cannot pay is not Ready: its card says No powder, and when its keg comes", () => {
  assert.equal(dryState(null), "", "no box to read (no powder in this match): nothing to say");
  assert.equal(dryState(box({ box: 4 })), "", "it can pay");
  assert.equal(dryState(box({ box: 0, eta: 360 })), "No powder: keg in 6 s");
  assert.equal(dryState(box({ box: 0, eta: 1 })), "No powder: keg in 1 s", "never 0 s");
  assert.equal(dryState(box({ box: 0, eta: -1 })), "No powder", "none on its way");
});
