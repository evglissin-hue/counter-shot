# Keepfall: Game Spec (draft 0.6)

Keepfall is a working title. Draft 0.1 was agreed by the owner and Kat, including the build order. Draft 0.2 adds the decisions since: the Gritty art direction (section 13), co-op as physics-driven wave defence (section 11), the second laptop's lab result with the quality tier defaults (section 6), and laptops only: no iPad or touch. Draft 0.3 adds the owner's phase 2 answers: the first map (section 3), the keep's timber floors (section 4) and fallen minions that stay (section 8). Draft 0.4 adds the owner's notes after phase 2 M5: guns that stand on the masonry and can be knocked out (section 4), the mortar's charge with a ring on the ground (section 5), and the chain shot's whirling chain (section 10). Draft 0.5 adds the direction the owner approved after phase 2 (November 10): a sixth pillar (section 1) and phase 3 in the build phases (section 15). Draft 0.6 records phase 3's first measurements (3.1, the observatory: sections 15 and 16); no rule changed. Sections 2 to 14 still describe the game as phase 2 left it; each phase 3 milestone folds its rules into them as it ships (`docs/phase-3.md` and the specs under `docs/phase-3/` say what is coming). Still **Pending**: how online play feels over the internet (needs the Cloudflare hookup). Decisions and findings so far are in `docs/plan.md`; the phase 1 plan is in `docs/phase-1.md`.

## 1. Concept

Two castles face each other across a valley. You defend yours and attack theirs at the same time. You fire siege weapons yourself, in first person, at the enemy castle and at the minions marching on yours. Meanwhile your castle earns gold, trains minions who march on the enemy, and unlocks abilities. Physics drives everything: castles are real masonry that breaches and collapses, minions get knocked flying, rubble blocks routes. The main way to win is to topple the enemy keep until its banner hits the ground.

Real time, 10 to 15 minute matches, fun from the first game, with a high skill ceiling.

**Pillars**

1. **Physics is the game.** Damage is destruction, defence is masonry and positioning, and winning is a collapse. Nothing important is a hit-point bar.
2. **Your aim matters most.** A shot you fire yourself is far better than automatic fire, and trick shots pay.
3. **Light RTS, no grind.** Few decisions with big consequences. Repetitive work is automated, and everything is on hotkeys.
4. **Readable chaos.** You can always tell where shots are going, what is about to fall and what threatens you.
5. **Same match on both screens.** The simulation is deterministic, so online play sends only inputs.
6. **Strategy you can shoot** (phase 3). Every capability of a castle is a thing that stands somewhere and breaks in its own way; shooting costs powder the castle must make; a keep falls because what held it up was cut. When a design call is unclear: you can shoot the tech tree.

## 2. Platforms, players and modes

- Laptops only: desktop browsers (Chrome, Edge, Firefox, Safari) on Windows and Mac. No tablets or phones.
- Input: keyboard and mouse, gamepad, and keyboard only. Mouse is never required.
- Modes, in build order:
  1. **Practice range** (solo): your castle and a target castle, no enemy. Learn the weapons. Includes a short guided first match.
  2. **Versus AI** (solo): an AI castle that plays by the same rules.
  3. **Online 1v1**: the MVP.
  4. **Online co-op**: two players defend one castle against waves of attackers (section 11).
  5. **2v2**: two players per castle, one day.
- Online rooms open by invite link. No accounts or matchmaking at first.

## 3. The battlefield

- Two castles about 150 m apart (to be tuned in playtests), on terrain generated from a seed and mirrored for fairness.
- **2 to 3 routes** between the castles (a central road and flank paths), shaped by hills, a river or ravine, and bridges. Physics can open or close a route: blow a bridge, drop a tower across a pass, start a landslide.
- **The first map** is a valley with a stream: a central road and two flank paths between low ridges, a stream across the middle with three timber bridges (one per route), crags and knolls on the valley sides. Point symmetric about the middle of the field, so each player sees the same valley from their own walls.
- **Deformable terrain**: big impacts leave craters. Steep slopes slide when disturbed (a deterministic landslide simulation on a terrain grid). Loose boulders can be knocked rolling.
- **Wind** changes every 30 to 60 seconds, and gusts on top of that: every few seconds it swells or slackens by up to a quarter and veers by up to 10 degrees. Flags, smoke and a wind gauge show it, and it pushes every shot in flight, so a gunner can wait for a lull.

