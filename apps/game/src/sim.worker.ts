// The simulation runs here at a fixed 60 Hz, off the main thread: the
// Practice range (the sandbox), a match against the AI castle (M5: the AI
// commands the enemy from here, by inputs), or a match against a friend
// online (M5: lockstep; the page carries each side's inputs to the other). The
// page sends inputs; the worker tags each with a tick, steps the sim and posts
// what changed.

import { ASHWRIGHT_EMPLACEMENTS, boxSize, buildLayout, CASTLE_SHAPE, Earn, UNMANNED, GAME_LAYOUT, KEEP_STOREYS, MIX_NAMES, PLOTS, REGISTER, ROUTE_NAMES, shotCost, STORM, UPGRADE_KINDS, WEAPON_KINDS, type CastleLayout, type Emplacement } from "@keepfall/content";
import { AiPlayer } from "@keepfall/ai";
import { GUIDED_OPTIONS, Match, Register, Team, teamOf, TUTOR_TEAM, type MatchInput, type MatchOptions, type RegisterHost } from "@keepfall/rules";
import { RULES_VERSION, SandboxSim, type Rapier } from "@keepfall/sim";
import { BUTTRESS_FACES, STRUCTURE } from "@keepfall/content";
import { Lockstep, netHash } from "./lockstep";
import { MatchLog, makeSetup, writeLog, type LoggedMode, type ReplayFile, type ReplaySetup } from "./matchLog";
import { NET_VERSION } from "./net";
import { LANE_COUNT, laneSummary } from "./threat";
import { FOOT_COURSES, SECTION_COUNT, sectionOf } from "./minimap";
import { placeName } from "./marks";
import { BOX_STRIDE, BOY_STRIDE, EARN_STRIDE, type FromWorker, type MarkInfo, type MatchInfo, type StructureInfo, type MatchSetup, type Mode, type NavInfo, type RegisterInfo, type ToWorker } from "./protocol";

/** The page's number for the world being run (init and reset carry it): every message says which world it is from. */
let gen = 0;
const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage({ ...msg, gen }, transfer);
const DT = 1000 / 60;

let R: Rapier | null = null;
let sim: SandboxSim | null = null;
let match: Match | null = null;
let layout: CastleLayout | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
let acc = 0;
let speed = 1;
let paused = false;
let stepEma = 0;
/** The slowest step in the current and the previous second, for the HUD. */
let peakNow = 0, peakLast = 0, peakTicks = 0;
/** Test clock: the page advances the sim itself, frame by frame. */
let manual = false;
/** Nav overlay: send the grid when it changes, at most a few times a second. */
let navOn = false;
/** Online: the page left the match; the world stands still until the next one. */
let stopped = false;
let navSent = -1;
let navAt = 0;
let bridgesSent = -1;
/** The match's end is reported once with the masonry counts. */
let endSent = false;
/** Each castle's gate leaves (stone ids). */
let gateLeaves: [number[], number[]] = [[], []];
/** M5: the team this page plays, the AI commanding the other (Versus AI, or a friend's castle once they have gone), and the lockstep with a friend online. */
let me: Team = Team.Player;
let ai: AiPlayer | null = null;
let net: Lockstep | null = null;
let matchSeed = 0;
/** Online: since when the match has been waiting for the friend (ms), and when this side's state last went to the page. */
let waitingSince = 0;
let netSentAt = 0;
let netDirty = true;
/**
 * 3.2: the Practice range's register (one team, its four guns: the register runs on the page's
 * worker only, never in the pinned session) and the gun the page rides there (-1: none).
 */
let practiceReg: Register | null = null;
let practiceManned = -1;
/** The bearing counts of the marks as last worked out (they cost a solve per gun, so a few times a second): by mark and the tick it was made. */
const bearCache = new Map<string, number[]>();
let bearAt = -1e9;
/** S6: the log of the match being played (every input it applies), and its setup for the file. */
let matchLog: MatchLog | null = null;
let logSetup: ReplaySetup | null = null;
/** S6: a replay being watched: the tick it stops at, and whether it has been reported (the file's hash is compared then). */
let watching: ReplayFile | null = null;
let watchSent = false;

