// Screenshots of the siege (phase 2 M4) in a match against the AI in headless
// Chromium (WebGL2, Low) on the real clock: the player breaches the enemy
// wall with the long gun, the enemy's masons clear and rebuild it under their
// hoist, ladder crews carry ladders across the valley and raise them against
// a wall, the HUD shows the masons and the repair switches, and a surrender
// ends on the end screen. Writes tools/.shots/siege-*.png and prints the
// match at each shot.
// Usage: node tools/siege-shots.mjs [names...]   (PORT overrides the dev server's port)
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const port = Number(process.env.PORT) || 5196;
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !only.length || only.some((o) => name.includes(o));
const info = () =>
  page.evaluate(() => {
    const m = window.__sandbox.match;
    return m ? { t: (m.tick / 60).toFixed(1), gold: m.gold, masons: m.masons.map((x) => `${x.job || "-"} left ${x.left} hold ${x.hold} up ${x.up} laid ${x.laid}`), ladders: m.ladders, storm: m.storm, garrison: m.garrison, standing: m.standing, fallen: m.fallen } : null;
  });
async function until(t) {
  await page.waitForFunction((tick) => (window.__sandbox.match?.tick ?? 0) >= tick, t * 60, { timeout: 900000, polling: 200 });
}
async function shot(name, cam) {
  if (!want(name)) return;
  await page.evaluate((c) => window.__sandbox.look(c), cam ?? null);
  await sleep(2500);
  await page.screenshot({ path: `${out}siege-${name}.png` });
  console.log(`shot ${name}`, JSON.stringify(await info()));
}
/** Upright figures of the last frame: { id, x, y, z, team, action, unit }. */
const figures = () =>
  page.evaluate(() => {
    const f = window.__sandbox.frame;
    if (!f) return [];
    const a = f.minions, out = [];
    for (let o = 0; o + 9 < a.length; o += 10) out.push({ id: a[o], x: a[o + 1], y: a[o + 2], z: a[o + 3], team: a[o + 6], action: a[o + 7], unit: a[o + 9] });
    return out;
  });
const ladders = () =>
  page.evaluate(() => {
    const f = window.__sandbox.frame;
    if (!f) return [];
    const a = f.ladders, out = [];
    for (let o = 0; o + 9 < a.length; o += 10) out.push({ id: a[o], team: a[o + 1], state: a[o + 2], fx: a[o + 3], fy: a[o + 4], fz: a[o + 5], tx: a[o + 6], ty: a[o + 7], tz: a[o + 8] });
    return out;
  });

try {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#versus-webgl-low`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  // STORM_ONLY=1 skips straight to the staged storm.
  const stormOnly = !!process.env.STORM_ONLY;
  if (!stormOnly) await tour();
  await storm();
  console.log("log", JSON.stringify(await page.evaluate(() => window.__sandbox.matchLog)));
} finally {
  if (errors.length) console.log("page errors:\n  " + [...new Set(errors)].slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}

async function tour() {
  // Two long gun shots at the foot of the enemy front wall, left of its gate as its owner sees it.
  await until(4);
  await page.evaluate(() => {
    window.__sandbox.aimAt(0, -0.0707, -0.022);
  });
  await until(6);
  await page.evaluate(() => window.__sandbox.fire());
  await until(10.5);
  await page.evaluate(() => {
    window.__sandbox.aimAt(0, -0.0624, -0.022);
  });
  await until(11);
  await page.evaluate(() => window.__sandbox.fire());
  await until(15);
  await shot("01-breach", { x: -1, y: 6, z: -36, tx: -8, ty: 2.5, tz: -16, fov: 50 });
  await until(28);
  await shot("02-masons-inside", { x: -2.5, y: 6.5, z: -5.5, tx: -8, ty: 2, tz: -15, fov: 55 });
  await shot("03-hoist-from-outside", { x: -9, y: 5, z: -42, tx: -8, ty: 6, tz: -15, fov: 45 });
  await page.evaluate(() => window.__sandbox.look(null));
  await shot("04-hud", null);
  // The second waves carry ladders (they leave at 0:33): follow the player's crew.
  await until(52);
  let crew = (await figures()).filter((m) => m.unit === 2 && m.team === 1);
  if (crew.length) {
    const c = crew[0];
    await shot("05-ladder-crew", { x: c.x + 7, y: 4.5, z: c.z + 6, tx: c.x, ty: 1.2, tz: c.z, fov: 45 });
  }
  // Wait for a ladder to go up against either wall (up to 2:30), then look at it.
  let planted = null;
  for (let t = 60; t < 150 && !planted; t += 3) {
    await until(t);
    planted = (await ladders()).find((l) => l.state === 2) ?? null;
  }
  if (planted) {
    const side = planted.fz > -75 ? -1 : 1; // which way is out from that wall
    await until((await page.evaluate(() => window.__sandbox.match.tick)) / 60 + 4);
    await shot("06-ladder-up", { x: planted.fx + 9, y: 5, z: planted.fz + side * 9, tx: planted.fx, ty: 4.5, tz: (planted.fz + planted.tz) / 2, fov: 50 });
    await until((await page.evaluate(() => window.__sandbox.match.tick)) / 60 + 8);
    await shot("07-climbing", { x: planted.fx - 6, y: 9, z: planted.fz + side * 7, tx: planted.fx, ty: 5, tz: planted.tz, fov: 50 });
  } else console.log("no ladder went up");
  await page.keyboard.press("Tab");
  await sleep(500);
  await shot("08-overview", null);
  await page.keyboard.press("Tab");
}

async function storm() {
  if (process.env.SURRENDER) {
    await page.evaluate(() => window.__sandbox.surrender());
    await sleep(4000);
    await page.evaluate(() => window.__sandbox.look(null));
    await shot("09-end", null);
  } else {
    // A storm, staged (test tools only): a new breach right of the enemy gate (two shots at the foot of the wall),
    // two waves pushing through it, the meter, the ring, the end.
    const fireAt = async (yaw) => {
      await page.evaluate((y) => window.__sandbox.aimAt(0, y, -0.022), yaw);
      await page.waitForFunction(() => window.__sandbox.reload[0] === 0, null, { timeout: 120000, polling: 100 });
      await sleep(300);
      await page.evaluate(() => window.__sandbox.fire());
      await sleep(600);
    };
    await fireAt(0.0707);
    await fireAt(0.0624);
    await page.evaluate(() => window.__sandbox.giveOrder(2));
    await page.evaluate(() => {
      window.__sandbox.spawn(1, 8, 7.5, -26);
      window.__sandbox.spawn(1, 8, 7.5, -31);
    });
    await page.waitForFunction(() => (window.__sandbox.match?.storm?.[0] ?? 0) > 240 || !!window.__sandbox.match?.result, null, { timeout: 900000, polling: 250 });
    await page.evaluate(() => window.__sandbox.look(null));
    await shot("09-storm-hud", null);
    await shot("10-storm-ring", { x: 10, y: 24, z: -32, tx: 0, ty: 0, tz: -8, fov: 50 });
    await page.waitForFunction(() => !!window.__sandbox.match?.result, null, { timeout: 900000, polling: 250 });
    await sleep(4000);
    await page.evaluate(() => window.__sandbox.look(null));
    await shot("11-end", null);
  }
}
