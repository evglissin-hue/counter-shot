// Screenshots of M3 in headless Chromium (WebGL2, Low): the Practice range's
// courtyards with a building of each kind (on the test clock), then a match on
// the real clock: a mixed wave of sappers and musketeers forming up and
// marching, a Powder Mill rising, the build wheel, gold rising from a fight,
// sappers at the enemy wall. Writes tools/.shots/estate-*.png.
// Usage: PORT=6197 node tools/estate-shots.mjs [names...]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const port = Number(process.env.PORT ?? 6197);
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
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

async function load(hash) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#${hash}`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 120000 });
      return;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
}
const info = () =>
  page.evaluate(() => {
    const m = window.__sandbox.match;
    return m ? { t: (m.tick / 60).toFixed(1), gold: m.gold, income: m.income, standing: m.standing, fallen: m.fallen } : null;
  });
const FULL = { width: 1280, height: 720 };
async function shot(name, cam, wait = 2500) {
  if (!want(name)) return;
  await page.setViewportSize(FULL);
  await page.evaluate((c) => window.__sandbox.look(c), cam ?? null);
  await sleep(wait);
  await page.screenshot({ path: `${out}estate-${name}.png` });
  console.log(`shot ${name}`, JSON.stringify(await info()));
}
/**
 * Wait until the match clock reaches t seconds. The page draws in a small
 * window meanwhile, so the software renderer leaves the sim worker the CPU.
 */
async function until(t) {
  await page.setViewportSize({ width: 192, height: 108 });
  await page.waitForFunction((tick) => (window.__sandbox.match?.tick ?? 0) >= tick, t * 60, { timeout: 1500000, polling: 500 });
}

async function practice() {
  await load("webgl-low-fixed");
  await page.evaluate(() => window.__sandbox.freeze(false));
  await sleep(4000);
  // The target castle's courtyard from above its back wall, and the player's from over its keep.
  await shot("01-target-courtyard", { x: 0, y: 30, z: 26, tx: 0, ty: 0, tz: -4, fov: 55 });
  // The front plots from the front wall's walk (their doors face the gate), the mill from over the side wall.
  await shot("02-target-barracks", { x: -4.6, y: 9.2, z: -13.7, tx: -7.5, ty: 1.4, tz: -9.4, fov: 55 });
  await shot("03-target-foundry", { x: 4.6, y: 9.2, z: -13.7, tx: 7.5, ty: 1.0, tz: -9.4, fov: 55 });
  await shot("04-target-mill", { x: -13.7, y: 8.6, z: 0.4, tx: -9.6, ty: 1.2, tz: 4.4, fov: 55 });
  await shot("05-your-courtyard", { x: 0, y: 32, z: -176, tx: 0, ty: 0, tz: -146, fov: 55 });
}

async function match() {
  await load("versus-webgl-low");
  const sb = (f, ...a) => page.evaluate(f, ...a);
  // The first waves: a mixed wave (pikemen, sappers, musketeers) down the centre road.
  await sb(() => window.__sandbox.input({ kind: "barracks", plot: 0, mix: "mixed" }));
  await until(2.2);
  await sb(() => window.__sandbox.input({ kind: "build", plot: 1, building: "mill" }));
  await until(10);
  await shot("10-mixed-wave-forming", { x: 9, y: 5, z: -120, tx: 0, ty: 0.8, tz: -129, fov: 45 });
  await shot("11-mill-rising", { x: 2, y: 7, z: -146, tx: 7.5, ty: 1.5, tz: -141.5, fov: 55 });
  await sb(() => window.__sandbox.wheel(true));
  await shot("12-build-wheel", null);
  await sb(() => window.__sandbox.wheel(true, 0));
  await shot("13-build-wheel-barracks", null);
  await sb(() => window.__sandbox.wheel(false));
  await until(24);
  await shot("14-marching", { x: -10, y: 6, z: -96, tx: 0, ty: 0.8, tz: -104, fov: 45 });
  await until(42);
  await shot("15-meeting", { x: 12, y: 8, z: -64, tx: 0, ty: 0.5, tz: -76, fov: 55 });
  await until(60);
  await shot("16-enemy-wall", { x: -10, y: 6, z: -36, tx: 0, ty: 1.5, tz: -18, fov: 55 });
  await until(75);
  await shot("17-enemy-wall-later", { x: -10, y: 6, z: -36, tx: 0, ty: 1.5, tz: -18, fov: 55 });
  await shot("18-hud", null);
}

try {
  if (!only.length || only.some((o) => o < "10")) await practice();
  if (!only.length || only.some((o) => o >= "10")) await match();
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