async function load(): Promise<Rapier> {
  if (R) return R;
  const m = await import("@dimforge/rapier3d-deterministic-compat");
  const r = (m.default ?? m) as unknown as Rapier;
  await r.init();
  R = r;
  return r;
}

/**
 * A throwaway sim bursts two shells and steps a little at load, so the
 * JavaScript and WebAssembly behind a burst are compiled before the player's
 * first one (that first burst used to stall the frames for about 100 ms).
 * It never touches the real sim.
 */
function rehearse() {
  if (!R || !layout) return;
  const r = new SandboxSim(R, layout, { seed: 1, minions: 2 });
  r.explode(0, 19.3, -0.6);
  r.explode(15, 11.6, -15);
  for (let i = 0; i < 45; i++) r.step();
  r.free();
}

function build(mode: Mode, seed: number, minions: number, setup: MatchSetup = {}, replay?: ReplayFile) {
  if (!R) return;
  sim?.free();
  const t0 = performance.now();
  layout ??= buildLayout(1, GAME_LAYOUT);
  gateLeaves = [0, 1].map((c) => layout!.stones.filter((st) => st.part === "gate" && st.castle === c).map((st) => st.id)) as [number[], number[]];
  keepBoards = [0, 1].map((c) => KEEP_STOREYS.map((course) => layout!.stones.filter((st) => st.part === "storey" && st.castle === c && st.course === course - 1).map((st) => st.id)));
  sectionOfPiece = Int8Array.from(layout.stones.map(sectionOf));
  sectionTotal = new Uint16Array(2 * SECTION_COUNT * 2);
  layout.stones.forEach((st, i) => {
    const k = sectionOfPiece[i];
    if (k < 0) return;
    const at = (st.castle * SECTION_COUNT + k) * 2;
    sectionTotal[at]++;
    if (st.course < FOOT_COURSES) sectionTotal[at + 1]++;
  });
  sectionsAt = -1;
  structureAt = -1;
  structBounds = null;
  ai = null;
  net = null;
  stopped = false;
  practiceReg = null;
  practiceManned = -1;
  bearCache.clear();
  bearAt = -1e9;
  me = Team.Player;
  matchSeed = seed;
  if (watching) speed = 1; // the speed of a replay does not carry into the next match
  matchLog = null;
  logSetup = null;
  watching = null;
  watchSent = false;
  /** The options the match is built from: the log's setup records them as they were. */
  let opts: MatchOptions | null = null;
  if (mode === "watch" && replay) {
    // S6: a saved match played again from its file: the same options, every logged input queued on its tick, nobody driving it.
    watching = replay;
    speed = 1;
    opts = replay.setup.opts;
    me = replay.setup.team === 0 ? Team.Enemy : Team.Player;
    match = new Match(R, layout, opts);
    sim = match.world;
    for (const [tick, team, , input] of replay.inputs) match.queue(tick, team === 0 ? Team.Enemy : Team.Player, input);
  } else if (mode === "guided") {
    // M6: the guided first match: the tutor commands the enemy castle (it starts without a barracks; your waves start on Hold).
    opts = { ...GUIDED_OPTIONS, seed };
    match = new Match(R, layout, opts);
    sim = match.world;
    ai = new AiPlayer(match, TUTOR_TEAM, "tutor", seed);
  } else if (mode === "versus" || mode === "online") {
    // Someone commands the enemy castle now (the AI, or a friend): no fixed build order, no routes in turn.
    opts = { seed, plan: false, rotate: false };
    match = new Match(R, layout, opts);
    sim = match.world;
    if (mode === "versus") ai = new AiPlayer(match, Team.Enemy, setup.difficulty ?? "knight", seed);
    else {
      me = setup.team === 0 ? Team.Enemy : Team.Player;
      net = new Lockstep(match, me, me === Team.Player ? Team.Enemy : Team.Player, setup.delay ?? 8);
      waitingSince = performance.now();
      netDirty = true;
    }
  } else {
    match = null;
    sim = new SandboxSim(R, layout, { seed, minions });
    // 3.2: marks and salvos with the range's four guns (the page's team owns every one; the gun it rides fires its salvo shot with its own aim left alone).
    const range = sim;
    practiceReg = new Register(
      { world: range, emplacements: range.emplacements, owner: (id) => (id < ASHWRIGHT_EMPLACEMENTS.length ? Team.Player : -1), manned: (team) => (team === Team.Player ? practiceManned : -1), reloadScale: () => 1 },
      seed,
    );
  }
  if (match && opts && mode !== "watch") {
    // S6: every match keeps a log of what it applied (Match.onInput changes nothing in it).
    const log = (matchLog = new MatchLog());
    match.onInput = (tick, team, input) => log.record(tick, team, input);
    logSetup = makeSetup(mode as LoggedMode, opts, me as 0 | 1, NET_VERSION, layout, mode === "versus" ? (setup.difficulty ?? "knight") : undefined);
  }
  navSent = -1;
  bridgesSent = -1;
  endSent = false;
  post({ t: "ready", mode, stones: sim.castle.layout.stones.length, setupMs: Math.round(performance.now() - t0), terrain: sim.terrain.fullPatch(), rulesVersion: RULES_VERSION });
}