## 4. Your castle

- One fixed layout per race in the MVP: curtain walls, towers, a gatehouse, the keep, and a courtyard with build plots. A castle designer comes after the MVP.
- **Real masonry.** Every stone is a physics piece (about 4,400 per castle in the lab). Each race builds with its own material and stone size.
- **Weapon emplacements** sit on towers and walls (6 to 8 per castle). Each holds one weapon you buy and upgrade. A gun stands on the masonry under it: bring that down, strike the gun square with a ball, sweep its crew off with chain shot or burst a shell beside it, and it is out of action until its crew puts it back (30 seconds, once the masonry under it stands again). Silencing an enemy gun pays gold, and it is the other reason to shoot at something besides the keep: the guns that shell your keep and shoot your waves.
- **Courtyard plots** (6 to 8) hold buildings.
- **Repairs**: masons rebuild destroyed sections over time, for gold, wherever the space is clear. Auto-repair can be switched on per section.
- **The keep** is the tallest structure, with the banner on top. It has timber floors inside: a shell caves in one level and the banner drops a floor at a time, so toppling it takes a siege (or bringing its walls down). Upgrades can reinforce it (buttresses, thicker base).
- **Physics picks no sides.** Your own falling tower crushes your own buildings and minions.

## 5. Shooting

- **You ride the weapons.** Number keys 1 to 8 (or the bumpers) jump between emplacements, and the camera sits behind the weapon's sight. Tab opens the overview: both castles, routes and minions from above.
- **Aiming.** The mouse turns and tilts the weapon, but each weapon has a top turning speed (heavy guns swing slowly, so you lead your targets). Keys turn it with weight: the gun gathers speed while a key is held and coasts to a stop when let go (heavier guns are slower to start and stop), so a tap is a fine correction. A gamepad stick turns it at the speed it is pushed. Both have a fine-aim modifier; there is no fast FPS-style aiming on a stick. Scroll or the zoom key zooms the sight.
- **Power.** Some weapons fire at a fixed speed (cannon). Others charge: hold to draw a ballista or load a counterweight. The mortar charges: hold fire and its meter fills from the nearest range to the farthest (and falls back if held too long); let go to fire. The nearest range is the shortest lob on that bearing that clears your own castle, so a tap never shells your own walls. Its elevation follows the charge, and it is aimed from a spotter's view over the keep (on the front wall when you look close), not from above.
- **Real ballistics**: gravity, air drag (heavier and smaller shots carry further), wind, spin for some projectiles (they curve), ricochets off stone at shallow angles, skipping across water, rolling down slopes.
- **Aim help**: the first part of the flight path, its length set by the weapon and upgrades; a ghost trail of your last shot from this emplacement; a marker where it landed; the barrel's elevation, as a gunner reads off a quadrant. For the mortar, while you charge, a soft ring on the ground where the shell would come down in still air (the wind is yours to read), and a mark on the meter where your last shot left. Aiming is the skill: you correct from your last shot and read the wind. The whole predicted flight is an easy setting. Co-op and casual games show more of the path.
- **Scatter**: no two shots fly quite alike. Each weapon throws a little off the aim and its charge varies a little (seeded, so a match still replays from its inputs): about half a metre for the long gun at the enemy keep, two metres for the mortar. Rifled barrels tighten it.
- **Reloads** are per weapon (2 to 12 seconds: the swivel quickest, the mortar slowest). Weapons nobody is manning fire on their own at enemy minions coming at your walls (the approach once the stream is crossed), slower and much less accurately; the mortar fires only when you fire it (one shell knocks down a whole wave).
- **Shot camera**: optionally follow your shot (on by default for lobbed shells: you ride the shell down), with optional slow motion on impact. It only changes your own camera; the match runs on. Replays come free, because a match is just its inputs.
- **Kill cams and replays** (after the MVP; the owner's request): the best physics moments come back as short replays from a cinematic angle, with a tally of the damage: a minion thrown across the valley, a limb taken off, a wall dropped on a wave, a tower brought down. In the spirit of Porrasturvat, where the fun is watching a body take every step of the fall. A replay re-runs the sim from a recent snapshot with the recorded inputs, so it shows exactly what happened, and it can slow down and circle the moment freely.
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

**Budget.** Both machines in a match simulate everything, so the weaker one sets the limit. Target: at most about 600 stones moving at once at 60 Hz on the weakest supported laptop. Measured in the lab (deterministic build, moving stones that fit in 6 ms per step):

| Device | Physics budget | Scripted siege, average step | Graphics |
|---|---|---|---|
| Owner's Apple M4 Mac (Chrome, WebGPU, 120 Hz) | about 1,460 | 1.7 ms | Every tier under 9.3 ms for 95% of frames |
| Kat's laptop (Apple M3, Chrome, WebGPU, 60 Hz) | about 550 | 9.3 ms | 60 fps on Low to High; Ultra about 30 fps |

Both matched the reference hash bit for bit. Kat's laptop is the floor among supported devices, so the 600 target holds, and the support check, freezing and the shatter core must keep peaks there. A siege on her laptop averages 9.3 ms against a 16.7 ms frame, so the step must stay in the worker.

**Quality tiers.** Low, Medium, High and Ultra change only the look (shadows, post effects, scatter density, chip and dust counts, resolution scale), never the simulation. Defaults:

- First launch runs the lab's quick graphics test and picks the highest tier whose 95th-percentile frame fits the screen's refresh (with a 60 fps floor).
- Without a test result: High. Ultra is never picked automatically on a 60 Hz screen if High already fills it.
- A frame-time guard drops one tier after 5 seconds of missed frames, and says so.

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
- **Pathfinding** uses a flow field over the terrain that updates as rubble and craters change it. Minions scramble over rubble heaps and the fallen and go around what is too steep; standing masonry is a wall. Intact walls stop them, so they ram the gate, climb ladders, blow walls with sappers, or pour through breaches. A wave whose bridge is down takes the nearest one still standing.
- **Fighting** is simple contact combat. Minions inside the enemy courtyard count towards storming it.
- **Bodies stay** all match as frozen physics debris (cover, ramps, blockages on the routes); past a few hundred the oldest sink into the ground to keep the physics budget.
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
| Chain shot | Two balls on a whirling chain, and the chain itself sweeps a path as wide as it is: it mows down ranks, knocks ladders off walls and sweeps gun crews away (the gun that silences guns); weak against stone. |
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

## 11. Co-op: hold the keep (after the MVP)

Two players defend one castle against waves of attackers: a tower defence where every attacker is a physics problem, not a hit-point bar. Each enemy is defined by its mass, shape, armour and the way it moves, so the right answer changes from wave to wave: a shot that scythes through pikemen bounces off a shield wall, and a wall that stops infantry is exactly what a ram wants. Solo versus an AI castle stays as its own mode.

**The map.** Your castle on high ground, attackers entering from one to three approaches (the same terrain generator as the duel, not mirrored). Waves come in rounds of about 60 to 90 seconds with a short lull between them for building and repairs. A run is 12 to 20 waves, about 20 to 30 minutes.

**What attackers do to your castle.** Attackers win by physics too: rams and sappers breach walls, giants and trebuchets bring down towers, climbers get over intact walls, and the run is lost when the keep's banner falls or the attackers hold the courtyard for 20 seconds. Your own shots can drop your own towers on them (and on your own buildings).

### The roster

Every enemy below is a different physics problem. Numbers are starting points; the roster lives in data files.

| Enemy | Its physics | How you counter it | What it does to your castle |
|---|---|---|---|
| Levy | Light (70 kg) single body, ragdolls easily | Anything: grapeshot, chain shot, falling rubble | Little on its own; fills breaches and storms the courtyard |
| Shield wall | A rank of 8 to 12 locked together by joints; big tower shields are heavy plates that deflect shots and make shallow hits ricochet | Hit the flank or drop shells behind it (mortar fuse); a steep plunging shot breaks the lock; a heavy ball at the right angle tears a gap | Escorts rams and sappers to the wall untouched |
| Armoured knight | Heavy (140 kg) with plate armour: glancing hits ricochet off, only near-square hits knock him down | Square, heavy, close hits; or knock him off a bridge or ledge | Holds breaches, kills your repair crews |
| Cavalry | Rider and horse as two linked bodies, fast (12 m/s), big momentum; the rider is thrown when the horse falls | Lead the shot; caltrops and craters trip horses; a fallen horse blocks the road for the next riders | Reaches the walls first and rides down gate crews |
| Swarm | 30 to 60 tiny, light bodies (goblin-sized) spread wide | Splash, not precision: mortar air bursts, swivel guns, landslides | Climbs rubble anywhere; floods the courtyard if ignored |
| Climber | Grapnel on a rope (a jointed chain) hooked to a merlon | Cut the rope with chain shot or shoot the merlon off; a falling climber knocks the ones below off | Gets over intact walls; opens the gate from inside |
| Ram | A heavy log on a wheeled frame under a roof that sheds glancing shots; rams the gate with real impulses | Break a wheel to stall it, set the roof alight later, or drop masonry on it | Breaks gates and walls with repeated hits |
| Sapper | Carries a powder keg; the keg explodes when hit | Shoot the keg on the way and it blows up among its own side | Blows a breach where it reaches the wall |
| Siege tower | A tall timber tower of jointed sections pushed on wheels; it collapses section by section | Hit the lower sections to topple it, ideally onto the wave behind it | If it reaches the wall, a ramp drops and a wave crosses onto your walls |
| Trebuchet | A counterweight engine set up out of your easy range, with real arm and sling physics; it throws boulders that knock your masonry loose like your own shots | Long-range trick shots, a mortar at full charge, or a sortie of your minions | Takes towers apart from a distance; forces you to repair |
| Giant | Huge (2 to 3 t) jointed body, slow; only big impacts stagger it | Make it fall: hit a knee, drop a tower on it, start a landslide under it; its body becomes cover for the next wave | Tears stones out of walls with its hands, throws them |
| Digger | Tunnels under the terrain and changes the height field: trenches for cover, mines under walls | Spot the spoil heaps; shell the tunnel line to collapse it; a flooded or blocked tunnel stops them | Undermines a wall section, which slumps and falls |
| Bridge crew | Carries planks and lays a bridge across a ditch or river | Shoot the bridge, ideally with a crew on it | Opens a new approach the wave director can use |
| Shaman (late) | Raises a ward that bends shots near it, or makes the ground slide | Shoot it first: it is light and exposed | Turns the terrain against your defences |

Rules that keep the roster honest:

- **Armour is geometry, not a multiplier.** Shields and plate are real colliders with their own restitution. The angle of the hit decides whether a ball ricochets, glances or knocks the target down, so a trick shot can bounce off a shield into the next rank.
- **Formations are joints.** A shield wall is bodies held by breakable joints; enough force at one point breaks a gap and the rest fall into disorder.
- **Bodies stay.** Dead attackers, wrecked engines and fallen giants stay as physics debris (frozen once settled), so the battlefield fills with cover, ramps and blockages that the next waves must deal with.
- **Engines collapse for real.** Siege towers, rams and trebuchets are jointed timber that breaks into pieces, using the same freeze and thaw as masonry.
- **Budget aware.** A wave carries a physics cost (bodies, joints, ragdolls), and the director keeps the peak under the weakest device's budget.

### The wave director

Waves are built from the roster by a deterministic director (seeded Rng, so both players see the same run):

- Each wave has a **budget** that grows with the wave number, and each enemy has a cost.
- The director picks a **theme** per wave and **combines** units into packages that need two answers at once: a shield wall escorting sappers (break the shields or hit the kegs), cavalry with climbers behind them, a giant pushing a siege tower, a swarm screening a trebuchet, diggers under covering fire.
- It **reads the castle**: it targets breaches and weak sections, sends climbers to intact walls, and picks approaches your weapons cover least.
- It **reads the battlefield**: blown bridges, craters and rubble change which approaches are open and what can cross them.
- **Boss waves** every fifth wave: a pair of giants, three siege towers at once, a trebuchet battery.
- **Pressure** adapts slowly to how the defence is doing, within limits, so a strong team is pushed and a struggling one gets a lull.

### Roles

- **Gunner** rides the weapons, as in the duel, with full aim help. The fast reactions: picking off sappers, breaking shield walls, leading cavalry.
- **Steward** runs the castle: builds and upgrades in the lulls, sends repair crews to breaches, sets traps (powder trails, caltrops, oil), places barricades, calls abilities, and orders the castle's own minions to sortie or hold a breach, mostly from the overview with mouse, keyboard or gamepad. The Steward can also man a weapon, and the roles swap at any time.
- Both see a shared **threat strip** at the top: the next wave's packages and the approaches they will use, so the team can plan in the lull.

### Scoring

- The run's score is the waves held, plus points for kills (more for trick shots, collapse kills and engines destroyed), minus castle damage at the end.
- Medals per wave for clean defence (no breach), and per run for the best trick shot (saved as a replay, since a run is just its inputs).
- A shared high-score board per map and difficulty, kept by the room later; in the first version, on the device.
- Difficulty: Squire, Knight and Warlord change the wave budget growth and the aim help, never the physics.

## 12. Controls (default bindings)

| Action | Keyboard and mouse | Keyboard only | Gamepad |
|---|---|---|---|
| Aim | Mouse | W A S D (Shift: fine) | Left stick (right stick: fine) |
| Fire, or hold to charge | Left click | Space | Right trigger |
| Zoom the sight | Right click or scroll | Z | Left trigger |
| Switch weapon | 1 to 8, Q and E | 1 to 8, Q and E | Bumpers |
| Overview | Tab | Tab | View button |
| Build wheel | B | B | Y |
| Abilities | F, G, H | F, G, H | X, then pick |
| Orders: advance, hold, push | Ctrl+1, Ctrl+2, Ctrl+3 | Ctrl+1, Ctrl+2, Ctrl+3 | D-pad left (in turn) |
| Route of your next waves | L | L | D-pad right |

## 13. Look and sound

### Art direction: Gritty

The owner and Kat chose Gritty from the three lab styles. The game ships Gritty only; Warm and Low-poly stay in the lab as references and are not maintained.

**Mood.** A grim, cold siege late in a hard campaign: wet stone, mud, smoke drifting across the valley, the light of a low sun through haze. Heavy and believable rather than cartoonish, but never murky: the player must always read the battle (pillar 4).

**Palette.**

- Ground: muddy olive and grey-brown grass, darker trodden earth on the routes, wet black mud in craters.
- Stone: cool grey granite and limestone with green-grey lichen low down; Ashwright brick in dull red-brown with soot above every gun port; Graniteborn granite in heavy blue-grey.
- Wood: weathered grey timber, darker where wet; iron bands near black with rust.
- Sky: overcast blue-grey, a warm band near the horizon at dawn or dusk.
- Accents, used sparingly so they read: team colours on banners and minion tabards (Ashwright oxblood and brass, Graniteborn slate and ochre, attackers in co-op in sickly yellow-green), muzzle flashes, fire and fuse sparks in hot orange.

**Lighting.**

- One low key light (the sun at 10 to 25 degrees) with long shadows, and a cool sky fill. Shadows are what make masonry and craters read, so they are kept on every tier (cheaper on Low).
- Aerial perspective: distance fades to the haze colour, which separates the near castle from the far one.
- Time of day and weather are per map (overcast morning, stormy dusk, light rain); fog density is capped so the enemy castle stays readable.
- Tone mapping is filmic with gentle contrast; bloom only on fire, flashes and sparks.

**Materials.**

- Everything is generated in code from noise: stone faces with chipped edges and colour variation per block, mortar lines, grime that collects low and under ledges, wetness darkening at the base of walls.
- Damage shows on the surface: fresh breaks are lighter and sharper than weathered faces, and impacts leave soot and scorch.
- Realism without an artist means believable surface detail on simple shapes. CC0 photo textures (for example from Poly Haven or ambientCG) are allowed for detail maps such as stone, mud, bark and plaster, committed under `assets/textures/` with a `LICENCE` note per file (source, author, CC0). Procedural colour and wear still go on top, so no two blocks look stamped.
- Characters: low-detail bodies with strong silhouettes and painted cloth and metal; the physics shapes are simple capsules, so the look carries the detail.

**Readability rules.**

1. Silhouettes first: every unit type is recognisable as a black shape at 100 m (shields, lances, kegs, ladders, engine frames).
2. Team colour lives on large surfaces (banners, tabards, shields) and stays saturated against the muted world.
3. Threats glow: lit fuses, burning kegs and incoming boulders carry a small warm light so they read through smoke.
4. Aim help and interface marks use a cold white with a dark outline, never the warm effect colours.
5. Loose, about-to-fall masonry gets a subtle dust trickle, so you can see what is about to come down.
6. Smoke and dust thin out near the aim line and the crosshair, so effects never hide a shot.

**Gore.** On by default, one switch turns it off (blood becomes dust, severed limbs stay attached).

- Blood is dark, desaturated red-brown, never bright. Hits leave sprays and decals on ground and stone that fade over about a minute.
- Heavy hits (a direct cannonball, a falling block, a giant's blow) can take off limbs: the ragdoll splits at a joint, the limb becomes its own small body, and the stump gets a dark cap. No organs, no slow lingering.
- Gore is cosmetic: it never changes the simulation, so the switch is safe in online matches.
- Kill cams (section 5) favour the gruesome moments: severed limbs, bodies thrown far, collapse kills. With gore off they show the same falls without blood.

### Assets and sound

- **Assets**: no artist. Castles, terrain and foliage are generated in code; detail textures from CC0 libraries; characters from free asset packs or AI-generated models, with their licences committed alongside.
- **Sound**: free libraries plus procedural impacts that vary with material and mass. Gritty mood: low drums, wind, distant shouting; no heroic fanfare.

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
- **Rendering**: Three.js WebGPU renderer with a WebGL2 fallback, instanced masonry and procedural materials, in the Gritty style only. On first launch, a quality tier is chosen automatically by the same benchmark the lab runs.
- **Content is data**: weapons, minions, buildings, races and castles are JSON files, with behaviour in small modules.
- **Testing**:
  - A determinism check runs scripted matches in Node and compares state hashes with references (`lab/scripts/bench-node.ts` is the seed of this).
  - Headless browser runs check the pages.
  - The lab page checks real devices.
- **Hosting**: Cloudflare, with a preview link per branch, as in Castle Artillery (to connect later).

## 15. Build phases

Each phase ends with a playable, deployed version.

0. **Lab** (done): device test, three art styles, masonry destruction, determinism across browsers and chips.
1. **Sandbox** (planned in `docs/phase-1.md`):
   - The production monorepo with enforced package boundaries.
   - An Ashwright castle facing a target castle in the Gritty style, with all four weapons and real ballistics (drag, wind, spin, the chain shot as two linked balls).
   - Aim help, sight zoom, the shot camera, craters, a wind gauge, and test minions that ragdoll.
2. **A full match versus the AI** (done, `docs/phase-2.md`):
   - Build plots, buildings, gold and upgrades, repairs.
   - Barracks and waves with flow-field paths, orders, routes that physics can close.
   - Both win conditions, the AI castle, and the guided first match.
   - Online 1v1 in lockstep, brought forward: it runs over the claude.ai artifact's room. Cloudflare rooms and invite links are still to come.
3. **One game** (`docs/phase-3.md`; each milestone has its spec under `docs/phase-3/`): the parts of a match made to depend on each other, in this order:
   - the observatory (AI matches by the thousand, measured against targets; done in 3.1: `npm run observe`, `observe:quick`, `observe:openings`, `observe:prices`);
   - range and register; powder; the keep that falls by engineering;
   - machines; the household;
   - elements (fire, smoke, water, mud); the day (weather as the match's clock);
   - the valley as a board; armies with nerve and engines; the arsenal;
   - sieges for one (the Master Gunner's exam, the Daily Siege);
   - two seats (co-op in one castle, then the wave defence of section 11).
   Alongside, on the page only: the shot as a show (the impact cam, replays, a film of each match), the steward's ear (orders typed and spoken), and the look.
4. **Graniteborn**: the second race, with landslides and quakes.
5. **Later** (`docs/future.md`): the Castle Architect and sieges by post, the March (a campaign), more maps, 2v2.

## 16. Open questions

- How lockstep feels over a real connection (needs Cloudflare).
- Castle distance and match pacing: phase 3's targets (`docs/phase-3.md`) now say what pacing to aim for, and its observatory measures it. The first measures (3.1): Knight mirrors last a median 5.2 minutes and all end by keep; castle 0 wins 47.3% of 400 mirrors (no side bias); one opening (an early economy and Foundry) beats the stock Knight 8 of 8.
- The final name: Keepfall is the working title, and the repo's name counter-shot is to go. Candidates are under Name in `docs/plan.md`.
- Each phase 3 spec ends with a short "For the owner" list of choices that are the owner's.
