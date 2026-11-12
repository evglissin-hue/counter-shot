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

Not started.
