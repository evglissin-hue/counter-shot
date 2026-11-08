// Screenshots of a match against the AI in headless Chromium (WebGL2, Low),
// on the real clock: the sim worker runs at 60 Hz while the slow software
// renderer catches what it can. Fixed cameras look at the waves forming up,
// marching, meeting at the centre bridge, fighting, and battering a gate.
// Writes tools/.shots/wave-*.png and prints the match state at each shot.
// Usage: node tools/wave-shots.mjs [names...]
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
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: Number(process.env.PORT ?? 5197), host: "127.0.0.1" }, logLevel: "error" });
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
const info = () =>
  page.evaluate(() => {
    const m = window.__sandbox.match;
    return m ? { t: (m.tick / 60).toFixed(1), standing: m.standing, fallen: m.fallen, waves: m.waves, auto: m.autoShots, gate: m.gateHits, open: m.gateOpen, route: m.route, order: m.order } : null;
  });
/** Wait until the match clock reaches t seconds. */
async function until(t) {
  await page.waitForFunction((tick) => (window.__sandbox.match?.tick ?? 0) >= tick, t * 60, { timeout: 900000, polling: 200 });
}
async function shot(name, cam) {
  if (!want(name)) return;
  await page.evaluate((c) => window.__sandbox.look(c), cam ?? null);
  await sleep(2500); // a couple of rendered frames at the new camera
  await page.screenshot({ path: `${out}wave-${name}.png` });
  console.log(`shot ${name}`, JSON.stringify(await info()));
}

async function tour() {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5197}/index.html#versus-webgl-low`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 120000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  // Your waves go down the right flank; the enemy's first comes down the centre, unopposed.
  await page.evaluate(() => window.__sandbox.setRoute("right"));
  await until(10);
  await shot("01-forming-up", { x: 9, y: 6, z: -118, tx: 0, ty: 0.5, tz: -128, fov: 50 });
  await until(16);
  await shot("02-hud-sight", null);
  await until(24);
  await shot("03-marching", { x: -14, y: 9, z: -95, tx: -30, ty: 0, tz: -110, fov: 50 });
  await until(42);
  await shot("04-enemy-on-the-bridge", { x: 10, y: 6, z: -86, tx: 0, ty: 0.8, tz: -74, fov: 50 });
  await until(70);
  await shot("05-approach-under-fire", { x: 14, y: 12, z: -112, tx: 0, ty: 0, tz: -96, fov: 55 });
  await until(84);
  await shot("06-at-your-gate", { x: 7, y: 5, z: -124, tx: 0, ty: 1.5, tz: -133, fov: 50 });
  await page.keyboard.press("Tab");
  await sleep(500);
  await shot("07-overview", null);
  await page.keyboard.press("Tab");
  await until(110);
  await shot("08-right-bridge", { x: -38, y: 7, z: -88, tx: -48, ty: 0.5, tz: -78, fov: 50 });
  await until(130);
  await shot("09-enemy-gate", { x: -8, y: 6, z: -30, tx: 0, ty: 1.5, tz: -17, fov: 50 });
}

try {
  await tour();
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
