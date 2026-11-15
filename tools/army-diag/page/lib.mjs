// Army diag (page): shared helpers. A Vite server on PORT, headless Chromium, and hooks that record every input the
// page sends its worker (window.__sent) and the order and route each match report carries (window.__rep, window.__reps).
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
export const root = fileURLToPath(new URL("../../../apps/game", import.meta.url));
export const shots = fileURLToPath(new URL("../../.shots/army-diag/", import.meta.url));
mkdirSync(shots, { recursive: true });
export const PORT = Number(process.env.PORT) || 5291;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function start() {
  const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port: PORT, host: "127.0.0.1" }, logLevel: "error" });
  await server.listen();
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  // Small by default: software rendering is the cost on a busy machine (stills set their own size).
  const context = await browser.newContext({ viewport: { width: Number(process.env.VW) || 480, height: Number(process.env.VH) || 360 } });
  await context.addInitScript(() => {
    window.__sent = [];
    window.__reps = [];
    window.__rep = null;
    window.__pad = null;
    // A gamepad the script can press (D-pad left 14 cycles the order, right 15 the route).
    const pads = navigator.getGamepads?.bind(navigator);
    navigator.getGamepads = () => (window.__pad ? [window.__pad] : pads ? pads() : []);
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (m, ...rest) {
      if (m && m.t === "input") window.__sent.push({ input: JSON.parse(JSON.stringify(m.input)), at: Math.round(performance.now()) });
      return post.call(this, m, ...rest);
    };
    const W = window.Worker;
    window.Worker = class extends W {
      constructor(u, o) {
        super(u, o);
        this.addEventListener("message", (e) => {
          const m = e.data;
          if (!m || m.t !== "frame" || !m.match) return;
          const i = m.match, last = window.__rep;
          window.__rep = { tick: i.tick, order: i.order, route: i.route, barracks: i.barracks ? Array.from(i.barracks) : null, team: i.team };
          if (!last || last.order !== i.order || last.route !== i.route) window.__reps.push({ tick: i.tick, order: i.order, route: i.route, at: Math.round(performance.now()) });
        });
      }
    };
    // Every time the HUD's pressed order or route button changes (to count flicker).
    window.__hud = [];
    const watch = () => {
      const cmd = document.getElementById("command");
      if (!cmd) return setTimeout(watch, 500);
      new MutationObserver(() => {
        const o = document.querySelector('#command [data-order][aria-pressed="true"]')?.dataset.order ?? null;
        const r = document.querySelector('#command [data-route][aria-pressed="true"]')?.dataset.route ?? null;
        const last = window.__hud[window.__hud.length - 1];
        if (!last || last.o !== o || last.r !== r) window.__hud.push({ o, r, at: Math.round(performance.now()) });
      }).observe(cmd, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch);
    else watch();
    // Steps run inside the page (round trips to the script are slow when software rendering holds the main thread).
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const key = (code, opts = {}, target = window) => {
      target.dispatchEvent(new KeyboardEvent("keydown", { code, key: opts.key ?? code, bubbles: true, cancelable: true, ...opts }));
      target.dispatchEvent(new KeyboardEvent("keyup", { code, key: opts.key ?? code, bubbles: true, cancelable: true, ...opts }));
    };
    const frames = () => window.__sandbox.frames;
    const waitFrames = async (n, ms = 60000) => { const f = frames(); const t = performance.now(); while (frames() < f + n && performance.now() - t < ms) await wait(50); };
    window.__diag = {
      key,
      async pad(b) {
        const mk = (on) => Array.from({ length: 17 }, (_, i) => ({ pressed: on && i === b, touched: on && i === b, value: on && i === b ? 1 : 0 }));
        window.__pad = { id: "diag pad", index: 0, connected: true, mapping: "standard", timestamp: performance.now(), axes: [0, 0, 0, 0], buttons: mk(true) };
        await waitFrames(2);
        window.__pad = { ...window.__pad, buttons: mk(false) };
        await waitFrames(2);
      },
      /** The order line: open it with Enter (if shut), put the text in, Enter on the field sends it. */
      async say(text) {
        const el = document.getElementById("steward-input");
        if (document.activeElement !== el) {
          key("Enter", { key: "Enter" });
          await wait(100);
        }
        if (document.activeElement !== el) return "the line did not open";
        el.value = text;
        key("Enter", { key: "Enter" }, el);
        await wait(50);
        return "";
      },
      /** Run steps: each does something, steps the match a little if it is stepped by hand, and waits for a report that satisfies `want`. */
      async run(steps, manual) {
        const out = [];
        for (const st of steps) {
          const t0 = window.__rep?.tick ?? 0;
          window.__sent = [];
          const hudMark = window.__hud.length;
          const at0 = performance.now();
          let err = "";
          try {
            if (st.click) document.querySelector(st.click).click();
            if (st.key) key(st.key, st.opts ?? {}, st.on ? document.querySelector(st.on) : window);
            if (st.say !== undefined) err = await window.__diag.say(st.say);
            if (st.pad !== undefined) await window.__diag.pad(st.pad);
            if (st.input) window.__sandbox.input(st.input);
            if (st.eval) await new Function(st.eval)();
          } catch (e) { err = String(e); }
          if (st.frames) await waitFrames(st.frames);
          let ok = !st.want;
          const until = performance.now() + (st.ms ?? 20000);
          let stepped = 0;
          while (st.want && performance.now() < until) {
            if (manual && performance.now() - at0 > 300 * (stepped + 1) && stepped < 6) { window.__sandbox.advance(0.1); stepped++; }
            const r = window.__rep;
            if (r && r.tick > t0 + 2 && new Function("r", `return ${st.want}`)(r)) { ok = true; break; }
            await wait(100);
          }
          if (manual && !stepped) window.__sandbox.advance(0.1);
          await waitFrames(2, 8000);
          const m = window.__sandbox.match;
          out.push({
            label: st.label, ok, err,
            sent: window.__sent.map((s) => s.input).filter((i) => i.kind !== "aim" && i.kind !== "man"),
            rep: window.__rep, page: m ? { order: m.order, route: m.route } : null,
            hud: { order: document.querySelector('#command [data-order][aria-pressed="true"]')?.dataset.order ?? null, route: document.querySelector('#command [data-route][aria-pressed="true"]')?.dataset.route ?? null },
            answer: document.getElementById("steward-answer")?.hidden ? "" : document.getElementById("steward-answer")?.textContent ?? "",
            note: document.getElementById("note")?.textContent ?? "",
            flips: window.__hud.slice(hudMark).map((f) => ({ ...f, at: f.at - Math.round(at0) })),
            view: window.__sandbox.view,
          });
        }
        return out;
      },
    };
  });
  const errors = [];
  const open = async (hash, name = "page") => {
    const page = await context.newPage();
    page.setDefaultTimeout(180000);
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name}: ${m.text()}`); });
    for (let i = 0; i < 3; i++) {
      try {
        await page.goto(`http://127.0.0.1:${PORT}/index.html#${hash}`, { waitUntil: "load", timeout: 180000 });
        await page.waitForFunction(() => !!window.__sandbox, null, { timeout: 180000, polling: 1000 });
        break;
      } catch (e) { if (i === 2) throw e; }
    }
    return page;
  };
  const stop = async () => {
    if (errors.length) console.log("page errors:\n  " + errors.slice(0, 12).join("\n  "));
    await browser.close();
    await server.close();
  };
  return { browser, context, open, stop, errors };
}

