// Standalone harness for the renderer (served at /render.html): style,
// quality and view buttons, a fake collapse, an aim arc and ghost trail sample
// and two cannonballs. URL parameters drive it for automated screenshots:
//   ?style=warm|gritty|lowpoly &quality=low|medium|high|ultra
//   &view=cannon|orbit|flyover &webgl=1 &shot=1 (hide UI)
//   &dt=0.016 (fixed time step per frame) &fly=3.5 (fixed flyover time)
//   &collapse=1.2 (run the fake collapse and hold it at that time)
//   &cam=x,y,z,tx,ty,tz (orbit camera placement)

import { buildLayout, type Stone } from "@keepfall/content";
import { LabRenderer, type QualityTier, type StyleName, type ViewMode } from "./render/LabRenderer";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("view") as HTMLCanvasElement;
const statsEl = document.getElementById("stats") as HTMLDivElement;
const pickEl = document.getElementById("pickInfo") as HTMLDivElement;
const errorEl = document.getElementById("error") as HTMLDivElement;
if (params.get("shot") === "1") document.body.classList.add("shot");

window.addEventListener("error", (e) => {
  errorEl.textContent += `${e.message}\n`;
});
window.addEventListener("unhandledrejection", (e) => {
  errorEl.textContent += `${String(e.reason)}\n`;
});

const layout = buildLayout(1);
const lab = new LabRenderer(canvas);

interface HarnessState {
  ready: boolean;
  frames: number;
  backend: string;
  error: string | null;
}
const state: HarnessState & { pause: boolean } = { ready: false, frames: 0, backend: "", error: null, pause: false };
(window as unknown as { __lab: unknown }).__lab = { state, lab };

let style = (params.get("style") as StyleName) || "warm";
let quality = (params.get("quality") as QualityTier) || "high";
let view = (params.get("view") as ViewMode) || "cannon";
const fixedDt = params.has("dt") ? Number(params.get("dt")) : 0;
const fixedFly = params.has("fly") ? Number(params.get("fly")) : null;

// --- fake collapse -------------------------------------------------------

interface Mover {
  id: number;
  x: number;
  y: number;
  z: number;
  q: [number, number, number, number];
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  delay: number;
  floor: number;
}

