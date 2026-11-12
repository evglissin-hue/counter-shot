// The steward's word lists, as data. Everything the grammar knows by name is
// here; parse.ts only reads these. Words are lowercase single tokens unless a
// phrase is written as several words ("long gun" is two tokens).
import type { BuildingKind, MixName, RepairKind, UpgradeKind, WeaponKind } from "@keepfall/content";
import type { StandingId } from "./types";

/** Standing orders: their names as the panel lists them. */
export const STANDING_ORDERS: Record<StandingId, { name: string; blurb: string }> = {
  gateFirst: { name: "Keep the gate mended first", blurb: "While your gate is open, masons work only on the gate" },
  rebuild: { name: "Rebuild what falls", blurb: "A wrecked building is rebuilt for half as soon as the gold is there" },
  powder: { name: "Buy powder under twenty", blurb: "Powder is bought whenever the stock is under 20 and the gold is there" },
};

/** Words that carry nothing: dropped before the grammar looks. ("by" is not one: it names a plot.) */
export const FILLER = new Set(["a", "an", "the", "please", "on", "for", "to", "at", "us", "me", "steward", "now", "of", "in", "into", "with", "my", "our", "your", "is", "are", "it", "that", "this"]);

/** Spelled-out numbers (as tokens they become digits) and ordinals (they become "o" and a digit: "o2" is "second"). */
export const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
export const ORDINAL_WORDS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9 };
/** Ordinals as the steward says them. */
export const ORDINAL_NAMES = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];

/** One word for another, applied token by token before anything else. */
export const SYNONYMS: Record<string, string> = {
  barrack: "barracks",
  forge: "foundry",
  center: "centre",
  middle: "centre",
  walls: "wall",
  towers: "tower",
  pits: "pit",
  pikes: "pikemen",
  pike: "pikemen",
  pikeman: "pikemen",
  sappers: "breach",
  sapper: "breach",
  musketeers: "volley",
  musketeer: "volley",
  muskets: "volley",
  musket: "volley",
  mix: "mixed",
  masons: "mason",
  repairs: "repair",
  repairing: "repair",
  repaired: "repair",
  flanks: "flank",
  roads: "road",
  plots: "plot",
  retreat: "hold",
  everyone: "all",
  everybody: "all",
  troops: "waves",
  men: "waves",
  army: "waves",
};

/** A line is cut into parts at these ("and then" before "and"), at most MAX_PARTS of them. */
export const SPLITTERS = ["and then", "then", "and"];
export const MAX_PARTS = 6;

/** Words and phrases that are never given by words: giving up a match is the menu's. "leave" alone, but "leave the gun" is the overview. */
export const SURRENDER_WORDS = ["surrender", "yield", "quit", "resign", "concede", "exit", "restart", "giveup", "forfeit"];
export const SURRENDER_PHRASES: string[][] = [["give", "up"]];
export const FIRE_WORDS = ["fire", "shoot", "aim", "firing", "shooting"];

/** Verbs that only say what the part is about: dropped inside build, buy and upgrade parts. */
export const BUILD_VERBS = new Set(["build", "construct", "raise", "make", "erect"]);
export const BUY_VERBS = new Set(["buy", "get", "add", "fit", "install", "purchase", "build", "make", "mount"]);
/** Verbs that put you on a gun; "overview" and the like leave it. */
export const MAN_VERBS = new Set(["take", "man", "ride", "use", "board", "switch", "change", "select", "jump"]);
export const OVERVIEW_WORDS = new Set(["overview", "dismount"]);

/** Building phrases (longest first within a kind). */
export const BUILDING_WORDS: Array<{ kind: BuildingKind; phrases: string[] }> = [
  { kind: "mill", phrases: ["powder mill", "gold mill", "mill"] },
  { kind: "barracks", phrases: ["barracks"] },
  { kind: "foundry", phrases: ["foundry"] },
  { kind: "magazine", phrases: ["magazine"] },
];
/** Plot place words. A plot is also named by "plot N" (1-based). */
export const PLOT_WORDS = new Set(["front", "back", "left", "right", "keep", "by"]);
export const REBUILD_WORDS = new Set(["rebuild", "rebuilt", "restore"]);

/** Weapon phrases, longest first. "gun" alone is a gun of no named kind. */
export const WEAPON_WORDS: Array<{ kind: WeaponKind | null; phrases: string[] }> = [
  { kind: "longGun", phrases: ["long gun", "cannon"] },
  { kind: "chainShot", phrases: ["chain shot", "chain"] },
  { kind: "swivel", phrases: ["swivel gun", "swivel"] },
  { kind: "mortar", phrases: ["mortar"] },
  { kind: null, phrases: ["gun"] },
];

