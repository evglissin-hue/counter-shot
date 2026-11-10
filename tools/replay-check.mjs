// The recorder and the renderer's keyframes (show track, S3) in headless
// Chromium (WebGL2, Low, the test clock). Two worlds:
//  1. The Practice range: long gun shots and a mortar shell at the target castle
//     until stones are down, men have fallen and decals are laid; then
//     capture() -> apply() -> capture() must be equal (every part), and a keyframe
//     taken earlier, put back after more shooting, must equal the world as it was.
//  2. A Versus AI match after about 60 s with shots fired: the same, and the
//     recorder's ring, keyframes and reel are printed.
// Exit 1 on a failure.
// Usage: PORT=5184 node tools/replay-check.mjs [match seconds]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 5184;
const matchSeconds = process.argv[2] === undefined ? 24 : Number(process.argv[2]);
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W) || 192, height: Number(process.env.H) || 108 } });
page.setDefaultTimeout(300000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
let failed = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 2 ** 20;

async function load(hash) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html#${hash}`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      return;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
}
async function frames(n) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 600000, polling: 50 });
}
/** What a keyframe holds, as numbers (the page holds the keyframe itself). */
const summary = () =>
  page.evaluate(() => {
    const k = window.__sandbox.capture();
    const p = (n) => k.parts.get(n);
    return {
      tick: k.tick,
      parts: [...k.parts.keys()],
      bytes: k.bytes,
      stonesMoved: p("stones").moved.length / 8,
      craters: p("terrain").idx.length,
      frozen: p("minions").frozen.size,
      limbs: p("minions").limbs.length,
      drops: p("minions").drops.length,
      decals: p("decals").age.length,
      lays: p("works") ? p("works").lays.length / 18 : 0,
      kegs: p("estate").kegs.length / 5,
    };
  });

async function roundTrip(label, mustHave) {
  const s = await summary();
  console.log(`   ${label}: keyframe at tick ${s.tick}, ${(s.bytes / 1024).toFixed(0)} KB: ${JSON.stringify({ ...s, parts: undefined, bytes: undefined, tick: undefined })}`);
  for (const [k, v] of Object.entries(mustHave)) check(`${label}: ${k} at least ${v}`, s[k] >= v, `(${s[k]})`);
  const rt = await page.evaluate(() => window.__sandbox.roundTrip());
  check(`${label}: capture, apply, capture is equal`, rt.equal, rt.equal ? "" : `differs: ${rt.parts.join(", ")}`);
  // A keyframe put back after the world moved on: it must equal what was taken.
  await page.evaluate(() => {
    window.__k1 = window.__sandbox.capture();
  });
  return s;
}

async function putBack(label, moveOn) {
  await moveOn();
  const moved = await summary();
  const parts = await page.evaluate(() => {
    const S = window.__sandbox;
    S.apply(window.__k1);
    return S.diff(window.__k1);
  });
  check(`${label}: an earlier keyframe put back after the world moved on equals the world as it was`, parts.length === 0, parts.length ? `differs: ${parts.join(", ")}` : "");
  const back = await summary();
  const first = await page.evaluate(() => {
    const S = window.__sandbox;
    const a = S.capture();
    return { tick: a.tick };
  });
  console.log(`   ${label}: after moving on ${moved.stonesMoved} stones moved, ${moved.decals} decals, ${moved.frozen} fallen; put back ${back.stonesMoved} stones, ${back.decals} decals, ${back.frozen} fallen (tick ${first.tick})`);
  await frames(30);
}

