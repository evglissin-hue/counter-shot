// Contact sheets of the minions' animation, through the renderer test page
// (render-test.html?scene=anim: render-anim.ts moves the figures the way the
// army does), in headless Chromium on WebGL2. Each film places the camera,
// runs the scene clock to a moment, then renders a run of frames at a fixed
// step and tiles every few into one image: tools/.shots/anim-<name>.png.
// With --bench it also times the minions' update and step (no drawing) with
// a crowd of marching men: --bench=200 for 200 of them.
// Usage: PORT=6150 node tools/anim-shots.mjs [--quality=low|medium|high] [--bench=200] [films...]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split("=")[1];
const quality = opt("quality", "medium");
const tag = opt("tag", "");
const bench = Number(opt("bench", "0"));
const only = args.filter((a) => !a.startsWith("--"));
const port = Number(process.env.PORT) || 5299;

const F = 1 / 60;
/**
 * name: { eye, at, t (scene time to start), frames, every (sim frames per tile), sub (rendered frames per sim frame), crop (shares of the frame: x, y, w, h) }.
 */
const FILMS = {
  // One marching pikeman, the camera alongside him (track: eye and target are offsets from him): a little over one stride.
  gait: { track: 104, eye: [0.6, 1.0, -3.6], at: [0, 0.85, 0], fov: 38, t: 8, frames: 16, every: 3, crop: [0.2, 0.05, 0.6, 0.9] },
  // A man running (charging) alongside the column.
  run: { track: 120, eye: [0.6, 1.5, -3.4], at: [0, 0.85, 0], fov: 38, t: 8, frames: 16, every: 2, crop: [0.2, 0.05, 0.6, 0.9] },
  // The column marching across: a musketeer, a sapper with his keg, a crewman, a mason among the pikes.
  march: { eye: [3, 1.4, -49.5], at: [3, 0.9, -42], t: 19.5, frames: 16, every: 3, crop: [0.1, 0.1, 0.8, 0.8] },
  // A man turning a quarter at the sim's rate, with men at rest around him.
  turn: { eye: [-10.4, 1.8, -34.6], at: [-12.2, 0.95, -30.2], t: 4.5, frames: 16, every: 2, crop: [0.1, 0.05, 0.8, 0.9] },
  // Idle life: the same men over six seconds.
  idle: { eye: [-10.4, 1.8, -34.6], at: [-12.2, 0.95, -30.2], t: 20, frames: 12, every: 30, crop: [0.1, 0.05, 0.8, 0.9] },
  // Two pikemen fighting, side on: guard, wind-up, the thrust as each blow lands, the other's parry.
  fight: { eye: [-2.4, 1.45, -31.1], at: [-6, 1.05, -31.1], t: 1.9, frames: 24, every: 3, crop: [0.15, 0.1, 0.7, 0.8] },
  // An axe against a sapper's hatchet.
  chop: { eye: [-16.6, 1.45, -30.85], at: [-20, 1.05, -30.85], t: 1.4, frames: 16, every: 3, crop: [0.15, 0.1, 0.7, 0.8] },
  // A musket's jab at a pikeman.
  jab: { eye: [-27.4, 1.45, -31.1], at: [-24, 1.05, -31.1], t: 1.9, frames: 16, every: 3, crop: [0.15, 0.1, 0.7, 0.8] },
  gate: { eye: [4.0, 1.5, -18.6], at: [0, 1.1, -16.6], t: 3, frames: 16, every: 4, crop: [0.1, 0.05, 0.8, 0.9] },
  // A musketeer's whole cycle: the shot, the reload with the ramrod, up to aim again (300 ticks).
  musket: { eye: [-5.9, 1.45, -37.0], at: [-9.6, 1.1, -38.2], t: 2.9, frames: 16, every: 19, crop: [0.1, 0.05, 0.8, 0.9] },
  // A sapper at the wall: kneels, sets and lights his keg, runs.
  sapper: { eye: [-2.7, 1.9, -21.2], at: [-6.3, 0.7, -17.6], t: 4.2, frames: 24, every: 5, crop: [0.1, 0.05, 0.8, 0.9] },
  // Up the ladder, over the wall walk.
  climb: { eye: [11.2, 3.1, -21.6], at: [8.1, 3.2, -17.7], t: 3.6, frames: 16, every: 6, crop: [0.15, 0, 0.7, 1] },
  // Down the rope inside.
  rope: { eye: [12.0, 3.6, -7.0], at: [8.1, 3.6, -13.4], t: 8.0, frames: 16, every: 6, crop: [0.15, 0, 0.7, 1] },
  // A crew carrying a ladder, raising it, then fighting with axes.
  carry: { track: 250, eye: [4.6, 1.2, -2.2], at: [0, 1.0, -1.8], t: 4.5, frames: 24, every: 20, crop: [0.05, 0.05, 0.9, 0.9] },
  // A man knocked down while walking: from his last step into the fall; his pike drops.
  fall: { eye: [11.2, 1.4, -41.1], at: [11.0, 0.8, -36], t: 1.75, frames: 18, every: 3, crop: [0.1, 0.05, 0.8, 0.9] },
  masons: { eye: [-2.6, 1.6, -13.6], at: [-6.0, 1.15, -12.8], t: 1, frames: 16, every: 3, crop: [0.1, 0.05, 0.8, 0.9] },
  // The gait again at 120 Hz with 60 Hz sim frames (two drawn frames per sim frame), and the fall in quarter-speed slow motion.
  "gait-120": { track: 104, eye: [0.6, 1.0, -3.6], at: [0, 0.85, 0], fov: 38, t: 8, frames: 16, every: 3, sub: 2, crop: [0.2, 0.05, 0.6, 0.9] },
  "fall-slow": { eye: [11.2, 1.4, -41.1], at: [11.0, 0.8, -36], t: 1.95, frames: 18, every: 1, sub: 4, crop: [0.1, 0.05, 0.8, 0.9] },
};

