// The first seconds of a Versus AI match as a new player sees them (the guide
// up, nothing hidden) at a laptop's artifact panel size: aim with the keys,
// fire the long gun at the enemy keep with Space, and shoot the screen as the
// gold, notes and toasts come in. The page's timers, clock and CSS animations
// run slowed (not the match), so a slow software renderer still catches the
// short-lived messages together. Writes tools/.shots/first-*.png.
// Usage: PORT=6199 node tools/first-match-shots.mjs [width] [height] [scale]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = process.env.OUT ?? fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const [w = 1100, h = 810, scale = 1] = process.argv.slice(2).map(Number);
const port = Number(process.env.PORT ?? 6199);
const tag = process.env.TAG ?? "";
const SLOW = 25;
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
// The page's own clock and timers (not the worker's: the match runs at its pace).
await page.addInitScript(() => {
  window.__slow = 1;
  const st = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...a) => st(fn, (ms ?? 0) * window.__slow, ...a);
  const pn = performance.now.bind(performance);
  let real = pn(), virt = real;
  performance.now = () => {
    const r = pn();
    virt += (r - real) / window.__slow;
    real = r;
    return virt;
  };
});
const cdp = await page.context().newCDPSession(page);
await cdp.send("Animation.enable");
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const state = () =>
  page.evaluate(() => {
    const vis = (id) => (document.getElementById(id) && !document.getElementById(id).hidden ? document.getElementById(id).textContent : "");
    return {
      t: ((window.__sandbox.match?.tick ?? 0) / 60).toFixed(1),
      trick: vis("trick"),
      note: vis("note"),
      lock: vis("lock-hint"),
      floats: [...document.querySelectorAll("#floats span")].map((s) => s.textContent),
      feed: [...document.querySelectorAll("#feed span")].map((s) => s.textContent),
    };
  });
const t0 = Date.now();
try {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#versus=knight-webgl-low`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 30, null, { timeout: 180000, polling: 200 });
  await page.screenshot({ path: `${out}first${tag}-0-start.png` });
  console.log("start", JSON.stringify(await state()));
  await page.evaluate((s) => (window.__slow = s), SLOW);
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 / SLOW });
  // Aim a touch with the keys (the guide's first step), then fire with Space.
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(150);
  await page.keyboard.up("KeyW");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => !document.getElementById("trick").hidden || document.querySelectorAll("#floats span").length > 0, null, { timeout: 60000, polling: 50 });
  for (let k = 1; k <= 3; k++) {
    const s = await state();
    await page.screenshot({ path: `${out}first${tag}-${k}.png` });
    console.log(k, JSON.stringify(s));
    await page.waitForTimeout(400);
  }
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  console.log(`${Math.round((Date.now() - t0) / 1000)} s`);
  await browser.close();
  await server.close();
}
