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

Not started.
