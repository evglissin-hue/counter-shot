// Army pass diagnosis (specialists): shared tracker for ladder crews, climbers,
// sappers and musketeers. Measures only; changes nothing in the sim.
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, inCourtyard, KEG, MUSKET, Unit, holdMarker, ROUTE_NAMES } from "@keepfall/content";
import { Action, Cause, Climb, LadderState, MinionState, NavKind, navCell, Order, SapperTask, type Minion, type Rapier } from "@keepfall/sim";
import { Match, type MatchOptions } from "@keepfall/rules";

await RD.init();
export const R = RD as unknown as Rapier;
export const layout = buildLayout(1, GAME_LAYOUT);
export const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;

export function newMatch(opts: Partial<MatchOptions> & { seed: number }): Match {
  return new Match(R, layout, { plan: false, rotate: false, ...opts } as MatchOptions);
}

export const ACT = ["walk", "stand", "fight", "batter", "work", "carry", "climb", "raise", "plant", "aim"];
export const LSTATE = ["carried", "raising", "planted", "down", "gone"];
export const STASK = ["carry", "plant", "run", "done"];
export const ORDER = ["advance", "hold", "push"];
export const CAUSE = ["?", "ball", "burst", "masonry", "blow", "fall", "musket", "?", "?"];
export const UNIT = ["pike", "mason", "ladder", "sapper", "musket", "boy"];
export const clock = (tick: number) => `${Math.floor(tick / 3600)}:${String(Math.floor(tick / 60) % 60).padStart(2, "0")}`;
export const sec = (t: number) => (t / 60).toFixed(1);

/** World z of a castle's front wall's outer face, its gate x = 0. */
export const FACE = (castle: number) => (castle === 0 ? -16 : -134);
export const gateDist = (castle: number, x: number, z: number) => Math.hypot(x, z - (castle === 0 ? -15 : -135));

/** Where a minion stands, in words, for the musketeers' and sappers' positions. */
export function where(m: Match, x: number, z: number): string {
  const c = navCell(x, z);
  const k = c >= 0 ? m.world.nav.kind[c] : -1;
  const parts: string[] = [];
  if (k === NavKind.Water) parts.push("WATER");
  for (let r = 0; r < 3; r++) {
    const b = (m.world.army as any).bridges[r];
    if (Math.abs(x - b.x) < b.width / 2 + 0.6 && Math.abs(z - b.z) < b.length / 2 + 0.5) parts.push(`on ${ROUTE_NAMES[r]} bridge`);
  }
  for (const castle of [0, 1]) {
    if (inCourtyard(castle, x, z)) parts.push(`in courtyard ${castle}`);
    const g = gateDist(castle, x, z);
    if (g < 5) parts.push(`at gate ${castle} (${g.toFixed(1)} m)`);
  }
  return parts.join(", ");
}

/** Per-minion phase bookkeeping: seconds in each phase, seconds still (moved < 0.15 m that second) in each. */
interface Rec {
  id: number;
  team: number;
  unit: number;
  born: number;
  phases: Map<string, { secs: number; still: number }>;
  lastX: number;
  lastZ: number;
  phase: string;
  log: string[];
  /** Ticks in the current still spell, and the longest still spell in a phase that means to move. */
  stillRun: number;
  worstStill: { secs: number; phase: string; at: string; tick: number };
}

