import {
  BUILDING_REBUILD,
  BUILDINGS,
  plotName,
  POWDER,
  REPAIR_KINDS,
  UPGRADES,
  upgradesFor,
  WAVE_MIXES,
  WEAPON_COST,
  WEAPONS,
  type BuildingKind,
  type MixName,
  type RepairKind,
  type RouteName,
  type UpgradeKind,
  type WeaponKind,
} from "@keepfall/content";
import type { MatchInput } from "@keepfall/rules";
import type { Order } from "@keepfall/sim";
import type { GunView, OrdersView, ParseResult, StandingId, Step } from "./types";
import {
  ALL_WORDS,
  BARRACKS_FILLER,
  BUILD_VERBS,
  BUILDING_WORDS,
  BUY_VERBS,
  FILLER,
  FIRE_WORDS,
  GUN_PLACE_WORDS,
  MAN_VERBS,
  MAX_PARTS,
  MIX_WORDS,
  NUMBER_WORDS,
  OFF_WORDS,
  ORDER_FILLER,
  ORDER_SAYS,
  ORDER_WORDS,
  ORDINAL_NAMES,
  ORDINAL_WORDS,
  OVERVIEW_WORDS,
  PLOT_WORDS,
  POWDER_FILLER,
  POWDER_STANDING,
  REBUILD_WORDS,
  REPAIR_CUES,
  REPAIR_FILLER,
  REPAIR_KIND_WORDS,
  ROUTE_CUES,
  ROUTE_FILLER,
  ROUTE_WORDS,
  SPLITTERS,
  STANDING_FILLER,
  STANDING_IDS,
  STANDING_OFF,
  STANDING_ORDERS,
  STANDING_TRIGGERS,
  SURRENDER_PHRASES,
  SURRENDER_WORDS,
  SYNONYMS,
  UPGRADE_VERBS,
  UPGRADE_WORDS,
  WEAPON_WORDS,
} from "./words";

/** Plots a new building takes first (the build menu's own order): the back ones, then the sides, then the front. */
const PLOT_ORDER = [4, 5, 2, 3, 1, 0];

const R_SURRENDER = "Not by words: surrender or leave from the menu";
const R_FIRE = "Fire and aim are yours: the steward only gives orders";

type Tokens = string[];
type Res = { ok: true; steps: Step[] } | { ok: false; reason: string };
interface Part {
  text: string;
  toks: Tokens;
}

const own = <T>(o: Record<string, T>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);
const fail = (reason: string): Res => ({ ok: false, reason });
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const isCard = (t: string | undefined): t is string => t !== undefined && /^\d+$/.test(t);
const isOrd = (t: string | undefined): t is string => t !== undefined && /^o\d+$/.test(t);
const ordVal = (t: string) => Number(t.slice(1));

/** One word as a token: numbers are digits, ordinals "o" and digits, synonyms folded. */
function norm(w: string): string {
  const n = own(NUMBER_WORDS, w);
  if (n !== undefined) return String(n);
  const o = own(ORDINAL_WORDS, w);
  if (o !== undefined) return `o${o}`;
  const m = /^(\d+)(?:st|nd|rd|th)$/.exec(w);
  if (m) return `o${Number(m[1])}`;
  return own(SYNONYMS, w) ?? w;
}

/** A line's words as tokens, filler kept. */
function tokenize(text: string): Tokens {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(norm);
}

/** Tokens without filler. */
function lean(text: string): Tokens {
  return tokenize(text).filter((t) => !FILLER.has(t));
}

// Working on a token list: phrases are taken out as they are understood, and whatever is left over must be known.

