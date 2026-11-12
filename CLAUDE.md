# Keepfall: notes for agents

Keepfall is a working title. The repo and package names still say counter-shot; leave them until the owner picks the final name.

- Never use em dashes (or en dashes) in code, comments, docs, commits or UI text.
- Anything that feeds the physics must be deterministic: use `lab/src/core/detmath.ts` (dsin, dcos, Rng) instead of Math.sin, Math.cos, Math.random and friends. Plain + - * / and comparisons are fine.
- Pin dependencies to exact versions.
- Work on a branch; do not push to `main` unless the owner says to ship.
- What to build next is in `docs/phase-3.md`: read it, then only the spec of the milestone or track you are building under `docs/phase-3/`. Build the milestones in its order unless the owner says otherwise. `docs/future.md` holds ideas kept for later and what was dropped: do not build from it.
- Every big build iteration follows the build and review loop (master plans and reviews, `executor` agents in `.claude/agents/executor.md` build, then dead-end hunt and player's chair rounds before the PR): see "Build and review loop" in `docs/handoff.md`.
