// Stills of the gun as a showpiece and its recoil (look round L1) on the Practice range (headless Chromium,
// software WebGL2, the test clock: every rendered frame is 1/30 s of game time). Writes tools/.shots/l1-gun-*.png.
//   sight views of the long gun: at rest, 0.1 s after a shot (gun back, camera jolted), 2 s (waiting),
//   3.4 s (being run out), 4.2 s (loaded);
//   free close-ups of the long gun (side, above and behind), the mortar and the chain shot, the swivel.
// Also prints draw calls in the sight view.
// Usage: PORT=5621 node tools/gun-shots.mjs [--quality=low|high] [--tag=name] [names...]   (names: part of a still's name, or "calls")
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const PORT = Number(process.env.PORT) || 5621;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const args = process.argv.slice(2);
const opt = (name, d) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${d}`).split("=")[1];
const quality = opt("quality", "low");
const tag = opt("tag", "");
const only = args.filter((a) => !a.startsWith("--"));
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !only.length || only.some((o) => name.includes(o));
const prefix = `l1-gun${tag ? "-" + tag : ""}-${quality}-`;
async function shot(name) {
  if (!want(name)) return;
  await page.evaluate(() => window.__sandbox.freeze(true));
  await sleep(500);
  await page.screenshot({ path: `${out}${prefix}${name}.png`, timeout: 600000 });
  await page.evaluate(() => window.__sandbox.freeze(false));
  console.log(`shot ${prefix}${name}`);
}
async function frames(n) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 900000, polling: 50 });
}
/** Run to an exact number of frames after now, then stop the clock (the page is frozen by shot()). */
async function waitFor(fn, limit = 600) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  while ((await page.evaluate(() => window.__sandbox.frames)) < start + limit) {
    if (await page.evaluate(fn)) return true;
    await sleep(40);
  }
  return false;
}
const look = (x, y, z, tx, ty, tz, fov = 40) => page.evaluate((c) => window.__sandbox.look(c), { x, y, z, tx, ty, tz, fov });
const calls = () => page.evaluate(() => window.__sandbox.renderer.getStats());

async function load() {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html#webgl-low-fixed`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await frames(20);
  if (quality !== "low") {
    // Raise the tier through the quality list (the page was loaded on Low).
    await page.evaluate((q) => {
      const sel = document.querySelector("#quality, select[name=quality]");
      if (sel) {
        sel.value = q;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, quality);
    await frames(30);
  }
}

/** Game seconds are frames / 30. */
const secs = (s) => frames(Math.round(s * 30));

try {
  await load();
  // The Practice range: you ride the long gun (slot 0) in the sight.
  await page.evaluate(() => window.__sandbox.select(0));
  await frames(40);
  if (want("calls")) {
    const s = await calls();
    console.log(`${quality}: draw calls in the sight view: ${s.drawCalls}, triangles ${s.triangles}`);
  }
  await shot("sight-rest");
  // Fire; the sight stills are at known ages after the shot (a frame is 1/30 s).
  const timed = ["sight-0.1s", "sight-2s", "sight-3.4s", "sight-4.2s"];
  if (timed.some(want)) {
    await page.evaluate(() => window.__sandbox.fire());
    await frames(3);
    await shot("sight-0.1s");
    if (["sight-2s", "sight-3.4s", "sight-4.2s"].some(want)) {
      await secs(1.9);
      await shot("sight-2s");
      await secs(1.4);
      await shot("sight-3.4s");
      await secs(0.8);
      await shot("sight-4.2s");
    }
  }
  // Close-ups from a free camera (the long gun at 0, 9.7, -133.6, the chain shot at -15, 13.8, -135, the mortar at 0, 0.9, -146.5).
  const closeup = async (name, ...c) => {
    if (!want(name)) return;
    await look(...c);
    await frames(6);
    await shot(name);
  };
  await closeup("long-side", -3.2, 9.9, -131.4, 0, 9.4, -134, 40);
  await closeup("long-above-behind", 1.2, 12.0, -137.2, 0, 9.4, -133.4, 55);
  await closeup("long-box-rack", -2.6, 9.6, -139.6, 0.6, 9.3, -134.2, 48);
  await closeup("mortar-side", -6, 2.6, -144, 0, 1.0, -146.5, 45);
  await closeup("chain-side", -13.4, 14.6, -129.8, -15, 13.7, -135, 42);
  await closeup("chain-above-behind", -16.7, 15.9, -138.7, -15, 13.4, -134.4, 50);
  await closeup("swivel-side", 14.2, 14.7, -131.6, 15, 13.8, -135, 38);
  await page.evaluate(() => window.__sandbox.look(null));
} finally {
  if (errors.length) console.log("page errors:\n  " + [...new Set(errors)].slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
