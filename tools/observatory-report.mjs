#!/usr/bin/env node
// The observatory's report (phase 3 milestone 3.1, rule 4).
// Turns a run directory into report.html (one static file, inline SVG, no
// chart library, no external requests), summary.json and summary.md.
//
//   node tools/observatory-report.mjs <run dir>
//
// Reads matches.jsonl (one MatchLine per line, see packages/ai/scripts/observe-line.ts),
// and when present run.json, errors.jsonl, openings.json, prices.json.
// Exports report(dir) for the runner to call at the end of a run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TICKS_PER_SEC = 60;
const KINDS = ["keep", "crowd", "breach", "raid", "masons", "gun"];
const LEVEL_ORDER = ["idle", "squire", "knight", "warlord"];

// ---------------------------------------------------------------- reading

function readJsonl(file) {
  if (!fs.existsSync(file)) return { rows: [], bad: 0 };
  const rows = [];
  let bad = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      bad++;
    }
  }
  return { rows, bad };
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- numbers

const sum = (a) => a.reduce((x, y) => x + y, 0);
function quantile(a, p) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const median = (a) => quantile(a, 0.5);
function wilson(w, n) {
  if (!n) return { lo: 0, hi: 1, p: NaN };
  const z = 1.96;
  const p = w / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h), p };
}
const pct = (x, d = 0) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "n/a");
const num = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------- the targets

const TARGET_TEXT = {
  T1: "Median 9 to 13 minutes; 80% of matches between 6 and 16; under 2% reach time (25:00).",
  T2: "No single ending above 60%; storms 25% to 50%.",
  T3: "Castle 0 wins 46% to 54%.",
  T4: "Warlord beats Knight 75% or more, Squire 90% or more.",
  T5: "Unspent gold above 400 for under 60 s a match (median); something worth buying until 8:00 at least.",
  T6: "At least three build orders within 5 points of the best; the best beats the median opening by under 10 points.",
  T7: "No one kind of target takes more than half the winner's shots by hand.",
  T8: "The side behind at half time wins 20% to 35%.",
  T9: "At most 600 stones moving at once (99th percentile across matches); no step over 33 ms on the reference machine.",
};
const TARGET_NAME = {
  T1: "Length", T2: "Endings", T3: "Sides", T4: "Skill", T5: "Spending", T6: "Openings", T7: "Targets", T8: "Comebacks", T9: "Budget",
};
const DEFINITION = {
  T1: "Mirror matches that have a result (both sides the same level, plan and variant; all levels pooled). Minutes are result.tick / 3600. Pass when the median is 9 to 13, at least 80% fall between 6 and 16, and under 2% end by time.",
  T2: "Mirror matches that have a result, by reason (keep, storm, time, surrender). Pass when no reason is above 60% and storms are 25% to 50%.",
  T3: "Castle 0's win rate among mirror matches that have a winner (draws left out, and counted below). Shown with its 95% Wilson interval. Pass when the rate is 46% to 54%. When the interval is wider than the 8 point band the target reads too few to call.",
  T4: "Every match pairing the two levels, either castle. The higher level's win rate, draws counting as half. Pass at 75% or more against Knight and 90% or more against Squire. n/a when there are no such matches.",
  T5: "Two numbers. (a) The median over every side of every match of totals.richSecs (seconds with more than 400 unspent gold), under 60 s. (b) Over sides in matches that lasted at least 8:00, the median tick of that side's last totals.build entry, at 8:00 (480 s) or later. Sides with no build entry are left out of (b).",
  T6: "From openings.json when it is in the run directory (its pass field if it has one); otherwise not measured.",
  T7: "The winning side's totals.byHand summed over matches with a winner (all pairings). Pass when no kind takes more than 50% of those shots.",
  T8: "Mirror matches that have a result. Half time is the sample whose t is nearest result.tick / 120 (seconds). The side behind has fewer floors; on equal floors, more of its own castle down; on equal both, nobody is behind and the match is left out. Draws are left out. Pass when the side behind wins 20% to 35%.",
  T9: "The 99th percentile (linear interpolation) over matches of totals.movingMax, at most 600; and the largest totals.worstMs over all matches, at most 33. The target's reference machine is the owner's Apple M3 laptop, so a step time measured on any other machine is only indicative.",
};

const isDecided = (m) => m.result && (m.result.winner === 0 || m.result.winner === 1 || m.result.winner === -1);
const isMirror = (m) => m.setup.sides[0] === m.setup.sides[1] && m.setup.plans[0] === m.setup.plans[1];
const levelOf = (m) => m.setup.sides[0];
const NA = (why) => ({ value: why, pass: null });

function t1(ms) {
  if (!ms.length) return NA("n/a (no mirror matches)");
  const mins = ms.map((m) => m.result.tick / (TICKS_PER_SEC * 60));
  const med = median(mins);
  const inBand = mins.filter((x) => x >= 6 && x <= 16).length / mins.length;
  const time = ms.filter((m) => m.result.reason === "time").length / ms.length;
  return {
    value: `median ${num(med)} min; ${pct(inBand)} between 6 and 16; ${pct(time, 1)} by time (n ${ms.length})`,
    pass: med >= 9 && med <= 13 && inBand >= 0.8 && time < 0.02,
    data: { n: ms.length, medianMin: med, shareIn6to16: inBand, shareTime: time },
  };
}

function shares(ms) {
  const by = {};
  for (const m of ms) by[m.result.reason ?? "none"] = (by[m.result.reason ?? "none"] ?? 0) + 1;
  return by;
}

function t2(ms) {
  if (!ms.length) return NA("n/a (no mirror matches)");
  const by = shares(ms);
  const sh = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v / ms.length]));
  const max = Math.max(...Object.values(sh));
  const storm = sh.storm ?? 0;
  const text = ["keep", "storm", "time", "surrender"].filter((k) => sh[k] !== undefined).map((k) => `${k} ${pct(sh[k])}`).join(", ");
  return { value: `${text} (n ${ms.length})`, pass: max <= 0.6 && storm >= 0.25 && storm <= 0.5, data: { n: ms.length, counts: by, shares: sh } };
}

