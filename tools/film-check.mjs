// The film and the photo (show track, S5) in headless Chromium (WebGL2, Low, the test clock).
// A Versus AI match is fought on a tiny canvas until the reel holds a few clips; then
//  1. photo mode: in a replay (O, step the clip, the camera, the field of view, a picture, leave: the replay is where it was)
//     and in a waiting match (the user's pause; no stepping; the camera comes back); stills S5-photo-*.png;
//  2. the film mid-match: the title card, the clips in tick order, the live view equal after it (replayDiff empty);
//  3. the match ends (a surrender): the end screen's film buttons, the film through the Watch button, a skip half way
//     (Esc): the end screen comes back and the live view is equal;
//  4. stills of the title card and of a film frame with bars and caption (S5-film-title.png, S5-film-clip.png);
//  5. Save the film: a real file (ffprobe: video and audio streams), its length within 10 percent of the film's own clock,
//     then again with every page frame made slow by a busy wait (SLOW ms, default 150): the file still follows the game's clock.
// Usage: PORT=5186 node tools/film-check.mjs [parts: photo film still save slow]   (W and H: the stills' window, default 1280 by 720;
// FW and FH: the window for the rest, default 320 by 180; SCALE: the film's time scale for the tests, default 0.15; SLOW: ms, default 150;
// MAKE: longest game time spent making clips, default 240 s; NEED: clips wanted, default 4)
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PORT = Number(process.env.PORT) || 5186;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const want = (n) => !only.length || only.includes(n);
const W = Number(process.env.W) || 1280, H = Number(process.env.H) || 720;
const FW = Number(process.env.FW) || 320, FH = Number(process.env.FH) || 180;
const SCALE = Number(process.env.SCALE) || 0.15;
const SLOW = Number(process.env.SLOW) || 150;
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 192, height: 108 }, acceptDownloads: true });
page.setDefaultTimeout(600000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
};
const S = (fn, arg) => page.evaluate(fn, arg);
async function frames(n) {
  const start = await S(() => window.__sandbox.frames);
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 600000, polling: 50 });
}
async function until(fn, arg, timeout = 600000) {
  await page.waitForFunction(fn, arg, { timeout, polling: 100 });
}
async function load(hash) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto("about:blank");
      await page.goto(`http://127.0.0.1:${PORT}/index.html#${hash}`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      return;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
}
/** A still while game time stands: freeze, let a frame render, shoot, thaw. */
async function still(name) {
  await S(() => window.__sandbox.freeze(true));
  await sleep(1500);
  await page.screenshot({ path: `${out}S5-${name}.png` });
  await S(() => window.__sandbox.freeze(false));
  console.log(`shot S5-${name}`);
}

// ---- make clips ---------------------------------------------------------------------
await load("versus=knight-webgl-low-fixed");
await frames(20);
const NEED = Number(process.env.NEED) || 4, MAKE = Number(process.env.MAKE) || 240;
let reel = [];
for (let t = 0; t < MAKE; t += 4) {
  if (t % 12 === 0) {
    const mortar = (t / 12) % 2 === 1;
    await S(([slot, y]) => {
      const x = window.__sandbox;
      x.select(slot);
      if (x.aimAtPoint(slot, 0, y, 0)) x.fire();
    }, mortar ? [1, 1] : [0, 9]);
  }
  const t0 = await S(() => window.__sandbox.match.tick);
  await S(() => window.__sandbox.advance(4));
  await page.waitForFunction((tick) => (window.__sandbox.match?.tick ?? 0) >= tick, t0 + 4 * 60 - 30, { timeout: 600000, polling: 200 });
  await sleep(300);
  if (t % 16 === 12) {
    await S(() => window.__sandbox.flushRecorder());
    reel = await S(() => window.__sandbox.recorder.reel.map((c) => ({ kind: c.kind, score: c.score, tick: c.tick })));
    console.log(`   ${t + 4} s: ${reel.length} clips`);
    if (reel.length >= NEED) break;
  }
}
await S(() => window.__sandbox.flushRecorder());
reel = await S(() => window.__sandbox.recorder.reel.map((c) => ({ kind: c.kind, score: c.score, tick: c.tick })));
console.log(`   reel: ${reel.map((c) => `${c.kind}@${c.tick} (${c.score})`).join(", ")}`);
check("the reel holds clips", reel.length >= 2, `(${reel.length})`);
await page.setViewportSize({ width: FW, height: FH });
await frames(5);

