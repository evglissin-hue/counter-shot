// Orders on the page (Versus AI, seat 1, headless Chromium, software rendering): every way to give your waves an order
// and a road sends the right input to the match (the worker's postMessage is hooked) and the command card shows it at
// once and keeps showing it (no old state lit again after the click, even while reports from before the input arrive):
// the card's buttons, Ctrl+1, 2, 3 in the sight, in the overview and with the order line open, L, the pad, the order
// line ("go", "attack the enemy", "Waves, advance.", "hold", "push the breach", "left", "advance right"), and a barracks'
// own road set from the build menu. The match is stepped by hand so it cannot end midway on a busy machine.
// Usage: PORT=5293 node tools/orders-check.mjs   (exits 1 if anything fails)
import { start } from "./army-diag/page/lib.mjs";

const { open, stop } = await start();
const O = (n) => `r.order === ${n}`;
const R = (n) => `r.route === "${n}"`;
const ctrl = (d) => ({ key: `Digit${d}`, opts: { ctrlKey: true, key: String(d) } });
const ord = (n) => ({ kind: "order", order: n });
const road = (n) => ({ kind: "route", route: n });
// Each step: what it does, the report it must bring (want), the inputs it must send (sent) and what the card must show at the end (hud).
const steps = [
  { label: "card: Advance", click: '[data-order="0"]', want: O(0), sent: [ord(0)], hud: { order: "0" } },
  { label: "card: Hold", click: '[data-order="1"]', want: O(1), sent: [ord(1)], hud: { order: "1" } },
  { label: "card: Push", click: '[data-order="2"]', want: O(2), sent: [ord(2)], hud: { order: "2" } },
  { label: "Ctrl+1 in the sight", ...ctrl(1), want: O(0), sent: [ord(0)], hud: { order: "0" } },
  { label: "Ctrl+2 in the sight", ...ctrl(2), want: O(1), sent: [ord(1)], hud: { order: "1" } },
  { label: "Ctrl+3 in the sight", ...ctrl(3), want: O(2), sent: [ord(2)], hud: { order: "2" } },
  { label: "Tab to the overview", key: "Tab", frames: 3 },
  { label: "Ctrl+1 in the overview", ...ctrl(1), want: O(0), sent: [ord(0)], hud: { order: "0" } },
  { label: "Ctrl+2 in the overview", ...ctrl(2), want: O(1), sent: [ord(1)], hud: { order: "1" } },
  { label: "Tab back", key: "Tab", frames: 3 },
  // The order line has the keys: Ctrl+1, 2, 3 still give the order.
  { label: "Enter opens the order line", key: "Enter", opts: { key: "Enter" }, frames: 1 },
  { label: "Ctrl+1 with the order line open", ...ctrl(1), on: "#steward-input", want: O(0), sent: [ord(0)], hud: { order: "0" }, ms: 3000 },
  { label: "Ctrl+3 with the order line open", ...ctrl(3), on: "#steward-input", want: O(2), sent: [ord(2)], hud: { order: "2" }, ms: 3000 },
  { label: "Esc closes the line", key: "Escape", on: "#steward-input", frames: 1 },
  // The order line.
  { label: 'line "hold"', say: "hold", want: O(1), sent: [ord(1)], hud: { order: "1" } },
  { label: 'line "go"', say: "go", want: O(0), sent: [ord(0)], hud: { order: "0" } },
  { label: "card: Hold", click: '[data-order="1"]', want: O(1), sent: [ord(1)], hud: { order: "1" } },
  { label: 'line "attack the enemy"', say: "attack the enemy", want: O(0), sent: [ord(0)], hud: { order: "0" } },
  { label: "card: Hold", click: '[data-order="1"]', want: O(1), sent: [ord(1)], hud: { order: "1" } },
  { label: 'line "Waves, advance."', say: "Waves, advance.", want: O(0), sent: [ord(0)], hud: { order: "0" } },
  { label: 'line "push the breach"', say: "push the breach", want: O(2), sent: [ord(2)], hud: { order: "2" } },
  { label: "Esc closes the line", key: "Escape", on: "#steward-input", frames: 1 },
  // Roads: the card, L, the pad, the line.
  { label: "card: Left", click: '[data-route="left"]', want: R("left"), sent: [road("left")], hud: { route: "left" } },
  { label: "L (from left)", key: "KeyL", want: R("centre"), sent: [road("centre")], hud: { route: "centre" } },
  { label: "L (from centre)", key: "KeyL", want: R("right"), sent: [road("right")], hud: { route: "right" } },
  { label: "card: Centre", click: '[data-route="centre"]', want: R("centre"), sent: [road("centre")], hud: { route: "centre" } },
  { label: "pad D-pad right (from centre)", pad: 15, want: R("right"), sent: [road("right")], hud: { route: "right" } },
  { label: 'line "left"', say: "left", want: R("left"), sent: [road("left")], hud: { route: "left" } },
  { label: 'line "advance right"', say: "advance right", want: O(0) + " && " + R("right"), sent: [road("right"), ord(0)], hud: { route: "right", order: "0" } },
  { label: "card: Hold", click: '[data-order="1"]', want: O(1), sent: [ord(1)], hud: { order: "1", route: "right" } },
  { label: "Esc closes the line", key: "Escape", on: "#steward-input", frames: 1 },
  // A barracks' own road, set from the build menu: the road row follows it.
  { label: "card: Centre (all barracks)", click: '[data-route="centre"]', want: R("centre"), sent: [road("centre")], hud: { route: "centre" } },
  { label: "B opens the build menu", key: "KeyB", frames: 3 },
  { label: "pick the barracks plot", eval: "document.querySelector('#build [data-pick=\"0\"]').click(); await new Promise((r) => setTimeout(r, 600));", frames: 2 },
  {
    label: "build menu: Route: Right on the barracks",
    eval: "return (async () => { const b = [...document.querySelectorAll('#build .choice2')].find((x) => /Route: Right/.test(x.textContent)); if (!b) throw new Error('no Route: Right row'); b.click(); })();",
    want: "r.barracks && r.barracks[1] === 2",
    sent: [{ kind: "barracks", plot: 0, route: "right" }],
    hud: { route: "right" },
  },
  { label: "Esc closes the menu", key: "Escape", frames: 2 },
  { label: 'line "all barracks left"', say: "all barracks left", want: "r.barracks && r.barracks[1] === 0", sent: [{ kind: "barracks", plot: 0, route: "left" }], hud: { route: "left" } },
];

