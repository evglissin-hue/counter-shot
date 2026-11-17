// T9 (3.6): where the stones moving past the budget come from around each fall. Plays one AI match; at every Topple or
// Crush it snapshots what each piece was (standing, frozen rubble, loose and asleep, loose and awake), then for the next
// `after` seconds prints, every half second, the pieces awake by what they were at the fall: the fall's own claimed
// pieces, frozen rubble woken, loose rubble that was asleep and woke, pieces that stood and came loose since, and loose
// pieces already awake at the fall. Also the castle's room (the budget less what moves) at the fall.
// npx rolldown packages/ai/scripts/budget-falls.ts --format esm --platform node -o node_modules/.scratch/budget-falls.mjs && node node_modules/.scratch/budget-falls.mjs [c0=knight] [c1=knight] [seed=1] [secs=1500] [after=6] [min=450]
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, type Difficulty } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, type Rapier } from "@keepfall/sim";
import { Match } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const sides = [arg("c0", "knight"), arg("c1", "knight")];
const seed = Number(arg("seed", "1")), secs = Number(arg("secs", "1500")), after = Number(arg("after", "6")), min = Number(arg("min", "450"));
const layout = buildLayout(1, GAME_LAYOUT);
const m = new Match(R, layout, { seed, plan: false, rotate: false });
const ais = sides.map((s, team) => (s === "idle" ? null : new AiPlayer(m, team, s as Difficulty, seed)));
const c = m.world.castle;
const n = layout.stones.length;
const worldEvents = (m.world as unknown as { events: number[] }).events;
const cs = c as unknown as { moving: number; tipping: number; woken: number };
let evSeen = 0;
/** What each piece was at the last fall: 0 standing, 1 frozen, 2 loose asleep, 3 loose awake, 4 dust or ghost. */
const was = new Uint8Array(n);
let watchUntil = -1, fallAt = -1, peak = 0, peakText = "", most = 0, mostAt = 0;
const name = (si: number) => `castle ${Math.floor(si / 5)} ${si % 5 === 0 ? "keep" : `tower ${si % 5}`}`;

function snapshot() {
  was.fill(0);
  for (const id of c.dynList) {
    if (c.shattered[id] || c.busy[id] === 2) was[id] = 4;
    else if (c.frozen[id]) was[id] = 1;
    else if (c.bodies[id].isSleeping()) was[id] = 2;
    else was[id] = 3;
  }
}

function count(): { total: number; text: string } {
  let claimed = 0, frozen = 0, asleep = 0, fresh = 0, awake = 0;
  for (const id of c.dynList) {
    const b = c.busy[id];
    if (b === 2) continue;
    const moving = b === 1 || (!c.frozen[id] && !c.shattered[id] && !c.bodies[id].isSleeping());
    if (!moving) continue;
    if (b === 1) claimed++;
    else if (was[id] === 1) frozen++;
    else if (was[id] === 2) asleep++;
    else if (was[id] === 0) fresh++;
    else awake++;
  }
  const total = claimed + frozen + asleep + fresh + awake;
  return { total, text: `${total}: claimed/fall ${claimed}, frozen woken ${frozen}, asleep woken ${asleep}, came loose ${fresh}, awake already ${awake} | castle moving ${cs.moving} tipping ${cs.tipping}` };
}

for (let i = 0; i < secs * 60 && !m.result; i++) {
  for (const ai of ais) ai?.step();
  const before = c.room();
  // A fall that begins this step: snapshot before the step (what the pieces were).
  const evBefore = worldEvents.length;
  void evBefore;
  m.step();
  for (; evSeen + EVENT_STRIDE <= worldEvents.length; evSeen += EVENT_STRIDE) {
    const k = worldEvents[evSeen];
    if (k === EventKind.Topple || k === EventKind.Crush) {
      console.log(`${(i / 60).toFixed(1)} s: ${name(worldEvents[evSeen + 1])} ${k === EventKind.Topple ? "topple" : "crush"} at course ${worldEvents[evSeen + 2]}; room before the step ${before}, now ${c.room()}`);
      if (watchUntil < i) snapshot();
      watchUntil = i + after * 60;
      fallAt = i;
    } else if (k === EventKind.Released) {
      console.log(`${(i / 60).toFixed(1)} s: ${name(worldEvents[evSeen + 1])} released (${worldEvents[evSeen + 2]} pieces, ${worldEvents[evSeen + 3]} bodies)`);
    }
  }
  if (i % 10 === 0) {
    const a = c.awakeCount();
    if (a > most) {
      most = a;
      mostAt = i;
    }
  }
  if (i <= watchUntil && (i - fallAt) % 30 === 0) {
    const x = count();
    if (x.total >= min || (i - fallAt) % 60 === 0) console.log(`   +${((i - fallAt) / 60).toFixed(1)} s ${x.text}`);
    if (x.total > peak) {
      peak = x.total;
      peakText = `${(i / 60).toFixed(1)} s ${x.text}`;
    }
  }
}
console.log(m.result ? `END at ${(m.result.tick / 60).toFixed(0)} s by ${m.result.reason}, winner ${m.result.winner}` : `no result after ${secs} s`);
console.log(`peak after a fall: ${peakText}`);
console.log(`most moving in the match (every 10 ticks): ${most} at ${(mostAt / 60).toFixed(1)} s`);
m.free();
