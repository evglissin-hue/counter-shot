// Track S6: the match's log and replay files, in headless Chromium on the test
// clock (#fixed, #webgl-low). A Versus AI match gets a few shots and an order,
// about 45 s of game time; the replay is saved from the pause menu (a download)
// and by saveLog(); the file is opened with "Watch a replay" (the file picker)
// and run to its end: the worker's hash there must be the saved one, even though
// the page tries to fire and give orders during the replay (nothing reaches it).
// The bar's speed buttons change the worker's speed (ticks per game second), and
// files from other rules versions, other content and garbage are refused with
// their reasons shown in the menu.
// Usage: PORT=5190 node tools/replay-file-check.mjs
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT) || 5190;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
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
let failed = 0;
const ok = (name, cond) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}`);
  if (!cond) failed++;
};
const tickOf = () => page.evaluate(() => window.__sandbox.match?.tick ?? 0);
const advance = async (seconds) => {
  const want = (await tickOf()) + seconds * 60;
  await page.evaluate((s) => window.__sandbox.advance(s), seconds);
  await page.waitForFunction((t) => (window.__sandbox.match?.tick ?? 0) >= t - 20, want, { timeout: 300000, polling: 200 });
};
const ready = () => page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
const pick = (name, text) => page.setInputFiles("#replay-file", { name, mimeType: "application/json", buffer: Buffer.from(text) });
try {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#versus=knight-webgl-low-fixed`, { waitUntil: "load" });
      await ready();
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  // A few shots and an order, about 45 s of game time.
  for (let t = 0; t < 45; t += 5) {
    if (t % 10 === 0) {
      await page.evaluate(() => {
        const S = window.__sandbox;
        S.select(0);
        if (S.aimAtPoint(0, 0, 9, 0)) S.fire();
      });
    }
    if (t === 15) await page.evaluate(() => window.__sandbox.input({ kind: "order", order: 1 }));
    await advance(5);
  }
  await page.waitForTimeout(500);

  // Saved from the pause menu: a download named keepfall-replay-<date>.json.
  await page.evaluate(() => document.getElementById("menu-btn").click());
  await page.waitForSelector("#menu-save", { state: "visible" });
  const [download] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => document.getElementById("menu-save").click())]);
  const name = download.suggestedFilename();
  ok(`the pause menu saves a download (${name})`, /^keepfall-replay-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(name));
  await page.evaluate(() => document.getElementById("menu-back").click());

  const text = await page.evaluate(() => window.__sandbox.saveLog());
  const file = JSON.parse(text);
  const kinds = {};
  for (const e of file.inputs) kinds[e[3].kind] = (kinds[e[3].kind] ?? 0) + 1;
  console.log(`file: ${text.length} bytes, final tick ${file.final.tick}, hash ${JSON.stringify(file.final.hash)}, ${file.inputs.length} inputs ${JSON.stringify(kinds)}`);
  console.log(`setup: mode ${file.setup.mode}, difficulty ${file.setup.difficulty}, team ${file.setup.team}, rules ${file.setup.rulesVersion}/${file.setup.matchRulesVersion}, net ${file.setup.netVersion}, content ${file.setup.content}`);
  ok("the file has a few shots, the order and both teams' inputs", (kinds.fire ?? 0) >= 3 && (kinds.order ?? 0) >= 1 && file.inputs.some((e) => e[1] === 0));
  ok("the file ends at about 45 s", file.final.tick >= 45 * 60 - 30 && file.final.tick <= 50 * 60);

  // Watch it: through the file picker.
  await pick("replay.json", text);
  await page.waitForFunction(() => window.__sandbox.mode === "watch");
  await ready();
  ok("the bar shows", await page.evaluate(() => !document.getElementById("watch-bar").hidden));
  ok("the match bar (scoreboard) stays and the build panel goes", await page.evaluate(() => !document.getElementById("matchbar").hidden && document.getElementById("command").hidden));
  // Nothing the page does reaches the replay: a shot, an order and a surrender sent in are dropped.
  await page.evaluate(() => {
    const S = window.__sandbox;
    S.select(0);
    S.aimAtPoint(0, 0, 3, 0);
    S.fire();
    S.input({ kind: "order", order: 2 });
    S.input({ kind: "surrender" });
  });

  // The speed buttons: ticks per game second second at 1x, 2x and 4x (the worker's speed).
  const settle = async () => {
    let last = -1;
    for (;;) {
      const t = await tickOf();
      if (t === last) return t;
      last = t;
      await page.waitForTimeout(600);
    }
  };
  const rate = async (btn) => {
    if (btn) await page.click(`[data-watch-speed="${btn}"]`);
    const t0 = await settle();
    await page.evaluate(() => window.__sandbox.advance(1));
    await page.waitForFunction((t) => (window.__sandbox.match?.tick ?? 0) > t, t0, { timeout: 60000, polling: 100 });
    return (await settle()) - t0;
  };
  const r1 = await rate(null);
  const r2 = await rate(2);
  const r4 = await rate(4);
  console.log(`ticks in 1 s of test clock: 1x ${r1}, 2x ${r2}, 4x ${r4}`);
  ok("1x is 60 ticks a second", Math.abs(r1 - 60) <= 6);
  ok("2x doubles it", Math.abs(r2 - 120) <= 12);
  ok("4x quadruples it", Math.abs(r4 - 240) <= 24);
  ok("the speed button is pressed", await page.evaluate(() => document.querySelector('[data-watch-speed="4"]').getAttribute("aria-pressed") === "true" && window.__sandbox.watchBar.speed === 4));
  await page.click('[data-watch-speed="1"]');

  // To the end.
  const final = file.final.tick;
  for (let i = 0; i < 40 && !(await page.evaluate(() => window.__sandbox.watchEnd)); i++) {
    await page.evaluate(() => window.__sandbox.advance(5));
    await page.waitForTimeout(600);
  }
  const end = await page.evaluate(() => window.__sandbox.watchEnd);
  console.log("watchEnd", JSON.stringify(end), "saved", JSON.stringify(file.final));
  ok("the replay reaches the saved tick", !!end && end.tick === final);
  ok("watchEnd.ok is true (the hash is the saved match's)", !!end && end.ok === true && end.hash.state === file.final.hash.state && end.hash.world === file.final.hash.world);
  await page.waitForFunction(() => !document.getElementById("watch-end").hidden);
  const endText = await page.textContent("#watch-end");
  ok(`the bar says "End of the replay" (and not that it drifted): ${endText}`, endText === "End of the replay");
  ok("no end screen over a replay", await page.evaluate(() => document.getElementById("end").hidden));
  await page.evaluate(() => window.__sandbox.advance(2));
  await page.waitForTimeout(800);
  ok("the replay stands still at its end", (await tickOf()) === final);

  // Refusals, shown in the menu.
  await page.click("#watch-back");
  await page.waitForSelector("#replay-go", { state: "visible" });
  const refused = async (label, body, re) => {
    await pick("bad.json", body);
    await page.waitForFunction(() => !document.getElementById("replay-why").hidden);
    const why = await page.textContent("#replay-why");
    console.log(`refused (${label}): ${why}`);
    ok(`${label}: refused with its reason`, re.test(why));
    ok(`${label}: still in the replay (nothing started)`, (await page.evaluate(() => window.__sandbox.mode)) === "watch");
    await page.evaluate(() => (document.getElementById("replay-why").hidden = true));
  };
  const other = JSON.parse(text);
  other.setup.rulesVersion += 1;
  await refused("another rules version", JSON.stringify(other), new RegExp(`rules version ${file.setup.rulesVersion + 1} \\(this game runs ${file.setup.rulesVersion}\\)`));
  const other2 = JSON.parse(text);
  other2.setup.content = "deadbeef";
  await refused("other content", JSON.stringify(other2), /other content/);
  await refused("garbage", "this is not json at all", /This is not a Keepfall replay\./);
  const other3 = JSON.parse(text);
  other3.v = 9;
  await refused("another file version", JSON.stringify(other3), /another version of the game/);
  // And the good file still plays from the menu.
  await pick("replay.json", text);
  await page.waitForFunction(() => window.__sandbox.mode === "watch" && window.__sandbox.watchEnd === null);
  ok("a good file starts again from the menu", await page.evaluate(() => document.getElementById("menu").hidden));
} catch (e) {
  console.log("ERROR", e);
  failed++;
}
if (errors.length) {
  console.log("page errors:", errors.slice(0, 5));
  failed++;
}
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
