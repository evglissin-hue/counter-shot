// 3.5 machines, the player's chair: a Versus AI match against the Knight, stepped by hand, with stills and every note and
// toast the page shows (logged with the match clock). You open the build menu (eight plots, the Spotter's Tower), hold C
// on their keep with no spotter's tower of yours, switch Works repairs off and on (Alt+5), then sit while the Knight plays:
// every note about the bell, the crane and the signal mast is printed as it shows, with the masons' line, and stills are
// taken when one of your organs or theirs goes down. Stills in tools/.shots/army-diag/machines-chair-*.png.
// Usage: PORT=5296 node tools/machines-chair.mjs
import { start, adv, shot, sleep } from "./army-diag/page/lib.mjs";

const { open, stop } = await start();
try {
  const page = await open("versus=knight-webgl-low", "versus");
  await page.waitForSelector("#loading[hidden]", { state: "attached", timeout: 600000 });
  await page.waitForFunction(() => (window.__sandbox.match?.tick ?? 0) > 60 && !!window.__rep, null, { timeout: 600000, polling: 500 });
  // Every note and toast, with the match clock.
  await page.evaluate(() => {
    window.__words = [];
    const clock = () => ((window.__sandbox.match?.tick ?? 0) / 60).toFixed(0) + " s";
    const watch = (id, what) => {
      const el = document.getElementById(id);
      new MutationObserver(() => {
        const t = el.textContent.trim();
        if (t && !el.hidden) window.__words.push(`${clock()} ${what}: ${t}`);
      }).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    };
    watch("note", "note");
    watch("feat-toast", "toast");
    watch("masons", "masons");
  });
  const words = async () => {
    const w = await page.evaluate(() => window.__words.splice(0));
    for (const l of w) console.log("  " + l);
  };
  await page.evaluate(() => window.__sandbox.advance(0.1));
  // The build menu: B.
  await page.keyboard.press("KeyB");
  await sleep(1500);
  console.log("build menu:", (await page.evaluate(() => document.getElementById("build")?.innerText ?? "")).replace(/\s+/g, " ").slice(0, 900));
  await shot(page, "machines-chair-1-build", null, 1500);
  await page.keyboard.press("Escape");
  await sleep(500);
  // Hold C on their keep (the sight looks at it from the start) with no spotter's tower.
  await page.keyboard.down("KeyC");
  await sleep(2500);
  await words();
  console.log("eye labels:", (await page.evaluate(() => document.getElementById("eye-labels")?.innerText ?? "")).replace(/\s+/g, " ").slice(0, 200));
  await shot(page, "machines-chair-2-eye-no-spotter", null, 500);
  await page.keyboard.up("KeyC");
  // Works off and on again: Alt+5.
  await page.keyboard.press("Alt+Digit5");
  await adv(page, 2);
  await words();
  console.log("works chip:", await page.evaluate(() => document.querySelector('[data-repair="works"]')?.className ?? "none"), "| masons:", await page.evaluate(() => document.getElementById("masons").textContent + " / " + document.getElementById("masons").title));
  await page.keyboard.press("Alt+Digit5");
  await adv(page, 2);
  await words();
  // Sit and watch, 15 s at a time; a still whenever an organ of either side changes.
  let prev = null, n = 3;
  for (let k = 0; k < 40; k++) {
    await adv(page, 15);
    await words();
    const now = await page.evaluate(() => {
      const r = window.__rep;
      return r && r.organs ? { tick: r.tick, organs: r.organs.map((side) => side.map((o) => (o.up ? "up" : `down(${o.wait})`))), spotter: r.spotter, result: r.result ?? null } : null;
    });
    if (!now) continue;
    const key = JSON.stringify(now.organs);
    if (prev !== key) {
      console.log(`${(now.tick / 60).toFixed(0)} s organs (theirs, yours): ${JSON.stringify(now.organs)} spotter ${JSON.stringify(now.spotter)}`);
      if (prev !== null && n < 9) await shot(page, `machines-chair-${n++}-organs`, null, 800);
      prev = key;
    }
    if (now.result) {
      console.log("result", JSON.stringify(now.result));
      break;
    }
  }
  await page.evaluate(() => window.__diag?.key?.("Tab"));
  await shot(page, "machines-chair-9-overview", null);
} finally {
  await stop();
}
