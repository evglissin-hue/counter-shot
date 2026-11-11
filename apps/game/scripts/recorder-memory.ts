// The recorder's memory through a ten-minute match (show track, S3): the AI
// against the AI (Knight against Knight), a frame collected every 2 ticks as
// the worker does, fed to a Recorder whose keyframe is a stand-in sized like the
// real one (the stones moved from where they were built times 32 bytes, the
// ground's changed cells, the bodies that have stopped moving). Moments are found
// by Moments from what the match tells (the match goes on stepping after its result, so the ten minutes are always run); every minute prints the ring, the
// keyframes and the reel, and the peak.
// npx rolldown apps/game/scripts/recorder-memory.ts --format esm --platform node -o node_modules/.scratch/recorder-memory.mjs && node --expose-gc node_modules/.scratch/recorder-memory.mjs [secs=600] [seed=11]
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, CASTLE_SHAPE, KEEP_STOREYS, type Difficulty } from "@keepfall/content";
import { MINION_PARTS, PART_STRIDE, STONE_STRIDE, type FrameData, type Rapier } from "@keepfall/sim";
import { Match } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";
import { Moments, type MatchView } from "../src/moments";
import { Recorder, type FrameExtras } from "../src/recorder";
import { frameBytes, type RenderKeyframe } from "../src/render/keyframe";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const secs = Number(arg("secs", "600")), seed = Number(arg("seed", "11"));
const MB = 2 ** 20;

const layout = buildLayout(1, GAME_LAYOUT);
const m = new Match(R, layout, { seed, plan: false, rotate: false });
const ais = [0, 1].map((team) => new AiPlayer(m, team, "knight" as Difficulty, seed));
const sim = m.world;

// What the renderer would remember, tallied from the frames.
const full = sim.terrain.fullPatch();
const gridNx = full.ni;
const base = full.h.slice();
const ground = base.slice();
const movedStones = new Set<number>();
const frozen = new Set<number>();
const BODY_BYTES = MINION_PARTS.length * PART_STRIDE * 4 + 200;
let lastFrame: FrameData | null = null;
function tally(f: FrameData) {
  for (let i = 0; i < f.stoneCount; i++) movedStones.add(f.stones[i * STONE_STRIDE] | 0);
  for (let i = 0; i < f.settledCount; i++) frozen.add(f.settled[i * PART_STRIDE] | 0);
  for (let i = 0; i < f.partCount; i++) frozen.delete(f.parts[i * PART_STRIDE] | 0);
  for (const id of f.gone) frozen.delete(id);
  for (const p of f.terrain) for (let j = 0; j < p.nj; j++) for (let i = 0; i < p.ni; i++) ground[(p.j0 + j) * gridNx + p.i0 + i] = p.h[j * p.ni + i];
  lastFrame = f;
}
function standIn(tick: number): RenderKeyframe {
  let changed = 0;
  for (let k = 0; k < base.length; k++) if (ground[k] !== base[k]) changed++;
  const size = movedStones.size * 32 + changed * 8 + frozen.size * BODY_BYTES + 30_000;
  const parts = new Map<string, unknown>([["standin", new Uint8Array(size)]]);
  return { tick, parts, last: lastFrame, bytes: size + (lastFrame ? frameBytes(lastFrame) : 0) };
}

const rec = new Recorder({ capture: standIn });
const gateLeaves = [0, 1].map((c) => layout.stones.filter((st) => st.part === "gate" && st.castle === c).map((st) => st.id));
const STOREY_TOPS = KEEP_STOREYS.map((c) => c * CASTLE_SHAPE.course);
const keepFloors = (castle: number): number => {
  if (sim.castle.toppled[castle]) return 0;
  const y = sim.castle.bodies[sim.castle.layout.bannerIds[castle]].translation().y;
  let n = 0;
  for (const top of STOREY_TOPS) if (top <= y + 0.25) n++;
  return n;
};
const moments = new Moments({
  layout,
  clock: () => 0,
  me: () => 1,
  gun: (emp) => {
    const e = m.emplacements[emp];
    return e ? { team: e.z < -75 ? 1 : 0, name: e.weapon, x: e.x, y: e.y, z: e.z } : null;
  },
});
moments.onMoment((x) => rec.moment(x));
const found: string[] = [];
moments.onMoment((x) => found.push(`${(x.tick / 60).toFixed(0)}s ${x.kind} ${x.score}`));
let bridges = sim.bridgesOpen();
let bridgesVersion = sim.nav.version;