const cam = () => S(() => window.__sandbox.camera);
const camDiff = (a, b) => Math.max(...["x", "y", "z", "fx", "fy", "fz", "fov"].map((k) => Math.abs(a[k] - b[k])));

// ---- 1. photo mode -------------------------------------------------------------------
if (want("photo")) {
  console.log("Photo mode in a replay");
  check("photo mode does nothing in a running match", await S(() => !window.__sandbox.photo(true)) && (await S(() => window.__sandbox.photoState)) === null);
  await S(() => window.__sandbox.replayCheck(true));
  check("a clip plays", await S(() => window.__sandbox.playClip(0, 8)));
  await until(() => window.__sandbox.replay.tick >= window.__sandbox.replay.start + 40);
  await page.keyboard.press("KeyO");
  await frames(2);
  let ps = await S(() => window.__sandbox.photoState);
  check("O in a replay enters photo mode", !!ps && ps.kind === "replay", JSON.stringify(ps));
  check("the HUD is off and the replay's bars are hidden", await S(() => document.body.classList.contains("photoing") && getComputedStyle(document.getElementById("replay")).visibility === "hidden"));
  check("the step hint is shown in a replay", ps && ps.stepHint);
  const t0 = ps.tick;
  await frames(5);
  ps = await S(() => window.__sandbox.photoState);
  check("the replay is paused while the photo is taken", Math.abs(ps.tick - t0) < 1e-6, `(${t0} then ${ps.tick})`);
  await S(() => window.__sandbox.photoStep(3));
  await frames(2);
  const t1 = (await S(() => window.__sandbox.photoState)).tick;
  check("three steps on move the replay 18 ticks", Math.abs(t1 - (t0 + 18)) < 1e-6, `(${t0} to ${t1})`);
  await S(() => window.__sandbox.photoStep(-5));
  await frames(2);
  const t2 = (await S(() => window.__sandbox.photoState)).tick;
  check("five steps back move it 30 ticks back", Math.abs(t2 - (t1 - 30)) < 1e-6, `(${t1} to ${t2})`);
  await page.keyboard.press("Period");
  await frames(2);
  const t3 = (await S(() => window.__sandbox.photoState)).tick;
  check("the period key steps on", Math.abs(t3 - (t2 + 6)) < 1e-6, `(${t2} to ${t3})`);
  const before = await S(() => window.__sandbox.photoState);
  await page.keyboard.down("KeyW");
  await frames(6);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("KeyE");
  await frames(4);
  await page.keyboard.up("KeyE");
  const moved = await S(() => window.__sandbox.photoState);
  check("WASD, Q and E move the free camera", Math.hypot(moved.x - before.x, moved.z - before.z) > 0.5 && moved.y > before.y + 0.3, `(${before.x.toFixed(1)},${before.y.toFixed(1)},${before.z.toFixed(1)} to ${moved.x.toFixed(1)},${moved.y.toFixed(1)},${moved.z.toFixed(1)})`);
  // (The photo panel wraps over the middle of a window this small: send the wheel to the canvas itself.)
  await S(() => document.getElementById("scene").dispatchEvent(new WheelEvent("wheel", { deltaY: 300, cancelable: true })));
  await frames(2);
  const wide = (await S(() => window.__sandbox.photoState)).fov;
  check("the wheel changes the field of view", Math.abs(wide - before.fov) > 1, `(${before.fov.toFixed(1)} to ${wide.toFixed(1)})`);
  await S(() => window.__sandbox.photoLook(0.4, -0.2));
  await page.setViewportSize({ width: W, height: H });
  await frames(3);
  await still("photo-replay");
  const pic = await S(() => window.__sandbox.savePhoto());
  check("a picture is saved: a PNG with bytes", !!pic && pic.type === "image/png" && pic.size > 2000, JSON.stringify(pic));
  await page.setViewportSize({ width: FW, height: FH });
  await frames(3);
  await page.keyboard.press("KeyO");
  await frames(2);
  check("O leaves photo mode", await S(() => window.__sandbox.photoState === null && !document.body.classList.contains("photoing") && window.__sandbox.replay.playing));
  const back = await S(() => window.__sandbox.replay.tick);
  check("the replay is back at the tick it was at", Math.abs(back - t0) < 8, `(${t0} before, ${back} after two frames)`);
  await until(() => !window.__sandbox.replay.playing);
  const d = await S(() => window.__sandbox.replayDiff);
  check("the live view is back after a replay with a photo taken in it", Array.isArray(d) && d.length === 0, d && d.length ? `differs: ${d.join(", ")}` : "");
  await S(() => window.__sandbox.replayCheck(false));
  check("the worker is released", await S(() => !window.__sandbox.worldHeld));

  console.log("Photo mode in a waiting match");
  await frames(30);
  const live = await cam();
  await page.keyboard.press("KeyP");
  await frames(3);
  await page.keyboard.press("KeyO");
  await frames(3);
  ps = await S(() => window.__sandbox.photoState);
  check("O in a paused match enters photo mode, with no clip to step", !!ps && ps.kind === "match" && !ps.stepHint, JSON.stringify(ps));
  await S(() => window.__sandbox.photoMove(-30, 14, -40));
  await S(() => window.__sandbox.photoLook(0.25, -0.1));
  await page.setViewportSize({ width: W, height: H });
  await frames(3);
  await still("photo-match");
  await page.setViewportSize({ width: FW, height: FH });
  await frames(3);
  await page.keyboard.press("Escape");
  await frames(3);
  check("Esc leaves photo mode", await S(() => window.__sandbox.photoState === null));
  await page.keyboard.press("KeyP");
  await frames(40);
  const after = await cam();
  check("the live camera is back where it was", camDiff(live, after) < 0.05, `(max difference ${camDiff(live, after).toFixed(4)})`);
}

