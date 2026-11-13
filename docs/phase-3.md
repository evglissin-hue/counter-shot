# Phase 3: one game (the plan after phase 2)

Phase 2 ended with a full match: guns, gold, waves, repairs, an AI, a friend online, a guided first match. Phase 3 makes those parts depend on each other. The owner approved this direction on November 10 after a design review (November 9). This file is the plan: what is wrong today, what phase 3 aims for in numbers, the order of the milestones, and the rules every milestone follows. Each milestone has its own spec under `docs/phase-3/`. Ideas kept for later are in `docs/future.md`.

Read this file first, then only the spec of the milestone or track you are building.

## The idea

Physics, strategy and shooting sit in three separate layers today, and one loop decides every match. Phase 3 fuses them:

1. **Strategy is physical, so it can be shot.** Every capability a castle has is a thing that stands somewhere, can be seen through a sight, and breaks in its own way.
2. **Shooting costs strategy.** Powder is made, stored and carried. More guns make a salvo, not just more idle iron.
3. **Physics decides, not a counter.** A keep falls because what held it up was cut, and it falls somewhere.

The short version, for when a design call is unclear: you can shoot the tech tree.

## What the design review found

Fifteen AI against AI matches on `main` after phase 2 M6 (seeds 11 to 54, Squire to Warlord, mirrored and mixed; the table is in `docs/plan.md`). An AI match is not a person playing, but it shows what the rules reward.

- **One loop decides, and it is a count.** 13 of 15 ended by keep between 2:17 and 6:16; the two storms (6:58 and 8:04) were a Knight over a Squire. The median was 4:35 against the spec's 10 to 15 minutes. Each keep floor takes two shells, so winning is letting go of the mortar's meter about a dozen times.
- **The economy never touches the shooting.** Shots are free. A Knight's castle is fully built by about 3:30, then gold piles up (the winner of the longest match held 3,971 unspent). A second long gun adds little: you ride one gun at a time, and guns nobody mans are weak by design.
- **Defence is mostly passive.** Apart from silencing a gun for 30 s, the defender watches the keep's pips drain while masons spend gold.
- **Waves rarely decide.** One side stood at the cap of 96 men with the storm meter at zero.
- **Tuning by hand swings.** The keep fell in 30 s (before M5), then Knight against Knight was undecided at 14:00, now the median is 4:35. Castle 0 won 7 of the 11 mirror matches and a Knight there beat a Warlord: too few to call, which is the point of milestone 3.1.

## Targets

Phase 3 is done when the observatory (3.1) measures these on mirror matches at equal level, 200 seeds or more. They are design targets: change one only with the owner's word.

| | Target | After phase 2 |
|---|---|---|
| T1 Length | Median 9 to 13 minutes; 80% of matches between 6 and 16; under 2% reach time (25:00) | Median 4:35, none past 8:04 |
| T2 Endings | No single ending above 60%; storms 25% to 50% | Keep 87%, storm 13% |
| T3 Sides | Castle 0 wins 46% to 54% | 7 of 11 (unproven) |
| T4 Skill | Warlord beats Knight 75% or more, Squire 90% or more | Unknown |
| T5 Spending | Unspent gold above 400 for under 60 s a match (median); something worth buying until 8:00 at least | 1,400 to 4,000 unspent by 5:00 to 8:00 |
| T6 Openings | At least three build orders within 5 points of the best; the best beats the median opening by under 10 points | One fixed plan per level |
| T7 Targets | No one kind of target takes more than half the winner's shots by hand | The keep takes most |
| T8 Comebacks | The side behind at half time wins 20% to 35% | Unknown |
| T9 Budget | At most 600 stones moving at once (99th percentile across matches); no step over 33 ms on the reference machine | Collapses peak near 600 |

## Order

Build the milestones in this order unless the owner says otherwise. Each ends with a playable build at the game link.