const phraseAt = (t: Tokens, phrase: string[]): number => {
  for (let i = 0; i + phrase.length <= t.length; i++) if (phrase.every((w, j) => t[i + j] === w)) return i;
  return -1;
};
const hasPhrase = (t: Tokens, phrase: string) => phraseAt(t, phrase.split(" ")) >= 0;
function take(t: Tokens, phrase: string): boolean {
  const p = phrase.split(" ");
  const i = phraseAt(t, p);
  if (i < 0) return false;
  t.splice(i, p.length);
  return true;
}
function takeWord(t: Tokens, pred: (w: string) => boolean): void {
  for (let i = t.length - 1; i >= 0; i--) if (pred(t[i])) t.splice(i, 1);
}
/** "slot N" (digits or an ordinal), or "Nth slot". */
function takeSlot(t: Tokens): number | undefined {
  const i = t.indexOf("slot");
  if (i < 0) return undefined;
  const next = t[i + 1], prev = t[i - 1];
  if (isCard(next)) {
    t.splice(i, 2);
    return Number(next);
  }
  if (isOrd(next)) {
    t.splice(i, 2);
    return ordVal(next);
  }
  if (isOrd(prev)) {
    t.splice(i - 1, 2);
    return ordVal(prev);
  }
  return undefined;
}
/** "plot N" (1-based); a bare "plot" is dropped. */
function takePlot(t: Tokens): number | undefined {
  const i = t.indexOf("plot");
  if (i < 0) return undefined;
  const next = t[i + 1];
  if (isCard(next)) {
    t.splice(i, 2);
    return Number(next);
  }
  takeWord(t, (w) => w === "plot");
  return undefined;
}

interface WeaponHit {
  kind: WeaponKind | null;
}
function findWeapon(t: Tokens): WeaponHit | null {
  for (const e of WEAPON_WORDS) for (const p of e.phrases) if (hasPhrase(t, p)) return { kind: e.kind };
  return null;
}
function takeWeapon(t: Tokens): WeaponHit | null {
  for (const e of WEAPON_WORDS) for (const p of e.phrases) if (take(t, p)) return { kind: e.kind };
  return null;
}
function findUpgrade(t: Tokens): UpgradeKind | null {
  for (const e of UPGRADE_WORDS) for (const p of e.phrases) if (hasPhrase(t, p)) return e.upgrade;
  return null;
}
function takeUpgrade(t: Tokens): UpgradeKind | null {
  for (const e of UPGRADE_WORDS) for (const p of e.phrases) if (take(t, p)) return e.upgrade;
  return null;
}
function takeBuilding(t: Tokens): BuildingKind | null {
  for (const e of BUILDING_WORDS) for (const p of e.phrases) if (take(t, p)) return e.kind;
  return null;
}
const hasBuilding = (t: Tokens) => BUILDING_WORDS.some((e) => e.phrases.some((p) => hasPhrase(t, p)));

const weaponName = (k: WeaponKind) => WEAPONS[k].name.toLowerCase();
const routeLabel = (r: RouteName) => (r === "centre" ? "centre road" : `${r} flank`);
/** A road in the player's words and in match terms: castle 0 faces the other way, so its left is the match's right. */
const matchRoute = (team: 0 | 1, r: RouteName): RouteName => (team === 0 && r !== "centre" ? (r === "left" ? "right" : "left") : r);

/** What the page knows, copied so each step of a line can change it for the next. */
function work(v: OrdersView): OrdersView {
  return {
    ...v,
    plots: v.plots.map((p) => ({ ...p })),
    guns: v.guns.map((g) => ({ ...g, allowed: [...g.allowed] })),
    barracks: v.barracks.map((b) => (b ? { ...b } : null)),
    repairs: { ...v.repairs },
    standing: [...v.standing],
    powder: v.powder ? { ...v.powder } : null,
  };
}

/** A step's effect on the working copy, so the next part of the line sees it (cumulative gold, a plot just taken). */
function apply(w: OrdersView, s: Step): void {
  if (s.kind === "standing") {
    w.standing = w.standing.filter((x) => x !== s.id);
    if (s.on) w.standing.push(s.id);
    return;
  }
  const i = s.input;
  w.gold -= s.cost;
  switch (i.kind) {
    case "build":
      w.plots[i.plot] = { kind: i.building, state: "rising" };
      break;
    case "buy": {
      const g = w.guns.find((x) => x.id === i.emplacement);
      if (g) Object.assign(g, { empty: false, weapon: i.weapon, upgrade: null });
      break;
    }
    case "upgrade": {
      const g = w.guns.find((x) => x.id === i.emplacement);
      if (g) g.upgrade = i.upgrade;
      break;
    }
    case "barracks": {
      const cur = w.barracks[i.plot];
      w.barracks[i.plot] = { mix: i.mix ?? cur?.mix ?? "pikemen", route: i.route ?? cur?.route ?? "centre" };
      break;
    }
    case "powder":
      if (w.powder) w.powder = { ...w.powder, stock: w.powder.stock + POWDER.buy.charges };
      break;
    case "repair":
      w.repairs[i.repair] = i.on;
      break;
    case "order":
      w.order = i.order;
      break;
    case "route":
      w.route = i.route;
      break;
    case "man":
      w.riding = i.emplacement < 0 ? -1 : (w.guns.find((x) => x.id === i.emplacement)?.slot ?? -1);
      break;
  }
}

