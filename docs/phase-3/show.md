# Track S: the shot as a show

## Goal

Every big moment gets the best seat. An inset shows your shot land as it happens; the best moments of a match come back as replays from a film camera; a match ends with its own thirty-second film you can save; and a whole match can be saved and watched again.

The owner asked for the kill cam by name. S1 and S2 start with milestone 3.1 and need nothing else.

## Why

From the long gun a hit is a puff 150 m away. The shell ride shows how much a good camera gives, but only the mortar has one. And physics games are passed on as clips: a film at the end of every match is the cheapest way this game can be shown to someone.

## What the code allows (traced on November 10)

- A frame from the worker holds only what moved. A stone at rest, a body that has stopped moving, the ground's craters and a gun's state are sent once and then remembered by the renderer. So a stretch of recorded frames cannot be drawn again without a picture of the renderer's world at its start: a **keyframe**.
- Every array in a frame is transferred to the page, so keeping frames costs no copying: about 0.5 MB a second in a calm match, and up to 0.5 MB for one frame of a great collapse.
- There is one renderer and its state only goes forward. A second camera on the same moment is cheap; a replay of the past must take the renderer over and give it back.
- A free camera can already look anywhere while a match runs (the screenshot tools' `look()`), and `render-test.ts` already drives the renderer from frames with no sim.
- No list of a match's inputs is kept anywhere today (`Match.step` drops each tick's inputs once applied), and no whole-world snapshot exists. Replays by running the sim again need a log first (S6).
- The match never slows for a camera online. Slow motion in a replay is the page drawing recorded frames slowly.

## Steps

### S1. Moments and the book of feats

1. A **moment** is something worth showing: when, where, what kind, whose doing, a score, and a line of words ("Tower down: 212 stones, 9 men, a gun").
2. The page finds moments from what it is already told (the earned feed with its places, each shot's tally, gun and plot states, the keep's floors, the storm) and from two new events the sim adds without touching a match's state:
   - **Down**: a man fell, with the cause the sim already records (ball, burst, masonry, blow, fall, musket), the shot and how far he was thrown;
   - **Fell**: a count of stones that came loose this tick by structure.
