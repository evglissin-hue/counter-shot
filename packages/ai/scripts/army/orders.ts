// Order hunts: advance, hold, push, route. Each returns a HuntResult (see common.ts).
import { inCourtyard, MUSTER } from "@keepfall/content";
import { Order, routeField, Spin, type Minion } from "@keepfall/sim";
import { GUIDED_OPTIONS, Team, TUTOR_TEAM, type Match, type MatchInput } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";
import { across, bridgeAt, BR, clock, costOf, FLOW_INF, HOLD, marcher, MinionState, newMatch, ORDER, pct, ROUTE_NAMES, type HuntFn, type HuntResult } from "./common";
import { Role } from "./common";

const PIKES = [0, 0, 0, 0, 0, 0, 0, 0];
/** Sandbox flags for scenarios that are about the army alone: no barracks timers, garrison, masons, powder or guns. */
const BARE = { barracks: false, garrison: false, masons: false, powder: false, gunnery: false } as const;
const gateD = (x: Minion) => Math.hypot(x.x - MUSTER[1 - x.team].x, x.z - MUSTER[1 - x.team].z);

// ---------------------------------------------------------------------------------------------------------------- advance
interface AdvMan { c0: number; resp: number; fought: boolean }
interface AdvWatch { team: number; t0: number; men: Map<number, AdvMan>; done: boolean }

/** Give Advance at the listed ticks and watch the men marching then: the ticks until each walks the way of his route, and the metres along it 20 s later. */
function watchAdvance(label: string, m: Match, events: Array<[number, Team]>, until: number, T: Record<string, number>, tutor?: AiPlayer): { lines: string[]; flags: string[]; stats: string } {
  for (const [t, team] of events) m.queue(t, team, { kind: "order", order: Order.Advance });
  const watches: AdvWatch[] = [];
  const dir: [number, number] = [0, 0];
  const lines: string[] = [], flags: string[] = [];
  let men = 0, slow = 0, short = 0;
  for (let tick = 0; tick < until && !m.result; tick++) {
    tutor?.step();
    const evs = events.filter((e) => e[0] === tick);
    m.step();
    for (const ev of evs) {
      const w: AdvWatch = { team: ev[1], t0: m.tick, men: new Map(), done: false };
      for (const x of m.world.minions.list) if (x.team === ev[1] && marcher(x)) w.men.set(x.id, { c0: costOf(m, x), resp: -1, fought: false });
      watches.push(w);
    }
    for (const w of watches) {
      const dt = m.tick - w.t0;
      if (w.done || dt > T.advanceWindow) continue;
      for (const [id, s] of w.men) {
        const x = m.world.minions.list[id];
        if (x.state !== MinionState.Upright) continue;
        if (x.target >= 0 || x.action === 2) s.fought = true;
        if (s.resp >= 0 || !m.army.flow.dir(routeField(x.team, x.route), x.x, x.z, dir)) continue;
        if (x.vx * dir[0] + x.vz * dir[1] > 0.5 * x.speed) s.resp = dt;
      }
      if (dt === T.advanceWindow) {
        w.done = true;
        let n = 0, noResp = 0, noProg = 0, worst = "";
        for (const [id, s] of w.men) {
          const x = m.world.minions.list[id];
          if (x.state !== MinionState.Upright || s.fought) continue; // fights excepted
          n++;
          const c1 = costOf(m, x);
          const prog = c1 >= FLOW_INF || s.c0 >= FLOW_INF ? NaN : (s.c0 - c1) / 10;
          const arrived = inCourtyard(1 - x.team, x.x, x.z) || (s.c0 < FLOW_INF && s.c0 / 10 < 10);
          const late = s.resp < 0 || s.resp > T.advanceResp;
          if (late) noResp++;
          if (!(prog >= 10) && !arrived) {
            noProg++;
            if (!worst) worst = `man ${id} at (${x.x.toFixed(0)}, ${x.z.toFixed(0)}) cost ${s.c0}->${c1}`;
          }
        }
        men += n;
        slow += noResp;
        short += noProg;
        lines.push(`${label} team ${w.team} Advance at ${clock(w.t0)}: ${n} men not in a fight; ${noResp} did not move within ${T.advanceResp} ticks; ${noProg} under 10 m along their road after 20 s${worst ? ` (first: ${worst})` : ""}`);
      }
    }
  }
  if (slow > 0) flags.push(`${label}: ${slow} of ${men} men did not walk toward the enemy within ${T.advanceResp} ticks of Advance`);
  if (men > 0 && (men - short) / men < T.advanceAlong) flags.push(`${label}: only ${pct(men - short, men)} of ${men} men were 10 m along their road 20 s after Advance (need ${Math.round(T.advanceAlong * 100)}%)`);
  return { lines, flags, stats: `${label} ${men - slow}/${men} moved, ${men - short}/${men} 10 m along` };
}

