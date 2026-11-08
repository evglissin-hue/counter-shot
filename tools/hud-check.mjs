// Every control of the HUD does its job in a Versus AI match (headless
// Chromium): the command card's route, order and repair buttons and their keys
// (L, Ctrl+1 to 3, Alt+1 to 4), the Build button and B, the build menu's Close
// and Esc, the gun tabs (an empty slot opens the menu on it), the weapon card's
// lines, the sound button and M, Controls and H, the shot camera box and V, the
// overview (Tab), the "click to take the gun" hint, pause (P). Each result is
// polled: software rendering draws a few frames a second and the HUD redraws
// every fourth frame. Exits 1 if anything fails.
// Usage: PORT=6205 node tools/hud-check.mjs
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const port = Number(process.env.PORT ?? 6205);
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 810 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
let failed = 0;
/** Wait (up to 15 s) for fn() in the page to be true. */
async function expect(name, fn, arg) {
  let ok = true;
  try { await page.waitForFunction(fn, arg, { timeout: 15000, polling: 100 }); } catch { ok = false; }
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
}
const press = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
try {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#versus=knight-webgl-low`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) { if (i === 2) throw e; }
  }
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 60, null, { timeout: 180000, polling: 200 });
  await expect("command card and scoreboard shown in a match", () => !document.getElementById("command").hidden && !document.getElementById("matchbar").hidden);
  await page.click('[data-route="left"]');
  await expect("Left button sets the route", () => window.__sandbox.match.route === "left");
  await page.keyboard.press("KeyL");
  await expect("L cycles the route", () => window.__sandbox.match.route === "centre");
  await page.click('[data-order="2"]');
  await expect("Push button gives the order", () => window.__sandbox.match.order === 2);
  await page.keyboard.press("Control+Digit2");
  await expect("Ctrl+2 holds", () => window.__sandbox.match.order === 1);
  await expect("the Hold button reads as pressed", () => document.querySelector('[data-order="1"]').getAttribute("aria-pressed") === "true");
  await page.click('[data-repair="walls"]');
  await expect("Walls button turns wall repairs off, and reads as off", () => window.__sandbox.match.repairs.walls === false && document.querySelector('[data-repair="walls"]').classList.contains("off"));
  await page.keyboard.press("Alt+Digit2");
  await expect("Alt+2 turns them back on", () => window.__sandbox.match.repairs.walls !== false);
  await page.keyboard.press("KeyB");
  await expect("B opens the build menu, with the gold in its head", () => !document.getElementById("build").hidden && /\d+ gold/.test(document.querySelector("#build .wheel-head")?.textContent ?? ""));
  await page.keyboard.press("Escape");
  await expect("Esc closes it", () => document.getElementById("build").hidden);
  await press("#build-btn");
  await expect("the Build button opens it", () => !document.getElementById("build").hidden);
  await page.dispatchEvent('#build [data-act="close"]', "pointerdown", { button: 0 });
  await expect("Close closes it", () => document.getElementById("build").hidden);
  await press('#weapons [data-weapon="1"]');
  await expect("the Mortar tab selects the mortar, its fuse shown", () => document.getElementById("w-name").textContent === "Mortar" && /Fuse/.test(document.getElementById("w-extra").textContent));
  await expect("the mortar's charge gauge shows", () => !document.getElementById("charge").hidden);
  await press('#weapons [data-weapon="4"]');
  await expect("an empty slot's tab opens the build menu on it", () => !document.getElementById("build").hidden && /Slot 5/.test(document.querySelector("#build p.small")?.textContent ?? ""));
  await expect("the empty slot's card says so", () => document.getElementById("w-name").textContent === "Empty slot");
  await page.dispatchEvent('#build [data-act="close"]', "pointerdown", { button: 0 });
  await expect("closed again", () => document.getElementById("build").hidden);
  await page.keyboard.press("Digit1");
  await expect("1 goes back to the long gun, its spin line back", () => document.getElementById("w-name").textContent === "Long gun" && /Spin/.test(document.getElementById("w-extra").textContent));
  const was = await page.getAttribute("#sound-btn", "aria-pressed");
  await page.keyboard.press("KeyM");
  await expect("M toggles the sound button (an icon)", (w) => document.getElementById("sound-btn").getAttribute("aria-pressed") !== w && document.getElementById("sound-btn").innerHTML.includes("<svg"), was);
  await press("#sound-btn");
  await expect("clicking it toggles back", (w) => document.getElementById("sound-btn").getAttribute("aria-pressed") === w, was);
  await page.keyboard.press("KeyH");
  await expect("H opens the Controls panel", () => !document.getElementById("help").hidden);
  await page.keyboard.press("KeyH");
  await expect("H closes it", () => document.getElementById("help").hidden);
  const cam = await page.isChecked("#shotcam");
  await page.click("label.shotcam");
  await expect("the Shot cam box toggles", (c) => document.getElementById("shotcam").checked !== c, cam);
  await page.keyboard.press("KeyV");
  await expect("V toggles it back", (c) => document.getElementById("shotcam").checked === c, cam);
  await page.keyboard.press("Tab");
  await expect("Tab goes to the overview, no click hint there", () => window.__sandbox.view === "overview" && document.getElementById("lock-hint").hidden);
  await page.keyboard.press("Tab");
  await expect("Tab comes back to the gun, the click hint with it (mouse free)", () => window.__sandbox.view === "sight" && !document.getElementById("lock-hint").hidden);
  await page.keyboard.down("KeyA");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyA");
  await expect("aiming with the keys dismisses it", () => document.getElementById("lock-hint").hidden);
  await expect("the masons' line has its full words in a tooltip", () => (document.getElementById("masons").title ?? "").length > 8);
  await page.keyboard.press("KeyP");
  await expect("P pauses (the badge shows)", () => !document.getElementById("paused").hidden);
  await page.keyboard.press("KeyP");
  await expect("P resumes", () => document.getElementById("paused").hidden);
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  console.log(failed ? `${failed} failed` : "all passed");
  await browser.close();
  await server.close();
}
if (failed || errors.length) process.exit(1);
