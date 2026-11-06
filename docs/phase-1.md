# Phase 1: the Sandbox

Goal: one player on an Ashwright castle, facing a target castle across the valley, in the Gritty style, firing all four Ashwright weapons with real ballistics, at masonry and at a handful of test minions. No economy, no AI, no network. Every gameplay rule runs in the deterministic sim and is covered by Node hash tests, so phase 3 (lockstep) inherits it unchanged.

Each milestone ends with the checks green, a commit and push on the phase branch, and a playable build published as a claude.ai artifact (one URL, updated in place), with a short note to the owner on what to try.

## Layout

```
packages/            DOM-free, deterministic where it feeds physics
  core/              @keepfall/core     detmath (dsin, dcos, dsqrt, Rng), hashing, vectors, tick clock
  content/           @keepfall/content  castle layouts (from the lab), weapons, minions, maps as data
  sim/               @keepfall/sim      Rapier world: masonry, projectiles, wind, terrain, minions, inputs
apps/
  sandbox/           @keepfall/sandbox  the playable page: worker, Three.js renderer (Gritty), input, HUD
lab/                 @counter-shot/lab  the device test page, now importing core, content and sim by name
tools/
  check-boundaries.mjs                  package boundary and determinism rules
  run-tests.mjs                         bundles each test with rolldown, runs it with node --test
```

Boundary rules (`npm run check` runs boundaries, then types, then tests):

1. A package imports another package only by its name (`@keepfall/core`), never by a relative path out of its folder.
2. Every bare import is declared in that package's `package.json`, at an exact version.
3. Packages under `packages/` are DOM-free: their `tsconfig` has no DOM library, and the check rejects `window`, `document`, `navigator`, `requestAnimationFrame` and storage APIs.
4. Determinism: in `core`, `content` and `sim`, the check rejects `Math.sin`, `cos`, `tan`, `atan2`, `exp`, `log`, `pow`, `sqrt`, `hypot`, `random`, `Date` and `performance`. (Render-only helpers live in `apps/`.)
5. Allowed direction: `core` <- `content` <- `sim` <- apps and lab. Nothing imports an app.

The lab keeps working: its physics reference hash (state 35a7603f, snapshot 054e5eb0) is a test, so moving code cannot silently change what devices compare against. The lab keeps its own renderer with all three styles; the sandbox gets a Gritty-only copy that grows from there.

## Determinism in the sim

- Fixed 60 Hz ticks. The worker steps the sim; the page renders interpolated transforms.
- Every action is an input `{ tick, kind, ... }` queued for its tick. A fire carries the exact aim (yaw, pitch), the weapon, the charge, the fuse and the spin, so online play later only ships these.
- The aim limiter (turn rate per weapon), reload timers, the wind schedule, fuses and the Rng streams are pure deterministic code in `sim`, tested on their own.
- Ballistics are applied as forces each tick with detmath only: gravity (Rapier), quadratic drag `F = -1/2 rho Cd A |v - w| (v - w)`, wind `w`, and Magnus lift `F = S (omega x v)` for spinning shot.
- Hash tests replay scripted inputs in Node and compare state hashes with stored references. A deliberate change updates the reference and bumps `RULES_VERSION`.

## Milestones

### M1. Monorepo and first shot (open: the sandbox page)

- Root workspaces for `packages/*`, `apps/*` and `lab`; the boundary check, `tsconfig` per package, the test runner and `npm run check`.
- Move `detmath` and hashing to `core`, the castle layout to `content`, the masonry sim to `sim`. The lab imports them by name and its reference hash test passes.
- `apps/sandbox`: the Gritty renderer copied from the lab, the Ashwright castle (brick-red masonry, soot, iron-banded gate) facing a grey granite target castle, a free orbit camera, and the existing long gun firing at the click point.
- Try: the scene loads in the Gritty style; click to fire; walls breach as in the lab.

### M2. Ballistics and aiming (open: ride the long gun and the mortar)

