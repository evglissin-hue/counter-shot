// The guided match (phase 2 M6): play it with a stand-in player and print, as
// they happen, the tutor's stage changes, each side's waves sent, both keeps'
// floors and the masonry down, and the result.
//   player=idle      no inputs at all
//   player=newcomer  an AiPlayer at "squire" as team 1 whose order inputs are dropped until advance= seconds (default 300), then let through
//   player=squire    an unrestricted Squire
//   player=waves     builds a second barracks at 1:40 and sends its waves in (Advance) at advance= seconds, nothing else (no shot)
// npx rolldown packages/ai/scripts/guided.ts --format esm --platform node -o node_modules/.scratch/guided.mjs && node node_modules/.scratch/guided.mjs [player=newcomer] [seed=31] [secs=1500] [advance=300]
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT } from "@keepfall/content";
import type { Rapier } from "@keepfall/sim";
import { GUIDED_OPTIONS, Match, Team, TUTOR_TEAM } from "@keepfall/rules";
import { AiPlayer, banner } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const who = arg("player", "newcomer"), seed = Number(arg("seed", "31")), secs = Number(arg("secs", "1500")), advance = Number(arg("advance", "300"));

const m = new Match(R, buildLayout(1, GAME_LAYOUT), { ...GUIDED_OPTIONS, seed });
if (who === "newcomer") {
  // The newcomer's waves wait on Hold until it has learned to send them: its order inputs are dropped until then.
  const q = m.queue.bind(m);
  m.queue = (tick, team, input) => {
    if (team === Team.Player && input.kind === "order" && tick < advance * 60) return;
    q(tick, team, input);
  };
}
const tutor = new AiPlayer(m, TUTOR_TEAM, "tutor", seed);
const player = who === "idle" || who === "waves" ? null : new AiPlayer(m, Team.Player, "squire", seed);
if (who === "waves") {
  m.queue(100 * 60, Team.Player, { kind: "build", plot: 2, building: "barracks" });
  m.queue(advance * 60, Team.Player, { kind: "order", order: 0 });
}
const clock = (tick: number) => `${Math.floor(tick / 3600)}:${String(Math.floor(tick / 60) % 60).padStart(2, "0")}`;
const say = (tick: number, text: string) => console.log(`${clock(tick)} ${text}`);
const floors = () => `floors ${banner(m, 0).floor.toFixed(1)}/${banner(m, 1).floor.toFixed(1)}`;
let stage = 0, waves: [number, number] = [0, 0];
say(0, `guided match, player=${who} seed=${seed}`);
for (let i = 0; i < secs * 60 && !m.result; i++) {
  tutor.step();
  player?.step();
  m.step();
  if (tutor.stage !== stage) {
    stage = tutor.stage;
    say(i, `tutor stage ${stage}  ${floors()}  down ${m.masonryDown(0)}/${m.masonryDown(1)}`);
  }
  if (m.waves[0] !== waves[0] || m.waves[1] !== waves[1]) {
    waves = [m.waves[0], m.waves[1]];
    say(i, `waves sent tutor ${waves[0]} player ${waves[1]}`);
  }
  if (i % (60 * 60) === 0 && i > 0) say(i, `${floors()}  down ${m.masonryDown(0)}/${m.masonryDown(1)}  shots ${m.shots[0]}/${m.shots[1]}  gold ${m.gold[0]}/${m.gold[1]}`);
}
const r = m.result;
say(m.tick, r ? `RESULT ${r.winner === Team.Player ? "player" : r.winner === TUTOR_TEAM ? "tutor" : "draw"} wins by ${r.reason}  tutor stage ${stage}  ${floors()}  down ${m.masonryDown(0)}/${m.masonryDown(1)}` : `RESULT none yet  tutor stage ${stage}  ${floors()}`);
m.free();
