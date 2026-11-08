// Replays the scripted sandbox session and the scripted matches (the keep, the waves and the building) in this browser
// and compares their hashes with the ones pinned from Node. Used by the
// headless check and on devices.

import { BUILD_MATCH_HASH, MATCH_HASH, runBuildMatch, runMatchSession, runWaveMatch, WAVE_MATCH_HASH } from "@keepfall/rules";
import { runSession, SESSION_HASH, type Rapier } from "@keepfall/sim";

const out = document.getElementById("out")!;
(async () => {
  try {
    const m = await import("@dimforge/rapier3d-deterministic-compat");
    const R = (m.default ?? m) as unknown as Rapier;
    await R.init();
    const t0 = performance.now();
    const r = runSession(R);
    const t1 = performance.now();
    const g = runMatchSession(R);
    const t2 = performance.now();
    const w = runWaveMatch(R);
    const t3 = performance.now();
    const b = runBuildMatch(R);
    const t4 = performance.now();
    const same = (a: { state: string; world: string }, b: { state: string; world: string }) => a.state === b.state && a.world === b.world;
    const ok = same(r.hash, SESSION_HASH) && same(g.hash, MATCH_HASH) && same(w.hash, WAVE_MATCH_HASH) && same(b.hash, BUILD_MATCH_HASH);
    out.textContent =
      `${ok ? "MATCH" : "MISMATCH"} session state ${r.hash.state} world ${r.hash.world} (Node: ${SESSION_HASH.state} ${SESSION_HASH.world}), ${r.down} down, ${Math.round(t1 - t0)} ms; ` +
      `match state ${g.hash.state} world ${g.hash.world} (Node: ${MATCH_HASH.state} ${MATCH_HASH.world}), won at tick ${g.result?.tick ?? "none"}, ${Math.round(t2 - t1)} ms; ` +
      `wave match state ${w.hash.state} world ${w.hash.world} (Node: ${WAVE_MATCH_HASH.state} ${WAVE_MATCH_HASH.world}), ${w.fallen[0] + w.fallen[1]} fallen, ${Math.round(t3 - t2)} ms; ` +
      `building match state ${b.hash.state} world ${b.hash.world} (Node: ${BUILD_MATCH_HASH.state} ${BUILD_MATCH_HASH.world}), gold ${b.gold[0]} and ${b.gold[1]}, ${Math.round(t4 - t3)} ms`;
    out.dataset.result = ok ? "match" : "mismatch";
  } catch (err) {
    out.textContent = `ERROR ${err instanceof Error ? err.message : String(err)}`;
    out.dataset.result = "error";
  }
})();