- Emplacements on the Ashwright castle: long gun on the front wall, mortar in the courtyard, chain shot and swivel gun on the towers. Keys 1 to 4, Q and E, gamepad bumpers jump between them; the camera sits behind the sight.
- Turn-rate-limited aiming: mouse (pointer lock), keyboard (W A S D, Shift for fine) and gamepad (left stick, right stick fine). Sight zoom on right click, scroll, Z or the left trigger.
- Real flight: drag and wind for every projectile; the wind changes every 30 to 60 seconds with a smooth turn, shown by a wind gauge, the flags and drifting smoke.
- Mortar: high arc with a settable fuse (scroll with Alt, or the D-pad); the shell bounces and rolls until the fuse blows it, or bursts in the air.
- Aim help: the first part of the predicted arc (length per weapon), a ghost trail of the last shot from this emplacement, and a landing marker.
- Try: hit the target keep with the long gun into a crosswind; lob a mortar shell over the wall and time the fuse.

### M3. Chain shot, swivel gun and spin (open: all four weapons)

- Chain shot: two balls joined by a rope joint, launched spinning about their centre; the chain is drawn between them. It scythes through minions and cuts ropes and timber, and has a small blast on masonry.
- Swivel gun: a cone of grapeshot from the Rng stream (spread per weapon), short range, light balls that knock minions down and chip stone without breaching it.
- Spin on the long gun (R cycles none, top, back, left, right): Magnus lift curves the shot; topspin dips and runs on, backspin floats.
- Ricochet: shallow hits on stone glance off (the ball keeps going) instead of breaching.
- Try: curve a long gun shot round a tower; spin chain shot into a row of targets.

### M4. Craters, test minions and the shot camera (open: the full sandbox)

- Terrain: the physics ground becomes tiled height fields; explosions dig craters (rebuilding only the touched tiles), and the renderer deforms its terrain to match. Craters stay flat inside the castle footprints for now.
- Test minions: a dozen pikemen on a patrol in front of the target castle. Upright they are a single kinematic capsule (cheap); a hit, blast or falling stone turns one into a ragdoll (about 10 bodies and joints) that settles and freezes. Gore follows the spec's rules (dark decals, a setting), cosmetic only.
- Shot camera (V): follows your shot and slows down at impact. In the sandbox the sim slows with it; online it will be a local replay instead.
- HUD: weapon, reload, fuse, spin, wind gauge, quality tier menu, and a help card for every input.
- Try: drop a wall on the patrol; air-burst a mortar over them; follow a chain shot with the shot camera.

### M5. Hardening (open: the release candidate)

- Hash tests for every weapon, the chain shot, wind, craters and ragdolls, plus a long scripted sandbox session.
- Headless browser check of the sandbox page on WebGL2 at Low.
- Quality tiers per spec (auto pick from the quick test, frame-time guard).
- Try: the sandbox on both laptops (the owner's M4 and Kat's M3).

## Not in phase 1

Economy, buildings, repairs, minion waves and pathfinding, the AI castle, networking, sound, Graniteborn. The sandbox's minions only patrol and ragdoll.

## Status

