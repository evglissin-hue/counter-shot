// What does the gun in your hands cost to draw (look round L1)? On the Practice
// range's long gun sight in headless Chromium (software WebGL2, so absolute
// times mean little but before/after ratios do) it freezes game time and times
// identical frames, as tools/burst-cost.mjs does: calm, zoomed fully in (the
// gunner's glass), 0.1 s after firing (flash, smoke, recoil) and 1.5 s after.
// It uses only page hooks that exist on main, so it can time "before" too.
// Usage: PORT=5632 node tools/fire-cost.mjs [low|medium|high|ultra]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** The dev server's port (PORT in the environment overrides it, so several runs can share a machine). */
const PORT = Number(process.env.PORT) || 5631;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const tier = process.argv[2] ?? "high";
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.addInitScript((t) => {
  try {
    localStorage.setItem("keepfall.quality", t);
    localStorage.setItem("keepfall.qualityChosen", "1");
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
async function ready() {
  const start = await page.evaluate(() => window.__sandbox.frames);
  while ((await page.evaluate(() => window.__sandbox.frames)) < start + 600) {
    if (await page.evaluate(() => window.__sandbox.reload[0] === 0)) return true;
    await sleep(40);
  }
  return false;
}
try {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html#webgl-fixed`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await page.evaluate(() => {
    const S = window.__sandbox;
    S.select(0);
    S.setFov(0, 44);
    S.aimAtPoint(0, 0, 6, -16.4);
  });
  // The impact cam's inset would add a second pass to every frame: off (K), as the page says.
  if (await page.evaluate(() => !!window.__sandbox.impact && window.__sandbox.impact.enabled)) await page.keyboard.press("KeyK");
  await frames(40);
  const calm = await cost();
  // Zoomed fully in on the far castle: the gunner's glass (on main there is none, and the field of view alone changes).
  await page.evaluate(() => window.__sandbox.setFov(0, 14));
  await frames(40);
  const glass = await cost();
  await page.evaluate(() => window.__sandbox.setFov(0, 44));
  await frames(20);
  await ready();
  await page.evaluate(() => window.__sandbox.fire());
  await frames(3);
  const fresh = await cost();
  await frames(42);
  const later = await cost();
  const x = (v) => `${v.toFixed(0)} ms (${(v / calm).toFixed(2)}x)`;
  console.log(`${tier}: calm ${calm.toFixed(0)} ms/frame, zoomed in ${x(glass)}, fire +0.1 s ${x(fresh)}, +1.5 s ${x(later)}`);
} finally {
  await browser.close();
  await server.close();
}
