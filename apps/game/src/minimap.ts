// The minimap, drawn as a plan (track L, round L0). The valley from above, your
// castle at the bottom: walls of stone with a dark edge, each of the four walls
// in six cells along its length, so a breach sits where it happened; towers as
// rings, the keep a square of stone round a dark floor with its banner and a
// pip for each floor; state read by pattern first (sound stone plain, damaged
// hatched, half gone hatched in amber, a breach a gap with rubble and a red
// arrow where men can walk in); the buildings as tiles with a sign, the guns
// as brass studs, the stream, roads and bridges, and every man standing as a
// dot, a plate by each group of six or more. Page only: it draws what the
// worker reports, a few times a second, and moves between reports (a cell
// flashes when it is hit, dots glide, plates fade, a storm draws its ring).
//
// Everything is drawn in a 390 by 500 design space (the mock in
// docs/phase-3/minimap-mock.svg is twice the real size), scaled to the canvas.
// The parts that never change between reports (panel, ground, roads, stream,
// the glow under each castle) are drawn once into a cache.

import { stockShare } from "./render/powderLogic";
import { BRIDGES, CASTLE_SHAPE, DIST, MID_Z, PLOTS, plotCentre, ROUTE_NAMES, routeAt, streamOffset, type Stone } from "@keepfall/content";
import { MINION_STRIDE, PLOT_STRIDE } from "@keepfall/sim";

// ---- the worker's sections ----------------------------------------------------

/**
 * A castle's sections, as the worker counts them and the minimap draws them:
 * SECTION_COUNT in all, per castle, two bytes each (the share standing and the
 * share of its foot standing, 0 to 100). Indices 0 to 23 are the four walls in
 * WALL_CELLS cells each (wallCell(wall, i)), then the gate, the four towers
 * and the keep.
 */
export const WALL_CELLS = 6;
/** The walls: the front (the gate's), the sides (A is the -x side, B the +x side) and the back. */
export const Wall = { Front: 0, SideA: 1, SideB: 2, Back: 3 } as const;
export const GATE = 4 * WALL_CELLS;
export const TOWER_FA = GATE + 1, TOWER_FB = GATE + 2, TOWER_BA = GATE + 3, TOWER_BB = GATE + 4;
export const KEEP = GATE + 5;
export const SECTION_COUNT = KEEP + 1;
/** Courses at the foot of a wall: a wall short of these is open to walk through (a breach). */
export const FOOT_COURSES = 6;

/** Section index of cell i (0 to 5) of a wall. Front cells run from the -x end, 0 to 2 left of the gate, 3 to 5 right of it; a side wall's run from the front to the back; the back's from -x to +x. */
export const wallCell = (wall: number, i: number) => wall * WALL_CELLS + i;

const S = CASTLE_SHAPE;
/** Where a wall's own stones end along it: the towers take the rest. */
const WALL_END = S.half - (S.towerOut + 0.8);

const clampi = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const cellAt = (a: number, lo: number, hi: number, n: number) => clampi(Math.floor(((a - lo) / (hi - lo)) * n), 0, n - 1);

/** Which section of its castle a piece belongs to (-1: none: buildings, the banner, the bridges). */
export function sectionOf(s: Stone): number {
  if (s.castle !== 0 && s.castle !== 1) return -1;
  // Castle 0's own frame: its gate side at cz = -half (castle 1 is mirrored across the middle of the field).
  const cz = s.castle === 0 ? s.z : -DIST - s.z;
  const x = s.x;
  switch (s.part) {
    case "gate":
      return GATE;
    case "keep":
    case "storey":
    case "floor":
      return KEEP;
    case "tower":
    case "wall":
    case "merlon": {
      const ax = Math.abs(x), az = Math.abs(cz);
      if (ax <= S.keepHalf + 1 && cz >= S.keepZ - S.keepHalf - 1 && cz <= S.keepZ + S.keepHalf + 1) return KEEP;
      const tx = ax - S.half, tz = az - S.half;
      if (s.part === "tower" || tx * tx + tz * tz <= (S.towerOut + 0.8) * (S.towerOut + 0.8)) {
        if (cz < 0) return x < 0 ? TOWER_FA : TOWER_FB;
        return x < 0 ? TOWER_BA : TOWER_BB;
      }
      if (cz < -S.half + 3) {
        const g = S.gateHalf;
        return wallCell(Wall.Front, x < 0 ? cellAt(x, -WALL_END, -g, 3) : 3 + cellAt(x, g, WALL_END, 3));
      }
      if (cz > S.half - 3) return wallCell(Wall.Back, cellAt(x, -WALL_END, WALL_END, WALL_CELLS));
      return wallCell(x < 0 ? Wall.SideA : Wall.SideB, cellAt(cz, -WALL_END, WALL_END, WALL_CELLS));
    }
    default:
      return -1;
  }
}

// ---- what a share means ---------------------------------------------------------

/** A cell standing at or above this share is sound (drawn plain). */
export const SHARE_SOUND = 94;
/** Below SHARE_SOUND down to this share it is damaged (hatched); below it, half gone (hatched in amber). */
export const SHARE_HALF = 60;
/** A wall cell whose foot stands less than this is a breach: a gap men can walk through. */
export const FOOT_BREACH = 60;
/** The gate is hurt (drawn hatched) below this share. */
export const GATE_SOUND = 96;

export const Cell = { Sound: 0, Damaged: 1, Half: 2, Breach: 3 } as const;
export type CellState = 0 | 1 | 2 | 3;

/** How a cell reads, from the worker's two shares (the share standing, and the share of its foot standing). */
export function cellState(share: number, foot: number): CellState {
  if (foot < FOOT_BREACH) return Cell.Breach;
  if (share >= SHARE_SOUND) return Cell.Sound;
  return share >= SHARE_HALF ? Cell.Damaged : Cell.Half;
}

// ---- the layout ---------------------------------------------------------------------

export const VW = 390, VH = 500;
/** Design units per metre inside a castle, and across the open field; along the valley between the castles. */
const CASTLE_K = 124 / (2 * S.half);
const FIELD_KX = 161 / 48;
const FIELD_KY = 168 / (DIST - 2 * S.half);
/** The castles' magnification across the valley fades out over FADE metres, from ZONE metres out of a castle's centre. */
const ZONE = 22, FADE = 30;
/** Where each castle's centre is (design units, down the page). */
const MINE_Y = 396, THEIRS_Y = MINE_Y - 2 * 62 - 168;

