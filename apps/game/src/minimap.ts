// The minimap (the owner's ask after M5: the state of both castles and both
// armies at a glance, as a picture rather than words). The valley from above,
// your castle at the bottom: every wall section, tower, the gate and the keep
// coloured by how much of it still stands (a red notch where a wall is open
// at its foot), the keep's floors under the banner, the buildings on the
// plots, the stream and its bridges, and every man standing as a dot in his
// team's colour, with each side's numbers. Page only: it draws what the
// worker reports, a few times a second.

import { BRIDGES, CASTLE_SHAPE, DIST, MID_Z, PLOTS, plotCentre, ROUTE_NAMES, routeAt, streamOffset, streamWidth, type Stone } from "@keepfall/content";
import { MINION_STRIDE, PLOT_STRIDE } from "@keepfall/sim";

/** A castle's sections, as the worker counts them and the minimap draws them. A is the -x side, B the +x side. */
export const enum Sec {
  FrontA = 0,
  Gate = 1,
  FrontB = 2,
  SideA = 3,
  Back = 4,
  SideB = 5,
  TowerFA = 6,
  TowerFB = 7,
  TowerBA = 8,
  TowerBB = 9,
  Keep = 10,
}
export const SECTION_COUNT = 11;
/** Courses at the foot of a wall: a wall short of these is open to walk through (a breach). */
export const FOOT_COURSES = 6;

/** Which section of its castle a piece belongs to (-1: none: buildings, the banner, the bridges). */
export function sectionOf(s: Stone): number {
  if (s.castle !== 0 && s.castle !== 1) return -1;
  const S = CASTLE_SHAPE;
  // Castle 0's own frame: its gate side at cz = -half (castle 1 is mirrored across the middle of the field).
  const cz = s.castle === 0 ? s.z : -DIST - s.z;
  const x = s.x;
  switch (s.part) {
    case "gate":
      return Sec.Gate;
    case "keep":
    case "storey":
    case "floor":
      return Sec.Keep;
    case "tower":
    case "wall":
    case "merlon": {
      const ax = Math.abs(x), az = Math.abs(cz);
      if (ax <= S.keepHalf + 1 && cz >= S.keepZ - S.keepHalf - 1 && cz <= S.keepZ + S.keepHalf + 1) return Sec.Keep;
      const tx = ax - S.half, tz = az - S.half;
      if (s.part === "tower" || tx * tx + tz * tz <= (S.towerOut + 0.8) * (S.towerOut + 0.8)) {
        if (cz < 0) return x < 0 ? Sec.TowerFA : Sec.TowerFB;
        return x < 0 ? Sec.TowerBA : Sec.TowerBB;
      }
      if (cz < -S.half + 3) return x < 0 ? Sec.FrontA : Sec.FrontB;
      if (cz > S.half - 3) return Sec.Back;
      return x < 0 ? Sec.SideA : Sec.SideB;
    }
    default:
      return -1;
  }
}

/**
 * The map is a schematic, not to scale: each castle (its centre to 22 m out)
 * is drawn MAG times larger than the open field between them, which is
 * squeezed to FIELD; across the valley the castles' magnification fades out
 * over 30 m, so the routes run on unbroken from the gates.
 */
const MAG = 1.6, FIELD = 0.55, ZONE = 22, FADE = 30;
/** The map's extent in its own units: along the valley, and across it either side of the middle. */
const LENGTH = 4 * ZONE * MAG + (DIST - 2 * ZONE) * FIELD;
const HALF_WIDTH = 56;

/** UI team colours: team 0 the attackers' yellow-green, team 1 Ashwright oxblood (brighter than the tabards, as the overview's marks). */
const TEAM_CSS = ["#c8d43a", "#d8424a"];
const KIND_LETTER = ["B", "M", "F"];

/** What the minimap draws from, as the page last heard it. */
export interface MinimapState {
  /** The team this page plays (its castle at the bottom). */
  me: 0 | 1;
  /** Per castle and section: share standing (0 to 100), and the share of its foot standing; null until the worker has said. */
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
  /** In a match (labels and the plots; the Practice range has its target castle). */
  match: boolean;
}

