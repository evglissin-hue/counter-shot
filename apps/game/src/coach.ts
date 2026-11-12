// The guided match's coach (phase 2 M6): a card beside the field that walks a
// newcomer through a real match against the tutor, one step at a time, with a
// pulsing ring on the HUD parts a step names and a brass ring pinned to the
// world point it is about (the enemy keep, their gate, their wave, your
// waves). It only reads what the page already knows (frames, MatchInfo, the
// player's own input events): it never sends an input and never changes the
// match. All its text is fixed, never taken from the match or a friend.

import { CASTLE_SHAPE, DIST, Earn, holdMarker } from "@keepfall/content";
import { MINION_STRIDE, PLOT_STRIDE, type FrameData } from "@keepfall/sim";
import { EARN_STRIDE, type MatchInfo } from "./protocol";
import type { GuideStep } from "./guide";

type MarkKind = "keep" | "gate" | "wave" | "hold" | "road";

/** What a step's tests and highlights may look at. */
interface Ctx {
  info: MatchInfo;
  me: 0 | 1;
  foe: 0 | 1;
  /** The tutor's stage (a test can override it). */
  stage: number;
  aimed: boolean;
  overviewed: boolean;
  /** Keep hits by your own shots since the match began. */
  keepHits: number;
  /** A barracks of yours rising or standing on a plot but your first. */
  barracks2: boolean;
  /** Enemy men standing outside their courtyard. */
  outside: number;
  /** Enemy men fallen since this step began. */
  fallenSince: number;
  /** Your men standing out of your courtyard (waiting at the marker while your order is Hold). */
  held: number;
  /** The gun tab and charge state of the page (highlights only). */
  weapon: number;
  charging: boolean;
}

interface Step {
  title: string;
  /** How, with keys in <kbd>. */
  how: string;
  /** Waits for this before it is asked (and shows `wait` meanwhile). */
  ready?(c: Ctx): boolean;
  wait?(c: Ctx): string;
  test(c: Ctx): boolean;
  /** The one-line follow-up shown a few seconds once the step is done. */
  follow?(c: Ctx): string;
  highlights(c: Ctx): string[];
  followHighlights?: string[];
  mark?: { kind: MarkKind; label: string };
}

/** Stop their wave (index 5; "Mark the road" follows it): the step that may interrupt an earlier one (the tutor stirs by 4:00 at the latest). */
const WAVE_STEP = 5;
/**
 * Send your waves in: it interrupts too, once the men waiting at your marker
 * are many while the tutor is awake. Your waves start on Hold; at the cap on
 * men standing (WAVES.maxStanding, 96) your barracks cannot even top up your
 * garrison, and two of the tutor's waves could storm a courtyard nobody holds.
 */
const SEND_STEP = 7;
/** Your men waiting out of your courtyard that make step 7 interrupt (eight waves; the cap is twelve). */
const HELD_MANY = 64;
/** A step asked this long (ticks of match time) without being done gets its Skip button pulsing; not the last two (a siege takes its time). */
const STUCK_TICKS = 120 * 60;
const TABS = (n: number) => `#weapons [data-weapon="${n}"]`;
const KBD = (k: string) => `<kbd>${k}</kbd>`;

