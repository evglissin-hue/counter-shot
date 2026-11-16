// The household on the page (milestone 3.6): the words and shapes of the weapon card's crew line, the household panel
// (J), the notes for people lost and replaced, and the minimap's uncrewed gun. Pure (no DOM, no three), so Node tests
// them; main.ts draws what these say. Nothing here feeds the match: it reads the worker's reports (MatchInfo.crews and
// MatchInfo.household) and the frame's HouseholdDown, HouseholdUp and Reserve events.

import { FIRST_KINDS, SKILL_NAMES, StationKind, type FirstKind, type WeaponKind } from "@keepfall/content";
import { CREW_STRIDE, SeatState, type HouseholdRoster, type SeatInfo, type StationInfo } from "@keepfall/sim";

/** The key that opens the household panel (H is the help). */
export const HOUSEHOLD_KEY = "KeyJ";

// --- the weapon card -------------------------------------------------------------------------------------------

/** One gun's crew as the report gives it: men at its posts (0 to 2), the crew's skill (0 to 3), replacements on their way. */
export interface CrewReport {
  men: number;
  level: number;
  way: number;
}

/** A gun's crew from MatchInfo.crews (null: no household, as on the Practice range). */
export function crewOf(crews: Int8Array | null | undefined, emp: number): CrewReport | null {
  if (!crews || (emp + 1) * CREW_STRIDE > crews.length || emp < 0) return null;
  return { men: crews[emp * CREW_STRIDE], level: crews[emp * CREW_STRIDE + 1], way: crews[emp * CREW_STRIDE + 2] };
}

/** The two posts of a gun: a man at his post, an empty post, or a replacement on his way (a dot). Men first. */
export type Post = "man" | "empty" | "way";
export function crewPosts(c: CrewReport): [Post, Post] {
  const out: Post[] = [];
  for (let i = 0; i < 2; i++) out.push(i < c.men ? "man" : i - c.men < c.way ? "way" : "empty");
  return [out[0], out[1]];
}

/** The skill's name for a level (green, trained, seasoned, veteran). */
export const skillName = (level: number) => SKILL_NAMES[Math.max(0, Math.min(3, level | 0))];

/** The weapon card's line when the gun is short-handed ("" with a full crew). */
export function crewShortLine(men: number): string {
  if (men >= 2) return "";
  if (men === 1) return "One hand short: loads slower";
  return "No crew: your own hands, twice as slow, and it never fires alone";
}

/** The weapon card's hover for the crew line. */
export function crewTitle(c: CrewReport): string {
  const who = c.men === 2 ? "Two at the gun" : c.men === 1 ? "One at the gun" : "Nobody at the gun";
  return c.men > 0 ? `${who}, ${skillName(c.level)} crew` : who;
}

// --- the panel -------------------------------------------------------------------------------------------------