/** The lane summary's buffer (the page gets a copy each time: the message is cloned). */
const lanesBuf = new Int16Array(LANE_COUNT);

function matchInfo(): MatchInfo | null {
  if (!match) return null;
  const ended = !!match.result;
  const army = match.army;
  const counts = match.armyCounts();
  const guns = new Float32Array(match.guns.length * 2);
  match.guns.forEach((g, i) => guns.set([g.yaw, g.pitch], i * 2));
  const hits = (c: 0 | 1) => gateLeaves[c].reduce((n, id) => n + (army.gateHits.get(id) ?? 0), 0);
  const open = (c: 0 | 1) => gateLeaves[c].some((id) => match!.world.castle.dynamic[id] === 1);
  const works = match.world.works!;
  const mason = (c: 0 | 1) => {
    const w = works.status(c);
    return { job: w.job, left: w.left, hold: w.hold, up: w.masons, laid: w.laid };
  };
  const L = match.world.ladders!;
  const info: MatchInfo = {
    team: me as 0 | 1,
    tick: match.tick,
    gold: [match.gold[0], match.gold[1]],
    result: match.result,
    shots: [match.shots[0], match.shots[1]],
    masonry: ended && !endSent ? [match.masonryDown(0), match.masonryDown(1)] : null,
    nextWave: match.nextWaveIn(),
    waves: [match.waves[0], match.waves[1]],
    route: match.route[me],
    order: army.order[me],
    standing: counts.standing,
    fallen: counts.fallen,
    autoShots: [match.autoShots[0], match.autoShots[1]],
    guns,
    gateHits: [hits(0), hits(1)],
    gateOpen: [open(0), open(1)],
    storm: [match.storm[0], match.storm[1]],
    stormHold: STORM.hold,
    attackers: [army.attackers[0], army.attackers[1]],
    defenders: [army.defenders[0], army.defenders[1]],
    garrison: [army.garrisonCount(0), army.garrisonCount(1)],
    suddenDeath: match.suddenDeath,
    repairs: { ...match.repairs[me] },
    masons: [mason(0), mason(1)],
    ladders: [L.plantedAt(0), L.plantedAt(1)],
    down: match.tick % 60 < 2 || ended ? [match.masonryDown(0), match.masonryDown(1)] : null,
    stats: ended && !endSent ? [match.stats(Team.Enemy), match.stats(Team.Player)] : null,
    keeps: [keepFloors(match, 0), keepFloors(match, 1)],
    keepFloor: [floorSound(match, 0), floorSound(match, 1)],
    lanes: laneSummary(match.world.minions.list, L.list, lanesBuf),
    tutor: ai && ai.difficulty === "tutor" ? ai.stage : -1,
    ...registerInfo(match.register, match.world, match.tick, (e) => teamOf(e) === me),
    ...estateInfo(match),
    ...powderInfo(match),
    structures: structureReport(match.world, match.tick),
    buttresses: [0, 1].map((t) => BUTTRESS_FACES.map((f) => match!.buttress(t, f))) as [number[], number[]],
  };
  if (info.masonry) endSent = true;
  return info;
}

