# Track L: the look

## Goal

Rounds of visual work that make the game look finished and unlike anything else: a map drawn like a plan, a gun that kicks, stone that remembers what was done to it, a valley the wind moves through, light that changes through a day, and an overview drawn like a siege engineer's engraving.

The game page only. No round changes a match, so no pinned hash moves.

## What is there today (traced on November 10)

- **Light**: one low sun (fixed at 21 degrees), a sky fill and a fill opposite the sun, one pooled point light for flashes. One shadow map over the whole battlefield, no cascades. Ambient occlusion on High and Ultra only. Height fog with the sun scattered in it. AgX tone mapping, a light bloom, a grade, a vignette, grain. No depth of field, motion blur, reflections of the scene, light shafts or cloud shadows.
- **Sky**: a gradient with a cloud layer that drifts slowly. No time of day, no weather.
- **Stone**: instanced sharp boxes (the bevel code is unused in Gritty), wholly procedural materials with mortar, grime, lichen and soot. Damage does not show on surfaces: no pale fresh breaks, no scorch.
- **Effects**: pooled GPU sprites for flash, fire, smoke, dust and chips, a shock ring, splashes. No trails behind shots, no burning timber or embers, no haze left after a collapse. Decals are blood only.
- **Ground and growth**: a rich procedural ground with craters shaded as mud; grass is colour only; trees, bushes and reeds are merged primitives that sway on fixed waves, not on the game's wind.
- **Figures and guns**: men are instanced capsules on a procedural rig with gore; gun crews are not drawn at all; guns are plain primitives with no recoil; the camera shakes for bursts and does nothing when you fire.
- **The overview** is the same scene from above; the minimap is a separate 2D drawing.
- **Seen in stills at High**: the picture sits in a narrow band of grey-green; a keep's shaded face goes nearly black; the castles are bare blocks with no dressing and no life; the barrel that fills the bottom of the screen all match is a grey cylinder; the far castle is small in the default sight.
- **Open bug**: seen low towards the sun, a stretch of ground by the stream draws as a white sheet.

## Rounds

### L0. The minimap, redrawn

The owner's ask on November 10: the minimap looks raw. The target is drawn in `docs/phase-3/minimap-mock.svg` (twice its size, at its real size, and today's beside it). Build to it; exact colours and strokes are in the file.

1. **A plan, not a diagram.** Walls are stone-coloured with a dark edge; towers are rings; the keep is a square of stone round a dark floor. Each castle has a soft glow and a faint tint of its team's colour under it, and that is the only place the team's colour sits on masonry.
2. **State by pattern first, colour second.** Sound stone is plain; damaged stone is hatched; half gone is hatched in amber; a breach is a real gap with rubble in it and a red arrow where men can walk in. A colour-blind player reads the hatching.
3. **Where it happened.** Each wall is drawn in six parts along its length, so a breach sits where it is. The worker's count of what stands (twice a second, eleven sections a castle today) grows to six cells a wall.
4. **Buildings are small tiles with a sign**: crossed pikes for a barracks, a wheel for a mill, a flame for a Foundry, a keg for a magazine with a bar for its stock (3.3). Rising: a dashed brass edge. A ruin: a dashed red edge, its sign dimmed. An empty plot: faint dots.
5. **The keep** shows its banner in the team's colour and a pip for each floor under it.
6. **Guns** are brass studs where they stand: a white ring round the one you ride, a red struck ring when one is out, a hollow dot for an empty slot. (From 3.6: a hollow brass ring for a gun with no crew.)
7. **The field**: the centre road a firm line, the flank paths dashed, the stream a ribbon with a light thread, ridges a soft shade. A bridge is planks; down, it is two stubs and a red stroke.
8. **Men** are dots with a dark rim; a group of six or more has its count beside it in a small plate of its team's colour. Each side's total stands in a corner by a pennant.
9. **It moves**: a section flashes once when it is hit; dots glide between updates; a group's plate fades in and out; a storm draws its ring round the courtyard.
10. **It grows**: hovering it, or holding a key, shows it at twice its size over the scene. Later systems each get one sign in the same hand: marks as chalk crosses (3.2), organs (3.5), nerve as a bar on a plate (3.10), places and their holders (3.9).
11. Checks: `tools/hud-check.mjs` and stills at both sizes in the states of the mock.

