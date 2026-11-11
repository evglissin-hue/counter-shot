// Screenshots of 3.2 range and register in headless Chromium (WebGL2, Low): a mark
// in the sight, the chips row on the command card, a mark in the overview, a mark
// on the minimap, and the Practice range with a mark and a salvo. Writes
// tools/.shots/marks-*.png and prints what the page held at each shot.
// Usage: PORT=5291 node tools/marks-shots.mjs [names...]
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
const port = Number(process.env.PORT) || 5291;
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !only.length || only.some((o) => name.includes(o));

async function load(hash) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#${hash}`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      return;
    } catch (e) { if (i === 2) throw e; }
  }
}
const wait = (fn, arg, timeout = 120000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
async function shot(name) {
  if (!want(name)) return;
  await sleep(1500);
  await page.screenshot({ path: `${out}marks-${name}.png` });
  console.log(`shot ${name}`, JSON.stringify(await page.evaluate(() => ({ marks: window.__sandbox.register?.marks.map((m) => `${m.n} ${m.place} (${m.x.toFixed(0)}, ${m.z.toFixed(0)}) bear ${m.bear}`), chips: window.__sandbox.chips, salvoReady: window.__sandbox.register?.salvoReady }))));
}
/** Lay the long gun on the point and fire it; press T inside the page the moment the landing may be marked (a round trip here can outlast the 5 s window on a slow machine). */
/** Step the game this many seconds at once (the test clock) and wait until the page has heard it. */
async function adv(seconds) {
  const t = await page.evaluate((s) => { const w = window.__sandbox; const t = w.match?.tick ?? w.frame?.tick ?? 0; w.advance(s); return t + Math.round(s * 60); }, seconds);
  await wait((t) => { const w = window.__sandbox; return (w.match?.tick ?? w.frame?.tick ?? 0) >= t - 6; }, t, 180000);
}
async function markAt(x, y, z) {
  await adv(6);
  const laid = await page.evaluate(([x, y, z]) => { window.__sandbox.select(0); return window.__sandbox.aimAtPoint(0, x, y, z); }, [x, y, z]);
  if (!laid) throw new Error(`the long gun cannot reach ${x}, ${z}`);
  await wait(() => window.__sandbox.reload[0] === 0);
  const had = await page.evaluate(() => window.__sandbox.register.marks.length);
  await page.evaluate(() => window.__sandbox.fire());
  await wait((had) => {
    const s = window.__sandbox;
    if (s.register.marks.length > had) return true;
    if (s.register.canMark.includes(0) && !window.__keyed) {
      window.__keyed = true;
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyT" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyT" }));
      setTimeout(() => (window.__keyed = false), 1500);
    }
    return false;
  }, had, 240000);
}

try {
  // ---- a match against the Squire: marks in the sight, the chips, the overview, the minimap ----
  await load("versus=squire-webgl-low-fixed");
  await wait(() => (window.__sandbox.match?.tick ?? 0) > 60);
  await page.evaluate(() => window.__sandbox.look(null));
  // A mark on the road before the middle bridge, one on the left road, and one before the enemy gate.
  await markAt(0, 0, -62);
  await shot("sight-centre");
  await markAt(20, 0, -58);
  await markAt(0, 0, -28);
  await shot("chips-and-sight");
  await page.keyboard.press("Tab");
  await wait(() => window.__sandbox.view === "overview");
  await shot("overview");
  await page.keyboard.press("Tab");
  await wait(() => window.__sandbox.view === "sight");
  await page.evaluate(() => window.__sandbox.redrawMap());
  const box = await page.evaluate(() => { const r = document.getElementById("mapbox").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await wait(() => window.__sandbox.mapBig);
  await shot("minimap");
  await page.mouse.move(5, 5);

  // ---- the Practice range: a mark and a salvo ----
  await page.goto("about:blank");
  await load("practice-webgl-low-fixed");
  await wait(() => window.__sandbox.mode === "practice");
  await markAt(0, 0, -62);
  await shot("range-mark");
  await wait(() => window.__sandbox.chips.length === 1 && !window.__sandbox.chips[0].dim);
  // F twice (a frame apart: two presses in one frame are one edge), in the page.
  await page.evaluate(async () => {
    for (let i = 0; i < 2; i++) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyF" }));
      await new Promise((r) => setTimeout(r, 700));
    }
  });
  await wait(() => window.__sandbox.register.salvoReady > 0);
  await sleep(900);
  await shot("range-salvo");
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
if (errors.length) process.exit(1);