/** 3.4: the structures' bounds (stone layout), once per world. */
let structBounds: Array<{ baseY: number; topY: number }> | null = null;
let structureAt = -1;

/** 3.4: every keep and tower as the page reads it (the mason's eye, the world's tells), every STRUCTURE.reportEvery ticks; null in between and without statics. */
function structureReport(world: SandboxSim, tick: number): StructureInfo[] | null {
  const st = world.statics;
  if (!st) return null;
  if (structureAt >= 0 && tick >= structureAt && tick - structureAt < STRUCTURE.reportEvery) return null;
  structureAt = tick;
  if (!structBounds) {
    structBounds = st.list.map((d) => {
      let lo = Infinity, hi = -Infinity;
      for (const id of d.stones) {
        const s = world.castle.layout.stones[id];
        if (s.part !== "keep" && s.part !== "tower") continue;
        lo = Math.min(lo, s.y - s.hy);
        hi = Math.max(hi, s.y + s.hy);
      }
      return { baseY: lo === Infinity ? 0 : lo, topY: hi === -Infinity ? 12 : hi };
    });
  }
  return st.list.map((d, i) => {
    const r = st.status(i), b = structBounds![i];
    return { index: i, castle: d.castle, kind: d.kind, name: d.name, cx: d.cx, cz: d.cz, half: d.half, baseY: b.baseY, topY: b.topY, state: r.state, holds: r.holds, weakest: r.weakest, crushNear: r.crushNear, toppleNear: r.toppleNear, margin: r.margin, dirX: r.dirX, dirZ: r.dirZ, comX: r.comX, comY: r.comY, comZ: r.comZ, footY: r.footY, hull: r.hull.slice(), drawIn: r.drawIn, heat: r.heat.slice() };
  });
}

/**
 * 3.2: the page's own team's marks (never the other side's), when its next salvo may be ordered,
 * and the guns whose last landing may be marked now. Reads only. `mine` says which emplacements are
 * the page's team's. How many guns bear on each mark is worked out a few times a second.
 */
function registerInfo(reg: Register, world: SandboxSim, tick: number, mine: (e: Emplacement) => boolean): RegisterInfo {
  if (tick - bearAt >= 6 || tick < bearAt) {
    bearAt = tick;
    bearCache.clear();
  }
  const marks: MarkInfo[] = reg.list(me).map((m) => {
    const key = `${m.n}:${m.made}`;
    let bear = bearCache.get(key);
    if (!bear) {
      const soonest = (ids: number[]) => {
        let t = 0;
        for (const id of ids) {
          const r = world.reload[id];
          if (r > 0 && (t === 0 || r < t)) t = r;
        }
        return Math.ceil(t / 60);
      };
      const reach = reg.bearing(me, m.n, false, false), reachM = reg.bearing(me, m.n, true, false);
      // Nothing could reach it: is it because the rules hold fire there? Asked of the match through the register's own host (the same calls as its salvo): one of your men by the mark, or a bridge the shot could hit.
      let why = 0;
      if (reachM.length === 0) {
        const host = (reg as unknown as { host: RegisterHost }).host;
        let own = false, bridge = false;
        for (const e of world.emplacements) {
          if (e.empty || !mine(e)) continue;
          const U = UNMANNED[e.weapon] ?? UNMANNED.longGun!;
          if (host.ownNear?.(me, m.x, m.z, U.clearOwn)) own = true;
          else if (host.bridgeAtRisk?.(e, m.x, m.z, REGISTER.errScale)) bridge = true;
        }
        why = own ? 1 : bridge ? 2 : 0;
      }
      bearCache.set(key, (bear = [reg.bearing(me, m.n, false).length, reg.bearing(me, m.n, true).length, reach.length, reachM.length, soonest(reach), soonest(reachM), why]));
    }
    return { n: m.n, x: m.x, y: m.y, z: m.z, made: m.made, left: Math.max(0, m.fades - tick), life: REGISTER.life, place: placeName(me as 0 | 1, m.x, m.y, m.z, world.terrain.heightAt(m.x, m.z)), bear: bear[0], bearM: bear[1], reach: bear[2], reachM: bear[3], loadS: bear[4], loadMS: bear[5], why: bear[6] === 1 ? "own" : bear[6] === 2 ? "bridge" : "" };
  });
  const canMark: number[] = [];
  for (const e of world.emplacements) if (!e.empty && mine(e) && reg.canMark(me, e.id, tick)) canMark.push(e.id);
  const gangs = (world.gangs?.status() ?? []).filter((g) => g.team === me).map((g) => ({ bridge: g.bridge, state: g.state as number, men: g.men, progress: g.progress }));
  return { marks, salvoReady: Math.max(0, REGISTER.salvoEvery - (tick - reg.salvoAt[me])), canMark, gangs };
}