/** What the page shows and what the match reports, in one look. */
export const look = (page) =>
  page.evaluate(() => {
    const s = window.__sandbox, m = s.match;
    return {
      tick: m?.tick ?? null,
      rep: window.__rep,
      page: m ? { order: m.order, route: m.route } : null,
      hud: {
        order: document.querySelector('#command [data-order][aria-pressed="true"]')?.dataset.order ?? null,
        route: document.querySelector('#command [data-route][aria-pressed="true"]')?.dataset.route ?? null,
      },
      note: document.getElementById("note")?.textContent ?? "",
      answer: document.getElementById("steward-answer")?.hidden ? "" : document.getElementById("steward-answer")?.textContent ?? "",
      view: s.view,
    };
  });

/** Clear the record of inputs sent, then do something, then wait (up to ms) for a report that satisfies want(rep). */
export async function act(page, label, doit, want, ms = 25000) {
  const t0 = await page.evaluate(() => { window.__sent = []; window.__hudMark = window.__hud.length; return window.__rep?.tick ?? 0; });
  await doit();
  let ok = true;
  try {
    await page.waitForFunction(([w, t0]) => { const r = window.__rep; return !!r && r.tick > t0 + 2 && new Function("r", `return ${w}`)(r); }, [want, t0], { timeout: ms, polling: 100 });
  } catch { ok = false; }
  await sleep(600);
  const l = await look(page);
  const sent = await page.evaluate(() => window.__sent.map((s) => s.input).filter((i) => i.kind !== "aim" && i.kind !== "man"));
  const flips = await page.evaluate(() => window.__hud.slice(window.__hudMark));
  return { label, ok, sent, ...l, flips };
}

