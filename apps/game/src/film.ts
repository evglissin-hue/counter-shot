// The film and the photo (track S, step S5).
//
// The film: a title card, then the best clips of the reel in the order they happened, played one after
// another through the replay player. Its picture (the bars, the caption, the title card) is drawn by one 2D
// function, `drawOverlay`, used both on the page and for the recording, so the saved file shows what the
// screen showed. Saving records a 2D composite (the game canvas drawn right after the renderer drew it, plus
// the overlay) and the game's sound with the browser's MediaRecorder, and follows the GAME's clock: a film
// frame is a fixed 1/25 s of game time however long it took to draw, and the recorder only runs for 1/30 s of
// wall time per frame (paused while the next frame is drawn).
//
// Photo mode: a free camera over a paused replay or a waiting match (`PhotoCam`, pure).
//
// Nothing here feeds the match. Page code, not physics: the math is free.

import { replayFileName } from "./matchLog";
import type { ReplayView } from "./replay";
import type { Clip } from "./recorder";

// ---- the plan ------------------------------------------------------------------------------------

export const FILM = {
  /** Clips in a full film. */
  clips: 5,
  /** Seconds of title card. */
  title: 3,
  /** The film as planned with a full reel: between min and max, aimed at target. */
  min: 30,
  target: 40,
  max: 45,
  /** No clip is given more than this many seconds, lead included (a film of fewer clips is just shorter). */
  perClipMax: 9,
  /** Seconds each clip spends under the cover before its take (the replay player's lead: LEAD_TICKS at 60 a second). */
  lead: 20 / 60,
  /** Game seconds one film frame advances while saving: 25 a second, so a frame's slot is two whole Opus frames of sound (the recorder rounds each paused-and-resumed stretch of sound up to 20 ms). */
  frame: 1 / 25,
  /** The title card fades out over this many seconds at its end. */
  fadeOut: 0.5,
} as const;

/** The clips of a film: the best by score (the later one wins a tie), at most `max`, then in the order they happened. */
export function chooseClips<T extends { moment: { score: number; tick: number } }>(reel: readonly T[], max: number = FILM.clips): T[] {
  const ranked = reel.map((c, i) => ({ c, i })).sort((a, b) => b.c.moment.score - a.c.moment.score || b.c.moment.tick - a.c.moment.tick || b.i - a.i);
  return ranked
    .slice(0, max)
    .sort((a, b) => a.c.moment.tick - b.c.moment.tick || a.i - b.i)
    .map((x) => x.c);
}

export interface FilmPlan {
  clips: number;
  title: number;
  /** The director's budget for each clip (seconds of play, lead not counted). */
  budgets: number[];
  /** Title plus every clip's budget and lead: the longest the film can run. */
  total: number;
}

/** Share the film's time out: `scale` shrinks everything (tests). */
export function planFilm(n: number, scale = 1): FilmPlan {
  const count = Math.max(0, Math.min(FILM.clips, Math.floor(n)));
  const per = count ? Math.min(FILM.perClipMax, (FILM.target - FILM.title) / count) : 0;
  // The lead under the cover is the player's own and does not shrink with the scale.
  const budget = Math.max(0.5, per * scale - FILM.lead);
  const budgets = Array.from({ length: count }, () => budget);
  const title = FILM.title * scale;
  return { clips: count, title, budgets, total: title + budgets.reduce((s, b) => s + b + FILM.lead, 0) };
}

/** What the Status says about the film on offer. */
export function filmNote(n: number): string {
  const p = planFilm(n);
  const secs = Math.round(p.total);
  if (!p.clips) return "No film: the reel is empty.";
  if (p.clips >= FILM.clips) return `The film: a title card and the ${p.clips} best clips, up to ${secs} s.`;
  return `The film is shorter this time: a title card and ${p.clips} clip${p.clips > 1 ? "s" : ""}, up to ${secs} s (it takes the best ${FILM.clips} moments when there are that many).`;
}

// ---- the title card ------------------------------------------------------------------------------

/** The castles' colours (the minimap's: team 0 then team 1). */
export const TEAM_COLORS = ["#cdd842", "#e2525a"] as const;

export interface TitleSide {
  name: string;
  /** 0 or 1: picks the castle's colour. */
  team: number;
}

