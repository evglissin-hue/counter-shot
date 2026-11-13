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

Done (November 13). Branch `claude/keepfall-3-4-keep` (from the integration branch `claude/festive-keller-mgdjup`: `main` with 3.3 and the look's L1). Built through the build and review loop: a contract commit by the master (`STRUCTURE` and `BUTTRESS` in `packages/content/src/structure.ts` and `buttress.ts`, the buttresses in the game's layout, the Statics and Buttresses skeletons, the new events), then executors for the statics pass, the buttresses and masons, the AI and the observatory, and the page, then the master's tuning from traced matches and the perfect gunner.

**What was built.**
- Content: `STRUCTURE` (every number of the rules above, as data) and `structureList` (each castle's keep and four towers with their pieces); `BUTTRESS` (120 gold, 15 s; two stone piers against each face of the keep, 2.5 m wide, 1.2 m out for the lowest 4 m and 0.6 m out up to 7 m, a door's width clear between them; 70 pieces a face). The layout option `buttresses` (only `GAME_LAYOUT` sets it) lays them out with the keep, part `buttress`, in the keep's masons' section; masons work on the keep's faces from 1.7 m out, clear of them. The keep's foot (its walls below the lowest floor) and its buttresses are laid harder than the rest (`MATCH_KEEP.footHard` 4, against 2 above).
- Sim (`packages/sim/src/statics.ts`, sim `RULES_VERSION` 14): per structure and course the area and mass standing, kept by a scan of its pieces each step and judged again only when one changed; crushing and toppling as the rules say (the convex hull of a course's standing masonry, the centre of mass above it, the hinge on the hull's most violated edge); the half second of groaning (`Strain`, `Saved` when masons put enough back in time); a topple turns the part above kinematic and tips it about its hinge (`dsin`, `dcos`) until 25 degrees, a probe stone meets standing masonry or the ground, or 3.5 s, then lets it go with the part's velocity (`Topple`, `Released`); a crush turns the course to dust and lets the part above go at once (`Crush`, `Released`); the report the eye and the AI read (`StructureStatus`: holds, the weakest course, how near it is to crushing and to toppling, the centre of mass, the footing and its draw-in, which way it would fall, a heat per course). All of it is hashed.
- Buttresses (`packages/sim/src/buttresses.ts`): withdrawn until bought, rising piece by piece like a building (`Buttressed` when up), then masonry of the keep that masons put back when it is shot down (never before it is bought).
- Masons (`works.ts`, rule 12): in a keep or a tower the course with the highest load / carry goes back first, and a keep or tower holding under 50% is mended before anything else, the gate included.
- Rules (match rules 11): the `{ kind: "buttress", face }` input (refused on a face already bought or without the gold); `Match.buttress(team, face)`; a buttress not bought is not masonry down. `NET_VERSION` 7.
- Orders by words: "buttress the front" (and the keep, the left, the back face, a buttress on the right), with the match's refusals said first.
- The AI (`packages/ai`): from the Knight up its long gun cuts the keep's foot: points on the foot of the keep and of its piers that it can see along the flight (through the gateway or a breach), the hit of a few of them forecast with the mason's eye (`Statics.whatIf`, read only) and the one that leaves the keep holding least taken (the Knight forecasts 6, the Warlord 20); with nothing in sight it opens the way (the gate's leaves, then the foot of the front wall in line with the keep); the Warlord's mortar drops shells at the foot of the face being cut once the keep holds under 60%. It still shells floors (`AiLevel.cut`: the share of its looks at the keep spent cutting, Knight 0.7, Warlord 0.9). Its steward buys the buttress on the face being cut once its own keep holds under 50%.
- The observatory: every fall of a keep or a tower (when, which, topple or crush, the course), hand shots landing on the keep's foot and its top, keep endings felled against floors, a falls block in the report, cut and open in T7; the dead-end hunt has the spec's three hunts. `siege.ts cut`: the perfect gunner through the open gateway.
- The page: the mason's eye on hold C (riding a gun, the keep or tower under the sight; in the overview every structure of yours and the enemy's under the mouse): the structure tinted course by course from cool to hot, a plumb line from the centre of mass of what stands above its weakest course, the footing's edge drawn in, an arrow the way it would fall, and one label ("Holds 62%", or "Falling"). Free for everyone (`EYE_FREE` in `eye.ts`: the owner's open question). Without the key the world tells: dark cracks across a course past 70% of the way to falling, dust trickling from it past 85%, a groan in the half second before a fall; a fall's creak, the rush of stone, a ground shock with a long camera shake and a great cloud where it lands. Notes ("Their keep groans", "Their front left tower fell", "Your keep groans: masons to it", "Your masons saved the keep"). A thin holds bar under each keep's pips in the match bar. "Buttress the keep" in the build menu, with its four faces ("Rising", "Up"). Felled moments for the impact cam and the replay ("Keep felled", "Tower felled") and the feat "Feller". The guided match's "Break in" is two steps, "Open their gate" and "Cut their keep's foot", with the eye shown once on their keep by itself; "Win" names felling it. "Hold C" in the controls help.