const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

try {
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/render-test.html?scene=anim&quality=${quality}&shot=1&dt=${F}${bench ? `&crowd=${bench}` : ""}#webgl`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__test && window.__test.state.frames > 2 && window.__test.advance, null, { timeout: 600000, polling: 200 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(0)} s (${quality})`);
  if (bench) {
    for (const sub of [1, 2]) {
      const b = await page.evaluate((sub) => window.__test.bench(600, sub), sub);
      console.log(`bench ${b.figures} upright figures, ${sub} drawn frame(s) per sim frame: update ${b.update.toFixed(3)} ms, step ${b.step.toFixed(3)} ms per sim frame`);
    }
  }
  for (const [name, f] of Object.entries(FILMS)) {
    if (!only.length && bench) break;
    if (only.length && !only.includes(name)) continue;
    const t1 = Date.now();
    await page.evaluate((f) => {
      const T = window.__test;
      // A fixed camera (the page's free mode), so only the figures move from tile to tile.
      T.look(f.eye, f.at, f.fov ?? 40, f.track ?? -1);
      T.setTime(f.t - 0.6);
    }, f);
    // Warm up: settle the figures (they jumped to the new time) and the camera.
    await page.evaluate((F) => window.__test.advance(36, F), F);
    const W = 1280, H = 720;
    const clip = { x: f.crop[0] * W, y: f.crop[1] * H, width: f.crop[2] * W, height: f.crop[3] * H };
    const shots = [], labels = [];
    for (let i = 0; i < f.frames; i++) {
      const t = await page.evaluate(([n, F, sub]) => window.__test.advance(n, F, sub), [f.every, F, f.sub ?? 1]);
      shots.push(`data:image/png;base64,${(await page.screenshot({ clip, timeout: 300000 })).toString("base64")}`);
      labels.push(`${t.toFixed(2)} s`);
    }
    const cols = f.frames > 16 ? 6 : 4;
    const title = `${name}: every ${Math.round(f.every * F * 1000)} ms of sim time${f.sub > 1 ? `, ${f.sub} drawn frames per sim frame` : ""}`;
    const url = await page.evaluate(([shots, labels, cols, tile, title]) => window.__test.sheet(shots, labels, cols, tile, title), [shots, labels, cols, f.frames > 16 ? 320 : 400, title]);
    const file = `${out}anim-${name}${tag ? `-${tag}` : ""}.png`;
    writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
    console.log(`${file} (${((Date.now() - t1) / 1000).toFixed(0)} s)`);
  }
  await page.evaluate(() => (window.__test.manual = false));
} finally {
  if (errors.length) console.log("page errors:\n  " + [...new Set(errors)].slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
