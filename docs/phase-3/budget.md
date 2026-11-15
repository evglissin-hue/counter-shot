# The banner rule and the budget pass (after 3.4 and the army pass)

## Why

Two things left open by 3.4 (see the Status of `04-keep.md`):

- **A dead end in the rules.** Since 3.4 a toppled keep whose banner comes to rest on its own rubble above 3.5 m did not end the match: it ran on to 25:00. The match was decided by where the banner happened to land.
- **T9 failed.** The p99 of the most stones moving in a match was 1,229 (3.4's quick run; 1,005 in this pass's baseline), against the 600 aimed for. A keep or tower falling alone stays well under it; in a match the fall breaks and wakes what it lands on, and mortar bursts thaw whole heaps of settled rubble.

## The banner rule

`CastleSim.step`'s win check (sim rules 16). With keep floors, a banner is down when its centre falls below `bannerFallY` (3.5 m, as before), or, once no storey board of its keep is still tipping, when the banner is off its keep:

- its centre is outside the keep's footprint (`CASTLE_SHAPE.keepHalf` plus 0.5 m), or
- no storey board of its keep still stands (not loose) with its top at or below the banner's centre plus 0.25 m.

So a keep felled from its foot ends the match the step its part is let go (not when it starts to tip, so the last blow's clip still shows the fall), however its banner lands: high on rubble, on a heap, caught on a wall. A crush ends it as soon as the floors are loose. A keep cut higher up, whose banner lands on a floor still standing in the stump, goes on, as rule 9 of `04-keep.md` says. The lab (no floors) is unchanged.

Tests: `packages/sim/test/banner.test.ts` (7): an untouched castle is not down; a foot topple with the banner held outside the footprint at 7 m and inside it at 5 m is not down while the storeys tip and down the step after release; a higher fall with the banner at 8 m outside the footprint is down at release; the same fall with the banner on the standing 7 m storey is not down for 20 s; the top storey dusted (banner at 13.75 m on the next floor) is not down; the lab layout with no floors.

Dead-end hunt (`packages/ai/scripts/dead-ends.ts`), two new hunts: a keep that fell (Topple or Crush) from below its lowest storey with no result 10 s later; a keep with under 25% of its own masonry standing for 60 s while the match goes on.

Left as it is: if every storey board of a keep were knocked loose while its walls stood, its banner on the walls would count as down. Shot can reach the top floor only; the lower floors sit inside the walls.

## The budget

`BUDGET = { moving: 440, minFallBodies: 60 }` in `packages/content/src/structure.ts` (in `TUNING_ROOTS`). The game's worlds pass `budget: BUDGET.moving` to `CastleSim` (`sandbox.ts`, next to `settle`); the lab passes nothing, so its reference hash is unchanged. `CastleSim.room()` is the budget less what moves (as of the last step, plus the kinematic pieces of a tipping part, plus pieces woken since).

- **Loose masonry over the budget turns to dust.** With no room, a piece that comes loose (a blast, a support cascade) is shattered instead: dust and chips on the page, out of the physics. Never a storey board, a banner or a gate leaf.
- **Settled rubble stays settled when struck over the budget.** A strike thaws the frozen rubble nearest first and only while there is room (it used to thaw every frozen piece in reach).
- **A burst pulverises the heart of a heap.** A shell bursting among rubble turns the rubble within its shatter core (0.45 of its radius) to dust instead of waking and throwing it; the rest is thrown as before. Never a banner, a storey board or a piece of a falling part.
- **A fall keeps fewer bodies in a busy world.** A keep keeps up to 300 bodies and a tower 120 (as in 3.4), but never more than the room, and never fewer than 60; the rest are brittle ghosts.
- **A fall wakes only what lies on it.** When a part starts to tip, only the frozen rubble resting on its pieces (and what rests on that, two layers) wakes, not every frozen piece in its box above the hinge (about 330 stones woken for nothing in a traced tower fall). Over the budget, rubble resting on the part turns to dust rather than hang in the air.

Unchanged: the settle thresholds (0.2 m/s, 0.5 rad/s for 60 steps), sleeping, a storey board giving way waking all that lies over it, dust and chips at a ghost's first touch.

Why 440 and not 550 (what the M3 handles in 6 ms): the count overshoots the budget by what it cannot see, sleeping rubble woken by contact and a fall that starts in a full world keeping its 60 bodies. At 480 AI matches peaked at 527 and 624; at 440 the highest seen is 461.

Tests: `packages/sim/test/budget.test.ts` (7): several falls at once stay within the budget plus 100 and turn the rest to dust; with no room masonry turns to dust and storey boards and gate leaves do not; with no budget nothing turns to dust for lack of room; a strike on frozen rubble wakes the nearest pieces only while there is room; a burst in a frozen heap dusts its core and throws the rest; a toppling tower wakes the rubble on it and leaves rubble beside its foot frozen; rubble on a moving part beyond the room turns to dust.

Not changed, left as levers: stiffer towers, towers judged with their curtain walls (towers still topple about 2.2 times a match), merging rubble.

## Measures, before and after

**The observatory's quick run** (24 matches: 12 Knight mirrors, 6 Warlord against Knight each way). Before: `base-quick` on the integration branch at 561d04e, played while two executors were testing (load 12 on 4 cores), so its step times mean nothing. After: `after-quick` on this branch, 3 workers on a quiet machine.

| Target | Before | After | Pass |
| --- | --- | --- | --- |
| T1 Length | median 6.4 min; 50% between 6 and 16; 0% by time | median 6.2 min; 58% between 6 and 16; 0% by time | FAIL |
| T2 Endings | felled 25%, floors 42%, storm 33% | felled 33%, floors 33%, storm 33% | FAIL (the keep 67%) |
| T4 Skill | Warlord beats Knight 92% | 92% | PASS |
| T5 Spending | 65.0 s | 73.5 s | FAIL |
| T7 Targets | keep 44% of 1116 | keep 47% of 1119 | PASS |
| T8 Comebacks | the side behind won 3 of 12 | 5 of 12 | PASS, then FAIL (n 12) |
| T9 Budget, stones moving | p99 1,005 | p99 500 | PASS |
| T9 Budget, worst step | 7,443 ms (a loaded machine) | 142 ms (3 workers on 4 cores) | see below |

Falls: a tower or keep toppled in 24 of 24 matches both times; keep topples 10 then 12, tower topples 55 then 53. Magazines blown: 58% then 29% (3.3's open item; not tuned here, the change is the physics diverging).

**Single matches** (`packages/ai/scripts/budget-peaks.ts`: what moves, by where it came from), most stones moving:

| Knight mirror | Before | After |
| --- | --- | --- |
| seed 1 | 591 (keep fall: 311 of its own, 135 woken, 145 newly loose) | 461 |
| seed 2 | 514 (a tower's support cascade: 359 newly loose) | 454 |
| seed 3 | 631 (woken 348) | 433 |
| seed 4 | 615 (a tower: 328 woken, mostly by bursts in heaps) | 440 |

**The worst step.** Played one at a time on this machine (Intel Xeon at 2.1 GHz, Node 22), the whole match step: seed 1 32.8 ms before, 45.0 ms after; seed 2 38.4 then 36.1 ms; seed 4 48.3 then 40.5 ms (a dead-end hunt ran on another core during these). The mean step is 6 to 10 ms, nearly all of it Rapier's own world step; the slow steps are Rapier's step with 300 to 450 bodies awake (20 to 30 ms here) plus up to 10 ms of the minions' and specialists' contacts after it. With four matches at once on four cores, steps of 40 to 80 ms come with as few as 1 to 6 bodies awake: contention, not the game. So the budget did not lower the worst step on this machine; it bounds what drives it. Whether T9's 33 ms holds on the reference M3 (550 moving in 6 ms) needs a run there: `npm run observe:quick` and the report.

A keep or tower falling alone (`packages/sim/scripts/topple.ts`, a quiet machine): unchanged in what moves (365, 152 and 373 bodies for a keep toppled, a tower toppled, a keep crushed), each under the budget alone; worst step 24.8 then 21.4 ms, 10.4 then 16.5 ms, 15.4 then 13.9 ms. The banner rule shows here: the toppled keep's banner is down at 2.77 s (its release) instead of 4.58 s, the crushed keep's at 0.53 s instead of 2.47 s.

**Dead-end hunt** (12 minutes each): Knight mirrors on seeds 21, 22, 23 (won by storm at 10:15, the keep at 10:49, the keep at 10:06) and Knight against Warlord on seed 21 (the Warlord by storm at 4:18): 22, 22, 4 and 2 flags. Neither new keep hunt fired. The rest are kinds seen before, and as many on the integration branch (seed 22 there: 19 flags in 12:00, no result): guns waiting for their masonry, slots that cannot be bought, towers holding under 0.3 for two minutes, a piece whose place holds rubble for three minutes while its masons work elsewhere, gold piling up late.

## The player's chair

`tools/keep-shots.mjs` (Practice, WebGL2 Low, 1280x720), before on the integration branch and after on this branch, looked at side by side. The keep cut through its gateway still groans, leans towards the gate as one piece, goes down into its great cloud and leaves the same field of dust and a stump behind the curtain wall; the tower cut on its outer side still falls in a rolling front of dust off the curtain wall with the impact cam on it. No piece hangs in the air and no hole of missing rubble shows where the budget turned stones to dust: in a fall alone the world is under the budget, and in a match the dust it makes is the same puffs and chips a shot leaves. The page's step at the fall (its stats): 8.97 ms on average and 24.2 ms at worst after, against 12.3 and 39.7 ms before, with the same 275 bodies awake (software rendering, frames about a second each, so frame times say nothing here).

## Checks

On the final tree: `npm run check` 534 of 534; `check:browser` (Chromium replays every pin to Node's bits, the keep match won at tick 5325); `online-check`, `guided-check` and `sound-check` pass; `hud-check` passes (143 of 143; a first run missed "P pauses" once on this slow machine, the next passed).

## Versions and hashes

Sim `RULES_VERSION` 15 to 16 (the banner rule and the budget); `MATCH_RULES_VERSION` 12 unchanged; `NET_VERSION` 8 to 9. Every match hash re-pinned once, on purpose:

| Pin | Before | After |
| --- | --- | --- |
| `SESSION_HASH` | 29af82af / 3ca45276 | d3ff0550 / c66f5981 |
| `MATCH_HASH` | 29bc6f70 / 52725556 | a7364f00 / fc688485 |
| `WAVE_MATCH_HASH` | b02228d7 / ec86aec6 | b02228d7 / 5a2a698e |
| `ESTATE_MATCH_HASH` | 3267f17b / cebf40a6 | 3267f17b / 95030043 |
| `AI_MATCH_HASH` | 2d50c56c / 128ff60f | 1dd8fd0f / 954f86a5 |
| `GUIDED_MATCH_HASH` | 04fe0546 / 3bab6da8 | 7205cccc / f78d73bb |

The keep match's script was written again (`packages/rules/scripts/keep-script.ts`): 30 shots, won at tick 5325 (was 6045 and after); its test's window runs from the last shot at 5085 to the refused one at 5400, `MATCH_TICKS` 5500. The lab's 35a7603f / 054e5eb0 unchanged.

## Open

- T9's worst step on the reference M3 (see above). If it fails there, the levers are a lower `BUDGET.moving`, towers that topple less (stiffer towers, or towers judged with their curtain walls), and spreading a fall's claim over several steps.
- T1 (median 6.2 min), T2 (the keep 67%) and T5 still fail; this pass did not aim at them.
