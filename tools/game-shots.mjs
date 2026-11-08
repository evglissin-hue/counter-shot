// Screenshots of every camera view of the sandbox in headless Chromium
// (WebGL2, Low): each weapon's sight, the mortar's observer (and zoomed), a
// mortar shell ride from launch to the burst and back, the long gun's shot
// camera and the overview. Writes tools/.shots/*.png and prints what the page
// reported. Usage: node tools/game-shots.mjs [names...]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

/** The dev server's port (PORT in the environment overrides it, so several runs can share a machine). */
const PORT = Number(process.env.PORT) || 5198;
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
/** Game time stands still while the (slow, software) screenshot is taken. */
async function shot(name) {
  if (!want(name)) return;
  await page.evaluate(() => window.__sandbox.freeze(true));
  await sleep(400); // let a frozen frame render
  await page.screenshot({ path: `${out}${name}.png` });
  await page.evaluate(() => window.__sandbox.freeze(false));
  console.log(`shot ${name}`);
}
/** Wait for n game frames (30 per game second with #fixed). */
async function frames(n) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 600000, polling: 50 });
}
const state = () => page.evaluate(() => {
  const s = window.__sandbox;
  return { ride: s.ride, aimHit: s.aimHit, flight: s.flightSeconds, slow: s.timeScale, reload: s.reload, hud: document.getElementById("w-target")?.textContent };
});
/** The aim help setting lives in the Controls panel, which is hidden: set it through the page. */
const setAimHelp = (v) =>
  page.evaluate((value) => {
    const s = document.getElementById("aimhelp");
    s.value = value;
    s.dispatchEvent(new Event("change"));
  }, v);
/** Wait until fn() is true, at most `limit` game frames. */
async function waitFor(fn, limit = 600) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  while ((await page.evaluate(() => window.__sandbox.frames)) < start + limit) {
    if (await page.evaluate(fn)) return true;
    await sleep(40);
  }
  return false;
}

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
  await frames(60);
  await shot("01-longgun-sight");
  console.log("long gun:", JSON.stringify(await state()));

  // The mortar: the observer, then zoomed.
  await page.evaluate(() => window.__sandbox.select(1));
  await frames(60);
  await shot("02-mortar-observer");
  console.log("mortar:", JSON.stringify(await state()));
  await page.evaluate(() => window.__sandbox.setFov(1, 14));
  await frames(30);
  await shot("03-mortar-zoomed");
  await page.evaluate(() => window.__sandbox.setFov(1, 44));

  // Find an elevation that lands on the target keep's roof (else anywhere on the keep), then ride a shell into it.
  // The search reads where the shell lands, which only the full aim help shows (the standard is the first part of the arc).
  await setAimHelp("full");
  let aim = null, fallback = null;
  for (let p = 1.34; p >= 0.7 && !aim; p -= 0.005) {
    await page.evaluate((pitch) => window.__sandbox.aimAt(1, 0, pitch), p);
    await frames(2);
    const s = await state();
    if (/keep roof|target battlements/.test(s.hud || "")) aim = { pitch: p, hud: s.hud };
    else if (!fallback && /target keep/.test(s.hud || "")) fallback = { pitch: p, hud: s.hud };
  }
  if (!aim && fallback) {
    aim = fallback;
    await page.evaluate((pitch) => window.__sandbox.aimAt(1, 0, pitch), aim.pitch);
  }
  console.log("aim at the keep:", JSON.stringify(aim));
  await setAimHelp("partial");
  await frames(45);
  await shot("04-mortar-on-keep");
  await page.evaluate(() => window.__sandbox.fire());
  await frames(9);
  await shot("05-ride-launch");
  await frames(24);
  await shot("06-ride-climb");
  console.log("ride:", JSON.stringify(await state()));
  await waitFor(() => window.__sandbox.ride && window.__sandbox.ride.tImpact < 1.4);
  await shot("07-ride-descent");
  await waitFor(() => window.__sandbox.ride && window.__sandbox.ride.hold);
  await shot("08-ride-hold");
  await waitFor(() => window.__sandbox.ride && window.__sandbox.ride.boom);
  await frames(3);
  await shot("09-ride-burst");
  console.log("burst:", JSON.stringify(await state()));
  await frames(12);
  await shot("10-ride-burst-later");
  await frames(30);
  await shot("11-ride-settling");
  await waitFor(() => !window.__sandbox.ride);
  await frames(30);
  await shot("12-mortar-after");
  if (only.length && only.every((o) => /ride|mortar/.test(o))) return;

  // The other weapons' sights.
  await page.evaluate(() => window.__sandbox.select(2));
  await frames(30);
  await shot("13-chain-sight");
  await page.evaluate(() => window.__sandbox.select(3));
  await frames(30);
  await shot("14-swivel-sight");

  // The long gun's shot camera (V).
  await page.evaluate(() => window.__sandbox.select(0));
  await page.keyboard.press("KeyV");
  await frames(3);
  await page.evaluate(() => window.__sandbox.fire());
  await frames(20);
  await shot("15-longgun-follow");
  await frames(90);
  await page.keyboard.press("KeyV");

  // The overview.
  await page.keyboard.press("Tab");
  await frames(30);
  await shot("16-overview");
  await page.keyboard.press("Tab");
}

try {
  await tour();
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