### L1. The gun in your hands

1. **Recoil.** The gun leaps back on its carriage and its crew run it out again as it loads. The camera goes with it: a short jolt back and up and a punch of the field of view, by the gun's weight.
2. **The blast.** The flash lights the wall and the crew; dust jumps from the wall walk; smoke stands before the sight and drifts off with the wind (for the eye only until 3.7 makes it count).
3. **A crew at every gun**, drawn at their work: swab, load, ram, run out, so a reload can be read without the bar. (Figures on the page only until 3.6 makes them real.)
4. **A trail.** A faint streak behind a round shot for its first half second, a spark and a thread behind a shell, so the eye can follow what it fired.
5. **The gun as a showpiece.** The barrel you look down all match: bronze with cast rings and a vent, a quoin, breeching ropes, a worn carriage; a garland of shot and the powder box beside it (its kegs are the ready box of 3.3), a slow match glowing.
6. **The gunner's glass.** Zoomed in, the sight is a telescope: the haze is cut by a third inside it, a soft dark ring frames it, the edge blurs a little. The far castle is where the eye works most; it should be the clearest thing on screen.
7. **A hit that reads at 150 m**: a bright blink of dust sized for the distance, before the cloud.

### L2. Stone that remembers

1. **Fresh breaks.** A face bared when its neighbour went is paler and rougher than weathered stone (SPEC section 13 asks for this).
2. **New stone.** What masons put back stays a shade paler for the rest of the match, so a wall shows its history.
3. **Scorch and soot** where shells burst, where guns fire, where fire has been.
4. **Cracks** across a course near crushing (3.4's report), and chipped edges on every block at High and above.
5. **Dust that stays.** A low haze hangs over a great collapse for half a minute to a minute and drifts with the wind; a pale wash settles on stone nearby.

### L3. A living valley

1. **The game's wind moves everything**: trees, reeds, grass, flags, smoke. A gust shows as a front crossing the grass and the treetops before it reaches your shot, so the wind can be read from the land and not only the gauge.
2. **Cloud shadows** drift over the valley with the wind: cheap, and it gives the whole picture depth and motion.
3. **Grass in tufts** near the camera at High and above.
4. **Life**: birds that rise at gunfire, smoke from chimneys and braziers, paths worn darker where waves have marched.
5. **Trees with shapes**: two or three kinds with real outlines, flat cards far off.

### L4. Light and weather (with 3.7 and 3.8)

1. **Four lights for four parts of the day**: a cold blue dawn with fog lying in the stream's hollow; a day with the sun breaking through moving cloud; a slate dusk with rain, wet dark stone, puddles and lightning; a night with a rim of moonlight and fire as the only warm light.
2. **Fire**: flames along what burns, embers on the wind, heat shimmer, char where it has been.
3. **Smoke as a volume** drawn from the sim's grid, and fog, rain and dark, all hiding the same on every tier (rule 8 of `docs/phase-3.md`).
4. **A pool of lights** (eight) for the fires, braziers and flashes nearest the camera; the rest glow.
5. **Shafts of sun** through smoke when the sun is in view.

### L5. Depth and shadow

1. **Shadows in two ranges**: a tight one round what the camera looks at, so merlons throw sharp shadows in the sight at 150 m, and a wide one for the rest.
2. **Corner darkening baked from the layout's neighbours** for each stone: free at run time, and it gives Low and Medium the depth that ambient occlusion gives High.
3. **The stream reflects** the far bank and the castles at High and above.
4. **Exposure that adapts** slowly, for night and for flashes.
5. **Depth of field and motion blur** for replays and photos only (track S).
6. Fixes: the white sheet by the stream; the shaded faces that go black at High; grain by the scene's brightness.

### L6. Faces and figures

The art round the handoff already lists (models built by scripts in Blender, with their licences committed).

1. **Men by their shape**: pikeman, musketeer, sapper, mason, gunner, powder boy, rider, each known as a black outline at 100 m.
2. **Guns, carriages and props**: kegs, baskets, carts, ladders.
3. **Castles that are places**: timber hoardings and tower roofs (they burn in 3.7), a gatehouse with a portcullis, arrow slits and windows as dark recesses, corbels under the battlements, a sloped foot to the walls, stairs, a well, larger stones low and smaller high. Dressing that is not physics falls away with the stones it hangs on.
4. **Heraldry**: each player has arms (a charge and two colours, chosen once). They fly on banners, tabards, the minimap's pennants and the film's title card.

### L7. The map as an engraving

1. The overview can be drawn in the manner of a siege engineer's plan come to life: ink outlines, hatching by slope and shadow, the tone of paper, shots as ruled arcs, marks as chalk crosses, groups as small flags.
2. It is a choice beside the natural view; the owner picks the default after seeing both.
3. The minimap (L0), the day's strip (3.8) and the film's cards share its hand. It is the look by which a screenshot of this game is known.

### L8. Type and ornament

One display face and one text face across the menu, the HUD, the end screen and the film; engraved rules and cartouches; figures that line up in columns; the start menu over the valley in the day's best light.

## Order

L0 first. L1 with track S's impact cam. L2 and L3 at any time. L4 with 3.7 and 3.8. L5 after L4. L6 when the owner wants the art round. L7 and L8 last, once the systems they draw exist.

## Rules for every round

- The readability rules of SPEC section 13 hold: marks for aiming are cold white, and effects never hide a shot (`render/clearview.ts`).
- Measure before and after at each tier (`tools/burst-cost.mjs`, the HUD's frame numbers on both laptops) and say so in the Status. A round that costs Kat's laptop its 60 frames at High is not done.
- Stills before and after with the screenshot tools, at High as well as Low. In headless Chromium a page loaded on Low can be raised to High through the quality list for a still (about a minute a frame in software).

## For the owner

- L0: is the mock the right direction, or would you rather see the paper-and-ink version of L7 on the minimap from the start?
- L6: heraldry chosen by each player, or drawn from their name?

## Status

L0 built on November 10 (branch `claude/festive-keller-mgdjup`), by an executor in the build and review loop, to `minimap-mock.svg`. Page only: no pinned hash moved.
- The worker counts 30 sections a castle (2 bytes each, see `protocol.ts`): the four walls in six cells each (the front's three left of the gate and three right of it, the sides front to back, the back across), the gate, four towers and the keep.
- Thresholds (named at the top of `minimap.ts`): sound at 94% standing or more, amber under 60%, a breach where under 60% of a cell's foot stands; the gate is sound at 96%.
- Buildings as tiles with a sign (crossed pikes, a wheel, a flame), rising with a dashed brass edge, a ruin with a dashed red edge; guns as brass studs (a white ring for the one you ride, a red struck ring when out, a hollow dot for an empty slot); a bridge down as two stubs and a red stroke; men as rimmed dots with a plate for a group of six or more; each side's count by a pennant; a cell flashes for 0.7 s when hit; dots glide; a storm draws a ring with its hold so far.
- Hover or hold G: twice the size over the scene, drawn at device pixels.
- Cost: 0.26 ms a draw at real size, 0.41 ms at twice the size (the ground, glow and panel are cached per size).
- Ridges are four soft shades placed by eye, not traced from `map.ts`. The threat strip above it still has three equal cells, which sit a little off the new flank roads.
- Tools: `tools/minimap-shots.mjs` (stills at both sizes in the mock's states); `tools/hud-check.mjs` checks the hover and G.

L2 and L3 built on November 11 (branch `claude/keepfall-look-l2-l3`), by five executors in the build and review loop. Page only: nothing in a match changed and no pinned hash moved (`npm run check:browser` matches Node on every hash).

L2, stone that remembers:
- Per-stone wear lives in one place, `apps/game/src/render/wear.ts` (StoneWear; the rules in `wearLogic.ts`, tested in Node; the shading in `wearShading.ts`). It owns a vec4 per stone (fresh face, scorch, crack, dust) fed to the stone shader as `iWear`. For replays (S3) it has `capture()` (a Float32Array, 4 per stone) and `apply(state)`, and `clear()` on a reset.
- A face bared when its neighbour goes is paler and warmer; stone the masons lay stays a shade paler. Scorch where shells burst, above a gun that fires, by a burning keg. Hairline cracks across a course, drawn by pixel width so they still read at 150 m in the sight. Chipped edges at High and Ultra (`tier.chips`).
- Cracks today follow damage and near misses: 3.4's crushing report does not exist yet. When it lands, call `wear.setCrack(id, v)` from it.
- Dust that stays (`haze.ts`, rules in `hazeLogic.ts`): 25 or more pieces of one section falling within 1.5 s raise a low haze for 30 to 60 s that drifts with the match's wind, thins near the aim line (ClearView) and fades softly where it meets a wall (against the depth buffer). It settles a pale wash on nearby stone (`wear.dustAround`) and ground. `capture(now)` and `apply(saved, now)` for S3.
- Ground marks (`groundMarks.ts`, rules in `groundMarksLogic.ts`): char and ash where shells burst low and kegs burn, and paths worn darker where waves march (two to three minutes of marching; one man leaves nothing). `capture()` and `apply()` for S3.
- Not done: trodden ground only darkens (no wetness in hollows, grass not thinned there).

L3, a living valley:
- One wind (`windField.ts`, CPU half in `windState.ts`): trees, reeds, bushes, grass, tufts, flags, smoke, haze and birds all read the match's `windX`, `windZ`. A gust shows as a front crossing the land before it reaches the gun you ride and rolls on downwind for 5 s after (30 m/s, band 9 m). To know the coming wind, the sim's frame now carries `gustX`, `gustZ`, `gustIn` from a new `Wind.lead(tick)` in `packages/sim/src/wind.ts`: a pure read, not in the hash, no Rng draw (a test in `sandbox.test.ts` holds the session hash). The front shows as pale streaks and a broad bright band on the grass (`windSheen.ts`): it reads, but softly.
- Cloud shadows (`clouds.ts`): drift with the wind at 1.6 times its speed; they dim only the sun's light (receivedShadowNode) on terrain, stone, guns, men and the rest.
- Grass tufts near the camera at High and Ultra (`grass.ts`, `grassLogic.ts`): 8 m tiles in a ring, about 8,000 to 9,000 blades, none on roads, water, castle pads or craters, gone by 35 m.
- Life: crows (`birds.ts`, `flocks.ts`) rise from three perches when a gun fires or a shell bursts within 120 m and settle elsewhere after 20 to 40 s; braziers (`braziers.ts`, `brazierLogic.ts`), three a castle on merlons, with a thread of smoke, go out when their stone falls; chimney smoke was already there (M3); worn paths as above.
- Trees with shapes (`treeShapes.ts`, `treeRaster.ts`, `treeCards.ts`): two spruces, two oaks and a dead tree as real models on the battlefield, fading over 12 m into flat cards painted from the same shape beyond it. Tree triangles 243,626 before, 311,306 after.

Cost (tools/burst-cost.mjs, calm frame, software WebGL2 in headless Chromium on a shared machine, so only ratios mean anything; each pair run back to back against the branch before L2):

| Tier | Before | After | Ratio |
|---|---|---|---|
| Low | 867 ms | 1133 ms | 1.31x |
| Medium | 1341 ms | 1815 ms | 1.35x |
| High | 1442 ms | 1895 ms | 1.31x |
| Ultra | 1636 ms | 2013 ms | 1.23x |

Earlier pairs gave 1.21x to 1.39x. Taking parts out at Medium: the grass sheen about 7%, cloud shadows about 3%, stone wear about 2%, the trees the largest part (the wind's bend on every tree vertex, drawn twice with the shadow pass; software rendering pays vertex work in full). Bursts cost the same as before (1.0x to 1.08x). Three hazes at once add about 7%. Trees inside the battlefield draw without the fade's alpha test, which a tile GPU such as the M3 rewards and software rendering does not show. Not measured on Kat's M3: please try High there. Levers if it misses 60 fps: the sheen's fine streaks, tree shadows at Low and Medium, a shorter tree fade.

Stills (written to `tools/.shots/`, made again by the tools):
- `node tools/valley-shots.mjs --quality=low|high --tag=l23-after-low|l23-after overview sight treeline valley-side`; before: the same views from the branch before L2 (`valley-l23-before-low-*`, `valley-l23-before-*`).
- `node tools/gust-shots.mjs --quality=low|high`: `gust-<tier>-0..5.png`, six stills half a second apart, a front crossing the meadow.
- `node tools/wear-shots.mjs low|high after`: `wear-after-<tier>-near|far|sight.png` (fresh faces, soot, cracks, at 150 m in the sight).
- `node tools/look-marks-shots.mjs --tier low|high`: `look-scorch|haze|paths-<tier>-before|after.png`.
- Tufts, crows and braziers (executor E's): from a free camera at ground level, a gatehouse close-up, and the sky 8 s after a mortar burst.

Replays (S3 to S6, merged in): L2 and L3 register keyframe parts with the renderer (`GameRenderer.registerBuiltInParts`): `wear`, `groundMarks`, `haze`, `braziers`, `birds` and `wind` (the wind's fronts and drift and the clouds' place). Ground dust fades by sim ticks and the wind takes each sim frame once, so a clip draws the same picture each play. `node tools/replay-check.mjs` passes.

Tests: `apps/game/test/wear.test.ts`, `haze.test.ts`, `windState.test.ts`, `treeShapes.test.ts`, `lookLife.test.ts`, and the sim's lead test. Seen in the player's chair: the valley overview, the sight, a gust front, haze at a gate, soot and cracks; not yet seen by a person: the impact cam inset with haze, tree lean against the flags in motion.

L1 built on November 13 (branch `claude/keepfall-look-l1`), by three executors in the build and review loop, with milestone 3.3 (powder, branch `claude/festive-keller-mgdjup`) merged in before the last checks. Page only: nothing in a match changed and no pinned hash moved (`npm run check:browser` matches Node on every hash). No new keys.

The gun as a showpiece (`render/gunModel.ts`, `render/guns.ts`):
- Long gun and chain shot: bronze barrels turned on a lathe (cascabel, base ring, reinforces, chase, astragal, a flared muzzle, a dark bore, a vent), trunnions under iron cap squares, a worn carriage (stepped cheeks, transoms, trucks with iron tyres), a quoin that follows the breech as the barrel lifts, breeching ropes that sag and go taut as the gun rolls back, a platform of planks. The mortar and the swivel are cast iron.
- Beside each gun, on the floor and turned with its rest aim: a garland of shot (the chain shot's: chained pairs; the mortar's: a crate of shells), a powder box with its kegs, and a tub with a slow match glowing (one additive instanced draw for every gun, flickering by the renderer's clock).
- Draw calls fell (geometries merged per material per gun): 453 to 377 at Low on the Practice range; triangles rose about 11% (881k to 976k at Low; 1.51M at High). Levers if it costs: the lathe's 18 radial segments and its profile points.

Recoil and the camera (`render/recoilLogic.ts`, `render/recoilCam.ts`):
- The long gun leaps back 0.55 m (the chain shot 0.6 m) in 0.07 s, stays back while the crew load and is run out between reload stage 0.75 and 0.92, so a gun that stands run out is a loaded gun. The mortar's bed thuds down 5 cm; the swivel springs back on its yoke.
- The stage comes from the match's reload: the page calls `renderer.setReloads(reload)` with each frame; replays carry it in `FrameExtras.reload`. A feed only moves the stage forward; between feeds it creeps on by the renderer's clock.
- The camera's jolt on the gun you ride (sight only; the mortar's spotter gets a small tip and fov punch): long gun 0.30 m back, 0.10 m up, 0.9 degrees, +2.5 degrees of fov; chain shot 0.35, 0.12, 1.1, +3; swivel 0.12, 0.04, 0.5, +1. It rises in 0.035 s, decays with 0.11 s and is exactly zero from 0.45 s. It is laid over the picture only and taken off after the frame is drawn, so the aim, the aim arc and the next shot never see it. None in replays or the impact cam.

The blast (`GameRenderer.spawnMuzzle`):
- The flash light of a far gun stands back from the muzzle and over the carriage, so its crew and merlons flare warm. The gun you ride keeps its light a metre ahead of the muzzle (over the carriage, right under the sight's camera, it bleached the barrel white in the player's chair), a little longer. A small flash still does not steal the light from a big one.
- A low ring of pale dust jumps from the floor round the carriage (6 puffs for the long gun and chain shot, 4 for the mortar, 2 for the swivel), settling in 1 to 2 s, never below the walk it rose from.
- A bank of grey-white smoke ahead of the muzzle, larger and slower than the old muzzle smoke, 3 to 5 s, carried off by the wind, thinning near the aim line and the crosshair (`clearAim`). For the eye only until 3.7. Both are pooled, sized for a salvo of 8 guns.

A crew at every gun (`render/crewLogic.ts` pure and tested, `render/crews.ts` instanced):
- Long gun and chain shot 4 men, mortar 3, swivel 1, in both castles. Figures on the page only (3.6 makes them real): the same capsule parts as the men, dark cloth, a soft cap in the team's colour, a leather apron, a 3 m staff (sponge and rammer) and a linstock with a glowing tip.
- By the reload stage (one table at the top of `crewLogic.ts`): stand clear as it leaps back (0 to 0.08), swab with three strokes (to 0.3), load the cartridge from the box and the ball from the garland (to 0.5), ram with two strokes (to 0.72), lean on the carriage and run it out (to 0.92), stand ready with the gunner by the breech (to 1). At the shot the gunner touches the vent and leans away. The mortar's crew swab, load the powder, carry the shell between two; the swivel's man works the breech, then stands at the tiller.
- A pose is a function of the gun's stage, slide and shot age (and a small sway by the renderer's clock): no state of its own, so a keyframe or a fast forward lands on the right pose and replays and the inset show the crews like the main view.
- Nobody stands in the sight's line on the gun you ride (a man who would steps aside), and a head within 0.8 m of the camera is hidden. The wall walk is only about 2 m deep, so two men work from the platform's strips beside the cheeks and the rest from the walk behind it.
- A gun knocked out has no crew; when it is back, so are they. Posing all 64 men costs 0.027 ms a frame in Node.

A trail, the glass and the blink:
- Trail (`render/trails.ts`, `render/trailLogic.ts`, one instanced draw): a pale tapering streak behind round shot and chain shot for their first half second, and a grey thread behind a shell over its last 1.5 s of path, drifting with the wind, the fuse's spark as before. Grape has none. A keyframe part `trails` for replays.
- The gunner's glass: zoomed in past 55% of the way (whole at 90%; the default zoom shows none), the haze is cut by a third inside the sight's circle, a soft dark ring frames it (at most 45% darker, from 0.92 of the half height) and the edge blurs up to 3 px. The far castle is the clearest thing on screen. Not in the impact cam's inset, replays or photo mode.
- The blink (`render/blink.ts`): a pale warm flash of dust at each hit, 0.18 s, sized by the distance (0.026 of it, 0.5 to 4.5 m), before the cloud.

The powder box and milestone 3.3: the kegs in each box are drawn from `renderer.setReadyBox(emplacement, charges, capacity)` (in `api.ts`): none for no charges, else four times the share of the capacity, rounded up, at most four. With 3.3 merged in, `setPowder` calls it for every gun in both castles from `MatchInfo.boxes` (box now of box size; an empty slot is skipped; a match without powder shows four). It follows the page's latest match info, so a replay shows the boxes as they are now, not as they were in the clip: to show the clip's, carry the boxes in `FrameExtras` beside `reload`.

The match glow and the AO (found in the player's chair at High): the scene pass writes each pixel's normal for the AO, and every transparent quad overwrote it, so the ground behind the crew's match read as a wall and the AO drew a dark square round the glow. The normal target now blends as each material does (`post.ts`), and every additive material (the guns' and crews' match glow, flashes and fire bursts, sparks, the shock ring, braziers) writes nothing to it (`noAoNormal` in `tslUtils.ts`). Opaque and smoke materials write it as before. High and Ultra only (Low and Medium have no AO).

Cost (software WebGL2 in headless Chromium on a shared 4 core machine, so only ratios mean anything; before is `main` at c893788, run back to back with the branch before 3.3 was merged in (the AO fix after it changes only blend state); `tools/fire-cost.mjs` and `tools/burst-cost.mjs`):

| Tier | Calm before | Calm after | Ratio | After a shot (+0.1 s, +1.5 s) | A burst (+0.3 s, +1.3 s) |
|---|---|---|---|---|---|
| Low | 1037 ms | 1101 ms | 1.06x | 0.98x, 1.01x (before 0.97x, 1.01x) | 1.00x, 1.01x (before 1.00x, 1.00x) |
| Medium | 1648 ms | 1681 ms | 1.02x | 1.01x, 1.03x (before 0.98x, 1.01x) | 0.99x, 0.96x (before 1.02x, 0.99x) |
| High | 1406 ms | 1354 ms | 0.96x | 1.02x, 1.03x (before 0.99x, 1.02x) | 1.06x, 1.05x (before 0.96x, 0.99x) |
| Ultra | 1601 ms | 1583 ms | 0.99x | 1.00x, 1.00x (before 0.99x, 0.98x) | 1.05x, 0.96x (before 0.99x, 1.02x) |

High's calm pair is the burst tool's (the fire tool's pair was split by a container restart). Zoomed in the frame costs about 1.3x calm before and after (the narrow view shows more detail); the glass itself costs nothing measurable (the same with it held off). Firing, the blast, the crews, the trails and the blink add nothing measurable. Not measured on Kat's M3: please try High there with a few guns firing. Levers if it misses 60 fps: the lathe's segment count, the crews' shadows, the bank's 20 puffs.

Checks: `npm run check` (356 tests, all pass), `npm run check:browser` (every hash matches), `node tools/replay-check.mjs`, `node tools/hud-check.mjs`. New tests: `recoil.test.ts`, `trails.test.ts`, `crew.test.ts`.

Stills (`tools/.shots/`, made again by the tools):
- `PORT=... node tools/l1-shots.mjs --quality=low|high --tag=<tag> [views]`, views rest, fire, reload, runout, glass, trail, shell, hit, closeup, inset, crew, crewfar, blast. Before (from `main`): `l1-before-low-*` and `l1-before-high-*` (rest, fire, glass, closeup). After: `l1-low-*`, `l1-high-*`, the High stills on the final branch `l1-after-high-rest|fire|closeup|glass|crew`, the crew at work `l1-c1-crew-0.2|0.4|0.6|0.8|1`, the sight after a shot `l1-c2-fire|reload|runout` (fire again after the light's fix: `l1-m2-fire`), the blast from the side `l1-c4-blast-0.17s|1s|3s`, the far crews through the glass `l1-c3-crewfar`.
- `PORT=... node tools/gun-shots.mjs [--quality=low|high]`: each gun from the side and above (`l1-gun-*`; before: `l1-gun-before-low-*`).
- `PORT=... node tools/fire-cost.mjs <tier>`: calm, zoomed in (with the glass and held off), after a shot.

Seen in the player's chair: the gun at rest and through a reload in the sight, the crew at each stage from 6 m, the blast from the side, the glass at Low, Medium and High, the trail broadside and down range, a shell's thread, a hit and 0.1 s later, the inset. Fixed there: the ridden gun's flash bleaching the barrel. Open for the owner's eye: the loader stands large at the left of the sight while he fetches the cartridge (clear of the centre and the shot); the mortar sits dark in the keep's shadow (L5); at the full zoom the aim arc's dots stand larger than the far castle's men.

L4 to L8: not started.
