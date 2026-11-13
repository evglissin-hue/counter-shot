// The observatory's match: plays one setup to its result (or its time) as two
// AIs, the way duel.ts does, and returns the JSON line the contract in
// observe-line.ts describes. Tuning is applied before the match is built and
// undone when it is freed, so a process can play many setups.

import { applyTuning, BUILDING_KINDS, buildLayout, CASTLE_SHAPE, castleOfEmp, GAME_LAYOUT, KEEP_STOREYS, MATCH, mirrorZ, POWDER, shotCost, type AiLevel, type AiStep, type Difficulty } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, RULES_VERSION, type Rapier } from "@keepfall/sim";
import { Match, MATCH_RULES_VERSION } from "@keepfall/rules";
import { AIM_GROUPS, AiPlayer } from "@keepfall/ai";
import { AIM_KINDS, LINE_VERSION, type AimKind, type Fall, type BuildEntry, type MatchLine, type MatchSetup, type Sample, type Totals } from "./observe-line";

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
    const k = BUILDING_KINDS[s.kind] === "magazine" ? "k" : BUILDING_KINDS[s.kind][0];
    return s.state === 1 ? k : k.toUpperCase();
  }).join("");

  const stockOf = (c: number) => m.world.carriers?.status(c).stock ?? 0;
  const samples: Sample[] = [];
  /** 3.3: powder made (a second's rate each second), shots seen leave (by id), the first magazine blown and how many, seconds the ridden gun could not pay. */
  const made: [number, number] = [0, 0], spent: [number, number] = [0, 0], blownAt: [number, number] = [-1, -1], blown: [number, number] = [0, 0], dry: [number, number] = [0, 0];
  const seenShots = new Set<number>();
  const worldEvents = (m.world as unknown as { events: number[] }).events;
  let evSeen = 0;
  const richSecs: [number, number] = [0, 0];
  /** 3.4: the falls of each castle's structures (Topple and Crush events), and the hand shots each side landed on the other's keep, at its foot and above. */
  const falls: [Fall[], Fall[]] = [[], []];
  const keepFoot: [number, number] = [0, 0], keepTop: [number, number] = [0, 0];
  const footY = (KEEP_STOREYS[0] - 1) * CASTLE_SHAPE.course;
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
      stock: [stockOf(0), stockOf(1)],
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
    if (i % 60 === 59) {
      for (const c of [0, 1] as const) {
        if (m.gold[c] > 400) richSecs[c]++;
        made[c] += m.powderRate(c);
        const r = ais[c]?.gunner.riding ?? -1;
        if (r >= 0 && m.world.carriers && !m.world.carriers.canPay(r)) dry[c]++;
      }
    }
    // 3.3: every shot that left a gun burned its cost; every MagazineBlew event is a magazine gone up (the world's event log, read in place).
    for (const [id, info] of m.world.shotInfo) {
      if (seenShots.has(id)) continue;
      seenShots.add(id);
      const e = m.emplacements[info.emplacement];
      spent[castleOfEmp(e)] += shotCost(e);
    }
    for (; evSeen + EVENT_STRIDE <= worldEvents.length; evSeen += EVENT_STRIDE) {
      const kind = worldEvents[evSeen];
      if (kind === EventKind.Topple || kind === EventKind.Crush) {
        const si = worldEvents[evSeen + 1];
        falls[Math.floor(si / 5) as 0 | 1].push([i / 60, si % 5 === 0 ? "keep" : "tower", kind === EventKind.Topple ? "topple" : "crush", worldEvents[evSeen + 2]]);
        continue;
      }
      if (kind !== EventKind.MagazineBlew) continue;
      const c = worldEvents[evSeen + 1] as 0 | 1;
      if (blownAt[c] < 0) blownAt[c] = i;
      blown[c]++;
    }
    // 3.4: a hand shot that came down on the other castle's keep (within a metre and a half of its walls: its buttresses too).
    for (const l of m.world.landings) {
      if (l.auto || l.emplacement < 0) continue;
      const shooter = castleOfEmp(m.emplacements[l.emplacement]);
      const kz = mirrorZ(1 - shooter, CASTLE_SHAPE.keepZ), reach = CASTLE_SHAPE.keepHalf + 1.5;
      if (Math.abs(l.x) > reach || Math.abs(l.z - kz) > reach) continue;
      if (l.y < footY) keepFoot[shooter]++;
      else keepTop[shooter]++;
    }
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
    build: m.applied.filter((a) => a[2] !== "powder").map((a): BuildEntry => [a[0], a[1], a[2]]),
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
    powderMade: [Math.round(made[0]), Math.round(made[1])],
    powderBought: pair((c) => m.applied.filter((a) => a[1] === c && a[2] === "powder").length * POWDER.buy.charges),
    powderSpent: spent,
    powderLost: pair((c) => m.world.carriers?.status(c).lost ?? 0),
    magazineBlown: blownAt,
    magazinesBlown: blown,
    dryRideSecs: dry,
    falls,
    keepFoot,
    keepTop,
  };
  const r = m.result;
  const line: MatchLine = {
    v: LINE_VERSION,
    setup,
    rules: { sim: RULES_VERSION, match: MATCH_RULES_VERSION },
    result: { winner: r ? r.winner : null, reason: r ? r.reason : null, tick, hash: m.hash(), felled: !!r && r.reason === "keep" && (r.winner === 0 || r.winner === 1) && falls[1 - r.winner].some((f) => f[1] === "keep") },
    samples,
    totals,
    wall: { ms: wallMs, speed: wallMs > 0 ? m.tick / 60 / (wallMs / 1000) : 0 },
  };
  m.free();
  return line;
}
