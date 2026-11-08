// Renders every sandbox sound offline in headless Chromium and checks each is
// audible, does not clip and has no invalid samples. Usage: node tools/sound-check.mjs
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const port = Number(process.env.PORT ?? 5196); // PORT overrides it, so two checkouts can run at once
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
let code = 1;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/sound-test.html`, { waitUntil: "load" });
      await page.waitForSelector("#out[data-done]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  console.log(await page.textContent("#out"));
  const results = await page.evaluate(() => window.__sound);
  const bad = results.filter((r) => r.bad !== 0 || r.peak <= 0.002 || r.peak > 1.0);
  if (errors.length) console.log("page errors:\n  " + errors.join("\n  "));
  if (bad.length) console.log("FAILED: " + bad.map((r) => r.name).join(", "));
  else console.log("All sounds render, are audible, never clip and have no invalid samples.");
  code = bad.length || errors.length ? 1 : 0;
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);