export interface TitleCard {
  heading: string;
  /** The two castles, the player's first. */
  sides: [TitleSide, TitleSide];
  /** "Victory", "Defeat", "A draw". */
  result: string;
  /** How it ended and when, a sentence. */
  line: string;
  /** "Tuesday 10 November 2026". */
  day: string;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Tuesday 10 November 2026" (the viewer's local day). */
export function dayText(d: Date): string {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function titleCard(o: { me: TitleSide; foe: TitleSide; winner: number | null; short: string; clock: string; date: Date }): TitleCard {
  const result = o.winner === null ? "So far" : o.winner === o.me.team ? "Victory" : o.winner === o.foe.team ? "Defeat" : "A draw";
  return { heading: "Keepfall", sides: [o.me, o.foe], result, line: `${o.short}, ${o.clock} on the clock`, day: dayText(o.date) };
}

// ---- the picture ---------------------------------------------------------------------------------

/** Everything the overlay draws: one state, drawn the same on the page and in the recording. */
export interface OverlayState {
  /** How far the bars have closed (0 open, 1 closed). */
  bars: number;
  /** A black cover over the picture (1 hides it). */
  cover: number;
  caption: { name: string; text: string } | null;
  /** "1/4" or null. */
  speed: string | null;
  card: TitleCard | null;
  /** The card's opacity (the world behind it is black). */
  cardAlpha: number;
}

export function emptyOverlay(): OverlayState {
  return { bars: 0, cover: 0, caption: null, speed: null, card: null, cardAlpha: 0 };
}

/** The subset of the 2D context the overlay needs (a test can pass a recorder of calls). */
export type Ctx2D = CanvasRenderingContext2D;

const INK = "#efe8d6", BRASS = "#c99a46", DIM = "#b5ab95";
const FONT = `"Barlow Semi Condensed", "Avenir Next Condensed", "Arial Narrow", system-ui, sans-serif`;
const MONO = `"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace`;

/** Draw the film's overlay over what is already on `g` (w by h): the title card, the bars, the caption, the cover. */
export function drawOverlay(g: Ctx2D, w: number, h: number, st: OverlayState): void {
  const u = h / 720;
  g.save();
  g.textBaseline = "alphabetic";
  if (st.cover > 0.001) {
    g.fillStyle = `rgba(0,0,0,${Math.min(1, st.cover)})`;
    g.fillRect(0, 0, w, h);
  }
  const bar = h * 0.1 * Math.max(0, Math.min(1, st.bars));
  if (bar > 0.5) {
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, bar);
    g.fillRect(0, h - bar, w, bar);
  }
  if (st.caption && st.bars > 0.05) {
    const a = Math.min(1, st.bars) * (1 - Math.min(1, st.cover));
    const x = Math.max(24, w * 0.02), y = h - h * 0.1 - 18 * u;
    g.globalAlpha = a;
    g.shadowColor = "rgba(0,0,0,0.9)";
    g.shadowBlur = 3 * u;
    g.shadowOffsetY = 1 * u;
    g.font = `500 ${15 * u}px ${FONT}`;
    g.fillStyle = INK;
    g.textAlign = "left";
    const maxW = w * 0.6;
    let text = st.caption.text;
    while (text.length > 4 && g.measureText(text).width > maxW) text = text.slice(0, -2);
    if (text !== st.caption.text) text = text.trimEnd() + "...";
    g.fillText(text, x, y);
    g.font = `600 ${12 * u}px ${FONT}`;
    g.fillStyle = BRASS;
    const name = st.caption.name.toUpperCase();
    spaced(g, name, x, y - 22 * u, 2 * u);
    if (st.speed) {
      g.font = `600 ${12 * u}px ${MONO}`;
      g.fillStyle = INK;
      g.fillText(st.speed, x + textWidth(g, name, 2 * u) + 10 * u, y - 22 * u);
    }
  }
  g.restore();
  if (st.card && st.cardAlpha > 0.001) drawCard(g, w, h, st.card, st.cardAlpha);
}

function textWidth(g: Ctx2D, s: string, track: number): number {
  return g.measureText(s).width + track * s.length;
}

/** Text with letter spacing (drawn glyph by glyph, which every browser supports). */
function spaced(g: Ctx2D, s: string, x: number, y: number, track: number) {
  let cx = x;
  for (const ch of s) {
    g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + track;
  }
}

function drawCard(g: Ctx2D, w: number, h: number, c: TitleCard, alpha: number) {
  const u = h / 720;
  g.save();
  g.fillStyle = `rgba(8,7,6,${alpha})`;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = alpha;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  const cx = w / 2, cy = h / 2;
  g.fillStyle = BRASS;
  g.font = `600 ${16 * u}px ${FONT}`;
  const head = c.heading.toUpperCase();
  g.textAlign = "left";
  spaced(g, head, cx - textWidth(g, head, 6 * u) / 2, cy - 120 * u, 6 * u);
  g.textAlign = "center";
  // The two castles, side by side, each with its colour.
  g.font = `600 ${34 * u}px ${FONT}`;
  const mid = " against ";
  g.font = `400 ${22 * u}px ${FONT}`;
  const midW = g.measureText(mid).width;
  g.font = `600 ${34 * u}px ${FONT}`;
  const aW = g.measureText(c.sides[0].name).width, bW = g.measureText(c.sides[1].name).width;
  const sw = 26 * u, gap = 12 * u;
  const total = sw + gap + aW + midW + sw + gap + bW;
  let x = cx - total / 2;
  g.textAlign = "left";
  const side = (s: TitleSide, wName: number) => {
    g.fillStyle = TEAM_COLORS[s.team] ?? INK;
    g.fillRect(x, cy - 56 * u - sw * 0.8, sw, sw);
    x += sw + gap;
    g.fillStyle = INK;
    g.font = `600 ${34 * u}px ${FONT}`;
    g.fillText(s.name, x, cy - 56 * u);
    x += wName;
  };
  side(c.sides[0], aW);
  g.font = `400 ${22 * u}px ${FONT}`;
  g.fillStyle = DIM;
  g.fillText(mid, x, cy - 56 * u);
  x += midW;
  side(c.sides[1], bW);
  // The result, then how it ended, then the day.
  g.textAlign = "center";
  g.fillStyle = INK;
  g.font = `600 ${64 * u}px ${FONT}`;
  g.fillText(c.result, cx, cy + 36 * u);
  g.fillStyle = DIM;
  g.font = `400 ${18 * u}px ${FONT}`;
  g.fillText(c.line, cx, cy + 76 * u);
  g.fillStyle = BRASS;
  g.font = `500 ${15 * u}px ${FONT}`;
  g.fillText(c.day, cx, cy + 112 * u);
  g.restore();
}

// ---- the film's state ----------------------------------------------------------------------------

/** What the film asks of the page. */
export interface FilmHost {
  /** Begin one clip through the replay player; call `onEnd` when it has ended or been skipped (the live view is already back then). */
  playClip(clip: Clip, budget: number, onEnd: () => void): void;
  /** Stop the playing clip at once for good (the live view goes back, `onEnd` is not called). */
  cancelClip(): void;
  /** One page frame of the playing clip: the player draws (and calls `Film.afterRender` through the renderer hook); sound goes on. */
  updateClip(dt: number): void;
  /** The HUD steps aside for the film (true) and comes back (false). */
  show(on: boolean): void;
  /** Draw the overlay where it is shown (the page, and the recording): `world` is false for the title card (black behind it). */
  paint(st: OverlayState, world: boolean): void;
  /** The film has finished (`completed`) or was ended early. */
  done(completed: boolean): void;
}

export type FilmPhase = "idle" | "title" | "clip";

export interface FilmOptions {
  /** Shrinks every time in the plan (tests). */
  scale?: number;
  saving?: boolean;
}

export class Film {
  phase: FilmPhase = "idle";
  readonly overlay: OverlayState = emptyOverlay();
  private clips: Clip[] = [];
  private plan: FilmPlan = planFilm(0);
  private card: TitleCard | null = null;
  private at = 0;
  private t = 0;
  private time = 0;
  private count = 0;
  /** The moment ticks of the clips as they were played, in order. */
  readonly played: number[] = [];
  saving = false;