/** The tops of a keep's timber storeys (m), lowest first: the roof is the last. */
const STOREY_TOPS = KEEP_STOREYS.map((c) => c * CASTLE_SHAPE.course);

/**
 * How many of a keep's storeys still stand under its banner (3: it flies from
 * the roof). Only reads where the banner's body is; the match is untouched.
 * A pole lying on a floor still counts that floor.
 */
function keepFloors(m: Match, castle: 0 | 1): number {
  if (m.world.castle.toppled[castle]) return 0;
  const y = m.world.castle.bodies[m.world.castle.layout.bannerIds[castle]].translation().y;
  let n = 0;
  for (const top of STOREY_TOPS) if (top <= y + 0.25) n++;
  return n;
}

/** For the minimap: each piece's castle section (-1: none), and each section's pieces and pieces at its foot. */
let sectionOfPiece: Int8Array = new Int8Array(0);
let sectionTotal = new Uint16Array(0);
let sectionsAt = -1;

/** Per castle and section: the share of its pieces standing, and of those at its foot (0 to 100). Reads only. */
function sectionShares(): Uint8Array {
  const c = sim!.castle, stones = c.layout.stones;
  const up = new Uint16Array(2 * SECTION_COUNT * 2);
  for (let i = 0; i < stones.length; i++) {
    const k = sectionOfPiece[i];
    if (k < 0 || c.dynamic[i] || c.shattered[i]) continue;
    const at = (stones[i].castle * SECTION_COUNT + k) * 2;
    up[at]++;
    if (stones[i].course < FOOT_COURSES) up[at + 1]++;
  }
  const out = new Uint8Array(up.length);
  for (let j = 0; j < up.length; j++) out[j] = sectionTotal[j] ? Math.round((100 * up[j]) / sectionTotal[j]) : 100;
  return out;
}

/** Each castle's keep boards (stone ids) by storey, lowest first. */
let keepBoards: number[][][] = [[], []];

/**
 * How sound the floor under a keep's banner is, 0 to 1: a whole board counts
 * one, a cracked one (a shell it took) a half, a broken or fallen one
 * nothing. Masons laying boards back raise it again. Reads only.
 */
function floorSound(m: Match, castle: 0 | 1): number {
  const level = keepFloors(m, castle);
  const boards = keepBoards[castle][level - 1];
  if (!boards || !boards.length) return 0;
  const c = m.world.castle;
  let sum = 0;
  for (const id of boards) if (!c.dynamic[id] && !c.shattered[id]) sum += c.hits[id] ? 0.5 : 1;
  return sum / boards.length;
}

