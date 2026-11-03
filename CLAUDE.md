# Counter-Shot: notes for agents

- Never use em dashes (or en dashes) in code, comments, docs, commits or UI text.
- Anything that feeds the physics must be deterministic: use `lab/src/core/detmath.ts` (dsin, dcos, Rng) instead of Math.sin, Math.cos, Math.random and friends. Plain + - * / and comparisons are fine.
- Pin dependencies to exact versions.
- Work on a branch; do not push to `main` unless the owner says to ship.
