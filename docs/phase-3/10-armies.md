# 3.10 Armies with nerve and engines

## Goal

Men fight with mass and nerve, not dice. A wave can be broken without being killed, a flank matters, and the great targets of a siege roll down the road: a ram, a siege tower, shields on wheels.

## Why

Today every blow is a 30% roll, a man hit once never rises, and a wave is eight identical men every 25 s. Guns kill them or they reach a gate and mostly die there. Nerve makes a near miss matter and a falling tower decisive; engines are forty-second stories with one best shot in them; and fewer men need to die for a wave to be stopped, which is kind to the physics budget.

## Rules

Numbers live in `packages/content/src/army.ts` (`NERVE`, `MELEE`, `ENGINES`).

### Nerve

1. Each wave has **nerve**, 100 when it musters.
2. **It falls**: 8 for each of its men who goes down; 10 for a burst within 15 m; 25 for a structure falling within 20 m; 1 a second while it is outnumbered two to one within 9 m; 15 for a rocket's burst within 20 m (3.11).
3. **It rises** 2 a second after 5 s with none of the above, and 4 a second behind a bank (3.9) or within 12 m of a place its side holds.
4. **At 30 it wavers**: it stops advancing and gives 10 m of ground.
5. **At 0 it routs**: its men run back the way they came at half again their pace, striking nobody, for 15 s; then they rally where they are, or at their own marker if they have passed it, with nerve 50. A man who routs twice leaves the field (he walks off its edge and is gone).
6. Men who rout do not count as attackers in a courtyard. They can be cut down from behind and pay their bounty.
7. The household (3.6) and a garrison in its own courtyard never rout.

### Melee without dice

8. Each man has a **guard** of 3. A blow that lands takes 1; at 0 he goes down. Guard returns, 1 every 6 s out of a fight.
9. A blow takes 2 when it comes from behind or from the flank (outside the 120 degrees he faces), or from higher ground (a step of 0.5 m or more).
10. A blow takes none, every other time, from a man who has a comrade within 1.2 m on each side: a line holds.
11. Blows still fall on a seeded rhythm (today's 70 to 110 ticks); nothing else in a fight is drawn. Who wins is numbers, facing and ground.
12. Units differ by guard and reach, as data: pikeman 3 and 2.6 m; ladder crew 3 and 1.7 m; sapper and musketeer 2, weak.

### Formations

13. A wave keeps its ranks on the march: each man has a place in the block, four abreast, and steers for it as the block follows its road. Under gun fire (a ball, a chain or a burst on the wave in the last 5 s) it opens to double spacing, which costs it rule 10.
14. Musketeers form the rear rank and fire through gaps; sappers walk in the middle.

### Riders

15. A barracks can be set to a new mix, **Riders**: four horsemen. They move at 6 m/s. A rider at speed knocks down a man on foot he meets (it takes 3 from his guard), and loses his speed doing it; standing, he fights as a pikeman with a reach of 1.6 m. They ride down routed men, bridge gangs, sappers, diggers and masons outside the walls, and field guns' crews. They do not enter a castle. A cap of 8 a side.

### Engines

A new building, the **workshop** (240 gold), builds one engine at a time for gold. Each is a kit of timber pieces laid out in the layout from the start and withdrawn; built, it moves as one rigid group along its road (the group of 3.4), pushed by men of the next wave. A hit loosens its pieces by the masonry's own rules; with its foot cut it topples by 3.4's rule, onto whoever follows it. It burns (3.7) and bogs in mud.

16. **The ram** (120 gold, 30 s to build; six men). A roofed log on wheels, on the centre road only. At a gate each stroke counts as six pike blows. Its roof is a real cover: grapeshot, muskets and the chain's sweep do not reach the men under it from above or the front. A wheel shot away stops it until its men mend it (20 s).
17. **The siege tower** (220 gold, 45 s; eight men). Timber, 9 m high, taller than the wall, on the centre road only, at half a man's pace. At the front wall it drops a ramp onto the wall walk and the waves behind cross by it, as they climb a ladder today. Cut its lower stage and it falls.
18. **Mantlets** (40 gold each, up to three; one man each). A shield on wheels on any road: men within 2 m behind it are covered from the front against grapeshot and muskets.
19. **The field gun** (200 gold, 30 s; four men). A light long gun hauled to a place or a marker its side holds. There it is an emplacement you can ride: 60 m from their wall, firing nearly flat. A hit on it or its crew ends it.

## Data and code

- `packages/content`: `NERVE`, `MELEE`, `ENGINES`; the kits in the layout behind a flag; the workshop; the Riders mix.
- `packages/sim/src/army.ts`: nerve beside the per-wave arrays (`waveSum`, `waveX`); a place in the block per man; guard as a field of the man, hashed; the rout uses the other team's route field, as `marchField` can. No new draw from the army's stream: rule 11 keeps the blow timing draws and removes the hit rolls, under a rules version bump.
- Engines follow the pattern of `ladders.ts`: a crew map, hooks for balls, bursts and the sweep, and their own collider handles so a ball's hit is known. They move along the road's line (`routeAt`), not the flow fields.
- A rider is one figure for the nav grid; shot, he and his horse fall as two bodies.
- Bump `RULES_VERSION` and `MATCH_RULES_VERSION`. New inputs: `{ kind: "engine", engine }`; the Riders mix in `barracks`.
- Cost: nerve and places are sums. Two engines a side at most, 12 to 40 pieces each.

## The AI

- The steward builds a workshop when a gate has stood for three of its waves; it sends a ram with pikes, a tower with a mixed wave, mantlets ahead of sappers.
- It sets Riders on a barracks when your routs or your gangs give them work.
- The gunner has a new aim, the engine: first among targets within 60 m of its wall. A Knight aims at the body, a Warlord at a wheel or the lower stage.
- It fires for effect on a mark when a block stands on it: shock breaks waves.

## The page

- A wave's pennant (the overview and the minimap) shows its nerve as a short bar; a wavering block shifts and looks back, a rout throws down its pikes and runs.
- Engines read at 100 m by their shape (SPEC section 13). Their fall is a moment for track S.
- The build menu gains the workshop and its four engines; the barracks' mixes gain Riders.
- Sound: a wave breaking; the ram's stroke; the tower's wheels and the ramp falling.

## Tests and measures

- Two blocks alike meet and the one struck in the flank loses. A line holds longer than a loose crowd.
- A burst beside a wave drops its nerve; at 0 it runs and does not count in a courtyard.
- A ram under grapeshot keeps its men; a wheel shot away stops it.
- A tower at the wall lets a wave over; cut at its foot it falls on the men behind.
- A rider rides down a routed man and stops at a gate.
- Observatory: T2 (aim: storms 25% to 50%); what became of each engine and what ended it; routs in a match; men down by cause; bodies on the field at the end (aim: fewer than today).

## Dead ends to hunt

- A wave that wavers for ever between two places.
- An engine stuck on rubble or a body with no way round: its men clear the road as masons clear a breach, or it is abandoned after 60 s and said so.
- A tower at a wall that has since fallen: its men storm the breach on foot.

## Try

Break a wave with one shell beside it and watch it run. Take a block in the flank with your own. Roll a ram at their gate under their swivel. Shoot the wheel off theirs.

## For the owner

- Riders: wanted now, or later with Graniteborn's larger creatures?

## Status

Not started.
