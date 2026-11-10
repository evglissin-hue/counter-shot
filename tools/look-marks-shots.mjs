// Stills for look rounds L2 and L3 (dust that stays, scorch, trodden paths) in
// headless Chromium (software WebGL2). Each still is taken twice from the same
// scene: "after" with the new marks, then "before" with the haze and the
// ground marks cleared (the same picture without them).
//   scorch:  mortar shells on the field, the ground where they burst
//   haze:    a haze of a great collapse (staged as a 12 s old haze at the enemy's front wall, with its ground wash)
//   paths:   a match against the AI run for PATH_SECONDS of game time, the routes the waves took
// Usage: PORT=5421 node tools/look-marks-shots.mjs [scorch haze paths] [--tier low|high]
// Writes tools/.shots/look-<scene>-<tier>-<before|after>.png. PATH_SECONDS defaults to 300.
// The page is loaded on Low; for High the tier is raised through the renderer before the still.
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const PORT = Number(process.env.PORT) || 5421;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const tierArg = args.indexOf("--tier");
const tiers = tierArg >= 0 ? [args[tierArg + 1]] : ["low", "high"];
const scenes = args.filter((a, i) => !a.startsWith("--") && i !== tierArg + 1);
const want = (s) => !scenes.length || scenes.includes(s);
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function open(hash) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("keepfall.quality", "low");
    } catch {}
  });
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html#${hash}`, { waitUntil: "load", timeout: 240000 });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  return page;
}
const frames = async (page, n) => {
  const start = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 900000, polling: 50 });
};

/** A still of the current scene with the new effects, then without them. tier: low or high. */
async function pair(page, name, tier, cam) {
  await page.evaluate((t) => window.__sandbox.renderer.setQuality(t), tier);
  await page.evaluate((c) => window.__sandbox.look(c), cam);
  const n = tier === "high" ? 3 : 8;
  await frames(page, n);
  await page.screenshot({ path: `${out}look-${name}-${tier}-after.png` });
  console.log(`${out}look-${name}-${tier}-after.png`);
  await page.evaluate(() => {
    const r = window.__sandbox.renderer;
    window.__kept = { marks: r.groundMarks.capture(), hazes: r.haze.capture(r.now) };
    r.groundMarks.clear();
    r.haze.clear();
  });
  await frames(page, n);
  await page.screenshot({ path: `${out}look-${name}-${tier}-before.png` });
  console.log(`${out}look-${name}-${tier}-before.png`);
  // Put them back for the next tier.
  await page.evaluate(() => {
    const r = window.__sandbox.renderer;
    r.groundMarks.apply(window.__kept.marks);
    r.haze.apply(window.__kept.hazes, r.now);
  });
}

try {
  if (want("scorch")) {
    const page = await open("webgl-fixed");
    await page.evaluate(() => window.__sandbox.select(1));
    await frames(page, 40);
    for (const level of [0.88, 0.9, 0.92]) {
      await page.waitForFunction(() => window.__sandbox.reload[1] === 0, null, { timeout: 900000, polling: 100 }).catch(() => {});
      await page.evaluate((l) => {
        window.__sandbox.holdCharge(l);
        window.__sandbox.holdCharge(null);
      }, level);
      await page.waitForFunction(() => window.__sandbox.ride && window.__sandbox.ride.boom, null, { timeout: 900000, polling: 50 });
      await frames(page, 12);
    }
    const c = await page.evaluate(() => {
      const d = window.__sandbox.renderer.groundMarks.data;
      let best = 0, bi = 0, bj = 0;
      for (let j = 0; j < d.grid.nz; j++) for (let i = 0; i < d.grid.nx; i++) {
        const v = d.data[(j * d.grid.nx + i) * 4];
        if (v > best) {
          best = v;
          bi = i;
          bj = j;
        }
      }
      return { best, x: d.grid.x0 + bi * d.grid.cell, z: d.grid.z0 + bj * d.grid.cell };
    });
    console.log("scorch centre", JSON.stringify(c));
    await page.evaluate(() => window.__sandbox.freeze(true));
    const cam = { x: c.x + 9, y: 7, z: c.z + 12, tx: c.x, ty: 0, tz: c.z, fov: 50 };
    for (const tier of tiers) await pair(page, "scorch", tier, cam);
    await page.close();
  }
  if (want("haze")) {
    const page = await open("webgl-fixed");
    await frames(page, 30);
    const at = await page.evaluate(() => {
      const r = window.__sandbox.renderer;
      const L = r.layout;
      // The enemy's front wall (castle 0, the stones nearest the player's side).
      const wall = L.stones.filter((s) => s.castle === 0 && s.part === "wall");
      const zmin = Math.min(...wall.map((s) => s.z));
      const front = wall.filter((s) => s.z < zmin + 1.5);
      const x = front.reduce((a, s) => a + s.x, 0) / front.length;
      const g = r.terrain.heightAt(x, zmin - 3);
      r.haze.apply({ hazes: [x, g, zmin - 3, 11, 12, 45, 0, 0], recent: [] }, r.now);
      r.groundMarks.dust(x, zmin - 3, 11, 0.5);
      return { x, z: zmin - 3, g };
    });
    console.log("haze at", JSON.stringify(at));
    await page.evaluate(() => window.__sandbox.freeze(true));
    const cam = { x: at.x + 22, y: 6, z: at.z - 26, tx: at.x, ty: 3, tz: at.z, fov: 50 };
    for (const tier of tiers) await pair(page, "haze", tier, cam);
    await page.close();
  }
  if (want("paths")) {
    const page = await open("versus-webgl-low");
    const seconds = Number(process.env.PATH_SECONDS) || 300;
    await page.evaluate(() => window.__sandbox.setRoute("right"));
    await page.waitForFunction((t) => (window.__sandbox.match?.tick ?? 0) >= t * 60, seconds, { timeout: 1800000, polling: 500 });
    const cam = { x: -26, y: 22, z: -52, tx: -34, ty: 0, tz: -86, fov: 55 };
    const tops = await page.evaluate(() => {
      const d = window.__sandbox.renderer.groundMarks.data;
      let n = 0, m = 0;
      for (let k = 2; k < d.grid.nx * d.grid.nz * 4; k += 4) {
        const v = d.data[k];
        if (v > 0.25) n++;
        if (v > m) m = v;
      }
      return { cellsOver025: n, max: m };
    }).catch(() => null);
    console.log("trodden", JSON.stringify(tops), `after ${seconds} s`);
    for (const tier of tiers) await pair(page, "paths", tier, cam);
    await page.close();
  }
} finally {
  if (errors.length) console.log("page errors:\n  " + [...new Set(errors)].slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
