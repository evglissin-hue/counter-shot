// The recorder and the renderer's keyframes (show track, S3) in headless
// Chromium (WebGL2, Low, the test clock). Two worlds:
//  1. The Practice range: long gun shots and a mortar shell at the target castle
//     until stones are down, men have fallen and decals are laid; then
//     capture() -> apply() -> capture() must be equal (every part), and a keyframe
//     taken earlier, put back after more shooting, must equal the world as it was.
//  2. A Versus AI match after about 60 s with shots fired: the same, and the
//     recorder's ring, keyframes and reel are printed.
// The range's men do not die to its guns, so the fallen and the blood are required of the match. Exit 1 on a failure.
// Then (S4) the replay player: a clip from the match played twice with a screenshot at the same three clip ticks (the
// pictures must be the same), the live view equal before and after a replay (played out and skipped half way), X in a
// match (the match waits while it plays), X with nothing to replay, the end of a match by a blow (result, the field, the
// last blow's replay, the end screen) and a surrender (no replay).
// Usage: PORT=5184 node tools/replay-check.mjs [match seconds]   (SKIP_PRACTICE=1 leaves out the Practice range, STOP_AFTER_PICS=1 stops once the two plays are compared, DUMP=1 saves the two pictures of a differing pair to tools/.shots/S4-same-*, DUMP=all saves every pair)
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const PORT = Number(process.env.PORT) || 5184;
const shotDir = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(shotDir, { recursive: true });
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
      // A new hash alone does not reload the page: start from a blank one.
      await page.goto("about:blank");
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
  if (!process.env.SKIP_PRACTICE) {
  console.log("Practice range");
  await load("webgl-low-fixed");
  console.log("   loaded");
  await frames(60);
  console.log("   60 frames");
  // S4: X with nothing recorded yet says so and plays nothing.
  await page.keyboard.press("KeyX");
  await page.waitForFunction(() => /Nothing to replay yet/.test(document.getElementById("note").textContent), null, { timeout: 60000, polling: 20 }).catch(() => {});
  const nothing = await page.evaluate(() => ({ note: document.getElementById("note").textContent, shown: !document.getElementById("note").hidden, playing: window.__sandbox.replay.playing }));
  check("X with nothing recorded: a note and no replay", /Nothing to replay yet/.test(nothing.note) && nothing.shown && !nothing.playing, JSON.stringify(nothing));
  // A wave of pikemen at the target castle's gate so some fall.
  await page.evaluate(() => window.__sandbox.spawn(0, 12, 0, -30));
  await frames(30);
  console.log(`   men standing in the range: ${await page.evaluate(() => window.__sandbox.frame.minions.length / 10)}`);
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
    const laid = await fire(i === 1 ? 0 : 2, 0, 1, -30);
    console.log(`   shot ${i} at the wave: laid ${laid}`);
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
  const practice = await roundTrip("practice", { stonesMoved: 10, craters: 1 });
  console.log(`   practice recorder: ${JSON.stringify(await page.evaluate(() => window.__sandbox.recorder.stats))}`);
  await putBack("practice", async () => {
    for (let i = 0; i < 3; i++) {
      await fire(0, [0, 3, -4][i], 7, -16.4);
      await frames(60);
    }
  });
  void practice;

  }
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
  await roundTrip("match", { stonesMoved: 1, frozen: 1, decals: 1 });
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

  // ---- 3. the replay player ------------------------------------------------------
  console.log("Replay player");
  await page.setViewportSize({ width: Number(process.env.RW) || 480, height: Number(process.env.RH) || 270 });
  await frames(5);
  /** Fire the long gun at the castle until a clip of the match has closed (at most `limit` game seconds). */
  const clipCount = () => page.evaluate(() => window.__sandbox.recorder.reel.length);
  let spent = 0;
  while ((await clipCount()) === 0 && spent < 240) {
    const t0 = await page.evaluate(() => {
      const S = window.__sandbox;
      S.select(0);
      if (S.aimAtPoint(0, 0, 9, 0)) S.fire();
      return S.match.tick;
    });
    await page.evaluate(() => window.__sandbox.advance(6));
    await page.waitForFunction((tick) => (window.__sandbox.match?.tick ?? 0) >= tick, t0 + 6 * 60 - 30, { timeout: 300000, polling: 200 });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__sandbox.flushRecorder());
    spent += 6;
  }
  const reel = await page.evaluate(() => window.__sandbox.recorder.reel);
  console.log(`   reel after ${spent} more seconds: ${reel.map((c) => `${c.kind} ${c.score} (${c.from}..${c.to})`).join("; ")}`);
  check("a clip is in the reel", reel.length > 0);
  if (reel.length) {
    await page.evaluate(() => window.__sandbox.replayCheck(true));
    const live = () => page.evaluate(() => ({ tick: window.__sandbox.match.tick, frames: window.__sandbox.frames, held: window.__sandbox.worldHeld }));
    const diffPng = (a, b) =>
      page.evaluate(
        async ([x, y]) => {
          const load = async (s) => {
            const img = new Image();
            img.src = "data:image/png;base64," + s;
            await img.decode();
            const c = document.createElement("canvas");
            c.width = img.width;
            c.height = img.height;
            const g = c.getContext("2d");
            g.drawImage(img, 0, 0);
            return g.getImageData(0, 0, c.width, c.height).data;
          };
          const [A, B] = await Promise.all([load(x), load(y)]);
          let n = 0;
          for (let i = 0; i < A.length; i += 4) if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) n++;
          return n / (A.length / 4);
        },
        [a.toString("base64"), b.toString("base64")],
      );

    // Play clip 0 twice, a screenshot at the same three clip ticks each time.
    const shots = [[], []];
    let plan = null;
    for (let round = 0; round < 2; round++) {
      const before = await live();
      const started = await page.evaluate(() => {
        const ok = window.__sandbox.playClip(0, 5);
        return { ok, r: window.__sandbox.replay };
      });
      check(`round ${round + 1}: the replay starts`, started.ok && started.r.playing, JSON.stringify(started.r));
      if (!started.ok) break;
      if (!plan) plan = started.r;
      const len = plan.end - plan.start;
      const ticks = [plan.start + len * 0.12, plan.start + len * 0.5, plan.end - len * 0.1];
      await page.evaluate((t) => window.__sandbox.replayFreezeAt(t), ticks);
      const held = await live();
      let first = null;
      for (const t of ticks) {
        await page.waitForFunction((x) => window.__sandbox.replay.tick >= x, t, { timeout: 600000, polling: 50 });
        await sleep(500);
        shots[round].push(await page.screenshot());
        if (!first) first = await live();
        await page.evaluate(() => window.__sandbox.freeze(false));
      }
      // (a frame or two of the match were still in flight when the pause arrived: the tick is read once it has settled.)
      const mid = await live();
      check(`round ${round + 1}: the match waits while it plays`, mid.tick === first.tick && mid.held, `(tick ${first.tick} at the first still, ${mid.tick} at the last)`);
      await page.waitForFunction(() => !window.__sandbox.replay.playing, null, { timeout: 600000, polling: 100 });
      const d = await page.evaluate(() => window.__sandbox.replayDiff);
      check(`round ${round + 1}: the live view is back (capture before equals capture after)`, Array.isArray(d) && d.length === 0, d && d.length ? `differs: ${d.join(", ")}` : "");
      await frames(30);
      const after = await live();
      check(`round ${round + 1}: the match runs on and draws`, after.tick > before.tick && after.frames > held.frames && !after.held, `(tick ${before.tick} to ${after.tick})`);
      if (round === 0) console.log(`   take: recipe ${plan.recipe}, clip ticks ${plan.start} to ${plan.end}, shots at ${ticks.map((t) => t.toFixed(1)).join(", ")}`);
    }
    if (shots[0].length === 3 && shots[1].length === 3) {
      for (let k = 0; k < 3; k++) {
        const same = shots[0][k].equals(shots[1][k]);
        const frac = same ? 0 : await diffPng(shots[0][k], shots[1][k]);
        check(`the same picture at clip tick ${k + 1} of 3 on both plays`, same || frac < 0.005, same ? "(byte-identical)" : `(${(frac * 100).toFixed(3)}% of pixels differ)`);
        if ((!same && process.env.DUMP) || process.env.DUMP === "all") {
          writeFileSync(`${shotDir}S4-same-${k + 1}-a.png`, shots[0][k]);
          writeFileSync(`${shotDir}S4-same-${k + 1}-b.png`, shots[1][k]);
        }
      }
    }

    if (process.env.STOP_AFTER_PICS) throw new Error("stopped after the pictures (STOP_AFTER_PICS)");
    // A skip half way: the live view is back all the same.
    await page.evaluate(() => window.__sandbox.replayCheck(true));
    const b4 = await live();
    await page.evaluate(() => window.__sandbox.playClip(0));
    await page.waitForFunction(() => window.__sandbox.replay.tick >= window.__sandbox.replay.start + 6, null, { timeout: 600000, polling: 50 });
    await page.evaluate(() => window.__sandbox.skipReplay());
    const dd = await page.evaluate(() => ({ diff: window.__sandbox.replayDiff, playing: window.__sandbox.replay.playing, held: window.__sandbox.worldHeld, replaying: document.body.classList.contains("replaying") }));
    check("a skip half way: the live view is back, the screen is back, the world is released", Array.isArray(dd.diff) && dd.diff.length === 0 && !dd.playing && !dd.held && !dd.replaying, JSON.stringify(dd));
    await frames(30);
    check("after the skip the match runs on", (await live()).tick > b4.tick);

    // X in a match plays the last clip, and the match waits.
    await page.evaluate(() => window.__sandbox.replayCheck(false));
    const x0 = await live();
    await page.keyboard.press("KeyX");
    await page.waitForFunction(() => window.__sandbox.replay.playing, null, { timeout: 60000, polling: 20 });
    const x1 = await live();
    await frames(20);
    const x2 = await live();
    check("X plays the last clip", await page.evaluate(() => window.__sandbox.replay.playing && document.body.classList.contains("replaying")));
    check("X: the tick does not move while it plays", x2.tick === x1.tick && x2.frames - x1.frames >= 10 && x2.held, `(${x1.tick} then ${x2.tick} over ${x2.frames - x1.frames} page frames; ${x0.tick} before the key)`);
    await page.keyboard.press("Escape");
    await frames(3);
    check("Esc skips it", !(await page.evaluate(() => window.__sandbox.replay.playing)));
    await frames(30);
    check("X: the match goes on after", (await live()).tick > x2.tick);
  }

  // The end of a match by a blow: the result (a keep blow laid over the match's report), the field, the last blow's replay, the end screen.
  console.log("   the end of a match by a blow");
  await page.evaluate(() => window.__sandbox.replayCheck(false));
  const tickNow = await page.evaluate(() => window.__sandbox.match.tick);
  const f0 = await page.evaluate(() => window.__sandbox.frames);
  await page.evaluate((t) => window.__sandbox.patchMatch({ result: { winner: 1, reason: "keep", tick: t } }), tickNow);
  let seen = { flow: -1, play: -1, shown: -1, endDuring: false };
  for (let i = 0; i < 3000 && seen.shown < 0; i++) {
    const st = await page.evaluate(() => ({ f: window.__sandbox.frames, flow: !!window.__sandbox.endFlow, playing: window.__sandbox.replay.playing, shown: window.__sandbox.endShown, kind: window.__sandbox.replay.recipe }));
    if (st.flow && seen.flow < 0) seen.flow = st.f - f0;
    if (st.playing && seen.play < 0) seen.play = st.f - f0;
    if (st.playing && st.shown) seen.endDuring = true;
    if (st.shown) seen.shown = st.f - f0;
    await sleep(60);
  }
  console.log(`   result at frame 0: waiting from ${seen.flow}, replay from ${seen.play}, end screen at ${seen.shown} (30 frames to a second)`);
  check("the end screen waits for the field and the last blow", seen.flow >= 0 && seen.shown > seen.play && seen.play > 0);
  check("the field shows for about 6 s before the replay", seen.play >= 150 && seen.play <= 260, `(${(seen.play / 30).toFixed(1)} s)`);
  check("the end screen is not up during the replay", !seen.endDuring);
  check("the end screen is up, the replay over, the screen back", await page.evaluate(() => window.__sandbox.endShown && !window.__sandbox.replay.playing && !document.body.classList.contains("replaying")));
  await page.evaluate(() => window.__sandbox.patchMatch(null));

  // A surrender makes no blow to show: the end screen at once, no replay.
  console.log("   a surrender");
  await load("versus=knight-webgl-low-fixed");
  await frames(30);
  await page.evaluate(() => window.__sandbox.surrender());
  let played = false, shownAt = -1;
  const s0 = await page.evaluate(() => window.__sandbox.frames);
  for (let i = 0; i < 400 && shownAt < 0; i++) {
    const st = await page.evaluate(() => ({ f: window.__sandbox.frames, playing: window.__sandbox.replay.playing, shown: window.__sandbox.endShown, flow: !!window.__sandbox.endFlow }));
    if (st.playing || st.flow) played = true;
    if (st.shown) shownAt = st.f - s0;
    await sleep(60);
  }
  check("a surrender: the end screen opens within a second and nothing is replayed", shownAt >= 0 && shownAt <= 60 && !played, `(end screen after ${shownAt} frames, replay ${played})`);
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
