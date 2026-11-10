# 3.6 The household

## Goal

A castle is run by named people at stations, and there are only so many of them. A crewed gun loads faster and shoots truer; a veteran crew is worth protecting; losses are for good until the reserve fills again.

## Why

Three things in the game are dice or free today: every shot scatters at random, a gun that is knocked out comes back after 30 s at no cost, and a fallen mason is replaced for nothing. People make all three legible. Scatter becomes a crew's skill, sweeping a crew off a gun costs the enemy something that lasts, and manpower becomes a clock that runs down in a long siege.

## Rules

Numbers live in a new `HOUSEHOLD` in `packages/content`.

1. **Stations.** Each gun has a crew of two (a layer and a loader). The masons (4), the powder boys (3), a bell ringer, a signaller and a spotter (if that tower stands) are stations too. The garrison (4) stays as it is.
2. **They are figures.** Crews stand at their guns on the wall walks, tower tops and in the pits, and can be knocked down by anything that knocks a man down. A man on masonry that falls goes with it.
3. **The reserve.** Six people wait in the keep. When a station loses someone, the next of the reserve walks out after 20 s to take the place. The reserve gains one every 60 s, up to six. With none left, the place stays empty.
4. **Who is replaced first** is one choice with three settings: guns first (the start), walls first (masons), powder first.
5. **What a crew does for its gun.**
   - Two at the gun: it loads at its own rate and fires on its own when nobody rides it.
   - One: it loads in half again the time.
   - None: it does not fire on its own. You can still ride it, and it then loads in twice the time, by your own hands.
6. **Skill, not dice.** A crew has a skill from the shots its gun has fired with it, by your hand or on its own: green (under 10), trained (10), seasoned (30), veteran (60).
   - Scatter: 1.3, 1.0, 0.8, 0.6 times the weapon's.
   - Reload: 1.1, 1.0, 0.95, 0.9 times.
   The four guns a castle starts with have trained crews; a bought gun's crew starts green. A replacement from the reserve is green, and a crew's skill is that of its less skilled member.
7. **Knocked out, now two things.** A gun whose crew is swept away or shot down is not out: it is uncrewed (rule 5) until the reserve sends someone. A gun struck square or brought down with its masonry is dismounted as today: its crew, if they live, put it back in 30 s once the masonry stands.
8. **Bounties.** A man of the household pays 8 gold, twice a soldier.
9. **Not counted.** The household is outside the cap on men standing and outside the storm's counts, as masons are.
10. **Names.** Each person gets a name from a seeded list. Notes use them: "Tam Greaves, layer of the long gun, is down. A green hand takes his place."

## Data and code

- `packages/content`: `HOUSEHOLD`; the name list; posts for each station from the emplacements.
- `packages/sim`: a `Crew` role with a fixed post (no pathfinding on the walls: a replacement walks the courtyard and is hoisted, as powder is). The chain's sweep takes crews as figures through `sweptMen`; the crew test in `mounts.ts` (`whirl`) goes, and `Mounts` asks the household who stands at a gun. Skill is a counter per crew, hashed. Scatter and reload read it where a shot is fired. Bump `RULES_VERSION`.
- `packages/rules`: the reserve and its clock, the `{ kind: "household", first }` input, crews in `gunnery`. Bump `MATCH_RULES_VERSION`.
- Cost: about 20 more upright figures a castle.
- `MatchInfo` gains the roster of the page's own castle (station, name, skill, standing) and the reserve; the enemy's crews are seen, not listed.

## The AI

- It sets who is replaced first by what it is short of.
- Going after a gun that hurts it (from a Knight up) now has a lasting gain; it prefers the enemy gun with the most skilled crew.
- It rides its best crew's gun when two guns would do.

## The page

- The weapon card shows the crew of the gun you ride: two small figures and skill pips; a line when it is short-handed.
- A household panel (H, if free): each station with its people, the reserve, and the one choice of rule 4. One short list, no micromanagement.
- The reload reads from the crew (track L, round L1): they swab, load, ram and run the gun out, so the reload bar is a second way to read what you can already see.
- The minimap marks an uncrewed gun (a hollow ring) apart from one that is dismounted.

## Tests and measures

- A gun with one of its crew loads slower; with none it does not fire on its own and loads in twice the time under your hand.
- A crew's skill rises with its shots and falls to green when a replacement joins.
- Chain shot through a crew knocks down figures, pays their bounties, and leaves the gun standing.
- The reserve empties, stations stay empty, and it fills again.
- Scatter by skill, measured over seeds as the aiming round measured it.
- Observatory: household lost in a match; crews' skill at the end; T8.

## Dead ends to hunt

- A castle with nobody left and no way back: the reserve always gains one a minute.
- A replacement who cannot reach a post (its tower is down): he waits at its foot and takes the place when it stands.

## Try

Fire sixty shots with the long gun and feel it tighten. Sweep the crew off the enemy's best gun with the chain. Let your own reserve run dry under a long shelling.

## For the owner

- Is a permanent loss within a match (until the reserve refills) the right weight, or should the reserve be larger?

## Status

Not started.
