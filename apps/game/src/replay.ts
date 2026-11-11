// The replay player (track S, step S4): takes the renderer over to show a recorded
// clip the way the director filmed it, and gives it back.
//
// `play(clip)`: take the live keyframe, put the clip's keyframe in the renderer, ask the
// director for a take (after the keyframe, so the sight answers are the clip's), roll the
// frames before the take forward unseen, run the last third of a second at real speed under a
// black cover (figures and smoke in step), then play the take at the speed the director sets.
// At the end, on a skip or on any error the live keyframe is put back, always.
//
// The player knows the renderer only through `ReplayHost` and the screen through `ReplayView`, so
// what it decides can be tested without either. Nothing here feeds the match: it never calls
// the page's frame handler, moments, notes, tallies, feats or gold.

import type { CastleLayout } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, type FrameData } from "@keepfall/sim";
import { direct, type CamPose, type Sight, type Take } from "./director";
import type { MomentKind } from "./moments";
import type { Clip, FrameExtras, RecEntry } from "./recorder";
import type { RenderKeyframe } from "./render/keyframe";
import { Timeline } from "./timeline";

/** What the player asks of the renderer (and of the page, for what a frame says). */
export interface ReplayHost {
  layout: CastleLayout;
  capture(): RenderKeyframe;
  apply(k: RenderKeyframe): void;
  applyFrame(f: FrameData): void;
  setProjectiles(proj: Float32Array, count: number, chains: Float32Array, chainCount: number): void;
  setStones(stones: Float32Array, count: number): void;
  setCamera(pose: { mode: "free" } & CamPose): void;
  render(dt: number): void;
  setTimeScale(scale: number): void;
  sightBlocked: Sight["blocked"];
  groundAt: Sight["ground"];
  /** Close the impact cam's inset. */
  closeInset(): void;
  /** Put what the page tells the renderer with a frame (barrels, the storm rings, and with `full` which guns are out) in place. */
  extras(e: FrameExtras, full: boolean): void;
  /** A frame of the clip is being shown: what its events do to the renderer beyond applyFrame (guns out), and, when `audible`, its sounds at `speed`. */
  frame(f: FrameData, speed: number, audible: boolean): void;
}

/** What the player asks of the screen. */
export interface ReplayView {
  /** The replay's screen on or off (the HUD hides, the bars and caption show). */
  show(on: boolean): void;
  /** How far the bars have closed (0 open, 1 closed). */
  bars(amount: number): void;
  /** A black cover over the picture (1 hides it). */
  cover(amount: number): void;
  caption(name: string, text: string): void;
  /** The speed mark: "1/4", or null at real speed. */
  speed(label: string | null): void;
}

export interface PlayOptions {
  /** Longest take, in seconds of play. */
  budget?: number;
  onEnd?: () => void;
}

/** One short name for each kind of moment (the caption's head). */
export const MOMENT_NAMES: Record<MomentKind, string> = {
  multiKill: "Multi-kill",
  ricochetKill: "Ricochet",
  collapseKill: "Collapse",
  thrown: "Thrown",
  kegChain: "Keg chain",
  kegBack: "Sent back",
  gunSilenced: "Gun silenced",
  buildingWrecked: "Building wrecked",
  gateDown: "Gate down",
  breachOpened: "Breach",
  towerDown: "Tower down",
  floorCaved: "Floor caved",
  bannerDown: "Banner down",
  bridgeDown: "Bridge down",
  stormBegun: "Storm begun",
  stormBeaten: "Storm beaten",
  lastBlow: "The last blow",
};

/** Ticks run at real speed under the cover before the take begins (a third of a second). */
export const LEAD_TICKS = 20;
/** Seconds the bars take to close, and the cover to clear. */
export const BARS_SECONDS = 0.4;
export const COVER_SECONDS = 0.25;
/** The longest a replay may run, in seconds of play, when the caller gives no budget. */
export const DEFAULT_BUDGET = 12;

/** "1/4" for a quarter speed; null from nearly real speed up. */
export function speedLabel(speed: number): string | null {
  if (!(speed < 0.95)) return null;
  const d = 1 / Math.max(speed, 0.02);
  return `1/${Math.round(d)}`;
}

