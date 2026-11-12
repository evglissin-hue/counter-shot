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
const scenes = args.filter((a, i) => !a.startsWith("--") && (tierArg < 0 || i !== tierArg + 1));
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
  console.log("loaded", hash);
  return page;
}
const frames = async (page, n) => {
  const start = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 900000, polling: 50 });
};

/** n rendered frames (game time is frozen for stills, so the page's frame counter stands still). */
const rafs = (page, n) =>
  page.evaluate(
    (k) =>
      new Promise((res) => {
        let i = 0;
        const f = () => (++i >= k ? res(0) : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

/** A still of the current scene with the new effects, then without them. tier: low or high. */
async function pair(page, name, tier, cam) {
  await page.evaluate((t) => window.__sandbox.renderer.setQuality(t), tier);
  await page.evaluate((c) => window.__sandbox.look(c), cam);
  const n = tier === "high" ? 2 : 4;
  await rafs(page, n);
  await page.screenshot({ path: `${out}look-${name}-${tier}-after.png`, timeout: 600000 });
  console.log(`${out}look-${name}-${tier}-after.png`);
  await page.evaluate(() => {
    const r = window.__sandbox.renderer;
    window.__kept = { marks: r.groundMarks.capture(), hazes: r.haze.capture(r.now) };
    r.groundMarks.clear();
    r.haze.clear();
  });
  await rafs(page, n);
  await page.screenshot({ path: `${out}look-${name}-${tier}-before.png`, timeout: 600000 });
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
    await frames(page, 20);
    // Shells staged through the real path (GroundMarks.frame reads Explosion events): three bursts on the open ground
    // and one keg burning, as the sim would report them. Real mortar shells need game minutes in software rendering.
    await page.evaluate(() => {
      const r = window.__sandbox.renderer;
      const ev = [[3, -40], [5, -37], [4, -43.5]].map(([rad, z]) => [1, 6 + (z + 40) * 0.4, r.terrain.heightAt(6, z) + 0.3, z, rad]);
      const f = { tick: 600, events: new Float32Array(ev.flat()), eventCount: ev.length, kegs: new Float32Array([-2, r.terrain.heightAt(-2, -38), -38, 200]), kegCount: 1, minions: new Float32Array(0), minionCount: 0 };
      r.groundMarks.frame(f, (x, z) => r.terrain.heightAt(x, z));
      for (let k = 0; k < 6; k++) r.groundMarks.data.kegs(f.kegs, 1);
    });
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
    // The most worn place (a 7 x 7 block with the most trodden), and a view of it; the HUD and any end screen are hidden.
    const hot = await page.evaluate(() => {
      const d = window.__sandbox.renderer.groundMarks.data, { nx, nz, x0, z0, cell } = d.grid;
      let n = 0, m = 0, best = -1, bi = 0, bj = 0;
      for (let j = Math.round((-125 - z0) / cell); j < Math.round((-40 - z0) / cell); j += 2) for (let i = 3; i < nx - 3; i += 2) {
        let sum = 0;
        for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) sum += d.data[((j + dj) * nx + i + di) * 4 + 2];
        if (sum > best) {
          best = sum;
          bi = i;
          bj = j;
        }
      }
      for (let k = 2; k < nx * nz * 4; k += 4) {
        if (d.data[k] > 0.25) n++;
        if (d.data[k] > m) m = d.data[k];
      }
      const cv = document.querySelector("canvas");
      for (const el of Array.from(document.querySelectorAll("body *"))) if (el !== cv && !el.contains(cv)) el.style.visibility = "hidden";
      return { x: x0 + bi * cell, z: z0 + bj * cell, cellsOver025: n, max: m };
    });
    console.log("trodden", JSON.stringify(hot), `after ${seconds} s`);
    await page.evaluate(() => window.__sandbox.freeze(true));
    const cam = { x: hot.x + 10, y: 7, z: hot.z - 14, tx: hot.x, ty: 0, tz: hot.z, fov: 55 };
    for (const tier of tiers) await pair(page, "paths", tier, cam);
    await page.close();
  }
} finally {
  if (errors.length) console.log("page errors:\n  " + [...new Set(errors)].slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
