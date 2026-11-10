# 3.13 Two seats

## Goal

Two people run one castle: a Gunner at the sights and a Steward over the whole. First against the AI's castle, then against the waves of Hold the keep (SPEC section 11).

## Why

The game asks one person to aim through a narrow sight and run a castle at once, and the owner has twice found the screen too much. Two seats turn that load into teamwork, and it is how the owner and Kat want to play. Track V (the order line and voice) is the answer for one player; this is the answer for two.

## Rules

### Seats

1. A team has one or two **seats**. Each seat rides at most one gun. Guns nobody rides fire on their own, as now.
2. Either seat may give any order. Gold, powder and the household are shared.
3. Roles are a habit, not a rule: the Steward's screen opens on the overview with the build menu, the household and the roads' stances to hand; the Gunner's opens on a sight. Either can take a gun or the overview at any time.
4. **A ping**: a click on the overview or the minimap leaves a mark both seats see for 5 s ("here"). It changes nothing in the match, so it travels beside the lockstep, not through it.

### Stage A0: two seats on one machine

5. One page, two gamepads (or a gamepad and the keyboard): the screen is split in two, each half a camera on the same world. No network.
6. The second camera is the one track S builds for the impact cam. It halves the frame rate on a weak machine, so the page offers it only when the quick graphics test allows.

### Stage A: two machines against the AI

7. Play a friend gains "Same castle": both players sit in castle 1 against an AI in castle 0.
8. The lockstep still joins two machines. The AI runs on both from the same seed and sends the same inputs on each, as the match hash already checks.
9. A team's inputs are applied seat by seat within a tick, after the order by team.
10. If a friend leaves, their seat empties and the game goes on.

### Stage B: Hold the keep

11. SPEC section 11 as written: one castle on high ground, waves from one to three approaches, a director that builds each wave from a roster under a budget, a run of 12 to 20 waves.
12. It is built from phase 3's parts:
    - the roster is 3.10's men and engines, and section 11's others as they are added (shield walls as blocks that hold by rule 10 of 3.10; climbers; the giant waits for Graniteborn);
    - the run is one day (3.8): the first waves in fog, the hardest at night;
    - powder, the household, the machines and the elements work as in a match.
13. The director is deterministic from the run's seed and reads the castle (it sends climbers at whole walls, rams at a standing gate, everything at a breach).
14. Solo play of Hold the keep uses track V for the Steward's work.

### Later

15. Two against two (four machines) is in `docs/future.md`.

## Data and code

- `packages/rules`: `manned` becomes a list per team; the `man` and `aim` inputs carry a seat; every other input is unchanged. Bump `MATCH_RULES_VERSION` and `NET_VERSION`.
- `apps/game`: the lobby's "Same castle"; the split screen; pings in presence.
- Stage B: `packages/rules/src/hold.ts` (the run, the director, the score) and its roster in `packages/content`; a pinned run replays in Node.

## The AI

- Stage A: the AI's castle is unchanged. To keep two players stretched, the menu offers the Warlord first.
- Stage B: the director is the opponent. The observatory measures runs with two AI seats in the castle: how far they get on each difficulty.

## The page

- Each seat sees the other's gun on the gun tabs (a small second marker) and the other's ping.
- The Steward's overview is the same view a single player has, with nothing new to learn.
- Stage B: the threat strip shows the next wave's parts and roads in the lull.

## Tests and measures

- Two seats ride two guns; the third fires on its own; one seat cannot fire the other's gun.
- A lockstep test with two seats on one team and the AI on the other ends bit for bit the same on both machines.
- A seat left empty changes nothing else.
- Stage B: the same seed gives the same run.
- From play: how the owner and Kat split the work; whether the Steward has enough to do in a quiet minute and not too much in a storm.

## Dead ends to hunt

- Both seats on one gun (the second is refused and told).
- A split screen on a machine that cannot draw it (the page falls back to one view and says so).

## Try

Two gamepads on one machine: one of you shoots, the other builds, sets stances and pings targets. Then the same from two laptops against the Warlord.

## For the owner

- Which comes first for you and Kat: one machine with a split screen (A0), or two laptops (A)?

## Status

Not started.
