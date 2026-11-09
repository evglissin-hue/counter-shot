// Screenshots of the overview in a Versus AI match on the test clock (headless
// Chromium, 1100 x 810): the threat strip over the minimap and the group marks
// over the field, at about 1:30 and 3:00, at the default view and zoomed in.
// Writes tools/.shots/overview-*.png and prints the strip's cells and the marks
// at each shot.
// Usage: PORT=6302 node tools/overview-shots.mjs
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const PORT = Number(process.env.PORT) || 6302;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 810 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Step the match to game second t and let the page catch up. */
async function until(t) {
  const now = await page.evaluate(() => (window.__sandbox.match?.tick ?? 0) / 60);
  if (t > now) await page.evaluate((s) => window.__sandbox.advance(s), t - now);
  await page.waitForFunction((tick) => (window.__sandbox.match?.tick ?? 0) >= tick - 6, t * 60, { timeout: 600000, polling: 200 });
  await sleep(2500);
}
const report = (name) =>
  page.evaluate((n) => {
    const cells = [...document.querySelectorAll("#threat .tc")].map((c) => `${c.querySelector(".tc-name").textContent}:${c.className.replace("tc ", "")} men=${c.querySelector(".tc-men").textContent || 0} kit=[${[...c.querySelectorAll(".tc-kit span")].map((s) => s.textContent + s.title[0]).join(" ")}] mine=${c.querySelector(".tc-mine").textContent || 0}`);
    const m = window.__sandbox.match;
    const marks = window.__sandbox.groupMarks.map((g) => `t${g.team}x${g.n}${g.keg ? "k" : ""}${g.ladder ? "L" : ""}`);
    return `${n} t=${(m.tick / 60).toFixed(0)}s waves=${m.waves} standing=${m.standing}\n  strip: ${cells.join(" | ")}\n  marks: ${marks.join(" ")}`;
  }, name);
async function shot(name) {
  await page.screenshot({ path: `${out}overview-${name}.png` });
  console.log(await report(name));
}

try {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html#versus=knight-webgl-low-fixed`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) { if (i === 2) throw e; }
  }
  await page.waitForFunction(() => window.__sandbox.match != null, null, { timeout: 120000, polling: 200 });
  await page.evaluate(() => window.__sandbox.freeze(true));
  await page.evaluate(() => window.__sandbox.toggleOverview());
  await page.waitForFunction(() => window.__sandbox.view === "overview", null, { timeout: 30000 });
  for (const [label, t] of [["0130", 90], ["0300", 180]]) {
    await until(t);
    await shot(`${label}-default`);
    // Zoom in on the field with the wheel (OrbitControls dollies), then back out.
    await page.mouse.move(550, 405);
    for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, -300); await sleep(300); }
    await sleep(2500);
    await shot(`${label}-zoomed`);
    for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, 300); await sleep(300); }
    await sleep(2500);
  }
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
