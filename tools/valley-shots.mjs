// Screenshots of the valley from fixed camera spots, through the renderer test
// page (render-test.html: the renderer with fake frames, no sim), in headless
// Chromium on WebGL2. One page load, then each view is placed through the
// overview camera. Writes tools/.shots/valley-*.png and prints the renderer's
// stats per view.
// Usage: node tools/valley-shots.mjs [--quality=low|medium|high|ultra] [--tag=name] [views...]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split("=")[1];
const quality = opt("quality", "low");
/** Scene objects to hide by name (comma separated), to see what draws what. */
const hide = opt("hide", "");
const tag = opt("tag", quality);
const only = args.filter((a) => !a.startsWith("--"));
/** The dev server's port (PORT in the environment overrides it). */
const port = Number(process.env.PORT) || 5298;

/** name: [eye x, y, z, target x, y, z] (metres; the player's castle is at z = -150, the enemy's at 0). */
const VIEWS = {
  overview: [135, 72, -58, 0, 5, -75],
  "high-behind": [0, 120, -265, 0, 0, -55],
  sight: "sight",
  "stream-low": [-34, 4.5, -66, 14, -0.5, -77],
  "flank-bridge": [53, 8, -53, 48, -0.5, -71],
  observer: [6, 62, -112, 0, 0, -42],
  "valley-side": [30, 14, -146, 82, 8, -70],
  "enemy-side": [-40, 18, 30, -10, 2, -40],
  // Low eye, looking up the valley side: trees against the sky (look round L3).
  treeline: [20, 2.2, -100, 82, 24, -60],
  "stream-top": [14, 22, -84, 14, -1, -74],
  // The render test's staged pikemen: two pairs fighting, three battering the target gate.
  fight: [-0.5, 2.4, -36.5, -4.6, 1.1, -31],
  gate: [5, 3.2, -22, 0, 1.6, -16],
  // The render test's shots and stones into the stream by the centre bridge (splashes).
  splash: [4, 5, -86, 14, -0.6, -75],
  // M4 staged on the render test page: ladders at the target wall, masons at a hoist inside it, a storm ring.
  ladders: [17, 5.5, -31, 6.5, 4, -18],
  masons: [-3.4, 2.7, -9.4, -6.0, 1.3, -13.0],
  storm: [16, 34, -34, 0, 0, -6.5],
  // M3, staged by the render test: musketeers aiming and jabbing, sappers with kegs, a keg burning at the target wall,
  // and the target castle's plots (a barracks, a Foundry, a Powder Mill rising and one standing, two empty).
  muskets: [-14.5, 2.2, -43, -8, 1.2, -35],
  keg: [9.5, 2.0, -21.5, 6, 0.8, -16.6],
  courtyard: [0, 30, 26, 0, 0, -4],
  // Between the target's front wall and its front plots, looking at their gate sides: the barracks' door, banner and pikes; the Foundry's furnace and anvil.
  "courtyard-barracks": [-3.2, 3.0, -13.4, -6.8, 1.5, -10.4],
  "courtyard-foundry": [3.2, 3.0, -13.4, 6.8, 1.0, -10.4],
};

const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = async (n) => {
  const start = await page.evaluate(() => window.__test.state.frames);
  await page.waitForFunction((t) => window.__test.state.frames >= t, start + n, { timeout: 900000, polling: 100 });
};

try {
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/render-test.html?quality=${quality}&shot=1&dt=0.05${hide ? `&hide=${hide}` : ""}#webgl`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__test && window.__test.state.frames > 2, null, { timeout: 600000, polling: 200 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  // Tree geometry in the scene (instances x triangles per tree, all meshes named trees-* and cards-*), once.
  const treeStats = await page.evaluate(() => {
    const r = { treeTris: 0, treeInst: 0, cardTris: 0, cardInst: 0, meshes: 0 };
    window.__test.r.scene.traverse((o) => {
      if (!o.parent || o.parent.name !== "scatter" || !(o.isInstancedMesh || o.geometry.isInstancedBufferGeometry)) return;
      const g = o.geometry, tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      if (!o.isInstancedMesh) o = { name: o.name, count: g.instanceCount, geometry: g };
      if (o.name.startsWith("trees-")) { r.treeTris += tris * o.count; r.treeInst += o.count; r.meshes++; }
      if (o.name.startsWith("cards-")) { r.cardTris += tris * o.count; r.cardInst += o.count; r.meshes++; }
    });
    return r;
  });
  console.log(`tree stats (${quality}): ${JSON.stringify(treeStats)}`);
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(0)} s (${quality})`);
  for (const [name, v] of Object.entries(VIEWS)) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    await page.evaluate((v) => {
      const T = window.__test;
      if (v === "sight") {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
        return;
      }
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1" }));
      const views = T.r.views;
      T.r.setCamera({ mode: "overview" });
      views.controls.minDistance = 1;
      views.controls.maxDistance = 2000;
      views.controls.maxPolarAngle = Math.PI * 0.499;
      views.camera.position.set(v[0], v[1], v[2]);
      views.controls.target.set(v[3], v[4], v[5]);
      views.controls.update();
    }, v);
    await frames(4);
    await sleep(300);
    await page.screenshot({ path: `${out}valley-${tag}-${name}.png`, timeout: 300000 });
    const s = await page.evaluate(() => window.__test.r.getStats());
    console.log(`valley-${tag}-${name}: ${s.drawCalls} draws, ${s.triangles} triangles`);
  }
} finally {
  if (errors.length) console.log("page errors:\n  " + [...new Set(errors)].slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