/** Ticks as m:ss. */
export function clockOf(ticks: number): string {
  const s = Math.max(0, Math.ceil(ticks / 60));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The reserve's line: "Reserve 4 of 6, one more in 0:42", "Reserve empty, one more in 0:42" or "Reserve full". */
export function reserveLine(r: HouseholdRoster): string {
  if (r.reserve >= r.max || r.refillIn < 0) return r.reserve >= r.max ? "Reserve full" : `Reserve ${r.reserve} of ${r.max}`;
  return r.reserve <= 0 ? `Reserve empty, one more in ${clockOf(r.refillIn)}` : `Reserve ${r.reserve} of ${r.max}, one more in ${clockOf(r.refillIn)}`;
}

/** One person on a panel line: at his post (with his skill), on his way, or a place left empty. */
export interface PanelPerson {
  state: "post" | "way" | "empty";
  /** His name (a gun's men: in full; the rest: the first name). */
  text: string;
  level: number;
}

/** One line of the panel: a head (a group's name) or a station with the people at it. */
export interface PanelLine {
  head: boolean;
  label: string;
  people: PanelPerson[];
}

export interface PanelModel {
  lines: PanelLine[];
  reserve: string;
  first: FirstKind;
}

const GROUP_NAMES: Partial<Record<StationKind, string>> = {
  [StationKind.Mason]: "Masons",
  [StationKind.Boy]: "Powder boys",
  [StationKind.Bell]: "Bell",
  [StationKind.Mast]: "Signal mast",
  [StationKind.Spotter]: "Spotter",
};

function person(s: SeatInfo, reserve: number, full: boolean): PanelPerson {
  if (s.state === SeatState.AtPost && s.person >= 0) return { state: "post", text: full ? s.name : (s.name.split(" ")[0] ?? s.name), level: s.level };
  // A seat lost waits for a hand of the reserve: with none it stays empty (until the reserve gains one).
  if (s.state === SeatState.Walking || s.state === SeatState.Waiting || s.state === SeatState.Hoisting) return { state: "way", text: "on the way", level: 0 };
  if (s.state === SeatState.Due && reserve > 0) return { state: "way", text: "on the way", level: 0 };
  return { state: "empty", text: "empty", level: 0 };
}

/**
 * What the panel lists: each armed gun by place (`gunName`: "2 Long gun", null for a gun not to list) with its layer and
 * loader, the masons, the powder boys, the bell ringer, the signaller and the spotter, then the reserve and who is replaced first.
 */
export function panelModel(r: HouseholdRoster, gunName: (index: number) => string | null): PanelModel {
  const lines: PanelLine[] = [];
  const guns = r.stations.filter((s: StationInfo) => s.kind === StationKind.Gun && s.seats.some((t) => t.state !== SeatState.Empty));
  if (guns.length) {
    lines.push({ head: true, label: "Guns", people: [] });
    for (const g of guns) lines.push({ head: false, label: gunName(g.index) ?? `Gun ${g.index + 1}`, people: g.seats.map((t) => person(t, r.reserve, true)) });
  }
  for (const kind of [StationKind.Mason, StationKind.Boy, StationKind.Bell, StationKind.Mast, StationKind.Spotter]) {
    const st = r.stations.filter((s) => s.kind === kind && s.seats.some((t) => t.state !== SeatState.Empty));
    if (!st.length) continue;
    lines.push({ head: false, label: GROUP_NAMES[kind] ?? "", people: st.flatMap((s) => s.seats.map((t) => person(t, r.reserve, false))) });
  }
  return { lines, reserve: reserveLine(r), first: r.first };
}

/** The three settings of "Replace first", as the buttons read. */
export const FIRST_LABELS: Record<FirstKind, string> = { guns: "Guns", walls: "Walls", powder: "Powder" };
export const FIRST_ORDER_OF_BUTTONS: FirstKind[] = [...FIRST_KINDS];

// --- notes ---------------------------------------------------------------------------------------------------

/** What the book knows of a person: where he stood. */
interface Known {
  kind: StationKind;
  index: number;
  seat: number;
  name: string;
}

/** Names from the roster by person id, so a down or up event (which carries the id) can say who. */
export class HouseholdBook {
  private known = new Map<number, Known>();
  learn(r: HouseholdRoster) {
    for (const st of r.stations) st.seats.forEach((t, seat) => {
      if (t.person >= 0 && t.name) this.known.set(t.person, { kind: st.kind, index: st.index, seat, name: t.name });
    });
  }
  get(person: number): Known | undefined {
    return this.known.get(person);
  }
  clear() {
    this.known.clear();
  }
}

const WEAPON_NOUN: Record<WeaponKind, string> = { longGun: "long gun", mortar: "mortar", chainShot: "chain shot", swivel: "swivel" };

/** "layer of the long gun", "bell ringer": what a seat is called (content seatTitle's words). */
function titleOf(k: Known | undefined, weapon: (index: number) => WeaponKind | undefined): string {
  if (!k) return "";
  switch (k.kind) {
    case StationKind.Gun: {
      const w = weapon(k.index);
      return `${k.seat === 0 ? "layer" : "loader"} of the ${w ? WEAPON_NOUN[w] : "gun"}`;
    }
    case StationKind.Mason:
      return "mason";
    case StationKind.Boy:
      return "powder boy";
    case StationKind.Bell:
      return "bell ringer";
    case StationKind.Mast:
      return "signaller";
    default:
      return "spotter";
  }
}

export interface Note {
  text: string;
  ms: number;
}

/** A few ticks to gather losses of one blow into one note, and the gap between notes about masons and powder boys. */
export const GATHER = 20;
export const HANDS_GAP = 5 * 60;

/**
 * The notes for your own household (no spam): losses within a moment merge ("3 of your household are down"), a lone one
 * is named ("Tam Greaves, layer of the long gun, is down. A green hand takes his place."), masons and powder boys
 * lost speak at most every few seconds, a replacement is named only when no other note is up, and a dry reserve says so once.
 */
export class HouseholdNotes {
  private downs: { person: number; hand: boolean }[] = [];
  private since = -1;
  private lastHands = -1e9;
  private ups: { person: number; at: number }[] = [];
  private dry = false;
  constructor(
    private book: HouseholdBook,
    private weapon: (index: number) => WeaponKind | undefined,
  ) {}

  down(person: number, tick: number) {
    const k = this.book.get(person);
    const hand = !!k && (k.kind === StationKind.Mason || k.kind === StationKind.Boy);
    if (!this.downs.length) this.since = tick;
    this.downs.push({ person, hand });
  }

  /** A replacement took a place (his name may reach the book a report later: he waits for it a few seconds). */
  up(person: number, tick: number) {
    this.ups.push({ person, at: tick });
  }

  /** Your reserve ran dry. */
  reserveDry() {
    this.dry = true;
  }

  /** Reset (a new match). */
  clear() {
    this.downs = [];
    this.ups = [];
    this.since = -1;
    this.lastHands = -1e9;
    this.dry = false;
  }

  /** The notes due at this tick, given the reserve now and whether the note line has been quiet. */
  flush(tick: number, reserve: number, quiet: boolean): Note[] {
    const out: Note[] = [];
    if (this.dry) {
      this.dry = false;
      out.push({ text: "Your reserve is empty: places stay empty until it gains one (one a minute)", ms: 5000 });
    }
    if (this.downs.length && tick - this.since >= GATHER) {
      const onlyHands = this.downs.every((d) => d.hand);
      if (!onlyHands || tick - this.lastHands >= HANDS_GAP) {
        const text = this.sayDowns(reserve);
        if (onlyHands) this.lastHands = tick;
        this.downs = [];
        out.push({ text, ms: 4500 });
        this.ups = [];
      }
    } else if (!this.downs.length && this.ups.length) {
      this.ups = this.ups.filter((u) => tick - u.at < 180);
      // Guns and the keepers only: masons and powder boys come back without a word.
      const k = this.ups.map((u) => this.book.get(u.person)).find((x) => x && x.kind !== StationKind.Mason && x.kind !== StationKind.Boy);
      if (k) {
        this.ups = [];
        if (quiet && !out.length) out.push({ text: this.sayUp(k), ms: 3500 });
      }
    }
    return out;
  }

  private sayDowns(reserve: number): string {
    const n = this.downs.length;
    if (n > 1) return `${n} of your household are down`;
    const k = this.book.get(this.downs[0].person);
    const title = titleOf(k, this.weapon);
    const who = k ? `${k.name}, ${title},` : "One of your household";
    return `${who} is down. ${reserve > 0 ? "A green hand takes his place." : "The reserve is empty."}`;
  }

  private sayUp(k: Known): string {
    if (k.kind === StationKind.Gun) {
      const w = this.weapon(k.index);
      return `${k.name} takes the ${w ? WEAPON_NOUN[w] : "gun"}'s ${k.seat === 0 ? "layer" : "loader"}'s place`;
    }
    return `${k.name} takes the ${titleOf(k, this.weapon)}'s place`;
  }
}

// --- why a gun is out, and the keepers ------------------------------------------------------------------------

/** The mounts report's wait for a gun that is out (sim OutWait: 1 masonry, 2 gold, 3 hands): the short word the card shows for hands. */
export const OUT_HANDS = 4;
export const OUT_HANDS_TEXT = "No crew to put it back";

/** Why a bell or a signal mast of yours is silent (its keeper is down), or "" when it works or is not down for that. */
export function keeperNote(organ: number, up: boolean, keeper: boolean): string {
  if (keeper || organ === 1) return "";
  void up;
  return organ === 0 ? "Your bell ringer is down: the bell is silent" : "Your signaller is down: the signal mast is silent";
}

/** The minimap's mark for a gun: uncrewed (a hollow ring) apart from a dismounted gun's own mark. */
export function uncrewed(men: number | null, out: boolean, armed: boolean): boolean {
  return armed && !out && men === 0;
}
