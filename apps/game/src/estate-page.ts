// The page's side of a castle's estate (phase 2 M3): the build wheel, gold
// coming in (the feed under the gold, numbers rising from where it was
// earned, a toast and a brass ping for trick shots), notes when buildings go
// up or are wrecked, and the sounds of building, of the mills and the
// foundries at work, of muskets and burning fuses. It reads what the worker
// reports and sends the player's inputs; the match decides everything.

import { BUILDING_KINDS, BUILDINGS, Earn, KEG, PLOTS, plotCentre, type Emplacement } from "@keepfall/content";
import type { MatchInput } from "@keepfall/rules";
import { EVENT_STRIDE, EventKind, PLOT_STRIDE, type FrameData } from "@keepfall/sim";
import { BuildWheel } from "./buildwheel";
import { EARN_STRIDE, type MatchInfo, type Mode, type ToWorker } from "./protocol";
import type { GameRenderer } from "./render/GameRenderer";
import type { Sound } from "./sound";

/** Plot states (sim structures.ts PlotState). */
const EMPTY = 0, RISING = 1, STANDING = 2, RUINED = 3;
const TRICK_NAMES: Partial<Record<Earn, string>> = {
  [Earn.Ricochet]: "Ricochet kill",
  [Earn.Collapse]: "Collapse kill",
  [Earn.MultiKill]: "Multi-kill",
  [Earn.KeepHit]: "Keep hit",
};
const FEED_NAMES: Partial<Record<Earn, string>> = { [Earn.Bounty]: "bounties", [Earn.Masonry]: "masonry" };

interface Float {
  el: HTMLSpanElement;
  x: number;
  y: number;
  z: number;
  born: number;
}

export class Estate {
  readonly wheel: BuildWheel;
  private mode: Mode | null = null;
  /** The team this page plays (M5: online, the guest plays team 0). */
  private team: 0 | 1 = 1;
  /** Each castle's plots as last seen: kind and state. */
  private plots: Array<Array<{ kind: number; state: number }>> = [0, 1].map(() => PLOTS.map(() => ({ kind: -1, state: EMPTY })));
  private plotsSeen = false;
  private floats: Float[] = [];
  private floatsEl: HTMLElement;
  private feedEl: HTMLElement;
  private trickEl: HTMLElement;
  private trickTimer: ReturnType<typeof setTimeout> | undefined;
  private feedSum = new Map<Earn, number>();
  private feedAt = 0;
  private lastKnock = 0;
  private lastCoin = 0;
  private nextWork: number[] = [];
  private lastPlots: Float32Array | null = null;
  private lastPlotCount = 0;
  private gold = 0;
  /** The player started a building (or a rebuild) on one of their plots. */
  onBuilt: (() => void) | null = null;

  constructor(
    private renderer: GameRenderer,
    private sound: Sound,
    private post: (m: ToWorker) => void,
    private note: (text: string, ms: number) => void,
    private $: (id: string) => HTMLElement,
  ) {
    this.wheel = new BuildWheel($("build"), (input: MatchInput) => this.post({ t: "input", input }), (text) => this.note(text, 2600));
    this.floatsEl = $("floats");
    this.feedEl = $("feed");
    this.trickEl = $("trick");
    this.nextWork = PLOTS.map((_, i) => 1.5 + i * 0.7).concat(PLOTS.map((_, i) => 2 + i * 0.6));
  }

  get wheelOpen(): boolean {
    return this.wheel.isOpen;
  }

  /** In a match (against the AI or a friend)? */
  private get inMatch(): boolean {
    return this.mode === "versus" || this.mode === "online";
  }

  /** A new world: nothing built yet, the wheel shut, no numbers in the air. */
  reset(mode: Mode, team: 0 | 1 = 1) {
    this.mode = mode;
    this.team = team;
    this.wheel.close();
    this.plots = [0, 1].map(() => PLOTS.map(() => ({ kind: -1, state: EMPTY })));
    this.plotsSeen = false;
    for (const f of this.floats) f.el.remove();
    this.floats = [];
    this.feedEl.innerHTML = "";
    this.feedSum.clear();
  }

  /** Every plot as the last frame with plots had it (PLOT_STRIDE each), for the minimap. */
  get plotFrame(): { data: Float32Array | null; count: number } {
    return { data: this.lastPlots, count: this.lastPlotCount };
  }

