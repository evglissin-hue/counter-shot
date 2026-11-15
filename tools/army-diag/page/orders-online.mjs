// Army diag (page), online (two pages in lockstep through #net=local): the guest holds castle 0 and faces the other way.
// Each side gives orders and routes by the card, the keys and the order line; checks what each sends, that its own match
// report carries it, that the host's match applied the guest's inputs for team 0 (its replay log), and where each side's
// waves really walk (left as each owner sees it). Stills in tools/.shots/army-diag/.
// Usage: PORT=5291 node tools/army-diag/page/orders-online.mjs
import { start, fmt, shot } from "./lib.mjs";

const { open, stop } = await start();
const click = (page, sel) => page.evaluate((q) => document.querySelector(q).click(), sel);
try {
  const host = await open("net=local-webgl-low", "host");
  const guest = await open("net=local-webgl-low", "guest");
  await click(host, "#online-go");
  await click(guest, "#online-go");
  await host.waitForSelector("#online-host:not([disabled])", { state: "attached", timeout: 60000 });
  await click(host, "#online-host");
  await host.waitForSelector("#online-wait:not([hidden])", { state: "attached", timeout: 60000 });
  await guest.waitForSelector("#online-list li button:not([disabled])", { state: "attached", timeout: 60000 });
  await guest.evaluate(() => new Promise((done) => { const t = setInterval(() => { if (window.__sandbox.mode === "online") { clearInterval(t); done(); } else document.querySelector("#online-list li button:not([disabled])")?.click(); }, 700); }));
  for (const p of [host, guest]) await p.waitForFunction(() => window.__sandbox.mode === "online" && !!window.__sandbox.match && !!window.__rep, null, { timeout: 180000, polling: 200 });
  console.log("teams", await host.evaluate(() => window.__sandbox.match.team), await guest.evaluate(() => window.__sandbox.match.team));
  const O = (n) => `r.order === ${n}`;
  const R = (n) => `r.route === "${n}"`;
  const ctrl = (d) => ({ key: `Digit${d}`, opts: { ctrlKey: true, key: String(d) } });
  const run = (page, steps) => page.evaluate(([s]) => window.__diag.run(s, false), [steps]);
  // Routes first (before the first wave at 8 s): the guest's Left is the match's right; the host takes its right.
  const g1 = run(guest, [
    { label: "card: Right (own right; match left)", click: '[data-route="right"]', want: R("left") },
    { label: 'line "go left" (own left; match right)', say: "go left", want: R("right") },
    { label: "L (own left to centre)", key: "KeyL", want: R("centre") },
    { label: "L (own centre to own right; match left)", key: "KeyL", want: R("left") },
    { label: "L (own right to own left; match right)", key: "KeyL", want: R("right") },
    { label: "card: Hold", click: '[data-order="1"]', want: O(1) },
    { label: "card: Advance", click: '[data-order="0"]', want: O(0) },
    { label: "Ctrl+2", ...ctrl(2), want: O(1) },
    { label: "Ctrl+1", ...ctrl(1), want: O(0) },
    { label: 'line "hold"', say: "hold", want: O(1) },
    { label: 'line "advance"', say: "advance", want: O(0) },
  ]);
  const h1 = run(host, [
    { label: "card: Right", click: '[data-route="right"]', want: R("right") },
    { label: "card: Hold", click: '[data-order="1"]', want: O(1) },
    { label: "Ctrl+1", ...ctrl(1), want: O(0) },
    { label: 'line "go right"', say: "go right", want: R("right") },
  ]);
  const rows = [];
  for (const [who, list] of [["guest", await g1], ["host", await h1]]) for (const r of list) { rows.push(r); console.log(`${who.padEnd(5)} ${fmt(r)}`); }
  // The host's match applied the guest's inputs for team 0, in the same order.
  const applied = async (p) => JSON.parse(await p.evaluate(() => window.__sandbox.saveLog())).inputs.filter((e) => ["order", "route"].includes(e[3].kind)).map((e) => [e[0], e[1], e[3].kind === "order" ? `o${e[3].order}` : e[3].route]);
  const [ha, ga] = [await applied(host), await applied(guest)];
  console.log("host's log:", JSON.stringify(ha));
  console.log("guest's log:", JSON.stringify(ga));
  console.log("the two logs agree:", JSON.stringify(ha) === JSON.stringify(ga));
  // Where the waves walk: wait until the first waves are well out on their flanks.
  await host.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) >= 36 * 60, null, { timeout: 600000, polling: 500 });
  const sides = await host.evaluate(() => {
    const a = window.__sandbox.frame.minions, out = { 0: [], 1: [] };
    for (let i = 0; i + 9 < a.length; i += 10) if ([0, 2, 3, 4].includes(a[i + 9])) { const z = a[i + 3]; if ((a[i + 6] === 1 && z > -125) || (a[i + 6] === 0 && z < -25)) out[a[i + 6]].push([Math.round(a[i + 1]), Math.round(z)]); }
    return out;
  });
  const meanX = (l) => (l.length ? Math.round(l.reduce((s, p) => s + p[0], 0) / l.length) : null);
  console.log(`out in the field at ${await host.evaluate(() => (window.__sandbox.match.tick / 60).toFixed(1))} s: team 0 (guest, own Left) ${sides[0].length} men, mean x ${meanX(sides[0])}; team 1 (host, Right) ${sides[1].length} men, mean x ${meanX(sides[1])}`);
  console.log("(castle 1 looks along +z, its left is +x; castle 0 looks along -z, its left is -x)");
  // Stills from behind each gate, looking out at the field.
  await shot(guest, "online-guest-own-left", { x: 0, y: 18, z: 6, tx: 0, ty: 0, tz: -60, fov: 80 }, 2000);
  await shot(host, "online-host-right", { x: 0, y: 18, z: -156, tx: 0, ty: 0, tz: -90, fov: 80 }, 2000);
  for (const [w, p] of [["host", host], ["guest", guest]]) console.log(w, "net line:", await p.evaluate(() => document.getElementById("netline")?.textContent ?? ""));
  console.log(`${rows.filter((r) => !r.ok).length} of ${rows.length} did not reach the match as expected`);
} finally {
  await stop();
}
