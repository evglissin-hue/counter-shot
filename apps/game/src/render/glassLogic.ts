// The gunner's glass (look round L1.6), with no three import so Node tests can run it:
// how far zoomed in the sight is, as the strength of the telescope's look (0 none, 1 full).

function smoothstep(a: number, b: number, v: number): number {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/** Zoom 0 (the widest field of view) to 1 (the narrowest), from the shown field of view and the weapon's range. */
export function zoomShare(fov: number, fovMin: number, fovMax: number): number {
  if (!(fovMax > fovMin)) return 0;
  return Math.max(0, Math.min(1, (fovMax - fov) / (fovMax - fovMin)));
}

/** The glass target for a sight or a spotter at this field of view: none until the zoom is past 0.55, whole at 0.9. The default zoom (0.8 of the widest) shows none. */
export function glassFromFov(fov: number, fovMin: number, fovMax: number): number {
  return smoothstep(0.55, 0.9, zoomShare(fov, fovMin, fovMax));
}
