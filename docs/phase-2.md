# Phase 2: a full match versus the AI (draft for review)

Goal: one player against an AI castle in a full 10 to 15 minute match. Both castles earn gold, build on plots, buy and upgrade weapons, repair, and train waves that march along routes physics can open and close. A match is won by toppling the enemy keep or storming its courtyard, and a guided first match teaches all of it. Every action that changes the match is an input tagged with its tick and runs in the deterministic sim, so phase 3 (online 1v1) inherits it unchanged.

Before phase 2 starts: both laptops play the phase 1 sandbox, and ideally the browser hash page is opened in Safari and Firefox.

Each milestone ends with the checks green, a commit and push, and a playable build at the same artifact link, with a short note to the owner on what to try.

## Layout

```
packages/
  core/      @keepfall/core     unchanged
  content/   @keepfall/content  + the map, buildings, minions, upgrades, the AI's plans, as data
  sim/       @keepfall/sim      + map terrain, bridges, the nav grid and flow fields, minion steering and combat
  rules/     @keepfall/rules    new: the match (gold, plots and buildings, upgrades, repairs, waves, orders, winning)
  ai/        @keepfall/ai       new: the AI player; it reads the match and sends inputs, like a person
apps/
  game/      @keepfall/game     the sandbox grows into the game: a start menu with Practice range, Versus AI and the guided match
```

- Direction: core <- content <- sim <- rules <- ai <- apps. The boundary check gets the two new packages, with the same determinism rules as sim.
- `rules` owns the match: whose stone is whose, gold, timers, what a building does, when a wave leaves, who has won. `sim` owns bodies and movement: masonry, projectiles, terrain, minion bodies, the nav grid. The split keeps the physics testable on its own, as now.
- The AI produces the same inputs a player does (fire with an exact aim, build, upgrade, order). It runs in the worker with its own Rng stream, so a match against it replays from its inputs like any other.
- The sandbox folder becomes `apps/game` in M1 and keeps the sandbox as its Practice range. The artifact link stays the same.

## Determinism and tests

- Same rules as phase 1: fixed 60 Hz ticks, detmath only, ordered iteration, inputs tagged with ticks, no wall-clock time. `RULES_VERSION` goes up whenever the same inputs play out differently.
- Flow fields use integer costs and a fixed-order queue, and recompute on a fixed tick schedule: a few fields per tick, the same on a fast machine and a slow one.
- Node tests pin the hash of a scripted match session per milestone; from M5, an AI against AI match replays to a pinned hash, and headless Chromium must match Node bit for bit (`npm run check:browser`).
- The lab's reference hash (35a7603f / 054e5eb0) stays valid throughout.

## Budget

Kat's laptop (Apple M3) is the floor: about 550 moving stones in 6 ms. Upright minions are kinematic capsules (cheap) and only become ragdolls when hit; ragdolls freeze once settled. With 60 to 100 minions per side at the peak, active ragdolls are capped (the oldest freeze early), and a match's worst moments (a wave under a collapsing tower) are timed on both laptops in M5.

## Milestones

### M1. The battlefield (open: a match page with a real valley)

