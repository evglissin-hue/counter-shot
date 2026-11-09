// Screenshots of the round after M5 on the Practice range (headless Chromium,
// WebGL2, Low, the test clock): the mortar's spotter looking close (on the
// front wall) and far, its charge ring and pin on the target keep's roof, the
// chain shot sweeping the crew off the target's long gun (a close-up of the
// gun knocked over, and the gun's tab as you see it), and long gun shots
// bringing a tower top down with its gun. Writes tools/.shots/guns-*.png.
// Usage: PORT=5403 node tools/guns-shots.mjs [names...]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const PORT = Number(process.env.PORT) || 5403;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !only.length || only.some((o) => name.includes(o));
async function shot(name) {
  if (!want(name)) return;
  await page.evaluate(() => window.__sandbox.freeze(true));
  await sleep(400);
  await page.screenshot({ path: `${out}guns-${name}.png` });
  await page.evaluate(() => window.__sandbox.freeze(false));
  console.log(`shot guns-${name}`);
}
async function frames(n) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 600000, polling: 50 });
}
async function waitFor(fn, limit = 600) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  while ((await page.evaluate(() => window.__sandbox.frames)) < start + limit) {
    if (await page.evaluate(fn)) return true;
    await sleep(40);
  }
  return false;
}
const hud = () => page.evaluate(() => ({ target: document.getElementById("w-target")?.textContent, reload: document.getElementById("w-reload")?.textContent, note: document.getElementById("note")?.textContent, tally: document.getElementById("tally")?.textContent }));

async function tour() {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html#webgl-low-fixed`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 120000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await frames(30);
  // The mortar: the spotter on the front wall looking close, then over the keep with a charge on the target keep's roof.
  await page.evaluate(() => {
    window.__sandbox.select(1);
    window.__sandbox.lookAt(1, 24);
  });
  await frames(45);
  await page.evaluate(() => window.__sandbox.holdCharge(0.02));
  await frames(2);
  await shot("mortar-near");
  await page.evaluate(() => window.__sandbox.lookAt(1, 150));
  await frames(45);
  await page.evaluate(() => window.__sandbox.holdCharge(0.92));
  await frames(2);
  await shot("mortar-keep");
  console.log("mortar:", JSON.stringify(await hud()));
  await page.evaluate(() => window.__sandbox.setFov(1, 14));
  await page.evaluate(() => window.__sandbox.holdCharge(0.92));
  await frames(20);
  await page.evaluate(() => window.__sandbox.holdCharge(0.92));
  await frames(2);
  await shot("mortar-keep-zoomed");
  await page.evaluate(() => {
    window.__sandbox.holdCharge(null);
    window.__sandbox.setFov(1, 44);
  });
  await waitFor(() => !window.__sandbox.ride, 900);

  // The chain shot sweeps the crew off the target's long gun (8, on its gate wall).
  await page.evaluate(() => {
    window.__sandbox.select(2);
    window.__sandbox.aimAtPoint(2, 0, 9.4, -16.4);
  });
  await frames(30);
  await page.evaluate(() => window.__sandbox.fire());
  const out8 = await waitFor(() => window.__sandbox.gunOut[16] > 0, 240);
  await frames(30);
  console.log("chain on the long gun:", out8, JSON.stringify(await hud()));
  // The shot's report comes a moment after it lands: it must name the gun it silenced.
  const told = await waitFor(() => /silenced/i.test(document.getElementById("tally")?.textContent ?? ""), 600);
  console.log("chain shot's report:", told, JSON.stringify((await hud()).tally));
  await shot("chain-tab");
  await page.evaluate(() => window.__sandbox.look({ x: 7, y: 13.5, z: -25, tx: 0, ty: 9.6, tz: -16.4, fov: 38 }));
  await frames(10);
  await shot("longgun-out");
  await page.evaluate(() => window.__sandbox.look(null));

  // Long gun shots at the top of the tower under the target's chain shot (10): the tower top comes down, and the gun with it.
  await page.evaluate(() => window.__sandbox.select(0));
  for (let k = 0; k < 4; k++) {
    const down = await page.evaluate(() => window.__sandbox.gunOut[20] > 0);
    if (down) break;
    await page.evaluate((y) => window.__sandbox.aimAtPoint(0, 15, y, -18.4), 11.4 - k * 0.5);
    await waitFor(() => window.__sandbox.reload[0] === 0, 400);
    await frames(10);
    await page.evaluate(() => window.__sandbox.fire());
    await frames(60);
  }
  const out10 = await page.evaluate(() => window.__sandbox.gunOut.slice(20, 22));
  console.log("tower gun:", JSON.stringify(out10), JSON.stringify(await hud()));
  await page.evaluate(() => window.__sandbox.look({ x: 26, y: 16, z: -36, tx: 15, ty: 8, tz: -15, fov: 42 }));
  await frames(40);
  await shot("tower-gun-fallen");
  await page.evaluate(() => window.__sandbox.look(null));
}

try {
  await tour();
} finally {
  if (errors.length) console.log("page errors:\n  " + [...new Set(errors)].slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
