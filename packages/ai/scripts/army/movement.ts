// Movement hunts: sealed (a courtyard whose gateway is blocked) and stuck (a man dropped into a step he cannot take).
import { BRIDGES, DECK_TOP, inCourtyard, MATCH_EMPLACEMENTS, MUSTER } from "@keepfall/content";
import { Action, FLOW_INF, MinionState, Order, Role, routeField, SandboxSim, type Minion } from "@keepfall/sim";
import { clock, costOf, layout, marcher, newMatch, R, type HuntFn, type HuntResult } from "./common";

const PIKES = [0, 0, 0, 0, 0, 0, 0, 0];

/** Nothing to fight and not busy with a specialist's task: the men these hunts judge for standing about. */
export const idleNow = (m: { world: { specialists?: { busy(x: Minion): boolean } | null } }, x: Minion) =>
  x.state === MinionState.Upright && (x.action === Action.Walk || x.action === Action.Stand) && x.target < 0 && x.role === Role.March && !(x.task >= 10 && x.task <= 14) && !m.world.specialists?.busy(x);

// ---------------------------------------------------------------------------------------------------------------- sealed
export const sealed: HuntFn = (T, seed) => {
  const out: HuntResult = { measure: "", flags: [], detail: [] };
  const m = newMatch({ seed, barracks: false, garrison: false, masons: false, powder: false, gunnery: false });
  // Castle 0's gateway is blocked: its gate leaves come loose but stay upright in place.
  const leaves = m.world.castle.layout.stones.filter((s) => s.castle === 0 && s.part === "gate");
  for (const s of leaves) m.world.castle.knockLoose(s.id, 0, 0, 0);
  m.army.spawnMix(1, 1, PIKES, 0);
  m.army.spawnMix(1, 1, PIKES, 5.5);
  const infSince = new Map<number, number>();
  let worst = 0, worstId = -1, worstAt = "";
  const front = (x: Minion) => Math.hypot(x.x - MUSTER[0].x, x.z - MUSTER[0].z) < T.sealedFront;
  let atFront = 0, everInf = 0;
  for (let tick = 0; tick < T.sealedSecs * 60 && !m.result; tick++) {
    m.step();
    if (m.tick % 60 !== 0) continue;
    atFront = 0;
    for (const x of m.world.minions.list) {
      if (!marcher(x) || x.team !== 1) continue;
      if (front(x)) atFront++;
      const inf = costOf(m, x) >= FLOW_INF;
      if (inf) everInf++;
      if (!inf || !idleNow(m, x) || inCourtyard(0, x.x, x.z)) {
        infSince.delete(x.id);
        continue;
      }
      if (!infSince.has(x.id)) infSince.set(x.id, m.tick);
      const run = (m.tick - infSince.get(x.id)!) / 60;
      if (run > worst) {
        worst = run;
        worstId = x.id;
        worstAt = `(${x.x.toFixed(0)}, ${x.z.toFixed(0)}) at ${clock(m.tick)}`;
      }
    }
  }
  const up = m.world.minions.list.filter((x) => marcher(x) && x.team === 1);
  const at = up.filter(front).length;
  out.detail.push(`sealed: ${everInf} man-seconds on FLOW_INF cells; longest idle run ${worst.toFixed(0)} s (man ${worstId} ${worstAt}); ${at}/${up.length} attackers within ${T.sealedFront} m of the gate at the end`);
  if (worst > T.sealedStill) out.flags.push(`sealed: a marching man with nothing to fight stood ${worst.toFixed(0)} s on a FLOW_INF cell (man ${worstId} ${worstAt}; limit ${T.sealedStill} s)`);
  if (!up.length || at / up.length < T.sealedReach) out.flags.push(`sealed: only ${at} of ${up.length} attackers reached the gate front (within ${T.sealedFront} m) in ${T.sealedSecs} s`);
  out.measure = `longest idle run on FLOW_INF ${worst.toFixed(0)} s; ${at}/${up.length} at the gate front`;
  m.free();
  return out;
};

