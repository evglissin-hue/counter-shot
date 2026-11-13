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

- Should the enemy see your marks (a stake in the ground they could read)? The spec says no. The owner's answer (November 13): hidden.

## Status

Done (November 12). Branch `claude/phase3-observatory-runs` (merges `claude/festive-keller-mgdjup`: tracks V, S1 to S6, the look's L0, L2, L3). Built through the build and review loop: a contract commit (`REGISTER` in `packages/content/src/register.ts`, AiLevel's `marks`, `salvo`, `gangs`), then executors for the rules (the register), the bridge gangs, the AI and the page, then the rounds.

**What was built.**
- Rules (`packages/rules/src/register.ts`, `match.ts`): marks per team (places 1 to 6, the oldest replaced, 180 s life refreshed by a shot landing inside, hashed, their own Rng stream "register"); the inputs `{ kind: "mark", emplacement }` and `{ kind: "salvo", mark, mortar? }`; guns nobody mans lay on men on marked ground with a quarter of the error, threat counted from half the distance, and reload as `REGISTER.reload`; fire for effect from the nearest gun out over 1.5 s, one a team every 20 s. A salvo skips a gun with its own men near the mark or a bridge at risk (checked when ordered and again as each gun fires), and a mark replaced meanwhile drops the rest of its salvo.
- Bridge gangs (`packages/sim/src/gangs.ts`): two men of a wave sent down a road whose bridge is down; 60 gold once; 40 s; the deck restored lowest first, rubble carried off; they wait while an enemy is within 20 m on their own side of the gap (enemies across the gap no longer hold them: with every bridge down that cut the valley for good).
- The AI: from the Knight up it ranges the enemy gate (a flat gun where one bears, the mortar otherwise), turns any own hand landing near the gate (and, for the Warlord, near the wall it attacks) into a mark, renews it, and orders the salvo there as its waves arrive (3 or more of its men within 30 m), mortar included; the earlier salvo on 6 enemy men on a mark stays; bridge gangs from the steward.
- The page: T marks where your shot landed (a "T mark" label on the landing; T falls back to any of your guns' newest landing); chalk crosses with numbers in the world and chalk-white numbers on the minimap; the Marks row in the command card (chips with place names and a draining ring, the keys and the salvo wait in the header, "Mortar in the salvo"); F then a number, F twice, a chip click or a click on a mark in the overview fires for effect; the refusals say why ("Guns loading (N s)", "Only the mortar bears: tick Mortar in the salvo", "Our men near", "No gun bears", "Salvo ready in N s"); a drum roll and the gun tabs flash; gang lines and notes; the Practice range has marks and salvos with its four guns; the guided match's step 7 "Mark the road" with a "Their road" mark. Enemy marks are never sent to the page (the owner's open question below; default hidden). Voice orders moved from T to hold Y (the owner's answer, November 11).

**Versions and pins.** Sim `RULES_VERSION` 11 to 12; `MATCH_RULES_VERSION` 8 to 9; `NET_VERSION` 4 to 5 (marks and salvos are inputs and the register is in the net hash). Re-pinned: MATCH_HASH e90ee604 / 7f743abe to edd989a0 / 7f743abe; WAVE_MATCH_HASH 77856e2b / 7f068fe4 to 504816da / a09c952a (its script now marks and orders a salvo); ESTATE_MATCH_HASH 2a25ef46 / f93ead42 to 718a1455 / f93ead42; AI_MATCH_HASH 1122efd1 / e4a33d6c to 28b2822d / a50a7488; GUIDED_MATCH_HASH c6289857 / dbf0c11b to 20ad5b9f / dbf0c11b. SESSION_HASH (fcfc80cf / 9c6521a6) and the lab's 35a7603f / 054e5eb0 unchanged.

**The observatory.**
- A Knight that marks against one that does not (`a2-marks`, 80 matches, 40 seeds from both castles): the marking side wins 54 of 80, 67.5% (95% interval 57.2% to 77.8%; 26 of 40 as castle 0, 28 of 40 as castle 1). Aim: clearly above 55%. Per match it holds 3.2 marks, orders 2.8 salvos of 1.6 guns, its guns nobody mans fire 36.9 shots on marked ground, and it spends 6.7 hand shots ranging. Before the gate marks it won 19 of 40 (47.5%, marking only roads and bridges), and with two marks at a time 17 of 40.
- Men downed by guns nobody mans on marked ground: shots on marks went from 0 to 7 a side to 27 to 57 a side in traced Knight mirrors.
- Bridges standing at the end: 2.0 to 2.3 of 3 on average.
- The quick run (`a2-quick`, 24 of 24) on the final AI:

| Target | Value | Pass |
| --- | --- | --- |
| T1 Length | median 5.4 min; 42% between 6 and 16; 0.0% by time (n 12) | FAIL |
| T2 Endings | keep 100% (n 12) | FAIL |
| T3 Sides | castle 0 won 3 of 12; too few to call | n/a |
| T4 Skill | Warlord beats Knight 100% (n 12) | PASS |
| T5 Spending | median unspent-gold time 78.5 s (48 sides) | FAIL |
| T6 Openings | not measured | n/a |
| T7 Targets | keep takes 56% of 1122 shots by hand | FAIL |
| T8 Comebacks | the side behind won 6 of 12 (50%) | FAIL |
| T9 Budget | p99 most stones moving 780; worst step 104.7 ms; steps over 33 ms a match: median 82, most 408 (this machine) | FAIL |

Against 3.1's quick run: more matches in the 6 to 16 minute band (42% against 8%), fewer hand shots at the keep (56% against 72%), comebacks 50% against 17%; unspent gold doubled (T5 now fails at 78.5 s). An earlier quick run with the AI marking roads only gave median 6.9 min and 67% in the band: the gate salvos shorten matches again.

**The rounds.**
- Checks on the final merge (with tracks V, S3 to S6, L2, L3): `npm run check` 317 of 317 (after replay files learned the mark and salvo inputs), `check:browser` (every pin matches Chromium), `online-check`, `sound-check` pass. `guided-check` and `hud-check` pass through every 3.2 step; on the integration branch alone they also fail at the end of the guided match (the last blow's replay never ends, so the end screen never opens) and, under load, at the impact cam's inset: both from the other session's tracks, reported to it.
- Published as version 21 of the game link.
- Dead-end hunt (read-only, then fixed): T was bound to marking and to voice (voice moved to Y); "No gun bears" while guns were only loading; salvos ignored own men and bridges; a seventh mark could redirect a salvo in flight; gangs invisible on the page and the bridge note wrong; only the ridden gun could be marked; no hint when only the mortar bears; a gang held forever by enemies across the gap.
- Player's chair (1280x720): the right column overflowed with two marks (it now fits six marks and two gang lines); the impact inset covered the minimap and the Controls panel; the chips hid their keys and showed the shared salvo wait as each mark's timer; two marks both named "Field" (now with a range); minimap marks unreadable; badges under the crosshair; a one-gun salvo read as a failure (the note now counts guns); gangs unexplained; step 7 had no world mark. All fixed.
- Test tools made robust for a loaded machine: the guided check keeps "Send your waves in" from interrupting steps 5 to 7 on the real clock; the HUD check gives the impact cam a fresh page on the real clock and waits for a salvo's later guns.

**Open.** The owner's question above (should the enemy see your marks?) is unanswered; marks stay hidden. T5 got worse; 3.3 (powder) is where gold gets its uses.