function t3(ms) {
  if (!ms.length) return NA("n/a (no mirror matches)");
  const w0 = ms.filter((m) => m.result.winner === 0).length;
  const w1 = ms.filter((m) => m.result.winner === 1).length;
  const draws = ms.filter((m) => m.result.winner === -1).length;
  const n = w0 + w1;
  if (!n) return NA(`n/a (no winners; ${draws} draws)`);
  const wl = wilson(w0, n);
  const wide = wl.hi - wl.lo > 0.08;
  return {
    value: `castle 0 won ${w0} of ${n} (${pct(wl.p, 1)}; 95% interval ${pct(wl.lo, 1)} to ${pct(wl.hi, 1)}); ${draws} ${draws === 1 ? "draw" : "draws"} left out${wide ? "; too few to call" : ""}`,
    pass: wide ? null : wl.p >= 0.46 && wl.p <= 0.54,
    tooFew: wide,
    data: { wins0: w0, wins1: w1, draws, n, rate: wl.p, lo: wl.lo, hi: wl.hi, tooFewToCall: wide, provisionalPass: wl.p >= 0.46 && wl.p <= 0.54 },
  };
}

// The win rate of level a against level b over a list of matches (draws as half).
function pairing(ms, a, b) {
  let n = 0;
  let score = 0;
  for (const m of ms) {
    if (!isDecided(m)) continue;
    const [s0, s1] = m.setup.sides;
    const w = m.result.winner;
    if (s0 === a && s1 === b) { n++; score += w === 0 ? 1 : w === -1 ? 0.5 : 0; }
    else if (s1 === a && s0 === b) { n++; score += w === 1 ? 1 : w === -1 ? 0.5 : 0; }
  }
  return { a, b, n, rate: n ? score / n : NaN };
}

function t4(all) {
  const wk = pairing(all, "warlord", "knight");
  const ws = pairing(all, "warlord", "squire");
  const parts = [];
  const checks = [];
  if (wk.n) { parts.push(`Warlord beats Knight ${pct(wk.rate)} (n ${wk.n})`); checks.push(wk.rate >= 0.75); }
  if (ws.n) { parts.push(`Warlord beats Squire ${pct(ws.rate)} (n ${ws.n})`); checks.push(ws.rate >= 0.9); }
  if (!parts.length) return NA("n/a (no Warlord against Knight or Squire matches)");
  return { value: parts.join("; "), pass: checks.every(Boolean), data: { warlordVsKnight: wk, warlordVsSquire: ws } };
}

function lastBuildTick(m, side) {
  let t = null;
  for (const e of m.totals.build ?? []) if (e[1] === side) t = e[0];
  return t;
}

function t5(all) {
  if (!all.length) return NA("n/a (no matches)");
  const rich = all.flatMap((m) => m.totals.richSecs ?? []);
  const medRich = median(rich);
  const lasts = [];
  for (const m of all) {
    if (!isDecided(m) || m.result.tick < 480 * TICKS_PER_SEC) continue;
    for (const s of [0, 1]) {
      const t = lastBuildTick(m, s);
      if (t !== null) lasts.push(t / TICKS_PER_SEC);
    }
  }
  const medLast = median(lasts);
  const okA = medRich < 60;
  const okB = lasts.length ? medLast >= 480 : null;
  return {
    value: `median unspent-gold time ${num(medRich)} s (over ${rich.length} sides); median last build at ${lasts.length ? mmss(medLast) : "n/a"} (over ${lasts.length} sides in matches of 8:00 or longer)`,
    pass: okB === null ? null : okA && okB,
    data: { richSecsMedian: medRich, sides: rich.length, lastBuildMedianSec: lasts.length ? medLast : null, lastBuildSides: lasts.length },
  };
}

function t7(all) {
  const tot = Object.fromEntries(KINDS.map((k) => [k, 0]));
  let n = 0;
  for (const m of all) {
    if (!isDecided(m) || m.result.winner === -1) continue;
    n++;
    const h = m.totals.byHand?.[m.result.winner];
    for (const k of KINDS) tot[k] += h?.[k] ?? 0;
  }
  const total = sum(Object.values(tot));
  if (!n || !total) return NA("n/a (no winners' shots)");
  const [top, topN] = Object.entries(tot).sort((a, b) => b[1] - a[1])[0];
  return {
    value: `${top} takes ${pct(topN / total)} of ${total} shots by hand (${n} winners)`,
    pass: topN / total <= 0.5,
    data: { matches: n, shots: tot, topKind: top, topShare: topN / total },
  };
}

function halfSample(m) {
  const half = m.result.tick / 120;
  let best = null;
  for (const s of m.samples ?? []) if (best === null || Math.abs(s.t - half) < Math.abs(best.t - half)) best = s;
  return best;
}

function t8(ms) {
  if (!ms.length) return NA("n/a (no mirror matches)");
  let behindWins = 0;
  let leaderWins = 0;
  let level = 0;
  for (const m of ms) {
    const s = halfSample(m);
    if (!s || m.result.winner === -1) continue;
    let behind = -1;
    if (s.floors[0] !== s.floors[1]) behind = s.floors[0] < s.floors[1] ? 0 : 1;
    else if (s.down[0] !== s.down[1]) behind = s.down[0] > s.down[1] ? 0 : 1;
    if (behind < 0) { level++; continue; }
    if (m.result.winner === behind) behindWins++;
    else leaderWins++;
  }
  const n = behindWins + leaderWins;
  if (!n) return NA(`n/a (nobody behind at half time in ${level} matches)`);
  const rate = behindWins / n;
  return {
    value: `the side behind won ${behindWins} of ${n} (${pct(rate)}); ${level} level at half time (left out)`,
    pass: rate >= 0.2 && rate <= 0.35,
    data: { behindWins, n, rate, level },
  };
}

