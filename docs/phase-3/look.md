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

Not started.
