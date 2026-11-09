// Group marks in the overview (M6, readability, page only): from high up each
// man is a few pixels, so the men of a team that stand together become one
// pennant over their centroid: how many, a keg if a sapper in the group still
// carries his, a ladder if a ladder crew is in it, and an arrow for where they
// are heading on screen. The grouping runs four times a second from the last
// frame's men (a coarse grid, neighbouring cells join); groups are matched to
// the last ones by nearest centroid so a mark glides rather than jumps. DOM
// elements over the canvas; nothing here touches the sim or the renderer.

import { MINION_STRIDE } from "@keepfall/sim";
import { GLYPH_KEG, GLYPH_LADDER } from "./threat";

/** Metres per grid cell. */
const CELL = 6;
/** Smallest group that gets a mark. */
const MIN_GROUP = 3;
/** Sim ticks between two groupings (4 a second). */
const STEP_TICKS = 15;
/** A group follows the nearest earlier group of its team within this many metres. */
const MATCH_REACH = 14;
/** Camera distance (m) below which the marks are gone, and above which they are whole. */
const FADE_NEAR = 50, FADE_FAR = 72;
/** Pixels from a screen edge over which a mark fades. */
const EDGE = 48;
/** A mark's box on screen (px), for keeping marks off each other. */
const BOX_W = 46, BOX_H = 38;

export interface Group {
  team: number;
  n: number;
  x: number;
  y: number;
  z: number;
  kegs: number;
  ladder: boolean;
  /** Mean velocity of its men (m/s), when the last step knew them. */
  vx: number;
  vz: number;
}

const UNIT_MASON = 1, UNIT_LADDER = 2, UNIT_SAPPER = 3;
const ACT_CARRY = 5, ACT_RAISE = 7;

/** Scratch for grouping (reused; the pass allocates only for its result). */
interface Cell { team: number; n: number; sx: number; sy: number; sz: number; kegs: number; ladder: boolean; px: number; pz: number; pn: number; root: number; cx: number; cz: number; index: number }

/**
 * Group the upright men of each team (masons left out) on a grid of CELL
 * metres: a cell with a man is occupied, occupied cells that touch (corners
 * too) join into one group. `kegless` holds the sappers who have set their
 * kegs. `prev` (id -> x, z of the last pass, by index 2 * id) gives each
 * group's motion.
 */
export function groupMinions(minions: ArrayLike<number>, count: number, kegless: ReadonlySet<number>, prev: Float32Array | null, dtSec: number): Group[] {
  const cells = new Map<number, Cell>();
  const list: Cell[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * MINION_STRIDE;
    const unit = minions[o + 9];
    if (unit === UNIT_MASON) continue;
    const team = minions[o + 6] > 0.5 ? 1 : 0;
    const x = minions[o + 1], y = minions[o + 2], z = minions[o + 3];
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const key = ((cx + 512) * 1024 + (cz + 512)) * 2 + team;
    let c = cells.get(key);
    if (!c) {
      c = { team, n: 0, sx: 0, sy: 0, sz: 0, kegs: 0, ladder: false, px: 0, pz: 0, pn: 0, root: list.length, cx, cz, index: list.length };
      cells.set(key, c);
      list.push(c);
    }
    c.n++;
    c.sx += x; c.sy += y; c.sz += z;
    const id = minions[o];
    if (unit === UNIT_SAPPER && !kegless.has(id)) c.kegs++;
    const act = minions[o + 7];
    if (unit === UNIT_LADDER && (act === ACT_CARRY || act === ACT_RAISE)) c.ladder = true;
    if (prev && dtSec > 0) {
      const px = id * 2 + 1 < prev.length ? prev[id * 2] : NaN, pz = prev[id * 2 + 1];
      if (px === px) { c.px += (x - px) / dtSec; c.pz += (z - pz) / dtSec; c.pn++; }
    }
  }
  // Join neighbouring cells of a team (union-find on list index; each cell looks at four of its eight neighbours so every pair is seen once).
  const find = (k: number): number => {
    while (list[k].root !== k) { list[k].root = list[list[k].root].root; k = list[k].root; }
    return k;
  };
  for (let k = 0; k < list.length; k++) {
    const c = list[k];
    for (let d = 0; d < 4; d++) {
      // East, south-east, south, south-west: each pair of neighbours is seen once.
      const nx = c.cx + (d === 2 ? 0 : d === 3 ? -1 : 1), nz = c.cz + (d === 0 ? 0 : 1);
      if (nx < -512 || nz < -512 || nx >= 512 || nz >= 512) continue;
      const o = cells.get(((nx + 512) * 1024 + (nz + 512)) * 2 + c.team);
      if (!o) continue;
      const a = find(k), b = find(o.index);
      if (a !== b) list[a].root = b;
    }
  }
  const sums = new Map<number, Cell>();
  for (let k = 0; k < list.length; k++) {
    const r = find(k);
    const c = list[k];
    const s = sums.get(r);
    if (!s) sums.set(r, { ...c, root: r });
    else { s.n += c.n; s.sx += c.sx; s.sy += c.sy; s.sz += c.sz; s.kegs += c.kegs; s.ladder = s.ladder || c.ladder; s.px += c.px; s.pz += c.pz; s.pn += c.pn; }
  }
  const out: Group[] = [];
  for (const s of sums.values()) {
    if (s.n < MIN_GROUP) continue;
    out.push({ team: s.team, n: s.n, x: s.sx / s.n, y: s.sy / s.n, z: s.sz / s.n, kegs: s.kegs, ladder: s.ladder, vx: s.pn ? s.px / s.pn : 0, vz: s.pn ? s.pz / s.pn : 0 });
  }
  return out;
}

