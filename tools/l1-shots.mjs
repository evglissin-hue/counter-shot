// Stills of look round L1 (the gun in your hands) on the Practice range in
// headless Chromium (software WebGL2, the test clock). One page load, then each
// view from the long gun (slot 0) at the far castle (about 150 m): the sight at
// rest, 0.1 s, 1.5 s and 3.7 s after a shot (flash, smoke, recoil, the crew at
// work), fully zoomed in (the gunner's glass), 0.3 s after a shot from beside
// the gun (the trail), a mortar shell 2 s into flight (its thread), the frame a
// ball strikes the far castle and 0.1 s later (the blink of dust), the gun seen
// from 3 m, and the impact cam's inset open on a landing.
// It uses only page hooks that exist on main, so the master can take "before"
// stills from main with the same tool. Writes tools/.shots/l1-<tag>-<view>.png.
// Usage: PORT=5633 node tools/l1-shots.mjs [--quality=low|medium|high|ultra] [--tag=name] [views...]
//   views: rest fire reload runout glass trail shell hit closeup inset (default: all)
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const PORT = Number(process.env.PORT) || 5631;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split("=")[1];
const quality = opt("quality", "low");
const tag = opt("tag", quality);
const only = args.filter((a) => !a.startsWith("--"));
const want = (...names) => !only.length || names.some((n) => only.includes(n));
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
if (quality !== "low") {
  // Straight to the tier (the same as raising it through the quality list), kept for the pacer.
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("keepfall.quality", t);
      localStorage.setItem("keepfall.qualityChosen", "1");
    } catch {}
  }, quality);
}
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function frames(n) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 900000, polling: 50 });
}
async function waitFor(fn, limit = 600) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  while ((await page.evaluate(() => window.__sandbox.frames)) < start + limit) {
    if (await page.evaluate(fn)) return true;
    await sleep(40);
  }
  return false;
}
/** Game time stands still while the (slow, software) screenshot is taken. */
async function shot(view, suffix = "") {
  await page.evaluate(() => window.__sandbox.freeze(true));
  await sleep(500);
  await page.screenshot({ path: `${out}l1-${tag}-${view}${suffix}.png`, timeout: 300000 });
  await page.evaluate(() => window.__sandbox.freeze(false));
  console.log(`shot l1-${tag}-${view}${suffix}`);
}
/** The long gun laid on the far castle's gate wall, default zoom, no test camera. */
const laid = () =>
  page.evaluate(() => {
    const S = window.__sandbox;
    S.look(null);
    S.select(0);
    S.setFov(0, 44);
    return S.aimAtPoint(0, 0, 6, -16.4);
  });
const readyToFire = async () => {
  await waitFor(() => window.__sandbox.reload[0] === 0, 900);
  await frames(6);
};
/** Where the long gun's camera sits in the sight and which way it looks (to place a free camera near the gun). */
const gunAt = async () => {
  await laid();
  await frames(8);
  return page.evaluate(() => {
    const S = window.__sandbox, c = S.camera, g = S.guns[0];
    // The sight sits 3.2 m behind the gun and 1.1 m above it.
    return { gx: g.x, gz: g.z, gy: c.y - 1.1 + 3.2 * c.fy, fx: c.fx, fy: c.fy, fz: c.fz };
  });
};
const impactEnabled = () => page.evaluate(() => !!window.__sandbox.impact && window.__sandbox.impact.enabled);
const impactDisabled = () => page.evaluate(() => !!window.__sandbox.impact && !window.__sandbox.impact.enabled);

