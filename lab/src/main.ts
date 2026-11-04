// Keepfall lab page: a live siege sandbox plus a device test.

import { aim, arc, SIEGE_SHOTS } from "@keepfall/sim";
import { buildLayout } from "@keepfall/content";
import type { FromWorker, ToWorker } from "./physics/protocol";
import { gpuName, measureRefresh, probe } from "./probe";
import { LabRenderer, type QualityTier, type StyleName, type ViewMode } from "./render/LabRenderer";
import { copyText, saveResult, watchResults, type GraphicsRow, type LabResult } from "./results";

/** Deterministic siege hashes from the reference run (Node 22, x86-64). Same code must give the same bits everywhere. */
const REFERENCE = { state: "35a7603f", snapshot: "054e5eb0" };
const LAB_BUILD = "lab-3";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("scene");
const layout = buildLayout(1);
const renderer = new LabRenderer(canvas);
const worker = new Worker(new URL("./physics/physics.worker.ts", import.meta.url), { type: "module" });
const send = (msg: ToWorker) => worker.postMessage(msg);

let style: StyleName = "warm";
let quality: QualityTier = "high";
let view: ViewMode = "cannon";
let backend = "--";
let physicsMs = 0;
let lastTarget: { x: number; y: number; z: number } | null = null;
let benchHook: ((now: number) => void) | null = null;
/** True while measuring the screen's refresh rate: the scene is not drawn so frames are cheap. */
let paused = false;
const waiters = new Map<string, Array<(m: FromWorker) => void>>();

function waitFor<T extends FromWorker["t"]>(t: T): Promise<Extract<FromWorker, { t: T }>> {
  return new Promise((resolve) => {
    const list = waiters.get(t) ?? [];
    list.push(resolve as (m: FromWorker) => void);
    waiters.set(t, list);
  });
}

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  switch (m.t) {
    case "frame": {
      if (m.count) renderer.updateBodies(m.bodies, m.count);
      renderer.setBalls(m.balls, m.ballCount);
      for (let i = 0; i < m.impacts.length; i += 4) {
        renderer.spawnImpact(m.impacts[i], m.impacts[i + 1], m.impacts[i + 2], m.impacts[i + 3]);
      }
      physicsMs = m.stepMs;
      $("r-loose").textContent = String(m.loose);
      $("r-awake").textContent = String(m.awake);
      break;
    }
    case "ready":
      $("loading").hidden = true;
      break;
    case "toppled":
      if (!benchHook) showToast();
      break;
    case "progress":
      setProgress(0.45 + 0.55 * physicsProgress(m.label, m.fraction), m.label);
      break;
    case "error":
      $("progress-label").textContent = `Physics error: ${m.message}`;
      $("loading-detail").textContent = `Physics error: ${m.message}`;
      break;
  }
  const list = waiters.get(m.t);
  if (list?.length) {
    waiters.delete(m.t);
    for (const fn of list) fn(m);
  }
};
worker.onerror = (e) => {
  $("loading-detail").textContent = `The physics worker failed to start: ${e.message || "unknown error"}`;
};

// ---------------------------------------------------------------------------
// Firing

function shotTo(t: { x: number; y: number; z: number }) {
  const c = layout.cannon;
  const dx = t.x - c.x, dz = t.z - c.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const time = Math.min(4.5, Math.max(1.5, dist / 48));
  const v = aim(c.x, c.y, c.z, t.x, t.y, t.z, time);
  return { c, v, time };
}

function previewAt(t: { x: number; y: number; z: number } | null) {
  if (!t) {
    renderer.setAimArc(null);
    return;
  }
  const { c, v, time } = shotTo(t);
  renderer.setAimArc(arc(c.x, c.y, c.z, v[0], v[1], v[2], 0, time * 0.45, 28)); // partial arc: the first 45% of the flight
}

function fireAt(t: { x: number; y: number; z: number }) {
  const { c, v, time } = shotTo(t);
  send({ t: "fire", x: c.x, y: c.y, z: c.z, vx: v[0], vy: v[1], vz: v[2] });
  renderer.setGhostTrail(arc(c.x, c.y, c.z, v[0], v[1], v[2], 0, time, 64));
  lastTarget = t;
}

