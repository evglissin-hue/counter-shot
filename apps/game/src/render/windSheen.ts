// The wind's sheen on grass (look round L3.1): long pale streaks where the
// grass is bent over and shows its undersides, riding the game's wind, and the
// front of a coming gust as a broad bright band (a lull as a darker one). It
// is colour only, a handful of texture reads, and it fades with distance so it
// never shimmers. Everything comes from the WindField: nothing here invents
// wind.

import { clamp, dot, exp, float, mix, smoothstep, texture, vec3 } from "three/tsl";
import type * as THREE from "three/webgpu";
import type { N } from "./tslUtils";
import { BAND, WIND_MAX } from "./windState";
import type { WindField } from "./windField";

/** How much wider than the sharp band the gust's broad tint is. */
const BROAD = 3.2;
/** The streaks: metres per noise tile, stretch along the wind (m, each side), and how strongly they pale the grass. */
const STREAK_TILE = 128;
const STREAK_REACH = 15;
const STREAK_PALE = 0.42;
const FINE_TILE = 30;
const FINE_REACH = 4;
/** How much the front tints the grass (gust brighter, lull darker). */
const FRONT_PALE = 0.3;
const LULL_DARK = 0.16;

/**
 * Apply the sheen to a grass colour `c` at world point xz, `dist` metres from
 * the camera, where `grass` (0..1) is how much the ground there is grass.
 * Returns the new colour.
 */
export function applyWindSheen(c: N, noise: THREE.Texture, wf: WindField, xz: N, dist: N, grass: N): N {
  const w: N = wf.at(xz);
  const speed: N = w.length();
  const norm: N = clamp(speed.div(WIND_MAX).mul(1.5), 0, 1);
  const dir: N = w.div(speed.max(0.05));
  // Noise rides the wind (scrolls with the drift); the stretch is a few reads spread along the wind.
  const p: N = xz.sub(wf.drift);
  const g1: N = texture(noise, p.div(STREAK_TILE)).g;
  const g2: N = texture(noise, p.add(dir.mul(STREAK_REACH)).div(STREAK_TILE)).g;
  const g3: N = texture(noise, p.sub(dir.mul(STREAK_REACH)).div(STREAK_TILE)).g;
  const long: N = g1.add(g2).add(g3).mul(1.0 / 3.0);
  // Fine streaks close up only.
  const f1: N = texture(noise, p.add(dir.mul(FINE_REACH)).div(FINE_TILE).add(0.31)).g;
  const f2: N = texture(noise, p.sub(dir.mul(FINE_REACH)).div(FINE_TILE).add(0.31)).g;
  const fineFade: N = float(1).sub(smoothstep(35.0, 130.0, dist));
  const farFade: N = float(1).sub(smoothstep(280.0, 650.0, dist));
  // Streak amount: a band of the averaged noise (long ones), roughened by the fine ones near the camera.
  const streak: N = smoothstep(0.47, 0.6, long.add(f1.add(f2).sub(1.0).mul(0.25).mul(fineFade))).mul(farFade.mul(0.75).add(0.25));
  const sharp: N = wf.band(xz);
  const lean: N = norm.mul(0.65).add(0.35).add(sharp.max(0.0).mul(0.6));
  // Broad band of the fronts (coming and passing), wider than the sharp one.
  const a: N = dot(xz.sub(wf.front.xy), wf.front.zw).div(BAND * BROAD);
  const b: N = dot(xz.sub(wf.past.xy), wf.past.zw).div(BAND * BROAD);
  const broad: N = exp(a.mul(a).negate()).mul(wf.change.x).add(exp(b.mul(b).negate()).mul(wf.change.y));
  const gustBand: N = broad.max(0.0);
  const lullBand: N = broad.negate().max(0.0);
  const sheen: N = clamp(streak.mul(lean).mul(STREAK_PALE).add(gustBand.mul(FRONT_PALE)), 0, 0.7).mul(grass);
  // Grass bent over shows its pale undersides: lighter and greyer, with a cool silvery cast.
  const lum: N = dot(c, vec3(0.3, 0.59, 0.11));
  const silver: N = mix(c, vec3(lum.mul(1.08), lum.mul(1.18), lum.mul(1.02)), 0.55).mul(1.32).add(vec3(0.012, 0.016, 0.014));
  const out: N = mix(c, silver, sheen);
  return out.mul(float(1).sub(lullBand.mul(LULL_DARK).mul(grass)));
}
