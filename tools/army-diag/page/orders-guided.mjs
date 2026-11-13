// Army diag (page), the guided match (#guided, the coach on): your waves start on Hold down the left flank. Steps the
// match by hand to the first wave held at its marker, gives Advance with the card's button, and measures whether the
// men move off (and how: walking in place, standing, facing away from where they go). Stills in tools/.shots/army-diag/.
// Usage: PORT=5291 node tools/army-diag/page/orders-guided.mjs
import { start, look, fmt, adv, shot } from "./lib.mjs";

const { open, stop } = await start();
const click = (page, sel) => page.evaluate((q) => document.querySelector(q).click(), sel);
const FIGHTERS = new Set([0, 2, 3, 4]);
/** Men of team 1 out in the field (not in their courtyard, z > -128), fighters only. */
const field = async (page) => (await page.evaluate(() => { const f = window.__sandbox.frame; const a = f.minions, out = []; for (let i = 0; i + 9 < a.length; i += 10) out.push([a[i], a[i + 1], a[i + 3], a[i + 4], a[i + 6], a[i + 7], a[i + 9]]); return { tick: f.tick, list: out }; }));
/** Compare two frames: per man of a team, how far he went, his action, and whether he faces the way he went. */
function motion(a, b, team) {
  const before = new Map(a.list.filter((m) => m[4] === team).map((m) => [m[0], m]));
  const dt = (b.tick - a.tick) / 60;
  const out = { dt, men: 0, moved: 0, still: 0, walkInPlace: 0, standing: 0, fighting: 0, faceAway: 0, back: 0, meanDz: 0, actions: {} };
  for (const m of b.list) {
    if (m[4] !== team || !FIGHTERS.has(m[6])) continue;
    const p = before.get(m[0]);
    if (!p) continue;
    if (team === 1 && m[2] < -126) continue; // in the courtyard
    out.men++;
    const dx = m[1] - p[1], dz = m[2] - p[2], d = Math.hypot(dx, dz);
    out.meanDz += dz;
    out.actions[m[5]] = (out.actions[m[5]] ?? 0) + 1;
    if (d > 0.5 * dt) out.moved++;
    else out.still++;
    if (m[5] === 0 && d < 0.2 * dt) out.walkInPlace++;
    if (m[5] === 1) out.standing++;
    if (m[5] === 2) out.fighting++;
    if (d > 0.5 * dt) {
      const fx = Math.sin(m[3]), fz = Math.cos(m[3]);
      if ((fx * dx + fz * dz) / d < 0) out.faceAway++;
      if (team === 1 ? dz < -0.3 * dt : dz > 0.3 * dt) out.back++;
    }
  }
  out.meanDz = out.men ? +(out.meanDz / out.men).toFixed(2) : 0;
  return out;
}
const centroid = (fr, team) => {
  const l = fr.list.filter((m) => m[4] === team && FIGHTERS.has(m[6]) && (team !== 1 || m[2] > -126));
  if (!l.length) return null;
  return { x: l.reduce((s, m) => s + m[1], 0) / l.length, z: l.reduce((s, m) => s + m[2], 0) / l.length, n: l.length };
};
try {
  const page = await open("guided-webgl-low", "guided");
  await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 180000 });
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 60 && !!window.__rep, null, { timeout: 180000, polling: 200 });
  const coach = () => page.evaluate(() => { const c = window.__sandbox.coach?.state; return c ? { step: c.step, phase: c.phase, title: document.querySelector("#coach .coach-title, #coach b")?.textContent ?? "" } : null; });
  console.log("start", JSON.stringify(await look(page)), "coach", JSON.stringify(await coach()));
  // To the first wave at its hold marker.
  await adv(page, 50);
  let f0 = await field(page);
  await adv(page, 3);
  let f1 = await field(page);
  console.log("t", (f1.tick / 60).toFixed(1), "held wave (Hold, 3 s):", JSON.stringify(motion(f0, f1, 1)), "centroid", JSON.stringify(centroid(f1, 1)), "coach", JSON.stringify(await coach()));
  const c = centroid(f1, 1) ?? { x: 48, z: -84 };
  const camHold = { x: c.x - 14, y: 7, z: c.z - 12, tx: c.x, ty: 0.8, tz: c.z + 2, fov: 50 };
  await shot(page, "guided-1-held-at-marker", camHold);
  console.log("look", JSON.stringify(await look(page)));
  // Advance, by the card's button (the sim steps by hand: one second with it).
  // As the coach's step says: "Pick a road under the map, then Advance". The held wave is on the left flank; pick the right.
  const rr = await page.evaluate(() => window.__diag.run([
    { label: "guided: Right button (the coach's road)", click: '[data-route="right"]', want: 'r.route === "right"', ms: 60000 },
    { label: "guided: Advance button", click: '[data-order="0"]', want: "r.order === 0", ms: 60000 },
  ], true));
  for (const x of rr) console.log(fmt(x));
  console.log("coach after Advance", JSON.stringify(await coach()));
  f0 = await field(page);
  await adv(page, 3);
  f1 = await field(page);
  console.log("first 3 s after Advance:", JSON.stringify(motion(f0, f1, 1)));
  await shot(page, "guided-2-advance-3s", camHold);
  await adv(page, 5);
  const f2 = await field(page);
  console.log("next 5 s:", JSON.stringify(motion(f1, f2, 1)), "centroid", JSON.stringify(centroid(f2, 1)));
  const byFlank = (fr) => { const l = fr.list.filter((m) => m[4] === 1 && FIGHTERS.has(m[6]) && m[2] > -126); return { left: l.filter((m) => m[1] > 20).length, centre: l.filter((m) => Math.abs(m[1]) <= 20).length, right: l.filter((m) => m[1] < -20).length }; };
  console.log("your men out by road after picking Right then Advance (left flank is x > 20):", JSON.stringify(byFlank(f2)));
  // Hold again, then Advance by Ctrl+1: the key path in the guided match.
  const ha = await page.evaluate(() => window.__diag.run([
    { label: "guided: Ctrl+2", key: "Digit2", opts: { ctrlKey: true, key: "2" }, want: "r.order === 1", ms: 60000 },
    { label: "guided: line \"advance\"", say: "advance", want: "r.order === 0", ms: 60000 },
  ], true));
  for (const x of ha) console.log(fmt(x));
  // On to the bridge and beyond.
  await adv(page, 12);
  const f3 = await field(page);
  const c3 = centroid(f3, 1);
  await adv(page, 3);
  const f4 = await field(page);
  console.log("t", (f4.tick / 60).toFixed(1), "marching (3 s):", JSON.stringify(motion(f3, f4, 1)), "centroid", JSON.stringify(centroid(f4, 1)));
  if (c3) await shot(page, "guided-3-marching", { x: c3.x - 12, y: 8, z: c3.z - 14, tx: c3.x, ty: 0.8, tz: c3.z + 4, fov: 50 });
  await adv(page, 35);
  const f5 = await field(page);
  await adv(page, 3);
  const f6 = await field(page);
  const c6 = centroid(f6, 1);
  console.log("men by road later:", JSON.stringify(byFlank(f6)));
  console.log("t", (f6.tick / 60).toFixed(1), "later (3 s):", JSON.stringify(motion(f5, f6, 1)), "centroid", JSON.stringify(c6), "enemy", JSON.stringify(motion(f5, f6, 0)), "look", JSON.stringify(await look(page)));
  if (c6) await shot(page, "guided-4-later", { x: c6.x - 12, y: 9, z: c6.z - 14, tx: c6.x, ty: 0.8, tz: c6.z + 4, fov: 50 });
  await page.keyboard.press("Tab");
  await shot(page, "guided-5-overview", null);
  console.log("coach at the end", JSON.stringify(await coach()));
  const lg = JSON.parse(await page.evaluate(() => window.__sandbox.saveLog()));
  console.log("match log, order/route inputs:", JSON.stringify(lg.inputs.filter((e) => ["order", "route", "barracks"].includes(e[3].kind)).map((e) => [e[0], e[1], e[3]])));
} finally {
  await stop();
}
