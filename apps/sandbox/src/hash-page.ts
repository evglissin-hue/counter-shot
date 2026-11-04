// Replays the scripted sandbox session in this browser and compares its hash
// with the one pinned from Node. Used by the headless check and on devices.

import { runSession, SESSION_HASH, type Rapier } from "@keepfall/sim";

const out = document.getElementById("out")!;
(async () => {
  try {
    const m = await import("@dimforge/rapier3d-deterministic-compat");
    const R = (m.default ?? m) as unknown as Rapier;
    await R.init();
    const t0 = performance.now();
    const r = runSession(R);
    const ms = performance.now() - t0;
    const match = r.hash.state === SESSION_HASH.state && r.hash.world === SESSION_HASH.world;
    out.textContent = `${match ? "MATCH" : "MISMATCH"} state ${r.hash.state} world ${r.hash.world} (Node: ${SESSION_HASH.state} ${SESSION_HASH.world}), ${r.down} down, ${Math.round(ms)} ms`;
    out.dataset.result = match ? "match" : "mismatch";
  } catch (err) {
    out.textContent = `ERROR ${err instanceof Error ? err.message : String(err)}`;
    out.dataset.result = "error";
  }
})();
