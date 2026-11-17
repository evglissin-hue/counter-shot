// 3.6 the household, the player's chair: a Versus AI match against the Knight, stepped by hand, with stills and every note
// and toast the page shows (logged with the match clock). You open the household panel (J) and read it, then sit while the
// Knight plays: every note about your household is printed as it shows, with the weapon card's crew line and the panel's
// reserve line whenever your roster changes (a place lost, a hand on the way, a place taken), and stills are taken when it
// does (at most eight). At the end: the end screen's rows. Stills in tools/.shots/army-diag/household-chair-*.png.
// Usage: PORT=5297 node tools/household-chair.mjs [secs=600]
import { start, adv, shot, sleep } from "./army-diag/page/lib.mjs";

const secs = Number(process.argv.find((a) => a.startsWith("secs="))?.split("=")[1] ?? 600);
const { open, stop } = await start();
try {
  const page = await open("versus=knight-webgl-low", "versus");
  await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 600000 });
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 60 && !!window.__rep, null, { timeout: 600000, polling: 500 });
  await page.evaluate(() => {
    window.__words = [];
    const clock = () => ((window.__sandbox.match?.tick ?? 0) / 60).toFixed(0) + " s";
    const watch = (id, what) => {
      const el = document.getElementById(id);
      if (!el) return;
      new MutationObserver(() => {
        const t = el.textContent.trim();
        if (t && !el.hidden) window.__words.push(`${clock()} ${what}: ${t}`);
      }).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    };
    watch("note", "note");
    watch("feat-toast", "toast");
  });
  const words = async () => {
    const w = await page.evaluate(() => window.__words.splice(0));
    for (const l of w) console.log("  " + l);
  };
  const text = (sel) => page.evaluate((s) => (document.querySelector(s)?.innerText ?? "").replace(/\s+/g, " ").trim(), sel);
  await page.evaluate(() => window.__sandbox.advance(0.1));
  // The household panel: J.
  await page.keyboard.press("KeyJ");
  await sleep(1500);
  const panelSel = "#household";
  console.log("panel:", (await text(panelSel)).slice(0, 900));
  await shot(page, "household-chair-1-panel", null, 1000);
  await page.keyboard.press("KeyJ");
  await sleep(500);
  console.log("weapon card:", (await text(".weapon")).slice(0, 300));
  await shot(page, "household-chair-2-gun", null, 500);
  // Sit and watch, 10 s at a time; a still whenever your roster changes.
  let prev = null, n = 3;
  for (let t = 0; t < secs; t += 10) {
    await adv(page, 10);
    await words();
    const now = await page.evaluate(() => {
      const r = window.__sandbox.match;
      if (!r) return null;
      // Your own castle's guns only (the page's team: slots 0 to 7 of its castle in match order).
      const base = r.team === 1 ? 0 : 8;
      const crews = r.crews ? Array.from(r.crews).slice(base * 3, base * 3 + 24) : null;
      return { tick: r.tick, crews, result: r.result ?? null };
    });
    if (!now) continue;
    const key = JSON.stringify(now.crews);
    if (prev !== key) {
      const panel = await (async () => {
        await page.keyboard.press("KeyJ");
        await sleep(600);
        const p = await text(panelSel);
        return p;
      })();
      console.log(`${(now.tick / 60).toFixed(0)} s crews (men, level, coming per gun): ${JSON.stringify(now.crews)}`);
      console.log(`   panel: ${panel.slice(0, 700)}`);
      if (prev !== null && n < 9) await shot(page, `household-chair-${n++}-roster`, null, 600);
      await page.keyboard.press("KeyJ");
      await sleep(300);
      console.log(`   weapon card: ${(await text(".weapon")).slice(0, 200)}`);
      prev = key;
    }
    if (now.result) {
      console.log("result", JSON.stringify(now.result));
      break;
    }
  }
  await sleep(2000);
  console.log("end screen:", (await text("#end")).slice(0, 1200));
  await shot(page, "household-chair-9-end", null, 500);
} finally {
  await stop();
}
