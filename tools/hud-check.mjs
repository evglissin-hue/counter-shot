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
  await expect("no marks to start: the marks row is hidden, the controls list says T and F", () => window.__sandbox.match.marks.length === 0 && document.getElementById("marks-row").hidden && /T: mark where your shot landed\. Guns nobody mans shoot true on marked ground\. F then its number: every gun that bears fires there\./.test(document.getElementById("help").innerHTML));
  await page.keyboard.press("KeyT");
  await expect("T with nothing to mark says so and sends nothing", () => /Nothing to mark/.test(document.getElementById("note").textContent) && window.__sent.length === 0);
  await layShot(-22, -62); // off the centre road: a salvo skips a gun with own men near the mark, and our waves walk that road
  await expect("after the landing the gun may be marked: the T mark label shows on it, and T marks it", markWhenLit, 1, 240000);
  await expect("the label reads T mark", () => /T mark/.test(document.getElementById("markhint").textContent));
  await expect("a mark 1 in the report, its place named, no landing to mark any more", () => { const r = window.__sandbox.register; return r.marks.length === 1 && r.marks[0].n === 1 && /bridge|Field|gate/i.test(r.marks[0].place) && !r.canMark.includes(0); });
  await expect("the order that went out is a mark input from gun 0", () => window.__sent.length === 1 && window.__sent[0].kind === "mark" && window.__sent[0].emplacement === 0);
  await expect("a chip appears in the command card with the number and the place, a ring that drains", () => { const c = document.querySelector("#chips .chip"); return !document.getElementById("marks-row").hidden && !!c && c.querySelector("b").textContent === "1" && c.querySelector(".pl").textContent.length > 3 && Number(c.style.getPropertyValue("--p")) > 0.9; });
  // A mark no gun bears on (whether the long gun is loaded again yet depends on the machine's speed, so the report is laid over).
  await page.evaluate(() => window.__sandbox.patchMatch({ marks: window.__sandbox.register.marks.map((m) => ({ ...m, bear: 0, bearM: 0, reach: 0, reachM: 0 })) }));
  await expect("a mark no gun bears on: its chip is dimmed and says so", () => { const c = window.__sandbox.chips[0]; return c.dim && c.title === "No gun bears"; });
  // Guns that reach the mark but are reloading: "Guns loading", not "No gun bears" (the chip and the refusal note).
  await page.evaluate(() => window.__sandbox.patchMatch({ marks: window.__sandbox.register.marks.map((m) => ({ ...m, bear: 0, bearM: 0, reach: 2, reachM: 2, loadS: 7, loadMS: 7 })) }));
  await expect("guns that only reload: the chip dims and reads Guns loading (7 s)", () => { const c = window.__sandbox.chips[0]; return c.dim && c.title === "Guns loading (7 s)"; });
  await page.evaluate(() => window.__sandbox.orderSalvo(1));
  await expect("ordering it says Guns loading and sends nothing", () => /Guns loading \(7 s\)/.test(document.getElementById("note").textContent) && window.__sent.length === 1);
  // Only the mortar reaches it, the toggle off.
  await page.evaluate(() => window.__sandbox.patchMatch({ marks: window.__sandbox.register.marks.map((m) => ({ ...m, bear: 0, bearM: 1, reach: 0, reachM: 1, loadS: 0, loadMS: 0 })) }));
  await expect("only the mortar bears: the chip says to tick Mortar in the salvo", () => { const c = window.__sandbox.chips[0]; return c.dim && c.title === "Only the mortar bears: tick Mortar in the salvo"; });
  await page.evaluate(() => window.__sandbox.orderSalvo(1));
  await expect("ordering it says so and sends nothing", () => /Only the mortar bears: tick Mortar in the salvo/.test(document.getElementById("note").textContent) && window.__sent.length === 1);
  // Bridge gangs: the command card's line.
  await page.evaluate(() => window.__sandbox.patchMatch({ marks: window.__sandbox.register.marks.map((m) => ({ ...m, bear: 0, bearM: 0, reach: 0, reachM: 0 })), gangs: [{ bridge: 0, state: 2, men: 2, progress: 0.4 }] }));
  await expect("a gang at work shows its road and its progress in the card", () => /^(Left|Right|Centre) bridge: gang at work 40%$/.test(window.__sandbox.gangsLine), null);
  await page.evaluate(() => window.__sandbox.patchMatch({ marks: window.__sandbox.register.marks.map((m) => ({ ...m, bear: 0, bearM: 0, reach: 0, reachM: 0 })), gangs: [{ bridge: 0, state: 1, men: 2, progress: 0 }], gold: [0, 0] }));
  await expect("a gang held with no gold says waiting for gold", () => /gang waiting \(60 gold\)$/.test(window.__sandbox.gangsLine), null);
  await page.evaluate(() => window.__sandbox.patchMatch({ marks: window.__sandbox.register.marks.map((m) => ({ ...m, bear: 0, bearM: 0, reach: 0, reachM: 0 })), gangs: [] }));
  await expect("no gangs: the line is gone", () => window.__sandbox.gangsLine === "", null);
  // The right-hand column with six marks and two gang lines (patched in): it fits under the top bar, the impact inset (shown by force) covers neither it nor the Controls panel.
  const keep = await page.evaluate(() => window.__sandbox.register.marks.map((m) => ({ ...m })));
  await page.evaluate(() => {
    const t = window.__sandbox.match.tick;
    const marks = [0, 1, 2, 3, 4, 5].map((i) => ({ n: i + 1, x: i * 9 - 20, y: 0, z: -60 - i * 12, made: t + i, left: 3000 - i * 300, life: 3600, place: ["Centre bridge", "Field 85 m", "Their gate", "Our gate", "Right bridge", "Field 120 m"][i], bear: i % 2, bearM: 1, reach: i % 2, reachM: 1, loadS: 0, loadMS: 0, why: "" }));
    window.__sandbox.patchMatch({ marks, gangs: [{ bridge: 0, state: 1, men: 2, progress: 0 }, { bridge: 2, state: 2, men: 2, progress: 0.4 }] });
    const st = document.createElement("style");
    st.id = "force-impact";
    st.textContent = ".impact { display: block !important; }";
    document.head.append(st);
  });
  await expect("six marks and two gang lines: six chips, two gang lines", () => document.querySelectorAll("#chips .chip").length === 6 && window.__sandbox.gangsLine.split("\n").length === 2);
  const lay = () => page.evaluate(() => {
    const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const side = r(".side"), top = r(".top"), im = r(".impact"), map = r("#mapbox"), cmd = r("#command"), chips = r("#chips");
    return { fits: side.t >= top.b && side.b <= innerHeight, chipsShown: chips.b <= cmd.b && chips.t >= cmd.t, mapOk: !hit(im, map) && !hit(im, cmd) && !hit(im, side)};
  });
  const l1 = await lay();
  check("the column fits under the top bar with all six chips inside the card", l1.fits && l1.chipsShown);
  check("the impact inset covers neither the minimap nor the command card", l1.mapOk);
  await page.evaluate(() => { document.getElementById("help").hidden = false; });
  await expect("with the Controls panel open the inset steps left of it", () => { const i = document.querySelector(".impact").getBoundingClientRect(), h = document.getElementById("help").getBoundingClientRect(); return i.right <= h.left; });
  await page.evaluate((keep) => { document.getElementById("help").hidden = true; document.getElementById("force-impact").remove(); window.__sandbox.patchMatch({ marks: keep, gangs: [] }); }, keep);
  const typed = await typeInPage(["KeyF", "Digit1"]);
  check("F starts a salvo order and the card asks which mark, up to the highest held", typed[0].armed && /^Which mark\? 1( to \d)?$/.test(typed[0].line));
  check("a number for a mark no gun bears on sends nothing, says so, and did not switch the gun", !typed[1].armed && typed[1].line === "F + number" && (await page.evaluate(() => window.__sent.length === 1 && /No gun bears/.test(document.getElementById("note").textContent) && document.getElementById("w-name").textContent === "Long gun")));
  await page.evaluate(() => window.__sandbox.patchMatch(null));
  await adv(6);
  await expect("with the real report back, once the long gun is loaded again the chip bears", () => { const c = window.__sandbox.chips[0]; return !c.dim && /Fire for effect at mark 1/.test(c.title); }, null);
  await expect("the mortar toggle starts off", () => document.getElementById("mortar-salvo").checked === false);
  const typed2 = await typeInPage(["KeyF", "KeyG"]);
  check("F then anything else cancels, and sends nothing", typed2[0].armed && !typed2[1].armed && (await page.evaluate(() => window.__sent.length === 1)));
  await typeInPage(["KeyF", "Digit1"], 400);
  await expect("F then 1 orders the salvo at mark 1, no mortar", () => window.__sent.length === 2 && window.__sent[1].kind === "salvo" && window.__sent[1].mark === 1 && window.__sent[1].mortar === undefined);
  await expect("the worker took it: the next salvo is under 20 s away, the Marks header shows the wait once and no chip carries it", () => { const r = window.__sandbox.register; return r.salvoReady > 0 && r.salvoReady < 1200 && /^Salvo in \d+ s$/.test(document.getElementById("salvo-line").textContent) && window.__sandbox.chips.every((c) => /^fades in \d+:\d\d$/.test(c.fade)); });
  await expect("the long gun's tab flashed as its gun fired in the salvo", () => window.__fired.includes("0"), null, 180000); // the guns fire nearest first over 1.5 s of game time: slow on the test clock under load
  await typeInPage(["KeyF", "Digit1"], 400);
  await expect("a second order inside the 20 s sends nothing", () => window.__sent.length === 2 && /Salvo ready in/.test(document.getElementById("note").textContent));
  await layShot(20, -58);
  await page.evaluate(() => { window.__hintSeen = false; });
  await expect("T marks it", markWhenLit, 2, 240000);
  await expect("two chips, numbered 1 and 2", () => window.__sandbox.chips.length === 2 && window.__sandbox.chips.map((c) => c.n).join() === "1,2" && document.querySelectorAll("#chips .chip").length === 2);
  await page.click("#mortar-salvo");
  await expect("the Mortar in the salvo toggle turns on", () => document.getElementById("mortar-salvo").checked === true);
  await adv(22);
  await expect("when the 20 s are up the header goes back to the keys", () => window.__sandbox.register.salvoReady === 0 && document.getElementById("salvo-line").textContent === "F + number", null);
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
  // The impact cam on a fresh range page with the real clock (the 3.2 checks above run on the test clock and leave shells in flight).
  await page.goto("about:blank");
  await load("practice-webgl-low");
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
  const shownBefore = await page.evaluate(() => window.__sandbox.impact.shownCount);
  await page.evaluate(() => window.__sandbox.fire());
  // Counted, not caught while open: on a slow page the inset can open and close between two polls.
  await expect("the inset opens after a long gun shot", (n) => window.__sandbox.impact.shownCount > n, shownBefore, 120000);
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

  // ---- 3.3: powder on the page (a Squire match on the test clock, the page at 1280x720 for the screenshots) ----
  await page.goto("about:blank");
  await page.setViewportSize({ width: 1280, height: 720 });
  await load("versus=squire-webgl-low-fixed");
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 30, null, { timeout: 180000, polling: 200 });
  const shots = "tools/.shots/powder";
  const { mkdirSync } = await import("node:fs");
  mkdirSync(shots, { recursive: true });
  const shot = (name, clip) => page.screenshot({ path: `${shots}/${name}.png`, ...(clip ? { clip } : {}) });
  const topBar = { x: 0, y: 0, width: 1280, height: 150 };
  const card = { x: 0, y: 520, width: 520, height: 200 };
  /** Lay a box's numbers over the report (box, size, cost, eta, hoist) for one emplacement. */
  const patchBox = (emp, v) => page.evaluate(([emp, v]) => {
    const m = window.__sandbox.match;
    const b = Float32Array.from(m.boxes);
    for (let k = 0; k < 5; k++) if (v[k] !== null) b[emp * 5 + k] = v[k];
    window.__sandbox.patchMatch({ boxes: b });
  }, [emp, v]);
  await expect("the report carries powder: both stores, a box for every emplacement, three boys a castle", () => { const m = window.__sandbox.match; return !!m.powder && m.powder.length === 2 && m.boxes.length === 16 * 5 && m.boys.length === 6 * 4; });
  await expect("#powder shows the stock and its rate by the gold", () => { const e = document.getElementById("powder"); return !e.hidden && /^\d+ \+\d\.\d\/s$/.test(document.getElementById("powder-text").textContent) && /^Powder: \d+ in the magazine \(holds 120\), \+0\.4 a second from the cellar and no mills$/.test(e.title) && !e.classList.contains("full"); });
  await expect("it sits by the gold, in the same row", () => { const g = document.getElementById("gold").getBoundingClientRect(), p = document.getElementById("powder").getBoundingClientRect(); return Math.abs(g.top - p.top) < 14 && p.left > g.right; });
  await shot("topbar-normal", topBar);
  await expect("the weapon card shows the long gun's box as 3 lit pips", () => { const p = document.getElementById("w-pips"); return !p.hidden && p.querySelectorAll("i").length === 3 && p.querySelectorAll("i.on").length === 3 && !p.classList.contains("dry"); });
  await shot("card-full", card);
  // The mortar holds two shells, the swivel six.
  await press('#weapons [data-weapon="1"]');
  await expect("mortar: 2 pips lit", () => document.querySelectorAll("#w-pips i").length === 2 && document.querySelectorAll("#w-pips i.on").length === 2);
  await press('#weapons [data-weapon="3"]');
  await expect("swivel: 6 pips lit", () => document.querySelectorAll("#w-pips i").length === 6 && document.querySelectorAll("#w-pips i.on").length === 6);
  await press('#weapons [data-weapon="0"]');
  // One shot left (patched in), then dry with a keg on its way: the card, the tab, the keg mark.
  await patchBox(0, [4, null, null, -1, -1]);
  await expect("a box with one shot left: 1 of 3 pips lit, the tab not dry", () => document.querySelectorAll("#w-pips i.on").length === 1 && !document.querySelector('#weapons [data-weapon="0"]').classList.contains("dry"));
  await shot("card-one-left", card);
  await patchBox(0, [0, null, null, 360, -1]);
  await expect("a dry box: no pips lit, the pips outlined as dry, the tab dims (class dry) with a keg mark (class kegged)", () => { const t = document.querySelector('#weapons [data-weapon="0"]'); return document.querySelectorAll("#w-pips i.on").length === 0 && document.getElementById("w-pips").classList.contains("dry") && t.classList.contains("dry") && t.classList.contains("kegged"); });
  await shot("card-dry", card);
  await shot("tabs-dry-keg", { x: 0, y: 4, width: 540, height: 52 });
  await page.evaluate(() => { const b = Float32Array.from(window.__sandbox.match.boxes); b[0 * 5 + 3] = -1; window.__sandbox.patchMatch({ boxes: b }); });
  await expect("no keg on its way: the keg mark goes, the tab stays dry", () => { const t = document.querySelector('#weapons [data-weapon="0"]'); return t.classList.contains("dry") && !t.classList.contains("kegged"); });
  await page.evaluate(() => window.__sandbox.patchMatch(null));
  // Magazine full, and the cellar form, laid over the report.
  await page.evaluate(() => { const m = window.__sandbox.match; const p = m.powder.map((x) => ({ ...x })); p[1] = { ...p[1], stock: 120, rate: 1.4 }; p[0] = { ...p[0], stock: 120, rate: 1.4 }; window.__sandbox.patchMatch({ powder: p }); });
  await expect("at the cap with powder still coming in it reads Magazine full, in amber, and says so once", () => { const e = document.getElementById("powder"); return document.getElementById("powder-text").textContent === "Magazine full" && e.classList.contains("full") && /Magazine full: powder made now is lost/.test(document.getElementById("note").textContent); });
  await shot("topbar-full", topBar);
  await page.evaluate(() => { const m = window.__sandbox.match; const p = m.powder.map((x) => ({ ...x })); p[1] = { stock: 24, cap: 30, rate: 0.4, magazine: -1, lost: 0 }; p[0] = { ...p[1] }; window.__sandbox.patchMatch({ powder: p }); });
  await expect("with no working magazine it reads the cellar form", () => document.getElementById("powder-text").textContent === "Cellar 24/30 +0.4/s" && /in the keep's cellar \(holds 30\)/.test(document.getElementById("powder").title));
  await shot("topbar-cellar", topBar);
  await page.evaluate(() => window.__sandbox.patchMatch(null));
  // The build menu: the Magazine (we have one) and Powder, with their states.
  await page.keyboard.press("KeyB");
  await expect("Magazine: greyed with You have one, its cost 140", () => { const r = [...document.querySelectorAll("#build .choice2")].find((b) => b.querySelector("b").textContent === "Magazine"); return !!r && r.classList.contains("no") && /You have one/.test(r.textContent) && /140/.test(r.textContent); });
  await expect("Powder, 20 for 60 gold: open, cost 60", () => { const r = [...document.querySelectorAll("#build .choice2")].find((b) => b.querySelector("b").textContent === "Powder, 20 for 60 gold"); return !!r && !r.classList.contains("no") && /60/.test(r.querySelector(".c").textContent); });
  await shot("build-menu");
  const why = (stock, cap, magazine, gold) => page.evaluate(([stock, cap, magazine, gold]) => { const m = window.__sandbox.match; const p = m.powder.map((x) => ({ ...x })); p[1] = { ...p[1], stock, cap, magazine }; p[0] = { ...p[1] }; window.__sandbox.patchMatch({ powder: p, gold: [gold, gold] }); }, [stock, cap, magazine, gold]);
  const powderRow = () => page.evaluate(() => { const r = [...document.querySelectorAll("#build .choice2")].find((b) => b.querySelector("b").textContent === "Powder, 20 for 60 gold"); return r ? { no: r.classList.contains("no"), d: r.querySelector(".d")?.textContent ?? "" } : null; });
  const waitRow = async (name, want) => { let got = null; for (let i = 0; i < 60; i++) { got = await powderRow(); if (got && got.no === want.no && got.d === want.d) break; await page.waitForTimeout(100); } check(`Powder choice ${name}: ${JSON.stringify(want)}`, !!got && got.no === want.no && got.d === want.d); };
  await why(50, 30, -1, 200);
  await waitRow("with no working magazine", { no: true, d: "Needs a working magazine" });
  await why(110, 120, 5, 200);
  await waitRow("with the magazine full", { no: true, d: "The magazine is full" });
  await why(50, 120, 5, 30);
  await waitRow("with the gold short", { no: true, d: "Not enough gold: 30 short" });
  await shot("build-menu-short");
  await why(50, 120, 5, 200);
  await waitRow("when it can be bought", { no: false, d: "Into the magazine at once" });
  await page.evaluate(() => window.__sandbox.patchMatch(null));
  await page.keyboard.press("Escape");
  await expect("closed again", () => document.getElementById("build").hidden);
  // The real thing: the swivel fired six times empties its box, and the dry note says why.
  await press('#weapons [data-weapon="3"]');
  await expect("the swivel is up, six pips lit", () => document.getElementById("w-name").textContent === "Swivel gun" && document.querySelectorAll("#w-pips i.on").length === 6);
  // The ridden gun is served first, so a keg comes while it fires: fire (two seconds apart on the test clock) until the box cannot pay, six shots at least.
  let fired = 0;
  for (; fired < 40; fired++) {
    if (await page.evaluate(() => { const b = window.__sandbox.match.boxes; return b[3 * 5] < b[3 * 5 + 2]; })) break;
    await page.waitForFunction(() => document.getElementById("w-reload").textContent === "Ready", null, { timeout: 60000, polling: 100 });
    await page.evaluate(() => window.__sandbox.fire());
    await adv(2.1);
  }
  check(`the swivel fired ${fired} shots (at least its six) before its box could not pay`, fired >= 6 && fired < 40);
  await expect("the swivel's box is empty: no pip lit, the tab dims", () => { const t = document.querySelector('#weapons [data-weapon="3"]'); return document.querySelectorAll("#w-pips i.on").length === 0 && document.getElementById("w-pips").classList.contains("dry") && t.classList.contains("dry"); });
  await expect("a boy is on his way with a keg: the tab carries the keg mark", () => document.querySelector('#weapons [data-weapon="3"]').classList.contains("kegged"), null, 60000);
  await page.evaluate(() => window.__sandbox.fire());
  await expect("firing the dry swivel says why: a boy is some seconds away (or on his way)", () => /^No powder at the swivel gun: a boy is (\d+ s away|on his way)$/.test(document.getElementById("note").textContent));
  await shot("dry-note");
  const shotsBefore = await page.evaluate(() => window.__sandbox.match.shots[1]);
  await page.evaluate(() => window.__sandbox.fire());
  await adv(0.5);
  await expect("nothing was fired: the shot count is where it was", (n) => window.__sandbox.match.shots[1] === n, shotsBefore);
  // The tip is the coach's (guided-check). Stock 0 says the magazine is empty.
  await page.evaluate(() => { const m = window.__sandbox.match; const p = m.powder.map((x) => ({ ...x })); p[1] = { ...p[1], stock: 0 }; const b = Float32Array.from(m.boxes); const o = 3 * 5; b[o] = 0; b[o + 3] = -1; b[o + 4] = -1; const y = Int16Array.from(m.boys); for (let i = 0; i < y.length; i += 4) if (y[i] === 1) y[i + 3] = -1; window.__sandbox.patchMatch({ powder: p, boxes: b, boys: y }); });
  await page.waitForTimeout(2200);
  await page.evaluate(() => window.__sandbox.fire());
  await expect("with the magazine empty and no boy sent: the magazine is empty", () => document.getElementById("note").textContent === "No powder at the swivel gun: the magazine is empty");
  await page.evaluate(() => window.__sandbox.patchMatch(null));
  // A magazine going up: the note and the log.
  await expect("#powder keeps reading after all that", () => !document.getElementById("powder").hidden);
  // The Practice range has no powder: no #powder, no pips, every gun fires.
  await page.goto("about:blank");
  await load("practice-webgl-low-fixed");
  await expect("the Practice range has no powder element showing and no pips", () => document.getElementById("powder").hidden && document.getElementById("w-pips").hidden);

} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  console.log(failed ? `${failed} failed` : "all passed");
  await browser.close();
  await server.close();
}
if (failed || errors.length) process.exit(1);
