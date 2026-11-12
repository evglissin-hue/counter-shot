# 3.8 The day

## Goal

Every match runs through one day: fog at dawn, a clear day, a wet and windy dusk, and night. Each part changes what a good shot and a good plan are, the match has an arc you can see, and night ends it. This replaces sudden death.

## Why

A match has no shape today: minute two plays like minute ten, and the end is forced by doubling income and speeding reloads at 15:00, then by calling time at 25:00. Weather can do the same work with meaning. It also uses what 3.2 and 3.7 built: marks let you fire where you cannot see, rain makes mud, and the dark makes fire the only light.

## Rules

Numbers live in a new `DAY` in `packages/content`, per map. Both sides share one clock.

| Part | When (start numbers) | What changes |
|---|---|---|
| Dawn | 0:00 to 3:00 | Fog: nothing is seen clearly past 70 m. Wind light (3 m/s at most). |
| Day | 3:00 to 9:00 | Clear. Wind as today. |
| Dusk | 9:00 to 13:00 | Rain and a gale. Wind up to 1.6 times as strong, gusts stronger. |
| Night | 13:00 on | Dark. Seen only: what burns, what flashes, what a light reaches. |

1. **Fog (dawn).**
   - Guns nobody mans engage within 40 m only, unless on marked ground.
   - You see the far castle as a shape. Your landing marker shows only for landings within 70 m; beyond that you hear the shot land and may still mark it (the mark's radius is half again as wide).
   - The AI's first error on a target past 70 m is doubled.
   So dawn is for building, for ranging by ear, and for the first meetings at the bridges.
2. **Rain (dusk).**
   - The ground wets (3.7): mud grows on the roads, balls stop skipping, wheels bog.
   - Fire spreads and lights at half its rate. Smoke thins twice as fast.
   - Every reload takes 1.15 times as long.
3. **Night.**
   - **Nothing is mended in the dark.** Masons stop laying stones (they still carry water). What falls stays down, so the match must end.
   - Guns nobody mans engage only men who are lit or on marked ground.
   - You see by fire, by muzzle flashes, by the braziers on each castle's walls, and by a **light ball** (a mortar round, 4 charges): it lights 40 m around where it lands for 30 s.
   - Marks made in daylight still serve, which is the reward for ranging early.
4. **Light.** A place is lit when it lies within reach of a fire, a brazier, a burst (for 2 s), a flash (for half a second) or a light ball. The rules ask one function whether a point is lit; the page draws from the same sources.
5. **Time is still called at 25:00** (first light): the higher banner wins, as now.
6. **Sudden death goes**: no doubled income, no faster reloads.
7. **The same for both, on every machine.** Lightning at dusk is for the eye and ear only; its moments come from the match's seed.
8. **Modes.** The Practice range has a list to choose the part of day. The guided match plays a long clear day and ends at dusk's first rain if it is still going.

## Data and code

- `packages/content`: `DAY` (the parts and their numbers).
- `packages/sim`: a `Day` module gives, by tick: the part, sight range, the wind's scale (read by `wind.ts`), rain, and "is this point lit". Bump `RULES_VERSION`.
- `packages/rules`: `gunnery` and musketeers ask sight and light; `works` asks whether stones may be laid; reload scale; the light ball round; sudden death removed. Bump `MATCH_RULES_VERSION`.
- The AI's view (`view.ts`) is cut to what its side could see, so it is as blind in fog and dark as a player.
- `MatchInfo` gains the part of day and what comes next, and when.

## The AI

- At dawn the Knight and the Warlord range their marks and build; they hold their great pushes for the day or the dark.
- At dusk they stop counting on skipping shot and on rams.
- At night the Warlord keeps light balls for its own push and fires for effect on marks it made by day.

## The page

- The sky, the sun and moon, fog that lies thickest in the stream's hollow, rain and wet stone, lightning, braziers, night by firelight (track L, round L4, is built with this milestone).
- The match bar's clock becomes a strip of the day's four parts with a hand, so the arc is read at a glance; a note before each change ("Rain within the minute").
- Fog, rain and dark hide the same on every tier.

## Tests and measures

- Each part's rules switch on its tick, on both machines of a lockstep test.
- At night a stone is not laid; at dawn it is.
- A light ball lights its ground; a gun nobody mans then fires there.
- The AI does not shoot what it could not see.
- Observatory: T1 (aim: 95% of matches over by 20:00); endings by part of day; storms by night.

## Dead ends to hunt

- A night in which neither side can hurt the other (no fire, no marks, no light balls): the brazier light at each gate and the cellar's powder keep a way.
- A match decided by fog alone in the first three minutes (a wave nobody could see): the bell still rings.

## Try

Range the bridges in the fog by ear. Fell a tower at noon. Watch your skipping shot die in the rain. Fire for effect in the dark on a mark you made by day, then light their courtyard and send your waves.

## For the owner

- How long should a day be? The start numbers aim the middle of a match at about eleven minutes.

## Status

Not started.
