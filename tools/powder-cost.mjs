// What 3.3's powder pieces cost the renderer (headless Chromium, WebGL2, Low, test clock): the
// time of PowderView.update per frame (kegs, hoists, ropes), and the whole render() with the
// powder group shown against hidden, in the overview of a Versus AI match after 30 s of play
// (kegs standing, a hoist or two at work). Prints milliseconds per call.
// Usage: PORT=5185 node tools/powder-cost.mjs
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const port = Number(process.env.PORT) || 5185;
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(600000);
try {
  await page.goto(`http://127.0.0.1:${port}/index.html#versus=squire-webgl-low-fixed`, { waitUntil: "load" });
  await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 600000 });
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 30, null, { polling: 100 });
  await page.evaluate(() => window.__sandbox.advance(30));
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) >= 30 * 60, null, { polling: 200 });
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => window.__sandbox.view === "overview");
  const r = await page.evaluate(() => {
    const rd = window.__sandbox.renderer;
    const pv = rd.powderView;
    const N = 3000;
    let t0 = performance.now();
    for (let i = 0; i < N; i++) pv.update(1 / 60);
    const update = (performance.now() - t0) / N;
    const timeRender = (n) => {
      const t = performance.now();
      for (let i = 0; i < n; i++) rd.render(1 / 60);
      return (performance.now() - t) / n;
    };
    timeRender(5);
    const on = [], off = [];
    for (let k = 0; k < 6; k++) {
      pv.root.visible = true;
      on.push(timeRender(8));
      pv.root.visible = false;
      off.push(timeRender(8));
    }
    pv.root.visible = true;
    const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    return { updateMs: update, renderOnMs: med(on), renderOffMs: med(off), kegs: pv.stacks.count, hoists: pv.lifted.count };
  });
  console.log(JSON.stringify(r));
} finally {
  await browser.close();
  await server.close();
}