  constructor(private host: FilmHost) {}

  get active(): boolean {
    return this.phase !== "idle";
  }

  /** Game seconds the film has run, and film frames drawn. */
  get elapsed(): number {
    return this.time;
  }
  get frames(): number {
    return this.count;
  }
  get planned(): FilmPlan {
    return this.plan;
  }
  get index(): number {
    return this.at;
  }

  /** Begin: the title card, then the clips. `reel` is the whole reel; the film chooses. Returns the plan, or null when there is nothing to show. */
  start(reel: readonly Clip[], card: TitleCard, opts: FilmOptions = {}): FilmPlan | null {
    if (this.active) return null;
    this.clips = chooseClips(reel);
    if (!this.clips.length) return null;
    this.plan = planFilm(this.clips.length, opts.scale ?? 1);
    this.saving = !!opts.saving;
    this.card = card;
    this.at = 0;
    this.t = 0;
    this.time = 0;
    this.count = 0;
    this.played.length = 0;
    this.phase = "title";
    Object.assign(this.overlay, emptyOverlay());
    this.host.show(true);
    this.setCard(0);
    return this.plan;
  }

  /** A page frame of `dt` seconds (the film's own clock while saving: always FILM.frame). */
  update(dt: number): void {
    if (this.phase === "idle") return;
    this.time += dt;
    this.count++;
    if (this.phase === "title") {
      this.t += dt;
      this.setCard(this.t);
      this.host.paint(this.overlay, false);
      if (this.t >= this.plan.title) this.next();
      return;
    }
    this.host.updateClip(dt);
  }

