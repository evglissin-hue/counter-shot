// The threat strip (M6): three cells over the minimap's road columns, each
// saying what is coming down that road: men, kegs, ladders, muskets, and how
// close the leading man is to your walls. The worker sums the lanes in one
// read-only pass over the upright men (laneSummary); the page names the roads
// from the player's own side and draws only what changed. The pure parts
// (naming, the lane sums, the reading of one lane) have no DOM and are tested.

import { COURTYARD, ROUTE_NAMES, holdMarker, type RouteName } from "@keepfall/content";

/** Numbers per team and road in MatchInfo.lanes. */
export const LANE_STRIDE = 6;
export const LANE_COUNT = 2 * ROUTE_NAMES.length * LANE_STRIDE;
/** Indices within one lane's numbers. */
export const L_MEN = 0, L_KEGS = 1, L_MUSKETS = 2, L_LADDERS = 3, L_DIST = 4, L_FLAGS = 5;
/** Lane flags. */
export const F_GATE = 1, F_HOLD = 2, F_INSIDE = 4;

/** Front wall z of each castle (indexed by castle; castle 1 is at -DIST). */
const WALL_Z: [number, number] = [-15, -135];
/** Metres a man must be from the wall to count as at the gate. */
const GATE_REACH = 6;
/** Metres from a hold marker that count as holding there. */
const HOLD_REACH = 3;

/** The part of a minion the lane sums read (Minion in @keepfall/sim satisfies it). */
export interface LaneMinion {
  team: number;
  /** MinionState: 0 upright. */
  state: number;
  /** Role: 0 March. */
  role: number;
  unit: number;
  /** Sapper task: 0 Carry. */
  task: number;
  route: number;
  action: number;
  x: number;
  z: number;
}
export interface LaneLadder {
  team: number;
  /** LadderState: 0 Carried, 1 Raising, 2 Planted. */
  state: number;
  front: number;
}

/**
 * One pass over the army: per team and road (ROUTE_NAMES order), LANE_STRIDE
 * numbers: men marching, sappers still carrying a keg, musketeers, ladders
 * carried or planted, metres from the leading man to the enemy front wall (-1:
 * nobody), flags. Reads only. `out` is reused when given.
 */
export function laneSummary(list: readonly LaneMinion[], ladders: readonly LaneLadder[], out = new Int16Array(LANE_COUNT)): Int16Array {
  out.fill(0);
  const roads = ROUTE_NAMES.length;
  for (let k = 0; k < 2 * roads; k++) out[k * LANE_STRIDE + L_DIST] = -1;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m.state !== 0 || m.role !== 0 || m.route < 0 || m.route >= roads || (m.team !== 0 && m.team !== 1)) continue;
    const lane = (m.team * roads + m.route) * LANE_STRIDE;
    out[lane + L_MEN]++;
    if (m.unit === 3 && m.task === 0) out[lane + L_KEGS]++;
    if (m.unit === 4) out[lane + L_MUSKETS]++;
    const enemy = 1 - m.team;
    const d = Math.max(0, Math.round(Math.abs(m.z - WALL_Z[enemy])));
    if (out[lane + L_DIST] < 0 || d < out[lane + L_DIST]) out[lane + L_DIST] = d;
    let f = 0;
    if (d <= GATE_REACH || m.action === 3) f |= F_GATE;
    if (m.action === 1) {
      const mk = MARKERS[m.team][m.route];
      if (Math.abs(m.z - mk.z) < HOLD_REACH && Math.abs(m.x - mk.x) < 8) f |= F_HOLD;
    }
    const c = COURTYARD[enemy];
    if (m.x >= c.x0 && m.x <= c.x1 && m.z >= c.z0 && m.z <= c.z1) f |= F_INSIDE;
    out[lane + L_FLAGS] |= f;
  }
  for (const l of ladders) {
    if (l.state > 2 || (l.team !== 0 && l.team !== 1)) continue;
    const m = list[l.front];
    if (!m || m.route < 0 || m.route >= roads) continue;
    out[(l.team * roads + m.route) * LANE_STRIDE + L_LADDERS]++;
  }
  return out;
}

/** Each team's hold markers by road (ROUTE_NAMES order). */
const MARKERS = [0, 1].map((t) => ROUTE_NAMES.map((r) => holdMarker(t as 0 | 1, r)));

/** The road a match's name (from castle 1's side) goes by on the player's own side. */
export function ownRoad(me: 0 | 1, r: RouteName): RouteName {
  return me === 0 && r !== "centre" ? (r === "left" ? "right" : "left") : r;
}

/** One road of the strip as the player reads it. */
export interface RoadReading {
  /** The road as the player names it. */
  road: RouteName;
  /** Enemy men on it, kegs, ladders, muskets. */
  men: number;
  kegs: number;
  ladders: number;
  muskets: number;
  /** Your own men on it. */
  mine: number;
  /** 0 (at their gate) to 1 (at yours); 0 with nobody. */
  near: number;
  /** quiet: nobody; coming: on the field; past: past the middle (amber); danger: at your walls or inside (red). */
  level: "quiet" | "coming" | "past" | "danger";
}

