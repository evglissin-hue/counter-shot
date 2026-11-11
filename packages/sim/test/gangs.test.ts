import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, DECK_TOP, GAME_LAYOUT, MATCH_EMPLACEMENTS, REGISTER, Unit } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, GangState, MinionState, Role, SandboxSim, type Minion, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const CENTRE = 1;
const BR = layout.bridges.findIndex((b) => b.site.name === "centre");
const site = layout.bridges[BR].site;
const nearZ = (team: number) => (team === 1 ? site.z - site.length / 2 - 3 : site.z + site.length / 2 + 3);
const world = (seed = 7) => new SandboxSim(R, layout, { seed, minions: 0, army: true, emplacements: MATCH_EMPLACEMENTS });
const pieces = () => Array.from({ length: layout.bridges[BR].count }, (_, k) => layout.bridges[BR].first + k);
const downCount = (sim: SandboxSim) => pieces().filter((id) => sim.castle.dynamic[id]).length;
const gangMen = (sim: SandboxSim) => sim.minions.list.filter((m) => m.role === Role.Gang && m.state === MinionState.Upright);

/** A purse that counts what it is charged. */
function purse(gold: number) {
  const p = { gold, charges: [] as number[] };
  return {
    p,
    policy: {
      pay: (_t: number, c: number) => {
        if (p.gold < c) return false;
        p.gold -= c;
        p.charges.push(c);
        return true;
      },
    },
  };
}

function blow(sim: SandboxSim) {
  sim.explode(site.x + 0.3, DECK_TOP - 0.4, site.z + 0.5);
  for (let i = 0; i < 4 * 60; i++) sim.step();
  assert.equal(sim.bridgesOpen()[BR], false, "the centre bridge is down");
}

const wave = (sim: SandboxSim, team: 0 | 1, n = 8, dz = 30) => sim.army!.spawnMix(team, CENTRE, new Array<number>(n).fill(0), 0, { x: site.x, z: team === 1 ? site.z - dz : site.z + dz });

function events(sim: SandboxSim, kind: EventKind, tally: { n: number }) {
  const f = sim.collect();
  for (let k = 0; k < f.eventCount; k++) if (f.events[k * EVENT_STRIDE] === kind) tally.n++;
}

test("a wave sent down a road with its bridge down leaves a gang that relays the deck, paid once", () => {
  const sim = world();
  const { p, policy } = purse(1000);
  sim.gangs!.policy = policy;
  blow(sim);
  const before = downCount(sim);
  assert.ok(before > 5, `${before} bridge pieces down`);
  wave(sim, 1);
  const men = gangMen(sim);
  assert.equal(men.length, REGISTER.gangMen, "two men leave the wave");
  assert.ok(men.every((m) => m.unit === Unit.Pikeman));
  assert.equal(sim.gangs!.status().length, 1);
  assert.equal(sim.gangs!.status()[0].state, GangState.Walking);
  const started = { n: 0 }, relaid = { n: 0 };
  let workStart = -1, open = -1;
  for (let t = 0; t < 120 * 60 && open < 0; t++) {
    sim.step();
    const f = sim.collect();
    for (let k = 0; k < f.eventCount; k++) {
      if (f.events[k * EVENT_STRIDE] === EventKind.GangStart) started.n++;
      if (f.events[k * EVENT_STRIDE] === EventKind.Relaid) relaid.n++;
    }
    const st = sim.gangs!.status();
    if (workStart < 0 && st.length && st[0].state === GangState.Working) workStart = t;
    if (!st.length && downCount(sim) === 0) open = t;
  }
  assert.ok(open > 0, "the gang finished");
  assert.deepEqual(p.charges, [REGISTER.gangCost], "charged once");
  assert.equal(started.n, 1, "a start event");
  assert.equal(relaid.n, 1, "a relaid event");
  assert.ok(workStart > 0 && open - workStart <= REGISTER.gangTicks + 120, `work took ${open - workStart} ticks`);
  assert.ok(open - workStart >= REGISTER.gangTicks * 0.8, "at an even pace, not at once");
  for (let i = 0; i < 4 * 60; i++) sim.step();
  assert.equal(sim.bridgesOpen()[BR], true, "the nav grid sees the deck");
  assert.equal(sim.army!.bridgeOpen[CENTRE], true);
  assert.equal(gangMen(sim).length, 0, "the men are ordinary men of their wave again");
  sim.free();
});

test("men of both teams cross the relaid bridge", () => {
  const sim = world();
  sim.gangs!.policy = purse(1000).policy;
  blow(sim);
  wave(sim, 1, 3);
  for (let t = 0; t < 120 * 60 && downCount(sim) > 0; t++) sim.step();
  for (let i = 0; i < 3 * 60; i++) sim.step();
  assert.equal(sim.army!.bridgeOpen[CENTRE], true);
  wave(sim, 1, 4, 14);
  const south = sim.minions.list.filter((m) => m.team === 1 && m.state === MinionState.Upright && m.z > site.z - 20 && m.z < site.z);
  for (let i = 0; i < 40 * 60; i++) sim.step();
  assert.ok(south.some((m: Minion) => m.state === MinionState.Upright && m.z > site.z + 3), "team 1 men crossed");
  wave(sim, 0, 4, 14);
  const north = sim.minions.list.filter((m) => m.team === 0 && m.state === MinionState.Upright && m.z > site.z);
  for (let i = 0; i < 40 * 60; i++) sim.step();
  assert.ok(north.some((m: Minion) => m.state === MinionState.Upright && m.z < site.z - 3), "team 0 men crossed");
  sim.free();
});