const input = (input: MatchInput, say: string, cost = 0): Step => ({ kind: "input", input, say, cost });
const ok = (...steps: Step[]): Res => ({ ok: true, steps });

/** Cut a line into parts at commas, full stops, "then", "and then" and "and"; a barracks' mix and road after a comma stay with it. */
function split(text: string): Part[] {
  const cuts = new RegExp(`(\\s*[,;.\\n]+|${SPLITTERS.map((s) => `\\s+${s}\\s+`).join("|")})`);
  const pieces = ` ${text} `.split(cuts);
  const parts: Array<Part & { soft: boolean }> = [];
  let soft = true;
  for (let i = 0; i < pieces.length; i++) {
    if (i % 2 === 1) {
      soft = !/then/i.test(pieces[i]);
      continue;
    }
    const frag = pieces[i].trim();
    const toks = lean(frag);
    if (toks.length === 0) continue;
    const prev = parts[parts.length - 1];
    if (prev && soft && mergesInto(prev.toks, toks)) {
      prev.text = `${prev.text}, ${frag}`;
      prev.toks = [...prev.toks, ...toks];
    } else parts.push({ text: frag, toks, soft });
    soft = true;
  }
  return parts;
}

/** Is a barracks' mix or road setting being set across commas ("second barracks: volley, right")? */
function mergesInto(prev: Tokens, cur: Tokens): boolean {
  // A place name with a comma in it, said as the game says it: "left, by the keep", "the front wall, left of the gate".
  if (cur[0] === "by" && cur.every((t) => PLOT_WORDS.has(t)) && hasBuilding(prev)) return true;
  if ((cur[0] === "left" || cur[0] === "right") && cur.length === 2 && cur[1] === "gate" && prev.includes("wall")) return true;
  if (!prev.includes("barracks")) return false;
  const bits = cur.filter((t) => own(MIX_WORDS, t) || ROUTE_WORDS.has(t) || t === "flank" || t === "road" || t === "route");
  if (bits.length !== cur.length) return false;
  const curMix = cur.some((t) => own(MIX_WORDS, t));
  const prevSetting = prev.some((t) => own(MIX_WORDS, t) || isOrd(t) || ALL_WORDS.has(t));
  return curMix || prevSetting;
}

/** Parse one line: its steps in order, or why it is refused. */
export function parse(text: string, view: OrdersView): ParseResult {
  const parts = typeof text === "string" ? split(text) : [];
  if (parts.length === 0) return { ok: false, reason: "Say an order" };
  if (parts.length > MAX_PARTS) return { ok: false, reason: "Too many orders: six at most in a line" };
  const w = work(view);
  const steps: Step[] = [];
  for (const part of parts) {
    const r = parsePart(part, w);
    if (!r.ok) {
      const reason = parts.length === 1 || r.reason.startsWith("Not understood") ? r.reason : `"${part.text}": ${lowerFirst(r.reason)}`;
      return { ok: false, reason };
    }
    for (const s of r.steps) {
      apply(w, s);
      steps.push(s);
    }
  }
  return { ok: true, steps, say: steps.length ? steps.map((s, i) => (i ? s.say.charAt(0).toLowerCase() + s.say.slice(1) : s.say)).join("; ") : "Already so" };
}

