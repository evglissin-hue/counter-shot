# Keepfall: Game Spec (draft 0.1)

Keepfall is a working title. This draft is for review. Three things are still open and marked **Pending**: the art style (the owner is comparing three in the lab), the physics budget on the iPad and the second laptop (lab runs), and how online play feels over the internet (needs the Cloudflare hookup). Decisions and findings so far are in `docs/plan.md`.

## 1. Concept

Two castles face each other across a valley. You defend yours and attack theirs at the same time. You fire siege weapons yourself, in first person, at the enemy castle and at the minions marching on yours. Meanwhile your castle earns gold, trains minions who march on the enemy, and unlocks abilities. Physics drives everything: castles are real masonry that breaches and collapses, minions get knocked flying, rubble blocks routes. The main way to win is to topple the enemy keep until its banner hits the ground.

Real time, 10 to 15 minute matches, fun from the first game, with a high skill ceiling.

**Pillars**

1. **Physics is the game.** Damage is destruction, defence is masonry and positioning, and winning is a collapse. Nothing important is a hit-point bar.
2. **Your aim matters most.** A shot you fire yourself is far better than automatic fire, and trick shots pay.
3. **Light RTS, no grind.** Few decisions with big consequences. Repetitive work is automated, and everything is on hotkeys.
4. **Readable chaos.** You can always tell where shots are going, what is about to fall and what threatens you.
5. **Same match on both screens.** The simulation is deterministic, so online play sends only inputs.

## 2. Platforms, players and modes

- Desktop browsers (Chrome, Edge, Firefox, Safari) on Windows and Mac, plus iPad (Safari, touch only) for co-op. No phones.
- Input: keyboard and mouse, gamepad, keyboard only, and touch on iPad. Mouse is never required.
- Modes, in build order:
  1. **Practice range** (solo): your castle and a target castle, no enemy. Learn the weapons. Includes a short guided first match.
  2. **Versus AI** (solo): an AI castle that plays by the same rules.
  3. **Online 1v1**: the MVP.
  4. **Online co-op**: two players share one castle against an AI castle. Later, wave defence.
  5. **2v2**: two players per castle, one day.
- Online rooms open by invite link. No accounts or matchmaking at first.

## 3. The battlefield

- Two castles about 150 m apart (to be tuned in playtests), on terrain generated from a seed and mirrored for fairness.
- **2 to 3 routes** between the castles (a central road and flank paths), shaped by hills, a river or ravine, and bridges. Physics can open or close a route: blow a bridge, drop a tower across a pass, start a landslide.
- **Deformable terrain**: big impacts leave craters. Steep slopes slide when disturbed (a deterministic landslide simulation on a terrain grid). Loose boulders can be knocked rolling.
- **Wind** changes every 30 to 60 seconds. Flags, smoke and a wind gauge show it, and it pushes every shot in flight.

## 4. Your castle

- One fixed layout per race in the MVP: curtain walls, towers, a gatehouse, the keep, and a courtyard with build plots. A castle designer comes after the MVP.
- **Real masonry.** Every stone is a physics piece (about 4,400 per castle in the lab). Each race builds with its own material and stone size.
- **Weapon emplacements** sit on towers and walls (6 to 8 per castle). Each holds one weapon you buy and upgrade.
- **Courtyard plots** (6 to 8) hold buildings.
- **Repairs**: masons rebuild destroyed sections over time, for gold, wherever the space is clear. Auto-repair can be switched on per section.
- **The keep** is the tallest structure, with the banner on top. Upgrades can reinforce it (buttresses, thicker base).
- **Physics picks no sides.** Your own falling tower crushes your own buildings and minions.

## 5. Shooting

