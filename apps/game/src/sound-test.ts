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
