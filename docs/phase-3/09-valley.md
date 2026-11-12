# 3.9 The valley as a board

## Goal

Things worth holding lie between the castles, men can change the ground they stand on, and each road has a stance. Waves get work to do besides dying at a gate.

## Why

The valley is a corridor today. In the review's matches one side stood at the cap of 96 men with the storm meter at zero. Objectives give waves a purpose that pays whether or not they ever storm, make each flank different, and give the guns targets in the field.

## Rules

Numbers and places live in the map's data (`packages/content/src/map.ts`) and a new `VALLEY`.

### Objectives

The map is point symmetric, so places come in pairs: each side has one of each pair near it (home) and one near the enemy (away).

1. **Two quarries**, one on each flank road just past the stream from one side. The holder's masons pay half for every stone and lay a quarter faster.
2. **Two villages**, on the other flank from each quarry: four or five timber houses. The holder earns 2 gold a second and its reserve (3.6) fills twice as fast. A village can burn (3.7); burnt, it pays nothing until its people rebuild it (60 s after the fire is out).
3. **The sluice**, by the centre bridge. Whoever holds it sets it with one order: open (as the map is) or shut. Shut, the stream backs up as behind a dam and the bed below drains (3.7 part D).
4. **Holding.** A ring of 12 m around each. The side with more men standing in it for 10 s takes it. It stays theirs when they leave, until the other side takes it. Home ones belong to their side at the start; the sluice to nobody.

### Stances

5. Each road has a stance, set for all of a team's waves on it:
   - **Advance** (as today);
   - **Hold** at the midfield marker (as today);
   - **Hold the place** on that road (the quarry, the village or the sluice);
   - **Push the breach** (as today).
   The team-wide order of today becomes a shortcut that sets all three roads.

### Changing the ground

6. **Digging in.** Men who hold a marker or a place for 30 s raise a bank: the ground rises 0.8 m in an arc 8 m long on the enemy's side of where they stand. It is ground, so it stops flat shot and grapeshot that would have reached them. A shell or a ball can cut it. Never in the map's no-dig zones.
7. **Mining.** Sappers on a road whose stance is Hold the place, with their side holding that place, dig instead of marching: a tunnel runs from the place towards the nearest stretch of the enemy's front wall at 0.5 m a second. A spoil heap grows where it starts, and a line of turned earth shows above its head. When it reaches the wall the charge is fired: a burst under the foot of the wall, twice a keg's. A burst within 4 m of the tunnel's head caves it in, with its diggers.
8. **Bridge gangs** (3.2) also mend a burnt bridge.

## Data and code

- `packages/content`: the places in the map's data, with their rings; `VALLEY`; village houses as masonry of the field's support group (laid out from the start, as bridges are).
- `packages/sim`: the count of men in each ring, as `Army.step` counts a courtyard's; the stance per team and road (the hold point is the marker or the place); digging in through `Terrain` (raise, as a crater lowers); the tunnel as state (its head, its diggers), hashed. Bump `RULES_VERSION`.
- `packages/rules`: who holds what, what it pays (income and repair costs go through the economy's one function each), the `{ kind: "stance", road, stance }` and `{ kind: "sluice", shut }` inputs. Bump `MATCH_RULES_VERSION`.
- `MatchInfo` gains each place's holder and meter, each road's stance, tunnels of the page's own side, and the enemy's spoil heaps (they are seen).

## The AI

- The steward holds its home places from the first waves; from a Knight up it sends a barracks down the road of an away place it does not hold; the Warlord shuts the sluice before a push across a dry bed and opens it when you push.
- It mines when its guns cannot keep a breach open.
- The gunner shells a spoil heap within its reach, and men dug in on its side of the stream.

## The page

- Each place has a banner in its holder's colour and a ring that fills as it changes hands, in the world, the overview and the minimap.
- The command card's three road chips each show their stance; one press steps it.
- A note and a horn when a place of yours is taken; the feed shows what a place pays.
- A mine: a faint line of turned earth creeping towards a wall, a low thud of picks you hear when it is near your own.

## Tests and measures

- More men in a ring for 10 s takes it; it stays taken when they leave.
- Each place pays what it says and stops when lost; a burnt village pays nothing.
- A bank stops grapeshot from the front and not from the side.
- A mine reaches a wall and breaches it; a shell on its head caves it in.
- Observatory: seconds each place is held; win rate by places held at 5:00; where men fall (aim: under half within 45 m of a gate); T8.

## Dead ends to hunt

- A place nobody can reach when its bridge is down (a gang relays it, or the bed is dry).
- A mine that never arrives or can never be stopped.
- Banks that wall a road shut: a bank is never raised across a road's own width.

## Try

Send one barracks to hold your quarry and another to take their village. Shut the sluice and walk your storm across the dry bed. Find the spoil heap of their mine and shell it.

## For the owner

- Five places on a field 150 m long: enough, or one too many? The sluice is the one to cut if it reads as busy.

## Status

Not started.
