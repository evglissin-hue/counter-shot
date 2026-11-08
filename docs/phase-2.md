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

**The owner picked M4 before M3 (November 8).** Until M3, gold has one use (repairs) and comes only from the keep; trick shots, bounties and buildings arrive with M3, and the end screen gains trick shots then. The detailed plan:

- **Masons** (4 per castle, real figures with mallets): they walk from the yard by the workshop to the damage, clear the rubble out of the gap (carried off), and rebuild course by course from the bottom, one stone at a time each, paying for every stone (walls and towers 1 gold, the keep 2, a keep floor 10, a gate leaf 25). A stone goes back only where its place is clear (no rubble, bodies or minions in it) and what it rests on stands. A gin pole (an A-frame hoist taller than the wall, so it shows from outside) stands over the work; each stone rises on its rope and settles into its bed with a puff of mortar dust, to the tap of chisels and the knock of mallets. A gate leaf is hung back with a heavy thud. Masons drop their work and run from enemy minions close by, and they are as easy to knock down as anyone: shoot the enemy's masons to keep a breach open. A fallen mason is replaced at the yard after 20 s.
- **Repair switches** for your castle: Gate, Walls, Towers, Keep (Alt+1 to 4, or the chips in the match bar), all on to start. Masons take the most urgent job first: the gate, then the lowest gap in a wall, then towers, then the keep. The HUD says what they are doing and what it costs. The enemy castle repairs everything until the AI decides for itself (M5).
- **Garrison and storming**: each courtyard holds a garrison of 4 pikemen in front of the keep, topped up from the barracks. When the enemy is inside your courtyard, your barracks keeps its next wave inside to defend. Attackers storm a courtyard by outnumbering the defenders inside: a meter fills over 20 s while they do, holds while they do not, and drains when they are gone. A ring on the courtyard's ground fills in the attackers' colour; a war horn sounds when a storm begins, the bell of the stormed castle tolls faster as it fills, and drums build under it. Holding at the midfield markers until two waves have gathered, then pushing through a breach, is the way in.
- **Ladder crews**: from the second wave on, every other wave carries a ladder (two men with it on their shoulders: the shape reads at 100 m). They plant it in a crenel of an intact front wall (a thump against the stone) and the wave climbs: up the outside, over the wall walk, down a rope on the inside, a few at a time. A planted ladder is a physics body: a ball, a chain shot or a shell knocks it off the wall and everyone on it falls; so does masonry coming down under it. Shoot crews on the way in: once a ladder is up, your guns cannot reach the foot of your own wall.
- **Sudden death at 15:00**: three tolls of a bell and a drum roll; income doubles and every gun reloads in 60% of the time. The clock turns red.
- **Surrender** from the menu (with a confirm).
- **The end screen** says how it ended (the keep, a storm or a surrender) and when, with gold earned and spent on repairs, masonry brought down, lost and rebuilt, pikemen lost and knocked down, shots, waves and ladders, and a short log of the match's moments (gates broken, breaches, storms begun and beaten off, ladders planted, sudden death).

### Polish (alongside M3 and M4: how it looks, sounds and reads)

The owner asked for a third agent on quality (November 8), working on the game page only (no gameplay, sim or hash changes), on its own branch until the merge. Plan, judged from screenshots of every view and the sound check:

- **Water**: splashes where shots, timber, stones and bodies fall into the stream, and a column of water for a shell bursting in it; the stream no longer turns white where it is seen at a low angle.
- **Sound**: impacts by what they strike (stone, timber, earth, water), the tramp of marching ranks near the camera, pikes meeting in fights, men shouting and the low roar wherever the fighting is, the stream's murmur near the water, crows over the woods in quiet moments, and a few quiet interface sounds (taking a gun, buttons, two drum beats for an order).
- **Readability**: team-coloured marks over the minions in the overview, so the waves can be followed from high up.
- **Look**: the low sun through haze the spec asks for (a little warmth in the sun and a warm band at the horizon towards it), keeping the Gritty palette.
- **Interface**: a title screen with a slow camera over the valley behind the start menu, and a cleaner HUD (weapon panel, reload bar, wind gauge, notes, the Controls panel, the menu and end cards), keeping every id so M3 and M4 merge cleanly.

Status (branch `claude/epic-hopper-0nsw4v-polish`; game page only, every hash and rules version unchanged):

