# Keepfall (working title)

A physics-heavy 3D castle duel for the browser: first-person siege weapons, minions, and a castle to run. Keepfall is a working title; the repo keeps the name counter-shot until the final name is chosen.

- `SPEC.md`: the game spec (draft 0.5). `docs/plan.md`: decisions and findings. `docs/phase-1.md`: the Sandbox plan and its status. `docs/phase-2.md`: the plan for a full match versus the AI, its decisions and status. `docs/handoff.md`: a brief for the next session.
- `docs/phase-3.md`: the plan for what is built next (the parts of a match made to depend on each other): the targets, the order, the rules for every milestone. `docs/phase-3/`: a spec for each milestone (`01-observatory.md` to `13-two-seats.md`) and each track on the page (`show.md`: the kill cam, replays and the film; `steward.md`: orders typed and spoken; `look.md`: the visual rounds, with `minimap-mock.svg` as the minimap's target). `docs/future.md`: ideas kept for later and what was dropped.
- `packages/`: DOM-free, deterministic code. `core` (maths, Rng, hashing), `content` (castles with the sturdy match keep, the valley map, weapons, the economy, buildings and guns, pikemen, sappers, musketeers and waves, repairs, the garrison, storming and ladders, the AI's levels and build plans, as data), `sim` (the Rapier simulation: masonry, bridges, buildings, projectiles, wind, terrain, minions, the nav grid, flow fields, the army, masons and repairs, ladders, gunnery, guns on their masonry, the chain shot's whirling chain), `rules` (the match: teams, gold, the clock, plots and buildings, guns and upgrades, barracks, orders, guns nobody rides, the garrison, repairs, storming, sudden death, surrender, who has won), `ai` (the AI castle: a player in the sim that sends the same inputs you do).
- `apps/game`: the game page (start menu, the guided match against a castle that wakes up slowly, with a coach, Practice range, Versus AI at three difficulties, Play a friend online in lockstep over the artifact room; worker, Gritty renderer with the minions' procedural rig, input, HUD with a keep tracker, a threat strip over the minimap, pennants for groups of men in the overview and a first-match guide, pause, sound).
- `lab/`: the device test page (physics budget, graphics tiers, determinism hash).

```bash
npm install
npm run check          # boundaries, types, Node determinism tests
npm run game:dev       # the game page (#guided, #practice, #versus or #versus=warlord in the address skips the menu; #net=local plays a friend between two tabs)
npm run lab:dev        # the lab
npm run game:build     # writes apps/game/dist/artifact.html and dist/assets/
npm run check:browser  # headless Chromium replays the session and the four scripted matches (keep, waves, estate, AI against AI) and must match Node
node tools/game-shots.mjs  # screenshots of every camera view into tools/.shots/ (slow: software rendering)
node tools/wave-shots.mjs  # a match on the real clock: waves forming up, meeting, fighting, at the gates
node tools/estate-shots.mjs  # M3: buildings on the Practice range, then a match: a mill rising, the build wheel, sappers and musketeers
node tools/online-check.mjs  # M5: two headless pages play each other through the lobby (lockstep must hold), then Versus AI
node tools/anim-shots.mjs  # contact sheets of the minions' animation on the renderer test page (gait, turning, fights, musket reload, sapper, climbing, a fall); --bench=200 times them
node tools/hud-check.mjs  # every HUD control in a Versus AI match: the command card's buttons and keys, Build and the build menu, gun tabs, sound, Controls, shot camera, overview, pause
node tools/first-match-shots.mjs  # the first seconds of a match at the artifact panel's size (1100 x 810), its short-lived messages slowed so they can be seen together
node tools/guns-shots.mjs  # the mortar's spotter and charge ring, a chain shot silencing a gun, a tower gun falling with its masonry
node tools/guided-check.mjs  # M6: the guided match step by step (the coach, its rings and marks, its interruptions, Skip and Hide, its end screen)
node tools/overview-shots.mjs  # M6: the threat strip and the overview's pennants in a Versus AI match
npx rolldown packages/ai/scripts/dead-ends.ts --format esm --platform node -o node_modules/.scratch/dead-ends.mjs && node node_modules/.scratch/dead-ends.mjs enemy=knight player=knight seed=21  # the dead-end hunt: an AI match that flags guns stuck out, slots that cannot be bought, idle gunners, hoarded gold
npx rolldown packages/ai/scripts/guided.ts --format esm --platform node -o node_modules/.scratch/guided.mjs && node node_modules/.scratch/guided.mjs player=newcomer seed=31  # M6: a guided match with a stand-in player (idle, newcomer, waves, squire): the tutor's stages and the result
npm run observe:quick  # 3.1: the observatory's quick run (24 AI matches in worker threads, one JSON line each into tools/.observatory/<run>/matches.jsonl; started again, a run skips the matches it has)
node tools/observatory.mjs pairs=warlord:knight seeds=1-12 swap=1 secs=300 jobs=4 run=mine variants=variants.json  # a custom matrix; presets: quick, review (the design review's 15), side (400 Knight mirrors)
node node_modules/.scratch/observe.mjs seed=11 sides=knight,knight secs=120 tuning='{"WEAPONS.mortar.reload":600}'  # one match to one JSON line (bundle packages/ai/scripts/observe.ts with rolldown first)
```

`tools/observatory-report.mjs <run dir>` turns an observatory run (`matches.jsonl` and friends) into `report.html`, `summary.json` and `summary.md` against the phase 3 targets; `tools/fixtures/observatory/` is a synthetic run to try it on (`node tools/observatory-report.mjs tools/fixtures/observatory`).
