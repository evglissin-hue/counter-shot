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
  /** The line, with keys in <kbd>. Fixed text, never from the match or a friend. */
  html: string;
}

const STEPS: Record<GuideKind, Step[]> = {
  match: [
    { id: "aim", html: "Click the field to take the gun: the mouse aims (or <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>)" },
    { id: "fire", html: "Fire the long gun at the enemy keep: <kbd>Space</kbd> or click. Correct from where it lands" },
    { id: "mortar", html: "<kbd>2</kbd> takes the mortar: hold <kbd>Space</kbd> to load the charge and let go at the full mark to drop a shell on the enemy keep's roof" },
    { id: "build", html: "Spend your gold: <kbd>B</kbd> or the Build button opens the menu. A Powder Mill earns more, a Barracks sends more waves, an empty slot takes a gun" },
    { id: "waves", html: "Command your waves: <kbd>L</kbd> picks their route, <kbd>Ctrl</kbd>+<kbd>3</kbd> sends them through a breach" },
  ],
  practice: [
    { id: "aim", html: "Click the field to take the gun: the mouse aims (or <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>)" },
    { id: "fire", html: "Fire the long gun at the target keep: <kbd>Space</kbd> or click" },
    { id: "mortar", html: "<kbd>2</kbd> takes the mortar: hold <kbd>Space</kbd> to load the charge, let go at the full mark: a full charge lands mid-view" },
    { id: "others", html: "Try the chain shot <kbd>3</kbd> or the swivel gun <kbd>4</kbd> on the pikemen" },
    { id: "overview", html: "<kbd>Tab</kbd> shows the whole valley from above" },
  ],
};

const TITLES: Record<GuideKind, string> = { match: "Your first match", practice: "First shots" };

const GOALS: Record<GuideKind, string> = {
  match: "Win by bringing the enemy banner down through its keep's three floors, or by holding its courtyard for 20 seconds.",
  practice: "No clock and no enemy: learn the guns. Rebuild the castles from the Controls panel any time.",
};

export class Guide {
  private kind: GuideKind | null = null;
  private done = new Set<GuideStep>();
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

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
    const kind = this.kind;
    if (!kind || this.el.hidden || this.done.has(step) || !STEPS[kind].some((s) => s.id === step)) return;
    this.done.add(step);
    this.render();
    if (this.done.size === STEPS[kind].length) {
      // All done: say so for a moment, and never show it again on its own.
      this.remember("done");
      const p = document.createElement("li");
      p.className = "all";
      p.textContent = "That is the lot. H shows every control.";
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
      li.innerHTML = s.html;
      if (this.done.has(s.id)) li.className = "done";
      else if (next) {
        li.className = "next";
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
