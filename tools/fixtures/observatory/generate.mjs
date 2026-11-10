// Writes a small synthetic run (about 30 matches) that follows the observatory's
// contract (packages/ai/scripts/observe-line.ts). Deterministic: a tiny LCG, no
// Math.random. Run: node tools/fixtures/observatory/generate.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
let state = 12345;
const rnd = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
const between = (a, b) => a + (b - a) * rnd();
const KINDS = ["keep", "crowd", "breach", "raid", "masons", "gun"];
const hex = () => Array.from({ length: 16 }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");

function match(i, sides, winner, reason, minutes) {
  const tick = Math.round(minutes * 3600);
  const secs = tick / 60;
  const loser = winner === 0 ? 1 : winner === 1 ? 0 : -1;
  const samples = [];
  const times = [];
  for (let t = 30; t <= secs; t += 30) times.push(t);
  if (times[times.length - 1] !== secs) times.push(Math.round(secs * 100) / 100);
  const spent = [0, 0];
  const comeback = rnd() < 0.3;
  const rich = [between(10, 90), between(10, 90)];
  let movingMax = 0;
  let worstMs = 0;
  for (const t of times) {
    const f = t / secs;
    const gold = [0, 1].map(() => Math.round(Math.max(0, 150 + 700 * Math.sin(Math.min(f, 1) * 2.6) * (0.5 + rnd()) - 250 * f)));
    for (const s of [0, 1]) spent[s] += Math.round(between(60, 180));
    const floors = [3, 3];
    if (loser >= 0) floors[loser] = Math.max(0, Math.round(3 - 3 * f * between(0.7, 1.3)));
    if (comeback && loser >= 0 && f < 0.7) { floors[winner] = 2; floors[loser] = 3; }
    if (winner === -1) { floors[0] = rnd() < 0.5 ? 3 : 2; floors[1] = 3; }
    const down = [Math.round(f * between(0, 14)), Math.round(f * between(0, 14))];
    if (loser >= 0) down[loser] += Math.round(f * 12);
    const moving = Math.round(between(0, 200));
    const mm = Math.round(moving + between(0, 380) * (rnd() < 0.15 ? 1.5 : 1));
    const ws = Math.round(between(6, 26) * 10) / 10;
    movingMax = Math.max(movingMax, mm);
    worstMs = Math.max(worstMs, ws);
    samples.push({
      t, gold, spent: [...spent], plots: ["bmfBMF", "BMF..x"], floors, down,
      standing: [Math.round(between(4, 30)), Math.round(between(4, 30))],
      fallen: [Math.round(f * between(0, 25)), Math.round(f * between(0, 25))],
      storm: [reason === "storm" && loser === 0 ? Math.round(f * 900) : 0, reason === "storm" && loser === 1 ? Math.round(f * 900) : 0],
      out: [Math.round(between(0, 2)), Math.round(between(0, 2))],
      moving, movingMax: mm, worstMs: ws,
    });
  }
  const byHand = [0, 1].map((s) => {
    const heavy = s === winner ? "keep" : KINDS[Math.floor(rnd() * KINDS.length)];
    const h = Object.fromEntries(KINDS.map((k) => [k, Math.round(between(2, 14))]));
    h[heavy] += s === winner ? 18 : 6;
    return h;
  });
  const build = [];
  for (const s of [0, 1]) {
    const n = Math.floor(between(5, 12));
    const reach = (rnd() < 0.55 ? 1.0 : 0.6) * tick;
    for (let k = 0; k < n; k++) build.push([Math.round(between(200, reach)), s, `build mill ${k % 6}`]);
  }
  build.sort((a, b) => a[0] - b[0]);
  const tot = (s) => Object.values(byHand[s]).reduce((a, b) => a + b, 0);
  return {
    v: 1,
    setup: {
      id: `${sides[0]}-${sides[1]}-s${i}-base`, seed: i, sides, plans: ["stock", "stock"], variant: "base", tuning: {}, secs: 1500,
    },
    rules: { sim: 4, match: 7 },
    result: { winner, reason, tick, hash: { state: hex(), world: hex() } },
    samples,
    totals: {
      byHand, shots: [tot(0), tot(1)], auto: [Math.round(between(0, 20)), Math.round(between(0, 20))], build,
      richSecs: rich.map((r) => Math.round(r * 10) / 10),
      tricks: [Math.round(between(0, 6)), Math.round(between(0, 6))],
      stats: [{ gold: 4000, masons: 3, ladders: 2, storms: 1, silenced: 2, lost: 1 }, { gold: 3800, masons: 2, ladders: 3, storms: 1, silenced: 1, lost: 2 }],
      movingMax, worstMs,
    },
    wall: { ms: Math.round(between(20000, 90000)), speed: Math.round(between(15, 40) * 10) / 10 },
  };
}

const lines = [];
let id = 1;
// Knight mirror: 14 matches. Castle 0 wins 6, castle 1 wins 7, one draw.
const km = [
  [0, "keep", 7.5], [1, "keep", 9.2], [0, "storm", 10.1], [1, "storm", 11.4], [0, "keep", 8.8], [1, "keep", 12.2],
  [0, "storm", 9.9], [1, "storm", 10.6], [1, "keep", 14.8], [0, "keep", 5.2], [1, "storm", 12.9], [0, "storm", 11.0],
  [-1, "time", 25.0], [1, "keep", 6.7],
];
for (const [w, r, m] of km) lines.push(match(id++, ["knight", "knight"], w, r, m));
// Squire mirror: 3 matches.
for (const [w, r, m] of [[0, "keep", 13.5], [1, "storm", 15.3], [0, "surrender", 11.8]]) lines.push(match(id++, ["squire", "squire"], w, r, m));
// Warlord against knight, from both castles: [warlord's castle, warlord won]. The warlord wins 6 of 8.
const wk = [[0, 1], [0, 1], [0, 0], [0, 1], [1, 1], [1, 1], [1, 0], [0, 1]];
wk.forEach(([c, won], k) => {
  const sides = c === 0 ? ["warlord", "knight"] : ["knight", "warlord"];
  const winner = won ? c : 1 - c;
  lines.push(match(id++, sides, winner, k % 3 === 0 ? "storm" : "keep", 7 + k * 0.6));
});
// Warlord against squire: 4 matches, the warlord wins them all.
for (let k = 0; k < 4; k++) {
  const c = k % 2;
  lines.push(match(id++, c === 0 ? ["warlord", "squire"] : ["squire", "warlord"], c, "keep", 5 + k * 0.7));
}
// One no-result line: stopped early at setup.secs.
const nr = match(id++, ["knight", "knight"], null, null, 4);
nr.setup.secs = 240;
lines.push(nr);

fs.writeFileSync(path.join(dir, "matches.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
fs.writeFileSync(path.join(dir, "errors.jsonl"), JSON.stringify({ id: "knight-warlord-s99-base", error: "worker exited with code 1" }) + "\n");
fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({
  name: "fixture", expected: lines.length + 1, jobs: 4,
  machine: { cpu: "Synthetic CPU", cpus: 8, node: "v22.0.0" }, started: "2026-11-01T09:00:00.000Z",
  matrix: { levels: ["squire", "knight", "warlord"], seeds: 30 },
}, null, 2) + "\n");
console.log(`wrote ${lines.length} lines`);
