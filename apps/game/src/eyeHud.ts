// The mason's eye on the page (3.4): what the page keeps of the structures' report, which of them to show now (the
// structure under the sight, your own castle in the overview, the one the guided match points at), and the one label
// above each ("Holds 62%"). The drawing is render/masonEye.ts; the choosing is eye.ts.

import { eyeTargets, holdsClass, holdsLabel, structureUnder } from "./eye";
import type { StructureInfo } from "./protocol";

export interface EyeHost {
  setStructures(list: readonly StructureInfo[]): void;
  setEye(targets: readonly number[]): void;
  /** The ray through a point of the screen (CSS pixels): origin and unit direction. */
  pickRay(clientX: number, clientY: number): { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number } | null;
  /** A world point on the screen (CSS pixels from the canvas's top left), or null when behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
}

export interface EyeAskNow {
  /** The eye key is held and the page takes keys. */
  held: boolean;
  overview: boolean;
  me: number;
  /** The pointer, for the overview (CSS pixels), and the middle of the screen, for the sight. */
  mouse: { x: number; y: number } | null;
  centre: { x: number; y: number };
}

export class EyeHud {
  list: StructureInfo[] = [];
  private labels: HTMLElement[] = [];
  private forced = -1;
  private forcedUntil = 0;
  private shown = "";
  /** The structure under the sight or the pointer at the last update (-1: none). */
  under = -1;

  constructor(private r: EyeHost, private host: HTMLElement) {}

  /** A new world: forget the structures and hide everything. */
  reset() {
    this.list = [];
    this.forced = -1;
    this.under = -1;
    this.shown = "";
    this.r.setStructures([]);
    this.r.setEye([]);
    for (const l of this.labels) l.hidden = true;
  }

  /** A new report from the sim. */
  structures(list: StructureInfo[]) {
    this.list = list;
    this.r.setStructures(list);
  }

  /** Show the eye on a structure for a while without the key (the guided match's one look at their keep). */
  force(structure: number, ms: number, nowMs: number) {
    this.forced = structure;
    this.forcedUntil = nowMs + ms;
  }

  update(nowMs: number, ask: EyeAskNow) {
    if (nowMs > this.forcedUntil) this.forced = -1;
    if (!this.list.length || (!ask.held && this.forced < 0)) {
      this.under = -1;
      if (this.shown) this.hide();
      return;
    }
    let under = -1;
    if (ask.held) {
      const at = ask.overview ? ask.mouse : ask.centre;
      const ray = at ? this.r.pickRay(at.x, at.y) : null;
      if (ray) under = structureUnder(this.list, ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz);
    }
    this.under = under;
    const targets = eyeTargets(this.list, { held: ask.held, overview: ask.overview, me: ask.me, under, forced: this.forced });
    this.r.setEye(targets);
    this.shown = targets.join(",");
    this.labels.forEach((l, k) => (l.hidden = k >= targets.length));
    targets.forEach((i, k) => {
      const s = this.list[i];
      let el = this.labels[k];
      if (!el) {
        el = document.createElement("div");
        el.className = "eye-label";
        this.host.appendChild(el);
        this.labels[k] = el;
      }
      const p = this.r.project(s.cx, s.topY + 2.5, s.cz);
      el.hidden = !p;
      if (!p) return;
      const text = holdsLabel(s);
      if (el.textContent !== text) el.textContent = text;
      el.dataset.holds = holdsClass(s.holds);
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    });
  }

  private hide() {
    this.shown = "";
    this.r.setEye([]);
    for (const l of this.labels) l.hidden = true;
  }
}
