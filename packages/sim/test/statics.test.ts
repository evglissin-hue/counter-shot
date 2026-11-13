// 3.4 The keep falls by engineering: keeps and towers crush and topple by load.
// Cuts are made through the castle's own hooks (dust a piece, restore it), then the
// world steps: what the statics pass does is read back from the events and the status.
import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, STRUCTURE, structureList } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, SandboxSim, StaticState, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const L = structureList(layout);
const KEEP = 0;
const TOWER = 1;

const world = () => new SandboxSim(R, layout, { seed: 7, minions: 0 });

type Ev = number[];
/** The events since the last look, as [kind, a, b, c, d]. */
const events = (sim: SandboxSim): Ev[] => {
  const f = sim.collect();
  const out: Ev[] = [];
  for (let i = 0; i < f.eventCount; i++) out.push(Array.from(f.events.slice(i * EVENT_STRIDE, (i + 1) * EVENT_STRIDE)));
  return out;
};
const STATIC_KINDS: number[] = [EventKind.Strain, EventKind.Saved, EventKind.Topple, EventKind.Crush, EventKind.Released];

/** Step n ticks, collecting the statics events with the tick they came at. */
function run(sim: SandboxSim, n: number, each?: (sim: SandboxSim, t: number) => void): Array<{ t: number; e: Ev }> {
  const log: Array<{ t: number; e: Ev }> = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    for (const e of events(sim)) if (STATIC_KINDS.includes(e[0])) log.push({ t: i + 1, e });
    each?.(sim, i + 1);
  }
  return log;
}
const kinds = (log: Array<{ t: number; e: Ev }>) => log.map((l) => l.e[0]);

const rel = (si: number, id: number) => {
  const s = layout.stones[id];
  return { x: s.x - L[si].cx, z: s.z - L[si].cz, c: s.course, part: s.part };
};

/** Dust pieces and run the support check, as a volley would. */
function cut(sim: SandboxSim, ids: number[]) {
  for (const id of ids) if (!sim.castle.dynamic[id]) sim.castle.dust(id);
  sim.castle.supportNow();
}

/** The keep's face on the -z side (every course in [c0, c1]) and the share `side` of each side face nearest it. */
function faceCut(c0: number, c1: number, side: number, si = KEEP): number[] {
  return L[si].stones.filter((id) => {
    const p = rel(si, id);
    if (p.part !== "keep" || p.c < c0 || p.c > c1) return false;
    return p.z < -3 || (Math.abs(p.x) > 3 && p.z < -5 + 10 * side);
  });
}

/**
 * Evenly `share` of every face's pieces of a course, the four corner pieces left. (A course holds until less than 38% of it stands, so
 * a crush needs well over 62% of its area gone: with the corners left that is about 80% of the rest.)
 */
function evenCut(c: number, share: number, si = KEEP): number[] {
  const faces = new Map<string, Array<{ id: number; pos: number }>>();
  for (const id of L[si].stones) {
    const p = rel(si, id);
    if (p.part !== "keep" || p.c !== c) continue;
    if (Math.abs(p.x) > 4 && Math.abs(p.z) > 3) continue; // a corner
    const key = Math.abs(p.z) > 3 ? (p.z < 0 ? "n" : "s") : p.x < 0 ? "w" : "e";
    const list = faces.get(key) ?? faces.set(key, []).get(key)!;
    list.push({ id, pos: key === "n" || key === "s" ? p.x : p.z });
  }
  const out: number[] = [];
  for (const key of [...faces.keys()].sort()) {
    const list = faces.get(key)!.sort((a, b) => a.pos - b.pos);
    list.forEach((e, k) => {
      if (Math.floor((k + 1) * share + 0.5) > Math.floor(k * share + 0.5)) out.push(e.id);
    });
  }
  return out;
}