// ---- 2. the film, mid-match ---------------------------------------------------------
if (want("film") || want("still") || want("save") || want("slow")) {
  console.log("The film");
  await S(() => window.__sandbox.replayCheck(true));
  const planned = await S((sc) => (window.__sandbox.playFilm(sc), window.__sandbox.film), SCALE);
  check("the film starts at its title card", planned.active && planned.phase === "title" && planned.held, JSON.stringify({ phase: planned.phase, count: planned.count, planned: planned.planned }));
  await until(() => window.__sandbox.film.phase === "clip");
  const idx = [];
  let seenCaption = false;
  while (await S(() => window.__sandbox.film.active)) {
    const f = await S(() => window.__sandbox.film);
    if (!idx.includes(f.index)) idx.push(f.index);
    if (f.phase === "clip" && f.overlay.caption && f.overlay.bars > 0.5) seenCaption = true;
    await sleep(60);
  }
  const done = await S(() => window.__sandbox.film);
  check("the film played every clip it chose, in the order they happened", done.played.length === Math.min(5, reel.length) && done.played.every((t, i) => i === 0 || t >= done.played[i - 1]), `(moment ticks ${done.played.join(", ")}; reel of ${reel.length})`);
  check("the bars and the caption were drawn on the film's overlay", seenCaption);
  check("the film ended and the worker is released", !done.active && !done.held && !(await S(() => document.body.classList.contains("replaying") || document.body.classList.contains("filming"))));
  const diff = await S(() => window.__sandbox.replayDiff);
  check("the live view is equal after the film", Array.isArray(diff) && diff.length === 0, diff && diff.length ? `differs: ${diff.join(", ")}` : "");
  console.log(`   film ran ${done.elapsed.toFixed(1)} s of game time in ${done.frames} frames; planned at most ${done.planned.toFixed(1)} s`);
  await S(() => window.__sandbox.replayCheck(false));

  // End the match: the end screen's film buttons.
  await S(() => window.__sandbox.input({ kind: "surrender" }));
  await S(() => window.__sandbox.advance(3));
  await until(() => window.__sandbox.endShown);
  const ended = await S(() => window.__sandbox.film);
  check("the end screen shows both film buttons", ended.buttons[0] && ended.buttons[1], `(${ended.status})`);
  console.log(`   status: ${ended.status}`);
  await S(() => window.__sandbox.replayCheck(true));
  await page.click("#end-film");
  await frames(2);
  const run = await S(() => window.__sandbox.film);
  check("the Watch the film button starts the film and closes the end screen", run.active && !run.endShown);
  await page.keyboard.press("Escape");
  await frames(3);
  const esc = await S(() => ({ film: window.__sandbox.film, diff: window.__sandbox.replayDiff }));
  check("Esc in the title card ends the film and the end screen comes back", !esc.film.active && esc.film.endShown && !esc.film.held);
  check("the live view is equal after the skip", Array.isArray(esc.diff) && esc.diff.length === 0, esc.diff && esc.diff.length ? `differs: ${esc.diff.join(", ")}` : "");

  await S((sc) => window.__sandbox.playFilm(sc), SCALE);
  await until(() => window.__sandbox.film.index >= 2 && window.__sandbox.replay.playing);
  await page.keyboard.press("Escape");
  await frames(3);
  const mid = await S(() => ({ film: window.__sandbox.film, diff: window.__sandbox.replayDiff, replay: window.__sandbox.replay }));
  check("Esc in the second clip ends the whole film", !mid.film.active && !mid.replay.playing && mid.film.endShown, `(stopped after ${mid.film.played.length} clips)`);
  check("the live view is equal after a skip half way", Array.isArray(mid.diff) && mid.diff.length === 0, mid.diff && mid.diff.length ? `differs: ${mid.diff.join(", ")}` : "");
  await S(() => window.__sandbox.replayCheck(false));
}

