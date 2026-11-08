// Procedural sound for the sandbox (Web Audio). Every sound is made here from
// noise and oscillators, then placed: it arrives late with distance (the speed
// of sound), loses its highs (air), gets quieter and sits left or right of the
// camera, with a valley reverb behind it. Cosmetic only: it reads what the sim
// reports and never feeds the simulation.
//
// Browsers start audio only after a click or key press, so nothing plays (and
// every call is a cheap no-op) until unlock() runs inside one.

import type { WeaponKind } from "@keepfall/content";
import type { Listener } from "./render/api";

const SPEED_OF_SOUND = 343;

interface Placed {
  delay: number;
  gain: number;
  pan: number;
  cutoff: number;
  dist: number;
}

/** A sound that lasts while its projectile flies: a falling shell's whistle, a chain shot's whirr. */
interface Voice {
  kind: "whistle" | "whirr";
  seen: boolean;
  level: GainNode;
  pan: StereoPannerNode;
  air: BiquadFilterNode;
  shape: GainNode;
  sources: AudioScheduledSourceNode[];
  tone: OscillatorNode[];
  /** Level of the whistle's tone against its air noise. */
  toneGain: GainNode | null;
  band: BiquadFilterNode | null;
}

export interface SoundState {
  /** Wind speed, m/s. */
  wind: number;
  /** Loose masonry moving right now. */
  awake: number;
  /** Slow motion (1 = real time). */
  slow: number;
}

export class Sound {
  volume = 0.8;
  muted = false;
  private ctx: BaseAudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private reverbIn!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private voices = new Map<number, Voice>();
  private ear: Listener = { x: 0, y: 10, z: -150, rx: -1, ry: 0, rz: 0, fx: 0, fy: 0, fz: 1 };
  private windGain: GainNode | null = null;
  private windBand: BiquadFilterNode | null = null;
  private rumbleGain: GainNode | null = null;
  private gust = 0;
  private gustTarget = 0;
  private clatterDebt = 0;
  /** Where loose masonry is moving (the centre of it), for the rumble and the clatter. */
  rubble = { x: 0, y: 4, z: 0 };
  private paused = false;

  constructor() {
    try {
      const v = localStorage.getItem("keepfall.volume");
      if (v !== null && !Number.isNaN(Number(v))) this.volume = Math.max(0, Math.min(1, Number(v)));
      this.muted = localStorage.getItem("keepfall.muted") === "1";
    } catch {}
  }