function parsePart(p: Part, w: OrdersView): Res {
  const t = [...p.toks];
  const notUnderstood = () => fail(`Not understood: ${p.text}`);
  const gunish = t.some((x) => x === "gun" || x === "cannon" || x === "mortar" || x === "swivel" || x === "chain" || x === "overview");
  if (t.some((x) => SURRENDER_WORDS.includes(x)) || SURRENDER_PHRASES.some((ph) => phraseAt(t, ph) >= 0) || (t.includes("leave") && !gunish)) return fail(R_SURRENDER);
  if (t.some((x) => FIRE_WORDS.includes(x))) return fail(R_FIRE);

  // Powder: "powder" is bought at once; with "under", "always" and the like it is the standing order (not the Powder Mill: that is a building).
  if (t.includes("powder") && !hasPhrase(t, "powder mill")) {
    if (t.some((x) => POWDER_STANDING.has(x) || STANDING_TRIGGERS.has(x))) return standing(t, w, notUnderstood);
    return powder(t, w, notUnderstood);
  }
  if (t.some((x) => STANDING_TRIGGERS.has(x))) return standing(t, w, notUnderstood);
  if (isBarracksSetting(t)) return barracksSetting(t, w, notUnderstood);
  if (hasBuilding(t) || t.some((x) => REBUILD_WORDS.has(x))) return build(t, w, notUnderstood);
  if (findUpgrade(t)) return upgrade(t, w, notUnderstood);
  if (t.some((x) => UPGRADE_VERBS.has(x))) {
    const k = findWeapon(t)?.kind;
    return fail(k ? `Which upgrade? ${upgradesFor(k).map((u) => u.name).join(" or ")}` : "Which upgrade? Name it, as the build menu does");
  }
  const weapon = findWeapon(t);
  const buyVerb = t.some((x) => BUY_VERBS.has(x));
  if (t.some((x) => MAN_VERBS.has(x) || OVERVIEW_WORDS.has(x) || x === "leave") || (weapon && weapon.kind === null && !buyVerb)) return man(t, w, notUnderstood);
  if (weapon) return buy(t, w, notUnderstood);
  if (t.some((x) => REPAIR_CUES.has(x)) || (t.some((x) => own(REPAIR_KIND_WORDS, x)) && t.some((x) => OFF_WORDS.has(x) || x === "o1"))) return repair(t, w, notUnderstood);
  if (t.some((x) => own(ORDER_WORDS, x) !== undefined)) return order(t, notUnderstood);
  if (t.some((x) => ROUTE_WORDS.has(x))) return route(t, w, notUnderstood);
  return notUnderstood();
}

// Standing orders

function standing(t: Tokens, w: OrdersView, nope: () => Res): Res {
  if (t.some((x) => !STANDING_FILLER.has(x))) return nope();
  const off = t.some((x) => STANDING_OFF.has(x));
  const ids = new Set<StandingId>();
  for (const x of t) {
    const id = own(STANDING_IDS, x);
    if (id) ids.add(id);
  }
  if (ids.size === 0) {
    // "no standing orders", "standing orders off": every one off. Nothing says "all on".
    if (!(off && (t.includes("standing") || t.includes("order") || t.includes("orders")))) return nope();
    (Object.keys(STANDING_ORDERS) as StandingId[]).forEach((id) => ids.add(id));
  }
  const steps: Step[] = [];
  for (const id of Object.keys(STANDING_ORDERS) as StandingId[]) {
    if (!ids.has(id) || w.standing.includes(id) === !off) continue;
    steps.push({ kind: "standing", id, on: !off, say: `Standing order${off ? " off" : ""}: ${lowerFirst(STANDING_ORDERS[id].name)}` });
  }
  return { ok: true, steps };
}

// Powder

/** Buy powder at the working magazine: the same refusals the match would make, said first. */
function powder(t: Tokens, w: OrdersView, nope: () => Res): Res {
  if (t.some((x) => !POWDER_FILLER.has(x))) return nope();
  const p = w.powder;
  if (!p || p.magazine < 0) return fail("No working magazine");
  if (p.cap - p.stock < POWDER.buy.charges) return fail("The magazine is full");
  if (POWDER.buy.gold > w.gold) return fail(`Not enough gold: ${POWDER.buy.gold - w.gold} short`);
  return ok(input({ kind: "powder" }, `Powder: ${POWDER.buy.charges} for ${POWDER.buy.gold} gold`, POWDER.buy.gold));
}