/** UI team colours (the mock's): team 0 the attackers' yellow-green, team 1 oxblood. */
const TEAM_CSS = ["#cdd842", "#e2525a"];
/** The chalk of your marks (the sight draws the same white). */
const CHALK_CSS = "#f3eedb";
const TEAM_INK = ["#14160a", "#1a0d0e"];
const TEAM_RGB = ["205, 216, 66", "226, 82, 90"];

const STONE = "#d9d1bd", EDGE = "#100f0c", BRASS = "#d7a049", RED = "#ef6a52", PAPER = "#efe8d6", RUBBLE = "#8d8470";
const TILE = "#2b2720", TILE_EDGE = "#8a7850";

/** The kinds of gun mark (Minimap guns: x, z, kind). */
export const Gun = { Armed: 0, Ride: 1, Out: 2, Empty: 3 } as const;
export const GUN_STRIDE = 3;

/** What the minimap draws from, as the page last heard it. */
export interface MinimapState {
  /** The team this page plays (its castle at the bottom). */
  me: 0 | 1;
  /** Per castle and section (SECTION_COUNT each): share standing (0 to 100), and the share of its foot standing; null until the worker has said. */
  sections: Uint8Array | null;
  /** Each keep's floors under its banner (3 to 0). */
  keeps: [number, number];
  /** Each castle's gate: broken open. */
  gateOpen: [boolean, boolean];
  /** Can each bridge be crossed (BRIDGES order). */
  bridges: boolean[];
  /** The last frame's upright figures (MINION_STRIDE each) and plots (PLOT_STRIDE each). */
  minions: Float32Array | null;
  minionCount: number;
  plots: Float32Array | null;
  plotCount: number;
  /** Every gun: world x, z, and its Gun kind (GUN_STRIDE each). */
  guns: Float32Array | null;
  gunCount: number;
  /** Per castle: how far its enemy has got in storming its courtyard (0 to 1), and whether men are storming it now. */
  storm: [number, number];
  stormOn: [boolean, boolean];
  /** In a match (labels and the plots; the Practice range has its target castle). */
  match: boolean;
  /** 3.3: each castle's powder store (charges) and what it holds at most: the bar under a magazine's keg sign. Null: no powder in this match. */
  stores?: [{ stock: number; cap: number }, { stock: number; cap: number }] | null;
  /** 3.2: your team's marks (world x, z and number): a chalk-white circled number. Never the other side's. */
  marks?: Array<{ n: number; x: number; z: number }>;
}

interface Plate {
  team: number;
  x: number;
  y: number;
  n: number;
  a: number;
  seen: boolean;
}

/** A man's drawn place glides to his reported one over about this many ms. */
const GLIDE_MS = 140;
/** A group of this many men or more has its count beside it. */
export const GROUP_MIN = 6;
const GROUP_CELL = 26;
/** How long a hit cell flashes (ms), and how long a plate takes to fade in or out. */
const FLASH_MS = 700, PLATE_MS = 260;

// Signs for the buildings, drawn about their centre.
let signs: { keg: Path2D; hoops: Path2D; pikes: Path2D; heads: Path2D; wheel: Path2D; spokes: Path2D; flame: Path2D; flag: Path2D } | null = null;
function getSigns() {
  return (signs ??= {
    keg: new Path2D("M-3.6 -4.6 C-5.2 -1.6 -5.2 1.6 -3.6 4.6 L3.6 4.6 C5.2 1.6 5.2 -1.6 3.6 -4.6 Z"),
    hoops: new Path2D("M-4.9 -2.1 H4.9 M-4.9 2.1 H4.9"),
    pikes: new Path2D("M-5 5.5 L5 -5.5 M5 5.5 L-5 -5.5"),
    heads: new Path2D("M3.2 -5.8 L5.6 -6.2 L5.2 -3.8 M-3.2 -5.8 L-5.6 -6.2 L-5.2 -3.8"),
    wheel: new Path2D("M5.2 0 A5.2 5.2 0 1 1 -5.2 0 A5.2 5.2 0 1 1 5.2 0 Z"),
    spokes: new Path2D("M0 -5.2 V5.2 M-5.2 0 H5.2"),
    flame: new Path2D("M0 -6.5 C3.6 -3 5 0 3.6 3.4 C2.6 5.8 -2.6 5.8 -3.6 3.4 C-4.8 0.6 -2.6 -1.2 -1.6 -3.2 C-1 -1.6 0.6 -2 0 -6.5 Z"),
    flag: new Path2D("M-6.2 -8 H2 L-0.4 -4.9 L2 -1.8 H-6.2 Z"),
  });
}

/** Rubble in a breach: along the wall, across it, radius. */
const RUBBLE_DOTS: Array<[number, number, number]> = [[-2.6, -1, 1.5], [0.4, 2.2, 1.3], [3.2, -1.6, 1.6], [5.4, 2, 1.2], [-4.4, 1.6, 1.1]];

export class Minimap {
  private ctx: CanvasRenderingContext2D | null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** Design units to CSS pixels, and where the design space starts. */
  private u = 1;
  private ox = 0;
  private oy = 0;
  private cache: HTMLCanvasElement | null = null;
  private cacheKey = "";
  private hatch: CanvasPattern | null = null;
  private hatchAmber: CanvasPattern | null = null;
  private hatchBrass: CanvasPattern | null = null;
  private patKey = "";

