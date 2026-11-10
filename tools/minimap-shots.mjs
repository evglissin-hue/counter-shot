// Stills of the minimap (track L, round L0) at both sizes, in the states of the
// mock (docs/phase-3/minimap-mock.svg): a fresh match; a damaged wall, a wall
// half gone and a breach (real: shells from the long gun on the test clock, as
// siege-shots does, counted by the worker); a building rising (real: a build
// order); a ruin, a gun knocked out and a bridge down (laid over what the map
// draws from, as those states are slow to reach); a group of six or more
// (real: spawned men); a storm. Also the whole HUD with the map in place, and
// the time one draw takes. Writes tools/.shots/minimap-*.png (the small one is
// the real size, the "big" one is what hovering or holding G shows).
// Usage: PORT=5181 node tools/minimap-shots.mjs [names...]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const port = Number(process.env.PORT) || 5181;
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const want = (name) => !only.length || only.some((o) => name.includes(o));
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 810 }, deviceScaleFactor: Number(process.env.DPR) || 1 });
page.setDefaultTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sb = (fn, arg) => page.evaluate(fn, arg);

/** Step the match to game second t (the test clock) and let the page catch up. */
async function until(t) {
  const now = await sb(() => (window.__sandbox.match?.tick ?? 0) / 60);
  if (t > now) await sb((s) => window.__sandbox.advance(s), t - now);
  await page.waitForFunction((tick) => (window.__sandbox.match?.tick ?? 0) >= tick - 6, t * 60, { timeout: 600000, polling: 200 });
  await sleep(1500);
}
/** The minimap's canvas as a png (read off the canvas: a page screenshot of software rendering takes minutes). */
async function canvasShot(file) {
  const url = await sb(() => document.getElementById("minimap").toDataURL("image/png"));
  writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
}
/** The minimap at its real size, and at twice it (pointed at: hovering). */
async function pair(name) {
  if (!want(name)) return;
  await sleep(600);
  await canvasShot(`${out}minimap-${name}.png`);
  // (A raw mouse move: page.hover waits for frames, which software rendering gives a few a minute.)
  const r = await sb(() => { const b = document.getElementById("mapbox").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await page.mouse.move(r.x, r.y);
  await page.waitForFunction(() => window.__sandbox.mapBig, null, { polling: 100 });
  await sleep(1500);
  await canvasShot(`${out}minimap-${name}-big.png`);
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => !window.__sandbox.mapBig, null, { polling: 100 });
  console.log(`shot ${name}`);
}
const shares = () => sb(() => window.__sandbox.mapShares);
/** The enemy castle's (castle 0's) cells as "wall: share/foot ..." for the walls. */
async function report(label) {
  const a = await shares();
  if (!a) return console.log(label, "no shares yet");
  const names = ["front", "sideA", "sideB", "back"];
  const parts = names.map((n, w) => `${n} ${Array.from({ length: 6 }, (_, i) => `${a[(w * 6 + i) * 2]}/${a[(w * 6 + i) * 2 + 1]}`).join(" ")}`);
  console.log(label, "castle 0:", parts.join(" | "), `| gate ${a[48]} towers ${[49, 50, 51, 52].map((k) => a[k * 2]).join(",")} keep ${a[58]}`);
}
async function fireAt(yaw) {
  await sb((y) => window.__sandbox.aimAt(0, y, -0.022), yaw);
  for (let k = 0; k < 40; k++) {
    if ((await sb(() => window.__sandbox.reload[0])) === 0) break;
    await until((await sb(() => window.__sandbox.match.tick / 60)) + 2);
  }
  await sb(() => window.__sandbox.fire());
  await until((await sb(() => window.__sandbox.match.tick / 60)) + 4);
}

try {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#versus=knight-webgl-low-fixed`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) { if (i === 2) throw e; }
  }
  await page.waitForFunction(() => window.__sandbox.match != null, null, { timeout: 120000, polling: 200 });
  await sb(() => window.__sandbox.freeze(true));
  await until(3);
  await report("fresh");
  await pair("01-fresh");
  if (want("hud")) {
    await page.screenshot({ path: `${out}minimap-hud.png` });
    console.log("shot hud");
    console.log("at the map's right edge:", JSON.stringify(await sb(() => document.elementsFromPoint(innerWidth - 24, 250).map((e) => e.id || e.className))));
  }
  // (Only the fresh match and the HUD asked for: stop here.)
  if (only.length && only.every((o) => ["hud", "fresh"].some((k) => o.includes(k)))) throw "done";
  // A building rising (a mill on plot 1, your own castle: the map's bottom).
  await sb(() => window.__sandbox.input({ kind: "build", plot: 1, building: "mill" }));
  await until(8);
  await pair("02-rising");
  // Walls: shells at the foot of the enemy front wall, left of its gate as its owner sees it, one after another.
  const yaws = [-0.0707, -0.0707, -0.0624, -0.0624, -0.0788, -0.0788];
  for (let i = 0; i < yaws.length; i++) {
    await fireAt(yaws[i]);
    await report(`after shot ${i + 1}`);
    await pair(`03-wall-${i + 1}`);
  }
  // Men: a group of ten on the field, a wave and its count.
  await sb(() => { window.__sandbox.spawn(0, 9, 0, -60); window.__sandbox.spawn(1, 12, -30, -90); });
  await until((await sb(() => window.__sandbox.match.tick / 60)) + 3);
  await pair("04-groups");
  // Laid over what the map draws from: a ruin, a gun knocked out, a bridge down, a storm.
  await sb(() => {
    // [castle, plot, kind (0 barracks, 1 mill, 2 foundry), state (1 rising, 2 standing, 3 ruined), raised, health]
    const rows = [[0, 0, 0, 2, 1, 1], [0, 1, 1, 3, 0, 0], [0, 2, 2, 2, 1, 1], [1, 0, 0, 2, 1, 1], [1, 1, 1, 2, 1, 1], [1, 2, 2, 2, 1, 1], [1, 3, 1, 1, 0.5, 1]];
    const f = new Float32Array(rows.flat());
    window.__sandbox.patchMap({ plots: f, plotCount: rows.length, bridges: [true, true, false] });
  });
  await pair("05-ruin-bridge");
  await sb(() => {
    const g = new Float32Array(16 * 3);
    // Every gun at its place: your long gun ridden, a swivel out, the rest armed; theirs with one out and slots empty.
    const emp = window.__sandbox.guns;
    emp.forEach((e, i) => { g[i * 3] = e.x; g[i * 3 + 1] = e.z; g[i * 3 + 2] = i === 0 ? 1 : i === 3 ? 2 : i === 4 || i === 5 ? 3 : i === 10 ? 2 : i === 14 || i === 15 ? 3 : 0; });
    window.__sandbox.patchMap({ guns: g, gunCount: 16 });
  });
  await pair("06-guns");
  await sb(() => window.__sandbox.patchMap({ storm: [0.55, 0], stormOn: [true, false] }));
  await pair("07-storm");
  await sb(() => window.__sandbox.patchMap(null));
  // Cost: the draw's time as the page measured it over this run.
  console.log("draw ms", JSON.stringify(await sb(() => window.__sandbox.minimapMs)));
  // The whole HUD once more, with a wall hit.
  if (want("hud")) {
    await page.screenshot({ path: `${out}minimap-hud-late.png` });
    console.log("shot hud-late");
  }
} catch (e) {
  if (e !== "done") throw e;
} finally {
  if (errors.length) console.log("page errors:\n  " + [...new Set(errors)].slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
