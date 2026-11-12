# 3.7 Elements

## Goal

A small chemistry that the whole field obeys: fire that runs through timber with the wind, smoke that drifts and hides, water that backs up behind a dam, mud, and hard ground a ball skips along. A few rules that multiply into stories nobody scripted.

## Why

The wind today only pushes shots. Timber, water and ground are scenery. Each element below gives an old part of the game a new job: the wind decides where a fire goes, the stream decides which road is open, the ground decides whether a ball goes through one man or ten, and smoke is the defender's first real tool.

## Rules

Numbers live in a new `ELEMENTS` in `packages/content`. Each element is a grid or a per-piece state of whole numbers, updated on fixed ticks in a fixed order, with its own Rng stream where it needs one. Build in this order; each part can ship on its own.

### Part A: fire

1. **What burns.** Every piece of timber: keep floors, gate leaves, bridges, the frames and roofs of buildings, the bell's frame, the crane, the mast, the spotter's tower, ladders. Plaster burns at half the rate. Stone and iron do not.
2. **What lights it.**
   - **Hot shot**: a long gun round heated in a working Foundry's furnace (2 charges more, 2 s more to load). It lights the timber it strikes and any within 1.5 m of where it stops.
   - **Fire shell**: a mortar round (10 charges) that bursts into flame: timber within 3 m is lit, and it does no harm to stone.
   - A powder burst (a shell, a keg, a magazine) lights timber within half its reach, one piece in two.
3. **How it burns.** A lit piece burns for 20 to 40 s by its size, then fails and leaves the world as ash; what it carried falls by the support check. So floors burn out from under a banner, a gate burns open, a bridge burns through.
4. **How it spreads.** Four times a second, each burning piece heats the timber it touches (the neighbour lists the layout already has) and timber within 2 m downwind. A piece lights when its heat passes its limit. A stronger wind carries it further.
5. **Men and fire.** A man who touches a burning piece goes down (a new cause, Fire). The nav grid treats burning pieces as blocked, so a burning gate stops both sides until it is ash.
6. **Fighting it.** While anything in their castle burns, masons leave their work and carry water: each douses the hottest piece in reach every 2 s. A new building, the **cistern** (140 gold), doubles their rate and gives water with the well's rope cut. Setting a fire is therefore also a way to stop repairs.
7. **Rain** (3.8) halves how fast fire spreads and how easily it lights.

### Part B: smoke

8. **A grid** of 4 m cells over the valley and both castles holds how thick the smoke is in each (0 to 255).
9. **What makes it.** Fires, all the time they burn. Every burst, once. Every gun that fires, a puff at its muzzle. A **smoke shell** (a mortar round, 6 charges) makes thick smoke where it lands for 30 s.
10. **How it moves.** Six times a second it is carried downwind by the wind's speed, spreads a little, and thins (half gone in about 10 s once its source stops).
11. **What it does to the rules.** A gun nobody mans cannot lay on a man it sees through 8 m or more of thick smoke; a musketeer cannot either. The AI's hand loses what it had learned about a target it can no longer see.
12. **What it does to you.** The page draws the same grid as a volume, so you see less through it; the landing marker, the last shot's trail, the mortar's ring and the mason's eye are hidden where the smoke is thick. Marks (3.2) still work: fire for effect goes where the mark is. Your own gun's smoke hangs before your sight in still air and clears with the wind.
13. **Every tier draws the same thickness** (rule 8 of `docs/phase-3.md`).

### Part C: hard ground and mud

14. **Skipping.** A round shot that meets the ground at under 12 degrees does not stop:
    - on hard ground (the roads, dry turf) it keeps 60% of its speed and leaves at the angle it came, up to three times;
    - on water it keeps half, once;
    - in mud it buries itself.
    A ball down the length of a road goes through a whole column; today it stops at its first bounce or rolls.
15. **Wet ground.** A grid of 2 m cells holds how wet the ground is. Rain wets everything; craters near the stream's level fill; feet churn wet ground to mud. In mud men walk at 0.6 of their pace and wheels (3.10) at 0.4.

### Part D: water

16. **The stream has a level** along its course. Rubble, wreckage and the fallen lying in its channel block a share of it (the nav grid already counts bodies above the waterline as a crossing).
17. **Behind a block the water rises** until it tops it. Ground below the new level floods: shallow water is waded at half pace, deep water is not crossed.
18. **Below a block the bed drains**, and where it is dry men cross anywhere.
19. The first map's low ground is given in its data so that a dam at the centre bridge floods the approach to one flank bridge and dries the bed beside the other. Both sides can read it and both can cause it.

## Ammunition

A gun's rounds are chosen with one key (X, if free) and shown on its card: long gun: round shot, hot shot (with a Foundry); mortar: shell, fire shell, smoke shell (with a working Powder Mill). The fire input carries the round.

## Data and code

- `packages/sim`: `fire.ts` (per piece: heat, burning, fuel; reads the layout's neighbours and the stone grid), `smoke.ts`, `ground.ts` (wetness, mud, the skip in the ball's ground contact, written as the glance off stone is), `water.ts` (the stream as a row of sections). All hashed. New events for the page: a piece lit, a piece burnt out. Bump `RULES_VERSION`.
- `packages/rules`: rounds in the fire input and its powder; smoke in `gunnery` and musketeers' sight; the cistern; masons' water duty in `works.ts`. Bump `MATCH_RULES_VERSION`.
- The frame gains the smoke grid (about 3 KiB, six times a second), the wetness grid when it changes, the water level by section.
- Cost: a few hundred timber pieces, a grid of about 3,200 cells and one of about 12,800, a row of sections. Small beside the physics.

## The AI

- It fights fire by the same automatic rule as a player's masons.
- From a Knight up: hot shot at a standing gate and at the keep's upper floors once it has a Foundry; fire shells in its raids on buildings. Never at a bridge its own waves need.
- The Warlord lays smoke on its own gate while its masons rehang it, and fires for effect into its own smoke.
- It reads the water: a wave takes a dry bed when there is one.

## The page

- Fire: flames, embers that drift with the wind, light on stone and men, char where it has been (track L, round L4).
- Smoke as a volume from the grid; water that spreads; mud in the ground's material.
- The weapon card shows the round; the Controls panel gains a line for each element.
- Sound: fire's roar by its size, hiss under rain, a ball's skip.

## Tests and measures

- A hot shot lights a floor board; the fire spreads downwind faster than up; the board fails and the banner drops a floor.
- Masons douse a small fire; a large one outruns them without a cistern.
- Smoke moves with the wind; a gun nobody mans holds fire through it; every tier hides the same.
- A ball skips three times down a dry road and fells a column; the same shot in mud stops.
- Rubble in the channel raises the level upstream and dries the bed below.
- Observatory: banners down by fire, by shells, by toppling (T2 across the ways a keep falls); fires in a match; roads closed by water and for how long.

## Dead ends to hunt

- Every bridge burnt and no gang able to relay one (3.2's gangs must work on burnt decks too).
- A fire that never goes out (it must run out of fuel).
- A castle wholly hidden in its own smoke for minutes.
- A flood that shuts every road at once: the first map's data must leave one way.

## Try

Heat shot and burn the enemy's gate open. Lay smoke on your own breach and watch their guns fall silent. Send a ball skipping down the centre road through a wave. Bring a bridge down into the stream and watch the far road flood.

## For the owner

- Should the valley's brush and woods burn too (a fire across the field)? The spec leaves the field out: only built timber burns.

## Status

Not started.