  /** Per section, when it was last hit (ms), and the shares the last report said (to see a drop). */
  private flashAt = new Float64Array(2 * SECTION_COUNT).fill(-1e9);
  private lastShares: Uint8Array | null = null;
  /** A man's drawn place (world x, z) by id; positions drawn this call (design units) and their team and kind. */
  private glide = new Map<number, { x: number; z: number; seen: number }>();
  private pts = new Float32Array(3 * 1024);
  private plates: Plate[] = [];
  private lastNow = 0;
  private pass = 0;
  private plotKind = new Int8Array(12);
  private plotState = new Int8Array(12);
  /** Milliseconds the last draws took, and their running average (a measure the page can read). */
  lastMs = 0;
  avgMs = 0;
  draws = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
  }

  /** Match the canvas to its box on the page (CSS pixels, at the screen's density). */
  private fit() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.u = Math.min(w / VW, h / VH);
    this.ox = (w - VW * this.u) / 2;
    this.oy = (h - VH * this.u) / 2;
  }

  /**
   * World (x, z) to the design space: your castle at the bottom, looking up
   * the valley at the enemy, your left on the left (castle 1 looks along +z,
   * its left is +x; castle 0 the other way). A schematic, not to scale: a
   * castle is drawn larger than the open field between the castles.
   */
  static px(me: 0 | 1, x: number, z: number, out: number[] = [0, 0]): number[] {
    // Along the valley from your castle's centre towards the enemy's (castle 1 at z = -DIST looks along +z).
    const d = me === 1 ? z + DIST : -z;
    const h = S.half;
    out[1] = d <= h ? MINE_Y - d * CASTLE_K : d <= DIST - h ? MINE_Y - h * CASTLE_K - (d - h) * FIELD_KY : MINE_Y - h * CASTLE_K - (DIST - 2 * h) * FIELD_KY - (d - (DIST - h)) * CASTLE_K;
    const away = Math.min(Math.max(0, d - ZONE), Math.max(0, DIST - ZONE - d));
    const k = FIELD_KX * (1 + (CASTLE_K / FIELD_KX - 1) * Math.max(0, 1 - away / FADE));
    out[0] = VW / 2 + (me === 1 ? -x : x) * k;
    return out;
  }

  private bgKey(me: number) {
    return `${this.w}x${this.h}@${this.dpr}:${me}`;
  }

  /** The hatches are tiles at the screen's density, so they stay crisp at both sizes. */
  private makePatterns(ctx: CanvasRenderingContext2D) {
    const key = `${this.u}:${this.dpr}`;
    if (key === this.patKey) return;
    this.patKey = key;
    const k = this.u * this.dpr;
    const n = Math.max(4, Math.round(5 * k));
    const make = (back: string, fore: string) => {
      const c = document.createElement("canvas");
      c.width = c.height = n;
      const g = c.getContext("2d")!;
      g.fillStyle = back;
      g.fillRect(0, 0, n, n);
      g.fillStyle = fore;
      g.fillRect(0, 0, Math.max(1, n * 0.48), n);
      const p = ctx.createPattern(c, "repeat")!;
      // The tile is n pixels; make it 5 design units, turned 45 degrees (as the mock's).
      p.setTransform(new DOMMatrix().rotate(45).scale(5 / n));
      return p;
    };
    this.hatch = make("#4a4336", STONE);
    this.hatchAmber = make("#4a3a22", "#d7a049");
    this.hatchBrass = make("#3a2e1a", "#d7a049");
  }

  /** The unchanging ground, drawn once per size: panel, valley floor, ridges, roads, stream, and the glow under each castle. */
  private background(me: 0 | 1): HTMLCanvasElement {
    const key = this.bgKey(me);
    if (this.cache && key === this.cacheKey) return this.cache;
    const c = this.cache ?? document.createElement("canvas");
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    this.cache = c;
    this.cacheKey = key;
    const g = c.getContext("2d")!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    // The panel fills the canvas, its corners rounded.
    const r = 16 * this.u;
    rrect(g, 0, 0, this.w, this.h, r);
    g.save();
    g.clip();
    const pg = g.createRadialGradient(this.w / 2, this.h / 2, 0, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    pg.addColorStop(0, "#2a2720");
    pg.addColorStop(1, "#191713");
    g.fillStyle = pg;
    g.fillRect(0, 0, this.w, this.h);
    g.translate(this.ox, this.oy);
    g.scale(this.u, this.u);
    // The valley floor, lighter where it is open; the ridges between the roads a shade darker.
    soft(g, 195, 250, 210, 120, "#34352a", 0.55);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const [a, b] = Minimap.px(me, sx * 24, MID_Z + sz * 26);
      soft(g, a, b, 46, 15, "#1f1e18", 0.5);
    }
    // The roads: the centre road a firm line, the flank paths dashed.
    g.lineCap = "round";
    g.lineJoin = "round";
    const route = (name: (typeof ROUTE_NAMES)[number]) => {
      g.beginPath();
      for (let u = -58; u <= 58; u += 2) {
        const [x] = routeAt(name, u);
        const [a, b] = Minimap.px(me, x, MID_Z + u);
        if (u === -58) g.moveTo(a, b);
        else g.lineTo(a, b);
      }
    };
    g.setLineDash([]);
    route("centre");
    g.strokeStyle = "rgba(21, 19, 15, 0.55)";
    g.lineWidth = 7;
    g.stroke();
    g.strokeStyle = "rgba(189, 165, 122, 0.8)";
    g.lineWidth = 3.6;
    g.stroke();
    g.strokeStyle = "rgba(189, 165, 122, 0.62)";
    g.lineWidth = 2.6;
    g.setLineDash([7, 5]);
    route("left");
    g.stroke();
    route("right");
    g.stroke();
    g.setLineDash([]);
    // The stream, a ribbon with a lighter thread down its middle.
    const stream = () => {
      g.beginPath();
      for (let x = -62; x <= 62; x += 3) {
        const [a, b] = Minimap.px(me, x, MID_Z + streamOffset(x));
        if (x === -62) g.moveTo(a, b);
        else g.lineTo(a, b);
      }
    };
    stream();
    g.strokeStyle = "rgba(21, 19, 15, 0.5)";
    g.lineWidth = 15;
    g.stroke();
    const wg = g.createLinearGradient(0, 0, VW, 0);
    wg.addColorStop(0, "#3f6074");
    wg.addColorStop(0.5, "#4b7188");
    wg.addColorStop(1, "#3f6074");
    g.strokeStyle = wg;
    g.lineWidth = 11;
    g.stroke();
    g.strokeStyle = "rgba(156, 195, 214, 0.55)";
    g.lineWidth = 1.4;
    g.setLineDash([14, 9]);
    g.stroke();
    g.setLineDash([]);
    // Under each castle, a soft glow and a faint tint of its team's colour (the only team colour on masonry).
    for (const cy of [MINE_Y, THEIRS_Y]) {
      const team = cy === MINE_Y ? me : 1 - me;
      const x0 = 195 - 62, y0 = cy - 62;
      for (let wd = 26; wd >= 4; wd -= 4) {
        g.strokeStyle = `rgba(${TEAM_RGB[team]}, 0.075)`;
        g.lineWidth = wd;
        rrect(g, x0, y0, 124, 124, 10);
        g.stroke();
      }
      g.fillStyle = `rgba(${TEAM_RGB[team]}, 0.07)`;
      g.fillRect(x0 + 4, y0 + 4, 116, 116);
    }
    g.restore();
    return c;
  }

  draw(st: MinimapState, now = performance.now()) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = performance.now();
    this.fit();
    const { me } = st;
    const dt = Math.min(200, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    this.pass++;
    this.makePatterns(ctx);
    this.seeHits(st, now);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.background(me), 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.save();
    rrect(ctx, 0, 0, this.w, this.h, 16 * this.u);
    ctx.clip();
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.u, this.u);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    this.bridges(st);
    // Their castle above, yours below (castle index c = team).
    for (const c of [(1 - me) as 0 | 1, me]) this.castle(st, c, now);
    for (const c of [0, 1] as const) this.stormRing(st, c, now);
    this.guns(st);
    const counts = this.men(st, dt);
    this.marks(st);
    this.totals(st, counts);
    ctx.restore();
    // The frame: a brass hairline and a faint inner light.
    ctx.strokeStyle = "rgba(215, 160, 73, 0.38)";
    ctx.lineWidth = 1.5 * this.u;
    rrect(ctx, 0.75 * this.u, 0.75 * this.u, this.w - 1.5 * this.u, this.h - 1.5 * this.u, 16 * this.u);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 246, 220, 0.05)";
    ctx.lineWidth = this.u;
    rrect(ctx, 3.5 * this.u, 3.5 * this.u, this.w - 7 * this.u, this.h - 7 * this.u, 13.5 * this.u);
    ctx.stroke();
    this.lastMs = performance.now() - t0;
    this.avgMs = this.draws++ === 0 ? this.lastMs : this.avgMs * 0.95 + this.lastMs * 0.05;
  }

  /** A cell whose share dropped since the last report was hit: it flashes once. */
  private seeHits(st: MinimapState, now: number) {
    const sec = st.sections;
    if (sec === this.lastShares) return;
    const prev = this.lastShares;
    this.lastShares = sec;
    if (!sec || !prev || prev.length !== sec.length) return;
    for (let k = 0; k < 2 * SECTION_COUNT; k++) if (sec[k * 2] < prev[k * 2]) this.flashAt[k] = now;
  }

  private bridges(st: MinimapState) {
    const ctx = this.ctx!;
    BRIDGES.forEach((b, k) => {
      const [a, c] = Minimap.px(st.me, b.x, b.z);
      ctx.save();
      ctx.translate(a, c);
      if (st.bridges[k] !== false) {
        // Planks.
        ctx.fillStyle = "#15130f";
        rrect(ctx, -7, -11, 14, 22, 1.5);
        ctx.fill();
        ctx.fillStyle = "#a9855a";
        rrect(ctx, -5.5, -10, 11, 20, 1);
        ctx.fill();
        ctx.strokeStyle = "#6f5536";
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(-5.5, -5);
        ctx.lineTo(5.5, -5);
        ctx.moveTo(-5.5, 0);
        ctx.lineTo(5.5, 0);
        ctx.moveTo(-5.5, 5);
        ctx.lineTo(5.5, 5);
        ctx.stroke();
      } else {
        // Down: two stubs and a red stroke across the gap.
        ctx.fillStyle = "#6f5536";
        ctx.strokeStyle = "#15130f";
        ctx.lineWidth = 1;
        for (const y of [-10, 6]) {
          ctx.fillRect(-5.5, y, 11, 4);
          ctx.strokeRect(-5.5, y, 11, 4);
        }
        ctx.strokeStyle = RED;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-6, 6);
        ctx.lineTo(6, -6);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  /** The stone fill of a state: plain, hatched, or hatched in amber. */
  private stoneFor(state: number): string | CanvasPattern {
    return state === Cell.Sound ? STONE : state === Cell.Damaged ? this.hatch! : this.hatchAmber!;
  }

  /** One castle: its walls cell by cell, the gate, towers, buildings, keep, and the flash of whatever was just hit. */
  private castle(st: MinimapState, c: 0 | 1, now: number) {
    const me = st.me;
    const sec = st.sections;
    const share = (k: number) => (sec ? sec[(c * SECTION_COUNT + k) * 2] : 100);
    const foot = (k: number) => (sec ? sec[(c * SECTION_COUNT + k) * 2 + 1] : 100);
    const tmp = [0, 0];
    // Castle 0's frame to the design space: x stays, z mirrors for castle 1.
    const W = (x: number, cz: number): [number, number] => {
      Minimap.px(me, x, c === 0 ? cz : -DIST - cz, tmp);
      return [tmp[0], tmp[1]];
    };
    const flash = (k: number) => Math.max(0, 1 - (now - this.flashAt[c * SECTION_COUNT + k]) / FLASH_MS);
    const [cx0, cy0] = W(0, 0);
    const outward = (ox: number, oz: number): [number, number] => {
      const [a, b] = W(ox, oz);
      const dx = a - cx0, dy = b - cy0, len = Math.hypot(dx, dy) || 1;
      return [dx / len, dy / len];
    };

    this.wallsOf(st, c, W, outward, share, foot, flash);
  }

  private wallsOf(
    st: MinimapState,
    c: 0 | 1,
    W: (x: number, cz: number) => [number, number],
    outward: (ox: number, oz: number) => [number, number],
    share: (k: number) => number,
    foot: (k: number) => number,
    flash: (k: number) => number,
  ) {
    const ctx = this.ctx!;
    const h = S.half, gh = S.gateHalf;
    const E = WALL_END;
    // Cell edges along a wall (castle frame); the end cells run on under the towers.
    const e6 = [-h, ...[1, 2, 3, 4, 5].map((i) => -E + (i * 2 * E) / 6), h];
    const w3 = (E - gh) / 3;
    const eL = [-h, -E + w3, -E + 2 * w3, -gh];
    const eR = [gh, gh + w3, gh + 2 * w3, h];
    interface Seg {
      k: number;
      x1: number;
      z1: number;
      x2: number;
      z2: number;
      ox: number;
      oz: number;
    }
    const segs: Seg[] = [];
    for (let i = 0; i < 6; i++) {
      const fa = i < 3 ? eL[i] : eR[i - 3], fb = i < 3 ? eL[i + 1] : eR[i - 2];
      segs.push({ k: wallCell(Wall.Front, i), x1: fa, z1: -h, x2: fb, z2: -h, ox: 0, oz: -1 });
      segs.push({ k: wallCell(Wall.SideA, i), x1: -h, z1: e6[i], x2: -h, z2: e6[i + 1], ox: -1, oz: 0 });
      segs.push({ k: wallCell(Wall.SideB, i), x1: h, z1: e6[i], x2: h, z2: e6[i + 1], ox: 1, oz: 0 });
      segs.push({ k: wallCell(Wall.Back, i), x1: e6[i], z1: h, x2: e6[i + 1], z2: h, ox: 0, oz: 1 });
    }
    const stroke = (s: Seg) => {
      const [a, b] = W(s.x1, s.z1), [c2, d] = W(s.x2, s.z2);
      ctx.beginPath();
      ctx.moveTo(a, b);
      ctx.lineTo(c2, d);
      ctx.stroke();
    };
    const state = (k: number): CellState => cellState(share(k), foot(k));
    ctx.lineCap = "butt";
    // A dark edge under every cell that stands, then its stone.
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = 12.5;
    for (const s of segs) if (state(s.k) !== Cell.Breach) stroke(s);
    ctx.lineWidth = 9;
    for (const s of segs) {
      const stt = state(s.k);
      if (stt === Cell.Breach) continue;
      ctx.strokeStyle = this.stoneFor(stt);
      stroke(s);
    }
    // Breaches: rubble in the gap, and a red arrow once for each run of open cells where men can walk in.
    for (let wall = 0; wall < 4; wall++) {
      let run = -1;
      for (let i = 0; i <= WALL_CELLS; i++) {
        const open = i < WALL_CELLS && state(wallCell(wall, i)) === Cell.Breach;
        if (open && run < 0) run = i;
        if (!open && run >= 0) {
          const a = segs.find((s) => s.k === wallCell(wall, run))!, b = segs.find((s) => s.k === wallCell(wall, i - 1))!;
          const mx = (a.x1 + b.x2) / 2, mz = (a.z1 + b.z2) / 2;
          for (let j = run; j < i; j++) {
            const s = segs.find((q) => q.k === wallCell(wall, j))!;
            const [ax, ay] = W((s.x1 + s.x2) / 2, (s.z1 + s.z2) / 2);
            const [nx, ny] = outward(s.ox, s.oz);
            ctx.fillStyle = RUBBLE;
            // The wall runs across the outward direction.
            const tx = -ny, ty = nx;
            RUBBLE_DOTS.forEach(([along, across, r], n) => {
              if ((n + j) % 3 === 0 && n > 1) return;
              ctx.beginPath();
              ctx.arc(ax + tx * along + nx * across, ay + ty * along + ny * across, r, 0, Math.PI * 2);
              ctx.fill();
            });
          }
          const [px0, py0] = W(mx, mz);
          const [nx, ny] = outward(a.ox, a.oz);
          this.arrow(px0, py0, nx, ny);
          run = -1;
        }
      }
    }
    // The gate: a brass bar while it holds (hatched when hurt), two stubs and a way in once broken open.
    {
      const [gx, gy] = W(0, -h);
      const [nx, ny] = outward(0, -1);
      if (st.gateOpen[c]) {
        ctx.strokeStyle = RED;
        ctx.lineWidth = 2.6;
        ctx.lineCap = "round";
        for (const sx of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(gx + sx * 9, gy);
          ctx.lineTo(gx + sx * 4, gy + ny * 4);
          ctx.stroke();
        }
        this.arrow(gx, gy, nx, ny);
      } else {
        ctx.fillStyle = EDGE;
        rrect(ctx, gx - 9, gy - 3, 18, 6, 1.5);
        ctx.fill();
        ctx.fillStyle = share(GATE) >= GATE_SOUND ? BRASS : this.hatchBrass!;
        rrect(ctx, gx - 7.8, gy - 1.8, 15.6, 3.6, 1);
        ctx.fill();
      }
    }
    // Towers: rings.
    const towers: Array<[number, number, number]> = [[TOWER_FA, -h, -h], [TOWER_FB, h, -h], [TOWER_BA, -h, h], [TOWER_BB, h, h]];
    for (const [k, tx, tz] of towers) {
      const [a, b] = W(tx, tz);
      const stt = cellState(share(k), 100);
      ctx.fillStyle = EDGE;
      circle(ctx, a, b, 14.5);
      ctx.fillStyle = stt === Cell.Sound ? STONE : this.stoneFor(stt === Cell.Breach ? Cell.Half : stt);
      circle(ctx, a, b, 12.6);
      ctx.fillStyle = "#23211b";
      circle(ctx, a, b, 6.2);
    }
    this.plotsOf(st, c);
    this.keepOf(st, c, W, share(KEEP));
    // What was just hit flashes once, fading.
    const hit: Array<() => void> = [];
    for (const s of segs) {
      const f = flash(s.k);
      if (f > 0) hit.push(() => {
        ctx.strokeStyle = `rgba(255, 246, 220, ${0.8 * f})`;
        ctx.lineWidth = 12.5;
        ctx.lineCap = "butt";
        stroke(s);
      });
    }
    for (const [k, tx, tz] of [...towers, [GATE, 0, -h], [KEEP, 0, S.keepZ]] as Array<[number, number, number]>) {
      const f = flash(k);
      if (f <= 0) continue;
      const [a, b] = W(tx, tz);
      const r = k === KEEP ? 22 : k === GATE ? 9 : 14.5;
      hit.push(() => {
        ctx.fillStyle = `rgba(255, 246, 220, ${0.75 * f})`;
        if (k === KEEP) ctx.fillRect(a - r, b - r, 2 * r, 2 * r);
        else circle(ctx, a, b, r);
      });
    }
    for (const f of hit) f();
  }

  /** A red arrow just outside a wall, pointing in (n: the way out from the castle). */
  private arrow(x: number, y: number, nx: number, ny: number) {
    const ctx = this.ctx!;
    const tx = -ny, ty = nx;
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.moveTo(x + nx * 13, y + ny * 13);
    ctx.lineTo(x + nx * 19 + tx * 4.5, y + ny * 19 + ty * 4.5);
    ctx.lineTo(x + nx * 19 - tx * 4.5, y + ny * 19 - ty * 4.5);
    ctx.closePath();
    ctx.fill();
  }

  /** The buildings on the plots: tiles with a sign; rising a dashed brass edge; a ruin a dashed red edge, its sign dimmed; an empty plot faint dots. */
  private plotsOf(st: MinimapState, c: 0 | 1) {
    if (!st.match || !st.plots || st.plotCount === 0) return;
    const ctx = this.ctx!;
    const kind = this.plotKind, state = this.plotState;
    kind.fill(-1);
    state.fill(0);
    for (let i = 0; i < st.plotCount; i++) {
      const o = i * PLOT_STRIDE;
      if ((st.plots[o] | 0) !== c) continue;
      const p = st.plots[o + 1] | 0;
      if (p < 0 || p >= PLOTS.length) continue;
      kind[p] = st.plots[o + 2] | 0;
      state[p] = st.plots[o + 3] | 0;
    }
    const sg = getSigns();
    const tmp = [0, 0];
    for (let p = 0; p < PLOTS.length; p++) {
      const pc = plotCentre(c, p), pl = PLOTS[p];
      Minimap.px(st.me, pc.x, pc.z, tmp);
      const a = tmp[0], b = tmp[1];
      const hw = (pl.w * CASTLE_K) / 2, hd = (pl.d * CASTLE_K) / 2;
      const k = kind[p], s = state[p];
      if (k < 0 || s === 0) {
        ctx.strokeStyle = "#5c5646";
        ctx.lineWidth = 1;
        ctx.setLineDash([1.6, 2.6]);
        rrect(ctx, a - hw, b - hd, hw * 2, hd * 2, 2.5);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      ctx.fillStyle = s === 3 ? "#2a1c18" : s === 1 ? "#25221c" : TILE;
      ctx.strokeStyle = s === 3 ? RED : s === 1 ? BRASS : TILE_EDGE;
      ctx.lineWidth = s === 3 ? 1.2 : 1.1;
      ctx.setLineDash(s === 3 ? [3, 2.4] : s === 1 ? [2.6, 2.2] : []);
      rrect(ctx, a - hw, b - hd, hw * 2, hd * 2, 2.5);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.save();
      ctx.translate(a, b);
      ctx.globalAlpha = s === 3 ? 0.55 : s === 1 ? 0.6 : 1;
      ctx.strokeStyle = PAPER;
      ctx.fillStyle = PAPER;
      ctx.lineCap = "round";
      if (k === 0) {
        ctx.lineWidth = 1.7;
        ctx.stroke(sg.pikes);
        ctx.lineWidth = 1.3;
        ctx.stroke(sg.heads);
      } else if (k === 1) {
        ctx.lineWidth = 1.5;
        ctx.stroke(sg.wheel);
        ctx.stroke(sg.spokes);
        circle(ctx, 0, 0, 1.1);
      } else if (k === 2) ctx.fill(sg.flame);
      else if (k === 3) {
        // A magazine: a keg, and under it a thin bar for the store (a working magazine only: a rising or ruined one holds none).
        ctx.translate(0, -1.6);
        ctx.lineWidth = 1.5;
        ctx.stroke(sg.keg);
        ctx.lineWidth = 1.1;
        ctx.stroke(sg.hoops);
      }
      ctx.restore();
      if (k === 3 && s === 2) this.stockBar(st, c, a, b + hd - 3.4, hw - 3);
    }
  }

  /** The stock bar of a magazine tile: a dark track and a fill by the share of the cap (red when it is nearly dry). */
  private stockBar(st: MinimapState, c: 0 | 1, a: number, y: number, half: number) {
    const store = st.stores?.[c];
    if (!store) return;
    const share = stockShare(store.stock, store.cap);
    if (share < 0) return;
    const ctx = this.ctx!;
    ctx.fillStyle = "#100f0c";
    rrect(ctx, a - half, y - 1.3, half * 2, 2.6, 1.2);
    ctx.fill();
    if (share <= 0) return;
    ctx.fillStyle = share < 0.25 ? RED : BRASS;
    rrect(ctx, a - half, y - 1.3, Math.max(2.4, half * 2 * share), 2.6, 1.2);
    ctx.fill();
  }

  /** The keep: a square of stone round a dark floor, its banner in the team's colour, a pip for each floor still under it. */
  private keepOf(st: MinimapState, c: 0 | 1, W: (x: number, cz: number) => [number, number], keepShare: number) {
    const ctx = this.ctx!;
    const [a, b] = W(0, S.keepZ);
    const stt = cellState(keepShare, 100);
    ctx.fillStyle = EDGE;
    rrect(ctx, a - 22.5, b - 22.5, 45, 45, 2);
    ctx.fill();
    ctx.fillStyle = stt === Cell.Breach ? this.hatchAmber! : this.stoneFor(stt);
    rrect(ctx, a - 21, b - 21, 42, 42, 1.5);
    ctx.fill();
    ctx.fillStyle = "#1d1b16";
    ctx.fillRect(a - 14, b - 14, 28, 28);
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a - 7, b + 8.5);
    ctx.lineTo(a - 7, b - 8.5);
    ctx.stroke();
    ctx.save();
    ctx.translate(a, b);
    ctx.fillStyle = TEAM_CSS[c];
    ctx.fill(getSigns().flag);
    ctx.restore();
    const floors = st.keeps[c];
    for (let f = 0; f < 3; f++) {
      // The lowest floor at the bottom.
      const y = b + 4.5 - f * 7;
      if (f < floors) {
        ctx.fillStyle = TEAM_CSS[c];
        rrect(ctx, a + 4, y, 7.5, 4.6, 1);
        ctx.fill();
      } else {
        ctx.strokeStyle = "#6f6a58";
        ctx.lineWidth = 1;
        rrect(ctx, a + 4, y, 7.5, 4.6, 1);
        ctx.stroke();
      }
    }
  }

  /** A storm draws its ring round the courtyard, filling as the enemy's hold goes on. */
  private stormRing(st: MinimapState, c: 0 | 1, now: number) {
    if (!st.match || (!st.stormOn[c] && st.storm[c] <= 0)) return;
    const ctx = this.ctx!;
    const [a, b] = Minimap.px(st.me, 0, c === 0 ? 0 : -DIST);
    const attacker = 1 - c;
    const half = 54, perim = 8 * half;
    const pulse = 0.55 + 0.25 * Math.sin(now / 220);
    ctx.save();
    ctx.translate(a, b);
    ctx.lineJoin = "round";
    ctx.lineCap = "butt";
    // The track, then the hold so far; the track pulses while the storm goes on.
    ctx.strokeStyle = `rgba(${TEAM_RGB[attacker]}, ${st.stormOn[c] ? pulse * 0.6 : 0.25})`;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([5, 4]);
    rrect(ctx, -half, -half, 2 * half, 2 * half, 8);
    ctx.stroke();
    ctx.setLineDash([Math.max(0.1, Math.min(1, st.storm[c])) * perim, perim * 2]);
    ctx.strokeStyle = TEAM_CSS[attacker];
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -half);
    ctx.lineTo(half, -half);
    ctx.lineTo(half, half);
    ctx.lineTo(-half, half);
    ctx.lineTo(-half, -half);
    ctx.lineTo(0, -half);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Guns: brass studs where they stand; a white ring round the one you ride, a struck red ring when one is out, a hollow dot for an empty slot. */
  private guns(st: MinimapState) {
    if (!st.guns) return;
    const ctx = this.ctx!;
    const tmp = [0, 0];
    for (let i = 0; i < st.gunCount; i++) {
      const o = i * GUN_STRIDE;
      Minimap.px(st.me, st.guns[o], st.guns[o + 1], tmp);
      const x = tmp[0], y = tmp[1], kind = st.guns[o + 2] | 0;
      if (kind === Gun.Empty) {
        ctx.fillStyle = "#16140f";
        ctx.strokeStyle = "#7b725f";
        ctx.lineWidth = 1.2;
        circle(ctx, x, y, 3.2);
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (kind === Gun.Out) {
        ctx.fillStyle = "#16140f";
        circle(ctx, x, y, 4.6);
        ctx.strokeStyle = RED;
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.arc(x, y, 3.3, 0, Math.PI * 2);
        ctx.moveTo(x - 2.3, y + 2.3);
        ctx.lineTo(x + 2.3, y - 2.3);
        ctx.stroke();
      } else {
        if (kind === Gun.Ride) {
          ctx.strokeStyle = "#fff6dc";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(x, y, 7.2, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = "#16140f";
        circle(ctx, x, y, 4.4);
        ctx.fillStyle = kind === Gun.Ride ? "#f0c56a" : BRASS;
        circle(ctx, x, y, 3.1);
      }
    }
  }

  /** 3.2: your marks, each a chalk-white circle (about 14 px across) with its number in it: the same chalk as the sight's, not a team colour. */
  private marks(st: MinimapState) {
    if (!st.marks || st.marks.length === 0) return;
    const ctx = this.ctx!;
    const tmp = [0, 0];
    ctx.font = "700 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const m of st.marks) {
      Minimap.px(st.me, m.x, m.z, tmp);
      const x = tmp[0], y = tmp[1], r = 7;
      ctx.beginPath();
      ctx.arc(x, y, r + 1, 0, Math.PI * 2);
      ctx.fillStyle = EDGE;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r - 0.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(20, 18, 14, 0.9)";
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = CHALK_CSS;
      ctx.stroke();
      ctx.fillStyle = CHALK_CSS;
      ctx.fillText(String(m.n), x, y + 0.5);
    }
  }

  /** The men: dots with a dark rim gliding between reports, masons as small squares, a plate by each group of six or more. Returns each side's men standing. */
  private men(st: MinimapState, dt: number): [number, number] {
    const ctx = this.ctx!;
    const m = st.minions;
    const counts: [number, number] = [0, 0];
    if (!m) {
      this.glide.clear();
      this.plates.length = 0;
      return counts;
    }
    const n = st.minionCount;
    if (this.pts.length < 4 * n) this.pts = new Float32Array(4 * n + 256);
    const pts = this.pts;
    const k = 1 - Math.exp(-dt / GLIDE_MS * 2.2);
    const tmp = [0, 0];
    let np = 0;
    for (let i = 0; i < n; i++) {
      const o = i * MINION_STRIDE;
      const id = m[o] | 0, x = m[o + 1], z = m[o + 3];
      let g = this.glide.get(id);
      if (!g) {
        g = { x, z, seen: this.pass };
        this.glide.set(id, g);
      } else if (Math.abs(g.x - x) + Math.abs(g.z - z) > 30) {
        g.x = x;
        g.z = z;
      } else {
        g.x += (x - g.x) * k;
        g.z += (z - g.z) * k;
      }
      g.seen = this.pass;
      Minimap.px(st.me, g.x, g.z, tmp);
      const team = m[o + 6] | 0, unit = m[o + 9] | 0;
      pts[np * 4] = tmp[0];
      pts[np * 4 + 1] = tmp[1];
      pts[np * 4 + 2] = team;
      pts[np * 4 + 3] = unit === 1 ? 1 : 0;
      np++;
      if (unit !== 1) counts[team === st.me ? 0 : 1]++;
    }
    if (this.glide.size > np) for (const [id, g] of this.glide) if (g.seen !== this.pass) this.glide.delete(id);
    // Rims, then each team's fill, then the masons.
    ctx.fillStyle = "#15130f";
    ctx.beginPath();
    for (let i = 0; i < np; i++) if (pts[i * 4 + 3] === 0) {
      ctx.moveTo(pts[i * 4] + 3.9, pts[i * 4 + 1]);
      ctx.arc(pts[i * 4], pts[i * 4 + 1], 3.9, 0, Math.PI * 2);
    }
    ctx.fill();
    for (const team of [0, 1]) {
      ctx.fillStyle = TEAM_CSS[team];
      ctx.beginPath();
      for (let i = 0; i < np; i++) if (pts[i * 4 + 3] === 0 && pts[i * 4 + 2] === team) {
        ctx.moveTo(pts[i * 4] + 2.9, pts[i * 4 + 1]);
        ctx.arc(pts[i * 4], pts[i * 4 + 1], 2.9, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#15130f";
    for (let i = 0; i < np; i++) {
      if (pts[i * 4 + 3] !== 1) continue;
      ctx.fillStyle = TEAM_CSS[pts[i * 4 + 2]] ?? PAPER;
      ctx.fillRect(pts[i * 4] - 2.2, pts[i * 4 + 1] - 2.2, 4.4, 4.4);
      ctx.strokeRect(pts[i * 4] - 2.2, pts[i * 4 + 1] - 2.2, 4.4, 4.4);
    }
    this.groups(np, dt);
    return counts;
  }

  /** Plates: the men on the field (not those inside a courtyard) are grouped by nearness; a group of six or more gets its count in a plate of its team's colour, fading in and out. */
  private groups(np: number, dt: number) {
    const ctx = this.ctx!;
    const pts = this.pts;
    const found: Array<{ team: number; x: number; y: number; n: number; maxX: number; minX: number }> = [];
    for (const team of [0, 1]) {
      const cells = new Map<number, number>();
      const cx: number[] = [], cy: number[] = [], cnt: number[] = [], sx: number[] = [], sy: number[] = [], mx: number[] = [], mn: number[] = [], par: number[] = [];
      for (let i = 0; i < np; i++) {
        if (pts[i * 4 + 3] !== 0 || pts[i * 4 + 2] !== team) continue;
        const x = pts[i * 4], y = pts[i * 4 + 1];
        if (inCourtyard(x, y)) continue;
        const gx = Math.floor(x / GROUP_CELL), gy = Math.floor(y / GROUP_CELL), key = gx * 1000 + gy;
        let j = cells.get(key);
        if (j === undefined) {
          j = cx.length;
          cells.set(key, j);
          cx.push(gx);
          cy.push(gy);
          cnt.push(0);
          sx.push(0);
          sy.push(0);
          mx.push(-1e9);
          mn.push(1e9);
          par.push(j);
        }
        cnt[j]++;
        sx[j] += x;
        sy[j] += y;
        mx[j] = Math.max(mx[j], x);
        mn[j] = Math.min(mn[j], x);
      }
      const root = (a: number): number => (par[a] === a ? a : (par[a] = root(par[a])));
      for (let j = 0; j < cx.length; j++) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const o = cells.get((cx[j] + dx) * 1000 + cy[j] + dy);
          if (o !== undefined && o !== j) par[root(o)] = root(j);
        }
      }
      const total = new Map<number, { n: number; x: number; y: number; max: number; min: number }>();
      for (let j = 0; j < cx.length; j++) {
        const r = root(j);
        const t = total.get(r) ?? { n: 0, x: 0, y: 0, max: -1e9, min: 1e9 };
        t.n += cnt[j];
        t.x += sx[j];
        t.y += sy[j];
        t.max = Math.max(t.max, mx[j]);
        t.min = Math.min(t.min, mn[j]);
        total.set(r, t);
      }
      for (const t of total.values()) if (t.n >= GROUP_MIN) found.push({ team, x: t.x / t.n, y: t.y / t.n, n: t.n, maxX: t.max, minX: t.min });
    }
    // Match each group to a plate already showing (same team, near), or start a new one at nothing.
    for (const p of this.plates) p.seen = false;
    for (const f of found) {
      const wd = f.n >= 10 ? 34 : 27;
      const right = f.maxX + 9 + wd <= VW - 4;
      const tx = right ? f.maxX + 9 : f.minX - 9 - wd;
      let ty = f.y - 10;
      // Never over a castle's masonry (a wave leaving its gate would hide the breach): out into the field.
      for (const cy of [MINE_Y, THEIRS_Y]) {
        if (tx + wd > 195 - 78 && tx < 195 + 78 && ty + 20 > cy - 78 && ty < cy + 78) ty = cy === MINE_Y ? cy - 78 - 20 : cy + 78;
      }
      let best: Plate | null = null, bd = 60;
      for (const p of this.plates) {
        if (p.seen || p.team !== f.team) continue;
        const d = Math.hypot(p.x - tx, p.y - ty);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (!best) {
        best = { team: f.team, x: tx, y: ty, n: f.n, a: 0, seen: true };
        this.plates.push(best);
      } else {
        const e = 1 - Math.exp(-dt / 90);
        best.x += (tx - best.x) * e;
        best.y += (ty - best.y) * e;
        best.n = f.n;
        best.seen = true;
      }
    }
    const step = dt / PLATE_MS;
    for (let i = this.plates.length - 1; i >= 0; i--) {
      const p = this.plates[i];
      p.a = p.seen ? Math.min(1, p.a + step) : Math.max(0, p.a - step);
      if (p.a <= 0 && !p.seen) {
        this.plates.splice(i, 1);
        continue;
      }
      const wd = p.n >= 10 ? 34 : 27;
      ctx.globalAlpha = p.a;
      ctx.fillStyle = TEAM_CSS[p.team];
      rrect(ctx, p.x, p.y, wd, 20, 6);
      ctx.fill();
      ctx.fillStyle = TEAM_INK[p.team];
      ctx.font = "700 17px 'Barlow Semi Condensed', 'Arial Narrow', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(`${p.n}`, p.x + wd / 2, p.y + 15.5);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
  }

  /** Each side's men standing, in a corner by a pennant in its colour: theirs above, yours below. */
  private totals(st: MinimapState, counts: [number, number]) {
    if (!st.match && !st.minions) return;
    const ctx = this.ctx!;
    const one = (team: number, n: number, y0: number) => {
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(16, y0);
      ctx.lineTo(16, y0 + 20);
      ctx.stroke();
      ctx.fillStyle = TEAM_CSS[team];
      ctx.beginPath();
      ctx.moveTo(17, y0 + 1);
      ctx.lineTo(31, y0 + 1);
      ctx.lineTo(27, y0 + 5.5);
      ctx.lineTo(31, y0 + 10);
      ctx.lineTo(17, y0 + 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = PAPER;
      ctx.font = "600 23px 'Barlow Semi Condensed', 'Arial Narrow', Arial, sans-serif";
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(`${n}`, 37, y0 + 18);
    };
    one(1 - st.me, counts[1], 13);
    one(st.me, counts[0], 467);
  }
}

/** Is a design-space point inside either castle's walls? (Men there are the garrison: no plate.) */
function inCourtyard(x: number, y: number): boolean {
  if (Math.abs(x - 195) > 62) return false;
  return Math.abs(y - MINE_Y) < 62 || Math.abs(y - THEIRS_Y) < 62;
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A rounded rectangle path. */
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/** A soft ellipse of colour, brightest at its middle (a radial gradient squashed to the ellipse). */
function soft(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, colour: string, alpha: number) {
  g.save();
  g.translate(cx, cy);
  g.scale(1, ry / rx);
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  const rgb = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16)).join(", ");
  rg.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  rg.addColorStop(0.55, `rgba(${rgb}, ${alpha * 0.7})`);
  rg.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = rg;
  g.fillRect(-rx, -rx, 2 * rx, 2 * rx);
  g.restore();
}