export const advance: HuntFn = (T, seed) => {
  const out: HuntResult = { measure: "", flags: [], detail: [] };
  const stats: string[] = [];
  const add = (r: { lines: string[]; flags: string[]; stats: string }) => {
    out.detail.push(...r.lines);
    out.flags.push(...r.flags);
    stats.push(r.stats);
  };
  // Men holding at a marker: the player's wave on the right road, the enemy's on the left; both on Hold, then Advance.
  {
    const m = newMatch({ seed, ...BARE, orders: [Order.Hold, Order.Hold], routes: ["right", "left"] });
    for (const team of [0, 1] as const) {
      m.army.spawnMix(team, team === 1 ? 0 : 2, PIKES, 0);
      m.army.spawnMix(team, team === 1 ? 0 : 2, PIKES, 5.5);
    }
    add(watchAdvance("marker", m, [[T.advanceMarkerAt * 60, Team.Player], [T.advanceMarkerAt * 60, Team.Enemy]], (T.advanceMarkerAt + T.advanceWindow / 60 + 1) * 60, T));
    m.free();
  }
  // Men standing after a fight: both on the centre road on Hold; the enemy advances into the player's held men, later the player advances.
  {
    const m = newMatch({ seed, ...BARE, orders: [Order.Hold, Order.Hold], routes: ["centre", "centre"] });
    m.army.spawnMix(0, 1, PIKES, 0);
    m.army.spawnMix(1, 1, PIKES, 0);
    m.queue(T.advanceFightEnemyAt * 60, Team.Enemy, { kind: "order", order: Order.Advance });
    add(watchAdvance("fight", m, [[T.advanceFightAt * 60, Team.Player]], (T.advanceFightAt + T.advanceWindow / 60 + 1) * 60, T));
    m.free();
  }
  // The guided match's waves on Hold on the left flank, sent in at the guided script's Advance.
  {
    const m = newMatch({ ...GUIDED_OPTIONS, seed });
    const tutor = new AiPlayer(m, TUTOR_TEAM, "tutor", seed);
    m.queue(0, Team.Player, { kind: "man", emplacement: 0 });
    add(watchAdvance("guided", m, [[T.advanceGuidedAt * 60, Team.Player]], (T.advanceGuidedAt + T.advanceWindow / 60 + 1) * 60, T, tutor));
    m.free();
  }
  out.measure = stats.join("; ");
  return out;
};

