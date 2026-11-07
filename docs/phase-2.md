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

## Decisions (the owner's answers, November 7)

1. The sandbox became the game page (`apps/game`) with a start menu, at the same artifact link. (Default taken; say if not.)
2. The first map is the valley with a stream: a central road, two flank paths between low ridges, and a stream across the middle with three timber bridges.
3. Abilities (Barrage, Smoke screen, Powder trail) wait until after phase 2. (Default taken; the Signal Tower leaves the M3 build wheel until then.)
4. The keep gets timber floors inside: each shell caves in one level and the banner drops a floor at a time, so toppling it takes a siege.
5. Fallen minions stay on the field all match as frozen bodies (cover, ramps, blockages), with a cap: past a few hundred the oldest sink into the ground, so the physics budget holds on Kat's laptop. (For M2.)

## Status

### M1. The battlefield

- **Rules version 4.** The session hash and the lab's reference hash (35a7603f / 054e5eb0, unchanged) are pinned in Node; a scripted match is pinned too, and headless Chromium replays both bit for bit (`npm run check:browser`).
- **The keep's timber floors** (`GAME_LAYOUT`, `keepFloors`): board floors at 7 and 13.5 m under the 20 m roof, wider apart than a burst reaches. Storey boards break only under bursts and direct hits, not falling rubble; rubble lying on a board falls when it goes. A banner now touches only its keep's intact walls and floors, the ground and shots, and bursts no longer throw it: before, rubble thrown by a burst on the roof carried the light banner 50 m up and off the keep (the real one-shot). Three shells straight down the shaft bring it to the ground floor, which is what counts as toppled now. The lab keeps the old single platform.
- **The valley** (`packages/content/src/map.ts`): one deterministic height function, point symmetric about the middle of the field (each player sees the same valley from their own walls, left is left), shared by the physics and the renderer. Flat castle pads, the centre road with an S-bend, flank paths that sweep out to x = +-48, ridges with rocky crests between them, a meandering stream with a gravel bed and real banks that runs square across every route, gorges through the ridges and the valley sides, crags, knolls, hills behind both castles, swells and hummocks. The physics grid covers 192 by 266 m at 1 m (about 120 ms to compute, once, shared by every sim in the worker). The Practice range plays in the same valley.
- **Bridges**: three timber bridges (sills, a pier of two posts and a cap, stringers, a plank deck, railings: 187 pieces) built like masonry as a third support group after the two castles. Stringers fall as soon as either support goes (beams need both ends), so a shell in the middle drops the deck into the stream. Grounded pieces stand on the real ground under them, not on y = 0.
- **The nav grid** (`packages/sim/src/nav.ts`): a floor height and a kind per square metre (ground, raised, water, steep, blocked), from the ground, the water and every standing or settled piece: walls stack the floor up beyond a 0.6 m step, intact deck planks are floors over the water, anything 1.9 m overhead (the wall over a broken gate) leaves the way open. Refreshed four times a second for the cells around what changed (under 0.3 ms after two bursts). Tests: the stream blocks, bridges cross, closed gates keep you out, a blown bridge closes its crossing, all three cut the valley in two.
- **`@keepfall/rules`**: the match wraps the world with two teams, gold from each standing keep (5 a second, 150 to start), the clock and the result (the other team wins when a banner falls; a draw if both fall on one tick). Inputs carry team and tick and are judged on that tick: own emplacements only, loaded only, nothing after the end.
- **The page**: a start menu (Practice range, Versus AI), the match bar (clock, gold), a note when a bridge goes down, the end screen a moment after a keep falls (time, masonry down on both sides, shots fired; Play again, Practice range, Look around), N for where minions can walk (green from your gate, amber cut off, blue water, red in the way) with the bridges' status, and the aim help and hit readout know the bridges.
- **The look of the valley** (render only, `apps/game/src/render`): the ground follows the valley's heights out to the horizon; the ground material has grass in patches, straw drifts, heath and a few flower specks, the road with ruts and a grassy crown, the flank paths as worn tracks, wet mud and gravel shoals on the banks, scree on steep slopes and dark rock with strata, lichen and moss on the crags. The stream is a flowing ribbon across the whole land with foam at the banks and wakes behind the bridge piers, and it turns away into the hills beyond the valley. Forests of conifers, broadleaf and dead trees cover the sides and hills, with groves and copses lower down; bushes, gorse, reeds at the water, boulders and fallen logs over the floor; nothing tall in the firing lanes, on the routes, in the stream or on the castle pads. Bridge timber reads as beams. About 1.15M triangles at High in the overview (most of the growth is the bigger ground and the forests); Low halves the scatter. Not yet measured on a real GPU.

### Aiming round (rules version 5)

The owner's verdict on M1: aiming is far too easy and the game too predictable (the full predicted arc put every shot exactly where its ring was); the mortar's reach is fine; the keep can be made harder to hit rather than sturdier.

- The standard aim help is the spec's: the first part of the arc, your last shot's trail and where it landed, plus the barrel's elevation (the mortar also shows its range in still air, and its observer looks at that point). The whole predicted flight with the landing ring and the "lands on" readout is the easy setting under Controls. The setting is remembered under a new key, so everyone starts on the standard.
- Scatter: each weapon throws up to a small angle off the aim and varies its charge (`WEAPONS.*.scatter`), from a seeded stream in the sim, so a match still replays from its inputs and headless Chromium still matches Node. Measured in still air: the long gun lands half its shots within 0.4 m of each other on the enemy keep (90% within 0.5 m), the mortar within 1.2 m on the keep's roof (90% within 1.9 m, mostly along the line of fire), the chain shot within 0.7 m at the gate.
- Gusts: every 2 to 5 s the wind eases into a new gust, up to 25% stronger or weaker and up to 10 degrees off; the gauge, flags and smoke show it.
- The keep is unchanged: judge it again with harder aiming.

Findings for the owner (M1):

- The keep is still quicker to topple than a siege when the shots are good: in tests it took a long gun hit and two shells, two long gun hits near the top, or a shell and one low long gun hit (a lucky pair, 42 s into a match). A long gun blast (4.7 m) is about half the keep's width, and the face above a hole that wide comes down. Options: a sturdier keep (better bonded or thicker walls), a smaller blast against the keep, or leave it until the AI fights back and repairs (M4, M5), then judge.
- At full charge the enemy keep sits at the edge of the mortar's reach (about 150 m): a strong headwind can put it out of range for a while. The mortar's speed (82 m/s) could rise a little if that is unwelcome.

Next: the owner's verdict on M1 and the two findings, Kat's M3 at High; then M2 (waves). Note for M2: upright minions follow the raw ground today, so waves must walk on the nav grid's floors (bridge decks).