// ---- 3. stills ----------------------------------------------------------------------
if (want("still")) {
  console.log("Stills of the film");
  await page.setViewportSize({ width: W, height: H });
  await frames(3);
  await S(() => window.__sandbox.filmFreezeAt(1.2 * 0.5));
  await S(() => window.__sandbox.playFilm(0.5));
  await until(() => window.__sandbox.film.elapsed >= 0.55 && window.__sandbox.stats !== null);
  await sleep(1500);
  const t = await S(() => window.__sandbox.film);
  await page.screenshot({ path: `${out}S5-film-title.png` });
  console.log(`shot S5-film-title (phase ${t.phase}, ${t.elapsed.toFixed(2)} s)`);
  check("the title card is up", t.phase === "title" && t.overlay.card);
  await S(() => window.__sandbox.freeze(false));
  await S((at) => window.__sandbox.filmFreezeAt(at), 1.5 + 2.2);
  await until(() => window.__sandbox.film.elapsed >= 3.6 && window.__sandbox.film.phase === "clip");
  await sleep(2000);
  const c = await S(() => window.__sandbox.film);
  await page.screenshot({ path: `${out}S5-film-clip.png` });
  console.log(`shot S5-film-clip (clip ${c.index}, ${c.elapsed.toFixed(2)} s, bars ${c.overlay.bars.toFixed(2)}, caption ${JSON.stringify(c.overlay.caption)})`);
  check("a film frame has bars and a caption", c.phase === "clip" && c.overlay.bars > 0.5 && !!c.overlay.caption);
  await S(() => window.__sandbox.freeze(false));
  await S(() => window.__sandbox.skipFilm());
  await frames(3);
  await page.setViewportSize({ width: FW, height: FH });
  await frames(3);
}