- Map v2, from a seed and mirrored: a wider valley (about 160 m across, castles still 150 m apart) with a central road and two flank paths between low ridges, and a stream across the middle crossed by three timber bridges. Bridges are physics pieces like masonry: blow one and it falls into the stream.
- The sim's terrain follows the map (the height grid grows to cover it), and the renderer draws the same heights, the stream and the bridges.
- `@keepfall/rules`: a match wraps the sim with two castles and two teams, a match clock, keep income ticking up, the keep win (the banner falls) and an end screen.
- The nav grid: walkable cells from slope, water, intact bridge decks, standing masonry and settled rubble (step up to about 0.6 m), shown as a debug overlay.
- A start menu: Practice range (today's sandbox) and Versus AI (an empty enemy castle for now).
- Try: look over the new valley in the overview; drop a mortar shell on a bridge and watch it go into the stream (the overlay shows the route closing); topple the keep and get the victory screen.

### M2. Waves (open: minions march and fight)

- Barracks (pre-built in M2) send a wave every 25 seconds. Pikemen follow flow fields along their route to the enemy gate, keep spacing in loose ranks, step over small rubble and walk around big piles. Fields update as craters, rubble and blown bridges change the ground.
- Contact combat: pikemen fight when they meet; a blow knocks the loser down (a ragdoll), with odds per unit type from the seeded Rng. Pikemen at a closed gate batter it until its leaves come loose.
- Orders by hotkey for all your waves: Advance (Ctrl+1), Hold at the midfield marker (Ctrl+2), Push the breach (Ctrl+3, to the nearest walkable gap in the enemy walls). Each barracks has a route: left, centre or right.
- Unmanned weapons fire at minions on their own: slower and much less accurate than you.
- Try: watch the waves meet at the bridges; blow the centre bridge as a wave crosses and see the next one reroute; open a breach with the long gun and order Push the breach.

### M3. Gold and building (open: run a castle)

- Gold from the keep, Powder Mills, kill bounties, enemy masonry you bring down, and trick shots (ricochet kill, collapse kill, multi-kill, long-range keep hit), shown as they happen.
- Plots (6 to 8 in each courtyard) and the build wheel (B, or click a plot in the overview): Barracks, Powder Mill, Foundry, Signal Tower. Buildings are physics structures that rise over 10 to 20 seconds and stop working when knocked down.
- Emplacements (6 to 8 on walls and towers): buy a weapon for an empty slot, upgrade it at the Foundry. Upgrades are trade-offs (a heavier ball breaches more but drops faster; a rifled barrel is tighter but reloads slower).
- The rest of the Ashwright roster: sappers carry powder kegs to the walls and blow a breach (shoot the keg on the way and it blows up among their own wave), and musketeers shoot enemy minions from range. Each barracks sets its wave's mix.
- Try: build a second barracks and a mill; buy a second mortar; shoot a sapper's keg in the middle of its wave.

### M4. Repairs and storming (open: both ways to win)

- Repairs: masons rebuild destroyed sections for gold, bottom course first, wherever the space is clear; rubble is carried back into the wall. Auto-repair can be switched on per section (walls, towers, gate, keep).
- Storm the courtyard: your minions hold the enemy courtyard for 20 seconds while outnumbering the defenders inside. Sudden death at 15 minutes (income doubles, reloads speed up). Surrender. An end screen with what happened (gold, kills, masonry, trick shots).
- Ladder crews: they carry ladders to intact walls and climb over.
- Try: lose your gate and repair it under fire; storm the enemy courtyard with a big wave through a breach.

### M5. The AI castle (open: a full match)

- The AI plays by the same rules: it builds from a plan in data, fires every weapon through the same turn limits and reloads (aiming by the same flight prediction as the aim help, plus error), sends waves and gives orders, and repairs. Three difficulties: Squire, Knight and Warlord (aim error, reaction time, how well it spends).
- An AI against AI match replays to a pinned hash in Node, and in headless Chromium.
- Performance pass on both laptops: the worst moments of a full match stay inside the physics budget.
- Try: full matches on Squire and Knight on both laptops.

### M6. The guided first match (open: the release candidate)

- The Practice range gains a short guided first match: prompts and highlights walk you through the long gun, the mortar, building a barracks, sending and ordering a wave, and defending against a passive AI that slowly wakes up, through to a win.
- Match HUD: gold, the next wave's timer, a threat strip (what is coming down which route), marks in the overview.
- Sound for marching, fighting, building and repairs.
- Try: Kat plays the guided match cold, with no explanation.

## Not in phase 2

Online play (phase 3), Graniteborn and landslides (phase 4), co-op (phase 5), kill cams and replays of the best moments (phase 6; the match keeps its inputs from M1, so they stay possible), random maps (one seeded map for now), the castle designer, fire on timber, 2v2.

## Questions for the owner

1. The sandbox becomes the game page (`apps/game`) with a start menu, at the same artifact link. Fine?
2. One map for phase 2: a valley with a road, two flank paths and a stream with three bridges. Is that the right first battlefield, or do you have a picture in mind?
3. Abilities (the Signal Tower's Barrage, Smoke screen and Powder trail) are not in the phase 2 list in the spec. Add them in M4, or leave them for later?
4. A mortar shell on the keep's roof can bring the banner down in one shot today. In a match that is an instant win. Should the keep get a timber roof that takes the first hits, a sturdier top, or should it stay a rare skill shot?
5. Do fallen minions stay on the field all match (as frozen debris that shapes the routes) or clear away after a minute?