interface Mark {
  el: HTMLElement;
  count: HTMLElement;
  kit: HTMLElement;
  arrow: HTMLElement;
  team: number;
  /** Where it is drawn (smoothed), and where the group is. */
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  vx: number;
  vz: number;
  n: number;
  shown: string;
  alive: boolean;
}

export type Projector = (x: number, y: number, z: number) => { x: number; y: number } | null;

export class OverviewMarks {
  private marks: Mark[] = [];
  private pool: Mark[] = [];
  private kegless = new Set<number>();
  private prev: Float32Array | null = null;
  private prevTick = -1;
  private on = false;

  constructor(private host: HTMLElement) {
    host.hidden = true;
  }

  /** A sapper set his keg (the renderer's rule for drawing him without it). */
  kegSet(id: number) {
    this.kegless.add(id);
  }

  /** A new world: forget everything. */
  reset() {
    this.kegless.clear();
    this.prev = null;
    this.prevTick = -1;
    for (const m of this.marks) this.release(m);
    this.marks = [];
  }

  /** Regroup from a sim frame when STEP_TICKS have passed since the last time. */
  update(minions: Float32Array, count: number, tick: number) {
    if (this.prevTick >= 0 && tick >= this.prevTick && tick - this.prevTick < STEP_TICKS) return;
    const dt = this.prevTick >= 0 && tick > this.prevTick ? (tick - this.prevTick) / 60 : 0;
    const groups = groupMinions(minions, count, this.kegless, this.prev, dt);
    // Remember where each man stood, for the next pass's motion.
    let top = 0;
    for (let i = 0; i < count; i++) top = Math.max(top, minions[i * MINION_STRIDE] + 1);
    if (!this.prev || this.prev.length < top * 2) this.prev = new Float32Array(Math.max(top * 2, 1024));
    this.prev.fill(NaN);
    for (let i = 0; i < count; i++) {
      const o = i * MINION_STRIDE;
      const id = minions[o];
      this.prev[id * 2] = minions[o + 1];
      this.prev[id * 2 + 1] = minions[o + 3];
    }
    this.prevTick = tick;
    this.match(groups);
  }

  /** Give each group the nearest unclaimed mark of its team (largest groups first), make new ones, drop the rest. */
  private match(groups: Group[]) {
    groups.sort((a, b) => b.n - a.n);
    const taken = new Set<Mark>();
    const next: Mark[] = [];
    for (const g of groups) {
      let best: Mark | null = null, bd = MATCH_REACH * MATCH_REACH;
      for (const m of this.marks) {
        if (m.team !== g.team || taken.has(m)) continue;
        const d = (m.tx - g.x) ** 2 + (m.tz - g.z) ** 2;
        if (d < bd) { bd = d; best = m; }
      }
      let m = best;
      if (!m) {
        m = this.make(g.team);
        m.x = g.x; m.y = g.y; m.z = g.z;
      }
      taken.add(m);
      m.tx = g.x; m.ty = g.y; m.tz = g.z;
      // Smooth the heading so a stray man does not swing the arrow.
      m.vx = best ? m.vx * 0.5 + g.vx * 0.5 : g.vx;
      m.vz = best ? m.vz * 0.5 + g.vz * 0.5 : g.vz;
      m.n = g.n;
      const key = `${g.n},${g.kegs > 0},${g.ladder}`;
      if (key !== m.shown) {
        m.shown = key;
        m.count.textContent = String(g.n);
        m.kit.innerHTML = (g.kegs > 0 ? GLYPH_KEG : "") + (g.ladder ? GLYPH_LADDER : "");
        m.el.title = `${g.n} men${g.kegs > 0 ? `, ${g.kegs} with kegs` : ""}${g.ladder ? ", a ladder" : ""}`;
      }
      next.push(m);
    }
    for (const m of this.marks) if (!taken.has(m)) this.release(m);
    this.marks = next;
  }

