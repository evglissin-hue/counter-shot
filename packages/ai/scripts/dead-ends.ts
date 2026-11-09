// The dead-end hunt (see "Build and review loop" in docs/handoff.md): play a
// match with an AI on either side (or a side left idle) and flag what a player
// would get stuck on. Since the round after M5 it watches the guns that can be
// knocked out: a gun out for minutes (its masonry never rebuilt), an empty slot
// that cannot be bought because the masonry under it is down, a gunner who
// stops firing, gold piling up unspent; and, before the match, every gun on a
// wall or a tower must stand on masonry (or it could never fall with it).
// Prints one line per flag and a summary; exits 1 if anything was flagged.
// npx rolldown packages/ai/scripts/dead-ends.ts --format esm --platform node -o node_modules/.scratch/dead-ends.mjs && node node_modules/.scratch/dead-ends.mjs [enemy=knight|idle] [player=knight|idle] [secs=720] [seed=21]
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, sectionOf, WEAPON_COST, type Difficulty } from "@keepfall/content";
import type { Rapier } from "@keepfall/sim";
import { Match } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const sides = [arg("enemy", "knight"), arg("player", "knight")];
const secs = Number(arg("secs", "720")), seed = Number(arg("seed", "21"));
/** How long (s) a gun may stay out, a slot stay blocked, a gunner stay idle, or gold pile up before it is flagged. */
const LIMIT = { out: Number(arg("out", "240")), blocked: 240, idle: 150, gold: 600, goldFor: 180 };

const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false });
const ais = sides.map((s, team) => (s === "idle" ? null : new AiPlayer(m, team, s as Difficulty, seed)));
const M = m.world.mounts;
const castleOf = (i: number) => (m.emplacements[i].z < -75 ? 1 : 0);
const flags: string[] = [];
const clock = (tick: number) => `${Math.floor(tick / 3600)}:${String(Math.floor(tick / 60) % 60).padStart(2, "0")}`;
const flag = (tick: number, text: string) => {
  flags.push(`${clock(tick)} ${text}`);
  console.log(`FLAG ${clock(tick)} ${text}`);
};

// Static: a gun on a wall walk or a tower stands on masonry (a mortar stands on the ground in its pit), and masons
// rebuild every stone of it (a stone of no repair section, once down, would keep its gun out for good).
const section = sectionOf(m.world.castle.layout);
for (let i = 0; i < m.emplacements.length; i++) {
  const e = m.emplacements[i];
  const onGround = e.y < 3;
  if (!onGround && M.pieces[i].length === 0) flag(0, `slot ${i} (castle ${castleOf(i)}, ${e.place ?? e.weapon}) stands on no masonry: it can never fall with its tower or wall`);
  const lost = Array.from(M.pieces[i]).filter((id) => section[id] < 0).length;
  if (lost) flag(0, `slot ${i} (castle ${castleOf(i)}, ${e.place ?? e.weapon}) stands on ${lost} stones no masons rebuild: once down, its gun is out for good`);
}

const n = m.emplacements.length;
const report = new Int16Array(n * 2);
/** Since when (tick) each emplacement has been out, or its empty slot blocked; -1 when not. */
const outSince = new Int32Array(n).fill(-1), blockedSince = new Int32Array(n).fill(-1);
const outFlagged = new Uint8Array(n), blockedFlagged = new Uint8Array(n);
const lastShot = [0, 0], shotsSeen = [0, 0], idleFlagged = [false, false];
const richSince = [-1, -1], richFlagged = [false, false];
/** Every spell out: [castle, seconds]. */
const spells: [number, number][] = [];
const cheapest = (i: number) => Math.min(...(m.emplacements[i].allowed ?? [m.emplacements[i].weapon]).map((k) => WEAPON_COST[k]));
const WAIT = ["", "its crew", "its masonry", "gold"];