let failed = 0;
try {
  const page = await open("versus=squire-webgl-low", "versus");
  await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 600000 });
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 60 && !!window.__rep, null, { timeout: 600000, polling: 500 });
  await page.evaluate(() => window.__sandbox.advance(0.1));
  const rows = await page.evaluate(([s]) => window.__diag.run(s, true), [steps]);
  rows.forEach((r, i) => {
    const st = steps[i];
    const bad = [];
    if (st.want && !r.ok) bad.push("the match never reported it");
    if (r.err) bad.push(r.err);
    if (st.sent && JSON.stringify(r.sent) !== JSON.stringify(st.sent)) bad.push(`sent ${JSON.stringify(r.sent)}, wanted ${JSON.stringify(st.sent)}`);
    for (const [k, v] of Object.entries(st.hud ?? {})) if (r.hud[k] !== v) bad.push(`card shows ${k} ${r.hud[k]}, wanted ${v}`);
    if (st.want && r.flips.length > 1) bad.push(`the card flickered: ${JSON.stringify(r.flips.map((f) => `${f.o}/${f.r}`))}`);
    console.log(`${bad.length ? "FAIL" : "ok  "} ${r.label}${bad.length ? ` | ${bad.join("; ")}` : ""}`);
    if (bad.length) failed++;
  });
  // The road row says when barracks differ: not asserted (one barracks here), but the tooltip must name the road action.
  const tip = await page.evaluate(() => document.querySelector("#command [data-route]")?.parentElement?.title ?? "");
  const okTip = /road your waves take/i.test(tip);
  console.log(`${okTip ? "ok  " : "FAIL"} the road row's tooltip: ${JSON.stringify(tip)}`);
  if (!okTip) failed++;
} finally {
  await stop();
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
