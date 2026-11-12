// Screenshots of 3.3's powder in the world (headless Chromium, WebGL2, Low, on the
// test clock: #fixed): a magazine with its kegs stacked under the lean-to (the start
// of a match: 40 charges, 4 kegs), a powder boy carrying a keg across the courtyard,
// the hoist at the long gun's foot (rope and keg halfway), the minimap's magazine
// tile with its stock bar, and the enemy magazine blowing (a mortar shell into it,
// framed from the overview). Writes tools/.shots/powder/*.png and prints what the
// page held at each shot.
// Usage: PORT=5181 node tools/powder-shots.mjs [names...]
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const out = fileURLToPath(new URL("./.shots/powder/", import.meta.url));
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const port = Number(process.env.PORT) || 5181;
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !only.length || only.some((o) => name.includes(o));
const wait = (fn, arg, timeout = 240000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const sb = (fn, arg) => page.evaluate(fn, arg);

async function load(hash) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#${hash}`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 240000 });
      await page.addStyleTag({ content: "#lock-hint { display: none !important; }" });
      return;
    } catch (e) { if (i === 2) throw e; }
  }
}
/** Wait for n more rendered frames (on the test clock each is 1/30 s of game time). */
async function frames(n) {
  const start = await sb(() => window.__sandbox.frames);
  await wait((t) => window.__sandbox.frames >= t, start + n);
}
/** Step the game this many seconds (the test clock) and wait until the page has heard it. */
async function adv(seconds) {
  const t = await sb((s) => { const w = window.__sandbox; const t = w.match?.tick ?? 0; w.advance(s); return t + Math.round(s * 60); }, seconds);
  await wait((t) => (window.__sandbox.match?.tick ?? 0) >= t - 6, t, 600000);
}
const powderNow = () => sb(() => {
  const m = window.__sandbox.match;
  return m ? { t: (m.tick / 60).toFixed(1), stock: m.powder?.map((p) => `${p.stock}/${p.cap} @plot ${p.magazine}`), hoisting: Array.from(m.boxes ?? []).reduce((a, v, i) => (i % 5 === 4 && v >= 0 ? [...a, `emp ${(i - 4) / 5}: ${v.toFixed(2)}`] : a), []) } : null;
});
async function shot(name, cam) {
  if (!want(name)) return;
  await page.setViewportSize({ width: 1280, height: 720 });
  await sb((c) => window.__sandbox.look(c), cam ?? null);
  await frames(4);
  await page.screenshot({ path: `${out}${name}.png` });
  console.log(`shot ${name}`, JSON.stringify(await powderNow()));
}
/** The boys of a castle in the last frame: [id, x, y, z, action, act] of unit 5 on a team. */
const boys = (team) => sb((tm) => {
  const f = window.__sandbox.frame;
  if (!f) return [];
  const r = [];
  for (let i = 0; i + 9 < f.minions.length; i += 10) if (f.minions[i + 9] === 5 && f.minions[i + 6] === tm) r.push([f.minions[i], f.minions[i + 1], f.minions[i + 2], f.minions[i + 3], f.minions[i + 7], f.minions[i + 8], f.minions[i + 4]]);
  return r;
}, team);

