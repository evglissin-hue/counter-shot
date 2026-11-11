# Track V: the steward's ear

## Goal

Run the castle in words while your hands stay on the gun: an order line you type, then the same orders spoken.

## Why

Everything but aiming is a menu, a wheel or a chord of keys today, and each takes your eyes off the sight. Apart from firing and aiming, a match takes nine kinds of input, each with a few choices. A small fixed grammar covers them all, and spoken orders enter the match as the same inputs a key would send, so nothing about determinism or online play changes.

## Steps

### V1. The order line

1. A key (Enter, if free in a match) opens one line at the bottom of the screen. Type an order, Enter sends it, Esc closes it. Aiming goes on behind it.
2. **The grammar** covers every input but fire and aim, in plain words:
   - "mill", "build a mill on the back plot", "barracks front right";
   - "buy a swivel", "long gun for the left wall", "heavy shot on the long gun";
   - "waves left", "advance", "hold", "push the breach", "second barracks: volley, right";
   - "masons off the walls", "keep first";
   - and, as each milestone lands: "mark that", "fire for effect on two" (3.2); "powder" (3.3); "buttress the front" (3.4); "guns first" (3.6); "hot shot" (3.7); "hold the quarry" (3.9); "build a ram" (3.10).
3. Several orders in one line, split on "and" or "then".
4. **It answers in one line**, before anything is sent: what it understood and what it costs ("Powder Mill on the back left plot: 160 gold"), or why not ("No free plot", "Not enough gold: 40 short"). An order it is not sure of is not sent.
5. It never surrenders, restarts or leaves a match by words.
6. Words for places come from the match: plots by their names, guns by their places, roads by left, centre and right.

### V2. Voice

1. Hold a key to talk (one that is free; never a toggle, so a cough gives no order). The words heard appear in the order line and go through the same grammar.
2. It uses the browser's own speech recognition where there is one, and is offered only where the page finds it and the microphone is allowed. On the claude.ai page the microphone is a capability the artifact must declare: read the artifact capabilities skill before building this, and if it is not to be had there, voice waits for a host of our own while V1 ships everywhere.
3. Numbers and names as spoken ("two", "second", "the left wall") are in the grammar's word lists.
4. An option: the steward answers aloud in a few words, with the browser's speech.

### V3. Standing orders

1. A few sentences the steward keeps doing until told otherwise, each a switch with a spoken form: "keep the gate mended first", "buy powder under twenty", "rebuild what falls".
2. Each is a small rule on the page that sends ordinary inputs when its condition holds; they are listed in a panel, and the AI's steward already has the code for most.

## Data and code

- A new package, `packages/orders` (DOM-free, pure): `parse(text, view)` gives a list of inputs or a reason, where `view` is what the page knows of its castle (plots, guns, gold). Its word lists are data.
- `apps/game`: the line, the key, the voice, the answer.
- No change to a match: an order is the same input a key sends.

## Tests and measures

- A table of sentences and the inputs each must give, in Node; every input kind but fire and aim has at least three sentences.
- Sentences that must be refused ("surrender", nonsense, an order for a plot that is taken).
- `tools/hud-check.mjs` gains the line: an order typed in a match builds the building.
- From play: which sentences people try that the grammar does not know. The line keeps the last twenty it refused, shown in the Controls panel, so the word lists can grow from them.

## Dead ends to hunt

- The line holding the keyboard while a wave is at the gate: Esc and a click on the scene both close it, and fire still fires.

## Try

Aim the long gun and, without leaving the sight, type "mill, then waves left". Then hold the talk key and say it.

## For the owner

- Should the steward talk back by default, or stay silent until asked?

## Status

V1, V2 and V3 built (November 10), page only: no match rule, input, version or hash changed. Every order goes out through the page's own functions for a key or a button (`giveOrder`, `setRoute`, `toggleRepair`, `select`, the build menu's send), so the match sees exactly the `MatchInput`s it sees today.

- **V1, the order line.** `packages/orders` (DOM-free, pure): `parse(text, view)` gives the inputs and a one-line answer, or a reason; word lists in `words.ts`. It covers build (and rebuild), buy, upgrade, order, route, each barracks' mix and route, repairs ("masons off the walls", "keep first"), which gun you ride ("take the mortar", "overview"), and the standing orders. A line splits on commas, "and", "then" (six orders at most); it is all or nothing, with gold counted across its parts. It refuses surrender, leaving and restarting ("Not by words: surrender or leave from the menu"), fire and aim, nonsense, a taken plot, short gold ("Not enough gold: 40 short"), a gun it cannot tell ("Which long gun? Say where it stands"). Plots are named as the build menu names them ("Mill on plot 5, back left: 120 gold"), left and right are the player's own. 23 Node tests hold a table of sentences (three or more for every input kind but fire and aim) and the refusals. On the page (`apps/game/src/steward/`): Enter in a match opens the line at the bottom; the mouse keeps aiming; Enter sends, Esc or a click on the scene closes it (the click still fires); Up recalls the last line. A refused line stays in the field; the last twenty refused lines are listed in Controls.
- **V2, voice.** Hold Y (never a toggle; T marks a landing, 3.2, the owner's answer, November 11) to talk; the words appear in the line and go through the same grammar on release. Sources: the claude.ai `dictation` capability when the page has it, else the browser's SpeechRecognition; with neither (or the microphone refused) voice is not offered and Y is not listed. **On the game link the artifact must declare `capabilities: {dictation: {}, tts: {}}`** (dictation for the words, tts for the steward's spoken answer; the browser's own speech recognition is blocked inside the framed page). Talking back: a Controls checkbox "Steward answers aloud", off by default (the owner's answer, November 10), speaking through the `tts` capability or the browser's speech.
- **V3, standing orders.** "Keep the gate mended first" (while your gate is open, wall, tower and keep repairs go off; they come back when it closes) and "rebuild what falls" (a wrecked building is rebuilt at half price once the gold is there). They are switched in words ("always rebuild", "stop rebuilding", "standing orders off"), listed as chips above the open line with an x each, and reset every match. "Buy powder under twenty" waits for 3.3, the other milestone words ("mark that", "powder", "buttress the front") for their milestones.
- **Checks** (merged with the integration branch at 0de4633): `npm run check` (157 tests), `npm run check:browser` (every pinned hash equal in Node and Chromium), `node tools/online-check.mjs`, `node tools/hud-check.mjs` (new: Enter opens the line, "mill" raises a building, "surrender" is refused and the match goes on, Esc closes it, Controls lists the refused lines): all passed.
- **Rounds.** Review: under pointer lock the browser keeps the first Esc, so the line stayed open; losing the mouse now closes it. Player's chair (thirty sentences a newcomer might type): "everyone advance", "retreat" (hold), "switch to the mortar" were refused, and "upgrade the mortar" said only "Not understood"; all now understood, the last answered with its two choices. Not tried in a real browser: voice and spoken answers (no microphone headless).