function t9(all, run) {
  if (!all.length) return NA("n/a (no matches)");
  const p99 = quantile(all.map((m) => m.totals.movingMax ?? 0), 0.99);
  const worst = Math.max(...all.map((m) => m.totals.worstMs ?? 0));
  const mach = run?.machine ? `${run.machine.cpu ?? "unknown cpu"}, ${run.machine.cpus ?? "?"} cpus, node ${run.machine.node ?? "?"}` : "machine unknown";
  // Steps over 33 ms per match (lines from before slowSteps lack it): one slow step on a busy machine says little, many say more.
  const slow = all.filter((m) => m.totals.slowSteps).map((m) => m.totals.slowSteps[1]);
  const slowMed = slow.length ? quantile(slow, 0.5) : null;
  const slowText = slowMed === null ? "" : `; steps over 33 ms per match: median ${num(slowMed, 0)}, most ${num(Math.max(...slow), 0)}`;
  return {
    value: `p99 of most stones moving ${num(p99, 0)}; worst step ${num(worst)} ms${slowText} (measured on ${mach}; the reference is an Apple M3 laptop, so elsewhere it is only indicative)`,
    pass: p99 <= 600 && worst <= 33,
    data: { movingP99: p99, worstMs: worst, slowStepsMedian: slowMed, machine: run?.machine ?? null },
  };
}

function t6(openings) {
  if (!openings) return { value: "not measured: run observe:openings", pass: null, table: null };
  let rows = null;
  let pass = null;
  if (Array.isArray(openings)) rows = openings;
  else if (typeof openings === "object") {
    if (typeof openings.pass === "boolean") pass = openings.pass;
    rows = Array.isArray(openings.rows) ? openings.rows : Array.isArray(openings.openings) ? openings.openings : null;
  }
  return { value: `${rows ? rows.length : 0} openings listed below${pass === null ? "" : ""}`, pass, table: rows };
}

// ---------------------------------------------------------------- analysis

function analyse(dir) {
  const run = readJson(path.join(dir, "run.json"));
  const { rows: rawLines, bad } = readJsonl(path.join(dir, "matches.jsonl"));
  const errs = readJsonl(path.join(dir, "errors.jsonl")).rows;
  const openings = readJson(path.join(dir, "openings.json"));
  const prices = readJson(path.join(dir, "prices.json"));

  // A resumed run may repeat an id: keep the last.
  const byId = new Map();
  for (const m of rawLines) if (m && m.setup && m.result && m.totals) byId.set(m.setup.id, m);
  const all = [...byId.values()];
  const decided = all.filter(isDecided);
  const noResult = all.filter((m) => !isDecided(m));
  const mirror = decided.filter(isMirror);
  const levels = LEVEL_ORDER.filter((l) => mirror.some((m) => levelOf(m) === l));
  for (const m of mirror) if (!levels.includes(levelOf(m))) levels.push(levelOf(m));

  const failed = errs.filter((e) => !byId.has(e.id));
  const versions = [...new Set(all.map((m) => `sim ${m.rules?.sim} / match ${m.rules?.match}`))];
  const wallMs = sum(all.map((m) => m.wall?.ms ?? 0));
  const jobs = run?.jobs ?? run?.machine?.jobs ?? run?.matrix?.jobs ?? 1;
  const perHour = wallMs > 0 ? all.length / (wallMs / jobs / 3600000) : NaN;

  const header = {
    name: run?.name ?? path.basename(path.resolve(dir)),
    machine: run?.machine ?? null,
    started: run?.started ?? null,
    done: all.length,
    expected: run?.expected ?? null,
    failed: failed.map((e) => ({ id: e.id, error: String(e.error) })),
    noResult: noResult.length,
    decided: decided.length,
    mirror: mirror.length,
    badLines: bad,
    rulesVersions: versions,
    mixedVersions: versions.length > 1,
    jobs,
    jobsAssumed: !(run && (run.jobs || run.machine?.jobs || run.matrix?.jobs)),
    matchesPerHour: perHour,
  };

  const perLevel = (fn) => (levels.length > 1 ? levels.map((l) => ({ level: l, ...fn(mirror.filter((m) => levelOf(m) === l)) })) : []);
  const mk = (id, res, extra = {}) => ({
    id, name: TARGET_NAME[id], target: TARGET_TEXT[id], definition: DEFINITION[id], value: res.value, pass: res.pass, data: res.data ?? null,
    levels: extra.levels ?? [], table: res.table, ...extra.more,
  });

  const targets = [
    mk("T1", t1(mirror), { levels: perLevel(t1) }),
    mk("T2", t2(mirror), { levels: perLevel(t2) }),
    mk("T3", t3(mirror), { levels: perLevel(t3) }),
    mk("T4", t4(decided)),
    mk("T5", t5(all)),
    mk("T6", t6(openings)),
    mk("T7", t7(all)),
    mk("T8", t8(mirror), { levels: perLevel(t8) }),
    mk("T9", t9(all, run)),
  ];

  const present = LEVEL_ORDER.filter((l) => decided.some((m) => m.setup.sides.includes(l)));
  const pairings = [];
  for (const a of present) for (const b of present) if (a !== b) pairings.push(pairing(decided, a, b));

  return { run, all, decided, mirror, levels, header, targets, pairings, openings, prices, noResult };
}

// ---------------------------------------------------------------- charts

const C = {
  ground: "#16140f", panel: "#1e1b15", line: "#3a352a", grid: "#2c2820", ink: "#efe8d6", dim: "#b5ab95", brass: "#c99a46",
  bad: "#e2715a", good: "#9bd07c", c0: "#cdd842", c1: "#e2525a",
  keep: "#c99a46", storm: "#6fa3bd", time: "#8a8270", surrender: "#a98bc4",
};

