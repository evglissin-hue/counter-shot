// Stills of the household against the real sim (milestone 3.6, round 2), in a Versus AI match against the Knight on the test
// clock (#fixed), headless Chromium (software WebGL, #webgl-low). The 3D scene is hidden while the match is stepped (a drawn
// frame takes seconds) and shown for each picture. It writes, as it finds them:
//   crew-two-men-real.png      your long gun with its two real men (a rear view from beside it)
//   crew-one-man-down-real.png the same view once one of a gun's men is down (the first of yours that has one left)
//   hoist-real.png             a replacement hoisted up at a post's foot (the camera at the foot, looking up at the gun)
//   panel-real.png             the household panel with real names and a lost seat on the way
// Usage: PORT=6350 node tools/household-shots-real.mjs [outDir] [maxSeconds=900]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = process.argv[2] ?? fileURLToPath(new URL("./.shots/3.6/", import.meta.url));
const maxSecs = Number(process.argv[3] ?? 900);
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 6350);
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
const scene = (on) => page.evaluate((on) => { window.__sandbox.renderer.scene.visible = on; }, on);
const frames = (n) => page.evaluate(async (n) => { const f = window.__sandbox.frames, t = performance.now(); while (window.__sandbox.frames < f + n && performance.now() - t < 120000) await new Promise((r) => setTimeout(r, 50)); }, n);
const snap = async (name, clip) => {
  await scene(true);
  await frames(3);
  await page.screenshot({ path: `${out}/${name}.png`, ...(clip ? { clip } : {}) });
  await scene(false);
  console.log("wrote", name);
};
const adv = async (s) => {
  const t = await page.evaluate((s) => { const w = window.__sandbox; const t = w.match?.tick ?? 0; w.advance(s); return t + Math.round(s * 60); }, s);
  await page.waitForFunction((t) => (window.__sandbox.match?.tick ?? 0) >= t - 6, t, { polling: 100 });
};
/** Look at a gun (match id) from the courtyard side, a little above its floor; `foot` looks from near the ground up at it. */
const lookAt = (id, foot) => page.evaluate(([id, foot]) => {
  const S = window.__sandbox, g = S.guns[id], c = S.camera;
  const gy = S.floorY?.[id] ?? c.y - 1.1 + 3.2 * c.fy;
  const inward = g.z < -75 ? -1 : 1; // the castle's courtyard lies behind its guns
  const cz = g.z < -75 ? -150 : 0;
  const dz = cz - g.z, dx = -g.x, d = Math.hypot(dx, dz) || 1;
  if (foot) S.look({ x: g.x + (dx / d) * 8, y: gy - 6, z: g.z + (dz / d) * 8, tx: g.x, ty: gy - 1.5, tz: g.z, fov: 60 });
  else S.look({ x: g.x - 3.6 * inward, y: gy + 2.2, z: g.z - 5 * inward, tx: g.x, ty: gy - 0.9, tz: g.z - 1.2 * inward, fov: 55 });
}, [id, foot]);
try {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#versus=knight-webgl-low-fixed`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 240000 });
      break;
    } catch (e) { if (i === 2) throw e; }
  }
  await scene(false);
  await adv(3);
  const base = await page.evaluate(() => window.__sandbox.emplacementBase);
  // 1. Two real men at your first gun.
  await lookAt(base, false);
  await adv(0.2);
  await snap("crew-two-men-real");
  const got = { one: false, hoist: false, panel: false };
  const t0 = Date.now();
  for (let s = 0; s < maxSecs && !(got.one && got.hoist && got.panel); s += 2) {
    await adv(2);
    const st = await page.evaluate(() => {
      const m = window.__sandbox.match, h = m.household, b = window.__sandbox.emplacementBase;
      if (!h) return null;
      const guns = h.stations.filter((x) => x.kind === 0 && x.seats.some((t) => t.state !== 0)).map((x) => ({ index: x.index, men: x.seats.filter((t) => t.state === 5).length, states: x.seats.map((t) => t.state) }));
      return { tick: m.tick, result: m.result, guns, lost: h.lost, reserve: h.reserve };
    });
    if (!st || st.result) break;
    const hurt = st.guns.find((g) => g.men === 1);
    const walking = st.guns.find((g) => g.states.some((x) => x === 2 || x === 3 || x === 4));
    if (hurt && !got.one) {
      got.one = true;
      await lookAt(hurt.index, false);
      await adv(0.2);
      await snap("crew-one-man-down-real");
      console.log("one man down at", hurt.index, "tick", st.tick);
    }
    if (walking && !got.panel) {
      got.panel = true;
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ" })));
      await frames(4);
      await snap("panel-real");
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ" })));
      await frames(2);
      console.log("panel with a seat on its way, tick", st.tick);
    }
    if (walking && walking.states.some((x) => x === 4) && !got.hoist) {
      got.hoist = true;
      await lookAt(walking.index, true);
      await snap("hoist-real");
      console.log("hoist at", walking.index, "tick", st.tick);
    }
    // Step finer while a man walks, so a hoist is caught while it lasts (3 s).
    if (walking && !got.hoist) {
      for (let k = 0; k < 40 && !got.hoist; k++) {
        await adv(0.5);
        const hoisting = await page.evaluate(([id]) => { const h = window.__sandbox.match.household; const g = h.stations.find((x) => x.kind === 0 && x.index === id); return g ? g.seats.some((t) => t.state === 4) : false; }, [walking.index]);
        if (hoisting) {
          got.hoist = true;
          await lookAt(walking.index, true);
          await snap("hoist-real");
          console.log("hoist at", walking.index);
        }
      }
    }
  }
  console.log("found", JSON.stringify(got), "in", Math.round((Date.now() - t0) / 1000), "s");
} finally {
  await browser.close();
  await server.close();
}
