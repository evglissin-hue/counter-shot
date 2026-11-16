// 3.6 the page's household logic: the weapon card's crew and its short line, the panel's lines and the reserve line, the
// notes (named, merged, rate limited, quiet-only), the keepers' words, and the uncrewed gun.
import { test } from "node:test";
import assert from "node:assert/strict";
import { StationKind, type WeaponKind } from "@keepfall/content";
import { SeatState, type HouseholdRoster, type SeatInfo, type StationInfo } from "@keepfall/sim";
import {
  GATHER,
  HANDS_GAP,
  HouseholdBook,
  HouseholdNotes,
  OUT_HANDS_TEXT,
  clockOf,
  crewOf,
  crewPosts,
  crewShortLine,
  crewTitle,
  keeperNote,
  panelModel,
  reserveLine,
  skillName,
  uncrewed,
} from "../src/household";

const seat = (person: number, name: string, level = 1, state: SeatState = SeatState.AtPost): SeatInfo => ({ state, person, name, shots: 0, level, dueIn: -1 });
const empty = (state: SeatState = SeatState.Empty): SeatInfo => ({ state, person: -1, name: "", shots: 0, level: 0, dueIn: -1 });
const station = (kind: StationKind, index: number, seats: SeatInfo[]): StationInfo => ({ kind, index, seats });
function roster(over: Partial<HouseholdRoster> = {}): HouseholdRoster {
  return {
    reserve: 4,
    max: 6,
    refillIn: 42 * 60,
    first: "guns",
    lost: 0,
    stations: [
      station(StationKind.Gun, 8, [seat(1, "Tam Greaves", 2), seat(2, "Wat Cole", 0)]),
      station(StationKind.Gun, 9, [seat(3, "Hob Pike"), empty(SeatState.Due)]),
      station(StationKind.Gun, 10, [empty(), empty()]),
      station(StationKind.Mason, 0, [seat(4, "Dick Mott")]),
      station(StationKind.Mason, 1, [empty(SeatState.Walking)]),
      station(StationKind.Boy, 0, [seat(5, "Rob Hale")]),
      station(StationKind.Bell, 0, [seat(6, "Kit Fenn")]),
      station(StationKind.Mast, 0, [empty(SeatState.Due)]),
    ],
    ...over,
  };
}
const weapons: Record<number, WeaponKind> = { 8: "longGun", 9: "mortar", 10: "swivel" };
const weapon = (i: number) => weapons[i];

test("a gun's crew from the report: men, skill and replacements, none without a household", () => {
  const crews = Int8Array.from([2, 3, 0, 1, 0, 1, 0, 0, 0]);
  assert.deepEqual(crewOf(crews, 0), { men: 2, level: 3, way: 0 });
  assert.deepEqual(crewOf(crews, 1), { men: 1, level: 0, way: 1 });
  assert.deepEqual(crewOf(crews, 2), { men: 0, level: 0, way: 0 });
  assert.equal(crewOf(crews, 3), null, "beyond the report");
  assert.equal(crewOf(null, 0), null, "the Practice range has none");
  assert.deepEqual(crewPosts({ men: 2, level: 1, way: 0 }), ["man", "man"]);
  assert.deepEqual(crewPosts({ men: 1, level: 1, way: 1 }), ["man", "way"], "a dot for a replacement on his way");
  assert.deepEqual(crewPosts({ men: 1, level: 1, way: 0 }), ["man", "empty"], "a hollow figure for an empty post");
  assert.deepEqual(crewPosts({ men: 0, level: 0, way: 1 }), ["way", "empty"]);
  assert.deepEqual([0, 1, 2, 3].map(skillName), ["green", "trained", "seasoned", "veteran"]);
});

test("the weapon card says nothing with a full crew and a short line when short-handed", () => {
  assert.equal(crewShortLine(2), "");
  assert.equal(crewShortLine(1), "One hand short: loads slower");
  assert.equal(crewShortLine(0), "No crew: your own hands, twice as slow, and it never fires alone");
  assert.match(crewTitle({ men: 2, level: 3, way: 0 }), /veteran/);
  assert.equal(crewTitle({ men: 0, level: 0, way: 0 }), "Nobody at the gun");
});

test("the reserve line: so many of six and when one more comes, empty, or full", () => {
  assert.equal(clockOf(42 * 60), "0:42");
  assert.equal(clockOf(75 * 60 - 5), "1:15");
  assert.equal(reserveLine(roster()), "Reserve 4 of 6, one more in 0:42");
  assert.equal(reserveLine(roster({ reserve: 0 })), "Reserve empty, one more in 0:42");
  assert.equal(reserveLine(roster({ reserve: 6, refillIn: -1 })), "Reserve full");
});