/** The buttress of castle 0's keep whose piers stand against the -z face. */
function buttressOnCutFace(): number[] {
  for (const b of layout.buttresses) {
    if (b.castle !== 0) continue;
    const ids: number[] = [];
    for (let id = b.first; id < b.first + b.count; id++) ids.push(id);
    if (rel(KEEP, ids[0]).z < -5) return ids;
  }
  throw new Error("no buttress on the -z face");
}

function allButtresses(si = KEEP): number[] {
  return L[si].stones.filter((id) => layout.stones[id].part === "buttress");
}

const raise = (sim: SandboxSim, ids: number[]) => {
  for (const id of ids) assert.ok(sim.castle.restore(id));
};

const angleTo = (dx: number, dz: number, tx: number, tz: number) => (Math.acos((dx * tx + dz * tz) / (Math.hypot(dx, dz) * Math.hypot(tx, tz))) * 180) / Math.PI;

test("the structures are the five of each castle, every piece belongs to one", () => {
  const sim = world();
  const st = sim.statics!;
  assert.equal(st.list.length, 10);
  for (const d of st.list) for (const id of d.stones) assert.equal(st.structureOf(id), d.index);
  assert.equal(st.structureOf(0), -1);
  for (let i = 0; i < 10; i++) assert.equal(st.status(i).state, StaticState.Standing);
  sim.free();
});

test("a keep cut along one face and the third of each side nearest it topples towards the cut", () => {
  const sim = world();
  const st = sim.statics!;
  cut(sim, faceCut(2, 4, 1 / 3));
  const log = run(sim, 900);
  console.log("  keep topple:", log.map((l) => `${l.t}:${l.e.slice(0, 4).join(",")}`).join(" "), "banner down", sim.castle.toppled[0]);
  assert.deepEqual(kinds(log), [EventKind.Strain, EventKind.Topple, EventKind.Released]);
  const strain = log[0], topple = log[1], released = log[2];
  assert.equal(strain.e[1], KEEP);
  assert.equal(strain.e[3], 2, "a topple, not a crush");
  assert.equal(topple.t - strain.t, STRUCTURE.hold, "half a second of groaning");
  assert.ok(angleTo(topple.e[3], topple.e[4], 0, -1) < 30, `falls towards the cut face: ${topple.e[3]}, ${topple.e[4]}`);
  assert.ok(released.t > topple.t);
  assert.ok(released.e[2] > 900, "the whole part above is let go");
  assert.ok(released.e[3] <= STRUCTURE.bodies + 18, `bodies ${released.e[3]}`);
  assert.equal(st.status(KEEP).state, StaticState.Fallen);
  assert.ok(sim.castle.toppled[0], "the banner is down");
  assert.ok(!sim.castle.toppled[1], "the other castle stands");
  sim.free();
});

test("the master's numbers: the face and a third of each side topples, the face alone holds", () => {
  const sim = world();
  const st = sim.statics!;
  cut(sim, faceCut(2, 4, 1 / 3));
  run(sim, 1);
  const s = st.status(KEEP);
  console.log("  face + thirds: weakest", s.weakest, "r", st.ratio(KEEP, 2).toFixed(3), "drawIn", s.drawIn.toFixed(2), "margin", s.margin.toFixed(2), "com z", (s.comZ - L[KEEP].cz).toFixed(2), "holds", s.holds.toFixed(2));
  assert.equal(s.weakest, 2);
  assert.ok(s.margin < 0 && s.toppleNear >= 1);
  assert.ok(Math.abs(st.ratio(KEEP, 2) - 1.63) < 0.15);
  assert.ok(Math.abs(s.drawIn - 1.93) < 0.15);
  sim.free();

  const face = world();
  const fs = face.statics!;
  cut(face, faceCut(2, 4, 0));
  const log = run(face, 600);
  const t = fs.status(KEEP);
  console.log("  face alone: weakest", t.weakest, "r", fs.ratio(KEEP, 2).toFixed(3), "drawIn", t.drawIn.toFixed(2), "margin", t.margin.toFixed(2), "com z", (t.comZ - L[KEEP].cz).toFixed(2), "holds", t.holds.toFixed(2));
  assert.deepEqual(kinds(log), [], "no strain");
  assert.equal(t.state, StaticState.Standing);
  assert.ok(t.margin > 0 && t.holds > 0 && t.holds < 1);
  face.free();
});

