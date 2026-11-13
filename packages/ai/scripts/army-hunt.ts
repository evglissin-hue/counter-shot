// The army hunts (the army pass; see "Build and review loop" step 4 in docs/handoff.md): short scripted, deterministic
// scenarios that check the army does what its orders say and does not stand about. Each hunt has a name, a threshold
// (the table below) and a printed measurement; exits 1 if anything is flagged.
// npx rolldown packages/ai/scripts/army-hunt.ts --format esm --platform node -o node_modules/.scratch/army-hunt.mjs && node node_modules/.scratch/army-hunt.mjs [only=advance,hold,push,route,sealed,stuck,keg,musket,targets,ladder] [seed=N] [v=1]
// The whole suite takes about 11 minutes of one core; `only=` runs part of it. Scenarios live in packages/ai/scripts/army/.
import { arg, type HuntFn } from "./army/common";
import { targets } from "./army/fighting";
import { sealed, stuck } from "./army/movement";
import { advance, hold, push, route } from "./army/orders";
import { keg, ladder, musket } from "./army/specialists";

/** Every threshold, in one table. Seconds unless the name says ticks; fractions are 0..1. */
const T: Record<string, number> = {
  // advance: Advance given to men holding at a marker, standing after a fight, and to the guided match's waves on Hold.
  advanceResp: 60, // every man (fights excepted) walks the way of his route within this many ticks of Advance
  advanceAlong: 0.95, // and at least this share are 10 m along their road after the window
  advanceWindow: 1200, // ticks watched after the order (20 s)
  advanceMarkerAt: 45, // s: Advance for the men holding at a marker
  advanceFightEnemyAt: 10, // s: the enemy walks into the held men
  advanceFightAt: 55, // s: Advance for the men after the fight
  advanceGuidedAt: 50, // s: Advance for the guided match's waves on the left flank
  // hold: waves stacked on Hold keep their marker; a late Hold brings men past the line back.
  holdWaves: 6, // waves sent to one marker per team
  holdEvery: 5, // s between the waves
  holdStackSecs: 175, // s of the stack scenario
  holdAt1: 40, // s after a man reaches the line: first check
  holdAt2: 120, // s after: second check
  holdNear: 6, // m from the marker that counts as held
  holdFrac1: 0.8, // share within holdNear at holdAt1
  holdFrac2: 0.85, // share within holdNear at holdAt2
  holdLateAt: 40, // s: Hold given late, men past the line
  holdLateBack: 60, // s allowed for the men to come back
  holdBack: 0.9, // share of men past the line (still up) that come back within it
  // push: a breach open, masons off.
  pushSecs: 130, // s of the scenario
  pushIn: 100, // s from leaving the gate to being in the enemy courtyard
  pushFrac: 0.9, // share of a wave (not downed outside) that is in within pushIn
  // route: a route input moves new waves, waves still out, and waves holding at a marker.
  routeAt: 5, // s: the route is named
  routeCrossSecs: 70, // s of the crossing scenario
  routeHoldAt: 40, // s: the route is named to waves holding at a marker
  routeMove: 60, // s allowed for held waves to reach the new marker
  routeNear: 8, // m from the new marker
  routeFrac: 0.9, // share of the held men that must be there
  // sealed: a courtyard whose gateway is blocked (gate leaves loose but upright in place).
  sealedSecs: 70, // s of the scenario
  sealedStill: 5, // s a marching man with nothing to fight may stand on a FLOW_INF cell
  sealedFront: 14, // m from the gate that counts as the gate front
  sealedReach: 0.9, // share of the attackers that must reach the gate front
  // stuck: the deck of the centre bridge drops out under a wave.
  stuckSecs: 90, // s of the scenario
  stuckStill: 10, // s a soldier with nothing to fight may make under stuckMetres
  stuckMetres: 1, // m of progress that counts as moving
  // keg: a set keg and the men of its own side.
  kegSecs: 100, // s of the scenario
  kegOwn: 1, // most men of a keg's own side it may down
  kegApart: 6, // m between two kegs of one wave
  // musket: a volley wave advances on a held wave across the stream.
  musketSecs: 70, // s of the scenario
  musketAt: 20, // s: the volley wave leaves, 50 m out from its own castle, after the held wave is at its marker
  musketStill: 15, // s a musketeer on Advance may stand with a mark he cannot walk to
  musketMoved: 0.5, // m he may drift and still count as standing
  // targets: 8 v 8 on one road.
  targetsSecs: 30, // s of the scenario
  targetsNear: 9, // m: an enemy within this of the team's middle is "within reach"
  targetsFoes: 5, // enemies within reach before the average is taken
  targetsMean: 3, // distinct targets a side averages then
  // ladder: crews and climbers.
  ladderSecs: 90, // s of the leak and Hold runs
  ladderMerlonSecs: 120, // s of the merlon run (long enough for a crew to carry for ladderNoSpot at the wall)
  ladderWavesUntil: 40, // s: ladder waves leave every 10 s until this (merlon run)
  ladderLeak: 3, // men knocked down on their way to a ladder (leak run)
  ladderClaimSecs: 5, // s a ladder's claims may disagree with the men walking and waiting
  ladderNoSpot: 60, // s a crew may carry within 34 m of the wall with no spot
  ladderHoldWait: 10, // s after Hold in which nobody may still walk to or wait at a ladder
};

const HUNTS: Array<[string, HuntFn]> = [
  ["advance", advance],
  ["hold", hold],
  ["push", push],
  ["route", route],
  ["sealed", sealed],
  ["stuck", stuck],
  ["keg", keg],
  ["musket", musket],
  ["targets", targets],
  ["ladder", ladder],
];

const only = arg("only", "").split(",").filter(Boolean);
const seedArg = arg("seed", "");
const verbose = arg("v", "0") === "1";
const suiteStart = Date.now();
const flagged: string[] = [];
for (const [name, fn] of HUNTS) {
  if (only.length && !only.includes(name)) continue;
  const t0 = Date.now(), c0 = process.cpuUsage();
  const r = fn(T, seedArg ? Number(seedArg) : 7);
  const secs = ((Date.now() - t0) / 1000).toFixed(0), cpu = process.cpuUsage(c0), cpuSecs = ((cpu.user + cpu.system) / 1e6).toFixed(0);
  console.log(`${r.flags.length ? "FLAG" : "ok  "} ${name.padEnd(8)} ${r.measure} (${secs} s wall, ${cpuSecs} s cpu)`);
  for (const f of r.flags) {
    console.log(`       - ${f}`);
    flagged.push(`${name}: ${f}`);
  }
  if (verbose || r.flags.length) for (const d of r.detail) console.log(`         ${d}`);
}
const cpuAll = process.cpuUsage();
console.log(`${flagged.length ? `${flagged.length} flagged` : "nothing flagged"} (${((Date.now() - suiteStart) / 60000).toFixed(1)} min wall, ${((cpuAll.user + cpuAll.system) / 6e7).toFixed(1)} min cpu)`);
process.exit(flagged.length ? 1 : 0);