function seeded(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function pickMovers(): Mover[] {
  const wall: Stone[] = [];
  const tower: Stone[] = [];
  for (const s of layout.stones) {
    if (s.castle !== 0) continue;
    const front = s.z < -13.5 && s.z > -16.6;
    if ((s.part === "wall" || s.part === "merlon") && front && Math.abs(s.x) < 10.5 && s.y > 1.2) wall.push(s);
    if (s.part === "tower" || s.part === "merlon") {
      const dx = s.x + 15, dz = s.z + 15;
      if (Math.hypot(dx, dz) < 4.2 && s.y > 7.8) tower.push(s);
    }
  }
  wall.sort((a, b) => b.y - a.y);
  tower.sort((a, b) => b.y - a.y);
  const chosen = [...wall.slice(0, 270), ...tower.slice(0, 130)];
  return chosen.map((s, i) => {
    const r1 = seeded(i + 1), r2 = seeded(i + 101), r3 = seeded(i + 211);
    let vx = (r1 - 0.5) * 2.2;
    let vz = -(1.6 + r2 * 3.2);
    if (s.part === "tower" || Math.hypot(s.x + 15, s.z + 15) < 4.2) {
      const dx = s.x + 15, dz = s.z + 15;
      const l = Math.hypot(dx, dz) || 1;
      vx = (dx / l) * (1.5 + r2 * 2.5) - 0.8;
      vz = (dz / l) * (1.5 + r2 * 2.5) - 1.6;
    }
    return {
      id: s.id,
      x: s.x,
      y: s.y,
      z: s.z,
      q: [...s.q] as [number, number, number, number],
      vx,
      vy: 0.5 + r3 * 2.2,
      vz,
      wx: (seeded(i + 307) - 0.5) * 5,
      wy: (seeded(i + 401) - 0.5) * 3,
      wz: (seeded(i + 503) - 0.5) * 5,
      delay: Math.max(0, (11 - s.y) * 0.03) + r1 * 0.08,
      floor: Math.min(s.hy, 0.3) + 0.02,
    };
  });
}

const movers = pickMovers();
const bodyBuf = new Float32Array(movers.length * 8);
let collapseT = -1;
const holdCollapse = params.has("collapse") ? Number(params.get("collapse")) : null;
let impactsDone = 0;

function quatMul(a: number[], b: number[]): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function stepCollapse(t: number) {
  let n = 0;
  for (const m of movers) {
    const tt = Math.max(0, Math.min(2.2, t - m.delay));
    // Ballistic until the stone reaches the ground, then it rests.
    const a = 0.5 * 9.81;
    const h = m.y - m.floor;
    const tHit = (m.vy + Math.sqrt(m.vy * m.vy + 4 * a * h)) / (2 * a);
    const tf = Math.min(tt, tHit);
    const x = m.x + m.vx * tf;
    const y = Math.max(m.floor, m.y + m.vy * tf - a * tf * tf);
    const z = m.z + m.vz * tf;
    const ang = Math.hypot(m.wx, m.wy, m.wz) * tf;
    const ax = m.wx, ay = m.wy, az = m.wz;
    const al = Math.hypot(ax, ay, az) || 1;
    const s = Math.sin(ang / 2);
    const dq: [number, number, number, number] = [(ax / al) * s, (ay / al) * s, (az / al) * s, Math.cos(ang / 2)];
    const q = quatMul(dq, m.q);
    const o = n * 8;
    bodyBuf[o] = m.id;
    bodyBuf[o + 1] = x;
    bodyBuf[o + 2] = y;
    bodyBuf[o + 3] = z;
    bodyBuf[o + 4] = q[0];
    bodyBuf[o + 5] = q[1];
    bodyBuf[o + 6] = q[2];
    bodyBuf[o + 7] = q[3];
    n++;
  }
  lab.updateBodies(bodyBuf, n);
  if (impactsDone === 0 && t >= 0) {
    lab.spawnImpact(-1.5, 6.5, -16.2, 1.0);
    lab.spawnImpact(4.0, 4.0, -16.2, 0.7);
    lab.spawnImpact(-14.0, 10.5, -18.4, 0.85);
    impactsDone = 1;
  }
  if (impactsDone === 1 && t >= 1.1) {
    lab.spawnImpact(-3, 0.3, -19, 0.6);
    lab.spawnImpact(3, 0.3, -20, 0.5);
    lab.spawnImpact(-12, 0.3, -21, 0.7);
    impactsDone = 2;
  }
}

function startCollapse() {
  collapseT = 0;
  impactsDone = 0;
}

// --- sample trajectories -----------------------------------------------------

function trajectory(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, apex: number, steps: number): Float32Array {
  // A parabola through from and to whose top is `apex` metres above the higher end.
  const g = 9.81;
  const top = Math.max(from.y, to.y) + apex;
  const vy = Math.sqrt(2 * g * (top - from.y));
  const tUp = vy / g;
  const tDown = Math.sqrt((2 * (top - to.y)) / g);
  const T = tUp + tDown;
  const out = new Float32Array((steps + 1) * 3);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * T;
    out[i * 3] = from.x + ((to.x - from.x) * t) / T;
    out[i * 3 + 1] = from.y + vy * t - 0.5 * g * t * t;
    out[i * 3 + 2] = from.z + ((to.z - from.z) * t) / T;
  }
  return out;
}

const muzzle = layout.cannon;
const ghost = trajectory(muzzle, { x: -2.5, y: 4.0, z: -16.0 }, 15, 160);
const aimFull = trajectory(muzzle, { x: 1.5, y: 7.0, z: -16.0 }, 17, 160);
const aimPartial = aimFull.slice(0, Math.floor(160 * 0.45) * 3 + 3);
const balls = new Float32Array(8);

function updateBalls(t: number) {
  // One ball in flight along the ghost path, one resting at the wall's foot.
  const n = ghost.length / 3;
  const f = (0.42 + t * 0.22) % 1;
  const i = Math.min(n - 2, Math.floor(f * (n - 1)));
  const k = f * (n - 1) - i;
  balls[0] = ghost[i * 3] + (ghost[i * 3 + 3] - ghost[i * 3]) * k;
  balls[1] = ghost[i * 3 + 1] + (ghost[i * 3 + 4] - ghost[i * 3 + 1]) * k;
  balls[2] = ghost[i * 3 + 2] + (ghost[i * 3 + 5] - ghost[i * 3 + 2]) * k;
  balls[3] = 0.32;
  balls[4] = 5.2;
  balls[5] = 0.32;
  balls[6] = -19.5;
  balls[7] = 0.32;
  lab.setBalls(balls, 2);
}

// --- UI ------------------------------------------------------------------------

function buttons(rowId: string, items: string[], current: () => string, onPick: (v: string) => void) {
  const row = document.getElementById(rowId)!;
  const els: HTMLButtonElement[] = [];
  for (const it of items) {
    const b = document.createElement("button");
    b.textContent = it;
    b.addEventListener("click", () => {
      onPick(it);
      for (const e of els) e.classList.toggle("on", e.textContent === current());
    });
    els.push(b);
    row.appendChild(b);
  }
  for (const e of els) e.classList.toggle("on", e.textContent === current());
}