// ---------------------------------------------------------------------------------------------------------------- hold
export const hold: HuntFn = (T, seed) => {
  const out: HuntResult = { measure: "", flags: [], detail: [] };
  // Stack: both teams on Hold on the centre road, several waves one after another.
  {
    const m = newMatch({ seed, ...BARE, orders: [Order.Hold, Order.Hold], routes: ["centre", "centre"] });
    const offs = [0, -5.5, 5.5];
    const past = (x: Minion) => (x.team === 1 ? x.z - HOLD[x.team][x.route].z : HOLD[x.team][x.route].z - x.z);
    const toMarker = (x: Minion) => Math.hypot(x.x - HOLD[x.team][x.route].x, x.z - HOLD[x.team][x.route].z);
    const arrive = new Map<number, number>();
    const at = new Map<number, Map<number, number>>();
    const secs = T.holdStackSecs;
    for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
      if (tick % (T.holdEvery * 60) === 0 && tick / (T.holdEvery * 60) < T.holdWaves) {
        const k = tick / (T.holdEvery * 60);
        for (const team of [0, 1] as const) m.army.spawnMix(team, 1, PIKES, offs[k % 3]);
      }
      m.step();
      for (const x of m.world.minions.list) {
        if (!marcher(x)) continue;
        if (!arrive.has(x.id)) {
          const p = past(x);
          if (p > -2 && p < 2.5 && toMarker(x) < 15) arrive.set(x.id, m.tick);
          continue;
        }
        const dt = m.tick - arrive.get(x.id)!;
        if (dt === T.holdAt1 * 60 || dt === T.holdAt2 * 60) {
          if (!at.has(x.id)) at.set(x.id, new Map());
          at.get(x.id)!.set(dt, toMarker(x));
        }
      }
    }
    for (const team of [0, 1]) {
      const rows = (s: number) => [...at.entries()].filter(([id]) => m.world.minions.list[id].team === team && m.world.minions.list[id].state === MinionState.Upright).map(([, v]) => v.get(s * 60)).filter((v): v is number => v !== undefined);
      const r1 = rows(T.holdAt1), r2 = rows(T.holdAt2);
      const n1 = r1.filter((d) => d < T.holdNear).length, n2 = r2.filter((d) => d < T.holdNear).length;
      const arrived = [...arrive.keys()].filter((id) => m.world.minions.list[id].team === team).length;
      out.detail.push(`stack team ${team}: ${T.holdWaves} waves sent, ${arrived} men reached the marker; at +${T.holdAt1} s ${n1}/${r1.length} within ${T.holdNear} m; at +${T.holdAt2} s ${n2}/${r2.length}`);
      if (r1.length && n1 / r1.length < T.holdFrac1) out.flags.push(`stack team ${team}: ${pct(n1, r1.length)} of ${r1.length} men within ${T.holdNear} m of their marker ${T.holdAt1} s after reaching it (need ${Math.round(T.holdFrac1 * 100)}%)`);
      if (r2.length && n2 / r2.length < T.holdFrac2) out.flags.push(`stack team ${team}: ${pct(n2, r2.length)} of ${r2.length} men within ${T.holdNear} m of their marker ${T.holdAt2} s after reaching it (need ${Math.round(T.holdFrac2 * 100)}%)`);
      if (!r2.length) out.flags.push(`stack team ${team}: no man held ${T.holdAt2} s at his marker (waves never reached it, or never stayed)`);
    }
    out.measure = `stack within ${T.holdNear} m: ` + [0, 1].map((team) => {
      const f = (s: number) => {
        const r = [...at.entries()].filter(([id]) => m.world.minions.list[id].team === team).map(([, v]) => v.get(s * 60)).filter((v): v is number => v !== undefined);
        return `${r.filter((d) => d < T.holdNear).length}/${r.length}`;
      };
      return `t${team} +${T.holdAt1}s ${f(T.holdAt1)} +${T.holdAt2}s ${f(T.holdAt2)}`;
    }).join(", ");
    m.free();
  }
  // Late Hold: both advancing (the player's wave on the centre road, the enemy's on the left); the player is given Hold with its men past the line.
  {
    const m = newMatch({ seed, ...BARE, orders: [Order.Advance, Order.Advance], routes: ["left", "centre"] });
    m.army.spawnMix(1, 1, PIKES, 0);
    m.army.spawnMix(1, 1, PIKES, 5.5);
    m.army.spawnMix(0, 0, PIKES, 0);
    m.queue(T.holdLateAt * 60, Team.Player, { kind: "order", order: Order.Hold });
    const past = (x: Minion) => x.z - HOLD[1][x.route].z;
    const start = new Map<number, number>();
    const back = new Set<number>();
    for (let tick = 0; tick < (T.holdLateAt + T.holdLateBack) * 60 && !m.result; tick++) {
      m.step();
      if (m.tick === T.holdLateAt * 60 + 1) for (const x of m.world.minions.list) if (marcher(x) && x.team === 1 && past(x) > 1.5) start.set(x.id, past(x));
      if (m.tick > T.holdLateAt * 60 + 1) for (const id of start.keys()) {
        const x = m.world.minions.list[id];
        if (x.state === MinionState.Upright && past(x) < 2.5) back.add(id);
      }
    }
    const alive = [...start.keys()].filter((id) => m.world.minions.list[id].state === MinionState.Upright);
    const nb = alive.filter((id) => back.has(id)).length;
    out.detail.push(`late Hold at ${T.holdLateAt} s: ${start.size} men past the line, ${alive.length} still up, ${nb} back to within 2.5 m past the line within ${T.holdLateBack} s`);
    if (!start.size) out.flags.push(`late Hold: no man was past his line when Hold was given (scenario did not set up)`);
    else if (alive.length && nb / alive.length < T.holdBack) out.flags.push(`late Hold: only ${nb} of ${alive.length} men past the line came back within ${T.holdLateBack} s (need ${Math.round(T.holdBack * 100)}%)`);
    out.measure += `; late Hold ${nb}/${alive.length} back`;
    m.free();
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------------------- push
export const push: HuntFn = (T, seed) => {
  const out: HuntResult = { measure: "", flags: [], detail: [] };
  // The player's gun opens a breach west of the enemy gate (the siege test's two wall shots); masons are off, so it stays open.
  const m = newMatch({ seed, plan: false, rotate: false, gunnery: false, masons: false, garrison: false, barracks: false, powder: false, orders: [Order.Hold, Order.Push], routes: ["right", "left"] });
  const shot = (yaw: number): MatchInput => ({ kind: "fire", emplacement: 0, yaw, pitch: -0.022, charge: 1, fuse: 0, spin: Spin.None });
  m.queue(0, Team.Player, { kind: "man", emplacement: 0 });
  m.queue(5, Team.Player, shot(-0.0707));
  m.queue(260, Team.Player, shot(-0.0624));
  // Two waves down the left road, side by side then one behind, and one on the right road.
  const sends: Array<[number, number, number]> = [[600, 0, 0], [600, 0, -5.5], [1500, 2, 0]];
  const spawn = new Map<number, number>(), inTick = new Map<number, number>(), crossed = new Map<number, number>(), first = new Map<number, number>(), waveOf = new Map<number, number>();
  const secs = T.pushSecs;
  for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
    for (const [t, r, off] of sends) if (t === tick) m.army.spawnMix(1, r, PIKES, off);
    m.step();
    for (const x of m.world.minions.list) {
      if (x.team !== 1 || x.wave < 0 || x.role !== Role.March) continue;
      if (!spawn.has(x.id)) {
        spawn.set(x.id, m.tick);
        first.set(x.id, x.route);
        waveOf.set(x.id, x.wave);
      }
      if (x.state !== MinionState.Upright) continue;
      if (!inTick.has(x.id) && inCourtyard(0, x.x, x.z)) inTick.set(x.id, m.tick);
      if (!crossed.has(x.id) && x.z > -75) crossed.set(x.id, bridgeAt(x.x));
    }
  }
  const waves = new Map<number, number[]>();
  for (const [id, w] of waveOf) waves.set(w, [...(waves.get(w) ?? []), id]);
  const cells: string[] = [];
  let wrong = 0, crossedN = 0, wavesJudged = 0, wavesShort = 0;
  for (const [w, ids] of [...waves.entries()].sort((a, b) => a[0] - b[0])) {
    const wrongHere = ids.filter((id) => crossed.has(id) && crossed.get(id) !== first.get(id));
    wrong += wrongHere.length;
    crossedN += ids.filter((id) => crossed.has(id)).length;
    const left = spawn.get(ids[0])!;
    const judged = left + T.pushIn * 60 <= m.tick;
    const downEarly = ids.filter((id) => m.world.minions.list[id].state !== MinionState.Upright && !inTick.has(id)).length;
    const inTime = ids.filter((id) => inTick.has(id) && inTick.get(id)! - spawn.get(id)! <= T.pushIn * 60).length;
    const denom = ids.length - downEarly;
    cells.push(`wave ${w} (route ${ROUTE_NAMES[first.get(ids[0])!]}, left ${clock(left)}): ${ids.length} men, ${inTime} in the courtyard within ${T.pushIn} s of leaving${judged ? "" : " (not judged: run ended first)"}, ${downEarly} down outside; crossed by ${ids.map((id) => (crossed.has(id) ? ROUTE_NAMES[crossed.get(id)!] : "-")).join(",")}`);
    if (judged && denom > 0) {
      wavesJudged++;
      if (inTime / denom < T.pushFrac) {
        wavesShort++;
        out.flags.push(`push wave ${w}: ${inTime} of ${denom} men in the enemy courtyard within ${T.pushIn} s of leaving (${pct(inTime, denom)}; need ${Math.round(T.pushFrac * 100)}%)`);
      }
    }
  }
  if (wrong > 0) out.flags.push(`push: ${wrong} of ${crossedN} men crossed the stream by a bridge that was not their wave's road`);
  if (!wavesJudged) out.flags.push(`push: no wave had ${T.pushIn} s to get in (scenario too short)`);
  out.detail.push(...cells);
  out.measure = `${wavesJudged - wavesShort}/${wavesJudged} waves got 90% in within ${T.pushIn} s; ${crossedN - wrong}/${crossedN} men crossed by their own road's bridge`;
  m.free();
  return out;
};