- **You ride the weapons.** Number keys 1 to 8 (or the bumpers) jump between emplacements, and the camera sits behind the weapon's sight. Tab opens the overview: both castles, routes and minions from above.
- **Aiming.** The mouse turns and tilts the weapon, but each weapon has a top turning speed (heavy guns swing slowly, so you lead your targets). Keyboard and gamepad turn it at a steady rate, with a fine-aim modifier; there is no fast FPS-style aiming on a stick. Scroll or the zoom key zooms the sight.
- **Power.** Some weapons fire at a fixed speed (cannon). Others charge: hold to draw a ballista or load a counterweight.
- **Real ballistics**: gravity, air drag (heavier and smaller shots carry further), wind, spin for some projectiles (they curve), ricochets off stone at shallow angles, skipping across water, rolling down slopes.
- **Aim help**: the first part of the flight path, its length set by the weapon and upgrades; a ghost trail of your last shot from this emplacement; a marker where it landed. Co-op and casual games show more of the path.
- **Reloads** are per weapon (about 3 to 10 seconds). Weapons nobody is manning fire at minions on their own, slower and much less accurately.
- **Shot camera**: optionally follow your shot, with slow motion on impact. It only changes your own camera; the match runs on. Replays come free, because a match is just its inputs.
- **Trick shots** are recognised and pay gold: ricochet kills, collapse kills (masonry you dropped landing on minions), multi-kills, skip shots, long-range keep hits.

## 6. Physics and destruction

Proven in the lab:

- **Masonry** stays put until hit, so an intact castle costs almost nothing to simulate.
- **A hit** shatters the stones at its core, which turn to dust and chips and leave the simulation. It knocks the ring around them loose and scatters it.
- **Heavy falling debris** knocks more pieces loose.
- **Support check**: masonry can bridge a gap of at most two stones sideways. Anything left unsupported falls.
- **Settled rubble** freezes back into static stone, and thaws when hit again.

To build:

- **Materials** with different mass, strength and how they break: granite, brick, timber, iron (gates and bands). Fire spreading on timber comes later.
- **Minions** are animated characters while unhurt (cheap). They turn into ragdolls when hit hard, killed or knocked off their feet, and freeze once settled.
- **Gore**, with a setting: blood marks on the ground and stone, and limbs that come off under heavy hits. Default on, one switch to turn it off.
- **Terrain**: craters (the physics ground is an editable height field) and landslides.
- **Chain reactions**: powder kegs, boulder piles, towers falling onto other structures.
- **Cosmetic layer**: chips, dust and small fragments run on the graphics card. They differ per device and never touch gameplay.

**Determinism rules** (online play depends on these):

- Fixed 60 Hz steps.
- Deterministic maths only (`detmath`, no `Math.sin` or `Math.random`).
- Ordered iteration, and no wall-clock time in gameplay.
- Every gameplay action enters the match as an input tagged with its tick.
- Rooms remember a rules version, bumped whenever the same inputs would play out differently.

**Budget (Pending: iPad and second laptop).** Both machines in a match simulate everything, so the weaker one sets the limit. Target: at most about 600 stones moving at once at 60 Hz on the weakest supported device. The Apple M4 Mac manages about 1,460 in 6 ms per step.

## 7. Economy and buildings

**Gold** comes from:

- Steady income from the keep.
- Income buildings.
- Bounties for kills.
- Gold for enemy masonry you bring down.
- Trick-shot bonuses.

You spend it on buildings, weapons, upgrades, repairs and abilities. There are no workers to manage.

**Building**: press B for the build wheel, pick a plot, pick a building. Build times are short (10 to 20 seconds), so you are never stuck waiting. Most buildings have two or three upgrade levels, and upgrades are trade-offs rather than pure power.

**Kinds of building**:

- **Economy**: more income, cheaper repairs.
- **Defence**: weapon emplacements, auto-firing watchtowers, wall reinforcement.
- **Offence**: barracks (minions), siege workshops (rams, ladders, siege towers).
- **Unlocks**: race buildings that unlock abilities and advanced weapons.

## 8. Minions

- **Barracks** spawn a wave on a timer (about every 25 seconds). Per barracks, you set the mix of units and which route the wave takes.
- **Orders** go to all your waves, by hotkey: **Advance** (default), **Hold** (stop at the midfield marker), **Push the breach** (head for the nearest gap in the enemy walls).
- **Pathfinding** uses a flow field over the terrain that updates as rubble and craters change it. Minions climb small rubble and go around big piles. Intact walls stop them, so they ram the gate, climb ladders, blow walls with sappers, or pour through breaches.
- **Fighting** is simple contact combat. Minions inside the enemy courtyard count towards storming it.
- **Numbers**: up to about 60 to 100 alive per side at the peak. Dozens, not hundreds, so each one is a proper physics body when it matters.

