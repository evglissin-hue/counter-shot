// The AI's orders: it holds only against a real threat, a Hold ends, a way in that stays open pushes, and orders do not churn.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_LEVELS, MID_Z, MUSTER, WAVES } from "@keepfall/content";
import { Rng } from "@keepfall/core";
import { FLOW_INF, MinionState, Order, Role } from "@keepfall/sim";
import type { Match, MatchInput } from "@keepfall/rules";
import { Steward } from "../src/steward";
import { threat } from "../src/view";

const man = (team: number, x: number, z: number, o: object = {}) => ({ team, x, z, state: MinionState.Upright, wave: 0, role: Role.March, ...o });

/** A match with only what the orders read: the men, the standing order, and whether the way in is open. */
function fake(list: object[]) {
  const st = { list, open: false };
  const m = {
    world: { minions: { list } },
    army: { order: [Order.Advance, Order.Advance], flow: { at: () => (st.open ? 0 : FLOW_INF) } },
    repairs: [{ gate: true, walls: true, towers: true, keep: true }, { gate: true, walls: true, towers: true, keep: true }],
    gold: [0, 0],
  };
  return { m: m as unknown as Match, st };
}

function steward(level: "squire" | "knight" | "warlord", m: Match, sent: Array<[number, Order]>, stage: (() => number) | null = null) {
  const s = new Steward(m, 0, level, AI_LEVELS[level], new Rng(1), (t: number, i: MatchInput) => {
    if (i.kind === "order") sent.push([t, i.order]);
  }, stage);
  return (tick: number) => (s as unknown as { orders(t: number): void }).orders(tick);
}

const S = 60;

test("the threat counts only men on its side of the stream or near its gate", () => {
  const g = MUSTER[0];
  const { m } = fake([
    man(1, 0, MID_Z - 30), // holding behind the stream: no
    man(1, 30, MID_Z - 80), // at home: no
    man(1, 0, MID_Z + 20), // across the stream, on its side: yes
    man(1, 0, g.z + 40), // at its gate: yes
    man(0, 0, g.z), // its own man: no
    man(1, 0, MID_Z + 5, { state: MinionState.Ragdoll }), // ragdoll: no
  ]);
  assert.equal(threat(m, 0), 2);
});

test("a Hold ends after 45 s and does not return for 60 s", () => {
  const men: object[] = [];
  for (let i = 0; i < 30; i++) men.push(man(1, i, MID_Z + 20));
  const { m } = fake(men);
  const sent: Array<[number, Order]> = [];
  const look = steward("knight", m, sent);
  const orderOf = () => (m as unknown as { army: { order: Order[] } }).army.order;
  for (let t = 0; t < 400 * S; t += 4 * S) {
    look(t);
    orderOf()[0] = sent.length ? sent[sent.length - 1][1] : Order.Advance;
  }
  const holds = sent.filter(([, o]) => o === Order.Hold);
  assert.ok(holds.length >= 2, "it holds again after resting");
  for (let i = 0; i < sent.length - 1; i++) {
    if (sent[i][1] !== Order.Hold) continue;
    const [t0] = sent[i], [t1] = sent[i + 1];
    assert.ok(t1 - t0 <= 50 * S, `a Hold lasted ${(t1 - t0) / S} s`);
    const next = sent.slice(i + 2).find(([, o]) => o === Order.Hold);
    if (next) assert.ok(next[0] - t1 >= 60 * S, "a rest of 60 s before the next Hold");
  }
});

test("a Hold ends early when the threat is gone, and many men never hold", () => {
  const men: object[] = [];
  for (let i = 0; i < 30; i++) men.push(man(1, i, MID_Z + 20));
  const { m } = fake(men);
  const sent: Array<[number, Order]> = [];
  const look = steward("knight", m, sent);
  look(100 * S);
  assert.deepEqual(sent.map((s) => s[1]), [Order.Hold]);
  (m as unknown as { army: { order: Order[] } }).army.order[0] = Order.Hold;
  men.length = 0;
  look(130 * S);
  assert.deepEqual(sent.map((s) => s[1]), [Order.Hold, Order.Advance]);

  const crowd: object[] = [];
  for (let i = 0; i < 30; i++) crowd.push(man(1, i, MID_Z + 20));
  for (let i = 0; i < WAVES.maxStanding - 8; i++) crowd.push(man(0, i, -10));
  const b = fake(crowd), sent2: Array<[number, Order]> = [];
  steward("knight", b.m, sent2)(100 * S);
  assert.equal(sent2.length, 0, "with its men at the cap's edge it does not hold");
});

test("a way in pushes only once it has stayed open, and Push is left only after it stayed shut", () => {
  const { m, st } = fake([]);
  const sent: Array<[number, Order]> = [];
  const look = steward("knight", m, sent);
  st.open = true;
  look(100 * S);
  look(102 * S);
  assert.equal(sent.length, 0, "open for 2 s: not yet");
  look(105 * S);
  assert.deepEqual(sent, [[105 * S, Order.Push]]);
  (m as unknown as { army: { order: Order[] } }).army.order[0] = Order.Push;
  st.open = false;
  look(130 * S);
  look(135 * S);
  assert.equal(sent.length, 1, "shut for 5 s: still Push");
  look(141 * S);
  assert.deepEqual(sent.map((s) => s[1]), [Order.Push, Order.Advance]);
});

test("orders change at most 6 times in 5 minutes", () => {
  const men: object[] = [];
  const { m, st } = fake(men);
  const sent: Array<[number, Order]> = [];
  const look = steward("warlord", m, sent);
  const orderOf = (m as unknown as { army: { order: Order[] } }).army.order;
  for (let t = 0; t < 1200 * S; t += 2 * S) {
    st.open = Math.floor(t / (37 * S)) % 2 === 0;
    men.length = 0;
    if (Math.floor(t / (53 * S)) % 2 === 0) for (let i = 0; i < 40; i++) men.push(man(1, i, MID_Z + 20));
    look(t);
    if (sent.length) orderOf[0] = sent[sent.length - 1][1];
  }
  for (const [t] of sent) assert.ok(sent.filter(([u]) => u >= t && u < t + 300 * S).length <= 6, `more than 6 changes within 5 min of ${t / S} s`);
  assert.ok(sent.length >= 4, "it still changes orders");
});

test("the Squire and the tutor keep the old rules: no Hold, Push at once on a way in", () => {
  for (const [level, stage] of [["squire", null], ["knight", () => 2]] as const) {
    const men: object[] = [];
    for (let i = 0; i < 40; i++) men.push(man(1, i, MID_Z + 20));
    const { m, st } = fake(men);
    const sent: Array<[number, Order]> = [];
    const look = steward(level, m, sent, stage);
    look(100 * S);
    assert.equal(sent.length, 0, `${level}: no Hold`);
    st.open = true;
    look(110 * S);
    if (stage) assert.equal(sent.length, 0, "the tutor never pushes");
    else assert.deepEqual(sent, [[110 * S, Order.Push]]);
  }
});