/** M3: gold coming in, earnings since the last frame, the player's barracks and every gun. */
function estateInfo(m: Match): Pick<MatchInfo, "income" | "earned" | "goldEarned" | "goldSpent" | "tricks" | "barracks" | "arms" | "foundry"> {
  const ec = m.economy, es = m.estate;
  const feed = ec.feed;
  const earned = new Float32Array(feed.length * EARN_STRIDE);
  feed.forEach((e, i) => earned.set([e.team, e.amount, e.kind, e.x, e.y, e.z], i * EARN_STRIDE));
  ec.feed = [];
  const barracks = new Int8Array(PLOTS.length * 2);
  es.barracks[me].forEach((b, p) => {
    barracks[p * 2] = MIX_NAMES.indexOf(b.mix);
    barracks[p * 2 + 1] = ROUTE_NAMES.indexOf(b.route);
  });
  const arms = new Int8Array(m.emplacements.length * 2);
  m.emplacements.forEach((e, i) => {
    arms[i * 2] = e.empty ? -1 : WEAPON_KINDS.indexOf(e.weapon);
    arms[i * 2 + 1] = e.upgrade ? UPGRADE_KINDS.indexOf(e.upgrade) : -1;
  });
  const tricks = (t: number) => ec.tricks[t].slice(Earn.Ricochet, Earn.KeepHit + 1);
  return {
    income: [m.income(Team.Enemy), m.income(Team.Player)],
    earned,
    goldEarned: [ec.earned[0], ec.earned[1]],
    goldSpent: [ec.spent[0], ec.spent[1]],
    tricks: [tricks(0), tricks(1)],
    barracks,
    arms,
    foundry: [es.foundry(0), es.foundry(1)],
  };
}

/** 3.3: the stores, every ready box and every powder boy's errand (all null when the match plays without powder). */
function powderInfo(m: Match): Pick<MatchInfo, "powder" | "boxes" | "boys"> {
  const c = m.world.carriers;
  if (!c) return { powder: null, boxes: null, boys: null };
  const store = (team: 0 | 1) => {
    const s = c.status(team);
    return { stock: s.stock, cap: s.cap, rate: m.powderRate(team), magazine: s.magazine, lost: s.lost };
  };
  const boxes = new Float32Array(m.emplacements.length * BOX_STRIDE);
  m.emplacements.forEach((e, i) => boxes.set([c.box(i), boxSize(e), shotCost(e), c.eta(i), c.hoisting(i)], i * BOX_STRIDE));
  const errands = c.errands();
  const boys = new Int16Array(errands.length * BOY_STRIDE);
  errands.forEach((b, i) => boys.set([b.team, b.minion, b.task, b.emplacement], i * BOY_STRIDE));
  return { powder: [store(0), store(1)], boxes, boys };
}

