// Online 1v1 and Versus AI in headless Chromium (M5). Two pages in one browser
// play each other through the local stand-in for the artifact room (#net=local:
// a BroadcastChannel): one hosts from the lobby, the other joins it, both
// ride guns, fire and build, and the lockstep's own hash check (every 2 s)
// must never find the two apart. Then a Versus AI match against the Knight
// must see the AI fire, build and send waves. Writes tools/.shots/online-*.png.
// Usage: node tools/online-check.mjs [seconds of online play, default 40]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const PORT = Number(process.env.PORT) || 5311;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(out, { recursive: true });
const secs = Number(process.argv[2] ?? 40);
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(hash, name) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${name}: ${m.text()}`);
  });
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html#${hash}`, { waitUntil: "load", timeout: 180000 });
      await page.waitForFunction(() => !!window.__sandbox, null, { timeout: 60000 });
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  return page;
}
const state = (page) =>
  page.evaluate(() => {
    const m = window.__sandbox.match;
    const line = document.getElementById("netline")?.textContent ?? "";
    return m ? { team: m.team, tick: m.tick, gold: m.gold, shots: m.shots, waves: m.waves, standing: m.standing, net: line } : { net: line, mode: window.__sandbox.mode };
  });

/** A click straight on the element (software rendering is too slow for Playwright's waits for frames). */
const click = (page, sel) => page.evaluate((q) => document.querySelector(q).click(), sel);

let failed = false;
const fail = (msg) => {
  failed = true;
  console.log(`FAIL ${msg}`);
};

// ---- two pages, one hosts and one joins ------------------------------------------------
const host = await open("net=local-webgl-low", "host");
const guest = await open("net=local-webgl-low", "guest");
await click(host, "#online-go");
await click(guest, "#online-go");
await host.waitForSelector("#online-host:not([disabled])", { state: "attached", timeout: 60000 });
await click(host, "#online-host");
await host.waitForSelector("#online-wait:not([hidden])", { state: "attached", timeout: 60000 });
const code = await host.textContent("#online-code");
console.log(`host is waiting in match ${code}`);
await guest.waitForSelector("#online-list li button:not([disabled])", { state: "attached", timeout: 60000 });
// (the list redraws now and then: a click that finds no button tries again)
await guest.evaluate(() => new Promise((done) => { const t = setInterval(() => { if (window.__sandbox.mode === "online") { clearInterval(t); done(); } else document.querySelector("#online-list li button:not([disabled])")?.click(); }, 700); }));
await host.waitForFunction(() => window.__sandbox.mode === "online" && !!window.__sandbox.match, null, { timeout: 120000 });
await guest.waitForFunction(() => window.__sandbox.mode === "online" && !!window.__sandbox.match, null, { timeout: 120000 });
const [a0, b0] = [await state(host), await state(guest)];
console.log("started", JSON.stringify(a0), JSON.stringify(b0));
if (a0.team !== 1 || b0.team !== 0) fail(`teams ${a0.team} and ${b0.team}, expected 1 (host) and 0 (guest)`);

// Each rides its long gun and fires at the other's keep; the guest builds a mill; both change their routes.
const aimFire = (page, yawOff) =>
  page.evaluate((off) => {
    const s = window.__sandbox;
    s.select(0);
    const team = s.match.team;
    s.aimAt(0, (team === 1 ? 0 : Math.PI) + off, 0.03);
    s.fire();
  }, yawOff);