  /** Call from inside a click or key press: starts (or resumes) audio. Tests pass an offline context. */
  unlock(given?: BaseAudioContext) {
    if (this.ctx) {
      if (this.ctx.state === "suspended" && !this.paused && this.ctx instanceof AudioContext) void this.ctx.resume();
      return;
    }
    let ctx: BaseAudioContext;
    if (given) ctx = given;
    else {
      const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        ctx = new AC({ latencyHint: "interactive" });
      } catch {
        return;
      }
    }
    this.ctx = ctx;
    this.white = this.noiseBuffer(false);
    this.brown = this.noiseBuffer(true);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.28;
    this.master = ctx.createGain();
    this.master.gain.value = this.level();
    this.dry = ctx.createGain();
    this.reverbIn = ctx.createGain();
    const reverb = ctx.createConvolver();
    reverb.buffer = this.valleyReverb();
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    // A last, hard limiter so a pile of bursts never clips.
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.12;
    this.dry.connect(comp);
    this.reverbIn.connect(reverb);
    reverb.connect(wet);
    wet.connect(comp);
    comp.connect(this.master);
    this.master.connect(limit);
    limit.connect(ctx.destination);
    this.startAmbience();
    if (ctx.state === "suspended" && ctx instanceof AudioContext) void ctx.resume();
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyLevel();
    try {
      localStorage.setItem("keepfall.volume", String(this.volume));
    } catch {}
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyLevel();
    try {
      localStorage.setItem("keepfall.muted", m ? "1" : "0");
    } catch {}
  }

  /** The tab was hidden or shown. */
  setPaused(p: boolean) {
    this.paused = p;
    const ctx = this.ctx;
    if (!(ctx instanceof AudioContext)) return;
    if (p) void ctx.suspend();
    else void ctx.resume();
  }

  private level(): number {
    return this.muted ? 0 : this.volume * this.volume;
  }

  private applyLevel() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05);
  }

  // --- one-shot sounds ------------------------------------------------------------

  /** A weapon fires from its emplacement. The one you ride (`own`) is heard at the gun, wherever the camera is. */
  fire(kind: WeaponKind, x: number, y: number, z: number, own = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const at = (ref: number): Placed => (own ? { delay: 0, gain: 1 / (1 + 4 / ref), pan: 0, cutoff: 19000, dist: 4 } : this.place(x, y, z, ref));
    if (kind === "mortar") {
      // A deep, hollow thoomp: the charge in a short fat barrel.
      const c = this.out(at(40), 0.55, 4);
      this.tone(c.input, c.t0, 120, 42, 0.22, 0.003, 0.55, 1.1, 2.5);
      this.tone(c.input, c.t0, 190, 85, 0.16, 0.002, 0.3, 0.8);
      this.burstNoise(c.input, c.t0, this.brown, "lowpass", 800, 0.7, 0.002, 0.45, 1.1);
      this.burstNoise(c.input, c.t0, this.white, "bandpass", 260, 6, 0.004, 0.3, 0.7);
      this.burstNoise(c.input, c.t0, this.white, "highpass", 1500, 0.7, 0.001, 0.06, 0.3);
    } else if (kind === "swivel") {
      const c = this.out(at(30), 0.35, 3);
      this.burstNoise(c.input, c.t0, this.white, "highpass", 1200, 0.7, 0.001, 0.08, 0.7);
      this.burstNoise(c.input, c.t0, this.brown, "lowpass", 1800, 0.7, 0.002, 0.3, 0.5);
      this.tone(c.input, c.t0, 110, 60, 0.15, 0.002, 0.2, 0.4);
    } else {
      // Long gun and chain shot: a hard crack, a boom, a low push.
      const k = kind === "chainShot" ? 0.75 : 1;
      const c = this.out(at(45), 0.5, 4);
      this.burstNoise(c.input, c.t0, this.white, "highpass", 800, 0.7, 0.001, 0.1, 0.9 * k);
      this.sweptNoise(c.input, c.t0, this.brown, 900, 200, 0.6, 0.002, 0.9, 1.0 * k);
      this.tone(c.input, c.t0, 80, 35, 0.5, 0.002, 0.6, 0.8 * k, 2);
      this.tone(c.input, c.t0, 170, 90, 0.15, 0.002, 0.25, 0.5 * k);
    }
  }

  /** A powder burst of `radius` metres. In slow motion it is deeper and longer. */
  explosion(x: number, y: number, z: number, radius: number, slow: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = this.place(x, y, z, 60);
    const size = Math.max(0.5, Math.min(1.6, radius / 4.6));
    const st = slow < 0.95 ? 1 / Math.sqrt(Math.max(0.3, slow)) : 1; // stretch in time
    const f = 1 / st; // and down in pitch
    const c = this.out(p, 0.35 + 0.4 * Math.min(1, p.dist / 120));
    // The crack of the burst, the body of the blast, the push in the chest, the long roll.
    this.burstNoise(c.input, c.t0, this.white, "highpass", 450 * f, 0.7, 0.001, 0.14 * st, 0.9 * size);
    this.sweptNoise(c.input, c.t0, this.brown, 1500 * f, 150 * f, 0.9 * st, 0.004, 1.9 * st, 1.0 * size, f);
    this.tone(c.input, c.t0, 62 * f, 27 * f, 1.0 * st, 0.004, 1.5 * st, 1.0 * size, 3);
    this.tone(c.input, c.t0 + 0.012, 44 * f, 24 * f, 1.2 * st, 0.01, 1.7 * st, 0.6 * size, 3);
    this.tone(c.input, c.t0, 150 * f, 70 * f, 0.25 * st, 0.002, 0.45 * st, 0.9 * size);
    this.burstNoise(c.input, c.t0, this.brown, "lowpass", 120 * f, 0.7, 0.08, 3.6 * st, 0.55 * size, f);
    // Stones and chips coming down after it.
    const grains = Math.round(34 * size);
    for (let i = 0; i < grains; i++) {
      const u = Math.random();
      const at = c.t0 + (0.25 + 3.0 * u * u) * st;
      const peak = (0.05 + 0.16 * Math.random()) * (1 - 0.6 * u) * size;
      this.burstNoise(c.input, at, this.white, "bandpass", (700 + 2400 * Math.random()) * f, 1.6, 0.001, (0.006 + 0.03 * Math.random()) * st, peak);
    }
  }

  /** A ball strikes stone (strength 0..1). */
  impact(x: number, y: number, z: number, strength: number) {
    if (!this.ctx) return;
    const s = Math.max(0.15, Math.min(1, strength));
    const c = this.out(this.place(x, y, z, 25), 0.3, 1.5);
    this.burstNoise(c.input, c.t0, this.white, "bandpass", 900, 0.9, 0.001, 0.18, 0.6 * s);
    this.tone(c.input, c.t0, 140, 70, 0.1, 0.001, 0.14, 0.5 * s);
    const n = 3 + Math.round(5 * s);
    for (let i = 0; i < n; i++) {
      const at = c.t0 + 0.05 + 0.6 * Math.random() * Math.random();
      this.burstNoise(c.input, at, this.white, "bandpass", 1200 + 2000 * Math.random(), 1.8, 0.001, 0.008 + 0.015 * Math.random(), (0.04 + 0.1 * Math.random()) * s);
    }
  }

  /** A body is hit (strength 0..1). */
  thud(x: number, y: number, z: number, strength: number) {
    if (!this.ctx) return;
    const s = Math.max(0.2, Math.min(1, strength));
    const c = this.out(this.place(x, y, z, 15), 0.15, 1);
    this.burstNoise(c.input, c.t0, this.brown, "lowpass", 500, 0.7, 0.002, 0.14, 0.5 * s);
    this.tone(c.input, c.t0, 95, 60, 0.1, 0.002, 0.12, 0.35 * s);
  }

  /** The current weapon is loaded again: a dry mechanical clack, not placed. */
  ready(kind: WeaponKind) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.01;
    const g = ctx.createGain();
    g.gain.value = kind === "mortar" ? 0.22 : 0.15;
    g.connect(this.dry);
    this.burstNoise(g, t0, this.white, "bandpass", 2600, 3, 0.001, 0.04, 0.8);
    this.burstNoise(g, t0 + 0.07, this.white, "bandpass", 1800, 3, 0.001, 0.05, 0.6);
    this.tone(g, t0 + 0.07, 220, 160, 0.05, 0.001, 0.06, 0.4);
    this.later(g, t0 + 0.3);
  }

  // --- the siege (M4): masons, ladders, horns, bells and drums ------------------------

  /** A mason's mallet on a chisel against stone: a wooden knock and a short ring of iron. `id` varies the pitch a little. */
  mallet(x: number, y: number, z: number, id: number) {
    if (!this.ctx) return;
    const c = this.out(this.place(x, y, z, 12), 0.25, 1);
    const k = 1 + (((id * 7919) % 13) - 6) * 0.018;
    this.burstNoise(c.input, c.t0, this.white, "bandpass", 950 * k, 2.2, 0.001, 0.05, 0.6);
    this.tone(c.input, c.t0, 430 * k, 360 * k, 0.04, 0.001, 0.06, 0.4);
    this.tone(c.input, c.t0 + 0.004, 2960 * k, 2940 * k, 0.1, 0.001, 0.13, 0.13);
    this.tone(c.input, c.t0 + 0.004, 4410 * k, 4390 * k, 0.1, 0.001, 0.08, 0.07);
  }

  /** A piece put back beds into its place `after` seconds from now: 0 a stone, 1 a timber floor board, 2 a gate leaf on its hinges. */
  stoneSet(x: number, y: number, z: number, kind: number, after = 0) {
    if (!this.ctx) return;
    const p = this.place(x, y, z, 22);
    p.delay += after;
    const c = this.out(p, 0.3, 2.5);
    if (kind === 2) {
      // A heavy leaf swung home: a deep wooden boom, then the iron of its hinges and bands settling.
      this.tone(c.input, c.t0, 74, 41, 0.35, 0.004, 0.7, 0.75, 2);
      this.burstNoise(c.input, c.t0, this.brown, "lowpass", 380, 0.7, 0.003, 0.45, 0.6);
      this.burstNoise(c.input, c.t0, this.white, "bandpass", 640, 1.4, 0.001, 0.09, 0.3);
      for (let i = 0; i < 6; i++) {
        const at = c.t0 + 0.08 + 0.5 * Math.random();
        this.tone(c.input, at, 2100 + 1700 * Math.random(), 1900, 0.05, 0.001, 0.07, 0.04 + 0.04 * Math.random());
      }
      return;
    }
    if (kind === 1) {
      this.tone(c.input, c.t0, 150, 96, 0.12, 0.002, 0.2, 0.26, 1.5);
      this.burstNoise(c.input, c.t0, this.white, "bandpass", 520, 1.3, 0.001, 0.1, 0.2);
      return;
    }
    // Stone on its bed of mortar: a dull thump, the grit of it, a small clack of the edges (quiet: masons set a few a second).
    this.tone(c.input, c.t0, 96, 58, 0.16, 0.002, 0.24, 0.2, 1.5);
    this.burstNoise(c.input, c.t0, this.brown, "lowpass", 900, 0.7, 0.002, 0.16, 0.16);
    this.burstNoise(c.input, c.t0 + 0.01, this.white, "bandpass", 1900, 2, 0.001, 0.025, 0.08);
    this.sweptNoise(c.input, c.t0 + 0.03, this.white, 2400, 700, 0.25, 0.01, 0.22, 0.03);
  }

  /** Rubble dragged out of a gap: a short scrape. */
  scrape(x: number, y: number, z: number) {
    if (!this.ctx) return;
    const c = this.out(this.place(x, y, z, 14), 0.2, 1.5);
    this.sweptNoise(c.input, c.t0, this.white, 1400, 320, 0.45, 0.04, 0.5, 0.26);
    this.burstNoise(c.input, c.t0 + 0.32, this.brown, "lowpass", 500, 0.7, 0.002, 0.12, 0.34);
  }

  /** A ladder's top swings against the wall: a wooden clack and rattle. */
  ladderUp(x: number, y: number, z: number) {
    if (!this.ctx) return;
    const c = this.out(this.place(x, y, z, 22), 0.35, 2);
    this.burstNoise(c.input, c.t0, this.white, "bandpass", 720, 1.6, 0.001, 0.12, 0.5);
    this.tone(c.input, c.t0, 170, 112, 0.08, 0.001, 0.12, 0.34);
    for (let i = 0; i < 3; i++) this.burstNoise(c.input, c.t0 + 0.05 + i * (0.035 + 0.02 * Math.random()), this.white, "bandpass", 1300 + 600 * Math.random(), 2.4, 0.001, 0.02, 0.14);
  }

  /** A ladder knocked off a wall: it goes over, then clatters down on the ground. */
  ladderDown(x: number, y: number, z: number) {
    if (!this.ctx) return;
    const c = this.out(this.place(x, y, z, 24), 0.35, 3);
    // The creak as it goes, then the crash about a second later.
    this.sweptNoise(c.input, c.t0, this.white, 900, 500, 0.6, 0.15, 0.55, 0.05);
    const hit = c.t0 + 0.9;
    this.tone(c.input, hit, 120, 70, 0.12, 0.002, 0.2, 0.5, 1.5);
    for (let i = 0; i < 7; i++) {
      const at = hit + 0.02 + 0.35 * Math.random() * Math.random();
      this.burstNoise(c.input, at, this.white, "bandpass", 380 + 700 * Math.random(), 1.4, 0.001, 0.05 + 0.05 * Math.random(), 0.22 + 0.18 * Math.random());
    }
  }

  /**
   * A war horn when a storm begins: your men's, one long low note that
   * swells and falls away; the enemy's at your walls, two horns a little
   * apart, beating against each other. Not placed (it carries over the whole
   * valley), with a long tail in the valley's echo.
   */
  horn(ours: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.05;
    const notes = ours ? [110] : [98, 103.6];
    for (const f of notes) this.hornNote(t0, f, ours ? 2.6 : 3.0, ours ? 0.16 : 0.13);
    if (!ours) this.hornNote(t0 + 0.6, 73.4, 2.4, 0.08);
  }

  private hornNote(t0: number, f: number, length: number, peak: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.35);
    g.gain.setValueAtTime(peak, t0 + length * 0.55);
    g.gain.linearRampToValueAtTime(peak * 0.7, t0 + length * 0.8);
    g.gain.linearRampToValueAtTime(0, t0 + length);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(380, t0);
    lp.frequency.linearRampToValueAtTime(1150, t0 + 0.4);
    lp.frequency.linearRampToValueAtTime(700, t0 + length);
    const send = ctx.createGain();
    send.gain.value = 0.8;
    lp.connect(g);
    g.connect(this.dry);
    g.connect(send);
    send.connect(this.reverbIn);
    // The note leans up into pitch as the player's lips set, and sags at the end.
    for (const [mult, level] of [[1, 1], [0.5, 0.45], [2.005, 0.18]] as const) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f * mult * 0.94, t0);
      o.frequency.exponentialRampToValueAtTime(f * mult, t0 + 0.25);
      o.frequency.setValueAtTime(f * mult, t0 + length * 0.75);
      o.frequency.exponentialRampToValueAtTime(f * mult * 0.97, t0 + length);
      const vib = ctx.createOscillator();
      vib.frequency.value = 4.6 + Math.random() * 0.8;
      const depth = ctx.createGain();
      depth.gain.value = f * mult * 0.004;
      vib.connect(depth);
      depth.connect(o.frequency);
      const lg = ctx.createGain();
      lg.gain.value = level;
      o.connect(lg);
      lg.connect(lp);
      o.start(t0);
      vib.start(t0);
      o.stop(t0 + length + 0.05);
      vib.stop(t0 + length + 0.05);
    }
    this.later(g, t0 + length + 3);
  }

  /** One stroke of a bell: the partials of a struck bell, the hum longest. Placed if a position is given, else heard close. */
  bell(f: number, level: number, at = 0, x?: number, y?: number, z?: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const p: Placed = x === undefined ? { delay: 0, gain: 1, pan: 0, cutoff: 14000, dist: 10 } : this.place(x, y!, z!, 60);
    p.delay += at;
    const c = this.out(p, 0.7, 7);
    for (const [r, l, d] of [[0.5, 0.5, 4.2], [1, 0.55, 3.2], [1.19, 0.32, 2.2], [1.5, 0.22, 1.8], [2, 0.3, 1.5], [2.52, 0.12, 1.0], [2.66, 0.1, 0.8]] as const) {
      this.tone(c.input, c.t0, f * r, f * r * 0.999, d, 0.002, d, l * level);
    }
    this.burstNoise(c.input, c.t0, this.white, "bandpass", f * 4, 2, 0.001, 0.04, 0.25 * level);
  }

  /** A war drum: a deep skin struck hard. */
  private drum(at: number, level: number, low = false) {
    if (!this.ctx) return;
    const c = this.out({ delay: at, gain: 1, pan: (Math.random() - 0.5) * 0.3, cutoff: 9000, dist: 20 }, 0.45, 2);
    const f = low ? 58 : 82;
    this.tone(c.input, c.t0, f * 1.5, f, 0.12, 0.002, 0.42, 0.7 * level, 2.5);
    this.burstNoise(c.input, c.t0, this.brown, "lowpass", 340, 0.7, 0.002, 0.12, 0.55 * level);
  }

  /** How far each storm has gone (0..1): yours on the enemy courtyard, the enemy's on yours. Drums build under both; your bell rings while yours is stormed. */
  setStorm(ours: number, theirs: number) {
    this.storming = [ours, theirs];
  }
  private storming: [number, number] = [0, 0];
  private nextDrum = 0;
  private drumBeat = 0;
  private nextBell = 0;

  /** Sudden death: three slow tolls of a deep bell over a drum roll. */
  suddenDeath() {
    const ctx = this.ctx;
    if (!ctx) return;
    for (let i = 0; i < 3; i++) this.bell(147, 0.5, 0.2 + i * 2.3);
    for (let i = 0; i < 26; i++) {
      const u = i / 25;
      this.drum(0.1 + 3.2 * u - 0.9 * u * u, 0.25 + 0.4 * u, i % 4 === 0);
    }
  }

  /** The end of a match by the keep or a storm: drums and a low horn for a win, a single deep bell for a loss. */
  matchEnd(won: boolean) {
    if (!this.ctx) return;
    if (won) {
      for (let i = 0; i < 3; i++) this.drum(0.2 + i * 0.55, 0.8, i === 2);
      this.hornNote(this.ctx.currentTime + 1.7, 82.4, 3.4, 0.14);
      this.hornNote(this.ctx.currentTime + 1.75, 123.5, 3.2, 0.08);
    } else {
      this.bell(98, 0.75, 0.3);
      this.hornNote(this.ctx.currentTime + 1.2, 73.4, 3.6, 0.1);
    }
  }

  /** The storm's drums and the stormed castle's bell (called every frame from update). */
  private stormBeat(now: number) {
    const [ours, theirs] = this.storming;
    const k = Math.max(ours, theirs);
    if (k <= 0) {
      this.drumBeat = 0;
      return;
    }
    // Drums: faster and louder as the storm nears its end.
    if (now >= this.nextDrum - 0.05) {
      const beat = 0.62 - 0.3 * k;
      const at = Math.max(0, this.nextDrum - now);
      this.drum(at, 0.3 + 0.5 * k, this.drumBeat % 4 === 0);
      if (k > 0.5 && this.drumBeat % 2 === 1) this.drum(at + beat / 2, 0.18 + 0.3 * k);
      this.drumBeat++;
      this.nextDrum = Math.max(now, this.nextDrum) + beat;
    }
    // Your courtyard stormed: its alarm bell, ever quicker.
    if (theirs > 0 && now >= this.nextBell) {
      this.bell(330, 0.32 + 0.25 * theirs);
      this.nextBell = now + 2.2 - 1.4 * theirs;
    } else if (ours > 0 && theirs <= 0 && now >= this.nextBell) {
      // The enemy's bell, across the valley.
      this.bell(311, 0.45 + 0.3 * ours, 0, 0, 22, 4);
      this.nextBell = now + 2.4 - 1.4 * ours;
    }
  }

  // --- projectile voices ------------------------------------------------------------

  /**
   * A mortar shell in flight; `tImpact` is seconds until it comes down. Air
   * rushes past it all the way; coming down it whistles, falling in pitch and
   * growing louder as it nears the ground.
   */
  shell(id: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, tImpact: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const WINDOW = 2.4;
    let v = this.voices.get(id);
    if (!v) {
      v = this.makeWhistle();
      this.voices.set(id, v);
    }
    v.seen = true;
    const now = ctx.currentTime;
    const p = this.place(x, y, z, 35);
    const falling = vy < 0 && tImpact <= WINDOW;
    const u = falling ? Math.max(0, Math.min(1, tImpact / WINDOW)) : 1; // 1 until the fall, 0 at impact
    const freq = 560 + 1150 * u;
    for (const o of v.tone) o.frequency.setTargetAtTime(freq * (o === v.tone[1] ? 1.006 : 1), now, 0.04);
    const speed = Math.hypot(vx, vy, vz);
    v.band?.frequency.setTargetAtTime(falling ? freq * 1.4 : 500 + speed * 6, now, 0.06);
    v.toneGain?.gain.setTargetAtTime(falling ? 0.5 * Math.pow(1 - u, 0.6) + 0.04 : 0, now, 0.05);
    v.shape.gain.setTargetAtTime(falling ? 0.34 * Math.pow(1 - u, 0.6) + 0.06 : 0.05 + Math.min(0.08, speed / 1000), now, 0.06);
    this.moveVoice(v, p, now);
  }

  /** A chain-shot pair in flight: a whirring whoosh. */
  chain(id: number, x: number, y: number, z: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    let v = this.voices.get(id);
    if (!v) {
      v = this.makeWhirr();
      this.voices.set(id, v);
    }
    v.seen = true;
    this.moveVoice(v, this.place(x, y, z, 20), ctx.currentTime);
  }

  /** Call after the voices of a frame: projectiles that were not seen have landed or burst. */
  endUnseen() {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const [id, v] of this.voices) {
      if (v.seen) {
        v.seen = false;
        continue;
      }
      const now = ctx.currentTime;
      v.level.gain.cancelScheduledValues(now);
      v.level.gain.setTargetAtTime(0, now, 0.03);
      for (const s of v.sources) s.stop(now + 0.25);
      this.later(v.level, now + 0.3);
      this.voices.delete(id);
    }
  }

  // --- per frame ----------------------------------------------------------------------

  update(ear: Listener, dt: number, s: SoundState) {
    this.ear = ear;
    const ctx = this.ctx;
    if (!ctx || this.paused) return;
    const now = ctx.currentTime;
    // Wind: a soft bandpassed rush that gusts.
    if (Math.random() < dt * 0.6) this.gustTarget = Math.random();
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 0.8);
    if (this.windGain && this.windBand) {
      const g = (0.025 + 0.006 * s.wind) * (0.6 + 0.8 * this.gust);
      this.windGain.gain.setTargetAtTime(g, now, 0.3);
      this.windBand.frequency.setTargetAtTime(380 + 260 * this.gust + 20 * s.wind, now, 0.4);
    }
    // Loose masonry: a low rumble while it moves, and the clatter of stones landing.
    const r = this.rubble;
    const p = this.place(r.x, r.y, r.z, 40);
    if (this.rumbleGain) {
      const g = Math.min(0.55, Math.sqrt(s.awake) / 38) * p.gain;
      this.rumbleGain.gain.setTargetAtTime(g, now, 0.25);
    }
    this.clatterDebt += Math.min(28, s.awake / 18) * dt * Math.min(1, s.slow + 0.2);
    let n = 0;
    while (this.clatterDebt >= 1 && n < 4) {
      this.clatterDebt -= 1;
      n++;
      const jx = (Math.random() - 0.5) * 14, jz = (Math.random() - 0.5) * 14;
      const c = this.out(this.place(r.x + jx, Math.max(0.5, r.y - 2), r.z + jz, 28), 0.25, 0.6);
      const big = Math.random() < 0.25;
      this.burstNoise(c.input, c.t0, this.white, "bandpass", big ? 500 + 500 * Math.random() : 1200 + 2200 * Math.random(), big ? 1.1 : 1.8, 0.001, big ? 0.06 : 0.012 + 0.02 * Math.random(), big ? 0.32 : 0.06 + 0.12 * Math.random());
      if (big) this.tone(c.input, c.t0, 120 + 60 * Math.random(), 70, 0.08, 0.001, 0.1, 0.25);
    }
    if (this.clatterDebt > 4) this.clatterDebt = 4;
    this.stormBeat(now);
  }

  // --- building blocks ---------------------------------------------------------------

  /** Distance, side and air for a point, relative to the camera. `ref` is the distance at which it is half as loud. */
  private place(x: number, y: number, z: number, ref: number): Placed {
    const l = this.ear;
    const dx = x - l.x, dy = y - l.y, dz = z - l.z;
    const dist = Math.hypot(dx, dy, dz);
    const side = dist > 0.01 ? (dx * l.rx + dy * l.ry + dz * l.rz) / dist : 0;
    return {
      delay: dist / SPEED_OF_SOUND,
      gain: 1 / (1 + dist / ref),
      pan: Math.max(-1, Math.min(1, side)) * 0.8,
      cutoff: 320 + 19000 * Math.exp(-dist / 70),
      dist,
    };
  }

  /** The path every placed sound takes: air, level, side, then dry and into the reverb. */
  private out(p: Placed, wet: number, length = 9): { input: AudioNode; t0: number } {
    const ctx = this.ctx!;
    const air = ctx.createBiquadFilter();
    air.type = "lowpass";
    air.frequency.value = p.cutoff;
    air.Q.value = 0.5;
    const level = ctx.createGain();
    level.gain.value = p.gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = p.pan;
    const send = ctx.createGain();
    send.gain.value = wet;
    air.connect(level);
    level.connect(pan);
    pan.connect(this.dry);
    pan.connect(send);
    send.connect(this.reverbIn);
    const t0 = ctx.currentTime + 0.01 + p.delay;
    this.later(air, t0 + length);
    return { input: air, t0 };
  }

  /** Noise through one filter with an attack and an exponential decay. */
  private burstNoise(to: AudioNode, t0: number, buf: AudioBuffer, type: BiquadFilterType, freq: number, q: number, attack: number, decay: number, peak: number, rate = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = Math.max(20, Math.min(18000, freq));
    filt.Q.value = q;
    const g = ctx.createGain();
    this.envelope(g, t0, attack, decay, peak);
    src.connect(filt);
    filt.connect(g);
    g.connect(to);
    src.start(t0, Math.random() * (buf.duration - 0.5));
    src.stop(t0 + attack + decay + 0.05);
  }

  /** Noise through a lowpass that sweeps down from f0 to f1 over `sweep` seconds. */
  private sweptNoise(to: AudioNode, t0: number, buf: AudioBuffer, f0: number, f1: number, sweep: number, attack: number, decay: number, peak: number, rate = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = 0.8;
    filt.frequency.setValueAtTime(f0, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + sweep);
    const g = ctx.createGain();
    this.envelope(g, t0, attack, decay, peak);
    src.connect(filt);
    filt.connect(g);
    g.connect(to);
    src.start(t0, Math.random() * (buf.duration - 0.5));
    src.stop(t0 + attack + decay + 0.05);
  }

  /**
   * A sine whose pitch falls from f0 to f1 over `sweep` seconds. `drive`
   * saturates it: the added harmonics let a laptop speaker suggest a bass
   * note it cannot play.
   */
  private tone(to: AudioNode, t0: number, f0: number, f1: number, sweep: number, attack: number, decay: number, peak: number, drive = 0) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t0 + sweep);
    const g = ctx.createGain();
    this.envelope(g, t0, attack, decay, peak);
    if (drive > 0) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.saturation(drive);
      osc.connect(shaper);
      shaper.connect(g);
    } else osc.connect(g);
    g.connect(to);
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.05);
  }

  private curves = new Map<number, Float32Array<ArrayBuffer>>();
  private saturation(drive: number): Float32Array<ArrayBuffer> {
    let c = this.curves.get(drive);
    if (!c) {
      c = new Float32Array(1024);
      const k = Math.tanh(drive);
      for (let i = 0; i < c.length; i++) {
        const x = (i / (c.length - 1)) * 2 - 1;
        c[i] = Math.tanh(drive * x) / k;
      }
      this.curves.set(drive, c);
    }
    return c;
  }

  private envelope(g: GainNode, t0: number, attack: number, decay: number, peak: number) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.setTargetAtTime(0, t0 + attack, decay / 4.5);
  }

  /** Disconnect a node once its sound is over, so finished graphs can be collected. */
  private later(node: AudioNode, at: number) {
    const ctx = this.ctx!;
    const ms = Math.max(0, (at - ctx.currentTime) * 1000) + 100;
    setTimeout(() => {
      try {
        node.disconnect();
      } catch {}
    }, ms);
  }

  private makeVoice(kind: Voice["kind"], wet: number): Voice {
    const ctx = this.ctx!;
    const air = ctx.createBiquadFilter();
    air.type = "lowpass";
    air.Q.value = 0.5;
    air.frequency.value = 8000;
    const shape = ctx.createGain();
    shape.gain.value = 0;
    const level = ctx.createGain();
    level.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const send = ctx.createGain();
    send.gain.value = wet;
    shape.connect(air);
    air.connect(level);
    level.connect(pan);
    pan.connect(this.dry);
    pan.connect(send);
    send.connect(this.reverbIn);
    return { kind, seen: true, level, pan, air, shape, sources: [], tone: [], toneGain: null, band: null };
  }

  private makeWhistle(): Voice {
    const ctx = this.ctx!;
    const v = this.makeVoice("whistle", 0.3);
    const t0 = ctx.currentTime;
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0;
    toneGain.connect(v.shape);
    v.toneGain = toneGain;
    for (const detune of [1, 1.006]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 1700 * detune;
      o.connect(toneGain);
      o.start(t0);
      v.tone.push(o);
      v.sources.push(o);
    }
    // Air tearing past the shell.
    const n = ctx.createBufferSource();
    n.buffer = this.white;
    n.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2400;
    band.Q.value = 3;
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    n.connect(band);
    band.connect(ng);
    ng.connect(v.shape);
    n.start(t0, Math.random());
    v.band = band;
    v.sources.push(n);
    return v;
  }

  private makeWhirr(): Voice {
    const ctx = this.ctx!;
    const v = this.makeVoice("whirr", 0.2);
    const t0 = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.brown;
    n.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 340;
    band.Q.value = 1.4;
    // The pair turns about four and a half times a second: the whoosh pulses with it.
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.5;
    const depth = ctx.createGain();
    depth.gain.value = 0.45;
    lfo.connect(depth);
    depth.connect(am.gain);
    n.connect(band);
    band.connect(am);
    am.connect(v.shape);
    v.shape.gain.value = 0.9;
    n.start(t0, Math.random());
    lfo.start(t0);
    v.sources.push(n, lfo);
    return v;
  }

  private moveVoice(v: Voice, p: Placed, now: number) {
    v.level.gain.setTargetAtTime(p.gain, now, 0.05);
    v.pan.pan.setTargetAtTime(p.pan, now, 0.05);
    v.air.frequency.setTargetAtTime(p.cutoff, now, 0.08);
  }

  private startAmbience() {
    const ctx = this.ctx!;
    // Wind over the valley.
    const w = ctx.createBufferSource();
    w.buffer = this.brown;
    w.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 450;
    band.Q.value = 0.45;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    w.connect(band);
    band.connect(wg);
    wg.connect(this.dry);
    w.start();
    this.windGain = wg;
    this.windBand = band;
    // The rumble of moving masonry.
    const r = ctx.createBufferSource();
    r.buffer = this.brown;
    r.loop = true;
    r.playbackRate.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 170;
    const rg = ctx.createGain();
    rg.gain.value = 0;
    r.connect(lp);
    lp.connect(rg);
    rg.connect(this.dry);
    const rs = ctx.createGain();
    rs.gain.value = 0.3;
    rg.connect(rs);
    rs.connect(this.reverbIn);
    r.start(0, 0.7);
    this.rumbleGain = rg;
  }

  private noiseBuffer(brown: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 3);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0, peak = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last;
      } else d[i] = w;
      peak = Math.max(peak, Math.abs(d[i]));
    }
    const k = 0.95 / (peak || 1);
    for (let i = 0; i < len; i++) d[i] *= k;
    return buf;
  }

  /** A valley's echo: a few early reflections off the castles, then a dark tail that dies over three seconds. */
  private valleyReverb(): AudioBuffer {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * 3.2);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        // The tail darkens as it ages: a one-pole lowpass that closes over time.
        const a = Math.min(0.97, 0.25 + t * 0.4);
        lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
        d[i] = lp * Math.exp(-t / 0.75) * (1 - Math.exp(-t / 0.02)) * 2.2;
      }
      for (const [at, g] of [[0.11, 0.5], [0.23, 0.35], [0.41, 0.28], [0.62, 0.18]] as const) {
        const i0 = Math.floor((at + (ch ? 0.013 : 0)) * rate);
        for (let k = 0; k < 400 && i0 + k < len; k++) d[i0 + k] += (Math.random() * 2 - 1) * g * Math.exp(-k / 90);
      }
    }
    return buf;
  }
}