export class Tracker {
  recs = new Map<number, Rec>();
  ladderLog: string[] = [];
  ladderState: number[] = [];
  ladderBorn: number[] = [];
  ladderPlantedAt: number[] = [];
  /** Per ladder: max (claims - counted claimers) seen, and ticks spent with claims >= queue. */
  claimLeak: number[] = [];
  queueFull: number[] = [];
  climbersOver: number[] = [];
  /** Per minion id: tick it began going for a ladder, and whether it got over. */
  claimAt = new Map<number, number>();
  claimResult = new Map<number, string>();
  /** Over-the-wall men: id -> tick reached the courtyard; then seconds by action inside. */
  inside = new Map<number, { at: number; acts: number[]; downAt: number; cause: number }>();
  shots = new Map<number, { shots: number; hits: number; targets: string[] }>();
  kegs: Array<{ id: number; tick: number; x: number; z: number; castle: number; downBefore: number; downAfter?: number; openAfter?: number }> = [];
  events: string[] = [];
  /** Per musketeer, positions when aiming (sampled each second). */
  aimSpots = new Map<number, string[]>();
  musketTargets = new Map<string, number>();
  private lastTask = new Map<number, number>();
  sapStand = new Map<string, number>();
  crewNoSpot = new Map<string, number>();
  muskStand = new Map<string, number>();
  /** Bursts seen: where, when, and who went down with them (by team). */
  bursts: Array<{ tick: number; x: number; y: number; z: number; r: number; down: [number, number]; downIds: string[] }> = [];
  private wasUp = new Set<number>();
  /** Per castle: seconds with pikes battering its gate, and minion-seconds of non-batterers standing at its door (within 3 m). */
  gate = [{ batter: 0, crowd: 0, crowdSecs: 0, pikesIdle: 0 }, { batter: 0, crowd: 0, crowdSecs: 0, pikesIdle: 0 }];
  private lastCool = new Map<number, number>();

  constructor(private m: Match, private verbose = false) {}

  note(s: string) {
    this.events.push(`${clock(this.m.tick)} ${s}`);
    if (this.verbose) console.log(`${clock(this.m.tick)} ${s}`);
  }

  phaseOf(n: Minion): string | null {
    const L = this.m.world.ladders!;
    const crew = (L as any).crewOf as Map<number, number>;
    if (crew.has(n.id)) {
      const lad = L.list[crew.get(n.id)!];
      const front = lad.front === n.id ? "front" : "back";
      return `crew:${LSTATE[lad.state]}:${front}`;
    }
    if (n.task >= Climb.ToLadder && n.task <= Climb.Down) return `climb:${["to", "wait", "up", "across", "down"][n.task - 10]}`;
    if (n.unit === Unit.Sapper) return `sapper:${STASK[n.task] ?? n.task}:${ACT[n.action]}`;
    if (n.unit === Unit.Musketeer) return `musket:${ACT[n.action]}`;
    if (n.unit === Unit.Ladder) return `ladderman:${ACT[n.action]}`;
    return null;
  }

