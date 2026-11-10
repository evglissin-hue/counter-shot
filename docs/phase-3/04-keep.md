# 3.4 The keep falls by engineering

## Goal

A keep or a tower comes down because what held it up was cut, and it comes down in one piece, towards the cut, onto whatever stands there. Reading a building becomes the gunner's main skill; buttresses and the order of repairs become the defender's.

## Why

Pillar 1 says nothing important is a hit-point bar, but the keep is one today: two shells a floor, counted. The masonry sim already knows more than that. Its support check lets a stone stand if support reaches it from the ground through its neighbours within a span of two stones (four in the keep's dressed stone). What it lacks is weight: a wall with most of a course shot away still carries everything above it, and a tower whose base is cut on one side crumbles straight down stone by stone and never topples.

The castle's own shape then gives a match its phases. The curtain wall is 8 m high and stands 14 m in front of the keep's face, so flat fire from the far castle reaches only the keep's upper half. Its foot is seen only through the gateway once the leaves are off (the gate corridor is kept clear of buildings) or through a breach low in the front wall. Open the curtain, keep it open, cut the foot, fell the keep.

## Rules

Numbers live in a new `STRUCTURE` in `packages/content`. The rules cover **structures**: each keep and each of the eight towers (the masons' sections of kind "keep" and "towers" in `repairSections`). Curtain walls keep today's support rule alone.

1. **Support first.** Today's support check runs as now. What follows looks only at stones that still stand.
2. **Crushing.** For a structure and a course c:
   - `carry(c)`: the top area of the stones standing in course c, as a share of that course as built;
   - `load(c)`: the mass standing above c, as a share of the mass above c as built (a keep that has lost its top carries less).
   Course c **crushes** when `load(c) / carry(c)` is above `crush` (start: 2.6). With everything above it still standing, a course holds until less than 38% of it stands.
3. **Toppling.** Take the stones standing in a damaged course c as the footing: their convex hull seen from above, drawn in by 0.3 m. If the centre of mass of everything standing above c lies outside it, the part above c **topples** about the hull's edge nearest that centre: towards the cut.
4. **Which comes first.** After any change to a structure, walk its damaged courses from the lowest up. The first course that crushes or topples decides. It must stay so for 30 ticks before the fall starts: half a second of groaning in which masons might still save it.
5. **A topple.** The part above tips as one rigid group about the hinge edge:
   - its stones turn kinematic and follow one rotation, integrated with `dsin` and `dcos` from the group's mass, its moment about the hinge and gravity, starting at 0.05 rad/s;
   - at 25 degrees of tip, or when a probe stone would meet standing masonry or the ground, or after 3.5 s, the group is released: every stone turns dynamic with the group's velocity where it is.
6. **A crush.** The course's standing stones turn to dust and the part above is released at once, with no turn.
7. **The budget on release.** A whole keep is about 1,150 pieces and a tower 490, against a budget of 600 moving. On release, stones of the group are marked brittle by id so that about 450 at most stay bodies; a brittle stone turns to dust at its first hard touch (9 m/s or more). The mass arrives as stone and leaves a heap about a third its size and a great cloud.
8. **What it lands on takes it.** Buildings and walls under it break by the contact forces that break masonry today; men under it fall to masonry (collapse kills); a gun whose mount goes falls with it.
9. **The banner** still comes down with the floor under it, and a keep that topples or crushes takes it to the ground: the match is won.
10. **Floors.** Two shells a floor stays until 3.7 gives timber another way to go.
11. **Buttresses.** The build menu offers "Buttress the keep" for each of its four faces (120 gold, rises in 15 s like a building): a stone buttress laid out in the layout from the start and withdrawn until bought. Once up it is masonry of that structure: it widens the footing on its side and adds to the lower courses' `carry`, so rules 2 and 3 see it with nothing special. It can be shot away like any stone.
12. **Masons know.** In a keep or a tower, masons put back first the course with the highest `load / carry`.
13. **Pacing to aim for** (tune the keep's `hard`, per course if needed, and `crush`): a perfect gunner firing through an open gateway fells the keep in 2 to 3 minutes with no masons, and in 4 to 6 against a full crew with gold. T1 and T2 are the final judges.

## The mason's eye

Page only, from a small report the sim gives every 15 ticks for each structure: its weakest course, how near that course is to crushing, how far the centre of mass is from the footing's edge, and which way it would fall.

- **Hold C** (if free): the structure under the sight is tinted course by course from cool to hot, a plumb line drops from the centre of mass of what stands above the weakest course to its footing, the footing's edge is drawn, and an arrow shows where it would fall. One number: "holds 62%".
- Your own castle shows it for every structure in the overview. The enemy's shows it only for the structure you aim at.
- Without the key, the world still tells: dark cracks across a course above 70% of the way to crushing, dust trickling from one above 85%, and a groan in the half second before a fall.

## Data and code

- `packages/content`: `STRUCTURE`; buttress pieces in the layout behind a `LayoutOptions` flag that `GAME_LAYOUT` sets (rule 5 of `docs/phase-3.md`).
- `packages/sim`: a `structures` pass beside `supportCheck` in `castleSim.ts` (per structure: the stones of each course, sums kept up to date as stones loosen, shatter and are restored; a structure is looked at again only when one of its stones changed); the toppling group (its members, hinge, angle and rate are state, and hashed); stones in a group are reported by `collectMoving` like any moving stone. New events: `Topple` and `Crush` (the structure, where, which way). Bump `RULES_VERSION`.
- Cost: sums over at most about 1,150 pieces on a change, and a hull of a few dozen points for each damaged course.
- `packages/rules`: the `{ kind: "buttress", face }` input; masons' order (rule 12) in `works.ts`.
- `MatchInfo` gains the structures' report.

## The AI

- Two new aims for the gunner: **open the way** (the gate's leaves, or the foot of the front wall in line with the keep) and **cut the keep** (its foot, seen through the gateway or a breach: one face, then the near thirds of the two beside it). It reads the same report a player's eye shows and chooses the hit that moves the weakest course most; how well depends on its level.
- It still shells floors and breaches for its waves; which it prefers is part of its plan, and the observatory compares them.
- The steward buys a buttress on the face being cut once its keep holds under 50%.

## The page

- The eye (above). A topple is the game's great moment: a low groan, the lean, the rush, the ground shock; track S frames it.
- The keep tracker in the match bar gains a thin bar under each keep's pips: how much its weakest course still holds.
- The guided match: "Break in" becomes two steps, open the gate and cut the foot of the keep, with the eye shown once.

## Tests and measures

- A keep cut along one face and a third of each side face topples towards the cut; cut evenly all round it crushes.
- A keep that lost its top third needs a deeper cut.
- A buttress on the cut face holds it; shot away, it falls.
- Nothing falls in an untouched castle through a ten-minute AI match.
- A whole keep released never has more than 650 stones moving, and the worst step is recorded.
- The lab's layout and hash are untouched.
- `packages/rules/scripts/siege.ts` (the perfect gunner) reports rule 13's times.
- Observatory: T1 and T2; falls by kind of structure in a match (aim: a tower or a keep topples in 70% of matches); hits on the keep's foot and its top.

## Dead ends to hunt

- A structure that hangs between falling and standing for minutes (masons undoing each hit for ever): gold must run out or the cut must win.
- A toppled group released inside standing masonry (stones thrown at great speed).
- A keep that can never be mended because rubble fills its foot: masons clear it as they do a breach.

## Try

Knock the enemy gate off. Hold C on their keep. Cut the foot of the face you can see until the plumb line leaves the footing, and watch which way it goes. Then lose your own gate and buy a buttress.

## For the owner

- Should the eye be free for everyone (the spec), or earned (a building, or only from the spotter's tower of 3.5)?

## Status

Not started.