export class Minimap {
  private ctx: CanvasRenderingContext2D | null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** Map units to pixels (a metre in the field is FIELD units along the valley; in a castle, MAG). */
  private s = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
  }

  /** Match the canvas to its box on the page (CSS pixels, at the screen's density). */
  private fit() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.s = Math.min((w - 6) / (2 * HALF_WIDTH), (h - 6) / LENGTH);
  }

  /**
   * World (x, z) to the map: your castle at the bottom, looking up the
   * valley at the enemy, your left on the left (castle 1 looks along +z, its
   * left is +x; castle 0 the other way).
   */
  private px(me: 0 | 1, x: number, z: number): [number, number] {
    // Along the valley from your castle's centre towards the enemy's (castle 1 at z = -DIST looks along +z).
    const d = me === 1 ? z + DIST : -z;
    const v = d < ZONE ? (d + ZONE) * MAG : d <= DIST - ZONE ? 2 * ZONE * MAG + (d - ZONE) * FIELD : 2 * ZONE * MAG + (DIST - 2 * ZONE) * FIELD + (d - (DIST - ZONE)) * MAG;
    const out = Math.min(Math.max(0, d - ZONE), Math.max(0, DIST - ZONE - d));
    const g = 1 + (MAG - 1) * Math.max(0, 1 - out / FADE);
    const k = me === 1 ? 1 : -1;
    const top = (this.h - LENGTH * this.s) / 2;
    return [this.w / 2 - k * x * g * this.s, top + (LENGTH - v) * this.s];
  }

  draw(st: MinimapState) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.fit();
    const { me } = st;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const s = this.s;
    const P = (x: number, z: number) => this.px(me, x, z);
    // The routes, faintly.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(196, 170, 120, 0.18)";
    for (const name of ROUTE_NAMES) {
      ctx.lineWidth = Math.max(1.5, (name === "centre" ? 5 : 3.6) * s);
      ctx.beginPath();
      for (let u = -62; u <= 62; u += 4) {
        const [x] = routeAt(name, u);
        const [a, b] = P(x, MID_Z + u);
        if (u === -62) ctx.moveTo(a, b);
        else ctx.lineTo(a, b);
      }
      ctx.stroke();
    }
    // The stream.
    ctx.strokeStyle = "rgba(92, 128, 150, 0.75)";
    for (let x = -HALF_WIDTH; x < HALF_WIDTH; x += 4) {
      ctx.lineWidth = Math.max(2, streamWidth(x + 2) * s * FIELD * 1.4);
      const [a, b] = P(x, MID_Z + streamOffset(x));
      const [c, d] = P(x + 4, MID_Z + streamOffset(x + 4));
      ctx.beginPath();
      ctx.moveTo(a, b);
      ctx.lineTo(c, d);
      ctx.stroke();
    }
    // The bridges: timber while they stand, a red cross once down.
    BRIDGES.forEach((b, k) => {
      const open = st.bridges[k] !== false;
      const [a, c] = P(b.x, b.z);
      const hw = Math.max(2.5, (b.width / 2) * s), hl = Math.max(4, (b.length / 2) * s * FIELD * 1.4);
      if (open) {
        ctx.fillStyle = "#8a6a44";
        ctx.fillRect(a - hw, c - hl, hw * 2, hl * 2);
      } else {
        ctx.strokeStyle = "#e2715a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a - hl * 0.6, c - hl * 0.6);
        ctx.lineTo(a + hl * 0.6, c + hl * 0.6);
        ctx.moveTo(a + hl * 0.6, c - hl * 0.6);
        ctx.lineTo(a - hl * 0.6, c + hl * 0.6);
        ctx.stroke();
      }
    });
    for (const c of [0, 1] as const) this.castle(st, c);
    // The men standing: a dot each in the team's colour (masons as small squares).
    let mine = 0, theirs = 0;
    const m = st.minions;
    if (m) {
      for (let i = 0; i < st.minionCount; i++) {
        const o = i * MINION_STRIDE;
        const team = m[o + 6] | 0, unit = m[o + 9] | 0;
        const [a, b] = P(m[o + 1], m[o + 3]);
        ctx.fillStyle = TEAM_CSS[team] ?? "#fff";
        if (unit === 1) ctx.fillRect(a - 1.3, b - 1.3, 2.6, 2.6);
        else {
          ctx.beginPath();
          ctx.arc(a, b, 2.1, 0, Math.PI * 2);
          ctx.fill();
          if (team === me) mine++;
          else theirs++;
        }
      }
    }
    // Each side's men standing, by its castle.
    ctx.font = "600 12px 'Barlow Semi Condensed', system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const count = (team: number, n: number, y: number) => {
      ctx.fillStyle = TEAM_CSS[team];
      ctx.beginPath();
      ctx.arc(9, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#efe8d6";
      ctx.fillText(`${n}`, 16, y + 0.5);
    };
    count(1 - me, theirs, 11);
    count(me, mine, this.h - 11);
  }

  /** One castle: walls, towers and the keep by how much stands, the gate, the keep's floors, the buildings. */
  private castle(st: MinimapState, c: 0 | 1) {
    const ctx = this.ctx!;
    const S = CASTLE_SHAPE;
    const me = st.me, s = this.s * MAG;
    // Castle 0's frame to the world: x stays, z mirrors for castle 1.
    const W = (x: number, cz: number) => this.px(me, x, c === 0 ? cz : -DIST - cz);
    const sec = st.sections;
    const share = (k: number) => (sec ? sec[(c * SECTION_COUNT + k) * 2] : 100);
    const foot = (k: number) => (sec ? sec[(c * SECTION_COUNT + k) * 2 + 1] : 100);
    const colour = (k: number) => {
      const v = share(k);
      return v >= 96 ? "#d9d1bd" : v >= 80 ? "#c99a46" : v >= 55 ? "#e08a3c" : "#e2715a";
    };
    const h = S.half, gh = S.gateHalf;
    ctx.lineCap = "butt";
    const wall = (k: number, ax: number, az: number, bx: number, bz: number) => {
      const [x1, y1] = W(ax, az), [x2, y2] = W(bx, bz);
      ctx.strokeStyle = colour(k);
      ctx.lineWidth = Math.max(2.5, S.wallThick * s);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // Open at its foot: a red notch outwards, where men can walk in.
      if (foot(k) < 92) {
        const [mx, my] = W((ax + bx) / 2, (az + bz) / 2);
        const [ox, oy] = W(((ax + bx) / 2) * 1.25, ((az + bz) / 2) * 1.25);
        ctx.strokeStyle = "#ff5a3c";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(ox, oy);
        ctx.stroke();
      }
    };
    // Wall runs between the towers (castle 0's frame: the gate side at cz = -h).
    const t = S.towerOut * 0.8;
    wall(Sec.FrontA, -h + t, -h, -gh, -h);
    wall(Sec.FrontB, gh, -h, h - t, -h);
    wall(Sec.SideA, -h, -h + t, -h, h - t);
    wall(Sec.SideB, h, -h + t, h, h - t);
    wall(Sec.Back, -h + t, h, h - t, h);
    // The gate: brass while it holds, red once broken open.
    {
      const [x1, y1] = W(-gh, -h), [x2, y2] = W(gh, -h);
      ctx.strokeStyle = st.gateOpen[c] ? "#e2715a" : share(Sec.Gate) >= 96 ? "#8a6a44" : "#c99a46";
      ctx.lineWidth = Math.max(2, S.wallThick * s * 0.7);
      ctx.setLineDash(st.gateOpen[c] ? [2, 2] : []);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Towers.
    for (const [k, tx, tz] of [[Sec.TowerFA, -h, -h], [Sec.TowerFB, h, -h], [Sec.TowerBA, -h, h], [Sec.TowerBB, h, h]] as const) {
      const [a, b] = W(tx, tz);
      ctx.fillStyle = colour(k);
      ctx.beginPath();
      ctx.arc(a, b, Math.max(3, S.towerOut * s * 0.85), 0, Math.PI * 2);
      ctx.fill();
    }
    // The buildings on the plots: a letter in a box, brass when it works, dashed while it rises, red as a ruin.
    if (st.plots) {
      ctx.font = `600 ${Math.max(8, Math.round(3.6 * s))}px 'Barlow Semi Condensed', system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < st.plotCount; i++) {
        const o = i * PLOT_STRIDE;
        if ((st.plots[o] | 0) !== c) continue;
        const plot = st.plots[o + 1] | 0, kind = st.plots[o + 2] | 0, state = st.plots[o + 3] | 0;
        if (kind < 0 || state === 0) continue;
        const p = PLOTS[plot], pc = plotCentre(c, plot);
        const [a, b] = this.px(me, pc.x, pc.z);
        const hw = (p.w / 2) * s, hd = (p.d / 2) * s;
        ctx.strokeStyle = state === 3 ? "#e2715a" : "#c99a46";
        ctx.fillStyle = state === 2 ? "rgba(201, 154, 70, 0.35)" : "rgba(0, 0, 0, 0.2)";
        ctx.lineWidth = 1;
        ctx.setLineDash(state === 1 ? [2, 2] : []);
        ctx.fillRect(a - hw, b - hd, hw * 2, hd * 2);
        ctx.strokeRect(a - hw, b - hd, hw * 2, hd * 2);
        ctx.setLineDash([]);
        ctx.fillStyle = state === 3 ? "#e2715a" : "#efe8d6";
        ctx.fillText(KIND_LETTER[kind] ?? "?", a, b + 0.5);
      }
      ctx.textAlign = "start";
    }
    // The keep: its walls by how much stands, and a bar for each floor still under its banner.
    {
      const kh = S.keepHalf;
      const [a, b] = W(-kh, S.keepZ - kh), [c2, d] = W(kh, S.keepZ + kh);
      const left = Math.min(a, c2), top = Math.min(b, d), wpx = Math.abs(c2 - a), hpx = Math.abs(d - b);
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(left, top, wpx, hpx);
      ctx.strokeStyle = colour(Sec.Keep);
      ctx.lineWidth = 2;
      ctx.strokeRect(left + 1, top + 1, wpx - 2, hpx - 2);
      const floors = st.keeps[c];
      const gap = 2, bh = (hpx - 6 - gap * 2) / 3;
      for (let f = 0; f < 3; f++) {
        // Lowest floor at the bottom of the box.
        const y = top + hpx - 3 - (f + 1) * bh - f * gap;
        ctx.fillStyle = f < floors ? TEAM_CSS[c] : "rgba(236, 228, 210, 0.12)";
        ctx.fillRect(left + 3, y, wpx - 6, bh);
      }
    }
  }
}
