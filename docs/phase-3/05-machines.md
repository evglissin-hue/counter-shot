# 3.5 Machines

## Goal

Every capability of a castle is a machine that stands somewhere, shows what it does and breaks in its own way. You learn an opponent's plan by looking through your sight, and you answer it by shooting it.

## Why

After phase 2 M5 the owner found no point in attacking anything but the keep; guns that can be knocked out were the first answer. This makes it a system. It also turns the build menu into a real choice: eight plots, two taken at the start, and more worth building than there is room for.

## Rules

Numbers live in `packages/content` (`buildings.ts` and a new `ORGANS`).

### Organs: what every castle has from the start

An organ is laid out in the layout like any masonry, stands from the first tick, works while 60% of it stands, and is put back by masons under a new repair switch, **Works** (after the gate, before the walls).

1. **The bell.** A timber frame with an iron bell on the top of the back right tower (the one tower with no gun slot), seen over the walls from the far castle.
   - While it stands, guns nobody mans engage out to 45 m from their gate (`DEFEND`, as today) and on marked ground (3.2).
   - Without it they see the enemy late: only within 20 m of the gate, and marks do nothing for them. Notes say so: "Your bell is down: your guns fire late".
2. **The crane.** A treadwheel crane in the yard by the masons, its jib 10 m high, just showing over the front wall.
   - While it stands, masons work as today.
   - Without it they lay stones only in the lowest 4 m (8 courses) and carry rubble; higher work waits. They rebuild the crane first.
3. **The signal mast.** On the keep's roof beside the banner, standing on the top floor's boards.
   - While it stands, orders, roads and barracks' mixes reach every wave at once, as today.
   - Without it a change reaches only waves that muster after it; men in the field keep their last order. It goes back up with the roof.

### Plots: what you choose