const STEPS: Step[] = [
  {
    title: "Take the long gun",
    how: `Click the field: the mouse aims <span class="nw">(or ${KBD("W")} ${KBD("A")} ${KBD("S")} ${KBD("D")})</span>.`,
    test: (c) => c.aimed,
    highlights: () => [],
  },
  {
    title: "Hit the enemy keep twice",
    how: `${KBD("Space")} or click fires. Watch where it lands and correct.`,
    test: (c) => c.keepHits >= 2,
    follow: () => "Each hit strips stone and pays 10 gold.",
    highlights: () => [],
    mark: { kind: "keep", label: "Enemy keep" },
  },
  {
    title: "Crack a floor with the mortar",
    how: `${KBD("2")} takes the mortar. Hold ${KBD("Space")}: a ring slides out. Let go when it is on the keep.`,
    test: (c) => c.info.keepFloor[c.foe] < 1 || c.info.keeps[c.foe] < 3,
    follow: () => "Three floors hold up their banner. Break them all to win.",
    followHighlights: ["#keep-theirs"],
    highlights: (c) => (c.charging ? ["#charge"] : [TABS(1)]),
    mark: { kind: "keep", label: "Enemy keep" },
  },
  {
    title: "Build a second barracks",
    how: `Build (${KBD("B")}) spends your gold. A Barracks sends another wave every 25 s.`,
    test: (c) => c.barracks2,
    highlights: () => ["#gold", "#build-btn"],
  },
  {
    title: "See the whole valley",
    how: `${KBD("Tab")} shows it from above. Your waves wait by the bridge.`,
    test: (c) => c.overviewed,
    highlights: () => ["#overview-btn"],
    mark: { kind: "hold", label: "Your waves" },
  },
  {
    title: "Stop their wave",
    how: `Enemy wave coming. The chain shot (${KBD("3")}) sweeps a wave; the swivel (${KBD("4")}) guards your walls.`,
    ready: (c) => c.stage >= 1 && c.outside > 0,
    wait: (c) => (c.stage < 1 ? "The enemy castle is still asleep." : "Their first wave is not out yet."),
    test: (c) => c.fallenSince >= 4 || c.outside === 0,
    follow: () => "Your other guns fire on their own at men near your gate.",
    highlights: () => ["#threat", TABS(2), TABS(3)],
    mark: { kind: "wave", label: "Their wave" },
  },
  {
    title: "Mark the road",
    how: `Land a shot on the road their waves take, then press ${KBD("T")}.`,
    test: (c) => c.info.marks.length > 0,
    follow: () => `On their next wave, press ${KBD("F")} and the mark's number: every gun that bears fires there.`,
    followHighlights: ["#marks-row"],
    highlights: () => ["#markhint"],
    mark: { kind: "road", label: "Their road" },
  },
  {
    title: "Send your waves in",
    how: `Pick a road under the map, then Advance (${KBD("Ctrl")}+${KBD("1")}). They march on the enemy gate.`,
    test: (c) => c.info.order === 0 || c.info.order === 2,
    follow: (c) => (c.stage >= 2 ? "They have woken up: their long gun is manned." : "Your waves are on their way."),
    highlights: () => ["#command [data-route]", "#command [data-order]"],
  },
  {
    title: "Break in",
    how: `Your waves batter their gate. A breach in a wall works too: Push the breach (${KBD("Ctrl")}+${KBD("3")}).`,
    test: (c) => c.info.storm[c.foe] > 0 || c.info.keeps[c.foe] <= 1,
    highlights: () => ['#command [data-order="2"]'],
    mark: { kind: "gate", label: "Their gate" },
  },
  {
    title: "Win",
    how: "Hold their courtyard 20 s, or bring down the last floor of their keep.",
    test: (c) => !!c.info.result && c.info.result.winner === c.me,
    highlights: (c) => [c.info.storm[c.foe] > 0 ? "#storm" : "#keep-theirs"],
  },
];

/** Tips, once each, as notes (not steps). */
/** Steps that come whatever the player is doing, each interrupting an earlier step once (the first that holds wins). */
const INTERRUPTS: Array<{ step: number; when(c: Ctx): boolean }> = [
  { step: WAVE_STEP, when: (c) => !!STEPS[WAVE_STEP].ready?.(c) },
  { step: SEND_STEP, when: (c) => c.stage >= 1 && c.info.order === 1 && c.held >= HELD_MANY },
];

const STAGE_TIPS: Record<number, string> = {
  1: "The enemy wakes: it is raising a barracks",
  2: "Their long gun is manned now",
  3: "Their mortar fires too. Your masons mend your walls (Repairs, under the map)",
};

/** A point of a castle in its own frame (castle 0's: the gate side at z = -half) as a world point (castle 1 is the mirror across the field). */
function castlePoint(castle: number, xl: number, y: number, zl: number): [number, number, number] {
  return castle === 0 ? [xl, y, zl] : [-xl, y, -DIST - zl];
}