/** A part that asks for an upgrade without naming one is answered with the choices. */
export const UPGRADE_VERBS = new Set(["upgrade", "improve"]);
/** Upgrade phrases (the Foundry's names, and short forms). Taken before weapons, so "long chain" is not a chain shot gun. */
export const UPGRADE_WORDS: Array<{ upgrade: UpgradeKind; phrases: string[] }> = [
  { upgrade: "heavyShot", phrases: ["heavy shot"] },
  { upgrade: "rifled", phrases: ["rifled barrel", "rifled", "rifling", "rifle"] },
  { upgrade: "heavyShell", phrases: ["heavy shell"] },
  { upgrade: "quickLoader", phrases: ["quick loader", "quick load", "quickloader", "fast loader"] },
  { upgrade: "longChain", phrases: ["long chain"] },
  { upgrade: "heavyBalls", phrases: ["heavy balls", "heavy ball"] },
  { upgrade: "canister", phrases: ["canister"] },
  { upgrade: "longBarrel", phrases: ["long barrel"] },
];

/** Words for where a gun stands (besides every word of the page's own place names). */
export const GUN_PLACE_WORDS = new Set(["left", "right", "gate", "wall", "tower", "front", "back", "pit", "o2", "mortar", "long", "shots", "keep"]);

/** Orders for all waves: sim Order 0 advance, 1 hold, 2 push. */
export const ORDER_WORDS: Record<string, number> = {
  advance: 0, attack: 0, charge: 0, forward: 0,
  hold: 1, halt: 1, wait: 1, stay: 1,
  push: 2, storm: 2,
};
export const ORDER_FILLER = new Set(["waves", "wave", "all", "breach", "order"]);
export const ORDER_SAYS = ["advance", "hold", "push the breach"];

/** Roads, in the player's own words. A road needs one of the cues ("left" alone is not an order). */
export const ROUTE_WORDS = new Set(["left", "right", "centre"]);
export const ROUTE_CUES = new Set(["waves", "wave", "go", "flank", "road", "route", "march", "send", "next", "centre"]);
export const ROUTE_FILLER = new Set(["waves", "wave", "go", "flank", "road", "route", "march", "send", "next", "side"]);

/** Barracks: mix words (after synonyms), and the words that pick which barracks. */
export const MIX_WORDS: Record<string, MixName> = { pikemen: "pikemen", breach: "breach", volley: "volley", mixed: "mixed" };
export const ALL_WORDS = new Set(["all", "every", "each", "both"]);
export const BARRACKS_FILLER = new Set(["barracks", "flank", "road", "route", "send", "sends", "set", "waves", "wave", "plot", "side", "go"]);

/** Masons. "first" (token "o1") with a kind: that kind on, every other off. */
export const REPAIR_KIND_WORDS: Record<string, RepairKind> = { gate: "gate", wall: "walls", tower: "towers", keep: "keep" };
export const REPAIR_CUES = new Set(["mason", "repair", "mend"]);
export const OFF_WORDS = new Set(["off", "stop", "no", "without", "never"]);
export const REPAIR_FILLER = new Set(["all", "every", "everything", "mason", "repair", "mend", "work", "off", "stop", "no", "without", "never", "o1", "plot"]);

/**
 * Standing orders (V3). A part is a standing order when it holds one of the
 * TRIGGER words; that is what tells "gate first always" (a rule kept until
 * told otherwise) from "gate first" (the one-off repair order: only that kind
 * of section is mended, now). "keep first" has no trigger: it is the repair
 * order for the keep.
 */
export const STANDING_TRIGGERS = new Set(["standing", "always", "mended", "mending", "rebuilding", "falls", "fall", "forget", "cancel"]);
export const STANDING_OFF = new Set(["stop", "cancel", "forget", "off", "no", "none", "drop", "end", "never", "clear"]);
/** Which standing order a word names. */
export const STANDING_IDS: Record<string, StandingId> = { gate: "gateFirst", rebuild: "rebuild", rebuilding: "rebuild", falls: "rebuild", fall: "rebuild", powder: "powder" };
export const STANDING_FILLER = new Set(["standing", "order", "orders", "always", "keep", "mended", "mend", "mending", "first", "o1", "what", "all", "rebuild", "rebuilding", "falls", "fall", "gate", "stop", "cancel", "forget", "off", "no", "none", "drop", "end", "never", "clear", "everything", "powder", "buy", "buying", "more", "under", "below", "whenever", "twenty", "20"]);

/** Powder (3.3): "powder", "buy powder", "more powder" buy at once; with one of these words it is a standing order ("buy powder under twenty"). */
export const POWDER_STANDING = new Set(["under", "below", "whenever", "always", "standing", "stop", "cancel", "forget", "off", "no", "none", "drop", "end", "never", "clear"]);
/** The words a powder part may hold besides "powder". */
export const POWDER_FILLER = new Set([...BUY_VERBS, "powder", "more", "some", "buying", "magazine", "charges", "keg", "kegs", "20", "twenty"]);
