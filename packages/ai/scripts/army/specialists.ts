// Specialist hunts: keg (sappers), musket, ladder. Scripted waves of team 1 (the player) against castle 0 unless noted.
import { KEG, Unit } from "@keepfall/content";
import { Cause, Climb, LadderState, MinionState, NavKind, navCell, Order, type Minion } from "@keepfall/sim";
import { Team } from "@keepfall/rules";
import { clock, newMatch, ORDER, pct, type HuntFn, type HuntResult, type Match } from "./common";

const P = Unit.Pikeman, S = Unit.Sapper, M = Unit.Musketeer;
const PIKES = [P, P, P, P, P, P, P, P];
/** Castle c's front wall face z. */
const WALL = (castle: number) => (castle === 0 ? -16 : -134);

// ---------------------------------------------------------------------------------------------------------------- keg
interface Keg { sapper: number; wave: number; team: number; tick: number; x: number; z: number }
interface Burst { tick: number; x: number; z: number; own: number; foe: number }

export const keg: HuntFn = (T, seed) => {
  const out: HuntResult = { measure: "", flags: [], detail: [] };
  const m = newMatch({ seed, masons: true, barracks: false, gunnery: false });
  // A wave with two sappers (the mix the barracks sends), down the centre road at castle 0; no storm so the match runs on.
  m.army.spawnMix(1, 1, [P, P, P, P, S, P, P, S], 0);
  const W = m.world;
  const kegs: Keg[] = [], bursts: Burst[] = [];
  const wasUp = new Set<number>();
  for (let tick = 0; tick < T.kegSecs * 60 && !m.result; tick++) {
    m.step();
    m.storm[0] = m.storm[1] = 0;
    const ev = (W as unknown as { events: number[] }).events;
    for (let k = 0; k + 4 < ev.length; k += 5) {
      if (ev[k] === 10) {
        const s = W.minions.list[ev[k + 1]];
        kegs.push({ sapper: s.id, wave: s.wave, team: s.team, tick: m.tick, x: ev[k + 2], z: ev[k + 4] });
      } else if (ev[k] === 1) bursts.push({ tick: m.tick, x: ev[k + 1], z: ev[k + 3], own: 0, foe: 0 });
    }
    ev.length = 0;
    // Who went down in a burst this tick (or the one before: the knock lands in the step).
    for (const n of W.minions.list) {
      if (n.state === MinionState.Upright) {
        wasUp.add(n.id);
        continue;
      }
      if (!wasUp.has(n.id)) continue;
      wasUp.delete(n.id);
      if (n.downCause !== Cause.Burst || n.wave < 0) continue;
      const b = [...bursts].reverse().find((b) => m.tick - b.tick <= 2 && Math.hypot(b.x - n.x, b.z - n.z) < 9);
      if (!b) continue;
      const k = kegs.find((k) => Math.abs(k.x - b.x) < 1 && Math.abs(b.tick - k.tick - KEG.fuse) <= 3);
      if (k && n.team === k.team) b.own++;
      else b.foe++;
    }
  }
  const setBursts = bursts.filter((b) => kegs.some((k) => Math.abs(k.x - b.x) < 1 && Math.abs(b.tick - k.tick - KEG.fuse) <= 3));
  const worstOwn = Math.max(0, ...setBursts.map((b) => b.own));
  let minGap = Infinity, pairs = 0;
  for (let i = 0; i < kegs.length; i++)
    for (let j = i + 1; j < kegs.length; j++) {
      if (kegs[i].wave !== kegs[j].wave) continue;
      pairs++;
      minGap = Math.min(minGap, Math.hypot(kegs[i].x - kegs[j].x, kegs[i].z - kegs[j].z));
    }
  for (const k of kegs) out.detail.push(`keg by sapper ${k.sapper} set ${clock(k.tick)} at (${k.x.toFixed(1)}, ${k.z.toFixed(1)})`);
  for (const b of setBursts) out.detail.push(`burst ${clock(b.tick)} at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}): own men down ${b.own}, enemy men down ${b.foe}`);
  if (!kegs.length) out.flags.push(`keg: no sapper set a keg in ${T.kegSecs} s (the scenario could not judge)`);
  if (worstOwn > T.kegOwn) out.flags.push(`keg: a set keg downed ${worstOwn} men of its own side (limit ${T.kegOwn})`);
  if (pairs && minGap < T.kegApart) out.flags.push(`keg: two kegs of one wave were set ${minGap.toFixed(1)} m apart (need ${T.kegApart} m)`);
  out.measure = `${kegs.length} kegs set; most own men downed by one keg ${worstOwn}; closest two kegs of a wave ${pairs ? minGap.toFixed(1) + " m" : "n/a"}`;
  m.free();
  return out;
};

