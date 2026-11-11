// Every control of the HUD does its job in a Versus AI match (headless
// Chromium): the command card's route, order and repair buttons and their keys
// (L, Ctrl+1 to 3, Alt+1 to 4), the Build button and B, the build menu's Close
// and Esc, the gun tabs (an empty slot opens the menu on it), the weapon card's
// lines, the sound button and M, Controls and H, the shot camera box and V, the
// overview (Tab), the "click to take the gun" hint, pause (P), the minimap growing
// on hover and while G is held, the impact cam (K turns it off and on; a long gun
// shot opens its inset and it closes after); 3.2: T marks where a shot landed, the chip, the salvo orders (F then a
// number, a chip click, the mortar toggle) and that no enemy mark is ever in MatchInfo. Each result is
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
page.setDefaultTimeout(120000);
// 3.2: the mark and salvo inputs the page sends to its worker (to see what an order carries).
await page.addInitScript(() => {
  const post = Worker.prototype.postMessage;
  window.__sent = [];
  Worker.prototype.postMessage = function (m, ...rest) {
    if (m && m.t === "input" && m.input && (m.input.kind === "mark" || m.input.kind === "salvo")) window.__sent.push(m.input);
    return post.call(this, m, ...rest);
  };
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
let failed = 0;
/** Wait (up to 15 s) for fn() in the page to be true. */
async function expect(name, fn, arg, timeout = 30000) {
  let ok = true;
  try { await page.waitForFunction(fn, arg, { timeout, polling: 100 }); } catch { ok = false; }
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
}
/**
 * Press T inside the page the moment a landing may be marked and its "T mark" label is up: a round trip to this
 * script can outlast the 5 s window on a slow machine. True once the page holds `want` marks (and saw the label).
 */
const markWhenLit = (want) => {
  const s = window.__sandbox;
  if (s.register.marks.length >= want) return window.__hintSeen === true;
  if (s.register.canMark.includes(0) && s.markHintShown && !window.__keyed) {
    window.__hintSeen = true;
    window.__keyed = true;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyT" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyT" }));
    setTimeout(() => (window.__keyed = false), 1500);
  }
  return false;
};
/**
 * Press keys inside the page, `gap` ms apart (a round trip to this script can outlast the 2 s that F waits for its number),
 * and report what the page showed after each: whether a salvo order is half typed, and the card's line.
 */
const typeInPage = (codes, gap = 600) =>
  page.evaluate(async ([codes, gap]) => {
    const out = [];
    for (const code of codes) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code }));
      await new Promise((r) => setTimeout(r, gap));
      out.push({ armed: window.__sandbox.salvoArmed, line: document.getElementById("salvo-line").textContent });
    }
    return out;
  }, [codes, gap]);