/** The distance from a wave's muster to the wall it marches on (m): the bar's full length. */
const SPAN = 115;

/** The three roads left to right in the player's own view, from the worker's lanes. */
export function readLanes(lanes: Int16Array, me: 0 | 1): RoadReading[] {
  const foe = 1 - me;
  const out: RoadReading[] = [];
  for (const road of ["left", "centre", "right"] as RouteName[]) {
    // The lanes use the match's names (castle 1's side); the player's own road is that name, or its mirror for castle 0.
    const k = ROUTE_NAMES.indexOf(ownRoad(me, road));
    const e = (foe * ROUTE_NAMES.length + k) * LANE_STRIDE;
    const o = (me * ROUTE_NAMES.length + k) * LANE_STRIDE;
    const men = lanes[e + L_MEN];
    const d = lanes[e + L_DIST];
    const flags = lanes[e + L_FLAGS];
    const near = men > 0 && d >= 0 ? Math.max(0, Math.min(1, 1 - d / SPAN)) : 0;
    const level: RoadReading["level"] = men === 0 ? "quiet" : flags & (F_GATE | F_INSIDE) ? "danger" : near > 0.5 ? "past" : "coming";
    out.push({ road, men, kegs: lanes[e + L_KEGS], ladders: lanes[e + L_LADDERS], muskets: lanes[e + L_MUSKETS], mine: lanes[o + L_MEN], near, level });
  }
  return out;
}

export const GLYPH_KEG = '<svg viewBox="0 0 10 10" aria-hidden="true"><ellipse cx="5" cy="5" rx="3.4" ry="4" fill="currentColor"/><path d="M1.8 3.4h6.4M1.8 6.6h6.4" stroke="#0b0c0d" stroke-width="0.9"/></svg>';
export const GLYPH_LADDER = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 0.5v9M7 0.5v9M3 2.5h4M3 5h4M3 7.5h4" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';
const GLYPH_MUSKET = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0.8 8.4L9 2.2M7.4 1.6l1.8 1.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>';

const TIP = "What is coming down each road: the enemy's men, the kegs, ladders and muskets among them, and a bar for how near their leading man is to your walls (amber past the middle, red at your gate or inside). The small number is your own men on that road.";

/** The DOM half: three cells in #threat. */
export class ThreatStrip {
  private cells: Array<{ root: HTMLElement; men: HTMLElement; kit: HTMLElement; mine: HTMLElement; fill: HTMLElement }> = [];
  private shown: string[] = ["", "", ""];
  private last = [0, 0, 0];
  private primed = false;

  constructor(private el: HTMLElement) {
    el.title = TIP;
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Threat strip: what is coming down each road");
    for (const name of ["Left", "Centre", "Right"]) {
      const root = document.createElement("div");
      root.className = "tc quiet";
      root.innerHTML = `<span class="tc-name">${name}</span><b class="tc-men"></b><span class="tc-kit"></span><i class="tc-mine" title="Your own men on this road"></i><span class="tc-bar"><u></u></span>`;
      el.appendChild(root);
      this.cells.push({ root, men: root.querySelector(".tc-men")!, kit: root.querySelector(".tc-kit")!, mine: root.querySelector(".tc-mine")!, fill: root.querySelector("u")! });
    }
  }

  setVisible(on: boolean) {
    this.el.hidden = !on;
    if (!on) this.reset();
  }

  /** A new world: forget the last readings. */
  reset() {
    this.shown = ["", "", ""];
    this.last = [0, 0, 0];
    this.primed = false;
  }

  /** Your team's colour for the small number. */
  setSide(me: 0 | 1) {
    this.el.style.setProperty("--mine", me === 0 ? "#c8d43a" : "#d8424a");
  }

  /** Draw what changed; a road that gained a wave's worth of men pulses once. */
  update(lanes: Int16Array, me: 0 | 1) {
    const r = readLanes(lanes, me);
    for (let i = 0; i < 3; i++) {
      const c = this.cells[i], v = r[i];
      if (this.primed && v.men - this.last[i] >= 3) {
        c.root.classList.remove("pulse");
        void c.root.offsetWidth;
        c.root.classList.add("pulse");
      }
      this.last[i] = v.men;
      const key = `${v.men},${v.kegs},${v.ladders},${v.muskets},${v.mine},${Math.round(v.near * 50)},${v.level}`;
      if (key === this.shown[i]) continue;
      this.shown[i] = key;
      for (const l of ["quiet", "coming", "past", "danger"]) c.root.classList.toggle(l, l === v.level);
      c.men.textContent = v.men ? String(v.men) : "";
      const kit = (n: number, svg: string, what: string) => (n ? `<span title="${what}">${svg}${n}</span>` : "");
      c.kit.innerHTML = kit(v.kegs, GLYPH_KEG, "kegs") + kit(v.ladders, GLYPH_LADDER, "ladders") + kit(v.muskets, GLYPH_MUSKET, "muskets");
      c.mine.textContent = v.mine ? String(v.mine) : "";
      c.fill.style.transform = `scaleX(${v.near.toFixed(2)})`;
    }
    this.primed = true;
  }
}
