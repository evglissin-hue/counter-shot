// The Gritty look as data (SPEC section 13): light, sky, fog, palette,
// geometry treatment and post settings. The sandbox has this one style only.

import * as THREE from "three/webgpu";

export type StyleName = "gritty";

export type TreeKind = "conifer";

export interface StylePreset {
  name: StyleName;
  /** Unit vector pointing towards the sun. */
  sunDir: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** Shadowless fill light from the opposite side of the sun. */
  fillColor: number;
  fillIntensity: number;
  /** Soft shadow radius in texels at 2048 (scaled with the map size). */
  shadowRadius: number;
  shadowIntensity: number;

  sky: {
  zenith: number;
  horizon: number;
  /** Below the horizon (only seen past the far hills). */
  ground: number;
  glow: number;
  glowPower: number;
  glowStrength: number;
  sunDisc: number;
  sunDiscSize: number;
  haze: number;
  hazeHeight: number;
  clouds: number;
  cloudColor: number;
  cloudShade: number;
  cloudScale: number;
  cloudSharp: number;
  /** How far above the horizon clouds fade in (0.02 overcast .. 0.2). */
  cloudFade: number;
  /** Distant mountains: base colour and how much they dissolve into haze. */
  mountain: number;
  mountainHaze: number;
  /** A warm band low along the horizon towards the sun, and how strong it is (0: none). */
  band?: number;
  bandStrength?: number;
};
  fog: {
  /** Extinction per metre at ground level. */
  density: number;
  /** Exponential falloff of density with height (per metre). */
  falloff: number;
  color: number;
  sunColor: number;
};
  toneMapping: THREE.ToneMapping;
  exposure: number;
  bloom: { strength: number; radius: number; threshold: number };
  ao: { radius: number; thickness: number; power: number; strength: number };
  grade: {
  saturation: number;
  contrast: number;
  /** Added in shadows. */
  lift: [number, number, number];
  /** Multiplied in highlights. */
  gain: [number, number, number];
  vignette: number;
  grain: number;
};
  geometry: {
  /** 0 = sharp boxes, 1 = single chamfer, 2 = rounded. */
  bevelSegments: number;
  bevelRadius: number;
  flat: boolean;
};
  stone: {
  colors: number[];
  mortar: number;
  mortarWidth: number;
  hueJitter: number;
  valueJitter: number;
  /** Brightness at the bottom of each block (1 = none). */
  bottomShade: number;
  /** Random inset per block (metres), for a hand-laid look. */
  sizeJitter: number;
  detail: number;
  grime: number;
  moss: number;
  mossColor: number;
  roughness: number;
  bump: number;
};
  /** Ashwright brick (castle 1): base colours, mortar and the soot near the top. */
  brick: {
  colors: number[];
  mortar: number;
  soot: number;
};
  wood: number;
  woodDark: number;
  plaster: number;
  timber: number;
  roof: number[];
  /** M3: roofs by building kind (barracks, Powder Mill, Foundry), so a courtyard reads from above. */
  buildingRoofs: number[][];
  pole: number;
  finial: number;
  bannerEnemy: number;
  bannerPlayer: number;
  emblem: number;
  tattered: boolean;
  ground: {
  grass: number;
  grass2: number;
  grassDark: number;
  hill: number;
  dirt: number;
  road: number;
  mud: number;
  /** Dry grass in drifts, heath on the valley sides. */
  straw: number;
  heath: number;
  /** Specks of flowers in the grass (muted: pale, ochre, a little purple). */
  flowerA: number;
  flowerB: number;
  flowerC: number;
  /** Crags: the light strata, lichen on the tops, moss low down. */
  rockLight: number;
  lichen: number;
  moss: number;
  /** The stream's banks: gravel and pebbles at the water line, wet mud above. */
  gravel: number;
  wetMud: number;
  roughness: number;
};
  water: { shallow: number; deep: number; reflect: number };
  trees: {
  kind: TreeKind;
  leaf: number;
  leafLight: number;
  leafDark: number;
  trunk: number;
};
  /** Broadleaf stands late in the year, bushes and gorse, reeds at the water: leaf, light, dark, wood. */
  broadleaf: { leaf: number; leafLight: number; leafDark: number; trunk: number };
  bushes: { leaf: number; leafLight: number; leafDark: number; trunk: number };
  reeds: { leaf: number; leafLight: number; leafDark: number; trunk: number };
  rock: number;
  iron: number;
  dust: number;
  chip: number;
  aim: number;
  aimEdge: number;
  ghost: number;
}

const DEG = Math.PI / 180;

function sunDir(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  // Azimuth 0 = towards +Z (behind the enemy castle), 90 = +X.
  const a = azimuthDeg * DEG;
  const e = elevationDeg * DEG;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}