/** Does the team hold a magazine, standing or rising? (The match allows one.) */
const magazineUp = (w: OrdersView) => w.plots.some((p) => p.kind === "magazine" && (p.state === "standing" || p.state === "rising"));

// Building

function build(t: Tokens, w: OrdersView, nope: () => Res): Res {
  const rebuild = t.some((x) => REBUILD_WORDS.has(x));
  takeWord(t, (x) => REBUILD_WORDS.has(x) || BUILD_VERBS.has(x) || isOrd(x));
  const kind = takeBuilding(t);
  const plotNum = takePlot(t);
  if (t.some((x) => !PLOT_WORDS.has(x))) return nope();
  const words = [...new Set(t)];
  if (plotNum !== undefined && (plotNum < 1 || plotNum > w.plots.length)) return fail(`No plot ${plotNum}`);
  const named = plotNum !== undefined || words.length > 0;
  const tokensOf = (i: number) => new Set(lean(plotName(w.team, i)));
  const matches = (plotNum !== undefined ? [plotNum - 1] : PLOT_ORDER).filter((i) => words.every((x) => tokensOf(i).has(x)));
  const plotSay = (i: number) => `plot ${i + 1}, ${plotName(w.team, i)}`;

  if (rebuild) {
    const ruins = [...matches].sort((a, b) => a - b).filter((i) => w.plots[i].state === "ruined" && w.plots[i].kind !== null && (!kind || w.plots[i].kind === kind));
    if (ruins.length === 0) return fail(named ? "No ruin there to rebuild" : "Nothing ruined to rebuild");
    const i = ruins[0];
    const k = w.plots[i].kind as BuildingKind;
    if (k === "magazine" && magazineUp(w)) return fail("You have a magazine already");
    const cost = Math.round(BUILDINGS[k].cost * BUILDING_REBUILD);
    if (cost > w.gold) return fail(`Not enough gold: ${cost - w.gold} short`);
    return ok(input({ kind: "build", plot: i, building: k }, `Rebuild the ${BUILDINGS[k].name} on ${plotSay(i)}: ${cost} gold`, cost));
  }

  if (!kind) return nope();
  if (kind === "magazine" && magazineUp(w)) return fail("You have a magazine already");
  const eligible = matches.filter((i) => w.plots[i].state === "empty" || (named && w.plots[i].state === "ruined" && w.plots[i].kind === kind));
  if (eligible.length === 0) {
    if (!named) return fail("No free plot");
    if (matches.length === 0) return fail("No plot is called that");
    return fail(matches.length === 1 ? `Plot ${matches[0] + 1} is taken` : "No free plot");
  }
  const i = eligible[0];
  const ruin = w.plots[i].state === "ruined";
  const cost = ruin ? Math.round(BUILDINGS[kind].cost * BUILDING_REBUILD) : BUILDINGS[kind].cost;
  if (cost > w.gold) return fail(`Not enough gold: ${cost - w.gold} short`);
  return ok(input({ kind: "build", plot: i, building: kind }, `${ruin ? "Rebuild the " : ""}${BUILDINGS[kind].name} on ${plotSay(i)}: ${cost} gold`, cost));
}

// Guns

/** Every word a gun's place may be told by: the fixed list and every word of the page's own place names. */
function placeVocab(w: OrdersView): Set<string> {
  const v = new Set(GUN_PLACE_WORDS);
  for (const g of w.guns) for (const x of lean(g.place)) v.add(x);
  return v;
}
const placeHas = (g: GunView, words: string[]) => {
  const have = new Set(lean(g.place));
  return words.every((x) => have.has(x));
};
/**
 * The guns a place names, lowest slot first. Words that name one gun's place
 * exactly ("the gate wall") pick it over guns whose longer names hold them
 * ("the front wall, left of the gate").
 */
function placePool(w: OrdersView, words: string[]): GunView[] {
  const all = [...w.guns].sort((a, b) => a.slot - b.slot).filter((g) => placeHas(g, words));
  const exact = all.filter((g) => new Set(lean(g.place)).size === words.length);
  return words.length > 0 && exact.length === 1 ? exact : all;
}
const gunSay = (g: GunView) => `slot ${g.slot + 1}${g.place ? `, ${g.place}` : ""}`;

