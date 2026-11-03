// Debug page: physics benchmarks only, no graphics.
import type { FromWorker } from "./physics/protocol";

const out = document.getElementById("out")!;
const worker = new Worker(new URL("./physics/physics.worker.ts", import.meta.url), { type: "module" });
const t0 = performance.now();
worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  if (m.t === "ready") {
    out.textContent = `ready: ${m.stones} stones, setup ${m.setupMs} ms; running benchmarks`;
    worker.postMessage({ t: "bench" });
  } else if (m.t === "progress") {
    out.textContent = `${m.label} ${Math.round(m.fraction * 100)}%`;
  } else if (m.t === "bench") {
    out.textContent = JSON.stringify(m, null, 1);
    document.title = "done " + Math.round(performance.now() - t0);
  } else if (m.t === "error") {
    out.textContent = "error: " + m.message;
    document.title = "error";
  }
};
worker.postMessage({ t: "init" });