export const GRITTY: StylePreset = {
  name: "gritty",
  sunDir: sunDir(128, 21),
  sunColor: 0xe4dfd5,
  sunIntensity: 2.7,
  hemiSky: 0x8a96a3,
  hemiGround: 0x3c3a31,
  hemiIntensity: 0.95,
  fillColor: 0x8a96a6,
  fillIntensity: 0.25,
  shadowRadius: 2.6,
  shadowIntensity: 0.88,
  sky: {
    zenith: 0x5a6570,
    horizon: 0x8e979c,
    ground: 0x7c8284,
    glow: 0xdad3c7,
    glowPower: 8,
    glowStrength: 0.4,
    sunDisc: 0xf2f4f6,
    sunDiscSize: 0.9996,
    haze: 0xa9afb2,
    hazeHeight: 0.22,
    clouds: 0.72,
    cloudColor: 0x9fa7ae,
    cloudShade: 0x5b636c,
    cloudScale: 0.7,
    cloudSharp: 0.2,
    cloudFade: 0.03,
    mountain: 0x3f4846,
    mountainHaze: 0.62,
    band: 0xc49a6c,
    bandStrength: 0.22,
  },
  fog: { density: 0.0015, falloff: 0.013, color: 0x8d969c, sunColor: 0xc6c2b8 },
  toneMapping: THREE.AgXToneMapping,
  exposure: 1.18,
  bloom: { strength: 0.08, radius: 0.4, threshold: 1.0 },
  ao: { radius: 1.3, thickness: 1.3, power: 1.35, strength: 0.8 },
  grade: { saturation: 0.74, contrast: 1.16, lift: [0.0, 0.006, 0.014], gain: [1.02, 1.0, 0.97], vignette: 0.4, grain: 0.035 },
  geometry: { bevelSegments: 0, bevelRadius: 0, flat: false },
  stone: {
    colors: [0x6c7073, 0x5f6366, 0x777b7d, 0x65696b, 0x6f7270],
    mortar: 0x2a2b2a,
    mortarWidth: 0.035,
    hueJitter: 0.025,
    valueJitter: 0.2,
    bottomShade: 0.8,
    sizeJitter: 0.03,
    detail: 0.42,
    grime: 0.6,
    moss: 0.5,
    mossColor: 0x4f5b3d,
    roughness: 0.92,
    bump: 1.0,
  },
  brick: {
    colors: [0x6e3c2d, 0x633629, 0x784433, 0x5b3126, 0x6c4030],
    mortar: 0x3b352e,
    soot: 0x1b1714,
  },
  // Weathered grey timber.
  wood: 0x5f5a52,
  woodDark: 0x37332e,
  plaster: 0x958b78,
  timber: 0x34302b,
  roof: [0x3f454d, 0x363b42, 0x474c52],
  // Weathered oak shingles on a barracks, a light boarded roof on a Powder Mill (built to lift off in a blast), sooty slate on a Foundry.
  buildingRoofs: [
    [0x5a4636, 0x523f31, 0x614c3b],
    [0x8a7b5c, 0x7f7154, 0x948463],
    [0x3b4046, 0x353a3f, 0x42474c],
  ],
  pole: 0x3b3731,
  finial: 0x6b6458,
  // Target castle: the sickly yellow-green attacker accent; Ashwright oxblood.
  bannerEnemy: 0x7a8526,
  bannerPlayer: 0x6a1618,
  emblem: 0x9c8f72,
  tattered: true,
  ground: {
    grass: 0x4b5a2c,
    grass2: 0x5a6331,
    grassDark: 0x2f3a1e,
    hill: 0x56603a,
    dirt: 0x4a3d2e,
    road: 0x51463a,
    mud: 0x3b3128,
    straw: 0x7b7046,
    heath: 0x4e3f3c,
    flowerA: 0xb4b19c,
    flowerB: 0x9c8a4a,
    flowerC: 0x6c5a70,
    rockLight: 0x7d7a71,
    lichen: 0x8f8f62,
    moss: 0x3d4a29,
    gravel: 0x64604f,
    wetMud: 0x231e19,
    roughness: 0.9,
  },
  water: { shallow: 0x3c4a46, deep: 0x1c2628, reflect: 0.7 },
  trees: { kind: "conifer", leaf: 0x24382a, leafLight: 0x3a5238, leafDark: 0x15241a, trunk: 0x2e251d },
  broadleaf: { leaf: 0x434626, leafLight: 0x5d5832, leafDark: 0x232816, trunk: 0x352e26 },
  bushes: { leaf: 0x3a4424, leafLight: 0x56592f, leafDark: 0x1f2714, trunk: 0x2e271f },
  reeds: { leaf: 0x67663d, leafLight: 0x8f8455, leafDark: 0x34391f, trunk: 0x3a3a24 },
  rock: 0x5a5852,
  iron: 0x2a2928,
  dust: 0x8f877b,
  chip: 0x6a635a,
  // Readability rule 4: aim marks are cold white with a dark outline.
  aim: 0xeef4ff,
  aimEdge: 0x0a0c0f,
  ghost: 0xdce6ee,
};
