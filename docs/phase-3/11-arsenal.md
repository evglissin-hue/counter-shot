# 3.11 The arsenal

## Goal

Each gun is its own sport with its own trick to master, and two new guns bring physics the others lack: a harpoon on a rope and a rack of rockets.

## Why

The four guns were close to four sizes of ball until the chain learned to sweep. By this milestone the systems that make them differ exist (3.2 to 3.10); this pass sharpens each one, teaches its trick, and makes the AI use all of them. It never fires the swivel today, and uses the chain only on guns.

## Rules

Numbers live in `packages/content` (`weapons.ts`, `arsenal.ts`).

### The four, sharpened

1. **Long gun: billiards.** Bank shots off stone (the glance exists), skipping fire down a road (3.7), the shot through a gateway at a keep's foot (3.4), hot shot. With the easy aim help only, the predicted flight shows its first bank.
2. **Mortar: golf.** The charge, the wind and the fuse, and four rounds: shell, fire shell, smoke shell, light ball (3.7, 3.8). A shell burst in the air over a block costs it nerve as well as men.
3. **Chain shot: bowling.** It sweeps ranks, ladders and crews already. Now it also **cuts timber and rope**: a mast, the crane's jib, the bell's frame, a siege tower's stage, a harpoon's line. Timber its chain passes through is broken as by a weak ball.
4. **Swivel: skeet.** The quick gun for what moves: riders, sappers, engines' crews outside their cover. Canister against a ram's men from the side.

### The harpoon

5. A new gun for a wall or tower slot (180 gold; 2 charges a shot, a box of 6; reach about 80 m). It throws a barbed bolt on a rope.
6. The bolt lodges in the first piece of masonry or timber it strikes at 25 m/s or more, unless the piece is hard stone.
7. **Hold fire to haul**: the windlass pulls along the rope with a force that builds over 2 s. A piece comes away when the pull beats what holds it: a merlon, a prop, a ladder, a gate leaf, a mantlet, a stage of a siege tower, the wheel of a ram.
8. The rope is cut by a chain shot, or let go with a second press.
9. Its place: your own walls against engines and ladders, and from a field gun's place (3.10) against theirs. With 3.4 it pulls the last stone of a cut at the moment you choose.

### The rocket rack

10. A new gun for a wall slot (160 gold; 12 charges a ripple, a box of 12; 20 s to load). It fires six rockets over a second.
11. A rocket flies fast and wild: a thrust for its first second, then a sideways force that turns with its spin, so it corkscrews. Scatter is five times a long gun's.
12. Each bursts small (2 m, weak on stone), **lights timber** (3.7) and **shakes nerve** (3.10: 15 to every wave within 20 m).
13. Its place: breaking blocks at range and starting fires. The gun for a rout.

### Drills

14. The Practice range gains a drill for each gun: a short set of targets that teaches its trick (a bank, a skip, an air burst, a sweep, a haul, a ripple on a block), each with a par. They feed 3.12's exam.

The giant's sling stays with Graniteborn (SPEC section 10).

## Data and code

- `packages/content`: `harpoon` and `rockets` join `WeaponKind`, with their costs, boxes and the slots that take them; the drills as data.
- `packages/sim`: the harpoon's rope is a rope joint, as the chain shot's chain is; the lodged bolt, the pull and the piece it holds are state, hashed. Rockets are balls with a thrust and a turning side force in `flight.ts`. The chain's cut of timber goes through `sweep.ts`. Bump `RULES_VERSION`.
- `packages/rules`: the haul as a held input (`{ kind: "haul", emplacement, on }`); the new guns in `buy`. Bump `MATCH_RULES_VERSION`.

## The AI

- It rides the swivel when men are within 40 m of its wall and nothing better is loaded.
- It sweeps a block with the chain at 40 to 80 m, and cuts your crane or mast with it from a Knight up.
- A Knight buys rockets when your blocks reach its wall often; a Warlord harpoons a siege tower at 60 m.
- The observatory reports each gun's share of shots; a gun under 8% or over 45% among winners is out of balance.

## The page

- Each gun's card says its sport in a line. The harpoon shows its rope's strain as it hauls; the rack shows six tubes emptying.
- Rockets are the loudest thing after a magazine: a shriek, six trails, six fires.
- The book of feats (track S) gains each gun's tricks.

## Tests and measures

- A bolt lodges in a merlon and hauls it off; it does not lodge in the keep's hard stone; a chain cuts its rope.
- A ripple lands scattered, lights timber and drops a wave's nerve.
- The chain cuts a mast.
- Each drill can be passed by the AI's hand at Warlord level within its par.
- Observatory: shots by gun among winners; men down by gun.

## Dead ends to hunt

- A bolt lodged in a piece that can never come away, with the rope held for ever: the rope lets go after 10 s of full pull.
- A rocket that lands on its own castle: the rack never fires where its ripple's scatter reaches its own walls, as guns nobody mans check their line.

## Try

Skip a ball through a wave on the centre road. Haul a ladder off your wall with men on it. Break a block with rockets and watch the fire take their barracks.

## For the owner

- Should the two new guns be Ashwright's for good, or samples of the races to come?

## Status

Not started.