  step() {
    const m = this.m, tick = m.tick;
    const W = m.world;
    const L = W.ladders!;
    // Events from the sim (read and cleared: nobody else reads them in a script).
    const ev = (W as any).events as number[];
    for (let k = 0; k + 4 < ev.length; k += 5) {
      const kind = ev[k];
      if (kind === 10) {
        const s = W.minions.list[ev[k + 1]];
        const castle = 1 - s.team;
        this.kegs.push({ id: s.id, tick, x: ev[k + 2], z: ev[k + 4], castle, downBefore: m.masonryDown(castle as 0 | 1) });
        this.note(`KEG set by sapper ${s.id} (team ${s.team}) at x ${ev[k + 2].toFixed(1)} z ${ev[k + 4].toFixed(1)}`);
      } else if (kind === 1) {
        this.bursts.push({ tick, x: ev[k + 1], y: ev[k + 2], z: ev[k + 3], r: ev[k + 4], down: [0, 0], downIds: [] });
      } else if (kind === 9) {
        const s = W.minions.list[ev[k + 1]];
        const r = this.shots.get(s.id) ?? { shots: 0, hits: 0, targets: [] };
        r.shots++;
        const t = s.target >= 0 ? W.minions.list[s.target] : null;
        if (t) {
          const tk = `${UNIT[t.unit]}${t.task >= 12 && t.task <= 14 ? "(climbing)" : ""}${t.role === 3 ? "(mason)" : t.role === 1 ? "(garrison)" : t.role === 4 ? "(gang)" : ""}`;
          this.musketTargets.set(tk, (this.musketTargets.get(tk) ?? 0) + 1);
          if (t.state !== MinionState.Upright && t.downCause === Cause.Musket) r.hits++;
          r.targets.push(`${tk}@${Math.hypot(t.x - s.x, t.z - s.z).toFixed(0)}m`);
        }
        this.shots.set(s.id, r);
      }
    }
    ev.length = 0;
    // Ladders.
    for (const lad of L.list) {
      if (this.ladderState[lad.id] === undefined) {
        this.ladderState[lad.id] = -1;
        this.ladderBorn[lad.id] = tick;
        this.claimLeak[lad.id] = 0;
        this.queueFull[lad.id] = 0;
        this.climbersOver[lad.id] = 0;
      }
      if (lad.state !== this.ladderState[lad.id]) {
        const f = W.minions.list[lad.front], b = W.minions.list[lad.back];
        const sp = lad.spot >= 0 ? L.spots[lad.spot] : null;
        const msg = `LADDER ${lad.id} (team ${lad.team}) ${LSTATE[this.ladderState[lad.id]] ?? "new"} -> ${LSTATE[lad.state]} after ${sec(tick - this.ladderBorn[lad.id])} s from muster; spot ${lad.spot}${sp ? ` (x ${sp.x})` : ""}; front ${f.id} at (${f.x.toFixed(1)}, ${f.z.toFixed(1)}) ${f.state === MinionState.Upright ? "up" : "DOWN:" + CAUSE[f.downCause ?? 0]}, back ${b.state === MinionState.Upright ? "up" : "DOWN:" + CAUSE[b.downCause ?? 0]}; order ${ORDER[m.army.order[lad.team]]}`;
        this.ladderLog.push(`${clock(tick)} ${msg}`);
        this.note(msg);
        if (lad.state === LadderState.Planted) this.ladderPlantedAt[lad.id] = tick;
        this.ladderState[lad.id] = lad.state;
      }
      if (lad.state === LadderState.Planted) {
        let counted = 0;
        for (const n of W.minions.list) if (n.state === MinionState.Upright && n.aux === lad.id && (n.task === Climb.ToLadder || n.task === Climb.Wait)) counted++;
        const leak = lad.claims - counted;
        if (leak > this.claimLeak[lad.id]) this.claimLeak[lad.id] = leak;
        if (lad.claims >= 10) this.queueFull[lad.id]++;
      }
    }
    // Who went down in a burst this tick (or the one before: the knock lands in the step).
    for (const n of W.minions.list) {
      if (n.state === MinionState.Upright) {
        this.wasUp.add(n.id);
        continue;
      }
      if (!this.wasUp.has(n.id)) continue;
      this.wasUp.delete(n.id);
      if (n.downCause !== Cause.Burst || n.wave < 0) continue;
      const b = [...this.bursts].reverse().find((b) => tick - b.tick <= 2 && Math.hypot(b.x - n.x, b.z - n.z) < 9);
      if (b) {
        b.down[n.team]++;
        b.downIds.push(`${n.team}${UNIT[n.unit]}${n.task >= 10 && n.task <= 14 ? "(" + ["to", "wait", "up", "across", "down"][n.task - 10] + ")" : n.action === 3 ? "(batter)" : ""}`);
      }
    }
    if (tick % 60 === 0) {
      for (const c of [0, 1]) {
        const gz = c === 0 ? -16.5 : -133.5;
        let bat = 0, crowd = 0, pikeIdle = 0;
        for (const n of W.minions.list) {
          if (n.state !== MinionState.Upright || n.team === c || n.wave < 0) continue;
          if (Math.abs(n.x) > 3.2 || Math.abs(n.z - gz) > 2.5) continue;
          if (n.action === 3) bat++;
          else if (n.unit !== Unit.Pikeman) crowd++;
          else if (n.action === 1) pikeIdle++;
        }
        if (bat) this.gate[c].batter++;
        this.gate[c].crowd += crowd;
        if (crowd) this.gate[c].crowdSecs++;
        this.gate[c].pikesIdle += pikeIdle;
      }
    }
    // Minions of interest.
    for (const n of W.minions.list) {
      const prevTask = this.lastTask.get(n.id) ?? -99;
      if (n.state !== MinionState.Upright) {
        const r = this.recs.get(n.id);
        if (r && r.phase !== "dead") {
          r.log.push(`${clock(tick)} down (${CAUSE[n.downCause ?? 0]}) in ${r.phase}`);
          r.phase = "dead";
        }
        const ins = this.inside.get(n.id);
        if (ins && ins.downAt < 0) {
          ins.downAt = tick;
          ins.cause = n.downCause ?? 0;
        }
        if (this.claimAt.has(n.id) && !this.claimResult.has(n.id)) this.claimResult.set(n.id, `down (${CAUSE[n.downCause ?? 0]}) while ${["to", "wait", "up", "across", "down"][prevTask - 10] ?? "?"}`);
        continue;
      }
      // Claims and the way over.
      if (n.task === Climb.ToLadder && prevTask !== Climb.ToLadder && !this.claimAt.has(n.id)) this.claimAt.set(n.id, tick);
      if (n.task === Climb.Wait && prevTask !== Climb.Wait && !this.claimAt.has(n.id)) this.claimAt.set(n.id, tick); // the crew
      if (prevTask === Climb.Down && n.task === Climb.None) {
        this.inside.set(n.id, { at: tick, acts: new Array(10).fill(0), downAt: -1, cause: 0 });
        this.claimResult.set(n.id, `over in ${sec(tick - (this.claimAt.get(n.id) ?? tick))} s`);
        const lad = L.list.find((l) => l.spot >= 0 && Math.abs(L.spots[l.spot].x - n.x) < 0.5 && L.spots[l.spot].castle !== n.team);
        if (lad) this.climbersOver[lad.id]++;
      }
      if ((prevTask === Climb.ToLadder || prevTask === Climb.Wait) && n.task === Climb.None && !this.claimResult.has(n.id)) this.claimResult.set(n.id, `released from ${["to", "wait"][prevTask - 10]} (ladder ${n.aux})`);
      // Sapper task changes.
      if (n.unit === Unit.Sapper && prevTask !== n.task && prevTask !== -99) {
        const r = this.rec(n);
        r.log.push(`${clock(tick)} ${STASK[prevTask] ?? prevTask} -> ${STASK[n.task] ?? n.task} at (${n.x.toFixed(1)}, ${n.z.toFixed(1)}) ${where(m, n.x, n.z)}`);
      }
      this.lastTask.set(n.id, n.task);
      const ins = this.inside.get(n.id);
      if (ins) ins.acts[n.action]++;
      const ph = this.phaseOf(n);
      if (!ph) continue;
      const r = this.rec(n);
      if (ph !== r.phase) {
        if (this.verbose && r.phase !== "") r.log.push(`${clock(tick)} ${r.phase} -> ${ph}`);
        r.phase = ph;
      }
      if ((tick - r.born) % 60 === 59) {
        const moved = Math.hypot(n.x - r.lastX, n.z - r.lastZ);
        r.lastX = n.x;
        r.lastZ = n.z;
        const p = r.phases.get(ph) ?? { secs: 0, still: 0 };
        p.secs++;
        if (moved < 0.15) p.still++;
        r.phases.set(ph, p);
        // A still spell in a phase that means to move (walking, carrying, going to a ladder, a sapper carrying).
        const moving = /crew:carried|climb:to|sapper:carry|sapper:run|musket:walk|ladderman:walk/.test(ph);
        if (moved < 0.15 && moving) {
          r.stillRun++;
          if (r.stillRun > r.worstStill.secs) r.worstStill = { secs: r.stillRun, phase: ph, at: `(${n.x.toFixed(1)}, ${n.z.toFixed(1)}) ${where(m, n.x, n.z)}`, tick };
        } else r.stillRun = 0;
        // Where sappers stand while still carrying, and crews carry with no spot near the enemy wall.
        if (n.unit === Unit.Sapper && n.task === 0 && n.action === 1) {
          const f = FACE(1 - n.team), d = (n.z - f) * (n.team === 1 ? -1 : 1);
          const key = `team ${n.team} ${ORDER[m.army.order[n.team]]} ${d <= KEG.near ? "STEERING (aux " + n.aux + ")" : "marching"} near (${Math.round(n.x / 4) * 4}, ${Math.round(n.z / 4) * 4}) ${where(m, n.x, n.z)}`;
          this.sapStand.set(key, (this.sapStand.get(key) ?? 0) + 1);
        }
        if (ph.startsWith("crew:carried")) {
          const lad = L.list[((L as any).crewOf as Map<number, number>).get(n.id)!];
          const wall = 1 - n.team === 0 ? -16 : -134;
          if (lad.spot < 0 && Math.abs(n.z - wall) < 34) {
            const key = `team ${n.team} ${ORDER[m.army.order[n.team]]} ${ACT[n.action]} ${Math.abs(n.x) < 30 ? "" : "|x|>=30 "}${where(m, n.x, n.z) || "near wall"}`;
            this.crewNoSpot.set(key, (this.crewNoSpot.get(key) ?? 0) + 1);
          }
        }
        if (n.unit === Unit.Musketeer && n.action === 1) {
          const key = `team ${n.team} ${ORDER[m.army.order[n.team]]} ${where(m, n.x, n.z) || "field z~" + Math.round(n.z / 10) * 10}`;
          this.muskStand.set(key, (this.muskStand.get(key) ?? 0) + 1);
        }
        if (n.unit === Unit.Musketeer && n.action === 9) {
          const a = this.aimSpots.get(n.id) ?? [];
          if (a.length < 400) a.push(`${n.x.toFixed(0)},${n.z.toFixed(0)}${where(m, n.x, n.z) ? " " + where(m, n.x, n.z) : ""}`);
          this.aimSpots.set(n.id, a);
        }
      }
    }
    // Kegs: masonry down 10 s after.
    for (const k of this.kegs) {
      if (k.downAfter === undefined && tick - k.tick >= KEG.fuse + 600) {
        k.downAfter = m.masonryDown(k.castle as 0 | 1);
        let open = 0;
        for (let dx = -3; dx <= 3; dx += 0.5) {
          const c = navCell(k.x + dx, FACE(k.castle) + (k.castle === 0 ? 1.0 : -1.0));
          const kk = W.nav.kind[c];
          if (kk === NavKind.Ground || kk === NavKind.Rubble) open++;
        }
        k.openAfter = open;
      }
    }
  }