// ---------------------------------------------------------------------------------------------------------------- route
/** A route input is a match route name (a bridge's own name). A page for castle 0 shows left and right swapped (ownSide in apps/game/src/main.ts), so the hunt names what each owner would press. */
const ownerName = (team: number, r: string) => (team === 0 && r !== "centre" ? (r === "left" ? "right" : "left") : r);
export const route: HuntFn = (T, seed) => {
  const out: HuntResult = { measure: "", flags: [], detail: [] };
  const stats: string[] = [];
  // Crossing: both teams on Advance; a route input at 5 s, after the first wave left (still short of the bridge); a new wave leaves later.
  // Two runs so each team is sent through left and right and the centre.
  const cases: Array<{ from: [string, string]; to: [string, string] }> = [
    { from: ["centre", "centre"], to: ["left", "right"] },
    { from: ["left", "right"], to: ["centre", "left"] },
  ];
  for (const c of cases) {
    const m = newMatch({ seed, ...BARE, orders: [Order.Advance, Order.Advance], routes: c.from as never });
    for (const team of [0, 1] as const) m.army.spawnMix(team, ROUTE_NAMES.indexOf(c.from[team] as never), PIKES, 0);
    for (const team of [0, 1] as const) m.queue(T.routeAt * 60, team, { kind: "route", route: c.to[team] as never });
    const waveOf = new Map<number, number>(), waveRoute0 = new Map<number, number>(), crossed = new Map<number, number>(), spawnedAfter = new Set<number>();
    const secs = T.routeCrossSecs;
    for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
      if (tick === (T.routeAt + 2) * 60) for (const team of [0, 1] as const) m.army.spawnMix(team, ROUTE_NAMES.indexOf(c.to[team] as never), PIKES, 0);
      m.step();
      for (const x of m.world.minions.list) {
        if (!marcher(x)) continue;
        if (!waveOf.has(x.id)) {
          waveOf.set(x.id, x.wave);
          waveRoute0.set(x.id, x.route);
          if (tick >= T.routeAt * 60) spawnedAfter.add(x.id);
        }
        if (!crossed.has(x.id) && across(x.team, x.z)) crossed.set(x.id, bridgeAt(x.x));
      }
    }
    for (const team of [0, 1]) {
      const want = ROUTE_NAMES.indexOf(c.to[team] as never);
      const ids = [...waveOf.keys()].filter((id) => m.world.minions.list[id].team === team && crossed.has(id));
      const fresh = ids.filter((id) => spawnedAfter.has(id)), old = ids.filter((id) => !spawnedAfter.has(id));
      const fr = fresh.filter((id) => crossed.get(id) === want).length, ol = old.filter((id) => crossed.get(id) === want).length;
      const label = `team ${team} ${c.from[team]}->${c.to[team]} (its owner presses ${ownerName(team, c.to[team])})`;
      out.detail.push(`crossing ${label}: new wave ${fr}/${fresh.length} by the named bridge; the wave already out (not yet across at the input) ${ol}/${old.length}`);
      if (fresh.length && fr < fresh.length) out.flags.push(`route ${label}: ${fresh.length - fr} of ${fresh.length} men of a new wave crossed by another bridge than the named one`);
      if (!fresh.length) out.flags.push(`route ${label}: the new wave never crossed (${T.routeCrossSecs} s)`);
      if (old.length && ol < old.length) out.flags.push(`route ${label}: ${old.length - ol} of ${old.length} men of a wave out but not yet across when the route was named took the old road (the input should move them too)`);
      stats.push(`t${team} ${c.from[team]}->${c.to[team]} new ${fr}/${fresh.length} out ${ol}/${old.length}`);
    }
    m.free();
  }
  // Holding at a marker: waves wait on Hold, then the route is named: they should walk to the new route's marker.
  {
    const from: [string, string] = ["right", "left"], to: [string, string] = ["left", "right"];
    const m = newMatch({ seed, ...BARE, orders: [Order.Hold, Order.Hold], routes: from as never });
    for (const team of [0, 1] as const) {
      m.army.spawnMix(team, ROUTE_NAMES.indexOf(from[team] as never), PIKES, 0);
      m.army.spawnMix(team, ROUTE_NAMES.indexOf(from[team] as never), PIKES, 5.5);
    }
    for (const team of [0, 1] as const) m.queue(T.routeHoldAt * 60, team, { kind: "route", route: to[team] as never });
    for (let tick = 0; tick < (T.routeHoldAt + T.routeMove) * 60 && !m.result; tick++) m.step();
    for (const team of [0, 1]) {
      const want = ROUTE_NAMES.indexOf(to[team] as never);
      const mk = HOLD[team][want];
      const men = m.world.minions.list.filter((x) => marcher(x) && x.team === team);
      const near = men.filter((x) => Math.hypot(x.x - mk.x, x.z - mk.z) < T.routeNear).length;
      const label = `team ${team} ${from[team]}->${to[team]} (its owner presses ${ownerName(team, to[team])})`;
      out.detail.push(`hold ${label}: ${near}/${men.length} within ${T.routeNear} m of the new marker ${T.routeMove} s after the input (men now on routes ${[...new Set(men.map((x) => ROUTE_NAMES[x.route]))].join(",")})`);
      if (men.length && near / men.length < T.routeFrac) out.flags.push(`route hold ${label}: ${near} of ${men.length} men held at the old marker within ${T.routeMove} s of the input moved to the new marker (need ${Math.round(T.routeFrac * 100)}%)`);
      stats.push(`hold t${team} ${near}/${men.length}`);
    }
    m.free();
  }
  out.measure = stats.join("; ");
  return out;
};
void bridgeAt; void BR; void ORDER;
