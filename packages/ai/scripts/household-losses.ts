// 3.6: what knocks the household down in an AI match. Plays one match and lists every man of the household knocked down,
// by station kind (gun crew, keeper, mason, boy) and cause (a hand shot of the enemy's, a shot of a gun nobody mans, a
// burst, falling masonry, the floor gone from under him, a blow, a musket ball), with each team's reserve every 30 s and
// the first time it ran dry.
// npx rolldown packages/ai/scripts/household-losses.ts --format esm --platform node -o node_modules/.scratch/household-losses.mjs && node node_modules/.scratch/household-losses.mjs [c0=knight] [c1=knight] [seed=1] [secs=900] [list=0]
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, Unit, type Difficulty } from "@keepfall/content";
import { Cause, isWorker, Role, type Rapier } from "@keepfall/sim";
import { Match } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const sides = [arg("c0", "knight"), arg("c1", "knight")];
const seed = Number(arg("seed", "1")), secs = Number(arg("secs", "900")), list = arg("list", "0") === "1";
const layout = buildLayout(1, GAME_LAYOUT);
const m = new Match(R, layout, { seed, plan: false, rotate: false });
const ais = sides.map((s, team) => (s === "idle" ? null : new AiPlayer(m, team, s as Difficulty, seed)));
const w = m.world, h = w.household!;
const CAUSE: Record<number, string> = { [Cause.Unknown]: "unknown", [Cause.Ball]: "ball", [Cause.Burst]: "burst", [Cause.Masonry]: "masonry", [Cause.Blow]: "blow", [Cause.Fall]: "fall", [Cause.Musket]: "musket" };
const kindOf = (mi: { role: number; unit: number; action: number }) =>
  mi.role === Role.Mason ? "mason" : mi.role === Role.Carrier ? "boy" : mi.action === 12 ? "gun crew" : mi.action === 13 ? "keeper" : mi.action === 14 ? "hoisting" : "walking out";
const tally = new Map<string, number>();
const dry: number[] = [-1, -1];
const lost = [0, 0];
for (let i = 0; i < secs * 60 && !m.result; i++) {
  for (const ai of ais) ai?.step();
  // Who each household minion was before the step (his action tells a gun's man from a keeper and a walker).
  const before = new Map<number, string>();
  for (const mi of w.minions.list) if (mi.state === 0 && isWorker(mi) && mi.wave >= 0) before.set(mi.id, kindOf(mi));
  // The economy reads and clears the step's knockdowns inside Match.step: take a copy as it starts.
  let downs: number[] = [];
  const eco = m.economy as unknown as { step(t: number): void };
  const orig = eco.step.bind(eco);
  eco.step = (t: number) => {
    downs = w.minions.downs.slice();
    orig(t);
  };
  m.step();
  eco.step = orig;
  for (let k = 0; k + 3 < downs.length; k += 4) {
    const mi = w.minions.list[downs[k]];
    if (!mi || !isWorker(mi) || mi.wave < 0) continue;
    const cause = downs[k + 1], shot = downs[k + 2];
    let how = CAUSE[cause] ?? String(cause);
    if ((cause === Cause.Ball || cause === Cause.Burst) && shot >= 0) {
      const info = w.shotInfo.get(shot);
      if (info) {
        const e = w.emplacements[info.emplacement];
        const own = (e.z < -75 ? 1 : 0) === mi.team;
        how += `:${own ? "own " : ""}${info.auto ? "auto " : "hand "}${e.weapon}`;
      }
    } else if ((cause === Cause.Ball || cause === Cause.Burst) && shot < 0) how += ":keg or magazine";
    const kind = before.get(mi.id) ?? (mi.unit === Unit.Crew ? "crew" : "worker");
    lost[mi.team]++;
    const key = `${kind} | ${how}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if (list) console.log(`${(i / 60).toFixed(0)} s team ${mi.team} ${kind} down: ${how} (y ${mi.y.toFixed(1)})`);
  }
  for (const t of [0, 1]) if (dry[t] < 0 && h.reserve[t] === 0) dry[t] = i;
  if (i % 1800 === 0) console.log(`${(i / 60).toFixed(0)} s reserve ${h.reserve[0]} / ${h.reserve[1]}, lost ${h.lost[0]} / ${h.lost[1]}, crews ${[0, 1].map((t) => w.emplacements.filter((e) => (e.z < -75 ? 1 : 0) === t && !e.empty).map((e) => h.crew(e.id)).join("")).join(" / ")}`);
}
console.log(m.result ? `END at ${(m.result.tick / 60).toFixed(0)} s by ${m.result.reason}, winner ${m.result.winner}` : `no result after ${secs} s`);
console.log(`lost ${h.lost[0]} / ${h.lost[1]}; reserve first dry at ${dry.map((d) => (d < 0 ? "never" : `${(d / 60).toFixed(0)} s`)).join(" / ")}`);
for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)} ${k}`);
m.free();