| | Milestone | Spec | What changes |
|---|---|---|---|
| 3.1 | The observatory | `phase-3/01-observatory.md` | Thousands of AI matches, a report against the targets, a search for dominant openings. No gameplay change. |
| 3.2 | Range and register | `phase-3/02-range-and-register.md` | Your shots mark ground; guns nobody mans shoot true on it; fire for effect. Bridges can be rebuilt. |
| 3.3 | Powder | `phase-3/03-powder.md` | Every shot burns powder that mills make, a magazine stores and powder boys carry. |
| 3.4 | The keep falls by engineering | `phase-3/04-keep.md` | Towers and keeps crush and topple by load; the mason's eye; buttresses. |
| 3.5 | Machines | `phase-3/05-machines.md` | The bell, the crane, the signal mast, the spotter's tower; eight plots. |
| 3.6 | The household | `phase-3/06-household.md` | Named crews at every station, a finite reserve, crew skill in place of dice. |
| 3.7 | Elements | `phase-3/07-elements.md` | Fire, smoke, water, mud, hard ground; hot shot, fire and smoke shells. |
| 3.8 | The day | `phase-3/08-day.md` | Dawn fog, a clear day, a wet dusk, night; replaces sudden death. |
| 3.9 | The valley as a board | `phase-3/09-valley.md` | Quarries, villages, a sluice; stances per road; earthworks; mines. |
| 3.10 | Armies with nerve and engines | `phase-3/10-armies.md` | Morale and routs, melee without dice, formations, riders, the ram, the siege tower. |
| 3.11 | The arsenal | `phase-3/11-arsenal.md` | Each gun its own sport; the harpoon and the rocket rack. |
| 3.12 | Sieges for one | `phase-3/12-sieges-for-one.md` | Forts as data, the Master Gunner's exam, the Daily Siege, rewind. |
| 3.13 | Two seats | `phase-3/13-two-seats.md` | Gunner and Steward in one castle; Hold the keep (SPEC section 11). |

Three tracks run alongside, on the game page only (no change to a match, so no hash moves). Each can be built by its own executors during any milestone.

| | Track | Spec | What it is |
|---|---|---|---|
| S | The shot as a show | `phase-3/show.md` | The impact cam, moments and the book of feats, replays, the film of a match, replay files. The owner asked for the kill cam first: S1 and S2 start with 3.1. |
| V | The steward's ear | `phase-3/steward.md` | An order line and voice orders, so your hands stay on the gun. |
| L | The look | `phase-3/look.md` | Rounds of visual work: the gun in your hands, stone that remembers, a living valley, light and weather, the map as an engraving. |

Why this order: measure first (3.1); then the three cheapest fusions, each of which fixes one finding above (3.2 makes more guns matter, 3.3 ties the economy to the shooting, 3.4 replaces the count); then the castle's insides (3.5, 3.6), the world (3.7, 3.8, 3.9), the armies (3.10), and the content that needs all of it (3.11 to 3.13).

## Rules for every milestone

These add to `CLAUDE.md` and the "Build and review loop" in `docs/handoff.md`; they do not replace them.

1. **The loop.** One master session per milestone plans and reviews; executors build. The master writes its briefs from the milestone's spec. A spec gives the rules and where they live; the master still traces the code before it briefs.
2. **The spec's intent outranks its numbers.** Every number in a spec is a starting point and lives in data (`packages/content`). Tune with the observatory against the targets and write what you measured into the milestone's Status. If a rule fights the idea at the top of this file, or a spec's "For the owner" lists a choice, stop and ask the owner.
3. **The AI plays everything.** A system ships only when the AI at Knight level uses it and defends against it, by sending the same inputs a player does. Otherwise the observatory is blind to it and nobody can balance it.
4. **Determinism.** As in phases 1 and 2: fixed 60 Hz ticks, `@keepfall/core` maths, ordered iteration, inputs tagged with ticks, no wall-clock time. New randomness gets a new named Rng stream; never draw from an existing stream (an extra draw moves every later fight). New state goes into the hash. A malformed input is refused. Anything that changes a match is an input.
5. **Versions and pins.** A gameplay change bumps `RULES_VERSION` (sim) or `MATCH_RULES_VERSION` (rules), and `NET_VERSION` when two builds could not pair. Re-pin the session, keep, wave, estate, AI and guided hashes on purpose and say so in the Status. The lab's reference hash (35a7603f / 054e5eb0) stays valid: new masonry goes behind a `LayoutOptions` flag that only `GAME_LAYOUT` sets.
6. **No body joins the masonry mid-match.** New masonry (plots, the bell, buttresses, engines) is laid out in the layout from the start and withdrawn until it is built, as buildings are since phase 2 M3. Shots and men are the only bodies made during a match.
7. **Budget.** Kat's laptop (Apple M3) is the floor: about 550 stones moving in 6 ms. Each spec states its cost; the observatory reports the most stones moving and the worst step of every match.
8. **What can be seen is gameplay.** Once smoke, fog and night arrive (3.7, 3.8), quality tiers must not change what they hide. Tiers change only the look.
9. **The castle shows it first.** A new system adds at most one element to the HUD. Its state should be readable in the world (kegs by the magazine, a crew at a gun, cracks in a course) before it is a number. Every new line of text is read in place in the player's chair round.
10. **The guided match keeps up.** When a milestone changes what a first-time player must know (3.2, 3.3, 3.4), the coach gains or changes a step and `tools/guided-check.mjs` covers it.
11. **Closing a milestone.** Checks green; the observatory's quick run against the targets; the dead-end hunt with the milestone's new hunts; the player's chair; the build published; the milestone's Status filled in; its rules folded into `SPEC.md` (bump the draft); `docs/handoff.md` and this file's status table updated.