async function tour() {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html#webgl${quality === "low" ? "-low" : ""}-fixed`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  console.log(`tier ${await page.evaluate(() => document.getElementById("quality")?.value)} (asked ${quality})`);
  await frames(40);
  // The impact cam's inset would cover part of every other still: off (K) unless the view is the inset.
  if (await impactEnabled()) {
    await page.keyboard.press("KeyK");
    await frames(2);
  }

  if (want("rest")) {
    await laid();
    await frames(45);
    await shot("rest");
  }

  // One shot, three stills: 0.1 s (flash, smoke, the gun leaping back), 1.5 s (reloading) and 3.7 s (run out again).
  if (want("fire", "reload", "runout")) {
    await laid();
    await readyToFire();
    await page.evaluate(() => window.__sandbox.fire());
    await frames(3);
    if (want("fire")) await shot("fire");
    await frames(42);
    if (want("reload")) await shot("reload");
    await frames(66);
    if (want("runout")) await shot("runout");
  }

  if (want("glass")) {
    await laid();
    await page.evaluate(() => window.__sandbox.setFov(0, 14));
    // The glass eases in at the rate the field of view does (about a second).
    await frames(40);
    await shot("glass");
    await page.evaluate(() => window.__sandbox.setFov(0, 44));
    await frames(30);
  }

  // The trail: 0.3 s after a long gun shot, a free camera beside the gun looking down range.
  if (want("trail")) {
    const g = await gunAt();
    await readyToFire();
    await page.evaluate(() => window.__sandbox.fire());
    // Side of the gun, a little behind the muzzle and above it, looking along the shot.
    const px = g.gx + 5, py = g.gy + 1.6, pz = g.gz - 1;
    await page.evaluate(([px, py, pz, fx, fy, fz]) => window.__sandbox.look({ x: px, y: py, z: pz, tx: px + fx * 40 - 4, ty: py + fy * 40 - 0.5, tz: pz + fz * 40, fov: 38 }), [px, py, pz, g.fx, g.fy, g.fz]);
    await frames(9);
    await shot("trail");
    await page.evaluate(() => window.__sandbox.look(null));
  }

  // A mortar shell 2 s into flight, seen from a free camera to the side (its fuse spark, its thread).
  if (want("shell")) {
    await page.evaluate(() => window.__sandbox.look(null));
    await page.evaluate(() => window.__sandbox.select(1));
    await frames(10);
    await page.keyboard.press("KeyV");
    await frames(2);
    await page.evaluate(() => window.__sandbox.lookAt(1, 140));
    await frames(40);
    await page.evaluate(() => {
      window.__sandbox.holdCharge(0.9);
      window.__sandbox.holdCharge(null);
    });
    await frames(54);
    // Where the shell is now (the renderer's first ball), then a camera to the side of it, set to be there in two frames' time.
    const p = await page.evaluate(() => {
      const b = window.__sandbox.renderer.projectiles.ballArr;
      return { x: b[0], y: b[1], z: b[2], r: b[3] };
    });
    console.log("shell at", JSON.stringify(p));
    await page.evaluate((p) => window.__sandbox.look({ x: p.x + 26, y: p.y + 3, z: p.z + 6, tx: p.x, ty: p.y, tz: p.z + 8, fov: 42 }), p);
    await frames(2);
    await shot("shell");
    await page.evaluate(() => window.__sandbox.look(null));
    await waitFor(() => !window.__sandbox.ride, 900);
    await page.keyboard.press("KeyV");
    await frames(2);
    await page.evaluate(() => window.__sandbox.select(0));
    await frames(60);
  }

  // The frame a ball strikes the far castle in the zoomed sight, and 0.1 s later.
  if (want("hit")) {
    await laid();
    await page.evaluate(() => window.__sandbox.setFov(0, 20));
    await frames(30);
    await readyToFire();
    // A watcher in the page: the first frame the ball is no longer drawn is the frame it struck; freeze there.
    await page.evaluate(() => {
      const S = window.__sandbox;
      const g = S.renderer.projectiles.balls.geometry;
      window.__hit = { seen: false, done: false };
      const tick = () => {
        const n = g.instanceCount;
        if (n > 0) window.__hit.seen = true;
        if (window.__hit.seen && n === 0) {
          S.freeze(true);
          window.__hit.done = true;
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      S.fire();
    });
    await page.waitForFunction(() => window.__hit.done, null, { timeout: 600000, polling: 100 });
    await sleep(500);
    await page.screenshot({ path: `${out}l1-${tag}-hit.png`, timeout: 300000 });
    console.log(`shot l1-${tag}-hit`);
    await page.evaluate(() => window.__sandbox.freeze(false));
    await frames(3);
    await shot("hit", "-later");
    await page.evaluate(() => window.__sandbox.setFov(0, 44));
    await frames(30);
  }

  // The gun seen from 3 m, side on.
  if (want("closeup")) {
    const g = await gunAt();
    await page.evaluate((g) => {
      const yaw = Math.atan2(g.fx, g.fz);
      // Side on: to the right of the barrel, the gun's middle in the middle of the frame.
      const sx = Math.cos(yaw), sz = -Math.sin(yaw);
      window.__sandbox.look({ x: g.gx + sx * 3, y: g.gy + 1.1, z: g.gz + sz * 3, tx: g.gx, ty: g.gy + 0.9, tz: g.gz, fov: 50 });
    }, g);
    await frames(10);
    await shot("closeup");
    await page.evaluate(() => window.__sandbox.look(null));
  }

  // The impact cam's inset open on a landing.
  if (want("inset")) {
    await laid();
    if (await impactDisabled()) {
      await page.keyboard.press("KeyK");
      await frames(2);
    }
    if (await page.evaluate(() => typeof window.__sandbox.impactIgnorePacer === "function")) await page.evaluate(() => window.__sandbox.impactIgnorePacer(true));
    await readyToFire();
    await page.evaluate(() => window.__sandbox.fire());
    const opened = await waitFor(() => window.__sandbox.impact.shown, 400);
    console.log("inset opened:", opened);
    await waitFor(() => window.__sandbox.impact.msToLanding <= 0, 200);
    await frames(2);
    await shot("inset");
  }
}

try {
  await tour();
} finally {
  if (errors.length) console.log("page errors:\n  " + [...new Set(errors)].slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
