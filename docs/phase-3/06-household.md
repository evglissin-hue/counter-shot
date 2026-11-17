# 3.6 The household

## Goal

A castle is run by named people at stations, and there are only so many of them. A crewed gun loads faster and shoots truer; a veteran crew is worth protecting; losses are for good until the reserve fills again.

## Why

Three things in the game are dice or free today: every shot scatters at random, a gun that is knocked out comes back after 30 s at no cost, and a fallen mason is replaced for nothing. People make all three legible. Scatter becomes a crew's skill, sweeping a crew off a gun costs the enemy something that lasts, and manpower becomes a clock that runs down in a long siege.

## Rules

Numbers live in a new `HOUSEHOLD` in `packages/content`.

1. **Stations.** Each gun has a crew of two (a layer and a loader). The masons (4), the powder boys (3), a bell ringer, a signaller and a spotter (if that tower stands) are stations too. The garrison (4) stays as it is.
2. **They are figures.** Crews stand at their guns on the wall walks, tower tops and in the pits, and can be knocked down by anything that knocks a man down. A man on masonry that falls goes with it.
3. **The reserve.** Six people wait in the keep. When a station loses someone, the next of the reserve walks out after 20 s to take the place. The reserve gains one every 60 s, up to six. With none left, the place stays empty.
4. **Who is replaced first** is one choice with three settings: guns first (the start), walls first (masons), powder first.
5. **What a crew does for its gun.**
   - Two at the gun: it loads at its own rate and fires on its own when nobody rides it.
   - One: it loads in half again the time.
   - None: it does not fire on its own. You can still ride it, and it then loads in twice the time, by your own hands.
6. **Skill, not dice.** A crew has a skill from the shots its gun has fired with it, by your hand or on its own: green (under 10), trained (10), seasoned (30), veteran (60).
   - Scatter: 1.3, 1.0, 0.8, 0.6 times the weapon's.
   - Reload: 1.1, 1.0, 0.95, 0.9 times.
   The four guns a castle starts with have trained crews; a bought gun's crew starts green. A replacement from the reserve is green, and a crew's skill is that of its less skilled member.
7. **Knocked out, now two things.** A gun whose crew is swept away or shot down is not out: it is uncrewed (rule 5) until the reserve sends someone. A gun struck square or brought down with its masonry is dismounted as today: its crew, if they live, put it back in 30 s once the masonry stands.
8. **Bounties.** A man of the household pays 8 gold, twice a soldier.
9. **Not counted.** The household is outside the cap on men standing and outside the storm's counts, as masons are.
10. **Names.** Each person gets a name from a seeded list. Notes use them: "Tam Greaves, layer of the long gun, is down. A green hand takes his place."

## Data and code

- `packages/content`: `HOUSEHOLD`; the name list; posts for each station from the emplacements.
- `packages/sim`: a `Crew` role with a fixed post (no pathfinding on the walls: a replacement walks the courtyard and is hoisted, as powder is). The chain's sweep takes crews as figures through `sweptMen`; the crew test in `mounts.ts` (`whirl`) goes, and `Mounts` asks the household who stands at a gun. Skill is a counter per crew, hashed. Scatter and reload read it where a shot is fired. Bump `RULES_VERSION`.
- `packages/rules`: the reserve and its clock, the `{ kind: "household", first }` input, crews in `gunnery`. Bump `MATCH_RULES_VERSION`.
- Cost: about 20 more upright figures a castle.
- `MatchInfo` gains the roster of the page's own castle (station, name, skill, standing) and the reserve; the enemy's crews are seen, not listed.

## The AI

- It sets who is replaced first by what it is short of.
- Going after a gun that hurts it (from a Knight up) now has a lasting gain; it prefers the enemy gun with the most skilled crew.
- It rides its best crew's gun when two guns would do.

## The page

- The weapon card shows the crew of the gun you ride: two small figures and skill pips; a line when it is short-handed.
- A household panel (H, if free): each station with its people, the reserve, and the one choice of rule 4. One short list, no micromanagement.
- The reload reads from the crew (track L, round L1): they swab, load, ram and run the gun out, so the reload bar is a second way to read what you can already see.
- The minimap marks an uncrewed gun (a hollow ring) apart from one that is dismounted.

## Tests and measures

- A gun with one of its crew loads slower; with none it does not fire on its own and loads in twice the time under your hand.
- A crew's skill rises with its shots and falls to green when a replacement joins.
- Chain shot through a crew knocks down figures, pays their bounties, and leaves the gun standing.
- The reserve empties, stations stay empty, and it fills again.
- Scatter by skill, measured over seeds as the aiming round measured it.
- Observatory: household lost in a match; crews' skill at the end; T8.