console.log("minute  ring MB  ring s  frames  keys (MB)   reel MB  clips  peak ring MB  heap MB  arrays MB");
let worst = 0;
const t0 = performance.now();
for (let i = 1; i <= secs * 60; i++) {
  for (const ai of ais) ai.step();
  m.step();
  if (i % 2 !== 0) continue;
  const f = sim.collect();
  const view: MatchView = {
    tick: m.tick,
    earned: new Float32Array(0),
    gateOpen: [gateLeaves[0].some((id) => sim.castle.dynamic[id] === 1), gateLeaves[1].some((id) => sim.castle.dynamic[id] === 1)],
    storm: [m.storm[0], m.storm[1]],
    keeps: [keepFloors(0), keepFloors(1)],
    result: m.result ? { winner: m.result.winner, reason: m.result.reason, tick: m.result.tick } : null,
  };
  // The page's order: the match report, then (a little later, on the render clock) the frame, its moments, then the recorder.
  const extras: FrameExtras = { guns: new Float32Array(m.guns.length * 2), out: new Int16Array(m.emplacements.length * 2), storm: [0, 0, 0, 0], bridges: null, arms: new Int8Array(m.emplacements.length * 2) };
  rec.note(f, extras);
  moments.match(view);
  moments.frame(f);
  if (sim.nav.version !== bridgesVersion) {
    bridgesVersion = sim.nav.version;
    const now = sim.bridgesOpen();
    moments.bridges(bridges, now);
    bridges = now;
  }
  tally(f);
  rec.frame(f);
  if (i % 3600 === 0) {
    const s = rec.stats();
    globalThis.gc?.();
    const mem = process.memoryUsage();
    worst = Math.max(worst, s.ringBytes + s.reelBytes);
    console.log(
      `${String(i / 3600).padStart(5)}  ${(s.ringBytes / MB).toFixed(2).padStart(7)}  ${s.ringSeconds.toFixed(1).padStart(6)}  ${String(s.frames).padStart(6)}  ${String(s.keyframes).padStart(4)} ${("(" + (s.keyframeBytes / MB).toFixed(2) + ")").padStart(7)}  ${(s.reelBytes / MB).toFixed(2).padStart(7)}  ${String(s.clips).padStart(5)}  ${(s.peakRingBytes / MB).toFixed(2).padStart(12)}  ${(mem.heapUsed / MB).toFixed(0).padStart(7)}  ${(mem.arrayBuffers / MB).toFixed(0).padStart(9)}`,
    );
  }
}
rec.flush();
const s = rec.stats();
console.log(`end at ${(m.tick / 60).toFixed(0)} s${m.result ? ` (${m.result.reason})` : ""}: wall ${((performance.now() - t0) / 1000).toFixed(0)} s`);
console.log(`peak ring ${(s.peakRingBytes / MB).toFixed(2)} MB, reel ${(s.reelBytes / MB).toFixed(2)} MB in ${s.clips} clips, ring + reel at a minute mark at most ${(worst / MB).toFixed(2)} MB, stones moved ${movedStones.size}, bodies frozen ${frozen.size}`);
for (const c of rec.reel) console.log(`  clip ${c.moment.kind.padEnd(13)} score ${String(c.moment.score).padStart(4)}  ${(c.from / 60).toFixed(0)}..${(c.to / 60).toFixed(0)} s  ${c.entries.length} frames  ${(c.bytes / MB).toFixed(2)} MB`);
console.log(`moments found: ${found.length}`);
m.free();