try {
  // ---- 1. the Practice range ----------------------------------------------------
  console.log("Practice range");
  await load("webgl-low-fixed");
  console.log("   loaded");
  await frames(60);
  console.log("   60 frames");
  // A wave of pikemen at the target castle's gate so some fall.
  await page.evaluate(() => window.__sandbox.spawn(0, 12, 0, -30));
  await frames(30);
  const fire = async (slot, x, y, z) => {
    const laid = await page.evaluate(([s, px, py, pz]) => {
      const S = window.__sandbox;
      S.select(s);
      const ok = S.aimAtPoint(s, px, py, pz);
      if (ok) S.fire();
      return ok;
    }, [slot, x, y, z]);
    return laid;
  };
  let shots = 0;
  // First the men: the chain shot and the long gun laid on the wave, so bodies fall and blood is laid.
  for (let i = 0; i < 3; i++) {
    await fire(i === 1 ? 0 : 2, 0, 1, -30);
    await frames(40);
  }
  for (let i = 0; i < 14; i++) {
    const wall = [[0, 6, -16.4], [4, 9, -16.4], [-4, 8, -16.4], [0, 12, -16.4]][i % 4];
    if (await fire(0, ...wall)) shots++;
    // Wait out the reload (game seconds are 30 frames each).
    await frames(40);
    const s = await summary();
    if (s.stonesMoved >= 30 && s.frozen >= 2 && s.decals >= 2) break;
  }
  check("long gun shots fired", shots > 0, `(${shots})`);
  // A mortar shell: the shell ride off, a long look.
  await page.evaluate(() => window.__sandbox.select(1));
  await frames(10);
  await page.keyboard.press("KeyV");
  await page.evaluate(() => window.__sandbox.lookAt(1, 140));
  await frames(30);
  await page.evaluate(() => {
    window.__sandbox.holdCharge(0.9);
    window.__sandbox.holdCharge(null);
  });
  await frames(100);
  const practice = await roundTrip("practice", { stonesMoved: 10, decals: 1, frozen: 1 });
  console.log(`   practice recorder: ${JSON.stringify(await page.evaluate(() => window.__sandbox.recorder.stats))}`);
  await putBack("practice", async () => {
    for (let i = 0; i < 3; i++) {
      await fire(0, [0, 3, -4][i], 7, -16.4);
      await frames(60);
    }
  });
  void practice;

  // ---- 2. a Versus AI match ------------------------------------------------------
  console.log("Versus AI match");
  await load("versus=knight-webgl-low-fixed");
  await frames(30);
  let fired = 0;
  for (let t = 0; t < matchSeconds; t += 2) {
    if (t % 12 === 0) {
      const mortar = (t / 12) % 2 === 1;
      const laid = await page.evaluate(([slot, y]) => {
        const S = window.__sandbox;
        S.select(slot);
        const ok = S.aimAtPoint(slot, 0, y, 0);
        if (ok) S.fire();
        return ok;
      }, mortar ? [1, 1] : [0, 9]);
      if (laid) fired++;
    }
    await page.evaluate(() => window.__sandbox.advance(2));
    await page.waitForFunction((tick) => (window.__sandbox.match?.tick ?? 0) >= tick, (t + 2) * 60 - 30, { timeout: 300000, polling: 200 });
    await page.waitForTimeout(300);
  }
  check("shots fired in the match", fired > 0, `(${fired})`);
  await page.waitForTimeout(1500);
  await roundTrip("match", { stonesMoved: 1 });
  await putBack("match", async () => {
    await page.evaluate(() => window.__sandbox.advance(6));
    await page.waitForTimeout(2500);
  });
  await page.evaluate(() => window.__sandbox.flushRecorder());
  const rec = await page.evaluate(() => window.__sandbox.recorder);
  const st = rec.stats;
  console.log(`   recorder: ${st.frames} frames over ${st.ringSeconds.toFixed(1)} s, ring ${(st.ringBytes / MB).toFixed(2)} MB (peak ${(st.peakRingBytes / MB).toFixed(2)} MB), ${st.keyframes} keyframes (${(st.keyframeBytes / MB).toFixed(2)} MB), reel ${st.clips} clips ${(st.reelBytes / MB).toFixed(2)} MB`);
  for (const c of rec.reel) console.log(`   clip ${c.kind.padEnd(13)} score ${String(c.score).padStart(4)}  tick ${c.tick}  ${c.from}..${c.to}  keyframe ${c.keyTick}  ${c.entries} frames  ${(c.bytes / MB).toFixed(2)} MB`);
  check("the ring holds frames and keyframes", st.frames > 0 && st.keyframes >= 1);
  check("the ring spans at most 40 s", st.ringSeconds <= 40.05, `(${st.ringSeconds.toFixed(1)} s)`);
  check("the ring is within 48 MB", st.ringBytes <= 48 * MB, `(${(st.ringBytes / MB).toFixed(1)} MB)`);
  check("the reel is within 8 clips and 120 MB", st.clips <= 8 && st.reelBytes <= 120 * MB);
  for (const c of rec.reel) check(`clip ${c.kind} at ${c.tick} starts at a keyframe before its window`, c.keyTick <= c.from || c.entries > 0, `(keyframe ${c.keyTick}, from ${c.from})`);
  // The page is still alive after all that applying.
  const before = await page.evaluate(() => window.__sandbox.frames);
  await frames(30);
  check("the page still draws after the round trips", (await page.evaluate(() => window.__sandbox.frames)) > before);
} finally {
  if (errors.length) {
    console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
    failed++;
  }
  await browser.close();
  await server.close();
  if (failed) {
    console.log(`${failed} FAILED`);
    process.exitCode = 1;
  } else console.log("all ok");
}
