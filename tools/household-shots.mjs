// Stills of the household's page (milestone 3.6) in a Versus AI match (headless Chromium, software WebGL, #webgl-low):
// the household panel open, the weapon card with a full crew, one man and none, a gun with two men and one with one man
// (the crews' look; the report is laid over the match's, as the stub's report is two at every gun), and the minimap's
// hollow ring for an uncrewed gun. Writes <out>/*.png (default tools/.shots/3.6).
// Usage: PORT=6320 node tools/household-shots.mjs [outDir]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = process.argv[2] ?? fileURLToPath(new URL("./.shots/3.6/", import.meta.url));
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 6320);
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const shot = (name, clip) => page.screenshot({ path: `${out}/${name}.png`, ...(clip ? { clip } : {}) });
const frames = (n) => page.evaluate(async (n) => { const f = window.__sandbox.frames; const t = performance.now(); while (window.__sandbox.frames < f + n && performance.now() - t < 60000) await new Promise((r) => setTimeout(r, 50)); }, n);
try {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#versus=squire-webgl-low`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) { if (i === 2) throw e; }
  }
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 60, null, { timeout: 180000, polling: 200 });
  // The report laid over the match's: a roster, and crews by gun: [men, level, replacements on the way].
  const lay = (per) => page.evaluate((per) => {
    const S = window.__sandbox, b = S.emplacementBase, n = S.guns.length;
    const st = (state, person, name, level) => ({ state, person, name, shots: 0, level, dueIn: -1 });
    const roster = {
      reserve: 4, max: 6, refillIn: 42 * 60, first: "guns", lost: 3,
      stations: [
        { kind: 0, index: b, seats: [st(5, 1, "Tam Greaves", 2), st(5, 2, "Wat Cole", 1)] },
        { kind: 0, index: b + 1, seats: [st(5, 3, "Hob Pike", 1), st(2, -1, "", 0)] },
        { kind: 0, index: b + 2, seats: [st(5, 7, "Jack Dunn", 0), st(5, 8, "Ned Ward", 0)] },
        { kind: 0, index: b + 3, seats: [st(1, -1, "", 0), st(1, -1, "", 0)] },
        { kind: 1, index: 0, seats: [st(5, 4, "Dick Mott", 1), st(5, 9, "Col Fenn", 1), st(5, 10, "Rob Hale", 0), st(2, -1, "", 0)] },
        { kind: 2, index: 0, seats: [st(5, 5, "Gib Rook", 1), st(5, 11, "Ivo Holt", 1), st(5, 12, "Kit Cobb", 1)] },
        { kind: 3, index: 0, seats: [st(5, 6, "Wilkin Parr", 1)] },
        { kind: 4, index: 0, seats: [st(5, 13, "Odo Slade", 1)] },
      ],
    };
    const crews = new Int8Array(n * 3);
    for (let i = 0; i < n; i++) { crews[i * 3] = 2; crews[i * 3 + 1] = 1; }
    for (const [k, v] of Object.entries(per)) crews.set(v, (b + Number(k)) * 3);
    S.patchMatch({ household: roster, crews });
  }, per);
  const camera = (slot) => page.evaluate((slot) => {
    const S = window.__sandbox, g = S.guns[S.emplacementBase + slot];
    const c = S.camera;
    // The gun you ride is under the sight; for the others look at the floor level of the first one.
    const gy = c.y - 1.1 + 3.2 * c.fy;
    const sgn = g.z < -75 ? 1 : -1;
    S.look({ x: g.x - 3.6 * sgn, y: gy + 2.2, z: g.z - 5 * sgn, tx: g.x, ty: gy - 0.9, tz: g.z - 1.2 * sgn, fov: 55 });
  }, slot);
  // The crews: two men at the first gun, one man at it, from beside it.
  await lay({ 0: [2, 2, 0] });
  await camera(0);
  await frames(10);
  await shot("crew-two-men");
  await lay({ 0: [1, 1, 1] });
  await frames(10);
  await shot("crew-one-man");
  await lay({ 0: [0, 0, 0] });
  await frames(10);
  await shot("crew-no-man");
  await page.evaluate(() => window.__sandbox.look(null));
  // The panel, with the whole screen.
  await lay({ 0: [2, 2, 0], 1: [1, 1, 1], 2: [2, 0, 0], 3: [0, 0, 0] });
  await frames(6);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ" })));
  await frames(6);
  await shot("panel-open");
  await shot("panel-open-crop", { x: 760, y: 360, width: 520, height: 360 });
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ" })));
  await frames(4);
  // The weapon card with two, one and no man.
  await shot("weapon-card-two", { x: 0, y: 520, width: 320, height: 200 });
  await lay({ 0: [1, 1, 1] });
  await frames(6);
  await shot("weapon-card-one", { x: 0, y: 520, width: 320, height: 200 });
  await lay({ 0: [0, 0, 0] });
  await frames(6);
  await shot("weapon-card-none", { x: 0, y: 520, width: 320, height: 200 });
  // The minimap with uncrewed guns in both castles.
  await page.evaluate(() => window.__sandbox.redrawMap());
  const box = await page.evaluate(() => { const b = document.getElementById("mapbox").getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  await shot("minimap-ring", box);
  console.log("shots in", out);
} finally {
  await browser.close();
  await server.close();
}