3. Kinds to start with: a multi-kill; a ricochet kill; a collapse kill; a man thrown 20 m or more; kegs set off in a chain; a gun silenced; a building wrecked; a gate down; a breach opened; a floor caved in; a banner down a floor; a bridge down with men on it; a storm begun or beaten off; the last blow of a match. Each milestone adds its own (a mark's salvo, a magazine, a topple, a fire, a rout, an engine wrecked).
4. Score: a base by kind, times its size (stones, men), more for the rare.
5. **The book of feats**: named moments with a threshold, about fifty by the end of phase 3 ("Timber", "Domino", "Skipping stone", "Return to sender" for a keg sent back among its own). A first feat gets a toast and a page in the book with its date and your best. Feats pay no gold: the four trick shots that pay stay in the rules.

### S2. The impact cam

1. A second camera draws the same world, at the same instant, into an **inset** (a quarter of the screen's width, 16 by 9, under the top bar on the right, in a thin brass frame).
2. It opens when a shot you fired by hand is a second from landing (the flight the page already predicts for the shell ride), and for a moment scoring high within your own castle that you are not looking at.
3. The camera stands 30 to 40 m to one side of where the shot will land and a little above, on the side clear of masonry, and pushes in slowly. It stays 3 s past the landing, then closes.
4. A click on it swaps it with the main view until it closes. K (if free) turns the impact cam off and on; it is on to start for the long gun and the chain shot, and off for the mortar while the shell ride is on.
5. Cost: a second pass of the scene at about a third of the resolution, with no ambient occlusion, sharing the shadow map. It is skipped while the frame pacer is at its lowest resolution.
6. It only draws, so it is the same online.

### S3. The recorder

1. The page keeps the last 40 s of frames as they came (to a cap of 48 MB), with each frame's gun barrels, guns out, storm and bridges.
2. Every 10 s it takes a **keyframe** of the renderer's world: every stone not at its place as built (dust and withdrawn ones too), the bodies that have stopped moving, the ground, guns out and fallen, the kegs sappers have set down, plots, and later the state of fire, smoke, water and the day. `capture()` and `apply()` are a pair: applying a keyframe must put the renderer exactly there.
3. When a moment scores above the film's line, its **clip** is copied out: the keyframe before, and frames from 4 s before the moment to 6 s after. The **reel** keeps the 8 best clips of a match, to 120 MB; the lowest score goes first.
4. What the renderer makes up by chance (where a limb falls, a decal's turn) is drawn from the event's own tick and place, so a clip looks the same each time it is played.

### S4. The replay

1. A replay takes the renderer over: apply the clip's keyframe, feed its frames to a timeline at the speed wanted (a third of a second runs unseen first, so figures and smoke are in step), then apply the keyframe of now to give the view back.
2. When replays play:
   - at a match's end, the last blow, before the end screen;
   - on the end screen, as the film (S5);
   - alone (the Practice range, a siege, a match against the AI), R (if free) replays the last moment while the match waits;
   - never over a match against a friend, where the impact cam serves.
3. **The director**: a recipe by kind of moment. A topple: side on from 60 m, low, at real speed through the lean, a quarter speed from the release to the ground, real speed for the dust. A multi-kill: beside the ball at a fifth speed. A magazine: wide, then close as the stones come down. The camera never passes through standing masonry, and a clip is filmed the same way each time.
4. In a replay the HUD is hidden, the bars close in top and bottom, a caption gives the moment's name and its tally, and the sound is played again from the clip's events (lower and longer when slowed, as a burst already is). Notes, tallies and gold are not given twice: the page's handling of a frame is split into what the world shows and what the match tells.
5. Depth of field and motion blur (track L, round L5) are for replays and photos only.

### S5. The film and the photo

1. "Watch the film" on the end screen: a title card (both castles' colours, the result, the day), the five best clips in the order they happened, 30 to 45 s in all.
2. "Save the film" records the canvas and the game's sound as the film plays (the browser's own recorder: webm, or mp4 where it is offered) and hands over a file.
3. **Photo mode**, in a replay or a waiting match: a free camera, the field of view, the focus, a step forwards and back through the clip, the HUD off, save a picture.

### S6. The log and replay files

1. The worker keeps every input a match applied (tick, team, seat, input) and the match's setup (mode, seed, levels, options, both rules versions, a hash of content). Aim inputs are only for drawing a barrel: keep one in four.
2. "Save the replay" writes a small file. "Watch a replay" opens one and runs it as a match with both castles driven by the log: free cameras, and 1, 2 or 4 times speed as the machine allows. A file from other rules versions is refused, and says why.
3. The log is also what rewind needs (3.12), what the observatory needs to show a match from its table, and what a bug report should carry.

## Data and code

- All of it is on the game page (`apps/game`), except the two events of S1 and the log of S6 in the worker. No pinned hash moves; say so in the Status.
- New modules: `moments.ts`, `feats.ts`, `recorder.ts` (the ring, keyframes, the reel), `replay.ts` (the player), `director.ts`, `film.ts`; the inset in the renderer (`GameRenderer` draws a second camera to a part of the canvas).
- The renderer gains `capture()` and `apply()` across its stones, bodies, ground, guns and plots.

## Tests and measures

- Apply a keyframe, play its clip twice: the same pictures (a contact sheet test, as `tools/anim-shots.mjs` does).
- After a replay the live view equals what it would have shown (compare stone poses with a page that did not replay).
- The reel never passes its cap.
- A replay file run again ends at the saved match's final hash.
- New tools: `tools/show-shots.mjs` (stills of the inset and of each director recipe on the test clock).
- Measure the inset's cost in frame time at each tier, and the recorder's memory through a ten-minute match.

## Dead ends to hunt

- A replay that leaves the view in the past (the live keyframe is always applied, also when a replay is skipped).
- A film on a machine too slow to draw it in time: the recording follows the game's clock, not the wall's.

## Try

Fire the long gun and watch the hit in the inset. Win a match and watch its last blow from the director's chair, then the film; save it and send it to someone.

## For the owner

- Should the impact cam be on by default? The spec says yes for the long gun and the chain shot.

## Status

S1 and S2 built on November 10 (branch `claude/festive-keller-mgdjup`, with milestone 3.1's tools), through the build and review loop: two executors in parallel, merged and wired by the master. No pinned hash moved (the session, keep, wave, estate, AI and guided hashes and the lab's all hold, in Node and in Chromium).

S1, moments and the book of feats:
- The sim adds two page events without touching a match's state: Down `[16, man, cause, shot, speed]` (his body's fastest part just after the blow) and Fell `[17, castle, repair section, count, 0]` (pieces that came loose this tick). They are drained from logs in `minions.ts` and `castleSim.ts` at each step; nothing reads them in a match.
- `moments.ts` finds 19 kinds from what the page is told: the 15 of S1.3, plus a tower down (40 stones or more and 30% of a tower), a keg sent back among its own men, a floor caved (each floor lost while the banner stands) and the banner on the ground. A shot's knockdowns close into one moment 90 ticks after the last; masonry closes after 150 quiet ticks; a man thrown is measured from where he fell to where his body settles (bodies leaving at 9 m/s or more). Scores come from one table at the top of the file (`SCORE`).
- `feats.ts`: 22 feats ("Skittles", "Domino", "Timber", "Mountain of rubble", "Skipping stone", "Return to sender" and more), only the player's own doing, stored per viewer (`keepfall.feats.v1`, the date of the first and the best). A first feat shows a toast at the left under the gun tabs; the Book of feats opens from the menu (start and pause).
- On the test clock against the Knight, 100 s of shots gave guns silenced, multi-kills of two to eight, a man buried, the gate broken, a breach of 82 stones and a tower of 189 (`tools/moments-check.mjs`). Kinds not met in those runs (a ricochet, a man thrown, kegs, a storm, a floor, a bridge) are covered by the unit tests only. In the Practice range there is no earned feed, so a ricochet there counts as a multi-kill.

S2, the impact cam:
- The inset (a quarter of the screen's width, 16 by 9, under the top bar on the right, a brass frame marked IMPACT and K) opens about a second before a shot you fired by hand lands: the long gun and the chain shot, and the mortar with its shell ride off. The page predicts each shot's landing from its own state (spin included) with the walls in the way; a shot that lands early opens it at once. It holds 3 s past the landing, then fades out.
- Its camera stands 30 to 40 m to the side of the landing and 6 to 12 m up, on the first bearing whose sight line is clear of stone and ground (the renderer's ray test), and pushes in 15% while open.
- A big moment (score 150 or more: a tower, a breach, a floor, six men or more with one shot; and your gate broken, whatever its score) in your own castle that is not on your screen opens it too. Moments close once their stones settle, so it shows the ruin and its dust; replays (S3, S4) will show the fall itself.
- K turns it off and on (remembered per viewer). It is skipped while the shot camera (V) follows the shot, and while the frame pacer is at its lowest resolution.
- Drawn as a second scene pass into a render target a third of the drawing buffer's size, with the main view's tone mapping and grade but no ambient occlusion, bloom or edge smoothing, sharing the sun's shadow map. In headless software rendering it adds about 40% to 50% to a frame while open (no GPU timing here); measure it on the laptops.
- Gap: a click on the inset swaps it with the main view, but while the pointer is locked to the gun a click fires instead, so the swap works only with the mouse free (Esc) or in the overview.
- Tools: `tools/show-shots.mjs` (stills before, at and after a landing for each gun), `tools/impact-cost.mjs` (the inset's cost); `tools/hud-check.mjs` checks K and the inset opening and closing.

S5, the film and the photo (branch `claude/keepfall-show-s3-s6`, built in a worktree):
- `film.ts`: the plan (`chooseClips`: the five best clips by score, played in the order of their moment ticks; `planFilm`: a 3 s title and per clip a budget so that five clips come to 40 s at most, no clip over 9 s with its lead, so a reel of fewer clips gives a shorter film and the end screen says so), the title card (both castles' colours, the result, how it ended, the day), `drawOverlay` (bars, caption, speed mark, title card on one 2D canvas: the page and the recording draw the same thing), the `Film` state machine (clips chained through `ReplayPlayer`, no live frame between two clips, Esc or Skip ends the whole film), `FilmRecorder` and the photo camera.
- The end screen has Watch the film and Save the film (not online, hidden with an empty reel). Saving records a 2D composite (the game canvas drawn right after `renderer.render`, plus the overlay) with `MediaRecorder`, and the game's sound (`Sound.recordFeed`: the last node of the chain also feeds a stream destination). webm (vp9 or vp8 and opus) where offered, mp4 only where webm is not (Safari). The file is named `keepfall-film-<date>-<time>.webm`.
- The recording follows the game's clock: while saving, a film frame is a fixed 1/25 s of game time (not 1/30: 40 ms is whole Opus frames), the recorder runs for one such slot of wall time around `requestFrame()` and is paused (and the audio context suspended) while the next frame is drawn, balanced against a running total so timer jitter does not add up. With 150 ms of busy wait added to every page frame (and about 0.8 s a frame in this container anyway) the file's picture is within 0.3% of the film's game time.
- Gap: in this container the saved sound stream runs about 30% longer than the picture (5.9 s of sound against 4.5 s of picture in a 4.5 s film; the picture is exact). An isolated test of the same pause and resume cycle on a bare oscillator showed no such difference, so it comes from something in the game's chain or the recorder that was not found. Check it on a real machine before relying on the sound's timing.
- Photo mode (O): in a replay (pauses it) or in a waiting match (the user's pause, or held). A free camera (WASD, mouse with the pointer locked, Q and E down and up, Shift faster), the wheel for the field of view, comma and period or the arrows step the clip back and on (`ReplayPlayer.scrub`: the keyframe goes in again and the frames roll forward; not in a waiting match), the HUD off, C or Space or the button saves a PNG of the canvas right after a render (no bars). O or Esc leaves: the replay goes back to the tick it was at, the live camera comes back. The focus control is left out: the renderer has no depth of field hook (track L, round L5).
- Tools: `tools/film-check.mjs` (photo, film, still, save, slow); stills `tools/.shots/S5-*`.

S3, S4 and S6 are described above by the build that made them; see their own notes.