let down: { x: number; y: number; t: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  if (e.pointerType !== "mouse") previewAt(renderer.pick(e.clientX, e.clientY));
});
canvas.addEventListener("pointermove", (e) => {
  if (benchHook) return;
  if (e.pointerType === "mouse" && !down) previewAt(renderer.pick(e.clientX, e.clientY));
});
canvas.addEventListener("pointerup", (e) => {
  if (!down || benchHook) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = e.timeStamp - down.t < 700; // event times, so a busy frame cannot turn a tap into a long press
  down = null;
  if (moved > 8 || !quick) return;
  const p = renderer.pick(e.clientX, e.clientY);
  if (p) fireAt(p);
});
canvas.addEventListener(
  "wheel",
  (e) => {
    if (view !== "cannon" || benchHook) return;
    e.preventDefault();
    renderer.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
  },
  { passive: false },
);
canvas.addEventListener("pointerleave", () => {
  if (!benchHook) renderer.setAimArc(null);
});
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  if (e.code === "Space" && lastTarget && !benchHook) {
    e.preventDefault();
    fireAt(lastTarget);
  } else if (e.code === "KeyR" && !benchHook) {
    rebuild();
  } else if ((e.key === "+" || e.key === "=") && view === "cannon") {
    renderer.zoom(1 / 1.12);
  } else if ((e.key === "-" || e.key === "_") && view === "cannon") {
    renderer.zoom(1.12);
  }
});

function rebuild() {
  renderer.resetStones();
  renderer.setGhostTrail(null);
  send({ t: "reset" });
  $("toast").hidden = true;
}
$("reset").addEventListener("click", rebuild);

let toastTimer = 0;
function showToast() {
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ($("toast").hidden = true), 6000);
}

// ---------------------------------------------------------------------------
// Controls

function pressed(attr: string, value: string) {
  document.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[attr] === value)));
}
document.querySelectorAll<HTMLButtonElement>("[data-style]").forEach((b) =>
  b.addEventListener("click", () => {
    style = b.dataset.style as StyleName;
    renderer.setStyle(style);
    pressed("style", style);
    remember();
  }),
);
document.querySelectorAll<HTMLButtonElement>("[data-quality]").forEach((b) =>
  b.addEventListener("click", () => {
    quality = b.dataset.quality as QualityTier;
    renderer.setQuality(quality);
    renderer.resize();
    pressed("quality", quality);
    remember();
  }),
);
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    view = b.dataset.view as ViewMode;
    renderer.setView(view);
    pressed("view", view);
  }),
);
$("panel-toggle").addEventListener("click", () => {
  const panel = $("panel");
  const open = panel.classList.toggle("closed") === false;
  $("panel-toggle").setAttribute("aria-expanded", String(open));
});

function remember() {
  try {
    localStorage.setItem("cs-lab", JSON.stringify({ style, quality, label: ($("device-label") as HTMLInputElement).value }));
  } catch {
    // storage is optional
  }
}
function recall() {
  try {
    const saved = JSON.parse(localStorage.getItem("cs-lab") || "{}") as { style?: StyleName; quality?: QualityTier; label?: string };
    if (saved.style) style = saved.style;
    if (saved.quality) quality = saved.quality;
    if (saved.label) ($("device-label") as HTMLInputElement).value = saved.label;
  } catch {
    // storage is optional
  }
}
$("device-label").addEventListener("change", remember);

// ---------------------------------------------------------------------------
// Device test

function setProgress(fraction: number, label: string) {
  $("progress-fill").style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  $("progress-label").textContent = label;
}

const PHYS_STAGES = ["Siege (deterministic)", "Moving stones (deterministic)", "Loading the fast build", "Siege (simd)", "Moving stones (simd)"];
function physicsProgress(label: string, fraction: number): number {
  const i = PHYS_STAGES.findIndex((s) => label.startsWith(s));
  return i < 0 ? 0 : (i + Math.min(1, fraction)) / PHYS_STAGES.length;
}

