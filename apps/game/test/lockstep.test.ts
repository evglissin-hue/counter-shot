// Online 1v1 (M5): two pages run the same match in lockstep, each sending its
// own inputs, over a link that delays, drops, repeats and reorders what it
// carries (the room's presence is latest-state, so only the newest arrival
// matters). Both must end bit for bit the same, and neither may flag a desync.

import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT } from "@keepfall/content";
import { Rng } from "@keepfall/core";
import { Match, Team, type MatchInput } from "@keepfall/rules";
import { Order, Spin, type Rapier } from "@keepfall/sim";
import { Lockstep, netHash, type NetState } from "../src/lockstep";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);

const fire = (emplacement: number, yaw: number, pitch: number): MatchInput => ({ kind: "fire", emplacement, yaw, pitch, charge: 1, fuse: 0, spin: Spin.None });

/** What each side does, by its own tick when it does it (it lands a few ticks later, on both sides). */
const SCRIPT: Array<[number, Team, MatchInput]> = [
  [0, Team.Player, { kind: "man", emplacement: 0 }],
  [5, Team.Enemy, { kind: "man", emplacement: 8 }],
  // (Wide of the enemy's long gun, which stands straight ahead on its gate wall: after M5 a ball through it knocks it out.)
  [100, Team.Player, fire(0, 0.05, 0.03)],
  [140, Team.Enemy, fire(8, Math.PI - 0.05, 0.03)],
  [200, Team.Player, { kind: "build", plot: 1, building: "mill" }],
  [260, Team.Enemy, { kind: "route", route: "left" }],
  [380, Team.Player, fire(0, 0.06, 0.028)],
  [430, Team.Enemy, { kind: "order", order: Order.Hold }],
  [500, Team.Enemy, { kind: "aim", emplacement: 8, yaw: Math.PI + 0.01, pitch: 0.05 }],
  [520, Team.Enemy, fire(8, Math.PI + 0.01, 0.05)],
  [700, Team.Player, { kind: "repair", repair: "towers", on: false }],
];

interface Side {
  m: Match;
  ls: Lockstep;
  script: Array<[number, MatchInput]>;
}

test("two pages in lockstep over a lossy link end bit for bit the same", () => {
  const sides: Side[] = [Team.Player, Team.Enemy].map((team) => {
    const m = new Match(R, layout, { seed: 5, plan: false, rotate: false });
    return { m, ls: new Lockstep(m, team, team === Team.Player ? Team.Enemy : Team.Player, 6), script: SCRIPT.filter(([, t]) => t === team).map(([k, , i]) => [k, i] as [number, MatchInput]) };
  });
  const rng = new Rng(77);
  // In flight: [arrives at, to side, state]. The link delays 1 to 12 steps, drops a fifth, repeats some, and can reorder.
  let wire: Array<[number, number, NetState]> = [];
  const END = 900;
  let clock = 0, stalls = 0;
  while ((sides[0].m.tick < END || sides[1].m.tick < END) && clock < END * 4) {
    clock++;
    for (let k = 0; k < 2; k++) {
      const s = sides[k];
      // This side's inputs, when its own clock reaches them.
      while (s.script.length && s.script[0][0] <= s.m.tick) s.ls.local(s.script.shift()![1]);
      // One side runs a little faster than the other, as two laptops do.
      const tries = k === 0 ? 1 : clock % 7 === 0 ? 2 : 1;
      for (let t = 0; t < tries && s.m.tick < END; t++) {
        if (!s.ls.canStep()) {
          stalls++;
          break;
        }
        s.m.step();
        s.ls.afterStep(() => netHash(s.m));
      }
      // Send the latest state now and then (presence coalesces), over the link.
      if (rng.next() < 0.6) {
        const copy = JSON.parse(JSON.stringify(s.ls.state())) as NetState;
        if (rng.next() > 0.2) wire.push([clock + 1 + Math.floor(rng.next() * 12), 1 - k, copy]);
        if (rng.next() < 0.1) wire.push([clock + 2 + Math.floor(rng.next() * 20), 1 - k, copy]);
      }
    }
    const now = wire.filter((w) => w[0] <= clock);
    wire = wire.filter((w) => w[0] > clock);
    for (const [, to, st] of now) assert.ok(sides[to].ls.remote(st, clock), "no input arrived for a tick already played");
  }
  const [a, b] = sides;
  assert.equal(a.m.tick, END);
  assert.equal(b.m.tick, END);
  assert.equal(a.ls.desync, null, "the host saw no desync");
  assert.equal(b.ls.desync, null, "the guest saw no desync");
  assert.deepEqual(a.m.hash(), b.m.hash(), "both pages hold the same match");
  // The inputs took effect on both sides: shots by each team, the mill bought, the guest's route and hold.
  assert.equal(a.m.shots[Team.Player], 2);
  assert.equal(a.m.shots[Team.Enemy], 2);
  assert.ok(a.m.spent[Team.Player] >= 160, "the host built a mill");
  assert.equal(a.m.route[Team.Enemy], "left");
  assert.equal(a.m.army.order[Team.Enemy], Order.Hold);
  assert.equal(a.m.repairs[Team.Player].towers, false);
  assert.ok(stalls > 0, "the faster side had to wait for the slower one at times");
  for (const s of sides) s.m.free();
});
