// Screenshots of phase 2 M3 (gold and building) in headless Chromium (WebGL2,
// Low), on the real clock: the build menu over your courtyard, a Powder Mill
// going up and done, the gun bar with all eight slots, a swivel bought for an
// empty slot, the enemy's mill, a wave with sappers, the overview with the
// plot numbers. Writes tools/.shots/build-*.png and prints the match state.
// Usage: node tools/build-shots.mjs [names...]
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
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: 5196, host: "127.0.0.1" }, logLevel: "error" });
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
    const s = window.__sandbox, m = s.match;
    if (!m) return null;
    const plots = s.plots.map((p) => `${p.team}:${p.plot}:${p.kind ?? "-"}:${p.state}:${Math.round(p.progress * 100)}`).join(" ");
    const slots = s.slots.map((v, i) => `${i}:${v.armed ? v.weapon : "-"}${v.down ? "!" : ""}`).join(" ");
    return { t: (m.tick / 60).toFixed(1), gold: m.gold, income: m.income, keeps: m.keepFloor, standing: m.standing, fallen: m.fallen, plots, slots };
  });
/** Wait until the match clock reaches t seconds. */
async function until(t) {
  await page.waitForFunction((tick) => (window.__sandbox.match?.tick ?? 0) >= tick, t * 60, { timeout: 900000, polling: 200 });
}
async function shot(name, cam) {
  if (!want(name)) return;
  await page.evaluate((c) => window.__sandbox.look(c), cam ?? null);
  await sleep(2500); // a couple of rendered frames at the new camera
  await page.screenshot({ path: `${out}build-${name}.png` });
  console.log(`shot ${name}`, JSON.stringify(await info()));
}

async function tour() {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto("http://127.0.0.1:5196/index.html#versus-webgl-low", { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 120000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await until(1);
  // The build menu over your courtyard; a Powder Mill on the front right plot.
  await page.keyboard.press("KeyB");
  await sleep(300);
  await shot("01-menu");
  await page.evaluate(() => window.__sandbox.doAct("build:1:mill"));
  const t0 = await page.evaluate(() => window.__sandbox.match.tick / 60);
  await until(t0 + 5);
  await shot("02-going-up", { x: -2, y: 22, z: -127, tx: -9, ty: 1.5, tz: -140.5, fov: 45 });
  await until(t0 + 13.5);
  await shot("03-mill-done", { x: -2, y: 22, z: -127, tx: -9, ty: 1.5, tz: -140.5, fov: 45 });
  await page.evaluate(() => window.__sandbox.doAct("mix:0:sappers"));
  await page.keyboard.press("KeyB");
  await sleep(300);
  await shot("04-hud");
  // The next wave carries sappers: catch it a few seconds out of the gate.
  const now = await page.evaluate(() => window.__sandbox.match.tick);
  const wave = 480 + Math.ceil((now - 480) / 1500) * 1500;
  await until(wave / 60 + 7);
  await shot("05-sappers-out", { x: 9, y: 5, z: -108, tx: 0, ty: 1, tz: -121, fov: 50 });
  await page.evaluate(() => window.__sandbox.doAct("buy:4:swivel"));
  await sleep(1500);
  await shot("06-new-swivel", { x: 13, y: 13.5, z: -124, tx: 7.5, ty: 9.6, tz: -133.6, fov: 45 });
  await until(50);
  await shot("07-enemy-mill", { x: -3, y: 24, z: -28, tx: -9.5, ty: 1.5, tz: -2, fov: 50 });
  await page.keyboard.press("Tab");
  await sleep(500);
  await shot("08-overview");
  await page.keyboard.press("Tab");
}

try {
  await tour();
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
