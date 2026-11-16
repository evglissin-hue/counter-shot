// The observatory's match: plays one setup to its result (or its time) as two
// AIs, the way duel.ts does, and returns the JSON line the contract in
// observe-line.ts describes. Tuning is applied before the match is built and
// undone when it is freed, so a process can play many setups.

import { applyTuning, BUILDING_KINDS, buildLayout, CASTLE_SHAPE, castleOfEmp, GAME_LAYOUT, KEEP_STOREYS, MATCH, mirrorZ, ORGAN_KINDS, PLOTS, POWDER, shotCost, StationKind, type AiLevel, type AiStep, type Difficulty } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, RULES_VERSION, type Rapier } from "@keepfall/sim";
import { Match, MATCH_RULES_VERSION } from "@keepfall/rules";
import { AIM_GROUPS, AiPlayer } from "@keepfall/ai";
import { AIM_KINDS, LINE_VERSION, type AimKind, type Fall, type BuildEntry, type MatchLine, type HouseholdTotals, type MatchSetup, type Sample, type Totals } from "./observe-line";

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
  const plots = (c: number) => PLOTS.map((q) => q.index).map((p) => {
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
  /** 3.5: per castle and organ (ORGAN_KINDS order), since when it has been down (tick, -1: up), the ticks down so far, the times it went down, and whether it was down at 5:00; and the tick each spotter's tower first worked. */
  const nO = ORGAN_KINDS.length;
  const zeros = () => ORGAN_KINDS.map(() => 0);
  const downSince: [number[], number[]] = [ORGAN_KINDS.map(() => -1), ORGAN_KINDS.map(() => -1)];
  const downTicks: [number[], number[]] = [zeros(), zeros()], downs: [number[], number[]] = [zeros(), zeros()];
  const downAt5: [Array<boolean | null>, Array<boolean | null>] = [ORGAN_KINDS.map(() => null), ORGAN_KINDS.map(() => null)];
  const spotterAt: [number | null, number | null] = [null, null];
  const AT5 = 5 * 60 * 60;
  /** 3.6: people lost by kind of station, seconds the reserve stood at 0 and seconds a gun had no crew, and changes of "who is replaced first". */
  const hh = m.world.household;
  const lostBy = pair(() => ({ guns: 0, masons: 0, boys: 0, keepers: 0 }));
  const reserveZero: [number, number] = [0, 0], uncrewed: [number, number] = [0, 0], firstChanges: [number, number] = [0, 0];
  const firstSeen = hh ? [hh.first[0], hh.first[1]] : ["guns", "guns"];
  const armedGuns = (c: number) => m.emplacements.filter((e) => !e.empty && (e.z < -75 ? 1 : 0) === c);
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
        if (hh) {
          if (hh.reserve[c] === 0) reserveZero[c]++;
          if (armedGuns(c).some((e) => hh.crew(e.id) === 0)) uncrewed[c]++;
          if (hh.first[c] !== firstSeen[c]) (firstSeen[c] = hh.first[c], firstChanges[c]++);
        }
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
      if (kind === EventKind.OrganDown || kind === EventKind.OrganUp) {
        const c = worldEvents[evSeen + 1], o = worldEvents[evSeen + 2];
        if ((c !== 0 && c !== 1) || !(o >= 0 && o < nO)) continue;
        if (kind === EventKind.OrganDown) {
          if (downSince[c][o] < 0) (downSince[c][o] = i + 1, downs[c][o]++);
        } else if (downSince[c][o] >= 0) {
          downTicks[c][o] += i + 1 - downSince[c][o];
          downSince[c][o] = -1;
        }
        continue;
      }
      if (kind === EventKind.HouseholdDown && hh) {
        const c = worldEvents[evSeen + 1], st = hh.stations[worldEvents[evSeen + 2]];
        if ((c === 0 || c === 1) && st) lostBy[c][st.kind === StationKind.Gun ? "guns" : st.kind === StationKind.Mason ? "masons" : st.kind === StationKind.Boy ? "boys" : "keepers"]++;
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
    if (i === AT5 - 1) for (const c of [0, 1] as const) ORGAN_KINDS.forEach((k, o) => (downAt5[c][o] = !m.organUp(c, k)));
    if (i % 10 === 9) for (const c of [0, 1] as const) if (spotterAt[c] === null && m.spotter(c)) spotterAt[c] = i + 1;
    if (i % 1800 === 1799) sample(i + 1);
  }
  const tick = m.result ? m.result.tick : i;
  // The end, unless the last 30 s sample was taken on this very tick.
  if (!samples.length || samples[samples.length - 1].t !== m.tick / 60) sample(m.tick);
  const wallMs = performance.now() - t0;
  const endTick = m.tick;
  for (const c of [0, 1] as const) for (let o = 0; o < nO; o++) if (downSince[c][o] >= 0) downTicks[c][o] += endTick - downSince[c][o];

  const household = hh
    ? pair((c): HouseholdTotals => {
        const levels: [number, number, number, number] = [0, 0, 0, 0];
        let none = 0;
        for (const e of armedGuns(c)) {
          if (hh.crew(e.id) === 0) none++;
          else levels[hh.level(e.id)]++;
        }
        if (hh.first[c] !== firstSeen[c]) (firstSeen[c] = hh.first[c], firstChanges[c]++);
        return { lost: hh.lost[c], lostBy: lostBy[c], reserveZeroSecs: reserveZero[c], uncrewedSecs: uncrewed[c], levels, uncrewedEnd: none, firstChanges: firstChanges[c], firstEnd: hh.first[c] };
      })
    : undefined;
  const byHand = pair((c): Record<AimKind, number> => {
    const rec = {} as Record<AimKind, number>;
    for (const k of AIM_KINDS) rec[k] = 0;
    const by = ais[c]?.gunner.byAim;
    // Read the groups generically: whatever AIM_GROUPS holds is counted (3.5 adds bell, crane and mast).
    if (by) AIM_GROUPS.forEach((g, k) => (rec[g as AimKind] = by[k] ?? 0));
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
    organDownSecs: pair((c) => downTicks[c].map((t) => Math.round((t / 60) * 10) / 10)),
    organDowns: downs,
    organDownAt5: downAt5,
    spotterAt,
    household,
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
