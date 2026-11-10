// What the impact cam's inset costs: the time a game frame takes with the inset
// open and closed, at Low and at High, in headless Chromium (software WebGL2, so
// only the relative numbers mean anything). The same long gun shot is fired
// with the impact cam on (K) and off, several times in turn, and the wall time
// of the frames from 10 to 50 after the shot (the inset is open for them when it
// is on) is averaged. The test clock (#fixed) makes every frame the same game
// time, so the frames compare. Usage: PORT=5182 W=640 H=360 REPS=2 node tools/impact-cost.mjs
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 5198;
const REPS = Number(process.env.REPS) || 2;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W) || 640, height: Number(process.env.H) || 360 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => page.evaluate(() => window.__sandbox.frames);
async function frames(n) {
  const start = await frame();
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 900000, polling: 50 });
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** Fire the long gun and time frames 10 to 50 after it (ms per frame, wall). */
async function run() {
  await frames(100); // reloads, and the last shot's smoke clears
  await page.evaluate(() => window.__sandbox.fire());
  await frames(10);
  const t0 = await page.evaluate(() => [performance.now(), window.__sandbox.frames]);
  await frames(40);
  const t1 = await page.evaluate(() => [performance.now(), window.__sandbox.frames, window.__sandbox.impact.shown]);
  return { ms: (t1[0] - t0[0]) / (t1[1] - t0[1]), shown: t1[2] };
}

try {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html#webgl-low-fixed`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await page.evaluate(() => {
    window.__sandbox.impactIgnorePacer(true);
    window.__sandbox.aimAtPoint(0, 0, 6, -16.4);
  });
  await frames(60);
  for (const tier of ["low", "high"]) {
    await page.evaluate((t) => {
      const q = document.getElementById("quality");
      q.value = t;
      q.dispatchEvent(new Event("change"));
    }, tier);
    await frames(60);
    const on = [], off = [];
    for (let k = 0; k < REPS; k++) {
      for (const open of [true, false]) {
        const enabled = await page.evaluate(() => window.__sandbox.impact.enabled);
        if (enabled !== open) await page.keyboard.press("KeyK");
        const r = await run();
        (open ? on : off).push(r.ms);
        console.log(`${tier} ${open ? "inset on " : "inset off"} ${r.ms.toFixed(0)} ms/frame (inset shown: ${r.shown})`);
      }
    }
    const a = median(on), b = median(off);
    console.log(`${tier}: median ${a.toFixed(0)} ms with the inset, ${b.toFixed(0)} ms without (${(((a - b) / b) * 100).toFixed(0)} %)`);
  }
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 10).join("\n  "));
  await browser.close();
  await server.close();
}