try {
  await load("versus=squire-webgl-low-fixed");
  await wait(() => (window.__sandbox.match?.tick ?? 0) > 30);
  await sb(() => window.__sandbox.freeze(false));

  // ---- the magazine at the start: 40 charges, 4 kegs, under the lean-to (our castle, z = -150) ----
  await adv(1);
  await shot("01-magazine-kegs", { x: 9, y: 5, z: -147, tx: 7.7, ty: 0.6, tz: -155.6, fov: 45 });

  // ---- fire the long gun a few times so the boys have errands ----
  await sb(() => { window.__sandbox.select(0); return window.__sandbox.aimAtPoint(0, 0, 0, -62); });
  for (let k = 0; k < (want("02") || want("03") || want("04") ? 4 : 0); k++) {
    await wait(() => window.__sandbox.reload[0] === 0, undefined, 300000).catch(() => {});
    await sb(() => window.__sandbox.fire());
    await adv(5);
  }

  // ---- a boy with a keg, and the hoist at the long gun's foot ----
  let gotCarry = !want("02-boy-carrying"), gotHoist = !want("03-hoist");
  for (let k = 0; k < 400 && !(gotCarry && gotHoist); k++) {
    await adv(0.4);
    const mine = await boys(1);
    const hoisting = await sb(() => {
      const b = window.__sandbox.match?.boxes;
      if (!b) return -1;
      for (let i = 0; i < 8; i++) if (b[i * 5 + 4] >= 0) return i;
      return -1;
    });
    if (!gotCarry) {
      const c = mine.find((b) => b[4] === 10);
      if (c) {
        gotCarry = true;
        const [, x, , z] = c;
        await shot("02-boy-carrying", { x: x + 1, y: 8, z: z + 3, tx: x, ty: 0.8, tz: z, fov: 40 });
      }
    }
    if (!gotHoist && hoisting === 0) {
      // Wait until the keg is about halfway up, then frame the foot of the wall.
      const share = await sb(() => window.__sandbox.match.boxes[4]);
      if (share >= 0.4 && share <= 0.6) {
        gotHoist = true;
        // The foot and the gun (the renderer's own numbers): the eye a few metres out from the foot, looking up the rope.
        const g = await sb(() => { const v = window.__sandbox.renderer.powderView; const e = v.emps[0], f = v.feet[0]; return { fx: f.x, fz: f.z, gx: e.x, gy: e.y, gz: e.z }; });
        const dx = g.fx - g.gx, dz = g.fz - g.gz, d = Math.hypot(dx, dz) || 1;
        await shot("03-hoist-long-gun", { x: g.fx + (dx / d) * 9 - (dz / d) * 3, y: 4, z: g.fz + (dz / d) * 9 + (dx / d) * 3, tx: (g.fx + g.gx) / 2, ty: g.gy * 0.45, tz: (g.fz + g.gz) / 2, fov: 62 });
      }
    }
  }
  await sb(() => window.__sandbox.freeze(false));
  if (!gotCarry || !gotHoist) console.log(`missed: carry ${gotCarry} hoist ${gotHoist}`);

  // ---- the minimap's magazine tile ----
  if (want("04-minimap")) {
    await sb(() => window.__sandbox.look(null));
    await sb(() => window.__sandbox.redrawMap());
    const url = await sb(() => document.getElementById("minimap").toDataURL("image/png"));
    writeFileSync(`${out}04-minimap.png`, Buffer.from(url.split(",")[1], "base64"));
    const r = await sb(() => { const b = document.getElementById("mapbox").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.move(r.x, r.y);
    await wait(() => window.__sandbox.mapBig);
    await sleep(1500);
    const big = await sb(() => document.getElementById("minimap").toDataURL("image/png"));
    writeFileSync(`${out}04-minimap-big.png`, Buffer.from(big.split(",")[1], "base64"));
    await page.mouse.move(5, 5);
    console.log("shot 04-minimap", JSON.stringify(await powderNow()));
  }

  // ---- the enemy magazine blowing: a mortar shell into it (castle 0, plot 5 at 9.3, 5.6) ----
  if (want("05-magazine-blows")) {
    // A small window while the sim runs and the charge is searched (a software renderer draws the mortar's view slowly); full size for the shots.
    await page.setViewportSize({ width: 256, height: 144 });
    await sb(() => {
      window.__sandbox.select(1);
      const c = document.getElementById("shotcam");
      if (c && c.checked) c.click();
    });
    const laid = await sb(() => window.__sandbox.aimAtPoint(1, 9.3, 1, 5.6));
    // The charge whose range is the distance to the magazine.
    const dist = await sb(() => { const e = window.__sandbox.renderer.powderView.emps[1]; return Math.hypot(9.3 - e.x, 5.6 - e.z); });
    let best = { level: 0.9, err: Infinity };
    for (let lv = 0.3; lv <= 1.0001; lv += 0.05) {
      await sb((l) => window.__sandbox.holdCharge(l), lv);
      await frames(1);
      const r = await sb(() => window.__sandbox.chargeRange);
      const range = typeof r === "number" ? r : r?.range ?? r?.max ?? NaN;
      if (Math.abs(range - dist) < best.err) best = { level: lv, err: Math.abs(range - dist) };
    }
    const coarse = best.level;
    best = { level: coarse, err: Infinity };
    for (let lv = coarse - 0.05; lv <= coarse + 0.0501; lv += 0.005) {
      await sb((l) => window.__sandbox.holdCharge(l), lv);
      await frames(1);
      const r = await sb(() => window.__sandbox.chargeRange);
      const range = typeof r === "number" ? r : r?.range ?? r?.max ?? NaN;
      if (Math.abs(range - dist) < best.err) best = { level: lv, err: Math.abs(range - dist) };
    }
    console.log("mortar laid:", laid, "distance", dist.toFixed(1), "charge", JSON.stringify(best));
    console.log("before", JSON.stringify(await powderNow()));
    // Shells until the magazine goes up (a shell has to come down inside it): the charge nudged each time.
    let blown = false;
    for (const nudge of [0, -0.003, 0.003, -0.006, 0.006, -0.009]) {
      if (blown) break;
      await wait(() => window.__sandbox.reload[1] === 0, undefined, 300000).catch(() => {});
      await sb(([l]) => { window.__sandbox.holdCharge(l); window.__sandbox.holdCharge(null); }, [best.level + nudge]);
      for (let k = 0; k < 40 && !blown; k++) {
        await adv(0.5);
        blown = await sb(() => (window.__sandbox.match?.powder?.[0].stock ?? 1) === 0 || window.__sandbox.match?.powder?.[0].magazine === -1);
      }
      console.log("shell", nudge, "blown:", blown);
    }
    await shot("05-magazine-blows", { x: 38, y: 24, z: -26, tx: 8, ty: 3, tz: 5, fov: 55 });
    await adv(2);
    await shot("05b-magazine-ruin", { x: 38, y: 24, z: -26, tx: 8, ty: 3, tz: 5, fov: 55 });
  }
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  await browser.close();
  await server.close();
}
if (errors.length) process.exit(1);
