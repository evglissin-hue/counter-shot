# 3.3 Powder

## Goal

Every shot burns powder. Mills make it, a magazine stores it where everyone can see it, and powder boys carry it to the guns. The economy sets a castle's rate of fire, a careful shot is worth more than three loose ones, and the magazine is the best target in the game.

## Why

Shots are free today, so the best play is to fire the best gun at the keep as fast as it loads, and gold piles up with nothing to buy. Powder ties the economy to the shooting in both directions: what you build decides how much you can fire, and what you hit (a mill, a boy, the magazine) decides how much they can.

## Rules

Numbers live in a new `POWDER` in `packages/content`.

1. **Charges.** Powder is counted in whole charges, per team, shown beside the gold. A castle starts with 40 in its magazine and every gun's box full.
2. **What a shot costs.** Swivel 1, chain shot 3, long gun 4, mortar 10. Heavy shot costs 1 more, a heavy shell 2 more. Guns nobody mans pay the same.
3. **The ready box.** Each gun has a box of powder beside it: long gun 12, mortar 20, chain shot 9, swivel 6. A gun fires only if its box holds the shot's cost. The fire input is refused otherwise, as for a gun that is not loaded.
4. **Making it.** The keep's cellar makes 0.4 charges a second. Each working Powder Mill makes 0.5. Mills no longer pay gold.
5. **Storing it.** A new building, the **magazine** (140 gold, rises in 12 s), holds up to 120. Each castle starts with one on a back plot. With no working magazine the cellar holds 30. Powder made with nowhere to go is lost, and the HUD says "Magazine full".
6. **Carrying it.** Three **powder boys** per castle (figures, as easy to knock down as a mason; one who falls is replaced at the keep's door after 20 s). A boy takes a keg of 12 charges from the magazine (or the cellar), walks the courtyard to the foot of the wall or tower under the gun that needs it most (the gun you ride first, then the emptiest box), and a hoist lifts it in 3 s. Boys run from enemy men within 7 m, as masons do.
7. **Buying it.** 20 charges for 60 gold at the magazine, at once, if there is room.
8. **Kegs burst.** A boy knocked down by a ball, a burst or falling masonry while he carries a keg sets it off where he is (a sapper's keg: `KEG.burst`). A burst near another keg sets that off too.
9. **The magazine blows.** When a shell or a keg bursts inside it, or it is wrecked (under 60% standing) with stock in it, everything in it goes up as one burst at its middle: reach 3 m plus 1 m for every 20 charges (120 charges: 9 m), thrown half again as hard as a shell. The stock is lost. A Powder Mill that is wrecked while it works bursts like one keg.
10. **Sudden death** (until 3.8 replaces it) also doubles powder made.
11. **The Practice range** has boxes that never empty.

What the numbers mean, to tune from: the cellar alone feeds one long gun shot every 10 s. One mill brings a long gun close to its full rate. Three mills feed a long gun and a mortar at full rate. Three boys from a back plot carry about 80 charges a minute; from a front plot nearly twice that, so a magazine near the guns loads them faster and stands where shells fall.

## Data and code

- `packages/content`: `POWDER`; `magazine` joins `BuildingKind` with its pieces (a low stone vault with a timber lean-to, about 30 pieces; kegs are drawn, not bodies); `START_BUILDINGS` gains the magazine; the `powderBoy` unit.
- `packages/sim`: a `Carriers` module beside `Works` (the same shape: figures in the minion list, tasks, a policy the rules set); boys are left out of the cap on men standing and out of the storm counts, as masons are; a carried keg bursts through the path sappers' kegs use; the magazine's burst is one `burst()` call. Hash the carriers and the boxes. Bump `RULES_VERSION`.
- `packages/rules`: the stock and its making in `Economy` (whole charges paid every second, the fraction carried, as gold is); `Match.apply` refuses a fire the box cannot pay, and `gunnery` skips a gun whose box cannot; the `{ kind: "powder" }` input buys. Bump `MATCH_RULES_VERSION`.
- `MatchInfo` gains the stock, its rate, each gun's box and each boy's errand.

## The AI

- The gunner never chooses a gun whose box cannot pay, and prefers the gun whose shot it can afford twice.
- The steward's plans already build two mills; it buys powder when gold stands above its reserve and the stock is under 20; it rebuilds a lost magazine before anything else.
- From a Knight up, a raid (its mortar on buildings) prefers the enemy magazine when it holds 80 or more, then a mill.

## The page

- One number by the gold: the stock and its rate ("86 +1.4/s").
- The weapon card shows the box as pips (shots left). A gun tab dims when its box is empty and shows a small keg while a boy is on his way. Firing an empty gun gives a dry click and a short note ("No powder at the long gun: a boy is 6 s away").
- The world shows it first: kegs stacked under the magazine's lean-to (one for every 10 charges), a boy with a keg on his shoulder, the hoist's rope at each gun.
- The build menu gains the magazine and "Powder, 20 for 60 gold".
- Sound: the hoist, a keg set down, the dry click, and a magazine that is heard across the valley.
- The guided match: the mortar step mentions the box; a tip the first time a box runs dry.

## Tests and measures

- A fire is refused with an empty box; a boy's keg fills it; costs by weapon and upgrade.
- The stock never passes the cap; with no magazine the cellar feeds the guns.
- A boy shot while carrying bursts; a boy shot on his way back does not.
- The magazine's burst grows with its stock; an empty one makes none.
- Observatory: shots by hand a minute over a match; the share of matches with a magazine blown (aim: 15% to 35%); the win rate of the side that lost its magazine (aim: 20% or more, so it is a blow and not the end); T5.

## Dead ends to hunt

- A gun whose box stays empty for 60 s while there is stock and a boy stands.
- A castle with no powder coming in (the cellar must always make some).
- Boys who cannot reach a gun's foot (rubble, a ruin): they clear a way or take another path.
- A magazine that cannot be rebuilt because its plot is full of rubble.

## Try

Fire the mortar until its box is empty and watch a boy bring a keg. Build a mill, then a second. Shell the enemy magazine when the kegs are stacked high.

## For the owner

- Should the gun you ride always have powder (so shooting never stops) with scarcity biting only on the other guns? The spec says no: every gun pays, and the gun you ride is served first.

## Status

Done (November 13). Branch `claude/keepfall-3-3-powder` (from `main` with 3.1, 3.2, S, V, L0, L2, L3). Built through the build and review loop: a contract commit (`POWDER` in `packages/content/src/powder.ts`, the foot of every gun, the `Carriers` surface), then executors for the core (content, sim, rules), the AI and the observatory, the page and the world, then the master's tuning from the quick runs and the rounds.

**What was built.**
- Content: `POWDER` (every number above, as data); the magazine (140 gold, 12 s, a stone vault of hard masonry with a timber lean-to, 28 pieces) on plot 5 of every castle from the start (plot 3 on the Practice range); the powder boy (`Unit.PowderBoy`); mills pay no gold.
- Sim (`packages/sim/src/carriers.ts`, sim `RULES_VERSION` 13): each castle's store (the magazine's stock, or the cellar's), the ready box of every gun, three powder boys per castle (figures in the minion list, left out of the cap on men standing, the storm counts and every enemy search), kegs that burst, the magazine and the mill that blow (`MagazineBlew`, `MillBlew`, `KegBurst`, `Hoist`, `Boxed` events). A fire the box cannot pay is refused in `SandboxSim.apply` (by hand, by its crew, in a salvo). All of it is hashed.
- Rules (match rules 10): powder made in `Economy` (the cellar, the mills, doubled in sudden death; the fraction carried and hashed, as gold is); `{ kind: "powder" }` buys 20 for 60 gold; one magazine a castle; gunnery and salvos skip a gun whose box cannot pay; the keep match plays without powder. `NET_VERSION` 6.
- The AI: the gunner never chooses a gun that cannot pay and prefers one that holds two shots; the steward buys powder when its stock is under 20, rebuilds a lost magazine before anything else, and from the Knight up raids the enemy magazine when it holds 80 or more. The Knight's and the Warlord's plot 5 barracks steps came out of their plans (the magazine stands there).
- The page: the stock and its rate by the gold ("40 +0.4/s"; "Cellar 24/30" without a magazine; "Magazine full" when powder made is being lost), with a tooltip that says where it comes from; the weapon card shows the box as pips (shots left); a gun's tab dims when its box cannot pay and shows a small keg while one is on its way; firing a dry gun gives a dry click and a note ("No powder at the long gun: a boy is 6 s away", or why none is coming); notes and sounds for a magazine or a mill going up, ours or theirs, and for the hoist and a keg set down (a magazine is heard across the valley); the build menu gains the magazine ("You have one" while one stands) and "Powder, 20 for 60 gold"; the guided match's mortar step says each shell burns 10 powder from the box beside the gun, and a tip comes the first time a box runs dry; spoken orders "powder", "buy powder" and "build a magazine", and the standing order "buy powder under twenty" (`packages/orders`). And the world shows it first: kegs lie under the magazine's lean-to, one for every 10 charges (up to 12, in a pyramid); a powder boy has his own look (a linen smock and a cap in his side's colour, a keg on his left shoulder) and a hand over hand hoist pose; a rope runs from each gun down to the boy at its foot with the keg rising on it (at a mortar pit the keg is slid in, no rope); the minimap's magazine tile has a keg sign and a stock bar (red under a quarter); a magazine blown up is a moment for the impact cam and the replay ("Magazine blown") and the feat "Powder keg" (blow up the enemy magazine).
- The observatory: per side powder made, bought, spent and lost, the magazine blown, and the seconds the ridden gun could not pay; a Powder block in the report. The dead-end hunt has the spec's four powder hunts.

**Where it differs from the rules above (the master's tuning, each from a quick run or a traced match).**
- A boy takes a full keg and what a box has no room for goes on to the next gun in need (or back to the store): with a keg the size of what one box lacked, three boys carried about 40 charges a minute from a back plot.
- Boys run at 2.5 m/s with a keg and 3.0 without (spec: unset; the core started at 1.6 and 2.0), and one who falls is replaced after 10 s, not 20 (at 20 s shells in the courtyard kept two of three down).
- Boys with nothing to do wait in the lee of the magazine's vault, on the side of its plot away from the keep, and new boys come out there, not at the keep's door: at the door, beside the keep, one shell aimed at the keep took all three again and again, and late in a match the keep's door was walled in by its rubble.
- A keg goes off only when the burst that knocks its boy down reaches him (a ball or falling masonry always sets it off); a farther knock throws him down and the keg rolls away unlit. With every knock lighting kegs, shells in the courtyard set off a keg chain in most matches.
- The magazine blows from a burst inside its plot (not a margin round it), and its vault is hard masonry (a burst reaches a third as far into it): with a margin and a softer vault, magazines blew in 46% of the first quick run's matches, several in the first minute to shells that missed the plot in front of it by a few metres.
- Boys find their way: a door or a gun's foot cut off by rubble is reached from the nearest point within 6 m; a boy with no way at all to the store for 20 s (walled in, left on a ledge) finds his way round to it; one whose ground is no longer walkable (the lean-to's posts across the door) steps off it; and one whose last step went nowhere, or who has not got closer for half a second (at the corner of a heap the blended way pushed him into a step he could not take, or rocked him between two cells), follows his own cell's way down the field (`LocalFields.downhill`, `Army.stepOff`). Each was a boy standing for minutes with the store full and the gun dry.
- The stock lives in the sim's `Carriers` (the store is where the boys take kegs); the making is in `Economy` as the spec says.

**Versions and pins.** Sim `RULES_VERSION` 12 to 13; `MATCH_RULES_VERSION` 9 to 10; `NET_VERSION` 5 to 6 (powder is in the world and its hash, and buying it is an input). Every pin re-pinned on purpose (every match now has powder, boys and a magazine): SESSION_HASH fcfc80cf / 9c6521a6 to a4f869a6 / c555405d; MATCH_HASH edd989a0 / 7f743abe to 951ef979 / 2f4b1a1f; WAVE_MATCH_HASH 504816da / a09c952a to 169d50ea / da089720; ESTATE_MATCH_HASH 718a1455 / f93ead42 to 5a15b2ad / b6a2aa10; AI_MATCH_HASH 28b2822d / a50a7488 to b8d6c4ae / c2774773; GUIDED_MATCH_HASH 20ad5b9f / dbf0c11b to 89781c21 / d1ef7d67. The lab's 35a7603f / 054e5eb0 unchanged.

**The observatory.** The quick run (`p3-quick5`, 24 of 24) on the final core (41dfa3e), against 3.2's (`a2-quick`):

| Target | 3.2 | 3.3 | Pass |
| --- | --- | --- | --- |
| T1 Length | median 5.4 min; 42% between 6 and 16; 0% by time | median 6.7 min; 58% between 6 and 16; 0% by time (n 12) | FAIL |
| T2 Endings | keep 100% | keep 83%, storm 17% (n 12) | FAIL |
| T3 Sides | castle 0 won 3 of 12 | castle 0 won 5 of 12; too few to call | n/a |
| T4 Skill | Warlord beats Knight 100% | 83% (n 12) | PASS |
| T5 Spending | median unspent-gold time 78.5 s | 52.0 s (48 sides); last build at 10:25 (8 sides in matches of 8:00 or longer) | PASS |
| T6 Openings | not measured | not measured | n/a |
| T7 Targets | keep takes 56% of 1122 shots by hand | 56% of 1143 | FAIL |
| T8 Comebacks | the side behind won 50% | 42% (5 of 12) | FAIL |
| T9 Budget | p99 most stones moving 780; worst step 104.7 ms | p99 793; worst step 3142.7 ms (this machine, with two test suites and a browser running beside it: the step times say nothing) | FAIL |

Powder (the report's new block):
- Shots by hand a minute: 6.6 (median over sides).
- Matches with a magazine blown: 46% (11 of 24; aim 15% to 35%): FAIL.
- Win rate of the side that lost its magazine first: 18% (n 11; aim 20% or more): FAIL, by one match.
- Per side (medians, castle 0 / castle 1): made 401 / 378, bought 80 / 80, spent 381 / 344.
- The gun the AI rides could not pay for a median 34% of a match (a quarter of sides above 44%).

The first quick run (on 869f0cd, before the master's later fixes) gave T1 6.1 min with 50% in the band, T5 30.5 s, magazines blown in 46%, the side that lost its magazine first winning 36%, and T9's p99 1315 (magazine blows of 9 m made peaks of 700 to 950 stones moving). Making the magazine harder to set off (a burst must be inside its plot, the vault is harder) did not move the blown share: in both runs most blows were mortar shells landing on the plot by chance, many in the first minutes (the Knight's first shell at a new raid target carries its eye's first error, and the magazine stands behind the plots it raids), with 25 to 103 charges in it, mostly under the 80 that makes the AI aim at it.

**What powder does to T5.** It passes now: the median time a side sits on more than 400 gold fell from 78.5 s (3.2) to 52.0 s. Mills no longer pay gold, and gold now buys powder (a median 80 charges, 240 gold, a side) and rebuilds blown magazines (140 each). Long matches still pile gold up late: in the dead-end hunt two Knights sat on 1,800 and 2,300 gold after eight minutes, once their plans had run out.

**The rounds.**
- Checks on the final core (41dfa3e): `npm run check` 361 of 361. BROWSER
- Dead-end hunt (Knight mirrors on seeds 21, 22 and 23 for 12 minutes, Warlord against Knight on seed 21), before the master's fixes and after: 11, 17, 2 and 10 flags, then 4, 0, 8 and 0. Gone: boys standing for minutes (walled in at the keep's door, on blocked ground at the magazine's door after its lean-to fell, rocking at the corner of a heap) with the store full and the gun dry. Left: in long matches a gun whose box cannot pay for 60 s while all three boys are busy (the boys, not the powder, set the rate there: seven guns firing at waves outrun three boys), and guns over a battered gate whose feet are buried in rubble (passed over, tried again every 30 s); gold piling up late in long matches (two Knights at 1,800 and 2,300 after 8 minutes); guns waiting for their masonry. No castle ever had no powder coming in, and no magazine ruin failed to rise.
- Player's chair (1280x720: the executors' shots, and every new line read in place): the build menu's courtyard map cut "Magazine" off on a narrow plot (now "Maga-zine", and "Mill" for the Powder Mill there; the list beside it gives full names); a loaded gun with an empty box read Ready in gold beside its empty pips, so the next press gave a dry click (it now reads "No powder: keg in 6 s", or "No powder"). Both fixed. Left as they are: the kegs under the lean-to sit in the wall's shadow and read dimly from the guns, so the stock reads better by the gold and on the minimap than in the world; "Magazine full" takes the number's place by the gold (the number is 120 then).

**Open.**
- The owner's question above (should the gun you ride always have powder?) is unanswered; the spec's default stands: every gun pays, the gun you ride is served first.
- Magazines blow in 46% of matches (aim 15% to 35%) and the side that loses its magazine first wins 18% (aim 20% or more). Levers, from the runs: count only a burst inside the vault (not the lean-to), make the AI's first shell at a raid target less wild, or start the magazine further from the plots that are raided.
- The boys, not the powder, set the rate of fire late in long matches: three boys cannot keep seven guns fed while the guns nobody mans fire at waves, and the ridden gun is dry a third of a match. Levers: a fourth boy, bigger kegs, a front plot for the magazine (the spec's trade), or guns nobody mans burning less.
- Guns over a battered gate whose feet are buried in rubble go without (passed over, tried again every 30 s); boys do not clear a way.
