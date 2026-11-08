# Keepfall (working title)

A physics-heavy 3D castle duel for the browser: first-person siege weapons, minions, and a castle to run. Keepfall is a working title; the repo keeps the name counter-shot until the final name is chosen.

- `SPEC.md`: the game spec (draft 0.3). `docs/plan.md`: decisions and findings. `docs/phase-1.md`: the Sandbox plan and its status. `docs/phase-2.md`: the plan for a full match versus the AI, its decisions and status.
- `packages/`: DOM-free, deterministic code. `core` (maths, Rng, hashing), `content` (castles, the valley map, weapons, gun slots and upgrades, plots and buildings, the economy, pikemen, sappers, musketeers, mixes and the enemy's plan as data), `sim` (the Rapier simulation: masonry, bridges, buildings, projectiles, wind, terrain, minions, kegs, the nav grid, flow fields, the army, gunnery), `rules` (the match: teams, gold from every source, the clock, plots and buildings, gun slots and upgrades, barracks, orders, guns nobody rides, the enemy's plan, who has won).
- `apps/game`: the game page (start menu, Practice range, Versus AI with the build menu; worker, Gritty renderer, input, HUD, sound).
- `lab/`: the device test page (physics budget, graphics tiers, determinism hash).

```bash
npm install
npm run check          # boundaries, types, Node determinism tests
npm run game:dev       # the game page (#practice or #versus in the address skips the menu)
npm run lab:dev        # the lab
npm run game:build     # writes apps/game/dist/artifact.html and dist/assets/
npm run check:browser  # headless Chromium replays the session and the three scripted matches and must match Node
node tools/game-shots.mjs  # screenshots of every camera view into tools/.shots/ (slow: software rendering)
node tools/wave-shots.mjs  # a match on the real clock: waves forming up, meeting, fighting, at the gates
node tools/build-shots.mjs # a match on the real clock: the build menu, a mill going up, the gun bar, a bought gun, sappers
```
