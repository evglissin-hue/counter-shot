// The three candidate art styles as data. Everything that differs between the
// looks (light, sky, fog, palette, geometry treatment, post settings) lives
// here so the owner can compare them on the same scene.

import * as THREE from "three/webgpu";

export type StyleName = "warm" | "gritty" | "lowpoly";

export type TreeKind = "puffy" | "conifer" | "lowpoly";

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
  wood: number;
  woodDark: number;
  plaster: number;
  timber: number;
  roof: number[];
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
    flowers: number;
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

export const STYLES: Record<StyleName, StylePreset> = {
  warm: {
    name: "warm",
    sunDir: sunDir(-146, 19),
    sunColor: 0xffc489,
    sunIntensity: 4.4,
    hemiSky: 0x93b9ee,
    hemiGround: 0xa88d5c,
    hemiIntensity: 1.35,
    fillColor: 0x9ab4e6,
    fillIntensity: 0.55,
    shadowRadius: 3.6,
    shadowIntensity: 0.9,
    sky: {
      zenith: 0x2f74d2,
      horizon: 0xf4d8b0,
      ground: 0xb9b49a,
      glow: 0xffb070,
      glowPower: 5,
      glowStrength: 0.9,
      sunDisc: 0xfff0d2,
      sunDiscSize: 0.9993,
      haze: 0xf7dfc0,
      hazeHeight: 0.075,
      clouds: 0.3,
      cloudColor: 0xfff6ea,
      cloudShade: 0xd2b0a2,
      cloudScale: 1.15,
      cloudSharp: 0.72,
      cloudFade: 0.16,
      mountain: 0x6d8fa8,
      mountainHaze: 0.55,
    },
    fog: { density: 0.00085, falloff: 0.011, color: 0xb4c7dd, sunColor: 0xf6cf9f },
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 0.95,
    bloom: { strength: 0.18, radius: 0.55, threshold: 0.9 },
    ao: { radius: 1.8, thickness: 1.8, power: 1.2, strength: 0.9 },
    grade: { saturation: 1.07, contrast: 1.03, lift: [0.0, 0.012, 0.035], gain: [1.03, 1.0, 0.95], vignette: 0.24, grain: 0 },
    geometry: { bevelSegments: 1, bevelRadius: 0.05, flat: false },
    stone: {
      colors: [0xe4d2ab, 0xdcc69a, 0xe9dabb, 0xd6bf95, 0xdfcba4],
      mortar: 0xa38c6c,
      mortarWidth: 0.03,
      hueJitter: 0.022,
      valueJitter: 0.075,
      bottomShade: 0.86,
      sizeJitter: 0.022,
      detail: 0.15,
      grime: 0.2,
      moss: 0.2,
      mossColor: 0x7a8a3a,
      roughness: 0.88,
      bump: 0.0,
    },
    wood: 0x8c5a32,
    woodDark: 0x5c3a20,
    plaster: 0xf2e5c9,
    timber: 0x6b4426,
    roof: [0xc45f38, 0xb8532f, 0xcc6f45],
    pole: 0x5a3c26,
    finial: 0xe6b445,
    bannerEnemy: 0xa8122e,
    bannerPlayer: 0x2457c0,
    emblem: 0xf2c55a,
    tattered: false,
    ground: {
      grass: 0x5fa03a,
      grass2: 0x98be4e,
      grassDark: 0x3d7e2d,
      hill: 0x86b24a,
      dirt: 0xae8e62,
      road: 0xc8ab7e,
      mud: 0x8a6c4a,
      flowers: 0.6,
      roughness: 0.95,
    },
    water: { shallow: 0x86cbbd, deep: 0x3b8fae, reflect: 0.85 },
    trees: { kind: "puffy", leaf: 0x4e9a37, leafLight: 0xa8d05a, leafDark: 0x2c6a2c, trunk: 0x6b4a2f },
    rock: 0xb4a991,
    iron: 0x3a3836,
    dust: 0xdcc7a2,
    chip: 0xd6bf94,
    aim: 0xfff0b8,
    aimEdge: 0x5a3a1a,
    ghost: 0xffffff,
  },

  gritty: {
    name: "gritty",
    sunDir: sunDir(128, 21),
    sunColor: 0xd9e0e8,
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
      glow: 0xd2d7dc,
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
    },
    fog: { density: 0.0019, falloff: 0.013, color: 0x8d969c, sunColor: 0xbfc6cc },
    toneMapping: THREE.AgXToneMapping,
    exposure: 1.18,
    bloom: { strength: 0.08, radius: 0.4, threshold: 1.0 },
    ao: { radius: 1.3, thickness: 1.3, power: 1.35, strength: 0.8 },
    grade: { saturation: 0.74, contrast: 1.16, lift: [0.0, 0.006, 0.014], gain: [1.02, 1.0, 0.97], vignette: 0.4, grain: 0.035 },
    geometry: { bevelSegments: 0, bevelRadius: 0, flat: false },
    stone: {
      colors: [0x6b6359, 0x5b544b, 0x766c60, 0x615a51, 0x6e6457],
      mortar: 0x2a2621,
      mortarWidth: 0.035,
      hueJitter: 0.025,
      valueJitter: 0.2,
      bottomShade: 0.8,
      sizeJitter: 0.03,
      detail: 0.42,
      grime: 0.6,
      moss: 0.5,
      mossColor: 0x3d4a29,
      roughness: 0.92,
      bump: 1.0,
    },
    wood: 0x3e2c1e,
    woodDark: 0x241912,
    plaster: 0x958b78,
    timber: 0x2a1f16,
    roof: [0x3f454d, 0x363b42, 0x474c52],
    pole: 0x2b231c,
    finial: 0x6b6458,
    bannerEnemy: 0x5a1518,
    bannerPlayer: 0x1f2c45,
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
      flowers: 0,
      roughness: 0.9,
    },
    water: { shallow: 0x3c4a46, deep: 0x1c2628, reflect: 0.7 },
    trees: { kind: "conifer", leaf: 0x24382a, leafLight: 0x3a5238, leafDark: 0x15241a, trunk: 0x2e251d },
    rock: 0x5a5852,
    iron: 0x2a2928,
    dust: 0x8f877b,
    chip: 0x6a635a,
    aim: 0xffe2a0,
    aimEdge: 0x1a1612,
    ghost: 0xe8eef2,
  },

  lowpoly: {
    name: "lowpoly",
    sunDir: sunDir(-150, 40),
    sunColor: 0xfff1dc,
    sunIntensity: 3.3,
    hemiSky: 0xdde9f7,
    hemiGround: 0xd6dcae,
    hemiIntensity: 1.45,
    fillColor: 0xfff2e2,
    fillIntensity: 1.1,
    shadowRadius: 1.1,
    shadowIntensity: 0.55,
    sky: {
      zenith: 0x6cb6f0,
      horizon: 0xffe2cc,
      ground: 0xd9e3c9,
      glow: 0xfff0d0,
      glowPower: 5,
      glowStrength: 0.35,
      sunDisc: 0xfffaf0,
      sunDiscSize: 0.9991,
      haze: 0xffeedd,
      hazeHeight: 0.14,
      clouds: 0.3,
      cloudColor: 0xffffff,
      cloudShade: 0xdde5f6,
      cloudScale: 1.3,
      cloudSharp: 0.95,
      cloudFade: 0.16,
      mountain: 0x7fc2c0,
      mountainHaze: 0.32,
    },
    fog: { density: 0.0008, falloff: 0.01, color: 0xd6e7f2, sunColor: 0xfdecd8 },
    toneMapping: THREE.NeutralToneMapping,
    exposure: 1.02,
    bloom: { strength: 0, radius: 0, threshold: 1 },
    ao: { radius: 1.0, thickness: 1.0, power: 1.0, strength: 0.35 },
    grade: { saturation: 1.12, contrast: 1.04, lift: [0.0, 0.0, 0.01], gain: [1.0, 1.0, 1.0], vignette: 0.0, grain: 0 },
    geometry: { bevelSegments: 1, bevelRadius: 0.06, flat: true },
    stone: {
      colors: [0xf0ebe0, 0xf5ebdc, 0xe9edec, 0xf3ecda, 0xefe6dc],
      mortar: 0xb0a898,
      mortarWidth: 0.0,
      hueJitter: 0.012,
      valueJitter: 0.05,
      bottomShade: 0.95,
      sizeJitter: 0.0,
      detail: 0.0,
      grime: 0.0,
      moss: 0.0,
      mossColor: 0x9bc48a,
      roughness: 0.9,
      bump: 0.0,
    },
    wood: 0xb38558,
    woodDark: 0x8e6544,
    plaster: 0xfaf3e6,
    timber: 0xb38558,
    roof: [0xe98a6d, 0x6fb3c9, 0xf0c46a],
    pole: 0x9a7350,
    finial: 0xf4cf62,
    bannerEnemy: 0xe85a5a,
    bannerPlayer: 0x5a8fe8,
    emblem: 0xfff6dc,
    tattered: false,
    ground: {
      grass: 0x8bd09a,
      grass2: 0xa9d59a,
      grassDark: 0x78c28e,
      hill: 0x9fd39c,
      dirt: 0xe8d3a0,
      road: 0xf0dca8,
      mud: 0xd8c094,
      flowers: 0,
      roughness: 1.0,
    },
    water: { shallow: 0x8fe0da, deep: 0x5cbcd0, reflect: 0.2 },
    trees: { kind: "lowpoly", leaf: 0x5cc06f, leafLight: 0x9fdc6c, leafDark: 0x3fa860, trunk: 0xa5794f },
    rock: 0xcdc7bd,
    iron: 0x5d6068,
    dust: 0xf1e6d2,
    chip: 0xd8d0c2,
    aim: 0xff7a59,
    aimEdge: 0x7a2a1c,
    ghost: 0x50607a,
  },
};
