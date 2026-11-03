# Counter-Shot: planning notes

Working notes from the planning conversation. The spec (`SPEC.md`) comes after the test spikes.

## The game in one paragraph

A browser game where two castles face each other across a field. You fire siege weapons in first person at the enemy castle and at the waves of minions marching on yours, while running a light RTS layer: buildings that defend, buildings that attack, buildings that unlock abilities. Physics is the point: castles are real masonry that cracks, breaches and collapses; minions get knocked flying; terrain matters. Two ways to win: topple the enemy keep until its banner hits the ground, or storm their courtyard with your minions and hold it.

## Decisions so far

| Topic | Decision |
|---|---|
| Platforms | Desktop browsers (Windows, Mac) and iPad. No phones. The 2019 MacBook Air is not a target. |
| Audience | The owner, Kat and friends, via invite links. |
| MVP mode | Online 1v1. Later: online co-op (two players, one castle, vs AI) on two laptops or a laptop and an iPad; one day 2v2. |
| Against the AI | Both an AI castle playing by the same rules (first) and wave defence (later). |
| Co-op roles | Soft roles: Gunner (shooting, abilities) and Steward (buildings, repairs, economy, minion orders); the Steward can shoot too; swap any time. |
| How you play | You ride the castle's weapons: number keys or bumpers jump between cannons, mortars, ballistae; an overview camera for building. No walking around. |
| Unmanned weapons | Fire at minions on their own (the tower defence half). Manual control is far more accurate and allows trick shots. |
| Aim help | Only the first part of the flight path is shown, plus a ghost trail of your last shot. More help in co-op and casual, less in ranked; some buildings and races extend it. |
| Win | Topple the keep (banner hits the ground) or storm the courtyard (minions hold it for 20 s). |
| MVP physics | Castle collapse, minions knocked flying, craters and landslides, wind, chain reactions. Water and fire later. |
| Destruction look | Masonry: castles of real stones that crack and crumble. |
| Physics picks no sides | Your own tower can fall on your own buildings and minions. Plus some gore (with a setting to turn it off). |
| Building | Fixed build spots in the castle with upgrades for the MVP; a castle designer after the MVP. |
| Minions | Barracks spawn them; you set the mix and give a few hotkey orders (advance, hold, push the breach). 2 to 3 routes that physics can open or close. |
| Economy | Kills and trick shots earn gold. |
| Match length | 10 to 15 minutes. |
| Races | New races (proposals below); fall back to Castle Artillery's peoples if these do not land. |
| Art style | Undecided: the lab shows three candidates on the same scene. |
| Art assets | No artist: code-built castles and terrain, free asset packs and AI-generated models. |
| Stack | Same as Castle Artillery: TypeScript monorepo, Cloudflare, a preview link per branch, several Claude sessions in parallel. |

## Race proposals (for review)

Each race is built on a different branch of physics, has a different skill curve, and leans toward a different way to win.

| Race | Physics | How they play | Difficulty |
|---|---|---|---|
| Ashwright Guild (human gunsmiths) | Explosives and ballistics | Long guns, mortars, fused bombs that bounce before they blow, chain shot; sappers who carry powder kegs (shoot them early and they blow up among the enemy). Balanced between both ways to win. | Medium: the MVP race |
| Graniteborn (stone giants and their handlers) | Mass and momentum | Huge slow shots: boulders that roll downhill, a wrecking ball you swing and release, quakes that shake weakened walls down. Few, enormous minions. Very sturdy castle, slow to build. | Easy to pick up, brutal |
| Tidebound (coastal raiders) | Water and ice | Harpoons on ropes that pull walls down, flood the routes by opening sluices, freeze water into bridges or walls, shots that skip across water. Needs the water simulation. | Hard: reading terrain and timing |
| Lodestar Order (astronomer engineers) | Magnetism and gravity | Shots that curve toward iron, gravity wells that bend every shot nearby (including the enemy's), lifting rubble and dropping it. The best at countering incoming shots. | Hardest, highest ceiling |
| Alternates | Ropes and tension (net and bola weavers); growth and decay (a swarm whose roots crack foundations over time) | | |

## What the name suggests

"Counter-Shot" could be a signature mechanic: shoot down or deflect incoming shots in mid-air (a fast light shot nudges a heavy ball off course). Both players fire in real time, so defending your castle with your own shots becomes a skill of its own. To confirm with the owner.

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
- Jolt (single-thread WebAssembly build) on the same rubble test: 3.0 ms at 500 stones, 12.9 ms at 1,000, 22.5 ms at 2,000. No faster than Rapier's deterministic build, and its browser determinism is unproven. Multithreaded Jolt needs special page headers (cross-origin isolation), so it can only be tested once the game is hosted on Cloudflare.
- The first step after building a castle costs about 120 ms (the broad phase is built): do it during loading.
- Freezing settled rubble keeps a ruined castle cheap; without it, rubble piles keep waking up.

## Spikes

The lab page: https://claude.ai/artifact/GHqbFzcvN2tPt7wkhSm7NN (private to the owner; share it from its Share menu for other devices or people). Source in `lab/`; `npm run lab:build` writes `lab/dist/artifact.html` plus `lab/dist/assets/`.

1. Physics budget and determinism on every target device: the lab page.
2. The look on the weaker devices, and the art style choice: the lab page.
3. Online lockstep over the internet: needs the repo connected to Cloudflare (artifacts cannot open network connections).
