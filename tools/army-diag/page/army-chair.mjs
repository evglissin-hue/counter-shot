// Army pass, the player's chair: a Versus AI match against the Knight, stepped by hand, with stills and the words the page
// shows. Your waves held at the centre marker; the road changed to the right while they hold (they walk along the bank to
// the right marker); "Waves, advance." on the order line (they cross); and the Knight's own waves, counted every 20 s on
// your side of the stream (the owner saw them hold at the bridge and never come on). Stills in tools/.shots/army-diag/.
// Usage: PORT=5294 node tools/army-diag/page/army-chair.mjs
import { start, adv, shot, men, act, fmt, say } from "./lib.mjs";

const MID_Z = -75; // the stream's middle (castle 0 at z 0, castle 1 at z -150)
const { open, stop } = await start();
const centroid = (list) => (list.length ? { x: Math.round(list.reduce((s, m) => s + m[1], 0) / list.length), z: Math.round(list.reduce((s, m) => s + m[2], 0) / list.length), n: list.length } : null);
const field = (list, team) => list.filter((m) => (team === 1 ? m[2] > -126 : m[2] < -24)); // out of their courtyard
const near = (c) => (c ? { x: c.x - 8, y: 10, z: c.z - 10, tx: c.x, ty: 0.5, tz: c.z + 1, fov: 50 } : null);
try {
  const page = await open("versus=knight-webgl-low", "versus");
  await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 600000 });
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 60 && !!window.__rep, null, { timeout: 600000, polling: 500 });
  await page.evaluate(() => window.__sandbox.advance(0.1));
  console.log(fmt(await act(page, "road: centre (button)", () => page.click('[data-route="centre"]'), 'r.route === "centre"')));
  console.log(fmt(await act(page, "order: Hold (button)", () => page.click('[data-order="1"]'), "r.order === 1")));
  const next = await page.evaluate(() => window.__sandbox.match.nextWave / 60);
  await adv(page, next + 40);
  let mine = field(await men(page, 1), 1);
  console.log("held: yours", JSON.stringify(centroid(mine)));
  await shot(page, "chair-1-held-centre", near(centroid(mine)));
  console.log("road row tooltip:", await page.evaluate(() => document.querySelector("#command [data-route]")?.parentElement?.title ?? ""));
  console.log(fmt(await act(page, "road: right while they hold (button)", () => page.click('[data-route="right"]'), 'r.route === "right"')));
  await adv(page, 25);
  mine = field(await men(page, 1), 1);
  console.log("+25 s: yours", JSON.stringify(centroid(mine)));
  await shot(page, "chair-2-walking-to-right", near(centroid(mine)));
  await adv(page, 35);
  mine = field(await men(page, 1), 1);
  console.log("+60 s: yours", JSON.stringify(centroid(mine)));
  await shot(page, "chair-3-at-right-marker", near(centroid(mine)));
  console.log(fmt(await act(page, 'order line: "Waves, advance."', () => say(page, "Waves, advance."), "r.order === 0")));
  await adv(page, 12);
  mine = field(await men(page, 1), 1);
  console.log("+12 s after Advance: yours", JSON.stringify(centroid(mine)));
  await shot(page, "chair-4-advance-crossing", near(centroid(mine)));
  // The Knight's waves: how many of its men out on the field stand on your side of the stream, every 20 s.
  let best = null;
  for (let k = 0; k < 9; k++) {
    await adv(page, 20);
    const theirs = field(await men(page, 0), 0);
    const over = theirs.filter((m) => m[2] < MID_Z - 4);
    const t = await page.evaluate(() => (window.__sandbox.match.tick / 60).toFixed(0));
    const res = await page.evaluate(() => window.__sandbox.match.result ?? null);
    console.log(`t ${t} s: the Knight's men out ${theirs.length}, on your side of the stream ${over.length}, their centroid ${JSON.stringify(centroid(theirs))}${res ? ` | result ${JSON.stringify(res)}` : ""}`);
    if (over.length && (!best || over.length > best.n)) best = { n: over.length, c: centroid(over), k };
    if (best && best.k === k) await shot(page, "chair-5-knight-waves-on-your-side", near(best.c));
    if (res) break;
  }
  await page.evaluate(() => window.__diag.key("Tab"));
  await shot(page, "chair-6-overview", null);
} finally {
  await stop();
}