// ---------------------------------------------------------------------------------------------------------------- musket
/** Does the straight line between two points cross water (a mark he cannot walk to)? */
function waterBetween(m: Match, ax: number, az: number, bx: number, bz: number) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
  for (let k = 1; k < n; k++) {
    const c = navCell(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
    if (c >= 0 && m.world.nav.kind[c] === NavKind.Water) return true;
  }
  return false;
}

export const musket: HuntFn = (T, seed) => {
  const out: HuntResult = { measure: "", flags: [], detail: [] };
  // The enemy (team 0) holds a wave at its marker on the centre road; the player's volley wave (pikes and three musketeers) advances on it.
  const m = newMatch({ seed, barracks: false, garrison: false, masons: false, powder: false, gunnery: false });
  m.army.setOrder(0, Order.Hold);
  m.army.spawnMix(0, 1, PIKES, 0);
  m.army.spawnMix(1, 1, [P, P, P, P, M, P, M, M], 0);
  const anchor = new Map<number, { x: number; z: number; since: number }>();
  let worst = 0, worstId = -1, worstAt = "", shots = 0;
  for (let tick = 0; tick < T.musketSecs * 60 && !m.result; tick++) {
    m.step();
    if (m.tick % 60 !== 0) continue;
    for (const x of m.world.minions.list) {
      if (x.unit !== M || x.team !== 1 || x.state !== MinionState.Upright) continue;
      if (x.action === 9 && x.act === 1) shots++;
      const t = x.target >= 0 ? m.world.minions.list[x.target] : null;
      const cant = !!t && t.state === MinionState.Upright && m.army.order[1] === Order.Advance && waterBetween(m, x.x, x.z, t.x, t.z);
      const a = anchor.get(x.id);
      if (!cant || !a || Math.hypot(x.x - a.x, x.z - a.z) > T.musketMoved) {
        anchor.set(x.id, { x: x.x, z: x.z, since: m.tick });
        continue;
      }
      const run = (m.tick - a.since) / 60;
      if (run > worst) {
        worst = run;
        worstId = x.id;
        worstAt = `(${x.x.toFixed(0)}, ${x.z.toFixed(0)}) shooting at man ${t!.id} (${Math.hypot(t!.x - x.x, t!.z - x.z).toFixed(0)} m, across the stream) at ${clock(m.tick)}`;
      }
    }
  }
  out.detail.push(`musket: longest stand with a mark across water ${worst.toFixed(0)} s (man ${worstId} ${worstAt}); ${shots} shots seen`);
  if (worst > T.musketStill) out.flags.push(`musket: a musketeer on Advance stood ${worst.toFixed(0)} s with a mark he cannot walk to (man ${worstId} ${worstAt}; limit ${T.musketStill} s)`);
  out.measure = `longest stand with an unreachable mark ${worst.toFixed(0)} s`;
  m.free();
  return out;
};

// ---------------------------------------------------------------------------------------------------------------- ladder
const WAITING = [Climb.ToLadder, Climb.Wait];
const walkingOrWaiting = (m: Match, team: number) => m.world.minions.list.filter((n) => n.team === team && n.state === MinionState.Upright && WAITING.includes(n.task) && n.aux >= 0 && n.wave >= 0);

interface LadderRun { name: string; planted: number; sent: number; flags: string[]; detail: string[] }

