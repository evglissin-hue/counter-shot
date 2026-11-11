# 3.1 The observatory

## Goal

A tool that plays hundreds to thousands of AI matches, reports them against the targets in `docs/phase-3.md`, searches for dominant build orders and prices what gold buys. Every later milestone is tuned with it. No gameplay changes: every pinned hash holds.

## Why

Balance has been tuned by hand from a few matches at a time, and each pass traded one extreme for another (see the review in `docs/phase-3.md`). The pieces for measuring exist already: the sim runs faster than real time in Node, the AI plays through inputs, and `packages/ai/scripts/duel.ts` and `dead-ends.ts` run single matches. On the cloud machine used for the review, a match ran at 1.5 to 2.9 times real time per core with three or four running at once: about 190 ten-minute matches a night on its 4 cores. Thousands a night need about 16 cores or the owner's Mac (the handoff already lists running long simulations there).

## Rules

1. **A run** is a matrix: pairings of levels (and later of plans), seeds, and variants. Each match runs to its result or to time, in its own worker thread.
2. **One line per match** (JSON lines, git-ignored under `tools/.observatory/<run>/matches.jsonl`):
   - the setup: seed, both levels and plans, the variant, both rules versions;
   - the result: winner, reason, tick, the final match hash (so any line can be reproduced);
   - a sample every 30 s: gold, gold spent, plots, banner floors, masonry down, men standing and fallen, the storm meters, guns out, stones moving, the worst step in the window;
   - totals: shots by hand by kind of target (the gunner's `Aim` keys: keep, crowd, breach, raid, masons, gun), shots by guns nobody mans, the build order as it happened (tick and step), seconds with unspent gold above 400, trick shots, the most stones moving, the worst step.
3. **A variant** is a list of changes to content by path (`"WEAPONS.mortar.reload": 600`), applied by a new `applyTuning()` before the match is built. Worker threads each load their own copy of content, so variants never leak into each other. `armedWeapon()` caches, so tuning is applied before the first use. Tuning is for tools only: the game page never calls it, and a variant that proves out is written into content by hand with the versions bumped.
4. **The report** (`tools/.observatory/<run>/report.html`, one static file with inline SVG, plus `summary.json` and a short `summary.md` to paste into a Status): each target T1 to T9 with its value and pass or fail; the length histogram; endings by pairing; the win rate of castle 0; shots by kind of target; unspent gold over time; stones moving and worst steps. Charts follow the repo's HUD palette; no chart library.
5. **The quick run** (`npm run observe:quick`): 24 fixed matches (Knight against Knight on 12 seeds, Warlord against Knight on 6 from each castle), a few minutes on 4 cores. Every later milestone runs it in its quality check and pastes the summary into its Status.
6. **The opening search** (`npm run observe:openings`): build orders are `AiStep` lists already. Start from the three stock plans; mutate (swap two steps, change a building, move an `after`, change a mix or a route); score each candidate against a fixed panel on common seeds; keep the best; repeat for a set number of generations. It prints the best plans with their win rates and says whether T6 holds.
7. **The price list** (`npm run observe:prices`): for each thing gold buys (each building, gun and upgrade), paired runs of a plan with and without it on common seeds; the difference in win rate per 100 gold. The table goes into the report.
8. **Side bias first.** The first finding to settle is T3: 400 Knight mirror matches on today's `main`. If castle 0 wins outside 46% to 54%, find the cause before 3.2 (candidates: the order waves are sent in `Match.step`, the order of emplacements in `gunnery`, the wind's seed) and fix it under a rules version bump, or show it is noise.

## Data and code

- `packages/content/src/tuning.ts`: `applyTuning(changes)`, with a check that every path exists.
- `packages/ai/scripts/observe.ts` (bundled with rolldown like the other scripts): one match to one JSON line. `tools/observatory.mjs`: the worker pool, the matrix, resume after a stop. `tools/observatory-report.mjs`: the report.
- The gunner exposes a count of shots by `Aim` key; the match exposes the applied build steps. Read-only hooks: no pinned hash moves.
- `README.md` gains the commands.

## The AI

Unchanged. From 3.2 on, each milestone adds what the AI must do for the observatory to see that milestone.

## The page

Nothing. The report is a file.

## Tests and measures

- The same seed and variant give the same final hash twice (a Node test on a short match).
- `applyTuning` refuses a path that does not exist.
- The first full run on `main` reproduces the review: median near 4:35, about 87% by keep.
- Record matches an hour on the machine used.

## Dead ends to hunt

- A run that silently drops matches (a worker dies): the report says how many lines it expected and how many it has.

## Try

Open the first report. Read T1 to T9 for today's game. Change one number in a variant (the mortar's reload) and see T1 move.

## For the owner

- Where long runs happen: the cloud session's 4 cores (hundreds a night) or your Mac (several times faster).

## Status