  private make(team: number): Mark {
    let m = this.pool.pop();
    if (!m) {
      const el = document.createElement("div");
      el.className = "gm";
      el.innerHTML = '<span class="gm-flag"><span class="gm-in"><b></b><i></i></span></span><span class="gm-arrow"></span>';
      this.host.appendChild(el);
      m = { el, count: el.querySelector("b")!, kit: el.querySelector("i")!, arrow: el.querySelector(".gm-arrow")!, team, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, vx: 0, vz: 0, n: 0, shown: "", alive: true };
    }
    m.team = team;
    m.shown = "";
    m.alive = true;
    m.el.classList.toggle("team0", team === 0);
    m.el.classList.toggle("team1", team === 1);
    return m;
  }

  private release(m: Mark) {
    m.alive = false;
    m.el.style.opacity = "0";
    m.el.style.visibility = "hidden";
    this.pool.push(m);
  }

  /**
   * Every rendered frame: glide the marks, project them, fade them by distance
   * and screen edge, and let the smaller of two overlapping marks yield.
   * `cam` is the camera's position; `overview` says whether to show at all.
   */
  place(overview: boolean, project: Projector, cam: { x: number; y: number; z: number }, w: number, h: number, dtSec: number) {
    if (overview !== this.on) {
      this.on = overview;
      this.host.hidden = !overview;
    }
    if (!overview) return;
    const k = 1 - Math.exp(-Math.min(dtSec, 0.25) * 6);
    const drawn: Array<{ m: Mark; sx: number; sy: number; op: number; ang: number; moving: boolean }> = [];
    for (const m of this.marks) {
      m.x += (m.tx - m.x) * k;
      m.y += (m.ty - m.y) * k;
      m.z += (m.tz - m.z) * k;
      const dist = Math.hypot(m.x - cam.x, m.y - cam.y, m.z - cam.z);
      const near = (dist - FADE_NEAR) / (FADE_FAR - FADE_NEAR);
      let op = Math.max(0, Math.min(1, near));
      const p = op > 0 ? project(m.x, m.y + 3.2, m.z) : null;
      if (!p) { drawn.push({ m, sx: 0, sy: 0, op: 0, ang: 0, moving: false }); continue; }
      const edge = Math.min(p.x, p.y, w - p.x, h - p.y) / EDGE;
      op *= Math.max(0, Math.min(1, edge));
      let ang = 0, moving = false;
      if (Math.hypot(m.vx, m.vz) > 0.35) {
        const q = project(m.x + m.vx * 4, m.y + 3.2, m.z + m.vz * 4);
        if (q && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 > 4) { ang = Math.atan2(q.y - p.y, q.x - p.x); moving = true; }
      }
      drawn.push({ m, sx: p.x, sy: p.y, op, ang, moving });
    }
    // Largest first; a mark whose box meets an already placed one yields.
    drawn.sort((a, b) => b.m.n - a.m.n);
    const placed: Array<{ x: number; y: number }> = [];
    for (const d of drawn) {
      const el = d.m.el;
      let op = d.op;
      if (op > 0.02) {
        for (const q of placed) if (Math.abs(q.x - d.sx) < BOX_W && Math.abs(q.y - d.sy) < BOX_H) { op = 0; break; }
        if (op > 0.02) placed.push({ x: d.sx, y: d.sy });
      }
      if (op <= 0.02) {
        if (el.style.visibility !== "hidden") el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";
      el.style.opacity = op.toFixed(2);
      el.style.transform = `translate3d(${d.sx.toFixed(1)}px, ${d.sy.toFixed(1)}px, 0)`;
      d.m.arrow.style.display = d.moving ? "block" : "none";
      if (d.moving) d.m.arrow.style.transform = `rotate(${d.ang.toFixed(2)}rad)`;
    }
  }

  /** Marks showing now (test hook). */
  get visible(): Array<{ team: number; n: number; keg: boolean; ladder: boolean; x: number; y: number }> {
    const out = [];
    for (const m of this.marks) {
      if (m.el.style.visibility !== "visible") continue;
      const r = m.el.getBoundingClientRect();
      out.push({ team: m.team, n: m.n, keg: m.shown.split(",")[1] === "true", ladder: m.shown.split(",")[2] === "true", x: r.left, y: r.top });
    }
    return out;
  }
}