- First build published (https://claude.ai/artifact/XMq2HmKaL5KB6MUMVwHrbU, private to the owner). It already holds most of M1 to M4: the monorepo and checks, the Gritty renderer, all four weapons with drag, wind, spin and fuses, chain shot, grapeshot, glancing hits, craters, ragdoll minions, aim help, sight zoom and the shot camera. The sim and renderer were built in parallel, so the milestones landed together.
- Fixed in the layout: castle 1's tower wedges were mirrored inside out. The fix is the `mirrorWedges` layout option, on in the sandbox; the lab keeps the old layout so its device reference hash stays valid.
- M5 done (version 2 of the same link): the scripted session hash is pinned in the Node tests and headless Chromium matches it bit for bit (`npm run check:browser`); a first-launch graphics test picks the tier; the renderer clears smoke near the aim line, puts blood on stone, severs limbs (cosmetic), trickles dust from loose masonry, and the ground mesh is down from 188k to 102k triangles.
- Still to check on real hardware: the sandbox on both laptops (WebGPU), and the browser hash page on Safari and Firefox.
- Owner feedback round (version 5): aim help now shows the whole predicted flight with a landing ring (the partial arc is a setting); the mortar uses a raised spotter view, starts on an impact fuse, and its shells fall at 3.2x gravity at 82 m/s so they land in 2.7 to 4.5 s instead of 6 to 7, with a bigger blast and camera shake; Space no longer presses a focused weapon tab. Rules version 2, session hash re-pinned, Chromium still matches Node.
- Mortar round (rules version 3), published at a new link, https://claude.ai/artifact/Kv4hSqmUVa2JHV8d4TNK8F (the first link was on another account and could not be updated from this session). The owner found the mortar unsatisfying on every count (weak impact, silent, a dead wait, hard to aim) and wants each shell to be a big event: few shells, each one caving in a roof or a wall section. Done:
  - The burst is data (`WEAPONS.mortar.burst`): radius 4.6 m, a 2 m core turned to dust, the ring thrown up and out at up to 30 m/s, loose rubble within 6 m thrown too, minions knocked down within 12 m, a 4 m crater. A shell that strikes masonry bursts 0.9 m inside it, so roofs and wall tops cave in. Measured: 50 to 170 stones loosened per shell, up to 150 thrown more than 3 m up, about 100 to 190 moving at the peak.
  - Ride the shell: the shot camera is now per weapon and on for the mortar. The camera flies behind the shell looking at where it will land, stops about 30 m short, and the burst plays in slow motion (0.3) for about a second before easing back.
  - Sound, all procedural (Web Audio): launch thump, a falling whistle, the burst (crack, blast, sub, long roll, then stones raining down), arriving late with distance at the speed of sound, with air absorption and a valley reverb; cannon, chain whirr, grapeshot, stone hits, bodies, a rumble and clatter while masonry moves, wind, a clack when the gun is loaded. M mutes; volume under Controls.
  - The look of a burst: a bigger fireball, a dark smoke column, dust thrown along the ground in a ring, two rings of chips, a brief shock flash, a longer light, and camera shake and a kick that grow with closeness.
  - Aiming: every predicted arc stops at the first stone or ground it hits (the long gun's too), the landing ring lies on that surface, the mortar shows its blast radius, and the HUD says what the shot lands on, how far and how long it flies. The mortar is aimed from a raised observer partway to the target that eases towards the landing point, with a real zoom (12 to 55 degrees), and starts on a steep, plunging elevation.
  - The payoff is counted: a few seconds after a burst the page shows how many stones and men it brought down.
- Smoothness round, after the owner's play test (the physics felt good, but the camera juddered while riding a shell, and a big burst felt like a stall before the stones flew; keep the level of detail):
  - The page now draws between sim frames: a render clock runs two ticks (33 ms) behind the newest frame, applies each frame when it reaches it, and draws shells, chain shot, loose stones and the ride camera in between. Before, everything jumped to each frame as it arrived, and the camera extrapolated from message arrival times, which shook the world around a shell moving at 80 m/s.
  - The stall had three causes. The support check walked both whole castles (20 ms the first time, 2 to 4 ms after); it now walks only the castle that changed, over flat arrays, and is compiled at load. The first burst ran cold JavaScript and WebAssembly; the worker now rehearses two bursts in a throwaway sim while the page loads. And slow motion moved stones only about 18 times a second. A keep-top burst went from 60 to 110 ms of physics in its first four ticks to about 16 ms (cloud server). After a slow step the sim now falls slightly behind rather than stalling and rushing, and the shaders only a burst uses are compiled while loading.
  - Slow motion at impacts is an option under Controls, off by default (and smooth when on). The Controls panel shows the slowest physics step of the last second next to the average.
  - Same rules: the session hash and the lab's reference hash did not change.
- Known small gaps: blood on a stone that later shatters disappears with it; turn rates and wind strength are first pass; WebGPU, Safari and Firefox are untested; the sound is untested on real speakers.