Done (November 11). Branch `claude/phase3-observatory-runs`; the runs below are on the 3.1 code (commit fdcd7a1), on the cloud session's machine (Intel Xeon 2.1 GHz, 4 cpus, Node 22.23.4).

**What was built.** `applyTuning()` with path checks (`packages/content/src/tuning.ts`); one match to one JSON line (`packages/ai/scripts/observe.ts`, line format in `observe-line.ts`) with samples every 30 s, shots by hand by `Aim` key, shots by guns nobody mans, the build order as applied, unspent gold, stones moving and the worst step; the worker pool with presets and resume by setup id (`tools/observatory.mjs`, `npm run observe`, `observe:quick`); the report (`tools/observatory-report.mjs`: `report.html`, `summary.json`, `summary.md`, targets T1 to T9, lines expected against lines found); the opening search (`tools/observatory-openings.mjs`, `observe:openings`) and the price list (`tools/observatory-prices.mjs`, `observe:prices`). Read-only hooks only: no rules version and no pinned hash moved in 3.1 (session, keep, wave, estate, AI match and guided pins as they were; the lab's 35a7603f / 054e5eb0 kept).

**Matches an hour.** About 85 an hour on 4 workers for the quick run (each match about 1.7 times real time on its worker); 46 an hour on 3 workers for Knight mirrors.

**The quick run** (`quick-main`, 24 of 24):

| Target | Value | Pass |
| --- | --- | --- |
| T1 Length | median 5.2 min; 8% between 6 and 16; 0.0% by time (n 12) | FAIL |
| T2 Endings | keep 100% (n 12) | FAIL |
| T3 Sides | castle 0 won 7 of 12; too few to call | n/a |
| T4 Skill | Warlord beats Knight 83% (n 12) | PASS |
| T5 Spending | median unspent-gold time 38.0 s (48 sides) | n/a |
| T6 Openings | see below | FAIL |
| T7 Targets | keep takes 72% of 916 shots by hand | FAIL |
| T8 Comebacks | the side behind won 2 of 12 (17%) | FAIL |
| T9 Budget | p99 of most stones moving 768; worst step 225.7 ms; steps over 33 ms a match: median 50, most 271 (this machine, not the M3 reference) | FAIL |

**Side bias (T3), rule 8** (`side-main`): 400 Knight mirrors, 200 seeds from both castles. Castle 0 won 189, castle 1 won 211: 47.3% for castle 0, give or take 4.9 points. Inside 46% to 54%, so no rules change. Per side differences of the same matches (stones down, floors, men fallen, gold spent at 1 to 4 minutes, shots, gold earned, stones rebuilt) are all noise; castle 0 aims about one hand shot a match less at the keep (t = -3.1 among about 40 tests). The structural asymmetries found while tracing (route names in castle 1's frame, plots at the same world x for both castles, castle 1's waves and slots stepped first) are listed in `docs/plan.md` as the first suspects should a later run fall outside the band.

**Openings (T6)** (`openings-main`, 3 generations, 8 matches a plan against the stock Knight): FAIL. One plan within 5 points of the best (100.0), median 50, best minus median 50. The best is the Warlord's own build order with its second mill a minute later (mills, barracks left at 1:10, Foundry at 2:00 with the quick loader, mortar at 3:00): 8 of 8; the stock Warlord plan 7 of 8; the next 75.0 and 62.5. The early economy and Foundry beat the Knight's slower plan clearly; 3.3 (the economy) is where this is answered.

**Prices** (`prices-main`, 124 matches, the stock Knight plan with and without each item on 4 seeds from both castles):

| Item | Cost | With | Without | Diff | Per 100 gold |
| --- | --- | --- | --- | --- | --- |
| rifled | 140 | 62.5 | 25.0 | 37.5 | 26.8 |
| heavyShot | 140 | 50.0 | 25.0 | 25.0 | 17.9 |
| heavyShell | 140 | 50.0 | 37.5 | 12.5 | 8.9 |
| quickLoader | 140 | 50.0 | 37.5 | 12.5 | 8.9 |
| longBarrel | 140 | 62.5 | 50.0 | 12.5 | 8.9 |
| longGun | 220 | 50.0 | 37.5 | 12.5 | 5.7 |
| mill, foundry, mortar, longChain, heavyBalls | | 50.0 | 50.0 | 0 | 0 |
| barracks | 220 | 50.0 | 62.5 | -12.5 | -5.7 |
| chainShot | 160 | 50.0 | 62.5 | -12.5 | -7.8 |
| canister | 140 | 37.5 | 50.0 | -12.5 | -8.9 |
| swivel | 120 | 50.0 | 62.5 | -12.5 | -10.4 |

Eight matches a side make one match 12.5 points, so only the gun upgrades at the top (rifled, heavy shot) stand out; the rest is within one or two matches. A longer prices run (more seeds) is worth it before 3.3 prices anything.
