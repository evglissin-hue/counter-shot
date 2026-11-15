// Army diag (page), Versus AI (seat 1, a Squire): every way to give an order or a route, what input each sends, whether
// the match's report then carries it, and whether the command card shows it. The match is stepped by hand after the
// page is up (so it cannot end midway on a busy machine); the steps run inside the page (lib.mjs).
// Usage: PORT=5291 node tools/army-diag/page/orders-versus.mjs
import { start, fmt } from "./lib.mjs";

const { open, stop } = await start();
const O = (n) => `r.order === ${n}`;
const R = (n) => `r.route === "${n}"`;
const ctrl = (d) => ({ key: `Digit${d}`, opts: { ctrlKey: true, key: String(d) } });
const steps = [
  // Orders: the command card's buttons.
  { label: "card: Hold button", click: '[data-order="1"]', want: O(1) },
  { label: "card: Advance button", click: '[data-order="0"]', want: O(0) },
  { label: "card: Push button", click: '[data-order="2"]', want: O(2) },
  // The keys, in the sight.
  { label: "Ctrl+1 (in the sight)", ...ctrl(1), want: O(0) },
  { label: "Ctrl+2 (in the sight)", ...ctrl(2), want: O(1) },
  { label: "Ctrl+3 (in the sight)", ...ctrl(3), want: O(2) },
  // In the overview, and with the build menu open.
  { label: "Tab to the overview", key: "Tab", frames: 3 },
  { label: "Ctrl+1 (in the overview)", ...ctrl(1), want: O(0) },
  { label: "Ctrl+2 (in the overview)", ...ctrl(2), want: O(1) },
  { label: "Tab back; B opens the build menu", eval: "window.__diag.key('Tab'); await new Promise(r => setTimeout(r, 400)); window.__diag.key('KeyB');", frames: 3 },
  { label: "Ctrl+1 (build menu open)", ...ctrl(1), want: O(0) },
  { label: "Esc", key: "Escape", frames: 2 },
  // The gamepad: D-pad left cycles the order.
  { label: "pad D-pad left (from Advance)", pad: 14, want: O(1) },
  { label: "pad D-pad left again", pad: 14, want: O(2) },
  { label: "pad D-pad left again", pad: 14, want: O(0) },
  // The order line.
  { label: 'line "hold"', say: "hold", want: O(1) },
  { label: 'line "advance"', say: "advance", want: O(0) },
  { label: "card: Hold (to try the line from Hold)", click: '[data-order="1"]', want: O(1) },
  { label: 'line "attack"', say: "attack", want: O(0) },
  { label: "card: Hold", click: '[data-order="1"]', want: O(1) },
  ...["go", "march", "attack the enemy", "Waves, advance.", "advanced", "send them in"].map((t) => ({ label: `line "${t}" (from Hold)`, say: t, want: O(0), ms: 2500 })),
  { label: "Esc closes the line", key: "Escape", on: "#steward-input", frames: 1 },
  { label: 'line "charge"', say: "charge", want: O(0) },
  // Ctrl+1 while the line is open (the field has the keys).
  { label: "card: Hold", click: '[data-order="1"]', want: O(1) },
  { label: "Enter opens the line", key: "Enter", opts: { key: "Enter" }, frames: 1 },
  { label: "Ctrl+1 while the order line is open", ...ctrl(1), on: "#steward-input", want: O(0), ms: 3000 },
  { label: "Esc closes the line", key: "Escape", on: "#steward-input", frames: 1 },
  // The HUD follows the match, not its own copy: orders straight into the match.
  { label: "input straight to the match (Advance)", input: { kind: "order", order: 0 }, want: O(0) },
  { label: "input straight to the match (Hold)", input: { kind: "order", order: 1 }, want: O(1) },
  { label: "card: Advance", click: '[data-order="0"]', want: O(0) },
  // Routes.
  { label: "card: Left button", click: '[data-route="left"]', want: R("left") },
  { label: "L (from left)", key: "KeyL", want: R("centre") },
  { label: "L (from centre)", key: "KeyL", want: R("right") },
  { label: "L (from right)", key: "KeyL", want: R("left") },
  { label: "card: Right button", click: '[data-route="right"]', want: R("right") },
  { label: "card: Centre button", click: '[data-route="centre"]', want: R("centre") },
  { label: "pad D-pad right (from centre)", pad: 15, want: R("right") },
  { label: 'line "go left"', say: "go left", want: R("left") },
  { label: 'line "waves right"', say: "waves right", want: R("right") },
  { label: 'line "left" (from right)', say: "left", want: R("left"), ms: 2500 },
  { label: "Esc closes the line", key: "Escape", on: "#steward-input", frames: 1 },
  { label: 'line "centre"', say: "centre", want: R("centre") },
  // A barracks' own route: does the card's route row follow it?
  { label: 'line "all barracks left"', say: "all barracks left", want: "r.barracks && r.barracks[1] === 0" },
];
try {
  const page = await open("versus=squire-webgl-low", "versus");
  await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 600000 });
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 60 && !!window.__rep, null, { timeout: 600000, polling: 500 });
  // Step by hand from here.
  await page.evaluate(() => window.__sandbox.advance(0.1));
  console.log("start", JSON.stringify(await page.evaluate(() => ({ rep: window.__rep, view: window.__sandbox.view }))));
  const rows = await page.evaluate(([s]) => window.__diag.run(s, true), [steps]);
  for (const r of rows) console.log(fmt(r));
  const last = rows[rows.length - 1];
  console.log("after a barracks route: the match's barracks [mix, route] by plot", JSON.stringify(last.rep.barracks), "| the team route", last.rep.route, "| the card shows", last.hud.route);
  const lg = JSON.parse(await page.evaluate(() => window.__sandbox.saveLog()));
  console.log("match log: order/route/barracks inputs applied [tick, team, input]:", JSON.stringify(lg.inputs.filter((e) => ["order", "route", "barracks"].includes(e[3].kind)).map((e) => [e[0], e[1], e[3]])));
  console.log(`${rows.filter((r) => r.want !== undefined && !r.ok).length} failed; ${rows.filter((r) => !r.ok).length} of ${rows.length} without the wanted report`);
} finally {
  await stop();
}