/** Step the game this many seconds at once (the test clock: #fixed) and wait until the page has heard it. */
const adv = async (seconds) => {
  const t = await page.evaluate((s) => { const w = window.__sandbox; const t = w.match?.tick ?? w.frame?.tick ?? 0; w.advance(s); return t + Math.round(s * 60); }, seconds);
  await page.waitForFunction((t) => { const w = window.__sandbox; return (w.match?.tick ?? w.frame?.tick ?? 0) >= t - 6; }, t, { timeout: 180000, polling: 100 });
};
const check = (name, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
};
const press = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
/** Load an address and wait for the world (Vite may reload the page once on the first visit). */
async function load(hash) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html#${hash}`, { waitUntil: "load" });
      await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
      return;
    } catch (e) { if (i === 2) throw e; }
  }
}
try {
  await load("versus=knight-webgl-low");
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 60, null, { timeout: 180000, polling: 200 });
  await expect("command card and scoreboard shown in a match", () => !document.getElementById("command").hidden && !document.getElementById("matchbar").hidden);
  // L0: the minimap is drawn, and grows to twice its size over the scene when pointed at, or while G is held.
  const mapW = () => page.evaluate(() => document.querySelector(".mapzoom").getBoundingClientRect().width);
  const smallW = await mapW();
  await expect("the minimap has drawn (its canvas is sized, draws are counted)", () => window.__sandbox.minimapMs.draws > 0 && document.getElementById("minimap").width > 100);
  const mb = await page.evaluate(() => { const b = document.getElementById("mapbox").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await page.mouse.move(mb.x, mb.y);
  await expect("pointing at the minimap grows it", () => window.__sandbox.mapBig && document.getElementById("mapbox").classList.contains("big"));
  await expect("it is about twice as wide, and its canvas follows (crisp at the larger size)", (w) => { const r = document.querySelector(".mapzoom").getBoundingClientRect(); const c = document.getElementById("minimap"); return r.width > w * 1.6 && c.width >= Math.round(r.width) - 2; }, smallW);
  await page.mouse.move(5, 5);
  await expect("moving away shrinks it back", (w) => !window.__sandbox.mapBig && Math.abs(document.querySelector(".mapzoom").getBoundingClientRect().width - w) < 2, smallW);
  await page.keyboard.down("KeyG");
  await expect("holding G grows it", () => window.__sandbox.mapBig && document.getElementById("mapbox").classList.contains("big"));
  await page.keyboard.up("KeyG");
  await expect("letting go of G shrinks it", () => !window.__sandbox.mapBig && !document.getElementById("mapbox").classList.contains("big"));
  await expect("the key help says what G does", () => /<dt>G<\/dt>/.test(document.getElementById("help").innerHTML));
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
  console.log("(match at", JSON.stringify(await page.evaluate(() => ({ s: Math.round(window.__sandbox.match.tick / 60), result: window.__sandbox.match.result?.reason ?? null, end: !document.getElementById("end").hidden }))), ")");
  const cam = await page.isChecked("#shotcam");
  await press("label.shotcam");
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
  await expect("the Knight's own marks (if it makes any) never reach this page: we marked nothing, the report holds none", () => window.__sandbox.match.marks.length === 0 && document.getElementById("marks-row").hidden);
  // ---- 3.2: marks and fire for effect (a Squire never marks, so any mark in the report would be an enemy's: there must be none but ours) ----
  await page.goto("about:blank");
  await load("versus=squire-webgl-low-fixed");
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 60, null, { timeout: 180000, polling: 200 });
  // Which gun tabs flashed (a class "firing" put on one), to see a salvo's guns fire in turn.
  await page.evaluate(() => {
    window.__fired = [];
    new MutationObserver((ms) => ms.forEach((m) => { if (m.target.classList.contains("firing")) window.__fired.push(m.target.dataset.weapon); })).observe(document.getElementById("weapons"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  const layShot = async (x, z) => {
    await adv(5);
    await page.evaluate(([x, z]) => { window.__sandbox.select(0); return window.__sandbox.aimAtPoint(0, x, 0, z); }, [x, z]);
    await page.waitForFunction(() => window.__sandbox.reload[0] === 0, null, { timeout: 60000, polling: 100 });
    await page.evaluate(() => window.__sandbox.fire());
  };
  await expect("no marks to start: the marks row is hidden, the controls list says T and F", () => window.__sandbox.match.marks.length === 0 && document.getElementById("marks-row").hidden && /T mark where your shot landed; F and a number: fire for effect/.test(document.getElementById("help").innerHTML));
  await page.keyboard.press("KeyT");
  await expect("T with nothing to mark says so and sends nothing", () => /Nothing to mark/.test(document.getElementById("note").textContent) && window.__sent.length === 0);
  await layShot(0, -62);
  await expect("after the landing the gun may be marked: the T mark label shows on it, and T marks it", markWhenLit, 1, 240000);
  await expect("the label reads T mark", () => /T mark/.test(document.getElementById("markhint").textContent));
  await expect("a mark 1 in the report, its place named, no landing to mark any more", () => { const r = window.__sandbox.register; return r.marks.length === 1 && r.marks[0].n === 1 && /bridge|Field|gate/i.test(r.marks[0].place) && !r.canMark.includes(0); });
  await expect("the order that went out is a mark input from gun 0", () => window.__sent.length === 1 && window.__sent[0].kind === "mark" && window.__sent[0].emplacement === 0);
  await expect("a chip appears in the command card with the number and the place, a ring that drains", () => { const c = document.querySelector("#chips .chip"); return !document.getElementById("marks-row").hidden && !!c && c.querySelector("b").textContent === "1" && c.querySelector(".pl").textContent.length > 3 && Number(c.style.getPropertyValue("--p")) > 0.9; });
  // A mark no gun bears on (whether the long gun is loaded again yet depends on the machine's speed, so the report is laid over).
  await page.evaluate(() => window.__sandbox.patchMatch({ marks: window.__sandbox.register.marks.map((m) => ({ ...m, bear: 0, bearM: 0 })) }));
  await expect("a mark no gun bears on: its chip is dimmed and says so", () => { const c = window.__sandbox.chips[0]; return c.dim && c.title === "No gun bears"; });
  const typed = await typeInPage(["KeyF", "Digit1"]);
  check("F starts a salvo order and the card asks which mark", typed[0].armed && /Which mark/.test(typed[0].line));
  check("a number for a mark no gun bears on sends nothing, says so, and did not switch the gun", !typed[1].armed && typed[1].line === "" && (await page.evaluate(() => window.__sent.length === 1 && /No gun bears/.test(document.getElementById("note").textContent) && document.getElementById("w-name").textContent === "Long gun")));
  await page.evaluate(() => window.__sandbox.patchMatch(null));
  await adv(6);
  await expect("with the real report back, once the long gun is loaded again the chip bears", () => { const c = window.__sandbox.chips[0]; return !c.dim && /Fire for effect at mark 1/.test(c.title); }, null);
  await expect("the mortar toggle starts off", () => document.getElementById("mortar-salvo").checked === false);
  const typed2 = await typeInPage(["KeyF", "KeyG"]);
  check("F then anything else cancels, and sends nothing", typed2[0].armed && !typed2[1].armed && (await page.evaluate(() => window.__sent.length === 1)));
  await typeInPage(["KeyF", "Digit1"], 400);
  await expect("F then 1 orders the salvo at mark 1, no mortar", () => window.__sent.length === 2 && window.__sent[1].kind === "salvo" && window.__sent[1].mark === 1 && window.__sent[1].mortar === undefined);
  await expect("the worker took it: the next salvo is under 20 s away, the chips show the seconds left", () => { const r = window.__sandbox.register; return r.salvoReady > 0 && r.salvoReady < 1200 && /^\d+ s$/.test(window.__sandbox.chips[0].sec); });
  await expect("the long gun's tab flashed as its gun fired in the salvo", () => window.__fired.includes("0"), null);
  await typeInPage(["KeyF", "Digit1"], 400);
  await expect("a second order inside the 20 s sends nothing", () => window.__sent.length === 2 && /Salvo ready in/.test(document.getElementById("note").textContent));
  await layShot(20, -58);
  await page.evaluate(() => { window.__hintSeen = false; });
  await expect("T marks it", markWhenLit, 2, 240000);
  await expect("two chips, numbered 1 and 2", () => window.__sandbox.chips.length === 2 && window.__sandbox.chips.map((c) => c.n).join() === "1,2" && document.querySelectorAll("#chips .chip").length === 2);
  await page.click("#mortar-salvo");
  await expect("the Mortar in the salvo toggle turns on", () => document.getElementById("mortar-salvo").checked === true);
  await adv(22);
  await expect("when the 20 s are up the chips drop the seconds", () => window.__sandbox.register.salvoReady === 0 && window.__sandbox.chips.every((c) => c.sec === ""), null);
  await expect("the long gun is loaded again", () => window.__sandbox.reload[0] === 0);
  await page.click('#chips .chip[data-n="2"]');
  await expect("a click on chip 2 orders the salvo at mark 2 with the mortar in it", () => { const l = window.__sent[window.__sent.length - 1]; return l.kind === "salvo" && l.mark === 2 && l.mortar === true; });
  await expect("no enemy mark in the report: only the two we made", () => window.__sandbox.match.marks.length === 2 && window.__sandbox.match.marks.every((m) => m.made > 0));
  // The marks show on the minimap (our team's colour) and in the overview, and a click in the overview on a mark orders the salvo.
  await page.evaluate(() => window.__sandbox.redrawMap());
  await expect("the minimap was asked to draw our two marks", () => window.__sandbox.minimapMs.draws > 0);
  await page.keyboard.press("Tab");
  await expect("in the overview a mark has a place on screen", () => window.__sandbox.view === "overview" && !!window.__sandbox.markPoint(1));
  const at = await page.evaluate(() => window.__sandbox.markPoint(1));
  await page.mouse.click(at.x, at.y);
  await expect("a click on mark 1 there is a salvo order (refused: the 20 s run, and it says so; nothing sent)", () => /Salvo ready in/.test(document.getElementById("note").textContent) && window.__sent.length === 4);
  await page.keyboard.press("Tab");
  // M6: the threat strip follows the enemy's first wave (a fresh match on the test clock: #fixed, frozen, stepped by hand).
  await page.goto("about:blank");
  await load("versus=knight-webgl-low-fixed");
  await page.evaluate(() => window.__sandbox.freeze(true));
  await page.waitForFunction(() => window.__sandbox.match != null, null, { timeout: 60000, polling: 100 });
  await expect("the threat strip is shown in Versus AI, three cells", () => !document.getElementById("threat").hidden && document.querySelectorAll("#threat .tc").length === 3);
  await page.evaluate(() => window.__sandbox.advance(5));
  await expect("the road cells are quiet and empty while nobody comes", () => [...document.querySelectorAll("#threat .tc")].every((c) => c.classList.contains("quiet") && c.querySelector(".tc-men").textContent === ""));
  // Step a second at a time until the enemy's first wave has set out.
  for (let k = 0; k < 120 && !(await page.evaluate(() => (window.__sandbox.match?.waves?.[0] ?? 0) >= 1)); k++) {
    const t = await page.evaluate(() => { window.__sandbox.advance(1); return window.__sandbox.match.tick + 60; });
    await page.waitForFunction((tick) => (window.__sandbox.match?.tick ?? 0) >= tick - 6, t, { timeout: 60000, polling: 100 });
  }
  await expect("the enemy's first wave has set out", () => (window.__sandbox.match?.waves?.[0] ?? 0) >= 1);
  await expect("its road's cell shows men, the other two stay quiet", () => {
    const cells = [...document.querySelectorAll("#threat .tc")];
    const busy = cells.filter((c) => Number(c.querySelector(".tc-men").textContent) > 0);
    return busy.length === 1 && Number(busy[0].querySelector(".tc-men").textContent) >= 4 && cells.filter((c) => c.classList.contains("quiet")).length === 2;
  });
  await page.evaluate(() => window.__sandbox.advance(20));
  await expect("its bar fills as the wave marches", () => [...document.querySelectorAll("#threat .tc:not(.quiet) .tc-bar u")].some((u) => Number((u.style.transform.match(/scaleX\(([\d.]+)\)/) ?? [0, 0])[1]) > 0));
  await expect("the strip says what it shows in a tooltip", () => document.getElementById("threat").title.length > 40);
  await page.keyboard.press("Tab");
  await expect("in the overview the wave is one mark with its count", () => window.__sandbox.view === "overview" && window.__sandbox.groupMarks.some((g) => g.team === 0 && g.n >= 4));
  // The Practice range has no matches to warn about: the strip stays hidden there.
  await page.goto("about:blank");
  await load("practice-webgl-low-fixed");
  await expect("the threat strip is hidden on the Practice range", () => document.getElementById("threat").hidden && getComputedStyle(document.getElementById("threat")).display === "none");
  // 3.2: the Practice range has marks and salvos with its four guns (the command card holds only the marks row there).
  await expect("the command card is hidden until there is a mark", () => document.getElementById("command").hidden);
  await adv(6);
  await page.evaluate(() => { window.__sandbox.select(0); return window.__sandbox.aimAtPoint(0, 0, 0, -62); });
  await page.waitForFunction(() => window.__sandbox.reload[0] === 0, null, { timeout: 60000, polling: 100 });
  await page.evaluate(() => window.__sandbox.fire());
  await expect("a landing on the range may be marked, and T marks it", markWhenLit, 1, 240000);
  await expect("T marks it on the range: the card shows only the marks row", () => !document.getElementById("command").hidden && document.querySelectorAll("#chips .chip").length === 1 && document.querySelector("#command [data-route]").offsetParent === null && document.getElementById("marks-row").offsetParent !== null);
  await expect("the long gun is loaded again, the chip bears", () => { const c = window.__sandbox.chips[0]; return !!c && !c.dim; });
  const before = await page.evaluate(() => window.__sent.length);
  await typeInPage(["KeyF", "KeyF"], 700);
  await expect("F twice orders a salvo at the newest mark on the range, and its worker took it", (before) => { const l = window.__sent[window.__sent.length - 1]; return window.__sent.length === before + 1 && l.kind === "salvo" && l.mark === 1 && window.__sandbox.register.salvoReady > 0 && window.__sandbox.register.salvoReady < 1200; }, before);
  // The impact cam: K turns it off and on, and a long gun shot opens its inset and closes it after the landing.
  // Software rendering holds the frame pacer at its lowest resolution, where the inset stays shut: ignore the pacer.
  await page.evaluate(() => window.__sandbox.impactIgnorePacer(true));
  await expect("the impact cam starts on, its inset closed", () => window.__sandbox.impact.enabled && document.getElementById("impact").hidden);
  await page.keyboard.press("KeyK");
  await expect("K turns the impact cam off", () => !window.__sandbox.impact.enabled);
  await page.keyboard.press("KeyK");
  await expect("K turns it back on", () => window.__sandbox.impact.enabled);
  await expect("the Controls panel lists K", () => [...document.querySelectorAll("#help dt")].some((d) => d.textContent === "K"));
  await page.evaluate(() => { window.__sandbox.select(0); window.__sandbox.aimAtPoint(0, 0, 6, -16.4); });
  await page.evaluate(() => window.__sandbox.fire());
  await expect("the inset opens after a long gun shot", () => !document.getElementById("impact").hidden && window.__sandbox.impact.shown, null, 120000);
  await expect("and closes after the landing", () => document.getElementById("impact").hidden && !window.__sandbox.impact.open, null, 120000);

  // Track V: the order line. Enter opens it (focused), "mill" builds a mill, "surrender" is refused, Esc closes it.
  await page.goto("about:blank");
  await load("versus=knight-webgl-low");
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 60, null, { timeout: 180000, polling: 200 });
  await expect("the order line is closed at first", () => document.getElementById("steward-row").hidden);
  await page.keyboard.press("Enter");
  await expect("Enter opens the order line, focused", () => !document.getElementById("steward-row").hidden && document.activeElement?.id === "steward-input");
  const taken0 = await page.evaluate(() => window.__sandbox.ownPlots.filter((p) => p.state !== 0).length);
  await page.keyboard.type("mill");
  await page.keyboard.press("Enter");
  await expect("the line closes after an order is sent, the answer shows", () => document.getElementById("steward-row").hidden && !document.getElementById("steward-answer").hidden);
  await expect("'mill' raises a building on a free plot of the player's", (n) => window.__sandbox.ownPlots.filter((p) => p.state !== 0).length > n, taken0, 20000);
  await page.keyboard.press("Enter");
  await page.keyboard.type("surrender");
  await page.keyboard.press("Enter");
  await expect("'surrender' is refused in words, the line stays open", () => /Not by words/.test(document.getElementById("steward-answer").textContent) && !document.getElementById("steward-row").hidden);
  await expect("and the match is not over", () => !window.__sandbox.match.result);
  await page.keyboard.press("Escape");
  await expect("Esc closes the line", () => document.getElementById("steward-row").hidden);
  await expect("the Controls panel lists Enter and the refused lines", () => [...document.querySelectorAll("#help dt")].some((d) => d.textContent === "Enter") && !document.getElementById("steward-refused-head").hidden);

} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  console.log(failed ? `${failed} failed` : "all passed");
  await browser.close();
  await server.close();
}
if (failed || errors.length) process.exit(1);
