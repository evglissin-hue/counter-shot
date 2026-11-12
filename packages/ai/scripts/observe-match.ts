// The observatory's match: plays one setup to its result (or its time) as two
// AIs, the way duel.ts does, and returns the JSON line the contract in
// observe-line.ts describes. Tuning is applied before the match is built and
// undone when it is freed, so a process can play many setups.

import { applyTuning, BUILDING_KINDS, buildLayout, GAME_LAYOUT, MATCH, type AiLevel, type AiStep, type Difficulty } from "@keepfall/content";
import { RULES_VERSION, type Rapier } from "@keepfall/sim";
import { Match, MATCH_RULES_VERSION } from "@keepfall/rules";
import { AIM_GROUPS, AiPlayer } from "@keepfall/ai";
import { AIM_KINDS, LINE_VERSION, type AimKind, type BuildEntry, type MatchLine, type MatchSetup, type Sample, type Totals } from "./observe-line";

const pair = <T>(f: (c: 0 | 1) => T): [T, T] => [f(0), f(1)];

export function observeMatch(R: Rapier, setup: MatchSetup): MatchLine {
  const undo = applyTuning(setup.tuning ?? {});
  try {
    return play(R, { ...setup, secs: setup.secs ?? MATCH.timeLimitTick / 60 });
  } finally {
    undo();
  }
}

function play(R: Rapier, setup: MatchSetup): MatchLine {
  const seed = setup.seed;
  const secs = setup.secs;
  const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false });
  const ais = pair((team) => (setup.sides[team] === "idle" ? null : new AiPlayer(m, team, setup.sides[team] as Difficulty, seed, { plan: (setup.steps?.[team] as AiStep[] | null | undefined) ?? undefined, level: (setup.levels?.[team] as Partial<AiLevel> | null | undefined) ?? undefined })));
  const outs = (c: number) => m.emplacements.filter((e, i) => (e.z < -75 ? 1 : 0) === c && !e.empty && !m.world.mounts.up(i)).length;
  const plots = (c: number) => [0, 1, 2, 3, 4, 5].map((p) => {
    const s = m.world.structures!.slot(c, p);
    if (s.kind < 0 || s.state === 0) return ".";
    if (s.state === 3) return "x";
    const k = BUILDING_KINDS[s.kind][0];
    return s.state === 1 ? k : k.toUpperCase();
  }).join("");

  const samples: Sample[] = [];
  const richSecs: [number, number] = [0, 0];
  let moving = 0, movingMax = 0, windowMoving = 0, worst = 0, windowWorst = 0;
  /** Steps slower than 16 ms and 33 ms (one slow step on a busy machine says little; many say more). */
  const slow: [number, number] = [0, 0];
  /** 3.2: marks made (each is a new object in the register) and salvos fired (a new salvoAt), by castle. */
  const marksMade: [number, number] = [0, 0], salvos: [number, number] = [0, 0], salvoGuns: [number, number] = [0, 0];
  const seenMarks = new WeakSet<object>();
  const salvoAt: [number, number] = [m.register.salvoAt[0], m.register.salvoAt[1]];
  const sample = (tick: number) => {
    const army = m.armyCounts();
    samples.push({
      t: tick / 60,
      gold: [m.gold[0], m.gold[1]],
      spent: [m.spent[0], m.spent[1]],
      plots: [plots(0), plots(1)],
      floors: [m.floorsUnder(0), m.floorsUnder(1)],
      down: [m.masonryDown(0), m.masonryDown(1)],
      standing: [army.standing[0], army.standing[1]],
      fallen: [army.fallen[0], army.fallen[1]],
      storm: [m.storm[0], m.storm[1]],
      out: [outs(0), outs(1)],
      moving: m.world.castle.awakeCount(),
      movingMax: windowMoving,
      worstMs: windowWorst,
    });
    windowMoving = 0;
    windowWorst = 0;
  };

  const t0 = performance.now();
  const limit = Math.round(secs * 60);
  let i = 0;
  for (; i < limit && !m.result; i++) {
    for (const ai of ais) ai?.step();
    const s0 = performance.now();
    m.step();
    const ms = performance.now() - s0;
    if (ms > worst) worst = ms;
    if (ms > windowWorst) windowWorst = ms;
    if (ms > 16) slow[0]++;
    if (ms > 33) slow[1]++;
    for (const c of [0, 1] as const) {
      for (const k of m.register.marks[c]) if (k && !seenMarks.has(k)) (seenMarks.add(k), marksMade[c]++);
      if (m.register.salvoAt[c] !== salvoAt[c]) {
        salvoAt[c] = m.register.salvoAt[c];
        salvos[c]++;
        // The shots a salvo queues all go in on the tick it is ordered (the one before had long fired).
        for (const q of m.register.queued) if (q.team === c) salvoGuns[c]++;
      }
    }
    if (i % 10 === 0) {
      moving = m.world.castle.awakeCount();
      if (moving > movingMax) movingMax = moving;
      if (moving > windowMoving) windowMoving = moving;
    }
    if (i % 60 === 59) for (const c of [0, 1] as const) if (m.gold[c] > 400) richSecs[c]++;
    if (i % 1800 === 1799) sample(i + 1);
  }
  const tick = m.result ? m.result.tick : i;
  // The end, unless the last 30 s sample was taken on this very tick.
  if (!samples.length || samples[samples.length - 1].t !== m.tick / 60) sample(m.tick);
  const wallMs = performance.now() - t0;

  const byHand = pair((c): Record<AimKind, number> => {
    const rec = {} as Record<AimKind, number>;
    for (const k of AIM_KINDS) rec[k] = 0;
    const by = ais[c]?.gunner.byAim;
    if (by) AIM_GROUPS.forEach((g, k) => (rec[g] = by[k]));
    return rec;
  });
  const totals: Totals = {
    byHand,
    shots: [m.shots[0], m.shots[1]],
    auto: [m.autoShots[0], m.autoShots[1]],
    build: m.applied.map((a): BuildEntry => [a[0], a[1], a[2]]),
    richSecs,
    tricks: pair((c) => m.economy.tricks[c].reduce((a, b) => a + b, 0)),
    stats: pair((c) => ({ ...m.stats(c) }) as unknown as Record<string, number>),
    movingMax,
    worstMs: worst,
    slowSteps: slow,
    marks: marksMade,
    salvos,
    salvoGuns,
    autoOnMark: [m.autoOnMark[0], m.autoOnMark[1]],
    bridgesUp: m.army.bridgeOpen.filter(Boolean).length,
  };
  const r = m.result;
  const line: MatchLine = {
    v: LINE_VERSION,
    setup,
    rules: { sim: RULES_VERSION, match: MATCH_RULES_VERSION },
    result: { winner: r ? r.winner : null, reason: r ? r.reason : null, tick, hash: m.hash() },
    samples,
    totals,
    wall: { ms: wallMs, speed: wallMs > 0 ? m.tick / 60 / (wallMs / 1000) : 0 },
  };
  m.free();
  return line;
}
