// Stills of the machines (3.5, the look of them) in headless Chromium (WebGL2, Low, software
// rendering: a page takes 20 to 40 s to load, so the first load is retried). The Practice range
// (both castles: the bell on the back right tower, the crane by the masons' yard, the signal mast
// on the keep's roof, a spotter's tower on plot 7), with the plots' state and the minimap's
// organs laid over what the page draws from where a state is slow to reach. Writes
// tools/.shots/machines-*.png:
//   bell-far, bell-far-high, bell-ringing-far   the bell from the far castle's gate gun (13 m) and from higher, still and ringing
//   bell-close, bell-ringing-close              up close, still and swinging
//   crane-far, crane-far-high                   the crane over the front wall from the far castle
//   crane-close, crane-hook                     the wheel and the rope with its hook, from the yard
//   mast-far, mast-close                        the signal mast on the keep, pennant and flag in the wind
//   spotter-far, spotter-close, spotter-yours   the spotter's tower and the figure with a glass (theirs, up close, yours)
//   spotter-scaffold, spotter-scaffold-high     a spotter's tower rising (plot state laid over the frame's, the sim held)
//   tells-*                                     the Foundry's smoke, the mill's wheel, the magazine's kegs
//   minimap, minimap-big                        the organ signs, one organ down per castle
// Usage: PORT=6203 node tools/machines-shots.mjs [names...]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const port = Number(process.env.PORT ?? 6203);
const want = (name) => !only.length || only.some((o) => name.includes(o));
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const sb = (f, a) => page.evaluate(f, a);
const t0 = Date.now();

