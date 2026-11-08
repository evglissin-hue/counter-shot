# Keepfall (working title)

A physics-heavy 3D castle duel for the browser: first-person siege weapons, minions, and a castle to run. Keepfall is a working title; the repo keeps the name counter-shot until the final name is chosen.

- `SPEC.md`: the game spec (draft 0.3). `docs/plan.md`: decisions and findings. `docs/phase-1.md`: the Sandbox plan and its status. `docs/phase-2.md`: the plan for a full match versus the AI, its decisions and status. `docs/handoff.md`: a brief for the next session.
- `packages/`: DOM-free, deterministic code. `core` (maths, Rng, hashing), `content` (castles with the sturdy match keep, the valley map, weapons, the economy, buildings and guns, pikemen, sappers, musketeers and waves, repairs, the garrison, storming and ladders, the AI's levels and build plans, as data), `sim` (the Rapier simulation: masonry, bridges, buildings, projectiles, wind, terrain, minions, the nav grid, flow fields, the army, masons and repairs, ladders, gunnery), `rules` (the match: teams, gold, the clock, plots and buildings, guns and upgrades, barracks, orders, guns nobody rides, the garrison, repairs, storming, sudden death, surrender, who has won), `ai` (the AI castle: a player in the sim that sends the same inputs you do).
- `apps/game`: the game page (start menu, Practice range, Versus AI at three difficulties, Play a friend online in lockstep over the artifact room; worker, Gritty renderer with the minions' procedural rig, input, HUD, sound).
- `lab/`: the device test page (physics budget, graphics tiers, determinism hash).

```bash
npm install
npm run check          # boundaries, types, Node determinism tests
npm run game:dev       # the game page (#practice, #versus or #versus=warlord in the address skips the menu; #net=local plays a friend between two tabs)
npm run lab:dev        # the lab
npm run game:build     # writes apps/game/dist/artifact.html and dist/assets/
npm run check:browser  # headless Chromium replays the session and the four scripted matches (keep, waves, estate, AI against AI) and must match Node
node tools/game-shots.mjs  # screenshots of every camera view into tools/.shots/ (slow: software rendering)
node tools/wave-shots.mjs  # a match on the real clock: waves forming up, meeting, fighting, at the gates
node tools/estate-shots.mjs  # M3: buildings on the Practice range, then a match: a mill rising, the build wheel, sappers and musketeers
node tools/online-check.mjs  # M5: two headless pages play each other through the lobby (lockstep must hold), then Versus AI
node tools/anim-shots.mjs  # contact sheets of the minions' animation on the renderer test page (gait, turning, fights, musket reload, sapper, climbing, a fall); --bench=200 times them
```