## 9. Winning

- **Topple the keep**: the banner on the enemy keep hits the ground.
- **Storm the courtyard**: your minions hold the enemy courtyard for 20 seconds, outnumbering the defenders inside.
- **Sudden death** at 15 minutes, so matches end: income doubles and reloads speed up.
- You can also surrender.

## 10. Races (first two)

Each race rests on a different branch of physics, plays at a different skill curve, and leans towards a different way to win. Numbers are starting points for balancing; the content lives in data files.

### Ashwright Guild (the MVP race)

Human gunsmiths: gunpowder, brass and clockwork. Their castle is brick and timber with iron-banded gates: quick to build and repair, but thinner walls. Medium difficulty, balanced between both ways to win.

| Weapon | How it plays |
|---|---|
| Long gun | A cannon. Fast and flat; the wall breaker. |
| Mortar | A high arc with a fuse you set: burst over minions, or bounce a shell behind a wall and let it blow there. |
| Chain shot | Two balls on a spinning chain. Scythes through ranks and cuts ladders and ropes; weak against thick walls. |
| Swivel gun | Grapeshot at short range: the last line against minions at your walls. |

| Minion | Role |
|---|---|
| Pikemen | Cheap line infantry. |
| Sappers | Carry powder kegs to the enemy walls to blow a breach. Shoot one on the way and the keg blows up among their own side. |
| Ladder crews | Scale intact walls. |
| Musketeers | Shoot enemy minions from range. |

| Building | What it does |
|---|---|
| Powder Mill | Income; unlocks fused shells. |
| Foundry | Weapon upgrades: heavier balls, rifled barrels for tighter shots. |
| Signal Tower | Unlocks the abilities below. |

| Ability | What it does |
|---|---|
| Barrage | Every manned and unmanned cannon fires at the point you mark. |
| Smoke screen | Hides your castle from the enemy's aim help for 20 seconds. |
| Powder trail | Lays kegs along a route and lights them as a wave passes. |

### Graniteborn

Stone giants and the people who live alongside them. Enormous strength, slow tempo. Their castle is granite in huge blocks: very sturdy, slow to build and repair, and (because the blocks are big) cheap to simulate. Easy to pick up, because the shots are big and forgiving; mastery is in the terrain, with rolling lines, landslides and quake timing. Leans towards toppling the keep.

| Weapon | How it plays |
|---|---|
| Boulder catapult | A huge stone that keeps rolling after it lands, crushing a lane of minions; devastating when it hits a wall. |
| Giant's sling | A giant whirls a boulder on a chain and you choose the moment to let go: timing sets the angle and power. The skill weapon. |
| Quake drum | Sends a ground wave down a route: knocks minions over, shakes already-cracked masonry down, sets off landslides on slopes. Medium range. |
| Shard thrower | Sprays stone splinters at short range against minions at your walls. |

| Minion | Role |
|---|---|
| Handlers | Cheap infantry. |
| Stone giant | Slow and huge. Smashes walls with its fists; falls apart into rocks when killed. |
| Rock rollers | Push boulders down a route ahead of a wave. |

| Building | What it does |
|---|---|
| Quarry | Income; faster repairs. |
| Giant's Hall | Trains giants. |
| Rune Stone | Unlocks the abilities below. |

| Ability | What it does |
|---|---|
| Landslide | Brings down a marked slope. Needs the right terrain. |
| Raise rock | Lifts a ridge of rock across a route for 30 seconds, blocking minions and shots. |
| Petrify | Your cracked walls set hard for 20 seconds: much harder to knock loose. |

Later races: Tidebound (water and ice) and Lodestar Order (magnetism and gravity), as proposed in `docs/plan.md`.

## 11. Co-op (after the MVP)

- Two players share one castle against an AI castle.
- **Soft roles**: Gunner (weapons, abilities) and Steward (buildings, repairs, economy, minion orders). The Steward can shoot too, and the roles can be swapped at any time.
- **The iPad player** suits the Steward: tap plots to build, drag a wave's route on the overview, tap ability buttons. To shoot, drag back from the weapon to set direction and power, then release.
- The laptop player is the Gunner, with mouse, gamepad or keyboard.
- In co-op the iPad simulates the whole match too, so it sets the physics budget for that match.

