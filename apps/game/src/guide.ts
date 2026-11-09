// The first-match guide: a short checklist beside the field that ticks
// itself off as you do each thing, so a first match teaches the game while
// you play it (a light stand-in for phase 2 M6's guided match). It only
// watches what the page already knows; the match never hears of it. Once
// every step is done (or it is hidden) it stays away, until the Controls
// panel's "Show the guide" brings it back.

export type GuideStep = "aim" | "fire" | "mortar" | "build" | "waves" | "others" | "overview";
export type GuideKind = "match" | "practice";

interface Step {
  id: GuideStep;
  /** A few words: all the guide shows of a step done or still to come. */
  title: string;
  /** How, with keys in <kbd>: shown for the step to do next only. Fixed text, never from the match or a friend. */
  html: string;
}

const STEPS: Record<GuideKind, Step[]> = {
  match: [
    { id: "aim", title: "Take the gun", html: "Click the field: the mouse aims (or <span class=\"nw\"><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>)</span>" },
    { id: "fire", title: "Fire at the enemy keep", html: "<kbd>Space</kbd> or click. Correct from where it lands" },
    { id: "mortar", title: "Drop a mortar shell", html: "<kbd>2</kbd> takes the mortar: hold <kbd>Space</kbd> and a ring slides out along the ground; let go when it is on the enemy keep" },
    { id: "build", title: "Spend your gold", html: "<kbd>B</kbd> opens the build menu: a Powder Mill earns more, a Barracks sends more waves" },
    { id: "waves", title: "Command your waves", html: "Pick a route and an order in the panel under the map (<kbd>L</kbd>, <kbd>Ctrl</kbd>+<kbd>1</kbd> to <kbd>3</kbd>)" },
  ],
  practice: [
    { id: "aim", title: "Take the gun", html: "Click the field: the mouse aims (or <span class=\"nw\"><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>)</span>" },
    { id: "fire", title: "Fire at the target keep", html: "<kbd>Space</kbd> or click" },
    { id: "mortar", title: "Drop a mortar shell", html: "<kbd>2</kbd> takes the mortar: hold <kbd>Space</kbd> and a ring slides out along the ground; let go when it is on the target keep" },
    { id: "others", title: "Try the other guns", html: "The chain shot <kbd>3</kbd> sweeps pikemen and gun crews; the swivel gun <kbd>4</kbd> holds the foot of your walls" },
    { id: "overview", title: "See the whole valley", html: "<kbd>Tab</kbd> shows it from above" },
  ],
};

const TITLES: Record<GuideKind, string> = { match: "Your first match", practice: "First shots" };

const GOALS: Record<GuideKind, string> = {
  match: "Bring down the three floors of the enemy keep, or hold its courtyard for 20 s.",
  practice: "No clock, no enemy: learn the guns.",
};

export class Guide {
  private kind: GuideKind | null = null;
  private done = new Set<GuideStep>();
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  /** Told of every mark, listed or not (the guided match's coach reads the player's own doings from here). */
  onMark: ((step: GuideStep) => void) | null = null;

  constructor(
    private el: HTMLElement,
    private goal: HTMLElement,
    private list: HTMLElement,
    hideBtn: HTMLButtonElement,
    private title: HTMLElement | null = null,
  ) {
    hideBtn.addEventListener("click", () => {
      hideBtn.blur();
      this.remember("hidden");
      this.close();
    });
  }

  /** A mode starts: show its guide unless it was finished or hidden before (or `force`, from the Controls panel). */
  start(kind: GuideKind | null, force = false) {
    clearTimeout(this.hideTimer);
    this.kind = kind;
    this.done.clear();
    if (!kind || (!force && this.stored(kind))) {
      this.el.hidden = true;
      return;
    }
    if (force) this.remember(null);
    this.goal.textContent = GOALS[kind];
    if (this.title) this.title.textContent = TITLES[kind];
    this.render();
    this.el.hidden = false;
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Something the player just did: tick it off if this guide lists it. */
  mark(step: GuideStep) {
    this.onMark?.(step);
    const kind = this.kind;
    if (!kind || this.el.hidden || this.done.has(step) || !STEPS[kind].some((s) => s.id === step)) return;
    this.done.add(step);
    this.render();
    if (this.done.size === STEPS[kind].length) {
      // All done: say so for a moment, and never show it again on its own.
      this.remember("done");
      const p = document.createElement("li");
      p.className = "all";
      p.textContent = "All done. H lists every control.";
      this.list.append(p);
      this.hideTimer = setTimeout(() => this.close(), 6000);
    }
  }

  private render() {
    const kind = this.kind;
    if (!kind) return;
    this.list.textContent = "";
    let next = true;
    for (const s of STEPS[kind]) {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = s.title;
      li.append(b);
      if (this.done.has(s.id)) li.className = "done";
      else if (next) {
        // The step to do next says how; the rest are their titles only, so the guide stays small beside the field.
        li.className = "next";
        const how = document.createElement("span");
        how.innerHTML = s.html;
        li.append(how);
        next = false;
      }
      this.list.append(li);
    }
  }

  close() {
    clearTimeout(this.hideTimer);
    this.el.hidden = true;
  }

  private stored(kind: GuideKind): boolean {
    try {
      return !!localStorage.getItem(`keepfall.guide.${kind}`);
    } catch {
      return false;
    }
  }

  private remember(state: "done" | "hidden" | null) {
    const kind = this.kind;
    if (!kind) return;
    try {
      if (state) localStorage.setItem(`keepfall.guide.${kind}`, state);
      else localStorage.removeItem(`keepfall.guide.${kind}`);
    } catch {}
  }
}
