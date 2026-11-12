// Powder on the game page (phase 3 milestone 3.3): the words and numbers the HUD
// shows about it, DOM-free so they can be tested. The store by the gold, the box
// as pips on the weapon card, a dry gun's tab and note, and the notes for a
// magazine or a mill blowing. main.ts only calls these from small hooks.
// Without powder in the match (the Practice range, a keep match) every box is full.

import { POWDER } from "@keepfall/content";
import { BOX_STRIDE, BOY_STRIDE, type MatchInfo, type PowderInfo } from "./protocol";

/** One emplacement's ready box as the page reads it. */
export interface BoxView {
  box: number;
  size: number;
  cost: number;
  /** Ticks until the next keg reaches it (-1: none on its way), and the share of a hoist done at its foot (-1: none at work). */
  eta: number;
  hoist: number;
}

/** The box of an emplacement (match id), or null when the match plays without powder or the slot has no gun (then nothing is ever dry). */
export function boxOf(info: Pick<MatchInfo, "boxes"> | null, emp: number): BoxView | null {
  const b = info?.boxes;
  if (!b || emp < 0 || (emp + 1) * BOX_STRIDE > b.length) return null;
  const o = emp * BOX_STRIDE;
  if (b[o + 2] <= 0) return null; // an empty slot (a shot costs nothing)
  return { box: b[o], size: b[o + 1], cost: b[o + 2], eta: b[o + 3], hoist: b[o + 4] };
}

/** Can the box pay a shot? Without a box to read, yes. */
export const canPay = (b: BoxView | null): boolean => !b || b.box >= b.cost;

/** The pips: one for every shot the box holds when full, lit for each shot it holds now. */
export function pips(b: BoxView | null): { total: number; lit: number } {
  if (!b || b.cost <= 0) return { total: 0, lit: 0 };
  const total = Math.max(1, Math.floor(b.size / b.cost));
  return { total, lit: Math.max(0, Math.min(total, Math.floor(b.box / b.cost))) };
}

/** The pips row's words for a screen reader and its title. */
export function pipsLabel(b: BoxView | null): string {
  const p = pips(b);
  if (!b || p.total === 0) return "";
  const kegs = b.eta >= 0 ? `, a keg is ${Math.max(1, Math.ceil(b.eta / 60))} s away` : "";
  return `Powder box: ${p.lit} of ${p.total} shots${kegs}`;
}

/** Draw the pips into an element, only when they changed. */
export function drawPips(el: HTMLElement, b: BoxView | null): void {
  const p = pips(b);
  const key = `${p.total}/${p.lit}/${b && b.box < b.cost ? "dry" : ""}/${b ? Math.ceil(b.eta / 60) : ""}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.hidden = p.total === 0;
  el.classList.toggle("dry", !!b && p.total > 0 && !canPay(b));
  el.title = pipsLabel(b);
  el.setAttribute("aria-label", pipsLabel(b));
  let html = "";
  for (let i = 0; i < p.total; i++) html += `<i${i < p.lit ? ' class="on"' : ""}></i>`;
  el.innerHTML = html; // fixed markup only
}

// ---- By the gold ------------------------------------------------------------------

/** How many Powder Mills the rate says are working (the cellar makes the rest; sudden death doubles all of it). */
export function millsOf(rate: number, sudden: boolean): number {
  const k = sudden ? POWDER.sudden : 1;
  return Math.max(0, Math.round((rate / k - POWDER.cellar) / POWDER.mill));
}

export interface PowderLine {
  /** What #powder reads ("86 +1.4/s", "Cellar 24/30 +0.4/s", "Magazine full"). */
  text: string;
  /** The store is at its cap and powder is still coming in (it is lost). */
  full: boolean;
  /** Explains the number. */
  title: string;
}

const rateText = (rate: number) => `+${rate.toFixed(1)}/s`;
const millWords = (n: number) => (n === 0 ? "no mills" : n === 1 ? "1 mill" : `${n} mills`);

export function powderLine(p: PowderInfo, sudden = false): PowderLine {
  const mills = millsOf(p.rate, sudden);
  const made = `+${p.rate.toFixed(1)} a second from the cellar and ${millWords(mills)}`;
  const working = p.magazine >= 0;
  const full = p.stock >= p.cap && p.rate > 0;
  if (working) {
    return {
      text: full ? "Magazine full" : `${p.stock} ${rateText(p.rate)}`,
      full,
      title: `Powder: ${p.stock} in the magazine (holds ${p.cap}), ${made}`,
    };
  }
  return {
    text: full ? "Cellar full" : `Cellar ${p.stock}/${p.cap} ${rateText(p.rate)}`,
    full,
    title: `Powder: ${p.stock} in the keep's cellar (holds ${p.cap}), ${made}. A magazine holds ${POWDER.magazineCap}`,
  };
}

/** The short note the first time the magazine fills in a match. */
export const FULL_NOTE = "Magazine full: powder made now is lost";

// ---- A dry gun --------------------------------------------------------------------

