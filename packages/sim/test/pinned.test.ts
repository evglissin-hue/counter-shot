// A marching man whose way points straight at a cell he cannot step to (no sideways part, so "sliding" along the other axis
// moves him nowhere) is not pinned there: he steps towards a cheaper cell instead (the crater rim outside castle 0's gate).
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, MATCH_EMPLACEMENTS } from "@keepfall/content";
import { Action, FLOW_INF, NAV_GRID, routeField, SandboxSim, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);

test("a marching man pointed straight at a refused cell steps on towards a cheaper one; a man with no field stays", () => {
  const sim = new SandboxSim(R, layout, { seed: 7, minions: 0, army: true, powder: false, emplacements: MATCH_EMPLACEMENTS });
  const army = sim.army!;
  const f = routeField(1, 1);
  const G = NAV_GRID, D = army.flow.dist[f];
  const stride = 1.6 / 60;
  let spot: { x: number; z: number; ux: number; uz: number } | null = null;
  for (let j = 40; j < G.nz - 40 && !spot; j++) {
    for (let i = 40; i < G.nx - 40 && !spot; i++) {
      const c = j * G.nx + i;
      if (D[c] >= FLOW_INF) continue;
      for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = G.x0 + (i + 0.5) * G.cell + ux * 0.499 * G.cell, z = G.z0 + (j + 0.5) * G.cell + uz * 0.499 * G.cell;
        if (army.canStep(c, x + ux * stride, z + uz * stride)) continue;
        // A way on: some neighbour he can step to that is cheaper.
        let way = false;
        for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          if (D[(j + dj) * G.nx + i + di] < D[c] && army.canStep(c, G.x0 + (i + di + 0.5) * G.cell, G.z0 + (j + dj + 0.5) * G.cell)) way = true;
        }
        if (way) {
          spot = { x, z, ux, uz };
          break;
        }
      }
    }
  }
  assert.ok(spot, "found a cell edge facing a refused cell, with a way on");
  army.spawnWave(1, 1, 1, { x: spot.x, z: spot.z });
  const m = sim.minions.list[sim.minions.list.length - 1];
  m.x = spot.x;
  m.z = spot.z;
  army.move(m, spot.ux, spot.uz, 1.6, NaN, Action.Walk);
  assert.equal(Math.hypot(m.x - spot.x, m.z - spot.z), 0, "no field: he stays");
  army.move(m, spot.ux, spot.uz, 1.6, NaN, Action.Walk, f);
  const moved = Math.hypot(m.x - spot.x, m.z - spot.z);
  assert.ok(moved > stride * 0.9, `with a field he steps on (${moved.toFixed(4)} m of ${stride.toFixed(4)})`);
  sim.free();
});