4. **Eight plots**, not six: two more where they are clear of the gate corridor, the mortar pits, the masons' yard, the garrison's posts and the muster (behind the keep is free). Each castle starts with its barracks and its magazine.
5. **Each kind lists the plots it may stand on**, so the layout lays out only those (rule 6 of `docs/phase-3.md`).
6. **The spotter's tower** (new; 180 gold; a timber watch platform 12 m high, taller than the walls):
   - marks last 240 s and every gun of yours shares them; without it a mark lasts 90 s and serves only the gun that made it (3.2's numbers become these two cases);
   - the long gun's aim help shows a full second of its arc, not half, and the mortar's ring shows the wind.
7. **What the plots hold after this milestone**: barracks, Powder Mill, Foundry, magazine, spotter's tower. Later: the cistern (3.7), the workshop (3.10).
8. **A tell for each**, readable through a sight: the Foundry's smoke, the mill's wheel turning, kegs stacked by the magazine, a figure with a glass on the spotter's platform, the bell swinging when it rings.

## Data and code

- `packages/content`: the organs' pieces and places behind a `LayoutOptions` flag; a new `iron` material for the bell (density 7,800); `PLOTS` grows to eight; each `BuildingDef` gains the plots it may stand on.
- `packages/sim`: organs are plain masonry with a count of what stands, as buildings are (`structures.ts` already counts every 10 ticks); `works.ts` gains the Works section and the crane's height limit.
- `packages/rules`: `gunnery` asks the bell; `Army.setOrder`, routes and mixes ask the mast; marks ask the spotter's tower; the `repair` input gains "works". Bump both rules versions.
- `MatchInfo` gains each organ's state for both castles.

## The AI

- From a Knight up, the gunner has three new aims, chosen by what its side is about to do:
  - the bell, when two of its waves or more are past the stream;
  - the crane, while a breach it made is open;
  - the roof and mast, when your men in the field outnumber its own by half again.
- The steward builds a spotter's tower in the Knight's and the Warlord's plans, and keeps Works repairs on.
- The observatory's price list says what each organ and machine is worth; tune costs from it.

## The page

- The minimap shows each organ as a small sign in its place (see the redesign, round L0 of `look.md`), red when it is down.
- Notes when one of yours falls or is back; a toast when you bring one of theirs down ("Their bell is down").
- The build menu lists the spotter's tower and shows which plots each building may take.
- Sound: the bell rings from its tower when the enemy crosses the stream, and is cut short when it falls; the crane's wheel creaks while masons work high.

## Tests and measures

- Each organ's effect switches with it: guns fire late with the bell down; masons stop at 4 m with the crane down; a wave in the field keeps its order with the mast down.
- An organ is rebuilt and its effect returns.
- The eight plots are clear of every path in a ten-minute AI match (the dead-end hunt's blocked-way flags).
- Observatory: T7 (shots by kind of target); how long each organ is down in a match; win rate with each down at 5:00.

## Dead ends to hunt

- An organ that cannot be rebuilt: the bell with its tower down waits for the tower and says so; the crane must never need itself (its own pieces are low work).
- Orders lost for good: with the mast down, a team must still be able to change what new waves do.

## Try

Drop their bell with the long gun, then send two waves. Shell their roof and watch their men in the field stop answering. Lose your crane and see a high breach stay open.

## For the owner

- Is losing the bell too hard a blow (guns nobody mans nearly blind)? The number to soften it is the 20 m.

## Status

Done (November 15) on `claude/keepfall-machines` (merged with the banner rule and the budget pass from the integration branch; not on `main`, not published). Built in the build and review loop: the master's contract (shared types, the organs' pieces and places, eight plots), then six executors in parallel (A1 masons, bell and spotter's tower; A2 the signal mast; B1 the AI; B2 the observatory and the hunts; C1 the look; C2 the page) and one more for a dead end the hunt found (D1).

**What was built.**

- Content: `organs.ts` (`ORGAN_KINDS`, `ORGANS`, `ORGAN_WORKS` 0.6, `BELL` 45 and 20 m, `CRANE` 4 m, `organPieces`); each castle's organs laid out after its banner behind `LayoutOptions.organs` (only `GAME_LAYOUT` sets it; the lab's layout and hash are untouched): the bell (6 pieces, its key the iron bell) on the back right tower, the crane (8, its key the jib) in the yard east of the masons, the mast (5, its key the yard) on the keep's top floor; a new `iron` material (7,800 kg/m3). `PLOTS` grows to eight (6 and 7 behind the keep, clear of the keep's and back wall's masons, the refuge and the buttresses); `BuildingDef.plots` and `allowedOn` (barracks, mill and Foundry plots 0 to 5, the magazine 2 to 7, the spotter's tower 4 to 7, as the page counts them 1 to 8); the spotter's tower (180 gold, 15 s, 27 pieces, `SPOTTER`: marks 240 s or 90 s alone, the long gun's arc 1 s or 0.5 s); `REPAIR_KINDS` gains "works" and `REPAIR_ORDER` puts it after the gate. 11,253 stones in the game's layout (under `MAX_STONES` 12,000), no overlaps, every organ supported and still after 10 s.
- Sim: `organs.ts` counts each organ every 10 ticks (works while 60% stand with its key piece; `OrganDown` and `OrganUp` events; why one waits: Footing, Crane, Off, Busy); `works.ts`: with the crane down only pieces whose foot is under 4 m go back and high rubble is carried off; rule 12 (a keep or tower near falling) comes first while the course carrying the most is low work, otherwise the crane comes first, before anything else, unless every piece of it is blocked; the Works section per organ. `army.ts`: an order per wave (`waveOrder`, `orderOf`, `setOrder(team, order, reach)`), read by the march field, holding, ladders, cohesion and musketeers; a crew (the garrison, the masons) hears the standing order whatever the mast does. Over the budget, an organ's key piece never turns to dust. A gate leaf loose in its frame never breaks the wall around it by contact force (it rubbed the lintel over the gate loose once the plots moved). A man whose slide along a refused cell moves him less than a quarter of his stride sidesteps (men stood for good in a crater by their own gate: the eight-plot hunt).
- Rules: the bell in `lay()` (45 m and marks while it rings, 20 m and no marks without); the mast gates order and road inputs and re-sends the standing order when it works again (roads are not replayed; hashed); the register: marks 240 s shared by every gun with a working spotter's tower, 90 s for the gun that made them without, cut to that when the tower falls; the estate refuses a building on a plot its kind may not take; `organUp(team, organ)`, `spotter(team)`.
- AI: `Aim.Bell`, `Aim.Crane`, `Aim.Mast` (from the Knight, `organAims` 0.5 and 0.7 of its looks while the condition holds: the bell once two of its waves are past the stream, the crane while a way in is open, the roof and mast when the enemy's men in the field outnumber its own by half again; `organRest` 45 s and 30 s after one falls; its own Rng stream); raids take the spotter's tower before the mills; the steward builds only on allowed plots (the spotter's tower on plot 7 in the Knight's and Warlord's plans) and keeps Works on; the mason's eye earned: with no spotter's tower of its own it forecasts no cut and guesses one point of the foot it can see.
- Page: eight plots in the build menu (only the kinds a plot may take, "Plots 5 to 8" on each line, "No free plot" when none is left), the Works chip on Alt+5, notes for your organs down, back and why one waits, a toast for theirs, the masons' line saying why, the bell ringing from its tower when the enemy crosses the stream and cut short with a clang, the crane's creak while masons work high, the long gun's arc by the spotter's tower, the mortar's wind ring with it, the mason's eye on their castle only with it ("Build a spotter's tower to read their castle"; the Practice range and the guided match count it standing), order words for the Works and the tower, shot reports naming the organ. No new HUD element.
- Look: iron, the bell turned on a lathe and swinging while it rings, the treadwheel turning while masons work high, rope and hook, the mast's pennant and signal flag in the wind, the spotter with his glass, a ladder and railing, a scaffold while the tower rises, the Foundry's smoke heavier, the minimap's organ signs (red and struck through when down) and the tower's tile (`tools/machines-shots.mjs`).
- Tools: the observatory's lines carry each organ's time down, times down and state at 5:00 and the spotter's tower's first working tick; the report's Machines block; plans only on allowed plots, the price list and the openings with the tower; the dead-end hunt's organ hunts, the lost-orders hunt, `plots=full` (all eight built) and the reach check (every work spot and powder foot from the masons' yard); `tools/machines-chair.mjs`.

**Where it differs from the rules above (the master's readings).**

- The crane first, but not over everything: taking it before every keep near falling felled keeps in 11 of 12 Knight mirrors (with the crane down the masons rebuilt it while the keep's foot, low work they could mend, was cut). Rule 12 keeps its place while low work saves the structure; a tower whose cut is above 4 m waits for the crane.
- The mason's eye is earned for the AI too (the owner's answer was for the player): without its own spotter's tower it guesses its cut. A first version that cut at the lowest, middlemost point it could see cut better than the forecasts and felled keeps at 2:12.
- The garrison and the masons are not out in the field: they hear orders without the mast.
- The masons' order puts the Works after the gate; the chip is the fifth (Alt+5), after the keep.
- An organ's key piece stays a body over the budget, so a fallen bell lies where it fell.

**Versions and pins.** Sim `RULES_VERSION` 15 to 17 (16 is the banner rule and budget pass's, which landed first); `MATCH_RULES_VERSION` 12 to 13; `NET_VERSION` 8 to 10 (9 is the budget pass's). Every pin re-pinned once, on purpose, on the merged tree, from the budget pass's: `SESSION_HASH` d3ff0550 / c66f5981 to fe162884 / 15845c5a; `MATCH_HASH` a7364f00 / fc688485 to 47057381 / 12aa4b9a (the first shell brings the enemy's signal mast down and the keep falls sooner: its script written again by `keep-script.ts`, 27 shots, won at tick 4664); `WAVE_MATCH_HASH` b02228d7 / 5a2a698e to cb47b7bb / 822adf78 (the player loses no pikemen now: the wave match asks only that the enemy does); `ESTATE_MATCH_HASH` 3267f17b / 95030043 to 464b61f8 / c7da83eb; `AI_MATCH_HASH` 1dd8fd0f / 954f86a5 to 22503ef7 / 7754d82f; `GUIDED_MATCH_HASH` 7205cccc / f78d73bb to 00ddc356 / 5d5de20b. The lab's 35a7603f / 054e5eb0 unchanged.

**The observatory.** The quick run (`machines-final`, 24 of 24, 3 workers on a machine shared with tests and hunts) against the budget pass's (`after-quick`):

| Target | Budget pass | 3.5 | Pass |
| --- | --- | --- | --- |
| T1 Length | median 6.2 min; 58% between 6 and 16 | median 7.5 min; 75% between 6 and 16 | FAIL |
| T2 Endings | felled 33%, floors 33%, storm 33% | felled 42%, floors 33%, storm 25% | FAIL (the keep 75%) |
| T4 Skill | Warlord beats Knight 92% | 83% | PASS |
| T5 Spending | 73.5 s | 124.5 s | FAIL |
| T7 Targets | keep 47% of 1119 | keep 39% of 1347 (floors 28%, cut 12%); bell 2%, crane 7%, mast 1% | PASS |
| T8 Comebacks | 5 of 12 | 3 of 12 | PASS |
| T9 Budget, stones moving | p99 500 | p99 655 | FAIL |

Falls: a tower or keep toppled in 23 of 24; keep topples 13, tower topples 56. Magazines blown 67% (29% in the budget pass; 3.3's open item). The machines:

- The bell went down in 23 of 24 matches, 242 s at the median (827 s at the longest); the crane in 24 of 24, 141 s (732 s); the mast in 23 of 24, 225 s (887 s). Most falls are not aimed (2% to 7% of hand shots go at them): the bell and the mast come down with the tower top and the keep's roof under them, and wait for those.
- Down at 5:00 on one side only, that side won: the bell 1 of 7, the crane 2 of 10, the mast 1 of 9 (often both sides' are down: 12, 8 and 11 matches).
- The spotter's tower worked for 44 of 48 sides, first at 3:20 at the median.

Runs before the last fixes (the reasons above): `machines-quick-1-precut` (8 matches), `machines-quick-2-precrane` (4), `machines-quick-3` (24, keeps felled in 11 of 12 Knight mirrors).

**The dead-end hunt** (Knight against Knight, seeds 21 and 22, and seed 21 with `plots=full`), on the final tree: no organ hunt fires (no organ down for 120 s with masons free, gold and no enemy near, none waiting on its footing for 240 s), no order lost with the mast down (937 men mustered, 635 with it down), every work spot and powder foot reached on foot in both layouts (450 of 450), the crane's, bell's and mast's static checks pass. What the hunt found on the way, and fixed: the crane never rebuilt while rule 12 kept the masons on towers (2 minutes down and more), a garrison man on an old order with the mast down, men standing for good in a crater by their own gate. Still flagged, older hunts: towers holding under 0.3 for 2 minutes and pieces down for 3 minutes with rubble in their place (many with the crane down), guns waiting on their masonry, gold piling up, and in seed 22 musketeers of the Push wave standing on a blocked cell at their own gate (not looked into).

**The player's chair** (`tools/machines-chair.mjs`, a Versus match against the Knight, stepped): the build menu shows eight plots with 7 and 8 behind the keep and the Spotter's Tower on "Plots 5 to 8"; holding C on their keep with no tower says "Build a spotter's tower to read their castle"; Alt+5 says "Works repairs off" and on; through the match the notes read "Your crane is down: masons build only the lowest 4 m", "Your crane is back", "Your bell is down: your guns fire late", "The bell waits for its tower", "The signal mast waits for the keep's roof". Stills from C1's shots tool: the bell on its tower near and far, ringing; the treadwheel and hook; the mast's flags; the spotter on his platform; the minimap's signs.

**Checks** on the merged tree: `npm run check` 573 of 573; `npm run check:browser` (Chromium equals Node on every pin); `node tools/guided-check.mjs` all passed (77; the guided match counts your spotter's tower as standing, so the coach's "hold C on their keep" still shows the eye); `node tools/sound-check.mjs` passed (the bell, the bell cut short, the crane's creak); `node tools/online-check.mjs` passed once its marks moved between the bridges (with no spotter's tower only the marking long gun fires for effect, and by the centre bridge it holds its fire); `node tools/hud-check.mjs` 169 of 170 on a shared machine (the miss, "P pauses (the badge shows)", is a timing step: "P resumes" passed right after it).

**For the owner (answered November 15).** The bell's 20 m stays. The mason's eye on the enemy's castle is earned by your spotter's tower (and the AI's by its own).

**Open.** T5 worse (124.5 s: gold piles up while high work waits for the crane); T9's p99 of stones moving 655 against 600 (more towers fall and matches run longer; not traced); the bell and mast down most of a match once their footing falls (the number to soften is how fast masons put a tower top and the keep's roof back, or the 20 m); the observatory's price list not run for the spotter's tower and the organs; the bell swings along its beam, side to side as the far castle sees it, so that it reads from there; a real bell swings across the beam.