## Dead ends to hunt

- A castle with nobody left and no way back: the reserve always gains one a minute.
- A replacement who cannot reach a post (its tower is down): he waits at its foot and takes the place when it stands.

## Try

Fire sixty shots with the long gun and feel it tighten. Sweep the crew off the enemy's best gun with the chain. Let your own reserve run dry under a long shelling.

## For the owner

- Is a permanent loss within a match (until the reserve refills) the right weight, or should the reserve be larger?

## Status

Done (November 17) on `claude/keepfall-household` (from the integration branch at 3.5's merge; not on `main`, not published). Built in the build and review loop: the master's contract (`HOUSEHOLD` and the names, posts, `StationKind`, the `Household` surface, the input, `MatchInfo`'s fields), then three executors (A the sim and the rules, B the AI, the observatory and the hunts, C the page and the look, in two rounds), then the master's tuning and fixes. Several container restarts and three stops at the account's usage limit on the way; everything below was rebuilt from what was pushed.

**What was built.**

- Content (`household.ts`): `HOUSEHOLD` (crews of two, a reserve of 6 gaining one a minute, the walk out after 20 s, the 3 s hoist, half again and twice the reload with one and no man, skill at 10, 30 and 60 shots with scatter 1.3, 1.0, 0.8, 0.6 and reload 1.1, 1.0, 0.95, 0.9, trained starting crews, a bounty of 8, who is replaced first, and the cover below), `StationKind`, `FIRST_ORDER`, `skillLevel`, `crewReload`, `crewScatter`, the crews' and keepers' posts and their feet, 32 first names and 32 surnames, `Unit.Crew`.
- Sim (`household.ts`): stations in a fixed order (each castle's eight gun slots, the masons, the powder boys, the bell ringer, the signaller, the spotter), people named from a stream of their own (the Practice range's hash holds), gun crews and keepers as `Role.Crew` figures at their posts (outside the cap and the storm counts, as masons are), the reserve and its clock, seats served by `FIRST_ORDER`, replacements walking out of the keep's door to the post's foot and hoisted up, masons and boys replaced from the reserve through `Works.refill` and `Carriers.refill`, a bought gun's crew and a new spotter's tower's spotter coming new; skill counted per person and read where a shot is fired; `Mounts.whirl` gone (the chain takes crews as men), a dismounted gun put back only with a man at its post (`OutWait.Hands`); `Minions.teleport` and `Minions.yielding` (below). Rules: the `household` input (who is replaced first), a gun with no crew never fires on its own nor in a salvo unless ridden, the bell and the mast work only with their keeper at his post and the spotter's tower only with its spotter, the household's bounty, `TeamStats.householdLost`.
- AI (B): from the Knight the steward sets who is replaced first by what it is short of (walls with two masons lost and work to do, powder with two boys lost and a gun dry, guns otherwise and while a seasoned crew is short); the counter prefers the enemy gun with the most skilled crew, leaves an uncrewed one alone unless it is ridden, aims the chain between a crew's two posts, and may take a seasoned crew's gun before it hurts; it rides its best crew's gun when two would do; its counts leave the household out.
- Page (C): the posed crews draw exactly the men at a gun's posts (two, one or none, each weapon's work shared between them); the household's walkers, keepers and hoists in the minion rig; the weapon card's two figures, skill pips and a line when short-handed; the household panel on J (H is help), the one new HUD element, with a "Household J" button in the command card: each station's people, the reserve and its clock, Replace first: Guns, Walls, Powder; notes by name ("Tam Greaves, layer of the long gun, is down. A green hand takes his place."), merged when several fall; their crew in a shot's report; a hollow ring on the minimap for an uncrewed gun; "Out: no crew to put it back"; the bell and the mast silent without their keeper; order words ("guns first", "walls first", "masons first", "powder first", "boys first"); the end screen's "Household lost"; the coach's line "Your other guns fire on their own at men near your gate, while their crews stand." The HUD check moved to the test clock and polls the two steps that missed on slow machines.
- Tools: the observatory's household lines and Household block; the dead-end hunt's household hunts and the post-foot reach check; `household-losses.ts` (what knocks the household down), `budget-falls.ts`, `keep-watch.ts`, `household-chair.mjs`, `household-shots.mjs`, `household-shots-real.mjs`.

**The owner's answers.** Before the build: the reserve stays as the spec has it (6, one a minute). After the first quick run (`household-b`: a Knight castle lost 29 of its household a match, mostly by accident, and its reserve stood dry about 7 of 9 minutes; storms 58%, the Warlord beat the Knight 67%): the household takes cover. Built as: a burst knocks one of them down only within a quarter of its reach (`HOUSEHOLD.cover`, 3 m of a shell's 12), only a stone falling at 10 m/s or faster knocks one down (`stone`), a gun's man stands on his own footing (`footReach` 0.9 m), and a man whose footing is shot away climbs down to the post's foot, keeps his place and his shots, and goes back up when it stands (a man on a keep or tower that topples or crushes still falls with it).