  /** Called right after the renderer drew a frame of a clip: paint the picture. */
  afterRender(): void {
    if (this.phase === "clip") this.host.paint(this.overlay, true);
  }

  /** End the whole film now (Esc, Skip): the live view comes back. */
  cancel(): void {
    if (this.phase === "idle") return;
    const was = this.phase;
    this.phase = "idle";
    if (was === "clip") this.host.cancelClip();
    this.finish(false);
  }

  private setCard(t: number) {
    const o = this.overlay;
    o.card = this.card;
    const fade = Math.min(1, Math.max(0, (this.plan.title - t) / Math.max(0.01, FILM.fadeOut * (this.plan.title / FILM.title))));
    const fadeIn = Math.min(1, t / 0.4);
    o.cardAlpha = Math.min(fade, fadeIn);
    o.cover = 0;
    o.bars = 0;
    o.caption = null;
    o.speed = null;
  }

  /** The title is over or a clip ended: the next clip, or the end. */
  private next() {
    const i = this.at;
    if (i >= this.clips.length) {
      this.phase = "idle";
      this.finish(true);
      return;
    }
    this.at = i + 1;
    this.phase = "clip";
    const o = this.overlay;
    o.card = null;
    o.cardAlpha = 0;
    o.cover = 1;
    const clip = this.clips[i];
    this.played.push(clip.moment.tick);
    this.host.playClip(clip, this.plan.budgets[i], () => this.clipEnded(clip));
  }

  private clipEnded(clip: Clip) {
    if (this.phase !== "clip" || this.clips[this.at - 1] !== clip) return;
    this.next();
  }

  private finish(completed: boolean) {
    Object.assign(this.overlay, emptyOverlay());
    this.host.show(false);
    this.host.done(completed);
  }
}

/**
 * The replay player's view while a film plays: bars, cover, caption and speed go into the film's overlay (drawn by `drawOverlay`,
 * on the page and in the recording) and not into the page's own bars; `show` always goes to the page's screen. With no film
 * playing everything passes through, so plain replays look as they did.
 */
export function filmView(film: Film, dom: ReplayView): ReplayView {
  const live = () => film.active;
  return {
    show: (on) => {
      // A film's own HUD cover is kept up by the film between clips (show(false) then show(true) in one call).
      dom.show(on);
    },
    bars: (a) => {
      if (live()) film.overlay.bars = a;
      else dom.bars(a);
    },
    cover: (a) => {
      if (live()) film.overlay.cover = a;
      else dom.cover(a);
    },
    caption: (n, t) => {
      if (live()) film.overlay.caption = { name: n, text: t };
      else dom.caption(n, t);
    },
    speed: (l) => {
      if (live()) film.overlay.speed = l;
      else dom.speed(l);
    },
  };
}

// ---- the recording -------------------------------------------------------------------------------

/** The type to record in: webm where the browser offers it, else mp4 (Safari); null when neither. */
export function pickFilmType(supported: (type: string) => boolean): { mime: string; ext: "webm" | "mp4" } | null {
  const tries: Array<[string, "webm" | "mp4"]> = [
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
    ["video/webm", "webm"],
    ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "mp4"],
    ["video/mp4", "mp4"],
  ];
  for (const [mime, ext] of tries) if (supported(mime)) return { mime, ext };
  return null;
}

