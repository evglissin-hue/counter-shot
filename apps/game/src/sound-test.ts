// Sound check (served at /sound-test.html, not part of the game): renders
// every sound into an offline buffer and reports, per sound, its peak, its
// loudness and whether it produced any invalid samples. Run headless by
// tools/sound-check.mjs, which fails on silence, clipping or NaN.

import { Sound } from "./sound";
import type { Listener } from "./render/api";

const RATE = 48000;
const ear: Listener = { x: 0, y: 12, z: -40, rx: -1, ry: 0, rz: 0, fx: 0, fy: 0, fz: 1 };

interface Case {
  name: string;
  seconds: number;
  /** Start the sound(s); `step` runs every 50 ms of render time until it returns false. */
  run(s: Sound, ctx: OfflineAudioContext): ((t: number) => boolean) | void;
}

const CASES: Case[] = [
  { name: "mortar launch (own gun)", seconds: 2, run: (s) => s.fire("mortar", 0, 0.9, -146.5, true) },
  { name: "long gun far away", seconds: 3, run: (s) => s.fire("longGun", 0, 9.7, -133.6) },
  { name: "chain shot", seconds: 3, run: (s) => s.fire("chainShot", -15, 13.8, -135, true) },
  { name: "swivel gun", seconds: 2, run: (s) => s.fire("swivel", 15, 13.8, -135, true) },
  { name: "burst at 40 m", seconds: 8, run: (s) => s.explosion(0, 4, -5, 4.6, 1) },
  { name: "burst at 150 m", seconds: 8, run: (s) => s.explosion(0, 4, 110, 4.6, 1) },
  { name: "burst in slow motion", seconds: 9, run: (s) => s.explosion(0, 4, -5, 4.6, 0.3) },
  { name: "stone hit", seconds: 2, run: (s) => s.impact(3, 5, -20, 0.8) },
  { name: "body hit", seconds: 1, run: (s) => s.thud(2, 1, -30, 0.7) },
  { name: "loaded clack", seconds: 1, run: (s) => s.ready("mortar") },
  // M3: gold, building, the trades at work, muskets and kegs.
  { name: "coins", seconds: 1.2, run: (s) => s.coin(12) },
  { name: "trick shot", seconds: 2.5, run: (s) => s.trick() },
  { name: "mallet on timber", seconds: 1, run: (s) => s.knock(-3, 1, -32) },
  { name: "building finished", seconds: 3.5, run: (s) => s.built(-3, 1, -32) },
  { name: "musket shot", seconds: 3, run: (s) => s.musket(5, 1.4, -30) },
  { name: "keg fuse", seconds: 5, run: (s) => s.fuse(2, 0.4, -34, 4) },
  { name: "anvil", seconds: 2.5, run: (s) => s.anvil(-6, 1, -30) },
  { name: "mill grinding", seconds: 3, run: (s) => s.millGrind(-6, 1, -30) },
  {
    name: "falling shell whistle",
    seconds: 4,
    run: (s) => {
      // A shell 2.4 s from the ground, falling past the camera.
      return (t: number) => {
        const left = 2.4 - t;
        if (left <= 0) {
          s.endUnseen();
          return false;
        }
        s.shell(1, 0, 20 + left * 30, -20 + t * 10, 0, -60, 10, left);
        s.endUnseen();
        return true;
      };
    },
  },
  {
    name: "chain whirr",
    seconds: 2,
    run: (s) => (t: number) => {
      if (t > 1.5) {
        s.endUnseen();
        return false;
      }
      s.chain(2, -15 + t * 2, 14, -60 + t * 80);
      s.endUnseen();
      return true;
    },
  },
  { name: "splash, grapeshot", seconds: 2, run: (s) => s.splash(0, -0.8, -60, 0.12) },
  { name: "splash, a stone", seconds: 3, run: (s) => s.splash(4, -0.8, -50, 1.0) },
  { name: "splash, shell burst", seconds: 3, run: (s) => s.splash(-3, -0.8, -45, 1.5) },
  { name: "timber hit", seconds: 2, run: (s) => s.woodHit(2, 0.5, -30, 0.8) },
  { name: "earth hit", seconds: 2, run: (s) => s.earthHit(-5, 0, -35, 0.85) },
  { name: "pike clash", seconds: 1, run: (s) => s.clash(1, 1.3, -32) },
  {
    name: "a rank marching",
    seconds: 3,
    run: (s) => {
      let n = 0;
      return () => {
        s.footstep(-2 + (n % 4), 0, -36 - (n % 3), 0.8);
        n++;
        return n < 40;
      };
    },
  },
  { name: "a shout", seconds: 2, run: (s) => s.shout(6, 1.4, -70, 1) },
  { name: "a crow", seconds: 3, run: (s) => s.crow(-60, 22, 20) },
  { name: "taking a gun", seconds: 1, run: (s) => s.ui("switch") },
  { name: "a button", seconds: 1, run: (s) => s.ui("click") },
  { name: "an order", seconds: 1, run: (s) => s.ui("order") },
  {
    name: "the stream and a fight",
    seconds: 4,
    run: (s) => {
      s.setBeds(1, 1, 0, 1, -70);
      return () => {
        s.update(ear, 0.05, { wind: 4, awake: 0, slow: 1 });
        return true;
      };
    },
  },
  {
    name: "the gun turning",
    seconds: 3,
    run: (s) => {
      return (t: number) => {
        s.traverse(t < 2 ? 1 : 0, 1, 0.05);
        return true;
      };
    },
  },
  { name: "reloading the long gun", seconds: 2, run: (s) => s.reloadWork("longGun") },
  { name: "reloading the mortar", seconds: 2, run: (s) => s.reloadWork("mortar") },
  { name: "reloading the chain shot", seconds: 2, run: (s) => s.reloadWork("chainShot") },
  {
    name: "collapse rumble and wind",
    seconds: 4,
    run: (s) => {
      s.rubble = { x: 0, y: 6, z: -10 };
      return (t: number) => {
        s.update(ear, 0.05, { wind: 8, awake: t < 3 ? 300 : 0, slow: 1 });
        return t < 3.9;
      };
    },
  },
  // M4: masons, ladders, storms and the end of a match.
  { name: "mason's mallet, close", seconds: 1, run: (s) => s.mallet(1, 11, -36, 3) },
  { name: "stone set (after the hoist)", seconds: 3, run: (s) => s.stoneSet(2, 9, -35, 0, 1.15) },
  { name: "keep floor board set", seconds: 2, run: (s) => s.stoneSet(2, 12, -35, 1, 0.2) },
  { name: "gate leaf hung", seconds: 3, run: (s) => s.stoneSet(0, 10, -34, 2, 0.2) },
  { name: "rubble carried off", seconds: 2, run: (s) => s.scrape(-3, 10, -36) },
  { name: "ladder against the wall", seconds: 2, run: (s) => s.ladderUp(4, 14, -32) },
  { name: "ladder knocked down", seconds: 3, run: (s) => s.ladderDown(4, 10, -32) },
  { name: "war horn (yours)", seconds: 4, run: (s) => s.horn(true) },
  { name: "war horn (the enemy's)", seconds: 5, run: (s) => s.horn(false) },
  { name: "alarm bell", seconds: 5, run: (s) => s.bell(330, 0.6) },
  {
    name: "storm drums and bell, building",
    seconds: 6,
    run: (s) => (t: number) => {
      s.setStorm(0, Math.min(1, t / 5));
      s.update(ear, 0.05, { wind: 3, awake: 0, slow: 1 });
      return t < 5.9;
    },
  },
  {
    name: "storm bell (the enemy's keep)",
    seconds: 6,
    run: (s) => {
      s.setKeeps({ x: 0, z: 4 }, { x: 0, z: -60 });
      return (t: number) => {
        s.setStorm(Math.min(1, t / 5), 0);
        s.update(ear, 0.05, { wind: 3, awake: 0, slow: 1 });
        return t < 5.9;
      };
    },
  },
  // M6: waves, marching, fighting, building, repairs and alarms.
  { name: "long gun at its own gun", seconds: 3, run: (s) => s.fire("longGun", 0, 9.7, -133.6, true) },
  { name: "wave sets out: drums", seconds: 3, run: (s) => s.drumFlourish(0, 3, -25) },
  { name: "fire for effect: drum roll", seconds: 3, run: (s) => s.salvoRoll(0, 3, -25) },
  { name: "wave sets out: enemy horn", seconds: 5, run: (s) => s.hornCall(0, 8, -150, 0.3) },
  {
    name: "marching drum",
    seconds: 3,
    run: (s) => {
      let n = 0;
      return () => {
        if (n % 10 === 0) s.marchDrum(6, 2, -15, (n / 10) % 2 === 0);
        n++;
        return true;
      };
    },
  },
  {
    name: "tramp of a column",
    seconds: 4,
    run: (s) => {
      s.setTramp(1, 0, 1, -25);
      return () => {
        s.update(ear, 0.05, { wind: 0, awake: 0, slow: 1 });
        return true;
      };
    },
  },
  { name: "a man's cry", seconds: 1.5, run: (s) => s.cry(3, 1.5, -20) },
  { name: "a body falls", seconds: 1.5, run: (s) => s.bodyFall(3, 0.3, -20) },
  { name: "chain swish", seconds: 1.5, run: (s) => s.swish(2, 1.5, -20) },
  { name: "gate blow", seconds: 3, run: (s) => s.gateBoom(0, 3, -10) },
  { name: "war cry of two lines", seconds: 3, run: (s) => s.warCry(0, 1.5, -10) },
  { name: "purchase", seconds: 2, run: (s) => s.purchase(7, 1.5, -22) },
  { name: "saw at a rising building", seconds: 2, run: (s) => s.saw(-7, 2, -20) },
  { name: "building wrecked", seconds: 3, run: (s) => s.crash(-7, 2, -25) },
  { name: "rope and pulley lift", seconds: 2, run: (s) => s.creak(2, 9, -25, 1.15) },
  { name: "alarm: gate battered", seconds: 3, run: (s) => s.alarm("gate") },
  { name: "alarm: ladder on the wall", seconds: 3, run: (s) => s.alarm("ladder") },
  { name: "alarm: keg at the wall", seconds: 2, run: (s) => s.alarm("keg") },
  { name: "sudden death tolls", seconds: 8, run: (s) => s.suddenDeath() },
  { name: "the end: a win", seconds: 7, run: (s) => s.matchEnd(true) },
  { name: "the end: a loss", seconds: 7, run: (s) => s.matchEnd(false) },
];

