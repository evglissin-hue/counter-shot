// The guided match (phase 2 M6) in headless Chromium at 1100x810: the start menu
// lists "Guided match" first with its "Start here" tag; it starts the guided
// mode with the coach on step 1 and the checklist guide hidden; each of the ten
// steps advances when its condition is met (real key presses and clicks where
// practical; test hooks on window.__sandbox otherwise: patchMatch lays fields
// over the match report, e.g. the tutor's stage, a storm or a result); each
// step's highlights land on the elements it names and leave when it ends; the
// world marks show; Skip, Hide and "Show the guide" work; the guided end screen
// offers its buttons and "Versus AI: Squire" starts Versus AI at the Squire; no
// page errors. Screenshots go to tools/.shots/guided-*.png. Exits 1 on failure.
// Usage: PORT=6301 node tools/guided-check.mjs
import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../apps/game", import.meta.url));
const shots = fileURLToPath(new URL("./.shots/", import.meta.url));
mkdirSync(shots, { recursive: true });
const port = Number(process.env.PORT ?? 6301);
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 810 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failed++; };
/** Wait (up to 40 s) for fn() in the page to be true. */
async function expect(name, fn, arg, ms = 40000) {
  let ok = true;
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); } catch { ok = false; }
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
  return ok;
}
/** The elements carrying the coach's ring, as a sorted list of ids or data attributes. */
const lit = () => page.evaluate(() => [...document.querySelectorAll(".coach-hl")].map((e) => e.id || e.dataset.weapon || e.dataset.order || e.dataset.route || e.className).sort());
const stepIs = (n) => [`coach is on step ${n}`, (k) => window.__sandbox.coach.state.step === k && window.__sandbox.coach.state.phase === "ask", n - 1];
/** A screenshot (a slow page may need a second try). */
async function shot(name) {
  for (let i = 0; i < 3; i++) {
    try { await page.screenshot({ path: `${shots}${name}.png`, timeout: 120000 }); return; } catch (e) { if (i === 2) console.log("no screenshot " + name); }
  }
}
const press = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
/** Fields laid over the match report, merged call by call (null clears them; a key set to undefined is dropped). */
let laid = {};
const patch = (p) => {
  if (p === null) laid = {};
  else for (const [k, v] of Object.entries(p)) { if (v === undefined) delete laid[k]; else laid[k] = v; }
  return page.evaluate((x) => window.__sandbox.patchMatch(x), Object.keys(laid).length ? laid : null);
};
const hasRing = (sel) => [`${sel} carries the ring`, (s) => document.querySelector(s)?.classList.contains("coach-hl"), sel];
const noRing = (sel) => [`${sel} has no ring`, (s) => !document.querySelector(s)?.classList.contains("coach-hl"), sel];
async function load(hash) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`http://127.0.0.1:${port}/index.html${hash}`, { waitUntil: "load" });
      return;
    } catch (e) { if (i === 2) throw e; }
  }
}
async function guidedReady() {
  await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 60, null, { timeout: 180000, polling: 200 });
}
try {
  // ---- the start menu ----
  await load("#title-webgl-low");
  await page.waitForSelector("#menu:not([hidden])", { timeout: 60000 });
  await expect("the menu lists Guided match first", () => document.querySelector("#choices > .choice")?.id === "guided-go" && /Guided match/.test(document.querySelector("#guided-go b").textContent));
  await expect("it carries the Start here tag and its blurb", () => !document.getElementById("guided-tag").hidden && /Start here/.test(document.getElementById("guided-tag").textContent) && /wakes up slowly/.test(document.querySelector("#guided-go span:not(.tag)").textContent));
  await press("#guided-go");
  await guidedReady();
  // A follow-up shows 3 s: on a slow machine the page may not be polled in that time, so the checks lengthen it.
  await page.evaluate(() => { window.__sandbox.coach.followMs = 12000; });
  await expect("it starts the guided mode, named in the HUD", () => window.__sandbox.mode === "guided" && document.getElementById("mode-name").textContent === "Guided match");
  await expect("the coach shows step 1 and the checklist guide is hidden", () => !document.getElementById("coach").hidden && /Step 1 of 10/.test(document.getElementById("coach-step").textContent) && /Take the long gun/.test(document.getElementById("coach-title").textContent) && document.getElementById("guide").hidden);
  await expect("the tutor's stage is reported (0 until it wakes)", () => typeof window.__sandbox.match.tutor === "number" && window.__sandbox.match.tutor >= 0);
  await page.waitForTimeout(1500);
  await shot("guided-step1");

  // ---- step 1: take the long gun ----
  await page.keyboard.down("KeyA");
  await page.waitForTimeout(500);
  await page.keyboard.up("KeyA");
  await expect(...stepIs(2));
  await expect("step 2 names the enemy keep and its mark is on screen", () => {
    const m = document.getElementById("coach-mark");
    if (m.hidden || document.getElementById("coach-mark-label").textContent !== "Enemy keep") return false;
    const r = m.getBoundingClientRect();
    return r.x > -1 && r.x < 1100 && r.y > -1 && r.y < 810;
  });
  // ---- step 2: two keep hits ----
  page.evaluate(() => window.__sandbox.coach.fakeKeepHit());
  await page.waitForTimeout(600);
  await expect("one keep hit does not finish step 2", () => window.__sandbox.coach.state.step === 1);
  await page.evaluate(() => window.__sandbox.coach.fakeKeepHit());
  await expect("two keep hits tick step 2, its follow-up shows", () => window.__sandbox.coach.state.phase === "after" && /strips stone and pays 10 gold/.test(document.getElementById("coach-how").textContent));
  await expect(...stepIs(3));
  // ---- step 3: the mortar ----
  await expect("step 3 rings gun tab 2", () => document.querySelector('#weapons [data-weapon="1"]').classList.contains("coach-hl"));
  await expect("step 3 keeps the mark on the keep", () => !document.getElementById("coach-mark").hidden);
  // ---- the amendment: step 6 interrupts an earlier step once the tutor's first wave is out ----
  await patch({ tutor: 1, standing: [10, 12] });
  await page.evaluate(() => window.__sandbox.spawn(0, 8, 0, -45));
  await expect("the first wave interrupts step 3: Step 6 of 10, Stop their wave", () => /Step 6 of 10/.test(document.getElementById("coach-step").textContent) && /Stop their wave/.test(document.getElementById("coach-title").textContent) && window.__sandbox.coach.state.step === 5, null, 60000);
  await expect("it rings gun tabs 3 and 4 (no #threat strip is needed)", () => document.querySelector('#weapons [data-weapon="2"]').classList.contains("coach-hl") && document.querySelector('#weapons [data-weapon="3"]').classList.contains("coach-hl") && !document.querySelector('#weapons [data-weapon="1"]').classList.contains("coach-hl"));
  await expect("it marks their wave", () => !document.getElementById("coach-mark").hidden && document.getElementById("coach-mark-label").textContent === "Their wave", null, 60000);
  await shot("guided-step6");
  await patch({ standing: [4, 12] });
  await expect("no enemy man outside their courtyard: step 6 ticks, its follow-up shows", () => window.__sandbox.coach.state.phase === "after" && /fire on their own at men near your gate/.test(document.getElementById("coach-how").textContent));
  await expect("then the interrupted step 3 comes back, Step 3 of 10", () => window.__sandbox.coach.state.step === 2 && window.__sandbox.coach.state.phase === "ask" && /Step 3 of 10/.test(document.getElementById("coach-step").textContent));
  await expect("with its ring on gun tab 2 again", () => document.querySelector('#weapons [data-weapon="1"]').classList.contains("coach-hl") && !document.querySelector('#weapons [data-weapon="2"]').classList.contains("coach-hl"));
  await patch({ standing: undefined, order: 0 }); // waves not on Hold through steps 5 to 7: on the real clock men pile up and "Send your waves in" would interrupt (it has its own test below)
  await page.keyboard.press("Digit2");
  await expect("taking the mortar", () => document.getElementById("w-name").textContent === "Mortar");
  await page.evaluate(() => { const b = document.getElementById("shotcam"); if (b.checked) b.click(); });
  await page.evaluate(() => window.__sandbox.holdCharge(0.6));
  await expect(...hasRing("#charge"));
  await page.waitForTimeout(500);
  await shot("guided-step3");
  await page.evaluate(() => window.__sandbox.holdCharge(null));
  await patch({ keepFloor: [0.5, 0.5] });
  await expect("a cracked top floor ticks step 3, its follow-up rings the enemy keep meter", () => window.__sandbox.coach.state.phase === "after" && /Three floors hold up their banner/.test(document.getElementById("coach-how").textContent) && document.getElementById("keep-theirs").classList.contains("coach-hl"));
  await expect(...stepIs(4));
  await expect(...noRing("#keep-theirs"));
  await expect(...noRing('#weapons [data-weapon="1"]'));
  // ---- step 4: a second barracks ----
  await page.keyboard.press("Digit1");
  await expect("step 4 rings the gold and the Build button", () => document.getElementById("gold").classList.contains("coach-hl") && document.getElementById("build-btn").classList.contains("coach-hl"));
  await shot("guided-step4");
  await expect("gold for a barracks", () => window.__sandbox.match.gold[1] >= 225, null, 120000);
  await page.evaluate(() => window.__sandbox.input({ kind: "build", plot: 1, building: "barracks" }));
  await expect(...stepIs(5));
  await expect(...noRing("#build-btn"));
  // ---- step 5: the overview ----
  await expect("step 5 rings the Overview button and marks your waves", () => document.getElementById("overview-btn").classList.contains("coach-hl") && !document.getElementById("coach-mark").hidden && document.getElementById("coach-mark-label").textContent === "Your waves");
  await page.keyboard.press("Tab");
  await expect("Tab opens the overview and ticks step 5", () => window.__sandbox.view === "overview" && window.__sandbox.coach.state.step >= 5 || window.__sandbox.coach.state.phase === "after");
  await page.keyboard.press("Tab");
  await expect("step 6 was done once and never comes back: step 5 leads to step 7, Mark the road", () => window.__sandbox.coach.state.step === 6 && /Step 7 of 10/.test(document.getElementById("coach-step").textContent) && /Mark the road/.test(document.getElementById("coach-title").textContent) && window.__sandbox.coach.state.phase === "ask");
  // ---- step 7: mark the road (3.2) ----
  await expect("step 7 asks for a landing on their road and the T key", () => /their waves take/.test(document.getElementById("coach-how").textContent) && /<kbd>T<\/kbd>/.test(document.getElementById("coach-how").innerHTML));
  await expect("step 7 puts a world mark labelled Their road on the road their waves take", () => !document.getElementById("coach-mark").hidden && document.getElementById("coach-mark-label").textContent === "Their road", null, 60000);
  await shot("guided-step7");
  await patch({ marks: [{ n: 1, x: 0, y: 0, z: -95, made: 0, left: 10800, life: 10800, place: "Centre bridge", bear: 1, bearM: 2 }] });
  // Watched from inside the page (a follow-up is on show a few seconds, and a round trip here can be slow on a busy machine).
  const seen = await page.evaluate(() => new Promise((done) => {
    const got = { after: false, f: false, ring: false };
    const t0 = performance.now();
    const t = setInterval(() => {
      const c = window.__sandbox.coach.state;
      if (c.phase === "after" && c.step === 6 && /fire/.test(document.getElementById("coach-how").textContent)) got.after = true;
      if (/<kbd>F<\/kbd>/.test(document.getElementById("coach-how").innerHTML)) got.f = true;
      if (document.getElementById("marks-row").classList.contains("coach-hl")) got.ring = true;
      if ((got.after && got.f && got.ring) || performance.now() - t0 > 30000) { clearInterval(t); done(got); }
    }, 50);
  }));
  check("holding a mark ticks step 7: its follow-up shows", seen.after);
  check("the follow-up names the F key", seen.f);
  check("the marks row is ringed", seen.ring);
  await expect("the mark shows as a chip", () => window.__sandbox.chips.length === 1 && window.__sandbox.chips[0].place === "Centre bridge");
  await expect(...stepIs(8));
  await patch({ marks: undefined, order: undefined });
  // ---- step 8: send your waves in ----
  await patch({ tutor: 2 });
  await expect("step 8 rings the route and order buttons", () => document.querySelectorAll('#command [data-route].coach-hl').length === 3 && document.querySelectorAll('#command [data-order].coach-hl').length === 3);
  await press('[data-order="0"]');
  await expect("Advance ticks step 8, its follow-up says the tutor woke", () => window.__sandbox.coach.state.phase === "after" && /their long gun is manned/.test(document.getElementById("coach-how").textContent));
  await expect(...stepIs(9));
  // ---- step 9: break in ----
  await expect("step 9 rings Push and marks their gate", () => document.querySelector('[data-order="2"]').classList.contains("coach-hl") && !document.querySelector('[data-order="0"]').classList.contains("coach-hl") && document.getElementById("coach-mark-label").textContent === "Their gate" && !document.getElementById("coach-mark").hidden);
  await patch({ tutor: 3, storm: [100, 100] });
  await expect(...stepIs(10));
  // ---- step 10: win ----
  await expect("step 10 rings the storm meter while a storm runs", () => document.getElementById("storm").classList.contains("coach-hl"));
  await patch({ tutor: 3, storm: [0, 0] });
  await expect("and the enemy keep meter when none does", () => document.getElementById("keep-theirs").classList.contains("coach-hl") && !document.getElementById("storm").classList.contains("coach-hl"));
  const tick = await page.evaluate(() => window.__sandbox.match.tick);
  await patch({ result: { winner: 1, reason: "keep", tick } });
  await expect("a win: the coach goes, the end screen shows its buttons", () => document.getElementById("coach").hidden && document.querySelectorAll(".coach-hl").length === 0 && !document.getElementById("end").hidden && document.getElementById("end-title").textContent === "Victory" && document.getElementById("end-line").textContent === "You won your first match." && document.getElementById("end-again").textContent === "Versus AI: Squire" && !document.getElementById("end-guided").hidden && document.getElementById("end-guided").textContent === "Play the guided match again" && document.getElementById("end-practice").textContent === "Practice range", null, 60000);
  await shot("guided-end");
  await press("#end-again");
  await patch(null);
  await expect("Versus AI: Squire starts Versus AI at the Squire and stores it", () => window.__sandbox.mode === "versus" && document.getElementById("mode-name").textContent === "Versus AI: Squire" && localStorage.getItem("keepfall.difficulty") === "squire" && localStorage.getItem("keepfall.guided") === "won" && document.getElementById("coach").hidden);
  await expect("the guided tag is gone from the menu once one is won", () => document.getElementById("guided-tag").hidden);

  // ---- Skip, Hide, Show the guide ----
  await page.evaluate(() => window.__sandbox.startMode("guided"));
  await guidedReady();
  await expect(...stepIs(1));
  await press("#coach-skip");
  await expect("Skip passes a step", () => window.__sandbox.coach.state.step === 1 && /Step 2 of 10/.test(document.getElementById("coach-step").textContent));
  await press("#coach-hide");
  await expect("Hide hides the coach, its marks and its rings", () => document.getElementById("coach").hidden && document.getElementById("coach-mark").hidden && document.querySelectorAll(".coach-hl").length === 0);
  await page.keyboard.press("KeyH");
  await press("#guide-show");
  await expect("Controls' Show the guide brings the coach back, on the same step", () => !document.getElementById("coach").hidden && /Step 2 of 10/.test(document.getElementById("coach-step").textContent) && document.getElementById("guide").hidden);
  await page.keyboard.press("KeyP");
  await expect("P pauses the guided match like Versus AI", () => !document.getElementById("paused").hidden);
  await page.keyboard.press("KeyP");
  // Step 6 reached in turn waits for the tutor's stage.
  await patch(null);
  for (let i = 0; i < 4; i++) { await press("#coach-skip"); await page.waitForTimeout(300); }
  await expect(...stepIs(6));
  await expect("step 6 reached in turn waits: the enemy castle is still asleep, no ring", () => /still asleep/.test(document.getElementById("coach-how").textContent) && document.querySelectorAll(".coach-hl").length === 0);
  // Step 8 interrupts too once your waiting men are many and the tutor is awake (at the cap your barracks cannot top up your garrison).
  await patch({ tutor: 1, order: 1, standing: [4, 80], garrison: [4, 4] });
  await expect("a field full of your waiting men interrupts: Step 8 of 10, Send your waves in", () => window.__sandbox.coach.state.step === 7 && /Step 8 of 10/.test(document.getElementById("coach-step").textContent) && /Send your waves in/.test(document.getElementById("coach-title").textContent));
  await expect("it rings the route and order buttons", () => document.querySelectorAll('#command [data-order].coach-hl').length === 3);
  await patch({ order: 0 });
  await expect("Advance ticks it, then step 6 comes back, waiting for their first wave", () => window.__sandbox.coach.state.step === 5 && /Step 6 of 10/.test(document.getElementById("coach-step").textContent) && /not out yet/.test(document.getElementById("coach-how").textContent), null, 60000);
  await patch({ tutor: 1, order: 1, standing: [12, 80], garrison: [4, 4] });
  await expect("their wave out: step 6 asks, and step 8 (done) does not interrupt it again", () => window.__sandbox.coach.state.step === 5 && /Stop their wave/.test(document.getElementById("coach-title").textContent) && /Enemy wave coming/.test(document.getElementById("coach-how").textContent));
  await patch({ standing: [4, 80] });
  await expect("step 6 done: Mark the road (step 7) asks next", () => window.__sandbox.coach.state.step === 6 && /Step 7 of 10/.test(document.getElementById("coach-step").textContent) && /Mark the road/.test(document.getElementById("coach-title").textContent), null, 60000);
  await patch(null);

  // ---- a loss ----
  await page.evaluate(() => window.__sandbox.surrender());
  await expect("a loss: the enemy won this time, Try again", () => !document.getElementById("end").hidden && document.getElementById("end-title").textContent === "Defeat" && document.getElementById("end-line").textContent === "The enemy won this time." && document.getElementById("end-again").textContent === "Try again" && document.getElementById("end-guided").hidden && document.getElementById("coach").hidden, null, 60000);
  await press("#end-again");
  await expect("Try again starts the guided match anew", () => window.__sandbox.mode === "guided" && document.getElementById("end").hidden && !document.getElementById("coach").hidden && /Step 1 of 10/.test(document.getElementById("coach-step").textContent));
  // Two minutes of match time on one step: the Skip button pulses.
  await expect(...noRing("#coach-skip"));
  const t0 = await page.evaluate(() => window.__sandbox.match.tick);
  await patch({ tick: t0 + 121 * 60 });
  await expect(...hasRing("#coach-skip"));
  await patch(null);
} finally {
  if (errors.length) console.log("page errors:\n  " + errors.slice(0, 20).join("\n  "));
  console.log(failed ? `${failed} failed` : "all passed");
  await browser.close();
  await server.close();
}
if (failed || errors.length) process.exit(1);