## 12. Controls (default bindings)

| Action | Keyboard and mouse | Keyboard only | Gamepad | Touch (iPad) |
|---|---|---|---|---|
| Aim | Mouse | W A S D (Shift: fine) | Left stick (right stick: fine) | Drag back from the weapon |
| Fire, or hold to charge | Left click | Space | Right trigger | Release the drag |
| Zoom the sight | Right click or scroll | Z | Left trigger | Pinch |
| Switch weapon | 1 to 8, Q and E | 1 to 8, Q and E | Bumpers | Tap a weapon |
| Overview | Tab | Tab | View button | Overview button |
| Build wheel | B | B | Y | Tap a plot |
| Abilities | F, G, H | F, G, H | X, then pick | Ability buttons |
| Orders: advance, hold, push | Ctrl+1, Ctrl+2, Ctrl+3 | Ctrl+1, Ctrl+2, Ctrl+3 | D-pad | Order buttons |

## 13. Look and sound

- **Art style: Pending.** The lab offers Warm (storybook), Gritty (grim siege) and Low-poly (clean diorama) on the same scene.
- **Assets**: no artist. Castles, terrain and foliage are generated in code; characters come from free asset packs or AI-generated models.
- **Sound**: free libraries plus procedural impacts that vary with material and mass.

## 14. Technical architecture

- **Monorepo** (TypeScript, npm workspaces), with packages that may depend on each other only through declared imports, as in Castle Artillery:
  - `core`: deterministic maths, the random generator, shared types.
  - `sim`: physics world, masonry, projectiles, minions, terrain.
  - `rules`: economy, buildings, waves, winning.
  - `content`: races, weapons, castles as JSON.
  - `ai`, `net`, the client app (rendering, input, interface), and the server.
- **Simulation**: the Rapier deterministic build runs in a worker at a fixed 60 Hz and owns all gameplay state. The main thread renders interpolated transforms and the cosmetic layer.
- **Netcode**: deterministic lockstep.
  - Each player sends inputs every tick, batched.
  - An adaptive input delay of 3 to 8 ticks (50 to 130 ms) hides latency. Aiming and the camera respond instantly; a fire command carries the exact aim and enters a few ticks later, covered by the fuse and recoil animation.
  - Both machines exchange a state hash every second to catch desyncs. On a desync the host sends a world snapshot.
- **Rooms**: a Cloudflare Durable Object relays inputs over WebSocket. Peer-to-peer comes later, if latency calls for it.
- **Rendering**: Three.js WebGPU renderer with a WebGL2 fallback, instanced masonry and procedural materials. On first launch, a quality tier is chosen automatically by the same benchmark the lab runs.
- **Content is data**: weapons, minions, buildings, races and castles are JSON files, with behaviour in small modules.
- **Testing**:
  - A determinism check runs scripted matches in Node and compares state hashes with references (`lab/scripts/bench-node.ts` is the seed of this).
  - Headless browser runs check the pages.
  - The lab page checks real devices.
- **Hosting**: Cloudflare, with a preview link per branch, as in Castle Artillery (to connect later).

## 15. Build phases

Each phase ends with a playable, deployed version.

0. **Lab** (done): device test, three art styles, masonry destruction, determinism across browsers and chips.
1. **Sandbox**:
   - An Ashwright castle facing a target castle, with all four weapons and real ballistics (drag, wind, spin).
   - Aim help, the shot camera, craters, and test minions that ragdoll.
   - Choose the art style.
2. **A full match versus the AI**:
   - Build plots, buildings, gold and upgrades, repairs.
   - Barracks and waves with flow-field paths, orders, routes that physics can close.
   - Both win conditions, the AI castle, and the guided first match.
3. **Online 1v1** (completes the MVP): lockstep over Cloudflare rooms, invite links, desync checks.
4. **Graniteborn**: the second race, with landslides and quakes.
5. **Co-op**: roles, the iPad Steward, vs AI, then wave defence.
6. **Polish**: sound, gore, more maps, 2v2.

## 16. Open questions

- Art style (lab).
- Physics budget on the iPad and the second laptop (lab).
- How lockstep feels over a real connection (needs Cloudflare).
- Castle distance and match pacing (playtests).
- The final name.
