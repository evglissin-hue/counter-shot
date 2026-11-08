# Keepfall: planning notes

Working notes from the planning conversation. The spec is `SPEC.md` (draft 0.3); the phase plans are `docs/phase-1.md` and `docs/phase-2.md`.

## The game in one paragraph

A browser game where two castles face each other across a field. You fire siege weapons in first person at the enemy castle and at the waves of minions marching on yours, while running a light RTS layer: buildings that defend, buildings that attack, buildings that unlock abilities. Physics is the point: castles are real masonry that cracks, breaches and collapses; minions get knocked flying; terrain matters. Two ways to win: topple the enemy keep until its banner hits the ground, or storm their courtyard with your minions and hold it.

## Decisions so far

| Topic | Decision |
|---|---|
| Platforms | Laptops only: desktop browsers on Windows and Mac. No iPad, tablets or phones, so no touch controls. Inputs: keyboard and mouse, gamepad, keyboard only. The 2019 MacBook Air is not a target. |
| Audience | The owner, Kat and friends, via invite links. |
| MVP mode | Online 1v1. Later: online co-op on two laptops; one day 2v2. |
| Spec 0.1 | Agreed by the owner and Kat, including the build order. |
| Against the AI | Solo versus an AI castle playing by the same rules stays as a mode. |
| Co-op | Changed after spec 0.1: two players defend one castle against waves of attackers (tower defence), not against an AI castle. It must be very physics-based, not identical minions: attackers differ in mass and size, armour that deflects shots or makes them ricochet, shields and formations, mounts, siege engines and towers that collapse, climbers, swarms, giants, units that change the terrain. Waves interact with the castle's physics. See SPEC section 11. |
| Co-op roles | Soft roles: Gunner (shooting, abilities) and Steward (buildings, repairs, economy, minion orders); the Steward can shoot too; swap any time. |
| How you play | You ride the castle's weapons: number keys or bumpers jump between cannons, mortars, ballistae; an overview camera for building. No walking around. |
| Unmanned weapons | Fire at minions on their own (the tower defence half). Manual control is far more accurate and allows trick shots. Since M2 they defend only their own approach (enemy minions within 45 m of their gate), miss by metres, reload 2.5 to 3 times slower, and hold fire near their own pikemen and bridges; the mortar never fires by itself (one shell knocks down a whole wave). About two thirds of an unopposed wave reach the gate. |
| Aim help | Only the first part of the flight path is shown, plus a ghost trail of your last shot. More help in co-op and casual, less in ranked; some buildings and races extend it. |
| Win | Topple the keep (banner hits the ground) or storm the courtyard (minions hold it for 20 s). |
| MVP physics | Castle collapse, minions knocked flying, craters and landslides, wind, chain reactions. Water and fire later. |
| Destruction look | Masonry: castles of real stones that crack and crumble. |
| Physics picks no sides | Your own tower can fall on your own buildings and minions. Plus some gore (with a setting to turn it off). |
| Detail | The owner wants the current level of physical detail kept (a mortar shell throws dozens of real stones). Smoothness comes from short physics steps and drawing between sim frames, not from fewer stones. |
| Kill cams and replays | Later (after the MVP): replays of the best minion deaths and collapses, gruesome ones included, in the spirit of Porrasturvat, which the owner enjoys. Built on world snapshots plus the recorded inputs, so a replay is exact. SPEC sections 5 and 13. |
| Building | Fixed build spots in the castle with upgrades for the MVP; a castle designer after the MVP. |
| Minions | Barracks spawn them; you set the mix and give a few hotkey orders (advance, hold, push the breach). 2 to 3 routes that physics can open or close. |
| Economy | Kills and trick shots earn gold. |
| Match length | 10 to 15 minutes. |
| Races | Start with the first two proposals: Ashwright Guild (the MVP race) and Graniteborn. The others later. |
| Name | Keepfall is the working title; the final name comes later. |
| Online test | Online 1v1 runs over the artifact's room capability since M5 (lockstep in presence). Cloudflare stays the plan for invite links outside claude.ai, spectators and a relay we control. |
| Art style | Gritty (grim siege), chosen by the owner and Kat. The game uses Gritty only; Warm and Low-poly stay in the lab as references. See SPEC section 13. CC0 photo textures are allowed if committed with their licence. |
| Quality tiers | Picked on first launch by the quick graphics test; High without one; drop a tier after 5 s of missed frames. |
| Art assets | No artist: code-built castles and terrain, free asset packs and AI-generated models. |
| Stack | Same as Castle Artillery: TypeScript monorepo, Cloudflare, a preview link per branch, several Claude sessions in parallel. |
| Phase 1 verdict | The quality round held the best tier through mortar bursts on the M4 ("feels good"): phase 1 is done. |
| The game page | The sandbox became the game page with a start menu (Practice range, Versus AI), at the same artifact link. |
| First map | A valley with a stream: central road, two flank paths between low ridges, a stream across the middle with three timber bridges. Point symmetric, so both players see the same valley from their own walls. The Practice range plays in it too. The owner asked for a more beautiful, more detailed map. |
| The keep | Timber floors inside (7 and 13.5 m under the 20 m roof): each shell caves in one level and the banner drops a floor at a time. Toppled means the banner reaches the ground floor (or the ground outside). |
| Fallen minions | Stay all match as frozen bodies (cover, ramps, blockages); past a few hundred the oldest sink into the ground. |
| Abilities | After phase 2. |
| Aiming takes skill | The owner found aiming far too easy and the game predictable with the full predicted arc. Now: the standard aim help is the first part of the arc, your last shot's trail and where it landed (you learn by correcting); the full arc is an easy setting. Every shot scatters a little (seeded, so replays and lockstep hold; rifled barrels will tighten it), and the wind gusts on top of its slow changes. The keep stays as it is until we see how it holds up against harder aiming. |
| Mortar reach | The enemy keep at the edge of the mortar's reach (a headwind can put it out of range for a while) is fine. |
| Waves (M2) | One pre-built barracks per castle sends 8 pikemen every 25 s. Your route with L, orders for all your waves with Ctrl+1, 2, 3 (Advance, Hold at the midfield markers, Push the breach). Until the AI (M5), the enemy's barracks takes the routes in turn. A wave whose bridge is down takes the nearest one standing, together. |
| Rubble and the fallen | Pikemen scramble over rubble heaps and bodies (steps up to 1 m), not up standing masonry (0.6 m). Fallen bodies stay as frozen floor; past 240 the oldest sink away. |
| Key aiming | The owner found key aiming too sharp. Keys now have weight per gun: the gun gathers speed while a key is held (up to about half its top turning speed, a third for the swivel) and coasts to a stop; a tap is a fine correction. The mouse and sticks are unchanged. |
| Mortar reload | The owner found the mortar a bit strong: it reloads in 12 s (was 6). Reloads: long gun 4 s, mortar 12 s, chain shot 5 s, swivel 2 s. |
| M2 shipped | The owner's go on November 8: `main` holds phase 2 up to M2. M3 starts in a new session. |
| M4 before M3 | The owner picked M4 (repairs and storming) next, with the focus on how it plays, looks and sounds; M3 is built in parallel by another session, and a third session polishes the look, sound and interface. Until M3, repairs are the only thing gold buys. |
| Repairs (M4) | Four masons per castle, real figures who can be shot; they rebuild the lowest gap first, carry rubble and bodies out of the way, pay per stone (walls and towers 1, keep 2, a keep floor 10, a gate leaf 25), and run from enemy pikemen. Switches per kind of section (Gate, Walls, Towers, Keep: Alt+1 to 4), all on to start. The enemy repairs everything until the AI. |
| Storming (M4) | A garrison of four in each courtyard, topped up by the barracks; a barracks under attack musters its wave inside. Attackers inside who outnumber the defenders (at least two) for 20 s storm it; the meter holds while they do not and drains when they are gone. |
| Ladders (M4) | Every other wave from the second carries a ladder; crews plant it in a crenel of an intact front wall; the wave climbs while the gate stands and there is no breach. A planted ladder is a physics body: shots, falling stones and bursts knock it off, with whoever is on it. |
| Match length | The owner: matches of 10 minutes or longer are welcome as long as time is not stretched for its own sake. Repairs make a siege attrition against the defender's gold and masons; the target stays 10 to 15 minutes, with sudden death at 15:00. |
| Polish alongside M3 and M4 | The owner asked for a third agent on quality (November 8): presentation only (no gameplay, sim or hash changes). Water splashes, sound by material with footfalls, clashes, shouting, the stream and crows, interface sounds, overview marks over minions, a title screen over the valley, a warmer low sun through the haze, and a finished HUD. See the Polish section in `docs/phase-2.md`. |
| M3 and M4 shipped | The owner's go on November 8: `main` holds M3, M4 and the polish pass. |
| Matches too short (M5) | The owner toppled the AI's keep in under 30 s. The match keep now takes a siege: 2 m walls of dressed stone (a blast reaches half as far into them, courses bridge twice the gap), timber floors that take two shells each (a ball punches through but never brings a floor down), shots pass the banner pole (a clipped pole counted as toppled), and the mortar reaches the whole enemy roof (84 m/s). A perfect gunner with no repairs needs 2 to 3 minutes; masons stretch it further. |
| The AI (M5) | A player in the sim sending the same inputs (`packages/ai`): it rides one gun at a time with the gun's turn rates and reloads, aims by the aim help's flight prediction plus an error it corrects from where its shots land, builds by a plan in data, sets mixes, routes and orders, and works the repair switches. Squire, Knight, Warlord. |
| Two players (M5) | The owner wanted two people to play in this round. The artifact's room capability lets pages with the game's link open share live state, so online 1v1 runs in lockstep over it now (Play a friend: host or join from the lobby), without waiting for Cloudflare. The host plays the oxblood castle, the guest the green one. If the friend leaves, the AI can take their castle. |
| Minion animation (M5) | The owner asked for richer, more granular animation, by a separate agent: a procedural rig posed every rendered frame (gait from real speed, idle life, fights, crews, climbers, sappers, musketeers, falls out of the last pose, dropped kit), render only. |