function niceTicks(lo, hi, count = 6) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

// A frame with axes. inner(sx, sy, plot) returns the marks. Returns an svg string.
function frame({ W = 1000, H = 340, ml = 64, mr = 20, mt = 16, mb = 58, x, y, xlabel, ylabel, xfmt = (v) => v, yfmt = (v) => v, xticks, yticks, inner, label }) {
  const pw = W - ml - mr;
  const ph = H - mt - mb;
  const sx = (v) => ml + ((v - x[0]) / (x[1] - x[0])) * pw;
  const sy = (v) => mt + ph - ((v - y[0]) / (y[1] - y[0])) * ph;
  const xt = xticks ?? niceTicks(x[0], x[1]);
  const yt = yticks ?? niceTicks(y[0], y[1], 5);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label ?? ylabel)}" xmlns="http://www.w3.org/2000/svg">`;
  for (const v of yt) s += `<line x1="${ml}" x2="${W - mr}" y1="${sy(v)}" y2="${sy(v)}" stroke="${C.grid}"/><text x="${ml - 8}" y="${sy(v) + 5}" text-anchor="end">${esc(yfmt(v))}</text>`;
  for (const v of xt) s += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${mt + ph}" y2="${mt + ph + 5}" stroke="${C.dim}"/><text x="${sx(v)}" y="${mt + ph + 22}" text-anchor="middle">${esc(xfmt(v))}</text>`;
  s += inner(sx, sy, { ml, mr, mt, mb, pw, ph, W, H });
  s += `<line x1="${ml}" x2="${W - mr}" y1="${mt + ph}" y2="${mt + ph}" stroke="${C.dim}"/><line x1="${ml}" x2="${ml}" y1="${mt}" y2="${mt + ph}" stroke="${C.dim}"/>`;
  s += `<text x="${ml + pw / 2}" y="${H - 8}" text-anchor="middle" class="axis">${esc(xlabel)}</text>`;
  s += `<text transform="translate(16 ${mt + ph / 2}) rotate(-90)" text-anchor="middle" class="axis">${esc(ylabel)}</text>`;
  return s + "</svg>";
}

function legend(items, x, y) {
  let s = "";
  let cx = x;
  for (const [name, col] of items) {
    s += `<rect x="${cx}" y="${y - 11}" width="14" height="14" rx="2" fill="${col}"/><text x="${cx + 20}" y="${y + 1}">${esc(name)}</text>`;
    cx += 20 + name.length * 8 + 24;
  }
  return s;
}

const noData = (what) => `<p class="nodata">No data for this chart (${esc(what)}).</p>`;

function histogram({ values, binW, min = 0, max, bandX, markX, markLabel, xlabel, ylabel = "matches", xfmt, W = 1000, H = 320, color = C.brass, label }) {
  if (!values.length) return noData(label ?? xlabel);
  const top = Math.max(max, Math.ceil((Math.max(...values) + 1e-9) / binW) * binW);
  const nb = Math.round((top - min) / binW);
  const bins = new Array(nb).fill(0);
  for (const v of values) bins[Math.min(nb - 1, Math.max(0, Math.floor((v - min) / binW)))]++;
  const ymax = Math.max(...bins, 1);
  return frame({
    W, H, x: [min, top], y: [0, ymax * 1.12], xlabel, ylabel, xfmt, label: label ?? xlabel, yfmt: (v) => (Number.isInteger(v) ? v : ""),
    inner: (sx, sy, p) => {
      let s = "";
      if (bandX) s += `<rect x="${sx(bandX[0])}" y="${p.mt}" width="${sx(bandX[1]) - sx(bandX[0])}" height="${p.ph}" fill="${C.good}" opacity="0.16"/><text x="${sx((bandX[0] + bandX[1]) / 2)}" y="${p.mt + 16}" text-anchor="middle" fill="${C.good}">target band ${bandX[0]} to ${bandX[1]}</text>`;
      bins.forEach((c, i) => {
        if (!c) return;
        const x0 = sx(min + i * binW);
        const x1 = sx(min + (i + 1) * binW);
        s += `<rect x="${x0 + 1}" y="${sy(c)}" width="${Math.max(1, x1 - x0 - 2)}" height="${sy(0) - sy(c)}" fill="${color}"/>`;
      });
      if (markX !== undefined) s += `<line x1="${sx(markX)}" x2="${sx(markX)}" y1="${p.mt}" y2="${p.mt + p.ph}" stroke="${C.bad}" stroke-width="2" stroke-dasharray="6 4"/><text x="${sx(markX) + 6}" y="${p.mt + 34}" fill="${C.bad}">${esc(markLabel)}</text>`;
      return s;
    },
  });
}