function tick(advanceMs = -1) {
  if (!sim || paused || stopped) return;
  if (manual) {
    if (advanceMs < 0) return;
    acc += advanceMs * speed;
  } else {
    const now = performance.now();
    // Online: the side that is ahead of its friend eases off a little and the one behind hurries, so neither waits long.
    const lead = net ? net.lead(now) : 0;
    const pace = lead > 3 ? 0.92 : lead < -3 ? 1.12 : 1;
    acc += (now - last) * speed * pace;
    last = now;
    // After a slow step (a big collapse), fall a little behind real time rather
    // than stall and then rush through the backlog: at most two steps per tick (online, a little more to catch up).
    const cap = net ? DT * 4 : watching ? DT * 8 : DT * 2;
    if (acc > cap) acc = cap;
  }
  let steps = 0;
  // A replay being watched has no wall to keep to but the page's speed (4x needs up to eight steps an interval).
  const most = manual ? (watching ? 48 : 12) : net ? 4 : watching ? 8 : 2;
  while (acc >= DT && steps < most) {
    if (net && !net.canStep()) break; // waiting for the friend's inputs for this tick
    if (watching && match!.tick >= watching.final.tick) break; // the saved match's last tick: stop here
    const t0 = performance.now();
    if (match) {
      ai?.step();
      match.step();
      if (net) {
        net.afterStep(() => netHash(match!));
        netDirty = true;
      }
    } else {
      // 3.2: the range's register fades marks and fires salvo shots before the step, reads landings after it (the match does the same).
      const t = sim.tick;
      practiceReg?.beforeStep(t);
      sim.step();
      practiceReg?.afterStep(t);
    }
    const ms = performance.now() - t0;
    stepEma = stepEma === 0 ? ms : stepEma * 0.9 + ms * 0.1;
    if (ms > peakNow) peakNow = ms;
    if (++peakTicks >= 60) {
      peakLast = peakNow;
      peakNow = 0;
      peakTicks = 0;
    }
    acc -= DT;
    steps++;
  }
  if (net) postNet(steps > 0);
  if (watching && !watchSent && match!.tick >= watching.final.tick) {
    watchSent = true;
    acc = 0;
    const hash = match!.hash();
    post({ t: "watchEnd", tick: match!.tick, hash, ok: hash.state === watching.final.hash.state && hash.world === watching.final.hash.world });
  }
  if (!steps) return;
  const frame = sim.collect();
  const counts = sim.minionCounts();
  // After M5: which guns are knocked out, and for how long yet.
  const out = new Int16Array(sim.emplacements.length * 2);
  sim.mounts.report(sim.tick, out);
  const transfer: Transferable[] = [out.buffer, frame.stones.buffer, frame.projectiles.buffer, frame.chains.buffer, frame.minions.buffer, frame.parts.buffer, frame.settled.buffer, frame.gone.buffer, frame.events.buffer, frame.ladders.buffer, frame.works.buffer, frame.plots.buffer, frame.kegs.buffer];
  const info = matchInfo();
  if (info) transfer.push(info.guns.buffer, info.earned.buffer, info.barracks.buffer, info.arms.buffer);
  if (info?.boxes && info.boys) transfer.push(info.boxes.buffer, info.boys.buffer);
  for (const p of frame.terrain) transfer.push(p.h.buffer);
  // Bridges: whenever the nav grid changed.
  let bridges: boolean[] | null = null;
  if (sim.nav.version !== bridgesSent) {
    bridgesSent = sim.nav.version;
    bridges = sim.bridgesOpen();
  }
  let sections: Uint8Array | null = null;
  if (sim.tick - sectionsAt >= 30 || sectionsAt < 0) {
    sectionsAt = sim.tick;
    sections = sectionShares();
    transfer.push(sections.buffer);
  }
  let nav: NavInfo | null = null;
  const now = performance.now();
  if (navOn && sim.nav.version !== navSent && (manual || now - navAt > 250)) {
    navSent = sim.nav.version;
    navAt = now;
    nav = { version: sim.nav.version, kind: sim.nav.kind.slice(), floor: sim.nav.floor.slice() };
    transfer.push(nav.kind.buffer, nav.floor.buffer);
  }
  post(
    {
      t: "frame",
      frame,
      reload: sim.reload.slice(),
      out,
      stepMs: Math.round(stepEma * 100) / 100,
      stepPeak: Math.round(Math.max(peakNow, peakLast) * 10) / 10,
      down: counts.down,
      standing: counts.standing,
      awake: sim.castle.awakeCount(),
      match: info,
      structures: !match ? structureReport(sim, sim.tick) : null,
      reg: !match && practiceReg ? registerInfo(practiceReg, sim, sim.tick, (e) => e.id < ASHWRIGHT_EMPLACEMENTS.length) : null,
      bridges,
      sections,
      nav,
    },
    transfer as Transferable[],
  );
}

/** Online: this side's lockstep state to the page (which carries it to the friend), when it changed and at most every 30 ms. */
function postNet(stepped: boolean) {
  if (!net) return;
  const now = performance.now();
  if (stepped || net.canStep()) waitingSince = now;
  if (!netDirty && now - netSentAt < 250) return;
  if (now - netSentAt < 30) return;
  netSentAt = now;
  netDirty = false;
  post({ t: "net", state: net.state(), waiting: Math.round(now - waitingSince), delay: net.delay, unacked: net.unacked, desync: net.desync });
}