**Where it differs from the spec (the master's readings).**

- A bought gun's crew and a new spotter's tower's spotter are new people, not drawn from the reserve; a tower rebuilt on any plot is the same station and draws on it.
- A shell bursting beside a gun still dismounts it, as before; the spec names only a square hit and the masonry, but a burst at a gun's bed is physical. Its men are knocked down only within the cover.
- The bell ringer, the signaller and the spotter are stations whose organ (or tower) works only while they stand at their posts: the spec lists them as stations without saying what they do.
- The household panel opens on J: H was taken by the help.
- The reserve, masons and boys walk out of the keep's door; masons and boys walk to their work by their own rules.
- Two fixes that came out of the cover: the household's capsules report what touches them but push on nothing (`Minions.yielding`: men left standing in the rubble were immovable posts, stones were pinned against the masonry beside them and broke it; the mortar pit's men broke their own keep's foot, which toppled at 0:36 in one match and in the first 3 minutes in most), and a man moved metres at once (to his post, climbing down) is teleported (`Minions.teleport`).

**T9.** Traced on the integration branch: the 3.5 quick run's worst match (Warlord against Knight, seed 1) moved 679 stones at once, and a Knight mirror 576. In both, a fall began beside a heap of loose rubble that had just fallen asleep but was not frozen yet: Rapier wakes such a heap whole when anything touches it, with no word to the budget, so the fall had claimed the room those bodies needed (140 of them in seed 4). The budget's room now counts them (`dozing`); and rubble lying on a storey board that gives way with no room left turns to dust rather than wake. The worst match moved 447 after it, seed 4 518. Cost of the household: 10 upright figures a castle at the start (8 men at the guns, the bell ringer, the signaller), 19 at most plus walkers; no stone woken by them in a quiet match; the match step's cost unchanged in the wave match (3.1 to 3.3 ms a step with and without).

**The observatory.** The quick run (24 matches, 3 workers on a machine shared with nothing else at the end) on the final tree (`household-final`) against 3.5's (`household-base`, which reproduces 3.5's own run exactly), with the run before the cover (`household-b`) between:

| Target | 3.5 | Before the cover | 3.6 | Pass |
| --- | --- | --- | --- | --- |
| T1 Length | median 7.5 min; 75% between 6 and 16 | median 8.9 min; 83% | median 10.2 min; 75%; none by time | FAIL (the share in 6 to 16) |
| T2 Endings | felled 42%, floors 33%, storm 25% | felled 25%, floors 17%, storm 58% | felled 67%, floors 8%, storm 25% | FAIL (felled 67%) |
| T4 Skill | Warlord beats Knight 83% | 67% | 83% | PASS |
| T5 Spending | 124.5 s | 198.5 s | 218.5 s | FAIL |
| T7 Targets | keep 39% of 1347 | keep 32% | keep 41% of 1741 (floors 26%, cut 15%) | PASS |
| T8 Comebacks | 3 of 12 | 5 of 12 | 2 of 12 | FAIL (n 12) |
| T9 Stones moving | p99 655 | p99 492 | p99 498 | PASS |

The household (medians over the castles of each level, quartiles in brackets): a Knight against a Knight loses 23 [17 to 30] a match (gun crews 12, masons 4, boys 4, keepers 3), its reserve stands dry 338 s [161 to 684] of a median 10.2 minutes, some gun of its stands with no crew 454 s, and at the end it has on average 1.3 green, 1.8 trained, 0.4 seasoned and no veteran crews, with 2.9 guns uncrewed; it changes who is replaced first 4.8 times a match (at the end: guns 58%, walls 29%, powder 13%). A Warlord loses 13 against a Knight, the Knight 26. Before the cover a Knight castle lost 29 and stood dry 448 s of a median 8.9 minutes; with the cover but before the men yielded, 15 lost and keeps toppled from the foot in the first 2 to 3 minutes (T1 median 5.2). Magazines blew in 75% of matches (3.3's open item, put off by the owner). T5 is worse: matches run longer and gold piles up late; not retuned here (the brief).

Runs on the way: `household-b` (before the cover), `household-cover` (cover, men not yet yielding), `cover-ab` (12 Knight mirrors with and without the cover: keeps fell early only with it), `cover-tp` (with the teleport, still early), `household-final`.

