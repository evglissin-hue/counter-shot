# 3.12 Sieges for one

## Goal

Play for five minutes alone: a fort, a battery, a wind, and the fewest shots. The Master Gunner's exam teaches every trick in fifty puzzles; the Daily Siege gives everyone the same fort each day; and a shot can be taken back.

## Why

A match asks for fifteen minutes and an opponent. Much of what phase 3 builds (reading a structure, skipping a ball, setting off a magazine) is a pleasure by itself and is learned fastest in small doses. It also needs the piece of groundwork that later ideas rest on: a castle described as data.

## Rules

### Forts as data

1. A **fort** is a list of parts with places: runs of wall, round towers, a keep with its options, a gatehouse, timber buildings, organs, props. `buildFort(spec)` turns one into a layout: stones, ids and the neighbour graph, by the same pass over stones' bounds that `buildLayout` runs today.
2. The game's castle becomes a fort, "the Ashwright square", and must come out stone for stone as `oneCastle` makes it now (a test compares the two, so no hash moves).
3. Forts live in `packages/content/src/forts/`. A fort has a budget: 5,000 pieces at most (the Ashwright square has about 4,980 with its buildings laid out).

### Siege mode

4. One player, no enemy castle of their own. Your battery stands where your castle's guns stand; across the valley stands the fort.
5. A siege gives: the guns you have, a powder allowance, the wind (fixed, or changing by its seed), the part of day, and what counts as done: the banner down, or a named thing (the magazine blown, the tower dropped on the barracks, the wave stopped before the bridge).
6. A fort may have masons, a garrison and guns that fire back at your battery, or none; the siege says which.
7. **Score**: shots, then powder, then time. Stars against the siege's par.
8. Scatter is drawn from the siege's own seed and the shot's number, so the same shots give the same result every try.

### The Master Gunner's exam

9. Fifty sieges in five chapters of ten:
   - reading masonry (what holds it up, which way it falls);
   - lobbing (the charge, the wind, the fuse);
   - banks and skips;
   - fire, smoke and powder;
   - all of it at once, with men in the field.
10. A chapter opens when six of the one before are passed. Three stars each. The guided match stays the way into matches; the exam is offered beside the Practice range.

### The Daily Siege

11. The date seeds one siege a day: a fort drawn from a handful of families (the square, a great tower in a long curtain, twin towers at a gate, a bridge fort), its size, the wind, the allowance.
12. Fewest shots wins. Your best is kept on the device.
13. A result is the day and the list of shots. Anyone's result can be checked by running it. A shared board stores results in that form. Whether the game's page can keep one where it is hosted now is for the builder to find out (the artifact's database, read through the artifact capabilities skill); if not, the board waits for a host of our own and the day's best stays local.
14. A line to copy: "Keepfall, day 123: banner down in 4 shots, 31 powder."

### Rewind

15. In siege mode and on the Practice range, Backspace takes back your last shot: the world is built again from its seed and the log of inputs (track S, step S6) is run up to that shot, at full speed, behind a moment of smoke.
16. Never in a match.

## Data and code

- `packages/content`: `forts/` (the parts, `buildFort`, the Ashwright square, the exam's forts, the daily's families) and `sieges.ts` (each siege: fort, battery, allowance, wind, goal, par).
- `packages/rules`: a `Siege` beside `Match`, wrapping the same world: one team, a goal checked each tick, a score. Deterministic and pinned: two exam sieges replay to pinned hashes in Node and in Chromium.
- `apps/game`: the modes, the chapter list, the day's card, the stars, the copy line.
- No change to a match: the match's pinned hashes hold.

## The AI

- No opponent. But every siege must be shown to be possible: a script plays each with the AI gunner's hand at Warlord level and must finish inside the allowance on three seeds. Par comes from its best.

## The page

- A chapter page of ten cards with stars. A siege opens on a slow look round the fort, then your sight.
- The mason's eye and the rounds a siege allows are part of each siege's lesson; a line says what is being taught.
- The day's siege has its own card on the start menu with your best.

## Tests and measures

- The Ashwright square equals today's castle, stone for stone.
- A siege's result is the same on every run of the same shots.
- Every exam siege passes the script.
- Rewind returns the world to the tick before the shot (hashes equal).
- From play: how many stars each siege earns on a first day; where people stop.

## Dead ends to hunt

- A siege that cannot be finished with what it gives: the script is the hunt.
- A day's fort the generator makes that cannot be finished: the same script runs on each new day's seed before it is offered, on the device, or the day falls back to the next seed.

## Try

Take the first chapter. Find the stone that drops the tower on the barracks in two shots. Play today's siege, then take back your worst shot on the Practice range.

## For the owner

- Should the exam be open from the first launch, or only after the guided match?

## Status

Not started.