function buy(t: Tokens, w: OrdersView, nope: () => Res): Res {
  takeWord(t, (x) => BUY_VERBS.has(x));
  const slot = takeSlot(t);
  const hit = takeWeapon(t);
  if (!hit) return nope();
  const vocab = placeVocab(w);
  if (t.some((x) => !vocab.has(x))) return nope();
  const words = [...new Set(t)];
  const kind = hit.kind;
  const what = kind ? weaponName(kind) : "gun";
  const there = slot !== undefined || words.length > 0 ? " there" : "";
  const guns = [...w.guns].sort((a, b) => a.slot - b.slot);
  let pool: GunView[];
  if (slot !== undefined) {
    const g = guns.find((x) => x.slot === slot - 1);
    if (!g) return fail(`No slot ${slot}`);
    if (!g.empty) return fail(`Slot ${slot} is taken`);
    if (kind && !g.allowed.includes(kind)) return fail(`Slot ${slot} does not take a ${what}`);
    pool = [g];
  } else pool = placePool(w, words);
  const eligible = pool.filter((g) => g.empty && (kind ? g.allowed.includes(kind) : g.allowed.length > 0));
  if (eligible.length === 0) return fail(`No empty slot takes a ${what}${there}`);
  const open = eligible.filter((g) => !g.mountDown);
  if (open.length === 0) return fail("That slot's masonry is down: masons first");
  const g = open[0];
  let weapon = kind;
  if (!weapon) {
    const kinds = new Set<WeaponKind>(open.flatMap((x) => x.allowed));
    if (kinds.size !== 1) return fail("Which gun? Say a long gun, mortar, chain shot or swivel");
    weapon = [...kinds][0];
  }
  const cost = WEAPON_COST[weapon];
  if (cost > w.gold) return fail(`Not enough gold: ${cost - w.gold} short`);
  return ok(input({ kind: "buy", emplacement: g.id, weapon }, `${WEAPONS[weapon].name} for ${gunSay(g)}: ${cost} gold`, cost));
}

function upgrade(t: Tokens, w: OrdersView, nope: () => Res): Res {
  const u = takeUpgrade(t);
  if (!u) return nope();
  takeWord(t, (x) => BUY_VERBS.has(x) || BUILD_VERBS.has(x));
  const def = UPGRADES[u];
  const slot = takeSlot(t);
  const hit = takeWeapon(t);
  const vocab = placeVocab(w);
  if (t.some((x) => !vocab.has(x))) return nope();
  const words = [...new Set(t)];
  if (hit && hit.kind && hit.kind !== def.weapon) return fail(`${def.name} does not fit a ${weaponName(hit.kind)}`);
  if (!w.foundry) return fail("Needs a working Foundry");
  const wname = weaponName(def.weapon);
  let g: GunView | undefined;
  if (slot !== undefined) {
    g = w.guns.find((x) => x.slot === slot - 1);
    if (!g) return fail(`No slot ${slot}`);
    if (g.empty) return fail(`Slot ${slot} is empty`);
    if (g.weapon !== def.weapon) return fail(`${def.name} does not fit a ${weaponName(g.weapon)}`);
    if (g.upgrade) return fail("One upgrade per gun");
  } else {
    const pool = placePool(w, words).filter((x) => !x.empty && x.weapon === def.weapon);
    if (pool.length === 0) return fail(words.length ? `No ${wname} stands there` : `No ${wname} to upgrade`);
    const free = pool.filter((x) => !x.upgrade);
    if (free.length === 0) return fail("One upgrade per gun");
    g = free.find((x) => x.slot === w.riding) ?? (free.length === 1 ? free[0] : undefined);
    if (!g) return fail(`Which ${wname}? Say where it stands`);
  }
  if (def.cost > w.gold) return fail(`Not enough gold: ${def.cost - w.gold} short`);
  return ok(input({ kind: "upgrade", emplacement: g.id, upgrade: u }, `${def.name} on the ${wname}, ${g.place || `slot ${g.slot + 1}`}: ${def.cost} gold`, def.cost));
}

