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

Not started.
