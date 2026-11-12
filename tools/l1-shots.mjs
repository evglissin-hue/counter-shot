// Stills of look round L1 (the gun in your hands) on the Practice range in
// headless Chromium (software WebGL2, the test clock). One page load, then each
// view from the long gun (slot 0) at the far castle (about 150 m): the sight at
// rest, 0.1 s, 1.5 s and 3.7 s after a shot (flash, smoke, recoil, the crew at
// work), fully zoomed in (the gunner's glass), 0.3 s after a shot from beside
// the gun (the trail, and again broadside from 12 m), a mortar shell in flight
// (its thread), the frame a ball strikes the far castle and 0.1 s later (the
// blink of dust), the gun seen from 3 m, and the impact cam's inset open on a
// landing.
// Timed views are exact in game frames (30 to the game second on the test
// clock): a page-side loop counts frames from the muzzle's event and freezes
// game time on the one asked for. It uses only page hooks that exist on main
// (and the renderer's private methods spawnMuzzle and spawnImpact, which main
// has too), so the master can take "before" stills from main with the same tool.
// Writes tools/.shots/l1-<tag>-<view>.png.
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
/** Whether game time is held (frozen) between calls: the timed views step it frame by frame. */
let held = false;
const run = async () => {
  await page.evaluate(() => window.__sandbox.freeze(false));
  held = false;
};
/** Let n game frames go by (coarse: a few more may pass before the poll sees it). */
async function frames(n) {
  await run();
  const start = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 900000, polling: 50 });
}
async function waitFor(fn, limit = 600) {
  await run();
  const start = await page.evaluate(() => window.__sandbox.frames);
  while ((await page.evaluate(() => window.__sandbox.frames)) < start + limit) {
    if (await page.evaluate(fn)) return true;
    await sleep(40);
  }
  return false;
}
/** Exactly n more game frames, then game time is held. */
async function step(n) {
  await page.evaluate(
    (n) =>
      new Promise((res) => {
        const S = window.__sandbox;
        const target = S.frames + n;
        S.freeze(false);
        const tick = () => {
          if (S.frames >= target) {
            S.freeze(true);
            res(S.frames);
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );
  held = true;
}
/** Fire (the long gun, or the mortar's charge) and run to exactly n game frames after the muzzle's event, then hold. */
async function fireStep(kind, n) {
  await page.evaluate(() => {
    const R = window.__sandbox.renderer;
    if (R.__mzHooked) return;
    R.__mzHooked = true;
    window.__mz = { frame: -1 };
    const orig = R.spawnMuzzle.bind(R);
    R.spawnMuzzle = (...a) => {
      orig(...a);
      window.__mz.frame = window.__sandbox.frames;
    };
  });
  const r = await page.evaluate(
    ([kind, n]) =>
      new Promise((res) => {
        const S = window.__sandbox;
        window.__mz.frame = -1;
        S.freeze(false);
        if (kind === "mortar") {
          S.holdCharge(0.9);
          S.holdCharge(null);
        } else S.fire();
        const t0 = S.frames;
        const tick = () => {
          const f = window.__mz.frame;
          if (f >= 0 && S.frames >= f + n) {
            S.freeze(true);
            res({ muzzle: f, now: S.frames });
          } else if (S.frames > t0 + 400) {
            S.freeze(true);
            res({ failed: true });
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [kind, n],
  );
  held = true;
  if (r.failed) console.log("the gun did not fire");
  return r;
}
/** The picture now: game time is held while the (slow, software) screenshot is taken, and goes on after unless a timed view holds it. */
async function shot(view, suffix = "") {
  await page.evaluate(() => window.__sandbox.freeze(true));
  await sleep(600);
  await page.screenshot({ path: `${out}l1-${tag}-${view}${suffix}.png`, timeout: 300000 });
  if (!held) await page.evaluate(() => window.__sandbox.freeze(false));
  console.log(`shot l1-${tag}-${view}${suffix}`);
}
/** The long gun laid on the far castle's gate wall, default zoom, no test camera. */
const laid = async () => {
  await run();
  return page.evaluate(() => {
    const S = window.__sandbox;
    S.look(null);
    S.select(0);
    S.setFov(0, 44);
    return S.aimAtPoint(0, 0, 6, -16.4);
  });
};
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
/** The newest projectile the renderer draws now ([x, y, z, radius]), or null when none is in the air (an earlier round shot may still be rolling on: the newest is last). */
const ballNow = () =>
  page.evaluate(() => {
    const P = window.__sandbox.renderer.projectiles, n = P.balls.geometry.instanceCount;
    return n > 0 ? Array.from(P.ballArr.slice((n - 1) * 4, n * 4)) : null;
  });
const impactEnabled = () => page.evaluate(() => !!window.__sandbox.impact && window.__sandbox.impact.enabled);
const impactDisabled = () => page.evaluate(() => !!window.__sandbox.impact && !window.__sandbox.impact.enabled);

async function tour() {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html#webgl${quality === "low" ? "-low" : ""}-fixed`, { waitUntil: "load", timeout: 120000 });
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
    await fireStep("long", 3);
    if (want("fire")) await shot("fire");
    await step(42);
    if (want("reload")) await shot("reload");
    await step(66);
    if (want("runout")) await shot("runout");
    await run();
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

  // The trail: 0.3 s after a long gun shot, a free camera beside the gun looking down range; and the same moment of a second shot broadside from 12 m.
  if (want("trail")) {
    const g = await gunAt();
    await readyToFire();
    // Side of the gun, a little behind the muzzle and above it, looking along the shot.
    const px = g.gx + 5, py = g.gy + 1.6, pz = g.gz - 1;
    await page.evaluate(([px, py, pz, fx, fy, fz]) => window.__sandbox.look({ x: px, y: py, z: pz, tx: px + fx * 40 - 4, ty: py + fy * 40 - 0.5, tz: pz + fz * 40, fov: 38 }), [px, py, pz, g.fx, g.fy, g.fz]);
    await fireStep("long", 9);
    await shot("trail");
    await page.evaluate(() => window.__sandbox.look(null));
    await readyToFire();
    await fireStep("long", 8);
    const q1 = await ballNow();
    await step(1);
    const q2 = await ballNow();
    if (!q1 || !q2) console.log("the ball was not in the air at 0.3 s");
    else {
      const w = q2.map((c, i) => c - q1[i]);
      const wl = Math.hypot(w[0], w[1], w[2]) || 1;
      const hl = Math.hypot(w[0], w[2]) || 1;
      console.log("ball at 0.3 s:", q2.slice(0, 3).map((c) => c.toFixed(1)).join(", "), "moving", (wl * 30).toFixed(0), "m/s");
      // The ball is held here: a camera 12 m to its side, a little above, looking at the path just behind it.
      await page.evaluate(([q, w, wl, sx, sz]) => window.__sandbox.look({ x: q[0] + sx * 12, y: q[1] + 1.5, z: q[2] + sz * 12, tx: q[0] - (w[0] / wl) * 3, ty: q[1] - (w[1] / wl) * 3, tz: q[2] - (w[2] / wl) * 3, fov: 32 }), [q2, w, wl, w[2] / hl, -w[0] / hl]);
      await shot("trail", "-side");
    }
    await page.evaluate(() => window.__sandbox.look(null));
    await run();
  }

  // A mortar shell in flight, seen from a free camera to the side (its fuse spark, its thread).
  if (want("shell")) {
    await run();
    await page.evaluate(() => {
      window.__sandbox.look(null);
      window.__sandbox.select(1);
    });
    await frames(10);
    await page.keyboard.press("KeyV");
    await frames(2);
    await page.evaluate(() => window.__sandbox.lookAt(1, 140));
    await frames(40);
    console.log("shell flight (s):", await page.evaluate(() => window.__sandbox.flightSeconds));
    // 2 s after the muzzle (60 frames): the shell is a little past the top of its flight.
    await fireStep("mortar", 60);
    const q = await ballNow();
    await step(1);
    const q2 = await ballNow();
    if (!q || !q2) console.log("no shell in the air");
    else {
      const w = q2.map((c, i) => c - q[i]);
      const hl = Math.hypot(w[0], w[2]) || 1;
      console.log("shell at", q2.slice(0, 3).map((c) => c.toFixed(1)).join(", "));
      await page.evaluate(([p, sx, sz]) => window.__sandbox.look({ x: p[0] + sx * 40, y: p[1] + 4, z: p[2] + sz * 40, tx: p[0], ty: p[1] - 1, tz: p[2], fov: 45 }), [q2, w[2] / hl, -w[0] / hl]);
      await shot("shell");
    }
    await page.evaluate(() => window.__sandbox.look(null));
    await run();
    await waitFor(() => !window.__sandbox.ride, 900);
    await page.keyboard.press("KeyV");
    await frames(2);
    await page.evaluate(() => window.__sandbox.select(0));
    await frames(30);
  }

  // The frame a ball strikes the far castle in the zoomed sight, and 0.1 s later.
  if (want("hit")) {
    await laid();
    await page.evaluate(() => window.__sandbox.setFov(0, 20));
    await frames(30);
    await readyToFire();
    // A hook on the renderer's impact: the frame the first hit is drawn (the event is applied just before that frame is drawn),
    // game time is held, so the still is that very frame. (A round shot bounces on: it is not gone when it strikes.)
    await page.evaluate(() => {
      const S = window.__sandbox, R = S.renderer;
      const orig = R.spawnImpact.bind(R);
      window.__hit = { done: false };
      R.spawnImpact = (...a) => {
        orig(...a);
        // The ball's own hit (a strong one at the gate wall), not the small cracks of stones still settling from an earlier shot.
        (window.__hit.log ||= []).push(a.map((v) => +v.toFixed(2)));
        if (!window.__hit.done && a[3] >= 0.7 && a[2] > -40 && a[2] < 12) {
          window.__hit.done = true;
          window.__hit.tick = S.frame ? S.frame.tick : 0;
          S.freeze(true);
        }
      };
      window.__hitRestore = () => {
        R.spawnImpact = orig;
      };
      S.fire();
    });
    try {
      await page.waitForFunction(() => window.__hit.done, null, { timeout: 900000, polling: 100 });
    } catch (e) {
      console.log("impacts seen:", JSON.stringify(await page.evaluate(() => window.__hit.log)));
      await page.evaluate(() => window.__hitRestore());
      throw e;
    }
    held = true;
    await page.evaluate(() => window.__hitRestore());
    await shot("hit");
    // 0.1 s on: six sim ticks (the worker's frames come a little behind the page's, so count the ticks the page has drawn, not its frames).
    await page.evaluate(
      () =>
        new Promise((res) => {
          const S = window.__sandbox, target = window.__hit.tick + 6;
          let n = 0;
          S.freeze(false);
          const tick = () => {
            if ((S.frame && S.frame.tick >= target) || ++n > 90) {
              S.freeze(true);
              res(n);
            } else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    await shot("hit", "-later");
    await run();
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
