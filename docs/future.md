# Ideas kept for later

Ideas the owner liked but put off (November 10), ideas raised and not yet chosen, and what was dropped. Nothing here is planned work. Phase 3 (`docs/phase-3.md`) is built first; where it leaves something ready for an idea below, that is noted.

## Kept for later (the owner's word: too ambitious for now)

### The Castle Architect and sieges by post

Draw your own castle in stone, timber and iron under a budget, write its standing orders, and publish it. Others besiege it while you sleep; you watch exactly how it fell; a league ranks castles by how long they stand and gunners by how fast they bring them down.

- **Why it could carry the product.** It is the thing only a deterministic sim can do: a siege is a seed and a list of inputs, so a result can be checked by running it again and a replay is exact. It gives the game content without end, a reason to come back each day, a way to play a friend without both being there, and a home for a player who would rather build than aim.
- **The Architect.** Draw a wall and it lays its own stones; drop towers, a keep, a gatehouse, plots and organs; the mason's eye shows what holds and what does not as you build; a budget in pieces and in gold. Decorating is part of it.
- **Standing orders.** A castle defends itself by its owner's rules: what its guns shoot first, what its masons mend first, when its waves sally. The AI's plans are data already.
- **The duel by stopwatch.** Two players each besiege the other's castle; the faster wins.
- **What phase 3 leaves ready**: forts as data and the budget (3.12), the load rules and the eye (3.4), replay files and the check by running again (track S, S6), the Daily Siege's board (3.12), standing orders (track V, V3).
- **What it still needs**: the Architect itself, a place to keep castles and results (a host of our own, or the page's database where it is hosted), the league.

### The March

A campaign for one or two: lead a siege train across a country at war, fortress by fortress.

- **A run**: a map of roads and strongholds; each stop a different fort (a hill fort, a river castle, a cliff abbey, a star fort, and real ones as its great sieges), a lord who plays in his own way, weather and a twist. Between sieges you draft guns, rounds, veterans and relics, mend, and choose the road. Guns and named crews carry on, gain marks and die. Powder is the campaign's fuel.
- **Why**: it is the fifty hours for someone who plays strategy games and RPGs, it gives the AI characters, and it makes lopsided builds a pleasure instead of a balance problem.
- **Later still**: a war map in the manner of Total War, with turns between the sieges, where a siege you do not want to play can be resolved by running it.
- **What phase 3 leaves ready**: forts as data and siege mode (3.12), the household and its veterans (3.6), the day and weather (3.8), engines (3.10), the AI's levels and plans as data.

## Raised, not yet chosen

- **A turn mode.** Both sides lay their guns and give their orders, then twenty seconds play out for both to watch. A duel by post between two people, and a slower game for those who want to think.
- **Doctrines.** Before a match each side picks eight cards from a pool (guns, rounds, troops, engines, machines) unseen by the other. A cheap way to many matchups, long before four races exist.
- **A steward you can talk to freely.** Track V understands a fixed grammar. Where the page can ask a language model, a sentence the grammar does not know could be turned into orders by one. Its answers would still enter a match as ordinary inputs.
- **Two against two.** Two seats in each castle, four machines (after 3.13).
- **Graniteborn** and the later races (SPEC section 10): each a branch of physics. The giant's sling waits for them.
- **Castles five times the size.** A physics solver on the graphics card, if one can be made to give the same result on every machine (noted in `docs/plan.md`).
- **Watching.** Spectators and a caster's camera: cheap once replay files exist.
- **Made by players.** Forts, sieges and maps are data; a way to share them.
- **A home of our own.** Hosting outside claude.ai (Cloudflare, as planned since phase 1): invite links, a relay we control, a board, the microphone.
- **A field that burns.** Brush and woods catching fire across the valley (left out of 3.7).

## Dropped

- **Counter-shot** (the owner, November 10): shooting shells out of the air, guns that stay hidden until they fire, and woolsacks dropped over a wall to take a hit. Do not build these. Smoke, which was pitched with them, stays as part of 3.7.
- The name counter-shot goes with it: the repo will be renamed when the game's name is chosen (see Name in `docs/plan.md`).
