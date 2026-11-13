# The army pass (between 3.3 and 3.4)

## Why

The owner played version 23 of the game link (November 13): "feels decent but minions are very dumb, and they don't follow orders as well". Then, more exactly: "they would not follow command about advancing. enemy mminions" and "enemy minions would just hold the bridge and not move forward". This pass makes the waves competent and obedient within today's design. Nerve, formations, melee without dice, riders and engines stay in milestone 3.10 (`10-armies.md`).

## How it was measured

Five diagnosis agents worked at once, one per area (orders and routes, movement, fighting, specialists, the page), each with scripted, deterministic scenarios that measure what a player would see. Their scripts stay in `tools/army-diag/<area>/` so every finding below can be reproduced; bundle one with `npx rolldown tools/army-diag/<area>/X.ts --format esm --platform node -o node_modules/.scratch/X.mjs` and run it with node (the page's are `.mjs` tools with a `PORT`).

## Findings, worst first

1. **The AI holds at its markers for most of the match** ("enemy minions would just hold the bridge"). The steward ordered Hold whenever the enemy's marchers within 120 m of its own muster outnumbered its own 1.6 to 1 plus 4. 120 m reaches past the player's own muster, so it counted the player's whole army, men holding behind the stream and men standing at home included, and nothing but its own numbers ended a Hold. Knight, seed 21: on Hold 224 of 336 s, 58% of its marching time at its own markers, 1 of 127 of its men reached the player's gate. Seed 5: Hold and Advance flipped 7 times, 0 of 176 reached the gate. Warlord: one Hold of 168 s. (`orders/versus.ts ai=knight player=gunhold aigun=0`)
2. **A sealed courtyard froze whole armies under any order** ("would not follow command about advancing"). A gate leaf knocked loose by a gun but still upright in its place stopped counting as a door, and rubble read by its bounding box stacked the gateway's floor to 2 to 9 m. The route fields then reached nothing and every marcher stood where he was, Advance or Push: 35 to 58 men at once, on both sides, 10 to 20 s at a time and again and again (Knight v Knight seeds 21, 33, 45; 13% of all marching time in seed 21). Men who were not cut off obeyed Advance at once in every scripted case, the guided match's held waves included. (`movement/match.ts`, `orders/pocket.ts`)
3. **The order line refused most ways of saying Advance.** 96 of 184 phrasings were not understood: "go", "march", "send them in", "attack the enemy", "attack enemy minions", "advanced" (a common transcript of "advance") and "Waves, advance." (the comma split the line). "take the left" manned a gun. (`page/parse-table.mjs`)
4. **The route moved only the next waves.** In the guided match the waves wait on Hold on the left; picking Right and then Advance sent all 24 held men up the left. (`orders/routes.ts`, `page/orders-guided.mjs`)
5. **Push abandoned the wave's road.** The breach fields had no road weights and took over as soon as a breach existed, so 32 of 32 men sent left crossed by the centre bridge and single waves split over two bridges, strung out over 150 m. The AI pushes from about 0:20 in most matches, so its road choices were wasted. (`orders/push.ts`, `movement/scenarios.ts sc=push-nocentre`)
6. **Ladders almost never went up**: 1 of 31 in two AI matches. One loose top stone spoiled a spot; a crew with no spot carried its ladder for minutes, into the enemy courtyard even; claims of men killed on the way were never freed; Hold was ignored at the ladders; climbers dropped in one at a time and died one at a time (0.7 to 6 s each). (`specialists/ladders.ts`)
7. **A sapper's set keg knocked down his own wave at the gate**: 5 to 6 of its men in 6 of 6 centre-road runs (kegs set 4.3 m from the gate's middle, a 7 m knock); the two kegs of a wave landed on one spot. (`specialists/sappers.ts`)
8. **Whole waves piled onto one enemy**: in an 8 v 8 meeting 6.3 men targeted 1.2 distinct enemies while 6.3 stood within 9 m; half the engaged time was spent closing on a target out of reach. (`fighting/advance.ts sc=field`)
9. **Musketeers stopped for good at enemies across the stream**, shooting at 15% a shot while their pikes went on alone, and stood idle in the doorway of a closed gate; most of their shots at a gate went at masons. (`fighting/advance.ts sc=hold mix=volley`, `specialists/muskets.ts`)
10. **Stand-offs in a courtyard**: an attacker and a garrison man 8 m apart across rubble stood 112 s and more and froze the storm; the garrison ignored an attacker in the gate passage; attackers chased a fleeing mason round the keep for 15 s. (`fighting/advance.ts sc=gate`)
11. **The AI flipped its order every 12 to 36 s** (11 changes in 5:16, Knight v Knight seed 21).
12. **The map lied about water**: a dropped deck's wreck read as an open bridge 8 to 20 s later (no bridge gang, the AI routed waves onto it); a mortar crater far from the stream read as deep water; a man could be pushed into a step he could not take and stand for good.
13. **The page**: the order and road buttons flickered back to the old state after each click (the old order lit for 150 to 300 ms online); Ctrl+1 to 3 did nothing while the order line had focus; the road row ignored the barracks' own roads.

Left for 3.10: waves marching as a blob and holding as one long thin rank; a held mass jamming a 3 m bridge deck when it advances; waves on different roads never meeting (sight 9 m, roads 45 m apart); a clash decided 2.5 to 5 s after the first blow; a carried keg's chain knocking down a crowd (by design until waves keep their spacing).

Bearing on the lanes (the owner finds roads per wave manual and hectic; a change for later): the AI's road choices were wasted under Push (finding 5); a road change that leaves the men already out on their old road reads as disobedience (finding 4); the barracks' own roads and the team road could disagree on the card.

Also seen, not changed: masons close a fresh two-shot breach in about 15 s, so Push often finds none (balance, for the observatory).

## Fixes

To be filled in as they land.

## Hunts added

To be filled in.

## The observatory's quick run, before and after

To be filled in.

## Versions and hashes

To be filled in.
