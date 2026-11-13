// Army diag (page): stills of your waves in a Versus AI match (a Squire), stepped by hand: marching on the centre road
// (from close by and from your gun), held at the marker, crossing the bridge after Advance, and later near the enemy
// gate or a fight. Beside each still, numbers from the frame: men walking in place, standing, fighting, facing away
// from where they move, going back, and pairs closer than 0.45 m (overlap). Stills in tools/.shots/army-diag/.
// Usage: PORT=5291 node tools/army-diag/page/wave-stills.mjs
import { start, adv, shot } from "./lib.mjs";

const { open, stop } = await start();
const FIGHTERS = new Set([0, 2, 3, 4]);
const frame = (page) => page.evaluate(() => { const f = window.__sandbox.frame; const a = f.minions, out = []; for (let i = 0; i + 9 < a.length; i += 10) out.push([a[i], a[i + 1], a[i + 3], a[i + 4], a[i + 6], a[i + 7], a[i + 9]]); return { tick: f.tick, list: out }; });
function stats(a, b, team) {
  const before = new Map(a.list.filter((m) => m[4] === team).map((m) => [m[0], m]));
  const dt = (b.tick - a.tick) / 60;
  const o = { t: +(b.tick / 60).toFixed(1), men: 0, moving: 0, walkInPlace: 0, standing: 0, fighting: 0, faceAway: 0, back: 0, overlap: 0, actions: {} };
  const list = [];
  for (const m of b.list) {
    if (m[4] !== team || !FIGHTERS.has(m[6])) continue;
    if (team === 1 ? m[2] < -126 : m[2] > -24) continue;
    const p = before.get(m[0]);
    if (!p) continue;
    list.push(m);
    o.men++;
    o.actions[m[5]] = (o.actions[m[5]] ?? 0) + 1;
    const dx = m[1] - p[1], dz = m[2] - p[2], d = Math.hypot(dx, dz);
    if (d > 0.5 * dt) {
      o.moving++;
      if ((Math.sin(m[3]) * dx + Math.cos(m[3]) * dz) / d < -0.3) o.faceAway++;
      if (team === 1 ? dz < -0.3 * dt : dz > 0.3 * dt) o.back++;
    }
    if (m[5] === 0 && d < 0.2 * dt) o.walkInPlace++;
    if (m[5] === 1) o.standing++;
    if (m[5] === 2) o.fighting++;
  }
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (Math.hypot(list[i][1] - list[j][1], list[i][2] - list[j][2]) < 0.45) o.overlap++;
  const c = list.length ? { x: Math.round(list.reduce((s, m) => s + m[1], 0) / list.length), z: Math.round(list.reduce((s, m) => s + m[2], 0) / list.length) } : null;
  return { o, c };
}
const run = (page, steps) => page.evaluate(([s]) => window.__diag.run(s, true), [steps]);
/** Two frames 2 s apart, the numbers, and a still on the men's centroid (or the given camera). */
async function moment(page, name, cam) {
  const a = await frame(page);
  await adv(page, 2);
  const b = await frame(page);
  const s1 = stats(a, b, 1), s0 = stats(a, b, 0);
  console.log(name, "yours", JSON.stringify(s1.o), "centroid", JSON.stringify(s1.c), "| theirs", JSON.stringify(s0.o));
  const c = s1.c;
  const view = cam === undefined ? (c ? { x: c.x - 7, y: 9, z: c.z - 9, tx: c.x, ty: 0.5, tz: c.z + 1, fov: 50 } : null) : cam;
  await shot(page, name, view, 1500);
}
try {
  const page = await open("versus=squire-webgl-low", "versus");
  await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 600000 });
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 60 && !!window.__rep, null, { timeout: 600000, polling: 500 });
  await page.evaluate(() => window.__sandbox.advance(0.1));
  const t = await page.evaluate(() => window.__sandbox.match.tick / 60);
  console.log("page up at", t.toFixed(1), "s of match time");
  // The next wave goes down the centre road and holds at the centre marker.
  await run(page, [{ label: "Centre", click: '[data-route="centre"]', want: 'r.route === "centre"' }, { label: "Hold", click: '[data-order="1"]', want: "r.order === 1" }]);
  const next = await page.evaluate(() => window.__sandbox.match.nextWave / 60);
  await adv(page, next + 14);
  await moment(page, "versus-1-marching-close");
  await moment(page, "versus-2-marching-from-gun", null);
  await adv(page, 16);
  await moment(page, "versus-3-held-at-centre-marker");
  await run(page, [{ label: "Advance", click: '[data-order="0"]', want: "r.order === 0" }]);
  await adv(page, 6);
  await moment(page, "versus-4-advance-bridge");
  await adv(page, 20);
  await moment(page, "versus-5-later");
  await adv(page, 20);
  await moment(page, "versus-6-later");
  await page.evaluate(() => window.__diag.key("Tab"));
  await moment(page, "versus-7-overview", null);
} finally {
  await stop();
}
