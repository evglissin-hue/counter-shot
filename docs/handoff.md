# Handoff prompt for the next session

Paste the block below into a new Claude Code session on evglissin-hue/counter-shot.

---

You are continuing work on Keepfall (working title), a physics-heavy 3D castle duel for the browser (laptops only), made for Evgeny (the owner) and Kat. Read this whole brief before acting.

## Where things are
- Repo: evglissin-hue/counter-shot. Work happens on `claude/` branches (`main` only has a README); the latest is `claude/blissful-bell-5kd14e`, which continues `claude/keepfall-phase-1`. Branch from the latest for new work; never push to `main` unless the owner says to ship.
- Read first: `CLAUDE.md`, `SPEC.md` (draft 0.2), `docs/plan.md` (decisions and findings), `docs/phase-1.md` (the sandbox plan and its Status section), `docs/phase-2.md` (the draft plan for a full match versus the AI, with questions for the owner), `README.md`.
- Layout: `packages/core` (detmath, Rng, hashing), `packages/content` (castle layout, weapons and the mortar's burst as data), `packages/sim` (Rapier sim: masonry, projectiles with drag, wind and spin, mortar fuses and bursts, chain shot, grapeshot, tiled height-field terrain with craters, ragdoll minions, the scripted session and its pinned hash), `apps/sandbox` (worker, Gritty Three.js renderer, input, HUD, procedural sound), `lab/` (device test page; keep its reference hash 35a7603f / 054e5eb0 valid), `tools/` (boundary check, test runner, browser hash check, screenshot tour, sound check).
- Checks: `npm run check` (boundaries, types, Node tests), `npm run check:browser` (headless Chromium replays the session and must match Node), `node tools/sound-check.mjs` (every sound renders, is audible, never clips).
- Sandbox artifact (private to the owner, same URL on every republish): https://claude.ai/artifact/Kv4hSqmUVa2JHV8d4TNK8F. The first sandbox link (https://claude.ai/artifact/XMq2HmKaL5KB6MUMVwHrbU) was published from another account and could not be read or updated from the mortar session, so the build moved to this one; if a session cannot reach a link either, publish a new artifact and say so. Build with `npm run sandbox:build`, copy `apps/sandbox/dist/artifact.html` and `dist/assets/` to the scratchpad, publish with each asset mapped in `files`, and remove stale hashed assets with `null` (read the artifact first to see its current files). Lab artifact: https://claude.ai/artifact/GHqbFzcvN2tPt7wkhSm7NN (device results in its `results` collection; it may also live on the other account).

## Decisions so far
- Laptops only (Windows and Mac browsers); keyboard and mouse, gamepad, keyboard only. No iPad or touch.
- Art: Gritty only (SPEC section 13). Co-op is physics-driven wave defence (SPEC section 11). Races: Ashwright Guild (MVP) and Graniteborn.
- Physics floor: Kat's laptop (Apple M3): about 550 moving stones in 6 ms. The owner's M4 Mac: about 1,460.
- Online play waits until the owner connects the repo to Cloudflare.
- The mortar is a big event (owner's choice): few shells, each one caving in a roof or a wall section, slow reload, big payoff.

## State and open feedback
- Phase 1 (the sandbox) is built. The latest round reworked the mortar on all four of the owner's complaints (weak impact, silent, a dead wait, hard to aim): a much bigger burst (rules version 3), riding the shell down with slow motion at the hit, procedural sound for everything, a heavier-looking burst, and arcs that stop at what they hit with a blast ring and a "lands on" readout, aimed from a raised observer. Details in `docs/phase-1.md`. Waiting for the owner's verdict.
- Known gaps: turn rates and wind strength are first pass; WebGPU, Safari and Firefox are untested on real machines; the sound has not been heard on real speakers yet.
- Phase 2 is drafted in `docs/phase-2.md` (six milestones) with five questions for the owner at the end.

## Next
1. The owner's verdict on the mortar; then both laptops play the sandbox (and, ideally, open the browser hash page in Safari and Firefox).
2. The owner's answers to the questions in `docs/phase-2.md`; then build phase 2 milestone by milestone.

## Rules
- Never use em dashes or en dashes anywhere (code, comments, docs, commits, UI text, messages). Keep messages to the owner concise.
- Anything that feeds physics is deterministic: `@keepfall/core` (dsin, dcos, dsqrt, Rng), fixed 60 Hz ticks, ordered iteration, inputs tagged with ticks, no wall-clock time. The boundary check enforces this in core, content and sim. When gameplay changes, bump `RULES_VERSION` and re-pin `SESSION_HASH` on purpose.
- Pin dependencies to exact versions. Packages stay DOM-free and import each other only by name.
- After each milestone: run the checks, commit and push, republish the artifact, and send the owner the link with what to try. Look at every camera view before publishing: `node tools/sandbox-shots.mjs` drives the page on its test clock (`#fixed`) and writes `tools/.shots/` (a camera inside the keep once shipped a black screen). It is slow (software rendering, about 1.4 frames per second): run it in the background.
- Headless Chromium tips: use `#webgl-low` (software WebGPU loses its device; Low keeps it fast), retry the first load (Vite may reload once), and never edit files under `apps/sandbox` or `packages/` while a Vite-served page is open in a test (the reload breaks the run).