test("a keep cut evenly all round crushes", () => {
  const sim = world();
  cut(sim, evenCut(2, 0.8));
  const log = run(sim, 600);
  console.log("  keep crush:", log.map((l) => `${l.t}:${l.e.slice(0, 4).join(",")}`).join(" "));
  assert.deepEqual(kinds(log), [EventKind.Strain, EventKind.Crush, EventKind.Released]);
  assert.equal(log[0].e[3], 1, "a crush");
  assert.equal(log[1].t - log[0].t, STRUCTURE.hold);
  assert.ok(sim.castle.toppled[0], "the banner is down");
  sim.free();
});

test("a keep that lost its top third needs a deeper cut", () => {
  const top = (sim: SandboxSim) => {
    for (const id of L[KEEP].stones) if (layout.stones[id].course >= 27 && layout.stones[id].part !== "buttress") sim.castle.withdraw(id);
  };
  const shallow = world();
  top(shallow);
  cut(shallow, faceCut(2, 4, 1 / 3));
  const a = run(shallow, 600);
  console.log("  stub, the cut that topples a whole keep:", kinds(a).join(","), "holds", shallow.statics!.status(KEEP).holds.toFixed(2));
  assert.deepEqual(kinds(a), [], "the lighter keep holds the same cut");
  shallow.free();

  const deep = world();
  top(deep);
  cut(deep, faceCut(2, 4, 0.55));
  const b = run(deep, 600);
  console.log("  stub, a deeper cut:", kinds(b).join(","), "holds", deep.statics!.status(KEEP).holds.toFixed(2));
  assert.deepEqual(kinds(b).slice(0, 2), [EventKind.Strain, EventKind.Topple]);
  deep.free();
});

test("a buttress on the cut face holds the cut that otherwise topples; shot away, it falls", () => {
  const sim = world();
  raise(sim, buttressOnCutFace());
  cut(sim, faceCut(2, 4, 1 / 3));
  const held = run(sim, 600);
  const s = sim.statics!.status(KEEP);
  console.log("  buttressed: holds", s.holds.toFixed(2), "margin", s.margin.toFixed(2));
  assert.deepEqual(kinds(held), [], "the buttress holds it");
  cut(sim, buttressOnCutFace());
  const fell = run(sim, 900);
  console.log("  buttress gone:", fell.map((l) => `${l.t}:${l.e.slice(0, 4).join(",")}`).join(" "));
  assert.deepEqual(kinds(fell).slice(0, 2), [EventKind.Strain, EventKind.Topple]);
  sim.free();
});

test("a tower cut on its outer side topples outward", () => {
  const sim = world();
  const d = L[TOWER];
  const out = { x: -1, z: -1 };
  const c0 = 2;
  const wedges = d.stones
    .filter((id) => layout.stones[id].part === "tower" && layout.stones[id].course === c0)
    .map((id) => ({ id, a: Math.atan2(layout.stones[id].z - d.cz, layout.stones[id].x - d.cx) }));
  const target = Math.atan2(out.z, out.x);
  const diff = (a: number) => Math.abs(Math.atan2(Math.sin(a - target), Math.cos(a - target)));
  wedges.sort((p, q) => diff(p.a) - diff(q.a) || p.id - q.id);
  const n = Math.round(wedges.length * 0.45);
  cut(sim, wedges.slice(0, n).map((w) => w.id));
  const log = run(sim, 900);
  console.log("  tower topple:", log.map((l) => `${l.t}:${l.e.slice(0, 5).join(",")}`).join(" "));
  assert.deepEqual(kinds(log), [EventKind.Strain, EventKind.Topple, EventKind.Released]);
  assert.equal(log[0].e[1], TOWER);
  assert.ok(angleTo(log[1].e[3], log[1].e[4], out.x, out.z) < 35, "outward");
  assert.ok(!sim.castle.toppled[0], "a tower that falls ends nothing");
  sim.free();
});

