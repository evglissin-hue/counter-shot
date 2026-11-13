// 3.4: the page's side of a keep falling, in headless Chromium (WebGL2, Low, the test clock): the mason's eye on the
// enemy keep untouched, on a keep half cut, then cut through the gateway until its plumb line leaves the footing and it
// groans, topples (mid-fall), and its great cloud; a tower toppled; a bought buttress up against a keep. Prints the page's
// frame time (rAF to rAF) idle, while it falls, and while a long gun's shot bursts, for the cost of the great cloud.
// Shots go to tools/.shots/3.4/.
// Usage: PORT=6310 node tools/keep-shots.mjs
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/3.4/", import.meta.url));
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 6310);
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function load(hash) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#${hash}`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      return;
    } catch (e) { if (i === 2) throw e; }
  }
}
const adv = async (seconds) => {
  const t = await page.evaluate((s) => { const w = window.__sandbox; const t = w.match?.tick ?? w.frame?.tick ?? 0; w.advance(s); return t + Math.round(s * 60); }, seconds);
  await page.waitForFunction((t) => { const w = window.__sandbox; return (w.match?.tick ?? w.frame?.tick ?? 0) >= t - 6; }, t, { timeout: 180000, polling: 100 });
};
const shot = async (name) => { await sleep(1500); await page.screenshot({ path: `${out}${name}.png` }); console.log("shot", name); };
/** Mean and worst page frame time (ms) over the next `ms`. */
const frames = (ms) => page.evaluate((ms) => new Promise((done) => {
  const d = []; let last = performance.now(); const t0 = last;
  const f = (n) => { d.push(n - last); last = n; if (n - t0 < ms) requestAnimationFrame(f); else done({ mean: d.reduce((a, b) => a + b, 0) / d.length, worst: Math.max(...d), n: d.length }); };
  requestAnimationFrame(f);
}), ms);
const eye = () => page.evaluate(() => { const s = window.__sandbox.eye; const k = s.list[0]; return { labels: s.labels, under: s.under, keep: k && { state: k.state, holds: +k.holds.toFixed(2), weakest: k.weakest, margin: +k.margin.toFixed(2), drawIn: +k.drawIn.toFixed(2), tn: +k.toppleNear.toFixed(2) } }; });
try {
  // ---- the enemy keep in the Practice range ----
  await load("practice-webgl-low-fixed");
  await page.waitForFunction(() => window.__sandbox.eye.list.length === 10, null, { timeout: 180000, polling: 200 });
  const k = await page.evaluate(() => { const s = window.__sandbox.eye.list[0]; return { x: s.cx, z: s.cz }; });
  const cam = (dx, dy, dz, fov = 50) => page.evaluate(([c]) => window.__sandbox.look(c), [{ x: k.x + dx, y: dy, z: k.z + dz, tx: k.x, ty: 9, tz: k.z, fov }]);
  await cam(-26, 15, -48);
  await page.keyboard.down("KeyC");
  await page.waitForFunction(() => window.__sandbox.eye.labels.length === 1, null, { timeout: 60000, polling: 100 });
  console.log("untouched", JSON.stringify(await eye()));
  await shot("eye-keep-untouched");
  const idle = await frames(2500);
  console.log("frame time idle", JSON.stringify(idle));
  await page.evaluate(() => window.__sandbox.cut(0, "partial"));
  await adv(0.6);
  console.log("half cut", JSON.stringify(await eye()));
  await shot("eye-keep-half-cut");
  await page.evaluate(() => window.__sandbox.cut(0, "face"));
  await adv(0.4);
  console.log("cut", JSON.stringify(await eye()));
  await shot("eye-keep-cut-plumb");
  const fall = [];
  await page.keyboard.up("KeyC");
  for (let i = 0; i < 6; i++) {
    await adv(0.5);
    fall.push(await frames(700));
    const e = await eye();
    console.log(`+${(i + 1) * 0.5} s`, JSON.stringify(e.keep), JSON.stringify(fall[i]));
    if (i === 1) await shot("keep-topple-mid-fall");
    if (i === 3) await shot("keep-topple-cloud");
  }
  await adv(4);
  await shot("keep-fallen-settled");
  console.log("frame time while it falls: worst mean", Math.max(...fall.map((f) => f.mean)).toFixed(1), "worst frame", Math.max(...fall.map((f) => f.worst)).toFixed(1));
  console.log("stats", JSON.stringify(await page.evaluate(() => window.__sandbox.stats)));
  // A shot's burst, for comparison: the long gun at the fallen keep's ground.
  await page.evaluate(([x, z]) => { window.__sandbox.aimAtPoint(0, x, 1, z); window.__sandbox.look(null); }, [k.x, k.z]);
  await page.evaluate(() => window.__sandbox.fire());
  await adv(1.5);
  const burst = await frames(2000);
  console.log("frame time over a shot's burst", JSON.stringify(burst));

  // ---- a tower ----
  await load("practice-webgl-low-fixed");
  await page.waitForFunction(() => window.__sandbox.eye.list.length === 10, null, { timeout: 180000, polling: 200 });
  const t1 = await page.evaluate(() => { const s = window.__sandbox.eye.list[1]; return { x: s.cx, z: s.cz }; });
  await page.evaluate(([c]) => window.__sandbox.look(c), [{ x: t1.x - 22, y: 12, z: t1.z - 30, tx: t1.x, ty: 6, tz: t1.z, fov: 50 }]);
  await page.evaluate(() => window.__sandbox.cut(1, "outer"));
  await adv(1.2);
  await shot("tower-toppling");

  // ---- a buttress against your keep ----
  await load("versus=squire-webgl-low-fixed");
  await page.waitForFunction(() => window.__sandbox.eye.list.length === 10 && (window.__sandbox.match?.tick ?? 0) > 30, null, { timeout: 180000, polling: 200 });
  const m = await page.evaluate(() => { const s = window.__sandbox.eye.list[5]; return { x: s.cx, z: s.cz }; });
  await page.evaluate(() => window.__sandbox.input({ kind: "buttress", face: "front" }));
  await adv(16);
  console.log("buttresses", JSON.stringify(await page.evaluate(() => window.__sandbox.match.buttresses)));
  await page.evaluate(([c]) => window.__sandbox.look(c), [{ x: m.x + 22, y: 12, z: m.z + 34, tx: m.x, ty: 7, tz: m.z, fov: 50 }]);
  await shot("buttress-up-against-keep");
  await page.screenshot({ path: `${out}tracker-bar.png`, clip: { x: 0, y: 0, width: 1280, height: 150 } });
  console.log("shot tracker-bar");
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
if (errors.length) process.exit(1);
