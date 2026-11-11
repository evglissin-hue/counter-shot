// Stills of per-stone wear (look round L2) on the Practice range (headless
// Chromium, software WebGL2, the test clock): the long gun breaches the
// enemy's front wall and a mortar shell bursts on its keep, then the camera
// looks at the breach from outside (fresh faces, soot, cracks) and from the
// sight's distance. Writes tools/.shots/wear-<label>-<tier>-*.png.
// Usage: PORT=5411 node tools/wear-shots.mjs <low|medium|high|ultra> <label> [shots to take: near far sight]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const PORT = Number(process.env.PORT) || 5411;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const tier = process.argv[2] ?? "low";
const label = process.argv[3] ?? "after";
const only = process.argv.slice(4);
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.addInitScript((t) => {
  try {
    localStorage.setItem("keepfall.quality", t);
  } catch {}
}, tier);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !only.length || only.includes(name);
async function shot(name) {
  if (!want(name)) return;
  await page.evaluate(() => window.__sandbox.freeze(true));
  await sleep(500);
  const path = `${out}wear-${label}-${tier}-${name}.png`;
  await page.screenshot({ path, timeout: 600000 });
  await page.evaluate(() => window.__sandbox.freeze(false));
  console.log(`shot ${path}`);
}
async function frames(n) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 900000, polling: 50 });
}
async function waitFor(fn, limit = 600) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  while ((await page.evaluate(() => window.__sandbox.frames)) < start + limit) {
    if (await page.evaluate(fn)) return true;
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
  console.log("loaded");
  await frames(5);
  // Game time is stepped by the test clock (a worker message per 0.2 s), so the slow software
  // renderer is not what the siege waits on.
  const sim = async (seconds) => {
    await page.evaluate((t) => window.__sandbox.advance(t), seconds);
    await frames(3);
  };
  // The long gun breaches the enemy's front wall: shots along it, low and high.
  await page.evaluate(() => window.__sandbox.select(0));
  const aims = [
    [-4, 3.2],
    [-2, 4.4],
    [0, 3.2],
    [2, 4.4],
    [-3, 6.0],
    [1, 6.0],
  ];
  for (const [x, y] of aims) {
    await page.evaluate(([ax, ay]) => window.__sandbox.aimAtPoint(0, ax, ay, -16.4), [x, y]);
    await sim(2);
    await page.evaluate(() => window.__sandbox.fire());
    await sim(6);
    console.log("fired", x, y);
  }
  // A mortar shell on the keep, for scorch.
  await page.evaluate(() => {
    window.__sandbox.select(1);
    window.__sandbox.lookAt(1, 150);
  });
  await sim(3);
  await page.evaluate(() => {
    window.__sandbox.holdCharge(0.5);
    window.__sandbox.holdCharge(null);
  });
  await sim(14);
  console.log("mortar done");
  await sim(30);
  await page.evaluate(() => window.__sandbox.look({ x: 5, y: 3.5, z: -10, tx: 0, ty: 4, tz: -16.4, fov: 55 }));
  await frames(3);
  await shot("near");
  await page.evaluate(() => window.__sandbox.look({ x: 0, y: 6, z: -8, tx: 0, ty: 4.5, tz: -16.4, fov: 22 }));
  await frames(3);
  await shot("far");
  await page.evaluate(() => window.__sandbox.look({ x: -6, y: 4, z: -11, tx: 2, ty: 4, tz: -16.4, fov: 60 }));
  await frames(3);
  await shot("sight");
} finally {
  if (errors.length) console.log("page errors:\n  " + [...new Set(errors)].slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