test("a topple or a crush that is mended in time is saved", () => {
  for (const [name, ids, mode] of [
    ["topple", faceCut(2, 4, 1 / 3), 2],
    ["crush", evenCut(2, 0.8), 1],
  ] as const) {
    const sim = world();
    cut(sim, ids);
    const log = run(sim, 20);
    assert.deepEqual(kinds(log), [EventKind.Strain], name);
    assert.equal(log[0].e[3], mode);
    for (const id of ids) assert.ok(sim.castle.restore(id), `${name}: restore ${id}`);
    const more = run(sim, 300);
    console.log(`  ${name} saved:`, more.map((l) => `${l.t}:${l.e.slice(0, 4).join(",")}`).join(" "));
    assert.deepEqual(kinds(more), [EventKind.Saved], name);
    assert.equal(sim.statics!.status(KEEP).state, StaticState.Standing);
    assert.equal(sim.statics!.status(KEEP).weakest, -1);
    assert.ok(!sim.castle.toppled[0]);
    sim.free();
  }
});

test("an untouched world steps 3,000 ticks with no strain", () => {
  const sim = world();
  const log = run(sim, 3000);
  assert.deepEqual(kinds(log), []);
  for (let i = 0; i < 10; i++) assert.equal(sim.statics!.status(i).state, StaticState.Standing);
  sim.free();
});

test("a whole keep let go, buttresses up, never has more than 650 bodies moving, and every stone ends as dust or a body", () => {
  const sim = world();
  const st = sim.statics!;
  raise(sim, allButtresses());
  // Crush the foot: everything above comes down at once (the biggest release).
  cut(sim, [...evenCut(0, 0.8), ...L[KEEP].stones.filter((id) => layout.stones[id].part === "buttress" && layout.stones[id].course === 0)]);
  let most = 0, worst = 0, worstT = 0, ghostsMost = 0, releasedAt = -1, sum = 0, steps = 0;
  const log: Array<{ t: number; e: Ev }> = [];
  for (let t = 1; t <= 900; t++) {
    const a = performance.now();
    sim.step();
    const ms = performance.now() - a;
    sum += ms;
    steps++;
    if (ms > worst) {
      worst = ms;
      worstT = t;
    }
    for (const e of events(sim)) if (STATIC_KINDS.includes(e[0])) log.push({ t, e });
    const awake = sim.castle.awakeCount();
    if (awake > most) most = awake;
    if (st.ghostCount() > ghostsMost) ghostsMost = st.ghostCount();
    if (releasedAt < 0 && log.some((l) => l.e[0] === EventKind.Released)) releasedAt = t;
  }
  console.log(`  whole keep let go: released at ${releasedAt}, most moving ${most}, most ghosts ${ghostsMost}, worst step ${worst.toFixed(1)} ms at ${worstT}, mean ${(sum / steps).toFixed(2)} ms`);
  assert.ok(releasedAt > 0);
  const rel0 = log.find((l) => l.e[0] === EventKind.Released)!;
  assert.ok(rel0.e[2] > 1200, `stones let go ${rel0.e[2]}`);
  assert.ok(most <= 650, `most moving ${most}`);
  assert.equal(st.ghostCount(), 0, "no ghost still flying after 10 s");
  // Every stone of the keep is dust, rubble, or still standing: none is left busy.
  for (const id of L[KEEP].stones) assert.equal(sim.castle.busy[id], 0, `stone ${id} still busy`);
  sim.free();
});

test("the same cuts give the same world twice", () => {
  const hashes: string[] = [];
  for (let k = 0; k < 2; k++) {
    const sim = world();
    cut(sim, faceCut(2, 4, 1 / 3));
    run(sim, 330); // through the topple, the release and the ghosts' flight
    hashes.push(sim.hash().state + sim.hash().world);
    sim.free();
  }
  assert.equal(hashes[0], hashes[1]);
});