- **Water** (`render/splashes.ts`): round shot, chain shot, grapeshot and shells crossing the stream's surface throw up droplets that fall back and vanish under it, with a drift of spray the wind carries off; so do loose timber and stones from a blown bridge, and bodies knocked into the water. An impact in the water splashes instead of throwing dust and chips, and a shell bursting in the stream throws up a column of water instead of a skirt of dust. The page hears every splash. The stream stays dark where it is seen at a low angle (low reflections show the valley's banks and trees, not the bright haze), so it no longer looks like a sheet of ice.
- **Sound** (`soundscape.ts` decides when and where, `sound.ts` makes them): impacts by what they strike (stone keeps its hit; timber knocks hollow with splinters, the gate when battered included; earth thumps and rains back; water splashes, from a grapeshot ball to a shell); the first touch of a shot on the ground thumps; footfalls of the ranks nearest the camera, with the odd knock of kit; pikes meeting at every blow in a fight, now and then iron on iron; men shouting where the fighting is, and a low roar of it placed there; the stream's murmur near the water (less from high up); a crow over the woods now and then when it is quiet; the gun you ride grinding on its carriage as it turns (heavier for heavier guns, with a creak of timber), and the crew at work a little past halfway through each reload (swab and rammer, a shell let down, the chain laid in); quiet interface sounds (taking another gun, a button, two drum beats when an order goes out). Interface sounds start a little ahead of the audio clock: very short envelopes scheduled too close to it were lost.
- **Readability** (`render/marks.ts`): in the overview every upright minion has a small diamond in its team's colour with a dark rim over its head, at a near constant size on screen, fading out as the camera comes close; one instanced draw.
- **Look**: a little warmth in the low sun, its glow and the haze towards it, and a warm band low along the horizon on the sun's side (SPEC section 13); the palette is otherwise unchanged.
- **Interface**: a title screen before a mode is chosen (a slow circuit of the valley at the height of the hills behind the menu, without the gun's instruments); glass panels with depth; keys drawn as keys; a heavier weapon name, a reload bar that glows when loaded and pulses once as it loads; a compass ring on the wind gauge; notes with a brass edge that rise into place; cards with a brass rule under the title and choices that answer the pointer; a vignette behind overlays; a shimmer on the loading box. Reduced motion turns the animations off. Every id and the markup are unchanged.
- **Tools**: the headless tools take a PORT from the environment, so several runs can share a machine.
- **Cost**: three more draws when nothing is happening (the splash droplets, the spray, the marks); triangles in the overview at High 1,186,450 before and 1,187,446 after (+0.1%); draw calls 214 before, 217 after.
- **Open**: seen from low down towards the sun, a stretch of the valley floor by the stream renders as a white sheet that reads as snow (it was there before this work; not specular, not the water or an overlay: still to find).

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

### M2. Waves (rules version 6, match rules version 2)

Built and published; waiting for the owner's verdict. What it does:

- **Barracks** (pre-built, one per castle): a wave of 8 pikemen every 25 seconds from 0:08, formed up in two ranks a few metres out from its own gate; a barracks sends only as many as keep its side at 96 standing. Your waves take the route you pick (L, or the chips in the match bar: left flank, centre road, right flank). Until the AI player (M5), the enemy's go down the centre, the left and the right in turn.
- **Flow fields** (`packages/sim/src/flow.ts`): for each team, a field per route and a breach field, over the valley floor (144 by 208 cells). Integer costs (5 a straight step, 7 a diagonal one, never past a corner) times a weight for being off the field's route (2 on it, up to 6 far off it), so a wave keeps to its route. In a route field the enemy gate is a door at extra cost (the waves who reach it batter it); in a breach field a standing gate is a wall. Dial's bucket queue, 2,500 cell visits per tick (about 0.2 ms on the cloud server once compiled), double buffered: a full refresh of all eight takes about 1.4 s. A field is rebuilt only when the nav grid's topology changes (a step between two neighbours opens or closes), not for every new heap.
- **Pikemen** (`packages/sim/src/army.ts`): they march on their field at 1.6 m/s (each up to 6% faster or slower), keep 0.95 m apart from anyone near, and keep their wave together (those ahead of its middle slow down). They walk on the nav grid's floors with eased steps: bridge decks, rubble, the fallen. When the floor drops out from under them (a deck blown away) they fall. They go for the nearest enemy within 9 m that they could walk straight to, close in, and strike within the pike's reach (2.6 m): a blow every 70 to 110 ticks, each knocking the enemy down with a chance of 30%, drawn from the army's seeded stream. Measured: 8 against 8 is over in about 6 s, and nobody is favoured by being spawned first. At a closed gate they batter it, pikes levelled: 60 blows a leaf, about 25 s for a full wave; the leaf comes loose and falls into the courtyard (the wall over the gate stays up). Inside they gather in the courtyard: storming it is M4.
- **Orders** (Ctrl+1, 2, 3, or the chips; all your waves, now and later): Advance (the default); Hold, at the midfield markers 4 m short of each bridge on your side (those already past walk back); Push the breach, to the nearest walkable gap in the enemy walls (as Advance while there is none). A wave whose bridge goes down before it crosses takes the nearest bridge still standing, all together (on a tie, its own left).
- **The nav grid**: rubble and the fallen are their own kind, a heap you scramble over (steps up to 1 m instead of 0.6 m; standing masonry keeps the stair rule); sandy in the overlay. Wreckage lying under the stream's surface leaves the cell wet, so a blown bridge does not bridge the water. A long gun shot high on a wall brings the top down but leaves a 3 m stub: a breach you can walk through takes a shot at the foot of the wall (about 1.3 degrees down from the gun, at the enemy wall).
- **The fallen** stay as floor: a frozen body raises its cells like rubble (ramps, heaps). Army ragdolls settle sooner than the Practice range's patrol (damped after 3 s, frozen once nearly still after 8 s). Past 240 bodies the oldest sink into the ground over 1.5 s and leave the world. A frozen body goes to the page once; the renderer keeps it.
- **Guns nobody rides** (`UNMANNED` in `packages/content/src/army.ts`, the match's gunnery): the four of each castle you are not riding fire on their own at enemy pikemen within 45 m of their own gate, the approach once the stream is crossed (the tower defence half). They turn at the weapon's own rates, lead the target, ignore the wind, and miss by up to 3 m plus a tenth of the range (the swivel 2 m plus 8%); reloads are 3 times the weapon's (the swivel 2.5). They hold fire when one of their own is near the target or a bridge lies on the line of fire. The mortar never fires on its own. Measured on an unopposed wave: 32 of 48 reach the gate (6 seeds), and a full wave breaks it half the time within 30 s of battering. You take a gun as it points: when you switch to one that has been firing, it swings back to where you last aimed at its own rate. Your trail and landing marker show only your own shots.
- **Gunnery** (`packages/sim/src/gunnery.ts`): the aim that lands a shot on a point in still air, by bisection on the elevation (the mortar: on the charge at a fixed elevation); the mortar lands within 0.4 m of the mark. The AI will use it too.
- **The enemy castle's guns**: its own four, your castle's turned through the middle of the field.
- **The page**: the match bar's second line (the next waves, the route and order chips, both sides' pikemen standing and down); notes when your gate is battered or falls and when the enemy's falls; the end screen counts pikemen; every gun turns where it aims; the midfield markers (a pennant in each team's colour on each route); pikes levelled in a fight with a thrust at each blow, and against a gate. `node tools/wave-shots.mjs` films a match on the real clock with fixed cameras; the renderer test page stages two fights and a gate for close-ups (`node tools/valley-shots.mjs fight gate`).
- **Determinism**: a scripted wave match (80 s: both barracks, a route change, Hold, Advance, a shot down the road, a breach in the enemy wall, Push, then every gun unmanned) is pinned in Node and replays bit for bit in headless Chromium, with the keep match and the Practice range session (whose hash did not change).
- **Cost** (cloud server, Node): the army adds about 0.15 ms a tick with 30 to 50 pikemen afield, with peaks of 1 to 4 ms when fields are rebuilt; the world's step grows from 2.2 ms to about 3.9 ms as bodies pile up to 110 (their physics, not the army's thinking). Not yet measured on the laptops.

