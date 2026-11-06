// What does a mortar burst cost to draw? Rides a shell into the target keep
// in headless Chromium (software WebGL2, so absolute times mean little but
// before/after ratios do), freezes game time in a calm view and at the burst,
// and times identical frames. Usage: node tools/burst-cost.mjs [low|medium|high|ultra]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const tier = process.argv[2] ?? "ultra";
const root = fileURLToPath(new URL("../apps/sandbox", import.meta.url));
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: 5195, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.addInitScript((t) => {
  try {
    localStorage.setItem("keepfall.quality", t);
  } catch {}
}, tier);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function frames(n) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 900000, polling: 50 });
}
/** Wall time per frame with game time frozen (the same picture drawn again and again). */
async function cost(n = 5) {
  await page.evaluate(() => window.__sandbox.freeze(true));
  await sleep(300);
  const ms = await page.evaluate(
    (count) =>
      new Promise((res) => {
        const times = [];
        let last = performance.now();
        const f = () => {
          const now = performance.now();
          times.push(now - last);
          last = now;
          if (times.length > count) res(times.slice(1).sort((a, b) => a - b)[Math.floor(count / 2)]);
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
    n,
  );
  await page.evaluate(() => window.__sandbox.freeze(false));
  return ms;
}
try {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto("http://127.0.0.1:5195/index.html#webgl-fixed", { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await page.evaluate(() => window.__sandbox.select(1));
  await page.evaluate(() => window.__sandbox.aimAt(1, 0, 0.99));
  await frames(40);
  const calm = await cost();
  await page.evaluate(() => window.__sandbox.fire());
  await page.waitForFunction(() => window.__sandbox.ride && window.__sandbox.ride.boom, null, { timeout: 900000, polling: 50 });
  await frames(9);
  const burst = await cost();
  await frames(30);
  const later = await cost();
  console.log(`${tier}: calm ${calm.toFixed(0)} ms/frame, burst +0.3 s ${burst.toFixed(0)} ms (${(burst / calm).toFixed(2)}x), +1.3 s ${later.toFixed(0)} ms (${(later / calm).toFixed(2)}x)`);
} finally {
  await browser.close();
  await server.close();
}
