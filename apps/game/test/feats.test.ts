import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATS, FEATS_KEY, Feats, bestText, type FeatDef, type Store } from "../src/feats";
import type { Moment } from "../src/moments";

const moment = (o: Partial<Moment>): Moment => ({ atMs: 0, tick: 0, x: 0, y: 0, z: 0, kind: "multiKill", team: 1, score: 100, text: "", size: 3, ...o });
const memory = (): Store & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

test("the book has about twenty feats with plain names, hints and no dashes", () => {
  assert.ok(FEATS.length >= 20 && FEATS.length <= 30);
  const names = FEATS.map((f) => f.name);
  for (const n of ["Timber", "Domino", "Skipping stone", "Return to sender"]) assert.ok(names.includes(n), n);
  assert.equal(new Set(FEATS.map((f) => f.id)).size, FEATS.length);
  for (const f of FEATS) assert.ok(!/[–—]/.test(f.name + f.hint), f.id);
});

test("a threshold met unlocks once, with the first date; the best then updates", () => {
  const store = memory();
  const firsts: FeatDef[] = [];
  const bests: number[] = [];
  const f = new Feats({ me: 1, store, today: () => "2026-11-10", onFirsts: (l) => firsts.push(...l.map((x) => x.def)), onBest: (_, v) => bests.push(v) });
  f.observe(moment({ size: 2 }));
  assert.equal(firsts.length, 0, "two men is under every threshold");
  f.observe(moment({ size: 3 }));
  assert.deepEqual(firsts.map((d) => d.id), ["skittles"]);
  f.observe(moment({ size: 3 }));
  assert.equal(firsts.length, 1, "unlocks once");
  f.observe(moment({ size: 6 }));
  assert.deepEqual(firsts.map((d) => d.id), ["skittles", "strike"]);
  assert.deepEqual(bests, [6], "skittles best moves to 6");
  const row = f.list().find((r) => r.def.id === "skittles")!;
  assert.equal(row.record?.best, 6);
  assert.equal(row.record?.first, "2026-11-10");
  assert.equal(bestText(row.def, row.record!), "6 men");
  f.observe(moment({ size: 4 }));
  assert.equal(f.list().find((r) => r.def.id === "skittles")!.record?.best, 6, "a lesser one does not lower it");
  assert.ok(store.data.get(FEATS_KEY));
});

test("only the player's own doing counts", () => {
  const f = new Feats({ me: 1, store: memory() });
  f.observe(moment({ team: 0, size: 9 }));
  f.observe(moment({ team: -1, size: 9 }));
  assert.equal(f.earned(), 0);
  f.observe(moment({ team: 1, kind: "gateDown", size: 1 }));
  assert.equal(f.earned(), 1);
});

test("the book is kept between visits", () => {
  const store = memory();
  new Feats({ me: 1, store, today: () => "2026-11-10" }).observe(moment({ kind: "thrown", size: 24 }));
  let again = 0;
  const f = new Feats({ me: 1, store, onFirsts: () => again++ });
  assert.equal(f.earned(), 1);
  f.observe(moment({ kind: "thrown", size: 22 }));
  assert.equal(again, 0, "already in the book");
  assert.equal(f.list().find((r) => r.def.id === "hurled")!.record?.best, 24);
});

test("storage that throws does not break the book", () => {
  const broken: Store = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("full");
    },
  };
  const firsts: string[] = [];
  const f = new Feats({ me: 1, store: broken, onFirsts: (l) => firsts.push(...l.map((x) => x.def.id)) });
  f.observe(moment({ kind: "towerDown", size: 212, men: 9 }));
  assert.ok(firsts.includes("timber") && firsts.includes("rubble") && firsts.includes("domino"));
  assert.equal(f.earned(), firsts.length, "held for the session");
  const none = new Feats({ me: 1, store: null });
  none.observe(moment({ kind: "gateDown", size: 1 }));
  assert.equal(none.earned(), 1);
});

test("damaged storage starts an empty book", () => {
  const store = memory();
  store.data.set(FEATS_KEY, "{not json");
  const f = new Feats({ me: 1, store });
  assert.equal(f.earned(), 0);
  store.data.set(FEATS_KEY, JSON.stringify({ gate: { first: 5, best: "x" }, timber: { first: "2026-01-01", best: 50 } }));
  assert.equal(new Feats({ me: 1, store }).earned(), 1);
});

test("rules: a tower's men count towards Domino, a breach too; a keg sent back is Return to sender", () => {
  const f = new Feats({ me: 1, store: memory() });
  f.observe(moment({ kind: "breachOpened", size: 40, men: 6 }));
  f.observe(moment({ kind: "kegBack", size: 3 }));
  f.observe(moment({ kind: "ricochetKill", size: 1 }));
  const earned = f.list().filter((r) => r.record).map((r) => r.def.name);
  assert.deepEqual(earned.sort(), ["Domino", "Hole in the wall", "Return to sender", "Skipping stone"].sort());
});