  /** The player's plots with nothing on them (a ruin counts as taken: it is rebuilt from the wheel too). */
  emptyPlots(): number {
    return this.plots[this.team].filter((p) => p.state === EMPTY).length;
  }

  /** Open the build menu on one of your gun slots (an empty slot's tab or its fire button). */
  openFor(slot: number) {
    if (!this.inMatch) return;
    document.exitPointerLock?.();
    this.wheel.open(10 + slot);
  }

  /** Open the build menu on its list (the Build button). */
  openList() {
    if (!this.inMatch) return;
    document.exitPointerLock?.();
    this.wheel.open();
  }

  /** Open the wheel on one of the player's plots (a click in the overview). */
  openPlot(plot: number) {
    if (!this.inMatch) return;
    document.exitPointerLock?.();
    this.wheel.open(plot);
  }

  /** The player's plot under a world point, or -1. */
  plotAt(x: number, z: number): number {
    for (const p of PLOTS) {
      const c = plotCentre(this.team, p.index);
      if (Math.abs(x - c.x) <= p.w / 2 + 0.5 && Math.abs(z - c.z) <= p.d / 2 + 0.5) return p.index;
    }
    return -1;
  }

  /**
   * This frame's keys: B opens and closes the wheel (in a match); while it is
   * open, a number, Backspace and Esc are its own. True if it took the number.
   */
  keys(p: { build: boolean; weapon: number; back: boolean; esc: boolean }, versus: boolean): boolean {
    if (p.build && versus) {
      if (this.wheel.isOpen) this.wheel.close();
      else {
        document.exitPointerLock?.();
        this.wheel.open();
      }
    }
    if (!this.wheel.isOpen) return false;
    if (p.esc) this.wheel.close();
    else if (p.back) this.wheel.back();
    if (p.weapon >= 0) {
      this.wheel.digit(p.weapon + 1);
      return true;
    }
    return false;
  }

  /** A sim frame: building, muskets and kegs heard; the plots for the wheel and for notes. */
  onFrame(f: FrameData, now: number) {
    for (let k = 0; k < f.eventCount; k++) {
      const o = k * EVENT_STRIDE;
      const kind = f.events[o];
      const a = f.events[o + 1], b = f.events[o + 2], c = f.events[o + 3], d = f.events[o + 4];
      if (kind === EventKind.Raised) {
        if (a >= 0 && now - this.lastKnock > 140) {
          this.lastKnock = now;
          this.sound.knock(b, c, d);
        }
      } else if (kind === EventKind.Built) {
        const pc = plotCentre(a, b);
        this.sound.built(pc.x, 1, pc.z);
      } else if (kind === EventKind.Musket) {
        const p = this.renderer.minionAt(a);
        if (p) this.sound.musket(p[0], p[1] + 1.4, p[2]);
      } else if (kind === EventKind.Keg) {
        this.sound.fuse(b, c, d, KEG.fuse / 60);
      }
    }
    if (f.plotCount) {
      this.lastPlots = f.plots;
      this.lastPlotCount = f.plotCount;
      this.plotNotes(f.plots, f.plotCount);
    }
  }

  /** Notes when the player's buildings go up or are wrecked, and when the enemy builds or loses one. */
  private plotNotes(data: Float32Array, count: number) {
    for (let i = 0; i < count; i++) {
      const o = i * PLOT_STRIDE;
      const castle = data[o] | 0, plot = data[o + 1] | 0, kind = data[o + 2] | 0, state = data[o + 3] | 0;
      const was = this.plots[castle]?.[plot];
      if (!was) continue;
      if (this.plotsSeen && this.inMatch && (was.state !== state || was.kind !== kind) && kind >= 0) {
        const name = BUILDINGS[BUILDING_KINDS[kind]].name;
        if (castle === this.team) {
          if (state === RISING && (was.state === EMPTY || was.state === RUINED)) this.onBuilt?.();
          if (state === STANDING && was.state === RISING) {
            const what = BUILDING_KINDS[kind] === "mill" ? `${name} is up: ${BUILDINGS.mill.income} more gold a second.` : BUILDING_KINDS[kind] === "barracks" ? "new barracks is ready: its waves leave with the others. B sets its mix and route." : `${name} is lit: B, then 7, upgrades the gun you ride.`;
            this.note(`Your ${what}`, 4500);
          } else if (state === RUINED) this.note(`Your ${name} is wrecked: B to rebuild it for half its cost.`, 5000);
        } else {
          if (state === RISING && was.state === EMPTY) this.note(`The enemy is building a ${name}.`, 3500);
          else if (state === RUINED) this.note(`The enemy's ${name} is wrecked${BUILDING_KINDS[kind] === "barracks" ? ": its waves stop until it is rebuilt" : ""}.`, 4500);
        }
      }
      this.plots[castle][plot] = { kind, state };
    }
    this.plotsSeen = true;
  }