/** `keepfall-film-2026-11-10-1432.webm`, named as the replay file is. */
export function filmFileName(ext: string, d = new Date()): string {
  return replayFileName(d).replace("-replay-", "-film-").replace(/\.json$/, `.${ext}`);
}

/** `keepfall-photo-2026-11-10-1432.png`. */
export function photoFileName(d = new Date()): string {
  return replayFileName(d).replace("-replay-", "-photo-").replace(/\.json$/, ".png");
}

export interface FilmAudio {
  stream: MediaStream;
  ctx: AudioContext;
}

/**
 * Records a composite canvas and the game's sound, frame by frame on the game's clock.
 *
 * `frame()` is called once per film frame, right after the composite was drawn: it runs the recorder for exactly one film
 * frame of wall time (1/25 s) around `requestFrame()`, then pauses the recorder and suspends the audio, so however long the
 * next frame takes to draw, the file gets only the one slot per frame. The slot lengths are balanced against a running total
 * so timer jitter does not add up.
 */
export class FilmRecorder {
  private rec: MediaRecorder;
  private track: CanvasCaptureMediaStreamTrack;
  private chunks: Blob[] = [];
  private running = 0;
  private framesDone = 0;
  private stopped: Promise<Blob>;
  private audioOn = false;
  readonly type: { mime: string; ext: "webm" | "mp4" };
  /** Wall time spent drawing between slots, for the report (ms). */
  drawMs = 0;
  private lastSlotEnd = 0;

  constructor(
    composite: HTMLCanvasElement,
    private audio: FilmAudio | null,
    private slotMs = FILM.frame * 1000,
  ) {
    const type = pickFilmType((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
    if (!type) throw new Error("This browser cannot record a film");
    this.type = type;
    const stream = composite.captureStream(0);
    this.track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    if (audio) for (const t of audio.stream.getAudioTracks()) stream.addTrack(t);
    this.rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 8_000_000 });
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    this.stopped = new Promise((resolve, reject) => {
      this.rec.onstop = () => resolve(new Blob(this.chunks, { type: type.mime.split(";")[0] }));
      this.rec.onerror = () => reject(new Error("The recorder failed"));
    });
    this.rec.start();
    this.rec.pause();
    if (audio) void audio.ctx.suspend();
    this.lastSlotEnd = performance.now();
  }

  /** Film frames recorded so far. */
  get frames(): number {
    return this.framesDone;
  }

  /** Record this frame (the composite is drawn) for one slot of wall time; resolves when the slot is over and the recorder paused again. */
  frame(): Promise<void> {
    this.pending = this.slot();
    return this.pending;
  }

  private pending: Promise<void> = Promise.resolve();

  /** The audio context's own clock (it stands still while suspended) when the first slot began. */
  private audioT0 = -1;

  private async slot(): Promise<void> {
    const audio = this.audio;
    if (audio && this.audioT0 < 0) {
      // The audio clock only counts while the context runs: find where it stands once it has been stopped.
      await audio.ctx.suspend().catch(() => {});
      this.audioT0 = audio.ctx.currentTime;
    }
    const start = performance.now();
    this.drawMs += start - this.lastSlotEnd;
    if (this.rec.state === "paused") this.rec.resume();
    if (audio && !this.audioOn) {
      this.audioOn = true;
      await audio.ctx.resume().catch(() => {});
    }
    this.track.requestFrame();
    this.framesDone++;
    // Run until the running total of wall time, and the audio clock, each reach this frame's share of the film's clock.
    // (Resuming and suspending the audio take a moment each, so its clock, not the timer, says when its slot is full.)
    const wall = this.framesDone * this.slotMs - this.running;
    // The recorder rounds each stretch of sound up to whole 20 ms Opus frames: aim a little under the slot so it never spills into one more.
    const audioTarget = (audio ? audio.ctx.currentTime : 0) + this.slotMs / 1000 - 0.008;
    for (;;) {
      const waited = performance.now() - start;
      if (waited >= wall && (!audio || audio.ctx.currentTime >= audioTarget)) break;
      await new Promise((r) => setTimeout(r, 2));
    }
    this.running += performance.now() - start;
    if (this.rec.state === "recording") this.rec.pause();
    if (audio && this.audioOn) {
      this.audioOn = false;
      await audio.ctx.suspend().catch(() => {});
    }
    this.lastSlotEnd = performance.now();
  }