await sleep(4000);
// 3.2: each side marks where its own shot lands and orders fire for effect at it (through the lockstep); neither sees the other's marks, and the hash check below must stay quiet.
// (The match's gun ids: the host's long gun is 0, the guest's 8.)
const markShot = async (page, x, z) => {
  await page.evaluate(([x, z]) => { window.__sandbox.select(0); if (!window.__sandbox.aimAtPoint(0, x, 0, z)) throw new Error("out of reach"); }, [x, z]);
  await page.waitForFunction(() => window.__sandbox.reload[window.__sandbox.match.team === 1 ? 0 : 8] === 0, null, { timeout: 90000, polling: 200 });
  // An earlier shot's landing may still be markable: let that window pass, so the mark is this shot's.
  await page.waitForFunction(() => window.__sandbox.register.canMark.length === 0, null, { timeout: 30000, polling: 100 });
  await page.evaluate(() => window.__sandbox.fire());
  // The page marks the landing itself the moment it may be marked (a round trip here can outlast the 5 s window on a slow machine).
  try {
  await page.waitForFunction(() => { const s = window.__sandbox; if (s.register.marks.length === 1) return true; if (s.register.canMark.some((id) => id === 0 || id === 8)) s.markHere(); return false; }, null, { timeout: 120000, polling: 50 });
  } catch (e) { console.log('mark wait failed', JSON.stringify(await page.evaluate(() => ({ can: window.__sandbox.register.canMark, nm: window.__sandbox.register.marks.length, view: window.__sandbox.view, reload: window.__sandbox.reload.slice(0, 10), team: window.__sandbox.match.team, tick: window.__sandbox.match.tick, shots: window.__sandbox.match.shots }))).slice(0, 700)); throw e; }
};
await markShot(host, 0, -62);
await markShot(guest, 0, -88);
const marks = (page) => page.evaluate(() => window.__sandbox.register.marks.map((m) => ({ n: m.n, x: Math.round(m.x), z: Math.round(m.z), place: m.place, bear: m.bear })));
const [hm, gm] = [await marks(host), await marks(guest)];
console.log("marks", JSON.stringify(hm), JSON.stringify(gm));
if (hm.length !== 1 || gm.length !== 1) fail(`each side should hold its own one mark, got ${hm.length} and ${gm.length}`);
else if (Math.abs(hm[0].z - gm[0].z) < 10) fail(`the two sides' marks are the same place (${hm[0].z}, ${gm[0].z}): one side sees the other's`);
for (const page of [host, guest]) {
  await page.waitForFunction(() => window.__sandbox.reload[window.__sandbox.match.team === 1 ? 0 : 8] === 0 && window.__sandbox.register.marks[0].bear > 0 && window.__sandbox.register.salvoReady === 0, null, { timeout: 90000, polling: 200 });
  await page.evaluate(() => window.__sandbox.orderSalvo(1));
}
for (const [who, page] of [["host", host], ["guest", guest]]) {
  try {
    await page.waitForFunction(() => window.__sandbox.register.salvoReady > 0 && window.__sandbox.register.salvoReady < 1200, null, { timeout: 60000, polling: 200 });
    console.log(`${who}: the salvo went in`);
  } catch {
    fail(`${who}: the salvo order never reached its match`);
  }
}
// S4: X replays nothing against a friend (the impact cam serves): no replay, the world not held, no note.
for (const p of [host, guest]) await p.keyboard.press("KeyX");
await sleep(800);
for (const [who, p] of [["host", host], ["guest", guest]]) {
  const x = await p.evaluate(() => ({ playing: window.__sandbox.replay.playing, held: window.__sandbox.worldHeld, note: document.getElementById("note")?.textContent ?? "" }));
  if (x.playing || x.held || /Nothing to replay/.test(x.note)) fail(`X did something online (${who}): ${JSON.stringify(x)}`);
}
await aimFire(host, 0);
await aimFire(guest, 0.01);
await guest.evaluate(() => window.__sandbox.input({ kind: "build", plot: 1, building: "mill" }));
await host.evaluate(() => window.__sandbox.setRoute("left"));
await guest.evaluate(() => window.__sandbox.setRoute("right"));
const t0 = Date.now();
while (Date.now() - t0 < secs * 1000) {
  await sleep(5000);
  await aimFire(host, (Math.random() - 0.5) * 0.04);
  await aimFire(guest, (Math.random() - 0.5) * 0.04);
  const [a, b] = [await state(host), await state(guest)];
  console.log(`host tick ${a.tick} shots ${a.shots} gold ${a.gold} | guest tick ${b.tick} | ${a.net} | ${b.net}`);
  if (/Out of step/.test(a.net) || /Out of step/.test(b.net)) {
    fail("the lockstep hash check found the two pages apart");
    break;
  }
}
await host.screenshot({ path: `${out}online-host.png` });
await guest.screenshot({ path: `${out}online-guest.png` });
const [a1, b1] = [await state(host), await state(guest)];
console.log("end", JSON.stringify(a1), JSON.stringify(b1));
if (Math.abs(a1.tick - b1.tick) > 60) fail(`the pages are ${Math.abs(a1.tick - b1.tick)} ticks apart`);
if (a1.tick < 600) fail(`only ${a1.tick} ticks played`);
if (!(a1.shots[1] > 0 && a1.shots[0] > 0)) fail(`shots ${a1.shots}: both sides should have fired`);
if (a1.gold[0] !== b1.gold[0] && Math.abs(a1.tick - b1.tick) < 2) fail(`gold differs at the same tick: ${a1.gold} and ${b1.gold}`);
await host.close();
await guest.close();

// ---- Versus AI: the Knight fires, builds and sends waves --------------------------------
const vs = await open("versus=knight-webgl-low", "versus");
await vs.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) >= 50 * 60, null, { timeout: 600000, polling: 500 });
const v = await vs.evaluate(() => {
  const m = window.__sandbox.match;
  return { tick: m.tick, shots: m.shots, spent: m.goldSpent, waves: m.waves, gold: m.gold, note: document.getElementById("mode-name")?.textContent };
});
console.log("versus", JSON.stringify(v));
if (!(v.shots[0] >= 4)) fail(`the Knight fired ${v.shots[0]} shots by hand in 50 s`);
if (!(v.spent[0] >= 150)) fail(`the Knight spent ${v.spent[0]} gold in 50 s`);
await vs.evaluate(() => window.__sandbox.look({ x: 8, y: 14, z: -6, tx: 0, ty: 12, tz: -15, fov: 45 }));
await sleep(2500);
await vs.screenshot({ path: `${out}online-versus-enemy-guns.png` });
await vs.close();

if (errors.length) {
  console.log("page errors:\n  " + errors.slice(0, 12).join("\n  "));
  failed = true;
}
await browser.close();
await server.close();
console.log(failed ? "online check FAILED" : "online check passed");
process.exit(failed ? 1 : 0);