  /** The match: gold coming in, and what the wheel shows. */
  onMatch(info: MatchInfo, gun: Emplacement | null, slot: number, guns: Emplacement[]) {
    this.gold = info.gold[this.team];
    const e = info.earned;
    for (let k = 0; k + EARN_STRIDE - 1 < e.length; k += EARN_STRIDE) {
      const team = e[k], amount = e[k + 1], kind = e[k + 2] as Earn;
      if (team !== this.team || kind === Earn.Income) continue;
      const trick = TRICK_NAMES[kind];
      this.float(e[k + 3], e[k + 4], e[k + 5], trick ? `+${amount} ${trick}` : `+${amount}`, !!trick);
      if (trick) this.toast(trick, amount);
      else {
        this.feedSum.set(kind, (this.feedSum.get(kind) ?? 0) + amount);
        const now = performance.now();
        if (now - this.lastCoin > 120) {
          this.lastCoin = now;
          this.sound.coin(amount);
        }
      }
    }
    this.wheel.update(this.lastPlots, this.lastPlotCount, { gold: this.gold, team: this.team, barracks: info.barracks, foundry: info.foundry[this.team], gun, gunSlot: slot, guns });
  }

  private toast(name: string, amount: number) {
    const el = this.trickEl;
    el.innerHTML = `${name} +${amount}<small>a trick shot</small>`;
    el.hidden = false;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(this.trickTimer);
    this.trickTimer = setTimeout(() => (el.hidden = true), 2800);
    this.sound.trick();
  }

  private float(x: number, y: number, z: number, text: string, big: boolean) {
    if (y < -100) return;
    if (this.floats.length > 28) {
      const old = this.floats.shift()!;
      old.el.remove();
    }
    const el = document.createElement("span");
    el.textContent = text;
    if (big) el.className = "big";
    this.floatsEl.append(el);
    this.floats.push({ el, x, y, z, born: performance.now() });
  }

  /** Every rendered frame: numbers rise and fade, the feed sums up, the trades are heard at work. */
  update(now: number) {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      const t = (now - f.born) / 1700;
      const s = t < 1 ? this.renderer.project(f.x, f.y, f.z) : null;
      if (!s || t >= 1) {
        f.el.remove();
        this.floats.splice(i, 1);
        continue;
      }
      f.el.style.opacity = String(t < 0.12 ? t / 0.12 : t > 0.7 ? (1 - t) / 0.3 : 1);
      f.el.style.transform = `translate(${s.x}px, ${s.y - 46 * t}px) translate(-50%, -50%)`;
    }
    if (this.feedSum.size && now - this.feedAt > 900) {
      this.feedAt = now;
      for (const [kind, sum] of this.feedSum) {
        const line = document.createElement("span");
        line.textContent = `+${sum} ${FEED_NAMES[kind] ?? ""}`;
        this.feedEl.prepend(line);
        setTimeout(() => line.remove(), 2400);
      }
      while (this.feedEl.children.length > 4) this.feedEl.lastElementChild?.remove();
      this.feedSum.clear();
    }
    // The mills grind and the foundries ring, near enough to hear.
    if (!this.inMatch) return;
    const ear = this.renderer.listener();
    const sec = now / 1000;
    for (const castle of [0, 1]) {
      for (let p = 0; p < PLOTS.length; p++) {
        const v = this.plots[castle][p];
        if (v.state !== STANDING || (v.kind !== 1 && v.kind !== 2)) continue;
        const k = castle * PLOTS.length + p;
        if (sec < this.nextWork[k]) continue;
        const c = plotCentre(castle, p);
        const dist = Math.hypot(c.x - ear.x, c.z - ear.z);
        if (v.kind === 2) {
          this.nextWork[k] = sec + 2.6 + (k % 3) * 0.4;
          if (dist < 90) this.sound.anvil(c.x, 1, c.z);
        } else {
          this.nextWork[k] = sec + 4.2 + (k % 2) * 0.7;
          if (dist < 70) this.sound.millGrind(c.x, 1, c.z);
        }
      }
    }
  }
}