function endingsChart(mirrorAndAll) {
  const groups = new Map();
  for (const m of mirrorAndAll) {
    const k = `${m.setup.sides[0]} v ${m.setup.sides[1]}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  if (!groups.size) return noData("no decided matches");
  const names = [...groups.keys()];
  const W = 1000;
  const rowH = 38;
  const ml = 200;
  const mr = 70;
  const mt = 44;
  const H = mt + names.length * rowH + 52;
  const pw = W - ml - mr;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Endings by pairing" xmlns="http://www.w3.org/2000/svg">`;
  s += legend([["keep", C.keep], ["storm", C.storm], ["time", C.time], ["surrender", C.surrender]], ml, 22);
  for (const v of [0, 25, 50, 75, 100]) {
    const x = ml + (v / 100) * pw;
    s += `<line x1="${x}" x2="${x}" y1="${mt - 6}" y2="${mt + names.length * rowH}" stroke="${C.grid}"/><text x="${x}" y="${mt + names.length * rowH + 20}" text-anchor="middle">${v}%</text>`;
  }
  names.forEach((nm, i) => {
    const ms = groups.get(nm);
    const by = shares(ms);
    const y = mt + i * rowH;
    s += `<text x="${ml - 10}" y="${y + 21}" text-anchor="end">${esc(nm)}</text>`;
    let x = ml;
    for (const r of ["keep", "storm", "time", "surrender"]) {
      const w = ((by[r] ?? 0) / ms.length) * pw;
      if (!w) continue;
      s += `<rect x="${x}" y="${y + 4}" width="${w}" height="${rowH - 12}" fill="${C[r]}"/>`;
      if (w > 44) s += `<text x="${x + w / 2}" y="${y + 21}" text-anchor="middle" fill="#16140f" font-weight="600">${Math.round(((by[r] ?? 0) / ms.length) * 100)}%</text>`;
      x += w;
    }
    s += `<text x="${ml + pw + 8}" y="${y + 21}">n ${ms.length}</text>`;
  });
  s += `<text x="${ml + pw / 2}" y="${H - 8}" text-anchor="middle" class="axis">share of matches by how they ended (castle 0's level first)</text>`;
  return s + "</svg>";
}

function sidesChart(mirror, levels) {
  const rows = [{ name: "all levels", ms: mirror }, ...(levels.length > 1 ? levels.map((l) => ({ name: l, ms: mirror.filter((m) => levelOf(m) === l) })) : [])];
  const data = rows.map((r) => {
    const w0 = r.ms.filter((m) => m.result.winner === 0).length;
    const n = w0 + r.ms.filter((m) => m.result.winner === 1).length;
    return { ...r, w0, n, ...wilson(w0, n) };
  }).filter((r) => r.n);
  if (!data.length) return noData("no mirror matches with a winner");
  const W = 1000;
  const ml = 150;
  const mr = 150;
  const mt = 20;
  const rowH = 46;
  const H = mt + data.length * rowH + 76;
  const pw = W - ml - mr;
  const sx = (v) => ml + v * pw;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Castle 0 win rate" xmlns="http://www.w3.org/2000/svg">`;
  for (const v of [0, 0.2, 0.4, 0.6, 0.8, 1]) s += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${mt}" y2="${mt + data.length * rowH}" stroke="${C.grid}"/><text x="${sx(v)}" y="${mt + data.length * rowH + 20}" text-anchor="middle">${Math.round(v * 100)}%</text>`;
  s += `<rect x="${sx(0.46)}" y="${mt}" width="${sx(0.54) - sx(0.46)}" height="${data.length * rowH}" fill="${C.good}" opacity="0.2"/>`;
  s += `<text x="${sx(0.5)}" y="${mt + data.length * rowH + 40}" text-anchor="middle" fill="${C.good}">target band 46% to 54%</text>`;
  data.forEach((r, i) => {
    const y = mt + i * rowH + rowH / 2;
    s += `<text x="${ml - 10}" y="${y + 5}" text-anchor="end">${esc(r.name)}</text>`;
    s += `<line x1="${sx(r.lo)}" x2="${sx(r.hi)}" y1="${y}" y2="${y}" stroke="${C.c0}" stroke-width="3"/><line x1="${sx(r.lo)}" x2="${sx(r.lo)}" y1="${y - 8}" y2="${y + 8}" stroke="${C.c0}" stroke-width="3"/><line x1="${sx(r.hi)}" x2="${sx(r.hi)}" y1="${y - 8}" y2="${y + 8}" stroke="${C.c0}" stroke-width="3"/>`;
    s += `<circle cx="${sx(r.p)}" cy="${y}" r="7" fill="${C.c0}" stroke="${C.ground}" stroke-width="2"/>`;
    s += `<text x="${ml + pw + 10}" y="${y + 5}">${r.w0} of ${r.n}, ${pct(r.p)}</text>`;
  });
  s += `<text x="${ml + pw / 2}" y="${H - 6}" text-anchor="middle" class="axis">castle 0's win rate (dot) with its 95% interval (bar); draws left out</text>`;
  return s + "</svg>";
}

function handChart(all) {
  const win = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const lose = Object.fromEntries(KINDS.map((k) => [k, 0]));
  let n = 0;
  for (const m of all) {
    if (!isDecided(m) || m.result.winner === -1) continue;
    n++;
    for (const k of KINDS) {
      win[k] += m.totals.byHand?.[m.result.winner]?.[k] ?? 0;
      lose[k] += m.totals.byHand?.[1 - m.result.winner]?.[k] ?? 0;
    }
  }
  const tw = sum(Object.values(win));
  const tl = sum(Object.values(lose));
  if (!n || !tw) return noData("no winners' shots");
  const W = 1000;
  const H = 340;
  return frame({
    W, H, x: [0, KINDS.length], y: [0, 100], xticks: [], xlabel: "what the shot by hand was for", ylabel: "share of the side's shots (%)", label: "Shots by hand by kind of target",
    yticks: [0, 25, 50, 75, 100],
    inner: (sx, sy, p) => {
      let s = legend([["winner", C.brass], ["loser", C.dim]], p.ml + 10, p.mt + 14);
      s += `<line x1="${p.ml}" x2="${p.W - p.mr}" y1="${sy(50)}" y2="${sy(50)}" stroke="${C.bad}" stroke-width="2" stroke-dasharray="6 4"/><text x="${p.W - p.mr - 4}" y="${sy(50) - 6}" text-anchor="end" fill="${C.bad}">50% line for the winner</text>`;
      KINDS.forEach((k, i) => {
        const bw = (sx(1) - sx(0)) * 0.34;
        const cx = sx(i + 0.5);
        const vw = (win[k] / tw) * 100;
        const vl = tl ? (lose[k] / tl) * 100 : 0;
        s += `<rect x="${cx - bw - 2}" y="${sy(vw)}" width="${bw}" height="${sy(0) - sy(vw)}" fill="${C.brass}"/><text x="${cx - bw / 2 - 2}" y="${sy(vw) - 6}" text-anchor="middle">${vw.toFixed(0)}%</text>`;
        s += `<rect x="${cx + 2}" y="${sy(vl)}" width="${bw}" height="${sy(0) - sy(vl)}" fill="${C.dim}"/><text x="${cx + bw / 2 + 2}" y="${sy(vl) - 6}" text-anchor="middle">${vl.toFixed(0)}%</text>`;
        s += `<text x="${cx}" y="${sy(0) + 22}" text-anchor="middle">${k}</text>`;
      });
      return s;
    },
  });
}

// Samples at the 30 s marks only (the closing sample falls anywhere), grouped by t.
function seriesByTime(all, pick) {
  const g = new Map();
  for (const m of all) for (const s of m.samples ?? []) {
    if (Math.abs(s.t / 30 - Math.round(s.t / 30)) > 1e-6) continue;
    for (const v of pick(s)) {
      if (!g.has(s.t)) g.set(s.t, []);
      g.get(s.t).push(v);
    }
  }
  const peak = Math.max(0, ...[...g.values()].map((a) => a.length));
  return [...g.entries()].filter(([, a]) => a.length >= Math.max(1, Math.min(3, peak * 0.1))).sort((a, b) => a[0] - b[0]);
}

function goldChart(all) {
  const ser = seriesByTime(all, (s) => s.gold);
  if (!ser.length) return noData("no samples");
  const tmax = ser[ser.length - 1][0];
  const ymax = Math.max(500, ...ser.map(([, a]) => quantile(a, 0.75))) * 1.15;
  return frame({
    x: [0, tmax / 60], y: [0, ymax], xlabel: "match time (minutes)", ylabel: "unspent gold per side", label: "Unspent gold over time", xfmt: (v) => v,
    inner: (sx, sy, p) => {
      const up = ser.map(([t, a]) => `${sx(t / 60)},${sy(quantile(a, 0.75))}`);
      const dn = ser.map(([t, a]) => `${sx(t / 60)},${sy(quantile(a, 0.25))}`).reverse();
      let s = `<polygon points="${up.concat(dn).join(" ")}" fill="${C.brass}" opacity="0.25"/>`;
      s += `<polyline points="${ser.map(([t, a]) => `${sx(t / 60)},${sy(median(a))}`).join(" ")}" fill="none" stroke="${C.brass}" stroke-width="3"/>`;
      s += `<line x1="${p.ml}" x2="${p.W - p.mr}" y1="${sy(400)}" y2="${sy(400)}" stroke="${C.bad}" stroke-width="2" stroke-dasharray="6 4"/><text x="${p.ml + 8}" y="${sy(400) - 8}" fill="${C.bad}">400 gold</text>`;
      s += `<line x1="${sx(8)}" x2="${sx(8)}" y1="${p.mt}" y2="${p.mt + p.ph}" stroke="${C.dim}" stroke-dasharray="3 5"/><text x="${sx(8) + 6}" y="${p.mt + 16}">8:00</text>`;
      s += legend([["median", C.brass], ["middle half of sides", "rgba(201,154,70,0.4)"]], p.ml + 120, p.mt + 16);
      return s;
    },
  });
}

function twoLineChart({ all, pick0, pick1, ylabel, label, ymin = 0, ymaxFloor, yfmt }) {
  const a = seriesByTime(all, pick0);
  const b = seriesByTime(all, pick1);
  if (!a.length) return noData("no samples");
  const tmax = Math.max(a[a.length - 1][0], b.length ? b[b.length - 1][0] : 0);
  const ymax = Math.max(ymaxFloor, ...a.map(([, v]) => median(v)), ...b.map(([, v]) => median(v))) * 1.3;
  return frame({
    W: 500, H: 320, ml: 56, mr: 14, x: [0, tmax / 60], y: [ymin, ymax], xlabel: "match time (minutes)", ylabel, label, yfmt,
    inner: (sx, sy, p) => {
      let s = "";
      for (const [ser, col] of [[a, C.c0], [b, C.c1]]) s += `<polyline points="${ser.map(([t, v]) => `${sx(t / 60)},${sy(median(v))}`).join(" ")}" fill="none" stroke="${col}" stroke-width="3"/>`;
      s += legend([["castle 0", C.c0], ["castle 1", C.c1]], p.ml + 12, p.mt + 16);
      return s;
    },
  });
}

function table(rows, cols) {
  if (!rows || !rows.length) return `<p class="nodata">No rows.</p>`;
  const keys = cols ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? esc(JSON.stringify(v)) : typeof v === "number" && !Number.isInteger(v) ? esc(v.toFixed(3)) : esc(v));
  return `<div class="scroll"><table><thead><tr>${keys.map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${keys.map((k) => `<td>${cell(r[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

// ---------------------------------------------------------------- the page

const status = (p) => (p === true ? `<span class="tag pass">PASS</span>` : p === false ? `<span class="tag fail">FAIL</span>` : `<span class="tag na">n/a</span>`);
const statusText = (p) => (p === true ? "PASS" : p === false ? "FAIL" : "n/a");

function pairingTable(a) {
  const lv = LEVEL_ORDER.filter((l) => a.pairings.some((p) => p.a === l));
  if (lv.length < 2) return `<p class="nodata">No pairings between different levels.</p>`;
  let h = `<div class="scroll"><table class="matrix"><thead><tr><th>row beats column</th>${lv.map((l) => `<th>${l}</th>`).join("")}</tr></thead><tbody>`;
  for (const r of lv) {
    h += `<tr><th>${r}</th>`;
    for (const c of lv) {
      const p = a.pairings.find((x) => x.a === r && x.b === c);
      h += r === c ? `<td class="dim">-</td>` : p && p.n ? `<td>${pct(p.rate)} <span class="dim">(n ${p.n})</span></td>` : `<td class="dim">no matches</td>`;
    }
    h += "</tr>";
  }
  return h + "</tbody></table></div>";
}

function buildHtml(a) {
  const h = a.header;
  const started = h.started ? (Number.isNaN(Date.parse(h.started)) ? String(h.started) : new Date(h.started).toISOString().replace("T", " ").slice(0, 16) + " UTC") : "date unknown";
  const mach = h.machine ? `${h.machine.cpu ?? "unknown cpu"}, ${h.machine.cpus ?? "?"} cpus, node ${h.machine.node ?? "?"}` : "machine unknown";
  const expectedText = h.expected ? `${h.done} of ${h.expected}` : `${h.done} (expected count unknown)`;
  const mirrorDecided = a.mirror;
  const warn = [];
  if (h.mixedVersions) warn.push(`This run mixes rules versions: ${h.rulesVersions.join(", ")}. Its numbers do not describe one game.`);
  if (h.expected && h.done + h.failed.length < h.expected) warn.push(`${h.expected - h.done - h.failed.length} matches are missing without an error line (a worker may have died).`);
  if (h.badLines) warn.push(`${h.badLines} lines of matches.jsonl could not be read.`);

  const targetRows = a.targets.map((t) => {
    const lv = t.levels.length ? `<div class="levels">${t.levels.map((l) => `<div><b>${esc(l.level)}</b>: ${esc(l.value)} ${status(l.pass)}</div>`).join("")}</div>` : "";
    let extra = "";
    if (t.id === "T4") extra = pairingTable(a);
    if (t.id === "T6" && t.table) extra = table(t.table);
    return `<tr><td class="tid"><b>${t.id}</b><br>${esc(t.name)}</td><td>${esc(t.value)}${lv}${extra}<div class="small">${esc(t.definition)}</div></td><td class="tstat">${status(t.pass)}</td><td class="ttext">${esc(t.target)}</td></tr>`;
  }).join("");

  const failedList = h.failed.length ? `<ul>${h.failed.map((f) => `<li><code>${esc(f.id)}</code>: ${esc(f.error)}</li>`).join("")}</ul>` : "";

  const length = histogram({
    values: mirrorDecided.map((m) => m.result.tick / (TICKS_PER_SEC * 60)), binW: 0.5, max: 18, bandX: [9, 13], xlabel: "match length (minutes, 30 s bins)", xfmt: (v) => v,
    label: "Match length histogram",
  });
  const endings = endingsChart(a.decided);
  const sides = sidesChart(mirrorDecided, a.levels);
  const hand = handChart(a.all);
  const gold = goldChart(a.all);
  const moving = histogram({ values: a.all.map((m) => m.totals.movingMax ?? 0), binW: 50, max: 700, markX: 600, markLabel: "600", xlabel: "most stones moving at once in a match", W: 500, H: 320, color: C.storm, label: "Stones moving", xfmt: (v) => v });
  const worst = histogram({ values: a.all.map((m) => m.totals.worstMs ?? 0), binW: 2, max: 40, markX: 33, markLabel: "33 ms", xlabel: "worst step in a match (ms)", W: 500, H: 320, color: C.surrender, label: "Worst step", xfmt: (v) => v });
  const floors = twoLineChart({ all: a.all, pick0: (s) => [s.floors[0]], pick1: (s) => [s.floors[1]], ylabel: "median storeys under the banner", label: "Banner floors", ymaxFloor: 3, yfmt: (v) => v });
  const down = twoLineChart({ all: a.all, pick0: (s) => [s.down[0]], pick1: (s) => [s.down[1]], ylabel: "median pieces of masonry down", label: "Masonry down", ymaxFloor: 5, yfmt: (v) => v });

  const prices = a.prices ? `<section><h2>Price list</h2>${table(Array.isArray(a.prices) ? a.prices : Array.isArray(a.prices.rows) ? a.prices.rows : [a.prices])}</section>` : "";
  const openings = a.openings ? "" : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Observatory report: ${esc(h.name)}</title>
<style>
:root{--ground:#16140f;--panel:#1e1b15;--line:rgba(236,228,210,.16);--ink:#efe8d6;--dim:#b5ab95;--brass:#c99a46;--bad:#e2715a;--good:#9bd07c}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:15px/1.5 "Barlow Semi Condensed","Avenir Next Condensed","Arial Narrow",system-ui,sans-serif}
main{max-width:1160px;margin:0 auto;padding:24px 20px 64px}
h1{font-size:30px;margin:0 0 4px;color:var(--brass);font-weight:600}
h2{font-size:21px;margin:36px 0 10px;color:var(--brass);font-weight:600;border-bottom:1px solid var(--line);padding-bottom:6px}
h3{font-size:16px;margin:18px 0 4px;font-weight:600}
code,.mono{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:13px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin:14px 0}
.meta>div{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.meta b{display:block;font-size:13px;color:var(--dim);font-weight:500}
.meta span{font-size:17px}
.warn{background:#3a2218;border:1px solid var(--bad);border-radius:8px;padding:10px 14px;margin:10px 0;color:#f3c4b8}
table{border-collapse:collapse;width:100%;background:var(--panel);border:1px solid var(--line)}
th,td{border-bottom:1px solid var(--line);padding:9px 11px;text-align:left;vertical-align:top;font-size:14px}
th{color:var(--dim);font-weight:500}
.tid{white-space:nowrap;width:90px}.tstat{width:70px}.ttext{width:26%;color:var(--dim)}
.tag{display:inline-block;padding:2px 9px;border-radius:5px;font-weight:700;font-size:13px;letter-spacing:.04em}
.pass{background:#2d4a24;color:var(--good)}.fail{background:#552a20;color:#ffb09c}.na{background:#3a352a;color:var(--dim)}
.small{font-size:13px;color:var(--dim);margin-top:6px}
.levels{margin-top:6px;font-size:14px}.levels div{margin:2px 0}
.dim{color:var(--dim)}
.scroll{overflow-x:auto;margin-top:8px}
.matrix td,.matrix th{text-align:center}.matrix tbody th{text-align:right}
figure{margin:14px 0;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
figcaption{font-size:13px;color:var(--dim);margin-top:4px}
figure h3{margin-top:0}
svg{width:100%;height:auto;display:block}
svg text{font-family:"Barlow Semi Condensed","Avenir Next Condensed","Arial Narrow",system-ui,sans-serif;font-size:14px;fill:var(--ink)}
svg text.axis{fill:var(--dim);font-size:14px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:800px){.pair{grid-template-columns:1fr}}
.nodata{color:var(--dim);font-style:italic}
</style></head><body><main>
<h1>Observatory report: ${esc(h.name)}</h1>
<div class="dim">${esc(started)} on ${esc(mach)}</div>
${warn.map((w) => `<div class="warn">${esc(w)}</div>`).join("")}
<div class="meta">
<div><b>Matches done</b><span>${esc(expectedText)}</span></div>
<div><b>Failed</b><span>${h.failed.length}</span></div>
<div><b>No result (stopped early)</b><span>${h.noResult}</span></div>
<div><b>Mirror matches with a result</b><span>${h.mirror}</span></div>
<div><b>Rules versions seen</b><span>${esc(h.rulesVersions.join("; ") || "none")}</span></div>
<div><b>Matches per hour</b><span>${esc(num(h.matchesPerHour, 0))}</span><div class="small">over ${h.jobs} job${h.jobs === 1 ? "" : "s"}${h.jobsAssumed ? " (assumed: run.json gives no job count)" : ""}, from each match's wall.ms</div></div>
</div>
${failedList}
<section><h2>Targets</h2>
<table><thead><tr><th>Target</th><th>Measured, and how</th><th>Result</th><th>Target text</th></tr></thead><tbody>${targetRows}</tbody></table>
</section>
<section><h2>Charts</h2>
<figure><h3>Match length (T1)</h3>${length}<figcaption>Mirror matches with a result: ${mirrorDecided.length}. The shaded band is the median target.</figcaption></figure>
<figure><h3>Endings by pairing (T2)</h3>${endings}<figcaption>All matches with a result, by who commanded castle 0 and castle 1.</figcaption></figure>
<figure><h3>Castle 0's win rate (T3)</h3>${sides}</figure>
<figure><h3>Shots by hand by kind of target (T7)</h3>${hand}<figcaption>Winner and loser side by side, each as a share of that side's own shots by hand.</figcaption></figure>
<figure><h3>Unspent gold over time (T5)</h3>${gold}<figcaption>Every side of every match, at each 30 s sample. Points with very few matches left are dropped.</figcaption></figure>
<div class="pair">
<figure><h3>Stones moving (T9)</h3>${moving}<figcaption>Each match's most stones moving at once.</figcaption></figure>
<figure><h3>Worst step (T9)</h3>${worst}<figcaption>Each match's slowest step, wall clock, on ${esc(mach)}.</figcaption></figure>
<figure><h3>Banner floors (T8)</h3>${floors}<figcaption>Median keep storeys still under each banner (3 is the roof).</figcaption></figure>
<figure><h3>Masonry down (T8)</h3>${down}<figcaption>Median pieces of each castle down.</figcaption></figure>
</div>
</section>
${prices}${openings}
</main></body></html>
`;
}

// ---------------------------------------------------------------- summaries

function buildSummary(a) {
  const h = a.header;
  return {
    run: h.name,
    machine: h.machine,
    started: h.started,
    counts: {
      done: h.done, expected: h.expected, failed: h.failed.length, noResult: h.noResult, decided: h.decided, mirrorDecided: h.mirror,
      rulesVersions: h.rulesVersions, mixedVersions: h.mixedVersions, matchesPerHour: Number.isFinite(h.matchesPerHour) ? h.matchesPerHour : null,
    },
    failed: h.failed,
    targets: a.targets.map((t) => ({
      id: t.id, name: t.name, value: t.value, pass: t.pass, status: statusText(t.pass), target: t.target, definition: t.definition, data: t.data,
      levels: t.levels.map((l) => ({ level: l.level, value: l.value, pass: l.pass })),
      ...(t.id === "T6" ? { rows: t.table ?? null } : {}),
    })),
    pairings: a.pairings,
  };
}

function buildMarkdown(a) {
  const h = a.header;
  const mach = h.machine ? `${h.machine.cpu ?? "unknown cpu"}, ${h.machine.cpus ?? "?"} cpus, node ${h.machine.node ?? "?"}` : "machine unknown";
  const lines = [];
  lines.push(`Observatory run \`${h.name}\`: ${h.done}${h.expected ? ` of ${h.expected}` : ""} matches done, ${h.failed.length} failed, ${h.noResult} without a result. Machine: ${mach}.`);
  if (h.mixedVersions) lines.push(`Warning: mixed rules versions (${h.rulesVersions.join(", ")}).`);
  lines.push("");
  lines.push("| Target | Value | Pass |");
  lines.push("| --- | --- | --- |");
  for (const t of a.targets) lines.push(`| ${t.id} ${t.name} | ${t.value.replace(/\|/g, "/")} | ${statusText(t.pass)} |`);
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------- entry points

export function report(dir) {
  const a = analyse(dir);
  const summary = buildSummary(a);
  fs.writeFileSync(path.join(dir, "report.html"), buildHtml(a));
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "summary.md"), buildMarkdown(a));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(path.join(dir, "matches.jsonl"))) {
    console.error("usage: node tools/observatory-report.mjs <run dir with matches.jsonl>");
    process.exit(1);
  }
  const s = report(dir);
  console.log(`wrote report.html, summary.json and summary.md in ${dir} (${s.counts.done} matches)`);
}