export interface CoachHost {
  /** A world point on screen (CSS pixels), or null behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  size(): { w: number; h: number };
  note(text: string, ms: number): void;
}

export interface CoachFrameState {
  /** Marks are drawn (not in the shot camera, the shell ride, a menu or the end screen). */
  marksOn: boolean;
  weapon: number;
  charging: boolean;
}

const FOLLOW_MS = 3000;
const TICK_MS = 700;
const SIGHT_CLEAR = 60;
const EDGE = 34;

export class Coach {
  /** How long a follow-up shows (ms); a test on a slow machine lengthens it. */
  followMs = FOLLOW_MS;
  private active = false;
  private hidden = false;
  private me: 0 | 1 = 1;
  private foe: 0 | 1 = 0;
  private idx = 0;
  private phase: "ask" | "after" = "ask";
  private afterUntil = 0;
  private afterText = "";
  private begun = false;
  /** Steps done or skipped as interruptions (INTERRUPTS): each interrupts once, never again, and is passed over in turn. */
  private doneOut = new Set<number>();
  /** The step an interruption left waiting (null: none). */
  private resume: number | null = null;
  /** The match tick the current step began to be asked (for the Skip nudge). */
  private askedTick = 0;
  /** The how-line while a stage-dependent step waits for its stage. */
  private waitText = "";
  private fallenBase = 0;
  private info: MatchInfo | null = null;
  private aimed = false;
  private overviewed = false;
  private keepHits = 0;
  private barracks2 = false;
  private foeBarracks = false;
  private tips = new Set<number>();
  private downTip = false;
  private enemy: [number, number, number] | null = null;
  private hlKey = "";
  private hlEls: Element[] = [];
  private cardKey = "";
  private lastWeapon = 0;
  private lastCharging = false;

  private readonly card: HTMLElement;
  private readonly stepEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly howEl: HTMLElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly hideBtn: HTMLButtonElement;
  private readonly mark: HTMLElement;
  private readonly markLabel: HTMLElement;
  private readonly markArrow: HTMLElement;

  constructor(private host: CoachHost, $: <T extends HTMLElement>(id: string) => T) {
    this.card = $("coach");
    this.stepEl = $("coach-step");
    this.titleEl = $("coach-title");
    this.howEl = $("coach-how");
    this.skipBtn = $<HTMLButtonElement>("coach-skip");
    this.hideBtn = $<HTMLButtonElement>("coach-hide");
    this.mark = $("coach-mark");
    this.markLabel = $("coach-mark-label");
    this.markArrow = $("coach-mark-arrow");
    this.skipBtn.addEventListener("click", () => {
      this.skipBtn.blur();
      if (this.phase === "after") this.next(performance.now());
      else if (this.active && this.idx < STEPS.length) this.finish(false, performance.now());
    });
    this.hideBtn.addEventListener("click", () => {
      this.hideBtn.blur();
      this.hide();
    });
  }

  /** A guided match starts (on) or another mode does (off). */
  start(on: boolean, me: 0 | 1 = 1) {
    this.active = on;
    this.hidden = false;
    this.me = me;
    this.foe = me === 1 ? 0 : 1;
    this.idx = 0;
    this.phase = "ask";
    this.begun = false;
    this.doneOut.clear();
    this.resume = null;
    this.askedTick = 0;
    this.info = null;
    this.aimed = this.overviewed = this.barracks2 = this.foeBarracks = this.downTip = false;
    this.keepHits = 0;
    this.tips.clear();
    this.enemy = null;
    this.cardKey = "";
    this.draw();
  }

  /** The Controls panel's "Show the guide". */
  show() {
    if (!this.active) return;
    this.hidden = false;
    this.cardKey = "";
    this.draw();
  }

