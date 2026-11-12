// Screenshots of the impact cam (show track, S2) in headless Chromium (WebGL2,
// Low, the test clock): in the Practice range a long gun shot, a chain shot and
// a mortar shell with its ride off, each shown just before the landing, at the
// landing and 2 s after, with the whole screen in the still (the inset is the
// brass-framed rectangle under the top bar on the right). Also checks that the
// inset opens about a second before the landing, closes 3 s after it, that K
// turns it off, and that a click on it swaps the views. Writes
// tools/.shots/S2-*.png and prints what the page reported.
// S4 (name "replay", run only when asked for): a Versus AI match on the test clock fires at the enemy castle until clips of
// the match are in the reel, then each director recipe that occurs is played and photographed three times (start, the slow
// part, end): tools/.shots/S4-<recipe>-<kind>-<1..3>.png, with the take's numbers printed.
// Usage: PORT=5182 node tools/show-shots.mjs [longgun chain mortar keys replay]  (W and H set the window, default 1280 by 720; MAKE is the longest game time spent making clips, default 240 s)
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const PORT = Number(process.env.PORT) || 5198;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W) || 1280, height: Number(process.env.H) || 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !only.length || only.some((o) => name.includes(o));
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`);
  if (!ok) failed++;
};
/** Game time stands still while the (slow, software) screenshot is taken. */
async function shot(name) {
  if (!want(name)) return;
  await page.evaluate(() => window.__sandbox.freeze(true));
  await sleep(500); // let a frozen frame render
  await page.screenshot({ path: `${out}S2-${name}.png` });
  await page.evaluate(() => window.__sandbox.freeze(false));
  console.log(`shot S2-${name}`);
}
async function frames(n) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 600000, polling: 50 });
}
/** Wait until fn() is true, at most `limit` game frames. */
async function waitFor(fn, limit = 600) {
  const start = await page.evaluate(() => window.__sandbox.frames);
  while ((await page.evaluate(() => window.__sandbox.frames)) < start + limit) {
    if (await page.evaluate(fn)) return true;
    await sleep(30);
  }
  return false;
}
const impact = () => page.evaluate(() => window.__sandbox.impact);
const frameShown = () => page.evaluate(() => !document.getElementById("impact").hidden);

/** One shot through the impact cam: stills before the landing, at it and 2 s after; the inset's timing checked. */
async function watch(label, fire) {
  await fire();
  const opened = await waitFor(() => window.__sandbox.impact.shown, 400);
  const at = await impact();
  check(`${label}: the inset opens`, opened && (await frameShown()), JSON.stringify(at));
  check(`${label}: about a second before the landing`, at.msToLanding > 200 && at.msToLanding <= 1100, `${at.msToLanding} ms`);
  await frames(1);
  await shot(`${label}-1-before`);
  const landed = await waitFor(() => window.__sandbox.impact.msToLanding <= 0, 200);
  await frames(2);
  await shot(`${label}-2-landing`);
  check(`${label}: it landed`, landed);
  await frames(55);
  await shot(`${label}-3-after`);
  check(`${label}: still open 2 s after`, await frameShown());
  const closed = await waitFor(() => !window.__sandbox.impact.open, 120);
  await frames(12);
  check(`${label}: closes 3 s after the landing`, closed && !(await frameShown()));
}

async function tour() {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html#webgl-low-fixed`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 120000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await page.evaluate(() => window.__sandbox.impactIgnorePacer(true));
  await frames(60);

  const scen = (n) => !only.length || only.includes(n);

  // The long gun at the target castle's gate wall.
  if (scen("longgun")) {
    const laid = await page.evaluate(() => window.__sandbox.aimAtPoint(0, 0, 6, -16.4));
    check("long gun laid on the gate wall", laid);
    await frames(10);
    await watch("longgun", () => page.evaluate(() => window.__sandbox.fire()));
  }

  // The chain shot at a wall of the target castle.
  if (scen("chain")) {
    await page.evaluate(() => window.__sandbox.select(2));
    const laid = await page.evaluate(() => window.__sandbox.aimAtPoint(2, 0, 9.4, -16.4));
    check("chain shot laid on the gate wall", laid);
    await frames(30);
    await watch("chain", () => page.evaluate(() => window.__sandbox.fire()));
  }

  // The mortar with its ride off (V turns the shot camera off for the gun in hand).
  if (scen("mortar")) {
    await page.evaluate(() => window.__sandbox.select(1));
    await frames(10);
    await page.keyboard.press("KeyV");
    await frames(2);
    await page.evaluate(() => window.__sandbox.lookAt(1, 140));
    await frames(40);
    await watch("mortar", async () => {
      await page.evaluate(() => {
        window.__sandbox.holdCharge(0.9);
        window.__sandbox.holdCharge(null);
      });
    });
  }

  // K turns it off and on; a click on the inset swaps the views.
  if (scen("keys")) {
    await page.evaluate(() => window.__sandbox.select(0));
    await frames(60);
    await page.keyboard.press("KeyK");
    await frames(2);
    check("K turns the impact cam off", !(await impact()).enabled);
    await page.evaluate(() => window.__sandbox.fire());
    await frames(120);
    check("off: no inset after a shot", !(await impact()).open && !(await frameShown()));
    await page.keyboard.press("KeyK");
    await frames(2);
    check("K turns it on again", (await impact()).enabled);
    await frames(60);
    await page.evaluate(() => window.__sandbox.fire());
    await waitFor(() => window.__sandbox.impact.shown, 400);
    await frames(8);
    await page.evaluate(() => document.getElementById("impact").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    await frames(3);
    check("a click swaps the views", (await impact()).swapped);
    await shot("keys-swapped");
    await page.evaluate(() => document.getElementById("impact").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    await waitFor(() => !window.__sandbox.impact.open, 200);
    await frames(12);
    check("the views go back when it closes", !(await impact()).swapped && !(await frameShown()));
  }
}

/** S4: the director's recipes on clips of a real match. */
async function replayStills() {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto("about:blank");
      await page.goto(`http://127.0.0.1:${PORT}/index.html#versus=knight-webgl-low-fixed`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  const W = Number(process.env.W) || 1280, H = Number(process.env.H) || 720;
  // Rendering is the slow part, the sim is not: make the clips on a small canvas and photograph on the big one.
  await page.setViewportSize({ width: 192, height: 108 });
  await frames(10);
  const MAKE = Number(process.env.MAKE) || 240;
  const wanted = new Set(["topple", "beside", "wide-close", "wide", "orbit"]);
  const kindsOf = async () => {
    await page.evaluate(() => window.__sandbox.flushRecorder());
    return page.evaluate(() => window.__sandbox.recorder.reel.map((c) => ({ kind: c.kind, score: c.score, tick: c.tick })));
  };
  /** The recipe each reel clip would be filmed with (played at once and skipped: no frames needed). */
  const recipes = async () => {
    const reel = await kindsOf();
    const out = [];
    for (let i = 0; i < reel.length; i++) {
      const r = await page.evaluate((k) => {
        const ok = window.__sandbox.playClip(k, 10);
        const rp = window.__sandbox.replay;
        window.__sandbox.skipReplay();
        return ok ? rp : null;
      }, i);
      if (r) out.push({ i, recipe: r.recipe, ...reel[i], start: r.start, end: r.end });
    }
    return out;
  };
  let have = [];
  for (let t = 0; t < MAKE; t += 4) {
    if (t % 12 === 0) {
      const mortar = (t / 12) % 2 === 1;
      await page.evaluate(([slot, y]) => {
        const S = window.__sandbox;
        S.select(slot);
        if (S.aimAtPoint(slot, 0, y, 0)) S.fire();
      }, mortar ? [1, 1] : [0, 9]);
    }
    const t0 = await page.evaluate(() => window.__sandbox.match.tick);
    await page.evaluate(() => window.__sandbox.advance(4));
    await page.waitForFunction((tick) => (window.__sandbox.match?.tick ?? 0) >= tick, t0 + 4 * 60 - 30, { timeout: 600000, polling: 200 });
    await sleep(300);
    if (t % 20 === 16) {
      have = await recipes();
      console.log(`   ${t + 4} s: ${have.map((h) => `${h.kind}/${h.recipe}`).join(", ") || "no clips yet"}`);
      const got = new Set(have.map((h) => h.recipe));
      if (got.has("topple") && got.has("beside")) break;
    }
  }
  have = await recipes();
  console.log(`   clips: ${have.map((h) => `#${h.i} ${h.kind} score ${h.score} -> ${h.recipe} (clip ticks ${h.start} to ${h.end})`).join("; ")}`);
  check("clips were made", have.length > 0);
  check("a topple and a beside take occur", have.some((h) => h.recipe === "topple") && have.some((h) => h.recipe === "beside"), `(recipes ${[...new Set(have.map((h) => h.recipe))].join(", ")})`);
  await page.setViewportSize({ width: W, height: H });
  await frames(5);
  const done = new Set();
  for (const h of have) {
    if (done.has(h.recipe) || !wanted.has(h.recipe)) continue;
    done.add(h.recipe);
    const before = await page.evaluate(() => ({ tick: window.__sandbox.match.tick }));
    await page.evaluate(([i]) => window.__sandbox.replayCheck(true) || window.__sandbox.playClip(i, 9), [h.i]);
    const info = await page.evaluate(() => window.__sandbox.replay);
    const len = info.end - info.start;
    console.log(`   ${h.recipe} (${h.kind}): clip ticks ${info.start} to ${info.end}`);
    const still = async (n, tick) => {
      await page.evaluate((t) => window.__sandbox.replayFreezeAt(t), tick);
      await page.waitForFunction((t) => window.__sandbox.replay.tick >= t, tick, { timeout: 600000, polling: 50 });
      await sleep(500);
      const r = await page.evaluate(() => window.__sandbox.replay);
      await page.screenshot({ path: `${out}S4-${h.recipe}-${h.kind}-${n}.png` });
      console.log(`shot S4-${h.recipe}-${h.kind}-${n}: clip tick ${r.tick.toFixed(1)}, speed ${r.speed}`);
      await page.evaluate(() => window.__sandbox.freeze(false));
      return r;
    };
    await still(1, info.start + Math.min(30, len * 0.1));
    // The slow part: the first tick the take runs below real speed.
    let slowAt = null;
    for (let k = 0; k < 4000 && slowAt === null; k++) {
      const r = await page.evaluate(() => window.__sandbox.replay);
      if (!r.playing) break;
      if (r.speed < 0.9) slowAt = r.tick;
      else await sleep(40);
    }
    if (slowAt !== null) await still(2, slowAt + 6);
    else console.log(`   ${h.recipe}: the take never slows down`);
    await still(3, info.end - Math.min(20, len * 0.05));
    await page.waitForFunction(() => !window.__sandbox.replay.playing, null, { timeout: 600000, polling: 100 });
    const d = await page.evaluate(() => window.__sandbox.replayDiff);
    check(`${h.recipe}: the live view is back after the replay`, Array.isArray(d) && d.length === 0, d && d.length ? `differs: ${d.join(", ")}` : "");
    void before;
  }
  check("a still set was taken for every recipe that occurs", done.size > 0);
}

try {
  if (only.includes("replay")) await replayStills();
  else await tour();
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
  if (failed) process.exitCode = 1;
}