/** One scripted ladder scenario; the invariants (claims, carrying with no spot) are watched in all of them. */
function ladderRun(T: Record<string, number>, seed: number, name: "merlon" | "leak" | "holdlate" | "holdspot", secs: number): LadderRun {
  const m = newMatch({ seed, masons: true, barracks: false, gunnery: false });
  const A = m.army, L = m.world.ladders!;
  const wave = () => A.spawnMix(1, 1, PIKES, 0, undefined, { ladder: true });
  const run: LadderRun = { name, planted: 0, sent: 0, flags: [], detail: [] };
  wave();
  if (name === "merlon") {
    // One loose stone (the topmost of each spot's support: a merlon or the top course) at every ladder spot of castle 0.
    const sup = (L as unknown as { support: number[][] }).support;
    const lay = m.world.castle.layout;
    let n = 0;
    for (let k = 0; k < L.spots.length; k++) {
      if (L.spots[k].castle !== 0) continue;
      const ids = sup[k];
      const top = ids.reduce((a, b) => (lay.stones[b].course > lay.stones[a].course ? b : a), ids[0]);
      if (m.world.castle.knockLoose(top, 0, 0, -0.5)) n++;
    }
    run.detail.push(`merlon: ${n} loose stones, one at each ladder spot of castle 0`);
  }
  let holdAt = -1, leaked = 0;
  const everPlanted = new Set<number>(), plantedSpots = new Set<number>();
  const mismatch = new Map<number, number>(), noSpot = new Map<number, number>();
  const flagged = new Set<string>();
  let holdNow = -1, holdCount = -1;
  for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
    if (name === "merlon" && tick > 0 && tick % 600 === 0 && tick <= T.ladderWavesUntil * 60) wave();
    if (name === "holdlate" && holdAt < 0 && L.list.length && L.list[0].state === LadderState.Planted && L.list[0].t > 120) holdAt = tick;
    if (name === "holdspot" && holdAt < 0 && L.list.length && L.list[0].spot >= 0) holdAt = tick;
    if (holdAt === tick && holdAt >= 0) A.setOrder(1, Order.Hold);
    // Knock down every man the first moment he walks for the ladder, up to three of them.
    if (name === "leak" && leaked < T.ladderLeak) {
      for (const n of m.world.minions.list) {
        if (n.state !== MinionState.Upright || n.task !== Climb.ToLadder || leaked >= T.ladderLeak) continue;
        m.world.minions.knock({ minion: n.id, vx: 0, vy: 2, vz: 2, px: n.x, py: 1, pz: n.z, extra: 1, cause: 1 }, m.tick);
        leaked++;
      }
    }
    m.step();
    m.storm[0] = m.storm[1] = 0;
    if (holdAt >= 0 && m.tick === holdAt + 1 + T.ladderHoldWait * 60) {
      holdNow = m.tick;
      holdCount = walkingOrWaiting(m, 1).length;
    }
    if (m.tick % 60 !== 0) continue;
    for (const lad of L.list) {
      if (lad.team !== 1) continue;
      if (lad.state === LadderState.Planted) {
        everPlanted.add(lad.id);
        if (lad.spot >= 0) plantedSpots.add(lad.spot);
        const counted = m.world.minions.list.filter((n) => n.state === MinionState.Upright && n.aux === lad.id && WAITING.includes(n.task)).length;
        const bad = lad.claims !== counted;
        mismatch.set(lad.id, bad ? (mismatch.get(lad.id) ?? 0) + 1 : 0);
        const key = `claims${lad.id}`;
        if (mismatch.get(lad.id)! > T.ladderClaimSecs && !flagged.has(key)) {
          flagged.add(key);
          run.flags.push(`ladder ${name}: ladder ${lad.id} claims ${lad.claims} against ${counted} men walking or waiting, for over ${T.ladderClaimSecs} s (at ${clock(m.tick)})`);
        }
      }
      const f = m.world.minions.list[lad.front];
      const near = Math.abs(f.z - WALL(0)) < 34;
      const carryNoSpot = lad.state === LadderState.Carried && lad.spot < 0 && near && f.state === MinionState.Upright;
      noSpot.set(lad.id, carryNoSpot ? (noSpot.get(lad.id) ?? 0) + 1 : 0);
      const key = `nospot${lad.id}`;
      if (noSpot.get(lad.id)! > T.ladderNoSpot && !flagged.has(key)) {
        flagged.add(key);
        run.flags.push(`ladder ${name}: crew of ladder ${lad.id} carried ${T.ladderNoSpot} s within 34 m of the wall with no spot (at ${clock(m.tick)}, front man at (${f.x.toFixed(0)}, ${f.z.toFixed(0)}))`);
      }
    }
  }
  run.sent = L.list.filter((l) => l.team === 1).length;
  run.planted = everPlanted.size;
  run.detail.push(`${name}: ${run.sent} ladders sent, ${run.planted} planted (spots ${[...plantedSpots].join(",") || "none"}); order ${ORDER[A.order[1]]}`);
  if (name === "merlon" && run.planted < 1) run.flags.push(`ladder merlon: no ladder went up in ${secs} s with a loose stone at every spot (${run.sent} sent)`);
  if (name === "holdlate" || name === "holdspot") {
    if (holdAt < 0) run.flags.push(`ladder ${name}: the scenario never reached the moment to give Hold`);
    else {
      run.detail.push(`${name}: Hold given at ${clock(holdAt)}; ${holdCount} men walking to or waiting at a ladder ${T.ladderHoldWait} s later (${clock(holdNow)})`);
      if (holdCount > 0) run.flags.push(`ladder ${name}: ${holdCount} men still walking to or waiting at a ladder ${T.ladderHoldWait} s after Hold`);
    }
  }
  m.free();
  return run;
}

export const ladder: HuntFn = (T, seed) => {
  const out: HuntResult = { measure: "", flags: [], detail: [] };
  const runs: LadderRun[] = [
    ladderRun(T, seed, "merlon", T.ladderMerlonSecs),
    ladderRun(T, seed, "leak", T.ladderSecs),
    ladderRun(T, seed, "holdlate", T.ladderSecs),
    ladderRun(T, seed, "holdspot", T.ladderSecs),
  ];
  for (const r of runs) {
    out.flags.push(...r.flags);
    out.detail.push(...r.detail);
  }
  const sent = runs.reduce((a, r) => a + r.sent, 0), planted = runs.reduce((a, r) => a + r.planted, 0);
  out.measure = `${planted}/${sent} ladders planted over ${runs.length} runs (${pct(planted, sent)}); ` + runs.map((r) => `${r.name} ${r.flags.length ? "FLAG" : "ok"}`).join(", ");
  return out;
};

export type { Minion };