/** Notes about a dry gun come at most this often (ms). */
export const DRY_NOTE_GAP = 2000;

/** Does a powder boy have this emplacement as his errand now? */
export function boyServing(info: Pick<MatchInfo, "boys"> | null, team: number, emp: number): boolean {
  const b = info?.boys;
  if (!b) return false;
  for (let o = 0; o + BOY_STRIDE <= b.length; o += BOY_STRIDE) if (b[o] === team && b[o + 1] >= 0 && b[o + 3] === emp) return true;
  return false;
}

/** The note for firing a gun whose box cannot pay: its name in lower case, and why it will not fire. */
export function dryNote(gunName: string, b: BoxView, stock: number, boy: boolean, cellar = false): string {
  const name = gunName.toLowerCase();
  let why: string;
  if (b.eta >= 0) why = `a boy is ${Math.max(1, Math.ceil(b.eta / 60))} s away`;
  else if (boy) why = "a boy is on his way";
  else if (stock <= 0) why = cellar ? "the cellar is empty" : "the magazine is empty";
  else why = "the boys are busy";
  return `No powder at the ${name}: ${why}`;
}

/** Hands out the dry note at most once every DRY_NOTE_GAP ms. */
export class DryNotes {
  private last = -1e9;
  /** True when a note may be shown at `now` (and counts it as shown). */
  take(now: number): boolean {
    if (now - this.last < DRY_NOTE_GAP) return false;
    this.last = now;
    return true;
  }
  reset() {
    this.last = -1e9;
  }
}

/** Is any of this team's guns out of powder (its box cannot pay a shot)? `own` says which emplacements (match ids) are the team's. */
export function anyDry(info: Pick<MatchInfo, "boxes"> | null, own: (emp: number) => boolean): boolean {
  const b = info?.boxes;
  if (!b) return false;
  for (let i = 0; i * BOX_STRIDE < b.length; i++) {
    if (!own(i)) continue;
    const v = boxOf(info, i);
    if (v && !canPay(v)) return true;
  }
  return false;
}

// ---- Blow-ups ---------------------------------------------------------------------

export function magazineBlewNote(mine: boolean, stock: number): { note: string; log: string } {
  const note = mine ? `Our magazine blew up: ${stock} powder lost` : "Their magazine went up";
  return { note, log: mine ? `Your magazine blew up with ${stock} powder in it` : "The enemy magazine went up" };
}

export function millBlewNote(mine: boolean): { note: string; log: string } {
  return mine ? { note: "Our Powder Mill blew up", log: "Your Powder Mill blew up" } : { note: "Their Powder Mill went up", log: "An enemy Powder Mill went up" };
}

export const KEG_BOY_NOTE = "A powder boy's keg went off";

/** The build menu's "Powder, 20 for 60 gold": why it cannot be bought now ("" when it can). */
export function powderBuyWhy(p: { stock: number; cap: number; magazine: number } | null, gold: number): string {
  if (!p || p.magazine < 0) return "Needs a working magazine";
  if (p.cap - p.stock < POWDER.buy.charges) return "The magazine is full";
  if (gold < POWDER.buy.gold) return `Not enough gold: ${POWDER.buy.gold - gold} short`;
  return "";
}

// ---- The page's elements ----------------------------------------------------------

/** The one element by the gold: the stock and its rate. */
export class PowderBar {
  private filled = false;
  private key = "";
  constructor(
    private el: HTMLElement,
    private text: HTMLElement,
  ) {}

  /** A new match: the "Magazine full" note may come again. */
  reset() {
    this.filled = false;
    this.key = "";
    this.el.hidden = true;
  }

  /** The match's report: draw the store of `team`; `note` shows the first-time "Magazine full" line. */
  update(info: MatchInfo, team: number, note: (text: string) => void) {
    const p = info.powder?.[team];
    if (!p) {
      this.el.hidden = true;
      return;
    }
    const line = powderLine(p, info.suddenDeath);
    if (line.full && p.magazine >= 0 && !this.filled) {
      this.filled = true;
      if (!info.result) note(FULL_NOTE);
    }
    const key = `${line.text}|${line.title}|${line.full}`;
    if (key === this.key) return;
    this.key = key;
    this.el.hidden = false;
    this.el.classList.toggle("full", line.full);
    this.el.title = line.title;
    this.text.textContent = line.text;
  }
}

/** Dim the tabs of guns whose boxes cannot pay a shot, and mark those with a keg on its way. `ids[i]` is tab i's match id. */
export function markTabs(tabs: ArrayLike<HTMLElement>, info: Pick<MatchInfo, "boxes"> | null, ids: (i: number) => number): void {
  for (let i = 0; i < tabs.length; i++) {
    const b = boxOf(info, ids(i));
    const dry = !!b && !canPay(b);
    const keg = !!b && b.eta >= 0;
    const t = tabs[i];
    if (t.classList.contains("dry") !== dry) t.classList.toggle("dry", dry);
    if (t.classList.contains("kegged") !== keg) t.classList.toggle("kegged", keg);
  }
}