**Where it differs from the rules above (the master's readings and tuning, each from a traced match or the perfect gunner).**
- Rule 2's load is the mass standing above a course as a share of all the structure above its lowest course as built, not of what is above that course: by the spec's share, a cut near the top of a keep felled it as surely as one at its foot (the scripted shelling match was won in 37 s instead of 78 s), and flat fire over the curtain wall reaches the keep's upper half. Now a course at the foot holds until less than 38% of it stands, as the spec says; halfway up, until about a fifth does. A course with less than a tenth of the structure above it is not judged (`STRUCTURE.minLoad`: two battlements toppling off the top had won a match).
- Rule 3's footing is drawn in by 0.3 m plus `toe` (0.25 for a keep, 0.1 for a tower) times the structure's half width times load / carry: a heavily loaded footing crushes at its edge. Without it a keep cut along one face and a third of each side never toppled (its centre of mass stays over what is left); with it, that cut near the foot topples it (by 0.33 m) and the face cut alone holds (by 1.0 m). A tower needs about half its ring cut: with the keep's toe, one mortar shell bursting against a tower toppled it, and five towers fell in three minutes of a Knight mirror.
- Rule 7: the stones let go beyond the budget are brittle "ghosts": out of the physics from the start of the fall (a toppling part's ghosts are posed by the statics pass with the rest of it, then fly on their own) and dust at their first touch of the ground or standing masonry. So the world never holds more than 300 bodies of a fallen keep (`STRUCTURE.bodies`; the spec's 450 left a keep's fall in a match at 900 to 1,030 bodies moving with what it broke in the courtyard) and 120 of a tower (`STRUCTURE.towerBodies`: with 450 a tower falling along a curtain wall took the wall down along its length and the next tower with it). Every storey board of a falling keep is a body (the banner rides on the top one).
- Rule 5: while it tips, the part touches only the banner riding on it: as a kinematic body it drove loose rubble into the curtain wall with a force nothing could stop, and unzipped the wall to the next tower. Let go, its pieces are rubble. What the part's pieces touched as it stood (a tower's wedges bonded to the curtain wall) counts as met once it has tipped 2 degrees, so a tower against its walls is let go early and falls as bodies the walls can stop.
- Rule 9: no floor is dropped by hand. A keep that falls from below its lowest floor takes every floor with it (they are all in the part that falls), so its banner comes down and the match is won; a fall higher up takes the floors above the cut, and where the banner lands (the ground, or a floor still standing in the stump) is the physics' to decide.
- Rule 13 (`siege.ts cut`, seeds 1 to 3): with the foot as hard as the rest of the keep (2) the perfect gunner felled it in 29 to 89 s with no masons; with the foot at 3, 46 to 101 s; at 4, 194 to 218 s (rule 13 aims at 2 to 3 minutes; a little over helps T1). Against a full crew with 3000 gold it took 110 to 221 s, not the 4 to 6 minutes aimed for: the masons stand in front of the keep, in the line of fire through the gateway and where the mortar's shells at the foot land, and are mostly down.

- Rule 13 with masons: see above; the masons' place is a lever for later (they could work the keep's foot from inside it, or run from shells as they run from men).

**Versions and pins.** Sim `RULES_VERSION` 13 to 14; `MATCH_RULES_VERSION` 10 to 11; `NET_VERSION` 6 to 7 (the buttress is an input; structures fall by load in every match). Every pin re-pinned on purpose (the game's layout gains 560 buttress pieces, withdrawn until bought; keeps and towers fall by load): SESSION_HASH a4f869a6 / c555405d to 29af82af / 3ca45276; MATCH_HASH 951ef979 / 2f4b1a1f to 8f4ff756 / 7497363c (the scripted match is now won at tick 4808: its test's window runs to 4880); WAVE_MATCH_HASH 169d50ea / da089720 to 52bf4d6d / 8fecc764; ESTATE_MATCH_HASH 5a15b2ad / b6a2aa10 to b6083528 / e79bc924; AI_MATCH_HASH b8d6c4ae / c2774773 to 8053c6aa / a8651371 (a tower falls in it); GUIDED_MATCH_HASH 89781c21 / d1ef7d67 to cda3bbdb / 82c23b40. Tests that moved with the rules: the army's breach test asserts that no man battered the gate (its two balls now also fell the front left tower onto it); the AI match asks 10 shots by hand a side, not 15 (a side whose long gun is knocked out early fires mostly its mortar). The lab's 35a7603f / 054e5eb0 unchanged (its layout has no buttresses, and its CastleSim hashes as before).

**The observatory.** The quick run (`k34-quick`, 24 of 24) on the final AI with 450 and 200 bodies, against 3.3's (`p3-quick5`):

