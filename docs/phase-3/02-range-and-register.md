# 3.2 Range and register

## Goal

Your own shots teach your battery. Land a shot and you can mark that ground; guns nobody mans shoot true on marked ground, and one order sends every gun that bears at a mark. Also in this milestone: bridges can be rebuilt, so nothing in phase 3 cuts the valley for good.

## Why

You ride one gun at a time, and guns nobody mans miss by metres on purpose, so a second long gun changes little and gold has nowhere to go. Marks make every extra gun worth its price, keep pillar 2 (your aim matters most) and turn quiet moments into strategy done through the sight: ranging the roads before the waves come.

## Rules

Numbers live in a new `REGISTER` in `packages/content`.

1. **Making a mark.** After a shot you fired by hand comes down (the world's `landings` record), for 5 s you may mark it: the key T, or a click on the landing marker. The mark is the landing point with a radius of 6 m. It may lie on the ground or on enemy masonry (their mortar pit, their gate).
2. **How many, how long.** A team holds at most 6 marks; a seventh replaces the oldest. A mark lasts 180 s. A shot by hand that lands inside it refreshes it.
3. **Guns nobody mans on marked ground.** When such a gun lays on a man inside one of its team's marks:
   - its error is a quarter of its usual (`errBase` and `errPerM` times 0.25);
   - its reload is 2 times the weapon's, not 3;
   - it may engage him anywhere in its range, not only within 45 m of its own gate (`DEFEND`), and a man on marked ground is chosen as if he stood at half his distance from the gate.
   It still never fires where a bridge is at risk (`bridgeAtRisk` with the smaller error) or near its own men.
4. **Fire for effect.** The key F then a mark's number (F twice: the newest mark). Every gun of yours that is loaded, standing, and can reach the mark without hitting your own castle (`solveAim`, `clearOfCastle`) fires one shot at it with the quarter error, one after another over 1.5 s, from the gun nearest the mark outwards. Each then reloads as usual. The mortar joins only if "Mortar in the salvo" is on (off to start: a shell is a big event). One salvo per team every 20 s. The gun you ride joins with your own aim left alone: it fires where the mark is, then swings back.
5. **Marks are yours alone.** The other side does not see them.
6. **The Practice range** has marks and salvos with its four guns.
7. **Bridge gangs.** When a road's bridge is down and a team's wave is ordered down that road, two men of that wave carry planks: with no enemy within 20 m of the bridge's near end they relay the deck in 40 s for 60 gold (the pieces go back as masons' stones do, lowest first, each only where its place is clear). The bridge then stands for both sides. One gang a bridge at a time.

## Data and code

- `packages/rules/src/match.ts`: marks per team (centre, the gun that made it, the tick it fades), hashed; new inputs `{ kind: "mark", emplacement }` and `{ kind: "salvo", mark }`, checked in `wellFormed`; `lay()` reads marks (rule 3); a salvo queues its fires over the next ticks. Bump `MATCH_RULES_VERSION`.
- The error of a gun nobody mans is drawn in one place (`lay()`, from `UNMANNED`): rule 3 scales it there. The draw still comes from the "unmanned" stream, one draw per new target as today.
- Bridge gangs: `packages/sim` (a task for two men of a wave, as ladder crews are taken from a wave; the pieces restored with `CastleSim.restore`), paid through the economy. Bump `RULES_VERSION`.
- `MatchInfo` gains the marks of the page's own team.

## The AI

- The Knight marks, in its warm-up and in quiet looks, the road just short of each bridge on its own side and the ground before its own gate; the Warlord also marks an enemy gun it has hit and the foot of the wall it is breaching. The Squire never marks.
- From a Knight up it orders a salvo when 6 or more enemy men stand on a mark, or on the wall mark when its own waves are within 30 m of it.
- It marks only where its own shot landed, like a player.

## The page

- The landing marker shows "T mark" while it can be marked. A mark is a chalk cross on the ground with its number, drawn in the sight and the overview, and on the minimap.
- The command card lists marks as numbered chips with a ring that drains as each fades; a place name from where it lies ("Left bridge", "Their gate", "Field"). A click on a chip, or in the overview on a mark, orders the salvo.
- A salvo: a drum roll, then the guns in turn. The gun tabs flash as each fires.
- The guided match: one new step after "Stop their wave": mark the road, then fire for effect on their next wave.
- The Controls panel and the first-match guide gain one line each.

## Tests and measures

- A mark can be made only from the team's own shot by hand, within its 5 s.
- Marks fade, refresh and replace the oldest.
- On marked ground the error and reload change; off it nothing does (the pinned wave match, re-pinned, covers both).
- A salvo fires only guns that are loaded, standing and bear; never the mortar unless switched on; never twice within 20 s.
- A bridge gang relays a blown deck; the nav grid opens; both sides cross.
- Observatory: men downed by guns nobody mans on and off marked ground; the win rate of a Knight that marks against one that does not (aim: clearly above 55%); bridges standing at the end of matches.

## Dead ends to hunt

- A mark nothing can reach (every gun that bears is out): the chip says so.
- A salvo that hits the team's own castle or men.
- A bridge that can never be relaid (rubble in every plank's place): the gang clears it as masons do.

## Try

Mark the road before the left bridge with the long gun. Buy a second long gun. Watch the guns you are not riding stop a wave there. Order a salvo at the enemy gate as your wave arrives.

## For the owner

- Should the enemy see your marks (a stake in the ground they could read)? The spec says no.

## Status

Not started.
