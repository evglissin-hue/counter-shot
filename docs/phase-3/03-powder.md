# 3.3 Powder

## Goal

Every shot burns powder. Mills make it, a magazine stores it where everyone can see it, and powder boys carry it to the guns. The economy sets a castle's rate of fire, a careful shot is worth more than three loose ones, and the magazine is the best target in the game.

## Why

Shots are free today, so the best play is to fire the best gun at the keep as fast as it loads, and gold piles up with nothing to buy. Powder ties the economy to the shooting in both directions: what you build decides how much you can fire, and what you hit (a mill, a boy, the magazine) decides how much they can.

## Rules

Numbers live in a new `POWDER` in `packages/content`.

1. **Charges.** Powder is counted in whole charges, per team, shown beside the gold. A castle starts with 40 in its magazine and every gun's box full.
2. **What a shot costs.** Swivel 1, chain shot 3, long gun 4, mortar 10. Heavy shot costs 1 more, a heavy shell 2 more. Guns nobody mans pay the same.
3. **The ready box.** Each gun has a box of powder beside it: long gun 12, mortar 20, chain shot 9, swivel 6. A gun fires only if its box holds the shot's cost. The fire input is refused otherwise, as for a gun that is not loaded.
4. **Making it.** The keep's cellar makes 0.4 charges a second. Each working Powder Mill makes 0.5. Mills no longer pay gold.
5. **Storing it.** A new building, the **magazine** (140 gold, rises in 12 s), holds up to 120. Each castle starts with one on a back plot. With no working magazine the cellar holds 30. Powder made with nowhere to go is lost, and the HUD says "Magazine full".
6. **Carrying it.** Three **powder boys** per castle (figures, as easy to knock down as a mason; one who falls is replaced at the keep's door after 20 s). A boy takes a keg of 12 charges from the magazine (or the cellar), walks the courtyard to the foot of the wall or tower under the gun that needs it most (the gun you ride first, then the emptiest box), and a hoist lifts it in 3 s. Boys run from enemy men within 7 m, as masons do.
7. **Buying it.** 20 charges for 60 gold at the magazine, at once, if there is room.
8. **Kegs burst.** A boy knocked down by a ball, a burst or falling masonry while he carries a keg sets it off where he is (a sapper's keg: `KEG.burst`). A burst near another keg sets that off too.
9. **The magazine blows.** When a shell or a keg bursts inside it, or it is wrecked (under 60% standing) with stock in it, everything in it goes up as one burst at its middle: reach 3 m plus 1 m for every 20 charges (120 charges: 9 m), thrown half again as hard as a shell. The stock is lost. A Powder Mill that is wrecked while it works bursts like one keg.
10. **Sudden death** (until 3.8 replaces it) also doubles powder made.
11. **The Practice range** has boxes that never empty.

What the numbers mean, to tune from: the cellar alone feeds one long gun shot every 10 s. One mill brings a long gun close to its full rate. Three mills feed a long gun and a mortar at full rate. Three boys from a back plot carry about 80 charges a minute; from a front plot nearly twice that, so a magazine near the guns loads them faster and stands where shells fall.

## Data and code

- `packages/content`: `POWDER`; `magazine` joins `BuildingKind` with its pieces (a low stone vault with a timber lean-to, about 30 pieces; kegs are drawn, not bodies); `START_BUILDINGS` gains the magazine; the `powderBoy` unit.
- `packages/sim`: a `Carriers` module beside `Works` (the same shape: figures in the minion list, tasks, a policy the rules set); boys are left out of the cap on men standing and out of the storm counts, as masons are; a carried keg bursts through the path sappers' kegs use; the magazine's burst is one `burst()` call. Hash the carriers and the boxes. Bump `RULES_VERSION`.
- `packages/rules`: the stock and its making in `Economy` (whole charges paid every second, the fraction carried, as gold is); `Match.apply` refuses a fire the box cannot pay, and `gunnery` skips a gun whose box cannot; the `{ kind: "powder" }` input buys. Bump `MATCH_RULES_VERSION`.
- `MatchInfo` gains the stock, its rate, each gun's box and each boy's errand.

## The AI

- The gunner never chooses a gun whose box cannot pay, and prefers the gun whose shot it can afford twice.
- The steward's plans already build two mills; it buys powder when gold stands above its reserve and the stock is under 20; it rebuilds a lost magazine before anything else.
- From a Knight up, a raid (its mortar on buildings) prefers the enemy magazine when it holds 80 or more, then a mill.

## The page

- One number by the gold: the stock and its rate ("86 +1.4/s").
- The weapon card shows the box as pips (shots left). A gun tab dims when its box is empty and shows a small keg while a boy is on his way. Firing an empty gun gives a dry click and a short note ("No powder at the long gun: a boy is 6 s away").
- The world shows it first: kegs stacked under the magazine's lean-to (one for every 10 charges), a boy with a keg on his shoulder, the hoist's rope at each gun.
- The build menu gains the magazine and "Powder, 20 for 60 gold".
- Sound: the hoist, a keg set down, the dry click, and a magazine that is heard across the valley.
- The guided match: the mortar step mentions the box; a tip the first time a box runs dry.

## Tests and measures

- A fire is refused with an empty box; a boy's keg fills it; costs by weapon and upgrade.
- The stock never passes the cap; with no magazine the cellar feeds the guns.
- A boy shot while carrying bursts; a boy shot on his way back does not.
- The magazine's burst grows with its stock; an empty one makes none.
- Observatory: shots by hand a minute over a match; the share of matches with a magazine blown (aim: 15% to 35%); the win rate of the side that lost its magazine (aim: 20% or more, so it is a blow and not the end); T5.

## Dead ends to hunt

- A gun whose box stays empty for 60 s while there is stock and a boy stands.
- A castle with no powder coming in (the cellar must always make some).
- Boys who cannot reach a gun's foot (rubble, a ruin): they clear a way or take another path.
- A magazine that cannot be rebuilt because its plot is full of rubble.

## Try

Fire the mortar until its box is empty and watch a boy bring a keg. Build a mill, then a second. Shell the enemy magazine when the kegs are stacked high.

## For the owner

- Should the gun you ride always have powder (so shooting never stops) with scarcity biting only on the other guns? The spec says no: every gun pays, and the gun you ride is served first.

## Status

Not started.