async function graphicsTest(): Promise<GraphicsRow[]> {
  const tiers: QualityTier[] = ["low", "medium", "high", "ultra"];
  const rows: GraphicsRow[] = [];
  const WARM = 1.5; // seconds per tier to compile shaders before measuring
  const MEASURE = 6;
  renderer.setView("flyover");
  renderer.setAimArc(null);
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    setProgress((i / tiers.length) * 0.45, `Graphics: ${tier} quality`);
    renderer.setQuality(tier);
    renderer.resize();
    renderer.resetStones();
    send({ t: "reset" });
    await waitFor("ready");
    const frames: number[] = [];
    const gpu: number[] = [];
    await new Promise<void>((resolve) => {
      const start = performance.now();
      let last = start;
      let fired = 0;
      let warmed = false;
      benchHook = (now) => {
        const t = (now - start) / 1000;
        renderer.setFlyoverTime(t);
        if (!warmed && t > 0.2) {
          renderer.spawnImpact(-6, 3, -16, 0.8); // compiles the dust and chip effects before measuring
          warmed = true;
        }
        if (fired < 3 && t > WARM + 0.2 + fired * 0.9) {
          const shot = SIEGE_SHOTS[fired];
          const c = layout.cannon;
          const v = aim(c.x, c.y, c.z, shot.target[0], shot.target[1], shot.target[2], shot.time);
          send({ t: "fire", x: c.x, y: c.y, z: c.z, vx: v[0], vy: v[1], vz: v[2] });
          fired++;
        }
        if (t > WARM) {
          frames.push(now - last);
          const g = renderer.getStats().gpuMs;
          if (g !== null && g > 0) gpu.push(g);
        }
        last = now;
        if (t > WARM + MEASURE) {
          benchHook = null;
          resolve();
        }
      };
    });
    const sorted = [...frames].sort((a, b) => a - b);
    const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    const avgMs = frames.reduce((s, f) => s + f, 0) / Math.max(1, frames.length);
    gpu.sort((a, b) => a - b);
    rows.push({
      tier,
      fps: Math.round(1000 / Math.max(0.1, pick(0.5))), // typical frame rate, from the median frame
      avgFps: Math.round(1000 / Math.max(0.1, avgMs)),
      p95Ms: Math.round(pick(0.95) * 10) / 10,
      hitches: frames.filter((f) => f > 50).length,
      gpuMs: gpu.length ? Math.round(gpu[Math.floor(gpu.length / 2)] * 10) / 10 : null,
    });
  }
  return rows;
}

/** The highest tier that runs smoothly: typical frame rate near the screen's, no long stalls. */
function recommend(rows: GraphicsRow[], refreshHz: number): string {
  const target = Math.min(55, refreshHz * 0.9);
  let best = "low";
  for (const r of rows) if (r.fps >= target && r.p95Ms <= 33 && r.hitches <= 3) best = r.tier;
  return best;
}

let lastResult: LabResult | null = null;