/** Event kinds that only throw particles or make a sound: not worth laying down for frames that run unseen. */
const PARTICLE_EVENTS = new Set<number>([EventKind.Muzzle, EventKind.Explosion, EventKind.Impact, EventKind.Musket, EventKind.Cracked]);

/**
 * A frame for the unseen roll forward: its events that only make particles dropped (they would
 * all be born at the same instant and show as fresh smoke from seconds ago); stones, bodies,
 * ground patches and the events that change what the world holds stay.
 */
export function quiet(f: FrameData): FrameData {
  let drop = 0;
  for (let k = 0; k < f.eventCount; k++) if (PARTICLE_EVENTS.has(f.events[k * EVENT_STRIDE])) drop++;
  if (!drop) return f;
  const events = new Float32Array((f.eventCount - drop) * EVENT_STRIDE);
  let w = 0;
  for (let k = 0; k < f.eventCount; k++) {
    const o = k * EVENT_STRIDE;
    if (PARTICLE_EVENTS.has(f.events[o])) continue;
    events.set(f.events.subarray(o, o + EVENT_STRIDE), w * EVENT_STRIDE);
    w++;
  }
  return { ...f, events, eventCount: w };
}

type Phase = "idle" | "lead" | "play";

export class ReplayPlayer {
  private phase: Phase = "idle";
  private live: RenderKeyframe | null = null;
  private take: Take | null = null;
  private clip: Clip | null = null;
  private tl: Timeline;
  private entryOf = new Map<FrameData, RecEntry>();
  private tick = 0;
  private bars = 0;
  private cover = 1;
  private onEnd: (() => void) | undefined;
  private lastSpeed = 1;
  /** Seconds since play(), for the bars. */
  private age = 0;

  constructor(
    private host: ReplayHost,
    private view: ReplayView,
    private plan: typeof direct = direct,
  ) {
    this.tl = new Timeline(host.layout);
  }

  get playing(): boolean {
    return this.phase !== "idle";
  }

  /** The clip tick shown now (continuous), or -1 when idle. */
  get at(): number {
    return this.phase === "idle" ? -1 : this.tick;
  }

  /** The take being played, or null. */
  get current(): Take | null {
    return this.take;
  }

  get speed(): number {
    return this.phase === "play" ? this.lastSpeed : 1;
  }

  /** Take the renderer over and begin. If it cannot, the live view is put back and `onEnd` is called at once. */
  play(clip: Clip, opts: PlayOptions = {}): void {
    if (this.phase !== "idle") this.finish();
    const host = this.host;
    this.onEnd = opts.onEnd;
    this.live = host.capture();
    this.clip = clip;
    try {
      host.closeInset();
      this.view.show(true);
      this.view.bars(0);
      this.view.cover(1);
      this.view.speed(null);
      this.bars = 0;
      this.cover = 1;
      this.age = 0;
      host.apply(clip.keyframe.render);
      host.extras(clip.keyframe.extras, true);
      this.take = this.plan(
        { moment: clip.moment, from: clip.from, to: clip.to, frames: clip.entries.map((e) => e.frame) },
        { blocked: (ax, ay, az, bx, by, bz) => host.sightBlocked(ax, ay, az, bx, by, bz), ground: (x, z) => host.groundAt(x, z) },
        { budget: opts.budget ?? DEFAULT_BUDGET },
      );
      this.view.caption(MOMENT_NAMES[clip.moment.kind] ?? "Replay", clip.moment.text);
      // The frames, in a timeline of our own, seeded with where the keyframe put the stones.
      const tl = this.tl;
      tl.reset();
      const stones = clip.keyframe.render.parts.get("stones") as { moved?: Float32Array } | undefined;
      if (stones?.moved) tl.seed(stones.moved);
      this.entryOf.clear();
      for (const e of clip.entries) {
        tl.push(e.frame);
        this.entryOf.set(e.frame, e);
      }
      // Roll forward unseen to LEAD_TICKS before the take.
      const from = this.take.start - LEAD_TICKS;
      let lastExtras: FrameExtras = clip.keyframe.extras;
      for (const f of tl.seek(from - 0.5)) {
        host.applyFrame(quiet(f));
        lastExtras = this.entryOf.get(f)?.extras ?? lastExtras;
      }
      host.extras(lastExtras, true);
      tl.tick = from;
      this.tick = from;
      this.phase = "lead";
      host.setTimeScale(1);
      this.poseCamera(this.take.start);
    } catch (err) {
      console.error("replay failed to start", err);
      this.finish();
    }
  }