async function load(hash) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#${hash}`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      await page.addStyleTag({ content: "#lock-hint { display: none !important; }" });
      return;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
}
async function frames(n) {
  // A long wait runs in a small window (each frame, and so each game second, is quicker there).
  const long = n > 12;
  if (long) await page.setViewportSize({ width: 192, height: 108 });
  const start = await sb(() => window.__sandbox.frames);
  await page.waitForFunction((t) => window.__sandbox.frames >= t, start + n, { timeout: 600000, polling: 100 });
  if (long) await page.setViewportSize({ width: 1280, height: 720 });
}
/** n drawn frames (the sim's frame counter stands still while the sim is held). */
const rafs = (n) => sb((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res(null) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function shot(name, cam, n = 3, wait = 0, held = false) {
  if (!want(name)) return;
  await sb((c) => window.__sandbox.look(c), cam);
  if (wait) await frames(wait);
  await (held ? rafs(n + 2) : frames(n));
  await page.screenshot({ path: `${out}machines-${name}.png` });
  console.log(`shot ${name} ${Math.round((Date.now() - t0) / 1000)} s`);
}
const ring = (castle, s) => sb(([c, v]) => window.__sandbox.renderer.setBellRinging(c, v), [castle, s]);

async function practice() {
  await load("webgl-low-fixed");
  await sb(() => window.__sandbox.freeze(false));
  await frames(6);
  // Castle 0 (the target) has the bell at (15, 12..15.5, 15), the crane at (10.6..11.4, 0..10, -5.2), the mast on the keep's roof at (1.8, 20..26.4, 5),
  // a spotter's tower on plot 7 at (7.8, 0..14, 10.8). The far castle's gate gun looks from about (0, 13, -135) along +z.
  await ring(0, -1);
  await shot("bell-far", { x: 6, y: 14, z: -136, tx: 15, ty: 14, tz: 15, fov: 6 });
  await shot("bell-far-high", { x: 6, y: 20, z: -136, tx: 15, ty: 14, tz: 15, fov: 6 });
  await shot("bell-close", { x: 26, y: 17, z: 4, tx: 15, ty: 13.6, tz: 15, fov: 32 });
  await ring(0, 1);
  await frames(40);
  await shot("bell-ringing-far", { x: 6, y: 14, z: -136, tx: 15, ty: 14, tz: 15, fov: 6 });
  await shot("bell-ringing-close", { x: 26, y: 17, z: 4, tx: 15, ty: 13.6, tz: 15, fov: 32 });
  await ring(0, -1);
  await shot("crane-far", { x: 4, y: 14, z: -136, tx: 11, ty: 9, tz: -6, fov: 8 });
  await shot("crane-far-high", { x: 4, y: 22, z: -136, tx: 11, ty: 9, tz: -6, fov: 8 });
  // The wheel and the mast from inside the yard, looking east across it; and the hook from the front.
  await shot("crane-close", { x: 3.5, y: 4.2, z: -4.5, tx: 11, ty: 3.5, tz: -5.2, fov: 62 });
  await shot("crane-hook", { x: 9, y: 9, z: -13, tx: 11, ty: 8, tz: -8, fov: 45 });
  await shot("mast-far", { x: 0, y: 14, z: -136, tx: 1.8, ty: 24, tz: 5, fov: 8 });
  await shot("mast-close", { x: 8, y: 24, z: -4, tx: 1.8, ty: 24, tz: 5, fov: 42 });
  await shot("spotter-far", { x: 6, y: 14, z: -136, tx: 7.8, ty: 12.5, tz: 10.8, fov: 7 });
  await shot("spotter-close", { x: 20, y: 11, z: 0, tx: 7.8, ty: 11, tz: 10.8, fov: 44 });
  await shot("spotter-yours", { x: 22, y: 14, z: -146, tx: 7.8, ty: 10, tz: -160.8, fov: 44 });
  // The tells. From a gun on the far castle's tower (13 m) the front wall hides the yard below 9 m: only what stands tall shows
  // (the Foundry's smoke, the spotter, the mast, the crane, the bell). The mill's wheel and the magazine's kegs read from the
  // mortar's lob or the overview: from above the wall.
  await shot("tells-foundry", { x: 4, y: 14, z: -136, tx: 6, ty: 11, tz: -6, fov: 9 }, 3, 150);
  await shot("tells-aerial", { x: -6, y: 32, z: -62, tx: 0, ty: 2, tz: -2, fov: 38 }, 3);
  await shot("tells-foundry-close", { x: 14, y: 12, z: -2, tx: 5.3, ty: 9, tz: -6, fov: 50 }, 3, 150);
  await shot("tells-mill", { x: -3, y: 9, z: -3, tx: -11, ty: 2, tz: 5.6, fov: 50 });
  await shot("tells-magazine", { x: 3, y: 9, z: -9, tx: 9.3, ty: 1, tz: -1.9, fov: 50 });
}

async function overlays() {
  // The scaffold of a spotter's tower rising on your plot 7 (castle 1): the plot's state laid over the frame's, with the sim held.
  if (want("spotter-scaffold")) {
    await sb(() => window.__sandbox.freeze(true));
    for (const [share, name] of [[0.25, "spotter-scaffold"], [0.8, "spotter-scaffold-high"]]) {
      await sb((sh) => window.__sandbox.renderer.estate.setPlots(new Float32Array([1, 7, 4, 1, sh, 1]), 1), share);
      await shot(name, { x: 22, y: 14, z: -146, tx: 7.8, ty: 6, tz: -160.8, fov: 48 }, 3, 0, true);
    }
    await sb(() => window.__sandbox.freeze(false));
  }
  // The minimap with the organ signs, one organ down in each castle (laid over what it draws from; the Practice range's map shows what a match shows).
  if (want("minimap")) {
    await sb(() => {
      window.__sandbox.patchMap({
        match: true,
        organs: [[{ up: true }, { up: false }, { up: true }], [{ up: false }, { up: true }, { up: true }]],
        // [castle, plot, kind, state (1 rising, 2 standing, 3 ruined), raised, health]
        plots: new Float32Array([0, 0, 0, 2, 1, 1, 0, 1, 2, 2, 1, 1, 0, 5, 3, 2, 1, 1, 0, 7, 4, 2, 1, 1, 0, 6, 4, 3, 0, 0, 1, 0, 0, 2, 1, 1, 1, 5, 3, 2, 1, 1, 1, 7, 4, 2, 1, 1, 1, 6, 4, 1, 0.5, 1]),
        plotCount: 9,
      });
      window.__sandbox.redrawMap();
    });
    await rafs(3);
    const shotMap = async (name) => {
      const url = await sb(() => document.getElementById("minimap").toDataURL("image/png"));
      writeFileSync(`${out}machines-${name}.png`, Buffer.from(url.split(",")[1], "base64"));
      console.log(`shot ${name}`);
    };
    await shotMap("minimap");
    const r = await sb(() => {
      const b = document.getElementById("mapbox").getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.mouse.move(r.x, r.y);
    await page.waitForFunction(() => window.__sandbox.mapBig, null, { polling: 100 });
    await rafs(3);
    await shotMap("minimap-big");
    await page.mouse.move(5, 5);
  }
}

try {
  await practice();
  await overlays();
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
