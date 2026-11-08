// Replays the scripted sandbox session and the scripted matches (the keep and the waves) in headless Chromium and checks that they
// match the hashes pinned from Node. Usage: node tools/browser-hash.mjs
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** The dev server's port (PORT in the environment overrides it, so several runs can share a machine). */
const PORT = Number(process.env.PORT) || 5199;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
let code = 1;
try {
  const page = await browser.newPage();
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/hash.html`, { waitUntil: "load" });
      await page.waitForSelector("#out[data-result]", { timeout: 180000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  const text = await page.textContent("#out");
  console.log(`Chromium: ${text}`);
  code = (await page.getAttribute("#out", "data-result")) === "match" ? 0 : 1;
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);