async function runTest() {
  const runBtn = $<HTMLButtonElement>("run");
  runBtn.disabled = true;
  $<HTMLButtonElement>("copy").disabled = true;
  $("save-status").hidden = true;
  $("summary").innerHTML = "";
  const typed = ($("device-label") as HTMLInputElement).value.trim();
  try {
    setProgress(0, "Checking the device");
    const device = await probe();
    const label = typed || `${device.os}, ${gpuName(device)}`;
    paused = true;
    const refreshHz = await measureRefresh().finally(() => (paused = false));
    const rows = await graphicsTest();
    renderer.setQuality(quality);
    renderer.setView(view);
    renderer.resize();
    setProgress(0.45, "Physics: siege replay");
    send({ t: "bench" });
    const bench = await waitFor("bench");
    renderer.resetStones();
    const matches = bench.siegeDet.hash.state === REFERENCE.state && bench.siegeDet.hash.snapshot === REFERENCE.snapshot;
    const result: LabResult = {
      version: 1,
      label,
      at: new Date().toISOString(),
      build: LAB_BUILD,
      device,
      graphics: { backend, refreshHz, style, rows, recommended: recommend(rows, refreshHz) },
      physics: { ...bench, reference: REFERENCE, matchesReference: matches },
    };
    lastResult = result;
    renderSummary(result);
    setProgress(1, "Done");
    $<HTMLButtonElement>("copy").disabled = false;
    const saved = await saveResult(result);
    const status = $("save-status");
    status.hidden = false;
    status.className = saved ? "ok" : "warn";
    status.textContent = saved
      ? "Saved to this page. Claude can read it now."
      : "Could not save here (open the page on claude.ai while signed in). Use Copy results and paste them to Claude.";
  } catch (err) {
    setProgress(0, `The test stopped: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    benchHook = null;
    runBtn.disabled = false;
    runBtn.textContent = "Run again";
  }
}
$("run").addEventListener("click", () => void runTest());
$("copy").addEventListener("click", async () => {
  if (!lastResult) return;
  const ok = await copyText(JSON.stringify(lastResult), $<HTMLTextAreaElement>("copy-fallback"));
  const status = $("save-status");
  status.hidden = false;
  status.textContent = ok ? "Copied. Paste it into your chat with Claude." : "Select the text below and copy it.";
});

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const fmt = (n: number) => n.toLocaleString("en-GB");
const TIER_NAME: Record<string, string> = { low: "Low", medium: "Medium", high: "High", ultra: "Ultra" };

function renderSummary(r: LabResult) {
  const d = r.device;
  const g = r.graphics;
  const p = r.physics;
  const tierRows = g.rows
    .map((row) => `<tr><td>${TIER_NAME[row.tier]}</td><td class="num">${row.fps}</td><td class="num">${row.p95Ms}</td><td class="num">${row.hitches ?? "--"}</td><td class="num">${row.gpuMs ?? "--"}</td></tr>`)
    .join("");
  const fast = p.rubbleSimd ? ` (fast build: ${fmt(p.rubbleSimd.comfortable)})` : "";
  $("summary").innerHTML = `
    <dl class="facts">
      <div><dt>Device</dt><dd>${esc(d.browser)} on ${esc(d.os)}, ${d.cores} cores</dd></div>
      <div><dt>Graphics chip</dt><dd>${esc(gpuName(d))} via ${esc(g.backend)}</dd></div>
      <div><dt>Smooth up to</dt><dd><b>${TIER_NAME[g.recommended]}</b> at ${g.refreshHz} Hz</dd></div>
      <div><dt>Physics budget</dt><dd>${fmt(p.rubbleDet.comfortable)} moving stones at 60 Hz${fast}</dd></div>
      <div><dt>Siege replay</dt><dd class="num">${p.siegeDet.stats.avg} ms average step, ${p.siegeDet.stats.max} ms worst</dd></div>
      <div><dt>Same result as reference</dt><dd class="${p.matchesReference ? "ok" : "bad"}">${p.matchesReference ? "Yes, bit for bit" : `No (${esc(p.siegeDet.hash.state)})`}</dd></div>
    </dl>
    <div class="tablewrap"><table><thead><tr><th>Quality</th><th class="num">FPS</th><th class="num">Slow frame ms</th><th class="num">Stalls</th><th class="num">GPU ms</th></tr></thead><tbody>${tierRows}</tbody></table></div>`;
}

function renderHistory(rows: LabResult[]) {
  if (!rows.length) {
    $("history-wrap").hidden = true;
    return;
  }
  $("history-wrap").hidden = false;
  const body = rows
    .map(
      (r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.device.browser)}</td><td>${esc(gpuName(r.device)).slice(0, 28)}</td><td>${TIER_NAME[r.graphics.recommended] ?? "--"}</td><td class="num">${fmt(r.physics.rubbleDet.comfortable)}</td><td class="${r.physics.matchesReference ? "ok" : "bad"}">${r.physics.matchesReference ? "same" : "differs"}</td></tr>`,
    )
    .join("");
  $("history").innerHTML = `<thead><tr><th>Device</th><th>Browser</th><th>Graphics</th><th>Smooth</th><th class="num">Stones</th><th>Result</th></tr></thead><tbody>${body}</tbody>`;
}

// ---------------------------------------------------------------------------
// Boot

let frames = 0;
let fpsAt = performance.now();
let lastFrame = performance.now();

function loop(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (benchHook) benchHook(now);
  if (!paused) renderer.render(dt);
  frames++;
  if (now - fpsAt > 500) {
    const stats = renderer.getStats();
    $("r-fps").textContent = `${Math.round((frames * 1000) / (now - fpsAt))} fps`;
    $("r-gpu").textContent = stats.gpuMs !== null ? `${stats.gpuMs.toFixed(1)} ms` : "n/a";
    $("r-phys").textContent = `${physicsMs.toFixed(1)} ms`;
    frames = 0;
    fpsAt = now;
  }
  requestAnimationFrame(loop);
}

async function boot() {
  recall();
  pressed("style", style);
  pressed("quality", quality);
  pressed("view", view);
  try {
    const info = await renderer.init({ forceWebGL: location.hash === "#webgl" });
    backend = info.backend;
  } catch (err) {
    $("loading-detail").textContent = `Graphics failed to start: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  $("r-backend").textContent = backend;
  renderer.onDeviceLost = (message) => {
    const toast = $("toast");
    toast.innerHTML = "";
    const title = document.createElement("strong");
    title.textContent = "Graphics stopped";
    const text = document.createElement("span");
    text.textContent = `The browser lost the WebGPU device (${message}). `;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "primary";
    retry.textContent = "Reload with WebGL2";
    retry.addEventListener("click", () => {
      location.hash = "webgl";
      location.reload();
    });
    toast.append(title, text, retry);
    toast.hidden = false;
  };
  renderer.setLayout(layout);
  renderer.setStyle(style);
  renderer.setQuality(quality);
  renderer.setView(view);
  renderer.resize();
  window.addEventListener("resize", () => renderer.resize());
  send({ t: "init" });
  requestAnimationFrame(loop);
  void watchResults(renderHistory, () => undefined);
}

// Handles for automated checks and for poking at the lab from the browser console.
(window as unknown as { __lab: unknown }).__lab = { renderer, layout, fireAt, rebuild };

void boot();