function start() {
  if (timer !== null) clearInterval(timer);
  last = performance.now();
  acc = 0;
  timer = setInterval(tick, 4);
}

/** Messages are handled one after another: one that arrives while init still loads the physics waits for it (a quick second choice of mode used to be lost). */
let queue: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<ToWorker>) => {
  queue = queue.then(() => handle(e.data));
};

async function handle(msg: ToWorker) {
  try {
    switch (msg.t) {
      case "init":
        gen = msg.gen;
        await load();
        layout ??= buildLayout(1, GAME_LAYOUT);
        rehearse();
        build(msg.mode, msg.seed, msg.minions, msg.setup, msg.replay);
        start();
        break;
      case "reset":
        gen = msg.gen;
        build(msg.mode, msg.seed, msg.minions, msg.setup, msg.replay);
        start();
        break;
      case "netStop":
        // The page left an online match: the old lockstep says nothing more (it would reach the next match's room).
        net = null;
        stopped = true;
        break;
      case "input": {
        const input = msg.input;
        if (watching) break; // a replay is driven by its file alone
        if (match) {
          if (input.kind === "minions") break;
          // Online, an input goes out to the friend and both play it on the same tick, a few ticks ahead.
          if (net) {
            net.local(input as MatchInput);
            netDirty = true;
            postNet(false);
          } else match.queue(match.tick, me, input);
        } else if (sim && practiceReg && (input.kind === "mark" || input.kind === "salvo" || input.kind === "man")) {
          // The range's register: not through a lockstep, there is none. Only the four guns the page rides are its team's.
          if (input.kind === "mark") practiceReg.makeMark(Team.Player, input.emplacement, sim.tick);
          else if (input.kind === "salvo") practiceReg.salvo(Team.Player, input.mark, input.mortar === true, sim.tick);
          else practiceManned = input.emplacement >= 0 && input.emplacement < ASHWRIGHT_EMPLACEMENTS.length ? input.emplacement : -1;
        } else if (sim && (input.kind === "fire" || input.kind === "minions")) sim.queue(sim.tick, input);
        break;
      }
      case "net":
        if (net) {
          net.remote(msg.state, performance.now());
          net.rtt = typeof msg.rtt === "number" && msg.rtt > 0 && msg.rtt < 5000 ? msg.rtt : net.rtt;
          netDirty = true;
        }
        break;
      case "delay":
        if (net) net.delay = Math.max(3, Math.min(40, Math.round(msg.ticks)));
        break;
      case "takeover":
        // The friend has gone: the AI takes their castle from here, and the match goes on alone.
        if (match && net) {
          ai = new AiPlayer(match, net.them, msg.difficulty, matchSeed);
          net = null;
        }
        break;
      case "speed":
        speed = msg.factor;
        break;
      case "saveLog":
        // S6: the file as the match stands now (it goes on): its setup, the inputs it applied, and its tick and hash.
        if (match && matchLog && logSetup) post({ t: "log", text: writeLog(logSetup, matchLog.entries(), match.tick, match.hash()) });
        break;
      case "pause":
        paused = msg.paused;
        last = performance.now();
        break;
      case "nav":
        navOn = msg.on;
        navSent = -1;
        break;
      case "spawn":
        match?.army.spawnWave(msg.team, 1, msg.count, { x: msg.x, z: msg.z }, { ladder: msg.ladder === true });
        break;
      case "dust":
        if (sim) {
          for (const id of msg.ids) sim.castle.dust(id);
          sim.castle.supportNow();
        }
        break;
      case "manual":
        manual = true;
        acc = 0;
        break;
      case "advance":
        tick(msg.seconds * 1000);
        break;
    }
  } catch (err) {
    post({ t: "error", message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
}

export {};