Findings for the owner (M2):

- At first the unmanned guns wiped out every wave before it reached a gate: one mortar shell knocks down everything within 12 m, and a wave walks as a block. Now they defend only their own approach, the mortar never fires by itself, and they miss far more; about two thirds of an unopposed wave reach the gate. Your own aim decides (a shell on a wave at your gate). Should your walls hold better or worse on their own?
- Right at your own gate no gun can reach the pikemen battering it (none depresses that far): only a mortar shell you fire yourself breaks them up there.
- Bodies piling up in the stream can rise above the waterline and make a crossing of the dead; the bridge status then reads open again.

### After M2 (rules version 7): shipped

The owner's verdict on M2 (November 8): everything feels pretty good; aiming with the keys was too sharp, and the mortar a bit strong. Then: ship M2, and start M3 in a new session.

- **Keys have weight** (page only, `WEAPONS.*.keys`): while a key is held the gun gathers speed (over 0.7 s for the long gun, 0.3 s for the swivel) up to a share of its top turning speed (the long gun 9 degrees a second instead of 20, the swivel 28 instead of 92), and it coasts to a stop when let go. A tap is a small correction: a tenth of a second turns the long gun less than a tenth of a degree. The mouse and the gamepad sticks are unchanged, and so are the sim's turn limits.
- **The mortar reloads in 12 s** (was 6): a big event, few shells. The long gun stays at 4 s, the chain shot at 5 s, the swivel at 2 s.
- The Practice range's scripted session and the keep match fire their second shell after the new reload and are re-pinned; the wave match never fires the mortar and is unchanged. Node and headless Chromium agree on all three.
- **Shipped**: `main` holds phase 2 up to M2 (with the lab, phase 1 and M1 before it), and the game link has this build.

Next: M3 (gold and building), in a new session. Still to hear: the laptops on Versus AI with a full field (Kat's M3 at High especially: the HUD's step and frame numbers), and whether guns nobody rides should hold the walls better or worse.
