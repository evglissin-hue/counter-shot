// Fighting hunt: targets (do the men of a wave pile onto one enemy?).
import { MID_Z, mirrorZ, routeAt } from "@keepfall/content";
import { MinionState } from "@keepfall/sim";
import { marcher, newMatch, type HuntFn, type HuntResult } from "./common";

const PIKES = [0, 0, 0, 0, 0, 0, 0, 0];
const roadX = (z: number) => routeAt("centre", z - MID_Z)[0];

export const targets: HuntFn = (T, seed) => {
  const out: HuntResult = { measure: "", flags: [], detail: [] };
  const means: string[] = [];
  // Same road, 8 v 8, meeting in the field on the defender's half (the attacker crosses first); once with each side attacking.
  for (const atk of [1, 0] as const) {
    const def = (1 - atk) as 0 | 1;
    const m = newMatch({ seed, barracks: false, garrison: false, masons: false, powder: false, gunnery: false });
    const outz = (c: number, d: number) => mirrorZ(c, -d);
    m.army.spawnMix(atk, 1, PIKES, 0, { x: roadX(outz(def, 62)), z: outz(def, 62) });
    m.army.spawnMix(def, 1, PIKES, 0, { x: roadX(outz(def, 28)), z: outz(def, 28) });
    /** Per team: the distinct targets counted each second a man of it has enough enemies within reach. */
    const sum = [0, 0], n = [0, 0];
    for (let tick = 0; tick < T.targetsSecs * 60 && !m.result; tick++) {
      m.step();
      if (m.tick % 60 !== 0) continue;
      const men = m.world.minions.list.filter(marcher);
      for (const team of [0, 1]) {
        const mine = men.filter((x) => x.team === team), foes = men.filter((x) => x.team !== team);
        if (!mine.length || !foes.length) continue;
        const cx = mine.reduce((a, x) => a + x.x, 0) / mine.length, cz = mine.reduce((a, x) => a + x.z, 0) / mine.length;
        const near = foes.filter((x) => Math.hypot(x.x - cx, x.z - cz) < T.targetsNear).length;
        if (near < T.targetsFoes) continue;
        const tg = new Set(mine.filter((x) => x.target >= 0 && m.world.minions.list[x.target].state === MinionState.Upright).map((x) => x.target));
        sum[team] += tg.size;
        n[team]++;
      }
    }
    for (const team of [atk, def]) {
      const mean = n[team] ? sum[team] / n[team] : NaN;
      out.detail.push(`targets (t${atk} attacks): team ${team} averaged ${Number.isNaN(mean) ? "n/a" : mean.toFixed(2)} distinct targets over ${n[team]} s with ${T.targetsFoes}+ enemies within ${T.targetsNear} m`);
      means.push(`t${team}${team === atk ? "(atk)" : "(def)"} ${Number.isNaN(mean) ? "n/a" : mean.toFixed(1)}`);
      if (n[team] === 0) out.flags.push(`targets (t${atk} attacks): team ${team} never had ${T.targetsFoes}+ enemies within ${T.targetsNear} m (the scenario did not meet)`);
      else if (mean < T.targetsMean) out.flags.push(`targets (t${atk} attacks): team ${team} averaged ${mean.toFixed(2)} distinct targets while ${T.targetsFoes}+ enemies were within ${T.targetsNear} m (need ${T.targetsMean})`);
    }
    m.free();
  }
  out.measure = `mean distinct targets ${means.join(" ")}`;
  return out;
};