function man(t: Tokens, w: OrdersView, nope: () => Res): Res {
  const overview = t.some((x) => OVERVIEW_WORDS.has(x) || x === "leave");
  takeWord(t, (x) => MAN_VERBS.has(x) || OVERVIEW_WORDS.has(x) || x === "leave");
  if (overview) {
    takeWeapon(t);
    return t.length === 0 ? ok(input({ kind: "man", emplacement: -1 }, "Overview")) : nope();
  }
  let slot: number | undefined;
  const gi = t.indexOf("gun");
  if (gi >= 0 && isCard(t[gi + 1])) {
    slot = Number(t[gi + 1]);
    t.splice(gi, 2);
  } else slot = takeSlot(t);
  const hit = takeWeapon(t);
  const vocab = placeVocab(w);
  if (t.some((x) => !vocab.has(x))) return nope();
  const words = [...new Set(t)];
  const kind = hit?.kind ?? null;
  const what = kind ? weaponName(kind) : "gun";
  let g: GunView | undefined;
  if (slot !== undefined) {
    g = w.guns.find((x) => x.slot === slot - 1);
    if (!g) return fail(`No slot ${slot}`);
    if (g.empty) return fail(`Slot ${slot} is empty`);
    if (kind && g.weapon !== kind) return fail(`Slot ${slot} holds a ${weaponName(g.weapon)}`);
  } else {
    const pool = placePool(w, words).filter((x) => !x.empty && (!kind || x.weapon === kind));
    if (pool.length === 0) return fail(words.length || kind ? `No ${what} stands there` : "You have no gun to man");
    if (pool.length > 1) return fail(`Which ${what}? Say where it stands`);
    g = pool[0];
  }
  return ok(input({ kind: "man", emplacement: g.id }, `Man the ${weaponName(g.weapon)}, ${g.place || `slot ${g.slot + 1}`}`));
}

// Waves

function order(t: Tokens, nope: () => Res): Res {
  const seen = new Set<number>();
  for (const x of t) {
    const n = own(ORDER_WORDS, x);
    if (n !== undefined) seen.add(n);
    else if (!ORDER_FILLER.has(x)) return nope();
  }
  if (seen.size !== 1) return nope();
  const n = [...seen][0];
  return ok(input({ kind: "order", order: n as Order }, `Waves: ${ORDER_SAYS[n]}`));
}

function route(t: Tokens, w: OrdersView, nope: () => Res): Res {
  const dirs = t.filter((x) => ROUTE_WORDS.has(x));
  if (dirs.length !== 1) return nope();
  if (t.some((x) => !ROUTE_WORDS.has(x) && !ROUTE_FILLER.has(x))) return nope();
  if (!t.some((x) => ROUTE_CUES.has(x))) return nope();
  const mine = dirs[0] as RouteName;
  return ok(input({ kind: "route", route: matchRoute(w.team, mine) }, `Next waves: ${routeLabel(mine)}`));
}

// Barracks

function isBarracksSetting(t: Tokens): boolean {
  if (!t.includes("barracks")) return false;
  const mix = t.some((x) => own(MIX_WORDS, x));
  const pick = t.some((x) => isOrd(x) || ALL_WORDS.has(x));
  return mix || (pick && t.some((x) => ROUTE_WORDS.has(x)));
}