// ---- 4. saving ---------------------------------------------------------------------
/** Read a saved film with ffprobe and ffmpeg. */
function probe(file) {
  const j = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,codec_name,nb_read_frames,width,height", "-of", "json", file], { encoding: "utf8" });
  const streams = j.status === 0 ? JSON.parse(j.stdout).streams : [];
  const v = streams.find((s) => s.codec_type === "video"), a = streams.find((s) => s.codec_type === "audio");
  // The container may lack a duration: decode it all and read the clock where it ends.
  const f = spawnSync("ffmpeg", ["-v", "info", "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const times = [...f.stderr.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)].map((m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  const mean = /mean_volume: (-?[\d.]+|-inf) dB/.exec(f.stderr);
  const span = (sel) => {
    const pk = spawnSync("ffprobe", ["-v", "error", "-select_streams", sel, "-show_entries", "packet=pts_time", "-of", "csv=p=0", file], { encoding: "utf8" });
    const pts = pk.stdout.split("\n").map((l) => Number(l.split(",")[0])).filter((n) => Number.isFinite(n));
    return { span: pts.length ? Math.max(...pts) - Math.min(...pts) : 0, n: pts.length };
  };
  const vs = span("v"), as = span("a");
  return { v, a, decoded: times.length ? times[times.length - 1] : 0, mean: mean ? mean[1] : null, vspan: vs.span, vframes: vs.n, aspan: as.span };
}

async function saveRun(label, file) {
  const t0 = Date.now();
  const r = await S((sc) => window.__sandbox.saveFilm(sc), SCALE);
  const wall = (Date.now() - t0) / 1000;
  check(`${label}: the film was recorded`, r.ok && r.size > 1000, JSON.stringify(r));
  if (!r.ok) return;
  const b = await S(() => window.__sandbox.filmBlob());
  writeFileSync(file, Buffer.from(b.base64, "base64"));
  const p = probe(file);
  console.log(`   ${label}: ${r.size} bytes ${b.type}, ${r.frames} film frames = ${r.seconds.toFixed(2)} s of game time, took ${wall.toFixed(1)} s of wall time`);
  console.log(`   ${label}: ffprobe video ${p.v ? `${p.v.codec_name} ${p.v.width}x${p.v.height}, ${p.v.nb_read_frames} frames` : "none"}, audio ${p.a ? p.a.codec_name : "none"}, decoded length ${p.decoded.toFixed(2)} s, video packets span ${p.vspan.toFixed(2)} s (${p.vframes}), audio packets span ${p.aspan.toFixed(2)} s, mean volume ${p.mean} dB`);
  check(`${label}: a real file with a video stream`, !!p.v && Number(p.v.nb_read_frames) > 5);
  check(`${label}: it has a sound stream, and the sound is not silence`, !!p.a && p.mean !== null && p.mean !== "-inf", `(mean ${p.mean} dB)`);
  const len = p.vspan + 1 / 25;
  check(`${label}: its length is within 10 percent of the film's own clock`, Math.abs(len - r.seconds) <= 0.1 * r.seconds, `(file ${len.toFixed(2)} s, film ${r.seconds.toFixed(2)} s, ${(((len - r.seconds) / r.seconds) * 100).toFixed(1)} percent)`);
  check(`${label}: the sound runs as long as the picture, within 10 percent`, !p.a || Math.abs(p.aspan - p.vspan) <= 0.1 * p.vspan + 0.1, `(sound ${p.aspan.toFixed(2)} s, picture ${p.vspan.toFixed(2)} s)`);
  console.log(`ROW ${label}: planned ${(await S(() => window.__sandbox.film.planned)).toFixed(2)} s, film clock ${r.seconds.toFixed(2)} s, picture ${(p.vspan + 0.04).toFixed(2)} s, sound ${p.aspan.toFixed(2)} s (${(((p.aspan - p.vspan) / p.vspan) * 100).toFixed(1)} percent over the picture), ${r.pauses} pauses over ${r.frames} frames, ${Math.round(r.late)} ms late`);
  const planned = await S(() => window.__sandbox.film.planned);
  check(`${label}: the film ran no longer than its plan`, r.seconds <= planned + 0.5, `(${r.seconds.toFixed(2)} s of ${planned.toFixed(2)} s planned)`);
  return { r, p, wall };
}

if (want("save")) {
  console.log("Save the film");
  await S(() => window.__sandbox.slowFrames(0));
  await S((ms) => window.__sandbox.audioTrim(ms), Number(process.env.TRIM) || 0);
  await saveRun("save", `${out}S5-film.webm`);
  check("the end screen is back after saving", await S(() => window.__sandbox.endShown));
}
if (want("slow")) {
  await S((ms) => window.__sandbox.audioTrim(ms), Number(process.env.TRIM) || 0);
  console.log(`Save the film on a machine too slow to draw it (${SLOW} ms added to every page frame)`);
  await S((ms) => window.__sandbox.slowFrames(ms), SLOW);
  const res = await saveRun("slow", `${out}S5-film-slow.webm`);
  await S(() => window.__sandbox.slowFrames(0));
  if (res) console.log(`   slow: wall time per film frame ${(res.wall / res.r.frames).toFixed(2)} s, the file's per frame ${(res.p.decoded / res.r.frames).toFixed(4)} s (a film frame is ${(1 / 25).toFixed(4)} s)`);
}

if (want("fast")) {
  console.log("Save the film on the fast path (the renderer's draw skipped: the picture is junk, the timing is real)");
  await S(() => window.__sandbox.slowFrames(0));
  await S(() => window.__sandbox.skipRender(true));
  await saveRun("fast", `${out}S5-film-fast.webm`);
  await S(() => window.__sandbox.skipRender(false));
}

if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
await browser.close();
await server.close();
if (failed) process.exitCode = 1;