export const fmt = (r) =>
  `${r.ok ? "ok  " : "FAIL"} ${r.label.padEnd(44)} sent ${JSON.stringify(r.sent)} | match order ${r.rep?.order} route ${r.rep?.route} | HUD order ${r.hud.order} route ${r.hud.route} | ${(r.answer || r.note).slice(0, 60)}${r.err ? ` | ${r.err}` : ""}${r.flips.length > 1 ? ` | HUD changes ${JSON.stringify(r.flips.map((f) => `${f.o}/${f.r}@${f.at}ms`))}` : ""}`;

/** Press a pad button for long enough that a slow frame reads it, then let go. */
export async function padPress(page, button) {
  await page.evaluate((b) => {
    const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: i === b, touched: i === b, value: i === b ? 1 : 0 }));
    window.__pad = { id: "diag pad", index: 0, connected: true, mapping: "standard", timestamp: performance.now(), axes: [0, 0, 0, 0], buttons };
  }, button);
  const f0 = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((f) => window.__sandbox.frames > f + 2, f0, { timeout: 60000, polling: 50 });
  await page.evaluate(() => {
    window.__pad = { ...window.__pad, buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  });
  const f1 = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((f) => window.__sandbox.frames > f + 2, f1, { timeout: 60000, polling: 50 });
}

/** Type a line into the order line: Enter opens it (if shut), the text is typed, Enter sends it. */
export async function say(page, text) {
  const open = await page.evaluate(() => document.activeElement?.id === "steward-input");
  if (!open) {
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "steward-input", null, { timeout: 15000, polling: 100 }).catch(() => {});
  }
  await page.evaluate(() => (document.getElementById("steward-input").value = ""));
  await page.keyboard.type(text, { delay: 5 });
  await page.keyboard.press("Enter");
}

/** Upright men of a team out of their courtyard: [id, x, z, yaw, action] from the last frame drawn. */
export const men = (page, team) =>
  page.evaluate((team) => {
    const f = window.__sandbox.frame;
    if (!f) return [];
    const a = f.minions, out = [];
    for (let i = 0; i + 9 < a.length; i += 10) if (a[i + 6] === team) out.push([a[i], a[i + 1], a[i + 3], a[i + 4], a[i + 7]]);
    return out;
  }, team);

/** Step the match this many seconds at once and wait until the page has heard it. */
export async function adv(page, seconds) {
  const t = await page.evaluate((s) => { const w = window.__sandbox; const t = w.match?.tick ?? 0; w.advance(s); return t + Math.round(s * 60); }, seconds);
  await page.waitForFunction((t) => (window.__sandbox.match?.tick ?? 0) >= t - 6, t, { timeout: 600000, polling: 200 });
}

export async function shot(page, name, cam, wait = 3000) {
  const size = page.viewportSize();
  await page.setViewportSize({ width: 960, height: 540 });
  await page.evaluate((c) => window.__sandbox.look(c), cam ?? null);
  const f0 = await page.evaluate(() => window.__sandbox.frames);
  await page.waitForFunction((f) => window.__sandbox.frames > f + 3, f0, { timeout: 120000, polling: 100 }).catch(() => {});
  await sleep(wait);
  for (let i = 0; i < 3; i++) {
    try { await page.screenshot({ path: `${shots}${name}.png`, timeout: 120000 }); break; } catch { if (i === 2) console.log(`no screenshot ${name}`); }
  }
  await page.evaluate(() => window.__sandbox.look(null));
  if (size) await page.setViewportSize(size);
  console.log(`shot ${shots}${name}.png`);
}