function action(label: string, fn: () => void) {
  const b = document.createElement("button");
  b.textContent = label;
  b.addEventListener("click", fn);
  document.getElementById("actionRow")!.appendChild(b);
}

let showArc = true;
let impactN = 0;

async function main() {
  try {
    const { backend } = await lab.init({ forceWebGL: params.get("webgl") === "1" });
    state.backend = backend;
    lab.setLayout(layout);
    lab.setStyle(style);
    lab.setQuality(quality);
    lab.setView(view);
    lab.resize();
    if (params.has("cam")) {
      const v = params.get("cam")!.split(",").map(Number);
      const anyLab = lab as unknown as { views: { camera: { position: { set: (...a: number[]) => void } }; controls: { target: { set: (...a: number[]) => void }; update: () => void } } };
      anyLab.views.camera.position.set(v[0], v[1], v[2]);
      anyLab.views.controls.target.set(v[3], v[4], v[5]);
      anyLab.views.controls.update();
    }
    lab.setAimArc(aimPartial);
    lab.setGhostTrail(ghost);
    if (holdCollapse !== null) startCollapse();
  } catch (e) {
    state.error = String(e);
    errorEl.textContent = `init failed: ${String(e)}`;
    return;
  }

  buttons("styleRow", ["warm", "gritty", "lowpoly"], () => style, (v) => {
    style = v as StyleName;
    lab.setStyle(style);
  });
  buttons("qualityRow", ["low", "medium", "high", "ultra"], () => quality, (v) => {
    quality = v as QualityTier;
    lab.setQuality(quality);
  });
  buttons("viewRow", ["cannon", "orbit", "flyover"], () => view, (v) => {
    view = v as ViewMode;
    lab.setView(view);
  });
  action("Fake collapse", () => {
    lab.resetStones();
    startCollapse();
  });
  action("Reset", () => {
    collapseT = -1;
    lab.resetStones();
  });
  action("Impact", () => {
    impactN++;
    lab.spawnImpact((seeded(impactN) - 0.5) * 20, 1 + seeded(impactN + 50) * 6, -16.2, 0.4 + seeded(impactN + 90) * 0.6);
  });
  action("Arc", () => {
    showArc = !showArc;
    lab.setAimArc(showArc ? aimPartial : null);
    lab.setGhostTrail(showArc ? ghost : null);
  });

  window.addEventListener("resize", () => lab.resize());
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.shiftKey) return;
    const p = lab.pick(e.clientX, e.clientY);
    pickEl.style.display = "block";
    pickEl.textContent = p ? `pick ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}` : "pick: none";
    if (p) lab.spawnImpact(p.x, p.y, p.z, 0.8);
  });

  let last = performance.now();
  let flyT = 0;
  let fpsAcc = 0;
  let fpsN = 0;
  let fps = 0;
  let statsAt = 0;
  let simT = 0;
  const frame = () => {
    if (state.pause) {
      requestAnimationFrame(frame);
      return;
    }
    const now = performance.now();
    const realDt = (now - last) / 1000;
    last = now;
    const dt = fixedDt > 0 ? fixedDt : Math.min(0.1, realDt);
    simT += dt;
    if (collapseT >= 0) {
      if (holdCollapse !== null) collapseT = Math.min(holdCollapse, collapseT + dt);
      else collapseT += dt;
      if (collapseT <= 2.6) stepCollapse(collapseT);
    }
    updateBalls(simT);
    if (view === "flyover") {
      flyT += dt;
      lab.setFlyoverTime(fixedFly !== null ? fixedFly : flyT);
    }
    lab.render(dt);
    state.frames++;
    if (state.frames > 2) state.ready = true;
    fpsAcc += realDt;
    fpsN++;
    if (now - statsAt > 400) {
      fps = fpsN / Math.max(1e-6, fpsAcc);
      fpsAcc = 0;
      fpsN = 0;
      statsAt = now;
      const s = lab.getStats();
      statsEl.textContent =
        `${s.backend}  ${fps.toFixed(0)} fps\n` +
        `gpu   ${s.gpuMs === null ? "n/a" : s.gpuMs.toFixed(2) + " ms"}\n` +
        `draws ${s.drawCalls}\n` +
        `tris  ${(s.triangles / 1e6).toFixed(2)} M\n` +
        `px    ${s.width}x${s.height} @${s.pixelRatio.toFixed(2)}\n` +
        `${style} / ${quality} / ${view}\n` +
        `shift+click: pick`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
