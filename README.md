# Keepfall (working title)

A physics-heavy 3D castle duel for the browser: first-person siege weapons, minions, and a castle to run. Keepfall is a working title; the repo keeps the name counter-shot until the final name is chosen.

- `SPEC.md`: the game spec (draft 0.2). `docs/plan.md`: decisions and findings. `docs/phase-1.md`: the Sandbox plan and its status. `docs/phase-2.md`: the plan for a full match versus the AI (draft for review).
- `packages/`: DOM-free, deterministic code. `core` (maths, Rng, hashing), `content` (castles, weapons as data), `sim` (the Rapier simulation: masonry, projectiles, wind, terrain, minions).
- `apps/sandbox`: the phase 1 page (worker, Gritty renderer, input, HUD).
- `lab/`: the device test page (physics budget, graphics tiers, determinism hash).

```bash
npm install
npm run check          # boundaries, types, Node determinism tests
npm run sandbox:dev    # the sandbox
npm run lab:dev        # the lab
npm run sandbox:build  # writes apps/sandbox/dist/artifact.html and dist/assets/
npm run check:browser  # headless Chromium replays the session and must match Node
node tools/sandbox-shots.mjs  # screenshots of every camera view into tools/.shots/ (slow: software rendering)
```