async function render(c: Case): Promise<{ peak: number; rms: number; bad: number; loudest: number }> {
  const ctx = new OfflineAudioContext(2, Math.ceil(RATE * c.seconds), RATE);
  const s = new Sound();
  s.setMuted(false);
  s.setVolume(0.8);
  s.unlock(ctx);
  s.update(ear, 0, { wind: 0, awake: 0, slow: 1 });
  const step = c.run(s, ctx);
  if (step) {
    let t = 0;
    const tick = (): void => {
      void ctx.suspend(t).then(() => {
        const more = step(t);
        t += 0.05;
        if (more && t < c.seconds - 0.05) tick();
        void ctx.resume();
      });
    };
    tick();
  }
  const buf = await ctx.startRendering();
  let peak = 0, sum = 0, bad = 0, loudest = 0;
  const win = Math.floor(RATE * 0.05);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    let w = 0;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) {
        bad++;
        continue;
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
      w += v * v;
      if ((i + 1) % win === 0) {
        loudest = Math.max(loudest, Math.sqrt(w / win));
        w = 0;
      }
    }
  }
  return { peak, rms: Math.sqrt(sum / (buf.length * buf.numberOfChannels)), bad, loudest };
}

const out = document.getElementById("out")!;
const results: Array<{ name: string; peak: number; rms: number; bad: number; loudest: number }> = [];
(async () => {
  const lines: string[] = [];
  for (const c of CASES) {
    try {
      const r = await render(c);
      results.push({ name: c.name, ...r });
      lines.push(`${c.name.padEnd(26)} peak ${r.peak.toFixed(3)}  loudest 50 ms ${r.loudest.toFixed(3)}  rms ${r.rms.toFixed(4)}  invalid ${r.bad}`);
    } catch (e) {
      results.push({ name: c.name, peak: -1, rms: -1, bad: -1, loudest: -1 });
      lines.push(`${c.name.padEnd(26)} FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
    out.textContent = lines.join("\n");
  }
  out.dataset.done = "1";
  (window as unknown as { __sound: unknown }).__sound = results;
})();
