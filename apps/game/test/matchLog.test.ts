// Track S6: the match's input log and replay files. A match logged through
// Match.onInput (aim inputs thinned) and written to the file format replays, from
// the file alone and with no AI, to the same hash; files from other versions or
// of other kinds are refused with their reasons.

import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT } from "@keepfall/content";
import { AiPlayer, GUIDED_MATCH_SCRIPT } from "@keepfall/ai";
import { GUIDED_OPTIONS, Match, Team, TUTOR_TEAM, type MatchOptions } from "@keepfall/rules";
import type { Rapier } from "@keepfall/sim";
import { contentHash, currentVersions, makeSetup, MatchLog, readLog, writeLog, type ReplayFile } from "../src/matchLog";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);

/** Play a match with the given drivers, logging what it applies; return the file's text, the hash and the log. */
function playLogged(opts: MatchOptions, mode: "versus" | "guided", ticks: number, drive: (m: Match) => Array<{ step(): void }>) {
  const m = new Match(R, layout, opts);
  const log = new MatchLog();
  let applied = 0;
  m.onInput = (tick, team, input) => {
    applied++;
    log.record(tick, team, input);
  };
  const ais = drive(m);
  for (let i = 0; i < ticks; i++) {
    for (const a of ais) a.step();
    m.step();
  }
  const hash = m.hash();
  const text = writeLog(makeSetup(mode, opts, 1, 4, layout, "knight"), log.entries(), m.tick, hash);
  m.free();
  return { text, hash, applied, kept: log.entries().length };
}

/** Run a file's match from its inputs alone. */
function replay(file: ReplayFile) {
  const m = new Match(R, layout, file.setup.opts);
  for (const [tick, team, , input] of file.inputs) m.queue(tick, team as Team, input);
  while (m.tick < file.final.tick) m.step();
  const hash = m.hash();
  m.free();
  return hash;
}

test("Knight against Knight, logged with aim thinning, replays from the file alone to the same hash", () => {
  const opts: MatchOptions = { seed: 11, plan: false, rotate: false };
  const run = playLogged(opts, "versus", 60 * 60, (m) => [new AiPlayer(m, Team.Enemy, "knight", 11), new AiPlayer(m, Team.Player, "knight", 11)]);
  console.log("logged", run.applied, "applied inputs,", run.kept, "kept,", run.text.length, "bytes");
  assert.ok(run.kept < run.applied, "aim inputs were thinned");
  const read = readLog(run.text);
  assert.ok(read.ok, read.ok ? "" : read.why);
  if (!read.ok) return;
  assert.equal(read.log.final.tick, 3600);
  assert.deepEqual(replay(read.log), run.hash);
});

test("with a match observed, the same match hashes the same as with none", () => {
  const go = (observe: boolean) => {
    const m = new Match(R, layout, { seed: 11, plan: false, rotate: false });
    if (observe) m.onInput = () => {};
    const ais = [new AiPlayer(m, Team.Enemy, "knight", 11), new AiPlayer(m, Team.Player, "knight", 11)];
    for (let i = 0; i < 1200; i++) {
      for (const a of ais) a.step();
      m.step();
    }
    const h = m.hash();
    m.free();
    return h;
  };
  assert.deepEqual(go(true), go(false));
});

test("a guided-style match (its options, the tutor, a scripted player) replays from the file", () => {
  const opts: MatchOptions = { ...GUIDED_OPTIONS, seed: 31 };
  const run = playLogged(opts, "guided", 3000, (m) => {
    for (const [t, input] of GUIDED_MATCH_SCRIPT) m.queue(t, Team.Player, input);
    return [new AiPlayer(m, TUTOR_TEAM, "tutor", 31)];
  });
  const read = readLog(run.text);
  assert.ok(read.ok);
  if (!read.ok) return;
  assert.ok(read.log.inputs.length >= 3);
  assert.deepEqual(replay(read.log), run.hash);
});