## How a milestone spec is laid out

Goal, Why, Rules (numbered, with starting numbers), Data and code (where it lives, new inputs and events, the hash), The AI, The page, Tests and measures, Dead ends to hunt, Try (what the owner tries), For the owner (choices that are theirs), Status (the builder fills it in).

## Words

- **Mark**: a piece of ground or masonry a team has ranged (3.2). **Fire for effect**: every gun that bears fires at a mark.
- **Charge**: the unit of powder. **Ready box**: the powder at a gun. **Magazine**: where a castle's powder is kept (3.3).
- **Structure**: a keep or a tower, judged as a whole for crushing and toppling (3.4). **The mason's eye**: the view that shows it.
- **Organ**: a machine every castle has from the start (the bell, the crane, the signal mast). **Machine**: any building or organ with a job (3.5).
- **Household**: a castle's named people. **Reserve**: those waiting in the keep (3.6).
- **Nerve**: a wave's morale (3.10).
- **Moment**: something worth a replay. **Feat**: a named moment in the book. **Clip, reel, film**: a recorded moment, the best of a match, and their cut (track S).
- **Fort**: a castle as data (3.12). **Seat**: one player's place in a castle (3.13).

## Not in phase 3

- Saved for later (`docs/future.md`): the Castle Architect and sieges by post, the March (a campaign), a turn mode, doctrines, an AI steward you talk to freely, 2v2.
- Graniteborn (SPEC section 10) follows phase 3; 3.11 leaves the giant's sling to it.
- Dropped by the owner (November 10): the counter-shot idea (shooting shells out of the air, guns hidden until they fire, woolsacks over a wall). Do not build these. Smoke stays, as part of 3.7.

## Status

| | State | Rules versions after | Game link version |
|---|---|---|---|
| 3.1 The observatory | Done (November 11): T4 passes; T1, T2, T6, T7, T8, T9 fail; no side bias (castle 0 47.3% of 400) | sim 11, match 8 (unchanged) | none (no page change) |
| 3.2 Range and register | Done (November 12): a marking Knight beats a non-marking one 67.5% of 80; T4 passes; T1, T2, T5, T7, T8, T9 fail | sim 12, match 9, net 5 | 21 |
| 3.3 Powder | Done (November 13): every shot burns powder carried by boys from the magazine; T4 and T5 pass (T5 52.0 s, from 78.5 s); T1, T2, T7, T8, T9 fail; magazines blow in 46% of matches (aim 15% to 35%) | sim 13, match 10, net 6 | 22 |
| 3.4 The keep | Not started | | |
| 3.5 Machines | Not started | | |
| 3.6 The household | Not started | | |
| 3.7 Elements | Not started | | |
| 3.8 The day | Not started | | |
| 3.9 The valley | Not started | | |
| 3.10 Armies | Not started | | |
| 3.11 The arsenal | Not started | | |
| 3.12 Sieges for one | Not started | | |
| 3.13 Two seats | Not started | | |
| S The shot as a show | S1 moments and feats, S2 the impact cam: built (November 10); S3 the recorder, S4 the replay, S5 the film and the photo, S6 the log and replay files: built (November 11, `claude/keepfall-show-s3-s6`; the saved film's sound runs long in this container) | unchanged (page only; the rules gain an input observer) | 17 (S1, S2), 19 (S3 to S6; the game link declares `downloads` so the film, photos and replay files can be saved) |
| V The steward's ear | V1 the order line, V2 voice, V3 standing orders: built (November 10); the game link declares `dictation` and `tts` since version 18 | unchanged (page only) | 18 |
| L The look | L0 the minimap: built (November 10); L2 stone that remembers and L3 a living valley: built (November 11, branch `claude/keepfall-look-l2-l3`); L1, L4 to L8 not started | unchanged (page only; frames gain the coming gust, a read) | 17 (L0), 20 (L2, L3) |
