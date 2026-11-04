# Handoff prompt for the next session

Paste the block below into a new Claude Code session on evglissin-hue/counter-shot.

---

You are continuing work on Keepfall (working title), a physics-heavy 3D castle duel for the browser (laptops only), made for Evgeny (the owner) and Kat. Read this whole brief before acting.

## Where things are
- Repo: evglissin-hue/counter-shot. All work is on branch `claude/keepfall-phase-1` (`main` only has a README). Branch from it for new work; never push to `main` unless the owner says to ship.
- Read first: `CLAUDE.md`, `SPEC.md` (draft 0.2), `docs/plan.md` (decisions and findings), `docs/phase-1.md` (the sandbox plan and its Status section), `README.md`.
- Layout: `packages/core` (detmath, Rng, hashing), `packages/content` (castle layout, weapons as data), `packages/sim` (Rapier sim: masonry, projectiles with drag, wind and spin, mortar fuses, chain shot, grapeshot, tiled height-field terrain with craters, ragdoll minions, the scripted session and its pinned hash), `apps/sandbox` (worker, Gritty Three.js renderer, input, HUD), `lab/` (device test page; keep its reference hash 35a7603f / 054e5eb0 valid), `tools/` (boundary check, test runner, browser hash check).
- Checks: `npm run check` (boundaries, types, Node tests) and `npm run check:browser` (headless Chromium replays the session and must match Node).
- Sandbox artifact (private to the owner, same URL on every republish): https://claude.ai/artifact/XMq2HmKaL5KB6MUMVwHrbU. Build with `npm run sandbox:build`, copy `apps/sandbox/dist/artifact.html` and `dist/assets/` to the scratchpad, publish with each asset mapped in `files`, and remove stale hashed assets with `null`. Lab artifact: https://claude.ai/artifact/GHqbFzcvN2tPt7wkhSm7NN (device results in its `results` collection).

## Decisions so far
- Laptops only (Windows and Mac browsers); keyboard and mouse, gamepad, keyboard only. No iPad or touch.
- Art: Gritty only (SPEC section 13). Co-op is physics-driven wave defence (SPEC section 11). Races: Ashwright Guild (MVP) and Graniteborn.
- Physics floor: Kat's laptop (Apple M3): about 550 moving stones in 6 ms. The owner's M4 Mac: about 1,460.
- Online play waits until the owner connects the repo to Cloudflare.

## State and open feedback
- Phase 1 (the sandbox) is built and the owner likes the look, but finds the mortar unsatisfying even after it was sped up (shells now land in 2.7 to 4.5 s at 3.2x gravity, with a spotter view, full predicted arc and an impact fuse). Ideas not yet done: sound (whistle on the way down, a deep thump), a heavier-feeling hit (more debris, a shock ring, rubble thrown higher), the shot camera on by default for the mortar, a shorter reload. Ask the owner what "satisfying" should feel like before a big rework.
- Known gaps: the predicted arc passes through walls; turn rates and wind strength are first pass; WebGPU, Safari and Firefox are untested on real machines.

## Next
1. Finish the mortar's feel with the owner, then have both laptops play the sandbox (and, ideally, open the browser hash page in Safari and Firefox).
2. Then phase 2 (SPEC section 15): a full match versus the AI. Plan it in `docs/phase-2.md` as milestones that each end in something the owner can open and try, as phase 1 did: build plots, buildings, gold and upgrades, repairs; barracks and waves with flow-field paths, orders, routes physics can close; both win conditions, the AI castle, and the guided first match.

## Rules
- Never use em dashes or en dashes anywhere (code, comments, docs, commits, UI text, messages). Keep messages to the owner concise.
- Anything that feeds physics is deterministic: `@keepfall/core` (dsin, dcos, dsqrt, Rng), fixed 60 Hz ticks, ordered iteration, inputs tagged with ticks, no wall-clock time. The boundary check enforces this in core, content and sim. When gameplay changes, bump `RULES_VERSION` and re-pin `SESSION_HASH` on purpose.
- Pin dependencies to exact versions. Packages stay DOM-free and import each other only by name.
- After each milestone: run the checks, commit and push, republish the artifact, and send the owner the link with what to try. Look at every camera view in a headless screenshot before publishing (a camera inside the keep once shipped a black screen).
- Headless Chromium tips: use `#webgl-low` (software WebGPU loses its device; Low keeps it fast), retry the first load (Vite may reload once).