| Target | 3.3 | 3.4 | Pass |
| --- | --- | --- | --- |
| T1 Length | median 6.7 min; 58% between 6 and 16; 0% by time | median 7.9 min; 58% between 6 and 16; 0% by time (n 12) | FAIL |
| T2 Endings | keep 83%, storm 17% | keep 67% (felled 33%, by floors 33%), storm 33% (n 12) | FAIL |
| T3 Sides | castle 0 won 5 of 12 | 7 of 12; too few to call | n/a |
| T4 Skill | Warlord beats Knight 83% | 92% (n 12) | PASS |
| T5 Spending | median unspent-gold time 52.0 s | 109.5 s (48 sides); last build at 8:31 | FAIL |
| T6 Openings | not measured | not measured | n/a |
| T7 Targets | keep takes 56% of 1143 shots by hand | keep 50% of 1165 (floors 33%, cut 17%), open the way 1% | FAIL (at the line) |
| T8 Comebacks | the side behind won 42% | 17% (2 of 12) | FAIL |
| T9 Budget | p99 most stones moving 793; worst step 3142.7 ms (a loaded machine) | p99 1229; worst step 90.8 ms; steps over 33 ms a match: median 14, most 138 | FAIL |

Falls (the report's new block): a tower or a keep toppled in 23 of 24 matches (96%; aim 70% or more). Keeps toppled 15 times (0.63 a match, median course 7, median at 5:55) and never crushed; towers toppled 48 times (2.0 a match, median course 2, median at 3:55) and crushed 5 times. Of the 19 matches won by the keep, 13 were won by felling it and 6 by its floors. Hand shots landing on an enemy keep: 177 at its foot, 432 above it. Powder (put off by the owner, not retuned): magazines blew in 54% of matches (3.3: 46%).

Eight Knight mirrors played again with 300 and 120 bodies (`k34-bodies`, the final numbers): the most bodies moving in each match fell from 368 to 1,030 (median of the eight about 750) to 309 to 844 (about 530).

**What 3.4 did to T1, T2 and T7.** The count is no longer the only way down: a third of all matches end by a keep felled at its foot, a third by its floors, a third by storm (3.3: keep 83%, storm 17%). Storms now sit inside their band (25% to 50%); the keep as one reason (67%) is still over 60%. Matches run longer (median 7.9 min against 6.7), the harder foot and the buttresses making the new way down a siege of its own, but the band of 6 to 16 minutes holds the same 58%. The keep's share of hand shots fell from 56% to 50%, a third of it now spent cutting the foot. T5 got worse (gold piles up in the longer matches: little to buy late but buttresses) and T8 too (17%: a felled keep ends a match the side ahead was already winning).

**The budget.** The keep's statics pass costs 0.08 to 0.17 ms a step on average (a scan of its pieces; it judges a structure again only when one of them changed); its worst steps (6 to 20 ms on this machine) are the ticks a fall starts or is let go, claiming about a thousand pieces. A keep falling alone: at most 552 bodies moving and 594 ghosts flying, worst step 28 ms (`packages/sim/scripts/topple.ts`; a crush 534, a tower 232). In matches the fall breaks what it lands on, and the run's p99 of the most stones moving was 1,229 (900 to 1,030 at a keep's fall, 1,288 once after a tower's), above 3.3's 793 and the 600 aimed for: hence the 300 and 120 bodies. T9 still fails.

**The rounds.**
- Checks on the final tree (the integration branch at 8d1a37c merged in): `npm run check` 477 of 477; `check:browser` (Chromium matches Node on every pin); `online-check`, `sound-check` (the four new sounds), `guided-check` (both new steps) and `hud-check` (the buttress menu and its four faces, the holds bars, the eye on hold C) all pass. On this machine's software rendering the page runs at about a second a frame, so a fall's frame cost could not be measured: the great cloud is nine bursts the renderer already draws, spread over 2.2 s.
- Dead-end hunt (Knight mirrors on seeds 21 and 22 for 12 minutes, Warlord against Knight on seed 21): 9, 5 and 0 flags. New kinds: a tower or keep standing under 30% for two minutes without falling or being mended (masons down to one or none: not masons undoing every hit, the spec's worry); one high keep piece whose place held rubble for three minutes while its masons put back the lower courses first (rule 12 by design). The rest are 3.3's: guns waiting for their masonry, a chain shot's box dry while all three boys were busy, gold piling up late.
- Player's chair (1280x720, the page executor's shots and every new line read in place): the eye reads (the plumb line and the sliver of footing left drawn over the curtain wall; the hot courses at the foot are hidden by the curtain wall from the far castle, as the spec's castle shape intends); a keep leans towards the gate as one piece; the holds bars sit under both keeps' pips. Left for the owner: the great cloud is nine of the renderer's bursts scaled up and reads as separate puffs in software rendering (to judge on a real GPU).

**Open.**
- The owner's question above (the mason's eye free, or earned) is unanswered; it stays free.
- T9: the most stones moving in a match stays over 600 (falls breaking what they land on); towers topple twice a match. Levers: fewer bodies still, towers judged with the curtain walls that brace them, or stiffer towers.
- Rule 13 with masons: the masons stand in the line of fire and are mostly down, so a full crew does not slow the perfect gunner as the spec aims.
- T5 and T8 got worse; magazines blow in 54% of matches (3.3's tuning, put off by the owner).