  hide() {
    this.hidden = true;
    this.draw();
    this.setHighlights([]);
    this.mark.hidden = true;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Test hook: the coach's state in plain words. */
  get state() {
    return {
      active: this.active,
      hidden: this.hidden,
      step: this.idx,
      phase: this.phase,
      title: this.titleEl.textContent ?? "",
      how: this.howEl.textContent ?? "",
      done: this.idx >= STEPS.length,
      keepHits: this.keepHits,
    };
  }

  /** Test hook: count a keep hit of yours without a shot. */
  fakeKeepHit() {
    this.keepHits++;
  }

  /** Something the player did, from the page's own input events (the guide's marks). */
  did(step: GuideStep) {
    if (!this.active) return;
    if (step === "aim") this.aimed = true;
    else if (step === "overview") this.overviewed = true;
  }

  /** A sim frame: your barracks, their barracks, and where their men are. */
  onFrame(f: FrameData) {
    if (!this.active) return;
    for (let i = 0; i < f.plotCount; i++) {
      const o = i * PLOT_STRIDE;
      const castle = f.plots[o] | 0, plot = f.plots[o + 1] | 0, kind = f.plots[o + 2] | 0, state = f.plots[o + 3] | 0;
      if (kind !== 0 || (state !== 1 && state !== 2)) continue;
      if (castle === this.me && plot !== 0) this.barracks2 = true;
      if (castle === this.foe) this.foeBarracks = true;
    }
    // The enemy man nearest your gate (for the "Their wave" mark).
    const [gx, , gz] = castlePoint(this.me, 0, 0, -CASTLE_SHAPE.half);
    let best = Infinity;
    let at: [number, number, number] | null = null;
    for (let i = 0; i < f.minionCount; i++) {
      const o = i * MINION_STRIDE;
      if ((f.minions[o + 6] | 0) !== this.foe || (f.minions[o + 9] | 0) === 1) continue;
      const d = Math.hypot(f.minions[o + 1] - gx, f.minions[o + 3] - gz);
      if (d < best) {
        best = d;
        at = [f.minions[o + 1], f.minions[o + 2], f.minions[o + 3]];
      }
    }
    this.enemy = at;
  }

  /** The match as the worker reports it, once per frame. */
  onMatch(info: MatchInfo) {
    if (!this.active) return;
    this.info = info;
    for (let o = 0; o + EARN_STRIDE <= info.earned.length; o += EARN_STRIDE) {
      if ((info.earned[o] | 0) === this.me && (info.earned[o + 2] | 0) === Earn.KeepHit) this.keepHits++;
    }
    const now = performance.now();
    // Tips only while the match is on (one came six seconds after a win: the frames still in flight).
    if (!info.result) this.tips_(info);
    if (info.result) {
      // The match is over: the end screen takes over.
      if (this.idx < STEPS.length && info.result.winner === this.me) this.idx = STEPS.length;
      this.draw();
      this.setHighlights([]);
      this.mark.hidden = true;
      return;
    }
    this.advance(now);
  }

  /** Tutor tips and the first stone down, once each, through the page's note column. */
  private tips_(info: MatchInfo) {
    const stage = info.tutor;
    let top = 0;
    for (let s = 1; s <= 3; s++) {
      if (stage >= s && !this.tips.has(s)) {
        this.tips.add(s);
        top = s;
      }
    }
    // Stage 1's tip is what the page's own note says when it sees their barracks go up: not twice.
    if (top && !(top === 1 && this.foeBarracks)) this.host.note(STAGE_TIPS[top], 5000);
    else if (!top && !this.downTip && info.tutor >= 2 && info.down && info.down[this.me] > 0) {
      // Once its guns are awake: a stone or two of yours falls on its own before (settling, your own shots).
      this.downTip = true;
      this.host.note("Your masons rebuild what falls, for gold", 5000);
    }
  }

  private ctx(): Ctx | null {
    const info = this.info;
    if (!info) return null;
    return {
      info,
      me: this.me,
      foe: this.foe,
      stage: info.tutor,
      aimed: this.aimed,
      overviewed: this.overviewed,
      keepHits: this.keepHits,
      barracks2: this.barracks2,
      outside: Math.max(0, info.standing[this.foe] - info.garrison[this.foe]),
      held: Math.max(0, info.standing[this.me] - info.garrison[this.me]),
      fallenSince: info.fallen[this.foe] - this.fallenBase,
      weapon: this.lastWeapon,
      charging: this.lastCharging,
    };
  }

  /** Move on when the current step's test holds (and past steps already true are ticked at once). */
  private advance(now: number) {
    for (let guard = 0; guard < STEPS.length + 2; guard++) {
      if (this.idx >= STEPS.length) break;
      // Some steps come whatever the player is doing (the tutor's first wave; a field full of your waiting men):
      // each interrupts an earlier step once, and the coach goes back to the earliest step not done after it.
      if (this.resume === null) {
        const w = this.ctx();
        if (w) {
          for (const it of INTERRUPTS) {
            if (this.idx >= it.step || this.doneOut.has(it.step) || !it.when(w)) continue;
            // A wave being fought off comes first: nothing interrupts it.
            if (this.idx === WAVE_STEP && this.begun) break;
            this.resume = this.phase === "after" ? this.idx + 1 : this.idx;
            this.idx = it.step;
            this.phase = "ask";
            this.begun = false;
            this.afterText = "";
            this.cardKey = "";
            break;
          }
        }
      }
      if (this.phase === "after") {
        if (now >= this.afterUntil) this.next(now);
        else break;
        continue;
      }
      const c = this.ctx();
      if (!c) break;
      const step = STEPS[this.idx];
      if (!this.begun) {
        if (step.ready && !step.ready(c)) {
          this.waitText = step.wait?.(c) ?? "";
          break;
        }
        this.waitText = "";
        this.begun = true;
        this.askedTick = c.info.tick;
        this.fallenBase = c.info.fallen[this.foe];
        c.fallenSince = 0;
        // Already true as it comes up: ticked at once, no follow-up.
        if (step.test(c)) {
          this.next(now);
          continue;
        }
      }
      if (step.test(c)) this.finish(true, now);
      break;
    }
    this.draw();
  }

  /** The step is done: a tick and its follow-up where it has one (or skipped: straight on). */
  private finish(done: boolean, now: number) {
    const step = STEPS[this.idx];
    const c = this.ctx();
    const text = done && c && step.follow ? step.follow(c) : "";
    if (!done) {
      this.next(now);
      this.advance(now);
      return;
    }
    this.phase = "after";
    this.afterText = text;
    this.afterUntil = now + (text ? this.followMs : TICK_MS);
    this.draw();
  }

  private next(now: number) {
    if (this.resume !== null) {
      // An interruption is over: back to the earliest step not yet done.
      this.doneOut.add(this.idx);
      this.idx = this.resume - 1;
      this.resume = null;
    }
    this.idx++;
    while (this.doneOut.has(this.idx)) this.idx++;
    this.phase = "ask";
    this.begun = false;
    this.afterText = "";
    this.waitText = "";
    this.cardKey = "";
    void now;
  }

  /** The card, from the state (only touches the page when something changed). */
  private draw() {
    const waiting = this.phase === "ask" && !this.begun ? this.waitText : "";
    const visible = this.active && !this.hidden && this.idx < STEPS.length && !(this.info?.result);
    const step = STEPS[Math.min(this.idx, STEPS.length - 1)];
    const key = `${visible}|${this.idx}|${this.phase}|${this.afterText}|${waiting ?? ""}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    this.card.hidden = !visible;
    if (!visible) return;
    const after = this.phase === "after";
    this.stepEl.textContent = `Step ${this.idx + 1} of ${STEPS.length}`;
    this.titleEl.textContent = (after ? "✓ " : "") + step.title;
    this.card.classList.toggle("done", after);
    if (after) this.howEl.innerHTML = this.afterText;
    else if (waiting) this.howEl.textContent = waiting;
    else this.howEl.innerHTML = step.how;
    this.howEl.hidden = after && !this.afterText;
  }

  /** Every rendered frame: the clock for the follow-up, the highlights and the world mark. */
  render(now: number, r: CoachFrameState) {
    if (!this.active) {
      if (this.hlEls.length) this.setHighlights([]);
      this.mark.hidden = true;
      return;
    }
    this.lastWeapon = r.weapon;
    this.lastCharging = r.charging;
    if (this.phase === "after" && now >= this.afterUntil && !this.info?.result) this.advance(now);
    const c = this.ctx();
    const step = this.idx < STEPS.length ? STEPS[this.idx] : null;
    if (!c || !step || this.hidden || c.info.result) {
      this.setHighlights([]);
      this.mark.hidden = true;
      return;
    }
    const waiting = this.phase === "ask" && !this.begun;
    const hl = waiting ? [] : this.phase === "after" ? (step.followHighlights ?? []) : step.highlights(c);
    // Long on one step (stuck on the mortar, say): the Skip button pulses, so it is plain the coach can move on.
    const stuck = this.phase === "ask" && this.begun && this.idx < STEPS.length - 2 && c.info.tick - this.askedTick > STUCK_TICKS;
    this.setHighlights(stuck ? [...hl, "#coach-skip"] : hl);
    const m = step.mark;
    if (!m || this.phase === "after" || waiting || !r.marksOn) {
      this.mark.hidden = true;
      return;
    }
    const p = this.markPoint(m.kind, c);
    if (!p) {
      this.mark.hidden = true;
      return;
    }
    this.placeMark(p, m.label);
  }

  private markPoint(kind: MarkKind, c: Ctx): [number, number, number] | null {
    switch (kind) {
      case "keep": return castlePoint(this.foe, 0, CASTLE_SHAPE.keepCourses * CASTLE_SHAPE.course * 0.7, CASTLE_SHAPE.keepZ);
      case "gate": return castlePoint(this.foe, 0, 2.5, -CASTLE_SHAPE.half);
      case "hold": {
        const h = holdMarker(this.me, c.info.route);
        return [h.x, 1.5, h.z];
      }
      case "wave": return this.enemy;
      // The road their waves take: where their current wave is, else the centre bridge's approach on your side.
      case "road": {
        if (this.enemy) return this.enemy;
        const h = holdMarker(this.me, "centre");
        return [h.x, 0.5, h.z];
      }
    }
  }

  private placeMark(p: [number, number, number], label: string) {
    const { w, h } = this.host.size();
    const s = this.host.project(p[0], p[1], p[2]);
    let x: number, y: number, angle = 0, edge = false;
    const top = EDGE + 44; // clear of the top bar
    if (!s) {
      // Behind the camera: the bottom edge, the arrow pointing down.
      x = w / 2;
      y = h - EDGE;
      angle = Math.PI / 2;
      edge = true;
    } else {
      x = s.x;
      y = s.y;
      if (x < EDGE || x > w - EDGE || y < top || y > h - EDGE) {
        const cx = w / 2, cy = h / 2;
        const dx = x - cx, dy = y - cy;
        angle = Math.atan2(dy, dx);
        const k = Math.min(dx ? (dx > 0 ? w - EDGE - cx : EDGE - cx) / dx : Infinity, dy ? (dy > 0 ? h - EDGE - cy : top - cy) / dy : Infinity);
        x = cx + dx * k;
        y = cy + dy * k;
        edge = true;
      }
    }
    const nearSight = !edge && Math.hypot(x - w / 2, y - h / 2) < SIGHT_CLEAR;
    this.mark.hidden = false;
    this.mark.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    this.mark.classList.toggle("edge", edge);
    this.markLabel.hidden = nearSight;
    this.markLabel.textContent = label;
    // The label sits on the inner side at the right and left edges so it stays on screen.
    this.mark.classList.toggle("flip", x > w * 0.6);
    this.markArrow.style.transform = `rotate(${angle.toFixed(3)}rad)`;
  }

  private setHighlights(sels: string[]) {
    const key = sels.map((x) => `${x}:${document.querySelectorAll(x).length}`).join("|");
    if (key === this.hlKey) return;
    this.hlKey = key;
    for (const el of this.hlEls) el.classList.remove("coach-hl");
    this.hlEls = [];
    for (const s of sels) {
      // A selector that matches nothing (the threat strip before it lands) is skipped quietly.
      document.querySelectorAll(s).forEach((el) => {
        el.classList.add("coach-hl");
        this.hlEls.push(el);
      });
    }
  }
}