for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
  for (const ai of ais) ai?.step();
  m.step();
  if (tick % 60 !== 59) continue;
  const t = m.tick;
  M.report(t, report);
  for (let i = 0; i < n; i++) {
    const e = m.emplacements[i], c = castleOf(i), st = report[i * 2];
    if (e.empty) {
      // An empty slot whose masonry is down cannot be bought: flag it if its castle could pay for a gun all that time.
      const blocked = st === 2 && m.gold[c] >= cheapest(i);
      if (blocked && blockedSince[i] < 0) blockedSince[i] = t;
      if (!blocked) blockedSince[i] = -1;
      if (blocked && !blockedFlagged[i] && t - blockedSince[i] > LIMIT.blocked * 60) {
        blockedFlagged[i] = 1;
        flag(t, `castle ${c}'s empty slot ${i} (${e.place ?? "slot"}) could not be bought for ${LIMIT.blocked} s: its masonry is down (${Math.round(M.standing(i) * 100)}% stands; ${c ? "player" : "enemy"} repairs ${JSON.stringify(m.repairs[c])})`);
      }
      continue;
    }
    if (st !== 0 && outSince[i] < 0) outSince[i] = t;
    if (st === 0 && outSince[i] >= 0) {
      spells.push([c, (t - outSince[i]) / 60]);
      outSince[i] = -1;
      outFlagged[i] = 0;
    }
    if (st !== 0 && !outFlagged[i] && t - outSince[i] > LIMIT.out * 60) {
      outFlagged[i] = 1;
      flag(t, `castle ${c}'s ${e.weapon} (${i}, ${e.place ?? "slot"}) out for ${LIMIT.out} s, waiting for ${WAIT[st]} (${Math.round(M.standing(i) * 100)}% of its masonry stands; repairs ${JSON.stringify(m.repairs[c])})`);
    }
  }
  for (const c of [0, 1]) {
    if (!ais[c]) continue;
    if (m.shots[c] !== shotsSeen[c]) {
      shotsSeen[c] = m.shots[c];
      lastShot[c] = t;
      idleFlagged[c] = false;
    }
    const anyUp = m.emplacements.some((e, i) => castleOf(i) === c && !e.empty && M.up(i));
    if (anyUp && !idleFlagged[c] && t - lastShot[c] > LIMIT.idle * 60) {
      idleFlagged[c] = true;
      flag(t, `castle ${c}'s gunner (${sides[c]}) fired nothing by hand for ${LIMIT.idle} s with a gun up`);
    }
    // The Squire's plan is short and slow on purpose (seven steps, the last after ten minutes): once it is done, its gold piles up by design.
    if (sides[c] === "squire") continue;
    if (m.gold[c] > LIMIT.gold && richSince[c] < 0) richSince[c] = t;
    if (m.gold[c] <= LIMIT.gold) richSince[c] = -1;
    if (richSince[c] >= 0 && !richFlagged[c] && t - richSince[c] > LIMIT.goldFor * 60) {
      richFlagged[c] = true;
      flag(t, `castle ${c} (${sides[c]}) sat on more than ${LIMIT.gold} gold for ${LIMIT.goldFor} s (${m.gold[c]} now)`);
    }
  }
}

const end = m.tick;
for (let i = 0; i < n; i++) if (outSince[i] >= 0) spells.push([castleOf(i), (end - outSince[i]) / 60]);
const summary = [0, 1].map((c) => {
  const s = spells.filter((x) => x[0] === c).map((x) => x[1]).sort((a, b) => a - b);
  const med = s.length ? s[Math.floor(s.length / 2)] : 0;
  return `castle ${c} (${sides[c]}): ${s.length} knock-outs, median ${med.toFixed(0)} s out, longest ${(s[s.length - 1] ?? 0).toFixed(0)} s, ${m.shots[c]} shots by hand, silenced ${m.economy.silenced[c]}`;
});
console.log(`seed ${seed}, ${sides[0]} (castle 0) against ${sides[1]} (castle 1), ${clock(end)} played: ${m.result ? (m.result.winner < 0 ? `a draw (${m.result.reason})` : `won by castle ${m.result.winner} (${m.result.reason})`) : "no result yet"}`);
for (const s of summary) console.log("  " + s);
console.log(flags.length ? `${flags.length} flagged` : "nothing flagged");
m.free();
process.exit(flags.length ? 1 : 0);