test("an enemy near the bridge's near end holds the work, and it resumes when he is gone", () => {
  const sim = world();
  const { p, policy } = purse(1000);
  sim.gangs!.policy = policy;
  blow(sim);
  // A man who cannot move stands 15 m from the near end.
  const w = sim.army!.newWave(0, CENTRE, true);
  const foe = sim.army!.spawnAt(0, w, Unit.Pikeman, site.x + 15, nearZ(1), 0);
  foe.speed = 0;
  wave(sim, 1);
  for (let t = 0; t < 70 * 60; t++) sim.step();
  const st = sim.gangs!.status()[0];
  assert.equal(st.state, GangState.Waiting, "waits at the bridge");
  assert.equal(st.progress, 0);
  assert.deepEqual(p.charges, [], "nothing paid while held");
  sim.minions.knock({ minion: foe.id, vx: 0, vy: 1, vz: 0, px: foe.x, py: foe.y + 1, pz: foe.z, extra: 0 }, sim.tick);
  for (let t = 0; t < 2 * 60; t++) sim.step();
  assert.equal(sim.gangs!.status()[0].state, GangState.Working);
  assert.deepEqual(p.charges, [REGISTER.gangCost]);
  sim.free();
});

test("a gang that cannot pay waits, and starts when it can", () => {
  const sim = world();
  const { p, policy } = purse(0);
  sim.gangs!.policy = policy;
  blow(sim);
  wave(sim, 1);
  for (let t = 0; t < 60 * 60; t++) sim.step();
  assert.equal(sim.gangs!.status()[0].state, GangState.Waiting);
  p.gold = 500;
  for (let t = 0; t < 60; t++) sim.step();
  assert.equal(sim.gangs!.status()[0].state, GangState.Working);
  sim.free();
});

test("a piece of the bridge lying in another's place is carried off, and the deck still comes back", () => {
  const sim = world();
  sim.gangs!.policy = purse(1000).policy;
  blow(sim);
  const planks = pieces().filter((id) => layout.stones[id].deck && sim.castle.dynamic[id]);
  assert.ok(planks.length >= 2, "planks are down");
  // The first plank lies in the place of the next.
  const a = planks[0], b = planks[1];
  const s = layout.stones[b];
  sim.castle.bodies[a].setTranslation({ x: s.x, y: s.y, z: s.z }, true);
  sim.step();
  wave(sim, 1);
  const cleared = { n: 0 };
  for (let t = 0; t < 140 * 60 && downCount(sim) > 0; t++) {
    sim.step();
    if (t % 4 === 3) events(sim, EventKind.Cleared, cleared);
  }
  assert.equal(downCount(sim), 0, "every piece stands");
  assert.ok(cleared.n >= 1, "the plank in another's place was carried off");
  for (let i = 0; i < 4 * 60; i++) sim.step();
  assert.equal(sim.bridgesOpen()[BR], true);
  sim.free();
});

test("no gang when the bridge stands, and never two gangs on one bridge", () => {
  const sim = world();
  wave(sim, 1);
  assert.equal(gangMen(sim).length, 0, "a standing bridge needs no gang");
  sim.free();
  const sim2 = world();
  sim2.gangs!.policy = purse(1000).policy;
  blow(sim2);
  wave(sim2, 1);
  wave(sim2, 0);
  wave(sim2, 1);
  assert.equal(sim2.gangs!.status().length, 1);
  assert.equal(gangMen(sim2).length, REGISTER.gangMen);
  sim2.free();
});

test("a gang man who falls is not replaced; with none left the gang ends and a later wave starts a new one", () => {
  const sim = world();
  sim.gangs!.policy = purse(1000).policy;
  blow(sim);
  wave(sim, 1);
  const fell = () => {
    const m = gangMen(sim)[0];
    sim.minions.knock({ minion: m.id, vx: 0, vy: 1, vz: 0, px: m.x, py: m.y + 1, pz: m.z, extra: 0 }, sim.tick);
  };
  fell();
  sim.step();
  assert.equal(sim.gangs!.status()[0].men, 1, "one man left, no replacement");
  fell();
  sim.step();
  assert.equal(sim.gangs!.status().length, 0, "the gang ended");
  assert.ok(downCount(sim) > 0);
  wave(sim, 1);
  assert.equal(sim.gangs!.status().length, 1, "a later wave starts a new gang");
  sim.free();
});

test("the same seed and inputs give the same hash twice", () => {
  const run = () => {
    const sim = world(11);
    sim.gangs!.policy = purse(1000).policy;
    blow(sim);
    wave(sim, 1);
    for (let t = 0; t < 70 * 60; t++) sim.step();
    const h = sim.hash();
    sim.free();
    return h;
  };
  assert.deepEqual(run(), run());
});

test("an enemy holding the far bank inside the clearance radius does not hold the gang", () => {
  const sim = world();
  const { p, policy } = purse(1000);
  sim.gangs!.policy = policy;
  blow(sim);
  const checkZ = site.z - site.length / 2 - 3;
  const farZ = checkZ + REGISTER.gangClear - 1;
  assert.ok(farZ > site.z, `the far man (z ${farZ}) is across the gap (centre ${site.z})`);
  const w = sim.army!.newWave(0, CENTRE, true);
  const foe = sim.army!.spawnAt(0, w, Unit.Pikeman, site.x, farZ, 0);
  foe.speed = 0;
  wave(sim, 1);
  for (let t = 0; t < 70 * 60; t++) sim.step();
  assert.deepEqual(p.charges, [REGISTER.gangCost], "paid and working despite the man on the far bank");
  sim.free();
});