## Race proposals (for review)

Each race is built on a different branch of physics, has a different skill curve, and leans toward a different way to win.

| Race | Physics | How they play | Difficulty |
|---|---|---|---|
| Ashwright Guild (human gunsmiths) | Explosives and ballistics | Long guns, mortars, fused bombs that bounce before they blow, chain shot; sappers who carry powder kegs (shoot them early and they blow up among the enemy). Balanced between both ways to win. | Medium: the MVP race |
| Graniteborn (stone giants and their handlers) | Mass and momentum | Huge slow shots: boulders that roll downhill, a wrecking ball you swing and release, quakes that shake weakened walls down. Few, enormous minions. Very sturdy castle, slow to build. | Easy to pick up, brutal |
| Tidebound (coastal raiders) | Water and ice | Harpoons on ropes that pull walls down, flood the routes by opening sluices, freeze water into bridges or walls, shots that skip across water. Needs the water simulation. | Hard: reading terrain and timing |
| Lodestar Order (astronomer engineers) | Magnetism and gravity | Shots that curve toward iron, gravity wells that bend every shot nearby (including the enemy's), lifting rubble and dropping it. The best at countering incoming shots. | Hardest, highest ceiling |
| Alternates | Ropes and tension (net and bola weavers); growth and decay (a swarm whose roots crack foundations over time) | | |

## Name

Keepfall is a working title (after the main way to win: topple the enemy keep). The final name comes later; the repo is still called counter-shot.

## Technical direction

- Physics: Rapier (WebAssembly) in a worker. The deterministic build guarantees identical results across browsers and CPUs, which lets online play send only inputs (lockstep), like Castle Artillery's turn replays. Castle pieces are fixed bodies until hit. A hit shatters the core of the impact (those stones leave the simulation; the renderer draws dust and chips) and knocks loose and scatters the ring around it; heavy falling debris knocks more pieces loose; a support check drops anything left unsupported; settled rubble freezes back to fixed. Rapier 0.21 also has tearable soft bodies (banners, gore) and editable voxel shapes (craters), worth testing next.
- Rendering: Three.js WebGPU renderer (with its WebGL2 fallback), procedural materials, instanced stones.
- Online: lockstep over a Cloudflare Durable Object relay, rooms by invite link. Every client simulates everything, so the weakest device sets the physics budget; cosmetic effects scale per device.
- Moonshot to evaluate: AVBD (SIGGRAPH 2025) on the GPU for far larger castles, if it can be made deterministic (fixed-point) or run on one host.

## Findings from the first physics runs (Node and headless Chromium, cloud server CPU)

The server's speed varies between runs, so these are ranges. The lab page measures the real devices.

| Test | Deterministic build | Fast (SIMD) build |
|---|---|---|
| Moving stones that fit in 6 ms per step | about 500 to 700 | about 900 to 1,900 |
| Scripted siege (12 shots in 9 s, about 830 stones loosened, about 300 moving at peak), average step | about 6.8 ms | about 7.0 ms |

- Tuning that mattered: centring the blast a metre inside the masonry (the ball touches the face), shattering the core so a real hole opens, and a 450 kN break threshold for falling debris (220 kN made chain reactions double the cost).

- Same input gives the same hash run after run, and headless Chromium matches Node bit for bit. Cross-browser and cross-device checks are what the lab is for.
- First real device (lab-2 build, Apple M4 Mac, Chrome, WebGPU, 120 Hz screen): the deterministic siege matched the reference hash bit for bit, so Apple ARM and x86 servers simulate identically. Physics budget: about 1,460 moving stones in 6 ms per step (about 2,750 in 12 ms); the fast build about 2,870. Scripted siege: 1.7 ms average step, 4.1 ms worst. Graphics: 95% of frames under 9.3 ms at every quality tier, but average frame rates were dragged down by one-off stalls when switching tiers; the lab-3 build warms each tier up first, reports stalls separately and fixes the GPU timer (it was adding up several frames).
- Jolt (single-thread WebAssembly build) on the same rubble test: 3.0 ms at 500 stones, 12.9 ms at 1,000, 22.5 ms at 2,000. No faster than Rapier's deterministic build, and its browser determinism is unproven. Multithreaded Jolt needs special page headers (cross-origin isolation), so it can only be tested once the game is hosted on Cloudflare.
- Second real device (lab-3 build, Kat's laptop: Apple M3, Chrome, WebGPU, 60 Hz): matched the reference hash bit for bit. Physics budget about 550 moving stones in 6 ms (about 780 in 12 ms); scripted siege 9.3 ms average step, 37 ms worst. The SIMD build measured slower than the deterministic one on this run, which points to a busy or throttled machine, so treat these as a floor. Graphics: 60 fps on Low, Medium and High (High recommended), Ultra about 30 fps with stalls. With no iPad, this laptop is the weakest supported device and sets the physics floor, so the 600-stone target stands.
- The first step after building a castle costs about 120 ms (the broad phase is built): do it during loading.
- Freezing settled rubble keeps a ruined castle cheap; without it, rubble piles keep waking up.

## Spikes

The lab page: https://claude.ai/artifact/GHqbFzcvN2tPt7wkhSm7NN (private to the owner; share it from its Share menu for other devices or people). Source in `lab/`; `npm run lab:build` writes `lab/dist/artifact.html` plus `lab/dist/assets/`.

1. Physics budget and determinism on every target device: the lab page.
2. The look on the weaker devices, and the art style choice: the lab page.
3. Online lockstep over the internet: needs the repo connected to Cloudflare (artifacts cannot open network connections).

## Findings from phase 1 (the sandbox)

- Headless Chromium replays the scripted sandbox session (all four weapons, drag, wind, spin, fuses, ragdolls, craters) to the same hash as Node, bit for bit (`npm run check:browser`).
- Real gravity makes mortar flights too long at 150 m (6 to 7 s): lobbed shells use a gravity multiplier (3.2x) so they land in 3 to 4.5 s. The aim preview applies the same multiplier and matches the sim to about 0.1 m.
- A partial arc gives too little information for a lobbed weapon: the sandbox defaults to the full predicted arc with a landing ring; the partial arc stays as the harder setting.
- The lab's castle layout mirrored castle 1's tower wedges inside out; the fix is a layout option so the lab's reference hash stays valid.
- Weapon tabs kept keyboard focus, so Space pressed them: game keys must preventDefault and buttons must blur after a click.
- The mortar as a big event: a burst throws masonry only if pieces below its centre are thrown up too (pushed down they hit fixed stone and stop). With an upward share of 1.1 and 30 m/s at the centre, a shell on a wall top throws 20 to 40 stones high and loosens about 60; on a tower top about 170. The worst single step after a burst was about 20 to 26 ms on the cloud server (once), then 3 to 4 ms.
- Headless Chromium renders the sandbox at about 1.4 frames per second in software, so real-time camera moves cannot be judged from it. The page has a test clock (`#fixed` in the address: 1/30 s per frame, the sim stepping in lockstep), and `node tools/sandbox-shots.mjs` screenshots every camera view, including a whole shell ride, into `tools/.shots/`.
- The aim help now casts the predicted flight against the stones (the renderer's own copy, with current positions) and the terrain, near the castles only, in well under a millisecond per frame.
- Frame pacing: the worker posts frames at uneven moments (a 4 ms timer, catch-up steps), so drawing each frame as it arrives makes fast shells jump and a camera tied to them shake. Drawing on a render clock two ticks behind the newest frame, between frames, fixes it for 33 ms of display delay; aiming is unaffected (it runs on the page).
- The first burst of a session was the slowest: engines compile hot code lazily. The support check took 20 ms on its first run and 1 to 3 ms after; Rapier's first contact-heavy steps took about 20 ms, later 5. A throwaway rehearsal at load (about 0.6 s on the cloud server, overlapping the renderer's start) makes the first burst as quick as any other.
- Drawing cost of a burst: overdraw, not geometry. Seen from the ride camera (about 40 m), the impact dust alone covered the screen about twice over (44 puffs up to 12 m wide) and the smoke column, ground dust and fireball added more, at Ultra's doubled pixel density. Capping a puff at 30% of the screen's height and thinning the layers keeps the look; dynamic resolution (the scene pass's `setResolutionScale`, applied next frame) absorbs what is left, so the tier never has to drop for a burst. Software rendering in headless Chromium measures before/after ratios only (`node tools/burst-cost.mjs ultra`).

## Findings from phase 2 M2 (waves)

- Flow fields: eight fields (three routes and a breach field per team) over 144 by 208 cells. A full build is about 2.4 ms per field once the engine has compiled it (about 7 ms the first time); spread at 2,500 cell visits a tick it costs about 0.2 ms a tick and refreshes all eight in about 1.4 s. Rebuilding only on topology changes (a step opening or closing) keeps them idle most of the time; a blown bridge or a burst in a field triggers a full refresh while the debris settles.
- A route weight (2 on the route, up to 6 far off it) keeps waves on their routes; with the centre bridge down both flank detours cost the same, so the field's watershed split a wave down the middle. Rerouting is decided per wave instead: the nearest bridge still standing, together.
- Pikemen think in id order and see each other's latest positions; 16 seeded 8-against-8 clashes showed no advantage for the side spawned first. Fights are short and decisive (about 6 s).
- Ragdolls thrown by a burst kept tumbling for over 10 s under the patrol's settle rule; army bodies are damped after 3 s and frozen once nearly still after 8 s (the patrol keeps its rule, so the Practice range's hash holds).
- A breach is only a breach if you can walk it: a long gun shot high on a wall leaves a 3 m stub of the lower courses; shots at the foot of the wall open a gap to the ground (the debris is blasted into the courtyard).
- Cost on the cloud server: the army's own thinking is about 0.15 ms a tick for 30 to 50 pikemen; the world's step grows from 2.2 to about 3.9 ms as the fallen pile up to about 110 bodies. To measure on both laptops with a full field.

## Findings from phase 2 M5 (the AI castle, online play, the sturdy keep)

- What toppled the keep in seconds was two things: a long gun blast reaches 4.7 m (everything within 3 m turns to dust) on a 10 m keep with 1.4 m walls, and its ball kept 85% of its speed and blasted the far wall too; and a ball that clipped the banner pole knocked it off the keep, which counted as toppled. With the mortar's long lob, the keep went in 10 to 18 s to a perfect gunner. Hardness alone (blasts reaching half as far) gained little while balls could still break the floors from inside: what made the keep a siege was floors only shells break (two each), a bigger bridging span for the dressed stone, and shots passing the pole.
- The mortar could not reach the middle of the enemy keep's roof at 82 m/s (the farthest it came down at 20 m high was the inside edge of the front wall), so against a sturdier keep it could not break floors; 84 m/s reaches z 7.4 at roof height. The aim solver's long lob starts at the elevation of longest reach (about 0.83 rad with the shell's drag), not below it.
- A ragdoll set down a little inside a deck plank is pushed out by the solver with over half a meganewton, past the 450 kN that breaks a piece: every fight on a bridge broke the bridge, and in AI matches all three were down by 2:30 and the valley was cut. Contact forces from men, ladders and kegs no longer break pieces.
- A big heap never sleeps while any stone in it jostles: a wall front brought down by a Warlord's siege kept 1,000 to 1,450 stones moving (40 to 56 ms a step on the cloud server) for about 35 s and over 550 for 55 s. Freezing stones that are merely slow (under 0.2 m/s and 0.5 rad/s for a second) cut the peak and the time, but frozen stones then woke under the weight of the heap above them (half a meganewton in a deep heap), over and over: 9,771 thaws in 40 s with about 230 stones moving for good. Waking frozen rubble only for a blow (the other body faster than 2 m/s) fixes it. Freezing slow stones everywhere also froze rubble on wall tops and in the keep's shaft, where it caught later shells, so it acts only during a big collapse (over 300 stones moving): the same collapse then peaks near 600, its worst step is 22 ms instead of 109, and a Warlord against a Knight never had more than 300 stones moving (5.3 ms a step on average, was 8.9).
- Lockstep needs one order for a tick's inputs on both machines: each page queues its own input at once and the friend's when it arrives, so the arrival order differs; the match now applies them team by team.
- The room's presence holds 4 KiB per page: the lockstep state sends the oldest unacknowledged inputs that fit and promises only up to the first one left out.
- On this server two headless pages, each rendering in software, delay each other's messages by seconds (the main thread is starved), so the online check measures correctness, not latency. The real round trip over the room is not known yet.

## Findings from phase 2 M3 (gold and building)

- Buildings are masonry: every kind of building is laid out on every plot from the start and withdrawn (its bodies disabled) until it is built, so no body is ever added to the world mid-match; the frame's piece slots, the support groups and the hash all stay fixed. The game layout is 10,303 pieces (each castle 636 building pieces in waiting); a withdrawn piece is a disabled body, which Rapier leaves out of the step.
- A building goes up a piece at a time only where its place is clear: the pieces of a ruin are put back where they stood, so bodies lying there are buried, frozen rubble is carried off, and the living are waited for (otherwise a piece would appear inside a man or a stone and the physics would throw both).
- A keg at the foot of a wall made no breach at first: a burst outside the face only lifted the lower courses into the courses above, and they settled back where they were. Packing the charge into the foot (0.7 m into the wall, 0.7 m up) and turning most of what it reaches to dust leaves a 3 m gap to walk through, under the courses that still bridge it.
- The world now records why every minion went down (a ball, a burst, masonry, a pike, a fall, a musket ball) with the shot or stone that did it, and which pieces fell; the match turns those records into gold and trick shots, so the sim knows nothing of gold.
- Sapper kegs set off by a hit are decided after the world's step from the same records, so a keg blown by your shot counts as your shot (a multi-kill waiting to happen).
- Wave mixes, measured on open-field clashes on the centre road (5 or 6 seeds, from both sides, survivors after 30 s): with musketeers hitting 60% close in and 14% at 26 m and reloading in 4 to 5.3 s, a Volley wave won 8 of 10 against Pikemen and left almost nobody standing. At 50% and 12% and 4.3 to 5.7 s it wins 7 of 12, a Mixed wave breaks even and a Breach wave loses 6 of 10. Only pikes batter a gate (sappers and musketeers wait at it), so Pikemen keep a job of their own.
- A mortar shell in the middle of a wave downs most of it by design, so a multi-kill bonus for 3 would have paid on every good shell: the threshold is per gun (the long gun and the chain shot 3, the swivel 4, the mortar 6).
- The match reports to the page with every frame, so an overlay rebuilt from those reports (the build wheel) must redraw only what changed and act on the press: a click whose press and release fall on two different drawings never fires.
- Headless screenshots of a match on the real clock starved the sim when the machine was busy (the software renderer took the CPU): the estate shots run the match on the test clock (#fixed) and draw in a small window while they wait for game time.

## Findings from the playtest pass (after M5)

- The AI's gold comes mostly from your keep: a long gun hit on it pays about 30 gold (the keep-hit trick and its masonry), so a Squire firing every 5.5 s from 0:05 had its whole ten-minute build plan done by 2:25 (a plan step hurries once gold piles up). A warm-up before its first shot and a slower look after each landing put it back near its plan.
- Only shells break keep floors, so an AI that never fires its mortar cannot topple a keep its masons pay for: Knight against Knight stood at 10:00 with both banners on their roofs and 3,000 gold banked each. The mortar check compared "loaded" with the reload plus the time to settle in on the gun, which only the Warlord's settling passed.
- A gun's line of fire is not free inside its own castle: the back tower looks out over its own front tower, and a pit 2.4 m behind a 20 m keep cannot lob over it at the mortar's highest elevation (77 degrees). A height model of the castle as built (walls with battlements, towers, keep) flown against the predicted shot in still air catches these without a physics query, deterministically.
- A powder keg is a burst that walks: a swivel shot fired near a deck set off one sapper, and his burst the next. Guns nobody mans must count their own error (2 to 3 m plus 8 to 10 cm a metre of range) and the keg's reach when they keep clear of a bridge.
- A page that resets its worker must ignore what the old world still says: one frame in flight after Restart was enough to re-arm the end screen and give false notes, and a stale frame at the head of the timeline's queue blocked every new one until the new clock passed it. Numbering each world and stamping every message with it fixes all of it at once.
- Lockstep pacing must age the friend's tick: it is heard half a round trip late, plus the time since, so with 50 ms each way both pages read themselves 3 ticks ahead and both eased off to 92% speed.