  rec(n: Minion): Rec {
    let r = this.recs.get(n.id);
    if (!r) {
      r = { id: n.id, team: n.team, unit: n.unit, born: this.m.tick, phases: new Map(), lastX: n.x, lastZ: n.z, phase: "", log: [], stillRun: 0, worstStill: { secs: 0, phase: "", at: "", tick: 0 } };
      this.recs.set(n.id, r);
    }
    return r;
  }

  /** Seconds per phase over all minions of a unit kind (or all crew/climb phases). */
  summary(filter: (r: Rec) => boolean): string {
    const tot = new Map<string, { secs: number; still: number }>();
    let n = 0;
    for (const r of this.recs.values()) {
      if (!filter(r)) continue;
      n++;
      for (const [k, v] of r.phases) {
        const t = tot.get(k) ?? { secs: 0, still: 0 };
        t.secs += v.secs;
        t.still += v.still;
        tot.set(k, t);
      }
    }
    const rows = [...tot.entries()].sort((a, b) => b[1].secs - a[1].secs).map(([k, v]) => `    ${k.padEnd(28)} ${String(v.secs).padStart(6)} s  (still ${v.still} s)`);
    return `  ${n} minions\n${rows.join("\n")}`;
  }

  report(title: string) {
    const m = this.m;
    console.log(`\n===== ${title} (ended ${clock(m.tick)}) =====`);
    console.log("-- ladders --");
    for (const s of this.ladderLog) console.log("  " + s);
    const L = m.world.ladders!;
    for (const lad of L.list) {
      console.log(`  ladder ${lad.id} team ${lad.team}: now ${LSTATE[lad.state]}, spot ${lad.spot}, claims ${lad.claims}, on ${lad.on.length}, max claim leak ${this.claimLeak[lad.id]}, ${sec(this.queueFull[lad.id])} s with queue full, ${this.climbersOver[lad.id]} men over`);
    }
    const res = new Map<string, number>();
    for (const [id] of this.claimAt) {
      const r = this.claimResult.get(id) ?? `still ${["to", "wait", "up", "across", "down"][m.world.minions.list[id].task - 10] ?? "none?"} after ${sec(m.tick - this.claimAt.get(id)!)} s`;
      const key = r.replace(/[\d.]+ s/, "N s").replace(/\(ladder \d+\)/, "");
      res.set(key, (res.get(key) ?? 0) + 1);
    }
    console.log(`  men who went for a ladder: ${this.claimAt.size}; outcomes: ${[...res.entries()].map(([k, v]) => `${v}x ${k}`).join("; ")}`);
    const overT = [...this.claimResult.values()].filter((s) => s.startsWith("over")).map((s) => Number(s.split(" ")[2]));
    if (overT.length) console.log(`  claim to courtyard: min ${Math.min(...overT).toFixed(0)} s, median ${overT.sort((a, b) => a - b)[overT.length >> 1].toFixed(0)} s, max ${Math.max(...overT).toFixed(0)} s`);
    if (this.inside.size) {
      const acts = new Array(10).fill(0);
      let survived = 0, life = 0;
      for (const v of this.inside.values()) {
        for (let k = 0; k < 10; k++) acts[k] += v.acts[k];
        if (v.downAt < 0) survived++;
        life += ((v.downAt < 0 ? m.tick : v.downAt) - v.at) / 60;
      }
      const tot = acts.reduce((a, b) => a + b, 0) || 1;
      const det = [...this.inside.entries()].map(([id, v]) => `${id}@${clock(v.at)}${v.downAt >= 0 ? `+${sec(v.downAt - v.at)}s:${CAUSE[v.cause]}` : ":up"}`).join(" ");
      const gar = m.world.minions.list.filter((g) => g.role === 1);
      console.log(`  garrisons: castle 0 ${gar.filter((g) => g.team === 0 && g.state === MinionState.Upright).length}/${gar.filter((g) => g.team === 0).length} up, castle 1 ${gar.filter((g) => g.team === 1 && g.state === MinionState.Upright).length}/${gar.filter((g) => g.team === 1).length} up; arrivals: ${det}`);
      console.log(`  over the wall: ${this.inside.size} men, ${survived} still up; mean life inside ${(life / this.inside.size).toFixed(0)} s; actions inside: ${acts.map((v, k) => (v ? `${ACT[k]} ${((100 * v) / tot).toFixed(0)}%` : "")).filter(Boolean).join(", ")}`);
    }
    console.log("-- crew and climb phases (seconds) --");
    console.log(this.summary((r) => [...r.phases.keys()].some((k) => k.startsWith("crew") || k.startsWith("climb") || k.startsWith("ladderman"))));
    console.log("-- sappers --");
    console.log(this.summary((r) => r.unit === Unit.Sapper));
    for (const r of this.recs.values()) if (r.unit === Unit.Sapper) console.log(`  sapper ${r.id} (team ${r.team}): ${r.log.join(" | ")}${r.worstStill.secs >= 5 ? ` | worst still ${r.worstStill.secs} s in ${r.worstStill.phase} at ${r.worstStill.at}` : ""}`);
    for (const k of this.kegs) console.log(`  keg by ${k.id} at ${clock(k.tick)} x ${k.x.toFixed(1)} z ${k.z.toFixed(1)}: masonry down ${k.downBefore} -> ${k.downAfter ?? "?"}, open cells at the foot ${k.openAfter ?? "?"}/13`);
    for (const b of this.bursts) if (b.down[0] + b.down[1] > 0 || this.kegs.some((k) => Math.abs(k.x - b.x) < 1 && Math.abs(b.tick - k.tick - KEG.fuse) < 3)) console.log(`  burst at ${clock(b.tick)} (${b.x.toFixed(1)}, ${b.y.toFixed(1)}, ${b.z.toFixed(1)}) r ${b.r.toFixed(1)}${this.kegs.some((k) => Math.abs(k.x - b.x) < 1 && Math.abs(b.tick - k.tick - KEG.fuse) < 3) ? " [set keg]" : ""}: down team0 ${b.down[0]}, team1 ${b.down[1]} ${b.downIds.join(" ")}`);
    for (const c of [0, 1]) console.log(`  gate ${c}: ${this.gate[c].batter} s with someone battering; ${this.gate[c].crowdSecs} s with non-pikes standing at the door (${this.gate[c].crowd} minion-s); ${this.gate[c].pikesIdle} pike-s standing idle at it`);
    console.log("-- musketeers --");
    console.log(this.summary((r) => r.unit === Unit.Musketeer));
    let shots = 0, hits = 0;
    for (const v of this.shots.values()) {
      shots += v.shots;
      hits += v.hits;
    }
    console.log(`  shots ${shots}, hits seen at once ${hits}; targets: ${[...this.musketTargets.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}`);
    const spots = new Map<string, number>();
    for (const a of this.aimSpots.values()) for (const s of a) {
      const tag = s.includes(" ") ? s.slice(s.indexOf(" ") + 1) : "field";
      spots.set(tag, (spots.get(tag) ?? 0) + 1);
    }
    console.log(`  aiming seconds by place: ${[...spots.entries()].map(([k, v]) => `${k} ${v}`).join("; ")}`);
    const top = (mp: Map<string, number>, k = 12) => [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([a, b]) => `    ${b} s  ${a}`).join("\n");
    console.log("-- sapper seconds standing while still carrying the keg (by place) --\n" + top(this.sapStand));
    console.log("-- crew seconds carrying with no spot within 34 m of the enemy wall --\n" + top(this.crewNoSpot));
    console.log("-- musketeer seconds standing (not aiming) --\n" + top(this.muskStand));
    const worst = [...this.recs.values()].filter((r) => r.worstStill.secs >= 8).sort((a, b) => b.worstStill.secs - a.worstStill.secs).slice(0, 12);
    console.log("-- longest still spells while meaning to move (>= 8 s) --");
    for (const r of worst) console.log(`  ${UNIT[r.unit]} ${r.id} team ${r.team}: ${r.worstStill.secs} s in ${r.worstStill.phase} from ${clock(r.worstStill.tick - r.worstStill.secs * 60)} at ${r.worstStill.at}`);
  }
}

export { Action, Cause, Climb, LadderState, MinionState, Order, SapperTask, Unit, MUSKET, KEG, holdMarker };

/** Is there a way in for a team's waves (the breach field reaches its muster), and how many metres of the enemy front wall's row are open? */
export function wayIn(m: Match, team: number): string {
  const A = m.army as any;
  const f = 6 + team;
  const z0 = team === 1 ? -100 : -50;
  const reach = A.flow.at(f, 0, z0) < 1e8;
  const castle = 1 - team;
  let open = 0;
  for (let x = -14; x <= 14; x += 0.5) {
    if (Math.abs(x) <= 2.2) continue;
    const c = navCell(x, castle === 0 ? -15 : -135);
    const k = m.world.nav.kind[c];
    if (k === NavKind.Ground || k === NavKind.Rubble) open++;
  }
  return `breach field reaches z ${z0}: ${reach}; open half-metres along castle ${castle}'s front wall: ${open}`;
}
