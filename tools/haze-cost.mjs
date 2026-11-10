// What do the L2/L3 ground marks and the haze cost to draw? Software WebGL2 in
// headless Chromium, so absolute times mean little but ratios do. Freezes game
// time and times identical frames looking at the enemy's front wall: with no
// haze, then with 1 and with 3 hazes (staged, aged 12 s) over it.
// Usage: PORT=5421 node tools/haze-cost.mjs [low|medium|high]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 5421;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const tier = process.argv[2] ?? "low";
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
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
      await page.goto(`http://127.0.0.1:${PORT}/index.html#webgl-fixed`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await frames(30);
  const at = await page.evaluate(() => {
    const r = window.__sandbox.renderer;
    const wall = r.layout.stones.filter((s) => s.castle === 0 && s.part === "wall");
    const zmin = Math.min(...wall.map((s) => s.z));
    const x = wall.filter((s) => s.z < zmin + 1.5).reduce((a, s, _, l) => a + s.x / l.length, 0);
    window.__sandbox.look({ x: x + 22, y: 6, z: zmin - 29, tx: x, ty: 3, tz: zmin - 3, fov: 50 });
    return { x, z: zmin - 3 };
  });
  await frames(5);
  const none = await cost();
  const stage = (n) =>
    page.evaluate(
      ([n, at]) => {
        const r = window.__sandbox.renderer;
        const h = [];
        for (let k = 0; k < n; k++) h.push(at.x + k * 6, r.terrain.heightAt(at.x + k * 6, at.z), at.z + k * 4, 11, 12, 45, 0, 0);
        r.haze.apply({ hazes: h, recent: [] }, r.now);
      },
      [n, at],
    );
  await stage(1);
  const one = await cost();
  await stage(3);
  const three = await cost();
  console.log(`${tier}: no haze ${none.toFixed(0)} ms/frame, 1 haze ${one.toFixed(0)} ms (${(one / none).toFixed(2)}x), 3 hazes ${three.toFixed(0)} ms (${(three / none).toFixed(2)}x)`);
} finally {
  await browser.close();
  await server.close();
}