  /** Called each page frame while playing (`dt` in seconds of real time). */
  update(dt: number): void {
    if (this.phase === "idle" || !this.take) return;
    try {
      this.step(dt);
    } catch (err) {
      console.error("replay failed", err);
      this.finish();
    }
  }

  /** Stop at once for good (a new world): the live view is put back, `onEnd` is not called. */
  cancel(): void {
    this.onEnd = undefined;
    if (this.phase !== "idle") this.finish();
  }

  /** End now, as a skip: the live view is put back, then `onEnd`. */
  skip(): void {
    if (this.phase !== "idle") this.finish();
  }

  // ---- internals ------------------------------------------------------------------

  private step(dt: number) {
    const host = this.host, take = this.take!, tl = this.tl;
    let speed = 1;
    if (this.phase === "lead") {
      this.tick += dt * 60;
      if (this.tick >= take.start) {
        this.tick = take.start;
        this.phase = "play";
        this.cover = 0;
        this.view.cover(0);
        this.age = 0;
      }
    } else {
      speed = take.speedAt(this.tick);
      this.tick += dt * 60 * speed;
      this.age += dt;
    }
    this.lastSpeed = speed;
    const audible = this.phase === "play";
    host.setTimeScale(speed);
    for (const f of tl.seek(this.tick)) {
      host.applyFrame(f);
      const e = this.entryOf.get(f);
      if (e) host.extras(e.extras, false);
      host.frame(f, speed, audible);
    }
    tl.interpolate();
    host.setProjectiles(tl.proj, tl.projCount, tl.chains, tl.chainCount);
    if (tl.stoneCount) host.setStones(tl.stones, tl.stoneCount);
    this.poseCamera(Math.max(take.start, Math.min(this.tick, take.end)));
    if (this.phase === "play") {
      this.bars = Math.min(1, this.age / BARS_SECONDS);
      this.view.bars(this.bars * this.bars * (3 - 2 * this.bars));
      this.view.speed(speedLabel(speed));
    } else this.view.bars(1);
    host.render(dt);
    if (this.phase === "play" && this.tick >= take.end) this.finish();
  }

  private poseCamera(tick: number) {
    const p = this.take!.poseAt(tick);
    this.host.setCamera({ mode: "free", ...p });
  }

  /** Put the live view back whatever happened, then hand over. */
  private finish() {
    const onEnd = this.onEnd;
    this.restore();
    try {
      onEnd?.();
    } catch (err) {
      console.error("replay end handler failed", err);
    }
  }

  private restore() {
    const live = this.live;
    this.phase = "idle";
    this.take = null;
    this.clip = null;
    this.live = null;
    this.onEnd = undefined;
    this.entryOf.clear();
    try {
      if (live) this.host.apply(live);
    } catch (err) {
      console.error("replay could not put the live view back", err);
    }
    this.host.setTimeScale(1);
    this.view.speed(null);
    this.view.cover(0);
    this.view.bars(0);
    this.view.show(false);
  }
}

/** The page's own screen for a replay (see index.html: #replay). */
export function domView(doc: Document): ReplayView {
  const root = doc.getElementById("replay");
  const top = doc.getElementById("replay-top"), bot = doc.getElementById("replay-bot");
  const cover = doc.getElementById("replay-cover");
  const name = doc.getElementById("replay-name"), text = doc.getElementById("replay-text"), mark = doc.getElementById("replay-speed");
  return {
    show(on) {
      doc.body.classList.toggle("replaying", on);
      if (root) root.hidden = !on;
    },
    bars(a) {
      if (top) top.style.transform = `scaleY(${a})`;
      if (bot) bot.style.transform = `scaleY(${a})`;
    },
    cover(a) {
      if (cover) cover.style.opacity = String(a);
    },
    caption(n, t) {
      if (name) name.textContent = n;
      if (text) text.textContent = t;
    },
    speed(label) {
      if (!mark) return;
      mark.textContent = label ?? "";
      mark.hidden = !label;
    },
  };
}