function barracksSetting(t: Tokens, w: OrdersView, nope: () => Res): Res {
  const plotNum = takePlot(t);
  // Which one: "second barracks", "two barracks", "all barracks", "the front left one", "plot 3".
  let nth: number | undefined;
  const bi = t.indexOf("barracks");
  for (const j of [bi - 1, bi + 1]) {
    if (nth === undefined && (isOrd(t[j]) || isCard(t[j]))) nth = isOrd(t[j]) ? ordVal(t[j]) : Number(t[j]);
  }
  if (nth === undefined) {
    const oi = t.findIndex(isOrd);
    if (oi >= 0) nth = ordVal(t[oi]);
  }
  takeWord(t, (x) => isOrd(x) || isCard(x));
  const all = t.some((x) => ALL_WORDS.has(x));
  takeWord(t, (x) => ALL_WORDS.has(x));
  // Place words: front, back, keep, by, and a left or right next to one of them; any other left, right or centre is the road.
  const anchors = (i: number) => t[i] === "front" || t[i] === "back" || t[i] === "keep" || t[i] === "by";
  const place: string[] = [];
  const road: string[] = [];
  const mixes = new Set<MixName>();
  const rest: string[] = [];
  t.forEach((x, i) => {
    const m = own(MIX_WORDS, x);
    if (m) mixes.add(m);
    else if (anchors(i)) place.push(x);
    else if ((x === "left" || x === "right") && (anchors(i - 1) || anchors(i + 1))) place.push(x);
    else if (ROUTE_WORDS.has(x)) road.push(x);
    else if (!BARRACKS_FILLER.has(x)) rest.push(x);
  });
  if (rest.length > 0 || mixes.size > 1 || road.length > 1) return nope();
  const mix = [...mixes][0];
  const dir = road[0] as RouteName | undefined;
  if (!mix && !dir) return nope();
  const standingList = w.plots.map((p, i) => (p.kind === "barracks" && p.state === "standing" ? i : -1)).filter((i) => i >= 0);
  let chosen: number[];
  if (plotNum !== undefined) {
    if (!standingList.includes(plotNum - 1)) return fail(`No barracks on plot ${plotNum}`);
    chosen = [plotNum - 1];
  } else if (nth !== undefined) {
    const i = standingList[nth - 1];
    if (i === undefined) return fail(`No ${ORDINAL_NAMES[nth] ?? `number ${nth}`} barracks`);
    chosen = [i];
  } else if (all) {
    if (standingList.length === 0) return fail("No barracks standing");
    chosen = standingList;
  } else if (place.length > 0) {
    const m = standingList.filter((i) => place.every((x) => lean(plotName(w.team, i)).includes(x)));
    if (m.length === 0) return fail("No barracks there");
    if (m.length > 1) return fail("Which barracks? Say first, second or all");
    chosen = m;
  } else {
    if (standingList.length === 0) return fail("No barracks standing");
    if (standingList.length > 1) return fail("Which barracks? Say first, second or all");
    chosen = standingList;
  }
  const matchDir = dir ? matchRoute(w.team, dir) : undefined;
  return ok(
    ...chosen.map((i) => {
      const inp: MatchInput = { kind: "barracks", plot: i };
      if (mix) inp.mix = mix;
      if (matchDir) inp.route = matchDir;
      const bits = [mix ? WAVE_MIXES[mix].name : "", dir ? routeLabel(dir) : ""].filter(Boolean).join(", ");
      return input(inp, `Barracks on plot ${i + 1}, ${plotName(w.team, i)}: ${bits}`);
    }),
  );
}

// Masons

function repair(t: Tokens, w: OrdersView, nope: () => Res): Res {
  const kinds = new Set<RepairKind>();
  for (const x of t) {
    const k = own(REPAIR_KIND_WORDS, x);
    if (k) kinds.add(k);
    else if (!REPAIR_FILLER.has(x)) return nope();
  }
  const off = t.some((x) => OFF_WORDS.has(x));
  const first = t.includes("o1");
  const wantsAll = t.some((x) => x === "all" || x === "every" || x === "everything");
  const target = new Map<RepairKind, boolean>();
  if (first) {
    if (kinds.size === 0 || off) return nope();
    for (const k of REPAIR_KINDS) target.set(k, kinds.has(k));
  } else {
    const picked = kinds.size > 0 && !wantsAll ? [...kinds] : REPAIR_KINDS;
    if (kinds.size === 0 && !wantsAll && !t.some((x) => REPAIR_CUES.has(x))) return nope();
    for (const k of picked) target.set(k, !off);
  }
  const steps: Step[] = [];
  const names: Record<RepairKind, string> = { gate: "the gate", walls: "the walls", towers: "the towers", keep: "the keep" };
  for (const k of REPAIR_KINDS) {
    const on = target.get(k);
    if (on === undefined || w.repairs[k] === on) continue;
    steps.push(input({ kind: "repair", repair: k, on }, `Masons ${on ? "on" : "off"} ${names[k]}`));
  }
  return { ok: true, steps };
}