  /** Stop and give the file. */
  async finish(): Promise<Blob> {
    await this.pending;
    // Let the last frame reach the encoder before the stop.
    if (this.rec.state === "paused") this.rec.resume();
    await new Promise((r) => setTimeout(r, 120));
    if (this.rec.state !== "inactive") this.rec.stop();
    const blob = await this.stopped;
    this.release();
    return blob;
  }

  /** Throw the recording away. */
  abort() {
    try {
      if (this.rec.state !== "inactive") this.rec.stop();
    } catch {}
    this.release();
  }

  /** Stop the video track, and let the game's sound run again (its audio track is the game's own, kept for the next film). */
  private release() {
    this.track.stop();
    if (this.audio) void this.audio.ctx.resume();
  }
}

// ---- photo mode ----------------------------------------------------------------------------------

export const PHOTO = {
  /** Metres a second; shift multiplies. */
  speed: 14,
  fast: 4,
  /** Radians per pixel of mouse movement. */
  sens: 0.0022,
  fov: { min: 12, max: 90, step: 1.08 },
  /** Clip ticks a step moves (a tenth of a second). */
  stepTicks: 6,
} as const;

export interface PhotoKeys {
  /** -1, 0, 1 each: left/right, back/forward, down/up. */
  x: number;
  z: number;
  y: number;
  fast: boolean;
}

/** The photo mode's free camera: a position, yaw and pitch (yaw 0 looks along +z), a field of view in degrees. */
export class PhotoCam {
  x = 0;
  y = 10;
  z = 0;
  yaw = 0;
  pitch = 0;
  fov = 50;

  /** Start from where a camera stands and looks (a unit forward vector). */
  static from(p: { x: number; y: number; z: number; fx: number; fy: number; fz: number }, fov: number): PhotoCam {
    const c = new PhotoCam();
    c.x = p.x;
    c.y = p.y;
    c.z = p.z;
    c.yaw = Math.atan2(p.fx, p.fz);
    c.pitch = Math.asin(Math.max(-1, Math.min(1, p.fy)));
    c.fov = Math.max(PHOTO.fov.min, Math.min(PHOTO.fov.max, fov));
    return c;
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * PHOTO.sens;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * PHOTO.sens));
  }

  move(dt: number, k: PhotoKeys) {
    const s = PHOTO.speed * (k.fast ? PHOTO.fast : 1) * dt;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // Right of forward (yaw 0 faces +z, so right is -x).
    const rx = -fz, rz = fx;
    this.x += (fx * k.z + rx * k.x) * s;
    this.z += (fz * k.z + rz * k.x) * s;
    this.y += k.y * s;
  }

  /** Wheel steps (positive: towards the user) narrow or widen the view. */
  zoom(wheel: number) {
    if (!wheel) return;
    const f = wheel > 0 ? PHOTO.fov.step : 1 / PHOTO.fov.step;
    this.fov = Math.max(PHOTO.fov.min, Math.min(PHOTO.fov.max, this.fov * f ** Math.abs(wheel)));
  }

  pose(): { mode: "free"; x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number; snap: true } {
    const c = Math.cos(this.pitch);
    return {
      mode: "free",
      x: this.x,
      y: this.y,
      z: this.z,
      tx: this.x + Math.sin(this.yaw) * c,
      ty: this.y + Math.sin(this.pitch),
      tz: this.z + Math.cos(this.yaw) * c,
      fov: this.fov,
      snap: true,
    };
  }
}

/** Where a step through a clip lands: ticks from `at` by `n` steps, kept inside the take. */
export function stepTick(at: number, n: number, start: number, end: number): number {
  return Math.max(start, Math.min(end, at + n * PHOTO.stepTicks));
}
