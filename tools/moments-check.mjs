// Moments and the book of feats in a Versus AI match on the test clock
// (headless Chromium, #fixed: the sim steps with the page's frames). The long
// gun and the mortar fire at the enemy keep by script while the match runs;
// every moment found is logged with its score and text. Then a feat's toast and
// the Book of feats are photographed: tools/.shots/feat-toast.png, feat-book.png.
// Usage: PORT=5183 node tools/moments-check.mjs [match seconds]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const port = Number(process.env.PORT) || 5183;
const seconds = process.argv[2] === undefined ? 180 : Number(process.argv[2]);
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
let failed = 0;
const ok = (name, cond) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}`);
  if (!cond) failed++;
};
try {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#versus=knight-webgl-low-fixed`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await page.evaluate(() => { try { localStorage.removeItem("keepfall.feats.v1"); } catch {} });
  const seen = new Set();
  const log = [];
  const poll = async () => {
    const ms = await page.evaluate(() => window.__sandbox.moments);
    for (const m of ms) {
      const key = `${m.tick}|${m.kind}|${m.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      log.push(m);
      console.log(`t=${(m.tick / 60).toFixed(1).padStart(6)} s  ${m.kind.padEnd(13)} team ${String(m.team).padStart(2)}  score ${String(m.score).padStart(4)}  size ${String(m.size).padStart(3)}  ${m.text}  @(${m.x.toFixed(0)}, ${m.y.toFixed(0)}, ${m.z.toFixed(0)})`);
    }
  };
  let shots = 0;
  for (let t = 0; t < seconds; t += 4) {
    if (t % 12 === 0) {
      // Long gun (slot 0) at the enemy keep, the mortar (slot 1) at its courtyard, in turn.
      const mortar = (t / 12) % 2 === 1;
      const laid = await page.evaluate(
        ([slot, y]) => {
          const S = window.__sandbox;
          S.select(slot);
          const hit = S.aimAtPoint(slot, 0, y, 0);
          if (hit) S.fire();
          return hit;
        },
        mortar ? [1, 1] : [0, 9],
      );
      if (laid) shots++;
    }
    await page.evaluate(() => window.__sandbox.advance(4));
    await page.waitForFunction((tick) => (window.__sandbox.match?.tick ?? 0) >= tick, (t + 4) * 60 - 30, { timeout: 300000, polling: 200 });
    await page.waitForTimeout(400);
    await poll();
  }
  await page.waitForTimeout(1500);
  await poll();
  const end = await page.evaluate(() => ({ tick: window.__sandbox.match.tick, result: window.__sandbox.match.result }));
  console.log(`match tick ${end.tick}, ${shots} shots laid, ${log.length} moments, result ${JSON.stringify(end.result)}`);

  // A feat's toast (a moment made as the match would make it), looked at over the field.
  await page.evaluate(() => window.__sandbox.setFeatToastMs(60000));
  await page.evaluate(() => window.__sandbox.fakeMoment({ kind: "towerDown", size: 212, men: 9, text: "Tower down: 212 stones, 9 men, a gun", score: 637 }));
  await page.waitForFunction(() => !document.getElementById("feat-toast").hidden);
  ok("the toast shows a feat", /Domino/.test(await page.textContent("#feat-toast-name")));
  await page.waitForFunction(() => getComputedStyle(document.getElementById("feat-toast")).opacity === "1", null, { timeout: 60000, polling: 100 });
  await page.screenshot({ path: `${out}feat-toast.png` });
  const box = await page.evaluate(() => {
    const r = document.getElementById("feat-toast").getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: innerWidth, h: innerHeight };
  });
  ok("the toast stays off the middle of the screen", box.right < box.w * 0.4 && box.bottom < box.h * 0.5);

  // The book, from the pause menu.
  await page.evaluate(() => document.getElementById("menu-btn").click());
  await page.waitForSelector("#book-open", { state: "visible" });
  await page.evaluate(() => document.getElementById("book-open").click());
  await page.waitForSelector("#book:not([hidden])");
  ok("the book lists the feats, earned ones lit", (await page.$$eval("#book-list li", (l) => l.length)) >= 20 && (await page.$$eval("#book-list li.got", (l) => l.length)) >= 3);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}feat-book.png` });
  await page.evaluate(() => document.getElementById("book-close").click());
  ok("the book closes", await page.evaluate(() => document.getElementById("book").hidden));
  const stored = await page.evaluate(() => localStorage.getItem("keepfall.feats.v1"));
  ok("the book is kept in localStorage", !!stored && /timber/.test(stored));
} catch (e) {
  console.log("ERROR", e);
  failed++;
}
if (errors.length) {
  console.log("page errors:", errors.slice(0, 5));
  failed++;
}
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
