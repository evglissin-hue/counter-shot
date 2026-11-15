// What makes up the most stones moving in an AI match (T9)? Plays one AI match and, every 10 ticks, sorts the bodies
// moving by where they come from: a falling keep or tower's own part (claimed by the statics pass), rubble that had
// settled and was woken again, or masonry that stood until now; and by part (wall, tower, keep, house...). Prints the
// structures' falls as they happen, every sample over `over` stones moving, and the match's peak with its make-up.
// npx rolldown packages/ai/scripts/budget-peaks.ts --format esm --platform node -o node_modules/.scratch/budget-peaks.mjs && node node_modules/.scratch/budget-peaks.mjs [c0=knight] [c1=knight] [seed=1] [secs=1500] [over=500]
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, type Difficulty } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, type Rapier } from "@keepfall/sim";
import { Match } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const sides = [arg("c0", "knight"), arg("c1", "knight")];
const seed = Number(arg("seed", "1")), secs = Number(arg("secs", "1500")), over = Number(arg("over", "500"));
const layout = buildLayout(1, GAME_LAYOUT);
const m = new Match(R, layout, { seed, plan: false, rotate: false });
const ais = sides.map((s, team) => (s === "idle" ? null : new AiPlayer(m, team, s as Difficulty, seed)));
const c = m.world.castle;
const n = layout.stones.length;
const claimed = new Uint8Array(n), wasFrozen = new Uint8Array(n);
const worldEvents = (m.world as unknown as { events: number[] }).events;
let evSeen = 0;
let peak = 0, peakAt = 0, peakMix = "", above600 = 0, worst = 0;
const KIND: Record<number, string> = { [EventKind.Topple]: "topple", [EventKind.Crush]: "crush", [EventKind.Released]: "released" };
const name = (si: number) => `castle ${Math.floor(si / 5)} ${si % 5 === 0 ? "keep" : `tower ${si % 5}`}`;

function mix(): { total: number; text: string } {
  const by = new Map<string, number>();
  let total = 0, fall = 0, woke = 0, fresh = 0, ghosts = 0;
  for (const id of c.dynList) {
    const b = c.busy[id];
    if (b === 2) {
      ghosts++;
      continue;
    }
    const moving = b === 1 || (!c.frozen[id] && !c.shattered[id] && !c.bodies[id].isSleeping());
    if (!moving) continue;
    total++;
    const part = layout.stones[id].part;
    by.set(part, (by.get(part) ?? 0) + 1);
    if (claimed[id]) fall++;
    else if (wasFrozen[id]) woke++;
    else fresh++;
  }
  const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  return { total, text: `${total} moving: fall ${fall}, woken ${woke}, newly loose ${fresh} (ghosts ${ghosts}) | ${parts}` };
}

let i = 0;
for (; i < secs * 60 && !m.result; i++) {
  for (const ai of ais) ai?.step();
  const s0 = performance.now();
  m.step();
  worst = Math.max(worst, performance.now() - s0);
  for (const id of c.dynList) {
    if (c.busy[id]) claimed[id] = 1;
    if (c.frozen[id]) wasFrozen[id] = 1;
  }
  for (; evSeen + EVENT_STRIDE <= worldEvents.length; evSeen += EVENT_STRIDE) {
    const k = worldEvents[evSeen];
    if (k === EventKind.Topple || k === EventKind.Crush || k === EventKind.Released) {
      const extra = k === EventKind.Released ? ` (${worldEvents[evSeen + 2]} pieces, ${worldEvents[evSeen + 3]} bodies)` : ` at course ${worldEvents[evSeen + 2]}`;
      console.log(`  ${(i / 60).toFixed(1)} s: ${name(worldEvents[evSeen + 1])} ${KIND[k]}${extra}`);
    }
  }
  if (i % 10 === 0) {
    const x = mix();
    if (x.total > 600) above600 += 10;
    if (x.total > peak) {
      peak = x.total;
      peakAt = i;
      peakMix = x.text;
    }
    if (x.total > over && i % 60 === 0) console.log(`${(i / 60).toFixed(0).padStart(5)} s  ${x.text}`);
  }
}
console.log(m.result ? `END at ${(m.result.tick / 60).toFixed(0)} s by ${m.result.reason}, winner ${m.result.winner}` : `no result after ${secs} s`);
console.log(`peak ${peak} at ${(peakAt / 60).toFixed(1)} s: ${peakMix}`);
console.log(`ticks over 600 moving: ${above600} (${(above600 / 60).toFixed(1)} s); worst step ${worst.toFixed(1)} ms`);
m.free();