// ---------------------------------------------------------------------------------------------------------------- stuck
/** The centre deck's middle drops out under a wave (pieces knocked loose, no blast to knock the men down), with four men on it. A second wave follows 6 s behind. */
export const stuck: HuntFn = (T, seed) => {
  const out: HuntResult = { measure: "", flags: [], detail: [] };
  const w = new SandboxSim(R, layout, { seed, minions: 0, army: true, powder: false, emplacements: MATCH_EMPLACEMENTS });
  const army = w.army!;
  const b = BRIDGES[1];
  const lb = w.castle.layout.bridges[1];
  const zs = b.z - b.length / 2, ze = b.z + b.length / 2;
  army.spawnMix(1, 1, PIKES, 0);
  let dropAt = -1, dropped = 0;
  /** Per man: positions each second for the last STILL seconds, and whether every second was idle. */
  const ring = new Map<number, Array<[number, number]>>();
  const still = new Map<number, number>();
  let worst = 0, worstId = -1, worstAt = "";
  const names = new Map<number, number>();
  for (let tick = 0; tick < T.stuckSecs * 60; tick++) {
    if (tick === 6 * 60) army.spawnMix(1, 1, PIKES, 0); // a second wave, 6 s behind
    if (dropAt < 0) {
      const team = w.minions.list.filter((x) => marcher(x) && x.team === 1);
      const onDeck = team.filter((x) => x.z > zs && x.z < ze && Math.abs(x.x - b.x) < 2.5).length;
      if (onDeck >= 4) {
        dropAt = tick;
        for (let id = lb.first; id < lb.first + lb.count; id++) {
          const s = w.castle.layout.stones[id];
          if (Math.abs(s.z - b.z) < 4.5 && w.castle.knockLoose(id, 0, -0.5, 0)) dropped++;
        }
      }
    }
    w.step();
    if (dropAt < 0 || w.tick % 60 !== 0) continue;
    for (const x of w.minions.list) {
      if (!marcher(x) || x.team !== 1) continue;
      const calm = x.target < 0 && (x.action === Action.Walk || x.action === Action.Stand) && !(x.task >= 10 && x.task <= 14) && !w.specialists?.busy(x);
      const atGoal = inCourtyard(0, x.x, x.z) || Math.hypot(x.x - MUSTER[0].x, x.z - MUSTER[0].z) < 14;
      let r = ring.get(x.id);
      if (!r) ring.set(x.id, (r = []));
      if (!calm || atGoal) {
        r.length = 0;
        still.delete(x.id);
        continue;
      }
      r.push([x.x, x.z]);
      if (r.length > T.stuckStill + 1) r.shift();
      if (r.length === T.stuckStill + 1 && Math.hypot(x.x - r[0][0], x.z - r[0][1]) < T.stuckMetres) {
        const n = (still.get(x.id) ?? 0) + 1;
        still.set(x.id, n);
        names.set(x.id, 1);
        if (n > worst) {
          worst = n;
          worstId = x.id;
          worstAt = `(${x.x.toFixed(1)}, ${x.z.toFixed(1)}) ${((w.tick - dropAt) / 60).toFixed(0)} s after the drop`;
        }
      } else still.delete(x.id);
    }
  }
  const open = w.bridgesOpen()[1];
  const bad = names.size;
  const stuckFor = (worst + T.stuckStill) | 0;
  out.detail.push(`stuck: dropped ${dropped} pieces at ${dropAt >= 0 ? (dropAt / 60).toFixed(0) + " s" : "never"}; ${bad} men had a ${T.stuckStill} s window under ${T.stuckMetres} m; worst stood ${stuckFor} s (man ${worstId} ${worstAt}); centre bridge open at the end: ${open}`);
  if (dropAt < 0) out.flags.push("stuck: the scenario never got four men on the deck (nothing was dropped)");
  if (bad > 0) out.flags.push(`stuck: ${bad} upright soldiers with nothing to fight made under ${T.stuckMetres} m in ${T.stuckStill} s after the deck dropped (worst stood about ${stuckFor} s: man ${worstId} ${worstAt})`);
  if (open) out.flags.push("stuck: the dropped bridge is open again at the end (the scenario did not hold its setup)");
  out.measure = `${bad} men stuck (under ${T.stuckMetres} m in ${T.stuckStill} s), worst about ${stuckFor} s; bridge ${open ? "UP again" : "stays down"}`;
  w.free();
  return out;
};
void routeField;