test("the panel lists each armed gun by place with its men, the masons, powder boys and keepers, and the reserve", () => {
  const m = panelModel(roster(), (i) => `${i - 7} ${i === 8 ? "Long gun" : "Mortar"}`);
  const labels = m.lines.map((l) => l.label);
  assert.deepEqual(labels, ["Guns", "1 Long gun", "2 Mortar", "Masons", "Powder boys", "Bell", "Signal mast"], "a gun nobody has armed is not listed");
  const g1 = m.lines[1];
  assert.deepEqual(g1.people.map((p) => [p.state, p.text, p.level]), [["post", "Tam Greaves", 2], ["post", "Wat Cole", 0]]);
  const g2 = m.lines[2];
  assert.deepEqual(g2.people.map((p) => [p.state, p.text]), [["post", "Hob Pike"], ["way", "on the way"]], "a seat due with a hand in the reserve is on the way");
  const masons = m.lines[3];
  assert.deepEqual(masons.people.map((p) => [p.state, p.text]), [["post", "Dick"], ["way", "on the way"]], "the rest by their first names");
  assert.deepEqual(m.lines[6].people.map((p) => p.state), ["way"]);
  assert.equal(m.reserve, "Reserve 4 of 6, one more in 0:42");
  assert.equal(m.first, "guns");
  // With the reserve dry, a seat due stays empty.
  const dry = panelModel(roster({ reserve: 0 }), () => "x");
  assert.deepEqual(dry.lines[2].people.map((p) => p.state), ["post", "empty"]);
  assert.equal(dry.lines.find((l) => l.label === "Signal mast")!.people[0].text, "empty");
  // The spotter appears when it exists.
  const sp = panelModel(roster({ stations: [...roster().stations, station(StationKind.Spotter, 2, [seat(9, "Ned Ward")])] }), () => "x");
  assert.equal(sp.lines.at(-1)!.label, "Spotter");
});

function notes() {
  const book = new HouseholdBook();
  book.learn(roster());
  return { book, n: new HouseholdNotes(book, weapon) };
}

test("a lone loss is named with his seat, then says whether a hand takes his place", () => {
  const { n } = notes();
  n.down(1, 100);
  assert.deepEqual(n.flush(100 + GATHER - 1, 4, true), [], "gathered for a moment first");
  assert.deepEqual(n.flush(100 + GATHER, 4, true).map((x) => x.text), ["Tam Greaves, layer of the long gun, is down. A green hand takes his place."]);
  n.down(2, 400);
  assert.deepEqual(n.flush(400 + GATHER, 0, true).map((x) => x.text), ["Wat Cole, loader of the long gun, is down. The reserve is empty."]);
});

test("several losses in one blow are one note", () => {
  const { n } = notes();
  n.down(1, 100);
  n.down(2, 105);
  n.down(3, 110);
  assert.deepEqual(n.flush(100 + GATHER, 4, true).map((x) => x.text), ["3 of your household are down"]);
  assert.deepEqual(n.flush(100 + GATHER + 1, 4, true), [], "said once");
});

test("masons and powder boys lost speak at most once in a few seconds, merged", () => {
  const { n } = notes();
  n.down(4, 100);
  assert.deepEqual(n.flush(100 + GATHER, 4, true).map((x) => x.text), ["Dick Mott, mason, is down. A green hand takes his place."]);
  n.down(5, 200);
  assert.deepEqual(n.flush(200 + GATHER, 4, true), [], "too soon after the last");
  n.down(4, 220);
  assert.deepEqual(n.flush(100 + GATHER + HANDS_GAP - 1, 4, true), []);
  assert.deepEqual(n.flush(100 + GATHER + HANDS_GAP, 4, true).map((x) => x.text), ["2 of your household are down"], "the held losses merge");
  // A gun's crew is never held back by it.
  n.down(1, 1000);
  assert.equal(n.flush(1000 + GATHER, 4, true).length, 1);
});

test("a replacement is named only when the note line is quiet, and only for guns and keepers", () => {
  const { book, n } = notes();
  n.up(1, 100);
  assert.deepEqual(n.flush(100, 4, false), [], "not while another note is up");
  n.up(1, 100);
  assert.deepEqual(n.flush(101, 4, true).map((x) => x.text), ["Tam Greaves takes the long gun's layer's place"]);
  n.up(6, 300);
  assert.deepEqual(n.flush(301, 4, true).map((x) => x.text), ["Kit Fenn takes the bell ringer's place"]);
  n.up(4, 400);
  assert.deepEqual(n.flush(401, 4, true), [], "a mason comes back without a word");
  // A man the book learns a report later is still named.
  n.up(77, 500);
  assert.deepEqual(n.flush(501, 4, true), []);
  book.learn(roster({ stations: [station(StationKind.Gun, 9, [seat(77, "Gib Rook"), empty()])] }));
  assert.deepEqual(n.flush(510, 4, true).map((x) => x.text), ["Gib Rook takes the mortar's layer's place"]);
});

test("a person the book does not know is still counted", () => {
  const { n } = notes();
  n.down(99, 10);
  assert.deepEqual(n.flush(10 + GATHER, 2, true).map((x) => x.text), ["One of your household is down. A green hand takes his place."]);
});

test("a dry reserve says so once, with what to expect", () => {
  const { n } = notes();
  n.reserveDry();
  assert.deepEqual(n.flush(5, 0, true).map((x) => x.text), ["Your reserve is empty: places stay empty until it gains one (one a minute)"]);
  assert.deepEqual(n.flush(6, 0, true), []);
});

test("a bell or a mast without its keeper says why it is silent; the crane has no keeper", () => {
  assert.equal(keeperNote(0, true, true), "");
  assert.equal(keeperNote(0, true, false), "Your bell ringer is down: the bell is silent");
  assert.equal(keeperNote(2, true, false), "Your signaller is down: the signal mast is silent");
  assert.equal(keeperNote(1, true, false), "");
});

test("an uncrewed gun is one that is up and armed with nobody at it", () => {
  assert.equal(uncrewed(0, false, true), true);
  assert.equal(uncrewed(1, false, true), false);
  assert.equal(uncrewed(0, true, true), false, "a dismounted gun has its own mark");
  assert.equal(uncrewed(0, false, false), false, "an empty slot is not a gun");
  assert.equal(uncrewed(null, false, true), false, "no household: every gun has its crew");
  assert.equal(OUT_HANDS_TEXT, "No crew to put it back");
});