test("the log keeps one aim in four and each team's latest aim before its next other input", () => {
  const log = new MatchLog();
  const aim = (n: number) => ({ kind: "aim" as const, emplacement: 0, yaw: n, pitch: 0 });
  for (let i = 0; i < 10; i++) log.record(i, 1, aim(i));
  // Kept: aims 0, 4, 8; the latest (9) is pending.
  assert.deepEqual(log.entries().map((e) => e[3].kind === "aim" ? e[3].yaw : -1), [0, 4, 8, 9]);
  log.record(20, 1, { kind: "order", order: 1 });
  const e = log.entries();
  assert.deepEqual(e.map((x) => x[0]), [0, 4, 8, 9, 20]);
  assert.equal(e[4][3].kind, "order");
  // The other team's aims are counted apart.
  log.record(21, 0, aim(100));
  assert.equal(log.entries().filter((x) => x[1] === 0).length, 1);
});

test("a file from other rules, other content, another format or no format is refused with its reason", () => {
  const opts: MatchOptions = { seed: 5, plan: false, rotate: false };
  const run = playLogged(opts, "versus", 30, () => []);
  const file = JSON.parse(run.text) as ReplayFile;
  const mod = (f: (x: ReplayFile) => void) => {
    const c = JSON.parse(run.text) as ReplayFile;
    f(c);
    return JSON.stringify(c);
  };
  assert.ok(readLog(run.text).ok);
  const now = currentVersions();
  assert.equal(now.content, contentHash(layout));
  let r = readLog(mod((c) => (c.setup.rulesVersion = now.rulesVersion + 1)));
  assert.ok(!r.ok && r.why === `This replay was saved with rules version ${now.rulesVersion + 1} (this game runs ${now.rulesVersion}): it would not play out the same.`, JSON.stringify(r));
  r = readLog(mod((c) => (c.setup.matchRulesVersion = 1)));
  assert.ok(!r.ok && /match rules version 1 /.test(r.why));
  r = readLog(mod((c) => (c.setup.content = "deadbeef")));
  assert.ok(!r.ok && /other content/.test(r.why));
  r = readLog(mod((c) => ((c as unknown as { v: number }).v = 2)));
  assert.ok(!r.ok && r.why === "This replay file is from another version of the game.");
  for (const junk of ["", "not json", "[]", "{}", "null", '{"format":"other"}', "42"]) {
    r = readLog(junk);
    assert.ok(!r.ok && r.why === "This is not a Keepfall replay.", junk);
  }
  // Malformed inputs and endings.
  r = readLog(mod((c) => c.inputs.push([5, 1, 0, { kind: "nonsense" } as never])));
  assert.ok(!r.ok && /input/.test(r.why));
  r = readLog(mod((c) => c.inputs.push([999999, 1, 0, { kind: "order", order: 1 }])));
  assert.ok(!r.ok);
  r = readLog(mod((c) => (c.final.hash.state = "zz")));
  assert.ok(!r.ok && /end/.test(r.why));
  r = readLog(mod((c) => ((c as unknown as { inputs: unknown }).inputs = "x")));
  assert.ok(!r.ok);
  assert.equal(file.setup.mode, "versus");
});

test("a replay whose inputs were changed does not end at the saved hash", () => {
  const opts: MatchOptions = { seed: 11, plan: false, rotate: false };
  const run = playLogged(opts, "versus", 1800, (m) => [new AiPlayer(m, Team.Enemy, "knight", 11), new AiPlayer(m, Team.Player, "knight", 11)]);
  const read = readLog(run.text);
  assert.ok(read.ok);
  if (!read.ok) return;
  const i = read.log.inputs.findIndex((e) => e[3].kind === "fire");
  assert.ok(i >= 0);
  read.log.inputs.splice(i, 1);
  assert.notDeepEqual(replay(read.log), run.hash);
});
